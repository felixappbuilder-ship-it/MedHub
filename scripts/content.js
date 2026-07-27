// frontend-user/scripts/content.js

/**
 * Content Management Module (Convex + R2)
 * - Fetches resource metadata (thumbnails) from Convex (public, no subscription check)
 * - Caches metadata with manifest version for efficient updates
 * - Downloads actual files only if user has active subscription/trial
 * - Stores downloaded files in IndexedDB (not user-accessible)
 * - Provides filter options (institutions, years) for browsing
 */

import * as db from './db.js';
import * as utils from './utils.js';
import * as ui from './ui.js';
import { convexHttpClient } from './convex-client.js';
import { getToken } from './auth.js';
import * as subscription from './subscription.js';

// Cache keys
const METADATA_CACHE_KEY = 'content_metadata_cache_v2';
const DOWNLOAD_MANIFEST_KEY = 'download_manifest_v2';

// ==================== CACHE HELPERS ====================

async function getCache(subject, category) {
  const cache = await db.getSetting(METADATA_CACHE_KEY, {});
  const key = `${subject}_${category}`;
  return cache[key] || { version: null, documents: [], filters: null, lastFetched: 0 };
}

async function setCache(subject, category, data) {
  const cache = await db.getSetting(METADATA_CACHE_KEY, {});
  const key = `${subject}_${category}`;
  cache[key] = { ...data, lastFetched: Date.now() };
  await db.saveSetting(METADATA_CACHE_KEY, cache);
}

// Internal manifest helpers (used internally and exported)
function getDownloadManifest() {
  return utils.getLocalStorage(DOWNLOAD_MANIFEST_KEY, {});
}

function setDownloadManifest(manifest) {
  utils.setLocalStorage(DOWNLOAD_MANIFEST_KEY, manifest);
}

// ==================== FETCH RESOURCES (with caching) ====================

/**
 * Fetch resources for a subject/category.
 * Uses cached data if manifest version matches.
 * @param {string} subject
 * @param {string} category
 * @param {string|null} cursor (for pagination)
 * @param {Object} filters - { institution, year } (optional)
 * @returns {Promise<{documents: Array, cursor: string|null, hasMore: boolean}>}
 */
export async function fetchResources(subject, category, cursor = null, filters = {}) {
  // If no cursor and no filters, check cache
  if (!cursor && !filters.institution && !filters.year) {
    const cached = await getCache(subject, category);
    try {
      const manifest = await convexHttpClient.query('resources/queries:getManifest', {
        subject,
        category,
      });
      if (manifest && manifest.version === cached.version && cached.documents.length > 0) {
        return {
          documents: cached.documents,
          cursor: null,
          hasMore: false,
        };
      }
    } catch (err) {
      console.warn('[Content] Could not fetch manifest, will refetch all.', err);
    }
  }

  // Build query parameters
  const queryParams = {
    subject,
    category,
    limit: 20,
  };
  // ✅ Only include cursor if it's a valid non-empty string (not null/undefined)
  if (cursor && typeof cursor === 'string' && cursor.length > 0) {
    queryParams.cursor = cursor;
  }

  // Fetch from backend
  try {
    const result = await convexHttpClient.query('resources/queries:getResources', queryParams);

    const documents = result.documents.map((doc) => ({
      _id: doc._id,
      title: doc.title,
      thumbnailUrl: doc.thumbnailUrl,
      fileType: doc.fileType,
      fileSize: doc.fileSize,
      updatedAt: doc.updatedAt,
    }));

    // If first page, update cache
    if (!cursor && !filters.institution && !filters.year) {
      await setCache(subject, category, {
        version: result.manifestVersion,
        documents,
      });
    }

    return {
      documents,
      cursor: result.cursor,
      hasMore: result.hasMore,
    };
  } catch (err) {
    console.error('[Content] Fetch error:', err);
    ui.showToast('Failed to load resources', 'error');
    // Return cached data if available
    const cached = await getCache(subject, category);
    if (cached.documents.length > 0) {
      return { documents: cached.documents, cursor: null, hasMore: false };
    }
    return { documents: [], cursor: null, hasMore: false };
  }
}

// ==================== FILTERS ====================

/**
 * Get available filter values (institutions, years) for a subject/category.
 * @param {string} subject
 * @param {string} category
 * @returns {Promise<{institutions: string[], years: number[]}>}
 */
export async function getAvailableFilters(subject, category) {
  try {
    // Check cache first
    const cached = await getCache(subject, category);
    if (cached.filters) {
      return cached.filters;
    }
    const result = await convexHttpClient.query('resources/queries:getFilters', {
      subject,
      category,
    });
    // Cache filters
    const cacheData = await getCache(subject, category);
    cacheData.filters = result;
    await setCache(subject, category, cacheData);
    return result || { institutions: [], years: [] };
  } catch (err) {
    console.warn('[Content] Failed to fetch filters', err);
    return { institutions: [], years: [] };
  }
}

// ==================== DOWNLOAD FILE ====================

/**
 * Download a resource file.
 * Checks subscription, gets signed URL, stores in IndexedDB.
 * @param {string} resourceId
 * @param {string} title (for display)
 * @returns {Promise<boolean>} success
 */
export async function downloadResource(resourceId, title = '') {
  // Check active subscription/trial first (fast local check)
  const hasActive = await subscription.hasActiveSubscription();
  if (!hasActive) {
    ui.showToast('Active subscription or free trial required to download.', 'warning');
    return false;
  }

  const token = getToken();
  if (!token) {
    ui.showToast('Please log in to download.', 'warning');
    return false;
  }

  ui.showLoading(`Downloading ${title || 'file'}...`);
  try {
    const result = await convexHttpClient.action('resources/actions:getDownloadUrl', {
      token,
      resourceId,
    });

    if (!result.success) {
      if (result.error === 'subscription_required') {
        ui.showToast('Subscription required to download this file.', 'warning');
      } else {
        ui.showToast(result.message || 'Download failed.', 'error');
      }
      return false;
    }

    const { downloadUrl } = result.data;
    const response = await fetch(downloadUrl);
    if (!response.ok) throw new Error('Download failed');

    const blob = await response.blob();
    // Store in IndexedDB
    await db.saveFileBlob(resourceId, blob);

    // Update download manifest
    const manifest = getDownloadManifest();
    manifest[resourceId] = {
      downloadedAt: Date.now(),
      size: blob.size,
      mime: response.headers.get('content-type'),
    };
    setDownloadManifest(manifest);

    ui.showToast('Download complete', 'success');
    return true;
  } catch (err) {
    console.error('[Content] Download error:', err);
    ui.showToast('Download failed. Please try again.', 'error');
    return false;
  } finally {
    ui.hideLoading();
  }
}

// ==================== GET LOCAL FILE ====================

/**
 * Retrieve a downloaded file from IndexedDB.
 * @param {string} resourceId
 * @returns {Promise<Blob|null>}
 */
export async function getLocalFile(resourceId) {
  const manifest = getDownloadManifest();
  if (!manifest[resourceId]) return null;
  return await db.getFileBlob(resourceId);
}

/**
 * Check if a resource is already downloaded.
 * @param {string} resourceId
 * @returns {boolean}
 */
export function isDownloaded(resourceId) {
  const manifest = getDownloadManifest();
  return !!manifest[resourceId];
}

// ==================== FORMAT FILE SIZE ====================

export function formatFileSize(bytes) {
  if (!bytes) return '';
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(1) + ' ' + sizes[i];
}

// ==================== EXPORTS ====================
// Export the manifest helpers so the UI can use them
export { getDownloadManifest, setDownloadManifest };

// Compatibility aliases for the resource-browser.html
export const fetchDocuments = fetchResources;
export const downloadDocument = downloadResource;
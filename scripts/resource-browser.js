// frontend-user/scripts/resource-browser.js

/**
 * Resource Browser Module
 * Now with offline thumbnail caching – thumbnails are fetched and stored in IndexedDB
 * as soon as the resource list is loaded, regardless of file download status.
 */

import * as content from './content.js';
import * as subscription from './subscription.js';
import * as viewer from './viewer.js';
import * as db from './db.js';
import * as ui from './ui.js';
import * as router from './router.js';
import { convexHttpClient } from './convex-client.js';
import { getToken, logout } from './auth.js';

// ==================== CONSTANTS ====================
const CATEGORY_MAP = {
    'study': 'notes',
    'pastpaper': 'pastpapers',
    'textbook': 'textbooks',
    'visual': 'visual'
};
const TYPE_NAMES = {
    study: 'Study Resources',
    pastpaper: 'Past Papers',
    textbook: 'Textbooks',
    visual: 'Visual Concepts'
};
const FAVORITES_KEY = 'favorite_resources';
const MAX_THUMBNAIL_CONCURRENT = 3;   // limit concurrent thumbnail fetches

// ==================== STATE ====================
let currentSubject = null;
let currentCategory = null;
let currentCursor = null;
let isLoading = false;
let hasMore = true;
let currentFilter = 'all';
let searchTerm = '';
let allDocuments = [];
const activeDownloads = new Map();
export const docMap = new Map();

// Thumbnail cache – maps resourceId -> object URL (to avoid regenerating)
const thumbnailCache = new Map();

// ==================== DOM REFS ====================
const grid = document.getElementById('resource-grid');
const loadMoreBtn = document.getElementById('load-more-btn');
const loadMoreSpinner = document.getElementById('load-more-spinner');
const pageTitle = document.getElementById('page-title');
const searchInput = document.getElementById('search-input');
const filterBtn = document.getElementById('filter-btn');
const filterDropdown = document.getElementById('filter-dropdown');

// ==================== FAVORITES HELPERS ====================
function getFavorites() {
    return JSON.parse(localStorage.getItem(FAVORITES_KEY) || '[]');
}
function setFavorites(list) {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(list));
}
function isFavorite(id) {
    return getFavorites().includes(id);
}

// ==================== FILTER & SEARCH ====================
function filterDocuments(docs, filterType, searchTerm) {
    let filtered = docs;
    if (searchTerm.trim()) {
        const term = searchTerm.trim().toLowerCase();
        filtered = filtered.filter(d => d.title.toLowerCase().includes(term));
    }
    switch (filterType) {
        case 'favorites':
            filtered = filtered.filter(d => isFavorite(d._id));
            break;
        case 'downloaded':
            filtered = filtered.filter(d => content.isDownloaded(d._id));
            break;
        case 'recent':
            filtered = filtered.slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
            break;
        default:
            break;
    }
    return filtered;
}

// ==================== RENDER FUNCTIONS ====================
function applyFiltersAndRender() {
    const filtered = filterDocuments(allDocuments, currentFilter, searchInput.value);
    if (filtered.length === 0) {
        grid.innerHTML = '<div class="no-data">No resources match your criteria.</div>';
        return;
    }
    grid.innerHTML = filtered.map(doc => createResourceCard(doc)).join('');
    attachCardEventListeners();
}

/**
 * Returns an src for the thumbnail:
 * - cached blob URL if available
 * - network URL if online
 * - placeholder otherwise
 */
function getThumbnailSrc(doc) {
    if (thumbnailCache.has(doc._id)) {
        return thumbnailCache.get(doc._id);
    }
    // If online and has a URL, use it (will be cached in background)
    if (navigator.onLine && doc.thumbnailUrl) {
        return doc.thumbnailUrl;
    }
    // Offline and not cached – show placeholder
    return null;
}

function createResourceCard(doc) {
    const isDownloaded = content.isDownloaded(doc._id);
    const isFav = isFavorite(doc._id);
    const sizeStr = doc.fileSize ? content.formatFileSize(doc.fileSize) : '';

    let mainBtnHtml = '';
    if (isDownloaded) {
        mainBtnHtml = `<button class="main-btn btn-open" data-id="${doc._id}" data-title="${doc.title}" data-type="${doc.fileType}">Open</button>`;
    } else {
        mainBtnHtml = `<button class="main-btn btn-download" data-id="${doc._id}">⬇ Download</button>`;
    }

    const favBadgeHtml = isFav ? '<div class="favorite-badge">⭐</div>' : '';

    const thumbSrc = getThumbnailSrc(doc);
    const thumbnailHtml = thumbSrc
        ? `<img src="${thumbSrc}" alt="Thumbnail" loading="lazy">`
        : '<div class="thumbnail-placeholder">📄</div>';

    return `
        <div class="resource-card" data-id="${doc._id}">
            ${favBadgeHtml}
            <div class="card-thumbnail">
                ${thumbnailHtml}
            </div>
            <div class="card-info">
                <div>
                    <h3>${doc.title}</h3>
                    <div class="meta">${doc.author || ''} ${doc.year ? `· ${doc.year}` : ''}</div>
                    <span class="type-badge">${doc.category}</span>
                </div>
                <div class="card-stats">
                    <span>${sizeStr}</span>
                    ${doc.isPremium ? '<span class="premium-badge">🔒 Premium</span>' : ''}
                    ${isDownloaded ? '<span class="downloaded-badge">✅ Downloaded</span>' : ''}
                </div>
                <div class="card-actions">
                    ${mainBtnHtml}
                    <div class="menu-wrapper">
                        <button class="menu-btn" data-id="${doc._id}">⋮</button>
                        <div class="menu-dropdown" data-id="${doc._id}">
                            <button class="favorite-btn ${isFav ? 'active' : ''}" data-id="${doc._id}">
                                ${isFav ? '⭐ Remove favorite' : '☆ Add favorite'}
                            </button>
                            <button class="delete-btn" data-id="${doc._id}">🗑️ Delete</button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;
}

// ==================== EVENT LISTENERS ====================
function attachCardEventListeners() {
    document.querySelectorAll('.btn-download, .btn-open').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const id = btn.dataset.id;
            if (btn.classList.contains('btn-open')) {
                const title = btn.dataset.title || 'Document';
                const fileType = btn.dataset.type || 'pdf';
                viewer.openDocument(id, title, fileType);
                return;
            }
            const hasActive = await subscription.hasActiveSubscription();
            if (!hasActive) {
                ui.showToast('Subscription required to download', 'warning');
                router.navigateTo('subscription.html');
                return;
            }
            startDownload(id);
        });
    });

    document.querySelectorAll('.menu-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const menu = btn.closest('.card-actions').querySelector('.menu-dropdown');
            document.querySelectorAll('.menu-dropdown.open').forEach(m => {
                if (m !== menu) m.classList.remove('open');
            });
            menu.classList.toggle('open');
        });
    });

    document.querySelectorAll('.favorite-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const id = btn.dataset.id;
            const favs = getFavorites();
            const idx = favs.indexOf(id);
            if (idx > -1) {
                favs.splice(idx, 1);
                btn.classList.remove('active');
                btn.textContent = '☆ Add favorite';
            } else {
                favs.push(id);
                btn.classList.add('active');
                btn.textContent = '⭐ Remove favorite';
            }
            setFavorites(favs);
            const card = btn.closest('.resource-card');
            const doc = docMap.get(id);
            if (doc) {
                card.outerHTML = createResourceCard(doc);
                attachCardEventListeners();
            }
        });
    });

    document.querySelectorAll('.delete-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const id = btn.dataset.id;
            if (!confirm('Delete this downloaded file?')) return;
            await db.deleteFileBlob(id);
            const manifest = content.getDownloadManifest();
            delete manifest[id];
            content.setDownloadManifest(manifest);
            const doc = docMap.get(id);
            if (doc) {
                const card = btn.closest('.resource-card');
                card.outerHTML = createResourceCard(doc);
                attachCardEventListeners();
            }
            ui.showToast('File deleted', 'success');
        });
    });

    document.addEventListener('click', () => {
        document.querySelectorAll('.menu-dropdown.open').forEach(m => m.classList.remove('open'));
    });
}

// ==================== DOWNLOAD LOGIC ====================
async function startDownload(resourceId) {
    if (activeDownloads.has(resourceId)) return;

    const card = document.querySelector(`.resource-card[data-id="${resourceId}"]`);
    const actions = card.querySelector('.card-actions');
    const doc = docMap.get(resourceId);

    const mainBtn = actions.querySelector('.main-btn');
    mainBtn.innerHTML = `
        <div class="download-progress">
            <span class="spinner-small"></span>
            <span class="percent">0%</span>
        </div>
    `;
    mainBtn.disabled = true;
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'main-btn btn-cancel';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.dataset.id = resourceId;
    actions.insertBefore(cancelBtn, actions.querySelector('.menu-wrapper'));

    const abortController = new AbortController();
    activeDownloads.set(resourceId, abortController);

    cancelBtn.addEventListener('click', () => {
        abortController.abort();
        activeDownloads.delete(resourceId);
        if (doc) {
            card.outerHTML = createResourceCard(doc);
            attachCardEventListeners();
        }
        ui.showToast('Download cancelled', 'info');
    });

    try {
        const token = getToken();
        if (!token) {
            ui.showToast('Please log in again.', 'warning');
            router.navigateTo('login.html');
            return;
        }

        const result = await convexHttpClient.action('resources/actions:getDownloadUrl', {
            token,
            resourceId
        });
        if (!result.success) {
            if (result.message && (result.message.includes('token') || result.message.includes('JWT'))) {
                ui.showToast('Session expired. Please log in again.', 'warning');
                await logout();
                router.navigateTo('login.html');
                return;
            }
            throw new Error(result.message);
        }
        const { downloadUrl } = result.data;

        const response = await fetch(downloadUrl, {
            signal: abortController.signal
        });
        if (!response.ok) throw new Error('Download failed');
        const contentLength = response.headers.get('content-length');
        const total = contentLength ? parseInt(contentLength, 10) : 0;
        const reader = response.body.getReader();
        const chunks = [];
        let loaded = 0;
        const percentEl = mainBtn.querySelector('.percent');

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
            loaded += value.length;
            if (total) {
                const pct = Math.round((loaded / total) * 100);
                if (percentEl) percentEl.textContent = pct + '%';
            } else {
                if (percentEl) percentEl.textContent = (loaded / 1024).toFixed(1) + ' KB';
            }
        }

        const blob = new Blob(chunks);
        await db.saveFileBlob(resourceId, blob);

        const manifest = content.getDownloadManifest();
        manifest[resourceId] = {
            downloadedAt: Date.now(),
            size: blob.size,
            mime: response.headers.get('content-type') || 'application/octet-stream'
        };
        content.setDownloadManifest(manifest);

        if (doc) {
            card.outerHTML = createResourceCard(doc);
            attachCardEventListeners();
        }
        ui.showToast('Download complete', 'success');

    } catch (error) {
        if (error.name === 'AbortError') {
            // handled
        } else {
            console.error('Download error:', error);
            ui.showToast('Download failed: ' + error.message, 'error');
            if (doc) {
                card.outerHTML = createResourceCard(doc);
                attachCardEventListeners();
            }
        }
    } finally {
        activeDownloads.delete(resourceId);
    }
}

// ==================== THUMBNAIL CACHING ====================

/**
 * Downloads and stores a single thumbnail blob in IndexedDB.
 * Returns an object URL for immediate use.
 */
async function cacheThumbnail(resourceId, thumbnailUrl) {
    // Skip if already cached in memory
    if (thumbnailCache.has(resourceId)) return;

    // Check if already in IndexedDB
    const existing = await db.getThumbnailBlob(resourceId);
    if (existing) {
        const url = URL.createObjectURL(existing);
        thumbnailCache.set(resourceId, url);
        return;
    }

    if (!navigator.onLine || !thumbnailUrl) return; // can't download offline

    try {
        const response = await fetch(thumbnailUrl);
        if (!response.ok) throw new Error('Failed to fetch thumbnail');
        const blob = await response.blob();
        await db.saveThumbnailBlob(resourceId, blob);
        const url = URL.createObjectURL(blob);
        thumbnailCache.set(resourceId, url);
    } catch (err) {
        console.warn(`Failed to cache thumbnail for ${resourceId}:`, err);
    }
}

/**
 * Processes all uncached thumbnails in the background with concurrency limit.
 */
async function cacheAllThumbnails(documents) {
    const toCache = documents.filter(doc => doc.thumbnailUrl && !thumbnailCache.has(doc._id));
    if (toCache.length === 0) return;

    // Avoid overwhelming network – process in batches
    const queue = [...toCache];
    const workers = new Array(MAX_THUMBNAIL_CONCURRENT).fill(null).map(async () => {
        while (queue.length > 0) {
            const doc = queue.shift();
            await cacheThumbnail(doc._id, doc.thumbnailUrl);
        }
    });
    await Promise.allSettled(workers);

    // After caching, refresh the grid if we're still displaying these documents
    applyFiltersAndRender();
}

// ==================== LOAD RESOURCES ====================
async function loadResources(reset = true) {
    if (isLoading) return;
    isLoading = true;

    if (reset) {
        currentCursor = null;
        hasMore = true;
        allDocuments = [];
        loadMoreBtn.style.display = 'none';
        loadMoreSpinner.style.display = 'none';
    } else {
        loadMoreSpinner.style.display = 'block';
        loadMoreBtn.style.display = 'none';
    }

    const result = await content.fetchResources(
        currentSubject,
        currentCategory,
        currentCursor,
        {}
    );

    if (reset) {
        allDocuments = result.documents;
    } else {
        allDocuments = allDocuments.concat(result.documents);
    }
    allDocuments.forEach(d => docMap.set(d._id, d));

    currentCursor = result.cursor;
    hasMore = result.hasMore;
    loadMoreBtn.style.display = hasMore ? 'inline-block' : 'none';
    loadMoreSpinner.style.display = 'none';
    isLoading = false;

    applyFiltersAndRender();

    // Start background thumbnail caching (non-blocking)
    cacheAllThumbnails(result.documents);
}

// ==================== VIEWER COORDINATION ====================
export function showViewer(docId, title, fileType) {
    viewer.showEmbeddedViewer(docId, title, fileType);
}

export function closeViewer() {
    viewer.closeEmbeddedViewer();
}

// ==================== INITIALIZATION ====================
export async function initResourceBrowser(subject, type) {
    currentSubject = subject;
    currentCategory = CATEGORY_MAP[type] || type;

    const typeName = TYPE_NAMES[type] || 'Resources';
    pageTitle.textContent = `${typeName} – ${subject}`;

    // Pre-populate thumbnail cache from IndexedDB for already cached thumbnails
    // (so we can show them immediately without waiting for network)
    // This is optional but improves perceived performance.
    // We'll do this after the first loadResources so we have the doc list.
    await loadResources(true);

    // Now that we have documents, try to load any existing thumbnails from DB
    for (const doc of allDocuments) {
        if (doc.thumbnailUrl) {
            const blob = await db.getThumbnailBlob(doc._id);
            if (blob && !thumbnailCache.has(doc._id)) {
                thumbnailCache.set(doc._id, URL.createObjectURL(blob));
            }
        }
    }
    // Re-render to use cached thumbnails if available
    applyFiltersAndRender();

    // ---- Event listeners ----
    searchInput.addEventListener('input', debounce(() => applyFiltersAndRender(), 300));
    filterBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        filterDropdown.classList.toggle('open');
    });
    document.addEventListener('click', () => filterDropdown.classList.remove('open'));

    filterDropdown.querySelectorAll('button').forEach(btn => {
        btn.addEventListener('click', () => {
            currentFilter = btn.dataset.filter;
            filterDropdown.querySelectorAll('button').forEach(b => b.classList.remove('active-filter'));
            btn.classList.add('active-filter');
            filterDropdown.classList.remove('open');
            applyFiltersAndRender();
        });
    });

    loadMoreBtn.addEventListener('click', () => loadResources(false));

    window.addEventListener('click', (e) => {
        if (!e.target.closest('.filter-wrapper')) {
            filterDropdown.classList.remove('open');
        }
    });

    // Listen for coming back online – re-cache any missing thumbnails
    window.addEventListener('online', () => {
        cacheAllThumbnails(allDocuments);
    });
}

// ==================== DEBOUNCE ====================
function debounce(fn, delay) {
    let timer;
    return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn(...args), delay);
    };
}
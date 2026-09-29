// scripts/page-manager.js

import { loadPage } from './page-loader.js';
import * as auth from './auth.js';
import * as ui from './ui.js';
import * as router from './router.js';

// State
let currentPage = null;      // { name, root, cleanup, module, scriptPath }
let abortController = null;

/**
 * Navigate to a new page.
 *
 * @param {string} pageName - Page name (e.g., 'home')
 * @param {Object} params  - Dynamic route parameters
 * @param {URLSearchParams} query - Query parameters
 * @param {string} hash     - URL hash fragment
 */
export async function navigateTo(pageName, params = {}, query = new URLSearchParams(), hash = '') {
    // 1. Tear down the current page
    if (currentPage) {
        await destroyCurrentPage();
    }

    // 2. Fresh AbortController for this page
    abortController = new AbortController();
    const signal = abortController.signal;

    try {
        // 3. Load HTML + metadata + module
        const pageMeta = await loadPage(pageName);

        // 4. Auth gate (before injection, so we never paint a protected page)
        if (pageMeta.auth === 'required' && !auth.checkAuth()) {
            const returnTo = encodeURIComponent('/' + pageName);
            router.navigateTo(`/login?returnTo=${returnTo}`);
            return;
        }

        // 5. Page-specific CSS — awaited so there's no flash of unstyled content
        if (pageMeta.style) {
            await loadStylesheet(pageMeta.style, pageName);
        }

        // 6. Inject page HTML
        const appRoot = document.getElementById('app-root');
        if (!appRoot) throw new Error('#app-root not found');
        appRoot.innerHTML = pageMeta.html;

        // 7. Title immediately, before the page script runs
        document.title = pageMeta.title || 'MedVix';

        // 8. Locate the injected section
        const root = appRoot.querySelector('section[data-page]');
        if (!root) {
            throw new Error(`Page "${pageName}" has no <section data-page>.`);
        }

        // 9. Context object passed to every page's init().
        //    Every scripts/pages/*.js reads `context.root` for its queries.
        const context = {
            root,
            page: pageName,
            path: `/${pageName}`,
            query,
            params,
            hash,
            signal,
            router: {
                navigateTo,
                goBack: () => window.history.back(),
            },
        };

        // 10. Call the page's init.
        let cleanup = null;
        if (pageMeta.module && typeof pageMeta.module.init === 'function') {
            cleanup = await pageMeta.module.init(context);
        }

        // 11. Remember the page for teardown on next navigation
        currentPage = {
            name: pageName,
            root,
            cleanup: typeof cleanup === 'function' ? [cleanup] : [],
            module: pageMeta.module,
            scriptPath: pageMeta.script,
        };

        console.log(`[PageManager] Loaded "${pageName}".`);

    } catch (err) {
        console.error('[PageManager] Failed to load page:', err);
        showErrorPage(err);
    }
}

/**
 * Tear down the current page: destroy(), cleanup fns, abort fetches,
 * remove page CSS, clear the mount point.
 */
async function destroyCurrentPage() {
    const page = currentPage;
    if (!page) return;
    currentPage = null;

    // Module's own destroy()
    if (page.module && typeof page.module.destroy === 'function') {
        try { await page.module.destroy(); }
        catch (e) { console.warn('[PageManager] destroy() error:', e); }
    }

    // Cleanup functions returned by init()
    if (Array.isArray(page.cleanup)) {
        for (const fn of page.cleanup) {
            try { if (typeof fn === 'function') fn(); }
            catch (e) { console.warn('[PageManager] cleanup error:', e); }
        }
    }

    // Abort any in-flight fetches the page started with context.signal
    if (abortController) {
        abortController.abort();
        abortController = null;
    }

    // Remove page-specific CSS
    document.querySelectorAll(`link[data-page="${page.name}"]`).forEach(el => el.remove());

    // Clear the mount point
    const appRoot = document.getElementById('app-root');
    if (appRoot) appRoot.innerHTML = '';
}

/**
 * Append a <link> for a page's stylesheet and resolve when it's loaded
 * (or on error — a missing stylesheet shouldn't block navigation).
 */
function loadStylesheet(href, pageName) {
    return new Promise(resolve => {
        const existing = document.querySelector(`link[data-page="${pageName}"][href="${href}"]`);
        if (existing) return resolve();

        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = href;
        link.dataset.page = pageName;
        link.onload = () => resolve();
        link.onerror = () => {
            console.warn(`[PageManager] CSS failed to load: ${href}`);
            resolve();
        };
        document.head.appendChild(link);
    });
}

/**
 * Render the fallback error page.
 */
function showErrorPage(err) {
    const appRoot = document.getElementById('app-root');
    if (!appRoot) return;

    appRoot.innerHTML = `
        <section class="page error-page" data-page="error" data-title="Error">
            <header class="page-header">
                <h1>Something went wrong</h1>
            </header>
            <main class="page-content">
                <p id="error-message">${escapeHtml(err.message || 'Unknown error')}</p>
                <button id="error-home-btn" type="button">Go to Home</button>
            </main>
        </section>
    `;
    document.title = 'Error';

    const btn = document.getElementById('error-home-btn');
    if (btn) btn.addEventListener('click', () => router.navigateTo('/home'));
}

function escapeHtml(s) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

export function goBack() {
    window.history.back();
}
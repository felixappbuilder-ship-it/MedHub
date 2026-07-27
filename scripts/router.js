// frontend-user/scripts/router.js

/**
 * Client-Side Router – FULL VERSION
 * Handles navigation from all HTML pages, enforces authentication,
 * and maps page names to correct absolute paths.
 *
 * Subscription and free‑topic access is handled by the page itself
 * (e.g., exam-room.html), not by the router.
 */

import * as app from './app.js';
import * as ui from './ui.js';
import * as utils from './utils.js';

// ==================== ROUTE PERMISSIONS ====================
const ROUTES = {
    public: [
        'index.html',
        'welcome.html',
        'login.html',
        'signup.html',
        'forgot-password.html',
        'locked.html',
        'shared-exam.html'
    ],
    protected: [
        'subjects.html',
        'subject-specific.html',
        'subscription.html',
        'free-trial.html',
        'payment.html',
        'exam-settings.html',
        'exam-room.html',      // authentication required, but subscription check inside the page
        'results.html',
        'performance.html',
        'profile.html'
    ]
};

// ==================== ALLOWED NAVIGATION FLOWS ====================
const FLOW = {
    'index.html': ['welcome.html'],
    'welcome.html': ['login.html', 'signup.html', 'subjects.html'],
    'login.html': ['subjects.html', 'forgot-password.html'],
    'signup.html': ['free-trial.html', 'subjects.html'],
    'subjects.html': [
        'subject-specific.html',
        'exam-settings.html',
        'performance.html',
        'profile.html',
        'subscription.html'
    ],
    'subject-specific.html': ['exam-settings.html', 'subjects.html'],
    'exam-settings.html': ['exam-room.html', 'subject-specific.html', 'subjects.html'],
    'exam-room.html': ['results.html', 'subjects.html'],
    'results.html': ['exam-settings.html', 'subjects.html', 'performance.html'],
    'performance.html': ['subjects.html', 'profile.html', 'subject-specific.html'],
    'profile.html': ['subjects.html'],
    'subscription.html': ['payment.html', 'free-trial.html', 'subjects.html'],
    'payment.html': ['subscription.html', 'subjects.html'],
    'free-trial.html': ['subscription.html', 'subjects.html'],
    'forgot-password.html': ['login.html']
};


// ==================== PERMISSION CHECK ====================

function isAllowed(targetPage, currentPage) {
    // Public pages always allowed
    if (ROUTES.public.includes(targetPage)) return true;

    // Authentication check
    const isLoggedIn = app.checkAuth();
    if (!isLoggedIn && ROUTES.protected.includes(targetPage)) {
        ui.showToast('Please log in first', 'warning');
        return false;
    }

    // Flow check – if the transition is explicitly forbidden, block it.
    // But we allow going back to home/welcome always.
    if (FLOW[currentPage] && !FLOW[currentPage].includes(targetPage)) {
        // Allow navigation to index or welcome from anywhere
        if (targetPage === 'index.html' || targetPage === 'welcome.html') {
            return true;
        }
        // Otherwise, allow but warn (could be intentional)
        console.warn(`Navigation from ${currentPage} to ${targetPage} is not in the standard flow.`);
        return true;
    }

    return true;
}

// ==================== URL BUILDER ====================

function buildUrl(page) {
    // Split into path and query/hash
    const [pathAndQuery, hash] = page.split('#');
    const [base, query] = pathAndQuery.split('?');
    const cleanBase = base.replace(/^\/+|\/+$/g, ''); // trim slashes

    let absolutePath;
    if (cleanBase === 'index.html') {
        absolutePath = '/index.html';
    } else {
        absolutePath = `/pages/${cleanBase}`;
    }

    // Add query and hash if present
    let result = absolutePath;
    if (query) result += '?' + query;
    if (hash) result += '#' + hash;
    return result;
}

// ==================== NAVIGATE ====================

export function navigateTo(page, data = {}) {
    console.log(`[Router] Navigating to: ${page}`);

    const current = getCurrentPage();
    const base = page.split('?')[0].split('#')[0]; // strip query/hash for check

    if (!isAllowed(base, current)) {
        return;
    }

    if (Object.keys(data).length > 0) {
        sessionStorage.setItem('navData', JSON.stringify(data));
    }

    const targetUrl = buildUrl(page);

    // Show transition overlay if available
    const overlay = document.querySelector('.page-transition-overlay') || (() => {
        const el = document.createElement('div');
        el.className = 'page-transition-overlay';
        document.body.appendChild(el);
        return el;
    })();
    overlay.style.display = 'block';
    overlay.style.opacity = '1';

    // Small delay to allow overlay to show
    setTimeout(() => {
        window.location.href = targetUrl;
    }, 50);
}

// ==================== GET CURRENT PAGE ====================

export function getCurrentPage() {
    const path = window.location.pathname;
    if (path === '/' || path === '/index.html') return 'index.html';
    const parts = path.split('/');
    const filename = parts[parts.length - 1];
    return filename || 'index.html';
}

// ==================== NAVIGATION DATA ====================

export function getNavData() {
    const data = sessionStorage.getItem('navData');
    sessionStorage.removeItem('navData');
    return data ? JSON.parse(data) : {};
}

// ==================== GO BACK ====================

export function goBack() {
    window.history.back();
}

// ==================== EXPOSE GLOBALLY ====================

window.router = { navigateTo, goBack };
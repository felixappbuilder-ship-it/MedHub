// scripts/app.js

// ============================================================
// IMPORTS – Core modules
// ============================================================
import * as utils from './utils.js';
import * as db from './db.js';
import { convexHttpClient } from './convex-client.js';
import * as subscription from './subscription.js';
import * as auth from './auth.js';
import * as sync from './sync.js';
import * as notifications from './notifications.js';
import * as referral from './referral.js';
import * as timeVerifier from './timeVerifier.js';
import * as ui from './ui.js';
import * as security from './security.js';
import { initRouter, navigateTo } from './router.js';
import * as updates from './updates.js';
import * as events from './events.js';

// ============================================================
// STATE
// ============================================================
let appAuthenticated = false;
let referralCode = null;

// ============================================================
// PROGRESS BAR
// ============================================================
let progressFill = null;

function getProgressFill() {
    if (!progressFill) {
        progressFill = document.getElementById('progressFill');
    }
    return progressFill;
}

function updateProgress(percent) {
    const el = getProgressFill();
    if (el) {
        el.style.width = Math.min(100, Math.max(0, percent)) + '%';
    }
}

function completeProgress() {
    updateProgress(100);
}

// ============================================================
// SPLASH CLEANUP
// ============================================================
async function destroySplash() {
    console.log('[Splash] Destroying splash...');

    const splash = document.getElementById('app-bootstrap');
    if (splash) {
        splash.style.opacity = '0';
        await new Promise(resolve => setTimeout(resolve, 500));
        splash.remove();
    }

    const splashCss = document.getElementById('medvex-splash-css');
    if (splashCss) splashCss.remove();

    document.documentElement.classList.remove('app-ready', 'medvex-app-ready');
    document.body.classList.remove('splash-active', 'medvex-splash-active');

    progressFill = null;
    console.log('[Splash] Destroyed.');
}

// ============================================================
// TIMEOUT HELPER
// ============================================================
function withTimeout(promise, ms = 8000) {
    return Promise.race([
        promise,
        new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Network timeout')), ms)
        )
    ]);
}

// ============================================================
// INITIALIZATION
// ============================================================
export async function initializeApp() {
    console.log('[App] Initializing...');
    updateProgress(5);

    try {
        // 1. Referral detection from current URL
        if (!utils.getLocalStorage('accessToken')) {
            const refCode = referral.detectReferralFromURL();
            if (refCode) {
                console.log('[App] Referral code detected:', refCode);
                referral.validateReferralCode(refCode).then(result => {
                    if (result.valid) {
                        console.log('[App] Referral valid, referrer:', result.referrerName);
                    } else {
                        console.warn('[App] Referral invalid, clearing');
                        referral.clearStoredReferralCode();
                    }
                });
            }
        }
        updateProgress(15);

        const token = utils.getLocalStorage('accessToken');
        console.log('[App] Token:', token ? 'exists' : 'none');

        // 2. Load user
        await auth.initUser();
        updateProgress(30);

        // 3. Load subscription
        await subscription.initSubscription();
        updateProgress(45);

        // 4. Load app settings
        const savedSettings = utils.getLocalStorage('appSettings', null);
        if (savedSettings) {
            ui.setAppSettings(savedSettings);
        }
        updateProgress(55);

        // 5. Time verification
        if (!timeVerifier.verifyTime()) {
            return;
        }
        updateProgress(65);

        // 6. Silent token refresh
        let validToken = false;
        if (token && navigator.onLine) {
            console.log('[App] Online with token – refreshing session...');
            try {
                const refreshed = await withTimeout(auth.refreshSession(), 8000);
                if (refreshed) {
                    validToken = true;
                    console.log('[App] Token refreshed');
                }
            } catch (err) {
                console.warn('[App] Session refresh error:', err);
            }
        }
        updateProgress(75);

        if (validToken) {
            console.log('[App] Syncing data...');
            try {
                await withTimeout(sync.syncUserData(), 8000);
                await withTimeout(sync.triggerFullSync(), 8000);
            } catch (err) {
                console.warn('[App] Data sync timed out', err);
            }
        }
        updateProgress(85);

        if (notifications && typeof notifications.init === 'function') {
            notifications.init();
        }
        updateProgress(95);

        console.log('[App] Loaded user:', auth.getUser());
    } catch (e) {
        console.warn('[App] Init error, using fallback', e);
        auth.fallbackLoadUser();
        subscription.fallbackLoadSubscription();
    }

    updates.registerUpdateListener();
    completeProgress();
}

// ============================================================
// GLOBAL TIME-TAMPER LISTENER
// ============================================================
window.addEventListener('time-tamper-detected', async () => {
    console.warn('[App] Time tamper detected – logging out');
    await auth.clearUser();
    navigateTo('login?error=time_tamper');
});

// ============================================================
// SPA BOOTSTRAP
// ============================================================
async function bootstrap() {
    try {
        // 1. Referral detection
        referralCode = referral.detectReferralFromURL();
        if (referralCode) {
            const badge = document.getElementById('referralBadge');
            const codeSpan = document.getElementById('refBadgeCode');
            if (badge && codeSpan) {
                badge.style.display = 'block';
                codeSpan.textContent = referralCode;
            }
        }

        // 2. Initialize the core application
        await initializeApp();

        // 3. Auth state
        appAuthenticated = auth.checkAuth();

        // 4. Apply theme
        if (ui.applyTheme) ui.applyTheme();

        // 5. Start the router.
        //    The router reads window.location (path + query + hash),
        //    resolves the route, pushes the URL, and renders the page.
        initRouter();

        // 6. Wait for the first page to render
        const appRoot = document.getElementById('app-root');
        if (appRoot && !appRoot.children.length) {
            await new Promise((resolve) => {
                const observer = new MutationObserver(() => {
                    if (appRoot.children.length > 0) {
                        observer.disconnect();
                        resolve();
                    }
                });
                observer.observe(appRoot, { childList: true });
            });
        }

        // 7. Application is ready – destroy splash
        await destroySplash();

        // 8. Register service worker
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('/service-worker.js');
        }
    } catch (error) {
        console.error('[App] Bootstrap failed:', error);

        const splash = document.getElementById('app-bootstrap');
        if (splash) splash.remove();

        const splashCss = document.getElementById('medvex-splash-css');
        if (splashCss) splashCss.remove();

        document.documentElement.classList.remove('app-ready', 'medvex-app-ready');
        document.body.classList.remove('splash-active', 'medvex-splash-active');

        progressFill = null;

        const appRoot = document.getElementById('app-root');
        if (appRoot) {
            appRoot.innerHTML = `
                <section class="page error-page" data-page="error">
                    <h1>Application Error</h1>
                    <p>${error.message || 'Unknown error'}</p>
                    <button onclick="router.navigateTo('welcome')">Go to Welcome</button>
                </section>
            `;
        }
    }
}

bootstrap();

// ============================================================
// EXPOSE GLOBALLY
// ============================================================
import * as examEngine from './exam-engine.js';
import * as payment from './payment.js';

window.app = {
    initializeApp,

    // ---- Auth ----
    setToken: auth.setToken,
    clearToken: auth.clearToken,
    checkAuth: auth.checkAuth,
    setUser: auth.setUser,
    getUser: auth.getUser,
    clearUser: auth.clearUser,
    initUser: auth.initUser,
    fallbackLoadUser: auth.fallbackLoadUser,
    refreshSession: auth.refreshSession,

    // ---- Google Sign-In ----
    loginWithGoogle: auth.loginWithGoogle,
    linkGoogleAccount: auth.linkGoogleAccount,

    // ---- Subscription ----
    setSubscription: subscription.setSubscription,
    getSubscription: subscription.getSubscription,
    hasActiveSubscription: subscription.hasActiveSubscription,
    clearSubscription: subscription.clearSubscription,
    refreshSubscription: subscription.refreshSubscription,

    // ---- Exam engine ----
    setExamState: examEngine.setExamState,
    getExamState: examEngine.getExamState,
    clearExamState: examEngine.clearExamState,
    setExamConfig: examEngine.setExamConfig,
    getExamConfig: examEngine.getExamConfig,
    clearExamConfig: examEngine.clearExamConfig,

    // ---- UI / App settings ----
    setAppSetting: ui.setAppSetting,
    getAppSetting: ui.getAppSetting,
    toggleTheme: ui.toggleTheme,

    // ---- Plan / Payment ----
    setSelectedPlan: payment.setSelectedPlan,
    getSelectedPlan: payment.getSelectedPlan,
    setCurrentTransaction: payment.setCurrentTransaction,
    getCurrentTransaction: payment.getCurrentTransaction,

    // ---- Service worker updates ----
    checkForUpdates: updates.checkForUpdates,
    skipWaitingAndReload: updates.skipWaitingAndReload,

    // ---- Sync ----
    syncUserData: sync.syncUserData,
    triggerFullSync: sync.triggerFullSync,
    syncData: sync.syncData,
    syncExamResults: sync.syncExamResults,
    syncUserProfile: sync.syncUserProfile,
    syncSubscription: sync.syncSubscription,

    // ---- Event bus ----
    events: events.events,
};
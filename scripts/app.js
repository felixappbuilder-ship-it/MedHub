// frontend-user/scripts/app.js

import * as utils from './utils.js';
import * as db from './db.js';
import { convexHttpClient } from './convex-client.js';
import * as subscription from './subscription.js';
import { getToken, refreshSession } from './auth.js';  // ✅ ADDED refreshSession
import * as sync from './sync.js';
import * as notifications from './notifications.js';
import * as referral from './referral.js';
import * as timeVerifier from './timeVerifier.js';     // ✅ NEW: time tamper detection

// ==================== TIMEOUT HELPER ====================
// Added to prevent indefinite hangs when network is unavailable (0 B).
function withTimeout(promise, ms = 8000) {
    return Promise.race([
        promise,
        new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Network timeout')), ms)
        )
    ]);
}

// ==================== GLOBAL STATE ====================

let currentUser = null;
let subscriptionStatus = null;
let examState = null;
let appSettings = {
    theme: 'auto',
    notifications: true,
    sound: true
};
let selectedPlan = null;
let currentTransaction = null;
let examConfig = null;
let updatePending = false;

// Helper to extract error message
function getErrorMessage(error) {
    if (error.data?.message) return error.data.message;
    if (error.message) return error.message;
    return 'An unknown error occurred';
}

// ==================== ACTIVE SYNC FROM BACKEND ====================

/**
 * Fetch fresh user profile from backend and update local cache.
 * @returns {Promise<boolean>} true if successful
 */
async function syncUserProfile() {
    const token = getToken();
    if (!token || !navigator.onLine) return false;
    try {
        const result = await convexHttpClient.query("users/queries:getProfile", { token });
        if (result && result.success && result.data && result.data.user) {
            const freshUser = result.data.user;
            console.log('[App] Fetched user profile from backend:', freshUser);
            await setUser(freshUser);
            console.log('[App] User profile synced from backend');
            return true;
        } else if (result && !result.success) {
            console.warn('[App] Profile sync failed:', result.message);
        }
    } catch (err) {
        console.warn('[App] Could not sync user profile', err);
    }
    return false;
}

/**
 * Fetch fresh subscription status from backend and update local cache.
 * @returns {Promise<boolean>} true if successful
 */
async function syncSubscriptionStatus() {
    const token = getToken();
    if (!token || !navigator.onLine) return false;
    try {
        const freshSub = await subscription.getSubscriptionStatus(true);
        if (freshSub) {
            subscriptionStatus = freshSub;
            console.log('[App] Subscription status synced:', {
                expiry: freshSub.expiryDate,
                isActive: freshSub.isActive,
                plan: freshSub.plan,
                status: freshSub.status
            });
            return true;
        }
    } catch (err) {
        console.warn('[App] Could not sync subscription status', err);
    }
    return false;
}

/**
 * Sync all user data from backend (profile + subscription).
 * Call after login/register or periodically.
 */
export async function syncUserData() {
    console.log('[App] Syncing user data from backend...');
    await Promise.all([syncUserProfile(), syncSubscriptionStatus()]);
}

/**
 * Perform a full sync of all data (exam results, notes, conversations, etc.)
 * using the sync module. This is the main sync function for all data types.
 */
export async function triggerFullSync() {
    console.log('[App] Triggering full sync...');
    await sync.syncData();
}

// ==================== INITIALIZATION ====================

export async function initializeApp() {
    console.log('[App] Initializing...');
    try {
        // 1. Check for referral code in URL (BEFORE anything else)
        if (!utils.getLocalStorage('accessToken')) {
            // Only detect referral if not logged in (avoid self-referral issues)
            const refCode = referral.detectReferralFromURL();
            if (refCode) {
                console.log('[App] Referral code detected from URL:', refCode);
                // Optionally validate it (async)
                referral.validateReferralCode(refCode).then(result => {
                    if (result.valid) {
                        console.log('[App] Referral code is valid, referrer:', result.referrerName);
                    } else {
                        console.warn('[App] Referral code is invalid, clearing');
                        referral.clearStoredReferralCode();
                    }
                });
            }
        }

        const token = utils.getLocalStorage('accessToken');
        console.log('[App] Token from localStorage:', token ? 'exists' : 'none');

        let userFromDB = null;
        try {
            userFromDB = await db.getUser();
            console.log('[App] User from IndexedDB:', userFromDB ? userFromDB._id : 'none');
        } catch (e) {
            console.warn('[App] Failed to load from IndexedDB', e);
        }

        const userFromStorage = utils.getLocalStorage('user', null);
        if (userFromDB) {
            currentUser = userFromDB;
            console.log('[App] Loaded user from IndexedDB:', currentUser);
        } else if (userFromStorage) {
            currentUser = userFromStorage;
            if (userFromStorage) {
                try {
                    await db.saveUser(userFromStorage);
                    console.log('[App] Restored user from localStorage to IndexedDB');
                } catch (e) {}
            }
        } else {
            currentUser = null;
        }

        // If we have a token and user, start notification polling (handled by setUser)
        if (token && currentUser) {
            notifications.startPolling();
        }

        let subFromDB = null;
        try {
            subFromDB = await db.getSubscription();
        } catch (e) {}
        subscriptionStatus = subFromDB || utils.getLocalStorage('subscription', null);
        appSettings = utils.getLocalStorage('appSettings', appSettings);

        console.log('[App] Final loaded user:', currentUser ? currentUser._id : 'none');

        // ✅ TIME VERIFICATION – must happen before any Date.now() usage
        if (!timeVerifier.verifyTime()) {
            // verifyTime already dispatched the 'time-tamper-detected' event.
            // The global listener will handle logout and redirect.
            // We stop initialization here.
            return;
        }

        // ================================================================
        // 🔄 SILENT TOKEN REFRESH ON STARTUP (if online and token exists)
        // ================================================================
        let validToken = false;
        if (token && navigator.onLine) {
            console.log('[App] Online with token – attempting silent refresh...');
            try {
                // ✅ TIMEOUT added – prevents indefinite hang
                const refreshed = await withTimeout(refreshSession(), 8000);
                if (refreshed) {
                    validToken = true;
                    console.log('[App] Token refreshed successfully');
                } else {
                    console.warn('[App] Could not refresh session – using cached data');
                }
            } catch (err) {
                console.warn('[App] Session refresh error (timeout or other):', err);
                // validToken stays false → we continue with cached data
            }
        } else {
            console.log('[App] Offline or no token – using cached data only');
        }

        // Only sync if we have a valid token (either fresh or still valid)
        if (validToken) {
            console.log('[App] Syncing fresh data with valid token...');
            try {
                // ✅ TIMEOUT on both syncs
                await withTimeout(syncUserData(), 8000);
                await withTimeout(triggerFullSync(), 8000);
            } catch (err) {
                console.warn('[App] Data sync timed out – using cached data', err);
                // Do NOT clear token/user – stay offline
            }
        } else {
            console.log('[App] No valid token – using cached data only');
        }

        // ✅ Let notifications module handle loading and polling
        if (notifications && typeof notifications.init === 'function') {
            notifications.init();
        }

        console.log('[App] Loaded user:', currentUser);
    } catch (e) {
        console.warn('[App] Initialization error, using localStorage fallback', e);
        currentUser = utils.getLocalStorage('user', null);
        subscriptionStatus = utils.getLocalStorage('subscription', null);
    }

    registerUpdateListener();
}

// ==================== AUTHENTICATION ====================

export function setAuthToken(token) {
    if (token) {
        utils.setLocalStorage('accessToken', token);
        // Restart notification polling after login (if user exists)
        if (navigator.onLine && currentUser) {
            notifications.startPolling();
        }
    } else {
        utils.removeLocalStorage('accessToken');
        utils.removeLocalStorage('refreshToken');
        // Stop notification polling on logout
        notifications.stopPolling();
    }
}

export function checkAuth() {
    const token = utils.getLocalStorage('accessToken');
    const hasUser = !!currentUser;
    console.log('[App] checkAuth: token exists?', !!token, 'user exists?', hasUser);
    return !!token && hasUser;
}

// ==================== USER MANAGEMENT ====================

export async function setUser(user) {
    if (!user || !user._id) {
        console.warn('[App] setUser called with invalid user', user);
        return;
    }
    console.log('[App] Setting user:', user._id);
    console.log('[App] User data:', {
        name: user.name,
        email: user.email,
        phone: user.phone,
        institution: user.institution,
        yearOfStudy: user.yearOfStudy,
        preferences: user.preferences,
        role: user.role,
        username: user.username,
        displayName: user.displayName
    });
    currentUser = user;

    try {
        await db.saveUser(user);
        console.log('[App] User saved to IndexedDB');
    } catch (e) {
        console.warn('[App] IndexedDB save failed, using localStorage', e);
    }
    utils.setLocalStorage('user', user);
    console.log('[App] User set and saved to both storages');

    // Start notification polling if online and token exists
    if (navigator.onLine && getToken()) {
        notifications.startPolling();
    }
}

export function getUser() {
    return currentUser;
}

export async function clearUser() {
    console.log('[App] Clearing user');
    currentUser = null;
    try {
        await db.deleteAllUsers();
        console.log('[App] User deleted from IndexedDB');
    } catch (e) {
        console.warn('[App] IndexedDB delete failed', e);
    }
    utils.removeLocalStorage('user');
    setAuthToken(null);
    console.log('[App] User cleared');
    notifications.stopPolling();
}

// ==================== SUBSCRIPTION MANAGEMENT ====================

export async function setSubscription(subscriptionObj) {
    subscriptionStatus = subscriptionObj;
    try {
        await db.saveSubscription(subscriptionObj);
    } catch (e) {
        utils.setLocalStorage('subscription', subscriptionObj);
    }
}

export function getSubscription() {
    return subscriptionStatus;
}

export function hasActiveSubscription() {
    console.log('[App] hasActiveSubscription called. subscriptionStatus:', subscriptionStatus);
    if (!subscriptionStatus) {
        console.log('[App] No subscriptionStatus');
        return false;
    }
    const { isActive, expiryDate } = subscriptionStatus;
    console.log('[App] isActive:', isActive, 'expiryDate:', expiryDate, 'now:', Date.now());
    if (isActive !== undefined && isActive !== null) {
        if (!isActive) {
            console.log('[App] isActive is false');
            return false;
        }
        if (expiryDate && expiryDate > Date.now()) {
            console.log('[App] Active subscription (isActive true, expiry future)');
            return true;
        }
        console.log('[App] isActive true but expiry missing or expired');
        return false;
    }
    if (expiryDate && expiryDate > Date.now()) {
        console.log('[App] isActive undefined, but expiryDate in future – returning true');
        return true;
    }
    console.log('[App] isActive undefined and no valid expiry – returning false');
    return false;
}

export async function clearSubscription() {
    subscriptionStatus = null;
    try {
        await db.deleteSubscription();
    } catch (e) {
        utils.removeLocalStorage('subscription');
    }
}

export async function refreshSubscription() {
    return await syncSubscriptionStatus();
}

// ==================== EXAM STATE ====================

export function setExamState(state) {
    examState = state;
}

export function getExamState() {
    return examState;
}

export function clearExamState() {
    examState = null;
}

// ==================== EXAM CONFIG ====================

export function setExamConfig(config) {
    examConfig = config;
    if (config) {
        sessionStorage.setItem('examConfig', JSON.stringify(config));
    } else {
        sessionStorage.removeItem('examConfig');
    }
}

export function getExamConfig() {
    if (!examConfig) {
        const saved = sessionStorage.getItem('examConfig');
        if (saved) {
            try {
                examConfig = JSON.parse(saved);
            } catch {
                examConfig = null;
            }
        }
    }
    return examConfig;
}

export function clearExamConfig() {
    examConfig = null;
    sessionStorage.removeItem('examConfig');
}

// ==================== APP SETTINGS ====================

export function setAppSetting(key, value) {
    appSettings[key] = value;
    utils.setLocalStorage('appSettings', appSettings);
}

export function getAppSetting(key) {
    return appSettings[key];
}

export function toggleTheme() {
    const newTheme = appSettings.theme === 'dark' ? 'light' : 'dark';
    setAppSetting('theme', newTheme);
    return newTheme;
}

// ==================== PLAN SELECTION ====================

export function setSelectedPlan(plan) {
    selectedPlan = plan;
    if (plan) {
        sessionStorage.setItem('selectedPlan', JSON.stringify(plan));
        console.log('[App] Selected plan saved:', plan.id);
    } else {
        sessionStorage.removeItem('selectedPlan');
    }
}

export function getSelectedPlan() {
    if (selectedPlan) return selectedPlan;
    const stored = sessionStorage.getItem('selectedPlan');
    if (stored) {
        try {
            selectedPlan = JSON.parse(stored);
            return selectedPlan;
        } catch (e) {
            console.warn('[App] Failed to parse stored plan', e);
        }
    }
    return null;
}

// ==================== TRANSACTION ====================

export function setCurrentTransaction(transactionId) {
    currentTransaction = transactionId;
}

export function getCurrentTransaction() {
    return currentTransaction;
}

// ==================== SERVICE WORKER UPDATE HANDLING ====================

function registerUpdateListener() {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.addEventListener('controllerchange', () => {
            console.log('[App] Service worker controller changed');
            window.location.reload();
        });

        navigator.serviceWorker.ready.then(registration => {
            if (registration.waiting) {
                updatePending = true;
                showUpdatePrompt();
            }
        });

        navigator.serviceWorker.addEventListener('message', event => {
            if (event.data && event.data.type === 'UPDATE_FOUND') {
                updatePending = true;
                showUpdatePrompt();
            }
        });
    }
}

function showUpdatePrompt() {
    if (!updatePending) return;
    const updateModal = document.createElement('div');
    updateModal.className = 'modal-overlay';
    updateModal.innerHTML = `
        <div class="modal">
            <h3>Update Available</h3>
            <p>A new version of MedExamPro is available. Refresh to get the latest features.</p>
            <div style="display: flex; gap: 0.5rem; justify-content: flex-end; margin-top: 1rem;">
                <button id="update-refresh" class="btn-primary">Refresh Now</button>
                <button id="update-later" class="btn-secondary">Later</button>
            </div>
        </div>
    `;
    document.body.appendChild(updateModal);

    document.getElementById('update-refresh').addEventListener('click', () => {
        updateModal.remove();
        skipWaitingAndReload();
    });
    document.getElementById('update-later').addEventListener('click', () => {
        updateModal.remove();
    });
}

export async function skipWaitingAndReload() {
    if ('serviceWorker' in navigator) {
        const registration = await navigator.serviceWorker.getRegistration();
        if (registration && registration.waiting) {
            registration.waiting.postMessage({ type: 'SKIP_WAITING' });
        }
    }
    window.location.reload();
}

export async function checkForUpdates() {
    if (!navigator.onLine) return;
    if ('serviceWorker' in navigator) {
        try {
            const registration = await navigator.serviceWorker.getRegistration();
            if (registration) {
                registration.update().then(() => {
                    if (registration.waiting) {
                        updatePending = true;
                        showUpdatePrompt();
                    }
                }).catch(err => console.warn('Update check failed', err));
            } else {
                console.log('No service worker registered');
            }
        } catch (err) {
            console.warn('Update check error', err);
        }
    }
}

// ==================== EVENT BUS ====================

const eventListeners = {};

export const events = {
    on(event, callback) {
        if (!eventListeners[event]) eventListeners[event] = [];
        eventListeners[event].push(callback);
    },
    emit(event, data) {
        if (eventListeners[event]) {
            eventListeners[event].forEach(cb => cb(data));
        }
    },
    off(event, callback) {
        if (eventListeners[event]) {
            eventListeners[event] = eventListeners[event].filter(cb => cb !== callback);
        }
    }
};

export function cleanupApp() {}

// ==================== GLOBAL LISTENER FOR TIME TAMPER ====================

// Listen for time‑tamper events and log out immediately.
window.addEventListener('time-tamper-detected', async () => {
    console.warn('[App] Time tamper detected – logging out');
    await clearUser();
    window.location.href = '/pages/login.html?error=time_tamper';
});

// ==================== EXPOSE GLOBALLY ====================

window.app = {
    initializeApp,
    setAuthToken,
    checkAuth,
    setUser,
    getUser,
    clearUser,
    setSubscription,
    getSubscription,
    hasActiveSubscription,
    clearSubscription,
    setExamState,
    getExamState,
    clearExamState,
    setExamConfig,
    getExamConfig,
    clearExamConfig,
    setAppSetting,
    getAppSetting,
    toggleTheme,
    setSelectedPlan,
    getSelectedPlan,
    setCurrentTransaction,
    getCurrentTransaction,
    checkForUpdates,
    skipWaitingAndReload,
    syncUserData,
    refreshSubscription,
    triggerFullSync,
    syncData: sync.syncData,
    syncExamResults: sync.syncExamResults,
    syncUserProfile: sync.syncUserProfile,
    syncSubscription: sync.syncSubscription,
    events
};
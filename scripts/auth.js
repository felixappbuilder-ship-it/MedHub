// frontend-user/scripts/auth.js

/**
 * Authentication Handler – Convex Integration
 * Uses Convex backend for authentication when online.
 * Supports session management (single-device enforcement) and device tracking.
 * Includes referral code support during registration.
 */

import * as app from './app.js';
import * as ui from './ui.js';
import * as utils from './utils.js';
import * as security from './security.js';
import { convexHttpClient } from './convex-client.js';

// ==================== TOKEN MANAGEMENT ====================

export function getToken() {
    return utils.getLocalStorage('accessToken');
}

export function setToken(token) {
    app.setAuthToken(token);
}

export function clearToken() {
    app.setAuthToken(null);
}

export function isTokenValid() {
    return !!getToken();
}

// ==================== ONLINE CHECK ====================

function requireOnline() {
    if (!navigator.onLine) {
        throw new Error('You need to be online to perform this action.');
    }
}

// ==================== HELPER: GET USER-FRIENDLY ERROR ====================

function getErrorMessage(error) {
    if (error.data?.message) return error.data.message;
    if (error.message) return error.message;
    return 'An unknown error occurred';
}

// ==================== TOKEN ERROR HANDLER ====================

function handleTokenError(error) {
    const message = error.message || error.toString();
    if (message && (
        message.includes('invalid_token') ||
        message.includes('session_expired') ||
        message.includes('verify authentication token') ||
        message.includes('Failed to verify authentication token') ||
        message.includes('Unauthorized') ||
        message.includes('authentication failed') ||
        message.includes('token')
    )) {
        console.warn('[Auth] Token invalid, logging out...');
        clearToken();
        utils.removeLocalStorage('sessionId');
        app.clearUser();
        ui.showToast('Session expired. Please login again.', 'warning');
        window.location.href = '/pages/login.html';
        return true;
    }
    return false;
}

// ==================== REFERRAL HELPERS ====================

function getStoredReferralCode() {
    return utils.getLocalStorage('referral_code', null);
}

function clearStoredReferralCode() {
    utils.removeLocalStorage('referral_code');
}

// ==================== LOGIN ====================

export async function login(identifier, password, deviceInfo) {
    console.log('[Auth] Login attempt:', identifier);
    requireOnline();

    try {
        const deviceInfoObj = typeof deviceInfo === 'object' && deviceInfo !== null
            ? deviceInfo
            : { platform: deviceInfo || 'web' };

        const result = await convexHttpClient.action("auth/actions:login", {
            identifier,
            password,
            deviceFingerprint: deviceInfoObj.deviceFingerprint,
            deviceInfo: {
                platform: deviceInfoObj.platform || 'web',
                lastIp: deviceInfoObj.lastIp
            }
        });

        if (!result.success) {
            throw new Error(result.message);
        }

        const { token, userId, name, email, sessionId, isNewDevice } = result.data;
        setToken(token);
        await app.setUser({ _id: userId, name, email });
        security.setDeviceFingerprint(deviceInfoObj.deviceFingerprint);

        if (sessionId) {
            utils.setLocalStorage('sessionId', sessionId);
        }

        if (isNewDevice) {
            ui.showToast('New device detected. You are now logged in on this device.', 'info', 4000);
        }

        await app.syncUserData();

        console.log('[Auth] Login successful:', email);
        return { _id: userId, name, email };
    } catch (error) {
        console.error('[Auth] Login failed', error);
        const msg = getErrorMessage(error);
        throw new Error(msg);
    }
}

// ==================== REGISTER (with referral and agent support) ====================

/**
 * Register a new user with optional referral code and agent flag.
 * @param {Object} userData - contains name, email, phone, password, securityQuestions, deviceFingerprint, deviceInfo, referralCode, isAgent, agentVerified
 * @returns {Promise<Object>} user data
 */
export async function register(userData) {
    console.log('[Auth] Register attempt:', userData.email);
    requireOnline();

    try {
        // Get referral code from userData or localStorage
        let referralCode = userData.referralCode || getStoredReferralCode();

        // Extract agent flags from userData (default false)
        const isAgent = userData.isAgent || false;
        const agentVerified = userData.agentVerified || false;

        const deviceInfoObj = typeof userData.deviceInfo === 'object' && userData.deviceInfo !== null
            ? userData.deviceInfo
            : { platform: userData.deviceInfo || 'web' };

        const result = await convexHttpClient.action("auth/actions:register", {
            name: userData.name,
            email: userData.email.toLowerCase(),
            phone: userData.phone,
            password: userData.password,
            securityQuestions: userData.securityQuestions.map(q => ({
                question: q.question,
                answer: q.answer
            })),
            deviceFingerprint: userData.deviceFingerprint,
            deviceInfo: {
                platform: deviceInfoObj.platform || 'web',
                lastIp: deviceInfoObj.lastIp
            },
            referralCode: referralCode || undefined,
            isAgent: isAgent,
            agentVerified: agentVerified
        });

        if (!result.success) {
            throw new Error(result.message);
        }

        const { token, userId, name, email, referralCode: userReferralCode, isAgent: userIsAgent } = result.data;
        setToken(token);
        await app.setUser({ _id: userId, name, email, referralCode: userReferralCode, isAgent: userIsAgent });
        security.setDeviceFingerprint(userData.deviceFingerprint);

        // Clear stored referral code after successful registration
        clearStoredReferralCode();

        await app.syncUserData();

        console.log('[Auth] Registration successful:', email);
        return { _id: userId, name, email, referralCode: userReferralCode, isAgent: userIsAgent };
    } catch (error) {
        console.error('[Auth] Registration failed', error);
        const msg = getErrorMessage(error);
        throw new Error(msg);
    }
}

// ==================== LOGOUT ====================

export async function logout() {
    clearToken();
    utils.removeLocalStorage('sessionId');
    await app.clearUser();
    app.clearSubscription();
    app.clearExamConfig();
    app.clearExamState();
    ui.showToast('Logged out', 'info');
}

// ==================== PASSWORD RESET ====================

export async function getSecurityQuestions(identifier) {
    requireOnline();
    try {
        const result = await convexHttpClient.query("auth/queries:getSecurityQuestions", { identifier });
        if (!result.success) {
            throw new Error(result.message);
        }
        return result.data.questions;
    } catch (error) {
        console.error('[Auth] Failed to get security questions', error);
        const msg = getErrorMessage(error);
        if (msg.includes('User not found')) {
            throw new Error('User not found');
        }
        throw new Error(msg || 'Failed to retrieve security questions');
    }
}

export async function verifySecurityAnswers(identifier, answers) {
    requireOnline();
    try {
        const result = await convexHttpClient.action("auth/actions:verifySecurityAnswers", {
            identifier,
            answers
        });
        if (!result.success) {
            throw new Error(result.message);
        }
        sessionStorage.setItem('resetToken', result.data.resetToken);
        return result.data.resetToken;
    } catch (error) {
        console.error('[Auth] Verify answers failed', error);
        const msg = getErrorMessage(error);
        throw new Error(msg);
    }
}

export async function resetPassword(identifier, newPassword) {
    const resetToken = sessionStorage.getItem('resetToken');
    if (!resetToken) throw new Error('No reset token. Please restart the process.');

    requireOnline();
    try {
        const result = await convexHttpClient.action("auth/actions:resetPassword", {
            identifier,
            newPassword,
            resetToken
        });
        if (!result.success) {
            throw new Error(result.message);
        }
        sessionStorage.removeItem('resetToken');
        ui.showToast('Password reset successfully. Please login.', 'success');
        setTimeout(() => {
            window.location.href = '/pages/login.html';
        }, 2000);
    } catch (error) {
        console.error('[Auth] Reset password failed', error);
        throw new Error(getErrorMessage(error) || 'Password reset failed');
    }
}

// ==================== PROFILE MANAGEMENT ====================

export async function updateProfile(updates) {
    requireOnline();
    const user = app.getUser();
    if (!user) throw new Error('Not authenticated');

    try {
        const result = await convexHttpClient.action("users/mutations:updateProfile", {
            token: getToken(),
            ...updates
        });
        if (!result.success) {
            if (result.error === 'invalid_token' || result.message?.includes('token')) {
                handleTokenError(new Error(result.message));
                return;
            }
            throw new Error(result.message);
        }
        await app.setUser(result.data.user);
        return result.data.user;
    } catch (error) {
        console.error('[Auth] Update profile failed', error);
        if (handleTokenError(error)) return;
        throw new Error(getErrorMessage(error) || 'Update failed');
    }
}

export async function changePassword({ currentPassword, newPassword }) {
    requireOnline();
    const user = app.getUser();
    if (!user) throw new Error('Not authenticated');

    try {
        const result = await convexHttpClient.action("auth/actions:changePassword", {
            token: getToken(),
            currentPassword,
            newPassword
        });
        if (!result.success) {
            if (result.error === 'invalid_token' || result.message?.includes('token')) {
                handleTokenError(new Error(result.message));
                return;
            }
            throw new Error(result.message);
        }
        ui.showToast('Password changed successfully. You have been logged out from other devices.', 'success');
    } catch (error) {
        console.error('[Auth] Change password failed', error);
        if (handleTokenError(error)) return;
        throw new Error(getErrorMessage(error) || 'Password change failed');
    }
}

export async function updatePreferences(preferences) {
    requireOnline();
    const user = app.getUser();
    if (!user) throw new Error('Not authenticated');

    try {
        const result = await convexHttpClient.action("users/mutations:updatePreferences", {
            token: getToken(),
            ...preferences
        });
        if (!result.success) {
            if (result.error === 'invalid_token' || result.message?.includes('token')) {
                handleTokenError(new Error(result.message));
                return;
            }
            throw new Error(result.message);
        }
        await app.setUser(result.data.user);
    } catch (error) {
        console.error('[Auth] Update preferences failed', error);
        if (handleTokenError(error)) return;
        throw new Error(getErrorMessage(error) || 'Update preferences failed');
    }
}

export async function exportData() {
    requireOnline();
    const user = app.getUser();
    if (!user) throw new Error('Not authenticated');

    try {
        const result = await convexHttpClient.action("users/actions:exportData", {
            token: getToken()
        });
        if (!result.success) {
            if (result.error === 'invalid_token' || result.message?.includes('token')) {
                handleTokenError(new Error(result.message));
                return;
            }
            throw new Error(result.message);
        }
        const { downloadUrl, fileName } = result.data;
        const a = document.createElement('a');
        a.href = downloadUrl;
        a.download = fileName || `medical-exam-data-${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        ui.showToast('Export started', 'success');
    } catch (error) {
        console.error('[Auth] Export data failed', error);
        if (handleTokenError(error)) return;
        throw new Error(getErrorMessage(error) || 'Export failed');
    }
}

export async function deleteAccount(password) {
    requireOnline();
    const user = app.getUser();
    if (!user) throw new Error('Not authenticated');

    try {
        const result = await convexHttpClient.action("users/mutations:deleteAccount", {
            token: getToken(),
            password
        });
        if (!result.success) {
            if (result.error === 'invalid_token' || result.message?.includes('token')) {
                handleTokenError(new Error(result.message));
                return;
            }
            throw new Error(result.message);
        }
        await logout();
        ui.showToast('Account deleted', 'info');
    } catch (error) {
        console.error('[Auth] Delete account failed', error);
        if (handleTokenError(error)) return;
        const msg = getErrorMessage(error);
        if (msg.includes('Invalid password')) {
            throw new Error('Password incorrect');
        }
        throw new Error(msg || 'Account deletion failed');
    }
}

// ==================== SESSION MANAGEMENT ====================

let sessionTimeout;
const SESSION_DURATION = 2 * 60 * 60 * 1000; // 2 hours

export function startSession() {
    if (sessionTimeout) clearTimeout(sessionTimeout);
    sessionTimeout = setTimeout(() => {
        ui.showToast('Session expired. Please login again.', 'warning');
        logout();
        window.location.href = '/pages/login.html';
    }, SESSION_DURATION);
}

export function extendSession() {
    if (sessionTimeout) {
        clearTimeout(sessionTimeout);
        startSession();
    }
}

// ==================== DEVICE MANAGEMENT ====================

export async function getDevices() {
    const token = getToken();
    if (!token) throw new Error('Not authenticated');
    try {
        const result = await convexHttpClient.query("users/queries:getDevices", { token });
        if (!result.success) {
            throw new Error(result.message);
        }
        return result.data.devices;
    } catch (error) {
        console.error('[Auth] Failed to fetch devices', error);
        throw new Error(getErrorMessage(error) || 'Failed to fetch devices');
    }
}

export async function logoutDevice(fingerprint) {
    const token = getToken();
    if (!token) throw new Error('Not authenticated');
    try {
        const result = await convexHttpClient.action("users/mutations:logoutDevice", {
            token,
            fingerprint
        });
        if (!result.success) {
            if (result.error === 'invalid_token' || result.message?.includes('token')) {
                handleTokenError(new Error(result.message));
                return;
            }
            throw new Error(result.message);
        }
        ui.showToast('Device logged out', 'success');
    } catch (error) {
        console.error('[Auth] Logout device failed', error);
        if (handleTokenError(error)) return;
        throw new Error(getErrorMessage(error) || 'Failed to logout device');
    }
}

export async function logoutAllDevices() {
    const token = getToken();
    if (!token) throw new Error('Not authenticated');
    try {
        const result = await convexHttpClient.action("users/mutations:logoutAllDevices", { token });
        if (!result.success) {
            if (result.error === 'invalid_token' || result.message?.includes('token')) {
                handleTokenError(new Error(result.message));
                return;
            }
            throw new Error(result.message);
        }
        ui.showToast('All other devices logged out', 'success');
    } catch (error) {
        console.error('[Auth] Logout all devices failed', error);
        if (handleTokenError(error)) return;
        throw new Error(getErrorMessage(error) || 'Failed to logout all devices');
    }
}

// ==================== EXPOSE GLOBALLY ====================

window.auth = {
    login,
    register,
    logout,
    getSecurityQuestions,
    verifySecurityAnswers,
    resetPassword,
    updateProfile,
    changePassword,
    updatePreferences,
    exportData,
    deleteAccount,
    startSession,
    extendSession,
    getToken,
    isTokenValid,
    getDevices,
    logoutDevice,
    logoutAllDevices
};
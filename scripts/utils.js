// frontend-user/scripts/utils.js

/**
 * GENERAL UTILITIES
 * Used on all pages.
 * Provides formatting, storage, array/object helpers, device info.
 */

// ==================== FORMATTING ====================

/**
 * Format seconds to MM:SS
 * @param {number} seconds - time in seconds
 * @returns {string} formatted time (e.g., "02:15")
 */
export function formatTime(seconds) {
    if (typeof seconds !== 'number' || seconds < 0) return '00:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Format date to readable string
 * @param {string|number|Date} date - date to format
 * @param {string} style - 'full', 'short', 'time'
 * @returns {string} formatted date
 */
export function formatDate(date, style = 'full') {
    if (!date) return '—';
    const d = new Date(date);
    if (isNaN(d.getTime())) return '—';
    
    const options = {
        full: { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' },
        short: { month: 'short', day: 'numeric' },
        time: { hour: '2-digit', minute: '2-digit' }
    };
    return d.toLocaleDateString('en-KE', options[style] || options.full);
}

/**
 * Format currency (KES)
 * @param {number} amount
 * @returns {string} e.g., "KES 350"
 */
export function formatCurrency(amount) {
    if (typeof amount !== 'number') amount = parseFloat(amount);
    if (isNaN(amount)) return 'KES 0';
    return `KES ${amount.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

/**
 * Format milliseconds to human-readable duration string.
 * @param {number} ms - milliseconds
 * @returns {string} e.g., "3 months", "30 days", "2 hours"
 */
export function formatDuration(ms) {
    if (!ms || ms < 0) return '0 seconds';
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    const months = Math.floor(days / 30);
    const years = Math.floor(days / 365);

    if (years > 0) return `${years} year${years > 1 ? 's' : ''}`;
    if (months > 0) return `${months} month${months > 1 ? 's' : ''}`;
    if (days > 0) return `${days} day${days > 1 ? 's' : ''}`;
    if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''}`;
    if (minutes > 0) return `${minutes} minute${minutes > 1 ? 's' : ''}`;
    return `${seconds} second${seconds > 1 ? 's' : ''}`;
}

/**
 * Format file size in bytes to human-readable string.
 * @param {number} bytes - file size in bytes
 * @returns {string} e.g., "2.4 MB"
 */
export function formatFileSize(bytes) {
    if (!bytes || bytes === 0) return '';
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    const value = (bytes / Math.pow(1024, i)).toFixed(1);
    return `${value} ${sizes[i]}`;
}

/**
 * Safely parse JSON with fallback
 * @param {string} str - JSON string
 * @param {*} fallback - value to return on error
 * @returns {*} parsed object or fallback
 */
export function parseJSON(str, fallback = null) {
    try {
        return JSON.parse(str);
    } catch {
        return fallback;
    }
}

/**
 * Safely stringify JSON
 * @param {*} data
 * @returns {string} JSON string or empty string on error
 */
export function stringifyJSON(data) {
    try {
        return JSON.stringify(data);
    } catch {
        return '';
    }
}

// ==================== URL HELPERS ====================

/**
 * Get query parameter from URL
 * @param {string} name - parameter name
 * @returns {string|null} value or null
 */
export function getQueryParam(name) {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get(name);
}

/**
 * Set query parameter (updates URL without reload)
 * @param {string} name
 * @param {string} value
 */
export function setQueryParam(name, value) {
    const url = new URL(window.location.href);
    url.searchParams.set(name, value);
    window.history.replaceState({}, '', url);
}

/**
 * Remove query parameter
 * @param {string} name
 */
export function removeQueryParam(name) {
    const url = new URL(window.location.href);
    url.searchParams.delete(name);
    window.history.replaceState({}, '', url);
}

/**
 * Get hash from URL (without #)
 * @returns {string}
 */
export function getHash() {
    return window.location.hash.substring(1);
}

// ==================== STORAGE HELPERS ====================

/**
 * Get item from localStorage with fallback
 * @param {string} key
 * @param {*} fallback
 * @returns {*}
 */
export function getLocalStorage(key, fallback = null) {
    try {
        const value = localStorage.getItem(key);
        return value !== null ? parseJSON(value, fallback) : fallback;
    } catch {
        return fallback;
    }
}

/**
 * Set item in localStorage (stringified)
 * @param {string} key
 * @param {*} value
 */
export function setLocalStorage(key, value) {
    try {
        localStorage.setItem(key, stringifyJSON(value));
    } catch (e) {
        console.warn('localStorage write failed', e);
    }
}

/**
 * Remove item from localStorage
 * @param {string} key
 */
export function removeLocalStorage(key) {
    try {
        localStorage.removeItem(key);
    } catch (e) {
        console.warn('localStorage remove failed', e);
    }
}

/**
 * Clear all localStorage
 */
export function clearLocalStorage() {
    try {
        localStorage.clear();
    } catch (e) {
        console.warn('localStorage clear failed', e);
    }
}

// ==================== OBJECT HELPERS ====================

/**
 * Deep clone an object
 * @param {*} obj
 * @returns {*} cloned object
 */
export function deepClone(obj) {
    if (obj === null || typeof obj !== 'object') return obj;
    return parseJSON(stringifyJSON(obj), obj);
}

/**
 * Merge multiple objects (shallow)
 * @param {...Object} objects
 * @returns {Object}
 */
export function mergeObjects(...objects) {
    return Object.assign({}, ...objects);
}

/**
 * Check if object is empty
 * @param {Object} obj
 * @returns {boolean}
 */
export function isEmpty(obj) {
    return obj === null || obj === undefined || Object.keys(obj).length === 0;
}

// ==================== ARRAY HELPERS ====================

/**
 * Shuffle array (Fisher–Yates)
 * @param {Array} array
 * @returns {Array} new shuffled array
 */
export function shuffleArray(array) {
    const arr = [...array];
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

/**
 * Split array into chunks
 * @param {Array} array
 * @param {number} size
 * @returns {Array[]}
 */
export function chunkArray(array, size) {
    const chunks = [];
    for (let i = 0; i < array.length; i += size) {
        chunks.push(array.slice(i, i + size));
    }
    return chunks;
}

/**
 * Return unique values from array
 * @param {Array} array
 * @returns {Array}
 */
export function uniqueArray(array) {
    return [...new Set(array)];
}

// ==================== FUNCTIONAL HELPERS ====================

/**
 * Debounce function
 * @param {Function} func
 * @param {number} delay milliseconds
 * @returns {Function} debounced function
 */
export function debounce(func, delay) {
    let timeout;
    return function (...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), delay);
    };
}

/**
 * Throttle function
 * @param {Function} func
 * @param {number} limit milliseconds
 * @returns {Function} throttled function
 */
export function throttle(func, limit) {
    let inThrottle;
    return function (...args) {
        if (!inThrottle) {
            func.apply(this, args);
            inThrottle = true;
            setTimeout(() => (inThrottle = false), limit);
        }
    };
}

/**
 * Simple memoization
 * @param {Function} func
 * @returns {Function} memoized function
 */
export function memoize(func) {
    const cache = new Map();
    return function (key) {
        if (!cache.has(key)) {
            cache.set(key, func(key));
        }
        return cache.get(key);
    };
}

// ==================== VALIDATION UTILITIES ====================

/**
 * Simple email validation (not comprehensive, just format)
 * @param {string} email
 * @returns {boolean}
 */
export function isEmail(email) {
    if (!email || typeof email !== 'string') return false;
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * Kenyan phone validation (loose)
 * @param {string} phone
 * @returns {boolean}
 */
export function isPhone(phone) {
    if (!phone || typeof phone !== 'string') return false;
    const digits = phone.replace(/\D/g, '');
    return (
        (digits.length === 9 && digits.startsWith('7')) ||
        (digits.length === 10 && digits.startsWith('07')) ||
        (digits.length === 12 && digits.startsWith('254'))
    );
}

/**
 * Check if value is a number (or numeric string)
 * @param {*} value
 * @returns {boolean}
 */
export function isNumber(value) {
    return !isNaN(parseFloat(value)) && isFinite(value);
}

/**
 * Check if string is empty (null, undefined, or only whitespace)
 * @param {string} str
 * @returns {boolean}
 */
export function isEmptyString(str) {
    return !str || str.trim() === '';
}

// ==================== DEVICE UTILITIES ====================

/**
 * Get device type (mobile/tablet/desktop)
 * @returns {string}
 */
export function getDeviceType() {
    const ua = navigator.userAgent;
    if (/(tablet|ipad|playbook|silk)|(android(?!.*mobi))/i.test(ua)) {
        return 'tablet';
    }
    if (/Mobile|Android|iP(hone|od)|IEMobile|BlackBerry|Kindle|Silk-Accelerated|(hpw|web)OS|Opera M(obi|ini)/.test(ua)) {
        return 'mobile';
    }
    return 'desktop';
}

/**
 * Get browser info
 * @returns {string}
 */
export function getBrowser() {
    const ua = navigator.userAgent;
    if (ua.includes('Chrome')) return 'Chrome';
    if (ua.includes('Firefox')) return 'Firefox';
    if (ua.includes('Safari')) return 'Safari';
    if (ua.includes('Edge')) return 'Edge';
    return 'Unknown';
}

/**
 * Check if online (with small reliability)
 * @returns {boolean}
 */
export function isOnline() {
    return navigator.onLine;
}
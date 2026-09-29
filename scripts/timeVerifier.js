// scripts/timeVerifier.js

const STORAGE_KEY = 'timeVerifier_lastCheck';
const TOLERANCE_MS = 60000; // 1 minute

function getLastVerified() {
    const val = localStorage.getItem(STORAGE_KEY);
    if (val) {
        const num = Number(val);
        return isNaN(num) ? null : num;
    }
    return null;
}

function setLastVerified(timestamp) {
    localStorage.setItem(STORAGE_KEY, String(timestamp));
}

/**
 * Verify the current time against the last verified timestamp.
 * If rollback > tolerance is detected, dispatches a custom event and returns false.
 * Otherwise updates the stored timestamp and returns true.
 * @returns {boolean} true if time is valid, false if tampered
 */
export function verifyTime() {
    const now = Date.now();
    const last = getLastVerified();

    if (last !== null) {
        if (now < last - TOLERANCE_MS) {
            console.error('[TimeVerifier] ⚠️ Clock rollback detected!');
            window.dispatchEvent(new CustomEvent('time-tamper-detected'));
            return false;
        }
    }
    setLastVerified(now);
    return true;
}

/**
 * Get a safe timestamp – returns the last verified timestamp if it exists and is within tolerance,
 * otherwise returns null and triggers a re‑verification.
 * @returns {number|null} safe timestamp or null if time is invalid
 */
export function getSafeTimestamp() {
    const last = getLastVerified();
    if (last !== null) {
        const now = Date.now();
        if (now >= last - TOLERANCE_MS) {
            // Time is within tolerance – update and return
            setLastVerified(now);
            return now;
        } else {
            console.error('[TimeVerifier] Time rollback detected via getSafeTimestamp');
            window.dispatchEvent(new CustomEvent('time-tamper-detected'));
            return null;
        }
    }
    // No previous timestamp – set and return current time
    setLastVerified(Date.now());
    return Date.now();
}

/**
 * Reset the timestamp to current time (e.g., after successful login or backend sync).
 */
export function resetTimeVerifier() {
    setLastVerified(Date.now());
}

/**
 * Manually set a timestamp (for testing).
 */
export function setTimeVerifier(timestamp) {
    setLastVerified(timestamp);
}

// Also export the internal getter for debugging
export function getLastVerifiedTimestamp() {
    return getLastVerified();
}
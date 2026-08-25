/**
 * Time Verification Module
 * Detects device clock rollbacks by storing the last verified timestamp.
 * On each check, compare current time with stored timestamp.
 * If current < last - tolerance (1 minute), treat as manipulation → force logout.
 */

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
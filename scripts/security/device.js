// security/device.js

/**
 * MedVix device identity — web / PWA only.
 *
 * deviceId is a *stable device identity signal* for subscription authorization —
 * not an immutable hardware fingerprint. It is a crypto.randomUUID() persisted
 * in localStorage and hashed into a `dv_…` namespace. It disappears when site
 * data is cleared. The backend must tolerate occasional drift.
 *
 * The raw UUID never leaves this module. Callers only ever see the derived
 * `dv_…` MedVix ID and the normalized metadata object.
 */

import * as utils from '../utils.js';

const RAW_KEY   = 'medvix.device.raw';   // persistent raw UUID
const ID_KEY    = 'medvix.device.id';    // cached derived MedVix ID
const INFO_KEY  = 'medvix.device.info';  // cached normalized info

const ID_NAMESPACE = 'medvix.device.v1';

let _deviceId   = null;
let _deviceInfo = null;
let _appVersion = null;
let _pending    = null;

// ---------------------------------------------------------------- crypto ---

function randomUuid() {
    if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
    const bytes = new Uint8Array(16);
    if (globalThis.crypto?.getRandomValues) {
        crypto.getRandomValues(bytes);
    } else {
        for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
    }
    return [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(input) {
    if (globalThis.crypto?.subtle) {
        try {
            const buf = new TextEncoder().encode(input);
            const digest = await crypto.subtle.digest('SHA-256', buf);
            return [...new Uint8Array(digest)]
                .map(b => b.toString(16).padStart(2, '0'))
                .join('');
        } catch { /* fall through */ }
    }
    return fnv1aRepeat(input);
}

// Non-secure-context fallback. Produces 64 hex chars so downstream slicing
// behaves identically to the SHA-256 path. NOT cryptographically strong —
// exists only so a plain-HTTP dev server does not throw.
function fnv1aRepeat(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, '0').repeat(8);
}

async function deriveMedvixId(source) {
    const hex = await sha256Hex(`${ID_NAMESPACE}:${source}`);
    return `dv_${hex.slice(0, 32)}`;
}

// ------------------------------------------------------------- app info ----

export function setAppVersion(v) { _appVersion = v; }
export function getAppVersion() { return _appVersion; }

// -------------------------------------------------------- sync ID access ---
//
// Some callers (telemetry, offline queues) need the deviceId without an
// await. It's only safe to call this AFTER initializeDevice() has run at
// least once. Returns null if not yet resolved.

export function getCachedDeviceId() {
    return _deviceId;
}

export function getCachedDeviceInfo() {
    return _deviceInfo;
}

// -------------------------------------------------------------- device ID --

export async function getDeviceId() {
    if (_deviceId) return _deviceId;

    // Reuse the derived ID across restarts. The raw UUID in RAW_KEY is what
    // actually anchors identity; this cache just avoids re-hashing on launch.
    const cached = utils.getLocalStorage(ID_KEY);
    if (cached) {
        _deviceId = cached;
        return _deviceId;
    }

    if (_pending) return _pending;

    _pending = (async () => {
        try {
            _deviceId = await resolveDeviceId();
        } finally {
            _pending = null;
        }
        if (_deviceId) utils.setLocalStorage(ID_KEY, _deviceId);
        return _deviceId;
    })();

    return _pending;
}

async function resolveDeviceId() {
    let raw = utils.getLocalStorage(RAW_KEY);
    if (!raw) {
        raw = randomUuid();
        utils.setLocalStorage(RAW_KEY, raw);
    }
    return deriveMedvixId(`web:${raw}`);
}

// ------------------------------------------------------------ device info --

export async function getDeviceInfo() {
    if (_deviceInfo) return _deviceInfo;
    _deviceInfo = resolveDeviceInfo();
    utils.setLocalStorage(INFO_KEY, JSON.stringify(_deviceInfo));
    return _deviceInfo;
}

function resolveDeviceInfo() {
    return {
        platform:          'web',
        manufacturer:      null,
        model:             null,
        osName:            detectWebOsName(),
        osVersion:         null,
        architecture:      null,
        appVersion:        getAppVersion(),
        browser:           detectBrowser(),
        userAgent:         navigator.userAgent,
        language:          navigator.language,
        cpuCores:          navigator.hardwareConcurrency ?? null,
        deviceMemoryGb:    navigator.deviceMemory ?? null,
        screen:            `${screen.width}x${screen.height}`,
        pixelRatio:        window.devicePixelRatio ?? null,
        timezoneOffsetMin: new Date().getTimezoneOffset(),
    };
}

function detectBrowser() {
    const ua = navigator.userAgent;
    if (/Edg\//.test(ua))     return 'Edge';
    if (/OPR\//.test(ua))     return 'Opera';
    if (/Chrome\//.test(ua))  return 'Chrome';
    if (/Firefox\//.test(ua)) return 'Firefox';
    if (/Safari\//.test(ua))  return 'Safari';
    return 'Unknown';
}

function detectWebOsName() {
    const ua = navigator.userAgent;
    if (/Windows/.test(ua))         return 'Windows';
    if (/Android/.test(ua))         return 'Android';
    if (/iPhone|iPad|iPod/.test(ua))return 'iOS';
    if (/Mac OS X/.test(ua))        return 'macOS';
    if (/Linux/.test(ua))           return 'Linux';
    return null;
}

// -------------------------------------------------------------- lifecycle --

export async function initializeDevice(opts = {}) {
    if (opts.appVersion) _appVersion = opts.appVersion;
    await Promise.all([getDeviceId(), getDeviceInfo()]);
    return { deviceId: _deviceId, deviceInfo: _deviceInfo };
}

export async function refreshDeviceInfo() {
    _deviceInfo = null;
    return getDeviceInfo();
}

/**
 * Clear in-memory state and cached derived artifacts.
 *
 * Does NOT destroy the underlying identity by default — the raw UUID in
 * RAW_KEY survives, so the same dv_… regenerates on next call.
 *
 * Pass { clearWebIdentity: true } only for an intentional "reset this browser
 * installation" operation — e.g. the user explicitly asks for a new device
 * identity, or support is rotating a compromised one.
 */
export function clearDeviceData({ clearWebIdentity = false } = {}) {
    _deviceId   = null;
    _deviceInfo = null;
    _pending    = null;

    utils.removeLocalStorage(ID_KEY);
    utils.removeLocalStorage(INFO_KEY);

    if (clearWebIdentity) {
        utils.removeLocalStorage(RAW_KEY);
    }
}
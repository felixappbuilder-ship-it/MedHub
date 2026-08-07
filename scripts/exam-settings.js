// frontend-user/scripts/exam-settings.js

/**
 * Exam Settings Module
 * Handles configuration, validation, challenge creation, exam start, and joining challenges.
 * Integrated with Convex backend for challenge system.
 * 
 * Uses a self‑contained base64url blob for challenge config – no topic map required for decoding.
 */

import * as app from './app.js';
import * as ui from './ui.js';
import * as router from './router.js';
import * as utils from './utils.js';
import * as questions from './questions.js';
import * as subscription from './subscription.js';
import { convexHttpClient } from './convex-client.js';
import { getToken } from './auth.js';

// ==================== STATE ====================
let config = {};
let selectedMode = null;
let maxQuestions = 100;
let isVerified = false;
let verificationCode = null;

// Challenge state
let challengeState = {
    challengeId: null,
    challengeCode: null,
    status: null,
    opponent: null,
    seed: null,
    cycle: null,
    expiresAt: null,
    isCreator: false,
};

// Lock to prevent double creation
let creatingChallenge = false;

// DOM refs will be set by the HTML bootstrap
let dom = {};
let pollInterval = null;

// Topic mapping (still used for settings page UI, NOT for challenge encoding)
let topicIdMap = {};
let fullTopicNames = [];

// ==================== PERSISTENCE HELPERS ====================
const CHALLENGE_STORAGE_KEY = 'activeChallengeState';

function saveChallengeState() {
    if (!challengeState.challengeCode) return;
    const data = { ...challengeState };
    try {
        localStorage.setItem(CHALLENGE_STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
        console.warn('Failed to save challenge state', e);
    }
}

function loadChallengeState() {
    try {
        const saved = localStorage.getItem(CHALLENGE_STORAGE_KEY);
        if (!saved) return false;
        const parsed = JSON.parse(saved);
        // Only restore if it looks valid and not finished
        if (parsed.challengeCode && parsed.status && 
            parsed.status !== 'completed' && parsed.status !== 'archived') {
            challengeState = parsed;
            return true;
        }
    } catch (e) {
        console.warn('Failed to load challenge state', e);
    }
    return false;
}

function clearChallengeState() {
    localStorage.removeItem(CHALLENGE_STORAGE_KEY);
}

// ==================== PENDING EXAM CONFIG STORAGE ====================
const PENDING_CONFIG_KEY = 'pendingExamConfig';

function savePendingExamConfig(config) {
    try {
        localStorage.setItem(PENDING_CONFIG_KEY, JSON.stringify(config));
        console.log('[ExamSettings] Saved pending exam config');
    } catch (e) {
        console.warn('[ExamSettings] Failed to save pending exam config', e);
    }
}

// ==================== BASE64URL HELPERS ====================
const BASE64URL_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function base64urlEncode(buffer) {
    const bytes = new Uint8Array(buffer);
    let result = '';
    for (let i = 0; i < bytes.length; i += 3) {
        const a = bytes[i];
        const b = bytes[i + 1] || 0;
        const c = bytes[i + 2] || 0;
        result += BASE64URL_CHARS[a >> 2];
        result += BASE64URL_CHARS[((a & 3) << 4) | (b >> 4)];
        result += BASE64URL_CHARS[((b & 15) << 2) | (c >> 6)];
        result += BASE64URL_CHARS[c & 63];
    }
    // Do NOT remove trailing 'A's – keep the string length a multiple of 4
    return result;
}

function base64urlDecode(str) {
    // Safety: ensure length is a multiple of 4 by appending 'A' padding if needed
    while (str.length % 4 !== 0) {
        str += 'A';
    }
    const bytes = [];
    for (let i = 0; i < str.length; i += 4) {
        const a = BASE64URL_CHARS.indexOf(str[i] || 'A');
        const b = BASE64URL_CHARS.indexOf(str[i + 1] || 'A');
        const c = BASE64URL_CHARS.indexOf(str[i + 2] || 'A');
        const d = BASE64URL_CHARS.indexOf(str[i + 3] || 'A');
        bytes.push((a << 2) | (b >> 4));
        bytes.push(((b & 15) << 4) | (c >> 2));
        bytes.push(((c & 3) << 6) | d);
    }
    return new Uint8Array(bytes);
}

// ==================== BLOB ENCODER / DECODER ====================
/**
 * Pack exam configuration into a compact URL‑safe string.
 * Structure (binary):
 *   version:1 | subjectLen:1 | subject:subjectLen | topicCount:1 | (topicLen:1 | topic)*
 *   questionCount:1 | difficulty:1 | seed:4 | timingMode:1 | cycle:1 | flags:1
 */
export function encodeExamConfig(cfg) {
    const subjectBytes = new TextEncoder().encode(cfg.subject);
    if (subjectBytes.length > 255) throw new Error('Subject name too long');

    const topicNames = cfg.topics || []; // array of strings
    const topicData = [];
    for (const t of topicNames) {
        const enc = new TextEncoder().encode(t);
        if (enc.length > 255) throw new Error(`Topic name too long: ${t}`);
        topicData.push(enc.length, ...enc);
    }

    const seedInt = parseInt(cfg.seed || '0', 16) || 0;
    const difficultyVal = { easy: 0, mixed: 1, hard: 2 }[cfg.difficulty] ?? 1;
    const timingVal = cfg.timingMode === 'fixed' ? 1 : 0;
    const cycle = cfg.cycle || 1;

    let flags = 0;
    if (cfg.isChallenge) flags |= 1;
    if (cfg.preventCopyPaste) flags |= 2;
    if (cfg.autoSave) flags |= 4;
    if (cfg.detectTabSwitch) flags |= 8;
    if (cfg.breakAfter > 0) flags |= 16;

    const bufferSize =
        1 + 1 + subjectBytes.length + 1 + topicData.length +
        1 + 1 + 4 + 1 + 1 + 1;
    const buf = new ArrayBuffer(bufferSize);
    const view = new DataView(buf);
    let off = 0;

    view.setUint8(off++, 0x01); // version
    view.setUint8(off++, subjectBytes.length);
    new Uint8Array(buf, off, subjectBytes.length).set(subjectBytes);
    off += subjectBytes.length;

    view.setUint8(off++, topicNames.length);
    for (const byte of topicData) {
        view.setUint8(off++, byte);
    }

    view.setUint8(off++, cfg.questionCount);
    view.setUint8(off++, difficultyVal);
    view.setUint32(off, seedInt, false); // big-endian
    off += 4;
    view.setUint8(off++, timingVal);
    view.setUint8(off++, cycle);
    view.setUint8(off++, flags);

    return base64urlEncode(buf);
}

/**
 * Unpack a blob string back into a full exam config object.
 */
export function decodeExamConfig(blob) {
    const bytes = base64urlDecode(blob);
    const view = new DataView(bytes.buffer);
    let off = 0;

    const version = view.getUint8(off++);
    if (version !== 0x01) throw new Error('Unsupported blob version');

    const subjectLen = view.getUint8(off++);
    const subject = new TextDecoder().decode(bytes.slice(off, off + subjectLen));
    off += subjectLen;

    const topicCount = view.getUint8(off++);
    const topics = [];
    for (let i = 0; i < topicCount; i++) {
        const len = view.getUint8(off++);
        const name = new TextDecoder().decode(bytes.slice(off, off + len));
        off += len;
        topics.push(name);
    }

    const questionCount = view.getUint8(off++);
    const diffVal = view.getUint8(off++);
    const difficulty = ['easy', 'mixed', 'hard'][diffVal] || 'mixed';
    const seedInt = view.getUint32(off, false); off += 4;
    const seed = seedInt.toString(16).padStart(8, '0').toUpperCase();
    const timingMode = view.getUint8(off++) === 1 ? 'fixed' : 'adaptive';
    const cycle = view.getUint8(off++);
    const flags = view.getUint8(off++);

    return {
        subject,
        topics,              // full names, ready for exam engine
        questionCount,
        difficulty,
        seed,
        cycle,
        timingMode,
        mode: (flags & 1) ? 'challenge' : 'standard',
        isChallenge: !!(flags & 1),
        preventCopyPaste: !!(flags & 2),
        autoSave: !!(flags & 4),
        detectTabSwitch: !!(flags & 8),
        breakAfter: (flags & 16) ? 25 : 0,
    };
}

// ==================== TOPIC MAPPING HELPERS (for settings UI only) ====================
function buildTopicMap(topicNames) {
    const sorted = [...topicNames].sort((a, b) => a.localeCompare(b));
    const map = {};
    sorted.forEach((name, index) => {
        map[name] = index + 1;
    });
    return map;
}

function encodeTopics(names, map) {
    return names.map(name => map[name] || 0);
}

function decodeTopics(numbers, map) {
    const reverseMap = Object.fromEntries(Object.entries(map).map(([k, v]) => [v, k]));
    return numbers.map(num => reverseMap[num] || 'unknown');
}

// ==================== DOM SETUP ====================
export function setDomRefs(refs) {
    dom = refs;
    dom.questionCount = dom.questionCount || document.getElementById('question-count');
    dom.customCount = dom.customCount || document.getElementById('custom-count');
    dom.customCountContainer = dom.customCountContainer || document.getElementById('custom-count-container');
    dom.examMode = dom.examMode || document.getElementById('exam-mode');
    dom.timing = dom.timing || document.getElementById('timing');
    dom.preventCopy = dom.preventCopy || document.getElementById('prevent-copy');
    dom.autoSave = dom.autoSave || document.getElementById('auto-save');
    dom.detectTab = dom.detectTab || document.getElementById('detect-tab');
    dom.breakEnabled = dom.breakEnabled || document.getElementById('break-enabled');
    dom.presetSelect = dom.presetSelect || document.getElementById('preset-select');
    // Challenge UI elements
    dom.challengeCodeDisplay = dom.challengeCodeDisplay || document.getElementById('challenge-code-display');
    dom.challengeStatus = dom.challengeStatus || document.getElementById('challenge-status');
    dom.inviteFriendInput = dom.inviteFriendInput || document.getElementById('invite-friend-input');
    dom.inviteFriendBtn = dom.inviteFriendBtn || document.getElementById('invite-friend-btn');
    dom.challengeActions = dom.challengeActions || document.getElementById('challenge-actions');
    dom.waitingMessage = dom.waitingMessage || document.getElementById('waiting-message');
    dom.challengeStartBtn = dom.challengeStartBtn || document.getElementById('challenge-start-btn');
    // Join elements (may be undefined if not on page)
    dom.joinCodeDisplay = dom.joinCodeDisplay || document.getElementById('join-code-display');
    dom.joinStatus = dom.joinStatus || document.getElementById('join-status');
    dom.joinStartBtn = dom.joinStartBtn || document.getElementById('join-start-btn');
    dom.shareLinkArea = dom.shareLinkArea || document.getElementById('share-link-area');
}

// ==================== INITIALIZATION ====================
export async function initExamSettings() {
    console.log('[ExamSettings] Initializing...');

    await app.initializeApp();
    ui.applyTheme();

    if (!app.checkAuth()) {
        ui.showToast('Please log in', 'warning');
        router.navigateTo('login.html');
        return;
    }

    config = app.getExamConfig() || {};
    
    // Allow the page to load without a subject if we are joining via ?exam=
    const urlParams = new URLSearchParams(window.location.search);
    const examCode = urlParams.get('exam');
    if (!examCode && !config.subject) {
        ui.showToast('No subject selected', 'error');
        router.navigateTo('subjects.html');
        return;
    }

    if (config.subject) {
        const meta = await questions.getSubjectMeta(config.subject);
        const allTopics = meta.topics || [];
        const topicNames = allTopics.map(t => typeof t === 'object' ? t.name : t);
        fullTopicNames = [...topicNames].sort((a, b) => a.localeCompare(b));
        topicIdMap = buildTopicMap(fullTopicNames);
        const topics = config.topics || [];
        const totalQ = topics.reduce((sum, t) => sum + (t.questions || 0), 0);
        maxQuestions = Math.min(totalQ, 100);
        updateSubjectDisplay(meta, topics);
        updateStats(maxQuestions);
        setMaxQuestions(maxQuestions);
    } else {
        // Joiner – placeholder values, will be overridden when challenge data arrives
        maxQuestions = 100;
        setMaxQuestions(100);
    }

    setupValidation();
    setupSteppers();
    setupDifficultyButtons();
    setupChallengeUI();

    // Restore any active challenge from a previous session
    if (loadChallengeState()) {
        console.log('[ExamSettings] Restored active challenge:', challengeState.challengeCode);
        showChallengeUI();
        // Resume polling if still waiting
        if (challengeState.status === 'created' || challengeState.status === 'waiting') {
            startPolling();
        }
    }

    console.log('[ExamSettings] Initialized successfully.');
    return { maxQuestions };
}

// ==================== UI UPDATES ====================
export function updateSubjectDisplay(meta, topics) {
    dom.subjectIcon.textContent = meta.icon || '📚';
    dom.subjectName.textContent = meta.name || config.subject;
    dom.subjectTopics.textContent = topics.map(t => t.name).join(' • ') || 'All topics';
}

export function updateStats(questionCount) {
    const count = parseInt(questionCount) || 0;
    const timeEst = Math.ceil(count * 0.75);
    dom.statQuestions.textContent = `${count} questions`;
    dom.statTime.textContent = `≈ ${timeEst} min`;
}

export function setMaxQuestions(max) {
    for (const key of ['std', 'challenge', 'rev']) {
        const inp = dom.qtyInputs[key];
        const hint = dom.maxHints[key];
        if (inp) {
            inp.max = max;
            inp.value = Math.min(parseInt(inp.value) || 30, max);
            if (hint) hint.textContent = `max ${max}`;
        }
    }
}

// ==================== DIFFICULTY BUTTONS ====================
export function setupDifficultyButtons() {
    document.querySelectorAll('.difficulty-group').forEach(group => {
        const buttons = group.querySelectorAll('button');
        buttons.forEach(btn => {
            btn.removeEventListener('click', btn._diffHandler);
            btn._diffHandler = function(e) {
                buttons.forEach(b => b.classList.remove('active'));
                this.classList.add('active');
                const diff = this.dataset.diff;
                const label = diff.charAt(0).toUpperCase() + diff.slice(1);
                dom.statDifficulty.textContent = label;
            };
            btn.addEventListener('click', btn._diffHandler);
        });
    });
}

export function getSelectedDifficulty(groupElement) {
    const activeBtn = groupElement?.querySelector('.active');
    return activeBtn ? activeBtn.dataset.diff : 'mixed';
}

// ==================== STEPPER SETUP ====================
export function setupSteppers() {
    document.querySelectorAll('.question-stepper').forEach(stepper => {
        const input = stepper.querySelector('input');
        const dec = stepper.querySelector('.qty-dec');
        const inc = stepper.querySelector('.qty-inc');
        const max = parseInt(input.max) || 100;
        const warn = input.closest('.config-group')?.querySelector('.validation-warning');

        if (dec) {
            dec.removeEventListener('click', dec._handler);
            dec._handler = () => {
                let val = parseInt(input.value) || 10;
                val = Math.max(1, val - 5);
                input.value = val;
                validateQuestionInput(input, warn, max);
                updateStats(val);
            };
            dec.addEventListener('click', dec._handler);
        }
        if (inc) {
            inc.removeEventListener('click', inc._handler);
            inc._handler = () => {
                let val = parseInt(input.value) || 10;
                val = Math.min(max, val + 5);
                input.value = val;
                validateQuestionInput(input, warn, max);
                updateStats(val);
            };
            inc.addEventListener('click', inc._handler);
        }
        input.addEventListener('input', () => {
            const val = parseInt(input.value) || 0;
            if (val > max) input.value = max;
            validateQuestionInput(input, warn, max);
            updateStats(val);
        });
        input.addEventListener('blur', () => {
            let val = parseInt(input.value) || 1;
            if (val < 1) val = 1;
            if (val > max) val = max;
            input.value = val;
            validateQuestionInput(input, warn, max);
            updateStats(val);
        });
    });
}

// ==================== VALIDATION ====================
export function setupValidation() {
    for (const key of ['std', 'challenge', 'rev']) {
        const input = dom.qtyInputs[key];
        const warning = dom.warnings[key];
        if (input) {
            input.addEventListener('input', () => validateQuestionInput(input, warning));
            input.addEventListener('blur', () => validateQuestionInput(input, warning, true));
        }
    }
}

export function validateQuestionInput(input, warning, clamp = false) {
    const max = parseInt(input.max) || 100;
    let val = parseInt(input.value) || 0;
    if (clamp) {
        if (val < 1) val = 1;
        if (val > max) val = max;
        input.value = val;
    }
    const isValid = val <= max && val >= 1;
    input.classList.toggle('invalid', !isValid);
    if (warning) warning.classList.toggle('show', !isValid);
    updateStats(val);
    return isValid;
}

export function getCurrentQuestionCount(mode) {
    const key = mode === 'standard' ? 'std' : mode === 'challenge' ? 'challenge' : 'rev';
    const input = dom.qtyInputs[key];
    return parseInt(input?.value) || 10;
}

// ==================== DEPRECATED CHALLENGE FUNCTIONS ====================
export function generateChallengeCode() {
    const code = 'V' + Math.random().toString(36).substring(2, 6).toUpperCase() +
                Math.random().toString(36).substring(2, 6).toUpperCase();
    verificationCode = code;
    return code;
}

export function setVerificationState(verified) {
    isVerified = verified;
    if (dom.challengeStartBtn) {
        dom.challengeStartBtn.disabled = !verified;
    }
}

export function getVerificationState() {
    return isVerified;
}

export function getVerificationCode() {
    return verificationCode;
}

// ==================== CHALLENGE UI ====================
export function setupChallengeUI() {
    if (dom.challengeActions) dom.challengeActions.style.display = 'none';
    if (dom.inviteFriendBtn) {
        dom.inviteFriendBtn.addEventListener('click', inviteFriend);
    }
    if (dom.challengeStartBtn) {
        dom.challengeStartBtn.addEventListener('click', startChallenge);
    }
}

function showChallengeUI() {
    if (dom.challengeActions) dom.challengeActions.style.display = 'block';
    if (dom.challengeCodeDisplay) dom.challengeCodeDisplay.textContent = challengeState.challengeCode || '---';
    updateChallengeStatus();
}

function updateChallengeStatus() {
    if (!dom.challengeStatus) return;
    const statusMap = {
        'created': '⏳ Waiting for opponent...',
        'waiting': '⏳ Waiting for opponent...',
        'ready': '✅ Opponent joined! Ready to start.',
        'in_progress': '⚔️ Challenge in progress...',
        'completed': '🏁 Challenge completed.',
        'archived': '⏰ Challenge expired.'
    };
    dom.challengeStatus.textContent = statusMap[challengeState.status] || 'Unknown status';
    if (dom.waitingMessage) dom.waitingMessage.style.display = (challengeState.status === 'waiting' || challengeState.status === 'created') ? 'block' : 'none';
    if (dom.joinStatus && challengeState.status) {
        dom.joinStatus.textContent = statusMap[challengeState.status] || '';
    }
}

// ==================== CHALLENGE API CALLS ====================
async function getAuthToken() {
    const token = getToken();
    console.log('[ExamSettings] getAuthToken() ->', token ? 'token present' : 'NO TOKEN');
    if (!token) {
        if (window.auth && typeof window.auth.getToken === 'function') {
            const fallback = window.auth.getToken();
            console.log('[ExamSettings] Fallback window.auth.getToken() ->', fallback ? 'token present' : 'NO TOKEN');
            return fallback;
        }
        throw new Error('Not authenticated – no token found');
    }
    return token;
}

// -------------------- CREATE CHALLENGE (sends blob) --------------------
export async function createChallenge() {
    if (creatingChallenge) {
        console.warn('[ExamSettings] Challenge creation already in progress – skipping.');
        return false;
    }
    creatingChallenge = true;

    console.log('[ExamSettings] createChallenge() called');
    try {
        const token = await getAuthToken();
        const cfg = collectConfig();               // returns config with topic names
        const blob = encodeExamConfig(cfg);        // compact string

        // Send only the blob to the backend
        const result = await convexHttpClient.action('challenges/actions:createChallenge', {
            token,
            blob,                                  // backend stores this opaque string
        });
        console.log('[ExamSettings] createChallenge response:', result);
        if (!result.success) {
            ui.showToast(result.message || 'Failed to create challenge', 'error');
            return false;
        }

        challengeState.challengeCode = result.data.code;
        challengeState.expiresAt = result.data.expiresAt;
        challengeState.status = 'created';
        challengeState.isCreator = true;
        challengeState.seed = cfg.seed;
        challengeState.cycle = cfg.cycle;

        saveChallengeState();   // persist across refreshes
        showChallengeUI();
        ui.showToast(`Challenge created! Code: ${challengeState.challengeCode}`, 'success');
        startPolling();

        if (window.showShareableLink) {
            window.showShareableLink(challengeState.challengeCode);
        }
        return true;
    } catch (err) {
        console.error('[ExamSettings] createChallenge error:', err);
        ui.showToast(err.message || 'Challenge creation failed', 'error');
        return false;
    } finally {
        creatingChallenge = false;
    }
}

// -------------------- INVITE FRIEND (unchanged) --------------------
export async function inviteFriend() {
    const email = dom.inviteFriendInput?.value?.trim();
    if (!email) {
        ui.showToast('Please enter a friend\'s email', 'warning');
        return;
    }
    if (!challengeState.challengeCode) {
        ui.showToast('No active challenge', 'error');
        return;
    }
    console.log('[ExamSettings] inviteFriend() called for email:', email);
    try {
        const token = await getAuthToken();
        const result = await convexHttpClient.action('challenges/actions:inviteFriend', {
            token,
            challengeCode: challengeState.challengeCode,
            friendEmail: email,
        });
        console.log('[ExamSettings] inviteFriend response:', result);
        if (!result.success) {
            ui.showToast(result.message || 'Invitation failed', 'error');
            return;
        }
        ui.showToast(`Invitation sent to ${email}!`, 'success');
        dom.inviteFriendInput.value = '';
    } catch (err) {
        console.error('[ExamSettings] inviteFriend error:', err);
        ui.showToast(err.message || 'Invite failed', 'error');
    }
}

// -------------------- JOIN CHALLENGE (fetches blob and starts exam) --------------------
export async function joinChallenge(code) {
    if (!code) {
        ui.showToast('No challenge code provided', 'error');
        return false;
    }
    console.log('[ExamSettings] joinChallenge() called with code:', code);
    try {
        const token = await getAuthToken();
        const result = await convexHttpClient.action('challenges/actions:joinChallenge', {
            token,
            challengeCode: code,
        });
        console.log('[ExamSettings] joinChallenge response:', result);
        if (!result.success) {
            ui.showToast(result.message || 'Failed to join challenge', 'error');
            return false;
        }

        const { blob, challengeId } = result.data;
        // Decode the blob immediately – no topic map required
        const fullConfig = decodeExamConfig(blob);
        fullConfig.challengeCode = code;
        fullConfig.challengeId = challengeId;
        fullConfig.opponent = null;   // will be set later if needed
        fullConfig.isChallenge = true;
        fullConfig.mode = 'challenge';

        // ✅ Save the configuration for the exam room
        savePendingExamConfig(fullConfig);

        app.setExamConfig(fullConfig);
        ui.showToast('Joined successfully! Starting exam...', 'success');
        // Navigate directly to exam room – both players can now start
        setTimeout(() => {
            router.navigateTo('exam-room.html');
        }, 300);
        return true;
    } catch (err) {
        console.error('[ExamSettings] joinChallenge error:', err);
        ui.showToast(err.message || 'Join failed', 'error');
        return false;
    }
}

// -------------------- POLLING: check challenge status --------------------
async function checkChallengeStatus() {
    if (!challengeState.challengeCode) return;
    try {
        const token = await getAuthToken();
        const result = await convexHttpClient.action('challenges/actions:getChallengeStatus', {
            token,
            challengeCode: challengeState.challengeCode,
        });
        if (!result.success) return;

        const { status, opponent, creator, blob, expiresAt } = result.data;
        challengeState.status = status;
        challengeState.opponent = opponent;
        challengeState.expiresAt = expiresAt;
        challengeState.isCreator = creator;
        updateChallengeStatus();

        if (status === 'ready') {
            stopPolling();
            clearChallengeState();   // no longer needed
            ui.showToast('Opponent joined! Starting exam...', 'success');

            // Decode the blob (creator also gets the same blob)
            const fullConfig = decodeExamConfig(blob);
            fullConfig.challengeCode = challengeState.challengeCode;
            fullConfig.challengeId = challengeState.challengeId;
            fullConfig.opponent = opponent;
            fullConfig.isChallenge = true;
            fullConfig.mode = 'challenge';

            // ✅ Save the configuration for the exam room
            savePendingExamConfig(fullConfig);

            app.setExamConfig(fullConfig);
            setTimeout(() => {
                router.navigateTo('exam-room.html');
            }, 500);
        }
    } catch (err) {
        console.error('[ExamSettings] Poll error:', err);
    }
}

function startPolling() {
    stopPolling();
    console.log('[ExamSettings] Starting polling every 3 seconds...');
    pollInterval = setInterval(checkChallengeStatus, 3000);
    checkChallengeStatus(); // immediate first check
}

function stopPolling() {
    if (pollInterval) {
        clearInterval(pollInterval);
        pollInterval = null;
        console.log('[ExamSettings] Polling stopped.');
    }
}

// ==================== START CHALLENGE ====================
export async function startChallenge() {
    console.log('[ExamSettings] startChallenge() called');
    await createChallenge();
}

// ==================== START EXAM ====================
export function startExam() {
    const activeStep = document.querySelector('.card-step.active');
    const mode = activeStep?.id.includes('standard') ? 'standard' :
                 activeStep?.id.includes('challenge') ? 'challenge' : 'revision';

    console.log('[ExamSettings] startExam() called, mode:', mode);

    if (mode === 'challenge') {
        console.log('[ExamSettings] Challenge mode detected, calling createChallenge()');
        if (challengeState.status === 'ready') {
            console.log('[ExamSettings] Challenge already ready, but polling will handle start.');
            return;
        }
        createChallenge().then(success => {
            if (success) {
                console.log('[ExamSettings] Challenge created, waiting for opponent.');
            }
        });
        return;
    }

    let qty, difficulty;
    if (mode === 'standard') {
        qty = parseInt(dom.qtyInputs.std.value) || 10;
        difficulty = dom.stdDifficulty.querySelector('.active')?.dataset.diff || 'mixed';
    } else {
        qty = parseInt(dom.qtyInputs.rev.value) || 10;
        difficulty = dom.revDifficulty.querySelector('.active')?.dataset.diff || 'mixed';
    }

    if (qty > maxQuestions) {
        ui.showToast(`Only ${maxQuestions} questions available.`, 'warning');
        return;
    }

    const finalConfig = {
        ...config,
        mode: mode,
        questionCount: qty,
        difficulty: difficulty,
        timingMode: 'adaptive',
        isChallenge: false,
        seed: Math.random().toString(36).substring(2, 10).toUpperCase(),
        cycle: 1,
        preventCopyPaste: true,
        autoSave: true,
        detectTabSwitch: true,
        breakAfter: 0
    };

    // ✅ Save the configuration for the exam room
    savePendingExamConfig(finalConfig);

    app.setExamConfig(finalConfig);
    dom.bottomCard.classList.add('closed');
    setTimeout(() => {
        router.navigateTo('exam-room.html');
    }, 300);
}

// ==================== PRESETS ====================
export function savePreset() {
    const name = prompt('Enter a name for this preset:');
    if (!name) return;
    const cfg = collectConfig();
    const presets = utils.getLocalStorage('examPresets', []);
    presets.push({ name, config: cfg });
    utils.setLocalStorage('examPresets', presets);
    ui.showToast('Preset saved!', 'success');
    loadPresets();
}

export function loadPresets() {
    const presets = utils.getLocalStorage('examPresets', []);
    const select = dom.presetSelect;
    if (!select) return;
    select.innerHTML = '<option value="">Load preset...</option>';
    presets.forEach((p, i) => {
        const opt = document.createElement('option');
        opt.value = i;
        opt.textContent = p.name;
        select.appendChild(opt);
    });
}

export function applyPreset(index) {
    const presets = utils.getLocalStorage('examPresets', []);
    const preset = presets[index];
    if (!preset) return;
    const c = preset.config;
    dom.examMode.value = c.mode || 'timed';
    dom.qtyInputs.std.value = c.questionCount || 25;
    dom.qtyInputs.challenge.value = c.questionCount || 25;
    dom.qtyInputs.rev.value = c.questionCount || 25;
    const diff = c.difficulty || 'mixed';
    const stdDiffBtn = dom.stdDifficulty?.querySelector(`[data-diff="${diff}"]`);
    if (stdDiffBtn) stdDiffBtn.click();
    const revDiffBtn = dom.revDifficulty?.querySelector(`[data-diff="${diff}"]`);
    if (revDiffBtn) revDiffBtn.click();
    dom.timing.value = c.timingMode || 'adaptive';
    if (c.questionCount === 'custom') {
        dom.customCount.value = c.customCount || 25;
    }
    dom.preventCopy.checked = c.preventCopyPaste ?? true;
    dom.autoSave.checked = c.autoSave ?? true;
    dom.detectTab.checked = c.detectTabSwitch ?? true;
    dom.breakEnabled.checked = !!c.breakAfter;
    updateSettingsPreview();
    toggleChallengeSection();
    ui.showToast('Preset loaded', 'success');
}

export function resetToDefault() {
    dom.examMode.value = 'timed';
    dom.qtyInputs.std.value = 25;
    dom.qtyInputs.challenge.value = 25;
    dom.qtyInputs.rev.value = 25;
    dom.stdDifficulty.querySelector('[data-diff="mixed"]')?.click();
    dom.revDifficulty.querySelector('[data-diff="mixed"]')?.click();
    dom.timing.value = 'adaptive';
    dom.preventCopy.checked = true;
    dom.autoSave.checked = true;
    dom.detectTab.checked = true;
    dom.breakEnabled.checked = true;
    dom.customCountContainer.style.display = 'none';
    updateSettingsPreview();
}

// ==================== COLLECT CONFIG (returns topic names, not numbers) ====================
// ==================== COLLECT CONFIG (returns topic IDs) ====================
export function collectConfig() {
    const activeStep = document.querySelector('.card-step.active');
    let mode = 'standard';
    let qtyInput = null;
    let difficultyGroup = null;

    if (activeStep) {
        if (activeStep.id === 'step2-standard') {
            mode = 'standard';
            qtyInput = document.getElementById('std-qty');
            difficultyGroup = document.getElementById('std-difficulty');
        } else if (activeStep.id === 'step2-challenge') {
            mode = 'challenge';
            qtyInput = document.getElementById('challenge-qty');
            difficultyGroup = null;
        } else if (activeStep.id === 'step2-revision') {
            mode = 'revision';
            qtyInput = document.getElementById('rev-qty');
            difficultyGroup = document.getElementById('rev-difficulty');
        }
    }

    let questionCount = 10;
    if (qtyInput) questionCount = parseInt(qtyInput.value, 10) || 10;

    let difficulty = 'mixed';
    if (difficultyGroup) {
        const activeBtn = difficultyGroup.querySelector('.active');
        if (activeBtn) difficulty = activeBtn.dataset.diff || 'mixed';
    }

    // ⭐ Extract topic IDs from config.topics (objects with id/name, or strings)
    const selectedTopicIds = (config.topics || []).map(t =>
        typeof t === 'object' ? t.id : t
    );

    const timingMode = dom.timing ? dom.timing.value : 'adaptive';
    const preventCopyPaste = dom.preventCopy ? dom.preventCopy.checked : true;
    const autoSave = dom.autoSave ? dom.autoSave.checked : true;
    const detectTabSwitch = dom.detectTab ? dom.detectTab.checked : true;
    const breakAfter = dom.breakEnabled && dom.breakEnabled.checked ? 25 : 0;

    return {
        mode,
        subject: config.subject,
        topics: selectedTopicIds,        // ← now returns IDs (not names)
        questionCount,
        difficulty,
        timingMode,
        preventCopyPaste,
        autoSave,
        detectTabSwitch,
        breakAfter,
        seed: Math.random().toString(36).substring(2, 10).toUpperCase(),
        cycle: 1,
        isChallenge: mode === 'challenge'
    };
}

// ==================== UTILITY ====================
function updateSettingsPreview() {}
function toggleChallengeSection() {}

// ==================== CLEANUP ====================
export function cleanup() {
    stopPolling();
}

// ==================== EXPOSE ====================
window.examSettings = {
    initExamSettings,
    setDomRefs,
    updateSubjectDisplay,
    updateStats,
    setMaxQuestions,
    setupValidation,
    setupSteppers,
    setupDifficultyButtons,
    getSelectedDifficulty,
    validateQuestionInput,
    getCurrentQuestionCount,
    generateChallengeCode,
    setVerificationState,
    getVerificationState,
    getVerificationCode,
    savePreset,
    loadPresets,
    applyPreset,
    resetToDefault,
    collectConfig,
    startExam,
    createChallenge,
    inviteFriend,
    joinChallenge,
    checkChallengeStatus,
    startChallenge,
    cleanup,
    dom,
    encodeExamConfig,
    decodeExamConfig
};
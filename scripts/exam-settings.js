// frontend-user/scripts/exam-settings.js

/**
 * Exam Settings Module
 * Handles configuration, validation, challenge creation, and exam start.
 * Integrated with Convex backend for challenge system.
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

// DOM refs will be set by the HTML bootstrap
let dom = {};
let pollInterval = null;

// Topic mapping: name -> numeric ID (based on alphabetical order)
let topicIdMap = {};
let fullTopicNames = [];

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
}

// ==================== TOPIC MAPPING HELPERS ====================
/**
 * Build a deterministic mapping from topic name to numeric ID.
 * Sorts topics alphabetically to ensure consistency across users.
 * @param {Array<string>} topicNames - full list of topic names for the subject
 * @returns {Object} map { topicName: numericId }
 */
function buildTopicMap(topicNames) {
    const sorted = [...topicNames].sort((a, b) => a.localeCompare(b));
    const map = {};
    sorted.forEach((name, index) => {
        map[name] = index + 1; // 1‑based IDs
    });
    return map;
}

/**
 * Encode topic names to numeric IDs using the built map.
 * @param {Array<string>} names - selected topic names
 * @param {Object} map - topicIdMap
 * @returns {Array<number>}
 */
function encodeTopics(names, map) {
    return names.map(name => map[name] || 0);
}

/**
 * Decode numeric IDs back to topic names.
 * @param {Array<number>} numbers - topic IDs
 * @param {Object} map - topicIdMap
 * @returns {Array<string>}
 */
function decodeTopics(numbers, map) {
    const reverseMap = Object.fromEntries(Object.entries(map).map(([k, v]) => [v, k]));
    return numbers.map(num => reverseMap[num] || 'unknown');
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
    if (!config.subject) {
        ui.showToast('No subject selected', 'error');
        router.navigateTo('subjects.html');
        return;
    }

    // Load subject metadata (which includes all topics)
    const meta = await questions.getSubjectMeta(config.subject);
    const allTopics = meta.topics || [];
    // Extract topic names (some may be objects, some strings)
    const topicNames = allTopics.map(t => typeof t === 'object' ? t.name : t);
    // Store full sorted list for later use
    fullTopicNames = [...topicNames].sort((a, b) => a.localeCompare(b));
    // Build the deterministic map
    topicIdMap = buildTopicMap(fullTopicNames);
    console.log('[ExamSettings] Topic map built:', topicIdMap);

    const topics = config.topics || [];
    const totalQ = topics.reduce((sum, t) => sum + (t.questions || 0), 0);
    maxQuestions = Math.min(totalQ, 100);
    const estimatedTime = Math.ceil(maxQuestions * 0.75);

    updateSubjectDisplay(meta, topics);
    updateStats(maxQuestions);
    setMaxQuestions(maxQuestions);
    setupValidation();
    setupSteppers();
    setupDifficultyButtons();
    setupChallengeUI();

    console.log('[ExamSettings] Initialized successfully.');
    return { meta, topics, maxQuestions, estimatedTime };
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

export async function createChallenge() {
    console.log('[ExamSettings] createChallenge() called');
    try {
        const token = await getAuthToken();
        const cfg = collectConfig();
        console.log('[ExamSettings] Config for challenge:', cfg);

        // cfg.topics already contains numeric IDs (from collectConfig)
        const result = await convexHttpClient.action('challenges/actions:createChallenge', {
            token,
            seed: cfg.seed,
            cycle: cfg.cycle,
            config: {
                subject: cfg.subject,
                topics: cfg.topics,
                questionCount: cfg.questionCount,
                difficulty: cfg.difficulty,
                mode: 'challenge',
            }
        });
        console.log('[ExamSettings] createChallenge response:', result);
        if (!result.success) {
            ui.showToast(result.message || 'Failed to create challenge', 'error');
            return false;
        }
        challengeState.challengeId = result.data.challengeId;
        challengeState.challengeCode = result.data.challengeCode;
        challengeState.expiresAt = result.data.expiresAt;
        challengeState.status = 'created';
        challengeState.isCreator = true;
        challengeState.seed = cfg.seed;
        challengeState.cycle = cfg.cycle;
        showChallengeUI();
        ui.showToast(`Challenge created! Code: ${challengeState.challengeCode}`, 'success');
        startPolling();
        console.log('[ExamSettings] Challenge created successfully, polling started.');
        return true;
    } catch (err) {
        console.error('[ExamSettings] createChallenge error:', err);
        ui.showToast(err.message || 'Challenge creation failed', 'error');
        return false;
    }
}

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
        console.log('[ExamSettings] Calling convex action: challenges/actions:inviteFriend');
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

async function checkChallengeStatus() {
    if (!challengeState.challengeCode) return;
    console.log('[ExamSettings] checkChallengeStatus() polling...');
    try {
        const token = await getAuthToken();
        console.log('[ExamSettings] Calling convex action: challenges/actions:getChallengeStatus');
        // ✅ FIXED: use .action and the correct path
        const result = await convexHttpClient.action('challenges/actions:getChallengeStatus', {
            token,
            challengeCode: challengeState.challengeCode,
        });
        console.log('[ExamSettings] getChallengeStatus response:', result);
        if (!result.success) {
            console.warn('[ExamSettings] Status check failed:', result.message);
            return;
        }
        const { status, opponent, creator, config: challengeConfig, expiresAt } = result.data;
        challengeState.status = status;
        challengeState.opponent = opponent;
        challengeState.expiresAt = expiresAt;
        challengeState.isCreator = creator;
        updateChallengeStatus();

        if (status === 'ready') {
            console.log('[ExamSettings] Challenge is ready, opponent joined!');
            stopPolling();
            ui.showToast('Opponent joined! Starting exam...', 'success');
            // Decode topics from numbers back to names for the local exam engine
            const decodedTopics = decodeTopics(challengeConfig.topics, topicIdMap);
            const finalConfig = {
                subject: challengeConfig.subject,
                topics: decodedTopics, // now topic names
                questionCount: challengeConfig.questionCount,
                difficulty: challengeConfig.difficulty,
                mode: 'challenge',
                isChallenge: true,
                seed: challengeState.seed,
                cycle: challengeState.cycle,
                challengeCode: challengeState.challengeCode,
                challengeId: challengeState.challengeId,
                opponent: opponent,
            };
            app.setExamConfig(finalConfig);
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
    checkChallengeStatus(); // immediate check
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

// ==================== COLLECT CONFIG ====================
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
    if (qtyInput) {
        questionCount = parseInt(qtyInput.value, 10) || 10;
    }

    let difficulty = 'mixed';
    if (difficultyGroup) {
        const activeBtn = difficultyGroup.querySelector('.active');
        if (activeBtn) {
            difficulty = activeBtn.dataset.diff || 'mixed';
        }
    }

    // Encode selected topics to numbers using the deterministic map
    const selectedTopicNames = (config.topics || []).map(t => typeof t === 'object' ? t.name : t);
    const topicNumbers = encodeTopics(selectedTopicNames, topicIdMap);

    const timingMode = dom.timing ? dom.timing.value : 'adaptive';
    const preventCopyPaste = dom.preventCopy ? dom.preventCopy.checked : true;
    const autoSave = dom.autoSave ? dom.autoSave.checked : true;
    const detectTabSwitch = dom.detectTab ? dom.detectTab.checked : true;
    const breakAfter = dom.breakEnabled && dom.breakEnabled.checked ? 25 : 0;

    return {
        mode: mode,
        subject: config.subject,
        topics: topicNumbers,
        questionCount: questionCount,
        difficulty: difficulty,
        timingMode: timingMode,
        preventCopyPaste: preventCopyPaste,
        autoSave: autoSave,
        detectTabSwitch: detectTabSwitch,
        breakAfter: breakAfter,
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
    checkChallengeStatus,
    startChallenge,
    cleanup,
    dom
};
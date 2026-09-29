// scripts/pages/subject-specific.js
import * as auth from '../auth.js';
import * as ui from '../ui.js';
import * as router from '../router.js';
import * as utils from '../utils.js';
import * as questions from '../questions.js';
import * as analytics from '../analytics.js';
import * as db from '../db.js';
import * as subscription from '../subscription.js';
import * as examEngine from '../exam-engine.js';

// State
let currentSubject = null;
let currentUser = null;
let topicsData = [];
let hasActiveSub = false;
let currentMode = 'internal';

// DOM helper
let $;

export async function init(context) {
  $ = (sel) => context.root.querySelector(sel);

  ui.applyTheme();

  // Show shimmer, hide real content
  const shimmer = $('#shimmer-content');
  const realContent = $('#real-content');
  realContent.style.display = 'none';
  shimmer.style.display = 'block';

  // 1. Check auth (app is already initialized)
  currentUser = auth.getUser();
  hasActiveSub = await subscription.hasActiveSubscription();

  const subjectId = utils.getQueryParam('subject');
  if (!subjectId) {
    ui.showToast('No subject specified', 'error');
    router.navigateTo('subjects');
    return;
  }
  currentSubject = subjectId;

  // 2. Show the correct subject section
  document.querySelectorAll('.subject-section').forEach(el => el.style.display = 'none');
  const targetDiv = $(`#${subjectId}-topics`);
  if (!targetDiv) {
    ui.showToast('Subject not found', 'error');
    router.navigateTo('subjects');
    return;
  }
  targetDiv.style.display = 'block';

  // 3. Load subject metadata and update header
  const subjectMeta = await questions.getSubjectMeta(subjectId);
  $('#header-subject-icon').textContent = subjectMeta.icon;
  $('#header-subject-name').textContent = subjectMeta.name;
  $('#header-subject-color').style.backgroundColor = subjectMeta.color;
  $('#header-total-questions').textContent = `${subjectMeta.questions} questions`;

  // 4. Load topics
  topicsData = await questions.getTopicsBySubject(subjectId);
  renderTopicTree(subjectId, topicsData);

  // 5. Load recent topics
  const recentTopics = currentUser ? await analytics.getRecentTopics(subjectId, 3) : [];
  renderRecentTopics(recentTopics);

  // 6. Restore saved selection
  const savedSelection = sessionStorage.getItem(`topicSelection_${subjectId}`);
  if (savedSelection) {
    try {
      const selectedIds = JSON.parse(savedSelection);
      restoreSelection(selectedIds);
    } catch (e) {}
  }

  // 7. Set default mode: internal
  setMode('internal');

  // 8. Attach all event listeners
  attachEventListeners(context);

  // 9. Hide shimmer, show real content
  shimmer.style.display = 'none';
  realContent.style.display = 'block';

  console.log('[SubjectSpecific] Initialized');
}

// ==================== RENDER TOPICS ====================
function renderTopicTree(subjectId, topics) {
  const container = $(`#${subjectId}-topics-tree`);
  if (!container) return;

  let html = '';
  topics.forEach(topic => {
    const estimated = Math.ceil(topic.questions * 0.75);
    const isFree = subscription.isTopicFree(subjectId, topic.id);
    const enabled = hasActiveSub || isFree;
    const lockIcon = !enabled ? '<span class="lock-icon" title="Subscribe to unlock">🔒</span>' : '';
    const disabledAttr = enabled ? '' : 'disabled';

    html += `
      <div class="topic-item ${enabled ? '' : 'locked'}">
        <label>
          <input type="checkbox" name="topic" data-subject="${subjectId}" data-topic-id="${topic.id}" data-questions="${topic.questions}" data-estimated="${estimated}" ${disabledAttr}>
          <span class="topic-name">${topic.name} ${lockIcon}</span>
          <span class="topic-stats">${topic.questions} q · ~${estimated} min</span>
        </label>
        ${!enabled ? '<div class="tooltip">This topic requires a subscription</div>' : ''}
      </div>
    `;
  });
  container.innerHTML = html;

  // Attach change listeners to enabled checkboxes
  container.querySelectorAll('input[type="checkbox"]:enabled').forEach(cb => {
    cb.addEventListener('change', () => {
      updateSelectionSummary(subjectId);
      saveSelection(subjectId);
    });
  });
}

// ==================== RECENT TOPICS ====================
function renderRecentTopics(topics) {
  const container = $('#recent-topics-list');
  const section = $('#recent-section');
  if (!container || !section) return;

  if (!topics || topics.length === 0) {
    section.classList.add('hidden');
    return;
  }
  section.classList.remove('hidden');
  let html = '';
  topics.forEach(t => {
    html += `<div class="recent-topic" data-subject="${t.subjectId}" data-topic="${t.topicId}">📘 ${t.topicName} – ${t.questions} questions</div>`;
  });
  container.innerHTML = html;

  // Attach click listeners
  container.querySelectorAll('.recent-topic').forEach(el => {
    el.addEventListener('click', () => {
      const subject = el.dataset.subject;
      const topicId = el.dataset.topic;
      quickStudyTopic(subject, topicId);
    });
  });
}

// ==================== SELECTION SUMMARY ====================
function updateSelectionSummary(subjectId) {
  const container = $(`#${subjectId}-topics-tree`);
  if (!container) return;
  const checkboxes = container.querySelectorAll('input[type="checkbox"]:checked');
  const totalSelected = checkboxes.length;
  const totalTopics = container.querySelectorAll('input[type="checkbox"]').length;
  let totalQuestions = 0;
  let totalMinutes = 0;
  checkboxes.forEach(cb => {
    totalQuestions += parseInt(cb.dataset.questions);
    totalMinutes += parseInt(cb.dataset.estimated);
  });

  $('#selected-count').textContent = `${totalSelected} of ${totalTopics} topics selected`;
  $('#selected-questions').textContent = `${totalQuestions} questions selected`;
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  $('#estimated-time').textContent = `~${hours}h ${mins}m`;

  const primaryBtn = $('#primary-action-btn');
  const secondaryBtn = $('#secondary-action-btn');

  if (currentMode === 'internal') {
    primaryBtn.textContent = 'Start Exam';
    primaryBtn.onclick = () => studySelectedTopics(subjectId);
    secondaryBtn.style.display = 'inline-block';
    secondaryBtn.textContent = 'Quick Exam (10q)';
    secondaryBtn.onclick = () => quickExamSelected(subjectId);

    if (totalSelected === 0) {
      primaryBtn.disabled = true;
      secondaryBtn.disabled = true;
    } else {
      primaryBtn.disabled = false;
      secondaryBtn.disabled = false;
    }
  } else {
    // PDF mode
    primaryBtn.textContent = 'Create PDF';
    primaryBtn.onclick = () => createPDF(subjectId);
    secondaryBtn.style.display = 'none';

    const enoughTopics = totalSelected >= 2;
    const hasSub = hasActiveSub;

    if (!hasSub) {
      primaryBtn.disabled = true;
      const subMsg = $('#pdf-sub-required');
      if (subMsg) subMsg.style.display = 'inline';
    } else if (!enoughTopics) {
      primaryBtn.disabled = true;
      const subMsg = $('#pdf-sub-required');
      if (subMsg) subMsg.style.display = 'none';
    } else {
      primaryBtn.disabled = false;
      const subMsg = $('#pdf-sub-required');
      if (subMsg) subMsg.style.display = 'none';
    }
  }
}

function saveSelection(subjectId) {
  const container = $(`#${subjectId}-topics-tree`);
  if (!container) return;
  const selected = [];
  container.querySelectorAll('input[type="checkbox"]:checked').forEach(cb => {
    selected.push(cb.dataset.topicId);
  });
  sessionStorage.setItem(`topicSelection_${subjectId}`, JSON.stringify(selected));
}

function restoreSelection(selectedIds) {
  if (!currentSubject) return;
  const container = $(`#${currentSubject}-topics-tree`);
  if (!container) return;
  container.querySelectorAll('input[type="checkbox"]:enabled').forEach(cb => {
    if (selectedIds.includes(cb.dataset.topicId)) {
      cb.checked = true;
    }
  });
  updateSelectionSummary(currentSubject);
}

// ==================== MODE SWITCHING ====================
function setMode(mode) {
  currentMode = mode;
  document.querySelectorAll('.mode-btn').forEach(el => {
    el.classList.toggle('active', el.dataset.mode === mode);
  });

  const subMsg = $('#pdf-sub-required');
  if (subMsg) subMsg.style.display = 'none';

  if (currentSubject) {
    updateSelectionSummary(currentSubject);
  }
}

// ==================== EVENT LISTENERS ====================
function attachEventListeners(context) {
  // Back button
  const backBtn = $('#backBtn');
  if (backBtn) {
    backBtn.addEventListener('click', () => router.navigateTo('subjects'));
  }

  // Theme toggle
  const themeToggle = $('#themeToggle');
  if (themeToggle) {
    themeToggle.addEventListener('click', ui.toggleTheme);
  }

  // Mode buttons
  const modeInternal = $('#modeInternal');
  const modePdf = $('#modePdf');
  if (modeInternal) {
    modeInternal.addEventListener('click', () => setMode('internal'));
  }
  if (modePdf) {
    modePdf.addEventListener('click', () => setMode('pdf'));
  }

  // Select All buttons
  context.root.querySelectorAll('.select-all-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const subjectId = btn.dataset.subject;
      selectAllTopics(subjectId);
    });
  });

  // Clear All buttons
  context.root.querySelectorAll('.clear-all-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const subjectId = btn.dataset.subject;
      clearAllTopics(subjectId);
    });
  });
}

// ==================== GLOBAL ACTIONS (exposed for inline onclick) ====================
function selectAllTopics(subjectId) {
  const container = $(`#${subjectId}-topics-tree`);
  if (!container) return;
  container.querySelectorAll('input[type="checkbox"]:enabled').forEach(cb => cb.checked = true);
  updateSelectionSummary(subjectId);
  saveSelection(subjectId);
}

function clearAllTopics(subjectId) {
  const container = $(`#${subjectId}-topics-tree`);
  if (!container) return;
  container.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = false);
  updateSelectionSummary(subjectId);
  saveSelection(subjectId);
}

function studySelectedTopics(subjectId) {
  const container = $(`#${subjectId}-topics-tree`);
  const selected = [];
  container.querySelectorAll('input[type="checkbox"]:checked').forEach(cb => {
    selected.push({
      id: cb.dataset.topicId,
      name: cb.parentElement.querySelector('.topic-name').textContent.replace('🔒', '').trim(),
      questions: parseInt(cb.dataset.questions),
      estimated: parseInt(cb.dataset.estimated)
    });
  });
  if (selected.length === 0) {
    ui.showToast('Please select at least one topic', 'warning');
    return;
  }
  examEngine.setExamConfig({
    subject: subjectId,
    topics: selected,
    totalQuestions: selected.reduce((sum, t) => sum + t.questions, 0),
    mode: 'study'
  });
  router.navigateTo('exam-settings');
}

function quickExamSelected(subjectId) {
  const container = $(`#${subjectId}-topics-tree`);
  const selected = [];
  container.querySelectorAll('input[type="checkbox"]:checked').forEach(cb => {
    selected.push({
      id: cb.dataset.topicId,
      name: cb.parentElement.querySelector('.topic-name').textContent.replace('🔒', '').trim(),
      questions: parseInt(cb.dataset.questions),
      estimated: parseInt(cb.dataset.estimated)
    });
  });
  if (selected.length === 0) {
    ui.showToast('Please select at least one topic', 'warning');
    return;
  }
  examEngine.setExamConfig({
    subject: subjectId,
    topics: selected,
    totalQuestions: 10,
    mode: 'quick'
  });
  router.navigateTo('exam-settings');
}

function createPDF(subjectId) {
  const container = $(`#${subjectId}-topics-tree`);
  const selected = [];
  container.querySelectorAll('input[type="checkbox"]:checked').forEach(cb => {
    selected.push({
      id: cb.dataset.topicId,
      name: cb.parentElement.querySelector('.topic-name').textContent.replace('🔒', '').trim(),
      questions: parseInt(cb.dataset.questions),
      estimated: parseInt(cb.dataset.estimated)
    });
  });
  if (selected.length < 2) {
    ui.showToast('Please select at least 2 topics to export PDF', 'warning');
    return;
  }
  if (!hasActiveSub) {
    ui.showToast('An active subscription is required to export PDF', 'error');
    return;
  }
  examEngine.setExamConfig({
    subject: subjectId,
    topics: selected,
    totalQuestions: selected.reduce((sum, t) => sum + t.questions, 0),
    mode: 'pdf'
  });
  router.navigateTo('pdf-settings');
}

function quickStudyTopic(subjectId, topicId) {
  const topic = topicsData.find(t => t.id === topicId);
  if (!topic) return;
  examEngine.setExamConfig({
    subject: subjectId,
    topics: [topic],
    totalQuestions: 10,
    mode: 'quick'
  });
  router.navigateTo('exam-settings');
}

// ==================== EXPOSE GLOBALLY (for inline onclick) ====================
window.selectAllTopics = selectAllTopics;
window.clearAllTopics = clearAllTopics;
window.studySelectedTopics = studySelectedTopics;
window.quickExamSelected = quickExamSelected;
window.createPDF = createPDF;
window.quickStudyTopic = quickStudyTopic;
window.setMode = setMode;

export function destroy() {
  // Cleanup if needed
}
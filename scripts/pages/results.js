// scripts/pages/results.js
import * as ui from '../ui.js';
import * as router from '../router.js';
import * as auth from '../auth.js';
import * as utils from '../utils.js';
import * as db from '../db.js';
import * as sync from '../sync.js';

let $;
let currentExamId = null;
let currentExamData = null;

export async function init(context) {
  $ = (sel) => context.root.querySelector(sel);

  ui.applyTheme();

  // Check auth
  if (!auth.checkAuth()) {
    ui.showToast('Please log in to view results', 'warning');
    router.navigateTo('login');
    return;
  }

  let examId = new URLSearchParams(window.location.search).get('examId');
  if (!examId) {
    const navData = router.getNavData();
    if (navData && navData.examId) examId = navData.examId;
  }

  if (!examId) {
    ui.showToast('No exam ID provided', 'error');
    setTimeout(() => router.navigateTo('subjects'), 2000);
    return;
  }

  currentExamId = examId;
  console.log('[Results] Loading exam ID:', currentExamId);
  ui.showLoading('Loading results...');

  try {
    let results = await db.getExamResult(currentExamId);
    if (!results) {
      const lastExam = utils.getLocalStorage('lastExam', null);
      if (lastExam && lastExam.examId === currentExamId) {
        results = lastExam;
        console.log('[Results] Using localStorage fallback');
      }
    }

    if (!results) {
      ui.hideLoading();
      context.root.querySelector('main').innerHTML = `
        <div class="error-state">
          <h2>Results Not Found</h2>
          <p>We couldn't find the exam results.</p>
          <button id="backErrorBtn" class="btn-primary">Back to Subjects</button>
        </div>
      `;
      const backErrorBtn = $('#backErrorBtn');
      if (backErrorBtn) {
        backErrorBtn.addEventListener('click', () => router.navigateTo('subjects'));
      }
      return;
    }

    currentExamData = results;
    displaySummary(results);

    if (results.topics && results.topics.length > 0) {
      renderTopicPerformance(results.topics);
      $('#topic-performance').style.display = 'block';
    }
    if (results.weakAreas && results.weakAreas.length > 0) {
      displayRecommendations(results.weakAreas);
      $('#recommendations').style.display = 'block';
    }
    if (results.questions && results.questions.length > 0) {
      renderReviewList(results.questions);
      $('#reviewSection').style.display = 'block';
    }

  } catch (error) {
    console.error('[Results] Error loading results:', error);
    ui.showToast('Failed to load results: ' + error.message, 'error');
  } finally {
    ui.hideLoading();
  }

  // Attach event listeners
  attachEventListeners(context);

  console.log('[Results] Initialized');
}

function attachEventListeners(context) {
  // Subjects button
  const subjectsBtn = $('#subjectsBtn');
  if (subjectsBtn) {
    subjectsBtn.addEventListener('click', () => router.navigateTo('subjects'));
  }

  // Theme toggle
  const themeToggle = $('#themeToggle');
  if (themeToggle) {
    themeToggle.addEventListener('click', ui.toggleTheme);
  }

  // Download button
  const downloadBtn = $('#downloadBtn');
  if (downloadBtn) {
    downloadBtn.addEventListener('click', downloadExam);
  }

  // Analytics button
  const analyticsBtn = $('#analyticsBtn');
  if (analyticsBtn) {
    analyticsBtn.addEventListener('click', () => router.navigateTo('performance'));
  }
}

// ==================== DISPLAY FUNCTIONS ====================

function displaySummary(results) {
  const score = Math.round(results.scorePercentage);
  $('#score-percentage').textContent = `${score}%`;
  $('#correct-count').textContent =
    `${results.correctAnswers}/${results.totalQuestions}`;

  const timeAlloc = results.timeAllocated || (results.totalQuestions * 30);
  const timeSpentSec = Math.floor(results.timeSpent / 1000);
  const timePercent = timeAlloc > 0 ? Math.round((timeSpentSec / timeAlloc) * 100) : 0;
  $('#time-stats').textContent =
    `${utils.formatTime(timeSpentSec)} / ${utils.formatTime(timeAlloc)} (${timePercent}%)`;

  let grade = 'F';
  if (score >= 80) grade = 'A';
  else if (score >= 70) grade = 'B';
  else if (score >= 60) grade = 'C';
  else if (score >= 50) grade = 'D';
  $('#grade').textContent = grade;

  $('#exam-date').textContent = utils.formatDate(results.date);
  $('#exam-subject').textContent = results.subject || 'General';
  $('#exam-mode').textContent = results.mode || 'Timed';

  updatePieChart(score);
}

function updatePieChart(percentage) {
  const circle = $('#scoreCircle');
  const angle = (percentage / 100) * 360;
  circle.style.background =
    `conic-gradient(var(--accent) 0deg, var(--accent) ${angle}deg, var(--border) ${angle}deg, var(--border) 360deg)`;
}

function renderReviewList(questions) {
  const container = $('#review-list');
  if (!questions || questions.length === 0) {
    container.innerHTML = '<p class="no-data">No questions to review.</p>';
    return;
  }

  container.innerHTML = questions.map((q, idx) => {
    const isCorrect = q.correct;
    const statusClass = isCorrect ? 'correct' : 'incorrect';
    const statusIcon = isCorrect ? '✅' : '❌';

    function getOptionText(letter) {
      if (!letter || !q.options || !Array.isArray(q.options)) return letter || '—';
      const index = letter.toUpperCase().charCodeAt(0) - 65;
      if (index < 0 || index >= q.options.length) return letter;
      const opt = q.options[index];
      return (typeof opt === 'object' && opt !== null) ? opt.text : opt;
    }

    const userAnswerText = getOptionText(q.userAnswer);
    const correctAnswerText = getOptionText(q.correctAnswer);

    let explanationHtml = '';
    if (q.explanation) {
      if (typeof q.explanation === 'object') {
        const parts = [];
        if (q.explanation.overview) parts.push(q.explanation.overview);
        if (q.explanation.highYield) parts.push(`<br><strong>High‑Yield:</strong> ${q.explanation.highYield}`);
        if (q.explanation.clinicalCorrelation) parts.push(`<br><strong>Clinical:</strong> ${q.explanation.clinicalCorrelation}`);
        explanationHtml = parts.join(' ');
      } else {
        explanationHtml = q.explanation;
      }
    }

    return `
      <div class="review-item ${statusClass}">
        <div class="review-header">
          <span class="q-num">Q${idx + 1}</span>
          <span class="status">${statusIcon}</span>
          <span class="topic-tag">${q.topic || 'General'}</span>
          <span class="time-spent">⏱️ ${q.timeSpent || 0}s</span>
        </div>
        <div class="review-question">${q.question}</div>
        <div class="review-answers">
          <div><strong>Your answer:</strong> ${userAnswerText}</div>
          <div><strong>Correct answer:</strong> ${correctAnswerText}</div>
        </div>
        <div class="review-explanation">
          <strong>Explanation:</strong> ${explanationHtml || 'No explanation available.'}
        </div>
        ${q.flagged ? '<span class="flagged-badge">🏴 Flagged</span>' : ''}
      </div>
    `;
  }).join('');
}

function renderTopicPerformance(topicData) {
  const container = $('#topic-performance');
  if (!topicData || topicData.length === 0) {
    container.innerHTML = '<p class="no-data">No topic data available.</p>';
    return;
  }

  topicData.sort((a, b) => a.percentage - b.percentage);

  let html = '<h3>Topic Performance</h3><ul class="topic-list">';
  topicData.forEach(t => {
    const color = t.percentage >= 70 ? 'green' : (t.percentage >= 50 ? 'orange' : 'red');
    html += `
      <li>
        <span class="topic-name">${t.topic}</span>
        <span class="topic-score" style="color: ${color};">${Math.round(t.percentage)}%</span>
        <span class="topic-count">${t.correct}/${t.questions}</span>
        <div class="topic-bar">
          <div class="bar-fill" style="width: ${t.percentage}%; background: ${color};"></div>
        </div>
      </li>
    `;
  });
  html += '</ul>';
  container.innerHTML = html;
}

function displayRecommendations(weakAreas) {
  const container = $('#recommendations');
  if (!weakAreas || weakAreas.length === 0) {
    container.innerHTML = '<p class="no-data">Great job! No weak areas detected.</p>';
    return;
  }
  let html = '<h3>📚 Recommended Focus</h3><ul>';
  weakAreas.forEach(area => {
    html += `<li>🔍 Focus on <strong>${area}</strong> – review related topics.</li>`;
  });
  html += '</ul>';
  container.innerHTML = html;
}

// ==================== DOWNLOAD EXAM ====================
async function downloadExam() {
  if (!currentExamId) {
    ui.showToast('No exam ID found', 'error');
    return;
  }
  if (!currentExamData) {
    ui.showToast('Exam data not loaded', 'error');
    return;
  }

  const examWithDownload = {
    ...currentExamData,
    downloaded: true,
  };

  try {
    await saveDownloadedExam(examWithDownload);
    if (navigator.onLine) {
      sync.syncExamResults(examWithDownload).catch(err => {
        console.warn('[Results] Immediate sync after download failed:', err);
      });
    }
    ui.showToast('Exam downloaded and synced to cloud', 'success');
  } catch (err) {
    console.error('[Results] Download error:', err);
    ui.showToast('Failed to download exam', 'error');
  }
}

async function saveDownloadedExam(exam) {
  try {
    let downloaded = await db.getDownloadedExams() || [];
    downloaded = downloaded.filter(e => e.examId !== exam.examId);
    downloaded.unshift({
      examId: exam.examId,
      subject: exam.subject,
      date: exam.date,
      score: exam.scorePercentage,
      data: exam
    });
    if (downloaded.length > 10) downloaded = downloaded.slice(0, 10);
    await db.saveDownloadedExams(downloaded);
    await db.saveExamResult(exam);
  } catch (err) {
    console.error('[Results] Error saving downloaded exam:', err);
    throw err;
  }
}

// ==================== DESTROY ====================
export function destroy() {
  // Cleanup if needed
}
// scripts/pages/forgot-password.js
import * as auth from '../auth.js';
import * as ui from '../ui.js';
import * as router from '../router.js';
import * as validation from '../validation.js';

let $;
let currentIdentifier = '';
let securityQuestions = [];

export async function init(context) {
  $ = (sel) => context.root.querySelector(sel);

  ui.applyTheme();

  // Check if already logged in (optional warning)
  if (auth.checkAuth()) {
    ui.showToast('You are already logged in. Resetting password will log you out.', 'warning');
  }

  // Attach event listeners
  const step1Form = $('#step1-form');
  if (step1Form) {
    step1Form.addEventListener('submit', initiateReset);
  }

  const backToLogin = $('#backToLogin');
  if (backToLogin) {
    backToLogin.addEventListener('click', () => router.navigateTo('login'));
  }

  const verifyAnswersBtn = $('#verifyAnswersBtn');
  if (verifyAnswersBtn) {
    verifyAnswersBtn.addEventListener('click', verifyAnswers);
  }

  const backToStep1 = $('#backToStep1');
  if (backToStep1) {
    backToStep1.addEventListener('click', backToStep1Handler);
  }

  const step3Form = $('#step3-form');
  if (step3Form) {
    step3Form.addEventListener('submit', resetPassword);
  }

  const backToStep2 = $('#backToStep2');
  if (backToStep2) {
    backToStep2.addEventListener('click', backToStep2Handler);
  }

  const themeToggle = $('#themeToggle');
  if (themeToggle) {
    themeToggle.addEventListener('click', ui.toggleTheme);
  }

  console.log('[ForgotPassword] Initialized');
}

// ==================== Step Handlers ====================

async function initiateReset(event) {
  event.preventDefault();
  const identifier = $('#email').value.trim();
  if (!validation.validateEmail(identifier) && !validation.validatePhone(identifier)) {
    ui.showToast('Enter a valid email or Kenyan phone', 'error');
    return;
  }

  ui.showLoading('Verifying account...');
  try {
    const questions = await auth.getSecurityQuestions(identifier);
    securityQuestions = questions;
    currentIdentifier = identifier;
    ui.hideLoading();

    // Show step 2
    $('#step1').style.display = 'none';
    $('#step2').style.display = 'block';

    // Render questions
    const container = $('#questions-container');
    container.innerHTML = securityQuestions.map((q, idx) => `
      <div class="form-group">
        <label>${q}</label>
        <input type="text" id="answer-${idx}" class="security-answer" placeholder="Your answer" autocomplete="off">
      </div>
    `).join('');
  } catch (error) {
    ui.hideLoading();
    ui.showToast(error.message || 'Account not found', 'error');
  }
}

async function verifyAnswers() {
  const answers = [];
  for (let i = 0; i < securityQuestions.length; i++) {
    const ans = $(`#answer-${i}`).value.trim();
    if (!ans) {
      ui.showToast('Please answer all questions', 'error');
      return;
    }
    answers.push(ans);
  }

  ui.showLoading('Verifying answers...');
  try {
    await auth.verifySecurityAnswers(currentIdentifier, answers);
    ui.hideLoading();

    // Show step 3
    $('#step2').style.display = 'none';
    $('#step3').style.display = 'block';
  } catch (error) {
    ui.hideLoading();
    ui.showToast(error.message || 'Incorrect answers', 'error');
  }
}

async function resetPassword(event) {
  event.preventDefault();

  const newPassword = $('#new-password').value;
  const confirmPassword = $('#confirm-password').value;

  if (newPassword !== confirmPassword) {
    ui.showToast('Passwords do not match', 'error');
    return;
  }

  const strength = validation.validatePassword(newPassword);
  if (!strength.isValid) {
    ui.showToast('Password must be 8+ chars, include uppercase, lowercase, number', 'error');
    return;
  }

  ui.showLoading('Resetting password...');
  try {
    await auth.resetPassword(currentIdentifier, newPassword);
    ui.hideLoading();
    ui.showToast('Password reset successful! Please login.', 'success');
    router.navigateTo('login');
  } catch (error) {
    ui.hideLoading();
    ui.showToast(error.message || 'Reset failed', 'error');
  }
}

// ==================== Navigation Helpers ====================

function backToStep1Handler() {
  $('#step2').style.display = 'none';
  $('#step1').style.display = 'block';
}

function backToStep2Handler() {
  $('#step3').style.display = 'none';
  $('#step2').style.display = 'block';
}

// ==================== Destroy ====================
export function destroy() {
  // Cleanup if needed
}
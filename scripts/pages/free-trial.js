// scripts/pages/free-trial.js
import * as auth from '../auth.js';
import * as ui from '../ui.js';
import * as router from '../router.js';
import * as security from '../security.js';
import * as subscription from '../subscription.js';
import * as utils from '../utils.js';

let $;

export async function init(context) {
  $ = (sel) => context.root.querySelector(sel);

  ui.applyTheme();

  // Check authentication
  if (!auth.checkAuth()) {
    ui.showToast('Please log in to start free trial', 'warning');
    router.navigateTo('login');
    // Shimmer will be hidden by the page manager, but we can hide it early
    const shimmer = $('#shimmer-overlay');
    if (shimmer) shimmer.classList.add('shimmer-hidden');
    return;
  }

  const user = auth.getUser();
  if (user) {
    const welcomeEl = $('#user-welcome');
    if (welcomeEl) welcomeEl.textContent = `Welcome, ${user.name}!`;
  }

  // Hide shimmer once UI is ready
  const shimmer = $('#shimmer-overlay');
  if (shimmer) {
    shimmer.classList.add('shimmer-hidden');
    setTimeout(() => {
      if (shimmer && shimmer.parentNode) shimmer.remove();
    }, 450);
  }

  // Async eligibility check
  try {
    const eligible = await subscription.checkTrialEligibility();
    if (!eligible) {
      ui.showToast('Free trial already used on this device', 'warning');
      const trialActions = $('#trial-actions');
      if (trialActions) {
        trialActions.innerHTML = `
          <p style="text-align:center;color:var(--text-secondary);margin-bottom:0.75rem;">
            ⚠️ You have already used your free trial on this device.
          </p>
          <button id="beginTrialBtn" class="btn-primary btn-large" disabled
              style="opacity:0.5;cursor:not-allowed;">
            🚀 Begin Free Trial
          </button>
          <p style="text-align:center;font-size:0.85rem;color:var(--text-secondary);">
            Use the <strong>View Subscription Plans</strong> button above to upgrade.
          </p>
        `;
      }
    }
  } catch (error) {
    console.error('[FreeTrial] Eligibility check failed:', error);
    // Non-blocking
  }

  // Attach event listeners
  attachEventListeners(context);
}

function attachEventListeners(context) {
  const themeToggle = $('#themeToggle');
  if (themeToggle) {
    themeToggle.addEventListener('click', ui.toggleTheme);
  }

  const backSubjectsBtn = $('#backSubjectsBtn');
  if (backSubjectsBtn) {
    backSubjectsBtn.addEventListener('click', () => router.navigateTo('subjects'));
  }

  const viewSubscriptionBtn = $('#viewSubscriptionBtn');
  if (viewSubscriptionBtn) {
    viewSubscriptionBtn.addEventListener('click', () => router.navigateTo('subscription'));
  }

  const beginTrialBtn = $('#beginTrialBtn');
  if (beginTrialBtn) {
    beginTrialBtn.addEventListener('click', beginTrial);
  }
}

// ==================== Begin Trial ====================
async function beginTrial() {
  console.log('[FreeTrial] Starting trial activation...');

  const timeCheck = await security.detectTimeManipulation();
  console.log('[FreeTrial] Time check result:', timeCheck);

  if (timeCheck.action === 'block' || timeCheck.action === 'lock') {
    ui.showToast(timeCheck.message || 'Time integrity check failed. Cannot activate trial.', 'error');
    return;
  }

  ui.showLoading('Activating trial...');

  try {
    const deviceFingerprint = security.getDeviceFingerprint();

    const result = await subscription.startFreeTrial({
      deviceFingerprint,
      clientTime: Date.now()
    });

    ui.hideLoading();
    ui.showToast('Trial activated! 3 hours remaining.', 'success');

    if (result && result.subscription) {
      await subscription.setSubscription(result.subscription);
    }

    router.navigateTo('subjects');
  } catch (error) {
    ui.hideLoading();
    console.error('[FreeTrial] Activation failed:', error);
    ui.showToast(error.message || 'Failed to start trial', 'error');
  }
}

export function destroy() {
  // Cleanup if needed
}
// scripts/pages/referral.js
import * as ui from '../ui.js';
import * as router from '../router.js';
import * as auth from '../auth.js';
import * as referral from '../referral.js';
import * as referralUI from '../referral-ui.js';

let $;

export async function init(context) {
  $ = (sel) => context.root.querySelector(sel);

  ui.applyTheme();

  // Shimmer is already visible.
  const overlay = $('#shimmer-overlay');
  const mainContent = $('#main-content');

  // Check auth
  if (!auth.checkAuth()) {
    ui.showToast('Please log in to view referrals', 'warning');
    router.navigateTo('login');
    return;
  }

  // Update header status
  try {
    const data = await referral.getReferralDashboard();
    const isAgent = data.isAgent || false;
    const statusEl = $('#header-status');
    statusEl.innerHTML = isAgent ? '⭐ Agent' : '👤 User';
  } catch (err) {
    // ignore
  }

  // Render dashboard
  const container = $('#dashboard-container');
  await referralUI.renderDashboard(container);

  // Hide shimmer, show main content with fade
  overlay.classList.add('hidden');
  mainContent.classList.add('show');

  // Remove overlay from DOM after transition
  setTimeout(() => {
    overlay.style.display = 'none';
  }, 500);

  // Attach event listeners
  attachEventListeners(context);

  console.log('[Referral] Initialized');
}

function attachEventListeners(context) {
  // Back to Subjects buttons
  const backSubjectsBtn = $('#backSubjectsBtn');
  if (backSubjectsBtn) {
    backSubjectsBtn.addEventListener('click', () => router.navigateTo('subjects'));
  }
  const backSubjectsFooterBtn = $('#backSubjectsFooterBtn');
  if (backSubjectsFooterBtn) {
    backSubjectsFooterBtn.addEventListener('click', () => router.navigateTo('subjects'));
  }

  // Profile button
  const profileBtn = $('#profileBtn');
  if (profileBtn) {
    profileBtn.addEventListener('click', () => router.navigateTo('profile'));
  }

  // Theme toggle
  const themeToggle = $('#themeToggle');
  if (themeToggle) {
    themeToggle.addEventListener('click', ui.toggleTheme);
  }
}

export function destroy() {
  // Cleanup if needed
}
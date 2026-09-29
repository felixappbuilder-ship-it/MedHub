// scripts/pages/notifications.js
import * as ui from '../ui.js';
import * as router from '../router.js';
import * as auth from '../auth.js';
import * as notifications from '../notifications.js';

let $;

export async function init(context) {
  $ = (sel) => context.root.querySelector(sel);

  ui.applyTheme();

  // Check auth
  if (!auth.checkAuth()) {
    router.navigateTo('login');
    return;
  }

  // Initialize notifications core module (if not already)
  notifications.init();

  // Load notifications (respects cooldown)
  await notifications.loadNotifications(false);

  // Expose notifications globally for inline calls (if any)
  window.notifications = notifications;

  // Attach event listeners
  attachEventListeners(context);

  console.log('[NotificationsPage] Initialized');
}

function attachEventListeners(context) {
  // Back button
  const backBtn = $('#backBtn');
  if (backBtn) {
    backBtn.addEventListener('click', () => router.navigateTo('subjects'));
  }

  // Mark all read
  const markAllReadBtn = $('#markAllReadBtn');
  if (markAllReadBtn) {
    markAllReadBtn.addEventListener('click', notifications.markAllRead);
  }

  // Settings button (go to profile)
  const settingsBtn = $('#settingsBtn');
  if (settingsBtn) {
    settingsBtn.addEventListener('click', () => router.navigateTo('profile'));
  }

  // Filter tabs
  context.root.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      notifications.setFilter(btn.dataset.filter);
    });
  });

  // Sort select
  const sortSelect = $('#sortSelect');
  if (sortSelect) {
    sortSelect.addEventListener('change', () => {
      notifications.setSort(sortSelect.value);
    });
  }

  // Search input
  const searchInput = $('#searchInput');
  const clearSearch = $('#clearSearch');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      notifications.setSearch(e.target.value);
      clearSearch.classList.toggle('visible', e.target.value.length > 0);
    });
  }
  if (clearSearch) {
    clearSearch.addEventListener('click', () => {
      searchInput.value = '';
      notifications.setSearch('');
      clearSearch.classList.remove('visible');
    });
  }

  // Filter chips
  context.root.querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', () => {
      notifications.setCategory(chip.dataset.category);
    });
  });

  // Refresh / retry buttons
  const refreshEmptyBtn = $('#refreshEmptyBtn');
  if (refreshEmptyBtn) {
    refreshEmptyBtn.addEventListener('click', () => notifications.loadNotifications(true));
  }
  const retryBtn = $('#retryBtn');
  if (retryBtn) {
    retryBtn.addEventListener('click', () => notifications.loadNotifications(true));
  }

  // Floating buttons
  const scrollTopBtn = $('#scrollTopBtn');
  if (scrollTopBtn) {
    scrollTopBtn.addEventListener('click', () => {
      context.root.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  const helpBtn = $('#helpBtn');
  if (helpBtn) {
    helpBtn.addEventListener('click', notifications.openHelp);
  }

  // Compose button (admin) – future
  const composeBtn = $('#composeBtn');
  // logic to show/hide could be added later
}

export function destroy() {
  // Cleanup if needed
  // Notifications core module handles its own cleanup
}
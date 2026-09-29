// scripts/pages/resource-browser.js
import * as ui from '../ui.js';
import * as router from '../router.js';
import * as auth from '../auth.js';
import * as resourceBrowser from '../resource-browser.js';

let $;

export async function init(context) {
  $ = (sel) => context.root.querySelector(sel);

  ui.applyTheme();

  if (!auth.checkAuth()) {
    router.navigateTo('login');
    return;
  }

  const params = new URLSearchParams(window.location.search);
  const subject = params.get('subject');
  const type = params.get('type');

  if (!subject || !type) {
    ui.showToast('Invalid resource request', 'error');
    router.navigateTo('subjects');
    return;
  }

  // Attach event listeners
  const backBtn = $('#backBtn');
  if (backBtn) {
    backBtn.addEventListener('click', () => router.navigateTo('subjects'));
  }
  const themeBtn = $('#themeBtn');
  if (themeBtn) {
    themeBtn.addEventListener('click', ui.toggleTheme);
  }

  // Expose globals for viewer.js
  window.docMap = resourceBrowser.docMap;
  window.showViewer = resourceBrowser.showViewer;
  window.closeViewer = resourceBrowser.closeViewer;

  // ⚡ Force refresh: pass true to skip cache and call backend
  await resourceBrowser.initResourceBrowser(subject, type, true);

  console.log('[ResourceBrowser] Initialized (forced fresh load)');
}

export function destroy() {
  // Cleanup if needed
}
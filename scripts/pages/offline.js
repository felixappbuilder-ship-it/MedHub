// scripts/pages/offline.js
import * as router from '../router.js';

let $;

export async function init(context) {
  $ = (sel) => context.root.querySelector(sel);

  // Retry button
  const retryBtn = $('#retryBtn');
  if (retryBtn) {
    retryBtn.addEventListener('click', () => {
      // Go to the root URL (or the last attempted page)
      router.navigateTo('index');
    });
  }

  console.log('[Offline] Initialized');
}

export function destroy() {
  // Cleanup if needed
}
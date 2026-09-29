// scripts/pages/welcome.js
import * as ui from '../ui.js';
import * as router from '../router.js';

export async function init(context) {
  ui.applyTheme();

  if (app.checkAuth()) {
    router.navigateTo('subjects');
    return;
  }

  const redirect = sessionStorage.getItem('redirectAfterLogin');
  const $ = (sel) => context.root.querySelector(sel);

  const loginBtn = $('#loginBtn');
  const signupBtn = $('#signupBtn');
  const guestBtn = $('#guestBtn');
  const backHomeBtn = $('#backHomeBtn');
  const themeToggle = $('#themeToggle');

  if (loginBtn) {
    loginBtn.addEventListener('click', () => {
      let url = 'login';
      if (redirect) url += `?redirect=${encodeURIComponent(redirect)}`;
      router.navigateTo(url);
    });
  }

  if (signupBtn) {
    signupBtn.addEventListener('click', () => {
      let url = 'signup';
      if (redirect) url += `?redirect=${encodeURIComponent(redirect)}`;
      router.navigateTo(url);
    });
  }

  if (guestBtn) {
    guestBtn.addEventListener('click', () => {
      router.navigateTo('subjects');
    });
  }

  if (backHomeBtn) {
    backHomeBtn.addEventListener('click', () => {
      router.navigateTo('index');
    });
  }

  if (themeToggle) {
    themeToggle.addEventListener('click', () => {
      ui.toggleTheme();
    });
  }
}

export function destroy() {
  // Cleanup – called when user leaves the page
}
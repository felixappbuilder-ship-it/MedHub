// scripts/pages/home.js

import * as ui from '../ui.js';
import * as auth from '../auth.js';
import * as router from '../router.js';
import * as referral from '../referral.js';

let cleanupFns = [];

export async function init(context) {
  const root = context.root;
  if (!root) {
    console.error('[home] init: no root in context', context);
    return;
  }

  ui.applyTheme();
  setupInstallPrompt(root);
  renderFeatureGrid(root);
  renderTestimonials(root);
  renderFaq(root);
  setupEvents(root);

  // Referral detection
  const refCode = referral.detectReferralFromURL() || referral.getStoredReferralCode();
  if (refCode) showReferralModal(root, refCode);

  // Android app install banner (skips deep links and installed users)
  maybeShowAndroidAppBanner();

  console.log('[Home] Initialized');
}

export function destroy() {
  cleanupFns.forEach(fn => { try { fn(); } catch {} });
  cleanupFns = [];
}

// ============================================================
// Android app install banner
// ============================================================

const BANNER_DISMISSED_KEY = 'medvix_app_banner_dismissed';
const BANNER_DISMISS_DAYS  = 7;
const PLAY_STORE_URL       = 'https://play.google.com/store/apps/details?id=com.medhurb.app';
const APP_PACKAGE_ID       = 'com.medhurb.app';

async function maybeShowAndroidAppBanner() {
  // 1. Only on the bare landing page — skip any deep-link URL
  if (!isPlainLanding()) return;

  // 2. Only on Android browsers
  if (!isAndroidBrowser()) return;

  // 3. Never inside the app itself (Capacitor injects window.Capacitor)
  if (typeof window.Capacitor !== 'undefined') return;

  // 4. Respect prior dismissal
  if (isDismissedRecently()) return;

  // 5. If the app is already installed, do nothing
  if (await isAppInstalled()) return;

  // All checks passed — show the banner
  showAppInstallBanner();
}

function isPlainLanding() {
  // Only bare root: '/', '/index.html', '/home' — nothing else
  const path = location.pathname.replace(/^\/+|\/+$/g, '');
  if (path !== '' && path !== 'home' && path !== 'index.html') return false;
  // No query params (rules out ?ref=, ?token=, ?redirect=, etc.)
  if (location.search) return false;
  // No hash
  if (location.hash) return false;
  return true;
}

function isAndroidBrowser() {
  return /Android/i.test(navigator.userAgent);
}

function isDismissedRecently() {
  try {
    const ts = parseInt(localStorage.getItem(BANNER_DISMISSED_KEY), 10);
    if (!ts) return false;
    return (Date.now() - ts) < BANNER_DISMISS_DAYS * 24 * 60 * 60 * 1000;
  } catch {
    return false;
  }
}

function markBannerDismissed() {
  try {
    localStorage.setItem(BANNER_DISMISSED_KEY, String(Date.now()));
  } catch {}
}

async function isAppInstalled() {
  // getInstalledRelatedApps is Chrome-on-Android only.
  // It needs /.well-known/assetlinks.json on this domain AND
  // the website declared in the app's AndroidManifest.
  // If either is missing, the API returns [] even when the app
  // is actually installed — so treat [] as "cannot confirm".
  if (typeof navigator.getInstalledRelatedApps !== 'function') {
    return false;
  }
  try {
    const apps = await navigator.getInstalledRelatedApps();
    if (!Array.isArray(apps)) return false;
    return apps.some(a => a.id === APP_PACKAGE_ID);
  } catch {
    return false;
  }
}

function showAppInstallBanner() {
  injectBannerStyles();
  if (document.getElementById('app-install-banner')) return;

  const banner = document.createElement('div');
  banner.id = 'app-install-banner';
  banner.innerHTML = `
    <div class="app-banner-content">
      <div class="app-banner-icon">📱</div>
      <div class="app-banner-text">
        <div class="app-banner-title">Get the MedVix app</div>
        <div class="app-banner-subtitle">Better experience on your phone</div>
      </div>
      <button class="app-banner-install" type="button">Install</button>
      <button class="app-banner-close" type="button" aria-label="Close">×</button>
    </div>
  `;
  document.body.appendChild(banner);

  // Animate in on next frame
  requestAnimationFrame(() => banner.classList.add('visible'));

  const installBtn = banner.querySelector('.app-banner-install');
  const closeBtn   = banner.querySelector('.app-banner-close');

  installBtn.addEventListener('click', () => {
    markBannerDismissed();
    // Redirect to Play Store. On Android this opens the Play Store
    // app; returning to the browser brings the user back here with
    // the banner already dismissed.
    window.location.href = PLAY_STORE_URL;
  });

  closeBtn.addEventListener('click', () => {
    markBannerDismissed();
    dismissBanner(banner);
  });
}

function dismissBanner(banner) {
  banner.classList.remove('visible');
  setTimeout(() => banner.remove(), 300);
}

function injectBannerStyles() {
  if (document.getElementById('app-banner-styles')) return;
  const style = document.createElement('style');
  style.id = 'app-banner-styles';
  style.textContent = `
    #app-install-banner {
      position: fixed;
      left: 0; right: 0; bottom: 0;
      z-index: 9999;
      padding: 12px 16px calc(12px + env(safe-area-inset-bottom, 0px)) 16px;
      background: linear-gradient(135deg, #1976d2, #125ca8);
      color: #fff;
      box-shadow: 0 -4px 20px rgba(0, 0, 0, 0.15);
      transform: translateY(100%);
      transition: transform 0.3s ease;
      font-family: 'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
    }
    #app-install-banner.visible { transform: translateY(0); }

    #app-install-banner .app-banner-content {
      display: flex;
      align-items: center;
      gap: 12px;
      max-width: 720px;
      margin: 0 auto;
    }
    #app-install-banner .app-banner-icon {
      font-size: 28px;
      flex-shrink: 0;
    }
    #app-install-banner .app-banner-text {
      flex: 1; min-width: 0;
    }
    #app-install-banner .app-banner-title {
      font-weight: 600;
      font-size: 14px;
      line-height: 1.2;
      margin-bottom: 2px;
    }
    #app-install-banner .app-banner-subtitle {
      font-size: 12px;
      opacity: 0.85;
      line-height: 1.2;
    }
    #app-install-banner .app-banner-install {
      flex-shrink: 0;
      background: #fff;
      color: #1976d2;
      border: 0;
      padding: 8px 16px;
      border-radius: 6px;
      font-weight: 600;
      font-size: 13px;
      cursor: pointer;
      transition: transform 0.1s ease;
      font-family: inherit;
    }
    #app-install-banner .app-banner-install:active { transform: scale(0.95); }

    #app-install-banner .app-banner-close {
      flex-shrink: 0;
      background: transparent;
      color: #fff;
      border: 0;
      font-size: 24px;
      line-height: 1;
      padding: 4px 8px;
      cursor: pointer;
      opacity: 0.7;
      font-family: inherit;
    }
    #app-install-banner .app-banner-close:hover { opacity: 1; }
  `;
  document.head.appendChild(style);
}

// ============================================================
// event wiring
// ============================================================

function setupEvents(root) {
  const startBtn = root.querySelector('#getStartedBtn');
  if (startBtn) {
    const h = () => goFromHome();
    startBtn.addEventListener('click', h);
    cleanupFns.push(() => startBtn.removeEventListener('click', h));
  }

  const themeBtn = root.querySelector('#themeToggle');
  if (themeBtn) {
    const h = () => ui.toggleTheme();
    themeBtn.addEventListener('click', h);
    cleanupFns.push(() => themeBtn.removeEventListener('click', h));
  }

  const closeBtn = root.querySelector('#closeReferralBtn');
  if (closeBtn) {
    const h = () => closeReferralModal(root);
    closeBtn.addEventListener('click', h);
    cleanupFns.push(() => closeBtn.removeEventListener('click', h));
  }

  const copyBtn = root.querySelector('#copyReferralBtn');
  if (copyBtn) {
    const h = () => copyReferralCode(root);
    copyBtn.addEventListener('click', h);
    cleanupFns.push(() => copyBtn.removeEventListener('click', h));
  }

  const claimBtn = root.querySelector('#claimBtn');
  if (claimBtn) {
    const h = () => router.navigateTo('signup');
    claimBtn.addEventListener('click', h);
    cleanupFns.push(() => claimBtn.removeEventListener('click', h));
  }
}

function goFromHome() {
  if (auth.checkAuth()) router.navigateTo('subjects');
  else router.navigateTo('welcome');
}

// ============================================================
// renderers
// ============================================================

function renderFeatureGrid(root) {
  const el = root.querySelector('#feature-grid');
  if (!el) return;
  const features = [
    { icon: '📱', title: '100% Offline',    desc: '5,000+ questions stored on your phone. No internet needed.' },
    { icon: '⏱️', title: 'Adaptive Timing', desc: '21–54 sec per question, based on difficulty.' },
    { icon: '💳', title: 'M-Pesa Only',     desc: 'KES 350/mo, 850/3mo, 2,100/yr. Kenyan-first.' },
    { icon: '🛡️', title: 'Anti-Cheat',      desc: 'Time manipulation = instant lock.' }
  ];
  el.innerHTML = features.map(f => `
    <div class="feature-card">
      <div class="feature-icon">${f.icon}</div>
      <h3>${f.title}</h3>
      <p>${f.desc}</p>
    </div>
  `).join('');
}

function renderTestimonials(root) {
  const el = root.querySelector('#testimonials');
  if (!el) return;
  const list = [
    { name: 'Dr. A. M.', text: 'Passed my exams with ease. The offline mode saved me.' }
  ];
  el.innerHTML = list.map(t => `
    <div class="testimonial">
      <p>"${t.text}"</p>
      <cite>— ${t.name}</cite>
    </div>
  `).join('');
}

function renderFaq(root) {
  const el = root.querySelector('#faq-section');
  if (!el) return;
  const list = [
    { q: 'How do I pay?',                 a: 'M-Pesa only. Select a plan, enter your Safaricom number.' },
    { q: 'Can I study without internet?', a: 'Yes. All questions are stored offline.' }
  ];
  el.innerHTML = list.map((f, i) => `
    <div class="faq-item" id="faq-${i}">
      <div class="faq-question" data-toggle="faq-${i}">
        <span>${f.q}</span>
        <span class="faq-icon">▼</span>
      </div>
      <div class="faq-answer">${f.a}</div>
    </div>
  `).join('');

  el.querySelectorAll('.faq-question').forEach(q => {
    const handler = () => {
      const item = el.querySelector(`#${q.dataset.toggle}`);
      if (item) item.classList.toggle('active');
    };
    q.addEventListener('click', handler);
    cleanupFns.push(() => q.removeEventListener('click', handler));
  });
}

// ============================================================
// install prompt (PWA)
// ============================================================

function setupInstallPrompt(root) {
  const btn = root.querySelector('#installBtn');
  if (!btn) return;
  let deferred = null;

  const onPrompt = (e) => {
    e.preventDefault();
    deferred = e;
    btn.style.display = 'inline-block';
  };
  window.addEventListener('beforeinstallprompt', onPrompt);
  cleanupFns.push(() => window.removeEventListener('beforeinstallprompt', onPrompt));

  const onClick = async () => {
    if (!deferred) return;
    deferred.prompt();
    await deferred.userChoice;
    deferred = null;
    btn.style.display = 'none';
  };
  btn.addEventListener('click', onClick);
  cleanupFns.push(() => btn.removeEventListener('click', onClick));
}

// ============================================================
// referral modal
// ============================================================

function showReferralModal(root, code) {
  const modal  = root.querySelector('#referral-modal');
  const codeEl = root.querySelector('#ref-code-display');
  if (codeEl) {
    if ('value' in codeEl) codeEl.value = code;
    else codeEl.textContent = code;
  }
  if (modal) modal.style.display = 'flex';
}

function closeReferralModal(root) {
  const modal = root.querySelector('#referral-modal');
  if (modal) modal.style.display = 'none';
}

function copyReferralCode(root) {
  const codeEl = root.querySelector('#ref-code-display');
  if (!codeEl) return;
  const code = ('value' in codeEl ? codeEl.value : codeEl.textContent) || '';
  if (!code) return;

  if (navigator.clipboard) {
    navigator.clipboard.writeText(code)
      .then(() => ui.showToast('Referral code copied!', 'success'))
      .catch(() => fallbackCopy(code));
  } else {
    fallbackCopy(code);
  }
}

function fallbackCopy(code) {
  const input = document.createElement('input');
  input.value = code;
  document.body.appendChild(input);
  input.select();
  document.execCommand('copy');
  input.remove();
  ui.showToast('Referral code copied!', 'success');
}
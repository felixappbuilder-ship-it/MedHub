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

  console.log('[Home] Initialized');
}

export function destroy() {
  cleanupFns.forEach(fn => { try { fn(); } catch {} });
  cleanupFns = [];
}

// ============================================================
// event wiring
// ============================================================

function setupEvents(root) {
  // ---- Get Started ----
  const startBtn = root.querySelector('#getStartedBtn');
  if (startBtn) {
    const h = () => goFromHome();
    startBtn.addEventListener('click', h);
    cleanupFns.push(() => startBtn.removeEventListener('click', h));
  }

  // ---- Theme toggle ----
  const themeBtn = root.querySelector('#themeToggle');
  if (themeBtn) {
    const h = () => ui.toggleTheme();
    themeBtn.addEventListener('click', h);
    cleanupFns.push(() => themeBtn.removeEventListener('click', h));
  }

  // ---- Referral modal buttons ----
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
  // Decide at click-time based on auth state.
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
    // Works for both <input> and text elements.
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
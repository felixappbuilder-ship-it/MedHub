// scripts/pages/signup.js
import * as auth from '../auth.js';
import * as ui from '../ui.js';
import * as router from '../router.js';
import * as validation from '../validation.js';
import * as security from '../security.js';
import * as utils from '../utils.js';
import * as referral from '../referral.js';
import { initGoogleSignIn, disableGoogleAutoSelect } from '../auth/google.js';

// ============================================================
// Download Gate configuration
// ============================================================
const PLAY_STORE_URL =
  'https://play.google.com/store/apps/details?id=com.medhurb.app';

// Vite serves /public at the root, so this file lives at:
//   public/assets/images/qr-code.png
const QR_IMAGE = '/assets/images/qr-code.png';

const PLAY_ICON_SVG = `
  <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="currentColor">
    <path d="M3.6 2.3c-.3.2-.5.6-.5 1.1v17.2c0 .5.2.9.5 1.1l9.2-9.7-9.2-9.7zM14.6 9.3 5.9 2.1l9.6 5.5-1 1.7zm0 5.4 1 1.7-9.6 5.5 8.6-7.2zm5.5-2.4-2.9-1.7-1.2 1.6 1.2 1.6 2.9-1.7c.6-.3.6-1.5 0-1.8z"/>
  </svg>`;

function isAndroidBrowser() {
  return /android/i.test(navigator.userAgent);
}

export async function init(context) {
  ui.applyTheme();

  // ---- Deep-link redirect (?redirect=...) ----
  const redirectParam = new URLSearchParams(window.location.search).get('redirect');
  let redirectTarget = null;
  if (redirectParam) {
    try {
      const decoded = decodeURIComponent(redirectParam);
      if (decoded.startsWith('/')) redirectTarget = decoded;
    } catch { /* ignore */ }
  }

  // If already authenticated → redirect
  if (auth.checkAuth()) {
    if (redirectTarget) window.location.href = redirectTarget;
    else router.navigateTo('subjects');
    return;
  }

  // ---- DOM refs (scoped to the page root) ----
  const $ = (sel) => context.root.querySelector(sel);

  const stepIndicator = $('#step-indicator');
  const step1 = $('#step1');
  const step2 = $('#step2');
  const step3 = $('#step3');

  // Step 1
  const referralCode = $('#referralCode');
  const referralStatus = $('#referral-status');
  const terms = $('#terms');
  const emailSignupBtn = $('#emailSignupBtn');
  const googleContainer = $('#google-signup-container');
  const googleClickGuard = $('#google-click-guard');

  // Step 2
  const fullName = $('#fullName');
  const email = $('#email');
  const phone = $('#phone');
  const password = $('#password');
  const confirmPassword = $('#confirmPassword');
  const togglePwd1 = $('#togglePassword1');
  const togglePwd2 = $('#togglePassword2');
  const backStep2Btn = $('#backStep2Btn');
  const nextStep2Btn = $('#nextStep2Btn');

  // Step 3
  const sq1 = $('#sq1');
  const ans1 = $('#answer1');
  const sq2 = $('#sq2');
  const ans2 = $('#answer2');
  const sq3 = $('#sq3');
  const ans3 = $('#answer3');
  const backStep3Btn = $('#backStep3Btn');
  const createAccountBtn = $('#createAccountBtn');

  // Download gate
  const dgOverlay = $('#download-gate');
  const dgBody = $('#dg-body');
  const dgClose = $('#dg-close');

  // Header
  const themeToggle = $('#themeToggle');
  const backBtn = $('#backBtn');
  const loginLink = $('#loginLink');

  // ---- In-memory state ----
  const formData = {
    name: '',
    email: '',
    phone: '',
    password: '',
    confirmPassword: '',
    referralCode: '',
    securityQuestions: [
      { question: '', answer: '' },
      { question: '', answer: '' },
      { question: '', answer: '' },
    ],
  };

  // ---- Step navigation ----
  const STEP_LABELS = {
    1: 'Step 1 of 3: Choose your sign-up method',
    2: 'Step 2 of 3: Personal Information',
    3: 'Step 3 of 3: Security Questions',
  };

  function showStep(n) {
    [step1, step2, step3].forEach((el, idx) => {
      if (el) el.style.display = (idx + 1 === n) ? 'block' : 'none';
    });
    if (stepIndicator) {
      stepIndicator.style.display = 'block';
      stepIndicator.textContent = STEP_LABELS[n] || '';
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // ---- Header buttons ----
  if (themeToggle) themeToggle.addEventListener('click', () => ui.toggleTheme());
  if (backBtn) backBtn.addEventListener('click', () => router.navigateTo('welcome'));
  if (loginLink) {
    loginLink.addEventListener('click', () => {
      let url = 'login';
      if (redirectTarget) url += `?redirect=${encodeURIComponent(redirectTarget)}`;
      router.navigateTo(url);
    });
  }

  // ============================================================
  // DOWNLOAD GATE
  // ============================================================
  /**
   * Render the correct CTA into the modal body:
   *  - Android browser → Play Store button
   *  - Everything else → QR code
   */
  function renderDownloadGateBody() {
    if (!dgBody) return;

    if (isAndroidBrowser()) {
      dgBody.innerHTML = `
        <a class="dg-btn" href="${PLAY_STORE_URL}" target="_blank" rel="noopener">
          ${PLAY_ICON_SVG}
          <span>Download on Play Store</span>
        </a>
        <p class="dg-hint">Opens the MedVix app page on Google Play</p>
      `;
    } else {
      dgBody.innerHTML = `
        <div class="dg-qr">
          <img src="${QR_IMAGE}"
               alt="QR code to download MedVix on Android"
               width="180" height="180" />
        </div>
        <p class="dg-hint">
          Scan the QR code with your Android phone to download MedVix
          and activate your 24-hour free trial.
        </p>
      `;
    }
  }

  function showDownloadGate() {
    if (!dgOverlay) return;
    renderDownloadGateBody();
    dgOverlay.hidden = false;
    document.body.style.overflow = 'hidden';
  }

  function hideDownloadGate() {
    if (!dgOverlay) return;
    dgOverlay.hidden = true;
    document.body.style.overflow = '';
  }

  if (dgClose) dgClose.addEventListener('click', hideDownloadGate);
  if (dgOverlay) {
    dgOverlay.addEventListener('click', (e) => {
      if (e.target === dgOverlay) hideDownloadGate();
    });
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && dgOverlay && !dgOverlay.hidden) hideDownloadGate();
  });

  // ============================================================
  // STEP 1 – Referral + Terms handling
  // ============================================================
  function captureManualReferral() {
    const raw = (referralCode?.value || '').trim();
    if (!raw) return formData.referralCode || '';

    formData.referralCode = raw;

    try {
      utils.setLocalStorage('referral_code', raw);
    } catch (_) { /* ignore */ }

    console.log('[Signup] captureManualReferral →', formData.referralCode);
    return formData.referralCode;
  }

  async function prefillReferral() {
    if (!referralCode) return;

    const urlRef = referral.detectReferralFromURL?.();
    const storedRef = referral.getStoredReferralCode?.();
    const refCode = urlRef || storedRef;
    if (!refCode) return;

    referralCode.value = refCode;
    referralCode.readOnly = true;

    if (referralStatus) {
      referralStatus.textContent = '⏳ Validating referral code…';
      referralStatus.style.color = 'var(--text-muted)';
    }

    try {
      const result = await referral.validateReferralCode(refCode);
      if (result?.valid) {
        if (referralStatus) {
          referralStatus.textContent = `✅ Referred by ${result.referrerName || 'a MedVix user'}`;
          referralStatus.style.color = 'var(--success)';
        }
        formData.referralCode = refCode;
      } else {
        if (referralStatus) {
          referralStatus.textContent = '⚠️ Invalid referral code. You can still sign up.';
          referralStatus.style.color = 'var(--warning)';
        }
        referralCode.readOnly = false;
      }
    } catch (err) {
      console.warn('[Signup] Referral validation error:', err);
      if (referralStatus) {
        referralStatus.textContent = '⚠️ Could not validate code. You can still sign up.';
        referralStatus.style.color = 'var(--warning)';
      }
      referralCode.readOnly = false;
    }
  }
  await prefillReferral();

  function validateStep1() {
    let ok = true;
    ui.clearFormError('terms');

    if (!terms.checked) {
      ui.showFormError('terms', 'Please accept the Terms of Service to continue.');
      ok = false;
    }
    return ok;
  }

  function updateGoogleGuard() {
    if (!googleClickGuard) return;
    googleClickGuard.style.pointerEvents = terms.checked ? 'none' : 'auto';
    if (googleContainer) {
      googleContainer.style.opacity = terms.checked ? '1' : '0.6';
    }
  }
  if (terms) {
    terms.addEventListener('change', updateGoogleGuard);
    updateGoogleGuard();
  }
  if (googleClickGuard) {
    googleClickGuard.addEventListener('click', () => {
      ui.showFormError('terms', 'Please accept the Terms of Service to continue.');
      terms?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }

  // ============================================================
  // STEP 1 – Email/Phone path
  // ============================================================
  if (emailSignupBtn) {
    emailSignupBtn.addEventListener('click', () => {
      if (!validateStep1()) return;
      captureManualReferral();
      showStep(2);
    });
  }

  // ============================================================
  // STEP 1 – Google path
  // ============================================================
  if (googleContainer) {
    await initGoogleSignIn({
      container: googleContainer,
      text: 'signup_with',
      onCredential: async (response) => {
        if (!validateStep1()) {
          showStep(1);
          return;
        }
        const refCode = captureManualReferral();
        await handleGoogleCredential(response.credential, refCode);
      },
    });
  }

  // ============================================================
  // STEP 2 – Personal Info
  // ============================================================
  if (togglePwd1) togglePwd1.addEventListener('click', () => ui.togglePasswordVisibility('password'));
  if (togglePwd2) togglePwd2.addEventListener('click', () => ui.togglePasswordVisibility('confirmPassword'));

  if (password) {
    password.addEventListener('input', function () {
      const s = validation.checkPasswordStrength(this.value);
      ui.updatePasswordStrength(s);
    });
  }

  validation.setupLiveValidation('step2-form', {
    fullName: { required: true, min: 2, pattern: '^[A-Za-z ]+$' },
    email: { required: true, email: true },
    phone: { required: true, phone: 'KE' },
    password: { required: true, password: true },
  });

  if (backStep2Btn) {
    backStep2Btn.addEventListener('click', () => {
      formData.name = fullName.value.trim();
      formData.email = email.value.trim();
      formData.phone = phone.value.trim();
      showStep(1);
    });
  }

  if (nextStep2Btn) {
    nextStep2Btn.addEventListener('click', () => {
      const data = {
        fullName: fullName.value.trim(),
        email: email.value.trim(),
        phone: phone.value.trim(),
        password: password.value,
        confirmPassword: confirmPassword.value,
      };

      const rules = {
        fullName: { required: true, min: 2 },
        email: { required: true, email: true },
        phone: { required: true, phone: 'KE' },
        password: { required: true, password: true },
        confirmPassword: { required: true, equalTo: 'password' },
      };

      const result = validation.validateForm(data, rules);
      if (!result.valid) {
        validation.showValidationSummary(result.errors);
        return;
      }

      formData.name = data.fullName;
      formData.email = data.email;
      formData.phone = validation.formatKenyanPhone(data.phone) || data.phone;
      formData.password = data.password;
      formData.confirmPassword = data.confirmPassword;

      showStep(3);
    });
  }

  // ============================================================
  // STEP 3 – Security Questions
  // ============================================================
  if (backStep3Btn) {
    backStep3Btn.addEventListener('click', () => showStep(2));
  }

  if (createAccountBtn) {
    createAccountBtn.addEventListener('click', async () => {
      const sq1Val = sq1.value;
      const ans1Val = ans1.value.trim();
      const sq2Val = sq2.value;
      const ans2Val = ans2.value.trim();
      const sq3Val = sq3.value;
      const ans3Val = ans3.value.trim();

      if (!sq1Val || !ans1Val || !sq2Val || !ans2Val || !sq3Val || !ans3Val) {
        ui.showToast('Please fill in all security questions and answers', 'error');
        return;
      }

      if (new Set([sq1Val, sq2Val, sq3Val]).size !== 3) {
        ui.showToast('Please choose three different questions', 'error');
        return;
      }

      formData.securityQuestions = [
        { question: sq1Val, answer: ans1Val },
        { question: sq2Val, answer: ans2Val },
        { question: sq3Val, answer: ans3Val },
      ];

      captureManualReferral();

      ui.showLoading('Creating account…');

      try {
        const deviceFingerprint = security.generateDeviceFingerprint();
        const deviceInfo = {
          platform: navigator.platform,
          userAgent: navigator.userAgent,
          screen: `${screen.width}x${screen.height}`,
          timezone: new Date().getTimezoneOffset(),
        };

        await auth.register({
          name: formData.name,
          email: formData.email,
          phone: formData.phone,
          password: formData.password,
          securityQuestions: formData.securityQuestions,
          deviceFingerprint,
          deviceInfo,
          referralCode: formData.referralCode || undefined,
        });

        ui.hideLoading();

        // ✅ Instead of redirecting to /free-trial, show the download gate.
        showDownloadGate();

      } catch (error) {
        ui.hideLoading();
        ui.showToast(error.message || 'Registration failed', 'error');
      }
    });
  }

  // ============================================================
  // GOOGLE CREDENTIAL HANDLER
  // ============================================================
  async function handleGoogleCredential(idToken, refCode) {
    ui.showLoading('Signing up with Google…');

    try {
      const result = await auth.loginWithGoogle(idToken, refCode || undefined);

      if (result.requiresLink) {
        ui.hideLoading();
        openGoogleLinkModal({
          email: result.email,
          linkToken: result.linkToken,
          idToken,
          googleSub: result.googleSub,
          deviceFingerprint: result.deviceFingerprint,
          deviceInfo: result.deviceInfo,
          referralCode: refCode || undefined,
        });
        return;
      }

      ui.hideLoading();
      ui.showToast(
        result.isNewUser ? 'Account created — welcome!' : 'Signed in with Google',
        'success'
      );

      // ✅ Show the download gate instead of redirecting.
      showDownloadGate();

    } catch (err) {
      ui.hideLoading();
      ui.showToast(err.message || 'Google sign-up failed', 'error');
    }
  }

  // ============================================================
  // ACCOUNT LINKING MODAL
  // ============================================================
  function openGoogleLinkModal({
    email: linkedEmail,
    linkToken,
    idToken,
    googleSub,
    deviceFingerprint,
    deviceInfo,
    referralCode: refCode,
  }) {
    const modal = $('#google-link-modal');
    const emailEl = $('#google-link-email');
    const pwdInput = $('#google-link-password');
    const submitBtn = $('#google-link-submit');
    const cancelBtn = $('#google-link-cancel');
    const closeBtn = $('#google-link-close');

    emailEl.textContent = linkedEmail;
    pwdInput.value = '';
    modal.style.display = 'flex';
    setTimeout(() => pwdInput.focus(), 100);

    const close = () => {
      modal.style.display = 'none';
      disableGoogleAutoSelect?.();
    };

    const submit = async () => {
      const pwd = pwdInput.value;
      if (!pwd) {
        ui.showFormError('google-link-password', 'Password required');
        return;
      }
      ui.clearFormError('google-link-password');

      submitBtn.disabled = true;
      submitBtn.textContent = 'Connecting…';

      try {
        await auth.linkGoogleAccount({
          linkToken,
          identifier: linkedEmail,
          password: pwd,
          idToken,
          googleSub,
          deviceFingerprint,
          deviceInfo,
          referralCode: refCode || undefined,
        });

        modal.style.display = 'none';
        ui.showToast('Google connected to your account', 'success');

        // ✅ Show the download gate instead of redirecting.
        showDownloadGate();

      } catch (err) {
        ui.showToast(err.message || 'Could not connect Google', 'error');
        ui.showFormError('google-link-password', err.message || 'Invalid password');
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Connect Google';
      }
    };

    submitBtn.onclick = submit;
    cancelBtn.onclick = close;
    closeBtn.onclick = close;
    pwdInput.onkeydown = (e) => {
      if (e.key === 'Enter') { e.preventDefault(); submit(); }
    };
  }

  console.log('[Signup] Initialized.');
}

export function destroy() {
  // Nothing to clean up beyond what the page-manager handles.
}
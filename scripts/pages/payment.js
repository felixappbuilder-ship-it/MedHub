// scripts/pages/payment.js
import * as ui from '../ui.js';
import * as router from '../router.js';
import * as auth from '../auth.js';
import * as validation from '../validation.js';
import * as utils from '../utils.js';
import * as payment from '../payment.js';
import * as subscription from '../subscription.js';

let $;
let cancelPoll = null;

export async function init(context) {
  $ = (sel) => context.root.querySelector(sel);

  ui.applyTheme();

  // Check auth
  if (!auth.checkAuth()) {
    ui.showToast('Please log in first', 'warning');
    router.navigateTo('login');
    return;
  }

  const plan = payment.getSelectedPlan();
  if (!plan) {
    ui.showToast('No plan selected', 'error');
    router.navigateTo('subscription');
    return;
  }

  // Fill plan details
  $('#plan-name').textContent = plan.name;
  $('#plan-price').textContent = `KES ${plan.price}`;
  const durationDisplay = plan.durationText || utils.formatDuration(plan.duration);
  $('#plan-duration').textContent = durationDisplay;

  const summaryEl = $('#plan-summary');
  if (summaryEl) {
    summaryEl.innerHTML = `<strong>${plan.name}</strong> · ${durationDisplay} · <strong>KES ${plan.price}</strong>`;
  }

  const user = auth.getUser();
  if (user?.phone) {
    $('#phone').value = user.phone;
  }

  // Setup validation
  validation.setupLiveValidation('payment-form', {
    phone: { required: true, phone: 'KE' }
  });

  // Hide shimmer, show real content
  $('#shimmer-content').style.display = 'none';
  $('#real-content').style.display = 'block';

  // Attach event listeners
  attachEventListeners(context);

  console.log('[PaymentPage] Initialized');
}

function attachEventListeners(context) {
  // Back button
  const backBtn = $('#backBtn');
  if (backBtn) {
    backBtn.addEventListener('click', () => router.navigateTo('subjects'));
  }

  // Theme toggle
  const themeToggle = $('#themeToggle');
  if (themeToggle) {
    themeToggle.addEventListener('click', ui.toggleTheme);
  }

  // Change plan button
  const changePlanBtn = $('#changePlanBtn');
  if (changePlanBtn) {
    changePlanBtn.addEventListener('click', () => router.navigateTo('subscription'));
  }

  // Payment form submit
  const paymentForm = $('#payment-form');
  if (paymentForm) {
    paymentForm.addEventListener('submit', initiatePayment);
  }

  // Retry button
  const retryBtn = $('#retryBtn');
  if (retryBtn) {
    retryBtn.addEventListener('click', retryPayment);
  }
}

// ==================== Payment Handlers ====================

async function initiatePayment(event) {
  event.preventDefault();

  const phone = $('#phone').value.trim();
  const plan = payment.getSelectedPlan();

  if (!plan) {
    ui.showToast('No plan selected', 'error');
    return;
  }

  if (!validation.validatePhone(phone)) {
    ui.showToast('Enter a valid Kenyan phone (07XX or 2547XX)', 'error');
    return;
  }

  const formattedPhone = validation.formatKenyanPhone(phone);
  ui.showLoading('Initiating payment...');

  if (cancelPoll) {
    cancelPoll();
    cancelPoll = null;
  }

  try {
    const result = await payment.initiateMPesaPayment(formattedPhone, plan.id);
    const transactionId = result.transactionId;

    ui.hideLoading();
    ui.showToast('Check your phone for M‑Pesa prompt', 'info');

    const statusEl = $('#payment-status');
    statusEl.style.display = 'block';
    $('#status-message').textContent = '⏳ Waiting for payment confirmation...';
    $('#poll-attempt').textContent = '';

    cancelPoll = payment.pollPaymentStatus(
      transactionId,
      {
        onUpdate: ({ status, attempt }) => {
          console.log(`[Poll ${attempt}/10] Status: ${status}`);
          $('#poll-attempt').textContent = `Checking (${attempt}/10)...`;
          if (status === 'pending') {
            $('#status-message').textContent = '⏳ Waiting for M‑Pesa confirmation...';
          } else {
            $('#status-message').textContent = `Status: ${status}`;
          }
        },
        onComplete: async ({ status, timedOut }) => {
          cancelPoll = null;
          if (timedOut) {
            $('#status-message').textContent = '⏰ Payment not confirmed after 150 seconds. Please check your M‑Pesa app or try again.';
            $('#retryBtn').style.display = 'block';
            ui.showToast('Payment timeout. Check M‑Pesa or retry.', 'warning');
          } else if (status === 'completed') {
            $('#status-message').textContent = '✅ Payment successful! Updating subscription...';
            ui.showToast('Payment successful! Updating subscription...', 'success');
            const user = auth.getUser();
            if (user && plan) {
              const now = new Date();
              let expiryDate;
              switch (plan.id) {
                case 'monthly':
                  expiryDate = new Date(now.setMonth(now.getMonth() + 1));
                  break;
                case 'quarterly':
                  expiryDate = new Date(now.setMonth(now.getMonth() + 3));
                  break;
                case 'yearly':
                  expiryDate = new Date(now.setFullYear(now.getFullYear() + 1));
                  break;
                default:
                  expiryDate = new Date(now.setHours(now.getHours() + 3));
              }
              const subscriptionData = {
                userId: user.id,
                plan: plan.id,
                isActive: true,
                expiryDate: expiryDate.toISOString(),
                autoRenew: false
              };
              await subscription.activatePlan(subscriptionData);
              // subscription already sets itself in app state
            }
            setTimeout(() => router.navigateTo('subjects'), 1500);
          } else {
            $('#status-message').textContent = `❌ Payment ${status}. Please try again.`;
            $('#retryBtn').style.display = 'block';
            ui.showToast(`Payment ${status}. Please retry.`, 'error');
          }
          $('#poll-attempt').textContent = '';
        }
      },
      15000,
      10
    );
  } catch (error) {
    ui.hideLoading();
    ui.showToast(error.message || 'Payment initiation failed', 'error');
  }
}

function retryPayment() {
  $('#retryBtn').style.display = 'none';
  $('#status-message').textContent = '🔄 Retrying...';
  initiatePayment(new Event('submit'));
}

// ==================== Cleanup ====================
export function destroy() {
  if (cancelPoll) {
    cancelPoll();
    cancelPoll = null;
  }
}
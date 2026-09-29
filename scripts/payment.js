// scripts/payment.js

/**
 * Payment processing – Convex integration
 * Handles STK push initiation, status polling (with max attempts), manual claim,
 * and payment history management.
 */

import { convexHttpClient } from './convex-client.js';
import * as auth from './auth.js';
import * as security from './security.js';
import * as ui from './ui.js';
import * as subscription from './subscription.js';

// ==================== PLAN SELECTION ====================

let selectedPlan = null;

export function setSelectedPlan(plan) {
    selectedPlan = plan;
    if (plan) {
        sessionStorage.setItem('selectedPlan', JSON.stringify(plan));
    } else {
        sessionStorage.removeItem('selectedPlan');
    }
}

export function getSelectedPlan() {
    if (selectedPlan) return selectedPlan;
    const stored = sessionStorage.getItem('selectedPlan');
    if (stored) {
        try {
            selectedPlan = JSON.parse(stored);
            return selectedPlan;
        } catch (e) {}
    }
    return null;
}

// ==================== TRANSACTION ID ====================

let currentTransaction = null;

export function setCurrentTransaction(transactionId) {
    currentTransaction = transactionId;
}

export function getCurrentTransaction() {
    return currentTransaction;
}

// ==================== PAYMENT MANAGER ====================

class PaymentManager {
    constructor() {
        this.paymentStatus = {};
        this.paymentHistory = [];
        this.activePoll = null;
        this.isPolling = false;
        this.init();
    }

    init() {
        this.loadPaymentHistory();
        console.log('[Payment] Manager initialized with Convex backend');
    }

    loadPaymentHistory() {
        try {
            const saved = localStorage.getItem('payment_history');
            this.paymentHistory = saved ? JSON.parse(saved) : [];
        } catch (e) {
            this.paymentHistory = [];
        }
    }

    savePaymentHistory() {
        try {
            localStorage.setItem('payment_history', JSON.stringify(this.paymentHistory));
        } catch (e) {
            console.warn('[Payment] Could not save history', e);
        }
    }

    // ============================================================
    // 1. PHONE NUMBER VALIDATION
    // ============================================================
    validatePhoneNumber(phone) {
        const digits = phone.replace(/\D/g, '');
        if (digits.length === 9 && digits.startsWith('7')) return `254${digits}`;
        if (digits.length === 10 && digits.startsWith('07')) return `254${digits.substring(1)}`;
        if (digits.length === 12 && digits.startsWith('254')) return digits;
        return false;
    }

    formatPhoneDisplay(phone) {
        const formatted = this.validatePhoneNumber(phone);
        if (!formatted) return phone;
        const last9 = formatted.slice(-9);
        return `0${last9.slice(0, 2)} ${last9.slice(2, 5)} ${last9.slice(5)}`;
    }

    // ============================================================
    // 2. INITIATE M‑PESA PAYMENT
    // ============================================================
    async initiateMpesaPayment(paymentData) {
        try {
            const validation = this.validatePaymentData(paymentData);
            if (!validation.isValid) throw new Error(validation.errors[0]);

            const token = auth.getToken();
            if (!token) throw new Error('Not authenticated');

            const deviceFingerprint = security.getDeviceFingerprint();
            const normalizedPhone = this.validatePhoneNumber(paymentData.phoneNumber) || paymentData.phoneNumber;

            const actionArgs = {
                token,
                planName: paymentData.plan,
                deviceFingerprint,
                phoneNumber: normalizedPhone,
            };

            if (paymentData.plan === 'custom') {
                actionArgs.customAmount = paymentData.amount;
            }

            const result = await convexHttpClient.action(
                'subscriptions/actions:purchaseSubscription',
                actionArgs
            );

            if (!result.success) throw new Error(result.message);

            const { paymentId, transactionId, status, message } = result.data;

            const record = {
                id: transactionId,
                paymentId,
                phoneNumber: paymentData.phoneNumber,
                amount: paymentData.amount,
                plan: paymentData.plan,
                description: paymentData.description || `Subscription: ${paymentData.plan}`,
                status: 'pending',
                initiatedAt: new Date().toISOString(),
                completedAt: null,
                mpesaReceipt: null,
                userId: paymentData.userId || 'demo_user',
            };
            this.paymentStatus[transactionId] = { ...record, lastChecked: Date.now(), checkCount: 0 };
            this.paymentHistory.unshift(record);
            this.savePaymentHistory();

            console.log('[Payment] STK push initiated:', transactionId);

            return {
                success: true,
                transactionId,
                paymentId,
                message: message || 'Check your phone for M-Pesa prompt',
                polling: { interval: 15000, maxAttempts: 10 },
            };
        } catch (error) {
            console.error('[Payment] Initiation failed:', error);
            throw new Error(error.message || 'Payment initiation failed');
        }
    }

    // ============================================================
    // 3. CHECK PAYMENT STATUS
    // ============================================================
    async checkPaymentStatus(transactionId) {
        try {
            const token = auth.getToken();
            if (!token) {
                console.warn('[Payment] No token found, redirecting to login');
                window.location.href = '/pages/login.html';
                return { success: false, status: 'expired' };
            }

            const result = await convexHttpClient.action(
                'payments/queries:checkPaymentStatus',
                { token, transactionId }
            );

            if (!result.success) {
                if (result.error === 'invalid_token' || result.message?.toLowerCase().includes('token')) {
                    console.warn('[Payment] Invalid token, logging out');
                    await auth.logout();
                    window.location.href = '/pages/login.html';
                    return { success: false, status: 'expired' };
                }
                throw new Error(result.message);
            }

            const { status, receipt, amount, updatedAt } = result.data;

            if (this.paymentStatus[transactionId]) {
                this.paymentStatus[transactionId].status = status;
                this.paymentStatus[transactionId].mpesaReceipt = receipt;
                this.paymentStatus[transactionId].updatedAt = updatedAt;
                if (['completed', 'failed', 'expired'].includes(status)) {
                    this.paymentStatus[transactionId].completedAt = new Date().toISOString();
                }
                this.paymentStatus[transactionId].lastChecked = Date.now();
                this.paymentStatus[transactionId].checkCount++;
                const idx = this.paymentHistory.findIndex(p => p.id === transactionId);
                if (idx !== -1) {
                    this.paymentHistory[idx] = { ...this.paymentStatus[transactionId] };
                    this.savePaymentHistory();
                }
            }

            return {
                success: true,
                status,
                receipt,
                amount,
                updatedAt,
                payment: this.paymentStatus[transactionId] || null,
            };
        } catch (error) {
            console.error('[Payment] Status check failed:', error);
            if (error.message?.toLowerCase().includes('token')) {
                await auth.logout();
                window.location.href = '/pages/login.html';
                return { success: false, status: 'expired' };
            }
            return { success: false, status: 'unknown', message: error.message };
        }
    }

    // ============================================================
    // 4. POLL PAYMENT STATUS
    // ============================================================
    async pollPaymentStatus(transactionId, callbacks = {}, interval = 15000, maxAttempts = 10) {
        this.cancelPolling();

        let attempts = 0;
        let timedOut = false;
        let cancelled = false;
        let finalStatus = 'pending';

        const poll = async () => {
            if (cancelled) return;
            attempts++;
            console.log(`[Payment] Poll attempt ${attempts}/${maxAttempts} for ${transactionId}`);

            const result = await this.checkPaymentStatus(transactionId);
            const status = result.status || 'unknown';
            const payment = this.paymentStatus[transactionId] || null;

            if (callbacks.onUpdate) {
                callbacks.onUpdate({ status, payment, attempt: attempts });
            }

            if (['completed', 'failed', 'expired'].includes(status)) {
                finalStatus = status;
                this.isPolling = false;
                if (callbacks.onComplete) {
                    callbacks.onComplete({ status, payment, attempts, timedOut: false });
                }
                return;
            }

            if (attempts < maxAttempts && !cancelled) {
                this.activePoll = setTimeout(poll, interval);
            } else if (!cancelled) {
                timedOut = true;
                this.isPolling = false;
                if (callbacks.onComplete) {
                    callbacks.onComplete({ status, payment, attempts, timedOut: true });
                }
                ui.showToast('Payment status not confirmed after 150 seconds. Please check your M-Pesa app or contact support.', 'warning');
            }
        };

        this.isPolling = true;
        await poll();

        return () => {
            cancelled = true;
            this.cancelPolling();
        };
    }

    cancelPolling() {
        if (this.activePoll) {
            clearTimeout(this.activePoll);
            this.activePoll = null;
        }
        this.isPolling = false;
    }

    // ============================================================
    // 5. MANUAL CLAIM
    // ============================================================
    async claimManualPayment({ mpesaCode, phoneNumber }) {
        try {
            const token = auth.getToken();
            if (!token) throw new Error('Not authenticated');

            const result = await convexHttpClient.action(
                'payments/actions:claimManualPayment',
                { token, mpesaCode, phoneNumber }
            );

            if (!result.success) throw new Error(result.message);

            await subscription.refreshSubscription();
            return result.data;
        } catch (error) {
            console.error('[Payment] Manual claim failed:', error);
            throw new Error(error.message || 'Failed to claim payment');
        }
    }

    // ============================================================
    // 6. GET PENDING PAYMENTS
    // ============================================================
    async getPendingPayments(phoneNumber) {
        try {
            const token = auth.getToken();
            if (!token) throw new Error('Not authenticated');

            const result = await convexHttpClient.action(
                'payments/queries:getPendingPaymentsByPhone',
                { token, phoneNumber }
            );

            if (!result.success) throw new Error(result.message);
            return result.data;
        } catch (error) {
            console.error('[Payment] Failed to fetch pending payments:', error);
            return [];
        }
    }

    // ============================================================
    // 7. LEGACY / HELPER METHODS
    // ============================================================
    validatePaymentData(data) {
        const errors = [];
        if (!data.phoneNumber) errors.push('Phone number is required');
        else if (!this.validatePhoneNumber(data.phoneNumber)) {
            errors.push('Valid Kenyan phone number is required (format: 0712345678)');
        }
        if (!data.amount || data.amount < 50) errors.push('Amount must be at least KES 50');
        if (data.amount > 150000) errors.push('Amount cannot exceed KES 150,000');
        if (!data.plan) errors.push('Subscription plan is required');
        return { isValid: errors.length === 0, errors };
    }

    async recordManualPayment(paymentData) {
        console.warn('[Payment] recordManualPayment is deprecated; use claimManualPayment');
        return { success: false, message: 'Use claimManualPayment instead' };
    }

    async processRefund(transactionId, reason) {
        console.warn('[Payment] Refunds not implemented');
        return { success: false, message: 'Refunds not supported yet' };
    }

    getPaymentMethods() {
        return [
            { id: 'mpesa', name: 'M-Pesa', description: 'Mobile money payment', icon: '💰', available: true },
            { id: 'cash', name: 'Cash', description: 'Manual cash payment (Buy Goods Till)', icon: '💵', available: true },
        ];
    }

    getPlanDetails(planId) {
        const plans = subscription.getSubscriptionPlans ? subscription.getSubscriptionPlans() : {};
        return plans[planId] || null;
    }

    calculateTaxAndFees(amount) {
        const vatRate = 0.16;
        const vat = amount * vatRate;
        return {
            subtotal: amount,
            vat,
            vatRate,
            total: amount + vat,
            currency: 'KES',
            breakdown: [{ name: 'Subscription', amount }, { name: 'VAT (16%)', amount: vat }],
        };
    }

    showReceipt(transactionId) {
        const payment = this.paymentStatus[transactionId];
        if (!payment) {
            ui.showToast('Payment record not found', 'error');
            return;
        }
        const receiptContent = `
            <div class="receipt">
                <div class="receipt-header"><h3>Payment Receipt</h3><p class="receipt-id">${transactionId}</p></div>
                <div class="receipt-body">
                    <div class="receipt-row"><span class="label">Status:</span><span class="value success">${payment.status.toUpperCase()}</span></div>
                    <div class="receipt-row"><span class="label">Date:</span><span class="value">${payment.completedAt ? new Date(payment.completedAt).toLocaleString() : 'Pending'}</span></div>
                    <div class="receipt-row"><span class="label">Amount:</span><span class="value">KES ${payment.amount.toFixed(2)}</span></div>
                    <div class="receipt-row"><span class="label">Plan:</span><span class="value">${payment.plan.toUpperCase()}</span></div>
                    <div class="receipt-row"><span class="label">Phone:</span><span class="value">${this.formatPhoneDisplay(payment.phoneNumber)}</span></div>
                    <div class="receipt-row"><span class="label">M-Pesa Receipt:</span><span class="value">${payment.mpesaReceipt || 'N/A'}</span></div>
                </div>
                <div class="receipt-footer"><p>Thank you for your payment!</p></div>
            </div>
        `;
        ui.showModal({ title: 'Payment Confirmation', content: receiptContent, size: 'medium' });
    }

    printReceipt(transactionId) {
        const payment = this.paymentStatus[transactionId];
        if (!payment) return;
        const printContent = `
            <html><head><title>Receipt</title><style>body{font-family:Arial;margin:20px}.row{display:flex;justify-content:space-between;margin:8px 0}.label{font-weight:bold}</style></head>
            <body><div class="receipt"><h2>Medical Exam Room Pro</h2><h3>Payment Receipt</h3><p>${transactionId}</p>
            <div class="row"><span class="label">Date:</span><span>${payment.completedAt ? new Date(payment.completedAt).toLocaleString() : 'Pending'}</span></div>
            <div class="row"><span class="label">Amount:</span><span>KES ${payment.amount.toFixed(2)}</span></div>
            <div class="row"><span class="label">Plan:</span><span>${payment.plan.toUpperCase()}</span></div>
            <div class="row"><span class="label">Phone:</span><span>${this.formatPhoneDisplay(payment.phoneNumber)}</span></div>
            <div class="row"><span class="label">M-Pesa Receipt:</span><span>${payment.mpesaReceipt || 'N/A'}</span></div>
            <div class="row"><span class="label">Status:</span><span style="color:green;font-weight:bold">${payment.status.toUpperCase()}</span></div>
            <p>Thank you for your payment!</p></div></body></html>
        `;
        const win = window.open('', '_blank');
        win.document.write(printContent);
        win.document.close();
        win.print();
    }

    clearPaymentData() {
        this.paymentStatus = {};
        this.paymentHistory = [];
        localStorage.removeItem('payment_history');
        console.log('[Payment] Data cleared');
        return true;
    }

    getPaymentHistory(limit = 20) {
        return this.paymentHistory
            .sort((a, b) => new Date(b.initiatedAt) - new Date(a.initiatedAt))
            .slice(0, limit);
    }

    getPaymentSummary() {
        const total = this.paymentHistory.length;
        const completed = this.paymentHistory.filter(p => p.status === 'completed').length;
        const pending = this.paymentHistory.filter(p => p.status === 'pending').length;
        const failed = this.paymentHistory.filter(p => p.status === 'failed' || p.status === 'expired').length;
        const totalAmount = this.paymentHistory
            .filter(p => p.status === 'completed')
            .reduce((sum, p) => sum + p.amount, 0);
        return { total, completed, pending, failed, totalAmount, averageAmount: completed > 0 ? totalAmount / completed : 0 };
    }

    handlePaymentError(error, transactionId) {
        console.error('[Payment] Error:', error);
        let msg = error.message || 'Payment failed. Please try again.';
        if (transactionId && this.paymentStatus[transactionId]) {
            this.paymentStatus[transactionId].status = 'failed';
            this.paymentStatus[transactionId].error = msg;
        }
        ui.showToast(msg, 'error');
        return msg;
    }
}

// ==================== GLOBAL INSTANCE ====================
const Payment = new PaymentManager();

// ==================== EXPORTED WRAPPERS ====================

/**
 * Initiate M‑Pesa payment using the currently selected plan.
 * @param {string} phoneNumber - M‑Pesa phone number (normalized)
 * @param {string} planId - plan identifier (e.g., 'monthly', 'quarterly', 'yearly', 'custom')
 * @returns {Promise<Object>} transaction details
 */
export async function initiateMPesaPayment(phoneNumber, planId) {
    const plan = getSelectedPlan();
    if (!plan) {
        throw new Error('No plan selected. Please go back and choose a plan.');
    }
    const amount = plan.price;
    if (!amount || amount <= 0) {
        throw new Error('Invalid plan amount');
    }

    const paymentData = {
        phoneNumber,
        plan: planId,
        amount,
        description: `Subscription: ${planId}`,
        userId: auth.getUser()?._id || 'demo_user',
    };

    const result = await Payment.initiateMpesaPayment(paymentData);
    return {
        success: result.success,
        transactionId: result.transactionId,
        paymentId: result.paymentId,
    };
}

/**
 * Check payment status (wrapper).
 */
export async function checkPaymentStatus(transactionId) {
    const result = await Payment.checkPaymentStatus(transactionId);
    if (result.success) {
        return result.status;
    }
    return 'failed';
}

// Export the poll method for HTML use
export const pollPaymentStatus = Payment.pollPaymentStatus.bind(Payment);

// Expose Payment globally for window usage
window.Payment = Payment;
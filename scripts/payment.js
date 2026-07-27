// payment.js - Payment processing (mocked for Phase 1)
class PaymentManager {
    constructor() {
        this.mpesaApiUrl = 'https://medicalexamroom.onrender.com/api/v1/payments';
        this.paymentStatus = {};
        this.paymentHistory = [];
        
        this.init();
    }

    // Initialize payment manager
    init() {
        // Load payment history
        this.loadPaymentHistory();
        
        console.log('Payment manager initialized');
    }

    // Load payment history
    loadPaymentHistory() {
        try {
            const savedHistory = localStorage.getItem('payment_history');
            this.paymentHistory = savedHistory ? JSON.parse(savedHistory) : [];
        } catch (error) {
            console.error('Failed to load payment history:', error);
            this.paymentHistory = [];
        }
    }

    // Save payment history
    savePaymentHistory() {
        try {
            localStorage.setItem('payment_history', JSON.stringify(this.paymentHistory));
        } catch (error) {
            console.error('Failed to save payment history:', error);
        }
    }

    // Validate phone number (Kenyan format)
    validatePhoneNumber(phone) {
        const digits = phone.replace(/\D/g, '');
        
        if (digits.length === 9 && digits.startsWith('7')) {
            return `254${digits}`;
        } else if (digits.length === 10 && digits.startsWith('07')) {
            return `254${digits.substring(1)}`;
        } else if (digits.length === 12 && digits.startsWith('254')) {
            return digits;
        }
        
        return false;
    }

    // Format phone number for display
    formatPhoneDisplay(phone) {
        const formatted = this.validatePhoneNumber(phone);
        if (!formatted) return phone;
        
        // Format as 0712 345 678
        const last9 = formatted.slice(-9);
        return `0${last9.slice(0, 2)} ${last9.slice(2, 5)} ${last9.slice(5)}`;
    }

    // Mock M-Pesa payment initiation (Phase 1)
    async initiateMpesaPayment(paymentData) {
        return new Promise((resolve, reject) => {
            setTimeout(() => {
                try {
                    // Validate payment data
                    const validation = this.validatePaymentData(paymentData);
                    if (!validation.isValid) {
                        reject(new Error(validation.errors[0]));
                        return;
                    }
                    
                    // Generate transaction ID
                    const transactionId = `MP${Date.now()}${Math.random().toString(36).substr(2, 6).toUpperCase()}`;
                    
                    // Create payment record
                    const paymentRecord = {
                        id: transactionId,
                        phoneNumber: paymentData.phoneNumber,
                        amount: paymentData.amount,
                        plan: paymentData.plan,
                        description: paymentData.description || `Subscription: ${paymentData.plan}`,
                        status: 'pending',
                        initiatedAt: new Date().toISOString(),
                        completedAt: null,
                        mpesaReceipt: null,
                        userId: paymentData.userId || 'demo_user'
                    };
                    
                    // Store payment status
                    this.paymentStatus[transactionId] = {
                        ...paymentRecord,
                        lastChecked: new Date().toISOString(),
                        checkCount: 0
                    };
                    
                    // Add to history
                    this.paymentHistory.unshift(paymentRecord);
                    this.savePaymentHistory();
                    
                    // Log payment initiation
                    DB.logSecurityEvent('payment_initiated', {
                        transactionId,
                        amount: paymentData.amount,
                        plan: paymentData.plan,
                        phone: paymentData.phoneNumber
                    });
                    
                    console.log(`M-Pesa payment initiated: ${transactionId} for ${paymentData.amount} KES`);
                    
                    // For Phase 1: simulate M-Pesa prompt
                    this.simulateMpesaPrompt(transactionId, paymentData);
                    
                    resolve({
                        success: true,
                        transactionId,
                        message: 'Check your phone for M-Pesa prompt',
                        instructions: [
                            '1. Check your phone for M-Pesa prompt',
                            '2. Enter your M-Pesa PIN',
                            '3. Wait for confirmation'
                        ],
                        polling: {
                            statusUrl: `/api/v1/payments/check-status/${transactionId}`,
                            interval: 5000 // Check every 5 seconds
                        }
                    });
                } catch (error) {
                    reject(error);
                }
            }, 1000); // Simulate API delay
        });
    }

    // Validate payment data
    validatePaymentData(data) {
        const errors = [];
        
        if (!data.phoneNumber) {
            errors.push('Phone number is required');
        } else if (!this.validatePhoneNumber(data.phoneNumber)) {
            errors.push('Valid Kenyan phone number is required (format: 0712345678)');
        }
        
        if (!data.amount || data.amount < 50) {
            errors.push('Amount must be at least KES 50');
        }
        
        if (data.amount > 150000) {
            errors.push('Amount cannot exceed KES 150,000');
        }
        
        if (!data.plan) {
            errors.push('Subscription plan is required');
        }
        
        return {
            isValid: errors.length === 0,
            errors
        };
    }

    // Simulate M-Pesa prompt (Phase 1)
    simulateMpesaPrompt(transactionId, paymentData) {
        // For Phase 1: show simulated M-Pesa prompt
        setTimeout(() => {
            const modalContent = `
                <div class="mpesa-simulation">
                    <div class="simulation-header">
                        <h3>📱 M-Pesa Simulation (Phase 1)</h3>
                        <p>This is a simulation for testing purposes</p>
                    </div>
                    
                    <div class="simulation-body">
                        <div class="simulation-info">
                            <p><strong>To:</strong> MEDICAL EXAM ROOM</p>
                            <p><strong>Account:</strong> ${paymentData.plan.toUpperCase()}</p>
                            <p><strong>Amount:</strong> KES ${paymentData.amount.toFixed(2)}</p>
                            <p><strong>Phone:</strong> ${this.formatPhoneDisplay(paymentData.phoneNumber)}</p>
                        </div>
                        
                        <div class="simulation-pin">
                            <label for="mpesa-pin">Enter M-Pesa PIN (simulation):</label>
                            <input type="password" id="mpesa-pin" maxlength="4" placeholder="0000" class="pin-input">
                            <p class="pin-hint">For testing, use any 4-digit number</p>
                        </div>
                    </div>
                    
                    <div class="simulation-actions">
                        <button class="btn btn-outline cancel-payment">Cancel</button>
                        <button class="btn btn-primary confirm-payment">Confirm Payment</button>
                    </div>
                </div>
            `;
            
            const modalId = UIManager.showModal({
                title: 'M-Pesa Payment',
                content: modalContent,
                size: 'medium',
                showClose: false,
                backdrop: true,
                buttons: []
            });
            
            // Add event listeners
            setTimeout(() => {
                const confirmBtn = document.querySelector('.confirm-payment');
                const cancelBtn = document.querySelector('.cancel-payment');
                const pinInput = document.getElementById('mpesa-pin');
                
                if (confirmBtn) {
                    confirmBtn.addEventListener('click', () => {
                        const pin = pinInput ? pinInput.value : '0000';
                        this.processMpesaConfirmation(transactionId, pin);
                        UIManager.hideModal(modalId);
                    });
                }
                
                if (cancelBtn) {
                    cancelBtn.addEventListener('click', () => {
                        this.cancelPayment(transactionId, 'User cancelled');
                        UIManager.hideModal(modalId);
                    });
                }
                
                // Auto-confirm after 30 seconds for testing
                setTimeout(() => {
                    if (document.querySelector(`[id="${modalId}"]`)) {
                        this.processMpesaConfirmation(transactionId, '1234');
                        UIManager.hideModal(modalId);
                        UIManager.showToast('Auto-confirmed for testing', 'info');
                    }
                }, 30000);
            }, 100);
        }, 2000); // Show prompt after 2 seconds
    }

    // Process M-Pesa confirmation (Phase 1)
    async processMpesaConfirmation(transactionId, pin) {
        // Validate PIN (for Phase 1: accept any 4-digit PIN)
        if (!pin || pin.length !== 4 || !/^\d+$/.test(pin)) {
            this.cancelPayment(transactionId, 'Invalid PIN');
            return;
        }
        
        // Simulate processing delay
        UIManager.showLoader('Processing payment...');
        
        setTimeout(async () => {
            try {
                // Generate receipt number
                const receiptNumber = `RF${Date.now().toString().slice(-6)}${Math.floor(Math.random() * 1000).toString().padStart(3, '0')}`;
                
                // Update payment status
                this.paymentStatus[transactionId].status = 'completed';
                this.paymentStatus[transactionId].completedAt = new Date().toISOString();
                this.paymentStatus[transactionId].mpesaReceipt = receiptNumber;
                
                // Update history
                const paymentIndex = this.paymentHistory.findIndex(p => p.id === transactionId);
                if (paymentIndex !== -1) {
                    this.paymentHistory[paymentIndex] = this.paymentStatus[transactionId];
                    this.savePaymentHistory();
                }
                
                // Activate subscription
                await Subscription.subscribe(
                    this.paymentStatus[transactionId].plan,
                    'mpesa'
                );
                
                // Log successful payment
                DB.logSecurityEvent('payment_completed', {
                    transactionId,
                    amount: this.paymentStatus[transactionId].amount,
                    receipt: receiptNumber,
                    plan: this.paymentStatus[transactionId].plan
                });
                
                UIManager.hideLoader();
                UIManager.showToast('Payment successful! Subscription activated.', 'success');
                
                // Show receipt
                this.showReceipt(transactionId);
                
            } catch (error) {
                console.error('Payment processing failed:', error);
                this.cancelPayment(transactionId, error.message);
            }
        }, 2000); // Simulate 2-second processing
    }

    // Cancel payment
    cancelPayment(transactionId, reason) {
        if (this.paymentStatus[transactionId]) {
            this.paymentStatus[transactionId].status = 'failed';
            this.paymentStatus[transactionId].completedAt = new Date().toISOString();
            this.paymentStatus[transactionId].error = reason;
            
            // Update history
            const paymentIndex = this.paymentHistory.findIndex(p => p.id === transactionId);
            if (paymentIndex !== -1) {
                this.paymentHistory[paymentIndex] = this.paymentStatus[transactionId];
                this.savePaymentHistory();
            }
            
            // Log failed payment
            DB.logSecurityEvent('payment_failed', {
                transactionId,
                reason,
                amount: this.paymentStatus[transactionId].amount
            });
            
            UIManager.showToast(`Payment failed: ${reason}`, 'error');
        }
    }

    // Show payment receipt
    showReceipt(transactionId) {
        const payment = this.paymentStatus[transactionId];
        if (!payment) return;
        
        const receiptContent = `
            <div class="receipt">
                <div class="receipt-header">
                    <h3>Payment Receipt</h3>
                    <p class="receipt-id">${transactionId}</p>
                </div>
                
                <div class="receipt-body">
                    <div class="receipt-row">
                        <span class="label">Status:</span>
                        <span class="value success">COMPLETED</span>
                    </div>
                    
                    <div class="receipt-row">
                        <span class="label">Date:</span>
                        <span class="value">${Utils.formatDateTime(payment.completedAt)}</span>
                    </div>
                    
                    <div class="receipt-row">
                        <span class="label">Amount:</span>
                        <span class="value">KES ${payment.amount.toFixed(2)}</span>
                    </div>
                    
                    <div class="receipt-row">
                        <span class="label">Plan:</span>
                        <span class="value">${payment.plan.toUpperCase()}</span>
                    </div>
                    
                    <div class="receipt-row">
                        <span class="label">Phone:</span>
                        <span class="value">${this.formatPhoneDisplay(payment.phoneNumber)}</span>
                    </div>
                    
                    <div class="receipt-row">
                        <span class="label">M-Pesa Receipt:</span>
                        <span class="value">${payment.mpesaReceipt}</span>
                    </div>
                    
                    <div class="receipt-row">
                        <span class="label">Description:</span>
                        <span class="value">${payment.description}</span>
                    </div>
                </div>
                
                <div class="receipt-footer">
                    <p>Thank you for your payment!</p>
                    <p class="note">This is a simulation receipt for Phase 1 testing.</p>
                </div>
            </div>
        `;
        
        UIManager.showModal({
            title: 'Payment Confirmation',
            content: receiptContent,
            size: 'medium',
            buttons: [
                {
                    text: 'Close',
                    type: 'primary',
                    action: 'close'
                },
                {
                    text: 'Print Receipt',
                    type: 'secondary',
                    action: 'print'
                }
            ],
            onConfirm: () => {
                this.printReceipt(transactionId);
            }
        });
    }

    // Print receipt
    printReceipt(transactionId) {
        const payment = this.paymentStatus[transactionId];
        if (!payment) return;
        
        const printContent = `
            <html>
                <head>
                    <title>Payment Receipt - ${transactionId}</title>
                    <style>
                        body { font-family: Arial, sans-serif; margin: 20px; }
                        .receipt { max-width: 400px; margin: 0 auto; }
                        .header { text-align: center; border-bottom: 2px solid #000; padding-bottom: 10px; margin-bottom: 20px; }
                        .row { display: flex; justify-content: space-between; margin: 8px 0; }
                        .label { font-weight: bold; }
                        .footer { margin-top: 30px; text-align: center; font-size: 12px; color: #666; }
                        @media print { body { margin: 0; } }
                    </style>
                </head>
                <body>
                    <div class="receipt">
                        <div class="header">
                            <h2>Medical Exam Room Pro</h2>
                            <h3>Payment Receipt</h3>
                            <p>${transactionId}</p>
                        </div>
                        
                        <div class="row">
                            <span class="label">Date:</span>
                            <span>${Utils.formatDateTime(payment.completedAt)}</span>
                        </div>
                        
                        <div class="row">
                            <span class="label">Amount:</span>
                            <span>KES ${payment.amount.toFixed(2)}</span>
                        </div>
                        
                        <div class="row">
                            <span class="label">Plan:</span>
                            <span>${payment.plan.toUpperCase()}</span>
                        </div>
                        
                        <div class="row">
                            <span class="label">Phone:</span>
                            <span>${this.formatPhoneDisplay(payment.phoneNumber)}</span>
                        </div>
                        
                        <div class="row">
                            <span class="label">M-Pesa Receipt:</span>
                            <span>${payment.mpesaReceipt}</span>
                        </div>
                        
                        <div class="row">
                            <span class="label">Status:</span>
                            <span style="color: green; font-weight: bold;">COMPLETED</span>
                        </div>
                        
                        <div class="footer">
                            <p>Thank you for your payment!</p>
                            <p>This receipt is computer generated and does not require a signature.</p>
                            <p>For inquiries: felixappbuilder@gmail.com | 0746834527</p>
                        </div>
                    </div>
                </body>
            </html>
        `;
        
        const printWindow = window.open('', '_blank');
        printWindow.document.write(printContent);
        printWindow.document.close();
        printWindow.print();
    }

    // Check payment status (Phase 1 - polling simulation)
    async checkPaymentStatus(transactionId) {
        return new Promise((resolve) => {
            setTimeout(() => {
                const payment = this.paymentStatus[transactionId];
                
                if (!payment) {
                    resolve({
                        success: false,
                        message: 'Transaction not found'
                    });
                    return;
                }
                
                // Update check count
                if (this.paymentStatus[transactionId]) {
                    this.paymentStatus[transactionId].lastChecked = new Date().toISOString();
                    this.paymentStatus[transactionId].checkCount++;
                }
                
                resolve({
                    success: true,
                    payment: { ...payment }
                });
            }, 500); // Simulate API delay
        });
    }

    // Get payment history
    getPaymentHistory(limit = 20) {
        return this.paymentHistory
            .sort((a, b) => new Date(b.initiatedAt) - new Date(a.initiatedAt))
            .slice(0, limit);
    }

    // Get payment summary
    getPaymentSummary() {
        const total = this.paymentHistory.length;
        const completed = this.paymentHistory.filter(p => p.status === 'completed').length;
        const pending = this.paymentHistory.filter(p => p.status === 'pending').length;
        const failed = this.paymentHistory.filter(p => p.status === 'failed').length;
        
        const totalAmount = this.paymentHistory
            .filter(p => p.status === 'completed')
            .reduce((sum, p) => sum + p.amount, 0);
        
        return {
            total,
            completed,
            pending,
            failed,
            totalAmount,
            averageAmount: completed > 0 ? totalAmount / completed : 0
        };
    }

    // Manual payment entry (for admin/cash payments in Phase 1)
    async recordManualPayment(paymentData) {
        return new Promise((resolve, reject) => {
            setTimeout(() => {
                try {
                    // Validate data
                    if (!paymentData.amount || paymentData.amount <= 0) {
                        reject(new Error('Invalid amount'));
                        return;
                    }
                    
                    if (!paymentData.plan) {
                        reject(new Error('Plan is required'));
                        return;
                    }
                    
                    // Generate transaction ID
                    const transactionId = `MAN${Date.now()}${Math.random().toString(36).substr(2, 6).toUpperCase()}`;
                    
                    // Create payment record
                    const paymentRecord = {
                        id: transactionId,
                        phoneNumber: paymentData.phoneNumber || 'N/A',
                        amount: paymentData.amount,
                        plan: paymentData.plan,
                        description: paymentData.description || `Manual payment: ${paymentData.plan}`,
                        status: 'completed',
                        initiatedAt: new Date().toISOString(),
                        completedAt: new Date().toISOString(),
                        mpesaReceipt: paymentData.receipt || 'MANUAL',
                        paymentMethod: paymentData.method || 'cash',
                        userId: paymentData.userId || 'demo_user',
                        notes: paymentData.notes
                    };
                    
                    // Add to history
                    this.paymentHistory.unshift(paymentRecord);
                    this.savePaymentHistory();
                    
                    // Activate subscription
                    Subscription.subscribe(paymentData.plan, 'manual').catch(console.error);
                    
                    // Log manual payment
                    DB.logSecurityEvent('manual_payment_recorded', {
                        transactionId,
                        amount: paymentData.amount,
                        plan: paymentData.plan,
                        method: paymentData.method || 'cash'
                    });
                    
                    console.log(`Manual payment recorded: ${transactionId}`);
                    
                    resolve({
                        success: true,
                        transactionId,
                        payment: paymentRecord,
                        message: 'Manual payment recorded successfully'
                    });
                } catch (error) {
                    reject(error);
                }
            }, 500);
        });
    }

    // Process refund (Phase 1 - simulation)
    async processRefund(transactionId, reason) {
        return new Promise((resolve, reject) => {
            setTimeout(() => {
                try {
                    const payment = this.paymentHistory.find(p => p.id === transactionId);
                    
                    if (!payment) {
                        reject(new Error('Transaction not found'));
                        return;
                    }
                    
                    if (payment.status !== 'completed') {
                        reject(new Error('Only completed payments can be refunded'));
                        return;
                    }
                    
                    // Create refund record
                    const refundId = `REF${Date.now()}${Math.random().toString(36).substr(2, 6).toUpperCase()}`;
                    const refundRecord = {
                        id: refundId,
                        originalTransaction: transactionId,
                        amount: payment.amount,
                        reason: reason,
                        processedAt: new Date().toISOString(),
                        status: 'completed'
                    };
                    
                    // Mark original payment as refunded
                    payment.status = 'refunded';
                    payment.refundId = refundId;
                    payment.refundedAt = new Date().toISOString();
                    
                    this.savePaymentHistory();
                    
                    // Log refund
                    DB.logSecurityEvent('refund_processed', {
                        refundId,
                        transactionId,
                        amount: payment.amount,
                        reason
                    });
                    
                    console.log(`Refund processed: ${refundId} for ${transactionId}`);
                    
                    resolve({
                        success: true,
                        refundId,
                        amount: payment.amount,
                        message: 'Refund processed successfully'
                    });
                } catch (error) {
                    reject(error);
                }
            }, 1000);
        });
    }

    // Get payment methods
    getPaymentMethods() {
        return [
            {
                id: 'mpesa',
                name: 'M-Pesa',
                description: 'Mobile money payment',
                icon: '💰',
                available: true,
                fees: 'No fees',
                processingTime: 'Instant'
            },
            {
                id: 'cash',
                name: 'Cash',
                description: 'Manual cash payment',
                icon: '💵',
                available: true,
                fees: 'No fees',
                processingTime: 'Manual processing'
            },
            {
                id: 'bank',
                name: 'Bank Transfer',
                description: 'Direct bank transfer',
                icon: '🏦',
                available: false,
                fees: 'Bank charges may apply',
                processingTime: '1-2 business days'
            }
        ];
    }

    // Validate subscription plans for payment
    getPlanDetails(planId) {
        const plans = Subscription.getSubscriptionPlans();
        return plans[planId];
    }

    // Calculate tax and fees (Phase 1 - Kenya VAT)
    calculateTaxAndFees(amount, paymentMethod = 'mpesa') {
        const vatRate = 0.16; // 16% VAT in Kenya
        const vat = amount * vatRate;
        const total = amount + vat;
        
        return {
            subtotal: amount,
            vat: vat,
            vatRate: vatRate,
            total: total,
            currency: 'KES',
            breakdown: [
                { name: 'Subscription', amount: amount },
                { name: 'VAT (16%)', amount: vat }
            ]
        };
    }

    // Handle payment errors
    handlePaymentError(error, transactionId = null) {
        console.error('Payment error:', error);
        
        if (transactionId && this.paymentStatus[transactionId]) {
            this.cancelPayment(transactionId, error.message);
        }
        
        // Show user-friendly error message
        let userMessage = 'Payment failed. Please try again.';
        
        if (error.message.includes('insufficient funds')) {
            userMessage = 'Insufficient funds in your M-Pesa account.';
        } else if (error.message.includes('timeout')) {
            userMessage = 'Payment timeout. Please check your phone and try again.';
        } else if (error.message.includes('cancelled')) {
            userMessage = 'Payment cancelled.';
        } else if (error.message.includes('Invalid PIN')) {
            userMessage = 'Invalid M-Pesa PIN. Please try again.';
        }
        
        UIManager.showToast(userMessage, 'error');
        
        return userMessage;
    }

    // Clear payment data (for testing)
    clearPaymentData() {
        this.paymentStatus = {};
        this.paymentHistory = [];
        localStorage.removeItem('payment_history');
        
        console.log('Payment data cleared');
        return true;
    }
}

// Create global instance
const Payment = new PaymentManager();

// ==================== MODULE EXPORTS ====================
// Wrappers that match the imports used by payment.html

export async function initiateMPesaPayment(phoneNumber, planId) {
  // Hardcoded plan prices (keep in sync with subscription.js PLANS constant)
  const PLAN_PRICES = {
    trial: 0,
    monthly: 350,
    quarterly: 850,
    yearly: 2100
  };
  const amount = PLAN_PRICES[planId] || 350;

  const paymentData = {
    phoneNumber,
    plan: planId,
    amount,
    description: `Subscription: ${planId}`,
    userId: (typeof app !== 'undefined' ? app.getUser()?.id : undefined) || 'demo_user'
  };

  const result = await Payment.initiateMpesaPayment(paymentData);
  return {
    success: result.success,
    transactionId: result.transactionId
  };
}

export async function checkPaymentStatus(transactionId) {
  const result = await Payment.checkPaymentStatus(transactionId);
  if (result.success) {
    // payment.html polling expects a plain status string like 'completed'
    return result.payment.status;
  }
  return 'failed';
}
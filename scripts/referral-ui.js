// frontend-user/scripts/referral-ui.js

/**
 * Referral UI Module
 * Renders the referral dashboard for users and agents.
 * Handles wallet display, referral list, and withdrawal requests.
 */

import * as referral from './referral.js';
import * as ui from './ui.js';
import * as utils from './utils.js';
import * as app from './app.js';

// ==================== RENDER DASHBOARD ====================

/**
 * Render the full referral dashboard.
 * @param {HTMLElement} container - The container element
 */
export async function renderDashboard(container) {
    if (!container) return;

    ui.showLoading('Loading referral data...');
    try {
        const data = await referral.getReferralDashboard();
        const isAgent = data.isAgent || false;

        // Render based on user type
        if (isAgent) {
            renderAgentDashboard(container, data);
        } else {
            renderUserDashboard(container, data);
        }

        // Attach event listeners
        attachEventListeners(container, data);
    } catch (err) {
        container.innerHTML = `
            <div class="error-state">
                <p>Failed to load referral data: ${err.message}</p>
                <button onclick="location.reload()" class="btn-primary">Retry</button>
            </div>
        `;
    } finally {
        ui.hideLoading();
    }
}

// ==================== USER DASHBOARD ====================

function renderUserDashboard(container, data) {
    const isAgent = data.isAgent || false;
    // Determine earn text based on user type
    let earnText = `<strong>KES 30</strong> for every friend who subscribes!`;
    if (isAgent) {
        earnText = `<strong>KES 40</strong> for every friend who subscribes and <strong>KES 15</strong> per renewal!`;
    }

    container.innerHTML = `
        <div class="referral-header">
            <div class="referral-code-section">
                <h2>Your Referral Code</h2>
                <div class="code-display">
                    <span class="code">${data.referralCode}</span>
                    <button class="btn-outline copy-btn" data-code="${data.referralCode}">📋 Copy</button>
                    <button class="btn-primary share-btn" data-code="${data.referralCode}">📤 Share</button>
                </div>
                <p class="earn-info">Earn ${earnText}</p>
            </div>
        </div>

        <div class="wallet-section">
            <div class="wallet-card">
                <div class="wallet-balance">
                    <span class="label">Available Balance</span>
                    <span class="amount">KES ${data.balance || 0}</span>
                </div>
                <div class="wallet-stats">
                    <div class="stat">
                        <span class="stat-label">Total Earned</span>
                        <span class="stat-value">KES ${data.totalEarned || 0}</span>
                    </div>
                    <div class="stat">
                        <span class="stat-label">Pending</span>
                        <span class="stat-value">KES ${data.pendingBalance || 0}</span>
                    </div>
                    <div class="stat">
                        <span class="stat-label">Successful Referrals</span>
                        <span class="stat-value">${data.successful || 0}</span>
                    </div>
                    <div class="stat">
                        <span class="stat-label">Total Referrals</span>
                        <span class="stat-value">${data.count || 0}</span>
                    </div>
                </div>
                ${data.balance >= 100 ? `
                    <button class="btn-primary withdraw-btn" data-balance="${data.balance}">💰 Request Withdrawal</button>
                ` : `
                    <p class="withdraw-hint">Earn at least KES 100 to withdraw. You have KES ${data.balance || 0}.</p>
                `}
            </div>
        </div>

        <div class="referrals-section">
            <h3>Your Referrals</h3>
            ${data.referrals && data.referrals.length > 0 ? `
                <div class="referral-list">
                    ${data.referrals.map(ref => `
                        <div class="referral-item ${ref.subscriptionActive ? 'active' : ''}">
                            <div class="ref-info">
                                <span class="ref-name">${ref.name || 'Anonymous'}</span>
                                <span class="ref-email">${ref.email || ''}</span>
                            </div>
                            <div class="ref-status">
                                ${ref.subscriptionActive ? '✅ Active Subscriber' : (ref.hasSubscribed ? '⏳ Expired' : '📝 Registered')}
                            </div>
                            <div class="ref-date">${utils.formatDate(ref.createdAt)}</div>
                        </div>
                    `).join('')}
                </div>
            ` : `
                <p class="no-data">No referrals yet. Share your link to start earning!</p>
            `}
        </div>

        ${isAgent ? `
            <div class="agent-badge">
                ⭐ You are a verified Agent! You earn <strong>KES 40</strong> per new subscriber and <strong>KES 15</strong> per renewal.
            </div>
        ` : `
            <div class="become-agent" style="display: none;">
                <p>Want to earn more? <a href="#" onclick="router.navigateTo('agent-signup.html')">Become a Campus Agent</a> and earn KES 40 per referral!</p>
            </div>
        `}
    `;
}

// ==================== AGENT DASHBOARD ====================

function renderAgentDashboard(container, data) {
    // Render user dashboard (which now uses isAgent flag for correct earn text)
    renderUserDashboard(container, data);

    // Add renewal stats if available
    if (data.renewals !== undefined) {
        const statsSection = container.querySelector('.wallet-stats');
        if (statsSection) {
            statsSection.innerHTML += `
                <div class="stat">
                    <span class="stat-label">Renewals</span>
                    <span class="stat-value">${data.renewals || 0}</span>
                </div>
            `;
        }
    }
}

// ==================== WITHDRAWAL MODAL ====================

function showWithdrawalModal(balance) {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.id = 'withdrawal-modal';
    modal.innerHTML = `
        <div class="modal">
            <div class="modal-header">
                <h3>Request Withdrawal</h3>
                <button class="modal-close" onclick="document.getElementById('withdrawal-modal').remove()">&times;</button>
            </div>
            <div class="modal-body">
                <p>Available balance: <strong>KES ${balance}</strong></p>
                <p>Minimum withdrawal: <strong>KES 100</strong></p>
                <div class="form-group">
                    <label for="withdraw-amount">Amount (KES)</label>
                    <input type="number" id="withdraw-amount" min="100" max="${balance}" step="50" value="${Math.min(100, balance)}">
                </div>
                <div class="form-group">
                    <label for="withdraw-phone">M-Pesa Phone Number</label>
                    <input type="tel" id="withdraw-phone" placeholder="e.g., 0712345678">
                </div>
                <div id="withdraw-status" class="withdraw-status"></div>
            </div>
            <div class="modal-footer">
                <button class="btn-secondary" onclick="document.getElementById('withdrawal-modal').remove()">Cancel</button>
                <button class="btn-primary" id="withdraw-submit">Request Withdrawal</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    document.getElementById('withdraw-submit').addEventListener('click', async () => {
        const amount = parseInt(document.getElementById('withdraw-amount').value);
        const phone = document.getElementById('withdraw-phone').value.trim();
        const statusEl = document.getElementById('withdraw-status');

        statusEl.textContent = 'Processing...';
        statusEl.className = 'withdraw-status info';

        try {
            const result = await referral.requestWithdrawal(amount, phone);
            statusEl.textContent = '✅ Withdrawal request submitted successfully!';
            statusEl.className = 'withdraw-status success';
            setTimeout(() => {
                document.getElementById('withdrawal-modal').remove();
                location.reload();
            }, 3000);
        } catch (err) {
            statusEl.textContent = '❌ ' + err.message;
            statusEl.className = 'withdraw-status error';
        }
    });
}

// ==================== EVENT LISTENERS ====================

function attachEventListeners(container, data) {
    // Copy referral link
    container.querySelectorAll('.copy-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const code = btn.dataset.code;
            referral.copyReferralLink(code);
        });
    });

    // Share referral link
    container.querySelectorAll('.share-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const code = btn.dataset.code;
            referral.shareReferralLink(code);
        });
    });

    // Withdrawal button
    const withdrawBtn = container.querySelector('.withdraw-btn');
    if (withdrawBtn) {
        withdrawBtn.addEventListener('click', () => {
            const balance = parseFloat(withdrawBtn.dataset.balance) || 0;
            showWithdrawalModal(balance);
        });
    }
}

// ==================== EXPOSE GLOBALLY ====================

window.referralUI = {
    renderDashboard,
    renderUserDashboard,
    renderAgentDashboard
};
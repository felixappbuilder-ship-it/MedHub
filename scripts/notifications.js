// frontend-user/scripts/notifications.js

/**
 * MedHub Notification Engine – Real Data Version
 * Loads, renders, filters, searches, groups, sorts, and manages notifications.
 * Uses Convex for backend sync and IndexedDB (db.js) for local caching.
 * 
 * Throttling: notifications are fetched at most once every 3 hours.
 * The timer is stored in localStorage to persist across page reloads.
 * All backend calls use the token from localStorage; no extra auth calls are made.
 */

import * as app from './app.js';
import * as ui from './ui.js';
import * as router from './router.js';
import * as utils from './utils.js';
import * as db from './db.js';
import { convexHttpClient } from './convex-client.js';
import { getToken } from './auth.js';

// ==================== CONSTANTS ====================

const NOTIFICATION_COOLDOWN_MS = 3 * 60 * 60 * 1000; // 3 hours
const NOTIFICATION_TIMER_KEY = 'notification_timer';

// ==================== TIMER MANAGEMENT ====================

function getLastNotificationFetch() {
    const stored = localStorage.getItem(NOTIFICATION_TIMER_KEY);
    return stored ? parseInt(stored, 10) : 0;
}

function setLastNotificationFetch(ts) {
    localStorage.setItem(NOTIFICATION_TIMER_KEY, String(ts));
}

function isNotificationFetchAllowed() {
    const last = getLastNotificationFetch();
    const now = Date.now();
    return (now - last) > NOTIFICATION_COOLDOWN_MS;
}

// ==================== STATE ====================

let notifications = [];
let filteredNotifications = [];
let currentFilter = 'all';
let currentCategory = 'all';
let currentSort = 'newest';
let searchQuery = '';
let isLoaded = false;
let isInitialized = false;
let pollingInterval = null;
let appReady = false;

// DOM refs (set in init)
let container;
let unreadBadge;
let loadingState;
let emptyState;
let errorState;
let searchInput;
let clearSearch;
let filterBtns;
let sortSelect;
let chips;
let stats;

// ==================== DOM REFS SETUP ====================

function getDomRefs() {
    return {
        container: document.getElementById('notificationContainer'),
        unreadBadge: document.getElementById('unreadBadge'),
        loadingState: document.getElementById('loadingState'),
        emptyState: document.getElementById('emptyState'),
        errorState: document.getElementById('errorState'),
        searchInput: document.getElementById('searchInput'),
        clearSearch: document.getElementById('clearSearch'),
        filterBtns: document.querySelectorAll('.filter-btn'),
        sortSelect: document.getElementById('sortSelect'),
        chips: document.querySelectorAll('.chip'),
        stats: {
            unread: document.getElementById('statUnread'),
            read: document.getElementById('statRead'),
            pinned: document.getElementById('statPinned'),
            archived: document.getElementById('statArchived'),
            critical: document.getElementById('statCritical'),
            today: document.getElementById('statToday')
        }
    };
}

// ==================== HELPER: MAP BACKEND TO FRONTEND ====================

function mapBackendToFrontend(backendNotif) {
    return {
        id: backendNotif._id,
        title: backendNotif.title || 'Notification',
        body: backendNotif.message || '',
        timestamp: backendNotif.createdAt,
        read: backendNotif.read || false,
        category: backendNotif.type || 'general',
        data: backendNotif.data || null,
        senderId: backendNotif.senderId || null,
        pinned: false,
        archived: false,
        priority: backendNotif.type === 'admin_broadcast' ? 'high' : 'normal',
        icon: getIconForType(backendNotif.type),
        actions: getActionsForType(backendNotif.type, backendNotif.data),
    };
}

function getIconForType(type) {
    const icons = {
        'admin_broadcast': '📢',
        'exam_shared': '📤',
        'note_shared': '📝',
        'subscription_expiry': '⏰',
        'subscription_renewed': '✅',
        'challenge_invite': '🏆',
        'challenge_result': '📊',
        'system': '⚙️',
    };
    return icons[type] || '📩';
}

function getActionsForType(type, data) {
    const actions = [];
    if (type === 'exam_shared' && data && data.shareToken) {
        actions.push({ label: 'View Exam', action: 'openExam', data: { examId: data.examId || data.shareToken } });
    }
    if (type === 'challenge_invite' && data && data.challengeId) {
        actions.push({ label: 'Join Challenge', action: 'joinChallenge', data: { challengeId: data.challengeId } });
    }
    if (type === 'subscription_expiry') {
        actions.push({ label: 'Renew', action: 'renewSubscription', data: {} });
    }
    if (type === 'admin_broadcast') {
        actions.push({ label: 'Dismiss', action: 'dismiss', data: {} });
    }
    return actions;
}

// ==================== ENSURE APP IS INITIALIZED ====================

async function ensureAppInitialized() {
    if (appReady) return;
    if (!app.getUser()) {
        console.log('[Notifications] App not initialized, initializing...');
        await app.initializeApp();
    }
    appReady = true;
    await new Promise(resolve => setTimeout(resolve, 100));
    console.log('[Notifications] App ready, user:', app.getUser());
}

// ==================== LOAD NOTIFICATIONS ====================

export async function loadNotifications(force = false) {
    await ensureAppInitialized();

    const refs = getDomRefs();
    container = refs.container;
    unreadBadge = refs.unreadBadge;
    loadingState = refs.loadingState;
    emptyState = refs.emptyState;
    errorState = refs.errorState;
    searchInput = refs.searchInput;
    clearSearch = refs.clearSearch;
    filterBtns = refs.filterBtns;
    sortSelect = refs.sortSelect;
    chips = refs.chips;
    stats = refs.stats;

    showLoading();

    try {
        const user = app.getUser();
        if (!user) {
            showEmpty('Please log in to view notifications');
            return;
        }

        // 1. Load from IndexedDB immediately (fast)
        let localNotifs = await db.getNotifications(user._id, { limit: 50 });
        if (localNotifs && localNotifs.length > 0) {
            notifications = localNotifs.map(mapBackendToFrontend);
            isLoaded = true;
            applyFilters();
            render();
            updateStats();
            updateBadge();
            hideAllStates();
        }

        // 2. Fetch from backend only if allowed by cooldown (or forced)
        if (navigator.onLine && (force || isNotificationFetchAllowed())) {
            const token = getToken();
            if (token) {
                const result = await convexHttpClient.action("notifications/queries:getNotifications", {
                    token,
                    limit: 50,
                });
                if (result.success && result.data && result.data.notifications) {
                    const serverNotifs = result.data.notifications;
                    for (const notif of serverNotifs) {
                        const frontendNotif = mapBackendToFrontend(notif);
                        await db.saveNotification(frontendNotif);
                    }
                    localNotifs = await db.getNotifications(user._id, { limit: 50 });
                    notifications = localNotifs.map(mapBackendToFrontend);
                    isLoaded = true;
                    applyFilters();
                    render();
                    updateStats();
                    updateBadge();
                    hideAllStates();
                    // Update timer
                    setLastNotificationFetch(Date.now());
                }
            }
        } else if (!force) {
            console.log('[Notifications] Cooldown active – using cached data.');
        }

        if (!isLoaded) {
            showEmpty('No notifications found.');
        }
    } catch (err) {
        console.error('[Notifications] Load error:', err);
        showError();
    }
}

// ==================== POLLING FOR NEW NOTIFICATIONS ====================

export function startPolling() {
    if (pollingInterval) {
        clearInterval(pollingInterval);
        pollingInterval = null;
    }

    const user = app.getUser();
    if (!user || !navigator.onLine) {
        console.log('[Notifications] Not starting polling: offline or no user');
        return;
    }

    const token = getToken();
    if (!token) {
        console.log('[Notifications] No token, cannot poll');
        return;
    }

    console.log('[Notifications] Starting polling (every 30s, but cooldown 3h)');

    pollingInterval = setInterval(async () => {
        try {
            const userNow = app.getUser();
            if (!userNow || !navigator.onLine) {
                stopPolling();
                return;
            }
            const tokenNow = getToken();
            if (!tokenNow) {
                stopPolling();
                return;
            }

            // Only fetch if cooldown has passed
            if (!isNotificationFetchAllowed()) {
                // Cooldown active – skip backend call
                return;
            }

            // Get the latest timestamp from the most recent notification we have
            const lastTimestamp = notifications.length > 0
                ? Math.max(...notifications.map(n => n.timestamp))
                : 0;

            const result = await convexHttpClient.action("notifications/queries:getNotificationsSince", {
                token: tokenNow,
                userId: userNow._id,
                since: lastTimestamp || 0,
                limit: 20,
            });

            if (result.success && result.data && result.data.length > 0) {
                // New notifications arrived
                const newNotifs = result.data;
                handleNewNotifications(newNotifs);
                // Update timer
                setLastNotificationFetch(Date.now());
            }
        } catch (err) {
            console.warn('[Notifications] Polling error:', err);
        }
    }, 30000); // every 30 seconds
}

export function stopPolling() {
    if (pollingInterval) {
        clearInterval(pollingInterval);
        pollingInterval = null;
        console.log('[Notifications] Polling stopped.');
    }
}

// ==================== HANDLE NEW NOTIFICATIONS ====================

function handleNewNotifications(newNotifs) {
    if (!newNotifs || newNotifs.length === 0) return;

    const latest = newNotifs[newNotifs.length - 1];
    showNotificationToast(latest);

    addNotifications(newNotifs);
    updateBadge();
    app.events.emit('new-notification', { notifications: newNotifs });
}

function showNotificationToast(notif) {
    if (!notif) return;
    if (!app.getAppSetting('notifications')) return;

    if (app.getAppSetting('sound')) {
        try {
            const audio = new Audio('/assets/sounds/notification.mp3');
            audio.play().catch(() => {});
        } catch (e) { /* ignore */ }
    }

    const message = `${notif.title}: ${notif.message || ''}`;
    if (ui && typeof ui.showToast === 'function') {
        ui.showToast(message, 'info', 5000);
    } else {
        console.log('[Notification]', message);
    }
}

// ==================== ADD NEW NOTIFICATIONS ====================

export function addNotifications(newNotifs) {
    if (!newNotifs || newNotifs.length === 0) return;

    const user = app.getUser();
    if (!user) return;

    newNotifs.forEach(async (notif) => {
        if (!notif.userId) notif.userId = user._id;
        const frontendNotif = notif._id ? mapBackendToFrontend(notif) : notif;
        await db.saveNotification(frontendNotif).catch(() => {});
    });

    db.getNotifications(user._id, { limit: 50 }).then(localNotifs => {
        if (localNotifs && localNotifs.length > 0) {
            notifications = localNotifs.map(mapBackendToFrontend);
            isLoaded = true;
            applyFilters();
            render();
            updateStats();
            updateBadge();
            hideAllStates();
        }
    }).catch(() => {});
}

export function getUnreadCount() {
    return notifications.filter(n => !n.read).length;
}

// ==================== RENDER ====================

export function render() {
    if (!isLoaded) return;
    if (!container) {
        const refs = getDomRefs();
        container = refs.container;
    }
    if (!container) return;

    container.innerHTML = '';
    
    if (filteredNotifications.length === 0) {
        if (searchQuery || currentFilter !== 'all' || currentCategory !== 'all') {
            const empty = document.createElement('div');
            empty.className = 'state-message empty';
            empty.innerHTML = `
                <div class="empty-icon">🔍</div>
                <h3>No matching notifications</h3>
                <p>Try adjusting your filters or search terms.</p>
                <button onclick="window.notifications?.resetFilters()" class="btn-secondary">Reset Filters</button>
            `;
            container.appendChild(empty);
        } else {
            if (emptyState) emptyState.style.display = 'block';
        }
        return;
    }
    
    const groups = groupNotifications(filteredNotifications);
    
    for (const [label, items] of Object.entries(groups)) {
        const groupDiv = document.createElement('div');
        groupDiv.className = 'notification-group';
        const header = document.createElement('div');
        header.className = 'group-header';
        header.textContent = label;
        groupDiv.appendChild(header);
        
        items.forEach(notif => {
            const card = createCard(notif);
            groupDiv.appendChild(card);
        });
        container.appendChild(groupDiv);
    }
}

function groupNotifications(items) {
    const groups = {};
    const today = new Date().toDateString();
    const yesterday = new Date(Date.now() - 86400000).toDateString();
    
    items.forEach(notif => {
        const date = new Date(notif.timestamp);
        const dateStr = date.toDateString();
        let label;
        if (dateStr === today) label = 'Today';
        else if (dateStr === yesterday) label = 'Yesterday';
        else if (date.getFullYear() === new Date().getFullYear()) {
            label = date.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
        } else {
            label = date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
        }
        if (!groups[label]) groups[label] = [];
        groups[label].push(notif);
    });
    return groups;
}

function createCard(notif) {
    const template = document.getElementById('notificationCardTemplate');
    if (!template) {
        const div = document.createElement('div');
        div.className = 'notif-card';
        div.dataset.id = notif.id;
        div.innerHTML = `
            <div class="card-header">
                <div class="card-icon">${notif.icon || '📩'}</div>
                <div class="card-title-area">
                    <div class="card-title">${notif.title || ''}</div>
                    <div class="card-subtitle">${notif.subtitle || ''}</div>
                </div>
            </div>
            <div class="card-body">${notif.body || ''}</div>
            <div class="card-footer">
                <span class="card-time">${utils.formatDate(notif.timestamp, 'full')}</span>
            </div>
        `;
        return div;
    }

    const card = template.content.cloneNode(true).firstElementChild;
    card.dataset.id = notif.id;
    
    if (!notif.read) card.classList.add('unread');
    if (notif.pinned) card.classList.add('pinned');
    if (notif.priority === 'critical') card.classList.add('critical');
    
    const icon = card.querySelector('.card-icon');
    icon.textContent = notif.icon || '📩';
    
    card.querySelector('.card-title').textContent = notif.title;
    card.querySelector('.card-subtitle').textContent = notif.subtitle || '';
    
    const body = card.querySelector('.card-body');
    body.textContent = notif.body || '';
    if (notif.body && notif.body.length > 100) {
        body.classList.add('collapsible');
        const showMore = document.createElement('span');
        showMore.className = 'more';
        showMore.textContent = '... Show more';
        body.appendChild(showMore);
        showMore.addEventListener('click', (e) => {
            e.stopPropagation();
            body.classList.toggle('expanded');
            showMore.textContent = body.classList.contains('expanded') ? ' Show less' : '... Show more';
        });
    }
    
    const mediaContainer = card.querySelector('.card-media');
    if (notif.media) {
        if (notif.media.type === 'image') {
            const img = document.createElement('img');
            img.src = notif.media.url;
            img.alt = notif.media.alt || '';
            mediaContainer.appendChild(img);
        } else if (notif.media.type === 'video') {
            const video = document.createElement('video');
            video.src = notif.media.url;
            video.controls = true;
            mediaContainer.appendChild(video);
        }
    }
    
    const progressContainer = card.querySelector('.card-progress');
    if (notif.progress) {
        const progress = document.createElement('progress');
        progress.value = notif.progress.value;
        progress.max = notif.progress.max || 100;
        progressContainer.appendChild(progress);
    } else {
        progressContainer.style.display = 'none';
    }
    
    const btnContainer = card.querySelector('.card-buttons');
    if (notif.actions && notif.actions.length) {
        notif.actions.forEach(action => {
            const btn = document.createElement('button');
            btn.textContent = action.label;
            if (action.primary) btn.classList.add('primary');
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                handleAction(action, notif);
            });
            btnContainer.appendChild(btn);
        });
    } else {
        btnContainer.style.display = 'none';
    }
    
    const timeEl = card.querySelector('.card-time');
    timeEl.textContent = utils.formatDate(notif.timestamp, 'full');
    
    const priorityEl = card.querySelector('.card-priority');
    priorityEl.textContent = notif.priority || 'normal';
    priorityEl.className = `card-priority priority-${notif.priority || 'normal'}`;
    
    card.querySelector('.pin-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        togglePin(notif.id);
    });
    card.querySelector('.archive-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        toggleArchive(notif.id);
    });
    card.querySelector('.delete-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        deleteNotification(notif.id);
    });
    
    card.addEventListener('click', () => {
        if (!notif.read) markRead(notif.id);
    });
    
    return card;
}

// ==================== ACTIONS ====================

function handleAction(action, notif) {
    console.log('[Notification Action]', action.action, action.data);
    
    switch (action.action) {
        case 'openExam':
            router.navigateTo('results.html', { examId: action.data.examId });
            break;
        case 'joinChallenge':
            router.navigateTo('exam-settings.html', { challengeId: action.data.challengeId });
            break;
        case 'renewSubscription':
            router.navigateTo('subscription.html');
            break;
        case 'openAI':
            router.navigateTo('ai.html');
            break;
        case 'shareAchievement':
            if (navigator.share) {
                navigator.share({
                    title: 'MedHub Achievement',
                    text: `I unlocked "${notif.title}" on MedHub!`
                });
            } else {
                ui.showToast('Share not supported', 'warning');
            }
            break;
        case 'dismiss':
            deleteNotification(notif.id);
            break;
        default:
            ui.showToast(`Action: ${action.action}`, 'info');
    }
    if (!notif.read) markRead(notif.id);
}

// ==================== CRUD ====================

export async function markRead(id) {
    const notif = notifications.find(n => n.id === id);
    if (!notif) return;
    notif.read = true;
    try {
        const token = getToken();
        if (token) {
            await convexHttpClient.mutation("notifications/mutations:markNotificationRead", {
                token,
                notificationId: id,
            });
        }
    } catch (err) {
        console.warn('[Notifications] Mark read network error', err);
    }
    await db.markNotificationRead(id).catch(() => {});
    applyFilters();
    render();
    updateStats();
    updateBadge();
}

export async function markAllRead() {
    const user = app.getUser();
    if (!user) return;
    notifications.forEach(n => n.read = true);
    try {
        const token = getToken();
        if (token) {
            await convexHttpClient.mutation("notifications/mutations:markAllNotificationsRead", {
                token,
            });
        }
    } catch (err) {
        console.warn('[Notifications] Mark all read network error', err);
    }
    await db.markAllNotificationsRead(user._id).catch(() => {});
    applyFilters();
    render();
    updateStats();
    updateBadge();
    ui.showToast('All notifications marked as read', 'success');
}

export function togglePin(id) {
    const notif = notifications.find(n => n.id === id);
    if (notif) {
        notif.pinned = !notif.pinned;
        db.updateNotification(id, { pinned: notif.pinned }).catch(() => {});
        applyFilters();
        render();
        updateStats();
    }
}

export function toggleArchive(id) {
    const notif = notifications.find(n => n.id === id);
    if (notif) {
        notif.archived = !notif.archived;
        db.updateNotification(id, { archived: notif.archived }).catch(() => {});
        applyFilters();
        render();
        updateStats();
    }
}

export function deleteNotification(id) {
    notifications = notifications.filter(n => n.id !== id);
    db.deleteNotification(id).catch(() => {});
    applyFilters();
    render();
    updateStats();
    updateBadge();
}

// ==================== FILTERS & SEARCH ====================

export function applyFilters() {
    let filtered = [...notifications];
    
    if (currentCategory !== 'all') {
        filtered = filtered.filter(n => n.category === currentCategory);
    }
    
    if (currentFilter === 'unread') {
        filtered = filtered.filter(n => !n.read);
    } else if (currentFilter === 'pinned') {
        filtered = filtered.filter(n => n.pinned);
    } else if (currentFilter === 'archived') {
        filtered = filtered.filter(n => n.archived);
    } else if (currentFilter === 'important') {
        filtered = filtered.filter(n => n.important);
    }
    
    if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        filtered = filtered.filter(n =>
            n.title.toLowerCase().includes(q) ||
            (n.body && n.body.toLowerCase().includes(q)) ||
            (n.subtitle && n.subtitle.toLowerCase().includes(q)) ||
            n.category.includes(q)
        );
    }
    
    if (currentSort === 'newest') {
        filtered.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    } else if (currentSort === 'oldest') {
        filtered.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    } else if (currentSort === 'priority') {
        const order = { critical: 0, high: 1, normal: 2, low: 3, silent: 4 };
        filtered.sort((a, b) => (order[a.priority] || 2) - (order[b.priority] || 2));
    }
    
    filtered.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
    
    filteredNotifications = filtered;
}

export function setFilter(filter) {
    currentFilter = filter;
    filterBtns.forEach(btn => {
        btn.classList.toggle('active', btn.dataset.filter === filter);
    });
    applyFilters();
    render();
}

export function setCategory(category) {
    currentCategory = category;
    chips.forEach(chip => {
        chip.classList.toggle('active', chip.dataset.category === category);
    });
    applyFilters();
    render();
}

export function setSort(sort) {
    currentSort = sort;
    applyFilters();
    render();
}

export function setSearch(query) {
    searchQuery = query;
    clearSearch.classList.toggle('visible', query.length > 0);
    applyFilters();
    render();
}

export function resetFilters() {
    currentFilter = 'all';
    currentCategory = 'all';
    searchQuery = '';
    searchInput.value = '';
    clearSearch.classList.remove('visible');
    filterBtns.forEach(btn => btn.classList.remove('active'));
    document.querySelector('.filter-btn[data-filter="all"]').classList.add('active');
    chips.forEach(chip => chip.classList.remove('active'));
    document.querySelector('.chip[data-category="all"]').classList.add('active');
    applyFilters();
    render();
}

// ==================== STATISTICS ====================

function updateStats() {
    if (!stats) {
        const refs = getDomRefs();
        stats = refs.stats;
    }
    if (!stats) return;

    const total = notifications.length;
    const unread = notifications.filter(n => !n.read).length;
    const read = notifications.filter(n => n.read && !n.archived).length;
    const pinned = notifications.filter(n => n.pinned).length;
    const archived = notifications.filter(n => n.archived).length;
    const critical = notifications.filter(n => n.priority === 'critical').length;
    const today = notifications.filter(n => {
        const d = new Date(n.timestamp);
        return d.toDateString() === new Date().toDateString();
    }).length;
    
    if (stats.unread) stats.unread.textContent = unread;
    if (stats.read) stats.read.textContent = read;
    if (stats.pinned) stats.pinned.textContent = pinned;
    if (stats.archived) stats.archived.textContent = archived;
    if (stats.critical) stats.critical.textContent = critical;
    if (stats.today) stats.today.textContent = today;
}

function updateBadge() {
    if (!unreadBadge) {
        const refs = getDomRefs();
        unreadBadge = refs.unreadBadge;
    }
    if (!unreadBadge) return;

    const unread = notifications.filter(n => !n.read).length;
    unreadBadge.textContent = unread;
    unreadBadge.style.display = unread > 0 ? 'inline' : 'none';
}

// ==================== UI STATES ====================

function showLoading() {
    if (loadingState) loadingState.style.display = 'block';
    if (emptyState) emptyState.style.display = 'none';
    if (errorState) errorState.style.display = 'none';
    if (container) container.innerHTML = '';
}

function showError() {
    if (loadingState) loadingState.style.display = 'none';
    if (emptyState) emptyState.style.display = 'none';
    if (errorState) errorState.style.display = 'block';
}

function showEmpty(message = 'No notifications found.') {
    if (loadingState) loadingState.style.display = 'none';
    if (emptyState) {
        emptyState.style.display = 'block';
        const p = emptyState.querySelector('p');
        if (p) p.textContent = message;
    }
    if (errorState) errorState.style.display = 'none';
}

function hideAllStates() {
    if (loadingState) loadingState.style.display = 'none';
    if (emptyState) emptyState.style.display = 'none';
    if (errorState) errorState.style.display = 'none';
}

// ==================== HELP ====================

export function openHelp() {
    const overlay = document.getElementById('helpOverlay');
    if (!overlay) return;
    overlay.style.display = 'flex';
    import('./help.js').then(module => {
        module.renderHelp(overlay);
    }).catch(() => {
        ui.showToast('Help module not available', 'warning');
    });
}

// ==================== INITIALIZATION ====================

export function init() {
    if (isInitialized) return;
    isInitialized = true;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', setupEventListeners);
    } else {
        setupEventListeners();
    }
}

async function setupEventListeners() {
    const refs = getDomRefs();
    container = refs.container;
    unreadBadge = refs.unreadBadge;
    loadingState = refs.loadingState;
    emptyState = refs.emptyState;
    errorState = refs.errorState;
    searchInput = refs.searchInput;
    clearSearch = refs.clearSearch;
    filterBtns = refs.filterBtns;
    sortSelect = refs.sortSelect;
    chips = refs.chips;
    stats = refs.stats;

    if (filterBtns && filterBtns.length > 0) {
        filterBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                setFilter(btn.dataset.filter);
            });
        });
    }
    
    if (sortSelect) {
        sortSelect.addEventListener('change', () => {
            setSort(sortSelect.value);
        });
    }
    
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            setSearch(e.target.value);
        });
    }
    if (clearSearch) {
        clearSearch.addEventListener('click', () => {
            searchInput.value = '';
            setSearch('');
        });
    }
    
    if (chips && chips.length > 0) {
        chips.forEach(chip => {
            chip.addEventListener('click', () => {
                setCategory(chip.dataset.category);
            });
        });
    }
    
    document.addEventListener('keydown', (e) => {
        if (e.key === '/' && e.ctrlKey) {
            e.preventDefault();
            if (searchInput) searchInput.focus();
        }
        if (e.key === 'Escape') {
            if (searchInput) searchInput.blur();
            const helpOverlay = document.getElementById('helpOverlay');
            if (helpOverlay && helpOverlay.style.display === 'flex') {
                helpOverlay.style.display = 'none';
            }
        }
    });
    
    app.events.on('new-notification', (data) => {
        if (data && data.notifications) {
            addNotifications(data.notifications);
        }
    });

    await ensureAppInitialized();

    if (app.getUser()) {
        // Initial load respects cooldown
        loadNotifications(false);
        startPolling();
    } else {
        const checkUser = setInterval(async () => {
            if (app.getUser()) {
                clearInterval(checkUser);
                await loadNotifications(false);
                startPolling();
            }
        }, 500);
        setTimeout(() => clearInterval(checkUser), 10000);
    }
}

// ==================== EXPOSE GLOBALLY ====================

window.notifications = {
    load: loadNotifications,
    render,
    markRead,
    markAllRead,
    togglePin,
    toggleArchive,
    deleteNotification,
    setFilter,
    setCategory,
    setSort,
    setSearch,
    resetFilters,
    openHelp,
    refresh: () => loadNotifications(true), // force refresh
    init,
    addNotifications,
    getUnreadCount,
    startPolling,
    stopPolling
};

// ==================== AUTO-INIT ====================

if (document.readyState === 'complete') {
    init();
} else {
    document.addEventListener('DOMContentLoaded', init);
}

export default {
    loadNotifications,
    render,
    markRead,
    markAllRead,
    togglePin,
    toggleArchive,
    deleteNotification,
    applyFilters,
    setFilter,
    setCategory,
    setSort,
    setSearch,
    resetFilters,
    openHelp,
    init,
    addNotifications,
    getUnreadCount,
    startPolling,
    stopPolling
};
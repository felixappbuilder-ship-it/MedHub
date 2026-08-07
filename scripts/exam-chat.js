// exam-chat.js – Real-time chat & participant tracking for shared revision rooms
// All backend communication is centralised here. The HTML only calls these exports.

import { convexHttpClient } from './convex-client.js';
import { getToken } from './auth.js';

const CHAT_POLL_INTERVAL = 30000;      // 30 seconds
const PARTICIPANT_POLL_INTERVAL = 120000; // 1 minute

// ── Internal state ──
const state = {
    roomId: null,
    messages: [],
    lastChatFetch: 0,
    chatTimer: null,
    participantTimer: null,
    onChatUpdate: null,
    onParticipantUpdate: null,
};

/**
 * Start the full chat session (messages + participants).
 * @param {string} roomId – challenge code or room identifier
 * @param {object} callbacks – { onChatUpdate(messages), onParticipantUpdate({count, creator, onlineUsers}) }
 */
export function initChat(roomId, callbacks = {}) {
    stopChat();
    state.roomId = roomId;
    state.onChatUpdate = callbacks.onChatUpdate || null;
    state.onParticipantUpdate = callbacks.onParticipantUpdate || null;

    state.messages = [];
    state.lastChatFetch = Date.now();

    fetchMessages();
    fetchParticipants();

    state.chatTimer = setInterval(fetchMessages, CHAT_POLL_INTERVAL);
    state.participantTimer = setInterval(fetchParticipants, PARTICIPANT_POLL_INTERVAL);
}

export function stopChat() {
    if (state.chatTimer) { clearInterval(state.chatTimer); state.chatTimer = null; }
    if (state.participantTimer) { clearInterval(state.participantTimer); state.participantTimer = null; }
    state.roomId = null;
    state.messages = [];
    state.lastChatFetch = 0;
}

// ── Deduplication helper ──
function isDuplicate(newMsg, existingMsgs) {
    return existingMsgs.some(m => 
        m.body === newMsg.body &&
        Math.abs(m.timestamp - newMsg.timestamp) < 5000 // within 5 seconds
    );
}

// ── Messages ──
async function fetchMessages() {
    if (!state.roomId) return;
    try {
        const token = getToken();
        if (!token) {
            console.warn('[exam-chat] No token, skipping message fetch');
            return;
        }
        const result = await convexHttpClient.action('challenges/actions:getMessages', {
            token,
            challengeCode: state.roomId,
            since: state.lastChatFetch || 0
        });
        if (result.success && result.messages && result.messages.length > 0) {
            // Deduplicate incoming messages against current local state
            const newUnique = result.messages.filter(m => !isDuplicate(m, state.messages));
            if (newUnique.length > 0) {
                state.messages = [...state.messages, ...newUnique];
                state.messages.sort((a, b) => a.timestamp - b.timestamp);
                state.lastChatFetch = Date.now();
                if (state.onChatUpdate) state.onChatUpdate([...state.messages]);
            }
        } else if (!result.success) {
            console.warn('[exam-chat] getMessages error:', result.message);
        }
    } catch (e) {
        console.error('[exam-chat] fetchMessages error:', e);
    }
}

export async function sendMessage(text) {
    if (!state.roomId || !text?.trim()) return false;
    try {
        const token = getToken();
        if (!token) {
            console.warn('[exam-chat] No token, cannot send message');
            return false;
        }
        const result = await convexHttpClient.action('challenges/actions:sendMessage', {
            token,
            challengeCode: state.roomId,
            body: text.trim()
        });
        if (result.success) {
            // Optimistically add local message with 'You' as author
            const localMsg = { author: 'You', body: text.trim(), timestamp: Date.now() };
            state.messages.push(localMsg);
            if (state.onChatUpdate) state.onChatUpdate([...state.messages]);
            return true;
        } else {
            console.warn('[exam-chat] sendMessage failed:', result.message);
            return false;
        }
    } catch (e) {
        console.error('[exam-chat] sendMessage error:', e);
        return false;
    }
}

export function getMessages() {
    return [...state.messages];
}

// ── Participants ──
async function fetchParticipants() {
    if (!state.roomId) return;
    try {
        const token = getToken();
        if (!token) {
            console.warn('[exam-chat] No token, skipping participant fetch');
            return;
        }
        const result = await convexHttpClient.action('challenges/actions:getRoomParticipants', {
            token,
            challengeCode: state.roomId
        });
        if (result.success) {
            const data = {
                count: result.count || 0,
                creator: result.creator || 'Unknown',
                onlineUsers: result.onlineUsers || []
            };
            state._lastParticipantData = data;
            if (state.onParticipantUpdate) state.onParticipantUpdate(data);
        } else {
            console.warn('[exam-chat] getRoomParticipants error:', result.message);
        }
    } catch (e) {
        console.error('[exam-chat] fetchParticipants error:', e);
    }
}

export async function refreshParticipants() {
    await fetchParticipants();
}

export function getLastParticipantData() {
    return state._lastParticipantData || null;
}

// ── Cleanup on page unload ──
if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', () => {
        stopChat();
    });
    window.addEventListener('auth:logout', () => {
        stopChat();
    });
}
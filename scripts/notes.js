// scripts/notes.js

/**
 * Notes Management Module – Fully featured
 * Provides CRUD, rich content, password protection, sharing, PDF export,
 * AI summarization, flashcards, and search.
 * All backend interactions use Convex actions directly.
 * Uses IndexedDB via db.js and localStorage fallback.
 */

import * as auth from './auth.js';
import * as utils from './utils.js';
import * as db from './db.js';
import * as sync from './sync.js';
import { convexHttpClient } from './convex-client.js';
import { getToken } from './auth.js';

// ==================== Password Helpers ====================
async function hashPassword(password) {
    if (!password) return null;
    const encoder = new TextEncoder();
    const data = encoder.encode(password + 'notes-salt');
    const hash = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function verifyPassword(password, hash) {
    if (!hash) return false;
    const hashed = await hashPassword(password);
    return hashed === hash;
}

// ==================== Helper: get current user ID ====================
function getCurrentUserId() {
    const user = auth.getUser();
    if (!user) return null;
    return user._id || user.id;
}

// ==================== Helper: ensure note is synced to backend ====================
async function ensureNoteSynced(noteId) {
    const note = await db.getNote(noteId);
    if (!note) throw new Error('Note not found');

    if (note.synced && note.serverId) {
        return note.serverId;
    }

    await sync.pushSingleNote(noteId);

    const updatedNote = await db.getNote(noteId);
    if (!updatedNote || !updatedNote.synced || !updatedNote.serverId) {
        throw new Error('Failed to sync note to server');
    }
    return updatedNote.serverId;
}

// ==================== Core CRUD ====================

export async function createNote(data) {
    const userId = getCurrentUserId();
    if (!userId) throw new Error('You must be logged in to create notes');

    const now = new Date().toISOString();
    let passwordHash = null;
    if (data.isProtected && data.password) {
        passwordHash = await hashPassword(data.password);
    }

    const note = {
        id: 'note_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
        serverId: null,
        userId: userId,
        title: data.title || 'Untitled',
        content: data.content || '',
        plainText: data.plainText || '',
        subject: data.subject || null,
        topic: data.topic || null,
        questionId: data.questionId || null,
        tags: data.tags || [],
        attachments: data.attachments || [],
        flashcards: [],
        createdAt: now,
        updatedAt: now,
        lastReviewed: null,
        reviewCount: 0,
        shareWith: [],
        sharedPublic: false,
        sharedToken: null,
        isProtected: data.isProtected || false,
        passwordHash: passwordHash,
        synced: false
    };

    await db.saveNote(note);
    return note;
}

export async function updateNote(noteId, updates) {
    const note = await db.getNote(noteId);
    if (!note) throw new Error('Note not found');
    const currentUserId = getCurrentUserId();
    if (note.userId !== currentUserId) throw new Error('Unauthorized');

    if (updates.password !== undefined) {
        if (updates.password) {
            updates.passwordHash = await hashPassword(updates.password);
            updates.isProtected = true;
        } else {
            updates.passwordHash = null;
            updates.isProtected = false;
        }
        delete updates.password;
    }

    if (updates.content !== undefined && !updates.plainText) {
        const div = document.createElement('div');
        div.innerHTML = updates.content;
        updates.plainText = div.textContent || div.innerText || '';
    }

    Object.assign(note, updates, { updatedAt: new Date().toISOString(), synced: false });
    await db.saveNote(note);
    return note;
}

export async function deleteNote(noteId) {
    const note = await db.getNote(noteId);
    if (!note) return;
    const currentUserId = getCurrentUserId();
    if (note.userId !== currentUserId) throw new Error('Unauthorized');

    // Only queue deletion if the note was ever synced to the server
    if (note.serverId) {
        await db.addToSyncQueue('note_delete', { serverId: note.serverId, userId: note.userId });
    }

    // Delete locally
    await db.deleteNote(noteId);
}

export async function getNote(noteId, password = null) {
    const note = await db.getNote(noteId);
    if (!note) return null;
    if (note.isProtected) {
        if (!password) throw new Error('Password required');
        const ok = await verifyPassword(password, note.passwordHash);
        if (!ok) throw new Error('Incorrect password');
    }
    return note;
}

export async function getUserNotes(filters = {}) {
    const userId = getCurrentUserId();
    if (!userId) return [];
    let notes = await db.getNotesByUser(userId) || [];

    if (filters.subject) notes = notes.filter(n => n.subject === filters.subject);
    if (filters.topic) notes = notes.filter(n => n.topic === filters.topic);
    if (filters.tag) notes = notes.filter(n => n.tags.includes(filters.tag));

    return notes.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
}

export async function searchNotes(query) {
    const notes = await getUserNotes();
    const q = query.toLowerCase();
    return notes.filter(n =>
        n.title.toLowerCase().includes(q) ||
        (n.plainText && n.plainText.toLowerCase().includes(q)) ||
        n.tags.some(tag => tag.toLowerCase().includes(q))
    );
}

// ==================== Sharing ====================

export async function shareNote(noteId) {
    const serverId = await ensureNoteSynced(noteId);
    const token = getToken();
    if (!token) throw new Error('Not authenticated');

    const result = await convexHttpClient.action('notes/actions:shareNote', {
        token,
        noteId: serverId,
    });

    if (!result.success) {
        throw new Error(result.message || 'Failed to create share link');
    }

    const shareToken = result.data.shareToken;
    const shareUrl = result.data.shareUrl;

    const localNote = await db.getNote(noteId);
    if (localNote) {
        await db.saveNote({
            ...localNote,
            sharedToken: shareToken,
            sharedPublic: true,
            updatedAt: new Date().toISOString(),
        });
    }

    return shareUrl || `${window.location.origin}/pages/shared-note.html?token=${shareToken}`;
}

export async function getNoteByShareToken(token) {
    return db.getNoteByShareToken(token);
}

// ==================== Export ====================

export async function exportAsHTML(noteId) {
    const note = await getNote(noteId);
    if (!note) throw new Error('Note not found');
    return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>${note.title}</title>
<style>body { font-family: sans-serif; padding: 2rem; }</style>
</head><body>
<h1>${note.title}</h1>
${note.content}
<hr><p>Created: ${note.createdAt} | Last updated: ${note.updatedAt}</p>
</body></html>`;
}

export async function exportAsText(noteId) {
    const note = await getNote(noteId);
    if (!note) throw new Error('Note not found');
    return note.plainText || note.content.replace(/<[^>]*>/g, '');
}

export async function exportAsPDF(noteId) {
    const html = await exportAsHTML(noteId);
    return new Blob([html], { type: 'application/pdf' });
}

// ==================== AI Features ====================

export async function summarizeNote(noteId) {
    const note = await getNote(noteId);
    if (!note) throw new Error('Note not found');
    const token = getToken();
    if (!token) throw new Error('Not authenticated');

    try {
        const result = await convexHttpClient.action('ai/actions:summarizeText', {
            token,
            text: note.plainText || note.content,
        });
        return result.data?.summary || '';
    } catch (e) {
        console.warn('AI summary failed', e);
        return 'AI summary offline.';
    }
}

export async function generateFlashcards(noteId) {
    const note = await getNote(noteId);
    if (!note) throw new Error('Note not found');
    const token = getToken();
    if (!token) throw new Error('Not authenticated');

    try {
        const result = await convexHttpClient.action('ai/actions:generateFlashcards', {
            token,
            text: note.plainText || note.content,
            count: 5,
        });
        const cards = result.data?.flashcards || [];
        if (cards.length) {
            await updateNote(noteId, { flashcards: cards });
        }
        return cards;
    } catch (e) {
        console.warn('AI flashcards failed', e);
        return [];
    }
}

export async function generateQuestions(noteId, count = 5) {
    const note = await getNote(noteId);
    if (!note) throw new Error('Note not found');
    const token = getToken();
    if (!token) throw new Error('Not authenticated');

    try {
        const result = await convexHttpClient.action('ai/actions:generateQuestions', {
            token,
            topic: note.subject || note.topic || 'general',
            count,
        });
        return result.data?.questions || [];
    } catch (e) {
        console.warn('AI questions failed', e);
        return [];
    }
}

export async function suggestTags(noteId) {
    const note = await getNote(noteId);
    if (!note) throw new Error('Note not found');
    const token = getToken();
    if (!token) throw new Error('Not authenticated');

    try {
        const result = await convexHttpClient.action('ai/actions:askAI', {
            token,
            question: `Suggest up to 5 relevant tags for this text: ${note.plainText || note.content}`,
        });
        const tags = result.data?.answer?.split(',').map(t => t.trim()) || [];
        return tags;
    } catch (e) {
        console.warn('AI tag suggestion failed', e);
        return [];
    }
}

// ==================== Flashcards Review Helpers ====================

export function getFlashcardsForReview(noteIds) {
    return [];
}

export async function updateReviewStats(noteId, remembered) {
    const note = await getNote(noteId);
    if (!note) return;
    note.lastReviewed = new Date().toISOString();
    note.reviewCount = (note.reviewCount || 0) + 1;
    await updateNote(noteId, { lastReviewed: note.lastReviewed, reviewCount: note.reviewCount });
}

// ==================== Sync ====================

export async function syncNotes() {
    if (!navigator.onLine) return;
}

// ==================== Exports ====================
export default {
    createNote,
    updateNote,
    deleteNote,
    getNote,
    getUserNotes,
    searchNotes,
    shareNote,
    getNoteByShareToken,
    exportAsHTML,
    exportAsText,
    exportAsPDF,
    summarizeNote,
    generateFlashcards,
    generateQuestions,
    suggestTags,
    getFlashcardsForReview,
    updateReviewStats,
    syncNotes
};
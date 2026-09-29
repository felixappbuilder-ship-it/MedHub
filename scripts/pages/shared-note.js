// scripts/pages/shared-note.js
import * as ui from '../ui.js';
import * as utils from '../utils.js';
import * as db from '../db.js';
import * as auth from '../auth.js';
import * as notes from '../notes.js';
import * as router from '../router.js';

let $;

export async function init(context) {
  $ = (sel) => context.root.querySelector(sel);

  ui.applyTheme();

  // Navigation links (clean URLs)
  const subjectsNav = $('#subjectsNav');
  if (subjectsNav) {
    subjectsNav.addEventListener('click', (e) => {
      e.preventDefault();
      router.navigateTo('subjects');
    });
  }
  const performanceNav = $('#performanceNav');
  if (performanceNav) {
    performanceNav.addEventListener('click', (e) => {
      e.preventDefault();
      router.navigateTo('performance');
    });
  }
  const aiNav = $('#aiNav');
  if (aiNav) {
    aiNav.addEventListener('click', (e) => {
      e.preventDefault();
      router.navigateTo('ai');
    });
  }
  const notesNav = $('#notesNav');
  if (notesNav) {
    notesNav.addEventListener('click', (e) => {
      e.preventDefault();
      router.navigateTo('notes');
    });
  }

  // Theme toggle
  const themeToggle = $('#themeToggle');
  if (themeToggle) {
    themeToggle.addEventListener('click', ui.toggleTheme);
  }

  // Get token from URL
  const urlParams = new URLSearchParams(window.location.search);
  const token = urlParams.get('token');

  const container = $('#shared-note-container');

  if (!token) {
    container.innerHTML = '<div class="error">No share token provided.</div>';
    return;
  }

  try {
    const note = await db.getNoteByShareToken(token);
    if (!note) {
      container.innerHTML = '<div class="error">Note not found or link has expired.</div>';
      return;
    }

    const created = utils.formatDate(note.createdAt, 'full');
    const isLoggedIn = auth.checkAuth();

    let html = `
      <div class="note-card">
        <h1>${note.title || 'Untitled'}</h1>
        <div class="note-meta">
          <span>Created: ${created}</span>
          ${note.tags && note.tags.length ? `<span>Tags: ${note.tags.join(', ')}</span>` : ''}
        </div>
        <div class="note-content">${note.content}</div>
        <div class="note-actions">
          <button id="copyLinkBtn" class="btn-secondary">🔗 Copy Link</button>
    `;

    if (isLoggedIn) {
      html += `<button id="saveCopyBtn" class="btn-primary">📋 Save to My Notes</button>`;
    }

    html += `
        </div>
      </div>
    `;
    container.innerHTML = html;

    // Copy link button
    const copyLinkBtn = $('#copyLinkBtn');
    if (copyLinkBtn) {
      copyLinkBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(window.location.href).then(() => {
          ui.showToast('Link copied!', 'success');
        }).catch(() => {
          prompt('Copy this link:', window.location.href);
        });
      });
    }

    // Save copy button
    const saveCopyBtn = $('#saveCopyBtn');
    if (saveCopyBtn) {
      saveCopyBtn.addEventListener('click', async () => {
        if (!auth.checkAuth()) {
          ui.showToast('You must be logged in', 'error');
          return;
        }
        try {
          await notes.createNote({
            title: note.title + ' (shared copy)',
            content: note.content,
            plainText: note.plainText || '',
            subject: note.subject,
            topic: note.topic,
            tags: note.tags
          });
          ui.showToast('Note saved to your collection!', 'success');
        } catch (err) {
          ui.showToast('Failed to save note: ' + err.message, 'error');
        }
      });
    }
  } catch (err) {
    console.error(err);
    container.innerHTML = '<div class="error">Error loading note.</div>';
  }

  console.log('[SharedNote] Initialized');
}

export function destroy() {
  // Cleanup if needed
}
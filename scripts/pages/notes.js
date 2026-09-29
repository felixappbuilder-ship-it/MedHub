// scripts/pages/notes.js
import * as ui from '../ui.js';
import * as router from '../router.js';
import * as auth from '../auth.js';
import * as notesUI from '../notes-ui.js';

let $;

export async function init(context) {
  $ = (sel) => context.root.querySelector(sel);

  ui.applyTheme();

  // Check auth
  if (!auth.checkAuth()) {
    router.navigateTo('login');
    return;
  }

  // Initialize notes UI
  await notesUI.initNotesPage();

  // Expose global functions for legacy inline calls
  window.toggleHistory = toggleHistory;
  window.filterNotes = notesUI.filterNotes;
  window.createNewNote = notesUI.openNoteEditor;
  window.closeEditor = notesUI.closeNoteEditor;
  window.saveNote = notesUI.saveCurrentNote;
  window.toggleLock = notesUI.toggleLockCurrent;
  window.shareCurrentNote = notesUI.shareCurrentNote;
  window.exportPDFCurrent = notesUI.exportPDFCurrent;
  window.showEditorMenu = notesUI.showEditorMenu;
  window.closeShareModal = notesUI.closeShareModal;
  window.copyShareLink = notesUI.copyShareLink;
  window.shareViaNative = notesUI.shareViaNative;

  // Attach event listeners
  attachEventListeners(context);

  // Hide shimmer (body.loaded class is added by notesUI)
  document.body.classList.add('loaded');

  console.log('[Notes] Initialized');
}

function attachEventListeners(context) {
  // Theme toggle
  const themeToggle = $('#themeToggle');
  if (themeToggle) {
    themeToggle.addEventListener('click', ui.toggleTheme);
  }

  // Hamburger (toggle history)
  const hamburgerBtn = $('#hamburgerBtn');
  if (hamburgerBtn) {
    hamburgerBtn.addEventListener('click', toggleHistory);
  }

  // Close history
  const closeHistoryBtn = $('#closeHistoryBtn');
  if (closeHistoryBtn) {
    closeHistoryBtn.addEventListener('click', toggleHistory);
  }

  // Back from editor
  const backEditorBtn = $('#backEditorBtn');
  if (backEditorBtn) {
    backEditorBtn.addEventListener('click', notesUI.closeNoteEditor);
  }

  // Save note
  const saveNoteBtn = $('#saveNoteBtn');
  if (saveNoteBtn) {
    saveNoteBtn.addEventListener('click', notesUI.saveCurrentNote);
  }

  // Lock tool
  const lockTool = $('#lockTool');
  if (lockTool) {
    lockTool.addEventListener('click', notesUI.toggleLockCurrent);
  }

  // Share tool
  const shareTool = $('#shareTool');
  if (shareTool) {
    shareTool.addEventListener('click', notesUI.shareCurrentNote);
  }

  // Export PDF tool
  const exportTool = $('#exportTool');
  if (exportTool) {
    exportTool.addEventListener('click', notesUI.exportPDFCurrent);
  }

  // Menu tool
  const menuTool = $('#menuTool');
  if (menuTool) {
    menuTool.addEventListener('click', notesUI.showEditorMenu);
  }

  // Share modal close
  const closeShareModalBtn = $('#closeShareModalBtn');
  if (closeShareModalBtn) {
    closeShareModalBtn.addEventListener('click', notesUI.closeShareModal);
  }

  // Copy share link
  const copyShareLinkBtn = $('#copyShareLinkBtn');
  if (copyShareLinkBtn) {
    copyShareLinkBtn.addEventListener('click', notesUI.copyShareLink);
  }

  // Share via native
  const shareViaNativeBtn = $('#shareViaNativeBtn');
  if (shareViaNativeBtn) {
    shareViaNativeBtn.addEventListener('click', notesUI.shareViaNative);
  }

  // FAB
  const fabBtn = $('#fabBtn');
  if (fabBtn) {
    fabBtn.addEventListener('click', notesUI.openNoteEditor);
  }

  // Filter tabs
  context.root.querySelectorAll('.filter-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      notesUI.filterNotes(btn.dataset.filter);
    });
  });

  // Search input
  const searchNotes = $('#searchNotes');
  if (searchNotes) {
    searchNotes.addEventListener('input', (e) => {
      notesUI.searchNotes(e.target.value);
    });
  }

  // Navigation links
  const performanceLink = $('#performanceLink');
  if (performanceLink) {
    performanceLink.addEventListener('click', (e) => {
      e.preventDefault();
      router.navigateTo('performance');
    });
  }

  const aiLink = $('#aiLink');
  if (aiLink) {
    aiLink.addEventListener('click', (e) => {
      e.preventDefault();
      router.navigateTo('ai');
    });
  }

  const subjectsLink = $('#subjectsLink');
  if (subjectsLink) {
    subjectsLink.addEventListener('click', (e) => {
      e.preventDefault();
      router.navigateTo('subjects');
    });
  }
}

function toggleHistory() {
  const panel = $('#historyPanel');
  if (panel) {
    panel.classList.toggle('open');
    if (panel.classList.contains('open')) {
      notesUI.updateHistoryPanel();
    }
  }
}

export function destroy() {
  // Cleanup if needed
}
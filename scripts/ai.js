// frontend-user/scripts/ai.js
/**
 * AI Module – Convex Integration (Memory Chunks)
 * Provides chat, summarization, flashcards, questions, mnemonics, and more.
 * Supports offline persistence via IndexedDB and syncs with backend when online.
 * 
 * Automatic conversation handling:
 * - The engine maintains a `_currentChatId` to reuse the same conversation for follow‑up messages.
 * - The UI can optionally pass a `chatId` to override the current one.
 * - New conversations are created on the backend immediately – no local IDs.
 */

import * as utils from './utils.js';
import * as ui from './ui.js';
import * as app from './app.js';
import * as db from './db.js';
import * as auth from './auth.js';
import { convexHttpClient } from './convex-client.js';

// ==================== CONSTANTS ====================

const FREE_LIMIT = 3;

// ==================== HELPERS ====================

function getToken() {
  const token = auth.getToken();
  if (!token) throw new Error('Not authenticated');
  return token;
}

function requireOnline() {
  if (!navigator.onLine) {
    throw new Error('You need to be online to perform this action.');
  }
}

// ==================== AI CLASS ====================

class AIEngine {
  constructor() {
    this._cache = {
      chats: null,
      usage: null,
    };
    this._currentChatId = null; // the last used conversation ID
    this._syncInProgress = false;
  }

  // ---- Usage & Subscription ----

  async checkUsageLimit() {
    const user = app.getUser();
    if (!user) return { allowed: false, remaining: 0, limit: 0 };
    const hasSubscription = await app.hasActiveSubscription();
    if (hasSubscription) {
      return { allowed: true, remaining: Infinity, limit: Infinity };
    }
    const count = utils.getLocalStorage('ai_usage_count', 0);
    return {
      allowed: count < FREE_LIMIT,
      remaining: Math.max(FREE_LIMIT - count, 0),
      limit: FREE_LIMIT,
    };
  }

  async _incrementUsage() {
    const count = utils.getLocalStorage('ai_usage_count', 0);
    utils.setLocalStorage('ai_usage_count', count + 1);
  }

  // ---- Chat CRUD ----

  async loadChats() {
    if (this._cache.chats) return this._cache.chats;

    // 1. Load from IndexedDB first (fast, offline)
    let localChats = [];
    try {
      localChats = await db.getConversations() || [];
    } catch (e) {
      console.warn('[loadChats] Error reading from IndexedDB:', e);
    }
    if (!localChats.length) {
      const stored = utils.getLocalStorage('ai_chats', []);
      if (stored.length) localChats = stored;
    }

    // 2. If online, fetch from backend and merge
    if (navigator.onLine) {
      try {
        const token = getToken();
        console.log('[loadChats] Fetching conversations from backend...');
        const result = await convexHttpClient.action('conversations/actions:getConversations', {
          token,
          limit: 100,
        });
        if (result.success && result.data && result.data.conversations) {
          const backendChats = result.data.conversations;
          const merged = this._mergeChats(localChats, backendChats);
          this._cache.chats = merged;
          await db.saveConversations(merged);
          await this._saveChatsToStorage(merged);
          return merged;
        }
      } catch (err) {
        console.warn('[loadChats] Backend fetch failed, using local only:', err);
      }
    }

    this._cache.chats = localChats;
    return localChats;
  }

  _mergeChats(local, backend) {
    const map = new Map();
    for (const chat of local) {
      map.set(chat.id, { ...chat });
    }
    for (const bChat of backend) {
      if (map.has(bChat._id)) {
        const existing = map.get(bChat._id);
        map.set(bChat._id, {
          id: bChat._id,
          title: bChat.title,
          messages: existing.messages || [],
          pinned: existing.pinned || false,
          createdAt: bChat.createdAt || existing.createdAt,
          updatedAt: bChat.updatedAt || existing.updatedAt,
          synced: true,
          serverId: bChat._id,
        });
      } else {
        map.set(bChat._id, {
          id: bChat._id,
          title: bChat.title,
          messages: [],
          pinned: false,
          createdAt: bChat.createdAt,
          updatedAt: bChat.updatedAt,
          synced: true,
          serverId: bChat._id,
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  }

  /**
   * Fetch messages for a specific conversation (from chunks) and merge into local DB.
   */
  async loadConversationMessages(chatId) {
    if (!chatId) return [];
    let chats = await this.loadChats();
    let chat = chats.find(c => c.id === chatId);
    if (chat && chat.messages && chat.messages.length > 0) {
      return chat.messages;
    }
    if (navigator.onLine) {
      try {
        const token = getToken();
        const result = await convexHttpClient.action('conversations/actions:getConversation', {
          token,
          conversationId: chatId,
          limit: 200,
        });
        if (result.success && result.data && result.data.messages) {
          const messages = result.data.messages;
          if (chat) {
            chat.messages = messages;
            chat.synced = true;
            await db.saveConversations(chats);
            await this._saveChatsToStorage(chats);
            this._cache.chats = chats;
          }
          return messages;
        }
      } catch (err) {
        console.warn('[loadConversationMessages] Backend fetch failed:', err);
      }
    }
    return chat ? chat.messages : [];
  }

  /**
   * Create a new empty conversation on the backend.
   */
  async createEmptyChat(title = 'New Chat') {
    requireOnline();
    const token = getToken();
    const result = await convexHttpClient.action('conversations/actions:saveConversation', {
      token,
      title,
      messages: [],
    });
    if (!result.success) throw new Error(result.message);
    const serverId = result.data.conversationId;

    const newChat = {
      id: serverId,
      title,
      messages: [],
      pinned: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      synced: true,
      serverId,
    };

    const chats = await this.loadChats();
    chats.unshift(newChat);
    this._cache.chats = chats;
    await db.saveConversations(chats);
    await this._saveChatsToStorage(chats);

    this._currentChatId = serverId;
    return newChat;
  }

  /**
   * Public alias for createEmptyChat – used by UI.
   */
  async createChat(title = 'New Chat') {
    return await this.createEmptyChat(title);
  }

  async deleteChat(chatId) {
    let chats = await this.loadChats();
    chats = chats.filter(c => c.id !== chatId);
    this._cache.chats = chats;
    await db.saveConversations(chats);
    await this._saveChatsToStorage(chats);

    if (navigator.onLine) {
      try {
        const token = getToken();
        await convexHttpClient.action('conversations/actions:deleteConversation', {
          token,
          conversationId: chatId,
        });
      } catch (err) {
        console.warn('[deleteChat] Backend delete failed:', err);
        await db.addToSyncQueue('delete_conversation', { conversationId: chatId });
      }
    }
    if (this._currentChatId === chatId) this._currentChatId = null;
    return true;
  }

  async pinChat(chatId) {
    const chats = await this.loadChats();
    const chat = chats.find(c => c.id === chatId);
    if (!chat) throw new Error('Chat not found');
    chat.pinned = !chat.pinned;
    this._cache.chats = chats;
    await db.saveConversations(chats);
    await this._saveChatsToStorage(chats);
    return chat.pinned;
  }

  // ---- Message handling ----

  async saveMessage(payload) {
    const chats = await this.loadChats();
    const chat = chats.find(c => c.id === payload.chatId);
    if (!chat) {
      console.warn('[saveMessage] Chat not found; will create a new one.');
      const newChat = await this.createEmptyChat('Untitled');
      payload.chatId = newChat.id;
      return this.saveMessage(payload);
    }
    chat.messages.push(payload);
    chat.updatedAt = Date.now();
    if (chat.synced !== false) chat.synced = false;
    this._cache.chats = chats;
    await db.saveConversations(chats);
    await this._saveChatsToStorage(chats);
    return true;
  }

  // ---- Main chat entry point ----

  /**
   * Send a message to the AI.
   * Automatically reuses the current conversation ID if `chatId` is not provided.
   * @param {Object} params
   * @param {string} params.message - The user message.
   * @param {string} [params.chatId] - Optional conversation ID. If omitted, the engine will reuse the last active one.
   * @param {Array} [params.modes] - (reserved)
   * @param {File} [params.file] - (reserved)
   * @returns {Promise<{text: string, chatId: string, meta: any, richData: any}>}
   */
  async sendMessageToAI({ message, chatId, modes = [], file = null }) {
    // If chatId is provided, use it and update current ID.
    let effectiveChatId = chatId || this._currentChatId;

    // If we have an ID, verify it exists locally.
    let chat = null;
    if (effectiveChatId) {
      const chats = await this.loadChats();
      chat = chats.find(c => c.id === effectiveChatId);
      if (!chat) {
        // The stored ID is not found locally – maybe it was deleted or cache is stale.
        // We'll treat it as a new conversation.
        effectiveChatId = null;
        chat = null;
      }
    }

    // If no valid chat, create a new one.
    if (!effectiveChatId) {
      const newChat = await this.createEmptyChat(message.slice(0, 30) + (message.length > 30 ? '...' : ''));
      effectiveChatId = newChat.id;
      chat = newChat;
      this._currentChatId = effectiveChatId;
    } else {
      // Ensure we have the chat object loaded.
      if (!chat) {
        const chats = await this.loadChats();
        chat = chats.find(c => c.id === effectiveChatId);
        if (!chat) {
          // Fallback: create a new one anyway.
          const newChat = await this.createEmptyChat(message.slice(0, 30) + '...');
          effectiveChatId = newChat.id;
          chat = newChat;
          this._currentChatId = effectiveChatId;
        }
      }
    }

    // Save user message locally.
    await this.saveMessage({
      chatId: effectiveChatId,
      role: 'user',
      content: message,
      fileData: file ? { name: file.name, type: file.type } : null,
      timestamp: Date.now(),
    });

    // Check usage limit.
    const { allowed, remaining } = await this.checkUsageLimit();
    if (!allowed) {
      if (remaining <= 0) {
        ui.showToast('Free limit reached. Please subscribe.', 'error');
        window.location.href = '/pages/subscription.html';
        throw new Error('Usage limit reached');
      }
      await this._incrementUsage();
    }

    // Send to backend.
    try {
      const token = getToken();
      const result = await convexHttpClient.action('conversations/actions:sendMessage', {
        token,
        conversationId: effectiveChatId,
        message,
      });

      if (!result.success) {
        if (result.error === 'subscription_required') {
          ui.showToast('Active subscription required for AI features.', 'error');
          window.location.href = '/pages/subscription.html';
          throw new Error('Subscription required');
        }
        if (result.error === 'rate_limit_exceeded') {
          ui.showToast('Too many AI requests. Please wait a minute.', 'warning');
          throw new Error('Rate limit exceeded');
        }
        throw new Error(result.message);
      }

      const answer = result.data.message;

      // Save assistant message.
      await this.saveMessage({
        chatId: effectiveChatId,
        role: 'assistant',
        content: answer,
        meta: null,
        richData: null,
        timestamp: Date.now(),
      });

      // Mark chat as synced.
      chat.synced = true;
      const chats = await this.loadChats();
      await db.saveConversations(chats);
      await this._saveChatsToStorage(chats);
      this._cache.chats = chats;

      // Update the current chat ID (in case it was newly created or changed).
      this._currentChatId = effectiveChatId;

      return {
        text: answer,
        chatId: effectiveChatId,
        meta: null,
        richData: null,
      };
    } catch (err) {
      console.error('sendMessageToAI error:', err);
      ui.showToast(err.message || 'AI request failed', 'error');
      throw err;
    }
  }

  // ---- Regenerate ----

  async regenerateResponse({ chatId, modes }) {
    if (!chatId) throw new Error('No conversation ID provided.');
    const chats = await this.loadChats();
    const chat = chats.find(c => c.id === chatId);
    if (!chat) throw new Error('Chat not found');

    let lastUserMsg = null;
    let lastAssistantIndex = -1;
    for (let i = chat.messages.length - 1; i >= 0; i--) {
      if (chat.messages[i].role === 'assistant' && lastAssistantIndex === -1) {
        lastAssistantIndex = i;
      }
      if (chat.messages[i].role === 'user' && !lastUserMsg) {
        lastUserMsg = chat.messages[i];
        break;
      }
    }
    if (!lastUserMsg) throw new Error('No user message to regenerate from');
    if (lastAssistantIndex !== -1) {
      chat.messages.splice(lastAssistantIndex, 1);
    }
    this._cache.chats = chats;
    await db.saveConversations(chats);
    await this._saveChatsToStorage(chats);

    try {
      const token = getToken();
      const result = await convexHttpClient.action('conversations/actions:sendMessage', {
        token,
        conversationId: chatId,
        message: lastUserMsg.content,
      });
      if (!result.success) throw new Error(result.message);
      const answer = result.data.message;
      await this.saveMessage({
        chatId: chatId,
        role: 'assistant',
        content: answer,
        meta: null,
        richData: null,
        timestamp: Date.now(),
      });
      chat.synced = true;
      await db.saveConversations(chats);
      await this._saveChatsToStorage(chats);
      this._cache.chats = chats;
      return { text: answer, chatId: chatId, meta: null, richData: null };
    } catch (err) {
      ui.showToast(err.message, 'error');
      throw err;
    }
  }

  // ---- Other AI Actions (unchanged) ----

  async summarizeText(text) {
    requireOnline();
    const token = getToken();
    ui.showLoading('Summarizing...');
    try {
      const result = await convexHttpClient.action('ai/actions:summarizeText', {
        token,
        text,
      });
      if (!result.success) throw new Error(result.message);
      return result.data.summary;
    } catch (err) {
      console.error('Summarize failed:', err);
      throw err;
    } finally {
      ui.hideLoading();
    }
  }

  async generateFlashcards(text, count = 5) {
    requireOnline();
    const token = getToken();
    ui.showLoading('Generating flashcards...');
    try {
      const result = await convexHttpClient.action('ai/actions:generateFlashcards', {
        token,
        text,
        count,
      });
      if (!result.success) throw new Error(result.message);
      return result.data.flashcards;
    } catch (err) {
      console.error('Flashcard generation failed:', err);
      throw err;
    } finally {
      ui.hideLoading();
    }
  }

  async generateQuestions(topic, count = 5) {
    requireOnline();
    const token = getToken();
    ui.showLoading('Generating questions...');
    try {
      const result = await convexHttpClient.action('ai/actions:generateQuestions', {
        token,
        topic,
        count,
      });
      if (!result.success) throw new Error(result.message);
      return result.data.questions;
    } catch (err) {
      console.error('Question generation failed:', err);
      throw err;
    } finally {
      ui.hideLoading();
    }
  }

  async getMnemonics(medicalTerm) {
    requireOnline();
    const token = getToken();
    ui.showLoading('Generating mnemonic...');
    try {
      const result = await convexHttpClient.action('ai/actions:getMnemonics', {
        token,
        medicalTerm,
      });
      if (!result.success) throw new Error(result.message);
      return result.data.mnemonic;
    } catch (err) {
      console.error('Mnemonic generation failed:', err);
      throw err;
    } finally {
      ui.hideLoading();
    }
  }

  async suggestTags(text) {
    requireOnline();
    const token = getToken();
    ui.showLoading('Suggesting tags...');
    try {
      const result = await convexHttpClient.action('ai/actions:suggestTags', {
        token,
        text,
      });
      if (!result.success) throw new Error(result.message);
      return result.data.tags;
    } catch (err) {
      console.error('Tag suggestion failed:', err);
      throw err;
    } finally {
      ui.hideLoading();
    }
  }

  async explainTopic(topic) {
    requireOnline();
    const token = getToken();
    ui.showLoading('Explaining topic...');
    try {
      const result = await convexHttpClient.action('ai/actions:explainTopic', {
        token,
        topic,
      });
      if (!result.success) throw new Error(result.message);
      return result.data.explanation;
    } catch (err) {
      console.error('Topic explanation failed:', err);
      throw err;
    } finally {
      ui.hideLoading();
    }
  }

  async deepthink(question) {
    requireOnline();
    const token = getToken();
    ui.showLoading('Deep thinking...');
    try {
      const result = await convexHttpClient.action('ai/actions:deepthink', {
        token,
        question,
      });
      if (!result.success) throw new Error(result.message);
      return result.data.answer;
    } catch (err) {
      console.error('DeepThink failed:', err);
      throw err;
    } finally {
      ui.hideLoading();
    }
  }

  async searchWeb(query) {
    requireOnline();
    const token = getToken();
    ui.showLoading('Searching web...');
    try {
      const result = await convexHttpClient.action('ai/actions:searchWeb', {
        token,
        query,
      });
      if (!result.success) throw new Error(result.message);
      return result.data.result;
    } catch (err) {
      console.error('Web search failed:', err);
      throw err;
    } finally {
      ui.hideLoading();
    }
  }

  async getReferences(topic) {
    requireOnline();
    const token = getToken();
    ui.showLoading('Fetching references...');
    try {
      const result = await convexHttpClient.action('ai/actions:getReferences', {
        token,
        topic,
      });
      if (!result.success) throw new Error(result.message);
      return result.data.references;
    } catch (err) {
      console.error('References retrieval failed:', err);
      throw err;
    } finally {
      ui.hideLoading();
    }
  }

  async analyzeImage(imageUrl, prompt = '') {
    requireOnline();
    const token = getToken();
    ui.showLoading('Analyzing image...');
    try {
      const result = await convexHttpClient.action('ai/actions:analyzeImage', {
        token,
        imageUrl,
        prompt,
      });
      if (!result.success) throw new Error(result.message);
      return result.data.analysis;
    } catch (err) {
      console.error('Image analysis failed:', err);
      throw err;
    } finally {
      ui.hideLoading();
    }
  }

  async analyzeDocument(documentUrl, prompt = '') {
    requireOnline();
    const token = getToken();
    ui.showLoading('Analyzing document...');
    try {
      const result = await convexHttpClient.action('ai/actions:analyzeDocument', {
        token,
        documentUrl,
        prompt,
      });
      if (!result.success) throw new Error(result.message);
      return result.data.analysis;
    } catch (err) {
      console.error('Document analysis failed:', err);
      throw err;
    } finally {
      ui.hideLoading();
    }
  }

  async transcribeAudio(audioUrl) {
    requireOnline();
    const token = getToken();
    ui.showLoading('Transcribing audio...');
    try {
      const result = await convexHttpClient.action('ai/actions:transcribeAudio', {
        token,
        audioUrl,
      });
      if (!result.success) throw new Error(result.message);
      return result.data.transcript;
    } catch (err) {
      console.error('Audio transcription failed:', err);
      throw err;
    } finally {
      ui.hideLoading();
    }
  }

  async generateExamQuestions(subject, count = 10) {
    requireOnline();
    const token = getToken();
    ui.showLoading('Generating exam questions...');
    try {
      const result = await convexHttpClient.action('ai/actions:generateExamQuestions', {
        token,
        subject,
        count,
      });
      if (!result.success) throw new Error(result.message);
      return result.data.questions;
    } catch (err) {
      console.error('Exam question generation failed:', err);
      throw err;
    } finally {
      ui.hideLoading();
    }
  }

  async autoGradeEssay(essay, rubric = '') {
    requireOnline();
    const token = getToken();
    ui.showLoading('Grading essay...');
    try {
      const result = await convexHttpClient.action('ai/actions:autoGradeEssay', {
        token,
        essay,
        rubric,
      });
      if (!result.success) throw new Error(result.message);
      return result.data.grade;
    } catch (err) {
      console.error('Essay grading failed:', err);
      throw err;
    } finally {
      ui.hideLoading();
    }
  }

  // ---- Persistence helpers ----

  async _saveChatsToStorage(chats) {
    utils.setLocalStorage('ai_chats', chats);
  }

  async clearAllData() {
    utils.removeLocalStorage('ai_chats');
    utils.removeLocalStorage('ai_usage_count');
    await db.clearConversations();
    this._cache.chats = null;
    this._currentChatId = null;
  }

  // ---- File upload (stub) ----

  async uploadFile(file) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => {
        resolve({
          name: file.name,
          type: file.type,
          data: reader.result,
          url: null,
        });
      };
      reader.readAsDataURL(file);
    });
  }

  // ---- Refresh chats from backend ----

  async refreshChats() {
    this._cache.chats = null;
    return this.loadChats();
  }

  // ---- Utility ----

  /**
   * Returns the current active conversation ID.
   */
  getCurrentChatId() {
    return this._currentChatId;
  }
}

// ==================== SINGLETON EXPORT ====================

const ai = new AIEngine();
export default ai;
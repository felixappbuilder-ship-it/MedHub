// ai.js – ES Module
import * as app from './app.js';
import * as ui from './ui.js';
import * as utils from './utils.js';
import * as security from './security.js';
import * as auth from './auth.js';
import * as db from './db.js';
import { navigateTo } from './router.js';

const FREE_LIMIT = 3;

// ---------- Internal helpers ----------
function getUsageCount() {
  return utils.getLocalStorage('ai_usage_count', 0);
}

function setUsageCount(count) {
  utils.setLocalStorage('ai_usage_count', count);
}

// ---------- Mock response generator (replace with real API later) ----------
function generateMockResponse(userMessage, modes, file) {
  const isDeep = modes.includes('deepthink');
  const isWeb = modes.includes('websearch');
  const isRef = modes.includes('references');

  let replyText = `You asked: "${userMessage}".\n\nHere is a detailed explanation.`;
  const metaParts = [];

  if (isDeep) {
    replyText = `[DeepThink] ` + replyText;
    metaParts.push(`⏱️ Thought for ${(Math.random() * 2 + 1).toFixed(1)}s`);
  }
  if (isWeb) {
    metaParts.push(`🌐 Web search used`);
    replyText = `Based on recent web sources: ${replyText}`;
  }
  if (isRef) {
    metaParts.push(`📚 Citations included`);
    replyText = `According to academic references: ${replyText}`;
  }

  const meta = metaParts.length ? metaParts.join(' · ') : null;
  const richData = {};

  if (userMessage.toLowerCase().includes('list')) {
    richData.listItems = ['First item', 'Second item', 'Third item'];
  }
  if (userMessage.toLowerCase().includes('code')) {
    richData.codeBlock = "function example() {\n  console.log('Hello world');\n}";
  }
  if (isWeb) {
    richData.sources = [
      { title: 'Medical News Today', snippet: 'Recent study shows...', url: '#' },
      { title: 'PubMed Central', snippet: 'Systematic review', url: '#' }
    ];
  }
  if (isRef) {
    richData.references = [
      { book: "Gray's Anatomy", page: 342, snippet: 'Detailed description' },
      { book: "Harrison's Principles", page: 120, snippet: 'Clinical correlation' }
    ];
  }

  if (file && file.type && file.type.startsWith('image/')) {
    richData.images = [file.data];
  } else if (Math.random() < 0.3) {
    richData.images = ['https://picsum.photos/id/48/800/400'];
  }

  richData.tools = ['Explain further', 'Quiz me', 'Flashcards'];
  return { text: replyText, meta, richData };
}

// ---------- Chat persistence (localStorage via utils) ----------
async function loadChatsFromStorage() {
  return utils.getLocalStorage('ai_chats', []);
}

async function saveChatsToStorage(chats) {
  utils.setLocalStorage('ai_chats', chats);
}

// ---------- Public API ----------
class AIEngine {
  constructor() {}

  async getCurrentUser() {
    // Real implementation: await app.getUser()
    return { id: 'user-001', name: 'Felix' };
  }

  async checkUsageLimit() {
    const user = await this.getCurrentUser();
    // Check subscription and free limit
    const hasSubscription = await app.hasActiveSubscription?.();
    if (hasSubscription) {
      return { allowed: true, remaining: Infinity, limit: Infinity };
    }
    const count = getUsageCount();
    return {
      allowed: count < FREE_LIMIT,
      remaining: Math.max(FREE_LIMIT - count, 0),
      limit: FREE_LIMIT
    };
  }

  async _incrementUsage() {
    const count = getUsageCount() + 1;
    setUsageCount(count);
  }

  // ----- Chat CRUD -----
  async loadChats() {
    return await loadChatsFromStorage();
  }

  async createChat(title = 'New Chat') {
    const chats = await loadChatsFromStorage();
    const newChat = {
      id: Date.now().toString(),
      title,
      messages: [],
      pinned: false
    };
    chats.push(newChat);
    await saveChatsToStorage(chats);
    return newChat;
  }

  async deleteChat(chatId) {
    let chats = await loadChatsFromStorage();
    chats = chats.filter(c => c.id !== chatId);
    await saveChatsToStorage(chats);
  }

  async pinChat(chatId) {
    const chats = await loadChatsFromStorage();
    const chat = chats.find(c => c.id === chatId);
    if (!chat) throw new Error('Chat not found');
    chat.pinned = !chat.pinned;
    await saveChatsToStorage(chats);
    return chat.pinned;
  }

  // ----- Message handling -----
  async saveMessage(payload) {
    const chats = await loadChatsFromStorage();
    const chat = chats.find(c => c.id === payload.chatId);
    if (!chat) throw new Error('Chat not found');
    chat.messages.push(payload);
    await saveChatsToStorage(chats);
  }

  async sendMessageToAI({ message, chatId, modes = [], file = null }) {
    // 1. Check limit & subscription
    const { allowed, remaining, limit } = await this.checkUsageLimit();
    if (!allowed) {
      if (remaining <= 0) {
        ui.showToast('Free limit reached. Please subscribe.', 'error');
        navigateTo('/pages/subscription.html');
        throw new Error('Usage limit reached');
      }
    }

    // 2. Increment usage
    await this._incrementUsage();

    // 3. Show loading
    ui.showLoading('Generating response...');

    try {
      // 4. Generate response (mock / future API call)
      const response = generateMockResponse(message, modes, file);

      // 5. Persist messages
      await this.saveMessage({
        chatId,
        role: 'user',
        content: message,
        fileData: file ? { name: file.name, type: file.type, data: file.data } : null
      });

      await this.saveMessage({
        chatId,
        role: 'assistant',
        content: response.text,
        meta: response.meta,
        richData: response.richData
      });

      // 6. Optionally queue for offline sync if needed
      if (!utils.isOnline()) {
        await db.addToSyncQueue?.('message', {
          chatId,
          userMsg: message,
          assistantMsg: response.text,
          timestamp: Date.now()
        });
      }

      return { ...response, chatId };
    } finally {
      ui.hideLoading();
    }
  }

  async regenerateResponse({ chatId, modes }) {
    const chats = await loadChatsFromStorage();
    const chat = chats.find(c => c.id === chatId);
    if (!chat) throw new Error('Chat not found');

    // Find last user message
    let lastUserMsg = null;
    for (let i = chat.messages.length - 1; i >= 0; i--) {
      if (chat.messages[i].role === 'user') {
        lastUserMsg = chat.messages[i];
        break;
      }
    }
    if (!lastUserMsg) throw new Error('No user message to regenerate from');

    // Remove last assistant message
    for (let i = chat.messages.length - 1; i >= 0; i--) {
      if (chat.messages[i].role === 'assistant') {
        chat.messages.splice(i, 1);
        break;
      }
    }
    await saveChatsToStorage(chats);

    ui.showLoading('Regenerating...');
    try {
      const response = generateMockResponse(lastUserMsg.content, modes, lastUserMsg.fileData);

      await this.saveMessage({
        chatId,
        role: 'assistant',
        content: response.text,
        meta: response.meta,
        richData: response.richData
      });

      return { ...response, chatId };
    } finally {
      ui.hideLoading();
    }
  }

  // ----- File handling -----
  async uploadFile(file) {
    return new Promise((resolve, reject) => {
      if (file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = () => {
          resolve({
            name: file.name,
            type: file.type,
            data: reader.result,
            url: null
          });
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      } else {
        resolve({
          name: file.name,
          type: file.type,
          data: null,
          url: null
        });
      }
    });
  }

  // ----- Housekeeping -----
  async clearAllData() {
    utils.removeLocalStorage('ai_chats');
    setUsageCount(0);
    // Optionally clear sync queue
    await db.clearSyncQueue?.();
  }
}

const ai = new AIEngine();
export default ai;
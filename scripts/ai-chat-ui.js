// frontend-user/scripts/ai-chat-ui.js

import * as ui from './ui.js';
import * as utils from './utils.js';
import * as router from './router.js';
import ai from './ai.js';

export default class AIChatUI {
    constructor() {
        // DOM elements
        this.sidebar = document.getElementById('sidebar');
        this.menuToggle = document.getElementById('menuToggle');
        this.newChatBtn = document.getElementById('newChatBtn');
        this.settingsBtn = document.getElementById('settingsBtn');
        this.settingsModal = document.getElementById('settingsModal');
        this.closeModalBtn = document.getElementById('closeModalBtn');
        this.themeToggle = document.getElementById('themeToggle');
        this.modelSelect = document.getElementById('modelSelect');
        this.currentModelSpan = document.getElementById('currentModel');
        this.modelSelectorBtn = document.getElementById('modelSelectorBtn');
        this.clearHistoryBtn = document.getElementById('clearHistoryBtn');
        this.sendBtn = document.getElementById('sendBtn');
        this.messageInput = document.getElementById('messageInput');
        this.chatContainer = document.getElementById('chatContainer');
        this.typingIndicator = document.getElementById('typingIndicator');
        this.attachBtn = document.getElementById('attachBtn');
        this.voiceBtn = document.getElementById('voiceBtn');
        this.attachDropdown = document.getElementById('attachDropdown');
        this.searchChats = document.getElementById('searchChats');
        this.chatHistoryList = document.getElementById('chatHistoryList');
        this.activeFunctionsDiv = document.getElementById('activeFunctions');
        this.pendingAttachmentsDiv = document.getElementById('pendingAttachments');
        this.normalInput = document.getElementById('normalInput');
        this.voiceRecordingBar = document.getElementById('voiceRecordingBar');
        this.stopRecordingBtn = document.getElementById('stopRecordingBtn');
        this.imageUpload = document.getElementById('imageUpload');
        this.photoCapture = document.getElementById('photoCapture');
        this.documentUpload = document.getElementById('documentUpload');

        this.currentChatId = null;
        this.activeModes = [];
        this.pendingAttachment = null;
        this.isRecording = false;
        this.recordingTimer = null;
        this.chats = [];

        // Bind methods
        this.loadChats = this.loadChats.bind(this);
        this.renderChatHistory = this.renderChatHistory.bind(this);
        this.loadChatUI = this.loadChatUI.bind(this);
        this.sendUserMessage = this.sendUserMessage.bind(this);
        this.addMode = this.addMode.bind(this);
        this.removeMode = this.removeMode.bind(this);
        this.renderChips = this.renderChips.bind(this);
        this.setPendingAttachment = this.setPendingAttachment.bind(this);
        this.clearPendingAttachment = this.clearPendingAttachment.bind(this);
        this.renderPendingAttachment = this.renderPendingAttachment.bind(this);
    }

    async init() {
        await this.loadChats();
        this.setupEventListeners();
        this.resetToWelcome();
        this.hideTypingIndicator();
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.item-menu')) {
                document.querySelectorAll('.dropdown-menu.show').forEach(m => m.classList.remove('show'));
            }
        });
    }

    async loadChats() {
        this.chats = await ai.loadChats();
        this.renderChatHistory('');
    }

    renderChatHistory(filterText = '') {
        const filtered = this.chats.filter(c =>
            c.title.toLowerCase().includes(filterText.toLowerCase())
        );
        filtered.sort((a,b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
        this.chatHistoryList.innerHTML = '';
        filtered.forEach(chat => {
            const li = document.createElement('li');
            li.className = `history-item ${chat.pinned ? 'pinned' : ''}`;
            li.dataset.id = chat.id;

            const titleSpan = document.createElement('span');
            titleSpan.className = 'chat-title';
            titleSpan.textContent = chat.title;
            titleSpan.addEventListener('click', (e) => {
                e.stopPropagation();
                this.loadChatUI(chat.id);
            });

            const menuContainer = document.createElement('div');
            menuContainer.className = 'item-menu';

            const dots = document.createElement('i');
            dots.className = 'fas fa-ellipsis-v menu-dots';
            dots.addEventListener('click', (e) => {
                e.stopPropagation();
                document.querySelectorAll('.dropdown-menu.show').forEach(m => m.classList.remove('show'));
                const dropdown = menuContainer.querySelector('.dropdown-menu');
                dropdown.classList.toggle('show');
            });

            const dropdown = document.createElement('div');
            dropdown.className = 'dropdown-menu';
            dropdown.innerHTML = `
                <div class="pin-item"><i class="fas fa-thumbtack"></i> ${chat.pinned ? 'Unpin' : 'Pin'}</div>
                <div class="delete-item"><i class="fas fa-trash"></i> Delete</div>
                <div class="share-item"><i class="fas fa-share-alt"></i> Share</div>
            `;

            dropdown.querySelector('.pin-item').addEventListener('click', async (e) => {
                e.stopPropagation();
                await ai.pinChat(chat.id);
                await this.loadChats();
            });

            dropdown.querySelector('.delete-item').addEventListener('click', async (e) => {
                e.stopPropagation();
                if (this.currentChatId === chat.id) {
                    this.resetToWelcome();
                    this.currentChatId = null;
                }
                await ai.deleteChat(chat.id);
                await this.loadChats();
            });

            dropdown.querySelector('.share-item').addEventListener('click', (e) => {
                e.stopPropagation();
                ui.showToast(`🔗 Shareable link (mock): https://chat.shared/${chat.id}`, 'info', 3000);
                dropdown.classList.remove('show');
            });

            menuContainer.appendChild(dots);
            menuContainer.appendChild(dropdown);
            li.appendChild(titleSpan);
            li.appendChild(menuContainer);
            this.chatHistoryList.appendChild(li);
        });
    }

    loadChatUI(chatId) {
        const chat = this.chats.find(c => c.id === chatId);
        if (!chat) return;
        this.currentChatId = chatId;
        this.clearMessages();
        chat.messages.forEach(msg => {
            if (msg.role === 'user') {
                if (msg.fileData) {
                    this.addUserMessageWithFile(msg.content, msg.fileData, false);
                } else {
                    this.addUserMessage(msg.content, false);
                }
            } else {
                this.addAssistantMessage(msg.content, false, msg.meta);
            }
        });
        this.removeWelcomeIfExists();
        if (window.innerWidth < 768) this.sidebar.classList.remove('open');
    }

    clearMessages() {
        Array.from(this.chatContainer.children).forEach(child => {
            if (child.id !== 'typingIndicator') child.remove();
        });
    }

    resetToWelcome() {
        this.clearMessages();
        this.removeWelcomeIfExists();
        this.chatContainer.insertBefore(this.createWelcomeBlock(), this.typingIndicator);
    }

    createWelcomeBlock() {
        const block = document.createElement('div');
        block.className = 'welcome-block';
        block.id = 'welcomeBlock';
        block.innerHTML = `
            <div class="greeting-bubble">
                Hello doc. <strong>${this.getUserName()}</strong> how should I help you today?
            </div>
            <div class="quick-actions">
                <button class="quick-action-btn" data-prompt="Explain a topic"><i class="fas fa-lightbulb"></i> Explain a topic</button>
                <button class="quick-action-btn" data-prompt="Write an essay"><i class="fas fa-pen"></i> Write an essay</button>
                <button class="quick-action-btn" data-prompt="Make flash cards"><i class="fas fa-card"></i> Make flash cards</button>
                <button class="quick-action-btn" data-prompt="Generate questions"><i class="fas fa-question-circle"></i> Generate questions</button>
            </div>
        `;
        return block;
    }

    getUserName() {
        const user = window.app?.getUser?.() || { name: 'Doctor' };
        return user.name?.split(' ')[0] || 'Doctor';
    }

    removeWelcomeIfExists() {
        const welcome = document.getElementById('welcomeBlock');
        if (welcome) welcome.remove();
    }

    scrollToBottom() {
        this.chatContainer.scrollTop = this.chatContainer.scrollHeight;
    }

    escapeHtml(unsafe) {
        return unsafe.replace(/[&<>"]/g, function(m) {
            return m === '&' ? '&amp;' : m === '<' ? '&lt;' : m === '>' ? '&gt;' : '"' ? '&quot;' : m;
        });
    }

    addUserMessage(text, save = true) {
        const msgDiv = document.createElement('div');
        msgDiv.className = 'message user';
        msgDiv.innerHTML = `<div class="bubble">${this.escapeHtml(text).replace(/\n/g, '<br>')}</div>`;
        this.chatContainer.insertBefore(msgDiv, this.typingIndicator);
        this.scrollToBottom();
    }

    addUserMessageWithFile(text, fileData, save = true) {
        const msgDiv = document.createElement('div');
        msgDiv.className = 'message user';
        let html = `<div class="bubble">${this.escapeHtml(text)}`;
        if (fileData && fileData.type && fileData.type.startsWith('image/')) {
            html += `<br><img src="${fileData.data}" class="image-preview" alt="upload" />`;
        } else if (fileData && fileData.name) {
            html += `<br><i class="fas fa-file" style="margin-right:5px;"></i>${this.escapeHtml(fileData.name)}`;
        }
        html += `</div>`;
        msgDiv.innerHTML = html;
        this.chatContainer.insertBefore(msgDiv, this.typingIndicator);
        this.scrollToBottom();
    }

    addAssistantMessage(text, save = true, meta = null) {
        const msgDiv = document.createElement('div');
        msgDiv.className = 'message assistant';
        const formatted = this.escapeHtml(text).replace(/\n/g, '<br>');
        let metaHtml = '';
        if (meta) {
            metaHtml = `<div class="message-meta">${meta}</div>`;
        }
        msgDiv.innerHTML = `
            <div>
                ${metaHtml}
                <div class="bubble">${formatted}</div>
                <div class="message-actions">
                    <span class="copy-action"><i class="far fa-copy"></i> Copy</span>
                    <span class="regenerate-action"><i class="fas fa-redo-alt"></i> Regenerate</span>
                    <span class="thumbs-up"><i class="far fa-thumbs-up"></i></span>
                    <span class="thumbs-down"><i class="far fa-thumbs-down"></i></span>
                    <span class="speak-action"><i class="fas fa-volume-up"></i></span>
                </div>
            </div>
        `;
        this.chatContainer.insertBefore(msgDiv, this.typingIndicator);
        this.scrollToBottom();

        const copySpan = msgDiv.querySelector('.copy-action');
        const regenSpan = msgDiv.querySelector('.regenerate-action');
        const thumbsUp = msgDiv.querySelector('.thumbs-up');
        const thumbsDown = msgDiv.querySelector('.thumbs-down');
        const speakSpan = msgDiv.querySelector('.speak-action');
        const originalText = text;

        copySpan.addEventListener('click', () => {
            navigator.clipboard?.writeText(originalText).then(() => {
                ui.showToast('Copied to clipboard', 'success');
            }).catch(() => ui.showToast('Press Ctrl+C to copy', 'warning'));
        });

        regenSpan.addEventListener('click', async () => {
            msgDiv.remove();
            this.showTypingIndicator();
            try {
                const response = await ai.regenerateResponse({
                    chatId: this.currentChatId,
                    modes: this.activeModes.map(m => m.type)
                });
                this.hideTypingIndicator();
                this.addAssistantMessage(response.text, false, response.meta);
                await this.loadChats();
            } catch (error) {
                this.hideTypingIndicator();
                ui.showToast(error.message, 'error');
            }
        });

        thumbsUp.addEventListener('click', () => {
            thumbsUp.classList.toggle('active');
            if (thumbsUp.classList.contains('active')) thumbsDown.classList.remove('active');
        });

        thumbsDown.addEventListener('click', () => {
            thumbsDown.classList.toggle('active');
            if (thumbsDown.classList.contains('active')) thumbsUp.classList.remove('active');
        });

        speakSpan.addEventListener('click', () => {
            if (!window.speechSynthesis) {
                ui.showToast('Speech not supported', 'warning');
                return;
            }
            const utterance = new SpeechSynthesisUtterance(originalText);
            window.speechSynthesis.speak(utterance);
        });
    }

    showTypingIndicator() {
        this.typingIndicator.style.display = 'flex';
        this.scrollToBottom();
    }

    hideTypingIndicator() {
        this.typingIndicator.style.display = 'none';
    }

    // ---- Modes ----
    addMode(mode) {
        if (this.activeModes.some(m => m.type === mode.type)) return;
        this.activeModes.push(mode);
        this.renderChips();
    }

    removeMode(type) {
        this.activeModes = this.activeModes.filter(m => m.type !== type);
        this.renderChips();
    }

    renderChips() {
        this.activeFunctionsDiv.innerHTML = '';
        this.activeModes.forEach(mode => {
            const chip = document.createElement('span');
            chip.className = 'function-chip';
            chip.innerHTML = `
                <i class="${mode.icon}"></i>
                <span>${mode.label}</span>
                <i class="fas fa-times remove-chip" data-type="${mode.type}"></i>
            `;
            this.activeFunctionsDiv.appendChild(chip);
        });
        document.querySelectorAll('.remove-chip').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const type = btn.dataset.type;
                this.removeMode(type);
            });
        });
    }

    // ---- Attachments ----
    setPendingAttachment(fileData) {
        this.pendingAttachment = fileData;
        this.renderPendingAttachment();
    }

    clearPendingAttachment() {
        this.pendingAttachment = null;
        this.renderPendingAttachment();
    }

    renderPendingAttachment() {
        this.pendingAttachmentsDiv.innerHTML = '';
        if (this.pendingAttachment) {
            const chip = document.createElement('span');
            chip.className = 'attachment-chip';
            let icon = this.pendingAttachment.type?.startsWith('image/') ? 'fa-image' : 'fa-file';
            chip.innerHTML = `
                <i class="fas ${icon}"></i>
                <span>${this.escapeHtml(this.pendingAttachment.name)}</span>
                <i class="fas fa-times remove-attachment"></i>
            `;
            this.pendingAttachmentsDiv.appendChild(chip);
            chip.querySelector('.remove-attachment').addEventListener('click', this.clearPendingAttachment);
        }
    }

    // ---- Send ----
    async sendUserMessage() {
        const rawText = this.messageInput.value.trim();
        if (!rawText && !this.pendingAttachment) return;

        if (this.currentChatId === null) {
            const title = rawText
                ? (rawText.length > 30 ? rawText.substring(0,30)+'…' : rawText)
                : (this.pendingAttachment ? 'File message' : 'New chat');
            const newChat = await ai.createChat(title);
            this.chats.push(newChat);
            this.currentChatId = newChat.id;
            this.renderChatHistory(this.searchChats.value);
        }

        this.removeWelcomeIfExists();

        const fileData = this.pendingAttachment;
        if (fileData) {
            this.addUserMessageWithFile(rawText || `📎 Uploaded ${fileData.name}`, fileData, true);
            this.clearPendingAttachment();
        } else {
            this.addUserMessage(rawText, true);
        }

        this.messageInput.value = '';
        this.messageInput.style.height = 'auto';
        this.showTypingIndicator();

        try {
            const response = await ai.sendMessageToAI({
                message: rawText,
                chatId: this.currentChatId,
                modes: this.activeModes.map(m => m.type),
                file: fileData
            });
            this.hideTypingIndicator();
            this.addAssistantMessage(response.text, true, response.meta);
            await this.loadChats();
        } catch (error) {
            this.hideTypingIndicator();
            ui.showToast(error.message, 'error');
        }
    }

    // ---- Event listeners ----
    setupEventListeners() {
        // Sidebar toggle
        if (this.menuToggle) {
            this.menuToggle.addEventListener('click', (e) => {
                e.stopPropagation();
                this.sidebar.classList.toggle('open');
            });
        }
        const mainEl = document.querySelector('.main');
        if (mainEl) {
            mainEl.addEventListener('click', () => {
                if (window.innerWidth < 768 && this.sidebar.classList.contains('open')) {
                    this.sidebar.classList.remove('open');
                }
            });
        }

        // New chat
        if (this.newChatBtn) {
            this.newChatBtn.addEventListener('click', async () => {
                this.resetToWelcome();
                this.currentChatId = null;
                this.activeModes = [];
                this.clearPendingAttachment();
                this.renderChips();
                if (window.innerWidth < 768) this.sidebar.classList.remove('open');
            });
        }

        // Settings
        if (this.settingsBtn) {
            this.settingsBtn.addEventListener('click', () => {
                this.settingsModal.style.display = 'flex';
            });
        }
        if (this.closeModalBtn) {
            this.closeModalBtn.addEventListener('click', () => {
                this.settingsModal.style.display = 'none';
            });
        }
        if (this.settingsModal) {
            this.settingsModal.addEventListener('click', (e) => {
                if (e.target === this.settingsModal) this.settingsModal.style.display = 'none';
            });
        }

        if (this.themeToggle) {
            this.themeToggle.addEventListener('click', () => {
                document.body.classList.toggle('light-mode');
            });
        }

        if (this.modelSelect) {
            this.modelSelect.addEventListener('change', () => {
                if (this.currentModelSpan) this.currentModelSpan.textContent = this.modelSelect.value;
            });
        }
        if (this.modelSelectorBtn) {
            this.modelSelectorBtn.addEventListener('click', () => {
                if (this.settingsModal) this.settingsModal.style.display = 'flex';
            });
        }

        if (this.clearHistoryBtn) {
            this.clearHistoryBtn.addEventListener('click', async () => {
                const confirmed = await ui.showConfirmationDialog(
                    'Clear History',
                    'Are you sure you want to delete all chats?',
                    'warning'
                );
                if (confirmed) {
                    await ai.clearAllData();
                    this.chats = [];
                    this.renderChatHistory('');
                    this.resetToWelcome();
                    this.currentChatId = null;
                    this.activeModes = [];
                    this.clearPendingAttachment();
                    this.renderChips();
                    if (this.settingsModal) this.settingsModal.style.display = 'none';
                }
            });
        }

        // Send
        if (this.sendBtn) {
            this.sendBtn.addEventListener('click', this.sendUserMessage);
        }
        if (this.messageInput) {
            this.messageInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    this.sendUserMessage();
                }
            });
            this.messageInput.addEventListener('input', function() {
                this.style.height = 'auto';
                this.style.height = Math.min(this.scrollHeight, 120) + 'px';
            });
        }

        // Search
        if (this.searchChats) {
            this.searchChats.addEventListener('input', (e) => {
                this.renderChatHistory(e.target.value);
            });
        }

        // Quick actions
        if (this.chatContainer) {
            this.chatContainer.addEventListener('click', (e) => {
                const btn = e.target.closest('.quick-action-btn');
                if (btn) {
                    const prompt = btn.getAttribute('data-prompt') || btn.innerText.trim();
                    if (this.messageInput) this.messageInput.value = prompt;
                    this.sendUserMessage();
                }
            });
        }

        // Attachment button
        if (this.attachBtn) {
            this.attachBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (this.attachDropdown) this.attachDropdown.classList.toggle('show');
            });
        }
        document.addEventListener('click', (e) => {
            if (this.attachBtn && this.attachDropdown) {
                if (!this.attachBtn.contains(e.target) && !this.attachDropdown.contains(e.target)) {
                    this.attachDropdown.classList.remove('show');
                }
            }
        });

        // Attachment items
        if (this.attachDropdown) {
            document.querySelectorAll('.attach-item').forEach(item => {
                item.addEventListener('click', () => {
                    const action = item.getAttribute('data-action');
                    if (this.attachDropdown) this.attachDropdown.classList.remove('show');

                    if (action === 'upload image' && this.imageUpload) {
                        this.imageUpload.click();
                        this.imageUpload.onchange = async (e) => {
                            if (e.target.files[0]) {
                                const fileData = await ai.uploadFile(e.target.files[0]);
                                this.setPendingAttachment(fileData);
                            }
                        };
                    } else if (action === 'take photo' && this.photoCapture) {
                        this.photoCapture.click();
                        this.photoCapture.onchange = async (e) => {
                            if (e.target.files[0]) {
                                const fileData = await ai.uploadFile(e.target.files[0]);
                                this.setPendingAttachment(fileData);
                            }
                        };
                    } else if (action === 'upload document' && this.documentUpload) {
                        this.documentUpload.click();
                        this.documentUpload.onchange = async (e) => {
                            if (e.target.files[0]) {
                                const fileData = await ai.uploadFile(e.target.files[0]);
                                this.setPendingAttachment(fileData);
                            }
                        };
                    } else if (action === 'deepthink') {
                        this.addMode({ type: 'deepthink', icon: 'fas fa-brain', label: 'Deepthink' });
                    } else if (action === 'search web') {
                        this.addMode({ type: 'websearch', icon: 'fas fa-globe', label: 'Search Web' });
                    } else if (action === 'references') {
                        this.addMode({ type: 'references', icon: 'fas fa-book', label: 'References' });
                    }
                });
            });
        }

        // Voice
        if (this.voiceBtn) {
            this.voiceBtn.addEventListener('click', () => {
                if (this.isRecording) {
                    this.stopRecording();
                } else {
                    this.startRecording();
                }
            });
        }
        if (this.stopRecordingBtn) {
            this.stopRecordingBtn.addEventListener('click', this.stopRecording.bind(this));
        }
    }

    startRecording() {
        this.isRecording = true;
        if (this.normalInput) this.normalInput.style.display = 'none';
        if (this.voiceRecordingBar) this.voiceRecordingBar.style.display = 'flex';
        this.recordingTimer = setTimeout(() => {
            this.stopRecording();
        }, 3000);
    }

    stopRecording() {
        if (!this.isRecording) return;
        clearTimeout(this.recordingTimer);
        this.isRecording = false;
        if (this.voiceRecordingBar) this.voiceRecordingBar.style.display = 'none';
        if (this.normalInput) this.normalInput.style.display = 'flex';
        if (this.messageInput) {
            this.messageInput.value = "This is a simulated voice transcription.";
            this.messageInput.style.height = 'auto';
            this.messageInput.focus();
        }
    }
}
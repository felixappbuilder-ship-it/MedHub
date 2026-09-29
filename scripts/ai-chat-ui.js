// scripts/ai-chat-ui.js

import * as ui from './ui.js';
import * as utils from './utils.js';
import * as router from './router.js';
import * as auth from './auth.js';
import ai from './ai.js';
import { convexHttpClient } from './convex-client.js';
import { getToken } from './auth.js';

export default class AIChatUI {
    constructor() {
        // DOM elements (unchanged)
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
        this.imageViewerOverlay = null;

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
        this._createImageViewer();
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
        const filtered = this.chats.filter(c => c.title.toLowerCase().includes(filterText.toLowerCase()));
        filtered.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
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

            // ===== SHARE (uses Convex backend) =====
            dropdown.querySelector('.share-item').addEventListener('click', async (e) => {
                e.stopPropagation();
                try {
                    const token = getToken();
                    if (!token) {
                        ui.showToast('You must be logged in to share.', 'error');
                        return;
                    }
                    const result = await convexHttpClient.action('conversations/actions:shareConversation', {
                        token,
                        conversationId: chat.id,
                        expiryHours: 24,
                        
                    });
                    if (result.success) {
                        const shareUrl = result.data.shareUrl; // e.g., `/ai.html?ref=shared&token=...`
                        ui.showToast(`🔗 Shareable link: ${window.location.origin}${shareUrl}`, 'success', 5000);
                    } else {
                        ui.showToast('Failed to create share link: ' + result.message, 'error');
                    }
                } catch (err) {
                    console.error('Share error:', err);
                    ui.showToast('Error sharing conversation', 'error');
                }
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
                this._renderMessageInstant(msg.content, false, msg.meta, msg.richData);
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
        // ✅ Use auth.getUser() instead of window.app?.getUser?.()
        const user = auth.getUser() || { name: 'Doctor' };
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
        return unsafe.replace(/[&<>"]/g, function (m) {
            return m === '&' ? '&amp;' : m === '<' ? '&lt;' : m === '>' ? '&gt;' : '"' ? '&quot;' : m;
        });
    }

    escapeHtmlSafe(text) {
        return text.replace(/[&<>"]/g, m => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;'
        }[m]));
    }

    stripMarkdown(md) {
        let plain = md;
        plain = plain.replace(/!\[.*?\]\(.*?\)/g, '');
        plain = plain.replace(/\[([^\]]+)\]\(.*?\)/g, '$1');
        plain = plain.replace(/\*\*(.+?)\*\*/g, '$1');
        plain = plain.replace(/\*(.+?)\*/g, '$1');
        plain = plain.replace(/`{1,3}(.+?)`{1,3}/g, '$1');
        plain = plain.replace(/\$\$(.+?)\$\$/g, '$1');
        plain = plain.replace(/\$(.+?)\$/g, '$1');
        return plain;
    }

    renderLatex(text) {
        if (!window.katex) return text;
        let result = text.replace(/\$\$(.+?)\$\$/gs, (match, formula) => {
            try {
                return `<div class="latex-block">${katex.renderToString(formula.trim(), { throwOnError: false, displayMode: true })}</div>`;
            } catch (e) {
                return `<div class="latex-block latex-error">${match}</div>`;
            }
        });
        result = result.replace(/\$(.+?)\$/g, (match, formula) => {
            try {
                return `<span class="latex-inline">${katex.renderToString(formula.trim(), { throwOnError: false })}</span>`;
            } catch (e) {
                return match;
            }
        });
        return result;
    }

    renderMarkdown(text) {
        const placeholders = {
            codeBlocks: [],
            inlineCodes: [],
            latex: [],
            images: [],
            links: [],
            safeHtml: []
        };

        const uid = (prefix, idx) => `\u0000${prefix}_${idx}\u0000`;

        let html = text;

        // Fenced code blocks
        html = html.replace(/```(\w*)\s*\n([\s\S]*?)```/g, (match, lang, code) => {
            const idx = placeholders.codeBlocks.length;
            placeholders.codeBlocks.push({
                type: lang === 'mermaid' ? 'mermaid' : 'code',
                lang,
                raw: code.trim(),
                isAscii: lang !== 'mermaid' && this._isAsciiDiagram(code)
            });
            return uid('CB', idx);
        });

        // Inline code
        html = html.replace(/`([^`]+)`/g, (match, code) => {
            const idx = placeholders.inlineCodes.length;
            placeholders.inlineCodes.push(code);
            return uid('IC', idx);
        });

        // LaTeX
        html = html.replace(/\$\$([\s\S]*?)\$\$/g, (match, formula) => {
            const idx = placeholders.latex.length;
            placeholders.latex.push({ type: 'block', formula });
            return uid('LX', idx);
        });
        html = html.replace(/\\\[([\s\S]*?)\\\]/g, (match, formula) => {
            const idx = placeholders.latex.length;
            placeholders.latex.push({ type: 'block', formula });
            return uid('LX', idx);
        });
        html = html.replace(/\$(.+?)\$/g, (match, formula) => {
            const idx = placeholders.latex.length;
            placeholders.latex.push({ type: 'inline', formula });
            return uid('LX', idx);
        });
        html = html.replace(/\\\(([\s\S]*?)\\\)/g, (match, formula) => {
            const idx = placeholders.latex.length;
            placeholders.latex.push({ type: 'inline', formula });
            return uid('LX', idx);
        });
        html = html.replace(/\(\(([\s\S]*?)\)\)/g, (match, formula) => {
            const idx = placeholders.latex.length;
            placeholders.latex.push({ type: 'inline', formula });
            return uid('LX', idx);
        });

        // Images / Video
        html = html.replace(/!\[([^\]]*)\]\(([^\)]+)\)/g, (match, alt, url) => {
            const idx = placeholders.images.length;
            placeholders.images.push({ alt, url });
            return uid('IMG', idx);
        });

        // Standard links
        html = html.replace(/\[([^\]]+)\]\(([^\)]+)\)/g, (match, text, url) => {
            const idx = placeholders.links.length;
            placeholders.links.push({ text, url });
            return uid('LNK', idx);
        });

        // Safe HTML tags
        html = html.replace(/<(\/?)(details|summary|kbd|abbr|sup|sub|mark|del|ins|video|source)([^>]*)>/gi, (match, closing, tag, attrs) => {
            const idx = placeholders.safeHtml.length;
            placeholders.safeHtml.push({ closing, tag, attrs });
            return uid('HTML', idx);
        });

        // Escape remaining raw text
        html = this.escapeHtmlSafe(html);

        // Block elements
        html = this._autoDetectAndWrapAsciiDiagrams(html);
        html = this._renderPerfectTables(html);
        html = this._renderAdmonitions(html);

        // Multi‑line blockquotes
        html = html.replace(/((?:^&gt;\s+.+\n?)+)/gm, (match) => {
            const lines = match.split('\n').filter(l => l.trim());
            const content = lines.map(l => l.replace(/^&gt;\s+/, '')).join('<br>');
            return `<blockquote>${content}</blockquote>`;
        });

        // Definition lists
        html = this._renderPerfectDefinitionLists(html);

        // Headers
        html = html.replace(/^######\s+(.+)$/gm, '<h6>$1</h6>');
        html = html.replace(/^#####\s+(.+)$/gm, '<h5>$1</h5>');
        html = html.replace(/^####\s+(.+)$/gm, '<h4>$1</h4>');
        html = html.replace(/^###\s+(.+)$/gm, '<h3>$1</h3>');
        html = html.replace(/^##\s+(.+)$/gm, '<h2>$1</h2>');
        html = html.replace(/^#\s+(.+)$/gm, '<h1>$1</h1>');
        html = html.replace(/^(---|___|\*\*\*)\s*$/gm, '<hr>');

        // Nested lists
        html = this._renderPerfectNestedLists(html);

        // Inline formatting
        html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
        html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
        html = html.replace(/~~(.+?)~~/g, '<del>$1</del>');
        html = html.replace(/==(.+?)==/g, '<mark>$1</mark>');
        html = html.replace(/~(\w+)~/g, '<sub>$1</sub>');
        html = html.replace(/\^(\w+)\^/g, '<sup>$1</sup>');

        // Abbreviations
        const abbrDefs = new Map();
        html = html.replace(/^\*\[([^\]]+)\]:\s+(.+)$/gm, (match, abbr, expansion) => {
            abbrDefs.set(abbr, expansion);
            return '';
        });
        if (abbrDefs.size) {
            const keys = Array.from(abbrDefs.keys()).map(k => k.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&'));
            const abbrRe = new RegExp(`\\b(${keys.join('|')})\\b`, 'g');
            html = html.replace(abbrRe, (m) => `<abbr title="${this.escapeHtmlSafe(abbrDefs.get(m))}">${m}</abbr>`);
        }

        // Backslash escapes
        html = html.replace(/\\([*_`~\[\]()#+\-.!>])/g, '$1');

        // Line breaks
        html = html.replace(/\n/g, '<br>');

        // Restore placeholders
        html = html.replace(/\u0000CB_(\d+)\u0000/g, (m, i) => {
            const blk = placeholders.codeBlocks[+i];
            const escaped = this.escapeHtmlSafe(blk.raw);
            if (blk.type === 'mermaid') {
                return `<div class="mermaid">${blk.raw}</div>`;
            }
            const cls = blk.isAscii ? 'ascii-diagram' : 'code-block';
            return `<pre class="${cls}"><code>${escaped}</code></pre>`;
        });
        html = html.replace(/\u0000IC_(\d+)\u0000/g, (m, i) => {
            return `<code>${this.escapeHtmlSafe(placeholders.inlineCodes[+i])}</code>`;
        });
        html = html.replace(/\u0000LX_(\d+)\u0000/g, (m, i) => {
            const lx = placeholders.latex[+i];
            if (lx.type === 'block') {
                return `<div class="latex-block">${this._renderLatexFormula(lx.formula, true)}</div>`;
            }
            return `<span class="latex-inline">${this._renderLatexFormula(lx.formula, false)}</span>`;
        });
        html = html.replace(/\u0000IMG_(\d+)\u0000/g, (m, i) => {
            const img = placeholders.images[+i];
            const url = this.escapeHtmlSafe(img.url);
            if (/\.(mp4|webm|ogg)$/i.test(url)) {
                return `<video controls style="max-width:100%; border-radius:8px;" preload="metadata">
                    <source src="${url}" type="video/mp4">${this.escapeHtmlSafe(img.alt)}</video>`;
            }
            return `<img src="${url}" alt="${this.escapeHtmlSafe(img.alt)}" class="rich-image inline-image" loading="lazy">`;
        });
        html = html.replace(/\u0000LNK_(\d+)\u0000/g, (m, i) => {
            const lnk = placeholders.links[+i];
            return `<a href="${this.escapeHtmlSafe(lnk.url)}" target="_blank" rel="noopener noreferrer">${this.escapeHtmlSafe(lnk.text)}</a>`;
        });
        html = html.replace(/\u0000HTML_(\d+)\u0000/g, (m, i) => {
            const h = placeholders.safeHtml[+i];
            return `<${h.closing}${h.tag}${h.attrs}>`;
        });

        // Auto‑linkify remaining URLs
        html = html.replace(/(?<!["'>=])(https?:\/\/[^\s<]+)/g,
            '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');

        // Footnotes
        const footnoteDefs = new Map();
        let fnCounter = 0;
        html = html.replace(/^\[\^(\d+|\w+)\]:\s+(.+)$/gm, (m, id, def) => {
            footnoteDefs.set(id, { def: def.trim(), index: ++fnCounter });
            return '';
        });
        html = html.replace(/\[\^(\d+|\w+)\](?!\])/g, (m, id) => {
            const d = footnoteDefs.get(id);
            if (!d) return m;
            return `<sup class="footnote-ref" id="fnref:${id}"><a href="#fn:${id}">${d.index}</a></sup>`;
        });
        if (footnoteDefs.size) {
            let fnHtml = '<hr><ol class="footnotes-list">';
            const sorted = [...footnoteDefs.entries()].sort((a, b) => a[1].index - b[1].index);
            sorted.forEach(([id, d]) => {
                fnHtml += `<li id="fn:${id}"><a href="#fnref:${id}">↩</a> ${d.def}</li>`;
            });
            fnHtml += '</ol>';
            html += fnHtml;
        }

        // Final cleanup
        html = html.replace(/<br>\s*<br>/g, '<br>');
        return html;
    }

    // ========== PERFECT HELPERS ==========

    _renderPerfectTables(html) {
        const tableRe = /\|(.+)\|\s*\n\|([-:| ]+)\|\s*\n((?:\|.+\|\s*\n?)+)/g;
        return html.replace(tableRe, (match, headerRow, sepRow, dataRows) => {
            const headers = headerRow.split('|').map(c => c.trim());
            const alignCells = sepRow.split('|').filter(c => c.trim());
            const alignments = alignCells.map(c => {
                if (c.startsWith(':') && c.endsWith(':')) return 'center';
                if (c.endsWith(':')) return 'right';
                return 'left';
            });
            const dataLines = dataRows.trim().split('\n').filter(l => l.trim());
            let table = '<table class="md-table"><thead><tr>';
            headers.forEach((h, i) => {
                table += `<th style="text-align:${alignments[i] || 'left'}">${h}</th>`;
            });
            table += '</tr></thead><tbody>';
            dataLines.forEach(line => {
                const cells = line.split('|').filter(c => c.trim());
                table += '<tr>';
                cells.forEach((c, j) => {
                    table += `<td style="text-align:${alignments[j] || 'left'}">${c}</td>`;
                });
                table += '</tr>';
            });
            table += '</tbody></table>';
            return table;
        });
    }

    _renderPerfectDefinitionLists(html) {
        const lines = html.split('\n');
        const out = [];
        let i = 0;
        while (i < lines.length) {
            const line = lines[i];
            if (i + 1 < lines.length && !/^:\s/.test(line) && /^:\s/.test(lines[i + 1])) {
                out.push('<dl>');
                let term = line.trim();
                if (term) out.push(`<dt>${term}</dt>`);
                i++;
                while (i < lines.length && /^:\s/.test(lines[i])) {
                    const def = lines[i].replace(/^:\s+/, '');
                    out.push(`<dd>${def}</dd>`);
                    i++;
                }
                out.push('</dl>');
            } else {
                out.push(line);
                i++;
            }
        }
        return out.join('\n');
    }

    _renderPerfectNestedLists(html) {
        const lines = html.split('\n');
        const stack = [];
        const output = [];
        for (let i = 0; i < lines.length; i++) {
            const raw = lines[i];
            const trimmed = raw.trimStart();
            const indent = raw.length - trimmed.length;

            let match = trimmed.match(/^[\*\-+]\s+\[([ xX])\]\s+(.+)$/);
            let isTask = true;
            if (!match) {
                match = trimmed.match(/^[\*\-+]\s+(.+)$/);
                isTask = false;
            }
            if (!match) {
                match = trimmed.match(/^(\d+)\.\s+(.+)$/);
                isTask = false;
            }

            if (match) {
                const content = match[2] || match[1];
                const tag = match[2] ? (isTask ? 'ul' : 'ul') : 'ol';
                const isChecked = isTask && /^\[[xX]\]$/.test(match[1]) ? true : false;

                while (stack.length > 0 && stack[stack.length - 1].indent > indent) {
                    const closed = stack.pop();
                    output.push(`</${closed.tag}>`);
                }

                if (stack.length === 0 || stack[stack.length - 1].indent < indent ||
                    (stack.length > 0 && stack[stack.length - 1].indent === indent && stack[stack.length - 1].tag !== tag)) {
                    output.push(`<${tag}>`);
                    stack.push({ tag, indent });
                }

                if (isTask) {
                    output.push(`<li class="task-list-item"><input type="checkbox" disabled ${isChecked ? 'checked' : ''}> ${content}</li>`);
                } else {
                    output.push(`<li>${content}</li>`);
                }
            } else {
                while (stack.length > 0) {
                    output.push(`</${stack.pop().tag}>`);
                }
                output.push(raw);
            }
        }
        while (stack.length > 0) {
            output.push(`</${stack.pop().tag}>`);
        }
        return output.join('\n');
    }

    _renderLatexFormula(formula, displayMode) {
        if (!window.katex) return this.escapeHtmlSafe(formula);
        try {
            return katex.renderToString(formula.trim(), { throwOnError: false, displayMode });
        } catch (e) {
            return `<span class="latex-error">${this.escapeHtmlSafe(formula)}</span>`;
        }
    }

    _isAsciiDiagram(text) {
        const lines = text.split('\n').filter(l => l.trim().length > 0);
        if (lines.length < 3) return false;
        let diagramLineCount = 0;
        const diagramPatterns = [
            /[|+\-]{3,}/,
            /[─┌┐└┘├┤┬┴┼│─━]+/,
            /v\s*$/,
            />\s*$/,
            /^\s*\+[\-+]+\+/,
            /[←→↑↓↔↕↨↲↳]+/,
            /^\s{2,}[|]/,
            /[|]\s{2,}[|]/,
            /^[|\-+\s]+$/
        ];
        for (const line of lines) {
            if (diagramPatterns.some(p => p.test(line))) diagramLineCount++;
        }
        return diagramLineCount >= Math.ceil(lines.length * 0.4);
    }

    _autoDetectAndWrapAsciiDiagrams(html) {
        const lines = html.split('<br>');
        const result = [];
        let asciiBuffer = [];
        let inAsciiBlock = false;
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const plainLine = line.replace(/<[^>]+>/g, '');
            const isDiagramLine = plainLine.length > 0 && this._isAsciiDiagram(plainLine);

            if (isDiagramLine && !inAsciiBlock) {
                inAsciiBlock = true;
                asciiBuffer = [line];
            } else if (isDiagramLine && inAsciiBlock) {
                asciiBuffer.push(line);
            } else if (!isDiagramLine && inAsciiBlock) {
                if (asciiBuffer.length >= 2) {
                    const diagramHtml = asciiBuffer.join('\n');
                    result.push(`<pre class="ascii-diagram"><code>${diagramHtml}</code></pre>`);
                } else {
                    result.push(...asciiBuffer);
                }
                result.push(line);
                inAsciiBlock = false;
                asciiBuffer = [];
            } else {
                result.push(line);
            }
        }
        if (inAsciiBlock && asciiBuffer.length >= 2) {
            const diagramHtml = asciiBuffer.join('\n');
            result.push(`<pre class="ascii-diagram"><code>${diagramHtml}</code></pre>`);
        } else if (inAsciiBlock) {
            result.push(...asciiBuffer);
        }
        return result.join('<br>');
    }

    _renderAdmonitions(html) {
        const admonitionRegex = /!!!(\w+)\s+(.+?)\n([\s\S]*?)(?=\n(?:!!!|```|$)|$)/g;
        return html.replace(admonitionRegex, (match, type, title, content) => {
            const validTypes = ['note', 'warning', 'tip', 'danger', 'info', 'success'];
            const iconMap = {
                note: '📝',
                warning: '⚠️',
                tip: '💡',
                danger: '🚨',
                info: 'ℹ️',
                success: '✅'
            };
            const cleanType = validTypes.includes(type) ? type : 'info';
            const icon = iconMap[cleanType] || 'ℹ️';
            const cleanContent = content.trim().replace(/\n/g, '<br>');
            return `<div class="admonition admonition-${cleanType}">
                <div class="admonition-header"><span class="admonition-icon">${icon}</span> ${title}</div>
                <div class="admonition-content">${cleanContent}</div>
            </div>`;
        });
    }

    buildRichMetaBar(richData) {
        if (!richData) return '';
        const parts = [];
        if (richData.modelUsed) parts.push(`🧠 ${richData.modelUsed}`);
        if (richData.thinkingTime) parts.push(`⏱ ${richData.thinkingTime}s`);
        if (richData.webPagesRead) parts.push(`🌐 ${richData.webPagesRead} pages`);
        if (richData.cost) parts.push(`💰 $${richData.cost}`);
        return parts.length ? `<div class="meta-bar">${parts.join(' · ')}</div>` : '';
    }

    renderRichDataCards(richData) {
        if (!richData) return '';
        let html = '<div class="rich-data-section">';
        if (richData.formulas && richData.formulas.length) {
            html += '<div class="formulas-group">';
            richData.formulas.forEach(f => {
                html += `
                    <div class="formula-card">
                        <div class="formula-desc">${this.escapeHtmlSafe(f.description)}</div>
                        <div class="formula-equation">${this.renderLatex(this.escapeHtmlSafe(f.formula))}</div>
                    </div>`;
            });
            html += '</div>';
        }
        if (richData.mnemonics && richData.mnemonics.length) {
            html += '<div class="mnemonics-group">';
            richData.mnemonics.forEach(m => {
                html += `<div class="mnemonic-card">${this.renderMarkdown(m)}</div>`;
            });
            html += '</div>';
        }
        if (richData.references && richData.references.length) {
            html += '<div class="references-group">';
            html += '<h4 class="rich-heading">References</h4>';
            richData.references.forEach(ref => {
                html += `<div class="reference-item">${this.escapeHtmlSafe(ref)}</div>`;
            });
            html += '</div>';
        }
        if (richData.sources && richData.sources.length) {
            html += '<div class="sources-group">';
            html += '<h4 class="rich-heading">Sources</h4>';
            html += '<div class="source-chips">';
            richData.sources.forEach(url => {
                html += `<a href="${this.escapeHtmlSafe(url)}" target="_blank" rel="noopener" class="source-chip">${this.escapeHtmlSafe(url)}</a>`;
            });
            html += '</div></div>';
        }
        if (richData.images && richData.images.length) {
            html += '<div class="images-group">';
            html += '<div class="images-row">';
            richData.images.forEach(imgUrl => {
                if (imgUrl && imgUrl.trim() !== '') {
                    html += `<img src="${this.escapeHtmlSafe(imgUrl)}" alt="Medical Image" class="rich-image" loading="lazy">`;
                }
            });
            html += '</div></div>';
        }
        html += '</div>';
        return html;
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

    _parseResponse(text, richData) {
        let actualText = text;
        let actualRichData = richData;
        if (typeof text === 'string') {
            const trimmed = text.trim();
            if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
                try {
                    const parsed = JSON.parse(trimmed);
                    if (parsed.text) {
                        actualText = parsed.text;
                        if (!actualRichData && parsed.richData) actualRichData = parsed.richData;
                    }
                } catch (e) {}
            }
            if (trimmed.startsWith('```json')) {
                const regex = /```json\s*([\s\S]*?)\s*```/;
                const match = text.match(regex);
                if (match && match[1]) {
                    try {
                        const parsed = JSON.parse(match[1].trim());
                        if (parsed.text) {
                            actualText = parsed.text;
                            if (!actualRichData && parsed.richData) actualRichData = parsed.richData;
                        }
                    } catch (e) {}
                }
            }
        }
        return { actualText, actualRichData };
    }

    _buildAssistantMessageElement(text, meta, richData, enableTyping) {
        const msgDiv = document.createElement('div');
        msgDiv.className = 'message assistant';
        let metaHtml = this.buildRichMetaBar(richData);
        if (!metaHtml && meta) metaHtml = `<div class="message-meta">${meta}</div>`;

        const htmlContent = this.renderMarkdown(text);
        const richCardsHtml = this.renderRichDataCards(richData);

        msgDiv.innerHTML = `
            ${metaHtml}
            <div class="assistant-content ${enableTyping ? 'typing-effect' : ''}">${htmlContent}</div>
            ${richCardsHtml}
            <div class="message-actions">
                <span class="copy-action"><i class="far fa-copy"></i> Copy</span>
                <span class="regenerate-action"><i class="fas fa-redo-alt"></i> Regenerate</span>
                <span class="thumbs-up"><i class="far fa-thumbs-up"></i></span>
                <span class="thumbs-down"><i class="far fa-thumbs-down"></i></span>
                <span class="speak-action"><i class="fas fa-volume-up"></i></span>
            </div>
        `;
        return msgDiv;
    }

    _attachMessageListeners(msgDiv, text) {
        const plainText = this.stripMarkdown(text);
        const copySpan = msgDiv.querySelector('.copy-action');
        const regenSpan = msgDiv.querySelector('.regenerate-action');
        const thumbsUp = msgDiv.querySelector('.thumbs-up');
        const thumbsDown = msgDiv.querySelector('.thumbs-down');
        const speakSpan = msgDiv.querySelector('.speak-action');

        copySpan.addEventListener('click', () => {
            navigator.clipboard?.writeText(plainText).then(() => {
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
                this._renderMessageStreaming(response.text, false, response.meta, response.richData);
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
            const utterance = new SpeechSynthesisUtterance(plainText);
            window.speechSynthesis.speak(utterance);
        });
    }

    _renderMessageInstant(text, save = true, meta = null, richData = null) {
        const { actualText, actualRichData } = this._parseResponse(text, richData);
        const msgDiv = this._buildAssistantMessageElement(actualText, meta, actualRichData, false);
        this.chatContainer.insertBefore(msgDiv, this.typingIndicator);
        this.scrollToBottom();
        this._attachMessageListeners(msgDiv, actualText);
        this._setupImageLightbox(msgDiv);
    }

    _renderMessageStreaming(text, save = true, meta = null, richData = null) {
        const { actualText, actualRichData } = this._parseResponse(text, richData);
        const msgDiv = this._buildAssistantMessageElement(actualText, meta, actualRichData, true);
        this.chatContainer.insertBefore(msgDiv, this.typingIndicator);
        this.scrollToBottom();

        const contentDiv = msgDiv.querySelector('.assistant-content');
        const totalChars = actualText.length;
        let revealed = 0;
        const speed = totalChars > 500 ? 4 : (totalChars > 100 ? 10 : 20);
        const step = Math.max(1, Math.floor(totalChars / 50));

        if (totalChars === 0) {
            this._attachMessageListeners(msgDiv, actualText);
            this._setupImageLightbox(msgDiv);
            return;
        }

        const interval = setInterval(() => {
            revealed += step;
            if (revealed >= totalChars) {
                revealed = totalChars;
                clearInterval(interval);
                contentDiv.classList.remove('typing-effect');
                contentDiv.style.removeProperty('--reveal-percentage');
                this._attachMessageListeners(msgDiv, actualText);
                this._setupImageLightbox(msgDiv);
                return;
            }
            contentDiv.style.setProperty('--reveal-percentage', `${(revealed / totalChars) * 100}%`);
        }, speed);
    }

    showTypingIndicator() {
        this.typingIndicator.style.display = 'flex';
        this.scrollToBottom();
    }

    hideTypingIndicator() {
        this.typingIndicator.style.display = 'none';
    }

    // ===== IMAGE VIEWER (LIGHTBOX) =====
    _createImageViewer() {
        if (this.imageViewerOverlay) return;
        const overlay = document.createElement('div');
        overlay.className = 'image-viewer-overlay';
        overlay.innerHTML = `
            <span class="close-viewer">&times;</span>
            <img src="" alt="Enlarged Image" />
        `;
        document.body.appendChild(overlay);
        this.imageViewerOverlay = overlay;
        const closeBtn = overlay.querySelector('.close-viewer');
        closeBtn.addEventListener('click', () => this._closeImageViewer());
        overlay.addEventListener('click', () => this._closeImageViewer());
    }

    _setupImageLightbox(msgDiv) {
        const images = msgDiv.querySelectorAll('.rich-image');
        images.forEach(img => {
            img.removeEventListener('click', this._openImageViewerHandler);
            const handler = () => this._openImageViewer(img.src);
            img.addEventListener('click', handler);
            img._lightboxHandler = handler;
        });
    }

    _openImageViewer(src) {
        if (!this.imageViewerOverlay) return;
        const img = this.imageViewerOverlay.querySelector('img');
        img.src = src;
        this.imageViewerOverlay.classList.add('active');
        document.body.style.overflow = 'hidden';
    }

    _closeImageViewer() {
        if (!this.imageViewerOverlay) return;
        this.imageViewerOverlay.classList.remove('active');
        document.body.style.overflow = '';
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
                ? (rawText.length > 30 ? rawText.substring(0, 30) + '…' : rawText)
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
            this._renderMessageStreaming(response.text, true, response.meta, response.richData);
            await this.loadChats();
        } catch (error) {
            this.hideTypingIndicator();
            ui.showToast(error.message, 'error');
        }
    }

    // ---- Event listeners ----
    setupEventListeners() {
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
            this.messageInput.addEventListener('input', function () {
                this.style.height = 'auto';
                this.style.height = Math.min(this.scrollHeight, 120) + 'px';
            });
        }
        if (this.searchChats) {
            this.searchChats.addEventListener('input', (e) => {
                this.renderChatHistory(e.target.value);
            });
        }
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
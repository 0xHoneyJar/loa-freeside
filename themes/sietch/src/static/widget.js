/**
 * Freeside Chat Widget v1.0.0
 * Sprint 6 (319), Task 6.6
 *
 * Embeddable web chat widget for interacting with AI agents.
 * Usage: <script src="https://api.arrakis.community/widget/v1/widget.js"></script>
 *
 * Configuration via data attributes:
 *   data-token-id="123"     — Agent token ID
 *   data-theme="dark"       — Theme (dark|light)
 *   data-position="bottom-right" — Position on page
 */
(function () {
  'use strict';

  // Prevent double-initialization
  if (window.__FREESIDE_WIDGET_LOADED) return;
  window.__FREESIDE_WIDGET_LOADED = true;

  // ─── Configuration ───────────────────────────────────────────────────────

  var script = document.currentScript;
  var CONFIG = {
    tokenId: script ? script.getAttribute('data-token-id') : null,
    theme: (script ? script.getAttribute('data-theme') : null) || 'dark',
    position: (script ? script.getAttribute('data-position') : null) || 'bottom-right',
    wsUrl: (script ? script.getAttribute('data-ws-url') : null) ||
      (window.location.protocol === 'https:' ? 'wss://' : 'ws://') +
      (script ? new URL(script.src).host : window.location.host) + '/ws/chat',
  };

  // ─── Styles ──────────────────────────────────────────────────────────────

  var COLORS = {
    dark: {
      bg: '#1a1a2e', surface: '#16213e', text: '#e0e0e0',
      accent: '#f5a623', border: '#2a2a4a', input: '#0f3460',
      muted: '#888', bubble_user: '#f5a623', bubble_agent: '#16213e',
    },
    light: {
      bg: '#ffffff', surface: '#f5f5f5', text: '#333333',
      accent: '#f5a623', border: '#e0e0e0', input: '#ffffff',
      muted: '#666', bubble_user: '#f5a623', bubble_agent: '#f0f0f0',
    },
  };

  var colors = COLORS[CONFIG.theme] || COLORS.dark;

  var css = [
    '#freeside-widget-toggle{position:fixed;z-index:99999;width:56px;height:56px;border-radius:50%;',
    'background:' + colors.accent + ';border:none;cursor:pointer;box-shadow:0 4px 12px rgba(0,0,0,0.3);',
    'display:flex;align-items:center;justify-content:center;transition:transform 0.2s;}',
    '#freeside-widget-toggle:hover{transform:scale(1.1);}',
    '#freeside-widget-toggle svg{width:28px;height:28px;fill:#fff;}',

    '#freeside-widget-container{position:fixed;z-index:99998;width:380px;height:520px;',
    'border-radius:12px;overflow:hidden;display:none;flex-direction:column;',
    'background:' + colors.bg + ';border:1px solid ' + colors.border + ';',
    'box-shadow:0 8px 32px rgba(0,0,0,0.4);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;}',

    '#freeside-widget-container.open{display:flex;}',

    '#freeside-widget-header{padding:12px 16px;background:' + colors.surface + ';',
    'border-bottom:1px solid ' + colors.border + ';display:flex;align-items:center;gap:10px;}',
    '#freeside-widget-header .agent-name{font-weight:600;color:' + colors.text + ';font-size:14px;flex:1;}',
    '#freeside-widget-header .status{width:8px;height:8px;border-radius:50%;background:#4caf50;}',
    '#freeside-widget-header .close-btn{background:none;border:none;cursor:pointer;color:' + colors.muted + ';font-size:18px;padding:0 4px;}',

    '#freeside-widget-messages{flex:1;overflow-y:auto;padding:12px 16px;display:flex;flex-direction:column;gap:8px;}',
    '.fw-msg{max-width:85%;padding:8px 12px;border-radius:12px;font-size:13px;line-height:1.4;word-wrap:break-word;}',
    '.fw-msg.user{align-self:flex-end;background:' + colors.bubble_user + ';color:#1a1a2e;border-bottom-right-radius:4px;}',
    '.fw-msg.agent{align-self:flex-start;background:' + colors.bubble_agent + ';color:' + colors.text + ';border:1px solid ' + colors.border + ';border-bottom-left-radius:4px;}',
    '.fw-msg.system{align-self:center;color:' + colors.muted + ';font-size:11px;font-style:italic;}',

    '#freeside-widget-input-area{padding:10px 12px;background:' + colors.surface + ';border-top:1px solid ' + colors.border + ';display:flex;gap:8px;}',
    '#freeside-widget-input{flex:1;padding:8px 12px;border-radius:20px;border:1px solid ' + colors.border + ';',
    'background:' + colors.input + ';color:' + colors.text + ';font-size:13px;outline:none;}',
    '#freeside-widget-input:focus{border-color:' + colors.accent + ';}',
    '#freeside-widget-input::placeholder{color:' + colors.muted + ';}',
    '#freeside-widget-send{width:36px;height:36px;border-radius:50%;background:' + colors.accent + ';',
    'border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;}',
    '#freeside-widget-send:disabled{opacity:0.5;cursor:not-allowed;}',
    '#freeside-widget-send svg{width:16px;height:16px;fill:#fff;}',

    '#freeside-widget-auth-bar{padding:8px 16px;background:' + colors.surface + ';',
    'border-top:1px solid ' + colors.border + ';text-align:center;font-size:11px;color:' + colors.muted + ';}',
    '#freeside-widget-auth-bar a{color:' + colors.accent + ';text-decoration:none;}',
  ];

  // Position the toggle and container
  var posMap = {
    'bottom-right': { toggle: 'bottom:20px;right:20px;', container: 'bottom:88px;right:20px;' },
    'bottom-left': { toggle: 'bottom:20px;left:20px;', container: 'bottom:88px;left:20px;' },
  };
  var pos = posMap[CONFIG.position] || posMap['bottom-right'];
  css[0] = '#freeside-widget-toggle{position:fixed;z-index:99999;' + pos.toggle + css[0].split('position:fixed;z-index:99999;')[1];
  css.push('#freeside-widget-container{' + pos.container + '}');

  // ─── DOM Creation ────────────────────────────────────────────────────────

  var styleEl = document.createElement('style');
  styleEl.textContent = css.join('\n');
  document.head.appendChild(styleEl);

  // Toggle button
  var toggle = document.createElement('button');
  toggle.id = 'freeside-widget-toggle';
  toggle.setAttribute('aria-label', 'Open chat');
  toggle.innerHTML = '<svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z"/></svg>';
  document.body.appendChild(toggle);

  // Container
  var container = document.createElement('div');
  container.id = 'freeside-widget-container';
  container.innerHTML = [
    '<div id="freeside-widget-header">',
    '  <span class="status"></span>',
    '  <span class="agent-name">Freeside Agent</span>',
    '  <button class="close-btn" aria-label="Close chat">&times;</button>',
    '</div>',
    '<div id="freeside-widget-messages"></div>',
    '<div id="freeside-widget-auth-bar" style="display:none;">',
    '  Connect wallet to chat &mdash; <a href="/chat" target="_blank">open full page</a>',
    '</div>',
    '<div id="freeside-widget-input-area">',
    '  <input id="freeside-widget-input" placeholder="Type a message..." autocomplete="off" />',
    '  <button id="freeside-widget-send" aria-label="Send"><svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg></button>',
    '</div>',
  ].join('');
  document.body.appendChild(container);

  // ─── Element References ──────────────────────────────────────────────────

  var messagesEl = document.getElementById('freeside-widget-messages');
  var inputEl = document.getElementById('freeside-widget-input');
  var sendBtn = document.getElementById('freeside-widget-send');
  var closeBtn = container.querySelector('.close-btn');
  var authBar = document.getElementById('freeside-widget-auth-bar');
  var statusDot = container.querySelector('.status');
  var agentName = container.querySelector('.agent-name');

  // ─── State ───────────────────────────────────────────────────────────────

  var ws = null;
  var isOpen = false;
  var isAuthenticated = false;
  var isStreaming = false;
  var currentStreamEl = null;
  var reconnectAttempts = 0;
  var maxReconnectAttempts = 5;
  var reconnectTimer = null;

  // ─── Message Rendering ───────────────────────────────────────────────────

  function addMessage(text, type) {
    var el = document.createElement('div');
    el.className = 'fw-msg ' + type;
    el.textContent = text;
    messagesEl.appendChild(el);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return el;
  }

  function startStreamMessage() {
    var el = document.createElement('div');
    el.className = 'fw-msg agent';
    el.textContent = '';
    messagesEl.appendChild(el);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    currentStreamEl = el;
    return el;
  }

  function appendStreamToken(content) {
    if (currentStreamEl) {
      currentStreamEl.textContent += content;
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }
  }

  function endStream() {
    currentStreamEl = null;
    isStreaming = false;
    sendBtn.disabled = false;
    inputEl.disabled = false;
    inputEl.focus();
  }

  // ─── WebSocket Connection ────────────────────────────────────────────────

  function connect() {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    var url = CONFIG.wsUrl + (CONFIG.tokenId ? '?tokenId=' + encodeURIComponent(CONFIG.tokenId) : '');

    try {
      ws = new WebSocket(url);
    } catch (err) {
      addMessage('Failed to connect. Please try again.', 'system');
      return;
    }

    ws.onopen = function () {
      reconnectAttempts = 0;
      statusDot.style.background = '#4caf50';
    };

    ws.onmessage = function (event) {
      var msg;
      try { msg = JSON.parse(event.data); } catch (e) { return; }

      switch (msg.type) {
        case 'welcome':
          isAuthenticated = msg.payload.authenticated;
          if (!isAuthenticated) {
            authBar.style.display = 'block';
            inputEl.placeholder = 'Connect wallet to chat...';
            inputEl.disabled = true;
            sendBtn.disabled = true;
          } else {
            authBar.style.display = 'none';
            inputEl.disabled = false;
            sendBtn.disabled = false;
          }
          addMessage('Connected to Freeside Agent', 'system');
          break;

        case 'stream_start':
          isStreaming = true;
          sendBtn.disabled = true;
          inputEl.disabled = true;
          startStreamMessage();
          break;

        case 'stream_token':
          if (msg.payload && msg.payload.content) {
            appendStreamToken(msg.payload.content);
          }
          break;

        case 'stream_end':
          endStream();
          break;

        case 'error':
          addMessage(msg.payload ? msg.payload.message : 'An error occurred', 'system');
          endStream();
          break;

        case 'server_drain':
          addMessage('Server restarting — reconnecting shortly...', 'system');
          statusDot.style.background = '#ff9800';
          break;

        case 'pong':
          break;
      }
    };

    ws.onclose = function (event) {
      statusDot.style.background = '#f44336';
      if (event.code !== 1000 && reconnectAttempts < maxReconnectAttempts) {
        var delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000);
        reconnectAttempts++;
        addMessage('Disconnected. Reconnecting in ' + Math.round(delay / 1000) + 's...', 'system');
        reconnectTimer = setTimeout(connect, delay);
      } else if (reconnectAttempts >= maxReconnectAttempts) {
        addMessage('Connection lost. Please refresh the page.', 'system');
      }
    };

    ws.onerror = function () {
      // onclose will fire next
    };
  }

  function sendMessage() {
    var text = inputEl.value.trim();
    if (!text || !ws || ws.readyState !== WebSocket.OPEN || isStreaming) return;

    addMessage(text, 'user');
    ws.send(JSON.stringify({
      type: 'chat',
      payload: { message: text, tokenId: CONFIG.tokenId },
    }));
    inputEl.value = '';
  }

  // ─── Event Listeners ────────────────────────────────────────────────────

  toggle.addEventListener('click', function () {
    isOpen = !isOpen;
    container.classList.toggle('open', isOpen);
    if (isOpen) {
      connect();
      if (!inputEl.disabled) inputEl.focus();
    }
  });

  closeBtn.addEventListener('click', function () {
    isOpen = false;
    container.classList.remove('open');
  });

  sendBtn.addEventListener('click', sendMessage);

  inputEl.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  // Keyboard accessibility
  toggle.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggle.click();
    }
  });
})();

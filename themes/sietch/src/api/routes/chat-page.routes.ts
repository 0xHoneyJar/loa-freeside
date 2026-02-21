/**
 * Sprint 6 (319), Task 6.8: Standalone Chat Page
 *
 * Shareable chat page at /chat/:tokenId for agent conversations.
 * - Read-only without auth (view agent personality, observe)
 * - SIWE login required to send messages
 * - Mobile-responsive layout
 * - Rate-limited per session via WS layer
 */

import { Router, type Request, type Response } from 'express';
import { getConfig } from '../../config.js';

export const chatPageRouter = Router();

// Sprint 7 (320), Task 7.3: Feature flag kill switch
chatPageRouter.use((_req: Request, res: Response, next) => {
  const config = getConfig();
  if (!config.features.webChatEnabled) {
    res.status(503).send('Web chat is currently disabled');
    return;
  }
  next();
});

/**
 * GET /chat/:tokenId — Standalone agent chat page
 */
chatPageRouter.get('/:tokenId', (req: Request, res: Response) => {
  const { tokenId } = req.params;

  // Basic tokenId validation — alphanumeric, hyphens, underscores, 1-64 chars
  if (!tokenId || !/^[a-zA-Z0-9_-]{1,64}$/.test(tokenId)) {
    res.status(400).send('Invalid token ID');
    return;
  }

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(getChatPage(tokenId));
});

// ─── HTML Template ────────────────────────────────────────────────────────────

function getChatPage(tokenId: string): string {
  // Escape tokenId for safe embedding in HTML/JS
  const safeTokenId = tokenId.replace(/[&<>"']/g, '');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Chat — Freeside</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    :root{--bg:#0d1117;--bg2:#161b22;--bg3:#21262d;--fg:#e0e0e0;--fg2:#8b949e;--accent:#58a6ff;--accent2:#1f6feb;--success:#3fb950;--error:#f85149;--radius:8px}
    body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:var(--bg);color:var(--fg);display:flex;flex-direction:column;height:100vh;overflow:hidden}
    header{background:var(--bg2);border-bottom:1px solid var(--bg3);padding:.75rem 1rem;display:flex;align-items:center;justify-content:space-between;flex-shrink:0}
    header h1{font-size:1.1rem;color:var(--accent);font-weight:600}
    header .status{font-size:.75rem;color:var(--fg2);display:flex;align-items:center;gap:.5rem}
    header .dot{width:8px;height:8px;border-radius:50%;display:inline-block}
    header .dot.connected{background:var(--success)}
    header .dot.disconnected{background:var(--error)}
    header .dot.connecting{background:#d29922}
    .chat-area{flex:1;overflow-y:auto;padding:1rem;display:flex;flex-direction:column;gap:.75rem}
    .msg{max-width:80%;padding:.6rem .9rem;border-radius:var(--radius);line-height:1.5;word-wrap:break-word;font-size:.95rem}
    .msg.user{align-self:flex-end;background:var(--accent2);color:#fff;border-bottom-right-radius:2px}
    .msg.agent{align-self:flex-start;background:var(--bg2);border:1px solid var(--bg3);border-bottom-left-radius:2px}
    .msg.system{align-self:center;background:transparent;color:var(--fg2);font-size:.8rem;font-style:italic}
    .msg.error{align-self:center;color:var(--error);font-size:.85rem}
    .input-area{background:var(--bg2);border-top:1px solid var(--bg3);padding:.75rem 1rem;display:flex;gap:.5rem;flex-shrink:0}
    .input-area textarea{flex:1;background:var(--bg);border:1px solid var(--bg3);color:var(--fg);padding:.5rem .75rem;border-radius:var(--radius);resize:none;font-family:inherit;font-size:.95rem;line-height:1.4;min-height:40px;max-height:120px}
    .input-area textarea:focus{outline:none;border-color:var(--accent)}
    .input-area textarea:disabled{opacity:.5;cursor:not-allowed}
    .input-area button{background:var(--accent2);color:#fff;border:none;padding:.5rem 1rem;border-radius:var(--radius);cursor:pointer;font-weight:600;font-size:.9rem;white-space:nowrap}
    .input-area button:hover{background:var(--accent)}
    .input-area button:disabled{opacity:.4;cursor:not-allowed}
    .auth-bar{background:var(--bg2);border-top:1px solid var(--bg3);padding:1rem;text-align:center;flex-shrink:0}
    .auth-bar p{color:var(--fg2);margin-bottom:.75rem;font-size:.9rem}
    .auth-bar button{background:var(--accent2);color:#fff;border:none;padding:.6rem 1.5rem;border-radius:var(--radius);cursor:pointer;font-weight:600;font-size:.95rem}
    .auth-bar button:hover{background:var(--accent)}
    .auth-bar button:disabled{opacity:.5;cursor:not-allowed}
    @media(max-width:600px){.msg{max-width:90%}header{padding:.5rem .75rem}.input-area{padding:.5rem}.chat-area{padding:.75rem .5rem}}
  </style>
</head>
<body>
  <header>
    <h1 id="agent-name">Agent Chat</h1>
    <div class="status">
      <span class="dot disconnected" id="status-dot"></span>
      <span id="status-text">Disconnected</span>
    </div>
  </header>

  <div class="chat-area" id="chat-area">
    <div class="msg system">Connecting to agent...</div>
  </div>

  <div class="auth-bar" id="auth-bar" style="display:none">
    <p>Connect your wallet to send messages</p>
    <button id="siwe-btn" onclick="startSiweLogin()">Sign In with Ethereum</button>
  </div>

  <div class="input-area" id="input-area" style="display:none">
    <textarea id="msg-input" placeholder="Type a message..." rows="1" maxlength="2000"></textarea>
    <button id="send-btn" onclick="sendMessage()">Send</button>
  </div>

<script>
(function() {
  'use strict';

  var TOKEN_ID = '${safeTokenId}';
  var ws = null;
  var authenticated = false;
  var reconnectAttempts = 0;
  var maxReconnect = 5;
  var streaming = false;
  var streamEl = null;

  var chatArea = document.getElementById('chat-area');
  var authBar = document.getElementById('auth-bar');
  var inputArea = document.getElementById('input-area');
  var msgInput = document.getElementById('msg-input');
  var sendBtn = document.getElementById('send-btn');
  var statusDot = document.getElementById('status-dot');
  var statusText = document.getElementById('status-text');
  var siweBtn = document.getElementById('siwe-btn');

  function setStatus(state) {
    statusDot.className = 'dot ' + state;
    statusText.textContent = state === 'connected' ? 'Connected' : state === 'connecting' ? 'Connecting...' : 'Disconnected';
  }

  function addMessage(text, cls) {
    var el = document.createElement('div');
    el.className = 'msg ' + cls;
    el.textContent = text;
    chatArea.appendChild(el);
    chatArea.scrollTop = chatArea.scrollHeight;
    return el;
  }

  function connect() {
    if (ws && (ws.readyState === 0 || ws.readyState === 1)) return;
    setStatus('connecting');

    var proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    var url = proto + '//' + location.host + '/ws/chat?tokenId=' + encodeURIComponent(TOKEN_ID);
    ws = new WebSocket(url);

    ws.onopen = function() {
      setStatus('connected');
      reconnectAttempts = 0;
    };

    ws.onmessage = function(ev) {
      try {
        var data = JSON.parse(ev.data);
        switch (data.type) {
          case 'welcome':
            authenticated = data.payload.authenticated;
            if (authenticated) {
              authBar.style.display = 'none';
              inputArea.style.display = 'flex';
              addMessage('You are signed in. Type a message to chat.', 'system');
            } else {
              authBar.style.display = 'block';
              inputArea.style.display = 'none';
              addMessage('Read-only mode. Sign in with your wallet to send messages.', 'system');
            }
            break;
          case 'stream_start':
            streaming = true;
            streamEl = document.createElement('div');
            streamEl.className = 'msg agent';
            chatArea.appendChild(streamEl);
            break;
          case 'stream_token':
            if (streamEl && data.payload && data.payload.content) {
              streamEl.textContent += data.payload.content;
              chatArea.scrollTop = chatArea.scrollHeight;
            }
            break;
          case 'stream_end':
            streaming = false;
            streamEl = null;
            sendBtn.disabled = false;
            msgInput.disabled = false;
            break;
          case 'error':
            addMessage(data.payload && data.payload.message || 'An error occurred', 'error');
            if (streaming) {
              streaming = false;
              streamEl = null;
              sendBtn.disabled = false;
              msgInput.disabled = false;
            }
            break;
          case 'server_drain':
            addMessage('Server restarting — will reconnect shortly...', 'system');
            break;
        }
      } catch(e) { /* ignore malformed */ }
    };

    ws.onclose = function() {
      setStatus('disconnected');
      if (reconnectAttempts < maxReconnect) {
        var delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000);
        reconnectAttempts++;
        setTimeout(connect, delay);
      } else {
        addMessage('Connection lost. Please refresh the page.', 'error');
      }
    };

    ws.onerror = function() {
      /* onclose will fire after this */
    };
  }

  function sendMessage() {
    if (!ws || ws.readyState !== 1 || !authenticated) return;
    var text = msgInput.value.trim();
    if (!text) return;

    addMessage(text, 'user');
    ws.send(JSON.stringify({ type: 'chat', payload: { message: text, tokenId: TOKEN_ID } }));
    msgInput.value = '';
    msgInput.style.height = 'auto';
    sendBtn.disabled = true;
    msgInput.disabled = true;
  }

  // Auto-resize textarea
  msgInput.addEventListener('input', function() {
    this.style.height = 'auto';
    this.style.height = Math.min(this.scrollHeight, 120) + 'px';
  });

  // Enter to send, Shift+Enter for newline
  msgInput.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  // ─── SIWE Authentication ───────────────────────────────────────────────
  window.startSiweLogin = async function() {
    if (typeof window.ethereum === 'undefined') {
      addMessage('No Ethereum wallet detected. Install MetaMask or another wallet.', 'error');
      return;
    }

    siweBtn.disabled = true;
    siweBtn.textContent = 'Connecting...';

    try {
      // Request accounts
      var accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
      var address = accounts[0];
      if (!address) throw new Error('No account selected');

      // Get chain ID
      var chainIdHex = await window.ethereum.request({ method: 'eth_chainId' });
      var chainId = parseInt(chainIdHex, 16);

      // Fetch nonce
      var nonceRes = await fetch('/api/v1/siwe/nonce');
      if (!nonceRes.ok) throw new Error('Failed to get nonce');
      var nonceData = await nonceRes.json();

      // Build SIWE message (EIP-4361)
      var domain = location.host;
      var uri = location.origin;
      var issuedAt = new Date().toISOString();
      var expirationTime = new Date(Date.now() + 300000).toISOString(); // 5 min

      var message = domain + ' wants you to sign in with your Ethereum account:\\n'
        + address + '\\n'
        + '\\n'
        + 'Sign in to Freeside\\n'
        + '\\n'
        + 'URI: ' + uri + '\\n'
        + 'Version: 1\\n'
        + 'Chain ID: ' + chainId + '\\n'
        + 'Nonce: ' + nonceData.nonce + '\\n'
        + 'Issued At: ' + issuedAt + '\\n'
        + 'Expiration Time: ' + expirationTime;

      // Request signature
      siweBtn.textContent = 'Sign message...';
      var signature = await window.ethereum.request({
        method: 'personal_sign',
        params: [message, address],
      });

      // Verify with server
      siweBtn.textContent = 'Verifying...';
      var verifyRes = await fetch('/api/v1/siwe/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ message: message, signature: signature }),
      });

      if (!verifyRes.ok) {
        var errData = await verifyRes.json().catch(function() { return {}; });
        throw new Error(errData.error || 'Verification failed');
      }

      // Success — reconnect WS to pick up new session cookie
      addMessage('Wallet connected! Reconnecting...', 'system');
      if (ws) ws.close();
      reconnectAttempts = 0;
      setTimeout(connect, 500);

    } catch (err) {
      addMessage('Sign-in failed: ' + (err.message || 'Unknown error'), 'error');
      siweBtn.disabled = false;
      siweBtn.textContent = 'Sign In with Ethereum';
    }
  };

  // Initial connect
  connect();
})();
</script>
</body>
</html>`;
}

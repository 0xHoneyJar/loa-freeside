/**
 * Sprint 6 (319), Task 6.6: WebSocket Chat Handler
 *
 * WebSocket server for streaming inference responses to the web chat widget.
 * Lifecycle: 300s idle timeout, 30s heartbeat, max 3 conns/user, 120s graceful drain.
 *
 * Auth: WS upgrade requires valid session cookie (set by SIWE auth in Task 6.7).
 * Origin: Validated against allowlist on upgrade request.
 */

import { WebSocketServer, WebSocket, type RawData } from 'ws';
import type { Server as HttpServer, IncomingMessage } from 'http';
import type { Socket } from 'net';
import { logger } from '../../utils/logger.js';
import { config } from '../../config.js';
import { verifySessionToken, type VerifyOptions } from '../auth/siwe-session.js';

// ─── Constants ───────────────────────────────────────────────────────────────

const IDLE_TIMEOUT_MS = 300_000;       // 300s — matches ALB idle timeout
const HEARTBEAT_INTERVAL_MS = 30_000;  // 30s ping/pong
const MAX_CONNS_PER_USER = 3;
const MAX_CONNS_PER_IP = 10;
const GRACEFUL_DRAIN_MS = 120_000;     // 120s — matches ECS container stopTimeout
const MAX_MESSAGE_SIZE = 4096;         // 4KB max inbound message

// ─── Types ───────────────────────────────────────────────────────────────────

interface ChatClient {
  ws: WebSocket;
  userId: string;          // Wallet address or 'anon'
  ip: string;
  lastActivity: number;
  isAlive: boolean;
  tokenId?: string;        // Agent token ID for personality routing
}

interface ChatMessage {
  type: 'chat' | 'ping';
  payload?: {
    message: string;
    pool?: string;
    tokenId?: string;
  };
}

// ─── State ───────────────────────────────────────────────────────────────────

const clients = new Map<WebSocket, ChatClient>();
const userConnectionCount = new Map<string, number>();
const ipConnectionCount = new Map<string, number>();
let heartbeatTimer: NodeJS.Timeout | null = null;
let idleCheckTimer: NodeJS.Timeout | null = null;
let draining = false;
let wss: WebSocketServer | null = null;

// ─── Origin Validation ───────────────────────────────────────────────────────

const ALLOWED_ORIGINS_DEFAULT = [
  'https://api.arrakis.community',
  'https://arrakis.community',
  'https://freeside.honeyjar.xyz',
];

function isOriginAllowed(origin: string | undefined): boolean {
  if (!origin) return false;

  // In development, allow localhost
  if (process.env.NODE_ENV !== 'production') {
    if (origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:')) {
      return true;
    }
  }

  const allowedOrigins = config.cors.allowedOrigins.includes('*')
    ? ALLOWED_ORIGINS_DEFAULT
    : config.cors.allowedOrigins;

  return allowedOrigins.some((allowed) => origin === allowed);
}

// ─── Session Validation ──────────────────────────────────────────────────────

/**
 * Extract and verify session token from cookie header.
 * Returns wallet address as userId if valid, 'anon' otherwise.
 */
function extractSessionFromCookies(cookieHeader: string | undefined): { userId: string; authenticated: boolean } {
  if (!cookieHeader) return { userId: 'anon', authenticated: false };

  const cookies = Object.fromEntries(
    cookieHeader.split(';').map((c) => {
      const [key, ...rest] = c.trim().split('=');
      return [key, rest.join('=')];
    })
  );

  const sessionToken = cookies['freeside_session'];
  if (!sessionToken) return { userId: 'anon', authenticated: false };

  const secret = process.env.SIWE_SESSION_SECRET;
  if (!secret) {
    logger.warn('SIWE_SESSION_SECRET not set — all WS connections are unauthenticated');
    return { userId: 'anon', authenticated: false };
  }

  const verifyOpts: VerifyOptions = {
    previousSecret: process.env.SIWE_SESSION_SECRET_PREVIOUS || undefined,
    currentKid: process.env.SIWE_SESSION_SECRET_KID || 'v1',
    previousKid: process.env.SIWE_SESSION_SECRET_PREVIOUS_KID || undefined,
  };

  const result = verifySessionToken(sessionToken, secret, verifyOpts);
  if (!result.valid || !result.payload) {
    return { userId: 'anon', authenticated: false };
  }

  return { userId: result.payload.sub, authenticated: true };
}

// ─── IP Extraction ───────────────────────────────────────────────────────────

function getClientIp(req: IncomingMessage): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') {
    return forwarded.split(',')[0]!.trim();
  }
  return req.socket.remoteAddress || 'unknown';
}

// ─── Connection Tracking ─────────────────────────────────────────────────────

function incrementConnectionCount(map: Map<string, number>, key: string): number {
  const current = map.get(key) || 0;
  map.set(key, current + 1);
  return current + 1;
}

function decrementConnectionCount(map: Map<string, number>, key: string): void {
  const current = map.get(key) || 0;
  if (current <= 1) {
    map.delete(key);
  } else {
    map.set(key, current - 1);
  }
}

// ─── WebSocket Server Setup ──────────────────────────────────────────────────

export function createChatWebSocket(httpServer: HttpServer): WebSocketServer {
  wss = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_MESSAGE_SIZE,
  });

  // Handle upgrade requests manually for origin/auth validation
  httpServer.on('upgrade', (req: IncomingMessage, socket: Socket, head: Buffer) => {
    const url = new URL(req.url || '/', `http://${req.headers.host}`);

    // Only handle /ws/chat path
    if (url.pathname !== '/ws/chat') {
      return; // Let other upgrade handlers (if any) handle it
    }

    // Origin validation (SKP-007)
    const origin = req.headers.origin;
    if (!isOriginAllowed(origin)) {
      logger.warn({ origin, ip: getClientIp(req) }, 'WS upgrade rejected: invalid origin');
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }

    // Draining — reject new connections during graceful shutdown
    if (draining) {
      logger.info({ ip: getClientIp(req) }, 'WS upgrade rejected: server draining');
      socket.write('HTTP/1.1 503 Service Unavailable\r\n\r\n');
      socket.destroy();
      return;
    }

    // Per-IP connection limit
    const ip = getClientIp(req);
    const ipConns = ipConnectionCount.get(ip) || 0;
    if (ipConns >= MAX_CONNS_PER_IP) {
      logger.warn({ ip, count: ipConns }, 'WS upgrade rejected: per-IP limit');
      socket.write('HTTP/1.1 429 Too Many Requests\r\n\r\n');
      socket.destroy();
      return;
    }

    // Session validation
    const { userId, authenticated } = extractSessionFromCookies(req.headers.cookie);

    // Per-user connection limit (only for authenticated users)
    if (authenticated && userId !== 'anon') {
      const userConns = userConnectionCount.get(userId) || 0;
      if (userConns >= MAX_CONNS_PER_USER) {
        logger.warn({ userId, count: userConns }, 'WS upgrade rejected: per-user limit');
        socket.write('HTTP/1.1 429 Too Many Requests\r\n\r\n');
        socket.destroy();
        return;
      }
    }

    // Extract tokenId from query params
    const tokenId = url.searchParams.get('tokenId') || undefined;

    wss!.handleUpgrade(req, socket, head, (ws) => {
      wss!.emit('connection', ws, req, { userId, authenticated, ip, tokenId });
    });
  });

  // Handle new connections
  wss.on('connection', (ws: WebSocket, _req: IncomingMessage, meta: { userId: string; authenticated: boolean; ip: string; tokenId?: string }) => {
    const client: ChatClient = {
      ws,
      userId: meta.userId,
      ip: meta.ip,
      lastActivity: Date.now(),
      isAlive: true,
      tokenId: meta.tokenId,
    };

    clients.set(ws, client);
    incrementConnectionCount(ipConnectionCount, meta.ip);
    if (meta.authenticated && meta.userId !== 'anon') {
      incrementConnectionCount(userConnectionCount, meta.userId);
    }

    logger.info(
      { userId: meta.userId, ip: meta.ip, tokenId: meta.tokenId, authenticated: meta.authenticated, totalClients: clients.size },
      'WS client connected'
    );

    // Send welcome message with auth status
    ws.send(JSON.stringify({
      type: 'welcome',
      payload: {
        authenticated: meta.authenticated,
        readOnly: !meta.authenticated,
        tokenId: meta.tokenId,
        idleTimeoutMs: IDLE_TIMEOUT_MS,
        heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
      },
    }));

    // Pong handler for heartbeat
    ws.on('pong', () => {
      const c = clients.get(ws);
      if (c) {
        c.isAlive = true;
        c.lastActivity = Date.now();
      }
    });

    // Message handler
    ws.on('message', (data: RawData) => {
      handleMessage(ws, data);
    });

    // Close handler
    ws.on('close', () => {
      const c = clients.get(ws);
      if (c) {
        decrementConnectionCount(ipConnectionCount, c.ip);
        if (c.userId !== 'anon') {
          decrementConnectionCount(userConnectionCount, c.userId);
        }
        clients.delete(ws);
        logger.info(
          { userId: c.userId, ip: c.ip, totalClients: clients.size },
          'WS client disconnected'
        );
      }
    });

    // Error handler
    ws.on('error', (err) => {
      logger.error({ err, userId: meta.userId }, 'WS client error');
    });
  });

  // Start heartbeat timer
  heartbeatTimer = setInterval(() => {
    for (const [ws, client] of clients) {
      if (!client.isAlive) {
        logger.info({ userId: client.userId, ip: client.ip }, 'WS client heartbeat timeout');
        ws.terminate();
        continue;
      }
      client.isAlive = false;
      ws.ping();
    }
  }, HEARTBEAT_INTERVAL_MS);

  // Start idle check timer
  idleCheckTimer = setInterval(() => {
    const now = Date.now();
    for (const [ws, client] of clients) {
      if (now - client.lastActivity > IDLE_TIMEOUT_MS) {
        logger.info({ userId: client.userId, ip: client.ip }, 'WS client idle timeout');
        ws.close(4000, 'Idle timeout');
      }
    }
  }, 60_000); // Check every 60s

  logger.info('WebSocket chat server initialized at /ws/chat');
  return wss;
}

// ─── Message Handling ────────────────────────────────────────────────────────

function handleMessage(ws: WebSocket, data: RawData): void {
  const client = clients.get(ws);
  if (!client) return;

  client.lastActivity = Date.now();

  let message: ChatMessage;
  try {
    message = JSON.parse(data.toString()) as ChatMessage;
  } catch {
    ws.send(JSON.stringify({ type: 'error', payload: { message: 'Invalid JSON' } }));
    return;
  }

  switch (message.type) {
    case 'ping':
      ws.send(JSON.stringify({ type: 'pong' }));
      break;

    case 'chat':
      handleChatMessage(ws, client, message);
      break;

    default:
      ws.send(JSON.stringify({ type: 'error', payload: { message: 'Unknown message type' } }));
  }
}

async function handleChatMessage(ws: WebSocket, client: ChatClient, message: ChatMessage): Promise<void> {
  // Read-only users cannot send chat messages
  if (client.userId === 'anon') {
    ws.send(JSON.stringify({
      type: 'error',
      payload: { message: 'Authentication required. Connect your wallet via SIWE to send messages.' },
    }));
    return;
  }

  if (!message.payload?.message || message.payload.message.trim().length === 0) {
    ws.send(JSON.stringify({
      type: 'error',
      payload: { message: 'Message cannot be empty' },
    }));
    return;
  }

  // Truncate overly long messages
  const userMessage = message.payload.message.slice(0, 2000);
  const tokenId = message.payload.tokenId || client.tokenId;

  // Proxy to loa-finn for inference via SSE, streaming tokens back over WS
  const loaFinnUrl = process.env.LOA_FINN_BASE_URL;
  const s2sSecret = process.env.DEVELOPER_API_S2S_SECRET || process.env.BILLING_INTERNAL_JWT_SECRET;

  if (!loaFinnUrl || !s2sSecret) {
    ws.send(JSON.stringify({
      type: 'error',
      payload: { message: 'Inference service not configured' },
    }));
    return;
  }

  // Signal streaming start
  ws.send(JSON.stringify({ type: 'stream_start', payload: { tokenId } }));

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120_000);

    // Close listener to abort upstream
    const onClose = () => { controller.abort(); clearTimeout(timeout); };
    ws.once('close', onClose);

    const response = await fetch(`${loaFinnUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${s2sSecret}`,
        'X-Developer-Pool': 'cheap',
        'X-Developer-Access-Level': 'free',
        'X-Developer-Key-Id': `ws_${client.userId}`,
      },
      body: JSON.stringify({
        messages: [{ role: 'user', content: userMessage }],
        stream: true,
        ...(tokenId ? { model: `agent:${tokenId}` } : {}),
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);
    ws.removeListener('close', onClose);

    if (!response.ok) {
      ws.send(JSON.stringify({
        type: 'error',
        payload: { message: `Inference error: ${response.status}` },
      }));
      return;
    }

    if (!response.body) {
      ws.send(JSON.stringify({ type: 'stream_end' }));
      return;
    }

    // Stream SSE tokens as WS messages
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    const readLoop = async () => {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') {
              ws.send(JSON.stringify({ type: 'stream_end' }));
              return;
            }
            try {
              const parsed = JSON.parse(data);
              const content = parsed.choices?.[0]?.delta?.content;
              if (content) {
                ws.send(JSON.stringify({ type: 'stream_token', payload: { content } }));
              }
            } catch {
              // Skip malformed SSE data lines
            }
          }
        }
      }
      ws.send(JSON.stringify({ type: 'stream_end' }));
    };

    await readLoop();
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      logger.info({ userId: client.userId }, 'WS chat inference aborted (client disconnect or timeout)');
    } else {
      logger.error({ err, userId: client.userId }, 'WS chat inference error');
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'error',
          payload: { message: 'Inference failed' },
        }));
      }
    }
  }
}

// ─── Graceful Drain ──────────────────────────────────────────────────────────

export function drainChatWebSocket(): Promise<void> {
  draining = true;
  logger.info({ clientCount: clients.size }, 'Starting WebSocket graceful drain');

  // Stop accepting new connections
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  if (idleCheckTimer) clearInterval(idleCheckTimer);

  // Notify all clients of pending shutdown
  for (const [ws] of clients) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'server_drain',
        payload: { message: 'Server restarting, please reconnect', drainMs: GRACEFUL_DRAIN_MS },
      }));
    }
  }

  return new Promise<void>((resolve) => {
    // Force-close after drain timeout
    const forceClose = setTimeout(() => {
      logger.warn({ remaining: clients.size }, 'Force-closing remaining WS connections after drain timeout');
      for (const [ws] of clients) {
        ws.terminate();
      }
      if (wss) wss.close();
      resolve();
    }, GRACEFUL_DRAIN_MS);

    // If all clients disconnect before timeout, resolve early
    const checkEmpty = setInterval(() => {
      if (clients.size === 0) {
        clearTimeout(forceClose);
        clearInterval(checkEmpty);
        if (wss) wss.close();
        resolve();
      }
    }, 1000);
  });
}

// ─── Metrics ─────────────────────────────────────────────────────────────────

export function getChatWsMetrics(): { activeConnections: number; uniqueUsers: number; uniqueIps: number } {
  return {
    activeConnections: clients.size,
    uniqueUsers: userConnectionCount.size,
    uniqueIps: ipConnectionCount.size,
  };
}

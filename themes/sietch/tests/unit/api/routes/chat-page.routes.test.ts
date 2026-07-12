/**
 * Chat Page Routes Tests
 * Bug: 20260403-i158-ff6347 — Chat page session creation URL mismatch
 *
 * Tests that the inline JS in the chat page uses correct URLs:
 * 1. Fetch URL for session creation: /chat/session (not /api/chat/session)
 * 2. WebSocket tokenId param uses collection-prefixed format (mibera:6426)
 * 3. Session proxy forwards to Finn
 * 4. Fallback on session creation failure
 */

import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import express from 'express';
import request from 'supertest';

beforeAll(() => {
  process.env.NODE_ENV = 'test';
  process.env.LOA_FINN_BASE_URL = 'http://finn.test.local:3000';
});

// Mock logger
vi.mock('../../../../src/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
  },
}));

// Mock config
vi.mock('../../../../src/config.js', () => ({
  config: {
    features: { webChatEnabled: true },
  },
}));

describe('chat-page.routes', () => {
  let app: express.Express;

  beforeEach(async () => {
    vi.restoreAllMocks();
    const { chatPageRouter } = await import('../../../../src/api/routes/chat-page.routes.js');
    app = express();
    app.use(express.json());
    app.use('/chat', chatPageRouter);
  });

  describe('GET /chat/:collection/:tokenId — rendered HTML', () => {
    it('fetch URL should be /chat/session (not /api/chat/session)', async () => {
      const res = await request(app).get('/chat/mibera/6426');
      expect(res.status).toBe(200);
      expect(res.text).toContain("fetch('/chat/session'");
      expect(res.text).not.toContain("fetch('/api/chat/session'");
    });

    it('WebSocket URL should use collection-prefixed tokenId', async () => {
      const res = await request(app).get('/chat/mibera/6426');
      expect(res.status).toBe(200);
      // The WS URL should encode COLLECTION_TOKEN_ID (mibera:6426), not raw TOKEN_ID (6426)
      expect(res.text).toContain("encodeURIComponent(COLLECTION_TOKEN_ID)");
      expect(res.text).not.toMatch(/encodeURIComponent\(TOKEN_ID\)/);
    });

    it('sets COLLECTION_TOKEN_ID as collection:tokenId', async () => {
      const res = await request(app).get('/chat/mibera/6426');
      expect(res.status).toBe(200);
      expect(res.text).toContain("var TOKEN_ID = '6426'");
      expect(res.text).toContain("var COLLECTION = 'mibera'");
      expect(res.text).toContain("var COLLECTION_TOKEN_ID = COLLECTION + ':' + TOKEN_ID");
    });
  });

  describe('POST /chat/session — Finn session proxy', () => {
    it('forwards request to Finn /api/sessions', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          sessionId: 'sess-123',
          personality: { agent_name: 'Dharma-Tek', archetype: 'Mystic' },
        }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const res = await request(app)
        .post('/chat/session')
        .send({ token_id: 'mibera:6426' });

      expect(res.status).toBe(200);
      expect(res.body.sessionId).toBe('sess-123');
      expect(res.body.personality.agent_name).toBe('Dharma-Tek');

      // Verify Finn was called with correct URL and body
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe('http://finn.test.local:3000/api/sessions');
      expect(JSON.parse(opts.body)).toEqual({ token_id: 'mibera:6426' });
    });

    it('returns 503 when LOA_FINN_BASE_URL is not configured', async () => {
      const orig = process.env.LOA_FINN_BASE_URL;
      delete process.env.LOA_FINN_BASE_URL;

      // Need to re-import to pick up env change
      vi.resetModules();
      const { chatPageRouter } = await import('../../../../src/api/routes/chat-page.routes.js');
      const freshApp = express();
      freshApp.use(express.json());
      freshApp.use('/chat', chatPageRouter);

      const res = await request(freshApp)
        .post('/chat/session')
        .send({ token_id: 'mibera:6426' });

      expect(res.status).toBe(503);
      process.env.LOA_FINN_BASE_URL = orig;
    });

    it('rejects invalid token_id format', async () => {
      const res = await request(app)
        .post('/chat/session')
        .send({ token_id: '../../../etc/passwd' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Invalid token_id format');
    });
  });

  describe('fallback behavior', () => {
    it('chat page JS has try/catch fallback when session creation fails', async () => {
      const res = await request(app).get('/chat/mibera/6426');
      expect(res.status).toBe(200);
      // The createFinnSession function should have a catch block for fallback
      expect(res.text).toContain('catch (e)');
      // Should still define the connect() function for direct WS
      expect(res.text).toContain('function connect()');
    });
  });
});

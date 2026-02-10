/**
 * Agent Gateway Routes — Input Validation Tests
 * Sprint S10-T1: Input Validation Middleware (SDD §7.4)
 *
 * Tests body size limits, idempotency key validation, and Zod schema enforcement
 * on the agent invoke and stream endpoints.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express, { type Request, type Response, type NextFunction } from 'express';
import { createAgentRoutes, type AgentRoutesDeps } from '../../../src/api/routes/agents.routes.js';
import type { IAgentGateway } from '@arrakis/core/ports';
import { AGENT_MAX_IDEMPOTENCY_KEY_LENGTH } from '@arrakis/adapters/agent/config';

// =============================================================================
// Helpers
// =============================================================================

/** Minimal agent context attached by auth middleware */
const MOCK_AGENT_CONTEXT = {
  tenantId: 'comm-test',
  userId: '0xABC',
  nftId: null,
  tier: 3,
  accessLevel: 'pro' as const,
  allowedModelAliases: ['cheap' as const, 'fast-code' as const],
  platform: 'discord' as const,
  channelId: 'ch-1',
  idempotencyKey: 'test-key-1',
  traceId: 'trace-1',
};

/** Auth middleware that attaches mock context */
function mockAuth(req: Request, _res: Response, next: NextFunction) {
  (req as any).agentContext = MOCK_AGENT_CONTEXT;
  next();
}

/** Valid invoke request body */
function validBody(overrides: Record<string, unknown> = {}) {
  return {
    agent: 'test-agent',
    messages: [{ role: 'user', content: 'hello' }],
    ...overrides,
  };
}

/** Mock gateway with all methods stubbed */
function createMockGateway(): IAgentGateway {
  return {
    invoke: vi.fn().mockResolvedValue({
      content: 'response',
      usage: { promptTokens: 10, completionTokens: 5, costUsd: 0.001 },
    }),
    stream: vi.fn().mockReturnValue((async function* () {
      yield { type: 'content', data: { text: 'hi' } };
      yield { type: 'done', data: null };
    })()),
    getAvailableModels: vi.fn().mockReturnValue(['cheap', 'fast-code']),
    getBudgetStatus: vi.fn().mockResolvedValue({
      communityId: 'comm-test',
      monthlyLimitCents: 10000,
      currentSpendCents: 500,
      remainingCents: 9500,
      percentUsed: 5,
      warningThresholdReached: false,
    }),
    getHealth: vi.fn().mockResolvedValue({
      loaFinn: { healthy: true, latencyMs: 10 },
      redis: { healthy: true, latencyMs: 2 },
    }),
  };
}

/** Build a test Express app with agent routes */
function createTestApp(depsOverrides: Partial<AgentRoutesDeps> = {}) {
  const gateway = createMockGateway();
  const deps: AgentRoutesDeps = {
    getJwks: () => ({ keys: [{ kty: 'RSA', n: 'test', e: 'AQAB', kid: 'k1' }] }),
    gateway,
    requireAuth: mockAuth,
    agentEnabled: true,
    ...depsOverrides,
  };

  const app = express();
  // No global body parser — agent routes add their own with 128kb limit
  app.use(createAgentRoutes(deps));

  return { app, gateway };
}

// =============================================================================
// Tests
// =============================================================================

describe('Agent Routes — Input Validation (S10-T1)', () => {
  // --------------------------------------------------------------------------
  // Body size limit (SDD §7.4: 128kb)
  // --------------------------------------------------------------------------

  describe('Body size limit', () => {
    it('should reject payloads exceeding 128kb', async () => {
      const { app } = createTestApp();
      // Build a payload larger than 128kb
      const largeContent = 'x'.repeat(130 * 1024);
      const res = await request(app)
        .post('/api/agents/invoke')
        .set('Content-Type', 'application/json')
        .send(JSON.stringify({ agent: 'test', messages: [{ role: 'user', content: largeContent }] }));

      expect(res.status).toBe(413);
    });

    it('should accept payloads within 128kb', async () => {
      const { app } = createTestApp();
      const res = await request(app)
        .post('/api/agents/invoke')
        .send(validBody());

      expect(res.status).toBe(200);
    });
  });

  // --------------------------------------------------------------------------
  // X-Idempotency-Key header validation (SDD §7.4)
  // --------------------------------------------------------------------------

  describe('X-Idempotency-Key validation', () => {
    describe('on POST /api/agents/invoke', () => {
      it('should accept requests without idempotency key', async () => {
        const { app } = createTestApp();
        const res = await request(app)
          .post('/api/agents/invoke')
          .send(validBody());

        expect(res.status).toBe(200);
      });

      it('should accept valid idempotency key', async () => {
        const { app } = createTestApp();
        const res = await request(app)
          .post('/api/agents/invoke')
          .set('X-Idempotency-Key', 'my-valid-key-123')
          .send(validBody());

        expect(res.status).toBe(200);
      });

      it('should reject idempotency key exceeding max length', async () => {
        const { app } = createTestApp();
        const longKey = 'a'.repeat(AGENT_MAX_IDEMPOTENCY_KEY_LENGTH + 1);
        const res = await request(app)
          .post('/api/agents/invoke')
          .set('X-Idempotency-Key', longKey)
          .send(validBody());

        expect(res.status).toBe(400);
        expect(res.body.error).toBe('INVALID_REQUEST');
        expect(res.body.message).toContain('maximum length');
      });

      it('should accept idempotency key at exact max length', async () => {
        const { app } = createTestApp();
        const maxKey = 'a'.repeat(AGENT_MAX_IDEMPOTENCY_KEY_LENGTH);
        const res = await request(app)
          .post('/api/agents/invoke')
          .set('X-Idempotency-Key', maxKey)
          .send(validBody());

        expect(res.status).toBe(200);
      });

      it('should reject idempotency key with non-printable characters', async () => {
        const { app } = createTestApp();
        const res = await request(app)
          .post('/api/agents/invoke')
          .set('X-Idempotency-Key', 'key-with-\x80high-bit')
          .send(validBody());

        expect(res.status).toBe(400);
        expect(res.body.error).toBe('INVALID_REQUEST');
        expect(res.body.message).toContain('invalid characters');
      });
    });

    describe('on POST /api/agents/stream', () => {
      it('should accept requests without idempotency key', async () => {
        const { app } = createTestApp();
        const res = await request(app)
          .post('/api/agents/stream')
          .send(validBody());

        expect(res.status).toBe(200);
      });

      it('should reject idempotency key exceeding max length', async () => {
        const { app } = createTestApp();
        const longKey = 'a'.repeat(AGENT_MAX_IDEMPOTENCY_KEY_LENGTH + 1);
        const res = await request(app)
          .post('/api/agents/stream')
          .set('X-Idempotency-Key', longKey)
          .send(validBody());

        expect(res.status).toBe(400);
        expect(res.body.error).toBe('INVALID_REQUEST');
        expect(res.body.message).toContain('maximum length');
      });

      it('should reject idempotency key with non-printable characters', async () => {
        const { app } = createTestApp();
        const res = await request(app)
          .post('/api/agents/stream')
          .set('X-Idempotency-Key', 'key-with-\x80high-bit')
          .send(validBody());

        expect(res.status).toBe(400);
        expect(res.body.error).toBe('INVALID_REQUEST');
        expect(res.body.message).toContain('invalid characters');
      });
    });
  });

  // --------------------------------------------------------------------------
  // Zod schema validation
  // --------------------------------------------------------------------------

  describe('Zod schema validation', () => {
    it('should reject empty body', async () => {
      const { app } = createTestApp();
      const res = await request(app)
        .post('/api/agents/invoke')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('INVALID_REQUEST');
    });

    it('should reject missing agent field', async () => {
      const { app } = createTestApp();
      const res = await request(app)
        .post('/api/agents/invoke')
        .send({ messages: [{ role: 'user', content: 'hello' }] });

      expect(res.status).toBe(400);
    });

    it('should reject missing messages', async () => {
      const { app } = createTestApp();
      const res = await request(app)
        .post('/api/agents/invoke')
        .send({ agent: 'test' });

      expect(res.status).toBe(400);
    });

    it('should reject empty messages array', async () => {
      const { app } = createTestApp();
      const res = await request(app)
        .post('/api/agents/invoke')
        .send({ agent: 'test', messages: [] });

      expect(res.status).toBe(400);
    });

    it('should reject invalid message role', async () => {
      const { app } = createTestApp();
      const res = await request(app)
        .post('/api/agents/invoke')
        .send({ agent: 'test', messages: [{ role: 'invalid', content: 'hello' }] });

      expect(res.status).toBe(400);
    });

    it('should reject too many messages (>50)', async () => {
      const { app } = createTestApp();
      const messages = Array.from({ length: 51 }, (_, i) => ({
        role: 'user',
        content: `message ${i}`,
      }));
      const res = await request(app)
        .post('/api/agents/invoke')
        .send({ agent: 'test', messages });

      expect(res.status).toBe(400);
    });

    it('should reject message content exceeding 32K chars', async () => {
      const { app } = createTestApp();
      const res = await request(app)
        .post('/api/agents/invoke')
        .send({ agent: 'test', messages: [{ role: 'user', content: 'x'.repeat(33_000) }] });

      expect(res.status).toBe(400);
    });

    it('should reject too many tools (>20)', async () => {
      const { app } = createTestApp();
      const tools = Array.from({ length: 21 }, (_, i) => `tool-${i}`);
      const res = await request(app)
        .post('/api/agents/invoke')
        .send(validBody({ tools }));

      expect(res.status).toBe(400);
    });

    it('should reject invalid model alias', async () => {
      const { app } = createTestApp();
      const res = await request(app)
        .post('/api/agents/invoke')
        .send(validBody({ modelAlias: 'nonexistent' }));

      expect(res.status).toBe(400);
    });

    it('should accept valid model alias', async () => {
      const { app } = createTestApp();
      const res = await request(app)
        .post('/api/agents/invoke')
        .send(validBody({ modelAlias: 'cheap' }));

      expect(res.status).toBe(200);
    });
  });

  // --------------------------------------------------------------------------
  // Kill switch (AGENT_ENABLED=false)
  // --------------------------------------------------------------------------

  describe('Kill switch', () => {
    it('should return 503 when agent gateway is disabled', async () => {
      const { app } = createTestApp({ agentEnabled: false });
      const res = await request(app)
        .post('/api/agents/invoke')
        .send(validBody());

      expect(res.status).toBe(503);
      expect(res.body.error).toBe('SERVICE_UNAVAILABLE');
    });

    it('should return 503 on health endpoint when disabled', async () => {
      const { app } = createTestApp({ agentEnabled: false });
      const res = await request(app).get('/api/agents/health');

      expect(res.status).toBe(503);
    });
  });

  // --------------------------------------------------------------------------
  // JWKS endpoint (existing — regression check)
  // --------------------------------------------------------------------------

  describe('JWKS endpoint', () => {
    it('should return public keys', async () => {
      const { app } = createTestApp();
      const res = await request(app).get('/.well-known/jwks.json');

      expect(res.status).toBe(200);
      expect(res.body.keys).toHaveLength(1);
      expect(res.body.keys[0].kty).toBe('RSA');
    });

    it('should strip private key fields', async () => {
      const { app } = createTestApp({
        getJwks: () => ({
          keys: [{ kty: 'RSA', n: 'test', e: 'AQAB', kid: 'k1', d: 'PRIVATE', p: 'PRIME' }],
        }),
      });
      const res = await request(app).get('/.well-known/jwks.json');

      expect(res.status).toBe(200);
      expect(res.body.keys[0]).not.toHaveProperty('d');
      expect(res.body.keys[0]).not.toHaveProperty('p');
    });

    it('should return ETag and Cache-Control headers', async () => {
      const { app } = createTestApp();
      const res = await request(app).get('/.well-known/jwks.json');

      expect(res.headers['etag']).toBeDefined();
      expect(res.headers['cache-control']).toContain('max-age=3600');
    });

    it('should return 304 on If-None-Match hit', async () => {
      const { app } = createTestApp();
      const first = await request(app).get('/.well-known/jwks.json');
      const etag = first.headers['etag'];

      const second = await request(app)
        .get('/.well-known/jwks.json')
        .set('If-None-Match', etag);

      expect(second.status).toBe(304);
    });
  });

  // --------------------------------------------------------------------------
  // Health endpoint (existing — regression check)
  // --------------------------------------------------------------------------

  describe('Health endpoint', () => {
    it('should return health status', async () => {
      const { app } = createTestApp();
      const res = await request(app).get('/api/agents/health');

      expect(res.status).toBe(200);
      expect(res.body.loaFinn).toBeDefined();
      expect(res.body.redis).toBeDefined();
    });
  });

  // --------------------------------------------------------------------------
  // Gateway error handling
  // --------------------------------------------------------------------------

  describe('Gateway error handling', () => {
    it('should return sanitized error on RATE_LIMITED', async () => {
      const gateway = createMockGateway();
      (gateway.invoke as ReturnType<typeof vi.fn>).mockRejectedValue({
        code: 'RATE_LIMITED',
        statusCode: 429,
        details: { limit: 20, remaining: 0, retryAfterMs: 30000 },
      });
      const { app } = createTestApp({ gateway });

      const res = await request(app)
        .post('/api/agents/invoke')
        .send(validBody());

      expect(res.status).toBe(429);
      expect(res.body.error).toBe('RATE_LIMITED');
      expect(res.body.message).toBe('Rate limit exceeded');
      expect(res.headers['retry-after']).toBe('30');
      expect(res.headers['x-ratelimit-limit']).toBe('20');
    });

    it('should return sanitized error on BUDGET_EXCEEDED', async () => {
      const gateway = createMockGateway();
      (gateway.invoke as ReturnType<typeof vi.fn>).mockRejectedValue({
        code: 'BUDGET_EXCEEDED',
        statusCode: 402,
      });
      const { app } = createTestApp({ gateway });

      const res = await request(app)
        .post('/api/agents/invoke')
        .send(validBody());

      expect(res.status).toBe(402);
      expect(res.body.message).toBe('Community budget exhausted');
    });

    it('should return generic 500 for unknown errors', async () => {
      const gateway = createMockGateway();
      (gateway.invoke as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('something broke'));
      const { app } = createTestApp({ gateway });

      const res = await request(app)
        .post('/api/agents/invoke')
        .send(validBody());

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('INTERNAL_ERROR');
      expect(res.body.message).toBe('An unexpected error occurred');
    });
  });

  // --------------------------------------------------------------------------
  // X-RateLimit-Policy header (S10-T3)
  // --------------------------------------------------------------------------

  describe('X-RateLimit-Policy header', () => {
    it('should include X-RateLimit-Policy: none on successful invoke', async () => {
      const { app } = createTestApp();
      const res = await request(app)
        .post('/api/agents/invoke')
        .send(validBody());

      expect(res.status).toBe(200);
      expect(res.headers['x-ratelimit-policy']).toBe('none');
    });

    it('should include X-RateLimit-Policy: none on health endpoint', async () => {
      const { app } = createTestApp();
      const res = await request(app).get('/api/agents/health');

      expect(res.status).toBe(200);
      expect(res.headers['x-ratelimit-policy']).toBe('none');
    });

    it('should include X-RateLimit-Policy: none on 503 kill-switch', async () => {
      const { app } = createTestApp({ agentEnabled: false });
      const res = await request(app)
        .post('/api/agents/invoke')
        .send(validBody());

      expect(res.status).toBe(503);
      expect(res.headers['x-ratelimit-policy']).toBe('none');
    });

    it('should set X-RateLimit-Policy to dimension on 429', async () => {
      const gateway = createMockGateway();
      (gateway.invoke as ReturnType<typeof vi.fn>).mockRejectedValue({
        code: 'RATE_LIMITED',
        statusCode: 429,
        details: { dimension: 'user', limit: 20, remaining: 0, retryAfterMs: 30000 },
      });
      const { app } = createTestApp({ gateway });

      const res = await request(app)
        .post('/api/agents/invoke')
        .send(validBody());

      expect(res.status).toBe(429);
      expect(res.headers['x-ratelimit-policy']).toBe('user');
    });

    it('should reject unknown dimension values on 429', async () => {
      const gateway = createMockGateway();
      (gateway.invoke as ReturnType<typeof vi.fn>).mockRejectedValue({
        code: 'RATE_LIMITED',
        statusCode: 429,
        details: { dimension: 'injected-value', limit: 20, remaining: 0, retryAfterMs: 30000 },
      });
      const { app } = createTestApp({ gateway });

      const res = await request(app)
        .post('/api/agents/invoke')
        .send(validBody());

      expect(res.status).toBe(429);
      expect(res.headers['x-ratelimit-policy']).toBe('none');
    });

    it('should include X-RateLimit-Policy on stream responses', async () => {
      const { app } = createTestApp();
      const res = await request(app)
        .post('/api/agents/stream')
        .send(validBody());

      expect(res.status).toBe(200);
      expect(res.headers['x-ratelimit-policy']).toBe('none');
    });

    it('should include X-RateLimit-Policy on models endpoint', async () => {
      const { app } = createTestApp();
      const res = await request(app).get('/api/agents/models');

      expect(res.status).toBe(200);
      expect(res.headers['x-ratelimit-policy']).toBe('none');
    });
  });

  // --------------------------------------------------------------------------
  // Stream abort propagation (S10-T2)
  // --------------------------------------------------------------------------

  describe('Stream abort propagation', () => {
    it('should pass abort signal to gateway.stream()', async () => {
      const gateway = createMockGateway();
      let receivedSignal: AbortSignal | undefined;

      // Override stream to capture the signal
      (gateway.stream as ReturnType<typeof vi.fn>).mockImplementation(
        async function* (_req: unknown, options?: { signal?: AbortSignal }) {
          receivedSignal = options?.signal;
          yield { type: 'content', data: { text: 'hi' } };
          yield { type: 'done', data: null };
        },
      );

      const { app } = createTestApp({ gateway });
      await request(app)
        .post('/api/agents/stream')
        .send(validBody());

      expect(receivedSignal).toBeDefined();
      expect(receivedSignal).toBeInstanceOf(AbortSignal);
    });

    it('should return SSE content-type for stream responses', async () => {
      const { app } = createTestApp();
      const res = await request(app)
        .post('/api/agents/stream')
        .send(validBody());

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/event-stream');
    });

    it('should set no-cache and keep-alive headers for SSE', async () => {
      const { app } = createTestApp();
      const res = await request(app)
        .post('/api/agents/stream')
        .send(validBody());

      expect(res.headers['cache-control']).toBe('no-cache');
      expect(res.headers['connection']).toBe('keep-alive');
    });
  });

  // --------------------------------------------------------------------------
  // STREAM_RESUME_LOST handling (S11-T1)
  // --------------------------------------------------------------------------

  describe('STREAM_RESUME_LOST handling', () => {
    it('should return 409 with STREAM_RESUME_LOST on stream context expiry', async () => {
      const gateway = createMockGateway();
      (gateway.invoke as ReturnType<typeof vi.fn>).mockRejectedValue({
        code: 'STREAM_RESUME_LOST',
        statusCode: 409,
        message: 'Stream context expired',
      });
      const { app } = createTestApp({ gateway });

      const res = await request(app)
        .post('/api/agents/invoke')
        .send(validBody());

      expect(res.status).toBe(409);
      expect(res.body.error).toBe('STREAM_RESUME_LOST');
      expect(res.body.message).toBe('Stream context expired — retry with new idempotency key');
    });

    it('should forward Last-Event-ID to gateway.stream()', async () => {
      const gateway = createMockGateway();
      let receivedLastEventId: string | undefined;

      (gateway.stream as ReturnType<typeof vi.fn>).mockImplementation(
        async function* (_req: unknown, options?: { signal?: AbortSignal; lastEventId?: string }) {
          receivedLastEventId = options?.lastEventId;
          yield { type: 'content', data: { text: 'resumed' } };
          yield { type: 'done', data: null };
        },
      );

      const { app } = createTestApp({ gateway });
      await request(app)
        .post('/api/agents/stream')
        .set('Last-Event-ID', 'evt-42')
        .send(validBody());

      expect(receivedLastEventId).toBe('evt-42');
    });

    it('should return 400 with REQ_HASH_MISMATCH when wire bytes diverge', async () => {
      const gateway = createMockGateway();
      (gateway.invoke as ReturnType<typeof vi.fn>).mockRejectedValue({
        code: 'REQ_HASH_MISMATCH',
        statusCode: 400,
        message: 'req_hash mismatch',
      });
      const { app } = createTestApp({ gateway });

      const res = await request(app)
        .post('/api/agents/invoke')
        .send(validBody());

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('REQ_HASH_MISMATCH');
      expect(res.body.message).toBe('Request body integrity check failed');
    });

    it('should not set lastEventId when Last-Event-ID header is absent', async () => {
      const gateway = createMockGateway();
      let receivedLastEventId: string | undefined = 'should-be-overwritten';

      (gateway.stream as ReturnType<typeof vi.fn>).mockImplementation(
        async function* (_req: unknown, options?: { signal?: AbortSignal; lastEventId?: string }) {
          receivedLastEventId = options?.lastEventId;
          yield { type: 'content', data: { text: 'hi' } };
          yield { type: 'done', data: null };
        },
      );

      const { app } = createTestApp({ gateway });
      await request(app)
        .post('/api/agents/stream')
        .send(validBody());

      expect(receivedLastEventId).toBeUndefined();
    });
  });

  // --------------------------------------------------------------------------
  // HTTP API Idempotency Enforcement (S11-T4)
  // --------------------------------------------------------------------------

  describe('HTTP API idempotency enforcement', () => {
    it('should echo X-Idempotency-Key in invoke response', async () => {
      const { app } = createTestApp();

      const res = await request(app)
        .post('/api/agents/invoke')
        .set('X-Idempotency-Key', 'my-key-123')
        .send(validBody());

      expect(res.status).toBe(200);
      expect(res.headers['x-idempotency-key']).toBe('test-key-1');
    });

    it('should echo X-Idempotency-Key in stream response', async () => {
      const { app } = createTestApp();

      const res = await request(app)
        .post('/api/agents/stream')
        .send(validBody());

      expect(res.headers['x-idempotency-key']).toBe('test-key-1');
    });

    it('should return server-generated key when X-Idempotency-Key header absent', async () => {
      // Use a mock auth that simulates server-generated UUID
      const serverGeneratedKey = 'server-uuid-abc123';
      function mockAuthWithGeneratedKey(req: Request, _res: Response, next: NextFunction) {
        (req as any).agentContext = { ...MOCK_AGENT_CONTEXT, idempotencyKey: serverGeneratedKey };
        next();
      }

      const { app } = createTestApp({ requireAuth: mockAuthWithGeneratedKey });

      const res = await request(app)
        .post('/api/agents/invoke')
        .send(validBody());

      expect(res.status).toBe(200);
      expect(res.headers['x-idempotency-key']).toBe(serverGeneratedKey);
    });

    it('should pass idempotency key through to gateway.invoke()', async () => {
      const gateway = createMockGateway();
      const { app } = createTestApp({ gateway });

      await request(app)
        .post('/api/agents/invoke')
        .send(validBody());

      const invokeCall = (gateway.invoke as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(invokeCall.context.idempotencyKey).toBe('test-key-1');
    });

    it('should pass idempotency key through to gateway.stream()', async () => {
      const gateway = createMockGateway();
      let receivedContext: Record<string, unknown> | undefined;

      (gateway.stream as ReturnType<typeof vi.fn>).mockImplementation(
        async function* (req: { context: Record<string, unknown> }) {
          receivedContext = req.context;
          yield { type: 'content', data: { text: 'hi' } };
          yield { type: 'done', data: null };
        },
      );

      const { app } = createTestApp({ gateway });
      await request(app)
        .post('/api/agents/stream')
        .send(validBody());

      expect(receivedContext?.idempotencyKey).toBe('test-key-1');
    });
  });
});

/**
 * Agent Gateway Routes
 * Sprint S1-T5 + S4-T3 + Hounfour-192: JWKS + Agent API + Internal Usage
 *
 * Public JWKS endpoint for loa-finn JWT verification.
 * Agent API routes: invoke, stream, models, budget, health.
 * Internal routes: usage report ingestion from loa-finn (S2S JWT auth).
 *
 * @see SDD §4.2 JWKS Endpoint
 * @see SDD §6.1 Agent API Routes
 * @see SDD §3.2 UsageReceiver
 * @see Trust Boundary §3.1 JWKS Trust Model
 */

import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { JWK } from 'jose';
import type { IAgentGateway } from '@arrakis/core/ports';
import type { AgentAuthenticatedRequest } from '@arrakis/adapters/agent/agent-auth-middleware';
import { agentInvokeRequestSchema, AGENT_BODY_LIMIT, AGENT_MAX_IDEMPOTENCY_KEY_LENGTH } from '@arrakis/adapters/agent/config';
import { createEventIdGenerator, parseLastEventId } from '@arrakis/adapters/agent';
import type { UsageReceiver } from '@arrakis/adapters/agent/usage-receiver';
import { UsageReceiverError } from '@arrakis/adapters/agent/usage-receiver';
import type { S2SAuthenticatedRequest } from '@arrakis/adapters/agent/s2s-auth-middleware';
import express from 'express';

// --------------------------------------------------------------------------
// Types
// --------------------------------------------------------------------------

/** Dependencies for agent routes (injected by factory) */
export interface AgentRoutesDeps {
  /** Returns JWKS keys from JwtService */
  getJwks: () => { keys: JWK[] };
  /** Agent gateway facade (optional — only required when agent routes are enabled) */
  gateway?: IAgentGateway;
  /** Auth middleware (optional — only required when agent routes are enabled) */
  requireAuth?: (req: Request, res: Response, next: NextFunction) => void;
  /** IP rate limiter middleware (optional) */
  ipRateLimiter?: (req: Request, res: Response, next: NextFunction) => void;
  /** Whether agent routes are enabled (AGENT_ENABLED env var) */
  agentEnabled?: boolean;
}

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

/** Known JWK private key fields (RSA, EC, OKP, symmetric) */
const PRIVATE_JWK_FIELDS = ['d', 'p', 'q', 'dp', 'dq', 'qi', 'oth', 'k'] as const;

/**
 * Strip private key fields from a JWK — defense-in-depth at the route boundary.
 * JwtService already exports only public JWKs, but this ensures no private
 * material can ever leak through the public JWKS endpoint.
 */
function stripPrivateJwk(jwk: JWK): JWK {
  const pub = { ...jwk };
  for (const field of PRIVATE_JWK_FIELDS) {
    delete (pub as Record<string, unknown>)[field];
  }
  return pub;
}

/**
 * Constant-time ETag comparison for conditional requests.
 */
function matchesEtag(header: string | string[] | undefined, etag: string): boolean {
  if (!header) return false;
  const values = Array.isArray(header)
    ? header
    : header.split(',').map(v => v.trim());

  for (const candidate of values) {
    if (candidate.length !== etag.length) continue;
    if (timingSafeEqual(Buffer.from(candidate), Buffer.from(etag))) {
      return true;
    }
  }
  return false;
}

// --------------------------------------------------------------------------
// Factory
// --------------------------------------------------------------------------

/**
 * Global kill switch middleware: returns 503 when AGENT_ENABLED=false
 */
function killSwitch(enabled: boolean) {
  return (_req: Request, res: Response, next: NextFunction) => {
    if (!enabled) {
      res.status(503).json({ error: 'SERVICE_UNAVAILABLE', message: 'Agent gateway is disabled' });
      return;
    }
    next();
  };
}

/** URL-safe charset for idempotency keys (SDD §7.4) */
const IDEMPOTENCY_KEY_CHARSET = /^[\x20-\x7e]+$/;

/**
 * Validate X-Idempotency-Key header. Returns true if valid (or absent), false if rejected.
 * Rejects: duplicate headers, oversized keys, non-printable characters.
 */
function validateIdempotencyKeyHeader(req: Request, res: Response): boolean {
  const header = req.headers['x-idempotency-key'];
  if (header == null) return true;

  if (Array.isArray(header)) {
    res.status(400).json({ error: 'INVALID_REQUEST', message: 'X-Idempotency-Key must be a single value' });
    return false;
  }

  if (header.length > AGENT_MAX_IDEMPOTENCY_KEY_LENGTH) {
    res.status(400).json({ error: 'INVALID_REQUEST', message: 'X-Idempotency-Key exceeds maximum length' });
    return false;
  }

  if (!IDEMPOTENCY_KEY_CHARSET.test(header)) {
    res.status(400).json({ error: 'INVALID_REQUEST', message: 'X-Idempotency-Key contains invalid characters' });
    return false;
  }

  return true;
}

/**
 * Create agent gateway routes.
 * Sprint 1: JWKS endpoint.
 * Sprint 4: Agent API routes (invoke, stream, models, budget, health).
 */
export function createAgentRoutes(deps: AgentRoutesDeps): Router {
  const router = Router();

  // --------------------------------------------------------------------------
  // JWKS — Public (Sprint 1)
  // --------------------------------------------------------------------------

  router.get('/.well-known/jwks.json', (req: Request, res: Response) => {
    const jwks = deps.getJwks();
    const publicJwks = { keys: jwks.keys.map(stripPrivateJwk) };
    const body = JSON.stringify(publicJwks);

    const etag = `W/"${createHash('sha256').update(body).digest('hex').slice(0, 16)}"`;

    res.setHeader('Content-Type', 'application/json');
    // max-age=60: aligned with JWKS cache TTL and key refresh interval.
    // During rotation, both old and new keys are served for ≥15 minutes.
    // @see packages/services/jwks-pg-service.ts CACHE_TTL_MS
    res.setHeader('Cache-Control', 'public, max-age=60');
    res.setHeader('ETag', etag);

    if (matchesEtag(req.headers['if-none-match'], etag)) {
      res.status(304).end();
      return;
    }

    res.send(body);
  });

  // --------------------------------------------------------------------------
  // Agent API Routes (Sprint 4) — only if gateway is provided
  // --------------------------------------------------------------------------

  if (!deps.gateway) return router;

  const gateway = deps.gateway;
  const agentEnabled = deps.agentEnabled ?? true;
  const middlewares: Array<(req: Request, res: Response, next: NextFunction) => void> = [];

  // Default X-RateLimit-Policy header on all agent responses (SDD §6.1, FR-3.3)
  const setDefaultRateLimitPolicy = (_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-RateLimit-Policy', 'none');
    next();
  };

  // Agent-specific body size limit (SDD §7.4) — overrides global 1MB limit
  middlewares.push(express.json({ limit: AGENT_BODY_LIMIT }) as unknown as (req: Request, res: Response, next: NextFunction) => void);

  // Ensure header is present even on kill-switch / rate-limit responses
  middlewares.push(setDefaultRateLimitPolicy);

  // Kill switch
  middlewares.push(killSwitch(agentEnabled));

  // Pre-auth IP rate limiter
  if (deps.ipRateLimiter) middlewares.push(deps.ipRateLimiter);

  // --------------------------------------------------------------------------
  // GET /api/agents/health — no auth required
  // --------------------------------------------------------------------------

  router.get('/api/agents/health', setDefaultRateLimitPolicy, killSwitch(agentEnabled), async (_req: Request, res: Response) => {
    try {
      const health = await gateway.getHealth();
      res.json(health);
    } catch {
      res.status(503).json({ error: 'HEALTH_CHECK_FAILED' });
    }
  });

  // Auth-required routes
  if (!deps.requireAuth) return router;

  const authMiddlewares = [...middlewares, deps.requireAuth];

  // --------------------------------------------------------------------------
  // POST /api/agents/invoke — synchronous invocation
  // --------------------------------------------------------------------------

  router.post('/api/agents/invoke', ...authMiddlewares, async (req: Request, res: Response) => {
    try {
      // Validate X-Idempotency-Key header (SDD §7.4)
      if (!validateIdempotencyKeyHeader(req, res)) return;

      const parsed = agentInvokeRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'INVALID_REQUEST', message: 'Invalid request' });
        return;
      }

      const agentReq = req as AgentAuthenticatedRequest;

      // Echo idempotency key in response (S11-T4, SDD §9.4)
      // Enables clients to retry with server-generated key when header was absent
      res.setHeader('X-Idempotency-Key', agentReq.agentContext.idempotencyKey);

      const response = await gateway.invoke({
        context: agentReq.agentContext,
        ...parsed.data,
      });

      res.json(response);
    } catch (err: unknown) {
      handleGatewayError(err, res);
    }
  });

  // --------------------------------------------------------------------------
  // POST /api/agents/stream — SSE streaming
  // --------------------------------------------------------------------------

  router.post('/api/agents/stream', ...authMiddlewares, async (req: Request, res: Response) => {
    try {
      // Validate X-Idempotency-Key header (SDD §7.4)
      if (!validateIdempotencyKeyHeader(req, res)) return;

      const parsed = agentInvokeRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'INVALID_REQUEST', message: 'Invalid request' });
        return;
      }

      const agentReq = req as AgentAuthenticatedRequest;

      // SSE response setup
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      // Echo idempotency key in response (S11-T4, SDD §9.4)
      res.setHeader('X-Idempotency-Key', agentReq.agentContext.idempotencyKey);
      res.flushHeaders();

      // Heartbeat interval (15s keepalive)
      const heartbeat = setInterval(() => {
        res.write(': keepalive\n\n');
      }, 15_000);

      // Abort controller for client disconnect
      const abort = new AbortController();
      const onClose = () => {
        abort.abort();
        clearInterval(heartbeat);
      };
      req.on('close', onClose);
      res.on('close', onClose);

      try {
        // Forward Last-Event-ID for SSE resume (S11-T1, SDD §4.6.1)
        const lastEventId = typeof req.headers['last-event-id'] === 'string'
          ? req.headers['last-event-id']
          : undefined;

        // SSE event ID generator — Monotonic (default) or Composite (when SSE_SERVER_ID set).
        // IDs are for client-side ordering and same-server resume only.
        // Cross-server reconnect defers to STREAM_RESUME_LOST FSM.
        // See Bridgebuilder PR #47 Comment 4, Finding B.
        let idGen = createEventIdGenerator();
        if (lastEventId) {
          idGen = idGen.fromLastEventId(lastEventId);

          // Detect server switch for composite IDs — log warning
          const parsed_id = parseLastEventId(lastEventId);
          const currentServerId = process.env.SSE_SERVER_ID;
          if (parsed_id.serverId && currentServerId && parsed_id.serverId !== currentServerId) {
            // Different server — STREAM_RESUME_LOST FSM will handle this upstream
            // Log for observability
            (req as Record<string, unknown>).log?.({
              lastEventServerId: parsed_id.serverId,
              currentServerId,
              msg: 'SSE server switch detected — deferring to STREAM_RESUME_LOST FSM',
            });
          }
        }

        for await (const event of gateway.stream({
          context: agentReq.agentContext,
          ...parsed.data,
        }, { signal: abort.signal, lastEventId })) {
          if (abort.signal.aborted) break;

          const eventId = idGen.next();
          res.write(`id: ${eventId}\n`);
          res.write(`event: ${event.type}\n`);
          res.write(`data: ${JSON.stringify(event.data)}\n\n`);
        }
      } finally {
        clearInterval(heartbeat);
      }

      res.end();
    } catch (err: unknown) {
      // If headers already sent (streaming), just end the response
      if (res.headersSent) {
        res.end();
        return;
      }
      handleGatewayError(err, res);
    }
  });

  // --------------------------------------------------------------------------
  // GET /api/agents/models — available models for tier
  // --------------------------------------------------------------------------

  router.get('/api/agents/models', ...authMiddlewares, (req: Request, res: Response) => {
    const agentReq = req as AgentAuthenticatedRequest;
    const models = gateway.getAvailableModels(agentReq.agentContext.accessLevel);
    res.json({ models });
  });

  // --------------------------------------------------------------------------
  // GET /api/agents/budget — budget status (admin only)
  // --------------------------------------------------------------------------

  router.get('/api/agents/budget', ...authMiddlewares, async (req: Request, res: Response) => {
    const agentReq = req as AgentAuthenticatedRequest;

    // Explicit admin role check (Flatline SKP-005: not just authenticated)
    const roles = (req as Record<string, unknown>).caller as { roles?: string[] } | undefined;
    const isAdmin = roles?.roles?.includes('admin') || roles?.roles?.includes('qa_admin');
    if (!isAdmin) {
      res.status(403).json({ error: 'FORBIDDEN', message: 'Admin access required' });
      return;
    }

    try {
      const status = await gateway.getBudgetStatus(agentReq.agentContext.tenantId);
      res.json(status);
    } catch {
      res.status(500).json({ error: 'INTERNAL_ERROR' });
    }
  });

  return router;
}

// --------------------------------------------------------------------------
// Error Handler
// --------------------------------------------------------------------------

// --------------------------------------------------------------------------
// Internal Agent Routes (Hounfour Integration — Sprint 192)
// --------------------------------------------------------------------------

/** Dependencies for internal agent routes (S2S loa-finn → arrakis) */
export interface InternalAgentRoutesDeps {
  /** S2S JWT auth middleware (validates loa-finn Bearer tokens) */
  requireS2SAuth: (req: Request, res: Response, next: NextFunction) => void
  /** Usage report receiver */
  usageReceiver: UsageReceiver
}

/**
 * Create internal agent routes.
 * Mounted on /internal/agent — NOT on the public /api/ prefix.
 * Production should additionally restrict via reverse proxy / NetworkPolicy.
 */
export function createInternalAgentRoutes(deps: InternalAgentRoutesDeps): Router {
  const router = Router();

  // All internal agent routes require S2S JWT authentication
  router.use(deps.requireS2SAuth);

  // --------------------------------------------------------------------------
  // POST /internal/agent/usage-reports — Inbound usage report from loa-finn
  // --------------------------------------------------------------------------

  router.post('/usage-reports', async (req: Request, res: Response) => {
    const s2sReq = req as S2SAuthenticatedRequest;
    const jwsCompact = req.body?.jws;

    if (!jwsCompact || typeof jwsCompact !== 'string') {
      res.status(400).json({ error: 'INVALID_REQUEST', message: 'Missing jws field in request body' });
      return;
    }

    try {
      const result = await deps.usageReceiver.receive(s2sReq.s2sClaims, jwsCompact);
      res.status(200).json(result);
    } catch (err) {
      if (err instanceof UsageReceiverError) {
        res.status(err.statusCode).json({
          error: err.statusCode < 500 ? 'VALIDATION_ERROR' : 'INTERNAL_ERROR',
          message: err.statusCode < 500 ? err.message : 'Internal error processing usage report',
        });
        return;
      }
      res.status(500).json({ error: 'INTERNAL_ERROR', message: 'An unexpected error occurred' });
    }
  });

  return router;
}

// --------------------------------------------------------------------------
// Error Handler
// --------------------------------------------------------------------------

function handleGatewayError(err: unknown, res: Response): void {
  const error = err as { code?: string; statusCode?: number; message?: string; details?: Record<string, unknown> };

  if (error.statusCode && error.code) {
    // Sanitize error messages — map error codes to safe messages
    const SAFE_MESSAGES: Record<string, string> = {
      RATE_LIMITED: 'Rate limit exceeded',
      BUDGET_EXCEEDED: 'Community budget exhausted',
      MODEL_NOT_ALLOWED: 'Model not available for your tier',
      BUDGET_ERROR: 'Budget reservation failed',
      STREAM_RESUME_LOST: 'Stream context expired — retry with new idempotency key',
      REQ_HASH_MISMATCH: 'Request body integrity check failed',
      ENSEMBLE_DISABLED: 'Ensemble orchestration is not enabled',
      ENSEMBLE_NOT_AVAILABLE: 'Ensemble orchestration is not available for your tier',
      BYOK_QUOTA_EXCEEDED: 'Daily BYOK request quota exceeded',
      BYOK_SERVICE_UNAVAILABLE: 'BYOK service temporarily unavailable',
      BYOK_UNKNOWN_PROVIDER: 'Unknown BYOK provider',
      BYOK_UNKNOWN_OPERATION: 'Unknown BYOK operation',
      BYOK_SSRF_BLOCKED: 'Request blocked by security policy',
      BYOK_REPLAY_DETECTED: 'Duplicate request detected',
    };
    const safeMessage = SAFE_MESSAGES[error.code] ?? (error.statusCode < 500 ? 'Request failed' : 'An unexpected error occurred');

    const response: Record<string, unknown> = {
      error: error.code,
      message: safeMessage,
    };

    // Add rate limit headers on 429
    if (error.statusCode === 429 && error.details) {
      if (error.details.limit != null) res.setHeader('X-RateLimit-Limit', String(error.details.limit));
      if (error.details.remaining != null) res.setHeader('X-RateLimit-Remaining', String(error.details.remaining));
      if (error.details.retryAfterMs != null) {
        res.setHeader('Retry-After', String(Math.ceil(Number(error.details.retryAfterMs) / 1000)));
      }
      // Override default 'none' with constraining dimension (FR-3.3)
      const dimension = typeof error.details.dimension === 'string' ? error.details.dimension : undefined;
      const ALLOWED_DIMENSIONS = new Set(['community', 'user', 'channel', 'burst']);
      if (dimension && ALLOWED_DIMENSIONS.has(dimension)) {
        res.setHeader('X-RateLimit-Policy', dimension);
      }
    }

    res.status(error.statusCode).json(response);
    return;
  }

  res.status(500).json({ error: 'INTERNAL_ERROR', message: 'An unexpected error occurred' });
}

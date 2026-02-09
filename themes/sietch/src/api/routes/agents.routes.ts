/**
 * Agent Gateway Routes
 * Sprint S1-T5 + S4-T3: JWKS + Agent API routes
 *
 * Public JWKS endpoint for loa-finn JWT verification.
 * Agent API routes: invoke, stream, models, budget, health.
 *
 * @see SDD §4.2 JWKS Endpoint
 * @see SDD §6.1 Agent API Routes
 * @see Trust Boundary §3.1 JWKS Trust Model
 */

import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { JWK } from 'jose';
import type { IAgentGateway } from '@arrakis/core/ports';
import type { AgentAuthenticatedRequest } from '@arrakis/adapters/agent/agent-auth-middleware';
import { agentInvokeRequestSchema } from '@arrakis/adapters/agent/config';

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
    res.setHeader('Cache-Control', 'public, max-age=3600');
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

  // Kill switch
  middlewares.push(killSwitch(agentEnabled));

  // Pre-auth IP rate limiter
  if (deps.ipRateLimiter) middlewares.push(deps.ipRateLimiter);

  // --------------------------------------------------------------------------
  // GET /api/agents/health — no auth required
  // --------------------------------------------------------------------------

  router.get('/api/agents/health', killSwitch(agentEnabled), async (_req: Request, res: Response) => {
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
      const parsed = agentInvokeRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'INVALID_REQUEST', message: 'Invalid request' });
        return;
      }

      const agentReq = req as AgentAuthenticatedRequest;
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
        for await (const event of gateway.stream({
          context: agentReq.agentContext,
          ...parsed.data,
        })) {
          if (abort.signal.aborted) break;

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

function handleGatewayError(err: unknown, res: Response): void {
  const error = err as { code?: string; statusCode?: number; message?: string; details?: Record<string, unknown> };

  if (error.statusCode && error.code) {
    // Sanitize error messages — map error codes to safe messages
    const SAFE_MESSAGES: Record<string, string> = {
      RATE_LIMITED: 'Rate limit exceeded',
      BUDGET_EXCEEDED: 'Community budget exhausted',
      MODEL_NOT_ALLOWED: 'Model not available for your tier',
      BUDGET_ERROR: 'Budget reservation failed',
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
    }

    res.status(error.statusCode).json(response);
    return;
  }

  res.status(500).json({ error: 'INTERNAL_ERROR', message: 'An unexpected error occurred' });
}

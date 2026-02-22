/**
 * Developer Onboarding & Inference Routes
 * Sprint 6 (319), Task 6.4: Developer Onboarding Flow
 *
 * Self-service developer onboarding:
 *   POST   /api/v1/developers/register   — create sandbox key (public, rate-limited)
 *   POST   /api/v1/developers/invoke     — inference proxy (developer key auth)
 *   POST   /api/v1/developers/stream     — SSE streaming proxy (developer key auth)
 *   GET    /api/v1/developers/models     — available models for key's access level
 *   POST   /api/v1/developers/upgrade    — upgrade sandbox → production key
 *
 * Sandbox keys (lf_test_) route to `cheap` pool only.
 * Live keys (lf_live_) route based on configured access level.
 *
 * SDD refs: §2.2 API Key Authentication, §4.3 Pool Routing
 * PRD refs: FR-5.5 Developer Onboarding
 *
 * @module api/routes/developer
 */

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { logger } from '../../utils/logger.js';
import {
  createApiKey,
  ApiKeyLimitError,
} from '../../services/api-keys/ApiKeyService.js';
import {
  requireDeveloperKey,
  recordTokenUsage,
  type DeveloperKeyRequest,
} from '../middleware/developer-key-auth.js';

// =============================================================================
// Constants
// =============================================================================

/** Allowed pool for sandbox (test) keys */
const SANDBOX_ALLOWED_POOLS: ReadonlySet<string> = new Set(['cheap']);

/** Allowed pools for live keys (free tier — upgrade tiers get more) */
const LIVE_FREE_ALLOWED_POOLS: ReadonlySet<string> = new Set(['cheap', 'fast-code']);

/** Default community ID for developer sandbox access */
const SANDBOX_COMMUNITY_ID = 'developer-sandbox';

// =============================================================================
// Validation Schemas
// =============================================================================

const registerSchema = z.object({
  name: z.string().min(1).max(64).optional().default('Developer'),
  communityId: z.string().min(1).max(128).optional().default(SANDBOX_COMMUNITY_ID),
});

const invokeSchema = z.object({
  model: z.string().min(1).max(64).optional(),
  pool: z.string().min(1).max(32).optional(),
  messages: z.array(z.object({
    role: z.enum(['system', 'user', 'assistant']),
    content: z.string().min(1).max(100_000),
  })).min(1).max(100),
  max_tokens: z.number().int().min(1).max(4096).optional().default(1024),
  temperature: z.number().min(0).max(2).optional(),
  stream: z.boolean().optional(),
});

const upgradeSchema = z.object({
  sandboxKeyId: z.string().min(1).max(64),
  name: z.string().min(1).max(64).optional(),
  rateLimitRpm: z.number().int().min(1).max(1000).optional(),
  rateLimitTpd: z.number().int().min(1).max(10_000_000).optional(),
});

// =============================================================================
// Registration Rate Limiter (IP-based, in-memory)
// =============================================================================

interface RegRateEntry {
  count: number;
  windowStart: number;
}

const regRateMap = new Map<string, RegRateEntry>();
const REG_WINDOW_MS = 3600_000; // 1 hour
const REG_MAX_PER_WINDOW = 3; // max 3 registrations per IP per hour

function checkRegistrationRate(ip: string): boolean {
  const now = Date.now();
  let entry = regRateMap.get(ip);

  if (!entry || now - entry.windowStart >= REG_WINDOW_MS) {
    entry = { count: 0, windowStart: now };
    regRateMap.set(ip, entry);
  }

  entry.count += 1;
  return entry.count <= REG_MAX_PER_WINDOW;
}

// Periodic cleanup of stale entries (every 30 min)
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of regRateMap) {
    if (now - entry.windowStart > REG_WINDOW_MS * 2) {
      regRateMap.delete(ip);
    }
  }
}, 30 * 60 * 1000).unref();

// =============================================================================
// Router
// =============================================================================

export const developerRouter = Router();

// ---------------------------------------------------------------------------
// POST /api/v1/developers/register — Self-service sandbox key creation
// ---------------------------------------------------------------------------
developerRouter.post('/register', async (req: Request, res: Response) => {
  try {
    const clientIp = req.ip || req.socket.remoteAddress || 'unknown';

    // IP-based rate limiting
    if (!checkRegistrationRate(clientIp)) {
      res.status(429).json({
        error: 'Registration rate limit exceeded. Try again later.',
        retryAfter: 3600,
      });
      return;
    }

    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: 'Invalid request body',
        details: parsed.error.issues.map(i => ({ path: i.path.join('.'), message: i.message })),
      });
      return;
    }

    const { name, communityId } = parsed.data;

    // Create sandbox key with free-tier defaults (10 RPM, 10k TPD)
    const result = await createApiKey({
      userId: `dev_${clientIp.replace(/[^a-zA-Z0-9]/g, '_')}`,
      communityId,
      name,
      mode: 'test',
      // Defaults from createApiKey: 10 RPM, 10k TPD for test mode
    });

    logger.info(
      { keyPrefix: result.keyPrefix, communityId, ip: clientIp },
      'Developer sandbox key registered',
    );

    res.status(201).json({
      id: result.id,
      key: result.cleartext,
      keyPrefix: result.keyPrefix,
      name: result.name,
      mode: result.mode,
      createdAt: result.createdAt,
      limits: {
        requestsPerMinute: 10,
        tokensPerDay: 10_000,
      },
      allowedPools: [...SANDBOX_ALLOWED_POOLS],
      gettingStarted: {
        invokeEndpoint: '/api/v1/developers/invoke',
        streamEndpoint: '/api/v1/developers/stream',
        modelsEndpoint: '/api/v1/developers/models',
        authHeader: `Authorization: Bearer ${result.cleartext}`,
        exampleCurl: `curl -X POST ${req.protocol}://${req.get('host')}/api/v1/developers/invoke \\
  -H "Authorization: Bearer ${result.cleartext}" \\
  -H "Content-Type: application/json" \\
  -d '{"messages": [{"role": "user", "content": "Hello!"}]}'`,
      },
      warning: 'Store this key securely. It will not be shown again.',
      upgradeUrl: '/api/v1/developers/upgrade',
    });
  } catch (err) {
    if (err instanceof ApiKeyLimitError) {
      res.status(409).json({ error: err.message });
      return;
    }
    logger.error({ err }, 'Failed to register developer');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/v1/developers/invoke — Inference proxy (developer key auth)
// ---------------------------------------------------------------------------
developerRouter.post('/invoke', requireDeveloperKey, async (req: DeveloperKeyRequest, res: Response) => {
  try {
    const parsed = invokeSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: 'Invalid request body',
        details: parsed.error.issues.map(i => ({ path: i.path.join('.'), message: i.message })),
      });
      return;
    }

    const keyRecord = req.developerKey!;
    const isSandbox = req.isSandboxKey;

    // Pool enforcement: sandbox keys restricted to `cheap` only
    const requestedPool = parsed.data.pool || 'cheap';
    const allowedPools = isSandbox ? SANDBOX_ALLOWED_POOLS : LIVE_FREE_ALLOWED_POOLS;

    if (!allowedPools.has(requestedPool)) {
      res.status(403).json({
        error: `Pool '${requestedPool}' not available for ${isSandbox ? 'sandbox' : 'your'} key`,
        allowedPools: Array.from(allowedPools),
        upgradeUrl: isSandbox ? '/api/v1/developers/upgrade' : undefined,
      });
      return;
    }

    // Forward to loa-finn agent gateway
    const loaFinnUrl = process.env.LOA_FINN_BASE_URL;
    if (!loaFinnUrl) {
      res.status(503).json({
        error: 'Inference service not configured',
        message: 'The agent gateway is not available. Contact the platform administrator.',
      });
      return;
    }

    const s2sSecret = process.env.DEVELOPER_API_S2S_SECRET || process.env.BILLING_INTERNAL_JWT_SECRET;
    if (!s2sSecret) {
      res.status(503).json({
        error: 'Inference service not configured',
        message: 'Missing service-to-service credentials for gateway authentication.',
      });
      return;
    }

    const gatewayResponse = await fetch(`${loaFinnUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Developer-Key-Id': keyRecord.id,
        'X-Developer-Community-Id': keyRecord.community_id,
        'X-Developer-Pool': requestedPool,
        'X-Developer-Access-Level': isSandbox ? 'free' : 'pro',
        'X-Developer-Is-Sandbox': String(!!isSandbox),
        'Authorization': `Bearer ${s2sSecret}`,
      },
      body: JSON.stringify({
        model: parsed.data.model,
        pool: requestedPool,
        messages: parsed.data.messages,
        max_tokens: parsed.data.max_tokens,
        temperature: parsed.data.temperature,
      }),
      signal: AbortSignal.timeout(60_000),
    });

    if (!gatewayResponse.ok) {
      const errorBody = await gatewayResponse.text();
      logger.warn(
        { status: gatewayResponse.status, keyId: keyRecord.id, pool: requestedPool },
        'Gateway inference error',
      );
      res.status(gatewayResponse.status).json({
        error: 'Inference failed',
        message: gatewayResponse.status === 429
          ? 'Gateway rate limit exceeded'
          : 'The inference service returned an error',
      });
      return;
    }

    const responseData = await gatewayResponse.json() as Record<string, unknown>;

    // Record token usage for TPD tracking
    const usage = responseData.usage as { total_tokens?: number } | undefined;
    if (usage?.total_tokens) {
      recordTokenUsage(keyRecord.id, usage.total_tokens);
    }

    res.json(responseData);
  } catch (err) {
    if (err instanceof Error && err.name === 'TimeoutError') {
      res.status(504).json({ error: 'Gateway timeout' });
      return;
    }
    logger.error({ err }, 'Developer invoke failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/v1/developers/stream — SSE streaming proxy (developer key auth)
// ---------------------------------------------------------------------------
developerRouter.post('/stream', requireDeveloperKey, async (req: DeveloperKeyRequest, res: Response) => {
  try {
    const parsed = invokeSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: 'Invalid request body',
        details: parsed.error.issues.map(i => ({ path: i.path.join('.'), message: i.message })),
      });
      return;
    }

    const keyRecord = req.developerKey!;
    const isSandbox = req.isSandboxKey;

    // Pool enforcement
    const requestedPool = parsed.data.pool || 'cheap';
    const allowedPools = isSandbox ? SANDBOX_ALLOWED_POOLS : LIVE_FREE_ALLOWED_POOLS;

    if (!allowedPools.has(requestedPool)) {
      res.status(403).json({
        error: `Pool '${requestedPool}' not available for ${isSandbox ? 'sandbox' : 'your'} key`,
        allowedPools: Array.from(allowedPools),
      });
      return;
    }

    const loaFinnUrl = process.env.LOA_FINN_BASE_URL;
    if (!loaFinnUrl) {
      res.status(503).json({ error: 'Inference service not configured' });
      return;
    }

    const s2sSecret = process.env.DEVELOPER_API_S2S_SECRET || process.env.BILLING_INTERNAL_JWT_SECRET;
    if (!s2sSecret) {
      res.status(503).json({
        error: 'Inference service not configured',
        message: 'Missing service-to-service credentials for gateway authentication.',
      });
      return;
    }

    const controller = new AbortController();
    const streamTimeout = setTimeout(() => controller.abort(), 120_000);
    let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;

    const gatewayResponse = await fetch(`${loaFinnUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Developer-Key-Id': keyRecord.id,
        'X-Developer-Community-Id': keyRecord.community_id,
        'X-Developer-Pool': requestedPool,
        'X-Developer-Access-Level': isSandbox ? 'free' : 'pro',
        'X-Developer-Is-Sandbox': String(!!isSandbox),
        'Authorization': `Bearer ${s2sSecret}`,
      },
      body: JSON.stringify({
        model: parsed.data.model,
        pool: requestedPool,
        messages: parsed.data.messages,
        max_tokens: parsed.data.max_tokens,
        temperature: parsed.data.temperature,
        stream: true,
      }),
      signal: controller.signal,
    });

    if (!gatewayResponse.ok || !gatewayResponse.body) {
      clearTimeout(streamTimeout);
      res.status(gatewayResponse.status || 502).json({
        error: 'Streaming inference failed',
      });
      return;
    }

    // Set up SSE response
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    // Heartbeat
    const heartbeat = setInterval(() => {
      res.write(': keepalive\n\n');
    }, 15_000);

    const onClose = () => {
      clearInterval(heartbeat);
      clearTimeout(streamTimeout);
      controller.abort();
      if (reader) {
        reader.cancel().catch(() => undefined);
      }
    };
    req.on('close', onClose);
    res.on('close', onClose);

    try {
      reader = gatewayResponse.body.getReader();
      const decoder = new TextDecoder();
      let totalTokens = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        res.write(chunk);

        // Try to parse usage from SSE chunks for TPD tracking
        const usageMatch = chunk.match(/"total_tokens":\s*(\d+)/);
        if (usageMatch && usageMatch[1]) {
          totalTokens = parseInt(usageMatch[1], 10);
        }
      }

      // Record token usage
      if (totalTokens > 0) {
        recordTokenUsage(keyRecord.id, totalTokens);
      }
    } finally {
      clearInterval(heartbeat);
      clearTimeout(streamTimeout);
    }

    res.end();
  } catch (err) {
    if (!res.headersSent) {
      if (err instanceof Error && err.name === 'TimeoutError') {
        res.status(504).json({ error: 'Gateway timeout' });
        return;
      }
      res.status(500).json({ error: 'Internal server error' });
    } else {
      res.end();
    }
    logger.error({ err }, 'Developer stream failed');
  }
});

// ---------------------------------------------------------------------------
// GET /api/v1/developers/models — Available models for key's access level
// ---------------------------------------------------------------------------
developerRouter.get('/models', requireDeveloperKey, (_req: DeveloperKeyRequest, res: Response) => {
  const isSandbox = _req.isSandboxKey;

  const models = isSandbox
    ? {
        pools: {
          cheap: {
            description: 'Cost-optimized models for general tasks',
            models: ['gpt-4o-mini', 'claude-haiku'],
          },
        },
        note: 'Sandbox keys are limited to the cheap pool. Upgrade to a live key for more models.',
        upgradeUrl: '/api/v1/developers/upgrade',
      }
    : {
        pools: {
          cheap: {
            description: 'Cost-optimized models for general tasks',
            models: ['gpt-4o-mini', 'claude-haiku'],
          },
          'fast-code': {
            description: 'Code-specialized models with fast response',
            models: ['gpt-4o', 'claude-sonnet'],
          },
        },
        note: 'Contact support for access to reasoning and architect pools.',
      };

  res.json(models);
});

// ---------------------------------------------------------------------------
// POST /api/v1/developers/upgrade — Upgrade sandbox key to production
// ---------------------------------------------------------------------------
developerRouter.post('/upgrade', requireDeveloperKey, async (req: DeveloperKeyRequest, res: Response) => {
  try {
    const parsed = upgradeSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: 'Invalid request body',
        details: parsed.error.issues.map(i => ({ path: i.path.join('.'), message: i.message })),
      });
      return;
    }

    const keyRecord = req.developerKey!;

    // Only sandbox keys can be upgraded
    if (!req.isSandboxKey) {
      res.status(400).json({ error: 'Only sandbox (test) keys can be upgraded' });
      return;
    }

    // Ensure the sandboxKeyId matches the authenticated key
    if (parsed.data.sandboxKeyId !== keyRecord.id) {
      res.status(403).json({ error: 'Sandbox key mismatch — sandboxKeyId must match the authenticated key' });
      return;
    }

    // Create a new live key with same community, higher limits
    const result = await createApiKey({
      userId: keyRecord.user_id,
      communityId: keyRecord.community_id,
      name: parsed.data.name || `${keyRecord.name} (upgraded)`,
      mode: 'live',
      rateLimitRpm: parsed.data.rateLimitRpm ?? 60,
      rateLimitTpd: parsed.data.rateLimitTpd ?? 100_000,
    });

    logger.info(
      { oldKeyId: parsed.data.sandboxKeyId, newKeyPrefix: result.keyPrefix, userId: keyRecord.user_id },
      'Developer key upgraded to production',
    );

    res.status(201).json({
      id: result.id,
      key: result.cleartext,
      keyPrefix: result.keyPrefix,
      name: result.name,
      mode: result.mode,
      createdAt: result.createdAt,
      limits: {
        requestsPerMinute: parsed.data.rateLimitRpm ?? 60,
        tokensPerDay: parsed.data.rateLimitTpd ?? 100_000,
      },
      allowedPools: [...LIVE_FREE_ALLOWED_POOLS],
      previousKeyId: parsed.data.sandboxKeyId,
      warning: 'Store this key securely. It will not be shown again.',
      note: 'Your sandbox key remains active. Revoke it when ready via DELETE /api/v1/keys/:id',
    });
  } catch (err) {
    if (err instanceof ApiKeyLimitError) {
      res.status(409).json({ error: err.message });
      return;
    }
    logger.error({ err }, 'Failed to upgrade developer key');
    res.status(500).json({ error: 'Internal server error' });
  }
});

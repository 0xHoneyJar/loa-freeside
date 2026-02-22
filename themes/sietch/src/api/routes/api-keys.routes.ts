/**
 * Developer API Key Management Routes
 * Sprint 6 (319), Task 6.3: Key Management Endpoints
 *
 * Self-service CRUD endpoints for developer API key management:
 *   POST   /api/v1/keys           — create key (returns cleartext once)
 *   GET    /api/v1/keys           — list keys (prefix + name + created_at only)
 *   DELETE /api/v1/keys/:id       — revoke key (soft delete)
 *   POST   /api/v1/keys/:id/rotate — revoke old, create new
 *
 * All endpoints scoped by authenticated user. Max 10 active keys per user.
 * Requires authentication via existing auth middleware.
 *
 * SDD refs: §2.2 API Key Authentication
 * PRD refs: FR-5.3 Key Management
 *
 * @module api/routes/api-keys
 */

import { Router, type Response } from 'express';
import { z } from 'zod';
import { logger } from '../../utils/logger.js';
import {
  createApiKey,
  listApiKeys,
  revokeApiKey,
  rotateApiKey,
  ApiKeyLimitError,
} from '../../services/api-keys/ApiKeyService.js';
import type { AuthenticatedRequest } from '../middleware.js';
import {
  requireApiKeyAsync,
  memberRateLimiter,
} from '../middleware.js';
import { getConfig } from '../../config.js';

// =============================================================================
// Validation Schemas
// =============================================================================

const createKeySchema = z.object({
  name: z.string().min(1).max(64).optional().default('Default'),
  mode: z.enum(['live', 'test']).optional().default('live'),
  communityId: z.string().min(1).max(128),
  rateLimitRpm: z.number().int().min(1).max(1000).optional(),
  rateLimitTpd: z.number().int().min(1).max(10_000_000).optional(),
});

const keyIdParamSchema = z.object({
  id: z.string().min(1).max(64),
});

// =============================================================================
// Router
// =============================================================================

export const apiKeysRouter = Router();

// Sprint 7 (320), Task 7.3: Feature flag kill switch (creation only — existing keys still work)
function requireApiKeysEnabled(_req: AuthenticatedRequest, res: Response, next: () => void) {
  const config = getConfig();
  if (!config.features.apiKeysEnabled) {
    res.status(503).json({
      error: 'API key creation not enabled',
      message: 'Developer API key creation is currently disabled',
    });
    return;
  }
  next();
}

// All key management endpoints require authentication and rate limiting
apiKeysRouter.use(memberRateLimiter);
apiKeysRouter.use(requireApiKeyAsync);

// ---------------------------------------------------------------------------
// POST /api/v1/keys — Create a new developer API key
// ---------------------------------------------------------------------------
apiKeysRouter.post('/', requireApiKeysEnabled, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const parsed = createKeySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: 'Invalid request body',
        details: parsed.error.issues.map(i => ({ path: i.path.join('.'), message: i.message })),
      });
      return;
    }

    const { name, mode, communityId, rateLimitRpm, rateLimitTpd } = parsed.data;

    if (!req.adminName) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const userId = req.adminName;

    const result = await createApiKey({
      userId,
      communityId,
      name,
      mode,
      rateLimitRpm,
      rateLimitTpd,
    });

    // Return cleartext exactly once — client must store it
    res.status(201).json({
      id: result.id,
      key: result.cleartext,
      keyPrefix: result.keyPrefix,
      name: result.name,
      mode: result.mode,
      createdAt: result.createdAt,
      warning: 'Store this key securely. It will not be shown again.',
    });
  } catch (err) {
    if (err instanceof ApiKeyLimitError) {
      res.status(409).json({ error: err.message });
      return;
    }
    logger.error({ err }, 'Failed to create API key');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/v1/keys — List active keys for the authenticated user
// ---------------------------------------------------------------------------
apiKeysRouter.get('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.adminName) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const userId = req.adminName;
    const keys = await listApiKeys(userId);

    // Only return non-sensitive fields (no key_hash, key_salt, etc.)
    const safeKeys = keys.map(k => ({
      id: k.id,
      keyPrefix: k.keyPrefix,
      name: k.name,
      mode: k.mode,
      rateLimitRpm: k.rateLimitRpm,
      rateLimitTpd: k.rateLimitTpd,
      lastUsedAt: k.lastUsedAt,
      createdAt: k.createdAt,
    }));

    res.json({
      keys: safeKeys,
      count: safeKeys.length,
    });
  } catch (err) {
    logger.error({ err }, 'Failed to list API keys');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/v1/keys/:id — Revoke (soft-delete) an API key
// ---------------------------------------------------------------------------
apiKeysRouter.delete('/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const parsed = keyIdParamSchema.safeParse(req.params);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid key ID' });
      return;
    }

    if (!req.adminName) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const userId = req.adminName;
    const revoked = await revokeApiKey(parsed.data.id, userId);

    if (!revoked) {
      res.status(404).json({ error: 'Key not found or already revoked' });
      return;
    }

    res.json({ revoked: true, id: parsed.data.id });
  } catch (err) {
    logger.error({ err }, 'Failed to revoke API key');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/v1/keys/:id/rotate — Revoke old key, create new one
// ---------------------------------------------------------------------------
apiKeysRouter.post('/:id/rotate', requireApiKeysEnabled, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const parsed = keyIdParamSchema.safeParse(req.params);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid key ID' });
      return;
    }

    if (!req.adminName) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const userId = req.adminName;
    const result = await rotateApiKey(parsed.data.id, userId);

    if (!result) {
      res.status(404).json({ error: 'Key not found or already revoked' });
      return;
    }

    res.status(201).json({
      id: result.id,
      key: result.cleartext,
      keyPrefix: result.keyPrefix,
      name: result.name,
      mode: result.mode,
      createdAt: result.createdAt,
      previousKeyId: parsed.data.id,
      warning: 'Store this key securely. It will not be shown again.',
    });
  } catch (err) {
    if (err instanceof ApiKeyLimitError) {
      res.status(409).json({ error: err.message });
      return;
    }
    logger.error({ err }, 'Failed to rotate API key');
    res.status(500).json({ error: 'Internal server error' });
  }
});

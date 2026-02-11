/**
 * BYOK Admin Routes — Bring Your Own Key Management
 * Sprint 3, Task 3.3: CRUD endpoints for community API key management
 *
 * Routes:
 *   POST   /api/admin/communities/:id/byok/keys           — Store a new key
 *   GET    /api/admin/communities/:id/byok/keys           — List keys
 *   DELETE /api/admin/communities/:id/byok/keys/:keyId    — Revoke a key
 *   POST   /api/admin/communities/:id/byok/keys/:keyId/rotate — Rotate a key
 *
 * All routes require admin auth (AC-4.10).
 *
 * @see SDD §6.2 BYOK Admin API
 * @see PRD FR-4 BYOK Key Management
 */

import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import type { BYOKManager, BYOKManagerError } from '@arrakis/adapters/agent/byok-manager';

// --------------------------------------------------------------------------
// Zod Schemas
// --------------------------------------------------------------------------

/** Allowed provider identifiers */
const ALLOWED_PROVIDERS = ['openai', 'anthropic'] as const;

/** POST body for storing a new key */
const storeKeySchema = z.object({
  provider: z.enum(ALLOWED_PROVIDERS),
  apiKey: z.string().min(8).max(512),
});

/** POST body for rotating a key */
const rotateKeySchema = z.object({
  apiKey: z.string().min(8).max(512),
});

/** UUID param validation */
const uuidParamSchema = z.string().uuid();

// --------------------------------------------------------------------------
// Types
// --------------------------------------------------------------------------

/** Dependencies for BYOK admin routes */
export interface BYOKRoutesDeps {
  /** BYOK manager instance */
  byokManager: BYOKManager;
  /** Auth middleware — must verify platform admin or community owner */
  requireAdmin: (req: Request, res: Response, next: NextFunction) => void;
  /** Whether BYOK feature is enabled (BYOK_ENABLED env var). Default: true for backward compat. */
  byokEnabled?: boolean;
}

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

/** Extract admin user ID from request (set by auth middleware) */
function getAdminUserId(req: Request): string {
  const caller = (req as Record<string, unknown>).caller as { userId?: string } | undefined;
  return caller?.userId ?? 'unknown';
}

/** Handle BYOKManagerError or generic errors */
function handleError(res: Response, err: unknown): void {
  if (err && typeof err === 'object' && 'code' in err && 'statusCode' in err) {
    const byokErr = err as { code: string; message: string; statusCode: number };
    res.status(byokErr.statusCode).json({
      error: byokErr.code,
      message: byokErr.message,
    });
    return;
  }

  res.status(500).json({ error: 'INTERNAL_ERROR' });
}

// --------------------------------------------------------------------------
// Factory
// --------------------------------------------------------------------------

/**
 * Create BYOK admin routes.
 *
 * AC-4.1: Full CRUD lifecycle (store → list → rotate → revoke).
 * AC-4.10: Admin-only access enforced via requireAdmin middleware.
 */
export function createBYOKRoutes(deps: BYOKRoutesDeps): Router {
  const router = Router();

  // All routes require admin auth (AC-4.10)
  router.use(deps.requireAdmin);

  // BYOK feature gate (BB3-5, AC-4.28): reject all requests when BYOK is disabled
  if (deps.byokEnabled === false) {
    router.use((_req: Request, res: Response) => {
      res.status(404).json({ error: 'BYOK_DISABLED', message: 'BYOK feature is not enabled' });
    });
    return router;
  }

  // --------------------------------------------------------------------------
  // POST /api/admin/communities/:id/byok/keys — Store a new key
  // --------------------------------------------------------------------------

  router.post(
    '/communities/:id/byok/keys',
    async (req: Request, res: Response) => {
      try {
        const communityId = req.params.id;
        const parsed = storeKeySchema.safeParse(req.body);
        if (!parsed.success) {
          res.status(400).json({
            error: 'INVALID_REQUEST',
            message: parsed.error.issues.map((i) => i.message).join(', '),
          });
          return;
        }

        const { provider, apiKey } = parsed.data;
        const createdBy = getAdminUserId(req);

        // Convert to Buffer for secure handling (never kept as string in memory)
        const apiKeyBuffer = Buffer.from(apiKey, 'utf8');

        const result = await deps.byokManager.storeKey(
          communityId,
          provider,
          apiKeyBuffer,
          createdBy,
        );

        res.status(201).json(result);
      } catch (err) {
        handleError(res, err);
      }
    },
  );

  // --------------------------------------------------------------------------
  // GET /api/admin/communities/:id/byok/keys — List keys
  // --------------------------------------------------------------------------

  router.get(
    '/communities/:id/byok/keys',
    async (req: Request, res: Response) => {
      try {
        const communityId = req.params.id;
        const keys = await deps.byokManager.listKeys(communityId);
        res.json({ keys });
      } catch (err) {
        handleError(res, err);
      }
    },
  );

  // --------------------------------------------------------------------------
  // DELETE /api/admin/communities/:id/byok/keys/:keyId — Revoke a key
  // --------------------------------------------------------------------------

  router.delete(
    '/communities/:id/byok/keys/:keyId',
    async (req: Request, res: Response) => {
      try {
        const communityId = req.params.id;
        const { keyId } = req.params;

        const keyIdParsed = uuidParamSchema.safeParse(keyId);
        if (!keyIdParsed.success) {
          res.status(400).json({ error: 'INVALID_KEY_ID', message: 'keyId must be a UUID' });
          return;
        }

        await deps.byokManager.revokeKey(communityId, keyId);
        res.status(204).end();
      } catch (err) {
        handleError(res, err);
      }
    },
  );

  // --------------------------------------------------------------------------
  // POST /api/admin/communities/:id/byok/keys/:keyId/rotate — Rotate a key
  // --------------------------------------------------------------------------

  router.post(
    '/communities/:id/byok/keys/:keyId/rotate',
    async (req: Request, res: Response) => {
      try {
        const communityId = req.params.id;
        const { keyId } = req.params;

        const keyIdParsed = uuidParamSchema.safeParse(keyId);
        if (!keyIdParsed.success) {
          res.status(400).json({ error: 'INVALID_KEY_ID', message: 'keyId must be a UUID' });
          return;
        }

        const parsed = rotateKeySchema.safeParse(req.body);
        if (!parsed.success) {
          res.status(400).json({
            error: 'INVALID_REQUEST',
            message: parsed.error.issues.map((i) => i.message).join(', '),
          });
          return;
        }

        const createdBy = getAdminUserId(req);
        const newKeyBuffer = Buffer.from(parsed.data.apiKey, 'utf8');

        const result = await deps.byokManager.rotateKey(
          communityId,
          keyId,
          newKeyBuffer,
          createdBy,
        );

        res.json(result);
      } catch (err) {
        handleError(res, err);
      }
    },
  );

  return router;
}

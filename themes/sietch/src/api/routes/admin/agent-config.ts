/**
 * Community Agent Config Admin API
 * Sprint S4-T5: CRUD endpoints for per-community AI configuration
 *
 * Manages budget limits, tier overrides, and enable/disable for communities.
 * Changes trigger immediate BudgetConfigProvider refresh (not wait 5min sync).
 *
 * @see SDD §6.2 Admin API
 * @see Flatline IMP-010
 */

import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';

// --------------------------------------------------------------------------
// Types
// --------------------------------------------------------------------------

/** A row from community_agent_config */
export interface AgentConfigRow {
  communityId: string;
  aiEnabled: boolean;
  monthlyBudgetCents: number;
  tierOverrides: Record<string, unknown> | null;
  pricingOverrides: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Data access for community agent config (injected) */
export interface AgentConfigStore {
  getConfig(communityId: string): Promise<AgentConfigRow | null>;
  upsertConfig(communityId: string, data: Partial<AgentConfigRow>): Promise<AgentConfigRow>;
}

/** Audit logger interface (injected) */
export interface AgentConfigAuditLogger {
  log(entry: {
    action: string;
    adminUserId: string;
    communityId: string;
    before: Record<string, unknown> | null;
    after: Record<string, unknown>;
  }): void;
}

/** BudgetConfigProvider refresh trigger (injected) */
export interface BudgetRefreshTrigger {
  syncBudgetLimits(): Promise<{ synced: number; errors: number }>;
}

/** Dependencies for admin agent config routes */
export interface AgentConfigRoutesDeps {
  store: AgentConfigStore;
  audit: AgentConfigAuditLogger;
  budgetRefresh: BudgetRefreshTrigger;
  /** Redis instance for immediate limit push */
  redis: { set(key: string, value: string): Promise<unknown> };
  /** Auth middleware — must verify platform admin or community owner */
  requireAdmin: (req: Request, res: Response, next: NextFunction) => void;
}

// --------------------------------------------------------------------------
// Zod Schemas
// --------------------------------------------------------------------------

/** Tier override entry: community-level tier mapping */
const tierOverrideSchema = z.record(
  z.string(),
  z.object({
    accessLevel: z.enum(['free', 'pro', 'enterprise']).optional(),
    maxRequestsPerDay: z.number().int().min(0).max(100_000).optional(),
  }),
).optional().nullable();

/** Pricing override entry: per-model-alias pricing */
const pricingOverrideSchema = z.record(
  z.string(),
  z.object({
    inputPer1k: z.number().min(0).max(100_000),
    outputPer1k: z.number().min(0).max(100_000),
  }),
).optional().nullable();

/** PUT /api/admin/communities/:id/agent-config body */
const updateConfigSchema = z.object({
  monthlyBudgetCents: z.number().int().min(0).max(10_000_000).optional(),
  tierOverrides: tierOverrideSchema,
  pricingOverrides: pricingOverrideSchema,
});

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

/** Serialize a config row to a safe JSON response */
function toResponse(row: AgentConfigRow) {
  return {
    communityId: row.communityId,
    aiEnabled: row.aiEnabled,
    monthlyBudgetCents: row.monthlyBudgetCents,
    tierOverrides: row.tierOverrides,
    pricingOverrides: row.pricingOverrides,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Get admin user ID from request (set by auth middleware) */
function getAdminUserId(req: Request): string {
  const caller = (req as Record<string, unknown>).caller as { userId?: string } | undefined;
  return caller?.userId ?? 'unknown';
}

// --------------------------------------------------------------------------
// Factory
// --------------------------------------------------------------------------

/**
 * Create admin agent config routes.
 *
 * Routes:
 *   GET    /api/admin/communities/:id/agent-config
 *   PUT    /api/admin/communities/:id/agent-config
 *   POST   /api/admin/communities/:id/agent-config/enable
 *   POST   /api/admin/communities/:id/agent-config/disable
 */
export function createAgentConfigRoutes(deps: AgentConfigRoutesDeps): Router {
  const router = Router();

  // All routes require admin auth
  router.use(deps.requireAdmin);

  // --------------------------------------------------------------------------
  // GET /api/admin/communities/:id/agent-config
  // --------------------------------------------------------------------------

  router.get(
    '/communities/:id/agent-config',
    async (req: Request, res: Response) => {
      try {
        const { id } = req.params;
        const config = await deps.store.getConfig(id);

        if (!config) {
          res.status(404).json({ error: 'NOT_FOUND', message: 'No agent config for this community' });
          return;
        }

        res.json(toResponse(config));
      } catch {
        res.status(500).json({ error: 'INTERNAL_ERROR' });
      }
    },
  );

  // --------------------------------------------------------------------------
  // PUT /api/admin/communities/:id/agent-config
  // --------------------------------------------------------------------------

  router.put(
    '/communities/:id/agent-config',
    async (req: Request, res: Response) => {
      try {
        const { id } = req.params;
        const parsed = updateConfigSchema.safeParse(req.body);
        if (!parsed.success) {
          res.status(400).json({ error: 'INVALID_REQUEST', message: 'Invalid request' });
          return;
        }

        // Capture before state for audit
        const before = await deps.store.getConfig(id);

        const updated = await deps.store.upsertConfig(id, {
          ...parsed.data,
          updatedAt: new Date(),
        });

        // Audit log
        deps.audit.log({
          action: 'agent_config_update',
          adminUserId: getAdminUserId(req),
          communityId: id,
          before: before ? toResponse(before) : null,
          after: toResponse(updated),
        });

        // Immediate budget limit sync to Redis
        if (parsed.data.monthlyBudgetCents != null) {
          const limitKey = `agent:budget:limit:${id}`;
          await deps.redis.set(limitKey, String(parsed.data.monthlyBudgetCents));
        }

        // Trigger full sync for pricing overrides and other changes
        await deps.budgetRefresh.syncBudgetLimits();

        res.json(toResponse(updated));
      } catch {
        res.status(500).json({ error: 'INTERNAL_ERROR' });
      }
    },
  );

  // --------------------------------------------------------------------------
  // POST /api/admin/communities/:id/agent-config/enable
  // --------------------------------------------------------------------------

  router.post(
    '/communities/:id/agent-config/enable',
    async (req: Request, res: Response) => {
      try {
        const { id } = req.params;
        const before = await deps.store.getConfig(id);

        const updated = await deps.store.upsertConfig(id, {
          aiEnabled: true,
          updatedAt: new Date(),
        });

        deps.audit.log({
          action: 'agent_config_enable',
          adminUserId: getAdminUserId(req),
          communityId: id,
          before: before ? toResponse(before) : null,
          after: toResponse(updated),
        });

        // Sync budget limit to Redis so enforcement knows about this community
        const limitKey = `agent:budget:limit:${id}`;
        await deps.redis.set(limitKey, String(updated.monthlyBudgetCents));

        await deps.budgetRefresh.syncBudgetLimits();

        res.json(toResponse(updated));
      } catch {
        res.status(500).json({ error: 'INTERNAL_ERROR' });
      }
    },
  );

  // --------------------------------------------------------------------------
  // POST /api/admin/communities/:id/agent-config/disable
  // --------------------------------------------------------------------------

  router.post(
    '/communities/:id/agent-config/disable',
    async (req: Request, res: Response) => {
      try {
        const { id } = req.params;
        const before = await deps.store.getConfig(id);

        const updated = await deps.store.upsertConfig(id, {
          aiEnabled: false,
          updatedAt: new Date(),
        });

        deps.audit.log({
          action: 'agent_config_disable',
          adminUserId: getAdminUserId(req),
          communityId: id,
          before: before ? toResponse(before) : null,
          after: toResponse(updated),
        });

        // Trigger sync so enforcement stops this community
        await deps.budgetRefresh.syncBudgetLimits();

        res.json(toResponse(updated));
      } catch {
        res.status(500).json({ error: 'INTERNAL_ERROR' });
      }
    },
  );

  return router;
}

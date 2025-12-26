/**
 * Admin API Routes (v4.0 - Sprint 26)
 *
 * Admin-only endpoints for:
 * - Fee waiver management (grant, revoke, list)
 * - Subscription management (list, manual overrides)
 * - Billing audit log queries
 * - System administration
 *
 * All routes require API key authentication.
 * All actions are logged in billing_audit_log.
 */

import { Router } from 'express';
import { z } from 'zod';
import type { Response } from 'express';
import type { AuthenticatedRequest } from './middleware.js';
import {
  requireApiKey,
  memberRateLimiter,
  ValidationError,
  NotFoundError,
} from './middleware.js';
import { config, isBillingEnabled } from '../config.js';
import { waiverService, billingAuditService, gatekeeperService } from '../services/billing/index.js';
import {
  getSubscriptionByCommunityId,
  getAllActiveFeeWaivers,
  updateSubscription,
  logBillingAuditEvent,
} from '../db/billing-queries.js';
import { logger } from '../utils/logger.js';
import type {
  SubscriptionTier,
  SubscriptionStatus,
  FeeWaiver,
  BillingAuditEventType,
} from '../types/billing.js';

// =============================================================================
// Router Setup
// =============================================================================

export const adminRouter = Router();

// Note: Authentication and rate limiting are applied in routes.ts
// The parent adminRouter already has requireApiKey and adminRateLimiter
// We don't duplicate those middlewares here

// =============================================================================
// Middleware: Check Billing Enabled
// =============================================================================

function requireBillingEnabled(req: AuthenticatedRequest, res: Response, next: Function) {
  if (!isBillingEnabled()) {
    res.status(503).json({
      error: 'Billing system not enabled',
      message: 'The billing system is currently disabled',
    });
    return;
  }
  next();
}

// =============================================================================
// Schema Definitions
// =============================================================================

/**
 * Grant waiver request schema
 */
const grantWaiverSchema = z.object({
  community_id: z.string().min(1),
  tier: z.enum(['starter', 'basic', 'premium', 'exclusive', 'elite', 'enterprise']).default('enterprise'),
  reason: z.string().min(10).max(500),
  expires_at: z.string().datetime().optional(),
  internal_notes: z.string().max(1000).optional(),
});

/**
 * Revoke waiver request schema
 */
const revokeWaiverSchema = z.object({
  reason: z.string().min(10).max(500),
});

/**
 * List waivers query schema
 */
const listWaiversSchema = z.object({
  include_inactive: z.string().transform(val => val === 'true').default('false'),
  community_id: z.string().optional(),
});

/**
 * Update subscription request schema
 */
const updateSubscriptionSchema = z.object({
  tier: z.enum(['starter', 'basic', 'premium', 'exclusive', 'elite', 'enterprise']).optional(),
  status: z.enum(['active', 'past_due', 'canceled', 'trialing', 'unpaid']).optional(),
  grace_until: z.string().datetime().optional().nullable(),
});

/**
 * Query audit log schema
 */
const queryAuditLogSchema = z.object({
  limit: z.string().transform(val => parseInt(val, 10)).default('100'),
  event_type: z.string().optional(),
  community_id: z.string().optional(),
  since: z.string().datetime().optional(),
});

// =============================================================================
// Fee Waiver Management Routes
// =============================================================================

/**
 * POST /admin/waivers
 * Grant a fee waiver to a community
 */
adminRouter.post(
  '/waivers',
  requireBillingEnabled,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      // Validate request body
      const body = grantWaiverSchema.parse(req.body);

      // Get admin username from auth context
      const grantedBy = req.apiKeyId ?? 'api-key';

      logger.info(
        { communityId: body.community_id, tier: body.tier, grantedBy },
        'Admin granting fee waiver'
      );

      // Grant waiver
      const result = await waiverService.grantWaiver({
        communityId: body.community_id,
        tier: body.tier,
        reason: body.reason,
        grantedBy,
        expiresAt: body.expires_at ? new Date(body.expires_at) : undefined,
        internalNotes: body.internal_notes,
      });

      res.status(201).json({
        success: true,
        waiver: {
          id: result.waiver.id,
          community_id: result.waiver.communityId,
          tier: result.waiver.tier,
          reason: result.waiver.reason,
          granted_by: result.waiver.grantedBy,
          granted_at: result.waiver.grantedAt.toISOString(),
          expires_at: result.waiver.expiresAt?.toISOString() || null,
          created_at: result.waiver.createdAt.toISOString(),
        },
        previous_waiver_revoked: result.previousWaiverRevoked,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({
          error: 'Validation failed',
          details: error.errors,
        });
        return;
      }

      logger.error({ error: (error as Error).message }, 'Failed to grant waiver');

      if ((error as Error).message.includes('already has')) {
        res.status(409).json({
          error: 'Conflict',
          message: (error as Error).message,
        });
        return;
      }

      res.status(500).json({
        error: 'Internal server error',
        message: (error as Error).message,
      });
    }
  }
);

/**
 * GET /admin/waivers
 * List all fee waivers (optionally including inactive)
 */
adminRouter.get(
  '/waivers',
  requireBillingEnabled,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      // Validate query params
      const query = listWaiversSchema.parse(req.query);

      logger.debug(
        { includeInactive: query.include_inactive, communityId: query.community_id },
        'Admin listing waivers'
      );

      // List waivers
      const waivers = waiverService.listWaivers({
        includeInactive: query.include_inactive,
        communityId: query.community_id,
      });

      res.json({
        success: true,
        count: waivers.length,
        waivers: waivers.map((w) => ({
          id: w.id,
          community_id: w.communityId,
          tier: w.tier,
          reason: w.reason,
          granted_by: w.grantedBy,
          granted_at: w.grantedAt.toISOString(),
          expires_at: w.expiresAt?.toISOString() || null,
          revoked_at: w.revokedAt?.toISOString() || null,
          revoked_by: w.revokedBy || null,
          revoke_reason: w.revokeReason || null,
          is_active: !w.revokedAt && (!w.expiresAt || w.expiresAt > new Date()),
        })),
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({
          error: 'Validation failed',
          details: error.errors,
        });
        return;
      }

      logger.error({ error: (error as Error).message }, 'Failed to list waivers');

      res.status(500).json({
        error: 'Internal server error',
        message: (error as Error).message,
      });
    }
  }
);

/**
 * DELETE /admin/waivers/:communityId
 * Revoke a fee waiver
 */
adminRouter.delete(
  '/waivers/:communityId',
  requireBillingEnabled,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { communityId } = req.params;

      if (!communityId) {
        res.status(400).json({ error: 'Community ID is required' });
        return;
      }

      // Validate request body
      const body = revokeWaiverSchema.parse(req.body);

      // Get admin username from auth context
      const revokedBy = req.apiKeyId ?? 'api-key';

      logger.info(
        { communityId, revokedBy },
        'Admin revoking fee waiver'
      );

      // Revoke waiver
      await waiverService.revokeWaiver({
        communityId,
        reason: body.reason,
        revokedBy: revokedBy || 'api-key',
      });

      res.json({
        success: true,
        message: 'Fee waiver revoked successfully',
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({
          error: 'Validation failed',
          details: error.errors,
        });
        return;
      }

      logger.error({ error: (error as Error).message }, 'Failed to revoke waiver');

      if ((error as Error).message.includes('No active waiver')) {
        res.status(404).json({
          error: 'Not found',
          message: (error as Error).message,
        });
        return;
      }

      res.status(500).json({
        error: 'Internal server error',
        message: (error as Error).message,
      });
    }
  }
);

/**
 * GET /admin/waivers/:communityId
 * Get waiver info for a specific community
 */
adminRouter.get(
  '/waivers/:communityId',
  requireBillingEnabled,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { communityId } = req.params;

      if (!communityId) {
        res.status(400).json({ error: 'Community ID is required' });
        return;
      }

      const info = waiverService.getWaiverInfo(communityId);

      res.json({
        success: true,
        has_waiver: info.hasWaiver,
        waiver: info.waiver ? {
          id: info.waiver.id,
          community_id: info.waiver.communityId,
          tier: info.waiver.tier,
          reason: info.waiver.reason,
          granted_by: info.waiver.grantedBy,
          granted_at: info.waiver.grantedAt.toISOString(),
          expires_at: info.waiver.expiresAt?.toISOString() || null,
        } : null,
        is_expiring_soon: info.isExpiringSoon,
        days_until_expiry: info.daysUntilExpiry,
      });
    } catch (error) {
      logger.error({ error: (error as Error).message }, 'Failed to get waiver info');

      res.status(500).json({
        error: 'Internal server error',
        message: (error as Error).message,
      });
    }
  }
);

// =============================================================================
// Subscription Management Routes
// =============================================================================

/**
 * GET /admin/subscriptions
 * List all subscriptions (with optional filters)
 */
adminRouter.get(
  '/subscriptions',
  requireBillingEnabled,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      // For now, we don't have a getAllSubscriptions query
      // This would need to be added to billing-queries.ts
      // For Sprint 26, we'll return a placeholder

      res.json({
        success: true,
        message: 'Subscription listing not yet implemented',
        note: 'Query specific subscriptions via /admin/subscriptions/:communityId',
      });
    } catch (error) {
      logger.error({ error: (error as Error).message }, 'Failed to list subscriptions');

      res.status(500).json({
        error: 'Internal server error',
        message: (error as Error).message,
      });
    }
  }
);

/**
 * GET /admin/subscriptions/:communityId
 * Get subscription details for a community
 */
adminRouter.get(
  '/subscriptions/:communityId',
  requireBillingEnabled,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { communityId } = req.params;

      if (!communityId) {
        res.status(400).json({ error: 'Community ID is required' });
        return;
      }

      const subscription = getSubscriptionByCommunityId(communityId);

      if (!subscription) {
        res.status(404).json({
          error: 'Not found',
          message: `No subscription found for community ${communityId}`,
        });
        return;
      }

      res.json({
        success: true,
        subscription: {
          id: subscription.id,
          community_id: subscription.communityId,
          stripe_customer_id: subscription.stripeCustomerId || null,
          stripe_subscription_id: subscription.stripeSubscriptionId || null,
          tier: subscription.tier,
          status: subscription.status,
          grace_until: subscription.graceUntil?.toISOString() || null,
          current_period_start: subscription.currentPeriodStart?.toISOString() || null,
          current_period_end: subscription.currentPeriodEnd?.toISOString() || null,
          created_at: subscription.createdAt.toISOString(),
          updated_at: subscription.updatedAt.toISOString(),
        },
      });
    } catch (error) {
      logger.error({ error: (error as Error).message }, 'Failed to get subscription');

      res.status(500).json({
        error: 'Internal server error',
        message: (error as Error).message,
      });
    }
  }
);

/**
 * PATCH /admin/subscriptions/:communityId
 * Manual subscription override (admin only)
 */
adminRouter.patch(
  '/subscriptions/:communityId',
  requireBillingEnabled,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { communityId } = req.params;

      if (!communityId) {
        res.status(400).json({ error: 'Community ID is required' });
        return;
      }

      // Validate request body
      const body = updateSubscriptionSchema.parse(req.body);

      // Get admin username from auth context
      const actor = req.apiKeyId ?? 'api-key';

      logger.warn(
        { communityId, changes: body, actor },
        'Admin manually updating subscription'
      );

      // Check if subscription exists
      const existing = getSubscriptionByCommunityId(communityId);
      if (!existing) {
        res.status(404).json({
          error: 'Not found',
          message: `No subscription found for community ${communityId}`,
        });
        return;
      }

      // Update subscription
      const success = updateSubscription(communityId, {
        tier: body.tier,
        status: body.status,
        graceUntil: body.grace_until ? new Date(body.grace_until) : undefined,
      });

      if (!success) {
        res.status(500).json({
          error: 'Update failed',
          message: 'Failed to update subscription',
        });
        return;
      }

      // Log audit event
      logBillingAuditEvent(
        'subscription_updated',
        {
          oldTier: existing.tier,
          newTier: body.tier || existing.tier,
          changes: body,
          manual_override: true,
        },
        communityId,
        actor
      );

      // Invalidate cache
      await gatekeeperService.invalidateCache(communityId);

      // Get updated subscription
      const updated = getSubscriptionByCommunityId(communityId);

      res.json({
        success: true,
        message: 'Subscription updated successfully',
        subscription: updated ? {
          id: updated.id,
          community_id: updated.communityId,
          tier: updated.tier,
          status: updated.status,
          grace_until: updated.graceUntil?.toISOString() || null,
          updated_at: updated.updatedAt.toISOString(),
        } : null,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({
          error: 'Validation failed',
          details: error.errors,
        });
        return;
      }

      logger.error({ error: (error as Error).message }, 'Failed to update subscription');

      res.status(500).json({
        error: 'Internal server error',
        message: (error as Error).message,
      });
    }
  }
);

// =============================================================================
// Audit Log Routes
// =============================================================================

/**
 * GET /admin/audit-log
 * Query billing audit log
 */
adminRouter.get(
  '/audit-log',
  requireBillingEnabled,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      // Validate query params
      const query = queryAuditLogSchema.parse(req.query);

      logger.debug({ query }, 'Admin querying audit log');

      // Query audit log
      const result = billingAuditService.queryAuditLog({
        limit: query.limit,
        eventType: query.event_type as BillingAuditEventType | undefined,
        communityId: query.community_id,
        since: query.since ? new Date(query.since) : undefined,
      });

      res.json({
        success: true,
        count: result.entries.length,
        has_more: result.hasMore,
        entries: result.entries.map((e) => ({
          id: e.id,
          event_type: e.eventType,
          community_id: e.communityId || null,
          event_data: e.eventData,
          actor: e.actor || null,
          created_at: e.createdAt.toISOString(),
        })),
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({
          error: 'Validation failed',
          details: error.errors,
        });
        return;
      }

      logger.error({ error: (error as Error).message }, 'Failed to query audit log');

      res.status(500).json({
        error: 'Internal server error',
        message: (error as Error).message,
      });
    }
  }
);

/**
 * GET /admin/audit-log/statistics
 * Get audit log statistics
 */
adminRouter.get(
  '/audit-log/statistics',
  requireBillingEnabled,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { community_id } = req.query;

      const stats = billingAuditService.getStatistics(
        community_id as string | undefined
      );

      res.json({
        success: true,
        statistics: {
          event_counts: stats.eventCounts,
          total_events: stats.totalEvents,
          oldest_event: stats.oldestEvent?.toISOString() || null,
          newest_event: stats.newestEvent?.toISOString() || null,
        },
      });
    } catch (error) {
      logger.error({ error: (error as Error).message }, 'Failed to get audit log statistics');

      res.status(500).json({
        error: 'Internal server error',
        message: (error as Error).message,
      });
    }
  }
);

// =============================================================================
// System Status Routes
// =============================================================================

/**
 * GET /admin/status
 * Get overall billing system status
 */
adminRouter.get(
  '/status',
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const billingEnabled = isBillingEnabled();
      const activeWaiverCount = waiverService.getActiveWaiverCount();

      res.json({
        success: true,
        status: {
          billing_enabled: billingEnabled,
          active_waivers: activeWaiverCount,
          stripe_configured: !!config.stripe?.secretKey,
          redis_configured: !!config.redis?.url,
        },
      });
    } catch (error) {
      logger.error({ error: (error as Error).message }, 'Failed to get status');

      res.status(500).json({
        error: 'Internal server error',
        message: (error as Error).message,
      });
    }
  }
);

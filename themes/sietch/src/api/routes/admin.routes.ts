/**
 * Admin Routes Module
 * Sprint 51: Route modularization - Admin endpoints
 */

import { Router } from 'express';
import { z } from 'zod';
import type { Response } from 'express';
import type { AuthenticatedRequest } from '../middleware.js';
import {
  adminRateLimiter,
  requireApiKeyAsync,
  ValidationError,
  NotFoundError,
} from '../middleware.js';
import {
  getHealthStatus,
  getActiveAdminOverrides,
  createAdminOverride,
  deactivateAdminOverride,
  getAuditLog,
  logAuditEvent,
} from '../../db/index.js';
import { config } from '../../config.js';
import { adminAwardBadge, revokeBadge } from '../../services/badge.js';
import { listAllActiveGrants, revokeGrant, getBadgeLineage, getGrantById } from '../../services/WaterSharerService.js';
import { notificationService } from '../../services/notification.js';
import { analyticsService } from '../../services/AnalyticsService.js';
import type { AlertStatsResponse } from '../../types/index.js';

/**
 * Admin routes (rate limited, API key required)
 */
export const adminRouter = Router();

// Apply admin rate limiting and authentication
// Sprint 73 (HIGH-1): Use async API key validation with bcrypt
adminRouter.use(adminRateLimiter);
adminRouter.use(requireApiKeyAsync);

/**
 * Zod schema for admin override request
 */
const adminOverrideSchema = z.object({
  address: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid Ethereum address'),
  action: z.enum(['add', 'remove']),
  reason: z.string().min(1, 'Reason is required').max(500, 'Reason too long'),
  expires_at: z.string().datetime().optional(),
});

/**
 * POST /admin/override
 * Create an admin override
 */
adminRouter.post('/override', (req: AuthenticatedRequest, res: Response) => {
  const result = adminOverrideSchema.safeParse(req.body);

  if (!result.success) {
    const errors = result.error.issues.map((i) => i.message).join(', ');
    throw new ValidationError(errors);
  }

  const { address, action, reason, expires_at } = result.data;

  const overrideId = createAdminOverride({
    address,
    action,
    reason,
    createdBy: req.adminName!,
    expiresAt: expires_at ? new Date(expires_at) : null,
  });

  res.status(201).json({
    id: overrideId,
    message: `Override created: ${action} ${address}`,
  });
});

/**
 * GET /admin/overrides
 * List all active admin overrides
 */
adminRouter.get('/overrides', (_req: AuthenticatedRequest, res: Response) => {
  const overrides = getActiveAdminOverrides();

  res.json({
    overrides: overrides.map((o) => ({
      id: o.id,
      address: o.address,
      action: o.action,
      reason: o.reason,
      created_by: o.createdBy,
      created_at: o.createdAt.toISOString(),
      expires_at: o.expiresAt?.toISOString() ?? null,
    })),
  });
});

/**
 * DELETE /admin/override/:id
 * Deactivate an admin override
 */
adminRouter.delete('/override/:id', (req: AuthenticatedRequest, res: Response) => {
  const idParam = req.params.id;
  if (!idParam) {
    throw new ValidationError('Override ID is required');
  }
  const id = parseInt(idParam, 10);

  if (isNaN(id)) {
    throw new ValidationError('Invalid override ID');
  }

  const success = deactivateAdminOverride(id);

  if (!success) {
    throw new NotFoundError('Override not found');
  }

  logAuditEvent('admin_override', {
    action: 'deactivate',
    overrideId: id,
    deactivatedBy: req.adminName,
  });

  res.json({ message: 'Override deactivated' });
});

/**
 * Zod schema for audit log query params
 */
const auditLogQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(1000).default(100),
  event_type: z
    .enum([
      'eligibility_update',
      'admin_override',
      'member_removed',
      'member_added',
      'naib_promotion',
      'naib_demotion',
      'grace_period_entered',
      'grace_period_exited',
      // Sprint 15-16: Tier system event types
      'tier_change',
      'tier_role_sync',
      'tier_roles_assigned',
      'tier_roles_removed',
    ])
    .optional(),
  since: z.string().datetime().optional(),
});

/**
 * GET /admin/audit-log
 * Get audit log entries
 */
adminRouter.get('/audit-log', (req: AuthenticatedRequest, res: Response) => {
  const result = auditLogQuerySchema.safeParse(req.query);

  if (!result.success) {
    const errors = result.error.issues.map((i) => i.message).join(', ');
    throw new ValidationError(errors);
  }

  const { limit, event_type, since } = result.data;

  const entries = getAuditLog({
    limit,
    eventType: event_type,
    since: since ? new Date(since) : undefined,
  });

  res.json({
    entries: entries.map((e) => ({
      id: e.id,
      event_type: e.eventType,
      event_data: e.eventData,
      created_at: e.createdAt.toISOString(),
    })),
  });
});

/**
 * GET /admin/health
 * Get detailed health status (more info than public endpoint)
 */
adminRouter.get('/health', (_req: AuthenticatedRequest, res: Response) => {
  const health = getHealthStatus();

  res.json({
    last_successful_query: health.lastSuccessfulQuery?.toISOString() ?? null,
    last_query_attempt: health.lastQueryAttempt?.toISOString() ?? null,
    consecutive_failures: health.consecutiveFailures,
    in_grace_period: health.inGracePeriod,
    grace_period_hours: config.gracePeriod.hours,
  });
});

/**
 * Zod schema for badge award request
 */
const badgeAwardSchema = z.object({
  member_id: z.string().uuid('Invalid member ID'),
  badge_id: z.string().min(1, 'Badge ID is required'),
  awarded_by: z.string().min(1, 'Awarded by is required'),
  reason: z.string().optional(),
});

/**
 * POST /admin/badges/award
 * Award a badge to a member
 */
adminRouter.post('/badges/award', (req: AuthenticatedRequest, res: Response) => {
  const result = badgeAwardSchema.safeParse(req.body);

  if (!result.success) {
    const errors = result.error.issues.map(i => i.message).join(', ');
    throw new ValidationError(errors);
  }

  const { member_id, badge_id, awarded_by, reason } = result.data;

  const success = adminAwardBadge(member_id, badge_id, awarded_by, reason ?? 'Admin API award');

  if (!success) {
    throw new ValidationError('Failed to award badge. Member or badge may not exist, or badge already awarded.');
  }

  logAuditEvent('admin_badge_award', {
    memberId: member_id,
    badgeId: badge_id,
    awardedBy: awarded_by,
    reason,
    adminName: req.adminName,
  });

  res.status(201).json({
    message: 'Badge awarded successfully',
    member_id,
    badge_id,
  });
});

/**
 * DELETE /admin/badges/:memberId/:badgeId
 * Revoke a badge from a member
 */
adminRouter.delete('/badges/:memberId/:badgeId', (req: AuthenticatedRequest, res: Response) => {
  const { memberId, badgeId } = req.params;

  if (!memberId || !badgeId) {
    throw new ValidationError('Member ID and Badge ID are required');
  }

  // Validate UUID format for memberId
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(memberId)) {
    throw new ValidationError('Invalid member ID format');
  }

  const success = revokeBadge(memberId, badgeId, req.adminName ?? 'admin');

  if (!success) {
    throw new NotFoundError('Badge not found for this member');
  }

  logAuditEvent('admin_badge_revoke', {
    memberId,
    badgeId,
    revokedBy: req.adminName,
  });

  res.json({
    message: 'Badge revoked successfully',
    member_id: memberId,
    badge_id: badgeId,
  });
});

/**
 * GET /admin/water-share/lineage
 * Get full Water Sharer badge lineage tree
 */
adminRouter.get('/water-share/lineage', (_req: AuthenticatedRequest, res: Response) => {
  const grants = listAllActiveGrants();

  const lineageTree = grants.map((g) => ({
    grant_id: g.grant.id,
    granter: {
      member_id: g.granter.memberId,
      nym: g.granter.nym,
    },
    recipient: {
      member_id: g.recipient.memberId,
      nym: g.recipient.nym,
    },
    granted_at: g.grant.grantedAt.toISOString(),
  }));

  res.json({
    lineage: lineageTree,
    total: lineageTree.length,
  });
});

/**
 * GET /admin/water-share/:memberId/lineage
 * Get badge lineage for a specific member
 */
adminRouter.get('/water-share/:memberId/lineage', (req: AuthenticatedRequest, res: Response) => {
  const { memberId } = req.params;

  if (!memberId) {
    throw new ValidationError('Member ID is required');
  }

  // Validate UUID format
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(memberId)) {
    throw new ValidationError('Invalid member ID format');
  }

  const lineage = getBadgeLineage(memberId);

  if (!lineage) {
    throw new NotFoundError('Member not found');
  }

  res.json({
    member: {
      member_id: lineage.member.memberId,
      nym: lineage.member.nym,
    },
    received_from: lineage.receivedFrom
      ? {
          member_id: lineage.receivedFrom.memberId,
          nym: lineage.receivedFrom.nym,
          granted_at: lineage.receivedFrom.grantedAt.toISOString(),
        }
      : null,
    shared_to: lineage.sharedTo
      ? {
          member_id: lineage.sharedTo.memberId,
          nym: lineage.sharedTo.nym,
          granted_at: lineage.sharedTo.grantedAt.toISOString(),
        }
      : null,
  });
});

/**
 * DELETE /admin/water-share/:memberId
 * Revoke Water Sharer badge and all grants for a member
 * This finds and revokes all active grants involving the member
 */
adminRouter.delete('/water-share/:memberId', (req: AuthenticatedRequest, res: Response) => {
  const { memberId } = req.params;

  if (!memberId) {
    throw new ValidationError('Member ID is required');
  }

  // Validate UUID format
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(memberId)) {
    throw new ValidationError('Invalid member ID format');
  }

  // Find active grants where this member is the granter
  const allGrants = listAllActiveGrants();
  const granterGrant = allGrants.find((g) => g.granter.memberId === memberId);

  // Also find grants where this member is the recipient
  const recipientGrant = allGrants.find((g) => g.recipient.memberId === memberId);

  if (!granterGrant && !recipientGrant) {
    throw new NotFoundError('No active Water Sharer grants found for this member');
  }

  let totalRevoked = 0;
  const revokedGrants: string[] = [];

  // Revoke grant where member is granter (this also cascades to their downstream grants)
  if (granterGrant) {
    const count = revokeGrant(granterGrant.grant.id, req.adminName ?? 'admin-api');
    totalRevoked += count;
    revokedGrants.push(granterGrant.grant.id);
  }

  // Revoke grant where member is recipient (they received from someone)
  // Note: This is separate from the cascade - we're revoking their received grant
  if (recipientGrant && !revokedGrants.includes(recipientGrant.grant.id)) {
    const count = revokeGrant(recipientGrant.grant.id, req.adminName ?? 'admin-api');
    totalRevoked += count;
    revokedGrants.push(recipientGrant.grant.id);
  }

  logAuditEvent('admin_badge_revoke', {
    type: 'water_sharer_admin_revoke',
    memberId,
    grantsRevoked: revokedGrants,
    totalRevoked,
    revokedBy: req.adminName,
  });

  res.json({
    success: true,
    message: 'Water Sharer grants revoked',
    member_id: memberId,
    grants_revoked: revokedGrants,
    total_revoked: totalRevoked,
  });
});

/**
 * DELETE /admin/water-share/grant/:grantId
 * Revoke a specific Water Sharer grant by ID
 */
adminRouter.delete('/water-share/grant/:grantId', (req: AuthenticatedRequest, res: Response) => {
  const { grantId } = req.params;

  if (!grantId) {
    throw new ValidationError('Grant ID is required');
  }

  // Validate UUID format
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(grantId)) {
    throw new ValidationError('Invalid grant ID format');
  }

  // Check if grant exists
  const grant = getGrantById(grantId);
  if (!grant || grant.grant.revokedAt !== null) {
    throw new NotFoundError('Active grant not found');
  }

  const revokeCount = revokeGrant(grantId, req.adminName ?? 'admin-api');

  logAuditEvent('admin_badge_revoke', {
    type: 'water_sharer_grant_revoke',
    grantId,
    granterMemberId: grant.granter.memberId,
    recipientMemberId: grant.recipient.memberId,
    cascadeCount: revokeCount - 1,
    revokedBy: req.adminName,
  });

  res.json({
    success: true,
    message: 'Water Sharer grant revoked',
    grant_id: grantId,
    cascade_count: revokeCount - 1,
    total_revoked: revokeCount,
  });
});

/**
 * GET /admin/alerts/stats
 * Get alert delivery statistics
 */
adminRouter.get('/alerts/stats', (_req: AuthenticatedRequest, res: Response) => {
  const stats = notificationService.getStats();

  const response: AlertStatsResponse = {
    total_sent: stats.totalSent,
    sent_this_week: stats.sentThisWeek,
    by_type: stats.byType as Record<any, number>,
    delivery_rate: stats.deliveryRate,
    opt_out_rate: stats.prefStats.total > 0
      ? (stats.prefStats.total - stats.prefStats.positionUpdatesEnabled) / stats.prefStats.total
      : 0,
    position_updates_disabled: stats.prefStats.total - stats.prefStats.positionUpdatesEnabled,
    at_risk_warnings_disabled: stats.prefStats.total - stats.prefStats.atRiskWarningsEnabled,
  };

  res.json(response);
});

/**
 * POST /admin/alerts/test/:memberId
 * Send a test alert to a member (for testing notification delivery)
 */
adminRouter.post('/alerts/test/:memberId', async (req: AuthenticatedRequest, res: Response) => {
  const { memberId } = req.params;

  if (!memberId) {
    throw new ValidationError('Member ID is required');
  }

  // Validate UUID format
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(memberId)) {
    throw new ValidationError('Invalid member ID format');
  }

  try {
    // Send a test position update
    const result = await notificationService.sendPositionUpdate(memberId, {
      position: 42,
      bgt: 1234.5678,
      distanceToAbove: 10.5,
      distanceToBelow: 5.25,
      distanceToEntry: null,
      isNaib: false,
      isFedaykin: true,
    });

    logAuditEvent('admin_test_alert', {
      memberId,
      success: result.success,
      alertId: result.alertId,
      error: result.error,
      triggeredBy: req.adminName,
    });

    res.json({
      success: result.success,
      alert_id: result.alertId,
      error: result.error,
      message: result.success
        ? 'Test alert sent successfully'
        : `Failed to send test alert: ${result.error}`,
    });
  } catch (error) {
    throw new ValidationError(
      error instanceof Error ? error.message : 'Failed to send test alert'
    );
  }
});

/**
 * POST /admin/alerts/reset-counters
 * Reset weekly alert counters for all members
 * Normally done by scheduled task, but exposed for admin override
 */
adminRouter.post('/alerts/reset-counters', (req: AuthenticatedRequest, res: Response) => {
  const count = notificationService.resetWeeklyCounters();

  logAuditEvent('admin_reset_alert_counters', {
    membersReset: count,
    triggeredBy: req.adminName,
  });

  res.json({
    message: 'Weekly alert counters reset',
    members_reset: count,
  });
});

/**
 * GET /admin/analytics
 * Get comprehensive community analytics
 * Returns member counts, tier distribution, BGT totals, weekly activity
 */
adminRouter.get('/analytics', (_req: AuthenticatedRequest, res: Response) => {
  const analytics = analyticsService.getCommunityAnalytics();

  res.json({
    total_members: analytics.totalMembers,
    by_tier: analytics.byTier,
    total_bgt: analytics.totalBgt,
    total_bgt_wei: analytics.totalBgtWei,
    weekly_active: analytics.weeklyActive,
    new_this_week: analytics.newThisWeek,
    promotions_this_week: analytics.promotionsThisWeek,
    badges_awarded_this_week: analytics.badgesAwardedThisWeek,
    generated_at: analytics.generatedAt.toISOString(),
  });
});

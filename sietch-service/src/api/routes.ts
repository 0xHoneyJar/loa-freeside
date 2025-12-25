import { Router } from 'express';
import { z } from 'zod';
import type { Response, Request } from 'express';
import type { AuthenticatedRequest } from './middleware.js';
import {
  publicRateLimiter,
  adminRateLimiter,
  memberRateLimiter,
  requireApiKey,
  ValidationError,
  NotFoundError,
} from './middleware.js';
import {
  getCurrentEligibility,
  getEligibilityByAddress,
  getHealthStatus,
  getActiveAdminOverrides,
  createAdminOverride,
  deactivateAdminOverride,
  getAuditLog,
  logAuditEvent,
} from '../db/index.js';
import { config } from '../config.js';
import type { EligibilityResponse, HealthResponse, DirectoryFilters } from '../types/index.js';
import { getPrometheusMetrics } from '../utils/metrics.js';
import { profileService } from '../services/profile.js';
import { directoryService } from '../services/directory.js';
import { leaderboardService } from '../services/leaderboard.js';
import { getAllBadgeDefinitions, adminAwardBadge, revokeBadge } from '../services/badge.js';
import { listAllActiveGrants, revokeGrant, getBadgeLineage, getGrantById } from '../services/WaterSharerService.js';
import { naibService } from '../services/naib.js';
import { thresholdService } from '../services/threshold.js';
import { notificationService } from '../services/notification.js';
import { analyticsService } from '../services/AnalyticsService.js';
import { getMemberProfileByDiscordId, getWalletPosition, getCurrentEligibility as getEligibilityList, getWalletByDiscordId } from '../db/queries.js';
import type {
  ThresholdResponse,
  ThresholdHistoryResponse,
  WaitlistStatusResponse,
  NotificationPreferencesResponse,
  UpdateNotificationPreferencesRequest,
  NotificationHistoryResponse,
  PositionResponse,
  AlertStatsResponse,
  AlertFrequency,
} from '../types/index.js';

/**
 * Public routes (rate limited, no auth required)
 */
export const publicRouter = Router();

// Apply public rate limiting
publicRouter.use(publicRateLimiter);

/**
 * GET /eligibility
 * Returns top 69 eligible wallets
 */
publicRouter.get('/eligibility', (_req: Request, res: Response) => {
  const eligibility = getCurrentEligibility();
  const health = getHealthStatus();

  const top69 = eligibility
    .filter((e) => e.rank !== undefined && e.rank <= 69)
    .map((e) => ({
      rank: e.rank!,
      address: e.address,
      bgt_held: Number(e.bgtHeld) / 1e18, // Convert from wei to BGT
    }));

  const top7 = eligibility
    .filter((e) => e.role === 'naib')
    .map((e) => e.address);

  const response: EligibilityResponse = {
    updated_at: health.lastSuccessfulQuery?.toISOString() ?? new Date().toISOString(),
    grace_period: health.inGracePeriod,
    top_69: top69,
    top_7: top7,
  };

  // Set cache headers (5 minutes)
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.json(response);
});

/**
 * GET /eligibility/:address
 * Check eligibility for a specific address
 */
publicRouter.get('/eligibility/:address', (req: Request, res: Response) => {
  const address = req.params.address;

  if (!address) {
    throw new ValidationError('Address parameter is required');
  }

  // Validate address format
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
    throw new ValidationError('Invalid Ethereum address format');
  }

  const entry = getEligibilityByAddress(address);

  if (!entry) {
    res.json({
      address: address.toLowerCase(),
      eligible: false,
      rank: null,
      role: 'none',
      bgt_held: null,
    });
    return;
  }

  res.json({
    address: entry.address,
    eligible: entry.rank !== undefined && entry.rank <= 69,
    rank: entry.rank ?? null,
    role: entry.role,
    bgt_held: Number(entry.bgtHeld) / 1e18,
  });
});

/**
 * GET /health
 * Returns service health status
 */
publicRouter.get('/health', (_req: Request, res: Response) => {
  const health = getHealthStatus();

  // Calculate next scheduled query (every 6 hours)
  const lastQuery = health.lastSuccessfulQuery ?? new Date();
  const nextQuery = new Date(lastQuery.getTime() + 6 * 60 * 60 * 1000);

  const response: HealthResponse = {
    status: health.inGracePeriod ? 'degraded' : 'healthy',
    last_successful_query: health.lastSuccessfulQuery?.toISOString() ?? null,
    next_query: nextQuery.toISOString(),
    grace_period: health.inGracePeriod,
  };

  // Use 200 even for degraded - it's still functioning
  res.json(response);
});

/**
 * GET /metrics
 * Prometheus metrics endpoint
 */
publicRouter.get('/metrics', (_req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
  res.send(getPrometheusMetrics());
});

/**
 * Admin routes (rate limited, API key required)
 */
export const adminRouter = Router();

// Apply admin rate limiting and authentication
adminRouter.use(adminRateLimiter);
adminRouter.use(requireApiKey);

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

// =============================================================================
// Sprint 9: Member API Routes
// =============================================================================

/**
 * Member routes (rate limited, no auth for public data)
 */
export const memberRouter = Router();

// Apply member rate limiting
memberRouter.use(memberRateLimiter);

// -----------------------------------------------------------------------------
// S9-T6: Profile Endpoints
// -----------------------------------------------------------------------------

/**
 * GET /api/profile
 * Get the authenticated member's own profile (requires nym header)
 */
memberRouter.get('/profile', (req: Request, res: Response) => {
  const nym = req.headers['x-member-nym'];

  if (!nym || typeof nym !== 'string') {
    throw new ValidationError('X-Member-Nym header is required');
  }

  // Find the profile by nym
  const profile = profileService.getProfileByNym(nym);

  if (!profile) {
    throw new NotFoundError('Profile not found');
  }

  // Get public profile data
  const publicProfile = profileService.getPublicProfile(profile.memberId);

  if (!publicProfile) {
    throw new NotFoundError('Profile not found');
  }

  res.json({
    member_id: publicProfile.memberId,
    nym: publicProfile.nym,
    bio: publicProfile.bio,
    pfp_url: publicProfile.pfpUrl,
    tier: publicProfile.tier,
    member_since: publicProfile.memberSince instanceof Date
      ? publicProfile.memberSince.toISOString()
      : publicProfile.memberSince,
    tenure_category: publicProfile.tenureCategory,
    badge_count: publicProfile.badgeCount,
  });
});

/**
 * GET /api/members/:nym
 * Get public profile by nym
 */
memberRouter.get('/members/:nym', (req: Request, res: Response) => {
  const nym = req.params.nym;

  if (!nym) {
    throw new ValidationError('Nym parameter is required');
  }

  // Get internal profile by nym, then public profile
  const internalProfile = profileService.getProfileByNym(nym);
  if (!internalProfile) {
    throw new NotFoundError('Member not found');
  }

  const profile = profileService.getPublicProfile(internalProfile.memberId);

  if (!profile) {
    throw new NotFoundError('Member not found');
  }

  res.json({
    member_id: profile.memberId,
    nym: profile.nym,
    bio: profile.bio,
    pfp_url: profile.pfpUrl,
    tier: profile.tier,
    member_since: profile.memberSince instanceof Date
      ? profile.memberSince.toISOString()
      : profile.memberSince,
    tenure_category: profile.tenureCategory,
    badge_count: profile.badgeCount,
  });
});

// -----------------------------------------------------------------------------
// S9-T7: Directory & Badges Endpoints
// -----------------------------------------------------------------------------

/**
 * Zod schema for directory query params
 */
const directoryQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(50).default(20),
  tier: z.enum(['naib', 'fedaykin']).optional(),
  badge_id: z.string().optional(),
  tenure_category: z.enum(['og', 'veteran', 'elder', 'member']).optional(),
  sort_by: z.enum(['nym', 'tenure', 'badgeCount']).default('nym'),
  sort_dir: z.enum(['asc', 'desc']).default('asc'),
});

/**
 * GET /api/directory
 * Browse member directory with filters and pagination
 */
memberRouter.get('/directory', (req: Request, res: Response) => {
  const result = directoryQuerySchema.safeParse(req.query);

  if (!result.success) {
    const errors = result.error.issues.map(i => i.message).join(', ');
    throw new ValidationError(errors);
  }

  const { page, page_size, tier, badge_id, tenure_category, sort_by, sort_dir } = result.data;

  const filters: DirectoryFilters = {
    page,
    pageSize: page_size,
    tier,
    badge: badge_id,
    tenureCategory: tenure_category,
    sortBy: sort_by,
    sortDir: sort_dir,
  };

  const directoryResult = directoryService.getDirectory(filters);

  res.json({
    members: directoryResult.members.map(m => ({
      member_id: m.memberId,
      nym: m.nym,
      bio: m.bio,
      pfp_url: m.pfpUrl,
      tier: m.tier,
      member_since: m.memberSince instanceof Date
        ? m.memberSince.toISOString()
        : m.memberSince,
      tenure_category: m.tenureCategory,
      badge_count: m.badgeCount,
    })),
    page: directoryResult.page,
    page_size: directoryResult.pageSize,
    total: directoryResult.total,
    total_pages: directoryResult.totalPages,
  });
});

/**
 * GET /api/badges
 * Get all available badge definitions
 */
memberRouter.get('/badges', (_req: Request, res: Response) => {
  const badges = getAllBadgeDefinitions();

  res.json({
    badges: badges.map(b => ({
      id: b.badgeId,
      name: b.name,
      description: b.description,
      emoji: b.emoji,
      category: b.category,
    })),
  });
});

/**
 * GET /api/leaderboard
 * Get the engagement leaderboard (top members by badge count)
 */
memberRouter.get('/leaderboard', (req: Request, res: Response) => {
  const limitParam = req.query.limit;
  const limit = limitParam ? parseInt(limitParam as string, 10) : 20;

  if (isNaN(limit) || limit < 1 || limit > 100) {
    throw new ValidationError('Limit must be between 1 and 100');
  }

  const entries = leaderboardService.getLeaderboard(limit);
  const stats = directoryService.getStats();

  res.json({
    entries: entries.map(e => ({
      rank: e.rank,
      nym: e.nym,
      pfp_url: e.pfpUrl,
      tier: e.tier,
      badge_count: e.badgeCount,
      tenure_category: e.tenureCategory,
    })),
    total_members: stats.total,
  });
});

// -----------------------------------------------------------------------------
// S19-S20: Stats & Analytics Endpoints
// -----------------------------------------------------------------------------

/**
 * GET /api/stats/tiers
 * Get tier definitions and thresholds
 */
memberRouter.get('/stats/tiers', (_req: Request, res: Response) => {
  // Import tierService dynamically to avoid circular deps
  const { tierService } = require('../services/index.js');
  const tiers = tierService.getAllTierInfo();

  res.json({
    tiers: tiers.map((t: any) => ({
      name: t.name,
      display_name: t.displayName,
      bgt_threshold: t.bgtThreshold,
      rank_based: t.rankBased,
      description: t.description,
    })),
  });
});

/**
 * GET /api/stats/community
 * Get public community statistics (aggregated)
 */
publicRouter.get('/stats/community', (_req: Request, res: Response) => {
  // Import statsService dynamically to avoid circular deps
  const { statsService } = require('../services/StatsService.js');
  const stats = statsService.getCommunityStats();

  // Set cache headers (5 minutes)
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.json(stats);
});

/**
 * GET /api/me/stats
 * Get personal activity stats for authenticated member
 */
memberRouter.get('/me/stats', (req: Request, res: Response) => {
  const discordUserId = req.headers['x-discord-user-id'] as string;

  if (!discordUserId) {
    throw new ValidationError('Discord user ID required in x-discord-user-id header');
  }

  // Import statsService dynamically to avoid circular deps
  const { statsService } = require('../services/StatsService.js');
  const stats = statsService.getPersonalStats(discordUserId);

  if (!stats) {
    throw new NotFoundError('Member not found or onboarding incomplete');
  }

  res.json(stats);
});

/**
 * GET /api/me/tier-progress
 * Get tier progression data for authenticated member
 */
memberRouter.get('/me/tier-progress', (req: Request, res: Response) => {
  const discordUserId = req.headers['x-discord-user-id'] as string;

  if (!discordUserId) {
    throw new ValidationError('Discord user ID required in x-discord-user-id header');
  }

  const member = getMemberProfileByDiscordId(discordUserId);

  if (!member || !member.onboardingComplete) {
    throw new NotFoundError('Member not found or onboarding incomplete');
  }

  // Get wallet address
  const walletAddress = getWalletByDiscordId(discordUserId);
  if (!walletAddress) {
    throw new NotFoundError('Wallet mapping not found');
  }

  // Get eligibility to get BGT and rank
  const eligibilityList = getEligibilityList();
  const eligibility = eligibilityList.find(
    (e) => e.address.toLowerCase() === walletAddress.toLowerCase()
  );

  if (!eligibility) {
    throw new NotFoundError('Eligibility data not found');
  }

  // Import tierService dynamically to avoid circular deps
  const { tierService } = require('../services/index.js');
  const progress = tierService.getTierProgress(
    member.tier,
    eligibility.bgtHeld.toString(),
    eligibility.rank ?? null
  );

  res.json(progress);
});

// -----------------------------------------------------------------------------
// S9-T8: Admin Badge Endpoints
// -----------------------------------------------------------------------------

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

// =============================================================================
// Sprint 18: Admin Water Sharer Management Endpoints
// =============================================================================

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

// =============================================================================
// Sprint 13: Admin Alert Endpoints
// =============================================================================

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

// =============================================================================
// Sprint 21: Admin Analytics API
// =============================================================================

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

// =============================================================================
// Sprint 11: Naib Council API Routes
// =============================================================================

// -----------------------------------------------------------------------------
// S11-T8: Naib Endpoints
// -----------------------------------------------------------------------------

/**
 * GET /api/naib
 * Get current Naib council and former members
 */
memberRouter.get('/naib', (_req: Request, res: Response) => {
  const current = naibService.getPublicCurrentNaib();
  const former = naibService.getFormerNaib();
  const emptySeats = naibService.getAvailableSeatCount();

  res.json({
    current: current.map(m => ({
      seat_number: m.seatNumber,
      nym: m.nym,
      member_id: m.memberId,
      pfp_url: m.pfpUrl,
      seated_at: m.seatedAt instanceof Date
        ? m.seatedAt.toISOString()
        : m.seatedAt,
      is_founding: m.isFounding,
      rank: m.rank,
    })),
    former: former.map(m => ({
      nym: m.nym,
      member_id: m.memberId,
      pfp_url: m.pfpUrl,
      first_seated_at: m.firstSeatedAt instanceof Date
        ? m.firstSeatedAt.toISOString()
        : m.firstSeatedAt,
      last_unseated_at: m.lastUnseatedAt instanceof Date
        ? m.lastUnseatedAt.toISOString()
        : m.lastUnseatedAt,
      total_tenure_days: Math.floor(m.totalTenureMs / (1000 * 60 * 60 * 24)),
      seat_count: m.seatCount,
    })),
    empty_seats: emptySeats,
    updated_at: new Date().toISOString(),
  });
});

/**
 * GET /api/naib/current
 * Get current Naib council members only
 */
memberRouter.get('/naib/current', (_req: Request, res: Response) => {
  const current = naibService.getPublicCurrentNaib();
  const emptySeats = naibService.getAvailableSeatCount();

  res.json({
    members: current.map(m => ({
      seat_number: m.seatNumber,
      nym: m.nym,
      member_id: m.memberId,
      pfp_url: m.pfpUrl,
      seated_at: m.seatedAt instanceof Date
        ? m.seatedAt.toISOString()
        : m.seatedAt,
      is_founding: m.isFounding,
      rank: m.rank,
    })),
    filled_seats: current.length,
    empty_seats: emptySeats,
    total_seats: 7,
  });
});

/**
 * GET /api/naib/former
 * Get former Naib members (honor roll)
 */
memberRouter.get('/naib/former', (_req: Request, res: Response) => {
  const former = naibService.getFormerNaib();

  res.json({
    members: former.map(m => ({
      nym: m.nym,
      member_id: m.memberId,
      pfp_url: m.pfpUrl,
      first_seated_at: m.firstSeatedAt instanceof Date
        ? m.firstSeatedAt.toISOString()
        : m.firstSeatedAt,
      last_unseated_at: m.lastUnseatedAt instanceof Date
        ? m.lastUnseatedAt.toISOString()
        : m.lastUnseatedAt,
      total_tenure_days: Math.floor(m.totalTenureMs / (1000 * 60 * 60 * 24)),
      seat_count: m.seatCount,
    })),
    total: former.length,
  });
});

/**
 * GET /api/naib/member/:memberId
 * Check if a specific member is a current or former Naib
 */
memberRouter.get('/naib/member/:memberId', (req: Request, res: Response) => {
  const memberId = req.params.memberId;

  if (!memberId) {
    throw new ValidationError('Member ID is required');
  }

  // Validate UUID format
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(memberId)) {
    throw new ValidationError('Invalid member ID format');
  }

  const isCurrentNaib = naibService.isCurrentNaib(memberId);
  const isFormerNaib = naibService.isFormerNaib(memberId);
  const hasEverBeenNaib = naibService.hasEverBeenNaib(memberId);
  const history = naibService.getMemberNaibHistory(memberId);

  res.json({
    member_id: memberId,
    is_current_naib: isCurrentNaib,
    is_former_naib: isFormerNaib,
    has_ever_been_naib: hasEverBeenNaib,
    seat_history: history.map(seat => ({
      seat_number: seat.seatNumber,
      seated_at: seat.seatedAt.toISOString(),
      unseated_at: seat.unseatedAt?.toISOString() ?? null,
      unseat_reason: seat.unseatReason,
      bgt_at_seating: seat.bgtAtSeating,
      bgt_at_unseating: seat.bgtAtUnseating,
    })),
  });
});

// =============================================================================
// Sprint 12: Cave Entrance API Routes (Threshold & Waitlist)
// =============================================================================

// -----------------------------------------------------------------------------
// S12-T8: Threshold Endpoints
// -----------------------------------------------------------------------------

/**
 * GET /api/threshold
 * Get current entry threshold data
 */
memberRouter.get('/threshold', (_req: Request, res: Response) => {
  const data = thresholdService.getThresholdData();
  const topWaitlist = thresholdService.getTopWaitlistPositions(5);

  const response: ThresholdResponse = {
    entry_threshold: data.entryThreshold,
    eligible_count: data.eligibleCount,
    waitlist_count: data.waitlistCount,
    gap_to_entry: data.gapToEntry,
    top_waitlist: topWaitlist.map(p => ({
      position: p.position,
      address_display: p.addressDisplay,
      bgt: p.bgt,
      distance_to_entry: p.distanceToEntry,
      is_registered: p.isRegistered,
    })),
    updated_at: data.updatedAt.toISOString(),
  };

  // Set cache headers (1 minute - threshold data changes frequently)
  res.setHeader('Cache-Control', 'public, max-age=60');
  res.json(response);
});

/**
 * Zod schema for threshold history query
 */
const thresholdHistorySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(24),
  since: z.string().datetime().optional(),
});

/**
 * GET /api/threshold/history
 * Get threshold snapshot history
 */
memberRouter.get('/threshold/history', (req: Request, res: Response) => {
  const result = thresholdHistorySchema.safeParse(req.query);

  if (!result.success) {
    const errors = result.error.issues.map(i => i.message).join(', ');
    throw new ValidationError(errors);
  }

  const { limit, since } = result.data;
  const sinceDate = since ? new Date(since) : undefined;

  const snapshots = thresholdService.getSnapshotHistory(limit, sinceDate);

  const response: ThresholdHistoryResponse = {
    snapshots: snapshots.map(s => ({
      id: s.id,
      entry_threshold: Number(BigInt(s.entryThresholdBgt)) / 1e18,
      eligible_count: s.eligibleCount,
      waitlist_count: s.waitlistCount,
      created_at: s.snapshotAt.toISOString(),
    })),
    count: snapshots.length,
  };

  res.json(response);
});

/**
 * GET /api/waitlist/status/:address
 * Check waitlist registration status for an address
 */
memberRouter.get('/waitlist/status/:address', (req: Request, res: Response) => {
  const address = req.params.address;

  if (!address) {
    throw new ValidationError('Address parameter is required');
  }

  // Validate address format
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
    throw new ValidationError('Invalid Ethereum address format');
  }

  const normalizedAddress = address.toLowerCase();

  // Check if wallet is in the waitlist range (70-100)
  const position = thresholdService.getWalletPosition(normalizedAddress);

  // Get registration if any (by wallet)
  const registrations = thresholdService.getActiveRegistrations();
  const registration = registrations.find(
    r => r.walletAddress.toLowerCase() === normalizedAddress
  );

  const response: WaitlistStatusResponse = {
    address: normalizedAddress,
    is_in_waitlist_range: position !== null,
    position: position?.position ?? null,
    bgt: position?.bgt ?? null,
    distance_to_entry: position?.distanceToEntry ?? null,
    is_registered: registration !== undefined,
    registered_at: registration?.registeredAt?.toISOString() ?? null,
  };

  res.json(response);
});

// =============================================================================
// Notification Endpoints (Sprint 13: Notification System)
// =============================================================================

/**
 * GET /api/notifications/preferences
 * Get notification preferences for authenticated member
 * Note: In a real implementation, this would use Discord OAuth
 * For now, requires discordUserId header for testing
 */
memberRouter.get('/notifications/preferences', (req: Request, res: Response) => {
  const discordUserId = req.headers['x-discord-user-id'] as string;

  if (!discordUserId) {
    throw new ValidationError('Discord user ID required in x-discord-user-id header');
  }

  const member = getMemberProfileByDiscordId(discordUserId);
  if (!member) {
    throw new NotFoundError('Member not found');
  }

  const prefs = notificationService.getPreferences(member.memberId);
  const maxAlerts = notificationService.getMaxAlertsPerWeek(prefs.frequency);

  const response: NotificationPreferencesResponse = {
    position_updates: prefs.positionUpdates,
    at_risk_warnings: prefs.atRiskWarnings,
    naib_alerts: prefs.naibAlerts,
    frequency: prefs.frequency,
    alerts_sent_this_week: prefs.alertsSentThisWeek,
    max_alerts_per_week: maxAlerts,
  };

  res.json(response);
});

/**
 * PUT /api/notifications/preferences
 * Update notification preferences for authenticated member
 */
const updatePreferencesSchema = z.object({
  position_updates: z.boolean().optional(),
  at_risk_warnings: z.boolean().optional(),
  naib_alerts: z.boolean().optional(),
  frequency: z.enum(['1_per_week', '2_per_week', '3_per_week', 'daily']).optional(),
});

memberRouter.put('/notifications/preferences', (req: Request, res: Response) => {
  const discordUserId = req.headers['x-discord-user-id'] as string;

  if (!discordUserId) {
    throw new ValidationError('Discord user ID required in x-discord-user-id header');
  }

  const member = getMemberProfileByDiscordId(discordUserId);
  if (!member) {
    throw new NotFoundError('Member not found');
  }

  const validation = updatePreferencesSchema.safeParse(req.body);
  if (!validation.success) {
    throw new ValidationError(validation.error.message);
  }

  const updates = validation.data;

  const prefs = notificationService.updatePreferences(member.memberId, {
    positionUpdates: updates.position_updates,
    atRiskWarnings: updates.at_risk_warnings,
    naibAlerts: updates.naib_alerts,
    frequency: updates.frequency as AlertFrequency | undefined,
  });

  const maxAlerts = notificationService.getMaxAlertsPerWeek(prefs.frequency);

  const response: NotificationPreferencesResponse = {
    position_updates: prefs.positionUpdates,
    at_risk_warnings: prefs.atRiskWarnings,
    naib_alerts: prefs.naibAlerts,
    frequency: prefs.frequency,
    alerts_sent_this_week: prefs.alertsSentThisWeek,
    max_alerts_per_week: maxAlerts,
  };

  res.json(response);
});

/**
 * GET /api/notifications/history
 * Get alert history for authenticated member
 */
const historyQuerySchema = z.object({
  limit: z.coerce.number().min(1).max(100).default(50),
  alert_type: z.string().optional(),
});

memberRouter.get('/notifications/history', (req: Request, res: Response) => {
  const discordUserId = req.headers['x-discord-user-id'] as string;

  if (!discordUserId) {
    throw new ValidationError('Discord user ID required in x-discord-user-id header');
  }

  const member = getMemberProfileByDiscordId(discordUserId);
  if (!member) {
    throw new NotFoundError('Member not found');
  }

  const validation = historyQuerySchema.safeParse(req.query);
  if (!validation.success) {
    throw new ValidationError(validation.error.message);
  }

  const { limit, alert_type } = validation.data;

  const alerts = notificationService.getHistory(member.memberId, {
    limit,
    alertType: alert_type as any,
  });

  const response: NotificationHistoryResponse = {
    alerts: alerts.map((a) => ({
      id: a.id,
      alert_type: a.alertType,
      delivered: a.delivered,
      sent_at: a.sentAt.toISOString(),
      alert_data: a.alertData,
    })),
    total: alerts.length,
  };

  res.json(response);
});

/**
 * GET /api/position
 * Get own position in eligibility ranking
 */
memberRouter.get('/position', (req: Request, res: Response) => {
  const discordUserId = req.headers['x-discord-user-id'] as string;

  if (!discordUserId) {
    throw new ValidationError('Discord user ID required in x-discord-user-id header');
  }

  const member = getMemberProfileByDiscordId(discordUserId);
  if (!member) {
    throw new NotFoundError('Member not found');
  }

  const walletAddress = getWalletByDiscordId(discordUserId);
  if (!walletAddress) {
    throw new ValidationError('Member has no wallet address linked');
  }

  const walletPos = getWalletPosition(walletAddress);
  if (!walletPos) {
    throw new NotFoundError('Wallet not found in eligibility rankings');
  }

  const position = walletPos.position;
  const bgt = Number(BigInt(walletPos.bgt)) / 1e18;

  // Calculate distances
  const eligibility = getEligibilityList();
  let distanceToAbove: number | null = null;
  let distanceToBelow: number | null = null;

  const currentIndex = eligibility.findIndex((e) => e.rank === position);
  if (currentIndex > 0) {
    const above = eligibility[currentIndex - 1];
    if (above) {
      const aboveBgt = Number(BigInt(above.bgtHeld)) / 1e18;
      distanceToAbove = aboveBgt - bgt;
    }
  }
  if (currentIndex < eligibility.length - 1 && currentIndex >= 0) {
    const below = eligibility[currentIndex + 1];
    if (below) {
      const belowBgt = Number(BigInt(below.bgtHeld)) / 1e18;
      distanceToBelow = bgt - belowBgt;
    }
  }

  // Distance to entry
  let distanceToEntry: number | null = null;
  const entryThreshold = thresholdService.getEntryThreshold();
  if (position > 69 && entryThreshold) {
    distanceToEntry = entryThreshold.human - bgt;
  }

  const isNaib = naibService.isCurrentNaib(member.memberId);
  const isFedaykin = position <= 69;
  const isAtRisk = notificationService.isAtRisk(position);

  const response: PositionResponse = {
    position,
    bgt,
    distance_to_above: distanceToAbove,
    distance_to_below: distanceToBelow,
    distance_to_entry: distanceToEntry,
    is_naib: isNaib,
    is_fedaykin: isFedaykin,
    is_at_risk: isAtRisk,
  };

  res.json(response);
});

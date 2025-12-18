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
import { profileService } from '../services/profile.js';
import { directoryService } from '../services/directory.js';
import { leaderboardService } from '../services/leaderboard.js';
import { getAllBadgeDefinitions, adminAwardBadge, revokeBadge } from '../services/badge.js';

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

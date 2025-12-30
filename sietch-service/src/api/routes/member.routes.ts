/**
 * Member Routes Module
 * Sprint 51: Route modularization - Member profile, directory, and stats endpoints
 */

import { Router } from 'express';
import { z } from 'zod';
import type { Response, Request } from 'express';
import {
  memberRateLimiter,
  ValidationError,
  NotFoundError,
} from '../middleware.js';
import type { DirectoryFilters } from '../../types/index.js';
import { profileService } from '../../services/profile.js';
import { directoryService } from '../../services/directory.js';
import { leaderboardService } from '../../services/leaderboard.js';
import { getAllBadgeDefinitions } from '../../services/badge.js';
import { getMemberProfileByDiscordId, getCurrentEligibility as getEligibilityList, getWalletByDiscordId } from '../../db/index.js';

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
memberRouter.get('/leaderboard', async (req: Request, res: Response) => {
  const limitParam = req.query.limit;
  const limit = limitParam ? parseInt(limitParam as string, 10) : 20;

  if (isNaN(limit) || limit < 1 || limit > 100) {
    throw new ValidationError('Limit must be between 1 and 100');
  }

  const entries = await leaderboardService.getLeaderboard(limit);
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
  const { tierService } = require('../../services/index.js');
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
 * GET /api/me/stats
 * Get personal activity stats for authenticated member
 */
memberRouter.get('/me/stats', (req: Request, res: Response) => {
  const discordUserId = req.headers['x-discord-user-id'] as string;

  if (!discordUserId) {
    throw new ValidationError('Discord user ID required in x-discord-user-id header');
  }

  // Import statsService dynamically to avoid circular deps
  const { statsService } = require('../../services/StatsService.js');
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
  const { tierService } = require('../../services/index.js');
  const progress = tierService.getTierProgress(
    member.tier,
    eligibility.bgtHeld.toString(),
    eligibility.rank ?? null
  );

  res.json(progress);
});

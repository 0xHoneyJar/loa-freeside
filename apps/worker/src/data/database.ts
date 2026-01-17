/**
 * Database Service for Worker
 *
 * Provides PostgreSQL database access for command handlers.
 * Uses postgres.js with Drizzle ORM for type-safe queries.
 *
 * Key design decisions:
 * - Connection pooling with configurable size
 * - Tenant-aware queries via community_id
 * - Read-heavy workload (Worker rarely writes)
 * - Graceful shutdown support
 */

import postgres from 'postgres';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq, and, desc, asc, lte, gte, sql } from 'drizzle-orm';
import type { Logger } from 'pino';
import type { Config } from '../config.js';
import * as schema from './schema.js';
import type { NotificationPreferences, AlertFrequency } from './schema.js';

/**
 * Database service singleton
 */
let dbInstance: PostgresJsDatabase<typeof schema> | null = null;
let sqlClient: postgres.Sql | null = null;

/**
 * Initialize database connection
 */
export function initDatabase(config: Config, logger: Logger): PostgresJsDatabase<typeof schema> {
  if (dbInstance) {
    return dbInstance;
  }

  logger.info('Initializing database connection...');

  // Create postgres.js connection with pooling
  sqlClient = postgres(config.databaseUrl, {
    max: 10, // Max connections in pool
    idle_timeout: 30, // Close idle connections after 30s
    connect_timeout: 10, // Connection timeout
    onnotice: () => {}, // Suppress notices
  });

  // Create Drizzle instance with schema
  dbInstance = drizzle(sqlClient, { schema });

  logger.info('Database connection initialized');
  return dbInstance;
}

/**
 * Get database instance (throws if not initialized)
 */
export function getDatabase(): PostgresJsDatabase<typeof schema> {
  if (!dbInstance) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return dbInstance;
}

/**
 * Close database connection
 */
export async function closeDatabase(logger: Logger): Promise<void> {
  if (sqlClient) {
    logger.info('Closing database connection...');
    await sqlClient.end();
    sqlClient = null;
    dbInstance = null;
    logger.info('Database connection closed');
  }
}

/**
 * Check if database is connected
 */
export async function isDatabaseConnected(): Promise<boolean> {
  if (!sqlClient) return false;

  try {
    await sqlClient`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

// =============================================================================
// Community Queries
// =============================================================================

/**
 * Get community by Discord guild ID
 */
export async function getCommunityByGuildId(
  guildId: string
): Promise<schema.Community | null> {
  const db = getDatabase();
  const result = await db
    .select()
    .from(schema.communities)
    .where(eq(schema.communities.discordGuildId, guildId))
    .limit(1);

  return result[0] ?? null;
}

// =============================================================================
// Profile Queries
// =============================================================================

/**
 * Get profile by Discord ID within a community
 */
export async function getProfileByDiscordId(
  communityId: string,
  discordId: string
): Promise<schema.Profile | null> {
  const db = getDatabase();
  const result = await db
    .select()
    .from(schema.profiles)
    .where(
      and(
        eq(schema.profiles.communityId, communityId),
        eq(schema.profiles.discordId, discordId)
      )
    )
    .limit(1);

  return result[0] ?? null;
}

/**
 * Get profile by wallet address within a community
 */
export async function getProfileByWallet(
  communityId: string,
  walletAddress: string
): Promise<schema.Profile | null> {
  const db = getDatabase();
  const result = await db
    .select()
    .from(schema.profiles)
    .where(
      and(
        eq(schema.profiles.communityId, communityId),
        eq(schema.profiles.walletAddress, walletAddress.toLowerCase())
      )
    )
    .limit(1);

  return result[0] ?? null;
}

/**
 * Maximum allowed limit for pagination queries to prevent memory exhaustion (L-1)
 */
export const MAX_PAGINATION_LIMIT = 1000;

/**
 * Get profiles ranked by conviction score (for leaderboard/position)
 * SEC-4.1: Limit capped at MAX_PAGINATION_LIMIT to prevent memory exhaustion
 */
export async function getProfilesByRank(
  communityId: string,
  limit: number = 100
): Promise<schema.Profile[]> {
  const db = getDatabase();
  const safeLimit = Math.min(Math.max(1, limit), MAX_PAGINATION_LIMIT);
  return db
    .select()
    .from(schema.profiles)
    .where(eq(schema.profiles.communityId, communityId))
    .orderBy(desc(schema.profiles.convictionScore), asc(schema.profiles.currentRank))
    .limit(safeLimit);
}

/**
 * Get profile rank (position) within community
 */
export async function getProfileRank(
  communityId: string,
  profileId: string
): Promise<number | null> {
  const db = getDatabase();

  // Get the profile's conviction score
  const profile = await db
    .select({ convictionScore: schema.profiles.convictionScore })
    .from(schema.profiles)
    .where(eq(schema.profiles.id, profileId))
    .limit(1);

  if (!profile[0]) return null;

  // Count how many profiles have higher conviction
  const result = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.profiles)
    .where(
      and(
        eq(schema.profiles.communityId, communityId),
        sql`${schema.profiles.convictionScore} > ${profile[0].convictionScore}`
      )
    );

  // Rank is count of higher scores + 1
  return (result[0]?.count ?? 0) + 1;
}

// =============================================================================
// Badge Queries
// =============================================================================

/**
 * Get badges for a profile
 * SEC-4.2: Limit capped at MAX_PAGINATION_LIMIT to prevent memory exhaustion
 */
export async function getProfileBadges(
  profileId: string,
  limit: number = 100
): Promise<schema.Badge[]> {
  const db = getDatabase();
  const safeLimit = Math.min(Math.max(1, limit), MAX_PAGINATION_LIMIT);
  return db
    .select()
    .from(schema.badges)
    .where(
      and(
        eq(schema.badges.profileId, profileId),
        sql`${schema.badges.revokedAt} IS NULL`
      )
    )
    .orderBy(desc(schema.badges.awardedAt))
    .limit(safeLimit);
}

/**
 * Count badges for a profile
 */
export async function countProfileBadges(profileId: string): Promise<number> {
  const db = getDatabase();
  const result = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.badges)
    .where(
      and(
        eq(schema.badges.profileId, profileId),
        sql`${schema.badges.revokedAt} IS NULL`
      )
    );

  return result[0]?.count ?? 0;
}

// =============================================================================
// Stats Queries
// =============================================================================

/**
 * Member stats data structure for /stats command
 */
export interface MemberStats {
  profile: schema.Profile;
  badgeCount: number;
  badges: schema.Badge[];
  rank: number | null;
}

/**
 * Get comprehensive member stats
 */
export async function getMemberStats(
  communityId: string,
  discordId: string
): Promise<MemberStats | null> {
  const profile = await getProfileByDiscordId(communityId, discordId);
  if (!profile) return null;

  const [badgeCount, badges, rank] = await Promise.all([
    countProfileBadges(profile.id),
    getProfileBadges(profile.id),
    getProfileRank(communityId, profile.id),
  ]);

  return {
    profile,
    badgeCount,
    badges,
    rank,
  };
}

// =============================================================================
// Position/Threshold Queries
// =============================================================================

/**
 * Position data for /position command
 */
export interface PositionData {
  position: number;
  convictionScore: number;
  distanceToAbove: number | null;
  distanceToBelow: number | null;
  distanceToEntry: number | null;
  isNaib: boolean;
  isFedaykin: boolean;
  isAtRisk: boolean;
}

/**
 * Get position data for a profile
 */
export async function getPositionData(
  communityId: string,
  profileId: string,
  entryThreshold: number = 69, // Top 69 are Fedaykin
  naibThreshold: number = 7,   // Top 7 are Naib
  atRiskThreshold: number = 63 // Positions 63-69 are at risk
): Promise<PositionData | null> {
  const db = getDatabase();

  // Get all profiles ranked by conviction
  const profiles = await getProfilesByRank(communityId, 200);

  const currentIndex = profiles.findIndex((p) => p.id === profileId);
  if (currentIndex === -1) return null;

  const currentProfile = profiles[currentIndex];
  if (!currentProfile) return null;

  const position = currentIndex + 1;
  const score = currentProfile.convictionScore;

  // Calculate distances
  let distanceToAbove: number | null = null;
  let distanceToBelow: number | null = null;
  let distanceToEntry: number | null = null;

  if (currentIndex > 0) {
    const above = profiles[currentIndex - 1];
    if (above) {
      distanceToAbove = above.convictionScore - score;
    }
  }

  if (currentIndex < profiles.length - 1) {
    const below = profiles[currentIndex + 1];
    if (below) {
      distanceToBelow = score - below.convictionScore;
    }
  }

  // If not in top 69, calculate distance to entry
  if (position > entryThreshold && profiles[entryThreshold - 1]) {
    const entryProfile = profiles[entryThreshold - 1];
    if (entryProfile) {
      distanceToEntry = entryProfile.convictionScore - score;
    }
  }

  return {
    position,
    convictionScore: score,
    distanceToAbove,
    distanceToBelow,
    distanceToEntry,
    isNaib: position <= naibThreshold,
    isFedaykin: position <= entryThreshold,
    isAtRisk: position > atRiskThreshold && position <= entryThreshold,
  };
}

/**
 * Threshold data for /threshold command
 */
export interface ThresholdData {
  entryThreshold: number; // Conviction score needed to enter
  eligibleCount: number;  // Number of eligible members (top 69)
  waitlistCount: number;  // Number in waitlist (70-100)
  gapToEntry: number | null; // Gap between #70 and #69
  updatedAt: Date;
}

/**
 * Get threshold data
 */
export async function getThresholdData(
  communityId: string,
  entryPosition: number = 69
): Promise<ThresholdData> {
  const profiles = await getProfilesByRank(communityId, 200);

  const eligibleCount = Math.min(profiles.length, entryPosition);
  const waitlistCount = Math.max(0, Math.min(profiles.length - entryPosition, 31)); // 70-100

  let entryThreshold = 0;
  let gapToEntry: number | null = null;

  const entryProfile = profiles[entryPosition - 1];
  if (entryProfile) {
    entryThreshold = entryProfile.convictionScore;
  }

  if (profiles[entryPosition]) {
    const firstWaitlist = profiles[entryPosition];
    gapToEntry = entryThreshold - firstWaitlist.convictionScore;
  }

  return {
    entryThreshold,
    eligibleCount,
    waitlistCount,
    gapToEntry,
    updatedAt: new Date(),
  };
}

/**
 * Waitlist position data
 */
export interface WaitlistPositionData {
  position: number;
  profile: schema.Profile;
  distanceToEntry: number;
}

/**
 * Get top waitlist positions (70-100)
 */
export async function getTopWaitlistPositions(
  communityId: string,
  limit: number = 5,
  entryPosition: number = 69
): Promise<WaitlistPositionData[]> {
  const profiles = await getProfilesByRank(communityId, entryPosition + limit + 1);

  if (profiles.length <= entryPosition) {
    return [];
  }

  const entryThreshold = profiles[entryPosition - 1]?.convictionScore ?? 0;

  return profiles
    .slice(entryPosition, entryPosition + limit)
    .map((profile, index) => ({
      position: entryPosition + index + 1,
      profile,
      distanceToEntry: entryThreshold - profile.convictionScore,
    }));
}

// =============================================================================
// Leaderboard Queries
// =============================================================================

/**
 * Leaderboard entry for badge rankings
 */
export interface BadgeLeaderboardEntry {
  rank: number;
  profileId: string;
  discordId: string | null;
  badgeCount: number;
  tier: string | null;
  tenureCategory: string;
  nym: string;
  joinedAt: Date;
}

/**
 * Tier progression leaderboard entry
 */
export interface TierProgressionEntry {
  rank: number;
  profileId: string;
  discordId: string | null;
  nym: string;
  currentTier: string;
  nextTier: string;
  convictionScore: number;
  distanceToNextTier: number;
}

/**
 * Calculate tenure category from join date
 */
function calculateTenureCategory(joinedAt: Date): string {
  const now = new Date();
  const daysSinceJoin = Math.floor((now.getTime() - joinedAt.getTime()) / (1000 * 60 * 60 * 24));

  if (daysSinceJoin <= 30) return 'og';
  if (daysSinceJoin >= 180) return 'elder';
  if (daysSinceJoin >= 90) return 'veteran';
  return 'member';
}

/**
 * Get badge leaderboard (ranked by badge count)
 * SEC-4.2: Limit capped at MAX_PAGINATION_LIMIT to prevent memory exhaustion
 */
export async function getBadgeLeaderboard(
  communityId: string,
  limit: number = 10
): Promise<BadgeLeaderboardEntry[]> {
  const db = getDatabase();
  const safeLimit = Math.min(Math.max(1, limit), MAX_PAGINATION_LIMIT);

  // Get profiles with badge counts
  const results = await db
    .select({
      profileId: schema.profiles.id,
      discordId: schema.profiles.discordId,
      tier: schema.profiles.tier,
      joinedAt: schema.profiles.joinedAt,
      metadata: schema.profiles.metadata,
      badgeCount: sql<number>`(
        SELECT COUNT(*)::int FROM badges
        WHERE badges.profile_id = ${schema.profiles.id}
        AND badges.revoked_at IS NULL
      )`,
    })
    .from(schema.profiles)
    .where(eq(schema.profiles.communityId, communityId))
    .orderBy(
      sql`(
        SELECT COUNT(*) FROM badges
        WHERE badges.profile_id = ${schema.profiles.id}
        AND badges.revoked_at IS NULL
      ) DESC`,
      asc(schema.profiles.joinedAt)
    )
    .limit(safeLimit);

  return results.map((row, index) => ({
    rank: index + 1,
    profileId: row.profileId,
    discordId: row.discordId,
    badgeCount: row.badgeCount,
    tier: row.tier,
    tenureCategory: calculateTenureCategory(row.joinedAt),
    nym: row.metadata?.displayName ?? row.metadata?.username ?? `User-${row.discordId?.slice(-4) ?? 'Unknown'}`,
    joinedAt: row.joinedAt,
  }));
}

/**
 * Get member's badge rank
 */
export async function getMemberBadgeRank(
  communityId: string,
  profileId: string
): Promise<number | null> {
  const db = getDatabase();

  // Get the member's badge count
  const memberBadges = await countProfileBadges(profileId);

  // Count how many members have more badges
  const result = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.profiles)
    .where(
      and(
        eq(schema.profiles.communityId, communityId),
        sql`(
          SELECT COUNT(*) FROM badges
          WHERE badges.profile_id = ${schema.profiles.id}
          AND badges.revoked_at IS NULL
        ) > ${memberBadges}`
      )
    );

  return (result[0]?.count ?? 0) + 1;
}

/**
 * Tier thresholds (BGT-based)
 */
const TIER_THRESHOLDS: Record<string, number> = {
  'fremen': 0,      // Entry level
  'stillsuit': 100,
  'sietch': 500,
  'sayyadina': 1000,
  'fedaykin': 5000, // Rank-based after this
  'naib': 10000,
};

const TIER_ORDER = ['fremen', 'stillsuit', 'sietch', 'sayyadina', 'fedaykin', 'naib'];

/**
 * Get next tier for a given tier
 */
function getNextTier(currentTier: string): string | null {
  const index = TIER_ORDER.indexOf(currentTier);
  if (index === -1 || index >= TIER_ORDER.length - 1) return null;
  return TIER_ORDER[index + 1] ?? null;
}

/**
 * Get tier progression leaderboard (closest to next tier promotion)
 * Excludes Fedaykin and Naib (rank-based tiers)
 * SEC-4.2: Limit capped at MAX_PAGINATION_LIMIT to prevent memory exhaustion
 */
export async function getTierProgressionLeaderboard(
  communityId: string,
  limit: number = 10
): Promise<TierProgressionEntry[]> {
  const db = getDatabase();
  const safeLimit = Math.min(Math.max(1, limit), MAX_PAGINATION_LIMIT);

  // Get all profiles that are not yet Fedaykin/Naib (BGT-based progression)
  // SEC-4.2: Apply limit to initial query to prevent fetching all profiles
  const profiles = await db
    .select()
    .from(schema.profiles)
    .where(
      and(
        eq(schema.profiles.communityId, communityId),
        sql`${schema.profiles.tier} NOT IN ('fedaykin', 'naib')`
      )
    )
    .orderBy(desc(schema.profiles.convictionScore))
    .limit(MAX_PAGINATION_LIMIT);

  // Calculate progression for each profile
  const withProgression = profiles
    .map((profile) => {
      const currentTier = profile.tier ?? 'fremen';
      const nextTier = getNextTier(currentTier);
      if (!nextTier || nextTier === 'fedaykin' || nextTier === 'naib') return null;

      const nextThreshold = TIER_THRESHOLDS[nextTier] ?? 0;
      const distance = Math.max(0, nextThreshold - profile.convictionScore);

      return {
        profileId: profile.id,
        discordId: profile.discordId,
        nym: profile.metadata?.displayName ?? profile.metadata?.username ?? `User-${profile.discordId?.slice(-4) ?? 'Unknown'}`,
        currentTier,
        nextTier,
        convictionScore: profile.convictionScore,
        distanceToNextTier: distance,
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

  // Sort by distance to next tier (closest first)
  withProgression.sort((a, b) => a.distanceToNextTier - b.distanceToNextTier);

  // Add ranks and limit (using safeLimit)
  return withProgression.slice(0, safeLimit).map((entry, index) => ({
    ...entry,
    rank: index + 1,
  }));
}

/**
 * Get member's tier progression rank
 */
export async function getMemberTierProgressionRank(
  communityId: string,
  profileId: string
): Promise<number | null> {
  const allEntries = await getTierProgressionLeaderboard(communityId, 1000);
  const entry = allEntries.find((e) => e.profileId === profileId);
  return entry?.rank ?? null;
}

/**
 * Get total member count for a community
 */
export async function getMemberCount(communityId: string): Promise<number> {
  const db = getDatabase();
  const result = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.profiles)
    .where(eq(schema.profiles.communityId, communityId));

  return result[0]?.count ?? 0;
}

// =============================================================================
// Directory Queries
// =============================================================================

/**
 * Directory filters
 */
export interface DirectoryFilters {
  page?: number;
  pageSize?: number;
  tier?: 'naib' | 'fedaykin';
  sortBy?: 'nym' | 'tenure' | 'badgeCount';
  sortDir?: 'asc' | 'desc';
}

/**
 * Directory member entry
 */
export interface DirectoryMember {
  profileId: string;
  discordId: string | null;
  nym: string;
  tier: string | null;
  tenureCategory: string;
  badgeCount: number;
  joinedAt: Date;
}

/**
 * Directory result with pagination
 */
export interface DirectoryResult {
  members: DirectoryMember[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/**
 * Get directory listing with pagination and filters
 * SEC-4.2: Page size capped at MAX_PAGINATION_LIMIT to prevent memory exhaustion
 */
export async function getDirectory(
  communityId: string,
  filters: DirectoryFilters = {}
): Promise<DirectoryResult> {
  const db = getDatabase();

  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(Math.max(1, filters.pageSize ?? 10), MAX_PAGINATION_LIMIT);
  const offset = (page - 1) * pageSize;

  // Build where clause
  const conditions = [eq(schema.profiles.communityId, communityId)];

  // Tier filter
  if (filters.tier) {
    conditions.push(eq(schema.profiles.tier, filters.tier));
  } else {
    // Default: only show fedaykin and naib (eligible members)
    conditions.push(sql`${schema.profiles.tier} IN ('fedaykin', 'naib')`);
  }

  // Get total count first
  const countResult = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.profiles)
    .where(and(...conditions));

  const total = countResult[0]?.count ?? 0;
  const totalPages = Math.ceil(total / pageSize);

  // Build order clause based on sortBy
  let orderClause;
  const sortDir = filters.sortDir ?? 'asc';

  switch (filters.sortBy) {
    case 'tenure':
      orderClause = sortDir === 'asc'
        ? asc(schema.profiles.joinedAt)
        : desc(schema.profiles.joinedAt);
      break;
    case 'badgeCount':
      orderClause = sortDir === 'asc'
        ? sql`(SELECT COUNT(*) FROM badges WHERE badges.profile_id = ${schema.profiles.id} AND badges.revoked_at IS NULL) ASC`
        : sql`(SELECT COUNT(*) FROM badges WHERE badges.profile_id = ${schema.profiles.id} AND badges.revoked_at IS NULL) DESC`;
      break;
    case 'nym':
    default:
      // Sort by display name or username
      orderClause = sortDir === 'asc'
        ? sql`COALESCE(${schema.profiles.metadata}->>'displayName', ${schema.profiles.metadata}->>'username', ${schema.profiles.discordId}) ASC`
        : sql`COALESCE(${schema.profiles.metadata}->>'displayName', ${schema.profiles.metadata}->>'username', ${schema.profiles.discordId}) DESC`;
      break;
  }

  // Get profiles with badge counts
  const results = await db
    .select({
      profileId: schema.profiles.id,
      discordId: schema.profiles.discordId,
      tier: schema.profiles.tier,
      joinedAt: schema.profiles.joinedAt,
      metadata: schema.profiles.metadata,
      badgeCount: sql<number>`(
        SELECT COUNT(*)::int FROM badges
        WHERE badges.profile_id = ${schema.profiles.id}
        AND badges.revoked_at IS NULL
      )`,
    })
    .from(schema.profiles)
    .where(and(...conditions))
    .orderBy(orderClause)
    .limit(pageSize)
    .offset(offset);

  const members = results.map((row) => ({
    profileId: row.profileId,
    discordId: row.discordId,
    nym: row.metadata?.displayName ?? row.metadata?.username ?? `User-${row.discordId?.slice(-4) ?? 'Unknown'}`,
    tier: row.tier,
    tenureCategory: calculateTenureCategory(row.joinedAt),
    badgeCount: row.badgeCount,
    joinedAt: row.joinedAt,
  }));

  return {
    members,
    total,
    page,
    pageSize,
    totalPages,
  };
}

// =============================================================================
// Profile Queries (Extended)
// =============================================================================

/**
 * Public profile data (privacy-filtered)
 */
export interface PublicProfile {
  profileId: string;
  nym: string;
  bio: string | null;
  pfpUrl: string | null;
  tier: string | null;
  tenureCategory: string;
  badgeCount: number;
  joinedAt: Date;
  badges: PublicBadge[];
}

/**
 * Public badge data (privacy-filtered)
 */
export interface PublicBadge {
  name: string;
  description: string;
  emoji: string | null;
  category: string;
}

/**
 * Own profile data (full view for owner)
 */
export interface OwnProfile {
  profileId: string;
  nym: string;
  bio: string | null;
  pfpUrl: string | null;
  tier: string | null;
  onboardingComplete: boolean;
  createdAt: Date;
  nymLastChanged: Date | null;
}

/**
 * Get profile by nym within a community
 */
export async function getProfileByNym(
  communityId: string,
  nym: string
): Promise<schema.Profile | null> {
  const db = getDatabase();
  // Search by displayName or username in metadata
  const result = await db
    .select()
    .from(schema.profiles)
    .where(
      and(
        eq(schema.profiles.communityId, communityId),
        sql`(
          ${schema.profiles.metadata}->>'displayName' ILIKE ${nym}
          OR ${schema.profiles.metadata}->>'username' ILIKE ${nym}
        )`
      )
    )
    .limit(1);

  return result[0] ?? null;
}

/**
 * Search profiles by nym (for autocomplete)
 * SEC-4.2: Limit capped at 100 for autocomplete (lower than MAX_PAGINATION_LIMIT)
 */
export async function searchProfilesByNym(
  communityId: string,
  query: string,
  limit: number = 25
): Promise<Array<{ nym: string; tier: string | null }>> {
  const db = getDatabase();
  // Autocomplete results should be smaller - cap at 100
  const safeLimit = Math.min(Math.max(1, limit), 100);

  const results = await db
    .select({
      metadata: schema.profiles.metadata,
      tier: schema.profiles.tier,
    })
    .from(schema.profiles)
    .where(
      and(
        eq(schema.profiles.communityId, communityId),
        sql`(
          ${schema.profiles.metadata}->>'displayName' ILIKE ${`%${query}%`}
          OR ${schema.profiles.metadata}->>'username' ILIKE ${`%${query}%`}
        )`
      )
    )
    .limit(safeLimit);

  return results.map((row) => ({
    nym: row.metadata?.displayName ?? row.metadata?.username ?? 'Unknown',
    tier: row.tier,
  }));
}

/**
 * Get own profile data (full view for owner)
 */
export async function getOwnProfile(
  communityId: string,
  discordId: string
): Promise<OwnProfile | null> {
  const profile = await getProfileByDiscordId(communityId, discordId);
  if (!profile) return null;

  // Onboarding is complete if user has a tier assigned
  const onboardingComplete = profile.tier !== null;

  return {
    profileId: profile.id,
    nym: profile.metadata?.displayName ?? profile.metadata?.username ?? `User-${discordId.slice(-4)}`,
    bio: profile.metadata?.bio ?? null,
    pfpUrl: profile.metadata?.pfpUrl ?? profile.metadata?.avatarUrl ?? null,
    tier: profile.tier,
    onboardingComplete,
    createdAt: profile.joinedAt,
    nymLastChanged: profile.metadata?.nymLastChanged ? new Date(profile.metadata.nymLastChanged) : null,
  };
}

/**
 * Get public profile data (privacy-filtered view)
 */
export async function getPublicProfile(
  communityId: string,
  nym: string
): Promise<PublicProfile | null> {
  const profile = await getProfileByNym(communityId, nym);
  if (!profile) return null;

  const badges = await getProfileBadges(profile.id);
  const badgeCount = badges.length;

  return {
    profileId: profile.id,
    nym: profile.metadata?.displayName ?? profile.metadata?.username ?? 'Unknown',
    bio: profile.metadata?.bio ?? null,
    pfpUrl: profile.metadata?.pfpUrl ?? profile.metadata?.avatarUrl ?? null,
    tier: profile.tier,
    tenureCategory: calculateTenureCategory(profile.joinedAt),
    badgeCount,
    joinedAt: profile.joinedAt,
    badges: badges.slice(0, 5).map((b) => ({
      name: b.metadata?.name ?? b.metadata?.badgeName ?? b.badgeType,
      description: b.metadata?.description ?? '',
      emoji: b.metadata?.emoji ?? null,
      category: b.metadata?.category ?? 'special',
    })),
  };
}

// =============================================================================
// Badge Queries (Extended)
// =============================================================================

/**
 * Badge with award info
 */
export interface BadgeWithAward {
  id: string;
  name: string;
  description: string;
  emoji: string | null;
  category: string;
  awardedAt: Date;
  awardedBy: string | null;
  awardReason: string | null;
}

/**
 * Get badges with award info for a profile
 */
export async function getBadgesWithAward(profileId: string): Promise<BadgeWithAward[]> {
  const badges = await getProfileBadges(profileId);

  return badges.map((b) => ({
    id: b.id,
    name: b.metadata?.name ?? b.metadata?.badgeName ?? b.badgeType,
    description: b.metadata?.description ?? '',
    emoji: b.metadata?.emoji ?? null,
    category: b.metadata?.category ?? 'special',
    awardedAt: b.awardedAt,
    awardedBy: b.awardedBy,
    awardReason: b.metadata?.reason ?? null,
  }));
}

/**
 * Get own badges view (with award dates)
 */
export async function getOwnBadges(
  communityId: string,
  discordId: string
): Promise<{ nym: string; pfpUrl: string | null; badges: BadgeWithAward[] } | null> {
  const profile = await getProfileByDiscordId(communityId, discordId);
  if (!profile) return null;

  const badges = await getBadgesWithAward(profile.id);

  return {
    nym: profile.metadata?.displayName ?? profile.metadata?.username ?? `User-${discordId.slice(-4)}`,
    pfpUrl: profile.metadata?.pfpUrl ?? null,
    badges,
  };
}

/**
 * Get public badges view
 */
export async function getPublicBadges(
  communityId: string,
  nym: string
): Promise<{ nym: string; tier: string | null; pfpUrl: string | null; badges: BadgeWithAward[] } | null> {
  const profile = await getProfileByNym(communityId, nym);
  if (!profile) return null;

  const badges = await getBadgesWithAward(profile.id);

  return {
    nym: profile.metadata?.displayName ?? profile.metadata?.username ?? 'Unknown',
    tier: profile.tier,
    pfpUrl: profile.metadata?.pfpUrl ?? null,
    badges,
  };
}

// =============================================================================
// Naib Queries
// =============================================================================

/**
 * Public Naib member data (privacy-filtered)
 */
export interface PublicNaibMember {
  nym: string;
  rank: number;
  seatNumber: number;
  seatedAt: Date;
  isFounding: boolean;
  pfpUrl: string | null;
}

/**
 * Former Naib data
 */
export interface PublicFormerNaib {
  nym: string;
  totalTenureMs: number;
  seatCount: number;
  lastUnseatedAt: Date;
}

/**
 * Get current Naib council (top 7)
 */
export async function getCurrentNaib(communityId: string): Promise<PublicNaibMember[]> {
  const profiles = await getProfilesByRank(communityId, 7);

  return profiles
    .filter((p) => p.tier === 'naib')
    .map((profile, index) => ({
      nym: profile.metadata?.displayName ?? profile.metadata?.username ?? 'Unknown',
      rank: index + 1,
      seatNumber: index + 1,
      seatedAt: profile.metadata?.naibSeatedAt ? new Date(profile.metadata.naibSeatedAt) : profile.joinedAt,
      isFounding: profile.metadata?.isFoundingNaib ?? false,
      pfpUrl: profile.metadata?.pfpUrl ?? null,
    }));
}

/**
 * Get former Naib members
 */
export async function getFormerNaib(communityId: string): Promise<PublicFormerNaib[]> {
  const db = getDatabase();

  // Get profiles that have formerNaib metadata flag
  const results = await db
    .select()
    .from(schema.profiles)
    .where(
      and(
        eq(schema.profiles.communityId, communityId),
        sql`${schema.profiles.metadata}->>'isFormerNaib' = 'true'`
      )
    )
    .orderBy(sql`(${schema.profiles.metadata}->>'totalNaibTenureMs')::bigint DESC`);

  return results.map((profile) => ({
    nym: profile.metadata?.displayName ?? profile.metadata?.username ?? 'Unknown',
    totalTenureMs: profile.metadata?.totalNaibTenureMs ?? 0,
    seatCount: profile.metadata?.naibSeatCount ?? 1,
    lastUnseatedAt: profile.metadata?.lastUnseatedAt ? new Date(profile.metadata.lastUnseatedAt) : profile.joinedAt,
  }));
}

/**
 * Get empty Naib seat count
 */
export async function getEmptyNaibSeatCount(communityId: string): Promise<number> {
  const currentNaib = await getCurrentNaib(communityId);
  return Math.max(0, 7 - currentNaib.length);
}

/**
 * Check if a profile is currently a Naib member
 */
export async function isProfileNaib(communityId: string, profileId: string): Promise<boolean> {
  const db = getDatabase();
  const result = await db
    .select({ tier: schema.profiles.tier })
    .from(schema.profiles)
    .where(eq(schema.profiles.id, profileId))
    .limit(1);

  return result[0]?.tier === 'naib';
}

// =============================================================================
// Notification Preferences Queries
// =============================================================================

// Re-export AlertFrequency from schema for convenience
export type { AlertFrequency } from './schema.js';

/**
 * Get notification preferences for a profile
 */
export async function getNotificationPreferences(
  profileId: string
): Promise<NotificationPreferences> {
  const db = getDatabase();
  const result = await db
    .select({ metadata: schema.profiles.metadata })
    .from(schema.profiles)
    .where(eq(schema.profiles.id, profileId))
    .limit(1);

  const prefs: Partial<NotificationPreferences> = result[0]?.metadata?.notifications ?? {};

  return {
    positionUpdates: prefs.positionUpdates ?? true,
    atRiskWarnings: prefs.atRiskWarnings ?? true,
    naibAlerts: prefs.naibAlerts ?? true,
    frequency: prefs.frequency ?? '2_per_week',
    alertsSentThisWeek: prefs.alertsSentThisWeek ?? 0,
  };
}

/**
 * Get max alerts per week based on frequency
 */
export function getMaxAlertsPerWeek(frequency: AlertFrequency): number {
  const limits: Record<AlertFrequency, number> = {
    '1_per_week': 1,
    '2_per_week': 2,
    '3_per_week': 3,
    'daily': 7,
  };
  return limits[frequency];
}

/**
 * Update notification preferences for a profile
 */
export async function updateNotificationPreferences(
  profileId: string,
  prefs: Partial<NotificationPreferences>
): Promise<void> {
  const db = getDatabase();

  // Get current metadata
  const result = await db
    .select({ metadata: schema.profiles.metadata })
    .from(schema.profiles)
    .where(eq(schema.profiles.id, profileId))
    .limit(1);

  const currentMetadata = result[0]?.metadata ?? {};
  const currentNotifications: Partial<NotificationPreferences> = currentMetadata.notifications ?? {};

  // Merge preferences - use type assertion since we're merging partial objects
  const updatedNotifications: Partial<NotificationPreferences> = {
    ...currentNotifications,
    ...prefs,
  };

  // Update metadata
  await db
    .update(schema.profiles)
    .set({
      metadata: {
        ...currentMetadata,
        notifications: updatedNotifications as NotificationPreferences,
      },
    })
    .where(eq(schema.profiles.id, profileId));
}

// =============================================================================
// Badge Definition Queries (Admin)
// =============================================================================

/**
 * Badge definition (from badges table with no profile association)
 */
export interface BadgeDefinition {
  badgeId: string;
  name: string;
  description: string;
  emoji: string | null;
  category: string;
}

/**
 * Get all badge definitions (unique badge types)
 * For admin-badge command autocomplete
 */
export async function getAllBadgeDefinitions(communityId: string): Promise<BadgeDefinition[]> {
  const db = getDatabase();

  // Get distinct badge types from badges table
  // In PostgreSQL, we can get unique badge types by grouping
  const results = await db
    .select({
      badgeType: schema.badges.badgeType,
      metadata: schema.badges.metadata,
    })
    .from(schema.badges)
    .innerJoin(schema.profiles, eq(schema.badges.profileId, schema.profiles.id))
    .where(eq(schema.profiles.communityId, communityId))
    .groupBy(schema.badges.badgeType, schema.badges.metadata);

  // Deduplicate by badgeType since metadata may vary
  const seen = new Set<string>();
  const definitions: BadgeDefinition[] = [];

  for (const row of results) {
    if (!seen.has(row.badgeType)) {
      seen.add(row.badgeType);
      definitions.push({
        badgeId: row.badgeType,
        name: row.metadata?.name ?? row.metadata?.badgeName ?? row.badgeType,
        description: row.metadata?.description ?? '',
        emoji: row.metadata?.emoji ?? null,
        category: row.metadata?.category ?? 'special',
      });
    }
  }

  // If no badges found, return default set of definitions
  if (definitions.length === 0) {
    return getDefaultBadgeDefinitions();
  }

  return definitions;
}

/**
 * Default badge definitions (used when no badges exist yet)
 */
function getDefaultBadgeDefinitions(): BadgeDefinition[] {
  return [
    // Tenure badges
    { badgeId: 'og', name: 'OG', description: 'Joined within 30 days of launch', emoji: '🏛️', category: 'tenure' },
    { badgeId: 'veteran', name: 'Veteran', description: '90+ days membership', emoji: '⭐', category: 'tenure' },
    { badgeId: 'elder', name: 'Elder', description: '180+ days membership', emoji: '🌟', category: 'tenure' },
    // Engagement badges
    { badgeId: 'consistent', name: 'Consistent', description: 'Activity balance 100+', emoji: '💪', category: 'engagement' },
    { badgeId: 'dedicated', name: 'Dedicated', description: 'Activity balance 250+', emoji: '🔥', category: 'engagement' },
    { badgeId: 'devoted', name: 'Devoted', description: 'Activity balance 500+', emoji: '⚡', category: 'engagement' },
    // Contribution badges (admin-awardable)
    { badgeId: 'helper', name: 'Helper', description: 'Helps other community members', emoji: '🤝', category: 'contribution' },
    { badgeId: 'builder', name: 'Builder', description: 'Contributes to community projects', emoji: '🔨', category: 'contribution' },
    { badgeId: 'teacher', name: 'Teacher', description: 'Educates community members', emoji: '📚', category: 'contribution' },
    { badgeId: 'water-sharer', name: 'Water Sharer', description: 'Shares water with the community', emoji: '💧', category: 'contribution' },
    // Special badges
    { badgeId: 'founding-fedaykin', name: 'Founding Fedaykin', description: 'First 69 members', emoji: '🌟', category: 'special' },
    { badgeId: 'usul-ascended', name: 'Usul Ascended', description: 'Achieved Usul tier', emoji: '👑', category: 'special' },
  ];
}

/**
 * Check if a profile has a specific badge
 */
export async function profileHasBadge(profileId: string, badgeType: string): Promise<boolean> {
  const db = getDatabase();
  const result = await db
    .select({ id: schema.badges.id })
    .from(schema.badges)
    .where(
      and(
        eq(schema.badges.profileId, profileId),
        eq(schema.badges.badgeType, badgeType),
        sql`${schema.badges.revokedAt} IS NULL`
      )
    )
    .limit(1);

  return result.length > 0;
}

/**
 * Award a badge to a profile
 * Returns the badge ID if successful, null if already has or error
 *
 * @param communityId - The community ID
 * @param profileId - The profile receiving the badge
 * @param badgeType - The badge type/ID
 * @param awardedByProfileId - The profile ID of the admin awarding (or null for system)
 * @param reason - Reason for the award
 */
export async function awardBadge(
  communityId: string,
  profileId: string,
  badgeType: string,
  awardedByProfileId: string | null,
  reason: string | null
): Promise<string | null> {
  const db = getDatabase();

  // Check if already has badge
  const hasBadge = await profileHasBadge(profileId, badgeType);
  if (hasBadge) {
    return null;
  }

  // Get badge metadata from defaults
  const definitions = getDefaultBadgeDefinitions();
  const def = definitions.find(d => d.badgeId === badgeType);

  // Build metadata (convert null emoji to undefined for type compatibility)
  const metadata: schema.BadgeMetadata = def ? {
    name: def.name,
    description: def.description,
    emoji: def.emoji ?? undefined,
    category: def.category,
    reason: reason ?? undefined,
  } : {
    name: badgeType,
    reason: reason ?? undefined,
  };

  const result = await db.insert(schema.badges).values({
    communityId,
    profileId,
    badgeType,
    awardedBy: awardedByProfileId,
    awardedAt: new Date(),
    metadata,
  }).returning({ id: schema.badges.id });

  return result[0]?.id ?? null;
}

/**
 * Revoke a badge from a profile
 * Sets revokedAt timestamp to mark badge as revoked
 *
 * @param profileId - The profile losing the badge
 * @param badgeType - The badge type/ID to revoke
 * @returns true if badge was found and revoked, false otherwise
 */
export async function revokeBadge(
  profileId: string,
  badgeType: string
): Promise<boolean> {
  const db = getDatabase();

  const result = await db
    .update(schema.badges)
    .set({
      revokedAt: new Date(),
    })
    .where(
      and(
        eq(schema.badges.profileId, profileId),
        eq(schema.badges.badgeType, badgeType),
        sql`${schema.badges.revokedAt} IS NULL`
      )
    )
    .returning({ id: schema.badges.id });

  return result.length > 0;
}

/**
 * Get badges for a profile that match a specific badge type
 * Used for revoke autocomplete
 */
export async function getProfileBadgesByType(profileId: string): Promise<string[]> {
  const db = getDatabase();
  const results = await db
    .select({ badgeType: schema.badges.badgeType })
    .from(schema.badges)
    .where(
      and(
        eq(schema.badges.profileId, profileId),
        sql`${schema.badges.revokedAt} IS NULL`
      )
    );

  return results.map(r => r.badgeType);
}

// =============================================================================
// Analytics Queries (Admin)
// =============================================================================

/**
 * Community analytics data structure
 */
export interface CommunityAnalytics {
  /** Total onboarded members */
  totalMembers: number;
  /** Member distribution by tier */
  byTier: Record<string, number>;
  /** Total conviction score represented */
  totalConviction: number;
  /** Weekly active users (members with activity in last 7 days) */
  weeklyActive: number;
  /** New members this week */
  newThisWeek: number;
  /** Tier promotions this week */
  promotionsThisWeek: number;
  /** Badges awarded this week */
  badgesAwardedThisWeek: number;
  /** When the analytics were generated */
  generatedAt: Date;
}

/**
 * Top active member entry
 */
export interface TopActiveMember {
  nym: string;
  activityScore: number;
  tier: string | null;
}

/**
 * Recent promotion entry
 */
export interface RecentPromotion {
  nym: string;
  fromTier: string;
  toTier: string;
  changedAt: Date;
}

/**
 * Get community analytics for admin dashboard
 */
export async function getCommunityAnalytics(communityId: string): Promise<CommunityAnalytics> {
  const db = getDatabase();
  const now = new Date();
  const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  // Total onboarded members (those with a tier)
  const totalMembersResult = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.profiles)
    .where(
      and(
        eq(schema.profiles.communityId, communityId),
        sql`${schema.profiles.tier} IS NOT NULL`
      )
    );
  const totalMembers = totalMembersResult[0]?.count ?? 0;

  // Tier distribution
  const tierDistribution = await db
    .select({
      tier: schema.profiles.tier,
      count: sql<number>`count(*)::int`,
    })
    .from(schema.profiles)
    .where(
      and(
        eq(schema.profiles.communityId, communityId),
        sql`${schema.profiles.tier} IS NOT NULL`
      )
    )
    .groupBy(schema.profiles.tier);

  const byTier: Record<string, number> = {};
  for (const row of tierDistribution) {
    if (row.tier) {
      byTier[row.tier] = row.count;
    }
  }

  // Total conviction score
  const totalConvictionResult = await db
    .select({ total: sql<number>`COALESCE(SUM(${schema.profiles.convictionScore}), 0)::numeric` })
    .from(schema.profiles)
    .where(
      and(
        eq(schema.profiles.communityId, communityId),
        sql`${schema.profiles.tier} IS NOT NULL`
      )
    );
  const totalConviction = Number(totalConvictionResult[0]?.total ?? 0);

  // Weekly active users (activity score > 0 and updated within last week)
  // Note: In PostgreSQL, we check if the profile was updated recently as a proxy for activity
  const weeklyActiveResult = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.profiles)
    .where(
      and(
        eq(schema.profiles.communityId, communityId),
        sql`${schema.profiles.activityScore} > 0`,
        sql`${schema.profiles.updatedAt} >= ${oneWeekAgo}`
      )
    );
  const weeklyActive = weeklyActiveResult[0]?.count ?? 0;

  // New members this week
  const newThisWeekResult = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.profiles)
    .where(
      and(
        eq(schema.profiles.communityId, communityId),
        sql`${schema.profiles.tier} IS NOT NULL`,
        sql`${schema.profiles.joinedAt} >= ${oneWeekAgo}`
      )
    );
  const newThisWeek = newThisWeekResult[0]?.count ?? 0;

  // Tier promotions this week
  // Note: We would need a tier_history table to track this properly
  // For now, we approximate by counting profiles that were updated this week with tier changes
  // This is a simplified metric - consider adding a tier_history table for accurate tracking
  const promotionsThisWeek = 0; // Placeholder - needs tier_history table

  // Badges awarded this week
  const badgesAwardedResult = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.badges)
    .innerJoin(schema.profiles, eq(schema.badges.profileId, schema.profiles.id))
    .where(
      and(
        eq(schema.profiles.communityId, communityId),
        sql`${schema.badges.awardedAt} >= ${oneWeekAgo}`,
        sql`${schema.badges.revokedAt} IS NULL`
      )
    );
  const badgesAwardedThisWeek = badgesAwardedResult[0]?.count ?? 0;

  return {
    totalMembers,
    byTier,
    totalConviction,
    weeklyActive,
    newThisWeek,
    promotionsThisWeek,
    badgesAwardedThisWeek,
    generatedAt: now,
  };
}

/**
 * Get tier distribution as formatted string
 */
export async function getTierDistributionSummary(communityId: string): Promise<string> {
  const analytics = await getCommunityAnalytics(communityId);
  const lines: string[] = [];

  // Order tiers from highest to lowest
  const tierOrder = ['naib', 'fedaykin', 'usul', 'sayyadina', 'mushtamal', 'sihaya', 'qanat', 'ichwan', 'hajra'];

  for (const tier of tierOrder) {
    const count = analytics.byTier[tier];
    if (count && count > 0) {
      const tierName = tier.charAt(0).toUpperCase() + tier.slice(1);
      lines.push(`${tierName}: ${count}`);
    }
  }

  // Also include any tiers not in the standard list
  for (const [tier, count] of Object.entries(analytics.byTier)) {
    if (!tierOrder.includes(tier) && count > 0) {
      const tierName = tier.charAt(0).toUpperCase() + tier.slice(1);
      lines.push(`${tierName}: ${count}`);
    }
  }

  return lines.join('\n') || 'No members assigned to tiers';
}

/**
 * Get top active members for the week
 * SEC-4.2: Limit capped at MAX_PAGINATION_LIMIT to prevent memory exhaustion
 */
export async function getTopActiveMembers(
  communityId: string,
  limit: number = 5
): Promise<TopActiveMember[]> {
  const db = getDatabase();
  const safeLimit = Math.min(Math.max(1, limit), MAX_PAGINATION_LIMIT);

  const results = await db
    .select({
      metadata: schema.profiles.metadata,
      activityScore: schema.profiles.activityScore,
      tier: schema.profiles.tier,
    })
    .from(schema.profiles)
    .where(
      and(
        eq(schema.profiles.communityId, communityId),
        sql`${schema.profiles.activityScore} > 0`
      )
    )
    .orderBy(desc(schema.profiles.activityScore))
    .limit(safeLimit);

  return results.map((row) => ({
    nym: row.metadata?.displayName ?? row.metadata?.username ?? 'Unknown',
    activityScore: row.activityScore,
    tier: row.tier,
  }));
}

/**
 * Get recent tier promotions
 * Note: This requires a tier_history table. For now returns empty array.
 * TODO: Implement when tier_history table is added
 */
export async function getRecentPromotions(
  communityId: string,
  limit: number = 5
): Promise<RecentPromotion[]> {
  // Placeholder - needs tier_history table implementation
  // In a full implementation, this would query a tier_history table
  // that tracks from_tier, to_tier, changed_at for each tier change
  return [];
}

// =============================================================================
// Export schema types
// =============================================================================
export type { Community, Profile, Badge } from './schema.js';

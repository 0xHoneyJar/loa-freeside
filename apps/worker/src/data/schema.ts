/**
 * Database Schema Re-export
 *
 * Re-exports the shared Drizzle schema from sietch-service.
 * This ensures Worker uses the exact same schema definitions.
 *
 * Note: In a monorepo setup, this would be a shared package.
 * For now, we duplicate the essential table definitions.
 */

import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  jsonb,
  unique,
  index,
  boolean,
} from 'drizzle-orm/pg-core';

// =============================================================================
// Communities Table
// =============================================================================

/**
 * Community settings stored as JSONB
 */
export interface CommunitySettings {
  rolePrefix?: string;
  autoSync?: boolean;
  syncInterval?: number;
  welcomeMessage?: string;
  adminWebhook?: string;
}

export const communities = pgTable(
  'communities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    themeId: text('theme_id').notNull().default('basic'),
    subscriptionTier: text('subscription_tier').notNull().default('free'),
    discordGuildId: text('discord_guild_id').unique(),
    telegramChatId: text('telegram_chat_id').unique(),
    isActive: boolean('is_active').notNull().default(true),
    settings: jsonb('settings').$type<CommunitySettings>().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    themeIdx: index('idx_communities_theme').on(table.themeId),
    discordGuildIdx: index('idx_communities_discord_guild').on(table.discordGuildId),
    subscriptionIdx: index('idx_communities_subscription').on(table.subscriptionTier),
  })
);

// =============================================================================
// Profiles Table
// =============================================================================

/**
 * Alert frequency type
 */
export type AlertFrequency = '1_per_week' | '2_per_week' | '3_per_week' | 'daily';

/**
 * Notification preferences (with defaults applied in getNotificationPreferences)
 */
export interface NotificationPreferences {
  positionUpdates: boolean;
  atRiskWarnings: boolean;
  naibAlerts: boolean;
  frequency: AlertFrequency;
  alertsSentThisWeek: number;
}

/**
 * Profile metadata stored as JSONB
 */
export interface ProfileMetadata {
  username?: string;
  displayName?: string;
  avatarUrl?: string;
  ensName?: string;
  highestTier?: string;
  highestRank?: number;
  preferences?: Record<string, unknown>;
  // Extended fields for profile/naib commands
  bio?: string;
  pfpUrl?: string;
  nymLastChanged?: string; // ISO date string
  naibSeatedAt?: string; // ISO date string
  isFoundingNaib?: boolean;
  isFormerNaib?: boolean;
  totalNaibTenureMs?: number;
  naibSeatCount?: number;
  lastUnseatedAt?: string; // ISO date string
  notifications?: NotificationPreferences;
}

export const profiles = pgTable(
  'profiles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    communityId: uuid('community_id')
      .notNull()
      .references(() => communities.id, { onDelete: 'cascade' }),
    discordId: text('discord_id'),
    telegramId: text('telegram_id'),
    walletAddress: text('wallet_address'),
    tier: text('tier'),
    currentRank: integer('current_rank'),
    activityScore: integer('activity_score').notNull().default(0),
    convictionScore: integer('conviction_score').notNull().default(0),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    firstClaimAt: timestamp('first_claim_at', { withTimezone: true }),
    metadata: jsonb('metadata').$type<ProfileMetadata>().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    communityIdx: index('idx_profiles_community').on(table.communityId),
    walletIdx: index('idx_profiles_wallet').on(table.walletAddress),
    tierIdx: index('idx_profiles_tier').on(table.communityId, table.tier),
    rankIdx: index('idx_profiles_rank').on(table.communityId, table.currentRank),
    discordUnique: unique('uq_profiles_discord').on(table.communityId, table.discordId),
    telegramUnique: unique('uq_profiles_telegram').on(table.communityId, table.telegramId),
  })
);

// =============================================================================
// Badges Table
// =============================================================================

/**
 * Badge metadata stored as JSONB
 */
export interface BadgeMetadata {
  badgeName?: string;
  name?: string;
  description?: string;
  emoji?: string;
  category?: string;
  tierAtAward?: string;
  rankAtAward?: number;
  context?: Record<string, unknown>;
  reason?: string;
}

export const badges = pgTable(
  'badges',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    communityId: uuid('community_id')
      .notNull()
      .references(() => communities.id, { onDelete: 'cascade' }),
    profileId: uuid('profile_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    badgeType: text('badge_type').notNull(),
    awardedAt: timestamp('awarded_at', { withTimezone: true }).notNull().defaultNow(),
    awardedBy: uuid('awarded_by').references(() => profiles.id, { onDelete: 'set null' }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    metadata: jsonb('metadata').$type<BadgeMetadata>().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    profileIdx: index('idx_badges_profile').on(table.profileId),
    typeIdx: index('idx_badges_type').on(table.communityId, table.badgeType),
    awardedByIdx: index('idx_badges_awarded_by').on(table.awardedBy),
    uniqueBadge: unique('uq_badges_profile_type').on(
      table.communityId,
      table.profileId,
      table.badgeType
    ),
  })
);

// =============================================================================
// Type Exports
// =============================================================================

export type Community = typeof communities.$inferSelect;
export type NewCommunity = typeof communities.$inferInsert;

export type Profile = typeof profiles.$inferSelect;
export type NewProfile = typeof profiles.$inferInsert;

export type Badge = typeof badges.$inferSelect;
export type NewBadge = typeof badges.$inferInsert;

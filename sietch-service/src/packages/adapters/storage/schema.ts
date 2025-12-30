/**
 * Drizzle Schema - PostgreSQL Database Schema
 *
 * Sprint 38: Drizzle Schema Design
 *
 * Multi-tenant schema with Row-Level Security (RLS) support.
 * All tenant-scoped tables include community_id foreign key.
 *
 * Tables:
 * - communities: Tenant root table (theme, subscription)
 * - profiles: Member profiles with wallet, tier, activity
 * - badges: Earned badges with lineage support (awarded_by)
 * - manifests: Configuration versioning with JSONB content
 * - shadow_states: Discord resource mappings for reconciliation
 *
 * @module packages/adapters/storage/schema
 */

import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  jsonb,
  unique,
  uniqueIndex,
  index,
  boolean,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// =============================================================================
// Communities Table
// =============================================================================

/**
 * Communities - Tenant root table
 *
 * Each community represents a single Discord/Telegram server using Arrakis.
 * No RLS on this table (community lookup happens before tenant context is set).
 */
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

/**
 * Community settings stored as JSONB
 */
export interface CommunitySettings {
  /** Custom role prefix for Discord roles */
  rolePrefix?: string;
  /** Whether to sync roles automatically */
  autoSync?: boolean;
  /** Sync interval in minutes */
  syncInterval?: number;
  /** Custom welcome message template */
  welcomeMessage?: string;
  /** Admin notification webhook */
  adminWebhook?: string;
}

// =============================================================================
// Profiles Table
// =============================================================================

/**
 * Profiles - Member profiles with tenant isolation
 *
 * RLS Policy: community_id = current_setting('app.current_tenant')::UUID
 */
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

/**
 * Profile metadata stored as JSONB
 */
export interface ProfileMetadata {
  /** Username from Discord/Telegram */
  username?: string;
  /** Display name */
  displayName?: string;
  /** Avatar URL */
  avatarUrl?: string;
  /** ENS name if resolved */
  ensName?: string;
  /** Highest tier ever achieved */
  highestTier?: string;
  /** Highest rank ever achieved */
  highestRank?: number;
  /** Custom user preferences */
  preferences?: Record<string, unknown>;
}

// =============================================================================
// Badges Table
// =============================================================================

/**
 * Badges - Earned badges with lineage support
 *
 * Self-referencing FK for Water Sharer lineage (awarded_by).
 * RLS Policy: community_id = current_setting('app.current_tenant')::UUID
 */
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
    // Self-referencing FK for lineage (Water Sharer)
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

/**
 * Badge metadata stored as JSONB
 */
export interface BadgeMetadata {
  /** Display name at time of award */
  badgeName?: string;
  /** Emoji at time of award */
  emoji?: string;
  /** Tier at time of award (for tier-based badges) */
  tierAtAward?: string;
  /** Rank at time of award */
  rankAtAward?: number;
  /** Additional context (e.g., lineage chain) */
  context?: Record<string, unknown>;
}

// =============================================================================
// Manifests Table
// =============================================================================

/**
 * Manifests - Configuration versioning with JSONB content
 *
 * Stores the desired state configuration for each community.
 * Version increments on each change for audit trail.
 * RLS Policy: community_id = current_setting('app.current_tenant')::UUID
 */
export const manifests = pgTable(
  'manifests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    communityId: uuid('community_id')
      .notNull()
      .references(() => communities.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    content: jsonb('content').$type<ManifestContent>().notNull(),
    checksum: text('checksum').notNull(),
    synthesizedAt: timestamp('synthesized_at', { withTimezone: true }).notNull().defaultNow(),
    synthesizedBy: text('synthesized_by'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    communityIdx: index('idx_manifests_community').on(table.communityId),
    versionIdx: index('idx_manifests_version').on(table.communityId, table.version),
    activeIdx: index('idx_manifests_active').on(table.communityId, table.isActive),
    uniqueVersion: unique('uq_manifests_community_version').on(table.communityId, table.version),
  })
);

/**
 * Manifest content stored as JSONB
 *
 * Represents the desired state of a community's Discord/Telegram configuration.
 */
export interface ManifestContent {
  /** Schema version for forward compatibility */
  schemaVersion: string;
  /** Theme configuration */
  theme: {
    themeId: string;
    tierOverrides?: Record<string, unknown>;
    badgeOverrides?: Record<string, unknown>;
  };
  /** Role definitions */
  roles: ManifestRole[];
  /** Channel definitions */
  channels: ManifestChannel[];
  /** Category definitions */
  categories: ManifestCategory[];
  /** Eligibility rules */
  eligibility?: {
    tokenAddress?: string;
    minBalance?: string;
    nftCollections?: string[];
  };
}

export interface ManifestRole {
  id: string;
  name: string;
  color: string;
  tierId?: string;
  permissions?: string[];
}

export interface ManifestChannel {
  id: string;
  name: string;
  type: 'text' | 'voice' | 'announcement' | 'forum';
  categoryId?: string;
  topic?: string;
  tierRestriction?: string;
}

export interface ManifestCategory {
  id: string;
  name: string;
  tierRestriction?: string;
}

// =============================================================================
// Shadow States Table
// =============================================================================

/**
 * Shadow States - Discord resource mappings for reconciliation
 *
 * Maps manifest IDs to actual Discord resource IDs.
 * Used for drift detection and reconciliation.
 * RLS Policy: community_id = current_setting('app.current_tenant')::UUID
 */
export const shadowStates = pgTable(
  'shadow_states',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    communityId: uuid('community_id')
      .notNull()
      .references(() => communities.id, { onDelete: 'cascade' }),
    manifestVersion: integer('manifest_version').notNull(),
    appliedAt: timestamp('applied_at', { withTimezone: true }).notNull().defaultNow(),
    appliedBy: text('applied_by'),
    resources: jsonb('resources').$type<ShadowResources>().notNull(),
    checksum: text('checksum').notNull(),
    status: text('status').notNull().default('applied'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    communityIdx: index('idx_shadow_community').on(table.communityId),
    statusIdx: index('idx_shadow_status').on(table.communityId, table.status),
  })
);

/**
 * Shadow resources mapping manifest IDs to Discord IDs
 */
export interface ShadowResources {
  /** Role mappings: manifest role ID -> Discord role ID */
  roles: Record<string, string>;
  /** Channel mappings: manifest channel ID -> Discord channel ID */
  channels: Record<string, string>;
  /** Category mappings: manifest category ID -> Discord category ID */
  categories: Record<string, string>;
}

// =============================================================================
// Drizzle Relations
// =============================================================================

/**
 * Community relations
 */
export const communitiesRelations = relations(communities, ({ one, many }) => ({
  profiles: many(profiles),
  badges: many(badges),
  manifests: many(manifests),
  shadowStates: many(shadowStates),
  // Coexistence relations (Sprint 56)
  incumbentConfig: one(incumbentConfigs),
  migrationState: one(migrationStates),
}));

/**
 * Profile relations
 */
export const profilesRelations = relations(profiles, ({ one, many }) => ({
  community: one(communities, {
    fields: [profiles.communityId],
    references: [communities.id],
  }),
  badges: many(badges),
  awardedBadges: many(badges, { relationName: 'awardedBy' }),
}));

/**
 * Badge relations
 */
export const badgesRelations = relations(badges, ({ one }) => ({
  community: one(communities, {
    fields: [badges.communityId],
    references: [communities.id],
  }),
  profile: one(profiles, {
    fields: [badges.profileId],
    references: [profiles.id],
  }),
  awarder: one(profiles, {
    fields: [badges.awardedBy],
    references: [profiles.id],
    relationName: 'awardedBy',
  }),
}));

/**
 * Manifest relations
 */
export const manifestsRelations = relations(manifests, ({ one }) => ({
  community: one(communities, {
    fields: [manifests.communityId],
    references: [communities.id],
  }),
}));

/**
 * Shadow state relations
 */
export const shadowStatesRelations = relations(shadowStates, ({ one }) => ({
  community: one(communities, {
    fields: [shadowStates.communityId],
    references: [communities.id],
  }),
}));

// =============================================================================
// Type Exports
// =============================================================================

export type Community = typeof communities.$inferSelect;
export type NewCommunity = typeof communities.$inferInsert;

export type Profile = typeof profiles.$inferSelect;
export type NewProfile = typeof profiles.$inferInsert;

export type Badge = typeof badges.$inferSelect;
export type NewBadge = typeof badges.$inferInsert;

export type Manifest = typeof manifests.$inferSelect;
export type NewManifest = typeof manifests.$inferInsert;

export type ShadowState = typeof shadowStates.$inferSelect;
export type NewShadowState = typeof shadowStates.$inferInsert;

// =============================================================================
// Audit Logs Table (Sprint 50 - Post-Audit Hardening)
// =============================================================================

/**
 * Audit Logs - Security event logging with HMAC signatures
 *
 * Persists security-critical events from KillSwitchProtocol, MFA, sessions, etc.
 * Uses Redis WAL buffer for high-throughput logging before batch persistence.
 *
 * RLS Policy: tenant_id = current_setting('app.current_tenant')::UUID OR tenant_id IS NULL
 * (Global events with NULL tenant_id are visible to platform admins)
 */
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').references(() => communities.id, { onDelete: 'set null' }),
    eventType: text('event_type').notNull(),
    actorId: text('actor_id').notNull(),
    targetScope: text('target_scope'), // 'GLOBAL', 'COMMUNITY', 'USER'
    targetId: text('target_id'),
    payload: jsonb('payload').$type<AuditLogPayload>().notNull(),
    hmacSignature: text('hmac_signature').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
  },
  (table) => ({
    tenantIdx: index('idx_audit_logs_tenant').on(table.tenantId),
    eventTypeIdx: index('idx_audit_logs_type').on(table.eventType),
    createdAtIdx: index('idx_audit_logs_created').on(table.createdAt),
    actorIdx: index('idx_audit_logs_actor').on(table.actorId),
  })
);

/**
 * Valid audit event types
 */
export type AuditEventType =
  | 'KILL_SWITCH_ACTIVATED'
  | 'KILL_SWITCH_DEACTIVATED'
  | 'MFA_VERIFIED'
  | 'MFA_FAILED'
  | 'SESSION_REVOKED'
  | 'VAULT_POLICY_REVOKED'
  | 'API_KEY_ROTATED'
  | 'API_KEY_REVOKED'
  | 'COMMUNITY_FROZEN'
  | 'COMMUNITY_UNFROZEN'
  | 'RLS_VIOLATION_ATTEMPT'
  | 'TENANT_CONTEXT_SET'
  | 'ADMIN_ACTION';

/**
 * Audit log payload stored as JSONB
 */
export interface AuditLogPayload {
  /** Event-specific data */
  [key: string]: unknown;
  /** Optional reason for the action */
  reason?: string;
  /** Optional additional context */
  context?: Record<string, unknown>;
  /** IP address if available */
  ipAddress?: string;
  /** User agent if available */
  userAgent?: string;
}

/**
 * Audit log relations
 */
export const auditLogsRelations = relations(auditLogs, ({ one }) => ({
  tenant: one(communities, {
    fields: [auditLogs.tenantId],
    references: [communities.id],
  }),
}));

export type AuditLog = typeof auditLogs.$inferSelect;
export type NewAuditLog = typeof auditLogs.$inferInsert;

// =============================================================================
// API Keys Table (Sprint 50 - Post-Audit Hardening)
// =============================================================================

/**
 * API Keys - Key management with versioning and rotation support
 *
 * Supports key rotation with grace period:
 * - New key created with incremented version
 * - Old key given expiration (grace period)
 * - Both keys valid during grace period
 * - Old key auto-expires after grace period
 *
 * Keys are stored as hashes (never plaintext).
 */
export const apiKeys = pgTable(
  'api_keys',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    keyId: text('key_id').notNull().unique(),
    keyHash: text('key_hash').notNull(),
    version: integer('version').notNull(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => communities.id, { onDelete: 'cascade' }),
    name: text('name'), // Optional friendly name
    permissions: jsonb('permissions').$type<string[]>().default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  },
  (table) => ({
    tenantIdx: index('idx_api_keys_tenant').on(table.tenantId),
    keyIdIdx: index('idx_api_keys_key_id').on(table.keyId),
    versionIdx: index('idx_api_keys_version').on(table.tenantId, table.version),
  })
);

/**
 * API key relations
 */
export const apiKeysRelations = relations(apiKeys, ({ one }) => ({
  tenant: one(communities, {
    fields: [apiKeys.tenantId],
    references: [communities.id],
  }),
}));

export type ApiKey = typeof apiKeys.$inferSelect;
export type NewApiKey = typeof apiKeys.$inferInsert;

// =============================================================================
// Coexistence Tables (Sprint 56 - Shadow Mode Foundation)
// =============================================================================

/**
 * Incumbent Bot Configuration - Tracks detected incumbent token-gating bots
 *
 * Stores information about incumbent solutions (Collab.Land, Matrica, Guild.xyz)
 * detected in a guild. Used for shadow mode comparison and migration planning.
 *
 * RLS Policy: community_id = current_setting('app.current_tenant')::UUID
 */
export const incumbentConfigs = pgTable(
  'incumbent_configs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    communityId: uuid('community_id')
      .notNull()
      .references(() => communities.id, { onDelete: 'cascade' })
      .unique(),
    provider: text('provider').notNull(), // 'collabland', 'matrica', 'guild.xyz', 'other'
    botId: text('bot_id'),
    botUsername: text('bot_username'),
    verificationChannelId: text('verification_channel_id'),
    detectedAt: timestamp('detected_at', { withTimezone: true }).notNull().defaultNow(),
    confidence: integer('confidence').notNull().default(0), // 0-100 (stored as integer for precision)
    manualOverride: boolean('manual_override').notNull().default(false),
    lastHealthCheck: timestamp('last_health_check', { withTimezone: true }),
    healthStatus: text('health_status').notNull().default('unknown'), // 'healthy', 'degraded', 'offline', 'unknown'
    detectedRoles: jsonb('detected_roles').$type<DetectedRole[]>().default([]),
    capabilities: jsonb('capabilities').$type<IncumbentCapabilities>().default({
    hasBalanceCheck: false,
    hasConvictionScoring: false,
    hasTierSystem: false,
    hasSocialLayer: false,
  }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    communityIdx: index('idx_incumbent_configs_community').on(table.communityId),
    providerIdx: index('idx_incumbent_configs_provider').on(table.provider),
    healthIdx: index('idx_incumbent_configs_health').on(table.healthStatus),
  })
);

/**
 * Detected role from incumbent bot
 */
export interface DetectedRole {
  id: string;
  name: string;
  memberCount: number;
  likelyTokenGated: boolean;
  confidence: number;
}

/**
 * Incumbent bot capabilities
 */
export interface IncumbentCapabilities {
  hasBalanceCheck: boolean;
  hasConvictionScoring: boolean;
  hasTierSystem: boolean;
  hasSocialLayer: boolean;
}

/**
 * Valid incumbent providers
 */
export type IncumbentProvider = 'collabland' | 'matrica' | 'guild.xyz' | 'other';

/**
 * Valid health statuses
 */
export type HealthStatus = 'healthy' | 'degraded' | 'offline' | 'unknown';

/**
 * Incumbent config relations
 */
export const incumbentConfigsRelations = relations(incumbentConfigs, ({ one }) => ({
  community: one(communities, {
    fields: [incumbentConfigs.communityId],
    references: [communities.id],
  }),
}));

export type IncumbentConfig = typeof incumbentConfigs.$inferSelect;
export type NewIncumbentConfig = typeof incumbentConfigs.$inferInsert;

// =============================================================================
// Migration States Table (Sprint 56 - Shadow Mode Foundation)
// =============================================================================

/**
 * Migration States - Tracks coexistence mode and migration progress
 *
 * State Machine: shadow -> parallel -> primary -> exclusive
 *
 * - SHADOW: Observe only, no Discord mutations, track divergences
 * - PARALLEL: Namespaced roles alongside incumbent (@arrakis-*)
 * - PRIMARY: Arrakis authoritative, incumbent as backup
 * - EXCLUSIVE: Full takeover, incumbent integration removed
 *
 * RLS Policy: community_id = current_setting('app.current_tenant')::UUID
 */
export const migrationStates = pgTable(
  'migration_states',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    communityId: uuid('community_id')
      .notNull()
      .references(() => communities.id, { onDelete: 'cascade' })
      .unique(),

    // Current state machine position
    currentMode: text('current_mode').notNull().default('shadow'), // CoexistenceMode enum
    targetMode: text('target_mode'), // For gradual migrations
    strategy: text('strategy'), // 'instant', 'gradual', 'parallel_forever', 'arrakis_primary'

    // Timestamps for each mode transition
    shadowStartedAt: timestamp('shadow_started_at', { withTimezone: true }),
    parallelEnabledAt: timestamp('parallel_enabled_at', { withTimezone: true }),
    primaryEnabledAt: timestamp('primary_enabled_at', { withTimezone: true }),
    exclusiveEnabledAt: timestamp('exclusive_enabled_at', { withTimezone: true }),

    // Rollback tracking
    rollbackCount: integer('rollback_count').notNull().default(0),
    lastRollbackAt: timestamp('last_rollback_at', { withTimezone: true }),
    lastRollbackReason: text('last_rollback_reason'),

    // Readiness metrics
    readinessCheckPassed: boolean('readiness_check_passed').notNull().default(false),
    accuracyPercent: integer('accuracy_percent'), // 0-10000 (stored as integer * 100 for 2 decimal precision)
    shadowDays: integer('shadow_days').notNull().default(0),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    communityIdx: index('idx_migration_states_community').on(table.communityId),
    modeIdx: index('idx_migration_states_mode').on(table.currentMode),
    strategyIdx: index('idx_migration_states_strategy').on(table.strategy),
  })
);

/**
 * Valid coexistence modes
 */
export type CoexistenceMode = 'shadow' | 'parallel' | 'primary' | 'exclusive';

/**
 * Valid migration strategies
 */
export type MigrationStrategy = 'instant' | 'gradual' | 'parallel_forever' | 'arrakis_primary';

/**
 * Migration state relations
 */
export const migrationStatesRelations = relations(migrationStates, ({ one }) => ({
  community: one(communities, {
    fields: [migrationStates.communityId],
    references: [communities.id],
  }),
}));

export type MigrationState = typeof migrationStates.$inferSelect;
export type NewMigrationState = typeof migrationStates.$inferInsert;

// =============================================================================
// Shadow Mode Tables (Sprint 57 - Shadow Ledger & Sync)
// =============================================================================

/**
 * Shadow Member States - Tracks incumbent vs Arrakis access comparison
 *
 * This table stores the "shadow ledger" - what access each member would have
 * under Arrakis vs what the incumbent bot actually provides. Zero Discord
 * mutations; purely observation data for accuracy measurement.
 *
 * RLS Policy: community_id = current_setting('app.current_tenant')::UUID
 */
export const shadowMemberStates = pgTable(
  'shadow_member_states',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    communityId: uuid('community_id')
      .notNull()
      .references(() => communities.id, { onDelete: 'cascade' }),
    memberId: text('member_id').notNull(), // Discord user ID

    // Incumbent state (what the incumbent bot gave them)
    incumbentRoles: jsonb('incumbent_roles').$type<string[]>().default([]),
    incumbentTier: integer('incumbent_tier'), // If incumbent uses tiers
    incumbentLastUpdate: timestamp('incumbent_last_update', { withTimezone: true }),

    // Arrakis prediction (what we would give them)
    arrakisRoles: jsonb('arrakis_roles').$type<string[]>().default([]),
    arrakisTier: integer('arrakis_tier'),
    arrakisConviction: integer('arrakis_conviction'), // 0-100
    arrakisLastCalculated: timestamp('arrakis_last_calculated', { withTimezone: true }),

    // Divergence tracking
    divergenceType: text('divergence_type'), // 'match', 'arrakis_higher', 'arrakis_lower', 'mismatch'
    divergenceReason: text('divergence_reason'), // Why the divergence occurred
    divergenceDetectedAt: timestamp('divergence_detected_at', { withTimezone: true }),

    // Metadata
    lastSyncAt: timestamp('last_sync_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    // Primary lookup: community + member
    communityMemberIdx: index('idx_shadow_member_states_community_member').on(
      table.communityId,
      table.memberId
    ),
    // Query by divergence type
    divergenceIdx: index('idx_shadow_member_states_divergence').on(table.divergenceType),
    // Query by last sync time
    syncIdx: index('idx_shadow_member_states_sync').on(table.lastSyncAt),
    // Unique constraint: one record per member per community
    uniqueMember: uniqueIndex('idx_shadow_member_states_unique').on(
      table.communityId,
      table.memberId
    ),
  })
);

/**
 * Valid divergence types for shadow comparison
 */
export type DivergenceType = 'match' | 'arrakis_higher' | 'arrakis_lower' | 'mismatch';

/**
 * Shadow member state relations
 */
export const shadowMemberStatesRelations = relations(shadowMemberStates, ({ one }) => ({
  community: one(communities, {
    fields: [shadowMemberStates.communityId],
    references: [communities.id],
  }),
}));

export type ShadowMemberState = typeof shadowMemberStates.$inferSelect;
export type NewShadowMemberState = typeof shadowMemberStates.$inferInsert;

/**
 * Shadow Divergences - Historical record of divergences for trending
 *
 * Each time a sync detects a divergence, it's logged here for historical
 * analysis. This enables accuracy trending over time and identifies
 * patterns in divergence types.
 *
 * RLS Policy: community_id = current_setting('app.current_tenant')::UUID
 */
export const shadowDivergences = pgTable(
  'shadow_divergences',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    communityId: uuid('community_id')
      .notNull()
      .references(() => communities.id, { onDelete: 'cascade' }),
    memberId: text('member_id').notNull(),

    // Divergence details
    divergenceType: text('divergence_type').notNull(), // DivergenceType
    incumbentState: jsonb('incumbent_state').$type<ShadowStateSnapshot>().notNull(),
    arrakisState: jsonb('arrakis_state').$type<ShadowStateSnapshot>().notNull(),
    reason: text('reason'),

    // When this divergence was detected
    detectedAt: timestamp('detected_at', { withTimezone: true }).notNull().defaultNow(),

    // Was this divergence resolved?
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolutionType: text('resolution_type'), // 'member_action', 'sync_corrected', 'manual'

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    communityIdx: index('idx_shadow_divergences_community').on(table.communityId),
    memberIdx: index('idx_shadow_divergences_member').on(table.memberId),
    typeIdx: index('idx_shadow_divergences_type').on(table.divergenceType),
    detectedIdx: index('idx_shadow_divergences_detected').on(table.detectedAt),
  })
);

/**
 * Snapshot of shadow state for historical comparison
 */
export interface ShadowStateSnapshot {
  roles: string[];
  tier: number | null;
  conviction?: number | null;
}

/**
 * Shadow divergence relations
 */
export const shadowDivergencesRelations = relations(shadowDivergences, ({ one }) => ({
  community: one(communities, {
    fields: [shadowDivergences.communityId],
    references: [communities.id],
  }),
}));

export type ShadowDivergence = typeof shadowDivergences.$inferSelect;
export type NewShadowDivergence = typeof shadowDivergences.$inferInsert;

/**
 * Shadow Predictions - Tracks prediction accuracy for validation
 *
 * When Arrakis predicts a member should have certain access, this table
 * tracks whether that prediction was accurate. Used to calculate
 * accuracy percentage for readiness assessment.
 *
 * RLS Policy: community_id = current_setting('app.current_tenant')::UUID
 */
export const shadowPredictions = pgTable(
  'shadow_predictions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    communityId: uuid('community_id')
      .notNull()
      .references(() => communities.id, { onDelete: 'cascade' }),
    memberId: text('member_id').notNull(),

    // What Arrakis predicted
    predictedRoles: jsonb('predicted_roles').$type<string[]>().notNull(),
    predictedTier: integer('predicted_tier'),
    predictedConviction: integer('predicted_conviction'),
    predictedAt: timestamp('predicted_at', { withTimezone: true }).notNull().defaultNow(),

    // What actually happened (validated against incumbent)
    actualRoles: jsonb('actual_roles').$type<string[]>(),
    actualTier: integer('actual_tier'),
    validatedAt: timestamp('validated_at', { withTimezone: true }),

    // Accuracy assessment
    accurate: boolean('accurate'), // null = not yet validated
    accuracyScore: integer('accuracy_score'), // 0-100 (percentage match)
    accuracyDetails: text('accuracy_details'), // Explanation of score

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    communityIdx: index('idx_shadow_predictions_community').on(table.communityId),
    memberIdx: index('idx_shadow_predictions_member').on(table.memberId),
    accurateIdx: index('idx_shadow_predictions_accurate').on(table.accurate),
    predictedAtIdx: index('idx_shadow_predictions_predicted_at').on(table.predictedAt),
  })
);

/**
 * Shadow prediction relations
 */
export const shadowPredictionsRelations = relations(shadowPredictions, ({ one }) => ({
  community: one(communities, {
    fields: [shadowPredictions.communityId],
    references: [communities.id],
  }),
}));

export type ShadowPrediction = typeof shadowPredictions.$inferSelect;
export type NewShadowPrediction = typeof shadowPredictions.$inferInsert;

// =============================================================================
// Parallel Mode Tables (Sprint 58 - Namespaced Role Management)
// =============================================================================

/**
 * Parallel Role Configuration - Namespaced role settings per community
 *
 * Stores configuration for Arrakis namespaced roles that coexist with
 * incumbent roles in parallel mode. All Arrakis roles are prefixed with
 * the namespace (default: @arrakis-*) and positioned below incumbent roles.
 *
 * RLS Policy: community_id = current_setting('app.current_tenant')::UUID
 */
export const parallelRoleConfigs = pgTable(
  'parallel_role_configs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    communityId: uuid('community_id')
      .notNull()
      .references(() => communities.id, { onDelete: 'cascade' })
      .unique(),

    // Namespace configuration
    namespace: text('namespace').notNull().default('@arrakis-'), // Role name prefix
    enabled: boolean('enabled').notNull().default(false),

    // Role positioning (relative to incumbent roles)
    positionStrategy: text('position_strategy').notNull().default('below_incumbent'), // 'below_incumbent', 'lowest', 'manual'

    // Tier-to-role mapping configuration
    tierRoleMapping: jsonb('tier_role_mapping').$type<TierRoleMapping[]>().default([]),

    // Custom role name overrides (community can customize while preserving namespace)
    customRoleNames: jsonb('custom_role_names').$type<Record<string, string>>().default({}),

    // Security: Arrakis roles should have NO permissions by default
    grantPermissions: boolean('grant_permissions').notNull().default(false), // CRITICAL: Keep false

    // Tracking
    setupCompletedAt: timestamp('setup_completed_at', { withTimezone: true }),
    lastSyncAt: timestamp('last_sync_at', { withTimezone: true }),
    totalRolesCreated: integer('total_roles_created').notNull().default(0),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    communityIdx: index('idx_parallel_role_configs_community').on(table.communityId),
    enabledIdx: index('idx_parallel_role_configs_enabled').on(table.enabled),
  })
);

/**
 * Tier to role mapping for parallel mode
 */
export interface TierRoleMapping {
  /** Tier number (1-N) */
  tier: number;
  /** Base role name (without namespace) */
  baseName: string;
  /** Hex color for the role */
  color: string;
  /** Minimum conviction for this tier */
  minConviction: number;
  /** Description shown in Discord */
  description?: string;
}

/**
 * Valid position strategies for parallel roles
 */
export type RolePositionStrategy = 'below_incumbent' | 'lowest' | 'manual';

/**
 * Parallel role config relations
 */
export const parallelRoleConfigsRelations = relations(parallelRoleConfigs, ({ one }) => ({
  community: one(communities, {
    fields: [parallelRoleConfigs.communityId],
    references: [communities.id],
  }),
}));

export type ParallelRoleConfig = typeof parallelRoleConfigs.$inferSelect;
export type NewParallelRoleConfig = typeof parallelRoleConfigs.$inferInsert;

/**
 * Parallel Roles - Tracks created Arrakis namespaced roles in Discord
 *
 * Each row represents an Arrakis role created in a guild during parallel mode.
 * These roles coexist with incumbent roles and are used for comparison.
 *
 * RLS Policy: community_id = current_setting('app.current_tenant')::UUID
 */
export const parallelRoles = pgTable(
  'parallel_roles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    communityId: uuid('community_id')
      .notNull()
      .references(() => communities.id, { onDelete: 'cascade' }),

    // Discord role information
    discordRoleId: text('discord_role_id').notNull(), // Discord snowflake
    roleName: text('role_name').notNull(), // Full name with namespace (e.g., @arrakis-tier-1)
    baseName: text('base_name').notNull(), // Name without namespace (e.g., tier-1)

    // Tier mapping
    tier: integer('tier').notNull(),
    minConviction: integer('min_conviction').notNull(),

    // Position tracking
    position: integer('position').notNull(), // Discord role position
    incumbentReferenceId: text('incumbent_reference_id'), // Role ID we're positioned relative to

    // Style
    color: text('color'), // Hex color
    mentionable: boolean('mentionable').notNull().default(false),
    hoist: boolean('hoist').notNull().default(false), // Display separately

    // Member count
    memberCount: integer('member_count').notNull().default(0),
    lastMemberCountUpdate: timestamp('last_member_count_update', { withTimezone: true }),

    // Lifecycle
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    communityIdx: index('idx_parallel_roles_community').on(table.communityId),
    discordRoleIdx: index('idx_parallel_roles_discord').on(table.discordRoleId),
    tierIdx: index('idx_parallel_roles_tier').on(table.communityId, table.tier),
    uniqueRole: uniqueIndex('idx_parallel_roles_unique').on(
      table.communityId,
      table.discordRoleId
    ),
  })
);

/**
 * Parallel role relations
 */
export const parallelRolesRelations = relations(parallelRoles, ({ one }) => ({
  community: one(communities, {
    fields: [parallelRoles.communityId],
    references: [communities.id],
  }),
}));

export type ParallelRole = typeof parallelRoles.$inferSelect;
export type NewParallelRole = typeof parallelRoles.$inferInsert;

/**
 * Parallel Member Assignments - Tracks which members have which Arrakis roles
 *
 * During parallel mode, we track which namespaced roles each member has.
 * This is separate from shadow mode tracking (which doesn't create roles).
 *
 * RLS Policy: community_id = current_setting('app.current_tenant')::UUID
 */
export const parallelMemberAssignments = pgTable(
  'parallel_member_assignments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    communityId: uuid('community_id')
      .notNull()
      .references(() => communities.id, { onDelete: 'cascade' }),
    memberId: text('member_id').notNull(), // Discord user ID

    // Current Arrakis assignment
    assignedTier: integer('assigned_tier'), // null = no tier assigned
    assignedRoleIds: jsonb('assigned_role_ids').$type<string[]>().default([]),
    currentConviction: integer('current_conviction'), // 0-100

    // Comparison with incumbent
    incumbentTier: integer('incumbent_tier'),
    incumbentRoleIds: jsonb('incumbent_role_ids').$type<string[]>().default([]),

    // Assignment lifecycle
    lastAssignmentAt: timestamp('last_assignment_at', { withTimezone: true }),
    lastSyncAt: timestamp('last_sync_at', { withTimezone: true }).notNull().defaultNow(),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    communityMemberIdx: index('idx_parallel_member_assignments_community_member').on(
      table.communityId,
      table.memberId
    ),
    tierIdx: index('idx_parallel_member_assignments_tier').on(table.assignedTier),
    uniqueMember: uniqueIndex('idx_parallel_member_assignments_unique').on(
      table.communityId,
      table.memberId
    ),
  })
);

/**
 * Parallel member assignment relations
 */
export const parallelMemberAssignmentsRelations = relations(
  parallelMemberAssignments,
  ({ one }) => ({
    community: one(communities, {
      fields: [parallelMemberAssignments.communityId],
      references: [communities.id],
    }),
  })
);

export type ParallelMemberAssignment = typeof parallelMemberAssignments.$inferSelect;
export type NewParallelMemberAssignment = typeof parallelMemberAssignments.$inferInsert;

// =============================================================================
// Parallel Channel Tables (Sprint 59 - Channels & Conviction Gates)
// =============================================================================

/**
 * Channel strategy options for parallel mode
 *
 * - `none`: No channels created (roles only)
 * - `additive_only`: Create conviction-gated channels only (no mirroring)
 * - `parallel_mirror`: Create Arrakis versions of incumbent channels
 * - `custom`: Admin-defined channel configuration
 */
export type ChannelStrategy = 'none' | 'additive_only' | 'parallel_mirror' | 'custom';

/**
 * Parallel Channel Configuration - Channel strategy and settings per community
 *
 * Stores configuration for Arrakis-managed channels that provide differentiated
 * value through conviction-gated access that incumbents cannot offer.
 *
 * RLS Policy: community_id = current_setting('app.current_tenant')::UUID
 */
export const parallelChannelConfigs = pgTable(
  'parallel_channel_configs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    communityId: uuid('community_id')
      .notNull()
      .references(() => communities.id, { onDelete: 'cascade' })
      .unique(),

    // Strategy configuration
    strategy: text('strategy').notNull().default('additive_only'), // ChannelStrategy
    enabled: boolean('enabled').notNull().default(false),

    // Category settings
    categoryName: text('category_name').notNull().default('Arrakis Channels'), // Parent category name
    categoryId: text('category_id'), // Discord category snowflake (once created)

    // Channel templates to create
    channelTemplates: jsonb('channel_templates').$type<ChannelTemplate[]>().default([]),

    // Custom channel definitions (for 'custom' strategy)
    customChannels: jsonb('custom_channels').$type<CustomChannelDefinition[]>().default([]),

    // Mirror configuration (for 'parallel_mirror' strategy)
    mirrorSourceChannels: jsonb('mirror_source_channels').$type<string[]>().default([]), // Channel IDs to mirror

    // Tracking
    setupCompletedAt: timestamp('setup_completed_at', { withTimezone: true }),
    lastSyncAt: timestamp('last_sync_at', { withTimezone: true }),
    totalChannelsCreated: integer('total_channels_created').notNull().default(0),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    communityIdx: index('idx_parallel_channel_configs_community').on(table.communityId),
    strategyIdx: index('idx_parallel_channel_configs_strategy').on(table.strategy),
    enabledIdx: index('idx_parallel_channel_configs_enabled').on(table.enabled),
  })
);

/**
 * Parallel channel template definition for additive channels
 * Named ParallelChannelTemplate to avoid conflict with IThemeProvider.ChannelTemplate
 */
export interface ParallelChannelTemplate {
  /** Unique template ID */
  templateId: string;
  /** Channel name (without prefix) */
  name: string;
  /** Channel topic/description */
  topic: string;
  /** Minimum conviction score required (0-100) */
  minConviction: number;
  /** Whether this is a default template */
  isDefault: boolean;
  /** Channel type: 'text' | 'voice' */
  type: 'text' | 'voice';
  /** Optional emoji for the channel name */
  emoji?: string;
}

/**
 * Alias for backward compatibility and internal use
 * @deprecated Use ParallelChannelTemplate directly
 */
export type ChannelTemplate = ParallelChannelTemplate;

/**
 * Custom channel definition (admin-defined)
 */
export interface CustomChannelDefinition {
  /** Channel name */
  name: string;
  /** Channel topic */
  topic: string;
  /** Minimum conviction required */
  minConviction: number;
  /** Channel type */
  type: 'text' | 'voice';
  /** Whether to grant @everyone view permission (private if false) */
  isPublicView: boolean;
  /** Optional role IDs that can always access (in addition to conviction) */
  additionalRoleIds?: string[];
}

/**
 * Parallel channel config relations
 */
export const parallelChannelConfigsRelations = relations(parallelChannelConfigs, ({ one }) => ({
  community: one(communities, {
    fields: [parallelChannelConfigs.communityId],
    references: [communities.id],
  }),
}));

export type ParallelChannelConfig = typeof parallelChannelConfigs.$inferSelect;
export type NewParallelChannelConfig = typeof parallelChannelConfigs.$inferInsert;

/**
 * Parallel Channels - Tracks created Arrakis channels in Discord
 *
 * Each row represents a channel created and managed by Arrakis during parallel mode.
 * These channels provide conviction-gated access that incumbents cannot offer.
 *
 * RLS Policy: community_id = current_setting('app.current_tenant')::UUID
 */
export const parallelChannels = pgTable(
  'parallel_channels',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    communityId: uuid('community_id')
      .notNull()
      .references(() => communities.id, { onDelete: 'cascade' }),

    // Discord channel information
    discordChannelId: text('discord_channel_id').notNull(), // Discord snowflake
    channelName: text('channel_name').notNull(),
    channelType: text('channel_type').notNull().default('text'), // 'text' | 'voice'

    // Category association
    categoryId: text('category_id'), // Discord category snowflake

    // Conviction gating
    minConviction: integer('min_conviction').notNull().default(0), // 0-100
    isConvictionGated: boolean('is_conviction_gated').notNull().default(true),

    // Source tracking (for mirrored channels)
    sourceType: text('source_type').notNull().default('additive'), // 'additive' | 'mirror' | 'custom'
    mirrorSourceChannelId: text('mirror_source_channel_id'), // Original channel ID if mirrored

    // Template reference
    templateId: text('template_id'), // Reference to ChannelTemplate.templateId

    // Member access tracking
    memberAccessCount: integer('member_access_count').notNull().default(0),
    lastAccessUpdate: timestamp('last_access_update', { withTimezone: true }),

    // Lifecycle
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    communityIdx: index('idx_parallel_channels_community').on(table.communityId),
    discordChannelIdx: index('idx_parallel_channels_discord').on(table.discordChannelId),
    convictionIdx: index('idx_parallel_channels_conviction').on(table.minConviction),
    uniqueChannel: uniqueIndex('idx_parallel_channels_unique').on(
      table.communityId,
      table.discordChannelId
    ),
  })
);

/**
 * Parallel channel relations
 */
export const parallelChannelsRelations = relations(parallelChannels, ({ one }) => ({
  community: one(communities, {
    fields: [parallelChannels.communityId],
    references: [communities.id],
  }),
}));

export type ParallelChannel = typeof parallelChannels.$inferSelect;
export type NewParallelChannel = typeof parallelChannels.$inferInsert;

/**
 * Parallel Channel Access - Tracks member access to conviction-gated channels
 *
 * Tracks which members have access to which conviction-gated channels.
 * Access is granted/revoked based on conviction score thresholds.
 *
 * RLS Policy: community_id = current_setting('app.current_tenant')::UUID
 */
export const parallelChannelAccess = pgTable(
  'parallel_channel_access',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    communityId: uuid('community_id')
      .notNull()
      .references(() => communities.id, { onDelete: 'cascade' }),
    memberId: text('member_id').notNull(), // Discord user ID
    channelId: text('channel_id').notNull(), // Discord channel snowflake

    // Access state
    hasAccess: boolean('has_access').notNull().default(false),
    convictionAtGrant: integer('conviction_at_grant'), // Conviction when access was granted

    // Tracking
    grantedAt: timestamp('granted_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    lastCheckAt: timestamp('last_check_at', { withTimezone: true }).notNull().defaultNow(),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    communityMemberIdx: index('idx_parallel_channel_access_community_member').on(
      table.communityId,
      table.memberId
    ),
    channelIdx: index('idx_parallel_channel_access_channel').on(table.channelId),
    accessIdx: index('idx_parallel_channel_access_has_access').on(table.hasAccess),
    uniqueAccess: uniqueIndex('idx_parallel_channel_access_unique').on(
      table.communityId,
      table.memberId,
      table.channelId
    ),
  })
);

/**
 * Parallel channel access relations
 */
export const parallelChannelAccessRelations = relations(parallelChannelAccess, ({ one }) => ({
  community: one(communities, {
    fields: [parallelChannelAccess.communityId],
    references: [communities.id],
  }),
}));

export type ParallelChannelAccess = typeof parallelChannelAccess.$inferSelect;
export type NewParallelChannelAccess = typeof parallelChannelAccess.$inferInsert;

// =============================================================================
// Incumbent Health Checks Table (Sprint 64 - Incumbent Health Monitoring)
// =============================================================================

/**
 * Incumbent Health Checks - Historical health check records
 *
 * Tracks health check results over time for trending and analysis.
 * Used by IncumbentHealthMonitor to store check results and alerts.
 *
 * RLS Policy: community_id = current_setting('app.current_tenant')::UUID
 */
export const incumbentHealthChecks = pgTable(
  'incumbent_health_checks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    communityId: uuid('community_id')
      .notNull()
      .references(() => communities.id, { onDelete: 'cascade' }),

    // Check results
    overallStatus: text('overall_status').notNull(), // HealthStatus: 'healthy' | 'degraded' | 'offline' | 'unknown'
    botOnlinePassed: boolean('bot_online_passed').notNull(),
    botOnlineMessage: text('bot_online_message'),
    roleUpdatePassed: boolean('role_update_passed').notNull(),
    roleUpdateMessage: text('role_update_message'),
    channelActivityPassed: boolean('channel_activity_passed').notNull(),
    channelActivityMessage: text('channel_activity_message'),

    // Alert tracking
    alertSent: boolean('alert_sent').notNull().default(false),
    alertThrottled: boolean('alert_throttled').notNull().default(false),
    alertSeverity: text('alert_severity'), // 'warning' | 'critical'

    // Timestamps
    checkedAt: timestamp('checked_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    communityIdx: index('idx_incumbent_health_checks_community').on(table.communityId),
    statusIdx: index('idx_incumbent_health_checks_status').on(table.overallStatus),
    checkedAtIdx: index('idx_incumbent_health_checks_checked').on(table.checkedAt),
    alertIdx: index('idx_incumbent_health_checks_alert').on(table.alertSent),
  })
);

/**
 * Incumbent health check relations
 */
export const incumbentHealthChecksRelations = relations(incumbentHealthChecks, ({ one }) => ({
  community: one(communities, {
    fields: [incumbentHealthChecks.communityId],
    references: [communities.id],
  }),
}));

export type IncumbentHealthCheck = typeof incumbentHealthChecks.$inferSelect;
export type NewIncumbentHealthCheck = typeof incumbentHealthChecks.$inferInsert;

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
    capabilities: jsonb('capabilities').$type<IncumbentCapabilities>().default({}),
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

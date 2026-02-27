/**
 * Drizzle Schema - PostgreSQL Database Schema
 *
 * Sprint S-19: Enhanced RLS & Drizzle Adapter
 *
 * Multi-tenant schema with Row-Level Security (RLS) support.
 * All tenant-scoped tables include community_id foreign key.
 *
 * Tables:
 * - communities: Tenant root table (theme, subscription)
 * - profiles: Member profiles with wallet, tier, activity
 * - badges: Earned badges with lineage support (awarded_by)
 *
 * @see SDD §6.3 PostgreSQL Multi-Tenant
 * @module packages/adapters/storage/schema
 */

import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  bigint,
  jsonb,
  unique,
  uniqueIndex,
  index,
  boolean,
  numeric,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

import type {
  CommunitySettings,
  ProfileMetadata,
  BadgeMetadata,
} from '@arrakis/core/ports';

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

// =============================================================================
// Drizzle Relations
// =============================================================================

/**
 * Community relations
 */
export const communitiesRelations = relations(communities, ({ many }) => ({
  profiles: many(profiles),
  badges: many(badges),
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

// =============================================================================
// Credit Lots Table (Cycle 037 — Proof of Economic Life)
// =============================================================================

/**
 * Credit Lots - Immutable funding event headers
 *
 * One row per funding event (purchase, grant, seed, x402 settlement).
 * NEVER updated or deleted. Lot balance computed via lot_balances view.
 * RLS Policy: community_id = app.current_community_id()
 *
 * @see SDD §4.2 Double-Entry Append-Only Ledger
 */
export const creditLots = pgTable(
  'credit_lots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    communityId: uuid('community_id').notNull(),
    source: text('source').notNull(),
    paymentId: text('payment_id'),
    amountMicro: bigint('amount_micro', { mode: 'bigint' }).notNull(),
    status: text('status').notNull().default('active'),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    communityIdx: index('idx_credit_lots_community').on(table.communityId, table.createdAt),
    paymentIdUnique: uniqueIndex('credit_lots_payment_id_uq')
      .on(table.paymentId),
  })
);

// =============================================================================
// Lot Entries Table
// =============================================================================

/**
 * Lot Entries - Immutable debit/credit journal
 *
 * Every economic event creates lot_entries rows.
 * entry_type: 'credit' | 'debit' | 'expiry' | 'credit_back'
 * RLS Policy: community_id = app.current_community_id()
 *
 * @see SDD §4.2 Double-Entry Append-Only Ledger
 */
export const lotEntries = pgTable(
  'lot_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    lotId: uuid('lot_id')
      .notNull()
      .references(() => creditLots.id),
    communityId: uuid('community_id').notNull(),
    entryType: text('entry_type').notNull(),
    amountMicro: bigint('amount_micro', { mode: 'bigint' }).notNull(),
    reservationId: text('reservation_id'),
    usageEventId: text('usage_event_id'),
    referenceId: text('reference_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    lotIdx: index('idx_lot_entries_lot').on(table.lotId, table.entryType),
    communityIdx: index('idx_lot_entries_community').on(table.communityId, table.createdAt),
  })
);

// =============================================================================
// Usage Events Table (PostgreSQL)
// =============================================================================

/**
 * Usage Events - Immutable per-request accounting ledger
 *
 * Append-only table. One row per budget finalization.
 * All monetary values are BIGINT micro-USD.
 * RLS Policy: community_id = app.current_community_id()
 *
 * @see SDD §3.4 Budget Finalization
 */
export const usageEvents = pgTable(
  'usage_events',
  {
    eventId: uuid('event_id').primaryKey().defaultRandom(),
    communityId: uuid('community_id').notNull(),
    nftId: text('nft_id').notNull(),
    poolId: text('pool_id').notNull(),
    tokensInput: integer('tokens_input').notNull().default(0),
    tokensOutput: integer('tokens_output').notNull().default(0),
    amountMicro: bigint('amount_micro', { mode: 'bigint' }).notNull().default(BigInt(0)),
    reservationId: text('reservation_id'),
    finalizationId: text('finalization_id').unique(),
    fenceToken: bigint('fence_token', { mode: 'bigint' }),
    conservationGuardResult: boolean('conservation_guard_result'),
    conservationGuardViolations: jsonb('conservation_guard_violations'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    communityIdx: index('idx_usage_events_pg_community_created').on(table.communityId, table.createdAt),
    nftIdx: index('idx_usage_events_pg_nft').on(table.nftId, table.createdAt),
    poolIdx: index('idx_usage_events_pg_pool').on(table.poolId, table.createdAt),
  })
);

// =============================================================================
// Webhook Events Table
// =============================================================================

/**
 * Webhook Events - Idempotent dedup for inbound webhooks
 *
 * UNIQUE(provider, event_id) for generic dedup across providers.
 * Append-only. Not tenant-scoped (webhooks arrive without context).
 *
 * @see SDD §4.4 Webhook Processing
 */
export const webhookEvents = pgTable(
  'webhook_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    provider: text('provider').notNull(),
    eventId: text('event_id').notNull(),
    payload: jsonb('payload').notNull().default({}),
    processedAt: timestamp('processed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    providerEventUnique: unique('webhook_events_provider_event_uq').on(table.provider, table.eventId),
    providerIdx: index('idx_webhook_events_provider').on(table.provider, table.processedAt),
  })
);

// =============================================================================
// Crypto Payments Table
// =============================================================================

/**
 * Crypto Payments - Outbound payment state machine
 *
 * Tracks lifecycle: waiting → confirming → finished (or expired/failed).
 * Status monotonicity enforced by DB trigger.
 * RLS Policy: community_id = app.current_community_id()
 *
 * @see SDD §4.4.1 Reconciliation
 */
export const cryptoPayments = pgTable(
  'crypto_payments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    communityId: uuid('community_id').notNull(),
    paymentId: text('payment_id').unique(),
    provider: text('provider').notNull().default('nowpayments'),
    amountUsd: numeric('amount_usd', { precision: 12, scale: 2 }).notNull(),
    amountCrypto: numeric('amount_crypto', { precision: 24, scale: 8 }),
    currency: text('currency').notNull().default('USDT'),
    status: text('status').notNull().default('waiting'),
    statusRank: integer('status_rank').notNull().default(0),
    checkoutUrl: text('checkout_url'),
    creditsMintedAt: timestamp('credits_minted_at', { withTimezone: true }),
    creditsMintLotId: uuid('credits_mint_lot_id'),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    communityIdx: index('idx_crypto_payments_community').on(table.communityId, table.createdAt),
  })
);

// =============================================================================
// Reconciliation Cursor Table
// =============================================================================

/**
 * Reconciliation Cursor - Persistent cursor for event processing
 *
 * Replaces time-window reconciliation with cursor-based approach.
 * Each community tracks last_processed_event_id.
 *
 * @see Flatline SKP-002: Cursor-based reconciliation
 */
export const reconciliationCursor = pgTable(
  'reconciliation_cursor',
  {
    communityId: uuid('community_id').primaryKey(),
    lastProcessedEventId: uuid('last_processed_event_id'),
    lastFenceToken: bigint('last_fence_token', { mode: 'bigint' }).notNull().default(BigInt(0)),
    lastReconciledAt: timestamp('last_reconciled_at', { withTimezone: true }).notNull().defaultNow(),
    driftMicro: bigint('drift_micro', { mode: 'bigint' }).notNull().default(BigInt(0)),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  }
);

// =============================================================================
// S2S JWKS Public Keys Table
// =============================================================================

/**
 * S2S JWKS Public Keys - ES256 key storage for S2S JWT
 *
 * Stores public keys for inter-service JWT verification.
 * Used by JWKS endpoint (/.well-known/jwks.json).
 */
export const s2sJwksPublicKeys = pgTable(
  's2s_jwks_public_keys',
  {
    kid: text('kid').primaryKey(),
    kty: text('kty').notNull().default('EC'),
    crv: text('crv').notNull().default('P-256'),
    x: text('x').notNull(),
    y: text('y').notNull(),
    issuer: text('issuer').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  }
);

// =============================================================================
// Economic Relations
// =============================================================================

export const creditLotsRelations = relations(creditLots, ({ many }) => ({
  entries: many(lotEntries),
}));

export const lotEntriesRelations = relations(lotEntries, ({ one }) => ({
  lot: one(creditLots, {
    fields: [lotEntries.lotId],
    references: [creditLots.id],
  }),
}));

// =============================================================================
// Type Exports
// =============================================================================

/**
 * Inferred community type from Drizzle schema
 */
export type DrizzleCommunity = typeof communities.$inferSelect;
export type DrizzleNewCommunity = typeof communities.$inferInsert;

/**
 * Inferred profile type from Drizzle schema
 */
export type DrizzleProfile = typeof profiles.$inferSelect;
export type DrizzleNewProfile = typeof profiles.$inferInsert;

/**
 * Inferred badge type from Drizzle schema
 */
export type DrizzleBadge = typeof badges.$inferSelect;
export type DrizzleNewBadge = typeof badges.$inferInsert;

/**
 * Inferred credit lot types
 */
export type DrizzleCreditLot = typeof creditLots.$inferSelect;
export type DrizzleNewCreditLot = typeof creditLots.$inferInsert;

/**
 * Inferred lot entry types
 */
export type DrizzleLotEntry = typeof lotEntries.$inferSelect;
export type DrizzleNewLotEntry = typeof lotEntries.$inferInsert;

/**
 * Inferred usage event types
 */
export type DrizzleUsageEvent = typeof usageEvents.$inferSelect;
export type DrizzleNewUsageEvent = typeof usageEvents.$inferInsert;

/**
 * Inferred webhook event types
 */
export type DrizzleWebhookEvent = typeof webhookEvents.$inferSelect;
export type DrizzleNewWebhookEvent = typeof webhookEvents.$inferInsert;

/**
 * Inferred crypto payment types
 */
export type DrizzleCryptoPayment = typeof cryptoPayments.$inferSelect;
export type DrizzleNewCryptoPayment = typeof cryptoPayments.$inferInsert;

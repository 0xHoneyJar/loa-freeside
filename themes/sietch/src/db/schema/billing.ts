/**
 * Drizzle ORM Schema: Billing & Credit Ledger Tables
 *
 * Maps to SQLite tables created by migration 030_credit_ledger.
 * All monetary columns use integer({ mode: 'bigint' }) for BigInt precision.
 *
 * SDD refs: §3.5 Drizzle Schema Definitions
 * Sprint refs: Task 1.2
 */

import { sqliteTable, text, integer, uniqueIndex, index } from 'drizzle-orm/sqlite-core';

/**
 * Helper: all monetary columns use integer({ mode: 'bigint' }) which:
 * - Stores as SQLite INTEGER (int64 affinity, matching the DDL)
 * - Deserializes to TypeScript bigint (not JS number)
 * Requires drizzle-orm >= 0.30.0 (current: 0.45.1).
 */
const microUSD = (name: string) => integer(name, { mode: 'bigint' });

// =============================================================================
// credit_accounts
// =============================================================================

export const creditAccounts = sqliteTable('credit_accounts', {
  id: text('id').primaryKey(),
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id').notNull(),
  version: integer('version').notNull().default(0),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => ({
  entityUnique: uniqueIndex('idx_credit_accounts_entity')
    .on(table.entityType, table.entityId),
}));

// =============================================================================
// credit_lots
// =============================================================================

export const creditLots = sqliteTable('credit_lots', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull().references(() => creditAccounts.id),
  poolId: text('pool_id'),
  sourceType: text('source_type').notNull(),
  sourceId: text('source_id'),
  originalMicro: microUSD('original_micro').notNull(),
  availableMicro: microUSD('available_micro').notNull().default(0n),
  reservedMicro: microUSD('reserved_micro').notNull().default(0n),
  consumedMicro: microUSD('consumed_micro').notNull().default(0n),
  expiresAt: text('expires_at'),
  createdAt: text('created_at').notNull(),
}, (table) => ({
  redemptionIdx: index('idx_credit_lots_redemption')
    .on(table.accountId, table.poolId, table.expiresAt),
  // NOTE: The partial unique index (WHERE source_id IS NOT NULL) for deposit
  // idempotency CANNOT be expressed in Drizzle's index API. It is created via
  // raw SQL in migration 030. The Drizzle schema omits it intentionally to
  // avoid creating a non-partial unique index that would over-constrain NULLs.
  // See migration 030 DDL: CREATE UNIQUE INDEX idx_credit_lots_source
  //   ON credit_lots(source_type, source_id) WHERE source_id IS NOT NULL;
}));

// =============================================================================
// credit_balances
// =============================================================================

export const creditBalances = sqliteTable('credit_balances', {
  accountId: text('account_id').notNull().references(() => creditAccounts.id),
  poolId: text('pool_id'),
  availableMicro: microUSD('available_micro').notNull().default(0n),
  reservedMicro: microUSD('reserved_micro').notNull().default(0n),
  updatedAt: text('updated_at').notNull(),
}, (table) => ({
  pk: uniqueIndex('credit_balances_pk')
    .on(table.accountId, table.poolId),
}));

// =============================================================================
// credit_account_seq
// =============================================================================

export const creditAccountSeq = sqliteTable('credit_account_seq', {
  accountId: text('account_id').notNull().references(() => creditAccounts.id),
  poolId: text('pool_id').notNull().default('__all__'),
  nextSeq: integer('next_seq').notNull().default(1),
}, (table) => ({
  pk: uniqueIndex('credit_account_seq_pk')
    .on(table.accountId, table.poolId),
}));

// =============================================================================
// credit_ledger
// =============================================================================

export const creditLedger = sqliteTable('credit_ledger', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull().references(() => creditAccounts.id),
  poolId: text('pool_id'),
  lotId: text('lot_id').references(() => creditLots.id),
  reservationId: text('reservation_id'),
  entrySeq: integer('entry_seq').notNull(),
  entryType: text('entry_type').notNull(),
  amountMicro: microUSD('amount_micro').notNull(),
  idempotencyKey: text('idempotency_key').unique(),
  description: text('description'),
  metadata: text('metadata'),
  createdAt: text('created_at').notNull(),
}, (table) => ({
  seqUnique: uniqueIndex('idx_credit_ledger_seq')
    .on(table.accountId, table.poolId, table.entrySeq),
  accountIdx: index('idx_credit_ledger_account')
    .on(table.accountId, table.createdAt),
  reservationIdx: index('idx_credit_ledger_reservation')
    .on(table.reservationId),
}));

// =============================================================================
// credit_reservations
// =============================================================================

export const creditReservations = sqliteTable('credit_reservations', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull().references(() => creditAccounts.id),
  poolId: text('pool_id'),
  totalReservedMicro: microUSD('total_reserved_micro').notNull(),
  status: text('status').notNull().default('pending'),
  billingMode: text('billing_mode').notNull().default('live'),
  expiresAt: text('expires_at').notNull(),
  createdAt: text('created_at').notNull(),
  finalizedAt: text('finalized_at'),
  idempotencyKey: text('idempotency_key').unique(),
}, (table) => ({
  // NOTE: The partial index (WHERE status = 'pending') for sweeper performance
  // CANNOT be expressed in Drizzle's SQLite index API. It is created via raw SQL
  // in migration 030. See DDL: CREATE INDEX idx_credit_reservations_expiry
  //   ON credit_reservations(expires_at) WHERE status = 'pending';
  accountIdx: index('idx_credit_reservations_account')
    .on(table.accountId, table.createdAt),
}));

// =============================================================================
// reservation_lots
// =============================================================================

export const reservationLots = sqliteTable('reservation_lots', {
  reservationId: text('reservation_id').notNull()
    .references(() => creditReservations.id),
  lotId: text('lot_id').notNull().references(() => creditLots.id),
  reservedMicro: microUSD('reserved_micro').notNull(),
  createdAt: text('created_at').notNull(),
}, (table) => ({
  pk: uniqueIndex('reservation_lots_pk')
    .on(table.reservationId, table.lotId),
}));

// =============================================================================
// credit_debts
// =============================================================================

export const creditDebts = sqliteTable('credit_debts', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull().references(() => creditAccounts.id),
  poolId: text('pool_id'),
  debtMicro: microUSD('debt_micro').notNull(),
  sourcePaymentId: text('source_payment_id'),
  sourceLotId: text('source_lot_id').references(() => creditLots.id),
  createdAt: text('created_at').notNull(),
  resolvedAt: text('resolved_at'),
}, (table) => ({
  accountIdx: index('idx_credit_debts_account')
    .on(table.accountId),
}));

// =============================================================================
// billing_idempotency_keys
// =============================================================================

export const billingIdempotencyKeys = sqliteTable('billing_idempotency_keys', {
  scope: text('scope').notNull(),
  idempotencyKey: text('idempotency_key').notNull(),
  responseHash: text('response_hash'),
  createdAt: text('created_at').notNull(),
  expiresAt: text('expires_at').notNull(),
}, (table) => ({
  pk: uniqueIndex('billing_idempotency_keys_pk')
    .on(table.scope, table.idempotencyKey),
}));

/**
 * Drizzle Schema - Sandbox Database Schema
 *
 * Sprint 84: Discord Server Sandboxes - Foundation
 *
 * Defines the control plane tables for sandbox management.
 * Stored in public schema (not in individual sandbox schemas).
 *
 * @see SDD §5.1 Database Schema
 * @module packages/sandbox/schema
 */

import {
  pgTable,
  pgEnum,
  uuid,
  timestamp,
  varchar,
  jsonb,
  index,
  unique,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';

import type { SandboxMetadata, AuditEventType } from './types.js';

// =============================================================================
// Enums
// =============================================================================

/**
 * Sandbox status enum
 *
 * Matches the sandbox_status PostgreSQL enum type.
 */
export const sandboxStatusEnum = pgEnum('sandbox_status', [
  'pending',
  'creating',
  'running',
  'expired',
  'destroying',
  'destroyed',
]);

// =============================================================================
// Sandboxes Table
// =============================================================================

/**
 * Sandboxes - Control plane table for sandbox metadata
 *
 * Stored in the public schema (not in individual sandbox schemas).
 * No RLS - accessible by management service for admin operations.
 */
export const sandboxes = pgTable(
  'sandboxes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 64 }).notNull(),
    owner: varchar('owner', { length: 64 }).notNull(),
    status: sandboxStatusEnum('status').notNull().default('pending'),
    schemaName: varchar('schema_name', { length: 64 }).notNull(),
    discordTokenId: uuid('discord_token_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    destroyedAt: timestamp('destroyed_at', { withTimezone: true }),
    lastActivityAt: timestamp('last_activity_at', { withTimezone: true }),
    metadata: jsonb('metadata').$type<SandboxMetadata>().notNull().default({}),
  },
  (table) => ({
    nameUnique: unique('sandboxes_name_unique').on(table.name),
    schemaNameUnique: unique('sandboxes_schema_name_unique').on(table.schemaName),
    statusIdx: index('idx_sandboxes_status').on(table.status),
    ownerIdx: index('idx_sandboxes_owner').on(table.owner),
    expiresIdx: index('idx_sandboxes_expires').on(table.expiresAt).where(sql`status = 'running'`),
    createdIdx: index('idx_sandboxes_created').on(table.createdAt),
  })
);

// =============================================================================
// Sandbox Guild Mapping Table
// =============================================================================

/**
 * Sandbox Guild Mapping - Routes Discord events to sandboxes
 *
 * One guild can only be mapped to one sandbox at a time.
 * Supports CASCADE delete when sandbox is destroyed.
 */
export const sandboxGuildMapping = pgTable(
  'sandbox_guild_mapping',
  {
    guildId: varchar('guild_id', { length: 20 }).primaryKey(),
    sandboxId: uuid('sandbox_id')
      .notNull()
      .references(() => sandboxes.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    sandboxIdx: index('idx_sandbox_guild_mapping_sandbox').on(table.sandboxId),
  })
);

// =============================================================================
// Sandbox Audit Log Table
// =============================================================================

/**
 * Sandbox Audit Log - Tracks sandbox lifecycle events
 */
export const sandboxAuditLog = pgTable(
  'sandbox_audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sandboxId: uuid('sandbox_id')
      .notNull()
      .references(() => sandboxes.id, { onDelete: 'cascade' }),
    eventType: varchar('event_type', { length: 32 }).$type<AuditEventType>().notNull(),
    actor: varchar('actor', { length: 64 }).notNull(),
    details: jsonb('details').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    sandboxTimeIdx: index('idx_sandbox_audit_log_sandbox_time').on(table.sandboxId, table.createdAt),
    typeIdx: index('idx_sandbox_audit_log_type').on(table.eventType),
  })
);

// =============================================================================
// Drizzle Relations
// =============================================================================

/**
 * Sandbox relations
 */
export const sandboxesRelations = relations(sandboxes, ({ many }) => ({
  guildMappings: many(sandboxGuildMapping),
  auditLogs: many(sandboxAuditLog),
}));

/**
 * Guild mapping relations
 */
export const sandboxGuildMappingRelations = relations(sandboxGuildMapping, ({ one }) => ({
  sandbox: one(sandboxes, {
    fields: [sandboxGuildMapping.sandboxId],
    references: [sandboxes.id],
  }),
}));

/**
 * Audit log relations
 */
export const sandboxAuditLogRelations = relations(sandboxAuditLog, ({ one }) => ({
  sandbox: one(sandboxes, {
    fields: [sandboxAuditLog.sandboxId],
    references: [sandboxes.id],
  }),
}));

// =============================================================================
// Type Exports
// =============================================================================

/**
 * Inferred sandbox type from Drizzle schema
 */
export type DrizzleSandbox = typeof sandboxes.$inferSelect;
export type DrizzleNewSandbox = typeof sandboxes.$inferInsert;

/**
 * Inferred guild mapping type from Drizzle schema
 */
export type DrizzleGuildMapping = typeof sandboxGuildMapping.$inferSelect;
export type DrizzleNewGuildMapping = typeof sandboxGuildMapping.$inferInsert;

/**
 * Inferred audit log type from Drizzle schema
 */
export type DrizzleAuditLog = typeof sandboxAuditLog.$inferSelect;
export type DrizzleNewAuditLog = typeof sandboxAuditLog.$inferInsert;

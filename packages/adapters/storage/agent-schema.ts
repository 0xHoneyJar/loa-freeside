/**
 * Agent Gateway Database Schema
 * Sprint S3-T6: community_agent_config + agent_usage_log tables
 *
 * Two tables for the agent gateway:
 * - community_agent_config: Per-community AI settings (budget, tier overrides)
 * - agent_usage_log: Audit trail of all finalized agent requests
 *
 * @see SDD §5.2, §5.3 PostgreSQL Schema
 */

import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  jsonb,
  boolean,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { communities } from './schema.js';

// =============================================================================
// Community Agent Config
// =============================================================================

/**
 * Per-community AI agent configuration.
 * Primary source of truth for budget limits and tier overrides.
 *
 * RLS Policy: community_id = current_setting('app.community_id')::UUID
 */
export const communityAgentConfig = pgTable(
  'community_agent_config',
  {
    communityId: uuid('community_id')
      .primaryKey()
      .references(() => communities.id),
    aiEnabled: boolean('ai_enabled').notNull().default(false),
    monthlyBudgetCents: integer('monthly_budget_cents').notNull().default(100),
    tierOverrides: jsonb('tier_overrides').$type<Record<string, unknown> | null>().default(null),
    pricingOverrides: jsonb('pricing_overrides').$type<Record<string, unknown> | null>().default(null),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
);

// =============================================================================
// Agent Usage Log
// =============================================================================

/**
 * Audit trail for all finalized agent requests.
 * NOT enforcement — Redis counters are the source of truth for budget enforcement.
 *
 * Sources: 'finalize' | 'reconciliation' | 'late_finalize'
 * Idempotent inserts via unique index on (community_id, user_wallet, idempotency_key).
 */
export const agentUsageLog = pgTable(
  'agent_usage_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    communityId: uuid('community_id')
      .notNull()
      .references(() => communities.id),
    userWallet: text('user_wallet').notNull(),
    modelAlias: text('model_alias').notNull(),
    promptTokens: integer('prompt_tokens').notNull(),
    completionTokens: integer('completion_tokens').notNull(),
    costCents: integer('cost_cents').notNull(),
    estimatedCostCents: integer('estimated_cost_cents').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    traceId: text('trace_id').notNull(),
    source: text('source').notNull().default('finalize'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    idempotencyIdx: uniqueIndex('idx_agent_usage_idempotency')
      .on(table.communityId, table.userWallet, table.idempotencyKey),
    communityMonthIdx: index('idx_agent_usage_community_month')
      .on(table.communityId, table.createdAt),
  }),
);

# Software Design Document: Discord Server Sandboxes

**Version**: 1.0
**Date**: January 17, 2026
**Status**: DRAFT - Pending Approval
**Feature Branch**: `feature/discord-server-sandboxes`
**PRD Reference**: `grimoires/loa/discord-server-sandboxes-prd.md` v1.0

---

## Document Traceability

| Section | Source | Implementation Path |
|---------|--------|---------------------|
| Database Schema | PRD §4.2 | `packages/adapters/storage/schema.ts` |
| NATS Integration | PRD §4.5 | `apps/worker/src/services/NatsClient.ts` |
| Redis Isolation | PRD §4.3 | `apps/worker/src/services/StateManager.ts` |
| TenantContext | Existing codebase | `packages/adapters/storage/tenant-context.ts` |
| CLI Commands | PRD §3.1, §12.A | `packages/cli/src/commands/sandbox/` |

---

## 1. Executive Summary

### 1.1 Overview

This SDD specifies the technical implementation for Discord Server Sandboxes, a developer tooling feature enabling isolated testing environments for the Arrakis Discord bot. The design leverages existing multi-tenant infrastructure (RLS, TenantContext, NATS JetStream) to provide zero-config sandbox creation with complete data isolation.

### 1.2 Design Goals

| Goal | Approach |
|------|----------|
| **Zero-config creation** | Auto-generated names, shared Discord token, convention over configuration |
| **Complete isolation** | PostgreSQL schema-per-sandbox, Redis key prefix, NATS subject namespace |
| **Minimal latency overhead** | Redis-cached guild-to-sandbox mapping, in-memory routing tables |
| **Simple teardown** | Idempotent cleanup with cascading deletes |
| **Extensibility** | Prepare for future REST API and dedicated token support |

### 1.3 Key Decisions

| Decision | Rationale |
|----------|-----------|
| Schema-per-sandbox (not RLS-only) | Complete isolation, easier cleanup, avoids complex RLS policy changes |
| Shared Discord token | Simplifies setup, guild-based routing sufficient for internal testing |
| CLI-first (bd sandbox) | Integrates with existing `bd` CLI pattern, developer-friendly |
| NATS subject namespacing | Leverages existing JetStream infrastructure, no RabbitMQ changes needed |
| Redis key prefixing | Simple, proven pattern from existing StateManager |

---

## 2. System Architecture

### 2.1 High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           CLI / API Layer                                    │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐             │
│  │  bd sandbox     │  │  bd sandbox     │  │  bd sandbox     │             │
│  │  create         │  │  list/status    │  │  destroy        │             │
│  └────────┬────────┘  └────────┬────────┘  └────────┬────────┘             │
└───────────┼────────────────────┼────────────────────┼───────────────────────┘
            │                    │                    │
            ▼                    ▼                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                        Sandbox Service Layer                                 │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                      SandboxManager                                    │  │
│  │  - createSandbox()     - listSandboxes()     - destroySandbox()      │  │
│  │  - getSandboxStatus()  - registerGuild()     - unregisterGuild()     │  │
│  │  - getConnectionDetails()                                             │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                              │                                              │
│         ┌────────────────────┼────────────────────┐                        │
│         ▼                    ▼                    ▼                        │
│  ┌─────────────┐     ┌─────────────┐     ┌─────────────┐                  │
│  │ SchemaProvi-│     │ RouteProvid-│     │ CleanupProvi│                  │
│  │ sioner      │     │ er          │     │ der         │                  │
│  └─────────────┘     └─────────────┘     └─────────────┘                  │
└─────────────────────────────────────────────────────────────────────────────┘
            │                    │                    │
            ▼                    ▼                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                        Infrastructure Layer                                  │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐       │
│  │ PostgreSQL  │  │ Redis       │  │ NATS        │  │ RabbitMQ    │       │
│  │ (RDS)       │  │ (ElastiCa-  │  │ JetStream   │  │ (Amazon MQ) │       │
│  │             │  │  che)       │  │             │  │             │       │
│  │ - Schema    │  │ - Key prefix│  │ - Subject   │  │ - Exchange  │       │
│  │   per-sbox  │  │   namespace │  │   namespace │  │   per-sbox  │       │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘       │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 2.2 Event Routing Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       Discord Gateway (Rust Twilight)                        │
│                       Receives all Discord events                            │
└────────────────────────────────┬────────────────────────────────────────────┘
                                 │
                                 ▼ NATS: events.raw.{event_type}
┌─────────────────────────────────────────────────────────────────────────────┐
│                          Event Router Service                                │
│  ┌────────────────────────────────────────────────────────────────────┐    │
│  │  1. Extract guild_id from event                                     │    │
│  │  2. Lookup sandbox_id in Redis cache (guild_sandbox_mapping:{gid}) │    │
│  │  3. If miss: query PostgreSQL sandbox_guild_mapping table          │    │
│  │  4. Route to appropriate NATS subject                               │    │
│  └────────────────────────────────────────────────────────────────────┘    │
│                                 │                                           │
│         ┌───────────────────────┴───────────────────────┐                  │
│         │ sandbox_id found                    │ no sandbox_id              │
│         ▼                                     ▼                            │
│  sandbox.{id}.events.{type}           events.{type}                        │
│  (to sandbox worker)                  (to production worker)               │
└─────────────────────────────────────────────────────────────────────────────┘
                                 │
        ┌────────────────────────┼────────────────────────┐
        ▼                        ▼                        ▼
┌───────────────┐        ┌───────────────┐        ┌───────────────┐
│ Sandbox A     │        │ Sandbox B     │        │ Production    │
│ Worker        │        │ Worker        │        │ Worker        │
│ ───────────── │        │ ───────────── │        │ ───────────── │
│ Schema: sb_a  │        │ Schema: sb_b  │        │ Schema: public│
│ Redis: sb:a:* │        │ Redis: sb:b:* │        │ Redis: prod:* │
│ NATS: sb.a.*  │        │ NATS: sb.b.*  │        │ NATS: events.*│
└───────────────┘        └───────────────┘        └───────────────┘
```

### 2.3 Component Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              packages/sandbox/                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐             │
│  │ SandboxManager  │  │ SchemaProvisio- │  │ RouteProvider   │             │
│  │                 │  │ ner             │  │                 │             │
│  │ - Core CRUD     │  │                 │  │ - Guild mapping │             │
│  │ - Lifecycle     │  │ - Create schema │  │ - Cache sync    │             │
│  │ - Status checks │  │ - Run migrations│  │ - Event routing │             │
│  └────────┬────────┘  │ - Drop schema   │  └────────┬────────┘             │
│           │           └────────┬────────┘           │                      │
│           │                    │                    │                      │
│           └────────────────────┼────────────────────┘                      │
│                                │                                            │
│                                ▼                                            │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                        SandboxContext                                │   │
│  │  - Wraps database operations with schema context                    │   │
│  │  - Wraps Redis operations with key prefix                          │   │
│  │  - Wraps NATS operations with subject prefix                       │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐             │
│  │ CleanupProvider │  │ HealthChecker   │  │ MetricsCollector│             │
│  │                 │  │                 │  │                 │             │
│  │ - TTL expiry    │  │ - Schema status │  │ - Active count  │             │
│  │ - Resource drop │  │ - Redis health  │  │ - Resource usage│             │
│  │ - Idempotent    │  │ - NATS health   │  │ - Error rates   │             │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘             │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Technology Stack

### 3.1 Core Technologies

| Component | Technology | Justification |
|-----------|------------|---------------|
| Database | PostgreSQL (RDS) | Existing infrastructure, schema isolation support |
| Cache | Redis (ElastiCache) | Existing infrastructure, key prefix namespacing |
| Messaging | NATS JetStream | Existing infrastructure, subject wildcards |
| CLI | TypeScript + Commander | Consistent with existing `bd` CLI |
| ORM | Drizzle | Existing infrastructure, migration support |

### 3.2 New Dependencies

| Package | Purpose | Version |
|---------|---------|---------|
| `nanoid` | Short sandbox ID generation | ^5.0.0 |
| `ms` | Human-readable TTL parsing | ^2.1.3 |
| `ora` | CLI spinner for async operations | ^7.0.1 |
| `cli-table3` | Formatted CLI table output | ^0.6.3 |

---

## 4. Component Design

### 4.1 SandboxManager

**Location**: `packages/sandbox/src/SandboxManager.ts`

```typescript
/**
 * SandboxManager - Core sandbox lifecycle management
 *
 * Responsibilities:
 * - Create/destroy sandbox environments
 * - Manage sandbox metadata in control plane
 * - Coordinate with provisioners for resource isolation
 */
export class SandboxManager {
  constructor(
    private readonly db: PostgresJsDatabase,
    private readonly redis: StateManager,
    private readonly nats: NatsClient,
    private readonly logger: Logger
  ) {}

  /**
   * Create a new sandbox environment
   *
   * @param options Sandbox creation options
   * @returns Created sandbox with connection details
   */
  async create(options: CreateSandboxOptions): Promise<Sandbox>;

  /**
   * List all sandboxes (optionally filtered)
   */
  async list(filter?: SandboxFilter): Promise<Sandbox[]>;

  /**
   * Get sandbox by ID
   */
  async get(sandboxId: string): Promise<Sandbox | null>;

  /**
   * Get sandbox status with health checks
   */
  async getStatus(sandboxId: string): Promise<SandboxStatus>;

  /**
   * Destroy a sandbox and cleanup all resources
   */
  async destroy(sandboxId: string): Promise<void>;

  /**
   * Register a guild to route events to sandbox
   */
  async registerGuild(sandboxId: string, guildId: string): Promise<void>;

  /**
   * Unregister a guild from sandbox
   */
  async unregisterGuild(guildId: string): Promise<void>;

  /**
   * Get connection details for sandbox
   */
  async getConnectionDetails(sandboxId: string): Promise<SandboxConnectionDetails>;

  /**
   * Cleanup expired sandboxes (called by cron job)
   */
  async cleanupExpired(): Promise<number>;
}
```

### 4.2 SchemaProvisioner

**Location**: `packages/sandbox/src/SchemaProvisioner.ts`

```typescript
/**
 * SchemaProvisioner - PostgreSQL schema lifecycle management
 *
 * Creates and destroys PostgreSQL schemas for sandbox isolation.
 * Each sandbox gets its own schema with copies of tenant-scoped tables.
 */
export class SchemaProvisioner {
  constructor(
    private readonly db: PostgresJsDatabase,
    private readonly logger: Logger
  ) {}

  /**
   * Create a new schema for sandbox
   *
   * Steps:
   * 1. CREATE SCHEMA sandbox_{id}
   * 2. SET search_path TO sandbox_{id}, public
   * 3. Run Drizzle migrations for tenant tables
   * 4. Grant permissions to app role
   */
  async createSchema(sandboxId: string): Promise<void>;

  /**
   * Drop schema and all contained objects
   *
   * Uses CASCADE to remove all dependent objects.
   * Idempotent - safe to call multiple times.
   */
  async dropSchema(sandboxId: string): Promise<void>;

  /**
   * Check if schema exists
   */
  async schemaExists(sandboxId: string): Promise<boolean>;

  /**
   * Get schema statistics (table count, row counts)
   */
  async getSchemaStats(sandboxId: string): Promise<SchemaStats>;
}
```

### 4.3 RouteProvider

**Location**: `packages/sandbox/src/RouteProvider.ts`

```typescript
/**
 * RouteProvider - Event routing management
 *
 * Manages the mapping between Discord guild IDs and sandbox IDs
 * for event routing. Maintains Redis cache for fast lookups.
 */
export class RouteProvider {
  // Redis cache key pattern
  private readonly CACHE_KEY_PREFIX = 'sandbox:route:';
  private readonly CACHE_TTL_MS = 60_000; // 1 minute

  constructor(
    private readonly db: PostgresJsDatabase,
    private readonly redis: StateManager,
    private readonly logger: Logger
  ) {}

  /**
   * Get sandbox ID for a guild (with cache)
   *
   * 1. Check Redis cache: sandbox:route:{guildId}
   * 2. If miss: query sandbox_guild_mapping table
   * 3. Cache result (even null to prevent repeated DB hits)
   */
  async getSandboxForGuild(guildId: string): Promise<string | null>;

  /**
   * Register guild to sandbox mapping
   *
   * Updates both PostgreSQL and Redis cache.
   */
  async registerMapping(guildId: string, sandboxId: string): Promise<void>;

  /**
   * Remove guild mapping
   */
  async removeMapping(guildId: string): Promise<void>;

  /**
   * Invalidate cache for guild
   */
  async invalidateCache(guildId: string): Promise<void>;

  /**
   * Get all guilds mapped to a sandbox
   */
  async getGuildsForSandbox(sandboxId: string): Promise<string[]>;

  /**
   * Warm cache for all active sandboxes
   */
  async warmCache(): Promise<void>;
}
```

### 4.4 SandboxContext

**Location**: `packages/sandbox/src/SandboxContext.ts`

```typescript
/**
 * SandboxContext - Isolation wrapper for sandbox operations
 *
 * Provides consistent prefixing/namespacing across all resources:
 * - PostgreSQL: search_path to sandbox schema
 * - Redis: key prefix
 * - NATS: subject prefix
 */
export class SandboxContext {
  constructor(
    private readonly sandboxId: string,
    private readonly db: PostgresJsDatabase,
    private readonly redis: StateManager,
    private readonly nats: NatsClient
  ) {}

  /**
   * Execute database operations within sandbox schema
   */
  async withSchema<T>(callback: (db: PostgresJsDatabase) => Promise<T>): Promise<T>;

  /**
   * Get sandbox-prefixed Redis key
   */
  redisKey(key: string): string;

  /**
   * Get sandbox-prefixed NATS subject
   */
  natsSubject(subject: string): string;

  /**
   * Create a Redis wrapper with automatic prefixing
   */
  createRedisWrapper(): SandboxRedis;

  /**
   * Create a NATS publisher with automatic prefixing
   */
  createNatsPublisher(): SandboxNatsPublisher;
}
```

### 4.5 CleanupProvider

**Location**: `packages/sandbox/src/CleanupProvider.ts`

```typescript
/**
 * CleanupProvider - Resource cleanup management
 *
 * Handles cleanup of expired sandboxes and orphaned resources.
 * Designed for idempotent execution (safe to retry on failure).
 */
export class CleanupProvider {
  constructor(
    private readonly db: PostgresJsDatabase,
    private readonly redis: StateManager,
    private readonly nats: NatsClient,
    private readonly schemaProvisioner: SchemaProvisioner,
    private readonly routeProvider: RouteProvider,
    private readonly logger: Logger
  ) {}

  /**
   * Find and cleanup all expired sandboxes
   *
   * Returns count of cleaned up sandboxes.
   */
  async cleanupExpired(): Promise<number>;

  /**
   * Cleanup a single sandbox's resources
   *
   * Steps (idempotent):
   * 1. Mark sandbox as 'destroying'
   * 2. Remove guild mappings (and invalidate cache)
   * 3. Delete Redis keys with sandbox prefix
   * 4. Drop PostgreSQL schema
   * 5. Mark sandbox as 'destroyed'
   */
  async cleanupSandbox(sandboxId: string): Promise<void>;

  /**
   * Delete Redis keys matching sandbox prefix
   *
   * Uses SCAN to avoid blocking on large keyspaces.
   */
  async cleanupRedisKeys(sandboxId: string): Promise<number>;

  /**
   * Find orphaned resources (resources without parent sandbox)
   */
  async findOrphanedResources(): Promise<OrphanedResources>;
}
```

---

## 5. Data Architecture

### 5.1 Database Schema

**Location**: `packages/sandbox/src/schema.ts`

```typescript
import {
  pgTable,
  uuid,
  text,
  timestamp,
  varchar,
  index,
  unique,
  pgEnum,
} from 'drizzle-orm/pg-core';

/**
 * Sandbox status enum
 */
export const sandboxStatusEnum = pgEnum('sandbox_status', [
  'pending',
  'creating',
  'running',
  'expired',
  'destroying',
  'destroyed',
]);

/**
 * Sandboxes - Control plane table for sandbox metadata
 *
 * Stored in the public schema (not in individual sandbox schemas).
 * No RLS - accessible by admin role for management operations.
 */
export const sandboxes = pgTable(
  'sandboxes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 64 }).notNull().unique(),
    owner: varchar('owner', { length: 64 }).notNull(),
    status: sandboxStatusEnum('status').notNull().default('pending'),
    schemaName: varchar('schema_name', { length: 64 }).notNull().unique(),
    discordTokenId: uuid('discord_token_id'), // NULL = shared token
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    destroyedAt: timestamp('destroyed_at', { withTimezone: true }),
    lastActivityAt: timestamp('last_activity_at', { withTimezone: true }),
    metadata: jsonb('metadata').$type<SandboxMetadata>().default({}),
  },
  (table) => ({
    statusIdx: index('idx_sandboxes_status').on(table.status),
    ownerIdx: index('idx_sandboxes_owner').on(table.owner),
    expiresIdx: index('idx_sandboxes_expires').on(table.expiresAt)
      .where(sql`status = 'running'`),
  })
);

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
    eventType: varchar('event_type', { length: 32 }).notNull(),
    actor: varchar('actor', { length: 64 }).notNull(),
    details: jsonb('details').$type<Record<string, unknown>>().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    sandboxTimeIdx: index('idx_sandbox_audit_log_sandbox_time')
      .on(table.sandboxId, table.createdAt),
  })
);
```

### 5.2 Type Definitions

**Location**: `packages/sandbox/src/types.ts`

```typescript
/**
 * Sandbox metadata stored in JSONB
 */
export interface SandboxMetadata {
  description?: string;
  tags?: string[];
  createdBy?: string;
  createdFrom?: 'cli' | 'api';
  ttlHours?: number;
}

/**
 * Sandbox creation options
 */
export interface CreateSandboxOptions {
  name?: string;          // Auto-generated if not provided
  owner: string;          // Developer username
  ttlHours?: number;      // Default: 24
  guildIds?: string[];    // Optional: register guilds immediately
  metadata?: SandboxMetadata;
}

/**
 * Sandbox entity returned from queries
 */
export interface Sandbox {
  id: string;
  name: string;
  owner: string;
  status: SandboxStatus;
  schemaName: string;
  discordTokenId: string | null;
  createdAt: Date;
  expiresAt: Date;
  destroyedAt: Date | null;
  lastActivityAt: Date | null;
  metadata: SandboxMetadata;
  guildIds: string[];     // Populated from mapping table
}

/**
 * Sandbox status values
 */
export type SandboxStatus =
  | 'pending'
  | 'creating'
  | 'running'
  | 'expired'
  | 'destroying'
  | 'destroyed';

/**
 * Sandbox health status
 */
export interface SandboxHealthStatus {
  sandboxId: string;
  status: SandboxStatus;
  health: 'healthy' | 'degraded' | 'unhealthy';
  checks: {
    schema: 'ok' | 'missing' | 'error';
    redis: 'ok' | 'error';
    routing: 'ok' | 'no_guilds' | 'error';
  };
  lastActivity: Date | null;
  expiresIn: string;      // Human-readable (e.g., "2 hours")
}

/**
 * Sandbox connection details for workers
 */
export interface SandboxConnectionDetails {
  sandboxId: string;
  schemaName: string;
  redisPrefix: string;
  natsPrefix: string;
  guildIds: string[];
  env: Record<string, string>; // Ready to export
}

/**
 * Sandbox filter for list queries
 */
export interface SandboxFilter {
  owner?: string;
  status?: SandboxStatus | SandboxStatus[];
  includeExpired?: boolean;
}

/**
 * Audit event types
 */
export type AuditEventType =
  | 'sandbox_created'
  | 'sandbox_destroying'
  | 'sandbox_destroyed'
  | 'guild_registered'
  | 'guild_unregistered'
  | 'ttl_extended'
  | 'status_changed';
```

### 5.3 Database Migration

**Location**: `infrastructure/migrations/100_sandboxes.sql`

```sql
-- =============================================================================
-- Migration: Discord Server Sandboxes
-- Sprint: S-SB-1
-- =============================================================================

-- Sandbox status enum
CREATE TYPE sandbox_status AS ENUM (
  'pending',
  'creating',
  'running',
  'expired',
  'destroying',
  'destroyed'
);

-- Sandboxes table (control plane)
CREATE TABLE sandboxes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(64) NOT NULL UNIQUE,
  owner VARCHAR(64) NOT NULL,
  status sandbox_status NOT NULL DEFAULT 'pending',
  schema_name VARCHAR(64) NOT NULL UNIQUE,
  discord_token_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  destroyed_at TIMESTAMPTZ,
  last_activity_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX idx_sandboxes_status ON sandboxes(status);
CREATE INDEX idx_sandboxes_owner ON sandboxes(owner);
CREATE INDEX idx_sandboxes_expires ON sandboxes(expires_at)
  WHERE status = 'running';

-- Guild to sandbox mapping
CREATE TABLE sandbox_guild_mapping (
  guild_id VARCHAR(20) PRIMARY KEY,
  sandbox_id UUID NOT NULL REFERENCES sandboxes(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sandbox_guild_mapping_sandbox ON sandbox_guild_mapping(sandbox_id);

-- Audit log
CREATE TABLE sandbox_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sandbox_id UUID NOT NULL REFERENCES sandboxes(id) ON DELETE CASCADE,
  event_type VARCHAR(32) NOT NULL,
  actor VARCHAR(64) NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sandbox_audit_log_sandbox_time
  ON sandbox_audit_log(sandbox_id, created_at);

-- =============================================================================
-- Functions for sandbox schema management
-- =============================================================================

-- Create sandbox schema with tenant tables
CREATE OR REPLACE FUNCTION create_sandbox_schema(sandbox_id TEXT)
RETURNS VOID AS $$
DECLARE
  schema_name TEXT := 'sandbox_' || sandbox_id;
BEGIN
  -- Create schema
  EXECUTE format('CREATE SCHEMA IF NOT EXISTS %I', schema_name);

  -- Create tenant-scoped tables in sandbox schema
  -- Note: These mirror the public schema tables but are isolated

  -- Profiles table
  EXECUTE format('
    CREATE TABLE IF NOT EXISTS %I.profiles (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      community_id UUID NOT NULL,
      discord_id TEXT,
      telegram_id TEXT,
      wallet_address TEXT,
      tier TEXT,
      current_rank INTEGER,
      activity_score INTEGER NOT NULL DEFAULT 0,
      conviction_score INTEGER NOT NULL DEFAULT 0,
      joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      first_claim_at TIMESTAMPTZ,
      metadata JSONB NOT NULL DEFAULT ''{}''::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (community_id, discord_id),
      UNIQUE (community_id, telegram_id)
    )', schema_name);

  -- Badges table
  EXECUTE format('
    CREATE TABLE IF NOT EXISTS %I.badges (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      community_id UUID NOT NULL,
      profile_id UUID NOT NULL,
      badge_type TEXT NOT NULL,
      awarded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      awarded_by UUID,
      revoked_at TIMESTAMPTZ,
      metadata JSONB NOT NULL DEFAULT ''{}''::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (community_id, profile_id, badge_type)
    )', schema_name);

  -- Communities table (sandbox can have its own community records)
  EXECUTE format('
    CREATE TABLE IF NOT EXISTS %I.communities (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      theme_id TEXT NOT NULL DEFAULT ''basic'',
      subscription_tier TEXT NOT NULL DEFAULT ''free'',
      discord_guild_id TEXT UNIQUE,
      telegram_chat_id TEXT UNIQUE,
      is_active BOOLEAN NOT NULL DEFAULT true,
      settings JSONB NOT NULL DEFAULT ''{}''::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )', schema_name);

  -- Grant permissions to app role
  EXECUTE format('GRANT USAGE ON SCHEMA %I TO arrakis_app', schema_name);
  EXECUTE format('GRANT ALL ON ALL TABLES IN SCHEMA %I TO arrakis_app', schema_name);
  EXECUTE format('GRANT ALL ON ALL SEQUENCES IN SCHEMA %I TO arrakis_app', schema_name);
END;
$$ LANGUAGE plpgsql;

-- Drop sandbox schema (idempotent)
CREATE OR REPLACE FUNCTION drop_sandbox_schema(sandbox_id TEXT)
RETURNS VOID AS $$
DECLARE
  schema_name TEXT := 'sandbox_' || sandbox_id;
BEGIN
  EXECUTE format('DROP SCHEMA IF EXISTS %I CASCADE', schema_name);
END;
$$ LANGUAGE plpgsql;

-- Check if sandbox schema exists
CREATE OR REPLACE FUNCTION sandbox_schema_exists(sandbox_id TEXT)
RETURNS BOOLEAN AS $$
DECLARE
  schema_name TEXT := 'sandbox_' || sandbox_id;
  exists_result BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.schemata
    WHERE schema_name = schema_name
  ) INTO exists_result;
  RETURN exists_result;
END;
$$ LANGUAGE plpgsql;
```

---

## 6. CLI Design

### 6.1 Command Structure

**Location**: `packages/cli/src/commands/sandbox/`

```
packages/cli/src/commands/sandbox/
├── index.ts          # Command group registration
├── create.ts         # bd sandbox create
├── list.ts           # bd sandbox list
├── status.ts         # bd sandbox status
├── destroy.ts        # bd sandbox destroy
├── connect.ts        # bd sandbox connect
└── register.ts       # bd sandbox register-guild
```

### 6.2 Command Implementations

#### `bd sandbox create`

```typescript
/**
 * Create a new sandbox environment
 *
 * Usage:
 *   bd sandbox create [name]
 *   bd sandbox create my-feature --ttl 48h
 *   bd sandbox create --guild 123456789
 */
export const createCommand = new Command('create')
  .description('Create a new sandbox environment')
  .argument('[name]', 'Sandbox name (auto-generated if not provided)')
  .option('--ttl <duration>', 'Time-to-live (e.g., 24h, 7d)', '24h')
  .option('--guild <guildId>', 'Discord guild ID to register')
  .option('--json', 'Output as JSON')
  .action(async (name, options) => {
    const spinner = ora('Creating sandbox...').start();

    try {
      const sandboxManager = await getSandboxManager();

      const sandbox = await sandboxManager.create({
        name,
        owner: getCurrentUser(),
        ttlHours: parseTTL(options.ttl),
        guildIds: options.guild ? [options.guild] : undefined,
      });

      spinner.succeed(`Sandbox created: ${sandbox.name}`);

      if (options.json) {
        console.log(JSON.stringify(sandbox, null, 2));
      } else {
        console.log('');
        console.log(`  ID:        ${sandbox.id}`);
        console.log(`  Name:      ${sandbox.name}`);
        console.log(`  Schema:    ${sandbox.schemaName}`);
        console.log(`  Expires:   ${formatExpiry(sandbox.expiresAt)}`);
        console.log('');
        console.log('  To connect:');
        console.log(`    eval $(bd sandbox connect ${sandbox.id})`);
        console.log('');
      }
    } catch (error) {
      spinner.fail(`Failed to create sandbox: ${error.message}`);
      process.exit(1);
    }
  });
```

#### `bd sandbox list`

```typescript
/**
 * List sandboxes
 *
 * Usage:
 *   bd sandbox list
 *   bd sandbox list --owner merlin
 *   bd sandbox list --status running
 *   bd sandbox list --all
 */
export const listCommand = new Command('list')
  .description('List sandboxes')
  .option('--owner <username>', 'Filter by owner')
  .option('--status <status>', 'Filter by status')
  .option('--all', 'Include destroyed sandboxes')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    const sandboxManager = await getSandboxManager();

    const sandboxes = await sandboxManager.list({
      owner: options.owner,
      status: options.status,
      includeExpired: options.all,
    });

    if (options.json) {
      console.log(JSON.stringify(sandboxes, null, 2));
      return;
    }

    if (sandboxes.length === 0) {
      console.log('No sandboxes found');
      return;
    }

    const table = new Table({
      head: ['ID', 'Name', 'Owner', 'Status', 'Guilds', 'Expires'],
    });

    for (const sandbox of sandboxes) {
      table.push([
        sandbox.id.slice(0, 8),
        sandbox.name,
        sandbox.owner,
        colorStatus(sandbox.status),
        sandbox.guildIds.length.toString(),
        formatExpiry(sandbox.expiresAt),
      ]);
    }

    console.log(table.toString());
  });
```

#### `bd sandbox connect`

```typescript
/**
 * Output connection details as environment variables
 *
 * Usage:
 *   eval $(bd sandbox connect <id>)
 */
export const connectCommand = new Command('connect')
  .description('Output sandbox connection details as env vars')
  .argument('<id>', 'Sandbox ID or name')
  .action(async (id) => {
    const sandboxManager = await getSandboxManager();
    const details = await sandboxManager.getConnectionDetails(id);

    console.log(`export SANDBOX_ID="${details.sandboxId}"`);
    console.log(`export SANDBOX_SCHEMA="${details.schemaName}"`);
    console.log(`export SANDBOX_REDIS_PREFIX="${details.redisPrefix}"`);
    console.log(`export SANDBOX_NATS_PREFIX="${details.natsPrefix}"`);
    console.log(`export SANDBOX_GUILD_IDS="${details.guildIds.join(',')}"`);
  });
```

#### `bd sandbox destroy`

```typescript
/**
 * Destroy a sandbox
 *
 * Usage:
 *   bd sandbox destroy <id>
 *   bd sandbox destroy --all --confirm
 */
export const destroyCommand = new Command('destroy')
  .description('Destroy a sandbox and cleanup resources')
  .argument('[id]', 'Sandbox ID or name')
  .option('--all', 'Destroy all sandboxes owned by current user')
  .option('--confirm', 'Skip confirmation prompt')
  .action(async (id, options) => {
    const sandboxManager = await getSandboxManager();

    if (options.all) {
      const sandboxes = await sandboxManager.list({
        owner: getCurrentUser(),
        status: 'running',
      });

      if (sandboxes.length === 0) {
        console.log('No running sandboxes to destroy');
        return;
      }

      if (!options.confirm) {
        const answer = await confirm(
          `Destroy ${sandboxes.length} sandbox(es)? This cannot be undone.`
        );
        if (!answer) return;
      }

      for (const sandbox of sandboxes) {
        const spinner = ora(`Destroying ${sandbox.name}...`).start();
        await sandboxManager.destroy(sandbox.id);
        spinner.succeed(`Destroyed ${sandbox.name}`);
      }
    } else {
      if (!id) {
        console.error('Sandbox ID required (or use --all)');
        process.exit(1);
      }

      const spinner = ora('Destroying sandbox...').start();
      await sandboxManager.destroy(id);
      spinner.succeed('Sandbox destroyed');
    }
  });
```

---

## 7. Event Routing

### 7.1 Event Router Service

**Location**: `apps/worker/src/services/EventRouter.ts`

```typescript
/**
 * EventRouter - Routes Discord events to sandboxes
 *
 * Subscribes to raw events from gateway and republishes
 * to appropriate sandbox or production subjects.
 */
export class EventRouter {
  constructor(
    private readonly routeProvider: RouteProvider,
    private readonly nats: NatsClient,
    private readonly logger: Logger
  ) {}

  /**
   * Start routing events
   *
   * Subscribes to: events.raw.>
   * Republishes to: sandbox.{id}.events.{type} or events.{type}
   */
  async start(): Promise<void> {
    const js = this.nats.getJetStream();
    const consumer = await js.consumers.get('EVENTS', 'event-router');

    for await (const msg of await consumer.consume()) {
      try {
        await this.routeMessage(msg);
        msg.ack();
      } catch (error) {
        this.logger.error({ error }, 'Failed to route event');
        msg.nak();
      }
    }
  }

  private async routeMessage(msg: JsMsg): Promise<void> {
    const event = JSON.parse(msg.string()) as DiscordEvent;
    const guildId = this.extractGuildId(event);

    if (!guildId) {
      // Events without guild_id go to production
      await this.nats.publish(`events.${event.type}`, event);
      return;
    }

    const sandboxId = await this.routeProvider.getSandboxForGuild(guildId);

    if (sandboxId) {
      // Route to sandbox-specific subject
      await this.nats.publish(`sandbox.${sandboxId}.events.${event.type}`, event);
      this.logger.debug({ guildId, sandboxId, eventType: event.type }, 'Routed to sandbox');
    } else {
      // Route to production subject
      await this.nats.publish(`events.${event.type}`, event);
    }
  }

  private extractGuildId(event: DiscordEvent): string | null {
    return event.guild_id ?? event.d?.guild_id ?? null;
  }
}
```

### 7.2 NATS Stream Configuration

Add sandbox stream to existing configuration:

```typescript
// Add to STREAM_CONFIGS in NatsClient.ts
{
  name: 'SANDBOX',
  subjects: ['sandbox.>'],
  retention: RetentionPolicy.Limits,
  storage: StorageType.Memory,
  maxAge: 5 * 60 * 1_000_000_000, // 5 minutes
  maxMsgs: 500_000,
  replicas: 3,
  description: 'Sandbox-specific events and commands',
},
```

---

## 8. Security Architecture

### 8.1 Threat Model

| Threat | Likelihood | Impact | Mitigation |
|--------|------------|--------|------------|
| Cross-sandbox data access | Low | Critical | PostgreSQL schema isolation, separate search_path |
| Event leakage between sandboxes | Low | High | NATS subject ACLs, guild mapping validation |
| Privilege escalation via sandbox | Low | Critical | Sandboxes run with same permissions as tenant |
| Resource exhaustion (DoS) | Medium | Medium | Sandbox limits per developer, auto-cleanup |
| Discord rate limit abuse | Medium | High | GlobalDiscordTokenBucket (existing) |

### 8.2 Security Controls

| Control | Implementation |
|---------|----------------|
| Schema isolation | Each sandbox has its own PostgreSQL schema |
| Search path enforcement | Database connections set `search_path` to sandbox schema |
| Redis key isolation | All keys prefixed with `sandbox:{id}:` |
| NATS subject isolation | All subjects prefixed with `sandbox.{id}.` |
| Guild mapping uniqueness | One guild can only map to one sandbox |
| Cleanup guarantees | Idempotent cleanup ensures complete resource removal |
| Audit logging | All sandbox lifecycle events logged |

### 8.3 RLS Considerations

Sandbox schemas do NOT use RLS because:
1. Each sandbox is already isolated by schema
2. Within a sandbox, there's a single "tenant" (the sandbox itself)
3. Simpler implementation and faster queries

However, the guild-to-sandbox mapping table in the public schema does need protection:
- Only sandbox management service can write
- Application role can only read

---

## 9. Monitoring & Observability

### 9.1 Metrics

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `sandbox_active_total` | Gauge | owner | Number of active sandboxes |
| `sandbox_create_duration_seconds` | Histogram | - | Time to create sandbox |
| `sandbox_destroy_duration_seconds` | Histogram | - | Time to destroy sandbox |
| `sandbox_event_route_duration_seconds` | Histogram | sandbox_id | Event routing latency |
| `sandbox_cleanup_errors_total` | Counter | error_type | Cleanup failures |

### 9.2 Logging

```typescript
// Structured log fields for sandbox operations
interface SandboxLogContext {
  sandboxId: string;
  sandboxName: string;
  owner: string;
  operation: 'create' | 'destroy' | 'route' | 'cleanup';
  guildId?: string;
  duration?: number;
}
```

### 9.3 Alerts

| Alert | Condition | Severity |
|-------|-----------|----------|
| SandboxCleanupFailing | cleanup_errors > 5 in 15m | Warning |
| SandboxCreateLatency | p99 > 60s for 5m | Warning |
| SandboxOrphanedResources | orphaned > 0 for 1h | Warning |
| SandboxRouteLatency | p99 > 10ms for 5m | Info |

---

## 10. Deployment Architecture

### 10.1 Service Topology

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              ECS Cluster                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐             │
│  │ API Service     │  │ Worker Service  │  │ Sandbox Cleanup │             │
│  │ (existing)      │  │ (existing)      │  │ Job (new)       │             │
│  │                 │  │                 │  │                 │             │
│  │ + /api/sandbox  │  │ + EventRouter   │  │ Runs every 15m  │             │
│  │   endpoints     │  │ + SandboxWorker │  │ Via EventBridge │             │
│  └────────┬────────┘  └────────┬────────┘  └────────┬────────┘             │
│           │                    │                    │                      │
└───────────┼────────────────────┼────────────────────┼──────────────────────┘
            │                    │                    │
            ▼                    ▼                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Shared Infrastructure                              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐       │
│  │ RDS         │  │ ElastiCache │  │ NATS        │  │ Amazon MQ   │       │
│  │ PostgreSQL  │  │ Redis       │  │ JetStream   │  │ RabbitMQ    │       │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘       │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 10.2 Cleanup Job Configuration

**Location**: `infrastructure/terraform/sandbox-cleanup.tf`

```hcl
# EventBridge rule for sandbox cleanup
resource "aws_cloudwatch_event_rule" "sandbox_cleanup" {
  name                = "${local.name_prefix}-sandbox-cleanup"
  description         = "Trigger sandbox cleanup every 15 minutes"
  schedule_expression = "rate(15 minutes)"

  tags = local.common_tags
}

# ECS task for cleanup
resource "aws_ecs_task_definition" "sandbox_cleanup" {
  family                   = "${local.name_prefix}-sandbox-cleanup"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 256
  memory                   = 512
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  container_definitions = jsonencode([{
    name  = "cleanup"
    image = "${aws_ecr_repository.worker.repository_url}:latest"
    command = ["node", "dist/jobs/sandbox-cleanup.js"]
    environment = [
      { name = "NODE_ENV", value = var.environment },
      { name = "LOG_LEVEL", value = var.log_level },
    ]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.worker.name
        awslogs-region        = var.aws_region
        awslogs-stream-prefix = "sandbox-cleanup"
      }
    }
  }])

  tags = local.common_tags
}
```

---

## 11. Implementation Plan

### Sprint S-SB-1: Foundation

**Goal**: Sandbox data model, schema management, basic CRUD

| Task | Estimate | Description |
|------|----------|-------------|
| Database migration | 2h | Create sandboxes, guild_mapping, audit_log tables |
| Schema provisioner | 4h | Create/drop sandbox schemas with tenant tables |
| SandboxManager core | 4h | Create, list, get, destroy operations |
| Unit tests | 2h | 90% coverage for core components |
| Integration tests | 2h | Schema creation/destruction, CRUD operations |

### Sprint S-SB-2: CLI Commands

**Goal**: Full CLI interface for sandbox management

| Task | Estimate | Description |
|------|----------|-------------|
| CLI infrastructure | 2h | Command group setup, shared utilities |
| `bd sandbox create` | 3h | Create with options, TTL parsing |
| `bd sandbox list` | 2h | Filtering, table formatting |
| `bd sandbox destroy` | 2h | Single and bulk destroy |
| `bd sandbox connect` | 1h | Env var output |
| Documentation | 2h | Command reference, examples |

### Sprint S-SB-3: Event Routing

**Goal**: Route Discord events to correct sandbox

| Task | Estimate | Description |
|------|----------|-------------|
| RouteProvider | 4h | Guild mapping with Redis cache |
| EventRouter service | 4h | Subscribe and republish events |
| NATS SANDBOX stream | 1h | Configure new stream |
| `bd sandbox register-guild` | 2h | CLI for guild registration |
| Integration tests | 2h | End-to-end event routing |

### Sprint S-SB-4: Cleanup & Polish

**Goal**: Auto-cleanup, health checks, metrics

| Task | Estimate | Description |
|------|----------|-------------|
| CleanupProvider | 4h | Idempotent resource cleanup |
| Cleanup job | 2h | EventBridge scheduled task |
| `bd sandbox status` | 2h | Health checks, diagnostics |
| Metrics integration | 2h | Prometheus metrics |
| CloudWatch alarms | 1h | Alerting for failures |
| Documentation | 2h | Runbook, troubleshooting |

---

## 12. Testing Strategy

### 12.1 Unit Tests

| Component | Coverage Target | Key Scenarios |
|-----------|-----------------|---------------|
| SandboxManager | 90% | CRUD operations, validation, error handling |
| SchemaProvisioner | 90% | Schema creation, idempotent drop |
| RouteProvider | 90% | Cache hits/misses, mapping operations |
| CleanupProvider | 90% | Resource cleanup, orphan detection |

### 12.2 Integration Tests

| Test Suite | Description |
|------------|-------------|
| `sandbox-lifecycle.test.ts` | Create → use → destroy full cycle |
| `event-routing.test.ts` | Events routed to correct sandbox |
| `schema-isolation.test.ts` | No data leakage between sandboxes |
| `cleanup.test.ts` | TTL expiry and resource cleanup |

### 12.3 Security Tests

| Test | Description |
|------|-------------|
| Cross-sandbox query | Verify queries in sandbox A cannot access sandbox B |
| Guild mapping enforcement | Verify event for guild A goes only to mapped sandbox |
| Redis key isolation | Verify key in sandbox A not readable from sandbox B |

---

## 13. Appendix

### A. Configuration Reference

```yaml
# Environment variables for sandbox feature
SANDBOX_ENABLED: "true"
SANDBOX_DEFAULT_TTL_HOURS: "24"
SANDBOX_MAX_PER_DEVELOPER: "3"
SANDBOX_CLEANUP_INTERVAL_MINUTES: "15"
SANDBOX_DISCORD_TOKEN: "${SHARED_DISCORD_BOT_TOKEN}"
SANDBOX_ROUTE_CACHE_TTL_MS: "60000"
```

### B. Error Codes

| Code | Message | Resolution |
|------|---------|------------|
| `SANDBOX_001` | Sandbox name already exists | Choose a different name |
| `SANDBOX_002` | Max sandboxes per developer exceeded | Destroy existing sandboxes |
| `SANDBOX_003` | Guild already mapped to another sandbox | Unregister from other sandbox first |
| `SANDBOX_004` | Sandbox not found | Check ID/name spelling |
| `SANDBOX_005` | Schema creation failed | Check PostgreSQL permissions |
| `SANDBOX_006` | Cleanup failed | Retry or manual cleanup |

### C. Glossary

| Term | Definition |
|------|------------|
| Sandbox | Isolated testing environment for Discord bot |
| Schema | PostgreSQL namespace containing tables for a sandbox |
| Guild | Discord server (identified by guild_id) |
| TTL | Time-to-live; how long until sandbox auto-expires |
| Route | Mapping from guild_id to sandbox_id for event routing |

---

**Document Status**: DRAFT - Pending Approval
**Next Steps**: Review by engineering team, then proceed to sprint planning with `/sprint-plan`

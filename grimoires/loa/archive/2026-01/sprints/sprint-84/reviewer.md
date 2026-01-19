# Sprint 84 Implementation Report

## Discord Server Sandboxes - Foundation

**Sprint**: 84
**Status**: Implementation Complete
**Date**: 2026-01-17

---

## Summary

Sprint 84 implements the foundation layer for Discord Server Sandboxes - isolated testing environments that provide per-developer PostgreSQL schemas, Redis key prefixes, and NATS subject namespacing for testing Arrakis functionality without affecting production data.

## Tasks Completed

### Task 84.1: Database Migration
**File**: `infrastructure/migrations/003_sandboxes.sql`

Created the control plane tables for sandbox management:

- **`sandbox_status` enum**: `pending`, `creating`, `running`, `expired`, `destroying`, `destroyed`
- **`sandboxes` table**: Core metadata with name, owner, status, schema_name, TTL, and JSONB metadata
- **`sandbox_guild_mapping` table**: Routes Discord guild_id to sandbox for event routing
- **`sandbox_audit_log` table**: Tracks lifecycle events with actor and details

**Indexes created**:
- `idx_sandboxes_status` - Status queries
- `idx_sandboxes_owner` - Per-developer queries
- `idx_sandboxes_expires` - TTL expiry queries (partial index on `running` status)
- `idx_sandboxes_created` - Listing by creation time
- `idx_sandbox_guild_mapping_sandbox` - Guild lookups
- `idx_sandbox_audit_log_sandbox_time` - Audit timeline queries

### Task 84.2: Schema Management Functions
**File**: `infrastructure/migrations/003_sandboxes.sql`

PostgreSQL functions for sandbox schema lifecycle:

- **`create_sandbox_schema(sandbox_id)`**: Creates isolated schema with `communities`, `profiles`, `badges` tables
- **`drop_sandbox_schema(sandbox_id)`**: Idempotent CASCADE drop
- **`sandbox_schema_exists(sandbox_id)`**: Existence check
- **`get_sandbox_schema_stats(sandbox_id)`**: Returns table names and row counts

### Task 84.3: Drizzle Schema Definition
**Package**: `@arrakis/sandbox`

Created new TypeScript package with Drizzle ORM schema:

**Files created**:
- `packages/sandbox/package.json` - Package configuration with dependencies
- `packages/sandbox/tsconfig.json` - TypeScript configuration
- `packages/sandbox/vitest.config.ts` - Test configuration
- `packages/sandbox/src/types.ts` - TypeScript type definitions
- `packages/sandbox/src/schema.ts` - Drizzle schema definitions
- `packages/sandbox/src/index.ts` - Package exports

**Type exports**:
- `SandboxStatus` - Union type for lifecycle states
- `SandboxMetadata` - JSONB metadata interface
- `CreateSandboxOptions` - Creation options
- `Sandbox` - Complete entity type
- `SandboxHealthStatus`, `SandboxHealthCheck`, `HealthLevel`
- `SandboxConnectionDetails` - Worker connection info
- `SandboxFilter` - Query filtering
- `AuditEventType`, `AuditLogEntry`
- `SandboxError`, `SandboxErrorCode` - Error handling

### Task 84.4: SchemaProvisioner Implementation
**File**: `packages/sandbox/src/services/schema-provisioner.ts`

Service for PostgreSQL schema lifecycle:

**Methods**:
- `generateSchemaName(sandboxId)` - Creates `sandbox_{short_id}` from UUID
- `extractSandboxId(schemaName)` - Reverses schema name to ID
- `createSchema(sandboxId)` - Creates schema with tables
- `dropSchema(sandboxId)` - Idempotent schema removal
- `schemaExists(sandboxId)` - Existence check
- `getSchemaStats(sandboxId)` - Table stats with row counts
- `listSchemas()` - Lists all sandbox schemas
- `cleanupOrphanedSchemas(activeSandboxIds)` - Removes orphaned schemas

**Key features**:
- Uses database functions from migration
- Comprehensive error handling with `SandboxError`
- Structured logging with child logger context

### Task 84.5: SandboxManager Core
**File**: `packages/sandbox/src/services/sandbox-manager.ts`

Complete sandbox lifecycle management:

**Creation & Retrieval**:
- `create(options)` - Creates sandbox with schema provisioning
- `getById(id)`, `getByName(name)`, `getByGuildId(guildId)` - Lookups
- `list(filter)` - Filtered listing

**Guild Management**:
- `registerGuild(sandboxId, guildId, actor)` - Routes guild to sandbox
- `unregisterGuild(sandboxId, guildId, actor)` - Removes mapping

**Lifecycle**:
- `extendTtl(sandboxId, hours, actor)` - TTL extension with max cap
- `destroy(sandboxId, actor)` - Full cleanup
- `updateActivity(sandboxId)` - Activity timestamp update

**Health & Status**:
- `getHealth(sandboxId)` - Health check (schema, redis, routing)
- `getConnectionDetails(sandboxId)` - Returns env vars for workers

**Expiry Processing**:
- `findExpired()` - Lists expired sandboxes
- `markExpired()` - Batch mark as expired

**Key features**:
- Owner sandbox limit (default: 5)
- Configurable TTL with max cap (default: 24h, max: 168h)
- Status transition validation
- Comprehensive audit logging
- Cleanup on creation failure

### Task 84.6: Unit Tests
**Directory**: `packages/sandbox/src/__tests__/`

**Test files**:
- `types.test.ts` - 14 tests for type definitions and error handling
- `schema-provisioner.test.ts` - 20 tests for SchemaProvisioner
- `sandbox-manager.test.ts` - 24 tests for SandboxManager

**Total**: 58 tests passing

**Coverage areas**:
- Status transition validation
- Error code verification
- Schema generation and extraction
- Mocked SQL client interactions
- Health check scenarios
- TTL cap behavior
- Guild registration edge cases

---

## Files Created/Modified

### New Files
```
infrastructure/migrations/003_sandboxes.sql
packages/sandbox/package.json
packages/sandbox/tsconfig.json
packages/sandbox/vitest.config.ts
packages/sandbox/src/types.ts
packages/sandbox/src/schema.ts
packages/sandbox/src/index.ts
packages/sandbox/src/services/index.ts
packages/sandbox/src/services/schema-provisioner.ts
packages/sandbox/src/services/sandbox-manager.ts
packages/sandbox/src/__tests__/types.test.ts
packages/sandbox/src/__tests__/schema-provisioner.test.ts
packages/sandbox/src/__tests__/sandbox-manager.test.ts
```

### Package Structure
```
packages/sandbox/
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── src/
│   ├── index.ts
│   ├── types.ts
│   ├── schema.ts
│   ├── services/
│   │   ├── index.ts
│   │   ├── schema-provisioner.ts
│   │   └── sandbox-manager.ts
│   └── __tests__/
│       ├── types.test.ts
│       ├── schema-provisioner.test.ts
│       └── sandbox-manager.test.ts
└── dist/           (generated)
```

---

## Acceptance Criteria Verification

| Criterion | Status | Evidence |
|-----------|--------|----------|
| Database migration creates control plane tables | ✅ | `003_sandboxes.sql` with sandboxes, sandbox_guild_mapping, sandbox_audit_log |
| Schema management functions exist | ✅ | create_sandbox_schema, drop_sandbox_schema, sandbox_schema_exists, get_sandbox_schema_stats |
| Drizzle schema matches migration | ✅ | schema.ts exports sandboxes, sandboxGuildMapping, sandboxAuditLog with relations |
| SchemaProvisioner creates/drops schemas | ✅ | createSchema(), dropSchema() methods with error handling |
| SandboxManager handles lifecycle | ✅ | create(), destroy(), extendTtl(), health checks |
| Guild mapping operations work | ✅ | registerGuild(), unregisterGuild() with availability checks |
| Unit tests cover core functionality | ✅ | 58 tests passing |
| TypeScript compiles without errors | ✅ | npm run typecheck passes |
| Package builds successfully | ✅ | npm run build generates dist/ |

---

## Technical Notes

### Schema Naming Convention
- Schema name format: `sandbox_{first_8_chars_of_uuid}`
- Example: `sandbox_12345678` from UUID `12345678-1234-...`

### Status Transitions
```
pending → creating → running → expired → destroying → destroyed
                  ↓ (failure)          ↗
                  → destroying → destroyed
```

### TTL Behavior
- Default: 24 hours
- Maximum: 168 hours (7 days)
- Extensions capped at max TTL from creation time

### Audit Event Types
- `sandbox_created`, `sandbox_destroying`, `sandbox_destroyed`
- `guild_registered`, `guild_unregistered`
- `ttl_extended`, `status_changed`

---

## Dependencies

### Runtime Dependencies
- `drizzle-orm@^0.33.0` - ORM for PostgreSQL
- `postgres@^3.4.0` - PostgreSQL client
- `nanoid@^5.0.0` - Unique ID generation
- `@arrakis/core` - Core types and utilities

### Peer Dependencies
- `pino@>=8.0.0` - Logging (provided by consumer)

### Dev Dependencies
- `vitest@^1.0.0` - Testing framework
- `typescript@^5.3.0` - TypeScript compiler

---

## Next Steps (Sprint 85)

1. **Redis Integration**: Implement Redis key prefixing and cache isolation
2. **NATS Integration**: Subject namespacing for event routing
3. **Event Router**: Route Discord events to correct sandbox
4. **CLI Commands**: `sandbox create`, `sandbox list`, `sandbox destroy`

---

## Review Checklist

- [x] All tasks implemented per sprint plan
- [x] Database migration is idempotent
- [x] Error handling uses SandboxError with codes
- [x] Logging includes component context
- [x] Status transitions are validated
- [x] Unit tests cover happy and error paths
- [x] TypeScript strict mode passes
- [x] Package exports are complete

---

**Implementation Engineer**: Claude (Implementing Tasks Agent)
**Sprint**: 84 - Discord Server Sandboxes - Foundation

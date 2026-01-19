# Sprint Plan: Discord Server Sandboxes

**Version:** 1.0
**Date:** January 17, 2026
**Author:** Sprint Planner Agent
**PRD Reference:** grimoires/loa/discord-server-sandboxes-prd.md
**SDD Reference:** grimoires/loa/discord-server-sandboxes-sdd.md
**Feature Branch:** `feature/discord-server-sandboxes`

---

## Executive Summary

This sprint plan implements Discord Server Sandboxes - isolated testing environments for the Arrakis Discord bot. The implementation leverages existing multi-tenant infrastructure (RLS, TenantContext, NATS JetStream) to provide zero-config sandbox creation with complete data isolation.

**Total Sprints:** 4
**Sprint Duration:** 2.5 days each
**Estimated Completion:** ~10 days total

**MVP Scope:**
- CLI sandbox management (`bd sandbox create/list/destroy/connect`)
- PostgreSQL schema-per-sandbox isolation
- Redis key prefix namespacing
- NATS subject namespace routing
- Guild-to-sandbox event routing
- TTL-based auto-cleanup

---

## Sprint Overview

**Sprint Range:** 84-87 (continuing from highest existing sprint: 83)

| Sprint | Theme | Key Deliverables | Dependencies |
|--------|-------|------------------|--------------|
| sprint-84 | Foundation | Database schema, SchemaProvisioner, SandboxManager core | None |
| sprint-85 | CLI Commands | `bd sandbox` command group (create/list/destroy/connect) | sprint-84 |
| sprint-86 | Event Routing | RouteProvider, EventRouter, guild mapping | sprint-84 |
| sprint-87 | Cleanup & Polish | CleanupProvider, scheduled job, health checks, metrics | sprint-84,85,86 |

---

## Sprint 84: Foundation

**Duration:** 2.5 days
**Theme:** Database schema, core service classes, and basic CRUD operations

### Sprint Goal
Establish the data foundation for sandboxes with PostgreSQL schema isolation and core management service.

### Deliverables
- [ ] Database migration for sandbox tables (`sandboxes`, `sandbox_guild_mapping`, `sandbox_audit_log`)
- [ ] SQL functions for sandbox schema management (`create_sandbox_schema`, `drop_sandbox_schema`)
- [ ] `SchemaProvisioner` class for PostgreSQL schema lifecycle
- [ ] `SandboxManager` core with create, list, get, destroy operations
- [ ] Unit tests with 90%+ coverage

### Tasks

#### Task 84.1: Database Migration
**Description:** Create PostgreSQL migration for sandbox control plane tables.

**Files to create/modify:**
- `infrastructure/migrations/100_sandboxes.sql` (new)
- `packages/sandbox/src/schema.ts` (new - Drizzle schema)

**Acceptance Criteria:**
- [ ] `sandboxes` table created with all columns per SDD §5.1
- [ ] `sandbox_status` enum type created (pending, creating, running, expired, destroying, destroyed)
- [ ] `sandbox_guild_mapping` table with CASCADE delete
- [ ] `sandbox_audit_log` table with proper indexes
- [ ] All indexes created per SDD §5.1
- [ ] Migration runs successfully: `npm run db:migrate`

**Test Scenarios:**
- Migration applies cleanly on fresh database
- Migration is idempotent (can run twice without error)
- Foreign key constraints work correctly (CASCADE delete)

---

#### Task 84.2: Schema Management Functions
**Description:** Create PostgreSQL functions for sandbox schema lifecycle.

**Files to create/modify:**
- `infrastructure/migrations/100_sandboxes.sql` (append)

**Acceptance Criteria:**
- [ ] `create_sandbox_schema(sandbox_id TEXT)` function creates schema with tenant tables
- [ ] `drop_sandbox_schema(sandbox_id TEXT)` function drops schema with CASCADE
- [ ] `sandbox_schema_exists(sandbox_id TEXT)` function returns boolean
- [ ] Tenant tables (profiles, badges, communities) created in sandbox schema
- [ ] Proper permissions granted to `arrakis_app` role

**Test Scenarios:**
- `SELECT create_sandbox_schema('test123')` creates schema `sandbox_test123`
- Schema contains profiles, badges, communities tables
- `SELECT drop_sandbox_schema('test123')` removes schema completely
- `SELECT sandbox_schema_exists('test123')` returns false after drop

---

#### Task 84.3: Drizzle Schema Definition
**Description:** Define TypeScript schema for sandbox tables using Drizzle ORM.

**Files to create/modify:**
- `packages/sandbox/src/schema.ts` (new)
- `packages/sandbox/src/types.ts` (new)
- `packages/sandbox/src/index.ts` (new - exports)
- `packages/sandbox/package.json` (new)

**Acceptance Criteria:**
- [ ] `sandboxes` table defined with proper types
- [ ] `sandboxGuildMapping` table defined
- [ ] `sandboxAuditLog` table defined
- [ ] TypeScript types exported: `Sandbox`, `SandboxStatus`, `CreateSandboxOptions`, etc.
- [ ] Relations defined between tables
- [ ] Package compiles without errors: `npm run build`

**Test Scenarios:**
- Types are correctly inferred from schema
- Can insert/select from tables via Drizzle
- Relations work correctly

---

#### Task 84.4: SchemaProvisioner Implementation
**Description:** Implement service for PostgreSQL schema lifecycle management.

**Files to create/modify:**
- `packages/sandbox/src/SchemaProvisioner.ts` (new)

**Acceptance Criteria:**
- [ ] `createSchema(sandboxId)` calls `create_sandbox_schema` SQL function
- [ ] `dropSchema(sandboxId)` calls `drop_sandbox_schema` SQL function (idempotent)
- [ ] `schemaExists(sandboxId)` calls `sandbox_schema_exists` SQL function
- [ ] `getSchemaStats(sandboxId)` returns table/row counts
- [ ] Error handling with typed exceptions
- [ ] Logging with structured context (sandboxId, operation)

**Test Scenarios:**
- Creates schema successfully
- Handles duplicate schema creation gracefully
- Drops schema successfully
- Returns correct exists status
- Returns accurate schema stats

---

#### Task 84.5: SandboxManager Core
**Description:** Implement core sandbox lifecycle management service.

**Files to create/modify:**
- `packages/sandbox/src/SandboxManager.ts` (new)

**Acceptance Criteria:**
- [ ] `create(options)` creates sandbox record and schema
- [ ] Auto-generates name if not provided (format: `sandbox-{owner}-{nanoid(6)}`)
- [ ] Sets `expires_at` based on TTL (default 24h)
- [ ] Logs audit event `sandbox_created`
- [ ] `list(filter?)` returns sandboxes with optional filtering
- [ ] `get(sandboxId)` returns sandbox by ID or name
- [ ] `destroy(sandboxId)` marks sandbox for destruction
- [ ] Status transitions: pending → creating → running → destroying → destroyed

**Test Scenarios:**
- Creates sandbox with auto-generated name
- Creates sandbox with custom name
- Rejects duplicate names
- Lists all sandboxes
- Filters by owner
- Filters by status
- Gets sandbox by ID
- Gets sandbox by name
- Destroys sandbox (marks status)
- Rejects invalid status transitions

---

#### Task 84.6: Unit Tests
**Description:** Comprehensive unit tests for all Sprint 1 components.

**Files to create/modify:**
- `packages/sandbox/src/__tests__/schema.test.ts` (new)
- `packages/sandbox/src/__tests__/SchemaProvisioner.test.ts` (new)
- `packages/sandbox/src/__tests__/SandboxManager.test.ts` (new)

**Acceptance Criteria:**
- [ ] 90%+ code coverage for SchemaProvisioner
- [ ] 90%+ code coverage for SandboxManager
- [ ] Tests use proper mocking for database
- [ ] Tests cover error conditions
- [ ] Tests run in CI: `npm test -- --coverage`

**Test Scenarios:**
- All happy paths covered
- Error handling covered
- Edge cases (empty name, invalid ID, etc.) covered

---

### Dependencies
- None (first sprint)

### Risks & Mitigation
| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| PostgreSQL permission issues | Low | High | Test with exact staging permissions |
| Drizzle schema mismatch | Low | Med | Run type checks before migration |

### Success Metrics
- Database migration applies successfully
- All unit tests pass with 90%+ coverage
- Can create/destroy sandbox via SandboxManager programmatically

---

## Sprint 85: CLI Commands

**Duration:** 2.5 days
**Theme:** Full CLI interface for sandbox management

### Sprint Goal
Provide developers with zero-config CLI commands for sandbox lifecycle management.

### Deliverables
- [ ] `bd sandbox create [name]` command with TTL support
- [ ] `bd sandbox list` command with filtering
- [ ] `bd sandbox destroy <id>` command with bulk support
- [ ] `bd sandbox connect <id>` command for env export
- [ ] Command documentation and help text

### Tasks

#### Task 85.1: CLI Infrastructure
**Description:** Set up command group structure and shared utilities.

**Files to create/modify:**
- `packages/cli/src/commands/sandbox/index.ts` (new)
- `packages/cli/src/commands/sandbox/utils.ts` (new)
- `packages/cli/src/commands/index.ts` (modify - register sandbox group)

**Acceptance Criteria:**
- [ ] `bd sandbox` command group registered
- [ ] `bd sandbox --help` shows subcommand list
- [ ] Shared utilities: `getSandboxManager()`, `getCurrentUser()`, `parseTTL()`
- [ ] Error handling with user-friendly messages
- [ ] Spinner utility for async operations

**Test Scenarios:**
- `bd sandbox --help` displays help
- Invalid subcommand shows helpful error

---

#### Task 85.2: Create Command
**Description:** Implement `bd sandbox create` with options.

**Files to create/modify:**
- `packages/cli/src/commands/sandbox/create.ts` (new)

**Acceptance Criteria:**
- [ ] `bd sandbox create` creates sandbox with auto-generated name
- [ ] `bd sandbox create my-sandbox` creates with custom name
- [ ] `--ttl <duration>` option (e.g., `24h`, `7d`, default: `24h`)
- [ ] `--guild <guildId>` option for immediate guild registration
- [ ] `--json` option for machine-readable output
- [ ] Displays sandbox ID, name, schema, expiry on success
- [ ] Shows `eval $(bd sandbox connect <id>)` hint

**Test Scenarios:**
- Creates sandbox with default settings
- Creates sandbox with custom name
- Creates sandbox with custom TTL
- Registers guild on creation
- Outputs JSON when requested
- Fails gracefully on duplicate name

---

#### Task 85.3: List Command
**Description:** Implement `bd sandbox list` with filtering.

**Files to create/modify:**
- `packages/cli/src/commands/sandbox/list.ts` (new)

**Acceptance Criteria:**
- [ ] `bd sandbox list` shows all sandboxes in table format
- [ ] `--owner <username>` filters by owner
- [ ] `--status <status>` filters by status
- [ ] `--all` includes destroyed sandboxes
- [ ] `--json` option for machine-readable output
- [ ] Table shows: ID (short), Name, Owner, Status, Guilds, Expires
- [ ] Status colored (running=green, expired=yellow, destroyed=gray)

**Test Scenarios:**
- Lists all running sandboxes
- Filters by owner
- Filters by status
- Shows empty message when no sandboxes
- Outputs JSON when requested

---

#### Task 85.4: Destroy Command
**Description:** Implement `bd sandbox destroy` with bulk support.

**Files to create/modify:**
- `packages/cli/src/commands/sandbox/destroy.ts` (new)

**Acceptance Criteria:**
- [ ] `bd sandbox destroy <id>` destroys single sandbox
- [ ] Accepts ID or name
- [ ] `--all` destroys all sandboxes owned by current user
- [ ] `--confirm` skips confirmation prompt
- [ ] Confirmation prompt for destructive actions
- [ ] Shows spinner during destruction
- [ ] Reports success/failure for each sandbox

**Test Scenarios:**
- Destroys sandbox by ID
- Destroys sandbox by name
- Destroys all with --all
- Prompts for confirmation
- Skips prompt with --confirm
- Handles non-existent sandbox gracefully

---

#### Task 85.5: Connect Command
**Description:** Implement `bd sandbox connect` for env export.

**Files to create/modify:**
- `packages/cli/src/commands/sandbox/connect.ts` (new)
- `packages/sandbox/src/SandboxManager.ts` (add `getConnectionDetails`)

**Acceptance Criteria:**
- [ ] `bd sandbox connect <id>` outputs env var exports
- [ ] Outputs: SANDBOX_ID, SANDBOX_SCHEMA, SANDBOX_REDIS_PREFIX, SANDBOX_NATS_PREFIX, SANDBOX_GUILD_IDS
- [ ] Format suitable for `eval $(bd sandbox connect <id>)`
- [ ] Validates sandbox exists and is running
- [ ] Error if sandbox not found or not running

**Test Scenarios:**
- Outputs correct env vars for running sandbox
- Fails for non-existent sandbox
- Fails for destroyed sandbox

---

#### Task 85.6: CLI Tests
**Description:** Integration tests for CLI commands.

**Files to create/modify:**
- `packages/cli/src/commands/sandbox/__tests__/create.test.ts` (new)
- `packages/cli/src/commands/sandbox/__tests__/list.test.ts` (new)
- `packages/cli/src/commands/sandbox/__tests__/destroy.test.ts` (new)
- `packages/cli/src/commands/sandbox/__tests__/connect.test.ts` (new)

**Acceptance Criteria:**
- [ ] Tests for all commands with mocked SandboxManager
- [ ] Tests for option parsing (TTL, filters)
- [ ] Tests for error handling
- [ ] Tests for output format (table, JSON)

**Test Scenarios:**
- All commands parse arguments correctly
- All commands handle errors gracefully
- JSON output is valid JSON

---

### Dependencies
- sprint-84: SandboxManager, SchemaProvisioner

### Risks & Mitigation
| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| TTL parsing edge cases | Med | Low | Use well-tested `ms` library |
| CLI output formatting | Low | Low | Use cli-table3 for consistency |

### Success Metrics
- All CLI commands functional
- `bd sandbox create` completes in <30 seconds
- User-friendly error messages

---

## Sprint 86: Event Routing

**Duration:** 2.5 days
**Theme:** Route Discord events to correct sandbox

### Sprint Goal
Enable sandboxes to receive Discord events for their registered guilds.

### Deliverables
- [ ] `RouteProvider` with Redis-cached guild mapping
- [ ] `EventRouter` service for event routing
- [ ] NATS SANDBOX stream configuration
- [ ] `bd sandbox register-guild` command
- [ ] Integration tests for end-to-end routing

### Tasks

#### Task 86.1: RouteProvider Implementation
**Description:** Implement guild-to-sandbox mapping with Redis cache.

**Files to create/modify:**
- `packages/sandbox/src/RouteProvider.ts` (new)

**Acceptance Criteria:**
- [ ] `getSandboxForGuild(guildId)` returns sandbox ID or null
- [ ] Redis cache with configurable TTL (default 60s)
- [ ] Cache miss queries PostgreSQL `sandbox_guild_mapping`
- [ ] Caches null results to prevent repeated DB hits
- [ ] `registerMapping(guildId, sandboxId)` updates DB and cache
- [ ] `removeMapping(guildId)` removes from DB and invalidates cache
- [ ] `invalidateCache(guildId)` clears cache entry
- [ ] `getGuildsForSandbox(sandboxId)` returns guild list
- [ ] `warmCache()` preloads all active mappings

**Test Scenarios:**
- Returns null for unmapped guild
- Returns sandbox ID for mapped guild
- Cache hit returns without DB query
- Cache miss queries DB and caches result
- Register updates DB and cache
- Remove clears DB and cache

---

#### Task 86.2: NATS SANDBOX Stream
**Description:** Configure NATS stream for sandbox events.

**Files to create/modify:**
- `apps/worker/src/services/NatsClient.ts` (modify - add SANDBOX stream)

**Acceptance Criteria:**
- [ ] SANDBOX stream added to STREAM_CONFIGS
- [ ] Subjects: `sandbox.>`
- [ ] Retention: Limits, Storage: Memory
- [ ] Max age: 5 minutes
- [ ] Replicas: 3
- [ ] Stream created on worker startup

**Test Scenarios:**
- Stream created successfully
- Events published to `sandbox.{id}.events.{type}` are retained

---

#### Task 86.3: EventRouter Service
**Description:** Implement event routing from raw events to sandbox/production subjects.

**Files to create/modify:**
- `apps/worker/src/services/EventRouter.ts` (new)

**Acceptance Criteria:**
- [ ] Subscribes to `events.raw.>` (or configurable source)
- [ ] Extracts `guild_id` from event payload
- [ ] Looks up sandbox via RouteProvider
- [ ] If sandbox found: publishes to `sandbox.{id}.events.{type}`
- [ ] If no sandbox: publishes to `events.{type}` (production)
- [ ] Logs routing decision with debug level
- [ ] Handles events without guild_id (routes to production)

**Test Scenarios:**
- Routes mapped guild event to sandbox subject
- Routes unmapped guild event to production subject
- Routes DM event (no guild_id) to production
- Handles RouteProvider errors gracefully

---

#### Task 86.4: Register Guild Command
**Description:** Implement `bd sandbox register-guild` CLI command.

**Files to create/modify:**
- `packages/cli/src/commands/sandbox/register-guild.ts` (new)
- `packages/sandbox/src/SandboxManager.ts` (modify - add registerGuild/unregisterGuild)

**Acceptance Criteria:**
- [ ] `bd sandbox register-guild <sandboxId> <guildId>` registers mapping
- [ ] `bd sandbox unregister-guild <guildId>` removes mapping
- [ ] Validates sandbox exists and is running
- [ ] Errors if guild already mapped to another sandbox
- [ ] Logs audit event `guild_registered` / `guild_unregistered`

**Test Scenarios:**
- Registers guild successfully
- Fails if guild already mapped
- Fails if sandbox not running
- Unregisters guild successfully

---

#### Task 86.5: Integration Tests
**Description:** End-to-end tests for event routing.

**Files to create/modify:**
- `packages/sandbox/src/__tests__/RouteProvider.test.ts` (new)
- `apps/worker/src/__tests__/EventRouter.test.ts` (new)
- `packages/sandbox/src/__tests__/integration/event-routing.test.ts` (new)

**Acceptance Criteria:**
- [ ] Unit tests for RouteProvider (90%+ coverage)
- [ ] Unit tests for EventRouter (90%+ coverage)
- [ ] Integration test: create sandbox → register guild → publish event → verify routed
- [ ] Integration test: unregister guild → verify routes to production

**Test Scenarios:**
- Full routing flow works end-to-end
- Cache invalidation works correctly
- Concurrent routing is handled

---

### Dependencies
- sprint-84: SandboxManager, database schema

### Risks & Mitigation
| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Event routing latency | Low | Med | Cache mapping in Redis |
| Missed events during cache update | Low | Low | Accept eventual consistency (60s) |

### Success Metrics
- Event routing latency overhead <5ms
- Cache hit rate >90% for active guilds
- Zero event loss during routing

---

## Sprint 87: Cleanup & Polish

**Duration:** 2.5 days
**Theme:** Auto-cleanup, health checks, metrics, documentation

### Sprint Goal
Complete the feature with production-ready cleanup, monitoring, and documentation.

### Deliverables
- [ ] `CleanupProvider` with idempotent resource cleanup
- [ ] EventBridge scheduled cleanup job
- [ ] `bd sandbox status` command with health checks
- [ ] Prometheus metrics integration
- [ ] CloudWatch alarms
- [ ] Documentation and runbook

### Tasks

#### Task 87.1: CleanupProvider Implementation
**Description:** Implement idempotent resource cleanup for sandboxes.

**Files to create/modify:**
- `packages/sandbox/src/CleanupProvider.ts` (new)

**Acceptance Criteria:**
- [ ] `cleanupExpired()` finds and cleans up expired sandboxes
- [ ] `cleanupSandbox(sandboxId)` cleans single sandbox resources
- [ ] Cleanup steps: mark destroying → remove guild mappings → delete Redis keys → drop schema → mark destroyed
- [ ] Each step is idempotent (safe to retry)
- [ ] `cleanupRedisKeys(sandboxId)` uses SCAN (non-blocking)
- [ ] `findOrphanedResources()` detects orphaned schemas/keys
- [ ] Logs each cleanup step

**Test Scenarios:**
- Cleans up expired sandbox
- Idempotent: running twice is safe
- Handles partial cleanup (retry works)
- Finds orphaned resources

---

#### Task 87.2: Cleanup Job
**Description:** Create scheduled job for automatic sandbox cleanup.

**Files to create/modify:**
- `apps/worker/src/jobs/sandbox-cleanup.ts` (new)
- `infrastructure/terraform/sandbox-cleanup.tf` (new)

**Acceptance Criteria:**
- [ ] Job runs CleanupProvider.cleanupExpired()
- [ ] Job logs count of cleaned up sandboxes
- [ ] EventBridge rule triggers every 15 minutes
- [ ] ECS task definition for cleanup job
- [ ] CloudWatch logs for cleanup job
- [ ] Job handles errors gracefully (doesn't crash on single failure)

**Test Scenarios:**
- Job cleans up expired sandboxes
- Job logs results
- Job continues on individual sandbox cleanup failure

---

#### Task 87.3: Status Command
**Description:** Implement `bd sandbox status` with health checks.

**Files to create/modify:**
- `packages/cli/src/commands/sandbox/status.ts` (new)
- `packages/sandbox/src/HealthChecker.ts` (new)

**Acceptance Criteria:**
- [ ] `bd sandbox status <id>` shows health status
- [ ] Health checks: schema exists, Redis accessible, guild mappings
- [ ] Shows: status, health (healthy/degraded/unhealthy), checks, expires in
- [ ] `--json` option for machine-readable output
- [ ] Colored output for health status

**Test Scenarios:**
- Shows healthy for running sandbox
- Shows degraded if schema missing
- Shows unhealthy if multiple checks fail

---

#### Task 87.4: Metrics Integration
**Description:** Add Prometheus metrics for sandbox operations.

**Files to create/modify:**
- `packages/sandbox/src/MetricsCollector.ts` (new)
- `apps/worker/src/metrics.ts` (modify - register sandbox metrics)

**Acceptance Criteria:**
- [ ] `sandbox_active_total` gauge (labels: owner)
- [ ] `sandbox_create_duration_seconds` histogram
- [ ] `sandbox_destroy_duration_seconds` histogram
- [ ] `sandbox_event_route_duration_seconds` histogram (labels: sandbox_id)
- [ ] `sandbox_cleanup_errors_total` counter (labels: error_type)
- [ ] Metrics exposed on /metrics endpoint

**Test Scenarios:**
- Metrics increment correctly
- Metrics have proper labels
- Metrics exposed via Prometheus endpoint

---

#### Task 87.5: CloudWatch Alarms
**Description:** Configure alerts for sandbox issues.

**Files to create/modify:**
- `infrastructure/terraform/sandbox-alarms.tf` (new)

**Acceptance Criteria:**
- [ ] Alarm: SandboxCleanupFailing (cleanup_errors > 5 in 15m)
- [ ] Alarm: SandboxCreateLatency (p99 > 60s for 5m)
- [ ] Alarm: SandboxOrphanedResources (orphaned > 0 for 1h)
- [ ] SNS topic for alarm notifications
- [ ] Alarms tagged with common tags

**Test Scenarios:**
- Alarms created in terraform plan
- Alarm dimensions correct

---

#### Task 87.6: Documentation
**Description:** Create user documentation and runbook.

**Files to create/modify:**
- `docs/sandbox-guide.md` (new)
- `docs/sandbox-runbook.md` (new)

**Acceptance Criteria:**
- [ ] User guide: getting started, CLI reference, examples
- [ ] Runbook: troubleshooting, manual cleanup, metrics interpretation
- [ ] Error code reference from SDD §B
- [ ] FAQ section

**Test Scenarios:**
- Documentation renders correctly
- Code examples work

---

### Dependencies
- sprint-84, sprint-85, sprint-86: All core components

### Risks & Mitigation
| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Cleanup job failures | Med | Low | Idempotent design, retry logic |
| Metrics cardinality | Low | Med | Limit sandbox_id labels to top N |

### Success Metrics
- Auto-cleanup removes 100% of expired sandboxes
- No orphaned resources after 24 hours
- Alerts fire correctly on failures

---

## Risk Register

| ID | Risk | Sprint | Probability | Impact | Mitigation | Owner |
|----|------|--------|-------------|--------|------------|-------|
| R1 | PostgreSQL permission issues | 1 | Low | High | Test with staging permissions | Engineer |
| R2 | Discord rate limiting across sandboxes | 3 | Med | High | Use GlobalDiscordTokenBucket | Engineer |
| R3 | Schema explosion | 1-4 | Low | Med | Limit sandboxes per dev, auto-cleanup | Engineer |
| R4 | Event routing latency | 3 | Low | Med | Redis cache, load testing | Engineer |
| R5 | Cross-sandbox data leakage | 1-3 | Low | Critical | RLS, schema isolation, security audit | Security |

---

## Success Metrics Summary

| Metric | Target | Measurement Method | Sprint |
|--------|--------|-------------------|--------|
| Sandbox creation time | <30 seconds | CLI timing | 2 |
| Sandbox destruction time | <15 seconds | CLI timing | 2 |
| Event routing latency | <5ms overhead | Prometheus histogram | 3 |
| Code coverage | 90%+ | Jest coverage report | 1-4 |
| Cleanup success rate | 100% | CloudWatch metrics | 4 |
| Data isolation | 0 leaks | Security audit | 1-3 |

---

## Dependencies Map

```
sprint-84 ──────────────▶ sprint-85 ──────────────▶ sprint-87
(Foundation)              (CLI Commands)            (Polish)
    │                                                   │
    └──────────────────▶ sprint-86 ────────────────────┘
                         (Event Routing)
```

---

## Appendix

### A. PRD Feature Mapping

| PRD Feature | Sprint | Tasks | Status |
|-------------|--------|-------|--------|
| FR-1.1 CLI create | 85 | Task 85.2 | Planned |
| FR-1.2 Auto-generate name | 85 | Task 85.2 | Planned |
| FR-1.3 Return connection details | 85 | Task 85.5 | Planned |
| FR-1.4 --discord-token flag | - | Out of scope (P2) | Deferred |
| FR-1.5 --ttl flag | 85 | Task 85.2 | Planned |
| FR-2.1 Database isolation | 84 | Tasks 84.1-84.4 | Planned |
| FR-2.2 Redis namespace | 86 | Task 86.1 | Planned |
| FR-2.3 RabbitMQ isolation | - | Out of scope | Deferred |
| FR-2.4 NATS subject namespace | 86 | Tasks 86.2-86.3 | Planned |
| FR-2.5 Tenant context | 84 | Task 84.5 | Planned |
| FR-3.1 CLI list | 85 | Task 85.3 | Planned |
| FR-3.2 CLI destroy | 85 | Task 85.4 | Planned |
| FR-3.3 CLI status | 87 | Task 87.3 | Planned |
| FR-3.4 Auto-cleanup | 87 | Tasks 87.1-87.2 | Planned |
| FR-3.5 CLI connect | 85 | Task 85.5 | Planned |
| FR-4.1 Shared Discord token | 86 | Design | Planned |
| FR-4.2 Event routing | 86 | Tasks 86.1-86.3 | Planned |
| FR-4.3 Guild registration | 86 | Task 86.4 | Planned |
| FR-4.4 Guild-based routing | 86 | Tasks 86.1-86.3 | Planned |
| FR-4.5 Dedicated tokens | - | Out of scope (P2) | Deferred |

### B. SDD Component Mapping

| SDD Component | Sprint | Tasks | Status |
|---------------|--------|-------|--------|
| Database Schema (§5.1) | 84 | Tasks 84.1-84.3 | Planned |
| SchemaProvisioner (§4.2) | 84 | Task 84.4 | Planned |
| SandboxManager (§4.1) | 84 | Task 84.5 | Planned |
| RouteProvider (§4.3) | 86 | Task 86.1 | Planned |
| EventRouter (§7.1) | 86 | Task 86.3 | Planned |
| CleanupProvider (§4.5) | 87 | Task 87.1 | Planned |
| CLI Commands (§6) | 85 | Tasks 85.1-85.5 | Planned |
| Health Checks (§4.4) | 87 | Task 87.3 | Planned |
| Metrics (§9.1) | 87 | Task 87.4 | Planned |

### C. Task ID Quick Reference

For `/implement` command compatibility:

**Sprint Range:** 84-87 (continuing from highest existing sprint: 83)

| Sprint | Task IDs | Description |
|--------|----------|-------------|
| sprint-84 | 84.1-84.6 | Foundation (6 tasks) |
| sprint-85 | 85.1-85.6 | CLI Commands (6 tasks) |
| sprint-86 | 86.1-86.5 | Event Routing (5 tasks) |
| sprint-87 | 87.1-87.6 | Cleanup & Polish (6 tasks) |

**Usage:**
```bash
/implement sprint-84  # Implements tasks 84.1-84.6 (Foundation)
/implement sprint-85  # Implements tasks 85.1-85.6 (CLI Commands)
/implement sprint-86  # Implements tasks 86.1-86.5 (Event Routing)
/implement sprint-87  # Implements tasks 87.1-87.6 (Cleanup & Polish)
```

---

*Generated by Sprint Planner Agent*

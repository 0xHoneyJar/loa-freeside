# Sprint 87: Discord Server Sandboxes - Cleanup & Polish

## Implementation Report

**Sprint**: S-SB-4 (Cleanup & Polish)
**Completed**: 2026-01-17
**Implementer**: Claude Code

---

## Summary

Implemented the final sprint of the Discord Server Sandboxes feature. This sprint focuses on cleanup operations, monitoring, and operational polish to make the feature production-ready.

---

## Deliverables

### 1. CleanupProvider Service

**File**: `packages/sandbox/src/services/cleanup-provider.ts`

Core cleanup logic with idempotent operations:

- **`cleanupExpired()`**: Finds and cleans up all expired sandboxes
- **`cleanupSandbox(sandboxId)`**: Single sandbox cleanup with step tracking
- **`cleanupRedisKeys(sandboxId)`**: SCAN-based Redis key deletion
- **`findOrphanedResources()`**: Detects orphaned schemas and Redis keys
- **`cleanupOrphanedResources()`**: Removes detected orphaned resources

Cleanup steps (idempotent, safe to retry):
1. Mark sandbox as 'destroying'
2. Remove guild mappings
3. Invalidate route cache
4. Delete Redis keys with SCAN
5. Drop PostgreSQL schema
6. Mark sandbox as 'destroyed'

### 2. Cleanup Job

**File**: `apps/worker/src/jobs/sandbox-cleanup.ts`

Standalone job designed for EventBridge scheduling:

- Runs every 15 minutes via EventBridge rule
- Calls `CleanupProvider.cleanupExpired()`
- Optional orphaned resource cleanup (`CLEANUP_ORPHANED=true`)
- Emits CloudWatch custom metrics when running in AWS
- Proper connection lifecycle management

### 3. Status Command

**Files**:
- `packages/cli/src/commands/sandbox/status.ts`
- `packages/cli/src/commands/sandbox/index.ts` (updated)

New CLI command: `bd sandbox status <name>`

Features:
- Detailed sandbox information display
- Health check results with latency
- Guild mapping list
- Time until expiration
- JSON output mode (`--json`)
- Watch mode (`--watch`) with configurable interval

### 4. Prometheus Metrics

**File**: `packages/sandbox/src/metrics.ts`

Comprehensive metrics for sandbox operations:

| Metric | Type | Description |
|--------|------|-------------|
| `sandbox_created_total` | Counter | Total sandboxes created |
| `sandbox_destroyed_total` | Counter | Total sandboxes destroyed |
| `sandbox_active_count` | Gauge | Currently active sandboxes |
| `sandbox_creation_duration_seconds` | Histogram | Sandbox creation time |
| `sandbox_cleanup_runs_total` | Counter | Cleanup job executions |
| `sandbox_cleanup_sandboxes_total` | Counter | Sandboxes cleaned up |
| `sandbox_cleanup_duration_seconds` | Histogram | Cleanup job duration |
| `sandbox_orphaned_resources` | Gauge | Orphaned resource count |
| `sandbox_route_lookups_total` | Counter | Route lookups |
| `sandbox_route_lookup_duration_seconds` | Histogram | Route lookup latency |
| `sandbox_events_routed_total` | Counter | Events routed |
| `sandbox_event_routing_errors_total` | Counter | Routing errors |

Helper functions for recording metrics included.

### 5. CloudWatch Alarms

**File**: `infrastructure/terraform/monitoring.tf` (updated)

New alarms for sandbox operations:

| Alarm | Threshold | Description |
|-------|-----------|-------------|
| `sandbox-cleanup-failures` | > 0 | Cleanup job failures |
| `sandbox-orphaned-resources` | > 5 (1h) | Persistent orphaned resources |
| `sandbox-schema-failures` | > 3/5min | Schema creation errors |
| `sandbox-routing-errors` | > 50/5min | Event routing errors |
| `sandbox-count-high` | > 100 | High active sandbox count |

### 6. CloudWatch Dashboard

**File**: `infrastructure/terraform/monitoring.tf` (updated)

New `sandbox` dashboard with widgets for:
- Active sandbox count
- Sandbox lifecycle (created/destroyed)
- Guild mappings
- Cleanup job metrics
- Orphaned resources
- Event routing statistics
- Route lookup performance

### 7. Operations Runbook

**File**: `docs/sandbox-runbook.md`

Comprehensive runbook with procedures for:
- RB-SB-001: High Active Sandbox Count Alert
- RB-SB-002: Cleanup Job Failures
- RB-SB-003: Orphaned Resources Detected
- RB-SB-004: Event Routing Errors
- RB-SB-005: Schema Creation Failures
- RB-SB-006: Sandbox Status Command Issues

Plus emergency procedures and maintenance guidelines.

### 8. Unit Tests

**File**: `packages/sandbox/src/__tests__/cleanup-provider.test.ts`

15 new tests covering:
- Cleanup step ordering
- Guild mapping cleanup
- Redis key deletion
- Failure handling
- Expired sandbox cleanup
- Orphaned resource detection
- Orphaned resource cleanup

---

## Test Results

```
 ✓ src/__tests__/types.test.ts  (14 tests)
 ✓ src/__tests__/event-router.test.ts  (20 tests)
 ✓ src/__tests__/schema-provisioner.test.ts  (20 tests)
 ✓ src/__tests__/route-provider.test.ts  (17 tests)
 ✓ src/__tests__/cleanup-provider.test.ts  (15 tests)
 ✓ src/__tests__/sandbox-manager.test.ts  (24 tests)
 ✓ src/__tests__/integration/sandbox-routing.test.ts  (7 tests)

 Test Files  7 passed (7)
      Tests  117 passed (117)
```

---

## Files Changed

| File | Change |
|------|--------|
| `packages/sandbox/src/services/cleanup-provider.ts` | NEW - CleanupProvider service |
| `packages/sandbox/src/services/index.ts` | UPDATED - Added CleanupProvider export |
| `packages/sandbox/src/index.ts` | UPDATED - Added CleanupProvider and metrics exports |
| `packages/sandbox/src/metrics.ts` | NEW - Prometheus metrics |
| `packages/sandbox/src/__tests__/cleanup-provider.test.ts` | NEW - 15 unit tests |
| `apps/worker/src/jobs/sandbox-cleanup.ts` | NEW - Cleanup job |
| `packages/cli/src/commands/sandbox/status.ts` | NEW - Status command |
| `packages/cli/src/commands/sandbox/index.ts` | UPDATED - Register status command |
| `infrastructure/terraform/monitoring.tf` | UPDATED - Added alarms and dashboard |
| `docs/sandbox-runbook.md` | NEW - Operations runbook |

---

## Architecture Decisions

### 1. Idempotent Cleanup Steps

**Decision**: Each cleanup step is idempotent and tracked individually.

**Rationale**: Allows safe retry on partial failure. If cleanup fails at step 3, the next attempt can skip steps 1-2 if they already completed.

### 2. SCAN for Redis Key Deletion

**Decision**: Use SCAN instead of KEYS for finding sandbox Redis keys.

**Rationale**: KEYS blocks Redis on large keyspaces. SCAN iterates non-blocking with pagination. Safe for production use.

### 3. Separate Metrics Registry

**Decision**: Create separate `sandboxRegistry` for sandbox metrics.

**Rationale**: Can be merged with application registry or exported separately. Provides flexibility for different deployment scenarios.

### 4. Orphaned Resource Detection

**Decision**: Separate detection from cleanup for orphaned resources.

**Rationale**: Allows audit before destructive operations. `findOrphanedResources()` is safe; `cleanupOrphanedResources()` requires explicit invocation.

### 5. CloudWatch Embedded Metric Format

**Decision**: Use EMF (Embedded Metric Format) for job metrics.

**Rationale**: CloudWatch Logs Insights can parse EMF from stdout. No need for CloudWatch agent or custom metric publishing.

---

## Dependencies

No new dependencies added. Uses existing:
- `prom-client` - Prometheus metrics (already in worker)
- `ioredis` - Redis client
- `postgres` - PostgreSQL client
- `commander` - CLI framework
- `chalk` - Terminal colors
- `ora` - Terminal spinner

---

## Next Steps

The Discord Server Sandboxes feature is now complete:

- [x] Sprint 84: Foundation (Schema, Types, SandboxManager)
- [x] Sprint 85: CLI Commands (create, list, destroy, connect)
- [x] Sprint 86: Event Routing (RouteProvider, EventRouter)
- [x] Sprint 87: Cleanup & Polish (CleanupProvider, Metrics, Monitoring)

### Recommended Follow-ups (Future Sprints)

1. **Sandbox WebSocket Proxy** - Route Discord Gateway connections to sandboxes
2. **Sandbox API** - REST endpoints for sandbox management
3. **Multi-tenant Isolation** - Tenant-level sandbox quotas
4. **Sandbox Templates** - Pre-configured sandbox types

---

## Conformance

- [x] Implements SDD §4.5 CleanupProvider
- [x] Implements SDD §6.5 Status Command
- [x] Implements SDD §8.2 Monitoring & Metrics
- [x] Follows existing test patterns
- [x] Uses existing infrastructure patterns
- [x] CLI follows Commander.js patterns from Sprint 85

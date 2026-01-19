# Sprint 86: Discord Server Sandboxes - Event Routing

## Implementation Report

**Sprint**: S-SB-3 (Event Routing)
**Completed**: 2026-01-17
**Implementer**: Claude Code
**Revision**: 2 (Addresses feedback from Senior Technical Lead)

---

## Summary

Implemented the event routing layer for Discord Server Sandboxes, enabling Discord events to be dynamically routed to sandbox-specific NATS subjects based on guild-to-sandbox mappings. This completes the event isolation architecture.

**Revision 2 addresses:**
- Cache synchronization between SandboxManager and RouteProvider
- Graceful Redis failure handling with database fallback
- Rolling average for latency statistics (prevents unbounded growth)
- Integration tests for SandboxManager + RouteProvider interaction

---

## Deliverables

### 1. RouteProvider Service

**File**: `packages/sandbox/src/services/route-provider.ts`

Core routing logic with Redis caching for fast guild-to-sandbox lookups:

- **Cache-first lookups**: `getSandboxForGuild()` checks Redis before database
- **NULL sentinel pattern**: Caches negative lookups as `__NULL__` to prevent repeated DB hits
- **Batch lookups**: `getSandboxesForGuilds()` for bulk routing
- **Cache management**: `invalidateCache()`, `invalidateSandboxRoutes()`
- **Cache warming**: `warmCache()` pre-populates cache at startup
- **Statistics**: `getStats()` returns mapping counts

Key implementation details:
```typescript
// Cache key pattern
CACHE_KEY_PREFIX = 'sandbox:route:'

// Default TTL
DEFAULT_CACHE_TTL_MS = 60_000 // 1 minute

// Query only running sandboxes
WHERE s.status = 'running'
```

### 2. EventRouter Service

**File**: `packages/sandbox/src/services/event-router.ts`

NATS consumer that routes Discord events:

- **Stream creation**: `ensureSandboxStream()` creates SANDBOX stream
- **Consumer setup**: `ensureConsumer()` creates durable consumer on EVENTS stream
- **Event routing**: Routes based on `guild_id` extraction
- **Direct routing**: `routeDirect()` for testing/manual routing
- **Statistics**: Tracks total processed, sandbox vs production routing, errors

Stream configuration:
```typescript
SANDBOX_STREAM_CONFIG = {
  name: 'SANDBOX',
  subjects: ['sandbox.>'],
  retention: 1,        // Limits
  storage: 0,          // Memory
  maxAge: 5 minutes,
  maxMsgs: 500_000,
  replicas: 3
}
```

Routing logic:
- Events without `guild_id` → production subject (unchanged)
- Events with `guild_id` not mapped → production subject
- Events with `guild_id` mapped → `sandbox.{sandboxId}.{originalSubject}`

### 3. CLI Commands

**Files**:
- `packages/cli/src/commands/sandbox/register.ts`
- `packages/cli/src/commands/sandbox/unregister.ts`
- `packages/cli/src/commands/sandbox/index.ts` (updated)

Guild registration commands:
- `bd sandbox register-guild <sandbox> <guildId>` (alias: `reg`)
- `bd sandbox unregister-guild <sandbox> <guildId>` (alias: `unreg`)

Features:
- Guild ID validation (17-20 digits)
- Sandbox status validation (must be running)
- JSON output mode for scripting
- Colored terminal output with ora spinner

### 4. Package Exports

**Updated files**:
- `packages/sandbox/src/services/index.ts`
- `packages/sandbox/src/index.ts`

New exports:
```typescript
export { RouteProvider } from './route-provider.js';
export { EventRouter, SANDBOX_STREAM_CONFIG } from './event-router.js';
export type {
  RouteProviderConfig,
  RouteLookupResult,
  RouteMapping,
  EventRouterConfig,
  DiscordEvent,
  RoutingStats,
  RoutingResult,
} from './services/index.js';
```

### 5. Unit & Integration Tests

**Files**:
- `packages/sandbox/src/__tests__/route-provider.test.ts` (17 tests)
- `packages/sandbox/src/__tests__/event-router.test.ts` (20 tests)
- `packages/sandbox/src/__tests__/integration/sandbox-routing.test.ts` (7 tests) **[NEW]**

Test coverage:
- Cache hit/miss scenarios
- NULL sentinel handling
- Batch lookups
- Cache invalidation
- Stream/consumer creation
- Event routing (production vs sandbox)
- Statistics tracking
- SANDBOX_STREAM_CONFIG validation
- **[NEW] SandboxManager + RouteProvider cache synchronization**
- **[NEW] Redis failure graceful degradation**

---

## Architecture Decisions

### 1. NULL Sentinel Pattern

**Decision**: Cache "not found" results as `__NULL__` sentinel.

**Rationale**: Prevents cache stampede for unmapped guilds. Without this, every event from an unmapped guild would hit the database.

### 2. Memory Storage for SANDBOX Stream

**Decision**: Use memory storage (`storage: 0`) for SANDBOX stream.

**Rationale**: Sandbox events are ephemeral (5-minute max age). Memory storage provides lowest latency. Data loss on node restart is acceptable.

### 3. Consumer on EVENTS Stream

**Decision**: Create a durable consumer on existing EVENTS stream rather than a separate stream.

**Rationale**: Reuses existing gateway event flow. Events are filtered by `events.>` subjects. Router republishes to `sandbox.{id}.events.{type}` or passes through unchanged.

### 4. Lazy Dynamic Import for CLI

**Decision**: Use dynamic `import()` for command implementations.

**Rationale**: Faster CLI startup. Commands are only loaded when invoked.

### 5. SandboxManager + RouteProvider Integration (Revision 2)

**Decision**: SandboxManager accepts optional RouteProvider and updates cache internally.

**Rationale**: Encapsulates cache synchronization within SandboxManager. CLI commands don't need to know about RouteProvider - they just call SandboxManager methods.

### 6. Rolling Average for Latency (Revision 2)

**Decision**: Use circular buffer of 1000 samples instead of cumulative sum.

**Rationale**: Prevents unbounded memory growth. Recent latency is more relevant than historical average.

### 7. Graceful Redis Degradation (Revision 2)

**Decision**: Wrap Redis operations in try-catch, fall back to database-only mode.

**Rationale**: Redis outages should not break event routing. Database is the source of truth; cache is optimization.

---

## Test Results

```
 ✓ src/__tests__/types.test.ts  (14 tests)
 ✓ src/__tests__/route-provider.test.ts  (17 tests)
 ✓ src/__tests__/event-router.test.ts  (20 tests)
 ✓ src/__tests__/schema-provisioner.test.ts  (20 tests)
 ✓ src/__tests__/sandbox-manager.test.ts  (24 tests)
 ✓ src/__tests__/integration/sandbox-routing.test.ts  (7 tests)

 Test Files  6 passed (6)
      Tests  102 passed (102)
```

---

## Files Changed

| File | Change |
|------|--------|
| `packages/sandbox/src/services/route-provider.ts` | NEW - RouteProvider service (with Redis error handling) |
| `packages/sandbox/src/services/event-router.ts` | NEW - EventRouter service (with rolling latency) |
| `packages/sandbox/src/services/sandbox-manager.ts` | UPDATED - Added RouteProvider integration |
| `packages/sandbox/src/services/index.ts` | UPDATED - Added exports |
| `packages/sandbox/src/index.ts` | UPDATED - Added exports |
| `packages/cli/src/commands/sandbox/register.ts` | NEW - register-guild command |
| `packages/cli/src/commands/sandbox/unregister.ts` | NEW - unregister-guild command |
| `packages/cli/src/commands/sandbox/index.ts` | UPDATED - Register new commands |
| `packages/sandbox/src/__tests__/route-provider.test.ts` | NEW - 17 tests |
| `packages/sandbox/src/__tests__/event-router.test.ts` | NEW - 20 tests |
| `packages/sandbox/src/__tests__/integration/sandbox-routing.test.ts` | NEW - 7 integration tests |

---

## Dependencies

No new dependencies added. Uses existing:
- `nats` - NATS client
- `ioredis` - Redis client
- `postgres` - PostgreSQL client
- `commander` - CLI framework
- `chalk` - Terminal colors
- `ora` - Terminal spinner

---

## Next Steps (Sprint 87: S-SB-4)

1. Integration tests for end-to-end event flow
2. Sandbox WebSocket proxy for Discord Gateway
3. Sandbox lifecycle automation (TTL expiry)
4. Monitoring dashboard integration

---

## Feedback Addressed (Revision 2)

| Feedback Item | Resolution |
|---------------|------------|
| Cache synchronization missing | SandboxManager now accepts optional RouteProvider and updates cache on register/unregister |
| Missing Redis error handling | Added try-catch with graceful fallback to database-only mode |
| Unbounded latencySum growth | Replaced with rolling average using 1000-sample circular buffer |
| No integration tests | Added 7 integration tests for SandboxManager + RouteProvider |
| Type inconsistency (uuid) | Already consistent - uses `${sandboxId}::uuid` casting in all queries |

---

## Conformance

- [x] Implements SDD §4.3 RouteProvider
- [x] Implements SDD §7.1 Event Router Service
- [x] Follows existing test patterns
- [x] Uses existing infrastructure (NATS, Redis, PostgreSQL)
- [x] CLI follows Commander.js patterns from Sprint 85
- [x] Addresses all high-priority feedback from Senior Technical Lead

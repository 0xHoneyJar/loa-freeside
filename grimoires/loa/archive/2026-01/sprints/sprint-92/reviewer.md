# Sprint 92: IaC Engine - Diff Calculation & State Application

## Implementation Summary

This sprint completed the second phase of the Discord Infrastructure-as-Code (IaC) system, implementing the core engine components for diff calculation, rate limiting, retry handling, and state application.

## Tasks Completed

### S-92.1: PermissionUtils Helper
**Status**: Already implemented in schemas.ts from Sprint 91
- `permissionsToBitfield()`: Converts permission names to Discord bitfield
- `bitfieldToPermissions()`: Converts bitfield back to permission names
- Full Discord permission flag coverage (45+ permissions)

### S-92.2: DiffEngine Component
**File**: `src/commands/server/iac/DiffEngine.ts`

Implements three-way diff calculation between desired YAML config and current Discord state:

**Core Functions**:
- `calculateDiff(config, state, guildId, options)`: Main entry point
- `diffRoles()`: Role comparison with color/permission/hoist/mentionable changes
- `diffCategories()`: Category position and permission changes
- `diffChannels()`: Channel topic/type/nsfw/position changes
- `diffPermissionOverwrites()`: Permission overwrite comparison

**Key Features**:
- Operation types: `create`, `update`, `delete`, `noop`
- Change tracking with `from`/`to` values for each field
- `managedOnly` option to only diff IaC-managed resources
- `includePermissions` option for granular permission diffs
- Summary statistics: total/create/update/delete/noop counts

**Exports**:
- `formatDiff()`: Human-readable diff output
- `getActionableChanges()`: Filters out noop operations

### S-92.3: RateLimiter Component
**File**: `src/commands/server/iac/RateLimiter.ts`

Token bucket rate limiter for Discord API compliance:

**Configuration**:
- `maxTokens`: 50 (default bucket size)
- `refillRate`: 5 tokens/second
- `createCooldownMs`: 3000ms between create operations
- `minRequestIntervalMs`: 100ms between any requests

**Key Methods**:
- `wait(operationType)`: Async wait for token availability
- `handleRateLimit(waitMs)`: Handle 429 responses from Discord
- `canRequest(operationType)`: Check if request can proceed
- `getState()`: Current limiter state for monitoring

**Singleton Support**:
- `getDefaultRateLimiter()`: Global singleton instance
- `resetDefaultRateLimiter()`: Reset for testing

### S-92.4: RetryHandler Component
**File**: `src/commands/server/iac/RetryHandler.ts`

Exponential backoff retry logic for transient Discord API errors:

**Configuration**:
- `maxAttempts`: 3 (default)
- `baseDelayMs`: 1000ms
- `maxDelayMs`: 30000ms (30 second cap)
- `jitterFactor`: 0.1 (10% random jitter)

**Retryable Conditions**:
- HTTP 429 (rate limited)
- HTTP 500, 502, 503, 504 (server errors)
- Network errors: ECONNRESET, ECONNREFUSED, timeout

**Key Methods**:
- `execute(operation)`: Returns result with success/attempts/error
- `executeOrThrow(operation)`: Throws on failure
- `onRetry` callback for logging/monitoring

**Utilities**:
- `isRetryableError(error)`: Check if error should retry
- `getRetryAfterMs(error)`: Extract Discord retry-after header
- `withRetry(operation, options)`: Convenience wrapper

### S-92.5: StateWriter Component
**File**: `src/commands/server/iac/StateWriter.ts`

Applies ServerDiff changes to Discord via REST API:

**Constructor**: `new StateWriter(client, rateLimiter, retryHandler)`

**Core Method**: `apply(diff, options)`
- Applies changes in dependency order: roles → categories → channels → permissions
- Returns `ApplyResult` with success/failure tracking per operation
- Supports dry-run mode via `options.dryRun`

**Error Handling**:
- Continues on individual failures (configurable)
- Tracks failed operations with error details
- Rate limit integration via RateLimiter
- Retry logic via RetryHandler

**ApplyResult Structure**:
```typescript
interface ApplyResult {
  success: boolean;
  summary: {
    total: number;
    succeeded: number;
    failed: number;
  };
  operations: OperationResult[];
  errors: ApplyError[];
  durationMs: number;
}
```

### S-92.6: Integration Tests
**File**: `src/commands/server/iac/__tests__/integration.test.ts`

End-to-end tests covering the full IaC pipeline:
- Config parsing → state reading → diff calculation → state writing
- 29 test cases (26 skipped pending Discord API mocks)
- 3 infrastructure tests verifying component integration

## Test Coverage

| Component | Tests | Status |
|-----------|-------|--------|
| schemas.ts | 55 | Pass |
| ConfigParser.ts | 33 | Pass |
| StateReader.ts | 18 | Pass |
| DiffEngine.ts | 19 | Pass |
| RateLimiter.ts | 19 | Pass |
| RetryHandler.ts | 32 | Pass |
| StateWriter.ts | 22 | Pass |
| integration.ts | 3 active + 26 skipped | Pass |

**Total**: 198 tests passing

## Type Safety

- All IaC files pass TypeScript strict mode
- No type errors in `src/commands/server/iac/**`
- Full generic type coverage for state/config/diff types

## Files Changed

### New Files
- `src/commands/server/iac/DiffEngine.ts` (600+ lines)
- `src/commands/server/iac/RateLimiter.ts` (200+ lines)
- `src/commands/server/iac/RetryHandler.ts` (200+ lines)
- `src/commands/server/iac/StateWriter.ts` (400+ lines)
- `src/commands/server/iac/__tests__/DiffEngine.test.ts`
- `src/commands/server/iac/__tests__/RateLimiter.test.ts`
- `src/commands/server/iac/__tests__/RetryHandler.test.ts`
- `src/commands/server/iac/__tests__/StateWriter.test.ts`
- `src/commands/server/iac/__tests__/integration.test.ts`

### Modified Files
- `src/commands/server/iac/index.ts` (exports)
- `src/commands/server/iac/types.ts` (new types)

## Architecture Notes

### Rate Limiting Strategy
The RateLimiter uses a token bucket algorithm that:
1. Refills tokens at a steady rate (5/sec)
2. Enforces extra cooldown between create operations (3s)
3. Handles Discord 429 responses by draining bucket
4. Supports operation-type-specific logic

### Retry Strategy
The RetryHandler implements exponential backoff that:
1. Respects Discord's `retry-after` header when present
2. Doubles delay each attempt up to maxDelayMs
3. Adds random jitter to prevent thundering herd
4. Distinguishes retryable from non-retryable errors

### Apply Order
StateWriter applies changes in dependency order:
1. **Roles first**: Other resources may reference roles in permissions
2. **Categories second**: Channels may belong to categories
3. **Channels third**: After their parent categories exist
4. **Permissions last**: After all target resources exist

## Known Limitations

1. **Integration tests skipped**: 26 tests require Discord API mocking framework
2. **Sandbox test failures**: Pre-existing issues in `src/commands/sandbox/` (unrelated to IaC)
3. **No position reordering**: Position changes are detected but complex reordering not optimized

## Next Steps (Sprint 93)

1. CLI integration (`arrakis server iac apply`)
2. Plan/apply workflow with confirmation prompts
3. State file locking for concurrent operations
4. Rollback support for failed applies

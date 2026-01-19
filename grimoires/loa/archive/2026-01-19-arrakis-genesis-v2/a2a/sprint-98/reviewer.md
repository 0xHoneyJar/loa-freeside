# Sprint 98: Apply & Destroy Operations - Implementation Report

**Sprint**: 98
**Date**: 2026-01-19
**Status**: Implementation Complete (Revision 2 - Feedback Addressed)

## Summary

Implemented the Apply & Destroy Operations for the Gaib CLI, providing Terraform-like workflow commands with state locking to prevent concurrent modifications.

## Revision 2 - Feedback Addressed

### Issue #1: Destroy Command Missing Second Confirmation (FIXED)
- **File**: `destroy.ts` lines 44-96
- **Fix**: Added two-stage confirmation flow:
  1. Stage 1: User must type workspace name exactly
  2. Stage 2: User must answer "Are you ABSOLUTELY sure?" with "yes"
- **Why**: Provides additional cognitive friction to prevent accidental data loss

### Issue #2: Apply Command Double Error Handling (FIXED)
- **File**: `apply.ts` lines 288-289
- **Fix**: Removed redundant `handleError` call that was always executing
- **Before**: Two `handleError` calls, second always ran
- **After**: Single `handleError` call in catch block

## Tasks Completed

### S-98.1: StateLock Utility
- Created `StateLock.ts` utility class that wraps StateBackend lock operations
- Key features:
  - `acquire()` / `release()` / `forceRelease()` methods
  - `withLock()` for automatic lock management with cleanup
  - `withLockCheck()` for read-only operations that check lock status
  - `isLockStale()` utility to detect abandoned locks (>1 hour)
  - `formatLockInfo()` for human-readable lock display

### S-98.2: ApplyEngine
- Created `ApplyEngine.ts` that orchestrates the apply workflow:
  1. Acquires state lock (optional)
  2. Delegates to StateWriter for Discord API changes
  3. Updates state with new resource IDs
  4. Releases lock on completion/error
- Supports dry-run mode and skip-lock option
- Tracks state serial numbers for consistency

### S-98.3: Apply Command
- Implemented `gaib server apply` CLI command
- Features:
  - Interactive confirmation with diff preview
  - `--auto-approve` flag for CI/CD
  - `--dry-run` for testing
  - `--json` for machine-readable output
  - Workspace-aware operation

### S-98.4: DestroyEngine
- Created `DestroyEngine.ts` for destroying managed resources:
  - Generates "delete all" diff from current state
  - Processes deletes in reverse dependency order (channels -> categories -> roles)
  - Supports targeting specific resource types
  - Provides preview functionality

### S-98.5: Destroy Command
- Implemented `gaib server destroy` CLI command
- Features:
  - Requires typing workspace name to confirm (safety measure)
  - `--auto-approve` flag for CI/CD
  - `--target` flag for selective destruction
  - `--dry-run` for testing
  - `--json` for machine-readable output

### S-98.6: Force-Unlock Command
- Implemented `gaib server force-unlock` CLI command for releasing stuck locks
- Implemented `gaib server lock-status` CLI command for checking lock state
- Both commands are workspace-aware

### S-98.7: CLI Registration
- Updated `index.ts` to register all new commands
- Added comprehensive help text with examples

## Files Created

| File | Lines | Purpose |
|------|-------|---------|
| `iac/StateLock.ts` | ~200 | State locking utility |
| `iac/ApplyEngine.ts` | ~180 | Apply orchestration |
| `iac/DestroyEngine.ts` | ~250 | Destroy orchestration |
| `apply.ts` | ~200 | Apply CLI command |
| `destroy.ts` | ~230 | Destroy CLI command |
| `force-unlock.ts` | ~180 | Force-unlock & lock-status commands |

## Files Modified

| File | Changes |
|------|---------|
| `iac/index.ts` | Added exports for StateLock, ApplyEngine, DestroyEngine |
| `index.ts` | Registered apply, destroy, force-unlock, lock-status commands |

## Test Coverage

Created comprehensive unit tests with 55 test cases:

- `StateLock.test.ts` - 25 tests covering:
  - Lock acquire/release lifecycle
  - Force release functionality
  - withLock automatic cleanup
  - Lock staleness detection
  - Error handling

- `ApplyEngine.test.ts` - 15 tests covering:
  - Basic apply operations
  - Dry run mode
  - State locking behavior
  - State update tracking
  - Error recovery

- `DestroyEngine.test.ts` - 15 tests covering:
  - Empty state handling
  - Resource destruction
  - Target type filtering
  - Dry run mode
  - State locking behavior
  - Preview functionality

## Architecture Decisions

1. **Lock-First Design**: All state-modifying operations acquire locks by default, with explicit `skipLock` option for advanced use cases.

2. **Graceful Degradation**: Dry-run mode previews changes without acquiring locks or making API calls.

3. **Safety Confirmation**: Destroy command requires typing workspace name to prevent accidental data loss.

4. **Mock Strategy**: Used function-based mocks (`createMockClient()`) instead of vi.mock for better test isolation.

## Commands Added

```bash
# Apply configuration
gaib server apply                    # Interactive apply
gaib server apply --auto-approve     # Non-interactive
gaib server apply --dry-run          # Preview only

# Destroy resources
gaib server destroy --guild <id>     # Interactive destroy
gaib server destroy --auto-approve   # Non-interactive
gaib server destroy -t role          # Target specific types

# Lock management
gaib server lock-status              # Check lock status
gaib server force-unlock             # Release stuck lock
```

## Notes for Reviewer

1. All tests pass (55/55)
2. Code follows existing patterns from Sprint 92 (StateWriter) and Sprint 97 (Workspace)
3. Error messages include actionable guidance for lock conflicts
4. JSON output mode supported for all commands for CI/CD integration

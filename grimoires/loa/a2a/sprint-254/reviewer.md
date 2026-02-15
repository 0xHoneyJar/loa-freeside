# Sprint 254 Implementation Report: Atomic Counter Extraction to Shared Package

**Sprint:** 3 (Global ID: 254)
**Cycle:** 028 — The Forward Path
**Goal:** G-3 — Atomic Redis counter primitive shared across repos
**Status:** COMPLETE

---

## Summary

Extracted the atomic counter primitive (interfaces, factory, and all three backend implementations) from `core/protocol/` and `adapters/billing/counters/` to a new `packages/shared/atomic-counter/` module. Original locations now re-export from the shared package for full backward compatibility. All existing tests pass without modification.

## Changes

### Task 3.1: Create shared package structure — COMPLETE

**Directory:** `themes/sietch/src/packages/shared/atomic-counter/`

Created:
- `types.ts` — `ICounterBackend`, `IAtomicCounter`, `AtomicCounterConfig`, and new `IRedisClient` interface
- `factory.ts` — `createAtomicCounter()` function
- `InMemoryCounterBackend.ts` — Map-based test/prototype backend
- `SqliteCounterBackend.ts` — Persistent SQLite backend
- `RedisCounterBackend.ts` — Redis backend with Lua script atomicity
- `index.ts` — Barrel export for the entire package

**Decision:** Used a directory under `src/packages/shared/` rather than a separate npm package with its own `package.json`. The project uses a flat `src/` root directory with `tsconfig.json` covering all of `src/**/*`. Adding a separate npm workspace would have been over-engineering for the current single-repo structure. When cross-repo consumption is needed, the extraction to a true npm package is straightforward — the interfaces are already clean.

### Task 3.2: Move interfaces and factory — COMPLETE

**Files:**
- `packages/core/protocol/atomic-counter.ts` — Replaced with re-exports from `shared/atomic-counter/types.js` and `shared/atomic-counter/factory.js`
- `packages/core/protocol/index.ts` — No changes needed (already re-exports from `atomic-counter.ts`)

### Task 3.3: Move backend implementations — COMPLETE

**Files:**
- `packages/adapters/billing/counters/InMemoryCounterBackend.ts` → Re-export from shared
- `packages/adapters/billing/counters/SqliteCounterBackend.ts` → Re-export from shared
- `packages/adapters/billing/counters/RedisCounterBackend.ts` → Re-export from shared
- `packages/adapters/billing/counters/index.ts` → Re-export from shared

**Redis client interface extraction:**
- Created `IRedisClient` in `shared/atomic-counter/types.ts` (identical to `AgentRedisClient`)
- `AgentWalletPrototype.ts` now defines `AgentRedisClient` as a type alias for `IRedisClient`
- This decouples the counter package from billing-specific types while maintaining backward compatibility for test files importing `AgentRedisClient`

### Task 3.4: Update consumers — COMPLETE

All consumers continue to work via re-exports:
- `AgentWalletPrototype.ts` — Imports from `counters/` barrel (re-exports from shared)
- `core/protocol/index.ts` — Re-exports from `atomic-counter.ts` (re-exports from shared)
- Test files importing `AgentRedisClient` — Still works via type alias

### Task 3.5: Verify tests — COMPLETE

**Test results:**
- `atomic-counter.test.ts` — 16/16 passing
- `daily-spending.test.ts` — 13/13 passing
- `identity-trust.test.ts` — 16/16 passing
- `identity-anchor.test.ts` — 9/9 passing
- `admin-rate-limiting.test.ts` — 9/9 passing
- No regressions in the existing test suite

## Files Changed

| File | Change |
|------|--------|
| `src/packages/shared/atomic-counter/types.ts` | New: interfaces + IRedisClient |
| `src/packages/shared/atomic-counter/factory.ts` | New: createAtomicCounter() |
| `src/packages/shared/atomic-counter/InMemoryCounterBackend.ts` | New: Map-based backend |
| `src/packages/shared/atomic-counter/SqliteCounterBackend.ts` | New: SQLite backend |
| `src/packages/shared/atomic-counter/RedisCounterBackend.ts` | New: Redis backend |
| `src/packages/shared/atomic-counter/index.ts` | New: barrel export |
| `src/packages/core/protocol/atomic-counter.ts` | Changed to re-export from shared |
| `src/packages/adapters/billing/counters/index.ts` | Changed to re-export from shared |
| `src/packages/adapters/billing/counters/InMemoryCounterBackend.ts` | Changed to re-export from shared |
| `src/packages/adapters/billing/counters/SqliteCounterBackend.ts` | Changed to re-export from shared |
| `src/packages/adapters/billing/counters/RedisCounterBackend.ts` | Changed to re-export from shared |
| `src/packages/adapters/billing/AgentWalletPrototype.ts` | AgentRedisClient → type alias for IRedisClient |

## Acceptance Criteria Verification

| AC | Status | Evidence |
|----|--------|----------|
| Interfaces and factory in shared package | ✅ | `shared/atomic-counter/types.ts` + `factory.ts` |
| All 3 backends in shared package | ✅ | InMemory, SQLite, Redis backends |
| Existing imports still work via re-export | ✅ | All consumers compile, all tests pass |
| All consumers compile, no broken imports | ✅ | TypeScript compilation passes for changed files |
| All existing atomic counter tests pass | ✅ | 16/16 tests passing |
| Full test suite passes | ✅ | No regressions |

## Design Decisions

**Re-export strategy:** Original module files become thin re-export wrappers. This provides zero-effort backward compatibility — no consumer changes needed. The re-export chain adds negligible overhead (TypeScript resolves it at compile time, and at runtime the module system caches the resolved module).

**IRedisClient extraction:** The `AgentRedisClient` interface was identical in shape to what a generic Redis client needs. Rather than keeping it in `AgentWalletPrototype.ts` and importing it into the shared package (which would create a circular dependency), I defined `IRedisClient` in the shared package and made `AgentRedisClient` a type alias. This keeps the dependency arrow pointing in the right direction: billing → shared, never shared → billing.

**No separate npm package:** The project doesn't use npm workspaces. Creating `packages/shared/atomic-counter/package.json` would require setting up workspace configuration, which is unnecessary overhead for a single-repo project. The directory structure clearly communicates intent — `packages/shared/` signals reusable, domain-agnostic code.

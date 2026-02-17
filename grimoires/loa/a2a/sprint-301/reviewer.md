# Sprint 301 — Implementation Report

**Sprint:** 301 — Consumer Migration: Import Path Overhaul
**Cycle:** cycle-034
**Date:** 2026-02-18
**Status:** COMPLETE

---

## Task Summary

| Task | Title | Status | Notes |
|------|-------|--------|-------|
| 301.1 | Update billing adapter imports | DONE | 6 files migrated |
| 301.2 | Update API route imports | DONE | 5 files migrated |
| 301.3 | Update test file imports | DONE | 7 files migrated |
| 301.4 | Verify agent adapter imports | DONE | Already canonical — no changes |
| 301.5 | Freeze snapshot, delete vendored, rewrite barrel | DONE | 4 deleted, barrel rewritten, 3 late-discovery fixes |

---

## Task 301.1 — Update billing adapter imports

**Files:** 6 billing adapter files

### Implementation

Updated all billing adapter files to import from `arrakis-arithmetic.js` instead of deleted `arithmetic.js`:

| File | Imports Changed |
|------|----------------|
| `PeerTransferService.ts` | assertMicroUSD, MicroUSD |
| `SettlementService.ts` | MicroUSD |
| `RevenueDistributionService.ts` | bpsShare, assertBpsSum, MicroUSD, BasisPoints |
| `CreditLedgerAdapter.ts` | assertMicroUSD, MicroUSD |
| `PaymentServiceAdapter.ts` | dollarsToMicro |
| `ReconciliationService.ts` | MicroUSD |

### Acceptance Criteria

- [x] All billing adapter imports updated to arrakis-arithmetic.js
- [x] Zero remaining references to `arithmetic.js` in adapters/billing/

---

## Task 301.2 — Update API route imports

**Files:** 5 API route files

### Implementation

| File | Changes |
|------|---------|
| `credit-pack-routes.ts` | `arithmetic.js` → `arrakis-arithmetic.js` |
| `spending-visibility.ts` | `arithmetic.js` → `arrakis-arithmetic.js` |
| `billing-admin-routes.ts` | `arithmetic.js` → `arrakis-arithmetic.js` |
| `billing-routes.ts` | `arithmetic.js` → `arrakis-arithmetic.js`, `compatibility.js` → `arrakis-compat.js`, `PROTOCOL_VERSION` → `CONTRACT_VERSION`, `validateCompatibility(PROTOCOL_VERSION, remoteVersion)` → `validateCompatibility(remoteVersion)` (single-arg canonical API), removed `minor_compatible` drift log block |
| `public.routes.ts` | `compatibility.js` → `arrakis-compat.js`, `PROTOCOL_VERSION` → `CONTRACT_VERSION` |

**Breaking API change:** `validateCompatibility` migrated from 2-arg (local, remote) to 1-arg (remote) canonical API. Return type changed: `compat.error` instead of `compat.message`, no `compat.level` field.

### Acceptance Criteria

- [x] All API route imports updated
- [x] PROTOCOL_VERSION → CONTRACT_VERSION migration complete
- [x] validateCompatibility call signature updated to canonical 1-arg API
- [x] Zero remaining references to deleted files in api/routes/

---

## Task 301.3 — Update test file imports

**Files:** 7 test files

### Implementation

| File | Changes |
|------|---------|
| `tests/helpers/bigint-db.ts` | `arithmetic.js` → `arrakis-arithmetic.js` |
| `arithmetic-guards.test.ts` | `arithmetic.js` → `arrakis-arithmetic.js` |
| `branded-types.test.ts` | `arithmetic.js` → `arrakis-arithmetic.js` (2 import lines) |
| `protocol-adoption.test.ts` | `arithmetic.js` → `arrakis-arithmetic.js`, `compatibility.js` → `arrakis-compat.js`, `PROTOCOL_VERSION` → `CONTRACT_VERSION`, validateCompatibility assertions updated to single-arg API |
| `credit-packs.test.ts` | `arithmetic.js` → `arrakis-arithmetic.js` |
| `conservation-properties.test.ts` | `conservation-properties.js` → `arrakis-conservation.js`, `arithmetic.js` → `arrakis-arithmetic.js` |
| KEEP file imports | jwt-boundary, billing-types, identity-trust, state-machines — untouched |

### Acceptance Criteria

- [x] All test imports updated to arrakis-* extension modules
- [x] Test assertions updated for CONTRACT_VERSION and single-arg validateCompatibility
- [x] Zero remaining references to deleted files in tests/

---

## Task 301.4 — Verify agent adapter imports

**Files:** Verification only — no changes needed

### Implementation

Verified `packages/adapters/agent/` already imports directly from `@0xhoneyjar/loa-hounfour`:

- `jwt-service.ts`: imports `CONTRACT_VERSION`, `validateCompatibility` from canonical package
- `loa-finn-client.ts`: imports `CONTRACT_VERSION` from canonical package
- `index.ts`: re-exports from canonical package

No migration needed — these files were already canonical.

### Acceptance Criteria

- [x] Confirmed agent adapters use canonical imports
- [x] No changes required

---

## Task 301.5 — Freeze snapshot, delete vendored files, rewrite barrel

**Files:**
- NEW: `tests/fixtures/frozen-conservation-evaluator.ts` (314 lines)
- DELETED: `protocol/VENDORED.md`, `protocol/compatibility.ts`, `protocol/arithmetic.ts`, `protocol/conservation-properties.ts`
- MODIFIED: `protocol/index.ts` (barrel rewrite)
- MODIFIED: `core/utils/cost-estimator.ts`, `core/utils/micro-usd.ts`, `core/billing/pricing.ts` (late-discovery fixes)

### Implementation

1. **Frozen conservation snapshot**: Extracted `conservation-properties.ts` from `pre-v7-migration-anchor` tag (SHA: b6e10181) to `tests/fixtures/frozen-conservation-evaluator.ts` with DO NOT MODIFY header. Used for dual-run validation in Sprint 302.

2. **Deleted vendored files** via `git rm`:
   - `protocol/VENDORED.md` — provenance doc (no longer needed)
   - `protocol/compatibility.ts` — replaced by arrakis-compat.ts
   - `protocol/arithmetic.ts` — replaced by arrakis-arithmetic.ts
   - `protocol/conservation-properties.ts` — replaced by arrakis-conservation.ts

3. **Barrel rewrite** (`protocol/index.ts`):
   - Removed imports from deleted arithmetic.js, compatibility.js, conservation-properties.js
   - Added imports from arrakis-arithmetic.js, arrakis-compat.js, arrakis-conservation.js
   - Added new v7.0.0 exports: CONTRACT_VERSION, negotiateVersion, normalizeInboundClaims, normalizeCoordinationMessage, ClaimNormalizationError, isV7NormalizationEnabled, TrustScope, TrustLevel, NormalizedClaims, VersionNegotiation, getCanonicalProperties, CANONICAL_CONSERVATION_PROPERTIES
   - Removed obsolete exports: PROTOCOL_VERSION, CONSERVATION_PROPERTIES, CompatibilityResult

4. **Late-discovery import fixes**: Post-deletion `tsc --noEmit` revealed 3 additional files using `../protocol/arithmetic.js` relative path (different from the `../../core/protocol/arithmetic.js` pattern caught in Tasks 301.1-301.3):
   - `core/utils/cost-estimator.ts` — assertMicroUSD
   - `core/utils/micro-usd.ts` — facade re-exporting arithmetic helpers
   - `core/billing/pricing.ts` — divideWithFloor, MAX_MICRO_USD, SafeArithmeticError

### Acceptance Criteria

- [x] Frozen conservation snapshot created from pre-migration tag
- [x] 4 vendored files deleted via git rm
- [x] Barrel index.ts rewritten for arrakis-* extension modules
- [x] All late-discovery import paths fixed
- [x] `tsc --noEmit` passes with zero migration-related errors
- [x] Zero remaining imports from deleted files across entire codebase

---

## Compilation Verification

```
$ tsc --noEmit 2>&1 | grep -E "(arrakis-arithmetic|arrakis-compat|arrakis-conservation|cost-estimator|micro-usd|pricing\.ts|arithmetic\.js|compatibility\.js|conservation-properties\.js)"
NO ERRORS IN MIGRATION FILES
```

Pre-existing errors in `admin-bonus-routes.ts`, `admin/agent-config.ts`, `byok.routes.ts`, `agents.routes.ts`, `agent-tba.routes.ts` — all unrelated to v7 migration.

---

## Risk Log

| Risk | Mitigation |
|------|-----------|
| 3 consumer files missed in initial grep | Post-deletion tsc --noEmit caught them. Different relative path pattern (`../protocol/` vs `../../core/protocol/`). |
| validateCompatibility API breaking change | Single-arg canonical API replaces 2-arg vendored API. Return type adapted (error vs message). |
| micro-usd.ts facade still references protocol/ | Updated to arrakis-arithmetic.js. Facade pattern preserved for backwards compatibility. |

---

## Metrics

| Metric | Value |
|--------|-------|
| Tasks completed | 5/5 |
| Files created | 1 (frozen snapshot) |
| Files deleted | 4 (vendored) |
| Files modified | 22 (imports + barrel) |
| Compilation errors (migration) | 0 |
| Consumer files migrated | 21 |

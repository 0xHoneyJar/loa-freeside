# SDD: Hounfour v7.9.2 Full Adoption — Protocol Convergence

**Version:** 1.2.0
**Cycle:** cycle-039
**Date:** 2026-02-23
**PRD:** v1.2.0 (GPT-APPROVED, Flatline-reviewed)
**Review:** GPT-APPROVED (3 iter, 8 issues). Flatline: 6 HIGH_CONSENSUS integrated, 4 BLOCKERs resolved (1 by IMP-006, 3 accepted)

---

## 1. Executive Summary

This SDD designs the upgrade of loa-hounfour from v7.0.0 (`ec50249`) to v7.9.2 (`ff8c16b`) across the arrakis codebase. The architecture preserves the existing three-layer integration pattern (canonical → adapter → consumer) while expanding the canonical surface to cover 9 minor versions of additive protocol evolution.

**Key architectural decisions:**
- Barrel-mediated access: all non-adapter modules consume hounfour types through the protocol barrel
- Adapter-layer reduction: 2 files deleted, 3 files reduced to thin canonical import + local extension
- Feature-flagged boundary engine: `evaluateEconomicBoundary` spike behind `ENABLE_CANONICAL_BOUNDARY_ENGINE`
- Dual-parse rollout for `parseMicroUsd`: log-and-compare period before cutover at each boundary
- Supply-chain verification: SHA + manifest validation in rebuild script

---

## 2. System Architecture

### 2.1 Integration Layer Model

The hounfour integration follows a three-layer architecture:

```
┌──────────────────────────────────────────────────────────────┐
│                    CONSUMER LAYER                             │
│  (services, routes, controllers — import from barrel only)   │
├──────────────────────────────────────────────────────────────┤
│                    ADAPTER LAYER                              │
│  protocol/index.ts (barrel)                                  │
│  ├── arrakis-arithmetic.ts   (REDUCE: canonical + local)     │
│  ├── arrakis-conservation.ts (REDUCE: canonical + local)     │
│  ├── arrakis-compat.ts       (REDUCE: canonical + local)     │
│  ├── billing-types.ts        (KEEP: arrakis-specific)        │
│  ├── billing-entry.ts        (KEEP: arrakis-specific)        │
│  ├── guard-types.ts          (KEEP: arrakis-specific)        │
│  ├── state-machines.ts       (KEEP: arrakis-specific)        │
│  ├── economic-events.ts      (KEEP: arrakis-specific)        │
│  ├── identity-trust.ts       (KEEP: arrakis-specific)        │
│  ├── config-schema.ts        (KEEP: arrakis-specific)        │
│  └── atomic-counter.ts       (KEEP: infrastructure)          │
│  adapters/agent/ (direct hounfour access — allowlisted)      │
│  ├── jwt-service.ts                                          │
│  ├── loa-finn-client.ts                                      │
│  ├── capability-audit.ts                                     │
│  └── pool-mapping.ts                                         │
├──────────────────────────────────────────────────────────────┤
│                    CANONICAL LAYER                            │
│  @0xhoneyjar/loa-hounfour v7.9.2 (ff8c16b)                  │
│  ├── /core       — identity, lifecycle, events, discovery    │
│  ├── /economy    — JWT, billing, escrow, currency, NFT       │
│  ├── /model      — completion, budget, preferences           │
│  ├── /governance — sanctions, disputes, reputation           │
│  ├── /constraints— constraint type system, evaluator         │
│  └── /integrity  — conservation, liveness, req-hash          │
└──────────────────────────────────────────────────────────────┘
```

### 2.2 Import Access Control

Per PRD AC-3.6 (Flatline IMP-005), direct `@0xhoneyjar/loa-hounfour` imports are restricted to an explicit allowlist:

| Module Pattern | Rationale |
|----------------|-----------|
| `packages/adapters/agent/*.ts` | Low-level JWT, pool, and compatibility adapter layer |
| `themes/sietch/src/packages/core/protocol/arrakis-*.ts` | Canonical adapter files |
| `themes/sietch/src/api/routes/discovery.routes.ts` | Discovery endpoint |
| `tests/**/*.ts` | Conformance and E2E test suites |

All other modules import via the protocol barrel (`themes/sietch/src/packages/core/protocol/index.ts`).

**Enforcement:** ESLint `no-restricted-imports` (core rule) with patterns matching `@0xhoneyjar/loa-hounfour*`, plus override blocks for the permitted globs. This matches module specifiers directly (unlike `import/no-restricted-paths` which operates on filesystem paths and would not reliably catch package specifier imports). Fallback: CI AST-based import check parsing specifiers from source files.

---

## 3. Component Design

### 3.1 FR-1: SHA Pin Bump

**Files modified:**
- `package.json` (root)
- `packages/adapters/package.json`

**Change:** Replace `ec5024938339121dbb25d3b72f8b67fdb0432cad` → `ff8c16b899b5bbebb9bf1a5e3f9e791342b49bea` in the `@0xhoneyjar/loa-hounfour` devDependency git ref.

**Boundary payload replay (AC-1.6):** Create `tests/boundary-replay/v7-delta.test.ts` that:
1. Loads representative fixtures from existing test suites (JWT claims, billing entries, conservation check payloads)
2. Parses each through v7.9.2 boundary types (schemas, validators)
3. Asserts identical parsed output compared to committed golden-output baselines
4. Documents any deltas in `grimoires/loa/a2a/v7-delta-log.md`

**Dual-version harness:** The test uses pre-computed golden baselines rather than dual-installing both versions. Before the pin bump, run the replay suite against v7.0.0 and commit serialized outputs as `tests/boundary-replay/golden/*.json`. After the pin bump, the same suite runs against v7.9.2 and compares against the committed golden files. This avoids the complexity of npm aliasing two versions of the same package. If a delta is found, it is logged to the delta-log and the test fails with a descriptive diff — the engineer then audits the delta, updates the golden file if the change is intentional, or flags a regression.

**Golden output classification (Flatline SKP-002):** Each golden baseline file is tagged with an intent classification:

| Classification | Meaning | Update Policy |
|---------------|---------|---------------|
| `MUST_MATCH` | Behavioral identity required (billing amounts, conservation decisions) | Golden update requires security + domain owner sign-off |
| `EXPECTED_CHANGE` | v7.9.2 intentionally tightens/changes (e.g., stricter parsing) | Golden update requires rationale in delta-log changelog |
| `INFORMATIONAL` | Shape/format changes that don't affect runtime semantics | Engineer discretion |

Golden file updates are tracked in `grimoires/loa/a2a/v7-delta-log.md` with: (1) which fixtures changed, (2) classification, (3) rationale, (4) approver.

### 3.2 FR-2: Rebuild Script Update

**File modified:** `scripts/rebuild-hounfour-dist.sh`

**Changes:**
1. **Version fingerprint:** Update stale-detection from checking `CONTRACT_VERSION='7.0.0'` to checking the full version string from `dist/version.js` (`CONTRACT_VERSION` may still report `7.0.0` as the contract version even in v7.9.2 — contract version != package version). Add a secondary check: `grep -q 'evaluateEconomicBoundary' dist/utilities/economic-boundary.js` as a v7.9.0+ fingerprint.

2. **Supply-chain verification (AC-2.4):**

The rebuild script clones, builds, and vendors hounfour into the local dist. Verification binds to the exact built artifacts (not workspace `node_modules`):

```bash
set -euo pipefail

# Step 1: Fetch exact commit into isolated temp dir (deterministic)
CLONE_DIR=$(mktemp -d)
git init "$CLONE_DIR"
cd "$CLONE_DIR"
git remote add origin "$HOUNFOUR_REPO"
git fetch --depth 1 origin "$EXPECTED_SHA" || {
  echo "SECURITY: Failed to fetch expected SHA $EXPECTED_SHA"
  exit 1
}
git checkout --detach FETCH_HEAD

# Step 2: Verify commit SHA in the cloned repo
ACTUAL_SHA=$(git rev-parse HEAD)
if [ "$ACTUAL_SHA" != "$EXPECTED_SHA" ]; then
  echo "SECURITY: SHA mismatch. Expected $EXPECTED_SHA, got $ACTUAL_SHA"
  exit 1
fi

# Step 3: Build in isolation (npm ci ensures lockfile-only deps)
npm ci --ignore-scripts
npx tsc -p tsconfig.build.json

# Step 4: Embed source provenance in built dist
echo "$ACTUAL_SHA" > dist/SOURCE_SHA

# Step 5: Verify export specifiers resolve from the BUILT dist (not node_modules)
for specifier in "" "/core" "/economy" "/model" "/governance" "/constraints" "/integrity"; do
  node -e "require('${CLONE_DIR}/dist${specifier}')" || {
    echo "MANIFEST: Failed to resolve dist${specifier}"
    exit 1
  }
done

# Step 6: Compute and record content hash of built dist
DIST_HASH=$(find dist -type f | sort | xargs sha256sum | sha256sum | cut -d' ' -f1)
echo "$DIST_HASH" > dist/DIST_HASH
```

At runtime, the installed package's `dist/SOURCE_SHA` is asserted to equal the expected SHA in CI.

**Dependency integrity controls (Flatline SKP-003):**
- `npm ci --ignore-scripts` prevents post-install script execution from transitive deps
- `pnpm --frozen-lockfile` enforces lockfile integrity (no silent resolution changes)
- `DIST_HASH` is compared against a committed expected value in `scripts/expected-dist-hashes.json` per SHA — recording provenance alone is insufficient, the hash must be verified against a known-good value
- Scripts that must run during build are explicitly allowlisted in `.npmrc` (`allow-scripts`)
- Git remote authenticity verified via SSH host key pinning in the build environment

3. **Build reproducibility:** Pin Node version (via `.nvmrc`), use `npm ci` / `pnpm --frozen-lockfile`, use the repo's `tsconfig.build.json` (with stable settings: `declaration`, `newLine: "lf"`, `importsNotUsedAsValues`). Set `SOURCE_DATE_EPOCH=0` to avoid timestamp embedding. The `--strict` flag is a type-checking mode, NOT a reproducibility control — removed from determinism claims.

### 3.3 FR-3: Protocol Barrel Expansion

**File modified:** `themes/sietch/src/packages/core/protocol/index.ts`

**Design principle:** Export only symbols that are consumed by arrakis code. New sections are appended after existing v7.0.0 re-exports, organized by domain.

**New barrel sections (v7.1–v7.9):**

**IMPORTANT — Export specifier alignment:** Each re-export MUST use the exact specifier from the v7.9.2 `package.json#exports` map. The specifiers shown below are provisional and MUST be validated against the actual exports map during implementation. If a symbol is exported from a subpath (e.g., `/governance`), use the subpath specifier — not the root. An automated export-map validation test will verify every barrel re-export resolves from the specifier used.

```typescript
// ─── Reputation & Trust (v7.1–v7.6) ────────────────────────────
// Specifiers: validate against v7.9.2 package.json#exports
export {
  evaluateAccessPolicy,
  type AccessPolicyContext,
  type AccessPolicyResult,
} from '@0xhoneyjar/loa-hounfour/governance'; // verify subpath

export {
  REPUTATION_STATES,
  REPUTATION_STATE_ORDER,
  isKnownReputationState,
  type ReputationStateName,
} from '@0xhoneyjar/loa-hounfour/governance'; // verify subpath

// ─── Event Sourcing & Replay (v7.3) ────────────────────────────
export {
  reconstructAggregateFromEvents,
  verifyAggregateConsistency,
  computeEventStreamHash,
  type ReconstructedAggregate,
  type ConsistencyReport,
} from '@0xhoneyjar/loa-hounfour/integrity'; // verify subpath

export {
  computeCredentialPrior,
  isCredentialExpired,
  CREDENTIAL_CONFIDENCE_THRESHOLD,
} from '@0xhoneyjar/loa-hounfour/core'; // verify subpath

// ─── Governance (v7.3–v7.7) ────────────────────────────────────
export {
  type Sanction,
  SanctionSchema,
  SANCTION_SEVERITY_LEVELS,
  VIOLATION_TYPES,
  ESCALATION_RULES,
} from '@0xhoneyjar/loa-hounfour/governance'; // verify subpath

export {
  type DisputeRecord,
  DisputeRecordSchema,
} from '@0xhoneyjar/loa-hounfour/governance'; // verify subpath

export {
  type ValidatedOutcome,
  ValidatedOutcomeSchema,
} from '@0xhoneyjar/loa-hounfour/governance'; // verify subpath

// ─── Economy Extensions (v7.5–v7.9) ────────────────────────────
export {
  parseMicroUsd,
  type ParseMicroUsdResult,
  evaluateEconomicBoundary,
  evaluateFromBoundary,
} from '@0xhoneyjar/loa-hounfour/economy'; // verify subpath

export {
  subtractMicroSigned,
  negateMicro,
  isNegativeMicro,
} from '@0xhoneyjar/loa-hounfour/economy';

export {
  TRANSFER_CHOREOGRAPHY,
  TRANSFER_INVARIANTS,
} from '@0xhoneyjar/loa-hounfour/economy';

// ─── Integrity Extensions (v6.0–v7.8) ──────────────────────────
export {
  LivenessPropertySchema,
  CANONICAL_LIVENESS_PROPERTIES,
  type LivenessProperty,
} from '@0xhoneyjar/loa-hounfour/integrity';

export {
  detectReservedNameCollisions,
  type NameCollision,
} from '@0xhoneyjar/loa-hounfour/integrity'; // verify subpath
```

**Export-map validation test:** A CI test (`tests/unit/barrel-export-map.test.ts`) will dynamically import every barrel re-export and assert it resolves from the exact specifier used. This catches root-vs-subpath mismatches that compile in TypeScript but fail at runtime under Node ESM resolution.

**Duplicate resolution:** The compatibility adapter (`arrakis-compat.ts`) already re-exports `CONTRACT_VERSION` and `validateCompatibility`. These remain in the compat section — the barrel does not duplicate them.

### 3.4 FR-4: Local Type Reduction

#### 3.4.1 DELETE: `compatibility.ts`

**Current state:** Contains `validateCompatibility()` and `CONTRACT_VERSION` — exact duplicates of canonical exports.

**Action:** Delete file. All 4 consumers already import from `arrakis-compat.ts` which imports from canonical.

**Consumer impact:** None — consumers import from barrel, not directly from `compatibility.ts`.

#### 3.4.2 DELETE: `VENDORED.md`

**Action:** Delete file. Vendoring metadata is obsolete since cycle-034 adopted canonical imports.

#### 3.4.3 REDUCE: `arrakis-arithmetic.ts`

**Current state:** Re-exports 14 canonical symbols from `/economy` + defines 8 local functions + 2 Zod schemas.

**After reduction:**
```typescript
// Canonical re-exports (unchanged — existing v7.0.0 imports)
export { type BrandedMicroUSD as MicroUSD, /* existing symbols */ } from '@0xhoneyjar/loa-hounfour/economy';

// NEW: v7.9.0 canonical strict parser (specifier: /economy per exports map)
export { parseMicroUsd, type ParseMicroUsdResult } from '@0xhoneyjar/loa-hounfour/economy';

// Local-only extensions (kept — no canonical equivalent)
export const MICRO_USD_PER_DOLLAR = 1_000_000n;
export const MAX_MICRO_USD = 1_000_000_000n;
export const TOTAL_BPS = 10_000n;
// Function signatures shown — implementations unchanged from current file
export function dollarsToMicro(dollars: number): bigint { /* unchanged */ }
export function microToDollarsDisplay(micro: bigint): string { /* unchanged */ }
export function assertMicroUSD(value: bigint): void { /* unchanged */ }
export function assertBpsSum(bps: bigint[]): void { /* unchanged */ }
export function divideWithFloor(a: bigint, b: bigint): bigint { /* unchanged */ }
export function serializeBigInt(value: bigint): string { /* unchanged */ }
```

> **Note (Flatline IMP-002/IMP-004):** All specifiers in this SDD are aligned to subpath exports from the v7.9.2 `package.json#exports` map. Function bodies shown as `/* unchanged */` indicate existing implementations that are not modified — refer to current source for full bodies. No `...` pseudocode ellipsis patterns are used in implementable code blocks.

**Net change:** Add `parseMicroUsd` re-export. Local extensions remain — they have no canonical equivalent.

#### 3.4.4 REDUCE: `arrakis-conservation.ts`

**Current state:** Imports `CANONICAL_CONSERVATION_PROPERTIES` from `/integrity`, maps to local error taxonomy.

**After reduction:**
```typescript
// Canonical: conservation + liveness (NEW)
import {
  CANONICAL_CONSERVATION_PROPERTIES,
  type ConservationProperty as CanonicalConservationProperty,
  type EnforcementMechanism as CanonicalEnforcementMechanism,
  CANONICAL_LIVENESS_PROPERTIES,        // NEW v6.0.0
  type LivenessProperty,                // NEW v6.0.0
} from '@0xhoneyjar/loa-hounfour/integrity';

// Re-export liveness for consumer access
export { CANONICAL_LIVENESS_PROPERTIES, type LivenessProperty };

// Local error taxonomy and mapping tables remain unchanged
```

**Net change:** Add liveness property imports + re-exports. Error taxonomy mapping unchanged.

#### 3.4.5 REDUCE: `jwt-boundary.ts` (if present in protocol/)

**Current state per audit:** Core 6-step JWT verification is identical to canonical. Arrakis-specific claim types (`pool_id`, `reserved_micro` for S2S) differ.

**After reduction:** Import canonical verification steps from hounfour, keep arrakis-specific claim types and S2S extensions locally.

### 3.5 FR-5: `evaluateEconomicBoundary` Spike

**Architecture:**

```
┌─────────────────────────────────────────────────┐
│ Conservation Guard (checkConservation)           │
│                                                  │
│  if (ENABLE_CANONICAL_BOUNDARY_ENGINE) {         │
│    // Spike path: canonical decision engine      │
│    const mapping = {                             │
│      trust: mapTierToTrustDimensions(tier),      │
│      capital: remainingBudgetMicro,              │
│      criteria: arrakisQualificationCriteria,     │
│    };                                            │
│    const result = evaluateEconomicBoundary(map); │
│    // Log comparison with existing logic         │
│    logBoundaryComparison(existingResult, result); │
│    return existingResult; // Always use existing  │
│  }                                               │
│                                                  │
│  // Default path: existing conservation logic    │
│  return existingConservationCheck();             │
└─────────────────────────────────────────────────┘
```

**Key design decisions:**
- **Shadow mode only**: Canonical engine runs alongside existing logic but does NOT drive decisions
- **Comparison logging**: Every invocation logs both results to enable equivalence analysis
- **Input mapping document**: Required (AC-5.5) — maps arrakis tier/conviction/budget to canonical trust dimensions

**Environment variable:** `ENABLE_CANONICAL_BOUNDARY_ENGINE` (default: `false`)

### 3.6 FR-6: `parseMicroUsd` Boundary Adoption

**Boundary entry points to migrate:**

| Entry Point | File | Current Parser | Migration Strategy |
|-------------|------|----------------|-------------------|
| HTTP route — billing entry creation | `routes/billing.routes.ts` | `BigInt(body.amount_micro)` | Dual-parse → cutover |
| HTTP route — budget check | `routes/budget.routes.ts` | `BigInt(query.amount)` | Dual-parse → cutover |
| Database row mapper | `adapters/billing-repository.ts` | `BigInt(row.amount_micro)` | Dual-parse → cutover |
| Redis value reader | `adapters/redis-budget-cache.ts` | `BigInt(cached.balance)` | Dual-parse → cutover |
| JWT claim parser | `adapters/agent/jwt-service.ts` | `BigInt(claims.reserved_micro)` | Dual-parse → cutover |

**Staged dual-parse rollout:**

The rollout has 3 explicit stages controlled by `PARSE_MICRO_USD_MODE` environment variable:

| Stage | Env Value | Behavior | When |
|-------|-----------|----------|------|
| 0: Legacy | `legacy` | `BigInt()` only (kill-switch) | Emergency revert |
| 1: Shadow | `shadow` (default) | Run both parsers, always use legacy result, log divergences | Initial deployment |
| 2: Enforce | `enforce` | Use canonical result, reject invalid inputs with 400/structured error | After shadow period criteria met |

**Implementation pattern:**

```typescript
import { parseMicroUsd } from '@0xhoneyjar/loa-hounfour/economy';

type ParseMode = 'legacy' | 'shadow' | 'enforce';
const PARSE_MODE: ParseMode = (process.env.PARSE_MICRO_USD_MODE as ParseMode) || 'shadow';

type BoundaryParseResult =
  | { ok: true; value: bigint }
  | { ok: false; reason: string; raw: string };

function parseBoundaryMicroUsd(
  raw: string,
  context: string,
  logger: Logger,
): BoundaryParseResult {
  // Stage 0: Kill-switch — pure legacy
  if (PARSE_MODE === 'legacy') {
    try { return { ok: true, value: BigInt(raw) }; }
    catch { return { ok: false, reason: 'BigInt parse failure', raw }; }
  }

  const canonical = parseMicroUsd(raw);
  let legacyValue: bigint | null = null;
  try { legacyValue = BigInt(raw); } catch { /* legacy also rejected */ }

  if (PARSE_MODE === 'shadow') {
    // Stage 1: Shadow — log divergences, always return legacy result
    if (canonical.ok && legacyValue !== null && canonical.value !== legacyValue) {
      logger.warn('parseMicroUsd divergence', { raw, context, canonical: String(canonical.value), legacy: String(legacyValue) });
    }
    if (!canonical.ok && legacyValue !== null) {
      logger.warn('parseMicroUsd would-reject', { raw, context, reason: canonical.error, legacy: String(legacyValue) });
    }
    // Return legacy result in shadow mode
    if (legacyValue !== null) return { ok: true, value: legacyValue };
    return { ok: false, reason: canonical.ok ? 'BigInt parse failure' : canonical.error, raw };
  }

  // Stage 2: Enforce — canonical drives decisions
  if (canonical.ok) {
    return { ok: true, value: canonical.value };
  }
  // Canonical rejected: return structured error (caller decides 400 vs log)
  return { ok: false, reason: canonical.error, raw };
}
```

**Caller responsibility:** HTTP route handlers convert `{ ok: false }` into 400 responses. Database/Redis readers log the rejection and skip the row (rather than crashing).

**Caller responsibility:** HTTP route handlers convert `{ ok: false }` into 400 responses with structured error body. Database readers quarantine invalid rows to a `micro_usd_parse_failures` dead-letter table and emit `parseMicroUsd_db_quarantine` alert — they MUST NOT silently skip rows, as this can cause undercounting balances or violating conservation invariants (Flatline IMP-006). Redis readers invalidate the cache key and fall back to DB source on parse failure. An incident runbook covers parse rejection from persisted data.

**Observability (Flatline IMP-003):** Shadow mode emits the following metrics:
- `parseMicroUsd_shadow_total` — total invocations per boundary context
- `parseMicroUsd_would_reject_total` — canonical rejection count (legacy accepted)
- `parseMicroUsd_divergence_total` — value mismatch count (both accepted, different result)
- Dashboard: dedicated panel per boundary context showing rejection rate over time
- Alert: `parseMicroUsd_would_reject_total > 0` fires PagerDuty notification within 5 minutes

**Cutover criteria (shadow → enforce):**
- Metric: `parseMicroUsd_would_reject_total` counter per boundary context
- Threshold: Zero `would-reject` events for ≥24h, OR all divergences audited and inputs normalized
- Timeboxed: Shadow mode removed (legacy fallback deleted) by end of cycle-040 at latest

**Deployment constraint (Flatline IMP-007):** `PARSE_MICRO_USD_MODE` must be set atomically across all replicas via environment config (not per-pod override). Mixed-mode deployments (some replicas in shadow, others in enforce) create divergent validation behavior and are prohibited. Mode transitions use rolling deployment with health checks confirming all pods report the same mode.

**Kill-switch:** `PARSE_MICRO_USD_MODE=legacy` bypasses canonical parser entirely at all callsites.

### 3.7 FR-7: Conformance Test Expansion

**File modified:** `tests/unit/protocol-conformance.test.ts`

**Changes:**
1. Update `CONTRACT_VERSION` assertion: `expect(CONTRACT_VERSION).toBe('7.0.0')` — note: CONTRACT_VERSION may still be `'7.0.0'` even in v7.9.2 package (contract version != package version). Verify actual value from v7.9.2 source.
2. Update vector loader to scan v7.9.2 vector directory structure
3. Add test blocks for new vector categories: governance, reputation, liveness
4. Dual-accept test at line 68 remains (v6.0.0 support still in window)

**Vector loading:**
```typescript
// v7.0.0: vectors in tests/vectors/*.json (91 files)
// v7.9.2: vectors in tests/vectors/**/*.json (202 files, nested by category)
const vectorFiles = glob.sync('node_modules/@0xhoneyjar/loa-hounfour/tests/vectors/**/*.json');
```

### 3.8 FR-8: Verify-Peer-Version Update

**File modified:** `scripts/verify-peer-version.sh`

**Changes:**
1. Update `CONTRACT_VERSION` constant if changed in v7.9.2 (verify from source)
2. Keep `MIN_SUPPORTED_VERSION=6.0.0` and dual-accept window (v6–v7)
3. Add version pair test script `tests/scripts/verify-peer-version.test.sh` with 5 concrete pairs from AC-8.2

---

## 4. Data Architecture

No database schema changes. The upgrade is purely a dependency and type-layer change.

---

## 5. Security Architecture

### 5.1 Supply-Chain Security

| Concern | Mitigation |
|---------|-----------|
| Tampered upstream commit | SHA verification in isolated clone + `dist/SOURCE_SHA` provenance (AC-2.4) |
| Stale/incorrect dist artifacts | Export specifier resolution against built dist (not node_modules) + `dist/DIST_HASH` (AC-2.4) |
| Non-reproducible builds | Pinned Node/TS versions, `npm ci`, stable tsconfig, `SOURCE_DATE_EPOCH=0` |
| Direct import bypass | ESLint `no-restricted-imports` with pattern `@0xhoneyjar/loa-hounfour*` + override allowlist |

### 5.2 Input Validation Tightening

`parseMicroUsd()` intentionally rejects inputs that `BigInt()` accepts:
- Leading zeros: `"0100"` → rejected (ambiguous octal/decimal)
- Whitespace: `" 100 "` → rejected
- Plus signs: `"+100"` → rejected
- Floats: `"100.5"` → rejected

This is a security improvement at protocol boundaries. The dual-parse rollout (AC-6.6) ensures safe transition.

### 5.3 Trust Escalation Prevention

The compatibility adapter's `TRUST_LEVEL_TO_SCOPES` mapping preserves the invariant that legacy trust level 9 never escalates to `admin:full`. This mapping is unchanged by the v7.9.2 upgrade.

---

## 6. Testing Strategy

### 6.1 Test Layers

| Layer | Coverage | Tool |
|-------|----------|------|
| Conformance vectors | 202 vectors (was 91) | `protocol-conformance.test.ts` |
| Boundary payload replay | Golden baselines from v7.0.0 vs v7.9.2 output | `tests/boundary-replay/v7-delta.test.ts` |
| Export-map validation | Every barrel re-export resolves from correct specifier | `tests/unit/barrel-export-map.test.ts` |
| Dual-parse shadow | All boundary entry points (`would-reject` counter) | Runtime logging in shadow mode |
| Version negotiation | 5 concrete version pairs | `tests/scripts/verify-peer-version.test.sh` |
| Type compilation | Full barrel + consumers | `npx tsc --noEmit` |
| Supply-chain provenance | `dist/SOURCE_SHA` matches expected | CI assertion |
| Existing regression | 5420+ tests | Existing test suite |

### 6.2 Semantic Compatibility Invariants (Flatline SKP-001)

Beyond type-level compatibility, the following per-domain semantic invariants MUST hold after the v7.9.2 upgrade. Each invariant has a concrete test:

| Domain | Invariant | Test |
|--------|-----------|------|
| JWT | `verifyJWT(token)` produces identical claims object for all valid token formats | Golden replay with 5+ token fixtures |
| Billing | `parseMicroUsd(x).value === BigInt(x)` for all current production input formats | Shadow mode `divergence_total == 0` |
| Conservation | 14 canonical conservation properties evaluate identically | Property-based test: random valid states → same pass/fail |
| Governance | `SanctionSchema.parse(x)` accepts all fixtures that v7.0.0 accepted | Golden replay with governance fixtures |
| Version | `validateCompatibility(a, b)` matches documented predicate for all test pairs | 5 explicit pairs from FR-8 AC-8.2 |

**Property-based tests:** For parsers and validators (`parseMicroUsd`, `SanctionSchema`, `LivenessPropertySchema`), add fast-check/property-based tests that generate random valid inputs and assert: (a) v7.9.2 accepts them, (b) parsed output matches expected shape. This catches edge cases beyond golden fixtures.

### 6.3 Boundary Engine Equivalence (FR-5 stretch)

10 scenarios minimum:
1. Sufficient budget, highest tier → ALLOW
2. Sufficient budget, lowest tier → ALLOW (limited pools)
3. Zero budget remaining → DENY (budget exhausted)
4. Budget below threshold → DENY (insufficient funds)
5. Invalid tier → DENY (unknown tier)
6. Expired conviction → DENY (tier expired)
7. Exact budget boundary (1 micro-USD remaining) → ALLOW
8. Negative budget (overdraft) → DENY
9. Maximum budget (ceiling) → ALLOW
10. Mixed trust dimensions (high conviction, low tier) → expected resolution

---

## 7. Rollback Strategy

Per PRD §7 Rollback Runbook:

| Level | Trigger | Action | Recovery Time |
|-------|---------|--------|---------------|
| L1: Full revert | Build failure or widespread test failure | Revert SHA pin to `ec50249...` | <5 minutes |
| L2: Feature kill-switch | `parseMicroUsd` boundary rejection | `PARSE_MICRO_USD_MODE=legacy` | <1 minute |
| L3: Boundary engine | Equivalence test failure | `ENABLE_CANONICAL_BOUNDARY_ENGINE=false` (default) | Immediate |
| L4: Re-vendor | Barrel import resolution failure | Revert REDUCE changes in adapter files | <15 minutes |

### 7.1 Post-Rollback Verification (Flatline IMP-001)

Each rollback level has explicit post-rollback smoke tests to confirm recovery:

| Level | Smoke Tests |
|-------|-------------|
| L1 | `npm test` passes, conformance suite passes, `import('@0xhoneyjar/loa-hounfour')` resolves to v7.0.0 |
| L2 | Boundary entry points accept previously-failing inputs, `parseMicroUsd_would_reject_total` counter stops incrementing |
| L3 | Conservation guard produces identical allow/deny for 10 reference scenarios, no `evaluateEconomicBoundary` calls in logs |
| L4 | `npx tsc --noEmit` passes, barrel exports resolve, no import resolution errors in application startup |

---

## 8. Implementation Phases

Per PRD §6 FR Dependency Order:

| Phase | FRs | Parallelizable | Description |
|-------|-----|----------------|-------------|
| 1 | FR-1 → FR-2 | Sequential | Pin bump + rebuild script update |
| 2 | FR-3, FR-7, FR-8 | Parallel | Barrel expansion + conformance + peer version |
| 3 | FR-4 | Sequential | Local type reduction (depends on barrel) |
| 4 | FR-6 | Sequential | parseMicroUsd boundary adoption (depends on type reduction) |
| 5 | FR-5 | Stretch | Boundary engine spike (depends on stable boundaries) |

---

## 9. Technical Risks & Mitigations

| Risk | Mitigation | Owner |
|------|-----------|-------|
| v7.9.2 CONTRACT_VERSION != '7.0.0' breaks conformance test | Verify actual value from v7.9.2 source before updating test assertion | Phase 1 |
| Barrel exports conflict with local type names | Use aliased imports (`type X as CanonicalX`) where names clash | Phase 2 |
| `parseMicroUsd` rejects valid production inputs | Dual-parse period with 0.1% threshold + kill-switch | Phase 4 |
| Rebuild script non-deterministic on different platforms | Pinned Node/TS versions, `npm ci`, stable tsconfig, `SOURCE_DATE_EPOCH=0` | Phase 1 |
| Conformance vector format changed in v7.9.2 | Inspect vector directory structure before updating loader | Phase 2 |

---

## 10. Files Changed Summary

| Category | Files | Action |
|----------|-------|--------|
| Dependency pins | 2 (`package.json` × 2) | Modify SHA |
| Build infrastructure | 1 (`rebuild-hounfour-dist.sh`) | Update stale detection + add verification |
| Protocol barrel | 1 (`protocol/index.ts`) | Add ~60 new re-exports |
| Adapter reduction | 3 (`arrakis-arithmetic.ts`, `arrakis-conservation.ts`, `arrakis-compat.ts` or `jwt-boundary.ts`) | Reduce to canonical + local |
| Adapter deletion | 2 (`compatibility.ts`, `VENDORED.md`) | Delete |
| Peer verification | 1 (`verify-peer-version.sh`) | Update constants |
| Conformance tests | 1 (`protocol-conformance.test.ts`) | Expand to 202 vectors |
| Boundary replay | 1 (`v7-delta.test.ts`) + golden baselines dir | New test file + fixtures |
| Export-map validation | 1 (`barrel-export-map.test.ts`) | New test file |
| Version pair tests | 1 (`verify-peer-version.test.sh`) | New test script |
| Boundary parsing | ~5 (route handlers, repository, cache, JWT) | Add dual-parse wrapper |
| Boundary engine spike | ~2 (conservation guard, equivalence test) | Feature-flagged spike |
| **Total** | **~20 files** | |

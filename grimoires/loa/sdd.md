# SDD: The Naming — Engineering Excellence & Protocol Identity

**Version:** 1.1.0
**Cycle:** cycle-040
**Date:** 2026-02-24
**PRD:** v1.1.0 (GPT-APPROVED, iteration 2)

---

## 1. Executive Summary

This SDD designs six engineering excellence improvements identified by the Bridgebuilder review of cycle-039. Unlike the previous cycle (dependency upgrade + protocol convergence), this cycle is primarily specification, documentation, and lightweight code — formalizing operational knowledge into enforceable contracts, documented strategies, and named identity.

**Key architectural decisions:**
- Graduation criteria computed entirely from existing `parseBoundaryMicroUsd` metrics — no new storage or quarantine mechanism
- Consumer-driven contract defined at the integration seam (barrel entrypoints + conformance vector bundle hash), not internal counts
- Mode-aware Zod micro-USD schema synchronized with `PARSE_MICRO_USD_MODE` env var — legacy mode preserves production acceptance, canonical mode tightens
- Cold-restart as the only config invalidation strategy — TTL hot-reload deferred due to split-brain risk from module-level caching
- Ceremony geometry as a structural post-merge ritual with a defined spec and inaugural execution
- Protocol naming with propagation through README, BUTTERFREEZONE, and protocol barrel module doc

**Scope:** ~12 files modified/created, primarily documentation + types + one shared Zod schema + one validation script.

---

## 2. System Architecture

### 2.1 Affected Components

This cycle does not alter the three-layer integration model (canonical → adapter → consumer). Changes are additive specifications and lightweight code layered onto existing infrastructure:

```
┌──────────────────────────────────────────────────────────────┐
│                    DOCUMENTATION LAYER (NEW)                  │
│  SDD §3.1  — Graduation criteria + thresholds                │
│  SDD §3.4  — Cold-restart config strategy                    │
│  SDD §3.5  — Ceremony geometry spec                          │
│  SDD §3.6  — Protocol naming                                 │
├──────────────────────────────────────────────────────────────┤
│                    SPECIFICATION LAYER (NEW)                   │
│  spec/contracts/                                              │
│  ├── contract.json          (FR-2: consumer-driven contract)  │
│  ├── vectors-bundle.sha256  (FR-2: conformance vector hash)   │
│  ├── validate.mjs           (FR-2: validation script)         │
│  └── README.md              (FR-2: hounfour CI instructions)  │
├──────────────────────────────────────────────────────────────┤
│                    CODE LAYER (MINIMAL)                        │
│  protocol/graduation.ts     (FR-1: type + gauge)              │
│  protocol/micro-usd-schema.ts (FR-3: shared Zod schema)      │
│  config.ts                  (FR-4: fingerprint + doc comment)  │
├──────────────────────────────────────────────────────────────┤
│                    EXISTING (UNCHANGED)                        │
│  protocol/parse-boundary-micro-usd.ts  (metrics source)       │
│  protocol/index.ts           (barrel — adds new re-exports)   │
│  spec/conformance/           (vector source for contract)     │
└──────────────────────────────────────────────────────────────┘
```

### 2.2 Environment Variable Alignment

The PRD references `BOUNDARY_PARSE_MODE` in AC-3.2, but the existing codebase uses `PARSE_MICRO_USD_MODE` (see `parse-boundary-micro-usd.ts:12`). This SDD uses the **existing** env var name throughout. The gateway schema mode reads the same `PARSE_MICRO_USD_MODE` variable to ensure synchronization.

---

## 3. Component Design

### 3.1 FR-1: Shadow-to-Enforce Graduation Criteria

**Purpose:** Define explicit, measurable criteria for graduating `parseBoundaryMicroUsd` from shadow mode to enforce mode.

**Metric source clarification:** The PRD states "computable from existing counters + deployment timestamps" (AC-1.3). The graduation function uses existing BigInt counters (`shadowTotal`, `divergenceTotal`, `wouldRejectTotal`) from `BoundaryMetrics`. Two additional lightweight inputs are needed:

1. **`deployTimestamp`**: When shadow mode was deployed. Source: `SHADOW_MODE_DEPLOY_TIMESTAMP` env var set during deployment, or process start time as fallback. This is operational metadata, not new storage.
2. **`lastWouldRejectTimestamp`**: When `wouldRejectTotal` last incremented. Source: an in-memory `Date.now()` updated by the existing `parseBoundaryMicroUsd` metrics emitter when a would-reject event fires. This resets on process restart, which is acceptable because cold restart also resets the consecutive-clean window.

**Cross-restart durability (operational, not in-code):** For the operational graduation decision (performed by a human/runbook, not automated), the recommended check is the PromQL query `increase(boundary_would_reject_total[72h]) == 0` which is durable across restarts. The in-code `evaluateGraduation()` function provides a real-time signal; the PromQL query provides the authoritative durable signal.

#### 3.1.1 Graduation Thresholds

| Criterion | Threshold | Metric Source | Computation |
|-----------|-----------|---------------|-------------|
| Divergence rate | ≤ 0.1% over rolling 7-day window | `divergenceTotal` / `shadowTotal` per context | `(divergenceTotal(ctx) / shadowTotal(ctx)) * 100 ≤ 0.1` |
| Observation window | ≥ 7 days in shadow mode | Deployment timestamp of `PARSE_MICRO_USD_MODE=shadow` | `now - deployTimestamp ≥ 7 * 24 * 60 * 60 * 1000` |
| Would-reject rate | 0% for ≥ 72 consecutive hours | `wouldRejectTotal` per context | `wouldRejectTotal(ctx) === 0n` for 72h window with no increment |

**Rationale for thresholds:**
- **0.1% divergence**: Allows for minor formatting differences (e.g., `BigInt(" 100")` vs canonical rejection of whitespace) while catching systematic mismatches. Cycle-039 bridge data showed 0% divergence in production traffic.
- **7-day observation**: Covers full weekly traffic patterns including weekend/weekday variation.
- **0% would-reject for 72h**: Any non-zero means canonical is stricter on real traffic. The consecutive window prevents a single stale input from blocking graduation indefinitely — the counter must be flat for 3 full days.

#### 3.1.2 Type Definition

**File:** `themes/sietch/src/packages/core/protocol/graduation.ts` (new)

```typescript
/**
 * Boundary graduation criteria for parseBoundaryMicroUsd shadow→enforce transition.
 *
 * All criteria are computable from existing BoundaryMetrics counters
 * (shadowTotal, wouldRejectTotal, divergenceTotal) plus deployment timestamps.
 * No new storage or quarantine mechanism required.
 *
 * @see SDD cycle-040 §3.1
 */

import type { BoundaryContext, BoundaryMetrics } from './parse-boundary-micro-usd.js';

export interface BoundaryGraduationCriteria {
  /** Maximum divergence rate as parts-per-million (PPM). 1000 PPM = 0.1% */
  readonly maxDivergenceRatePpm: bigint;
  /** Minimum observation window in milliseconds. 604_800_000 = 7 days */
  readonly minObservationWindowMs: number;
  /** Consecutive window in ms where wouldRejectTotal must not increment. 259_200_000 = 72h */
  readonly wouldRejectConsecutiveWindowMs: number;
}

export const DEFAULT_GRADUATION_CRITERIA: BoundaryGraduationCriteria = {
  maxDivergenceRatePpm: 1000n,      // 0.1% = 1000 parts per million
  minObservationWindowMs: 604_800_000, // 7 days
  wouldRejectConsecutiveWindowMs: 259_200_000, // 72 hours
};

export interface GraduationStatus {
  readonly context: BoundaryContext;
  readonly ready: boolean;
  readonly criteria: {
    divergenceRate: { met: boolean; currentPpm: bigint; thresholdPpm: bigint };
    observationWindow: { met: boolean; currentMs: number; thresholdMs: number };
    wouldRejectClean: { met: boolean; wouldRejectTotal: bigint; consecutiveCleanMs: number; thresholdMs: number };
  };
  readonly evaluatedAt: string; // ISO 8601
}

/**
 * Evaluate graduation readiness for a given boundary context.
 *
 * All BigInt counter comparisons use integer arithmetic (PPM = parts per million)
 * to avoid Number precision loss. Counters are never converted to Number.
 *
 * @param metrics - Current BoundaryMetrics for the context
 * @param deployTimestamp - When shadow mode was deployed (ms since epoch)
 * @param lastWouldRejectTimestamp - Last time wouldRejectTotal incremented (ms since epoch).
 *        Source: in-memory timestamp updated by the parseBoundaryMicroUsd metrics emitter
 *        when a would-reject event occurs. If wouldRejectTotal is 0, this value is ignored.
 *        NOTE: This timestamp is per-process and resets on cold restart. After restart,
 *        the consecutive-clean window restarts from the deploy/restart timestamp.
 *        For cross-restart durability, use PromQL: `increase(wouldRejectTotal[72h]) == 0`.
 * @param criteria - Graduation criteria (defaults to DEFAULT_GRADUATION_CRITERIA)
 */
export function evaluateGraduation(
  context: BoundaryContext,
  metrics: BoundaryMetrics,
  deployTimestamp: number,
  lastWouldRejectTimestamp: number,
  criteria: BoundaryGraduationCriteria = DEFAULT_GRADUATION_CRITERIA,
): GraduationStatus {
  const now = Date.now();
  const PPM = 1_000_000n;

  // BigInt integer arithmetic: divergenceTotal * 1_000_000 <= shadowTotal * thresholdPpm
  // This avoids Number conversion and maintains full precision.
  const divergenceMet = metrics.shadowTotal > 0n
    ? metrics.divergenceTotal * PPM <= metrics.shadowTotal * criteria.maxDivergenceRatePpm
    : true; // No traffic yet — vacuously met
  const currentPpm = metrics.shadowTotal > 0n
    ? (metrics.divergenceTotal * PPM) / metrics.shadowTotal
    : 0n;

  const observationMs = now - deployTimestamp;
  const observationMet = observationMs >= criteria.minObservationWindowMs;

  // Would-reject: must be exactly 0n for the consecutive window
  const consecutiveCleanMs = metrics.wouldRejectTotal === 0n
    ? observationMs // never incremented — clean since deploy
    : now - lastWouldRejectTimestamp;
  const wouldRejectMet = metrics.wouldRejectTotal === 0n
    ? consecutiveCleanMs >= criteria.wouldRejectConsecutiveWindowMs
    : false; // any non-zero means not ready

  return {
    context,
    ready: divergenceMet && observationMet && wouldRejectMet,
    criteria: {
      divergenceRate: { met: divergenceMet, currentPpm, thresholdPpm: criteria.maxDivergenceRatePpm },
      observationWindow: { met: observationMet, currentMs: observationMs, thresholdMs: criteria.minObservationWindowMs },
      wouldRejectClean: { met: wouldRejectMet, wouldRejectTotal: metrics.wouldRejectTotal, consecutiveCleanMs, thresholdMs: criteria.wouldRejectConsecutiveWindowMs },
    },
    evaluatedAt: new Date(now).toISOString(),
  };
}
```

#### 3.1.3 Graduation Status Endpoint

**Option A (preferred): Prometheus gauge** — Expose `boundary_graduation_ready{context="http"}` as a Prometheus gauge (0 or 1) alongside existing shadow metrics. This requires no new HTTP endpoint and integrates with existing monitoring.

**Option B: Internal health check** — If an HTTP endpoint is used (AC-1.4), it MUST be:
- Protected by admin JWT claim check (`claims.role === 'admin'`)
- Bound to internal-only network (k8s `NetworkPolicy` restricting to internal CIDR)
- Not tenant-accessible
- Returns `GraduationStatus[]` for all boundary contexts

**Decision:** Implement as a function (`evaluateGraduation`) that can be called by either a Prometheus gauge collector or an admin endpoint. The exposure mechanism is chosen at deployment time.

#### 3.1.4 Mode-Toggle Test Integration

The existing `boundary-mode-toggle.test.ts` will be extended with graduation criteria assertions:
- Test that `evaluateGraduation` returns `ready: false` when divergence rate exceeds threshold
- Test that `evaluateGraduation` returns `ready: false` when observation window is insufficient
- Test that `evaluateGraduation` returns `ready: false` when wouldRejectTotal > 0 within consecutive window
- Test that `evaluateGraduation` returns `ready: true` when all three criteria are met

---

### 3.2 FR-2: Consumer-Driven Contract Testing (Pact Pattern)

**Purpose:** Define a contract specification at the actual integration seam so hounfour's CI can verify it doesn't break freeside's expectations before release.

#### 3.2.1 Contract Directory Structure

**Directory:** `spec/contracts/` (new)

```
spec/contracts/
├── contract.json           # Pinned entrypoints + behavioral contract
├── vectors-bundle.sha256   # Hash of conformance vector bundle
├── validate.sh             # Validation script
└── README.md               # Instructions for hounfour CI consumption
```

#### 3.2.2 Contract Specification (`contract.json`)

The contract is defined at the integration seam — the exact module entrypoints and function signatures that freeside imports from hounfour, plus the conformance vector bundle as the behavioral contract.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "contract_version": "1.0.0",
  "consumer": "loa-freeside",
  "provider": "loa-hounfour",
  "provider_version_range": ">=7.9.2",

  "entrypoints": [
    {
      "specifier": "@0xhoneyjar/loa-hounfour",
      "symbols": [
        "AGENT_LIFECYCLE_STATES",
        "AGENT_LIFECYCLE_TRANSITIONS",
        "CAPABILITY_SCOPES",
        "CREDENTIAL_CONFIDENCE_THRESHOLD",
        "TRUST_LEVELS",
        "computeCredentialPrior",
        "computeEventStreamHash",
        "detectReservedNameCollisions",
        "effectiveTrustLevel",
        "evaluateAccessPolicy",
        "evaluateEconomicBoundary",
        "evaluateFromBoundary",
        "flatTrustToScoped",
        "isCredentialExpired",
        "isKnownReputationState",
        "isValidTransition",
        "meetsThresholdForScope",
        "parseAgentIdentity",
        "parseMicroUsd",
        "reconstructAggregateFromEvents",
        "trustLevelForScope",
        "trustLevelIndex",
        "verifyAggregateConsistency"
      ]
    },
    {
      "specifier": "@0xhoneyjar/loa-hounfour/economy",
      "symbols": [
        "ESCROW_TRANSITIONS",
        "EscrowEntrySchema",
        "MintingPolicySchema",
        "MonetaryPolicySchema",
        "NFT_ID_PATTERN",
        "TRANSFER_CHOREOGRAPHY",
        "TRANSFER_INVARIANTS",
        "formatNftId",
        "isNegativeMicro",
        "isValidEscrowTransition",
        "isValidNftId",
        "negateMicro",
        "parseNftId",
        "subtractMicroSigned"
      ]
    },
    {
      "specifier": "@0xhoneyjar/loa-hounfour/governance",
      "symbols": [
        "ContributionRecordSchema",
        "DisputeRecordSchema",
        "ESCALATION_RULES",
        "PerformanceOutcomeSchema",
        "PerformanceRecordSchema",
        "REPUTATION_STATES",
        "REPUTATION_STATE_ORDER",
        "ReputationScoreSchema",
        "SANCTION_SEVERITY_LEVELS",
        "SanctionSchema",
        "VIOLATION_TYPES",
        "ValidatedOutcomeSchema"
      ]
    },
    {
      "specifier": "@0xhoneyjar/loa-hounfour/integrity",
      "symbols": [
        "CANONICAL_LIVENESS_PROPERTIES",
        "LivenessPropertySchema"
      ]
    },
    {
      "specifier": "@0xhoneyjar/loa-hounfour/model",
      "symbols": []
    }
  ],

  "conformance_vectors": {
    "note": "spec/vectors/ contains golden JSON test vector files (micro-usd.json, conservation-i1-i5.json, agent-lifecycle.json). spec/conformance/ contains TypeScript test runners that import and execute these vectors.",
    "data_path": "spec/vectors/",
    "runner_path": "spec/conformance/",
    "bundle_hash_algorithm": "sha256",
    "bundle_hash": "<computed-at-generation-time-from-spec/vectors/*.json>",
    "vector_count": "<computed-at-generation-time>"
  },

  "metadata": {
    "informational_only": {
      "note": "The following counts are informational metadata, not gating criteria (AC-2.7)",
      "conservation_property_count": 14,
      "liveness_property_count": 5,
      "evaluator_builtin_count": 7
    }
  }
}
```

**Key design decisions:**
- Entrypoints are organized by specifier (root vs subpath), matching the actual barrel imports in `protocol/index.ts`
- Type-only imports are excluded from the contract (they're compile-time only and don't affect runtime)
- The `symbols` array lists only runtime exports (functions, constants, schemas) — not TypeScript types
- `metadata.informational_only` explicitly marks counts as non-gating per AC-2.7

#### 3.2.3 Conformance Vector Bundle Hash

**File:** `spec/contracts/vectors-bundle.sha256`

The freeside codebase has two related directories (verified via `ls`):

| Directory | Contents | Purpose |
|-----------|----------|---------|
| `spec/vectors/` | 3 golden JSON files: `micro-usd.json` (12 vectors), `conservation-i1-i5.json`, `agent-lifecycle.json` | **Data** — the behavioral contract inputs/expected outputs |
| `spec/conformance/` | 3 TypeScript files: `test-micro-usd.ts`, `test-conservation.ts`, `test-lifecycle.ts` | **Runners** — vitest suites that import `../vectors/*.json` and execute them |

**Note:** The "205-vector conformance suite" referenced in cycle-039's SDD refers to hounfour's internal test vectors inside `node_modules/@0xhoneyjar/loa-hounfour/tests/vectors/`. Those are hounfour's own tests. The contract hashes **freeside's** `spec/vectors/` — the golden test vectors that define freeside's behavioral expectations of hounfour.

The contract hashes the **vector data files** (`spec/vectors/*.json`), not the test runners. The runners are the execution mechanism; the vectors are the behavioral contract.

Generated by hashing all vector JSON files in sorted order:

```bash
find spec/vectors/ -name '*.json' -type f | sort | xargs sha256sum | sha256sum | cut -d' ' -f1
```

The hash is stored alongside the contract. Provider verification runs the conformance test suite (`spec/conformance/`) which imports and executes vectors from `spec/vectors/` — if hounfour produces different results for the same inputs, the tests fail.

#### 3.2.4 Validation Script (`validate.mjs`)

The validator is a Node ESM script (not bash+inline require) to handle ESM packages and subpath exports correctly. It honors the installed package path and uses dynamic `import()` for resolution.

**File:** `spec/contracts/validate.mjs` (new)

```javascript
#!/usr/bin/env node
/**
 * Consumer Contract Validator
 *
 * Validates that the installed hounfour version satisfies the consumer contract
 * by dynamically importing each entrypoint specifier and checking for named exports.
 *
 * ESM-compatible: uses import() for resolution, works with package.json exports maps.
 *
 * Usage:
 *   node spec/contracts/validate.mjs                    # uses installed package
 *   node spec/contracts/validate.mjs --run-vectors      # also run conformance tests
 *
 * For hounfour CI: install freeside's contract as a devDependency, then:
 *   pnpm install   # installs hounfour candidate
 *   node node_modules/loa-freeside/spec/contracts/validate.mjs
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const contract = JSON.parse(await readFile(join(__dirname, 'contract.json'), 'utf-8'));

console.log('=== Consumer Contract Validation ===');
console.log(`Contract version: ${contract.contract_version}`);
console.log(`Provider range: ${contract.provider_version_range}`);

let failures = 0;

// 1. Verify entrypoint availability via dynamic import()
console.log('\n--- Entrypoint Availability ---');
for (const ep of contract.entrypoints) {
  const { specifier, symbols } = ep;
  try {
    const mod = await import(specifier);
    for (const sym of symbols) {
      if (!(sym in mod)) {
        console.log(`FAIL: ${specifier}.${sym} not found in exports`);
        failures++;
      }
    }
  } catch (err) {
    console.log(`FAIL: Cannot import ${specifier}: ${err.message}`);
    failures += symbols.length;
  }
}

if (failures === 0) {
  console.log('PASS: All entrypoints available');
}

// 2. Conformance vectors (optional — consumer CI only, requires vitest + full repo)
const runVectors = process.argv.includes('--run-vectors');
if (runVectors) {
  console.log('\n--- Conformance Vectors ---');
  // Resolve repo root: explicit --repo-root arg or cwd
  const repoRootIdx = process.argv.indexOf('--repo-root');
  const repoRoot = repoRootIdx !== -1 ? process.argv[repoRootIdx + 1] : process.cwd();

  const { execSync } = await import('node:child_process');
  try {
    execSync('npx vitest run spec/conformance/ --reporter=verbose', {
      stdio: 'inherit',
      cwd: repoRoot,
    });
  } catch {
    console.log('FAIL: Conformance vector suite failed');
    failures++;
  }
}

// 3. Report
console.log('\n=== Result ===');
if (failures === 0) {
  console.log('PASS: Contract satisfied');
  process.exit(0);
} else {
  console.log(`FAIL: ${failures} failures detected`);
  process.exit(1);
}
```

**Key design decisions:**
- Uses `import()` (not `require()`) to correctly resolve ESM packages and subpath exports
- Validates against the installed `node_modules` package — hounfour CI installs the candidate version then runs validation
- **Provider CI (hounfour):** Runs entrypoint availability checks only. This is self-contained and works from any directory since it validates installed package exports via `import()`.
- **Consumer CI (freeside):** Runs both entrypoint checks AND conformance vectors (`--run-vectors`). The `--run-vectors` flag requires the full freeside repo context (spec/conformance/ + spec/vectors/ + vitest) and must be run from the freeside repo root.
- The `--run-vectors` path resolves the repo root via `--repo-root` argument (default: `process.cwd()`) rather than assuming a fixed directory layout relative to the script

#### 3.2.5 README for hounfour CI Consumption

**File:** `spec/contracts/README.md`

Documents:
1. What the contract covers (entrypoints + behavioral vectors)
2. How to run `validate.sh` in hounfour's CI
3. How to update the contract when freeside adds/removes hounfour imports
4. What happens when the contract breaks (freeside must update, not hounfour must revert)

---

### 3.3 FR-3: Schema-Level Micro-USD Validation at API Gateway

**Purpose:** Add a shared Zod micro-USD schema at the gateway layer so invalid inputs are rejected before reaching `parseBoundaryMicroUsd`.

#### 3.3.1 Shared Schema Definition

**File:** `themes/sietch/src/packages/core/protocol/micro-usd-schema.ts` (new)

```typescript
/**
 * Mode-aware Zod micro-USD validation schema for API gateway inputs.
 *
 * Two modes synchronized with PARSE_MICRO_USD_MODE:
 *   - legacy/shadow: Permissive — accepts what BigInt() accepts (no production breakage)
 *   - enforce/canonical: Strict — matches parseMicroUsd acceptance (non-negative integer
 *     string, no leading zeros except "0", max 18 digits)
 *
 * The gateway schema is always equal-or-tighter than parseBoundaryMicroUsd in the
 * corresponding mode. It must never accept a string that the boundary parser would reject.
 *
 * @see PRD cycle-040 FR-3, AC-3.1–AC-3.6
 * @see SDD cycle-040 §3.3
 */

import { z } from 'zod';
import {
  resolveParseMode,
  MAX_SAFE_MICRO_USD,
  MAX_INPUT_LENGTH,
} from './parse-boundary-micro-usd.js';
import type { ParseMode } from './parse-boundary-micro-usd.js';

/**
 * Canonical micro-USD pattern: non-negative integer string.
 * - No leading zeros except bare "0"
 * - No whitespace, no plus sign, no decimal point
 * - Numeric bound enforced separately via BigInt comparison against
 *   MAX_SAFE_MICRO_USD — the SAME constant already enforced by
 *   parseBoundaryMicroUsd's safety floor (parse-boundary-micro-usd.ts:224).
 *   This is not an arbitrary cap; it is the existing platform safety ceiling
 *   ($1B = 1e15 micro-USD), confirmed to exceed p100 production values.
 *   If the platform limit changes, both gateway and boundary parser update
 *   via the shared constant — no independent digit-count cap exists.
 */
const CANONICAL_MICRO_USD_PATTERN = /^(0|[1-9]\d*)$/;

/**
 * Create a mode-aware micro-USD Zod schema.
 *
 * @param mode - Parse mode override. If omitted, reads from PARSE_MICRO_USD_MODE env var.
 */
export function createMicroUsdSchema(mode?: ParseMode) {
  const resolvedMode = mode ?? resolveParseMode();

  if (resolvedMode === 'enforce') {
    // Canonical mode: strict validation matching parseMicroUsd acceptance.
    // Two-stage: (1) regex for format (non-negative integer, no leading zeros),
    // (2) BigInt bound check against MAX_SAFE_MICRO_USD (1e15 = $1B).
    // The bound is derived from the existing safety floor constant, not a hardcoded
    // digit count, so it stays aligned if the limit ever changes.
    return z.string()
      .min(1, 'micro-USD value must not be empty')
      .max(MAX_INPUT_LENGTH, `micro-USD input exceeds max length (${MAX_INPUT_LENGTH})`)
      .regex(CANONICAL_MICRO_USD_PATTERN, 'micro-USD must be a non-negative integer string without leading zeros')
      .refine(
        (val) => {
          try {
            return BigInt(val) <= MAX_SAFE_MICRO_USD;
          } catch {
            return false;
          }
        },
        { message: `micro-USD value exceeds maximum (${MAX_SAFE_MICRO_USD})` },
      )
      .describe('Micro-USD amount (canonical mode)');
  }

  // Legacy/shadow mode: permissive — accepts any string that BigInt() would accept.
  // This preserves backward compatibility with production (NFR-3).
  // We still reject clearly invalid non-numeric strings to provide basic protection.
  return z.string()
    .min(1, 'micro-USD value must not be empty')
    .refine(
      (val) => {
        try {
          BigInt(val);
          return true;
        } catch {
          return false;
        }
      },
      { message: 'micro-USD must be a valid integer string' },
    )
    .describe('Micro-USD amount (legacy mode)');
}

/**
 * Gateway error response for micro-USD validation failure.
 */
export interface MicroUsdValidationError {
  error: 'INVALID_MICRO_USD';
  message: string;
  field: string;
  mode: ParseMode;
}

/**
 * Build a structured 400 error for micro-USD validation failure.
 */
export function buildMicroUsdError(field: string, message: string, mode: ParseMode): MicroUsdValidationError {
  return {
    error: 'INVALID_MICRO_USD',
    message,
    field,
    mode,
  };
}
```

#### 3.3.2 Mode Synchronization

The schema reads `PARSE_MICRO_USD_MODE` via the existing `resolveParseMode()` function from `parse-boundary-micro-usd.ts:L136`. Both the gateway schema and `parseBoundaryMicroUsd` call `resolveParseMode()`, which caches the resolved mode in a module-level variable (`cachedMode`) on first call. Within a single process, both components will always see the same mode because they share the same cached value.

**Drift boundaries:** This guarantee holds within a single Node.js process. It does NOT hold across:
- Multiple replicas with different env vars (prohibited by existing deployment constraint from cycle-039 SDD §3.6)
- Processes restarted at different times during a rolling deploy (mitigated by health checks confirming mode agreement)

**Implementation constraint:** The gateway schema MUST call `resolveParseMode()` — it must NOT read `process.env.PARSE_MICRO_USD_MODE` directly. Both components use the same shared function so mode resolution is a single source of truth per process.

| Mode | Gateway Schema | Boundary Parser | Behavior |
|------|---------------|-----------------|----------|
| `legacy` | BigInt-permissive | BigInt() only | Both accept the same inputs |
| `shadow` | BigInt-permissive | Both parsers, legacy result | Gateway matches legacy acceptance |
| `enforce` | Canonical-strict | Canonical drives | Gateway equal-or-tighter than boundary |

#### 3.3.3 Integration Points

Routes that accept micro-USD string inputs will use the schema in their Zod request body/query validators. The schema is applied once per route registration (not per-request), so mode is resolved at startup time.

**Affected routes** (routes that parse micro-USD from user input):
- `billing-routes.ts` — billing entry creation (`amount_micro` body field)
- `transfer.routes.ts` — transfer amounts
- `credit-pack-routes.ts` — credit pack amounts
- `spending-visibility.ts` — spending query parameters

**Non-affected** (internal data, not user-facing input):
- Database row mappers — internal data already persisted, not gateway validation
- Redis cache readers — internal data
- JWT claim parsing — handled by JWT verification pipeline

#### 3.3.4 Error Response

Invalid inputs return HTTP 400 with `MicroUsdValidationError` body before reaching `parseBoundaryMicroUsd`. The structured error includes the mode for debugging.

---

### 3.4 FR-4: Cache Invalidation Strategy Documentation

**Purpose:** Document the module-level env var caching behavior and formalize cold-restart as the required invalidation strategy.

#### 3.4.1 Current Behavior Analysis

`config.ts:897` executes `const parsedConfig = parseConfig()` at module load time. This means:

1. All `process.env.*` reads happen once, when `config.ts` is first imported
2. The Zod-validated config object is captured in a module-level constant
3. Any code that imports `config` gets the frozen-at-import-time values
4. `resolveParseMode()` in `parse-boundary-micro-usd.ts:157` similarly caches `PARSE_MICRO_USD_MODE` at first call

**Split-brain risk:** If env vars are changed at runtime (e.g., via TTL-based refresh), some call sites will see the old value (captured in closures/constants at import time) while others might see the new value (if they read through a dynamic accessor). For economic invariants and auth, this inconsistency is dangerous.

#### 3.4.2 Strategy: Cold Restart

**All environment variable changes require cold restart** (process restart / ECS task replacement). This includes:

| Category | Variables | Restart Required |
|----------|----------|-----------------|
| Parse mode | `PARSE_MICRO_USD_MODE` | Yes — cold restart |
| Feature flags (env) | `FEATURE_BILLING_ENABLED`, `FEATURE_GATEKEEPER_ENABLED`, etc. | Yes — cold restart |
| Secrets | `JWT_SECRET`, `PADDLE_WEBHOOK_SECRET`, `DATABASE_URL` | Yes — cold restart |
| Service URLs | `REDIS_URL`, `NATS_URL` | Yes — cold restart |
| Boundary engine | `ENABLE_CANONICAL_BOUNDARY_ENGINE` | Yes — cold restart |

**Runtime-evaluable flags** (read from Redis, not env vars):
- None currently. If Redis-backed feature flags are added in the future, they must be explicitly enumerated here and distinguished from env-var-backed flags (AC-4.5).

#### 3.4.3 Config Module Doc Comment

**File modified:** `themes/sietch/src/config.ts`

Add module doc comment at the top of the file (after imports):

```typescript
/**
 * Application Configuration — Module-Level Env Var Loading
 *
 * COLD-RESTART CONSTRAINT: All environment variables are loaded and validated
 * at module import time (line ~897). The resulting config object is immutable
 * for the lifetime of the process. ANY change to env vars (including
 * PARSE_MICRO_USD_MODE, feature flags, secrets, service URLs) requires a
 * cold restart (process restart / ECS task replacement).
 *
 * TTL-based hot-reload is NOT supported and is explicitly out of scope.
 * Partial hot-reload would create split-brain behavior within a single
 * process because many call sites capture config values in closures and
 * module-level constants. This is dangerous for economic invariants and auth.
 *
 * @see SDD cycle-040 §3.4
 */
```

#### 3.4.4 Config Fingerprint at Startup

Add a startup log line that emits a hash of all loaded config keys for audit and drift detection:

```typescript
import { createHash } from 'node:crypto';

function emitConfigFingerprint(cfg: AppConfig): void {
  // Hash all config keys (not values — values may contain secrets)
  const keys = extractConfigKeys(cfg).sort().join(',');
  const fingerprint = createHash('sha256').update(keys).digest('hex').slice(0, 16);

  // Also hash select non-secret values that affect behavior
  const behaviorValues = [
    String(cfg.features.billingEnabled),
    String(cfg.features.gatekeeperEnabled),
    String(cfg.features.redisEnabled),
    process.env.PARSE_MICRO_USD_MODE ?? 'shadow',
    process.env.ENABLE_CANONICAL_BOUNDARY_ENGINE ?? 'false',
  ].join(',');
  const behaviorHash = createHash('sha256').update(behaviorValues).digest('hex').slice(0, 16);

  logger.info({
    configFingerprint: fingerprint,
    behaviorFingerprint: behaviorHash,
    parseMicroUsdMode: process.env.PARSE_MICRO_USD_MODE ?? 'shadow',
    nodeEnv: process.env.NODE_ENV ?? 'development',
  }, 'Config loaded — cold-restart required for any env var change');
}

function extractConfigKeys(obj: Record<string, unknown>, prefix = ''): string[] {
  const keys: string[] = [];
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      keys.push(...extractConfigKeys(value as Record<string, unknown>, path));
    } else {
      keys.push(path);
    }
  }
  return keys;
}
```

Called immediately after `validateStartupConfig(parsedConfig)` at module load time.

---

### 3.5 FR-5: Ceremony Geometry — Post-Merge Synthesis Ritual

**Purpose:** Design a structural post-merge ceremony that connects what was built to what it means.

#### 3.5.1 Ceremony Specification

| Attribute | Value |
|-----------|-------|
| **Name** | The Naming Ceremony (post-merge synthesis) |
| **Trigger** | After merge of a cycle PR to main (significant cycle merges, not every PR) |
| **Participants** | The engineer who merged + the Bridgebuilder (as reviewer/witness) |
| **Duration** | One artifact, written within the merge cycle |
| **Output** | A synthesis artifact in `grimoires/loa/ceremonies/` |

#### 3.5.2 Ceremony Artifact Format

**Directory:** `grimoires/loa/ceremonies/` (new)

**Filename pattern:** `YYYY-MM-DD-cycle-NNN-{slug}.md`

**Required sections:**

```markdown
# Ceremony: {Cycle Title}

**Cycle:** cycle-NNN
**PR:** #{number}
**Date:** YYYY-MM-DD
**Participants:** {who was involved}

## What Was Built

{Concrete summary of what changed: files, features, patterns introduced.
Not a changelog — a narrative of the technical work.}

## Why It Matters

{Connect the work to the larger system identity. What does this cycle
change about how the system understands itself? What capability was
unlocked? What constraint was removed or formalized?}

## What It Changes About the System's Identity

{The deepest question: did this cycle change what the system IS,
not just what it DOES? If so, how?}

## What Questions Remain

{Honest accounting of what's unresolved, deferred, or newly discovered.
These feed into the next cycle's Bridgebuilder review.}
```

#### 3.5.3 Trigger Criteria

A ceremony is triggered when:
1. A cycle PR is merged to main (PRs labeled `cycle-NNN`)
2. The cycle introduced significant architectural changes (not bug-fix-only cycles)
3. The Bridgebuilder review scored ≥ [3, *] on architectural depth

Not every PR gets a ceremony. Bug fixes, dependency bumps, and minor refactors are excluded.

#### 3.5.4 Inaugural Ceremony

The first ceremony is executed for cycle-039's merge (PR #94). This serves as both the template and the proof-of-concept.

**File:** `grimoires/loa/ceremonies/2026-02-24-cycle-039-protocol-convergence.md`

Content is written during sprint implementation — it is a deliverable of this cycle.

---

### 3.6 FR-6: Name the Protocol

**Purpose:** Choose a name for the economic protocol and propagate it through documentation and code.

#### 3.6.1 Protocol Name

The protocol name should capture: community-governed economic protocol for AI inference, with conservation invariants, conviction-gated access, and transparent disagreement resolution.

**Proposed names** (for user selection during implementation):

| Name | Rationale |
|------|-----------|
| **Loa Economic Protocol (LEP)** | Direct — names what it is. "Loa" is already the ecosystem name. Risk: too generic. |
| **Conviction Protocol** | Centers the key differentiator: conviction-gated access based on on-chain holding patterns. |
| **Commons Protocol** | Centers the governance model: community-governed commons for AI inference with conservation invariants. Echoes Ostrom's work on governing the commons. |

The user chooses during implementation. The name must NOT be a Dune reference (AC-6.5).

#### 3.6.2 Propagation Points

| Location | Change |
|----------|--------|
| `README.md` §"What is Freeside?" | Add: "Freeside implements the {Name} — a community-governed economic protocol for AI inference." |
| `BUTTERFREEZONE.md` | Update `purpose` field in AGENT-CONTEXT header and summary line |
| `protocol/index.ts` module doc | Add protocol name to the module doc comment (lines 1-13) |
| `grimoires/loa/ceremonies/` | Reference protocol name in inaugural ceremony artifact |

#### 3.6.3 What Does NOT Change

- Existing Dune references in the codebase (arrakis, sietch, etc.) remain unchanged
- Package names remain unchanged
- Variable names remain unchanged
- The protocol name is a documentation/identity concept, not a code rename

---

## 4. Security Architecture

### 4.1 Graduation Endpoint Protection (FR-1)

If graduation status is exposed as an HTTP endpoint (AC-1.4):

| Concern | Mitigation |
|---------|-----------|
| Tenant data leakage | Endpoint requires admin JWT claim (`role: 'admin'`) |
| Network exposure | Internal-only network policy (k8s NetworkPolicy or ALB rule) |
| Rate limiting | Standard admin rate limiting applies |

Preferred alternative: Prometheus gauge (`boundary_graduation_ready`) exposed on the existing metrics port, which is already internal-only.

### 4.2 Contract Specification (FR-2)

The contract spec in `spec/contracts/contract.json` contains no secrets. It lists public API surface (module exports) and behavioral test expectations. Safe to commit to the repository.

### 4.3 Gateway Schema (FR-3)

The mode-aware schema provides defense-in-depth:
- **Legacy/shadow mode**: No change in attack surface — accepts the same inputs as current production
- **Enforce mode**: Tighter validation reduces attack surface by rejecting ambiguous inputs (leading zeros, whitespace, signs) at the gateway before they reach business logic

---

## 5. Testing Strategy

### 5.1 Test Matrix

| FR | Test Type | File | Description |
|----|-----------|------|-------------|
| FR-1 | Unit | `tests/unit/graduation.test.ts` (new) | `evaluateGraduation` with various metric/timestamp combinations |
| FR-1 | Integration | `tests/unit/boundary-mode-toggle.test.ts` (extend) | Graduation criteria referenced in mode-toggle tests |
| FR-2 | Script | `spec/contracts/validate.sh` | Contract validation against current hounfour |
| FR-2 | Unit | `tests/unit/contract-spec.test.ts` (new) | Verify contract.json entrypoints match actual barrel exports |
| FR-3 | Unit | `tests/unit/micro-usd-schema.test.ts` (new) | Both modes: legacy accepts permissive, canonical rejects leading zeros |
| FR-3 | Integration | Route-level tests | 400 response for invalid inputs |
| FR-4 | Unit | `tests/unit/config-fingerprint.test.ts` (new) | Fingerprint emitted at startup |
| FR-5 | Manual | Code review | Ceremony artifact completeness check |
| FR-6 | Manual | Code review | Name appears in README, BUTTERFREEZONE, barrel doc |

### 5.2 FR-3 Schema Test Cases

**Canonical/enforce mode:**

| Input | Expected | Reason |
|-------|----------|--------|
| `"100"` | Accept | Valid non-negative integer |
| `"0"` | Accept | Zero is valid |
| `"1000000000000000"` | Accept | Exactly MAX_SAFE_MICRO_USD ($1B) |
| `"1000000000000001"` | Reject | Exceeds MAX_SAFE_MICRO_USD |
| `"0100"` | Reject | Leading zeros |
| `" 100"` | Reject | Leading whitespace |
| `"+100"` | Reject | Plus sign |
| `"-100"` | Reject | Negative |
| `"100.5"` | Reject | Decimal point |
| `""` | Reject | Empty string |
| `"abc"` | Reject | Non-numeric |

**Legacy/shadow mode:**

| Input | Expected | Reason |
|-------|----------|--------|
| `"100"` | Accept | BigInt("100") succeeds |
| `"0100"` | Accept | BigInt("0100") succeeds (octal not applied to BigInt) |
| `" 100"` | Accept | BigInt(" 100") succeeds (trims whitespace) |
| `"+100"` | Accept | BigInt("+100") succeeds |
| `"-100"` | Accept | BigInt("-100") succeeds |
| `"100.5"` | Reject | BigInt("100.5") throws |
| `""` | Reject | Empty string |
| `"abc"` | Reject | BigInt("abc") throws |

### 5.3 NFR-1 Compliance

All existing tests must continue to pass. No existing conformance vectors, conservation tests, or boundary tests are modified.

---

## 6. Implementation Phases

| Phase | FRs | Description | Files |
|-------|-----|-------------|-------|
| 1 | FR-6 | Name the protocol — choose name, update README, BUTTERFREEZONE, barrel doc | 3 files modified |
| 2 | FR-1 | Graduation criteria — type, function, tests, SDD section | 3 files created, 1 extended |
| 3 | FR-3 | Gateway schema — Zod schema, route integration, tests | 2 files created, 2-4 routes modified |
| 4 | FR-4 | Config strategy — doc comment, fingerprint, tests | 2 files modified, 1 test created |
| 5 | FR-2 | Contract spec — contract.json, validate.sh, README, verification test | 4 files created, 1 test created |
| 6 | FR-5 | Ceremony — spec doc, inaugural ceremony artifact | 2 files created |

**Parallelization:** Phases 1-2 are independent. Phases 3-4 are independent of each other but depend on Phase 1 (naming context). Phase 5 depends on Phase 2 (graduation criteria inform contract completeness). Phase 6 is independent.

---

## 7. Technical Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Gateway schema rejects valid production inputs in legacy mode | Low | High | Schema uses `BigInt()` acceptance in legacy mode — identical to current behavior |
| Graduation criteria too strict — shadow mode never graduates | Low | Medium | Criteria based on cycle-039 bridge data (0% divergence observed); thresholds are configurable constants |
| Contract spec becomes stale when barrel changes | Medium | Low | Verification test (`contract-spec.test.ts`) catches drift in CI |
| Config fingerprint adds startup latency | Very Low | Very Low | Single SHA-256 hash of ~100 keys — sub-millisecond |
| Protocol naming bikeshed | Medium | Low | 2-3 options presented to user; user decides |

---

## 8. Files Changed Summary

| Category | Files | Action |
|----------|-------|--------|
| Protocol types | 1 (`graduation.ts`) | New — graduation criteria type + evaluator |
| Protocol schema | 1 (`micro-usd-schema.ts`) | New — mode-aware Zod gateway schema |
| Protocol barrel | 1 (`protocol/index.ts`) | Modify — add re-exports for new modules |
| Config | 1 (`config.ts`) | Modify — add doc comment + fingerprint |
| Contract spec | 4 (`spec/contracts/*`) | New — contract.json, validate.mjs, vectors hash, README |
| Ceremony | 2 (`grimoires/loa/ceremonies/*`) | New — spec + inaugural artifact |
| Documentation | 3 (`README.md`, `BUTTERFREEZONE.md`, barrel doc) | Modify — protocol name |
| Tests | 4 (`graduation.test.ts`, `contract-spec.test.ts`, `micro-usd-schema.test.ts`, `config-fingerprint.test.ts`) | New |
| Test extension | 1 (`boundary-mode-toggle.test.ts`) | Modify — add graduation assertions |
| **Total** | **~18 files** | |

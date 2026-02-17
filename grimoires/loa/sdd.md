# SDD: The Voice from the Outer World — Canonical Protocol Adoption (v7.0.0)

**Version:** 1.1.0
**Date:** 2026-02-17
**Status:** Active
**Cycle:** cycle-034
**PRD:** grimoires/loa/prd.md (v1.1.0)

---

## 1. Executive Summary

This SDD designs the architecture for migrating arrakis from vendored loa-hounfour v4.6.0 protocol definitions to canonical `@0xhoneyjar/loa-hounfour` v7.0.0 package imports. The migration spans two integration points: (1) the agent adapter layer already importing at v1.1.0, and (2) the billing/sietch protocol layer with 14 vendored files and 40+ consumers. All work is arrakis-local (Phase 3 of the convergence plan).

**Key design decisions:**
- Direct canonical imports everywhere (no barrel re-export shim — FAANG approach, sustainable long-term)
- Full audit-and-align for arrakis-specific modules (config-schema, economic-events, identity-trust)
- Dual-run conservation validation with frozen local evaluator snapshot (transition safety)
- Two-layer CI drift detection: `CONTRACT_VERSION` + lockfile commit SHA
- Backward-compatible boundary layer accepts both v4.6.0 and v7.0.0 inbound during transition
- Arrakis-specific arithmetic helpers preserved as a utility module (separate from protocol types)

---

## 2. System Architecture

### 2.1 Migration Strategy Overview

The migration follows a **delete-and-replace** pattern, not a gradual shim. Each vendored file is either:
1. **DELETED** — canonical package exports equivalent (import directly)
2. **REDUCED** — canonical provides the type, arrakis keeps local helpers/extensions
3. **KEPT** — no canonical equivalent exists (arrakis-specific)

```
┌─────────────────────────────────────────────────────┐
│  BEFORE (v4.6.0 vendored)                           │
│                                                     │
│  core/protocol/ (14 files, ~2220 lines)             │
│  ├── state-machines.ts       ─── VENDORED ───┐      │
│  ├── arithmetic.ts           ─── VENDORED ───┤      │
│  ├── compatibility.ts        ─── VENDORED ───┤      │
│  ├── billing-types.ts        ─── VENDORED ───┤      │
│  ├── guard-types.ts          ─── VENDORED ───┤      │
│  ├── conservation-props.ts   ─── LOCAL    ───┤      │
│  ├── jwt-boundary.ts         ─── LOCAL    ───┤      │
│  ├── billing-entry.ts        ─── VENDORED ───┤      │
│  ├── identity-trust.ts       ─── LOCAL    ───┤      │
│  ├── config-schema.ts        ─── LOCAL    ───┤      │
│  ├── economic-events.ts      ─── LOCAL    ───┤      │
│  ├── atomic-counter.ts       ─── LOCAL    ───┤      │
│  └── index.ts                ─── BARREL   ───┘      │
│                                                     │
│  40+ consumers import via ../../core/protocol/      │
│  4 agent adapters import via @0xhoneyjar/loa-hounfour │
└─────────────────────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────┐
│  AFTER (v7.0.0 canonical)                           │
│                                                     │
│  @0xhoneyjar/loa-hounfour v7.0.0                    │
│  ├── CONTRACT_VERSION, state machines               │
│  ├── MicroUSD, BasisPoints, AccountId (branded)     │
│  ├── Conservation evaluator + 147 constraints       │
│  ├── validateCompatibility(), trust_scopes          │
│  ├── JWT schemas, error codes, pool vocabulary      │
│  └── Coordination schema (v7.0.0 structure)         │
│                                                     │
│  core/protocol/ (REDUCED — arrakis extensions only) │
│  ├── arrakis-arithmetic.ts   ── bpsShare, addMicroUSD │
│  ├── arrakis-billing.ts      ── BillingEntry mapper │
│  ├── arrakis-conservation.ts ── error taxonomy adapter│
│  ├── arrakis-compat.ts       ── boundary compat layer│
│  ├── config-schema.ts        ── 22 constitutional params│
│  ├── economic-events.ts      ── 31 event types      │
│  ├── identity-trust.ts       ── graduated trust     │
│  ├── atomic-counter.ts       ── Redis atomic ops    │
│  └── index.ts                ── barrel for arrakis ext│
│                                                     │
│  ALL consumers import canonical types directly      │
│  from @0xhoneyjar/loa-hounfour                      │
└─────────────────────────────────────────────────────┘
```

### 2.2 Component Map (Changes Only)

| Component | Location | Change Type | PRD Ref |
|-----------|----------|-------------|---------|
| Package dependency | `package.json`, `packages/adapters/package.json` | Bump v1.1.0 → v7.0.0 | FR-1 |
| Protocol layer | `core/protocol/*.ts` (14 files) | Delete/reduce/restructure | FR-2, FR-3, FR-4 |
| Billing adapters | `adapters/billing/*.ts` (23 files) | Import path migration | FR-2 |
| API routes | `api/routes/*.ts` (7 files) | Import path migration | FR-2 |
| Agent adapters | `packages/adapters/agent/*.ts` (4 files) | Version bump only | FR-1 |
| JWT boundary | `jwt-boundary.ts` → `arrakis-compat.ts` | Claim schema update + backward compat | FR-5 |
| Compatibility | `compatibility.ts` → `arrakis-compat.ts` | Version negotiation update | FR-6 |
| Conservation tests | `tests/unit/protocol/` | Dual-run harness + migration | FR-3, FR-8 |
| CI drift tests | `tests/unit/protocol/` | Two-layer version assertion | FR-7 |
| Property tests | `tests/unit/billing/property-tests/` | Import path migration | FR-8 |
| Fixtures | `tests/fixtures/` | Add frozen evaluator, delete hash fixtures | FR-3, FR-7 |

### 2.3 Unchanged Components

- Database schema and migrations (NFR-3)
- Infrastructure/Terraform (NFR-3)
- Discord/Telegram bot layer
- CLI package
- Theme system
- Redis/BullMQ job infrastructure

---

## 3. Detailed Design

### 3.1 Dependency Upgrade (FR-1)

**Both `package.json` files** (pin by resolved commit SHA for immutability, not mutable tag):
```json
{
  "@0xhoneyjar/loa-hounfour": "github:0xHoneyJar/loa-hounfour#<v7.0.0-resolved-sha>"
}
```

**Verification after install:**
```typescript
import { CONTRACT_VERSION } from '@0xhoneyjar/loa-hounfour';
assert(CONTRACT_VERSION === '7.0.0');
```

**Lockfile SHA recording:** After `npm install`, extract the resolved commit SHA from `package-lock.json` and record as `EXPECTED_HOUNFOUR_SHA` constant in the drift detection test.

### 3.2 Import Path Migration Strategy (FR-2)

**Approach: Direct canonical imports everywhere.**

Every consumer file that currently imports from `../../core/protocol/` (or similar relative path) will be updated to import canonical types directly from `@0xhoneyjar/loa-hounfour`. Arrakis-specific utilities remain importable from `../../core/protocol/`.

**Migration pattern for each consumer:**

```typescript
// BEFORE (vendored)
import {
  MicroUSD, microUSD, addMicroUSD,           // branded types + helpers
  RESERVATION_MACHINE, isValidTransition,     // state machines
  ENTRY_TYPES, EntryType,                     // billing types
  ConservationProperty,                       // conservation
  PROTOCOL_VERSION, validateCompatibility,    // compatibility
} from '../../core/protocol';

// AFTER (canonical + arrakis extensions)
import {
  MicroUSD, microUSD,                         // canonical branded types
  RESERVATION_MACHINE, isValidTransition,     // canonical state machines
  ENTRY_TYPES, EntryType,                     // canonical billing types
  ConservationProperty,                       // canonical conservation
  CONTRACT_VERSION, validateCompatibility,    // canonical compatibility
} from '@0xhoneyjar/loa-hounfour';

import {
  addMicroUSD, subtractMicroUSD, bpsShare,   // arrakis arithmetic helpers
} from '../../core/protocol/arrakis-arithmetic';
```

**Execution order:**
1. Upgrade dependency (FR-1) — ensures canonical imports resolve
2. Create arrakis extension modules (new files for local helpers)
3. Migrate consumers in dependency order: types-only first, then logic files
4. Delete vendored files one-by-one (each deletion is a compile-time verification)
5. TypeScript compiler (`tsc --noEmit`) validates every step

### 3.3 File Disposition Table

| Current File | Action | Destination | Rationale |
|-------------|--------|-------------|-----------|
| `VENDORED.md` | DELETE | — | No longer vendoring |
| `state-machines.ts` | DELETE | Canonical import | v7.0.0 exports all 4 machines |
| `arithmetic.ts` | SPLIT | Branded types → canonical; helpers → `arrakis-arithmetic.ts` | Types canonical, helpers arrakis-specific |
| `compatibility.ts` | DELETE + ABSORB | Canonical `validateCompatibility()`; local compat logic → `arrakis-compat.ts` | v7.0.0 exports compatibility checking |
| `billing-types.ts` | DELETE or ALIGN | Canonical if v7.0.0 has equivalent; otherwise audit-and-keep | Depends on v7.0.0 export audit |
| `guard-types.ts` | DELETE or ALIGN | Canonical if v7.0.0 has equivalent | Depends on v7.0.0 export audit |
| `conservation-properties.ts` | DELETE (after dual-run) | Canonical evaluator; error taxonomy → `arrakis-conservation.ts` | Core safety migration |
| `jwt-boundary.ts` | REDUCE | Canonical claim schemas; verification pipeline → `arrakis-compat.ts` | v7.0.0 JWT schemas, arrakis-specific verification |
| `billing-entry.ts` | DELETE or ALIGN | Canonical wire format; mapper logic stays in adapter | Depends on v7.0.0 BillingEntry export |
| `identity-trust.ts` | AUDIT | Align with canonical `trust_scopes` if applicable; keep as extension if not | FR-5 breaking change |
| `config-schema.ts` | KEEP | Stays in `core/protocol/` | 22 constitutional parameters are arrakis-specific |
| `economic-events.ts` | AUDIT | Align with canonical event taxonomy if v7.0.0 exports one; keep if not | 31 event types may be arrakis-specific |
| `atomic-counter.ts` | KEEP | Stays in `core/protocol/` | Redis-specific, arrakis infrastructure |
| `index.ts` | REWRITE | Barrel re-export of arrakis extensions only | Consumers import canonical directly; index.ts only for arrakis modules |

### 3.4 Arrakis Extension Modules (New Files)

#### 3.4.1 `arrakis-arithmetic.ts`

Arithmetic helper functions that operate on canonical branded types but are arrakis-specific business logic:

```typescript
// arrakis-arithmetic.ts
import { MicroUSD, BasisPoints, microUSD, basisPoints } from '@0xhoneyjar/loa-hounfour';

// Arrakis-specific helpers (not in canonical package)
export function addMicroUSD(a: MicroUSD, b: MicroUSD): MicroUSD { ... }
export function subtractMicroUSD(a: MicroUSD, b: MicroUSD): MicroUSD { ... }
export function bpsShare(total: MicroUSD, bps: BasisPoints): MicroUSD { ... }
export function assertBpsSum(values: BasisPoints[]): void { ... }
export function dollarsToMicro(dollars: number): MicroUSD { ... }
export function microToDollarsDisplay(micro: bigint): string { ... }

// Re-export canonical constants for convenience
export { MICRO_USD_PER_DOLLAR, TOTAL_BPS, MAX_MICRO_USD } from '@0xhoneyjar/loa-hounfour';
```

**Design rationale:** If v7.0.0 exports these helpers natively, this file becomes unnecessary and is deleted. The module boundary allows us to verify canonical API surface first, then shrink.

#### 3.4.2 `arrakis-compat.ts`

Boundary compatibility layer for the Phase 3 transition period:

```typescript
// arrakis-compat.ts
import { CONTRACT_VERSION, validateCompatibility } from '@0xhoneyjar/loa-hounfour';

// Phase 3 transition: accept both v4.6.0 and v7.0.0 inbound
const SUPPORTED_VERSIONS = ['4.6.0', '7.0.0'] as const;
const PREFERRED_VERSION = '7.0.0';

export interface VersionNegotiationResult {
  preferred: string;
  supported: readonly string[];
  selected: string;
  backwardCompat: boolean;
}

export function negotiateVersion(remoteVersion: string): VersionNegotiationResult { ... }

// JWT claim schema compatibility: accept v4.6.0 trust_level OR v7.0.0 trust_scopes
export function normalizeInboundClaims(claims: unknown): NormalizedClaims { ... }

// Coordination message compatibility: accept v4.6.0 AND v7.0.0 format
export function normalizeCoordinationMessage(msg: unknown): NormalizedCoordination { ... }
```

**Lifecycle:** This module is temporary. After loa-finn upgrades (Phase 2), backward compat is removed and this module is deleted or reduced to a thin wrapper around canonical `validateCompatibility()`.

#### 3.4.3 `arrakis-conservation.ts`

Adapter between canonical conservation evaluator and arrakis error taxonomy:

```typescript
// arrakis-conservation.ts
import { evaluateConservation, type ConservationResult } from '@0xhoneyjar/loa-hounfour';

// Arrakis error codes (may not exist in canonical package)
export type ConservationErrorCode =
  | 'RECEIVABLE_BOUND_EXCEEDED'
  | 'BUDGET_OVERSPEND'
  | 'TERMINAL_STATE_VIOLATION'
  | 'TRANSFER_IMBALANCE'
  | 'DEPOSIT_BRIDGE_MISMATCH'
  | 'SHADOW_DIVERGENCE';

export type ReconciliationFailureCode =
  | 'LOT_CONSERVATION_DRIFT'
  | 'ACCOUNT_CONSERVATION_DRIFT'
  | 'PLATFORM_CONSERVATION_DRIFT'
  | 'BUDGET_CONSISTENCY_DRIFT'
  | 'TREASURY_INADEQUATE';

export class ConservationViolationError extends Error {
  constructor(
    public readonly code: ConservationErrorCode,
    public readonly invariantId: string,
    message: string,
  ) {
    super(message);
    this.name = 'ConservationViolationError';
  }
}

// Adapter: maps canonical evaluation result → arrakis error taxonomy
export function evaluateWithArrakisErrors(
  ...args: Parameters<typeof evaluateConservation>
): ConservationResult & { arrakisErrorCode?: ConservationErrorCode } { ... }
```

**Design rationale:** If canonical v7.0.0 exports equivalent error codes, this adapter becomes unnecessary. The separate module allows us to verify and eliminate.

### 3.5 Conservation Dual-Run Validation (FR-3)

The conservation migration is the highest-risk change — billing correctness is the platform's trust anchor. The dual-run pattern provides transition safety.

```
┌──────────────────────────────────────────────────┐
│              DUAL-RUN TEST HARNESS               │
│                                                  │
│  Property-based test generator                   │
│  ├── Generates random billing traces             │
│  ├── Same traces fed to BOTH evaluators          │
│  └── Assertion: results must match               │
│                                                  │
│  ┌─────────────┐     ┌─────────────────────┐    │
│  │ FROZEN LOCAL │     │ CANONICAL v7.0.0    │    │
│  │ evaluator    │     │ evaluator           │    │
│  │ (snapshot    │     │ (from package)      │    │
│  │  of v4.6.0)  │     │                     │    │
│  └──────┬───────┘     └──────────┬──────────┘    │
│         │                        │               │
│         ▼                        ▼               │
│  ┌────────────────────────────────────────┐      │
│  │ COMPARISON                             │      │
│  │ ├── Pass/fail must match               │      │
│  │ ├── Unenumerated disagreement = FAIL   │      │
│  │ └── Enumerated diffs = reviewed & OK   │      │
│  └────────────────────────────────────────┘      │
│                                                  │
│  PLUS: Evaluator-independent conservation test   │
│  └── SUM(debits) == SUM(credits) in MicroUSD    │
│       (property-based, no evaluator dependency)  │
└──────────────────────────────────────────────────┘
```

**Implementation:**

1. **Freeze local evaluator:** Copy current `conservation-properties.ts` to `tests/fixtures/frozen-conservation-evaluator.ts` as a test-only snapshot. This file is never modified.

2. **Dual-run harness:** `tests/unit/protocol/conservation-dual-run.test.ts`
   - Uses `fast-check` (or equivalent) for property-based trace generation
   - Generates traces with: deposits, reservations, finalizations, releases, transfers
   - **Edge case generators:** overflow bounds (MAX_MICRO_USD), zero amounts, negative attempts, terminal state transitions, concurrent reservations
   - Runs each trace through both evaluators
   - **Comparison target:** All 14 local invariant IDs (I-1 through I-14) must produce identical pass/fail results. Additionally, any v7.0.0 invariants beyond the local 14 are run and their results logged (not gated) to build understanding of the expanded constraint set.
   - **Strictness monotonicity:** v7.0.0 must be >= v4.6.0 strictness on the shared 14 invariants. If v7 passes where local fails, that's an acceptable relaxation to investigate. If v7 fails where local passes, that's a tightening — acceptable if trace generation covers it.
   - **Bounded allowlist (not permanent ENUMERATED_DIFFS):** Any known semantic differences are recorded in `KNOWN_DIFFS` with: invariant ID, description, review date, reviewer, and **expiry date** (max 30 days from merge). After expiry, the diff becomes a hard failure. This prevents permanent masking.
   - **Coverage requirement:** Property corpus must exercise every canonical invariant ID at least once (verified by a coverage counter in the harness)

3. **Evaluator-independent test:** `tests/unit/protocol/conservation-independent.test.ts`
   - Property: `SUM(all credit entries) == SUM(all debit entries)` over generated traces
   - Does NOT use either evaluator — directly computes conserved quantities
   - Catches regression even if both evaluators have the same bug
   - **Additional properties:** `reserved_micro <= available_micro` per account, no negative balances after finalization

4. **Migration gate:** Conservation module deletion is blocked until dual-run passes with zero unexpired allowlist entries and full invariant ID coverage.

### 3.6 Breaking Change: trust_scopes (FR-5)

**Current state:** `identity-trust.ts` has a graduated trust model but `trust_level`/`trust_scopes` are not used as string literals. The v6.0.0 breaking change affects JWT claim schemas and imported type definitions.

**Migration design:**

```
┌──────────────────────────────────────────────────┐
│  JWT CLAIM SCHEMA MIGRATION                      │
│                                                  │
│  v4.6.0 (if present):     v7.0.0 (canonical):   │
│  {                         {                     │
│    ...claims,               ...claims,           │
│    trust_level: number      trust_scopes: {      │
│  }                            read: boolean,     │
│                               write: boolean,    │
│                               admin: boolean,    │
│                             }                    │
│                           }                      │
│                                                  │
│  TRANSITION BEHAVIOR (Phase 3):                  │
│  ├── Outbound: always emit trust_scopes (v7)     │
│  ├── Inbound: accept trust_level (v4.6) OR       │
│  │            trust_scopes (v7) via normalizer   │
│  └── Rejection: unknown format → PROTOCOL_       │
│                  VERSION_MISMATCH error           │
└──────────────────────────────────────────────────┘
```

**Normalization safety rules:**

1. **Exactly-one-of enforcement:** Inbound claims MUST contain exactly one of `trust_level` (v4.6) or `trust_scopes` (v7.0). If both are present, REJECT with `CLAIMS_SCHEMA` error — conflicting fields indicate a crafted token or misconfigured issuer. If neither is present, REJECT.

2. **Least-privilege mapping table (trust_level → trust_scopes):**

| trust_level (v4.6) | trust_scopes (v7.0) | Rationale |
|--------------------|--------------------|-----------|
| 0 (none) | `{ read: false, write: false, admin: false }` | No access |
| 1-3 (low) | `{ read: true, write: false, admin: false }` | Read-only |
| 4-6 (medium) | `{ read: true, write: true, admin: false }` | Read+write, no admin |
| 7-9 (high) | `{ read: true, write: true, admin: false }` | Still no admin — admin requires explicit v7.0 trust_scopes |
| Any other value | REJECT with `CLAIMS_SCHEMA` | Out of range |

**Key invariant:** `trust_level` can NEVER normalize to `admin: true`. Admin access requires an explicit v7.0.0 `trust_scopes` claim. This is monotone and least-privilege by design.

3. **Post-normalization re-validation:** After normalization, the output canonical claim object is re-validated against the v7.0.0 Zod schema. This catches any normalization bugs that produce an invalid claim shape.

4. **Issuer/audience/subject constraints:** These are validated BEFORE normalization (step 1-2 of the 6-step pipeline) and are unchanged by the migration.

**Files affected:**
- `jwt-boundary.ts` → claim schema updates, verification pipeline preserved
- `identity-trust.ts` → align `IdentityTrustConfig` with canonical trust model if applicable
- `arrakis-compat.ts` → `normalizeInboundClaims()` with exactly-one-of + mapping table + re-validation

**Tests:**
- JWT encode/decode round-trip with v7.0.0 claim schema
- Inbound v4.6.0 token with valid trust_level accepted and mapped correctly (boundary values: 0, 3, 6, 9)
- Inbound v7.0.0 token with trust_scopes accepted
- Token with BOTH trust_level AND trust_scopes → REJECTED
- Token with NEITHER trust_level NOR trust_scopes → REJECTED
- trust_level=9 NEVER maps to admin:true (privilege escalation guard)
- trust_level out of range (negative, >9) → REJECTED
- Malformed token rejected with `PROTOCOL_VERSION_MISMATCH`
- Post-normalization output passes v7.0.0 schema validation

### 3.7 Breaking Change: Coordination Schema (FR-6)

**Current state:** `compatibility.ts` defines `PROTOCOL_VERSION = '4.6.0'` and `validateCompatibility()` with semver-based negotiation. The agent layer already imports `validateCompatibility()` from the canonical package.

**Migration design:**

```
┌──────────────────────────────────────────────────┐
│  VERSION NEGOTIATION — Phase 3 Transition        │
│                                                  │
│  /api/v1/compat endpoint returns:                │
│  {                                               │
│    "preferred": "7.0.0",                         │
│    "supported": ["4.6.0", "7.0.0"],             │
│    "protocol": "loa-hounfour"                    │
│  }                                               │
│                                                  │
│  INBOUND MESSAGE HANDLING:                       │
│  ├── v7.0.0 format → process directly            │
│  ├── v4.6.0 format → normalize via arrakis-compat│
│  ├── No version field → REJECT (missing required │
│  │   discriminator, never assume legacy)          │
│  └── Unknown version → REJECT with error         │
│                                                  │
│  OUTBOUND MESSAGE FORMAT:                        │
│  └── Always v7.0.0 (no backward compat outbound) │
└──────────────────────────────────────────────────┘
```

**Files affected:**
- `compatibility.ts` → DELETE (canonical `validateCompatibility()` used directly)
- `arrakis-compat.ts` → `negotiateVersion()`, `normalizeCoordinationMessage()`
- Billing routes → update `/api/v1/compat` response
- Agent layer → already using canonical, just version bump

### 3.8 CI Drift Detection (FR-7)

**Immutable pinning + three-layer assertion replaces hash-pinning:**

**Dependency specification:** Pin by commit SHA in addition to tag for immutability:
```json
{
  "@0xhoneyjar/loa-hounfour": "github:0xHoneyJar/loa-hounfour#<commit-sha>"
}
```
The v7.0.0 tag is used to identify which commit to pin, but the actual `package.json` records the resolved commit SHA (not the mutable tag). This prevents force-tag-move attacks.

**Three-layer drift detection:**

```typescript
// tests/unit/protocol/drift-detection.test.ts

import { CONTRACT_VERSION } from '@0xhoneyjar/loa-hounfour';
import { readFileSync } from 'fs';
import { join } from 'path';

const EXPECTED_HOUNFOUR_VERSION = '7.0.0';
const EXPECTED_HOUNFOUR_SHA = 'abc123def456...'; // Full SHA, updated on upgrade

describe('Protocol Drift Detection', () => {
  // Layer 1: Semantic version constant
  test('CONTRACT_VERSION matches expected', () => {
    expect(CONTRACT_VERSION).toBe(EXPECTED_HOUNFOUR_VERSION);
  });

  // Layer 2: Installed package identity (reads installed package.json, not lockfile URL)
  test('Installed package version matches expected', () => {
    const pkgPath = require.resolve('@0xhoneyjar/loa-hounfour/package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    expect(pkg.version).toBe(EXPECTED_HOUNFOUR_VERSION);
    // If gitHead is present (npm pack from git), verify it too
    if (pkg.gitHead) {
      expect(pkg.gitHead).toBe(EXPECTED_HOUNFOUR_SHA);
    }
  });

  // Layer 3: No vendored protocol files remain
  test('No vendored protocol files remain', () => {
    const protocolDir = join(__dirname, '../../src/packages/core/protocol');
    const allowed = new Set([
      'arrakis-arithmetic.ts',
      'arrakis-compat.ts',
      'arrakis-conservation.ts',
      'config-schema.ts',
      'economic-events.ts',
      'identity-trust.ts',
      'atomic-counter.ts',
      'index.ts',
    ]);
    // readdirSync and assert all files are in allowed set
  });
});
```

**Why not parse lockfile URLs:** Lockfile formats vary across npm/pnpm/yarn versions. The `resolved` URL format is not stable. Instead, we read the installed package's own `package.json` which is always present and format-stable.

**Upgrade procedure:**
1. Identify the new target commit SHA from the v7.x.y tag on GitHub
2. Update `package.json`: `"@0xhoneyjar/loa-hounfour": "github:0xHoneyJar/loa-hounfour#<new-sha>"`
3. Run `npm install` / `pnpm install`
4. Update `EXPECTED_HOUNFOUR_VERSION` and `EXPECTED_HOUNFOUR_SHA` in drift-detection.test.ts
5. Run full test suite

**Deleted artifacts:**
- `themes/sietch/scripts/gen-protocol-fixtures.ts`
- `themes/sietch/tests/fixtures/protocol-hashes.json`

### 3.9 Test Strategy

#### 3.9.1 Test Disposition

| Current Test | Action | Replacement | PRD Ref |
|-------------|--------|-------------|---------|
| State machine equivalence | DELETE | Canonical schema validation (machine IDs, state sets, terminals) | NFR-4 |
| Protocol hash fixtures | DELETE | Lockfile commit SHA assertion (drift-detection.test.ts) | NFR-4 |
| Vendored file drift | DELETE | Vendored-file absence test | NFR-4 |
| 14 conformance assertions | MIGRATE | Update imports, same assertions against canonical | FR-8 |
| 32 property tests | MIGRATE | Update imports, same property tests against canonical types | FR-8 |
| Conservation dual-run | NEW | Frozen local vs canonical evaluator comparison | FR-3 |
| Conservation independent | NEW | SUM(debits)==SUM(credits) property test | FR-3 |
| JWT v7.0.0 round-trip | NEW | Encode/decode with v7.0.0 claim schema | FR-5 |
| JWT backward compat | NEW | Accept v4.6.0 + v7.0.0 inbound tokens | FR-5 |
| Version negotiation | NEW | /api/v1/compat response format | FR-6 |
| Coordination compat | NEW | Accept both v4.6.0 and v7.0.0 coordination messages | FR-6 |
| Drift detection (2-layer) | NEW | CONTRACT_VERSION + lockfile SHA | FR-7 |

#### 3.9.2 Test File Map

| Test File | Type | Count | Status |
|-----------|------|-------|--------|
| `conservation-dual-run.test.ts` | Property-based | ~14 properties | NEW |
| `conservation-independent.test.ts` | Property-based | 1+ properties | NEW |
| `conservation-properties.test.ts` | Unit | 28 (14+14) | MIGRATE |
| `drift-detection.test.ts` | Unit | 3 | NEW (replaces hash-pinning) |
| `jwt-boundary-v7.test.ts` | Unit | 4+ | NEW |
| `version-negotiation.test.ts` | Unit | 4+ | NEW |
| `protocol-conformance.test.ts` | Unit | 14 | MIGRATE |
| `property-tests/*.test.ts` | Property-based | 32 | MIGRATE |

**Net test change:** +25 new tests, -3 deleted tests = net +22

---

## 4. Data Model

No database changes (NFR-3). The only data model change is the wire format for cross-service messages:

| Field | v4.6.0 | v7.0.0 | Transition |
|-------|--------|--------|------------|
| `contract_version` | `"4.6.0"` | `"7.0.0"` | Accept both inbound |
| `trust_level` | `number` | — (removed) | Normalize to `trust_scopes` |
| `trust_scopes` | — (not present) | `{ read, write, admin }` | Emit outbound |
| `protocol_version` (health) | `"4.6.0"` | `"7.0.0"` | Explicit version-gated change |

---

## 5. API Changes

### 5.1 Modified Endpoints

| Endpoint | Change | NFR-2 |
|----------|--------|-------|
| `GET /api/health` | `protocol_version` changes `4.6.0` → `7.0.0` | Version-gated, expected |
| `GET /api/v1/compat` | Returns `{ preferred: '7.0.0', supported: ['4.6.0', '7.0.0'] }` | Backward compat |

### 5.2 No New Endpoints

No new routes, no new middleware, no new webhooks.

---

## 6. Security Considerations

### 6.1 JWT Boundary

The JWT verification pipeline (6-step: signature → algorithm → schema → reservation → replay → overspend) is preserved unchanged. Only the claim schema definitions update (trust_scopes). EdDSA signature verification is not affected by the type migration.

### 6.2 Conservation Properties

Conservation invariants are the billing system's trust anchor. The dual-run validation (Section 3.5) ensures no silent regression in conservation checking. The evaluator-independent test provides a safety net that doesn't depend on either evaluator implementation.

### 6.3 Backward Compatibility

During the transition period (Phase 3):
- Inbound messages from pre-v7 peers are accepted via normalization (not rejected)
- Outbound messages use v7.0.0 format only
- The `normalizeInboundClaims()` function is the single point of backward compat logic — easy to audit and remove

---

## 7. Implementation Order

The implementation must follow a strict dependency order to ensure each step is compile-time verified:

### Sprint 1: Foundation (FR-1, FR-2 partial)

| Task | Dependencies | Verification |
|------|-------------|-------------|
| 1.1 Upgrade `@0xhoneyjar/loa-hounfour` to v7.0.0 in both package.json files | v7.0.0 tag exists on GitHub | `npm install` succeeds |
| 1.2 Audit v7.0.0 canonical exports against local protocol layer | Task 1.1 | Export comparison document |
| 1.3 Create `arrakis-arithmetic.ts` with local helpers importing canonical types | Task 1.1 | `tsc --noEmit` passes |
| 1.4 Create `arrakis-compat.ts` with version negotiation + backward compat | Task 1.1 | `tsc --noEmit` passes |
| 1.5 Create `arrakis-conservation.ts` with error taxonomy adapter | Task 1.1 | `tsc --noEmit` passes |

### Sprint 2: Consumer Migration (FR-2, FR-4)

| Task | Dependencies | Verification |
|------|-------------|-------------|
| 2.1 Migrate billing adapter imports (23 files) to canonical | Sprint 1 | `tsc --noEmit` passes |
| 2.2 Migrate API route imports (7 files) to canonical | Sprint 1 | `tsc --noEmit` passes |
| 2.3 Migrate test imports to canonical | Sprint 1 | `tsc --noEmit` passes |
| 2.4 Delete vendored files that are fully replaced by canonical | Tasks 2.1-2.3 | `npm test` passes |
| 2.5 Update agent adapter layer (version bump, verify imports) | Task 1.1 | Agent tests pass |

### Sprint 3: Breaking Changes + Conservation (FR-3, FR-5, FR-6)

| Task | Dependencies | Verification |
|------|-------------|-------------|
| 3.1 Freeze local conservation evaluator to test fixture | Sprint 1 | Snapshot file exists |
| 3.2 Create conservation dual-run test harness | Task 3.1, Sprint 2 | Dual-run passes |
| 3.3 Migrate conservation properties to canonical evaluator | Task 3.2 (gate) | Dual-run + unit tests pass |
| 3.4 JWT claim schema migration (trust_scopes) | Sprint 2 | JWT round-trip tests pass |
| 3.5 Coordination schema migration + version negotiation | Sprint 2 | Compat tests pass |
| 3.6 Backward compatibility tests (v4.6.0 + v7.0.0 inbound) | Tasks 3.4, 3.5 | Boundary tests pass |

### Sprint 4: CI, Cleanup, Conformance (FR-7, FR-8)

| Task | Dependencies | Verification |
|------|-------------|-------------|
| 4.1 Create two-layer drift detection tests | Sprint 2 | Drift tests pass |
| 4.2 Delete hash-pinning fixtures and gen script | Task 4.1 | No fixtures remain |
| 4.3 Run full conformance suite (14 assertions + 32 property tests) | Sprint 3 | All pass |
| 4.4 Rewrite `core/protocol/index.ts` as arrakis-extensions barrel | Sprint 3 | `tsc --noEmit` passes |
| 4.5 Audit arrakis-specific modules (config-schema, economic-events, identity-trust) | Sprint 3 | Audit document |
| 4.6 Full regression: `npm test` with zero skipped tests | All above | `npm test` green |

---

## 8. Rollback Strategy

### 8.1 Pre-Migration Anchor

Before the migration branch is created:
1. **Tag the pre-migration commit:** `git tag pre-v7-migration-anchor` on the last commit before migration work begins
2. **Create a release branch:** `release/pre-v7-baseline` from that tag, preserving the exact pre-migration state including lockfile and vendored files

### 8.2 Deterministic Rollback Procedure

If the migration causes issues after merge:

1. **Immediate (< 5 min):** `git revert <squash-merge-sha>` — this reverts the entire squash merge, restoring all files including `package.json`, lockfile, vendored protocol directory, and consumer import paths
2. **Run `npm install` / `pnpm install`** after revert to restore the pre-migration dependency graph from the restored lockfile
3. **Verify:** `npm test` passes on the reverted state

If `git revert` produces conflicts (other commits landed after squash):
1. **Create rollback branch** from `pre-v7-migration-anchor` tag
2. **Cherry-pick** any non-migration commits from main onto the rollback branch
3. **Merge** rollback branch to main

### 8.3 Boundary Normalizer Feature Flag

The backward-compatibility normalizers (`normalizeInboundClaims()`, `normalizeCoordinationMessage()`) are gated by a runtime feature flag:

```typescript
// arrakis-compat.ts
const V7_NORMALIZATION_ENABLED = process.env.PROTOCOL_V7_NORMALIZATION !== 'false';

export function normalizeInboundClaims(claims: unknown): NormalizedClaims {
  if (!V7_NORMALIZATION_ENABLED) {
    // Bypass v7 normalization, use v4.6 claim schema directly
    return parseV4Claims(claims);
  }
  // ... v7 normalization logic
}
```

This allows disabling v7 parsing without a code rollback if boundary issues are discovered in production. The flag defaults to enabled (`true`); setting `PROTOCOL_V7_NORMALIZATION=false` reverts to v4.6 behavior.

### 8.4 Rollback Artifacts Checklist

A rollback is deterministic only if ALL of these are restored:
- [ ] `package.json` (both root and adapters) → v1.1.0 dependency
- [ ] `package-lock.json` / `pnpm-lock.yaml` → pre-migration lockfile
- [ ] `themes/sietch/src/packages/core/protocol/` → all 14 vendored files
- [ ] Consumer import paths → relative `../../core/protocol/` imports
- [ ] Test fixtures → `protocol-hashes.json` restored
- [ ] CI drift detection → hash-pinning tests restored

The `git revert` of the squash merge handles all of these atomically.

---

## 9. Monitoring & Observability

No new monitoring required (NFR-3). The protocol version change is observable via:
- `GET /api/health` → `protocol_version` field
- `GET /api/v1/compat` → version negotiation response
- Agent audit events already log `contract_version`

---

## 10. Dependencies & Constraints

| Dependency | Status | Impact |
|-----------|--------|--------|
| loa-hounfour v7.0.0 GitHub tag | Must exist before Sprint 1 | Blocking |
| v7.0.0 exports branded types (MicroUSD, etc.) | To be verified in Task 1.2 | If not exported, keep local |
| v7.0.0 exports conservation evaluator | To be verified in Task 1.2 | If not exported, keep local |
| loa-finn upgrade (Phase 2) | NOT required | Backward compat handles this |
| npm publish | NOT required | Using GitHub tag install |

---

## 11. Open Questions (to Resolve in Sprint 1, Task 1.2)

These questions depend on the actual v7.0.0 export surface, which can only be verified after the dependency upgrade:

| Question | Impact | Fallback |
|----------|--------|----------|
| Does v7.0.0 export `MicroUSD`, `BasisPoints`, `AccountId` branded types? | If yes: delete local. If no: keep local arithmetic.ts | Keep local, import canonical when published |
| Does v7.0.0 export conservation evaluator builtins? | If yes: dual-run then replace. If no: keep local module | Keep local, document as extension |
| Does v7.0.0 export `BillingEntry` wire format? | If yes: delete local. If no: keep arrakis-billing.ts | Keep local billing entry mapper |
| Does v7.0.0 export economic event types? | If yes: align. If no: keep arrakis-specific | Keep local economic-events.ts |
| Does v7.0.0 export `trust_scopes` in JWT schema? | If yes: migrate claim schema. If no: trust_scopes migration is a no-op | Keep existing identity-trust.ts |
| Does v7.0.0 export config schema / constitutional params? | If yes: align. If no: keep arrakis-specific | Keep local config-schema.ts |

**Resolution strategy:** Sprint 1 Task 1.2 performs the export audit. Each question has an explicit fallback that preserves the current behavior. No question blocks the migration — they only determine how much local code can be deleted.

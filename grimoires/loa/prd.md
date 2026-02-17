# PRD: The Voice from the Outer World — Canonical Protocol Adoption (v7.0.0)

**Version:** 1.1.0
**Date:** 2026-02-17
**Status:** Active
**Cycle:** cycle-034
**Predecessor:** cycle-033 "The Weirding Way" (archived — verification work, pre-adoption)
**Source:** [loa-finn #66 comment](https://github.com/0xHoneyJar/loa-finn/issues/66#issuecomment-3914427997) (Phase 3: arrakis upgrade)

---

## 1. Problem Statement

Arrakis consumes loa-hounfour protocol definitions through two independent integration points, both severely behind the canonical source:

1. **Agent adapter layer** (`packages/adapters/agent/`) imports `@0xhoneyjar/loa-hounfour` at **v1.1.0** via GitHub tag — **6 major versions behind** canonical v7.0.0.

2. **Billing/sietch protocol layer** (`themes/sietch/src/packages/core/protocol/`) vendored a snapshot at **v4.6.0** with 14 local files — **3 major versions behind** canonical v7.0.0.

The vendoring was necessary because loa-hounfour wasn't published to npm. Meanwhile, arrakis independently built conservation properties, branded types, and a constraint system that now have canonical equivalents in hounfour v7.0.0. The extraction tracker ([loa-hounfour #13](https://github.com/0xHoneyJar/loa-hounfour/issues/13)) is closed — the abstractions arrakis invented locally are now protocol-level definitions.

**The risk of inaction:** Every day the gap persists, arrakis's local definitions drift further from the canonical source. The 2 breaking changes (v6.0.0: `trust_level` → `trust_scopes`; v7.0.0: coordination schema structure) will only get harder to adopt as more code builds on the stale vendored layer.

> Sources: [loa-finn #66 comment (2026-02-17)](https://github.com/0xHoneyJar/loa-finn/issues/66#issuecomment-3914427997), `themes/sietch/src/packages/core/protocol/VENDORED.md`, `themes/sietch/src/packages/core/protocol/compatibility.ts:24`

---

## 2. Goals

| ID | Goal | Metric | Priority |
|----|------|--------|----------|
| G-1 | Upgrade to canonical loa-hounfour v7.0.0 across both integration points | Dependency resolves to GitHub tag v7.0.0; `import { CONTRACT_VERSION } from '@0xhoneyjar/loa-hounfour'` returns `'7.0.0'`; lockfile records resolved commit SHA | P0 |
| G-2 | Delete vendored protocol layer entirely | 0 vendored copies in `themes/sietch/src/packages/core/protocol/`; only barrel re-exports + arrakis-specific extensions remain | P0 |
| G-3 | Handle both breaking changes with boundary safety | v6.0.0 trust_scopes + v7.0.0 coordination schema compile, pass tests, and have explicit boundary compatibility strategy for pre-v7 peers | P0 |
| G-4 | Wire CI-grade drift detection | Automated test asserts `CONTRACT_VERSION` matches expected + lockfile commit SHA matches expected; replaces vendored-file hash-pinning | P1 |
| G-5 | Verify conservation properties hold under canonical evaluator with dual-run validation | All 14 invariants pass both local (frozen snapshot) and canonical evaluator on same traces during transition; 32 property tests green | P0 |
| G-6 | Zero arrakis-internal regressions | Full test suite green; no behavioral changes in arrakis-internal logic. Boundary changes (protocol_version, claim schemas) are version-gated, not "invisible" | P0 |

---

## 3. Scope

### In Scope (arrakis-local work)

All work is **arrakis-local**. This is Phase 3 from the [convergence plan](https://github.com/0xHoneyJar/loa-finn/issues/66#issuecomment-3914427997).

1. **Dependency bump** — Upgrade `@0xhoneyjar/loa-hounfour` from `github:#v1.1.0` to `github:#v7.0.0` (GitHub tag until npm publish)
2. **Vendored file replacement** — Delete 14 vendored files in `themes/sietch/src/packages/core/protocol/`, replace with canonical imports
3. **Breaking change: trust_scopes** — Migrate any `trust_level` references to capability-scoped `trust_scopes` (v6.0.0 breaking)
4. **Breaking change: coordination schema** — Adapt to v7.0.0 coordination schema structure changes
5. **Conservation property migration** — Replace local `conservation-properties.ts` with canonical evaluator imports
6. **Branded type migration** — Replace local `MicroUSD`, `BasisPoints`, `AccountId` with canonical definitions
7. **CI drift detection** — Replace commit-hash pinning with semver-based version assertion
8. **Conformance test suite** — Run existing 14 assertions + 32 property tests against canonical source

### Out of Scope

- Publishing `@0xhoneyjar/loa-hounfour` to npm (external — Phase 1)
- loa-finn upgrade (Phase 2 — separate repo)
- Cross-system E2E Docker Compose (Phase 4 — separate cycle)
- New feature development
- Production deployment changes

---

## 4. Functional Requirements

### FR-1: Dependency Upgrade (P0)

**Context:** Root `package.json:7` and `packages/adapters/package.json:74` both pin `@0xhoneyjar/loa-hounfour` to `github:0xHoneyJar/loa-hounfour#v1.1.0`. The npm package is not yet published, so we continue using GitHub tag install.

**Requirements:**
1. Update both `package.json` files: `"@0xhoneyjar/loa-hounfour": "github:0xHoneyJar/loa-hounfour#v7.0.0"`
2. Run `npm install` / lockfile update
3. Verify `CONTRACT_VERSION` import resolves to `7.0.0`
4. Update `PROTOCOL_VERSION` constant in any remaining local references to `7.0.0`
5. Update `BILLING_ENTRY_CONTRACT_VERSION` in `billing-entry.ts` (or delete if canonical provides it)

**Acceptance Criteria:**
- `@0xhoneyjar/loa-hounfour` resolves to v7.0.0 tag
- `import { CONTRACT_VERSION } from '@0xhoneyjar/loa-hounfour'` returns `'7.0.0'`
- No version mismatch warnings at import time
- `tests/unit/protocol-conformance.test.ts` updated to expect `'7.0.0'`

### FR-2: Vendored State Machine Replacement (P0)

**Context:** `themes/sietch/src/packages/core/protocol/state-machines.ts` contains vendored state machine definitions with a `VENDORED_FROM` constant pinned to commit `d297b01`. The canonical package now exports these directly.

**Requirements:**
1. Delete `state-machines.ts` vendored content
2. Create a thin barrel re-export: `export { STATE_MACHINES, ... } from '@0xhoneyjar/loa-hounfour'`
3. Alternatively, if all consumers can be updated to import directly from the package, delete the file entirely and update import paths
4. Delete `VENDORED.md` — no longer vendoring
5. Delete `VENDORED_FROM` constant — no longer applicable
6. Update or delete `themes/sietch/tests/unit/protocol/state-machine-equivalence.test.ts` — equivalence tests against vendored copy are now redundant (both sides import the same source)
7. Update or delete `themes/sietch/scripts/gen-protocol-fixtures.ts` and `tests/fixtures/protocol-hashes.json` — hash-pinning is replaced by semver

**Acceptance Criteria:**
- No local state machine definitions — all imported from canonical package
- All 13+ state machine consumers compile against canonical types
- State machine equivalence tests either deleted or converted to canonical-only validation

### FR-3: Conservation Property Migration (P0)

**Context:** `themes/sietch/src/packages/core/protocol/conservation-properties.ts` defines 14 invariants built locally during cycle-033. loa-hounfour v7.0.0 now has canonical protocol-level definitions for these properties, including an evaluator system with 31 builtins and 147 constraints.

**Requirements:**
1. Audit canonical conservation definitions in hounfour v7.0.0 against local 14 invariants:
   - Map each local invariant (I-1 through I-14) to its canonical equivalent
   - Identify any local invariants without canonical equivalents (keep as extensions)
   - Identify canonical invariants not present locally (adopt)
   - Produce an explicit diff list of semantic differences (rounding, sign conventions, event ordering)
2. **Dual-run validation (transition safety):** Before deleting the local evaluator, freeze a test-only snapshot of the current local conservation module. Create a dual-run test harness that:
   - Generates traces via property-based testing (same traces for both evaluators)
   - Runs each trace through both the frozen local evaluator AND the canonical evaluator
   - Asserts both produce identical pass/fail results, except for explicitly enumerated, reviewed differences
   - Any unenumerated disagreement is a test failure (catches silent semantic regression)
3. Replace local `ConservationProperties` module with canonical imports (only after dual-run passes)
4. Preserve local error taxonomy (`ConservationErrorCode`, `ConservationViolationError`) if canonical package doesn't export equivalent error types — wrap canonical types with local error codes
5. Update `ReconciliationService` to use canonical evaluator for invariant checking
6. Add at least one end-to-end conservation invariant expressed as a conserved quantity over event streams (e.g., `SUM(debits) == SUM(credits)` in MicroUSD) with property-based generation, independent of either evaluator implementation
7. Ensure all 14 positive tests and 14 counterexample tests pass against canonical definitions

**Acceptance Criteria:**
- Frozen local evaluator snapshot preserved in `tests/fixtures/` for dual-run comparison
- Dual-run harness passes: both evaluators agree on all generated traces (or disagreements are explicitly enumerated and reviewed)
- Local conservation properties file deleted or reduced to a thin adapter (only after dual-run validation)
- Mapping document: local invariant ID → canonical invariant reference, with semantic diff list
- `ReconciliationService.reconcile()` uses canonical evaluator
- At least one evaluator-independent conservation test (conserved quantity assertion)
- All 28+ conservation tests green
- No regression in conservation checking behavior

### FR-4: Branded Type Migration (P0)

**Context:** `themes/sietch/src/packages/core/protocol/arithmetic.ts` defines local branded types `MicroUSD`, `BasisPoints`, `AccountId` with constructors (`microUSD()`, `basisPoints()`, `accountId()`). loa-hounfour v7.0.0 exports canonical branded types.

**Requirements:**
1. Compare local branded type definitions with canonical:
   - Verify structural compatibility (same branding pattern)
   - Verify constructor validation rules match
2. Replace local definitions with canonical imports
3. If canonical constructors have different validation (e.g., different range for BasisPoints), use canonical validation and update any tests that depend on local behavior
4. Update all 40+ call sites importing from local `arithmetic.ts`
5. Preserve local arithmetic helpers (`bpsShare()`, `assertBpsSum()`, `assertMicroUSD()`) if not provided by canonical — re-implement using canonical types

**Acceptance Criteria:**
- `MicroUSD`, `BasisPoints`, `AccountId` imported from `@0xhoneyjar/loa-hounfour`
- All arithmetic helpers compile against canonical types
- `@ts-expect-error` compile-time tests still pass
- All branded type consumers compile clean

### FR-5: Breaking Change — trust_scopes Migration (P0)

**Context:** v6.0.0 breaking change: `trust_level` → `trust_scopes`. Currently, arrakis has `identity-trust.ts` with a graduated trust model but uses neither `trust_level` nor `trust_scopes` as literal strings in its TypeScript source (grep confirms 0 matches). However, the breaking change affects JWT claim schemas and type definitions imported from hounfour — absence of string matches does NOT mean absence of impact, because the break manifests through re-exported types and runtime schema validation.

**Requirements:**
1. Audit canonical v7.0.0 types for `trust_scopes` usage — check all exported interfaces, not just string literals
2. If JWT claim schemas in hounfour reference `trust_scopes`, update arrakis's JWT boundary (`jwt-boundary.ts`) to use the new field
3. If `identity-trust.ts` concepts map to capability-scoped trust in hounfour, adopt canonical model
4. Add JWT encode/decode compatibility tests: serialize a v7.0.0 token, validate claim shape matches canonical schema
5. Define boundary behavior for pre-v7 peers: either accept both `trust_level` and `trust_scopes` during transition (preferred), or explicitly reject pre-v7 tokens with documented error code
6. Update any tests that reference trust levels

**Acceptance Criteria:**
- No references to deprecated `trust_level` in any imported types
- JWT claim schemas compatible with v7.0.0 wire format
- JWT encode/decode round-trip test passes with v7.0.0 claim schema
- Boundary behavior for pre-v7 tokens explicitly defined and tested (accept with fallback OR reject with `PROTOCOL_VERSION_MISMATCH`)
- `identity-trust.ts` aligned with canonical trust model or documented as arrakis extension

### FR-6: Breaking Change — Coordination Schema (P0)

**Context:** v7.0.0 breaking change: coordination schema structure changed. This affects any code that constructs or validates coordination messages between services. Since loa-finn (the primary peer) has NOT yet upgraded to v7.0.0 (Phase 2 is out of scope), arrakis must define explicit boundary behavior for the transition period.

**Requirements:**
1. Audit canonical v7.0.0 coordination schema changes — enumerate every structural difference
2. Update any local code that constructs coordination messages (e.g., billing routes, agent gateway compatibility checks)
3. Update `compatibility.ts` to use canonical `validateCompatibility()` from the package (already imported in agent layer — extend to billing layer)
4. Define version negotiation behavior for Phase 3 transition:
   - `/api/v1/compat` returns supported version range `[min, max]` and selects highest common version
   - During Phase 3: arrakis advertises v7.0.0 as preferred, accepts v4.6.0 inbound via compatibility mode (since loa-finn is still on v5.x)
   - Once Phase 2 completes (loa-finn upgrades), compatibility mode can be removed in a follow-up
5. Add test: arrakis accepts coordination message in v4.6.0 format (backward compat) AND v7.0.0 format
6. Add test: arrakis rejects malformed coordination messages with specific error

**Acceptance Criteria:**
- All coordination message construction uses v7.0.0 schema for outbound
- `validateCompatibility()` imported from canonical package everywhere (no local copy)
- Version negotiation endpoint returns `{ preferred: '7.0.0', supported: ['4.6.0', '7.0.0'] }` during transition
- Inbound coordination messages accepted in both v4.6.0 and v7.0.0 format (backward compat)
- Backward compat documented as temporary — to be removed after loa-finn Phase 2

### FR-7: CI Drift Detection (P1)

**Context:** Current drift detection uses SHA-256 hash of vendored files (`protocol-hashes.json`). With canonical package imports via GitHub tag, this should be replaced by a two-layer assertion: (1) `CONTRACT_VERSION` constant matches expected, and (2) lockfile-resolved commit SHA matches expected. Version constants alone are insufficient because GitHub tags can be moved/retagged — the lockfile commit SHA is the true identity of the resolved source.

**Requirements:**
1. Create a test that asserts `CONTRACT_VERSION` from the package equals `'7.0.0'` (exact, not range)
2. Create a test that reads `package-lock.json` (or equivalent lockfile) and asserts the resolved git commit SHA for `@0xhoneyjar/loa-hounfour` matches an expected constant (e.g., `EXPECTED_HOUNFOUR_SHA`)
3. Create a test that asserts no files in `themes/sietch/src/packages/core/protocol/` are vendored copies (allowlist for barrel re-exports and arrakis-specific extensions)
4. Delete `gen-protocol-fixtures.ts` and `protocol-hashes.json`
5. Document upgrade procedure: "To upgrade: (1) update GitHub tag in package.json, (2) npm install, (3) update EXPECTED_HOUNFOUR_SHA to new lockfile commit, (4) run tests"

**Acceptance Criteria:**
- `CONTRACT_VERSION` assertion test passes
- Lockfile commit SHA assertion test passes
- Vendored-file absence test passes (allowlist for extensions)
- No vendored-file hash fixtures remain
- Upgrade procedure documented in test file comments

### FR-8: Conformance Test Suite (P0)

**Context:** Arrakis has 14 conformance assertions and 32 property tests that verify conservation properties hold. These must continue passing against canonical definitions — they are the regression gate.

**Requirements:**
1. Run all existing tests after migration
2. Update any import paths that changed
3. Fix any type incompatibilities between local and canonical definitions
4. Add a test that imports canonical test vectors (if hounfour exports them) and runs them against arrakis's implementation

**Acceptance Criteria:**
- All existing 14 conformance assertions pass
- All 32 property tests pass
- Full `npm test` green
- No skipped or `.todo` tests introduced by this migration

---

## 5. Non-Functional Requirements

### NFR-1: Import Path Consistency

All protocol imports should resolve to `@0xhoneyjar/loa-hounfour` (canonical) or a barrel re-export in `core/protocol/index.ts`. No direct file-path imports to vendored files.

### NFR-2: Boundary Compatibility During Transition

External-facing API responses (billing routes, health check, version endpoints) must continue working. The `protocol_version` field in `/api/health` changes from `4.6.0` to `7.0.0` — this is an expected, version-gated change, not a silent regression.

**Transition period behavior** (Phase 3 only — before loa-finn upgrades in Phase 2):
- Arrakis advertises v7.0.0 as preferred protocol version
- Arrakis accepts inbound coordination/JWT messages in both v4.6.0 and v7.0.0 format (backward compat)
- Arrakis emits outbound messages in v7.0.0 format only
- Compatibility mode is temporary — to be removed after loa-finn Phase 2 completes
- Inbound messages with unrecognized protocol version are rejected with `PROTOCOL_VERSION_MISMATCH` error

This is NOT "invisible to production" — it is a deliberate, version-gated boundary change. The safety property is that arrakis-internal logic has zero behavioral regressions, while boundary changes are explicit and tested.

### NFR-3: No Database or Infrastructure Changes

This is a code-level migration. No database migrations, no runtime configuration changes, no infrastructure deployment changes. The only production-visible change is the protocol version advertised at API boundaries.

### NFR-4: Test Coverage Preservation

No reduction in statement/branch coverage for protocol modules. Tests may be restructured — redundant tests (vendored equivalence, hash-pinning) must be replaced 1:1 with canonical-only validation tests. Specifically:

| Deleted Test | Required Replacement |
|-------------|---------------------|
| State machine equivalence (vendored vs canonical) | Canonical schema validation test (verify exported machine IDs, state sets, terminal states) |
| Protocol hash fixtures (`protocol-hashes.json`) | Lockfile commit SHA assertion (FR-7) |
| Vendored file drift detection | Vendored-file absence test (FR-7) |

Property test count (32) and conformance assertion count (14) must be preserved or increased, never decreased.

---

## 6. Technical Context

### Current Integration Points

| Integration | Location | Current Version | Target Version | Ref |
|-------------|----------|----------------|----------------|-----|
| npm package | `package.json:7` | `github:#v1.1.0` | `github:#v7.0.0` | Root + adapters |
| Vendored state machines | `core/protocol/state-machines.ts` | v4.6.0 (commit d297b01) | Delete → import | `state-machines.ts:20-25` |
| Vendored arithmetic | `core/protocol/arithmetic.ts` | v4.6.0 | Delete → import | `arithmetic.ts:1` |
| Vendored compatibility | `core/protocol/compatibility.ts` | v4.6.0 | Delete → import | `compatibility.ts:24` |
| Vendored billing types | `core/protocol/billing-types.ts` | v4.6.0 | Delete → import | `billing-types.ts` |
| Vendored guard types | `core/protocol/guard-types.ts` | v4.6.0 | Delete → import | `guard-types.ts` |
| Local conservation | `core/protocol/conservation-properties.ts` | Local (cycle-033) | Replace with canonical evaluator | `conservation-properties.ts:1` |
| Local branded types | `core/protocol/arithmetic.ts` | Local (cycle-033) | Replace with canonical types | `arithmetic.ts:28-40` |
| Local identity trust | `core/protocol/identity-trust.ts` | Local | Align with canonical trust_scopes | `identity-trust.ts` |
| Local JWT boundary | `core/protocol/jwt-boundary.ts` | Local | Update claim schemas for v7.0.0 | `jwt-boundary.ts` |
| Local billing entry | `core/protocol/billing-entry.ts` | v4.6.0 | Update or replace | `billing-entry.ts` |
| Local economic events | `core/protocol/economic-events.ts` | Local | Keep or align | `economic-events.ts` |
| Local atomic counter | `core/protocol/atomic-counter.ts` | Local | Keep (arrakis-specific) | `atomic-counter.ts` |
| Local config schema | `core/protocol/config-schema.ts` | Local | Keep or align | `config-schema.ts` |

### Consumers of Vendored Protocol Layer

| Consumer | Files | Import Pattern |
|----------|-------|---------------|
| ReconciliationService | `adapters/billing/ReconciliationService.ts` | `../../core/protocol/` |
| CreditLedgerAdapter | `adapters/billing/CreditLedgerAdapter.ts` | `../../core/protocol/` |
| RevenueDistributionService | `adapters/billing/RevenueDistributionService.ts` | `../../core/protocol/` |
| BillingEntryMapper | `adapters/billing/billing-entry-mapper.ts` | `../../core/protocol/` |
| Billing routes | `api/routes/billing-routes.ts` | `../../packages/core/protocol/` |
| Public routes | `api/routes/public.routes.ts` | `../../packages/core/protocol/` |
| Property tests | `tests/unit/billing/property-tests/` | `../../../src/packages/core/protocol/` |
| Conservation tests | `tests/unit/protocol/conservation-properties.test.ts` | Import from module |
| Equivalence tests | `tests/unit/protocol/state-machine-equivalence.test.ts` | Import from module |
| Agent adapters | `packages/adapters/agent/*.ts` | `@0xhoneyjar/loa-hounfour` (already canonical) |

### Breaking Changes to Handle

| Version | Change | Impact on arrakis |
|---------|--------|-------------------|
| v6.0.0 | `trust_level` → `trust_scopes` | JWT claim schemas, identity-trust module. Currently unused in TS source (0 grep matches) — impact likely limited to type definitions. |
| v7.0.0 | Coordination schema structure | Compatibility validation, version negotiation endpoints. `validateCompatibility()` in billing routes and agent layer. |

### Files to Delete (Vendored → Canonical)

```
themes/sietch/src/packages/core/protocol/
├── VENDORED.md                    # DELETE — no longer vendoring
├── state-machines.ts              # DELETE — import from package
├── arithmetic.ts                  # DELETE or REDUCE — import types, keep local helpers
├── compatibility.ts               # DELETE — import from package
├── billing-types.ts               # DELETE or REDUCE — import from package
├── guard-types.ts                 # DELETE — import from package
├── conservation-properties.ts     # DELETE or REDUCE — import canonical evaluator
├── jwt-boundary.ts                # REVIEW — may have arrakis-specific extensions
├── identity-trust.ts              # REVIEW — align with trust_scopes or keep as extension
├── billing-entry.ts               # DELETE or REDUCE — import from package
├── economic-events.ts             # REVIEW — may be arrakis-specific
├── config-schema.ts               # REVIEW — may be arrakis-specific
├── atomic-counter.ts              # KEEP — arrakis-specific (Redis atomic operations)
└── index.ts                       # REWRITE — barrel re-export from canonical + local extensions
```

### Cross-Repo Dependencies

| Item | Repo | Status | Blocking? |
|------|------|--------|-----------|
| loa-hounfour v7.0.0 tag on GitHub | loa-hounfour | PR #14 MERGED, tag ready | **Yes** — must be tagged before `npm install` |
| npm publish | loa-hounfour | Not published | **No** — using GitHub tag install |
| loa-finn v7.0.0 upgrade | loa-finn | Not started (Phase 2) | **No** — independent |
| Cross-system E2E | Both repos | Not started (Phase 4) | **No** — separate cycle |

---

## 7. Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Canonical evaluator API differs from local conservation implementation | Medium | High | Audit canonical exports before replacing; keep local adapter if API diverges significantly |
| Import path changes break 40+ files | Medium | Medium | Use barrel re-export in `index.ts` to minimize path changes; TypeScript compiler catches all |
| Canonical branded types have different validation rules | Low | Medium | Compare constructors; update tests if canonical is stricter |
| v7.0.0 tag not yet created on GitHub | Low | High | Confirm tag exists before starting; fall back to commit SHA install if needed |
| Canonical package doesn't export all needed types | Medium | Medium | Keep local files for types not exported by canonical; document as arrakis extensions |
| Property test failures reveal semantic differences between local and canonical | Medium | High | Fix tests to match canonical semantics; document any intentional divergences |
| loa-hounfour v7.0.0 exports break TypeScript strict mode | Low | Medium | Fix type errors; strict mode is non-negotiable |
| Migration creates merge conflicts with feature branch work | Low | Medium | Do migration on a clean branch from main; coordinate with any parallel work |

---

## 8. Success Criteria

1. `@0xhoneyjar/loa-hounfour` resolves to v7.0.0 tag in both `package.json` files; `CONTRACT_VERSION === '7.0.0'`; lockfile commit SHA recorded
2. Vendored protocol directory reduced to barrel re-exports + arrakis-specific extensions (zero vendored copies)
3. Both breaking changes (v6.0.0 trust_scopes, v7.0.0 coordination schema) handled with explicit boundary compatibility for pre-v7 peers
4. Dual-run conservation validation passes: frozen local evaluator and canonical evaluator agree on all generated traces
5. All 14 conformance assertions pass against canonical source
6. All 32 property tests pass against canonical types
7. Full `npm test` green with zero skipped tests; redundant tests replaced 1:1 with canonical validation tests
8. CI drift detection via `CONTRACT_VERSION` + lockfile commit SHA replaces hash-pinning
9. Zero arrakis-internal behavioral regressions; boundary changes (protocol_version, claim schemas, coordination format) are version-gated with backward compat during transition

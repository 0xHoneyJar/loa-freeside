# PRD: Hounfour v7.9.2 Full Adoption — Protocol Convergence

**Version:** 1.2.0
**Cycle:** cycle-039
**Date:** 2026-02-23
**Status:** Draft

> Sources: loa-finn#66 (Launch Readiness RFC), loa-hounfour v7.9.2 release notes,
> grimoires/loa/context/v7-export-audit.md (cycle-034), grimoires/loa/context/rfc31-hounfour.md

---

## 1. Problem Statement

Freeside (arrakis) pins loa-hounfour at commit `ec50249` (v7.0.0), released 2026-02-17. The canonical protocol has since evolved through 9 additive minor releases to v7.9.2 (2026-02-23), introducing:

- A **shared decision engine** (`evaluateEconomicBoundary`) that codifies trust × capital → access decisions
- **Strict BigInt parsing** (`parseMicroUsd`) replacing ad-hoc string→bigint conversion
- **6-dimensional capability-scoped trust** replacing flat trust levels
- **Liveness properties** complementing the 14 safety (conservation) invariants
- **Governance vocabulary** (sanctions, disputes, reputation) formalizing patterns arrakis implements locally
- **Doubled conformance coverage** (91 → 202 test vectors)
- **42 evaluator builtins** (was 31), enabling richer constraint evaluation

Freeside's local protocol layer (`themes/sietch/src/packages/core/protocol/`) contains vendored types that duplicate, shadow, or lag behind canonical equivalents. The v7-export-audit (cycle-034) identified the disposition of each file but only the v7.0.0 baseline was adopted. Nine minor versions of protocol evolution remain unconsumed.

**This creates three risks:**
1. **Drift**: Local types diverge from canonical definitions, creating subtle incompatibilities
2. **Duplication**: Engineering effort spent maintaining local versions of types that exist upstream
3. **Feature gap**: New canonical capabilities (decision engine, liveness properties, governance) go unused despite being directly relevant to arrakis's conservation guard, velocity service, and governance auth

> Source: v7-export-audit.md, v7.9.2 release notes

---

## 2. Goals

| ID | Goal | Metric |
|----|------|--------|
| G-1 | Pin hounfour at v7.9.2 (`ff8c16b`) with zero runtime regressions | All existing 5420+ tests pass |
| G-2 | Adopt new canonical types in protocol barrel | Protocol barrel exports exactly the symbols consumed by arrakis adapters, services, routes, and conformance suite — verified by zero direct `@0xhoneyjar/loa-hounfour` imports outside the barrel and designated low-level modules |
| G-3 | Replace local implementations with canonical equivalents where audit says REDUCE/DELETE | ≥5 local implementations replaced |
| G-4 | Expand conformance test coverage to v7.9.2 vectors | 202 conformance vectors passing (was 91) |
| G-5 | Spike `evaluateEconomicBoundary` behind feature flag on one new path | Feature-flagged integration with equivalence test on ≥10 defined scenarios |
| G-6 | Adopt `parseMicroUsd` at protocol boundary parsing layer | Protocol boundary entry points use `parseMicroUsd`; internal trusted paths may retain `BigInt()` where inputs are pre-validated |

---

## 3. User & Stakeholder Context

### Primary Persona: Platform Engineer (Internal)
- Maintains the arrakis codebase
- Needs protocol types to match what loa-finn expects
- Benefits from reduced local type surface and canonical conformance

### Secondary Persona: Community Admin
- Indirectly affected — governance and conservation improvements increase system reliability
- No direct interaction with protocol types

### Tertiary: loa-finn (System)
- Protocol peer — contract version negotiation must succeed
- v7.9.2 is backward-compatible; existing v7.0.0 interactions remain valid

---

## 4. Functional Requirements

### FR-1: SHA Pin Bump

**Update the dependency pin in both `package.json` files** (root + `packages/adapters/`) from `ec5024938339121dbb25d3b72f8b67fdb0432cad` to `ff8c16b899b5bbebb9bf1a5e3f9e791342b49bea`.

**Acceptance Criteria:**
- AC-1.1: Root `package.json` references `ff8c16b...`
- AC-1.2: `packages/adapters/package.json` references `ff8c16b...`
- AC-1.3: `npm install` / `pnpm install` resolves successfully
- AC-1.4: `rebuild-hounfour-dist.sh` builds v7.9.2 dist successfully
- AC-1.5: `CONTRACT_VERSION` accessible and matches expected value
- AC-1.6: **Boundary payload replay** (Flatline SKP-001): Representative payloads from existing test fixtures (HTTP request bodies, database row snapshots, Redis cached values, JWT claims) are replayed through v7.9.2 boundary parsers. Zero unexpected rejections or semantic changes compared to v7.0.0 behavior. Any upstream behavioral deltas between v7.0.0 and v7.9.2 that affect runtime semantics are documented in a delta log.

### FR-2: Rebuild Script Update

**Update `scripts/rebuild-hounfour-dist.sh`** to handle v7.9.2's package structure (Loa framework ejected — cleaner dist).

**Acceptance Criteria:**
- AC-2.1: Script detects v7.9.2 structure (no `.claude/`, no `grimoires/`)
- AC-2.2: The following import specifiers resolve and typecheck after build: `@0xhoneyjar/loa-hounfour`, `@0xhoneyjar/loa-hounfour/core`, `/economy`, `/model`, `/governance`, `/constraints`, `/integrity` (per v7.9.2 `package.json#exports` map)
- AC-2.3: Stale-detection logic updated for v7.9.2 fingerprint
- AC-2.4: **Supply-chain verification** (Flatline SKP-003): Script verifies upstream commit SHA matches expected `ff8c16b...` before building. Built dist is validated against a manifest of expected export specifiers (all 7 subpackage entry points resolve). Build output is deterministic — running the script twice on the same commit produces identical dist.

### FR-3: Protocol Barrel Expansion

**Update `themes/sietch/src/packages/core/protocol/index.ts`** to re-export new v7.1–v7.9 types from canonical source.

New exports to add (organized by domain):

**Reputation & Trust (v7.1–v7.6):**
- `evaluateAccessPolicy`, `AccessPolicyContext`, `AccessPolicyResult`
- `CapabilityScopedTrust` (already imported in compat, expose in barrel)
- `REPUTATION_STATES`, `REPUTATION_STATE_ORDER`, `isKnownReputationState`, `ReputationStateName`
- `ReputationScoreSchema`, `ReputationScore`

**Event Sourcing & Replay (v7.3):**
- `reconstructAggregateFromEvents`, `verifyAggregateConsistency`, `computeEventStreamHash`
- `ReconstructedAggregate`, `ConsistencyReport`
- `computeCredentialPrior`, `isCredentialExpired`, `CREDENTIAL_CONFIDENCE_THRESHOLD`

**Governance (v7.3–v7.7):**
- `SanctionSchema`, `Sanction`, `SANCTION_SEVERITY_LEVELS`, `VIOLATION_TYPES`, `ESCALATION_RULES`
- `DisputeRecordSchema`, `DisputeRecord`
- `ValidatedOutcomeSchema`, `ValidatedOutcome`
- `PerformanceRecordSchema`, `PerformanceOutcome`
- `ContributionRecordSchema`, `ContributionRecord`

**Economy Extensions (v7.5–v7.9):**
- `parseMicroUsd`, `ParseMicroUsdResult`
- `evaluateEconomicBoundary`, `evaluateFromBoundary`
- `subtractMicroSigned`, `negateMicro`, `isNegativeMicro`
- `StakePositionSchema`, `StakePosition`
- `CommonsDividendSchema`, `CommonsDividend`
- `MutualCreditSchema`, `MutualCredit`
- `TRANSFER_CHOREOGRAPHY`, `TRANSFER_INVARIANTS`

**Integrity Extensions (v6.0–v7.8):**
- `LivenessPropertySchema`, `CANONICAL_LIVENESS_PROPERTIES`, `LivenessProperty`
- `detectReservedNameCollisions`, `NameCollision`

**Acceptance Criteria:**
- AC-3.1: All new types compile without errors
- AC-3.2: Protocol barrel exports are organized by domain with section comments
- AC-3.3: No duplicate exports (canonical takes precedence over local)
- AC-3.4: Existing consumers remain unaffected (additive only)
- AC-3.5: Only symbols actually consumed by arrakis code (adapters, services, routes, tests) are re-exported — no speculative re-exports of unused upstream symbols
- AC-3.6: Automated enforcement via ESLint `import/no-restricted-paths` rule (preferred) or grep check. **Explicit allowlist** of modules permitted to import directly from `@0xhoneyjar/loa-hounfour` (Flatline IMP-005):
  - `packages/adapters/agent/*.ts` — low-level JWT, pool, and compatibility adapter layer
  - `themes/sietch/src/packages/core/protocol/arrakis-*.ts` — canonical adapter files
  - `themes/sietch/src/api/routes/discovery.routes.ts` — discovery endpoint
  - `tests/**/*.ts` — conformance and E2E test suites
  - All other modules must import via the protocol barrel only

### FR-4: Local Type Reduction

**Replace local implementations with canonical equivalents** per the v7-export-audit disposition table.

| Local File | Disposition | Action |
|------------|-------------|--------|
| `compatibility.ts` | DELETE | Remove — `validateCompatibility()` imported from canonical |
| `VENDORED.md` | DELETE | Remove — vendoring metadata obsolete |
| `arrakis-arithmetic.ts` | REDUCE | Import branded types + helpers from `@0xhoneyjar/loa-hounfour/economy`; keep only local helpers (`dollarsToMicro`, `microToDollarsDisplay`, `assertMicroUSD`, `assertBpsSum`) |
| `arrakis-conservation.ts` | REDUCE | Import canonical 14 properties from `/integrity`; keep only adapter layer |
| `jwt-boundary.ts` | REDUCE | Import canonical verification steps; keep arrakis-specific claim types |

**Acceptance Criteria:**
- AC-4.1: `compatibility.ts` and `VENDORED.md` deleted
- AC-4.2: `arrakis-arithmetic.ts` imports branded types from canonical, exports only local extensions
- AC-4.3: `arrakis-conservation.ts` imports `CANONICAL_CONSERVATION_PROPERTIES` and `LivenessPropertySchema` from canonical
- AC-4.4: All consumers of deleted/reduced types updated to import from protocol barrel or canonical
- AC-4.5: Zero TypeScript compilation errors introduced

### FR-5: `evaluateEconomicBoundary` Spike (Stretch — Feature-Flagged)

**Spike the canonical decision engine behind a feature flag** on a new or secondary decision path. This is exploratory — the goal is to prove equivalence, not replace the production conservation guard.

`evaluateEconomicBoundary()` provides: trust × capital → access decision with structured denial reasons. The spike maps arrakis's trust dimensions (tier, conviction score) and capital variable (remaining budget micro-USD) into the canonical engine's input schema.

**Acceptance Criteria:**
- AC-5.1: Feature-flagged callsite (`ENABLE_CANONICAL_BOUNDARY_ENGINE=true`) uses `evaluateEconomicBoundary()`
- AC-5.2: Equivalence test suite defines ≥10 scenarios (allow, deny-budget, deny-tier, edge cases) and asserts canonical engine matches existing logic on all of them
- AC-5.3: When flag is off (default), existing behavior is completely unchanged — zero code path difference
- AC-5.4: If equivalence cannot be proven on all scenarios, findings are documented and FR-5 is deferred to next cycle
- AC-5.5: Input mapping is documented: which arrakis fields map to which canonical trust dimensions and capital variables

### FR-6: `parseMicroUsd` Adoption (Protocol Boundary Scope)

**Adopt `parseMicroUsd()` at protocol boundary entry points** — where external input (HTTP request bodies, database row strings, Redis values, JWT claims) is first parsed into micro-USD BigInt values.

`parseMicroUsd()` is strict: no floating-point, no leading zeros, discriminated union return. This is safer than `BigInt(value)` which silently accepts some invalid inputs.

**Scope boundary:** Internal trusted paths where values are already validated BigInts or come from prior `parseMicroUsd()` calls may retain direct `BigInt()` construction. The goal is to harden the system boundary, not rewrite all internal arithmetic.

**Migration safety:** Before replacing any `BigInt()` call, audit the actual input values at that callsite. If inputs could contain formats that `parseMicroUsd()` rejects (leading zeros, whitespace, plus signs), add a normalization step or log-and-compare period before switching.

**Acceptance Criteria:**
- AC-6.1: Protocol boundary entry points (HTTP route handlers, database row mappers, Redis value readers) use `parseMicroUsd()` for micro-USD string parsing
- AC-6.2: Error cases handled via discriminated union (not thrown exceptions) with structured error propagation
- AC-6.3: Unit tests verify strict parsing rejects invalid inputs (leading zeros, whitespace, floats, empty strings)
- AC-6.4: Internal trusted paths explicitly documented as out-of-scope with rationale
- AC-6.5: No runtime regressions — existing valid inputs continue to parse successfully (verified by existing test suite)
- AC-6.6: **Dual-parse rollout** (Flatline IMP-003): Before switching any callsite, run a log-and-compare period:
  - Duration: ≥1 sprint (run both parsers, log divergences)
  - Threshold: <0.1% divergence rate before cutover
  - Sampling: 100% of boundary calls during comparison period
  - Cutover criteria: Zero divergences for ≥24h OR all divergences audited and normalized
  - Kill-switch: Environment variable `PARSE_MICRO_USD_LEGACY=true` falls back to `BigInt()` at any callsite

### FR-7: Conformance Test Expansion

**Update the conformance test suite** from 91 to 202 test vectors.

**Acceptance Criteria:**
- AC-7.1: `tests/unit/protocol-conformance.test.ts` loads all 202 v7.9.2 vectors
- AC-7.2: All 202 vectors pass
- AC-7.3: New vector categories (governance, reputation, liveness) included
- AC-7.4: Vector loader updated to handle v7.9.2 vector directory structure

### FR-8: Verify-Peer-Version Update

**Update `scripts/verify-peer-version.sh`** if CONTRACT_VERSION or MIN_SUPPORTED_VERSION changed in v7.9.2.

**Version negotiation predicate** (from hounfour `validateCompatibility()`):
- Accept peer if `peer.major == self.major && peer.minor >= 0` (any v7.x accepts any v7.y)
- Accept peer if `peer.major == self.major - 1 && peer.version >= MIN_SUPPORTED_VERSION` (cross-major window)
- Reject otherwise

**Acceptance Criteria:**
- AC-8.1: Script reflects current CONTRACT_VERSION and MIN_SUPPORTED_VERSION from v7.9.2
- AC-8.2: Concrete version pair tests:
  - arrakis v7.9.2 ↔ finn v7.0.0 → PASS (same major)
  - arrakis v7.9.2 ↔ finn v7.5.0 → PASS (same major)
  - arrakis v7.9.2 ↔ finn v6.0.0 → PASS (cross-major, within window)
  - arrakis v7.9.2 ↔ finn v5.9.0 → FAIL (below MIN_SUPPORTED)
  - arrakis v7.9.2 ↔ finn v8.0.0 → FAIL (future major)
- AC-8.3: Script passes when run against mock discovery endpoint returning each test pair

---

## 5. Technical & Non-Functional Requirements

### NFR-1: Zero Runtime Regressions (with intentional tightening)
All existing 5420+ tests must continue passing. The SHA pin bump itself is additive (no breaking changes in v7.9.2). FR-6 (`parseMicroUsd` adoption) intentionally tightens input validation at protocol boundaries — this is a security improvement, not a regression. Any callsite where `parseMicroUsd()` rejects inputs that `BigInt()` previously accepted must be audited and explicitly approved before migration, with tests covering the specific input formats.

### NFR-2: Build Performance
`rebuild-hounfour-dist.sh` should complete in <60 seconds (v7.9.2 is cleaner, should be faster).

### NFR-3: Type Safety
Zero `any` casts at protocol boundaries. All new imports must be properly typed.

### NFR-4: Backward Compatibility
Existing loa-finn instances running v7.0.0 must still negotiate successfully with updated arrakis. The compatibility predicate is: accept any peer with `major == 7` (same major), or `major == 6 && version >= MIN_SUPPORTED_VERSION`. This is enforced by `validateCompatibility()` from hounfour and verified by the concrete version pair tests in FR-8 AC-8.2.

---

## 6. Scope & Prioritization

### In Scope (MVP)
- SHA pin bump and rebuild script update (FR-1, FR-2)
- Protocol barrel expansion (FR-3)
- Local type reduction per audit (FR-4)
- Conformance test expansion (FR-7)
- `parseMicroUsd` adoption (FR-6)
- Verify-peer-version update (FR-8)

### Stretch Goals
- `evaluateEconomicBoundary` integration (FR-5) — high value but requires careful conservation guard integration
- Governance vocabulary adoption beyond barrel exports

### FR Dependency Order (Flatline IMP-002)

FRs have implicit dependencies that constrain parallelization:

```
FR-1 (SHA pin) → FR-2 (rebuild script) → FR-3 (barrel expansion)
                                        → FR-7 (conformance vectors)
                                        → FR-8 (verify-peer-version)
FR-3 (barrel) → FR-4 (local type reduction)
FR-4 (type reduction) → FR-6 (parseMicroUsd adoption)
FR-6 (parseMicroUsd) → FR-5 (boundary engine spike, stretch)
```

**Phase 1** (sequential): FR-1 → FR-2
**Phase 2** (parallel): FR-3, FR-7, FR-8
**Phase 3** (sequential): FR-4 (depends on FR-3 barrel being complete)
**Phase 4** (sequential): FR-6 (depends on FR-4 reducing local types)
**Phase 5** (stretch): FR-5 (depends on FR-6 boundary parsing being stable)

### Out of Scope
- Rewriting arrakis state machines to use hounfour vocabulary (audit says KEEP — different machine sets)
- Rewriting billing-types.ts or billing-entry.ts (audit says KEEP — different field structures)
- Rewriting economic-events.ts (audit says KEEP — different envelope format)
- loa-finn deployment or E2E integration testing (separate cycle per issue #66)

---

## 7. Risks & Dependencies

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| v7.9.2 dist build fails (missing files) | Low | High | v7-export-audit documented workaround; v7.9.2 is cleaner (ejected Loa) |
| Subpackage import paths changed | Low | Medium | Verify against v7.9.2 package.json exports map |
| Conformance vectors require new test infrastructure | Medium | Low | Existing vector loader handles JSON, just needs path update |
| `evaluateEconomicBoundary` semantics don't map 1:1 to conservation guard | Medium | Medium | FR-5 is stretch — can defer if mapping is complex |
| TypeScript version incompatibility with v7.9.2 TypeBox schemas | Low | High | Both use TypeBox; version alignment checked at install |

### Rollback Runbook (Flatline IMP-001)

If the v7.9.2 upgrade causes production issues:

1. **Immediate revert**: Change SHA pin back to `ec50249...` in both `package.json` files, run `pnpm install`, redeploy. All local protocol types remain functional (they were only reduced, not removed).
2. **Per-feature kill-switches**:
   - `PARSE_MICRO_USD_LEGACY=true` — reverts `parseMicroUsd()` to `BigInt()` at boundary callsites
   - `ENABLE_CANONICAL_BOUNDARY_ENGINE=false` (default) — FR-5 decision engine is already feature-flagged
3. **Re-vendoring**: If barrel imports cause issues, the reduced files (`arrakis-arithmetic.ts`, `arrakis-conservation.ts`, `jwt-boundary.ts`) still contain full local implementations behind a thin canonical import layer. Reverting the REDUCE changes restores vendored behavior.
4. **Recovery steps**: Run conformance suite against reverted state to verify v7.0.0 compatibility. Check `verify-peer-version.sh` against loa-finn discovery endpoint.

### Dependencies
- **loa-hounfour v7.9.2** (`ff8c16b899b5bbebb9bf1a5e3f9e791342b49bea`) — published 2026-02-23
- **Node.js 20+** — existing requirement
- **TypeScript 5.x** — existing requirement

---

## 8. Success Criteria

| Criterion | Measurement |
|-----------|-------------|
| SHA pin at v7.9.2 | `package.json` references `ff8c16b...` |
| All existing tests pass | CI green (5420+ tests) |
| 202 conformance vectors pass | Conformance test suite |
| ≥5 local types replaced with canonical | Code diff shows deletions in protocol/ |
| `parseMicroUsd` at protocol boundaries | Protocol boundary entry points audited and migrated |
| Protocol barrel covers consumed surface | Zero direct hounfour imports outside barrel + designated modules |
| Version negotiation verified | 5 concrete version pair tests pass (FR-8 AC-8.2) |
| Rebuild script resolves subpackages | All 7 import specifiers typecheck after build (FR-2 AC-2.2) |

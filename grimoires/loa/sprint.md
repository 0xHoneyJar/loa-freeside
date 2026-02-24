# Sprint Plan: Hounfour v7.9.2 Full Adoption — Protocol Convergence

**Version:** 2.0.0
**Date:** 2026-02-23
**Cycle:** cycle-039
**Source:** PRD v1.2.0, SDD v1.2.0 (GPT-APPROVED + Flatline-reviewed)
**PRD:** grimoires/loa/prd.md v1.2.0
**SDD:** grimoires/loa/sdd.md v1.2.0
**Duration:** 5 sprints (Sprint 1–5)
**Team:** 1 engineer (AI-assisted)
**Global Sprint IDs:** 343–347
**Prerequisite:** Cycle 038 (The Ostrom Protocol) merge-ready

### Capacity & De-Scope Strategy (Flatline SKP-001)

Single-engineer constraint acknowledged. Mitigations:
- **Per-sprint hard stop:** If a sprint exceeds 2x estimated effort, evaluate de-scope: defer lowest-priority remaining tasks to next cycle
- **Sprint 2 split option:** If barrel expansion + conformance + invariants proves too large, split into Sprint 2A (barrel + exports audit) and Sprint 2B (conformance + invariants + peer version), extending total to 6 sprints
- **Sprint 5 escape valve:** FR-5 is already stretch — skip entirely if Sprints 1–4 consume full capacity
- **Escalation trigger:** If any sprint is blocked >4h on tooling/ESM/resolution issues, escalate to human reviewer for pair debugging

---

## Context

Arrakis pins loa-hounfour at v7.0.0 (`ec50249`). Nine additive minor releases to v7.9.2 (`ff8c16b`) introduced a shared decision engine, strict BigInt parsing, 6-dimensional trust, liveness properties, governance vocabulary, and doubled conformance coverage (91 → 202 vectors). This sprint plan executes the upgrade following the phased dependency order from SDD §8.

### FR Dependency Graph

```
FR-1 (SHA pin) → FR-2 (rebuild script) → FR-3 (barrel expansion)
                                        → FR-7 (conformance vectors)
                                        → FR-8 (verify-peer-version)
FR-3 (barrel) → FR-4 (local type reduction)
FR-4 (type reduction) → FR-6 (parseMicroUsd adoption)
FR-6 (parseMicroUsd) → FR-5 (boundary engine spike, stretch)
```

---

## Sprint 1: Foundation — Pin Bump + Rebuild Script (FR-1, FR-2)

**Goal:** Update the hounfour dependency to v7.9.2 with full supply-chain verification.

**Global Sprint ID:** 343

### Tasks

#### Task 1.1: SHA Pin Bump
**Description:** Update the `@0xhoneyjar/loa-hounfour` git ref in both `package.json` files from `ec50249` to `ff8c16b`. Run install to verify resolution.
**Acceptance Criteria:**
- AC-1.1.1: Root `package.json` references `ff8c16b899b5bbebb9bf1a5e3f9e791342b49bea`
- AC-1.1.2: `packages/adapters/package.json` references `ff8c16b899b5bbebb9bf1a5e3f9e791342b49bea`
- AC-1.1.3: `pnpm install` resolves successfully with no peer dependency conflicts
- AC-1.1.4: `npx tsc --noEmit` compiles successfully with zero `any` stubs — all type errors resolved with real fixes (aliased imports, updated signatures, or conditional re-exports). If a type error cannot be fixed without barrel expansion (Sprint 2), isolate it behind a `// TODO(sprint-2): requires barrel` comment and add a tracked follow-up in Task 2.1 prerequisites
**Estimated Effort:** Small
**Dependencies:** None

#### Task 1.2: Rebuild Script Supply-Chain Verification
**Description:** Update `scripts/rebuild-hounfour-dist.sh` with isolated clone, SHA verification, deterministic build, SOURCE_SHA/DIST_HASH provenance per SDD §3.2.
**Acceptance Criteria:**
- AC-1.2.1: Script uses `git init` → `git fetch --depth 1 origin $EXPECTED_SHA` → `git checkout --detach FETCH_HEAD` (deterministic clone)
- AC-1.2.2: `set -euo pipefail` at script top, explicit error messages on fetch/checkout failure
- AC-1.2.3: Two-phase install: (a) `npm ci --ignore-scripts` for dependency install (no post-install scripts from transitive deps — requires `package-lock.json` present at `ff8c16b`, fail if missing), then (b) explicitly run the build command `npx tsc -p tsconfig.build.json`. Registry pinned to `https://registry.npmjs.org` via `--registry` flag; `npm config set fund false audit false` to reduce network variance
- AC-1.2.4: `SOURCE_DATE_EPOCH=0` set before build to prevent timestamp embedding; `.nvmrc` pins Node version; `tsconfig.build.json` has stable settings (`newLine: "lf"`, `declaration`, `importsNotUsedAsValues`)
- AC-1.2.5: `dist/SOURCE_SHA` embedded with verified commit hash
- AC-1.2.6: `dist/DIST_HASH` computed from canonical tarball: `npm pack --pack-destination /tmp && sha256sum /tmp/*.tgz | cut -d' ' -f1` (tarball normalizes file ordering and metadata, avoiding platform-dependent non-determinism from raw `find | sha256sum`)
- AC-1.2.7: All 7 export specifiers resolve from built dist: `""`, `"/core"`, `"/economy"`, `"/model"`, `"/governance"`, `"/constraints"`, `"/integrity"`
- AC-1.2.8: Stale-detection updated with v7.9.2 fingerprint (`evaluateEconomicBoundary` check)
- AC-1.2.9: `scripts/expected-dist-hashes.json` created with expected DIST_HASH for `ff8c16b`
- AC-1.2.10: **Reproducible build environment (Flatline SKP-002):** CI runs rebuild in a pinned container image (e.g., `node:20.11.1-bookworm-slim`) with exact `npm@10.x` version. A `scripts/recompute-expected-hash.sh` workflow recomputes and commits the expected hash with approval required. Reproducibility verified: two separate GitHub Actions jobs on different runner instances using the same container image each produce DIST_HASH independently — CI step compares both hashes and fails if they differ. Script fails fast if `package-lock.json` is missing at the pinned SHA
**Estimated Effort:** Medium
**Dependencies:** Task 1.1

#### Task 1.3: Boundary Payload Replay & Golden Baselines
**Description:** Create `tests/boundary-replay/v7-delta.test.ts` with golden baselines per SDD §3.1. Replay representative fixtures through v7.9.2 boundary parsers and assert no unexpected semantic changes.
**Acceptance Criteria:**
- AC-1.3.1: Golden baseline files committed in `tests/boundary-replay/golden/` (JWT claims, billing entries, conservation payloads)
- AC-1.3.2: Each golden file tagged with classification: `MUST_MATCH`, `EXPECTED_CHANGE`, or `INFORMATIONAL`
- AC-1.3.3: Replay test loads fixtures, parses through v7.9.2 schemas, compares against golden outputs
- AC-1.3.4: Any deltas documented in `grimoires/loa/a2a/v7-delta-log.md` with classification and rationale
- AC-1.3.5: Zero `MUST_MATCH` failures (billing amounts, conservation decisions identical)
**Estimated Effort:** Medium
**Dependencies:** Task 1.1

#### Task 1.4: Expected Dist Hash Verification CI Check
**Description:** Add CI assertion that `dist/SOURCE_SHA` matches expected SHA and `dist/DIST_HASH` matches `scripts/expected-dist-hashes.json`.
**Acceptance Criteria:**
- AC-1.4.1: CI check reads `dist/SOURCE_SHA`, asserts equals `ff8c16b899b5bbebb9bf1a5e3f9e791342b49bea`
- AC-1.4.2: CI check reads `dist/DIST_HASH`, asserts matches value in `expected-dist-hashes.json`
- AC-1.4.3: Failure produces clear error message identifying which hash mismatched
**Estimated Effort:** Small
**Dependencies:** Task 1.2

### Sprint 1 Exit Gate (CI-Verifiable)
- `npx tsc --noEmit` passes with zero errors, zero `any` stubs
- `pnpm install` resolves with no peer dependency conflicts
- Golden replay test (`tests/boundary-replay/v7-delta.test.ts`) passes — zero `MUST_MATCH` failures
- `dist/SOURCE_SHA` == `ff8c16b...` (CI assertion)
- `dist/DIST_HASH` matches `expected-dist-hashes.json` (CI assertion)
- All 7 export specifiers resolve from built dist

### Sprint 1 Success Criteria
- Hounfour pinned at v7.9.2 (`ff8c16b`)
- Rebuild script produces verified dist with provenance
- Golden baselines committed and replay test passing
- Supply-chain verification checks operational in CI

---

## Sprint 2: Expansion — Barrel + Conformance + Peer Version (FR-3, FR-7, FR-8)

**Goal:** Expand the protocol barrel with v7.1–v7.9 types, update conformance suite to 202 vectors, verify peer version negotiation.

**Global Sprint ID:** 344

### Tasks

#### Task 2.0: Exports Map Audit (Gate for Barrel Expansion)
**Description:** Read the actual v7.9.2 `package.json#exports` map and document every subpath, condition (node/import/require/types), and entry point. Confirm which conditions apply in arrakis's runtime (Node CJS via ts-node/jest) and update tooling config if needed (`moduleResolution`, jest `moduleNameMapper`, etc.).
**Acceptance Criteria:**
- AC-2.0.1: v7.9.2 `package.json#exports` map fully documented in `grimoires/loa/a2a/v792-exports-map.md`
- AC-2.0.2: Each subpath (`/core`, `/economy`, `/model`, `/governance`, `/constraints`, `/integrity`) confirmed present or mapped to actual alternatives
- AC-2.0.3: Runtime resolution conditions confirmed for arrakis: which of `node`, `import`, `require`, `types` are active under current `tsconfig.json` + test runner config
- AC-2.0.4: Any required tooling changes identified (e.g., `moduleResolution: nodenext`, jest ESM transform) — changes applied or deferred with rationale
- AC-2.0.5: Audit document committed before Task 2.1 begins
**Estimated Effort:** Small
**Dependencies:** Sprint 1 complete

#### Task 2.1: Protocol Barrel Expansion (FR-3)
**Description:** Update `themes/sietch/src/packages/core/protocol/index.ts` to re-export new canonical symbols organized by domain per SDD §3.3. Use the exact specifiers confirmed in the Task 2.0 exports map audit.
**Acceptance Criteria:**
- AC-2.1.1: Reputation & Trust exports added (evaluateAccessPolicy, AccessPolicyContext, AccessPolicyResult, REPUTATION_STATES, REPUTATION_STATE_ORDER, isKnownReputationState, ReputationStateName, ReputationScoreSchema, ReputationScore)
- AC-2.1.2: Event Sourcing & Replay exports added (reconstructAggregateFromEvents, verifyAggregateConsistency, computeEventStreamHash, ReconstructedAggregate, ConsistencyReport, computeCredentialPrior, isCredentialExpired, CREDENTIAL_CONFIDENCE_THRESHOLD)
- AC-2.1.3: Governance exports added (SanctionSchema, Sanction, SANCTION_SEVERITY_LEVELS, VIOLATION_TYPES, ESCALATION_RULES, DisputeRecordSchema, DisputeRecord, ValidatedOutcomeSchema, ValidatedOutcome, PerformanceRecordSchema, PerformanceOutcome, ContributionRecordSchema, ContributionRecord)
- AC-2.1.4: Economy Extensions exports added (parseMicroUsd, ParseMicroUsdResult, evaluateEconomicBoundary, evaluateFromBoundary, subtractMicroSigned, negateMicro, isNegativeMicro, StakePositionSchema, StakePosition, CommonsDividendSchema, CommonsDividend, MutualCreditSchema, MutualCredit, TRANSFER_CHOREOGRAPHY, TRANSFER_INVARIANTS)
- AC-2.1.5: Integrity Extensions exports added (LivenessPropertySchema, CANONICAL_LIVENESS_PROPERTIES, LivenessProperty, detectReservedNameCollisions, NameCollision)
- AC-2.1.6: `npx tsc --noEmit` passes with zero errors
- AC-2.1.7: No duplicate exports between barrel sections (canonical takes precedence)
- AC-2.1.8: Export the full set specified in SDD §3.3. After adding all exports, run a consumption audit script (`grep -r` for each symbol across `themes/sietch/src/`, `packages/`, `tests/`) and commit the audit output as `grimoires/loa/a2a/barrel-consumption-audit.md`. Symbols with zero current consumers are retained if they are required by an FR in this cycle (FR-4 reduction, FR-6 parseMicroUsd, FR-5 boundary engine) — otherwise remove them from the barrel
- AC-2.1.9: **Barrel manifest (Flatline SKP-004):** Generate and commit `grimoires/loa/a2a/barrel-manifest.json` — a versioned JSON file listing every barrel export with: symbol name, source specifier, v7.9.2 version introduced, consumer count from audit. This manifest is the barrel's contract — additions require manifest update, removals require deprecation notice.
**Estimated Effort:** Large
**Dependencies:** Sprint 1 complete (pin bump resolved)

#### Task 2.2: Export-Map Validation Test
**Description:** Create `tests/unit/barrel-export-map.test.ts` that dynamically imports every barrel re-export and asserts it resolves from the exact specifier used per SDD §3.3.
**Acceptance Criteria:**
- AC-2.2.1: Test file created at `tests/unit/barrel-export-map.test.ts`
- AC-2.2.2: Dynamically imports from each subpath specifier used in barrel (`/governance`, `/economy`, `/integrity`, `/core`, `/constraints`)
- AC-2.2.3: Asserts each exported symbol is defined (not undefined)
- AC-2.2.4: Catches root-vs-subpath mismatches that compile in TS but fail at Node ESM runtime
- AC-2.2.5: All assertions pass
- AC-2.2.6: **Dual-mode validation (Flatline SKP-003):** Export-map test runs in both CJS and ESM resolution modes via two concrete commands: (a) `pnpm test:exports:cjs` — Jest in default CJS mode with `require()` calls, (b) `pnpm test:exports:esm` — separate Jest config with `extensionsToTreatAsEsm: ['.ts']` and ESM-compatible transformer (ts-jest ESM preset or Babel), or alternatively Node's built-in test runner with `--experimental-vm-modules`. Both must pass in CI.
- AC-2.2.7: Minimal runtime smoke test: prerequisite build step (`pnpm -w build` or targeted workspace build), then execute `node -e "require(require.resolve('@arrakis/protocol'))"` (CJS) and `node --input-type=module -e "import('@arrakis/protocol').then(m => console.log(Object.keys(m)))"` (ESM) against the built JS output (not ts-jest). Both must exit 0.
- AC-2.2.8: `tsconfig.json` fields (`module`, `moduleResolution`) and Jest config files used for CJS/ESM testing explicitly locked in committed config and documented as sprint deliverable — not just "documented" but committed as concrete config files referenced by the test commands above
**Estimated Effort:** Small
**Dependencies:** Task 2.1

#### Task 2.3: Import Access Control Enforcement
**Description:** Add ESLint `no-restricted-imports` rule per SDD §2.2 to restrict direct `@0xhoneyjar/loa-hounfour` imports to explicit allowlist.
**Acceptance Criteria:**
- AC-2.3.1: ESLint config has `no-restricted-imports` rule with pattern `@0xhoneyjar/loa-hounfour*`
- AC-2.3.2: Override blocks for allowed modules: `packages/adapters/agent/*.ts`, `protocol/arrakis-*.ts`, `discovery.routes.ts`, `tests/**/*.ts`
- AC-2.3.3: `npx eslint --rule 'no-restricted-imports: error'` passes with zero violations (or CI AST fallback script)
- AC-2.3.4: Adding a disallowed import in a consumer file produces a lint error
**Estimated Effort:** Small
**Dependencies:** Task 2.1

#### Task 2.4: Conformance Test Expansion (FR-7)
**Description:** Update `tests/unit/protocol-conformance.test.ts` from 91 to 202 vectors per SDD §3.7. Update vector loader for v7.9.2 nested directory structure.
**Acceptance Criteria:**
- AC-2.4.1: Vector loader updated: `glob.sync('**/vectors/**/*.json')` for nested categories
- AC-2.4.2: All 202 vectors load and parse successfully
- AC-2.4.3: New test blocks for governance, reputation, liveness vector categories
- AC-2.4.4: CONTRACT_VERSION assertion matches actual v7.9.2 value (verify from source)
- AC-2.4.5: Dual-accept test (v6.0.0 support) preserved
- AC-2.4.6: All 202 vectors pass
**Estimated Effort:** Medium
**Dependencies:** Sprint 1 complete

#### Task 2.5: Verify-Peer-Version Update (FR-8)
**Description:** Update `scripts/verify-peer-version.sh` with v7.9.2 constants and add 5 concrete version pair tests per SDD §3.8.
**Acceptance Criteria:**
- AC-2.5.1: CONTRACT_VERSION updated if changed in v7.9.2 (verify from source)
- AC-2.5.2: MIN_SUPPORTED_VERSION remains `6.0.0` (dual-accept window preserved)
- AC-2.5.3: `tests/scripts/verify-peer-version.test.sh` created with 5 pairs:
  - v7.9.2 ↔ v7.0.0 → PASS
  - v7.9.2 ↔ v7.5.0 → PASS
  - v7.9.2 ↔ v6.0.0 → PASS
  - v7.9.2 ↔ v5.9.0 → FAIL
  - v7.9.2 ↔ v8.0.0 → FAIL
- AC-2.5.4: All 5 test pairs pass
**Estimated Effort:** Small
**Dependencies:** Sprint 1 complete

#### Task 2.6: Semantic Compatibility Invariant Tests (SKP-001)
**Description:** Create per-domain semantic invariant tests per SDD §6.2 — JWT golden replay, billing shadow verification, conservation property-based tests, governance golden replay, version negotiation pairs.
**Acceptance Criteria:**
- AC-2.6.1: JWT invariant: `verifyJWT(token)` produces identical claims for 5+ token fixtures
- AC-2.6.2: Billing invariant: fast-check property test generating valid micro-USD strings → `parseMicroUsd(x).value === BigInt(x)` for valid formats
- AC-2.6.3: Conservation invariant: property-based test with random valid states → 14 properties evaluate identically
- AC-2.6.4: Governance invariant: `SanctionSchema.parse(x)` golden replay with existing governance fixtures
- AC-2.6.5: Version invariant: covered by Task 2.5 version pair tests
- AC-2.6.6: All invariant tests pass
**Estimated Effort:** Medium
**Dependencies:** Tasks 2.1, 2.4

### Sprint 2 Exit Gate (CI-Verifiable)
- `npx tsc --noEmit` passes
- `barrel-export-map.test.ts` passes (all specifiers resolve at runtime)
- `protocol-conformance.test.ts` passes (202 vectors)
- `verify-peer-version.test.sh` passes (5 pairs)
- Semantic invariant tests pass (JWT, billing, conservation, governance, version)
- ESLint `no-restricted-imports` passes with zero violations
- Exports map audit committed (`grimoires/loa/a2a/v792-exports-map.md`)
- Barrel consumption audit committed (`grimoires/loa/a2a/barrel-consumption-audit.md`)

### Sprint 2 Success Criteria
- Protocol barrel exports new v7.1–v7.9 symbols per SDD §3.3
- Import access control enforced via ESLint
- 202 conformance vectors passing
- 5 version pair tests passing
- Per-domain semantic invariants verified
- Export-map validation test confirms all specifiers resolve

---

## Sprint 3: Reduction — Local Type Cleanup (FR-4)

**Goal:** Replace local implementations with canonical equivalents per v7-export-audit disposition table.

**Global Sprint ID:** 345

### Tasks

#### Task 3.1: DELETE compatibility.ts and VENDORED.md
**Description:** Delete `compatibility.ts` and `VENDORED.md` from `themes/sietch/src/packages/core/protocol/`. Verify all consumers import from `arrakis-compat.ts` or barrel.
**Acceptance Criteria:**
- AC-3.1.1: `compatibility.ts` deleted
- AC-3.1.2: `VENDORED.md` deleted
- AC-3.1.3: Zero compilation errors (`npx tsc --noEmit`)
- AC-3.1.4: No remaining imports of `./compatibility` in any file (verify with grep)
- AC-3.1.5: Barrel `index.ts` does not reference deleted files
**Estimated Effort:** Small
**Dependencies:** Sprint 2 complete (barrel expanded)

#### Task 3.2: REDUCE arrakis-arithmetic.ts
**Description:** Import branded types + `parseMicroUsd` from `/economy` per SDD §3.4.3. Keep only local helpers (`dollarsToMicro`, `microToDollarsDisplay`, `assertMicroUSD`, `assertBpsSum`, `divideWithFloor`, `serializeBigInt`).
**Acceptance Criteria:**
- AC-3.2.1: `parseMicroUsd` and `ParseMicroUsdResult` re-exported from `@0xhoneyjar/loa-hounfour/economy`
- AC-3.2.2: Existing canonical re-exports unchanged (14 symbols)
- AC-3.2.3: Local-only extensions clearly separated with comment block
- AC-3.2.4: `npx tsc --noEmit` passes
- AC-3.2.5: No `...` pseudocode or placeholder function bodies — all implementations explicit
**Estimated Effort:** Small
**Dependencies:** Sprint 2 complete

#### Task 3.3: REDUCE arrakis-conservation.ts
**Description:** Import `CANONICAL_LIVENESS_PROPERTIES` and `LivenessProperty` from `/integrity` per SDD §3.4.4. Re-export for consumer access. Keep local error taxonomy and mapping tables.
**Acceptance Criteria:**
- AC-3.3.1: `CANONICAL_LIVENESS_PROPERTIES` and `LivenessProperty` imported from `/integrity`
- AC-3.3.2: Both re-exported for barrel consumption
- AC-3.3.3: Local error taxonomy and conservation-to-error mappings unchanged
- AC-3.3.4: `npx tsc --noEmit` passes
**Estimated Effort:** Small
**Dependencies:** Sprint 2 complete

#### Task 3.4: REDUCE jwt-boundary.ts (if present)
**Description:** Import canonical 6-step JWT verification from hounfour per SDD §3.4.5. Keep arrakis-specific claim types and S2S extensions locally.
**Acceptance Criteria:**
- AC-3.4.1: Canonical verification steps imported (if jwt-boundary.ts exists in protocol/)
- AC-3.4.2: Arrakis-specific `pool_id`, `reserved_micro` claim types retained locally
- AC-3.4.3: `npx tsc --noEmit` passes
- AC-3.4.4: JWT-dependent tests still pass
**Estimated Effort:** Small
**Dependencies:** Sprint 2 complete

#### Task 3.5: Consumer Import Migration
**Description:** Update any consumers that imported directly from deleted/reduced files to import from the protocol barrel instead.
**Acceptance Criteria:**
- AC-3.5.1: Grep for all imports of `./compatibility`, `./arrakis-arithmetic`, `./arrakis-conservation`, `./jwt-boundary` — all resolve through barrel or adapter
- AC-3.5.2: Zero direct imports of `@0xhoneyjar/loa-hounfour` outside the allowlist (ESLint rule passes)
- AC-3.5.3: Full test suite passes (5420+ tests)
- AC-3.5.4: `npx tsc --noEmit` passes
**Estimated Effort:** Medium
**Dependencies:** Tasks 3.1–3.4

### Sprint 3 Success Criteria
- `compatibility.ts` and `VENDORED.md` deleted
- 3 adapter files reduced to canonical import + local extension
- All consumers import through barrel or allowlisted paths
- Zero compilation errors, full test suite green

---

## Sprint 4: Boundary Hardening — parseMicroUsd Adoption (FR-6)

**Goal:** Deploy `parseMicroUsd` at all protocol boundary entry points with 3-stage rollout (legacy/shadow/enforce).

**Global Sprint ID:** 346

**Entry Gate:** Sprint 4 MUST NOT start until the following are green in CI:
- Sprint 1 golden replay test (`tests/boundary-replay/v7-delta.test.ts`) — zero `MUST_MATCH` failures
- Sprint 2 conformance suite — all 202 vectors passing
- Sprint 2 semantic invariant tests — all domains green
This ensures boundary hardening operates on a trusted compatibility baseline, preventing conflation of "parser tightening intended change" with "upgrade regression."

### Tasks

#### Task 4.1: parseBoundaryMicroUsd Wrapper
**Description:** Create the `parseBoundaryMicroUsd()` dual-parse wrapper function per SDD §3.6. Implements 3-stage rollout controlled by `PARSE_MICRO_USD_MODE` env var.
**Acceptance Criteria:**
- AC-4.1.1: `parseBoundaryMicroUsd(raw, context, logger)` function created with `BoundaryParseResult` discriminated union return
- AC-4.1.2: Stage 0 (legacy): `BigInt()` only, activated by `PARSE_MICRO_USD_MODE=legacy`
- AC-4.1.3: Stage 1 (shadow): Both parsers run, legacy result returned, divergences logged — default mode
- AC-4.1.4: Stage 2 (enforce): Canonical result drives decisions, structured error on rejection
- AC-4.1.5: Unit tests cover all 3 modes with valid, invalid, and edge-case inputs
- AC-4.1.6: Tests verify: leading zeros rejected by canonical, whitespace rejected, plus signs rejected, floats rejected
- AC-4.1.7: **Performance budget (Flatline IMP-003):** Shadow-mode overhead must be <2ms p99 per parse call. Benchmark test measures 1000 parses in shadow mode vs legacy-only and asserts overhead < 2ms p99. If overhead exceeds budget, optimize (cache canonical result, reduce logging) before deploying
- AC-4.1.8: **Shadow-mode safety floor (Flatline SKP-006):** Even in shadow mode, reject inputs exceeding safety bounds: max length 50 chars, max value `MAX_SAFE_MICRO_USD` (1e15 micro-USD = $1B, derived from max budget * max duration — confirmed to exceed observed p100 production values via one-off query or log sample documented in implementation PR), and inputs containing non-ASCII characters. Bounds are context-aware: HTTP/JWT boundary inputs must be non-negative (`>= 0` enforced explicitly); DB context may encounter signed values and applies absolute-value bounds instead. ASCII whitespace is rejected (not trimmed) to surface upstream data quality issues. These are rejected immediately (not just logged) regardless of mode. Fuzz test with fast-check generates pathological inputs (very long strings, unicode whitespace, scientific notation, negative values at HTTP boundary, values at exactly MAX_SAFE_MICRO_USD +/- 1) and asserts all out-of-bounds inputs are rejected and all in-bounds inputs are accepted
**Estimated Effort:** Medium
**Dependencies:** Sprint 3 complete (type reduction done)

#### Task 4.2: Shadow-Mode Instrumentation (CI-Verifiable)
**Description:** Add metrics emission per SDD §3.6 IMP-003: `parseMicroUsd_shadow_total`, `parseMicroUsd_would_reject_total`, `parseMicroUsd_divergence_total` per boundary context. This task covers code-level instrumentation only.
**Acceptance Criteria:**
- AC-4.2.1: Three counters registered and emitted per boundary context (HTTP, DB, Redis, JWT) via existing `MetricsPort` / `emitEconomicMetric()` adapter
- AC-4.2.2: Unit test verifies metric emission calls with expected names, values, and context labels (snapshot/mock test — CI-verifiable)
- AC-4.2.3: Integration test: run wrapper in shadow mode with a `would-reject` input, assert counter incremented
**Estimated Effort:** Small
**Dependencies:** Task 4.1

#### Task 4.2b: Shadow-Mode Ops Config (Alert Rules + Dashboard)
**Description:** Create repo-based ops artifacts for PagerDuty alert and dashboard per SDD §3.6 IMP-003.
**Acceptance Criteria:**
- AC-4.2b.1: Alert rule definition committed as `infrastructure/alerts/parsemicro-shadow.json` (or Terraform `.tf`): `parseMicroUsd_would_reject_total > 0` within 5min window → PagerDuty notification
- AC-4.2b.2: Dashboard definition committed as `infrastructure/dashboards/parsemicro-shadow.json`: per-boundary-context rejection rate panel
- AC-4.2b.3: Both artifacts lint/validate cleanly (`terraform validate` or JSON schema check)
- AC-4.2b.4: If ops config lives outside this repo, create tracking issue with link and mark this task done with "ops PR: <link>"
**Estimated Effort:** Small
**Dependencies:** Task 4.2

#### Task 4.3: HTTP Route Migration
**Description:** Migrate boundary entry points in route handlers per SDD §3.6 table: `routes/billing.routes.ts` and `routes/budget.routes.ts`.
**Acceptance Criteria:**
- AC-4.3.1: `billing.routes.ts` uses `parseBoundaryMicroUsd()` for `body.amount_micro`
- AC-4.3.2: `budget.routes.ts` uses `parseBoundaryMicroUsd()` for `query.amount`
- AC-4.3.3: `{ ok: false }` result returns 400 with structured error body
- AC-4.3.4: Existing route tests pass (valid inputs still accepted)
- AC-4.3.5: New tests verify 400 response for invalid inputs in enforce mode
**Estimated Effort:** Small
**Dependencies:** Task 4.1

#### Task 4.4: Database/Redis/JWT Migration
**Description:** Migrate remaining boundary entry points: `adapters/billing-repository.ts`, `adapters/redis-budget-cache.ts`, `adapters/agent/jwt-service.ts`.
**Acceptance Criteria:**
- AC-4.4.1: `billing-repository.ts` uses `parseBoundaryMicroUsd()` for `row.amount_micro`
- AC-4.4.2: DB parse failures quarantine to `micro_usd_parse_failures` dead-letter table (NOT skip rows) per Flatline IMP-006
- AC-4.4.3: `parseMicroUsd_db_quarantine` alert emitted on quarantine
- AC-4.4.3b: Dead-letter table schema: `micro_usd_parse_failures(id SERIAL, original_row_id BIGINT, table_name TEXT, raw_value TEXT, context TEXT, error_code TEXT, source_fingerprint TEXT NOT NULL, replayed_at TIMESTAMPTZ NULL, replay_attempts INT DEFAULT 0, last_replay_error TEXT NULL, created_at TIMESTAMPTZ DEFAULT NOW())` with indexes on `(table_name, created_at)` and `UNIQUE(source_fingerprint)`. `source_fingerprint` is computed as `sha256(table_name || original_row_id || raw_value || error_code)` to enforce deduplication — INSERT uses `ON CONFLICT (source_fingerprint) DO NOTHING` to prevent re-quarantine of the same row
- AC-4.4.3c: Migration file created for dead-letter table
- AC-4.4.3d: 30-day retention policy implemented as `scripts/purge-quarantine.sh` SQL script (`DELETE FROM micro_usd_parse_failures WHERE created_at < NOW() - INTERVAL '30 days'`). CI-verifiable integration test: insert rows with `created_at = now() - interval '31 days'`, run purge script, assert rows deleted. Ops scheduling (pg_cron or external cron) documented in deployment runbook; if external, tracking issue created per Task 4.2b pattern
- AC-4.4.3e: Replay script: `scripts/replay-quarantined-rows.sh` re-parses quarantined rows (for use after normalization fixes) with idempotency guard: skips rows where `replayed_at IS NOT NULL`, sets `replayed_at` and increments `replay_attempts` in the same transaction as successful write-back, records `last_replay_error` on failure. Script is safe to re-run (idempotent)
- AC-4.4.3f: Integration test: simulate repeated parse failures → verify system remains available, same row not re-quarantined on retry (verified via `UNIQUE(source_fingerprint)` constraint — second INSERT returns 0 rows affected), and replay script skips already-replayed rows
- AC-4.4.4: `redis-budget-cache.ts` uses `parseBoundaryMicroUsd()` for `cached.balance`
- AC-4.4.5: Redis parse failure invalidates cache key and falls back to DB source
- AC-4.4.6: `jwt-service.ts` uses `parseBoundaryMicroUsd()` for `claims.reserved_micro`
- AC-4.4.7: All existing tests pass
**Estimated Effort:** Medium
**Dependencies:** Task 4.1

#### Task 4.5: Atomic Deployment Documentation
**Description:** Document the `PARSE_MICRO_USD_MODE` deployment constraint per Flatline IMP-007: mode must be set atomically across all replicas. Mixed-mode prohibited.
**Acceptance Criteria:**
- AC-4.5.1: Deployment runbook section added with mode transition procedure
- AC-4.5.2: Rolling deployment health check confirms all pods report same mode
- AC-4.5.3: Internal trusted paths explicitly documented as out-of-scope with rationale (SDD §5.2)
**Estimated Effort:** Small
**Dependencies:** Tasks 4.3, 4.4

#### Task 4.6: Cutover Criteria & Kill-Switch Test
**Description:** Verify kill-switch works (`PARSE_MICRO_USD_MODE=legacy` bypasses canonical parser) and document cutover criteria.
**Acceptance Criteria:**
- AC-4.6.1: Integration test: set `PARSE_MICRO_USD_MODE=legacy`, verify wrapper returns legacy `BigInt()` result for all inputs, canonical parser is never consulted (spy/counter assert: `parseMicroUsd` call count is 0), and no inputs that legacy accepts are rejected
- AC-4.6.2: Integration test: set `PARSE_MICRO_USD_MODE=enforce`, verify canonical parser drives decisions and inputs rejected by canonical return `{ ok: false }` with structured error (even if legacy would accept them)
- AC-4.6.3: Cutover criteria documented: zero `would-reject` for ≥24h, OR all divergences audited
- AC-4.6.4: Timebox documented: shadow mode removed by end of cycle-040 at latest
**Estimated Effort:** Small
**Dependencies:** Tasks 4.3, 4.4

#### Task 4.7: Rollback Drill Verification (Flatline IMP-004)
**Description:** Verify rollback levels L1–L4 from Appendix B actually work within stated RTOs. Each level is drilled as an integration test or runbook walkthrough.
**Acceptance Criteria:**
- AC-4.7.1: L2 drill: set `PARSE_MICRO_USD_MODE=legacy`, restart test server, verify boundary entry points accept previously-rejected inputs within <1min (automated test)
- AC-4.7.2: L4 drill: revert REDUCE changes in a git stash, verify `npx tsc --noEmit` passes and barrel still resolves (manual but documented with step-by-step runbook)
- AC-4.7.3: L1/L3 drills documented as runbook steps (L1: revert SHA pin + install; L3: already default=false)
- AC-4.7.4: Rollback runbook committed at `grimoires/loa/a2a/rollback-runbook.md` with drill results
**Estimated Effort:** Small
**Dependencies:** Tasks 4.3, 4.4, 4.6

### Sprint 4 Exit Gate (CI-Verifiable)
- `npx tsc --noEmit` passes
- All existing tests pass (5420+)
- Shadow-mode benchmark: p99 overhead < 2ms per parse
- Kill-switch test: legacy mode produces 0 canonical parser calls
- Enforce mode test: invalid inputs return `{ ok: false }`
- Golden replay test still passes (no regressions from boundary changes)

### Sprint 4 Success Criteria
- All 5 boundary entry points migrated to `parseBoundaryMicroUsd()`
- Shadow-mode instrumentation operational (3 counters, CI-verifiable unit + integration tests)
- Ops config artifacts committed (alert rules + dashboard definitions) or tracking issue linked
- DB readers quarantine to dead-letter (not skip)
- Redis readers invalidate + fallback
- Kill-switch verified: legacy mode bypasses canonical entirely (spy asserts 0 canonical calls)
- Shadow-mode p99 overhead within 2ms budget
- Rollback levels L1–L4 drilled and runbook committed
- Deployment constraint documented

---

## Sprint 5: Decision Engine Spike (Stretch) (FR-5)

**Goal:** Feature-flagged integration of `evaluateEconomicBoundary` in shadow mode alongside conservation guard.

**Global Sprint ID:** 347

### Tasks

#### Task 5.1: Input Mapping Document
**Description:** Map arrakis trust dimensions (tier, conviction score) and capital variable (remaining budget micro-USD) to canonical engine's input schema per SDD §3.5.
**Acceptance Criteria:**
- AC-5.1.1: Mapping document at `grimoires/loa/a2a/boundary-engine-mapping.md`
- AC-5.1.2: Maps arrakis `tier` → canonical trust dimensions
- AC-5.1.3: Maps `convictionScore` → canonical conviction/reputation dimension
- AC-5.1.4: Maps `remainingBudgetMicro` → canonical capital variable
- AC-5.1.5: Documents any semantic gaps or unmappable dimensions
**Estimated Effort:** Small
**Dependencies:** Sprint 4 complete

#### Task 5.2: Feature-Flagged Shadow Integration
**Description:** Add `ENABLE_CANONICAL_BOUNDARY_ENGINE` flag in conservation guard per SDD §3.5. Canonical engine runs alongside existing logic but does NOT drive decisions.
**Acceptance Criteria:**
- AC-5.2.1: When flag is `false` (default), zero code path difference — existing behavior completely unchanged
- AC-5.2.2: When flag is `true`, canonical engine runs alongside, both results logged
- AC-5.2.3: Comparison logging captures: input mapping, both results, match/mismatch
- AC-5.2.4: Return value always comes from existing conservation logic (shadow only)
**Estimated Effort:** Medium
**Dependencies:** Task 5.1

#### Task 5.3: Equivalence Test Suite (10 Scenarios)
**Description:** Create 10-scenario equivalence test suite per SDD §6.3 asserting canonical engine matches existing logic.
**Acceptance Criteria:**
- AC-5.3.1: 10 scenarios implemented per SDD §6.3:
  1. Sufficient budget, highest tier → ALLOW
  2. Sufficient budget, lowest tier → ALLOW (limited pools)
  3. Zero budget remaining → DENY
  4. Budget below threshold → DENY
  5. Invalid tier → DENY
  6. Expired conviction → DENY
  7. Exact budget boundary (1 micro-USD) → ALLOW
  8. Negative budget → DENY
  9. Maximum budget → ALLOW
  10. Mixed trust dimensions → expected resolution
- AC-5.3.2: All 10 pass (canonical matches existing logic)
- AC-5.3.3: If equivalence cannot be proven, findings documented and FR-5 deferred to cycle-040
**Estimated Effort:** Medium
**Dependencies:** Task 5.2

### Sprint 5 Success Criteria
- Input mapping documented
- Feature-flagged shadow integration operational
- 10-scenario equivalence suite passing (or deferred with findings if not)
- Existing conservation logic completely unchanged when flag is off

---

## Appendix A: Risk Matrix

| Risk | Sprint | Likelihood | Impact | Mitigation |
|------|--------|-----------|--------|------------|
| v7.9.2 dist build fails | 1 | Low | High | Rebuild script has explicit error handling |
| Subpath specifier misalignment | 2 | Medium | Medium | Export-map validation test catches at CI |
| Conformance vector format changed | 2 | Low | Low | Inspect directory structure before updating loader |
| `parseMicroUsd` rejects valid production inputs | 4 | Medium | Medium | Shadow period + kill-switch + dead-letter quarantine |
| `evaluateEconomicBoundary` semantics unmappable | 5 | Medium | Low | FR-5 is stretch — deferred if mapping fails |
| TypeScript version conflict with TypeBox schemas | 1 | Low | High | Version alignment checked at install |

---

## Appendix B: Rollback Levels

| Level | Trigger | Action | Recovery |
|-------|---------|--------|----------|
| L1: Full revert | Build failure | Revert SHA pin to `ec50249` | <5 min |
| L2: Feature kill-switch | `parseMicroUsd` rejection | `PARSE_MICRO_USD_MODE=legacy` | <1 min |
| L3: Boundary engine | Equivalence failure | `ENABLE_CANONICAL_BOUNDARY_ENGINE=false` | Immediate |
| L4: Re-vendor | Barrel import failure | Revert REDUCE changes | <15 min |

---

## Appendix C: Goal Traceability

| Goal | FRs | Sprints | Key AC |
|------|-----|---------|--------|
| G-1 (Pin at v7.9.2) | FR-1, FR-2 | 1 | AC-1.1.1–AC-1.2.8 |
| G-2 (Canonical barrel) | FR-3 | 2 | AC-2.1.1–AC-2.1.8 |
| G-3 (Replace ≥5 local) | FR-4 | 3 | AC-3.1.1–AC-3.5.4 |
| G-4 (202 conformance) | FR-7 | 2 | AC-2.4.1–AC-2.4.6 |
| G-5 (Boundary spike) | FR-5 | 5 | AC-5.3.1–AC-5.3.3 |
| G-6 (parseMicroUsd) | FR-6 | 4 | AC-4.1.1–AC-4.6.4 |

---

*Generated by Sprint Planning Agent — Cycle 039 Protocol Convergence (Sprints 343-347)*

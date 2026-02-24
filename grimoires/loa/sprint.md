# Sprint Plan: Launch Readiness — loa-hounfour v7.11.0 Full Adoption

**Version:** 1.1.0
**Cycle:** cycle-041
**Date:** 2026-02-24
**PRD:** v1.1.0 (GPT-APPROVED)
**SDD:** v1.1.0 (GPT-APPROVED)
**Sprints:** 2 (global IDs 353–354)

---

## Sprint Overview

This cycle adopts loa-hounfour v7.11.0 governance schemas into the freeside protocol barrel — schema-only, no runtime changes. Sprints are sequenced so the foundation (pin + barrel) precedes contract/testing.

| Sprint | FRs | Focus | Files |
|--------|-----|-------|-------|
| Sprint 1 | FR-1, FR-2, FR-3, FR-4, FR-6 | Version pin + barrel expansion | ~4 files |
| Sprint 2 | FR-5, FR-7 | Contract + tests + documentation | ~6 files |

---

## Sprint 1: Version Pin + Barrel Expansion

**Global Sprint ID:** 353
**Goal:** Migrate hounfour to v7.11.0 and expand the protocol barrel with governance types.
**Priority:** P0
**Dependencies:** None (foundational)

### Task 1.1: Version Pin Migration (FR-6)

**Description:** Determine the correct v7.11.0 pin format (npm registry > git tag > tagged-commit SHA) and update both package.json files. Run install and verify the rebuild script succeeds. Record new DIST_HASH.

**Acceptance Criteria:**
- AC-6.1: `package.json` (root) dependency uses exact version pin (no `^`/`~` range) — npm `"7.11.0"`, git tag `#v7.11.0`, or tagged-commit SHA
- AC-6.2: `packages/adapters/package.json` updated with same exact pin
- AC-6.3: `pnpm install` succeeds and lockfile updated
- AC-6.4: Rebuild script completes without error
- AC-6.5: Reinstall from clean `node_modules` reproduces same DIST_HASH (supply-chain determinism)
- New DIST_HASH recorded in NOTES.md (SDD §3.5.3)
- `CONTRACT_VERSION` import resolves — document new value if changed

**Effort:** Low
**Testing:** `pnpm install` success, `CONTRACT_VERSION` import check, DIST_HASH reproducibility
**SDD Reference:** §3.5

### Task 1.2: Export Surface Verification Gate (SDD §3.1.1)

**Description:** Run the mandatory runtime export verification to confirm all planned symbols exist at their expected entrypoints in the installed v7.11.0 package.

**Acceptance Criteria:**
- Root entrypoint verified: `GovernanceTaskType`, `GovernanceTaskTypeSchema`, `GovernanceReputationEvent`, `GovernanceReputationEventSchema`, `computeScoringPathHash`, `SCORING_PATH_GENESIS_HASH`
- Governance entrypoint verified: `TASK_TYPES`, `validateTaskCohortUniqueness`, `TaskTypeCohortSchema`, `QualitySignalEventSchema`, `TaskCompletedEventSchema`, `CredentialUpdateEventSchema`, `ScoringPathSchema`, `ScoringPathLogSchema`
- Root or appropriate entrypoint verified: `NativeEnforcement` (may be type-only — if so, document as type-only export, do not add to contract.json)
- `Constraint` type/schema barrel exposure verified (SDD §3.3) — if `ConstraintSchema` is a runtime export, add to contract.json
- Any MISSING symbol: move to correct entrypoint, mark type-only, or log as PRD deviation
- Produce **export mapping table** artifact: for each symbol, record {entrypoint, runtime/type-only, barrel-action, contract-action}

**Effort:** Low
**Testing:** `node -e "import(...).then(...)"` verification scripts
**SDD Reference:** §3.1.1, §3.3
**Dependencies:** Task 1.1

### Task 1.3: Protocol Barrel Governance Re-exports (FR-1, FR-3)

**Description:** Add v7.10.0-7.11.0 governance type re-exports to `protocol/index.ts`. Use ADR-001 aliases. Adjust import paths based on Task 1.2 results.

**Acceptance Criteria:**
- AC-1.1: All symbols marked "barrel-export" in Task 1.2 mapping table are imported in protocol barrel
- AC-1.2: ADR-001 aliases used for colliding names — governance types use `Governance*` prefix only
- AC-1.4: TypeScript compiles cleanly
- AC-1.5: Existing `TaskType` in `pool-mapping.ts` unchanged
- AC-3.1: ONLY aliased `Governance*` variants at barrel level — no unaliased governance `TaskType` or `ReputationEvent` re-exported under their original names
- AC-3.4: Barrel JSDoc documents ADR-001 rationale
- Export mapping table from Task 1.2 used as authoritative source for which symbols to export and under what names

**Effort:** Medium
**Testing:** `tsc --noEmit`
**SDD Reference:** §3.1.1
**Dependencies:** Task 1.2 (export mapping table)

### Task 1.4: Hash Chain + Evaluation Geometry Re-exports (FR-2, FR-4)

**Description:** Add `computeScoringPathHash`, `SCORING_PATH_GENESIS_HASH`, and `NativeEnforcement` re-exports to barrel.

**Acceptance Criteria:**
- AC-2.1: Hash utilities re-exported through barrel
- AC-4.1: `NativeEnforcement` type re-exported
- AC-4.3: No runtime constraint evaluation behavior changed
- TypeScript compiles cleanly

**Effort:** Low
**Testing:** `tsc --noEmit`
**SDD Reference:** §3.2.1, §3.3
**Dependencies:** Task 1.2

---

## Sprint 2: Contract + Tests + Documentation

**Global Sprint ID:** 354
**Goal:** Update consumer-driven contract, add guard/conformance tests, document launch readiness.
**Priority:** P0
**Dependencies:** Sprint 1

### Task 2.1: Contract Entrypoint + Version Update (FR-5)

**Description:** Update `contract.json` with new governance symbols (only verified runtime exports from Task 1.2) and bump `provider_version_range` to `>=7.11.0`.

**Acceptance Criteria:**
- AC-5.1: Entrypoints updated with all verified runtime governance symbols
- AC-5.2: `provider_version_range` bumped to `>=7.11.0`
- AC-5.6: All 65 previously-pinned entrypoints remain (strict superset)
- Contract changelog documents deliberate version bump

**Effort:** Low
**Testing:** `node spec/contracts/validate.mjs`
**SDD Reference:** §3.4.1, §3.4.2
**Dependencies:** Sprint 1

### Task 2.2: Bundle Hash Recomputation (FR-5)

**Description:** Recompute `vectors-bundle.sha256` and update `contract.json` `bundle_hash` + `vector_count`. Must run AFTER Task 2.1 to avoid overwriting entrypoint changes.

**Acceptance Criteria:**
- AC-5.3: Hash recomputed via `find spec/vectors/ -name '*.json' -type f | sort | xargs sha256sum | sha256sum`
- `contract.json` `bundle_hash` matches new hash
- `vector_count` updated if new vector files added
- `node spec/contracts/validate.mjs` passes after both Task 2.1 and 2.2 changes in final `contract.json` state

**Effort:** Low
**Testing:** `contract-spec.test.ts` bundle hash test passes, `validate.mjs` passes
**SDD Reference:** §3.4.3
**Dependencies:** Task 2.1 (both edit contract.json — must be sequenced)

### Task 2.3: Hash Chain Utility Tests (FR-2)

**Description:** Create `tests/unit/hash-chain-utility.test.ts` with 3 test cases.

**Acceptance Criteria:**
- AC-2.2: Hash determinism test (same input → same hash)
- AC-2.3: Genesis hash valid SHA-256 hex (64 chars)
- AC-2.4: `computeScoringPathHash` produces valid SHA-256 from sample input (utility only)

**Effort:** Low
**Testing:** `pnpm vitest run tests/unit/hash-chain-utility.test.ts`
**SDD Reference:** §3.2.2

### Task 2.4: ADR-001 Import Guard Tests (SDD §4.2)

**Description:** Add two-layer ADR-001 guard: schema identity assertion + routing module denylist.

**Acceptance Criteria:**
- AC-1.6: No governance TaskType in routing/mapping paths — CI-enforced
- Layer 1: Schema identity via reference equality — `expect(BarrelTaskTypeSchema).toBe(RoutingTaskTypeSchema)` where both are imported from their exact module paths (`protocol/index` and `@0xhoneyjar/loa-hounfour` root respectively). Also `expect(BarrelTaskTypeSchema).not.toBe(GovernanceTaskTypeSchemaFromSubpath)`. Precondition: verify only one resolved copy of loa-hounfour in `node_modules` (pnpm dedup check) to avoid false reference inequality from duplicate module instances
- Layer 2: Routing modules (`pool-mapping.ts` + curated denylist) contain no `GovernanceTaskType`, `GovernanceReputationEvent` identifiers AND no imports from `@0xhoneyjar/loa-hounfour/governance` subpath
- AC-3.2: `pool-mapping.ts` `TaskType` still routing-policy
- AC-3.3: No ambiguous type resolution errors
- If `TaskTypeSchema` is type-only (not runtime): skip Layer 1, rely on Layer 2 only, document limitation

**Effort:** Low-Medium
**Testing:** `pnpm vitest run tests/unit/protocol-conformance.test.ts`
**SDD Reference:** §4.2

### Task 2.5: Conformance Test Updates

**Description:** Update `protocol-conformance.test.ts` to verify new governance symbols importable from barrel.

**Acceptance Criteria:**
- AC-1.3: Conformance vocabulary includes `task-type`, `task-type-cohort`, `reputation-event`, `scoring-path-log`
- New governance symbols verified importable
- All existing conformance tests pass

**Effort:** Low
**Testing:** `pnpm vitest run tests/unit/protocol-conformance.test.ts`
**SDD Reference:** §4.1

### Task 2.6: Launch Readiness Documentation + Full Regression (FR-7)

**Description:** Update NOTES.md with cycle-041 status and P0 gap table. Run full test suite.

**Acceptance Criteria:**
- AC-7.1: NOTES.md documents P0 gap status (resolved/deferred/in-progress)
- AC-7.2: Freeside-controlled P0 gaps addressed or deferred with rationale
- NFR-1: ALL existing tests pass — zero regression
- Full `pnpm test` green

**Effort:** Low
**Testing:** `pnpm test` (full suite)
**SDD Reference:** §3.6

---

## Risk Assessment

| Risk | Mitigation | Task |
|------|-----------|------|
| v7.11.0 tag/npm resolution failure | Three-tier fallback; blocker escalation | 1.1 |
| Runtime export verification finds MISSING symbols | SDD §3.1.1 fallback procedure | 1.2 |
| Rebuild script fails with tag pin | Investigate ref resolution; document | 1.1 |
| TaskTypeSchema identity check not applicable | Fall back to Layer 2 denylist only | 2.4 |
| CONTRACT_VERSION value changes significantly | Update `negotiateVersion()` supported array | 1.1 |

## Success Criteria

Complete when:
1. `package.json` pins v7.11.0 via immutable semver reference
2. Protocol barrel re-exports all verified governance types with `Governance*` aliases
3. `computeScoringPathHash` + `SCORING_PATH_GENESIS_HASH` available and utility-tested
4. `contract.json` updated with `>=7.11.0`, strict superset verified
5. ADR-001 guard tests passing in CI
6. All existing tests pass (zero regression)
7. Launch readiness P0 gaps documented

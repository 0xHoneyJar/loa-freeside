# PRD: Launch Readiness — loa-hounfour v7.11.0 Full Adoption

**Version:** 1.1.0
**Cycle:** cycle-041
**Date:** 2026-02-24
**Status:** Draft

> Sources: loa-finn issue #66 (Launch Readiness RFC), loa-hounfour v7.11.0 release notes,
> cycle-039/040 archives (PR #94, #95), spec/contracts/contract.json,
> themes/sietch/src/packages/core/protocol/index.ts (barrel audit),
> grimoires/loa/context/v7-export-audit.md, grimoires/loa/reality/

---

## 1. Problem Statement

Cycles 039-040 achieved full protocol convergence with loa-hounfour v7.9.2 — 513 files changed, 202 conformance vectors passing, Commons Protocol named and propagated, consumer-driven contract testing established, shadow-to-enforce graduation criteria defined, gateway schema validation deployed.

Since that convergence, loa-hounfour has released v7.11.0 ("Protocol Hardening — Task-Dimensional Reputation") with 261 files changed across 3 minor versions (v7.10.0, v7.10.1, v7.11.0). **Zero breaking changes** — all additions are optional fields and additive union members. However, the new capabilities represent significant protocol evolution that freeside should adopt to maintain full convergence:

1. **Task-Dimensional Reputation is unrepresented.** v7.10.0 introduces `TaskType`, `TaskTypeCohort`, `ReputationEvent` (3-variant discriminated union), and `ScoringPathLog` — a complete per-(model, task_type) reputation system. Freeside currently uses the aggregate reputation model without task-type granularity. Without adoption, freeside cannot route based on task-specific model quality.

2. **Scoring path hash chains are unavailable.** v7.11.0 adds `computeScoringPathHash()` and `SCORING_PATH_GENESIS_HASH` for tamper-evident reputation history via SHA-256 hash chains with RFC 8785 canonical JSON. Freeside's reputation audit trail has no integrity verification.

3. **Governance ADRs create naming collisions.** v7.10.1 (ADR-001) adds `GovernanceTaskType` and `GovernanceReputationEvent` aliases at the root barrel because governance `TaskType` collides with the existing routing-policy `TaskType` already imported by `pool-mapping.ts`. Freeside must adopt the aliased re-exports to avoid future confusion.

4. **Constraint evaluation geometry is implicit.** v7.11.0 adds `evaluation_geometry: 'expression' | 'native'` on constraints, replacing the `expression: "true"` sentinel. Freeside's constraint evaluation should use the explicit field.

5. **Conformance vectors have grown.** v7.11.0 ships 7 new conformance vector categories (task-type, task-type-cohort, reputation-event, scoring-path-log). The spec/contracts/ bundle hash and vector count are stale.

6. **The version pin is a commit SHA, not a tag.** `package.json` pins `ff8c16b...` rather than a semver tag. Issue #66 P0 gap "Arrakis adopts loa-hounfour" identifies this as a launch readiness concern — production deployments should pin semver tags.

> Sources: loa-hounfour v7.11.0 release, loa-finn issue #66 §6

---

## 2. Goals

| ID | Goal | Metric |
|----|------|--------|
| G-1 | Adopt all v7.11.0 governance schemas in the protocol barrel | TaskType, TaskTypeCohort, ReputationEvent, ScoringPathLog, ScoringPath types re-exported through protocol/index.ts |
| G-2 | Make scoring path hash utilities available for future audit trail | `computeScoringPathHash` and `SCORING_PATH_GENESIS_HASH` imported, re-exported, and utility-tested (determinism, format) |
| G-3 | Resolve ADR-001 naming collisions cleanly | Governance aliases (`GovernanceTaskType`, `GovernanceReputationEvent`) re-exported; no ambiguous imports across codebase |
| G-4 | Re-export evaluation_geometry types for consumer access | `evaluation_geometry` literal union and `NativeEnforcement` type available through protocol barrel (no runtime behavior change) |
| G-5 | Update contract.json and conformance vectors to v7.11.0 | Contract entrypoints include new governance exports; vector bundle hash updated; provider_version_range bumped to `>=7.11.0` |
| G-6 | Pin hounfour to v7.11.0 immutable semver reference | package.json uses npm registry, git tag, or tagged-commit SHA — raw untagged SHAs not acceptable |
| G-7 | Validate launch readiness alignment per issue #66 P0 gaps | All P0 gaps from issue #66 §6 either resolved or explicitly deferred with rationale |

---

## 3. User & Stakeholder Context

### Primary Persona: Platform Engineer (Internal)

- Maintains arrakis codebase across 41 development cycles
- Needs task-dimensional reputation to implement quality-aware model routing (pool selection considers per-task model scores, not just aggregate)
- Benefits from tamper-evident audit trail for scoring decisions (compliance, dispute resolution)
- Needs clean import aliases to avoid `TaskType` collision between routing-policy and governance

### Secondary Persona: Protocol Author (loa-hounfour Maintainer)

- Published v7.11.0 with 5 governance ADRs and 168 generated schemas
- Expects consumers to adopt governance annotations and evaluation_geometry
- Benefits from updated contract.json that reflects actual consumption footprint

### Tertiary Persona: Community Operator

- Indirectly benefits from task-specific reputation (better model routing = better agent responses)
- Benefits from tamper-evident scoring audit trail (transparency in how models are evaluated)

---

## 4. Functional Requirements

### FR-1: Task-Dimensional Reputation Schema Adoption

**Import and re-export all v7.10.0+ governance schemas through the protocol barrel.**

New types to adopt from `@0xhoneyjar/loa-hounfour/governance`:
- `TaskTypeSchema` / `TaskType` (open union: 5 protocol types + community `namespace:type`)
- `TASK_TYPES` (canonical array)
- `TaskTypeCohortSchema` / `TaskTypeCohort` (per-model-task reputation with `confidence_threshold`)
- `validateTaskCohortUniqueness()` (validation helper)
- `ReputationEventSchema` / `ReputationEvent` (3-variant discriminated union)
- `QualitySignalEventSchema` / `QualitySignalEvent`
- `TaskCompletedEventSchema` / `TaskCompletedEvent`
- `CredentialUpdateEventSchema` / `CredentialUpdateEvent`
- `ScoringPathSchema` / `ScoringPath` (three-tier cascade)
- `ScoringPathLogSchema` / `ScoringPathLog` (audit record)

**Closed-world audit**: The governance `TaskType` is an open union (5 protocol types + community `namespace:type` strings). Freeside currently uses the routing-policy `TaskType` (from `@0xhoneyjar/loa-hounfour`) in `pool-mapping.ts` with mapping tables and potentially exhaustive handling. **This cycle does NOT introduce the governance `TaskType` into any routing or mapping code paths.** The governance variant is re-exported (under the `GovernanceTaskType` alias) for type completeness only. If a future cycle uses governance `TaskType` in routing logic, that cycle must audit all switch/map sites for open-world safety (default cases, unknown passthrough).

**Acceptance Criteria:**
- AC-1.1: All 10+ new governance types are imported in `themes/sietch/src/packages/core/protocol/index.ts`
- AC-1.2: Re-exports use the `GovernanceTaskType` / `GovernanceReputationEvent` aliases from root barrel (ADR-001 compliance) to avoid collision with existing core `TaskType`
- AC-1.3: Conformance category vocabulary includes `task-type`, `task-type-cohort`, `reputation-event`, `scoring-path-log`
- AC-1.4: TypeScript compiles cleanly with no unused import warnings
- AC-1.5: Existing `TaskType` imports in `pool-mapping.ts` continue to reference the routing-policy variant (no behavioral change)
- AC-1.6: No file in the codebase imports the unaliased governance `TaskType` into routing, mapping, or switch logic — governance types are schema-only this cycle

### FR-2: Scoring Path Hash Chain Integration

**Import tamper-evident hash chain utilities for reputation audit trail.**

- `computeScoringPathHash()` — deterministic SHA-256 with RFC 8785 canonical JSON
- `SCORING_PATH_GENESIS_HASH` — genesis constant for bootstrapping

**Acceptance Criteria:**
- AC-2.1: `computeScoringPathHash` and `SCORING_PATH_GENESIS_HASH` re-exported through protocol barrel
- AC-2.2: Test verifies hash determinism: same input produces same hash across invocations
- AC-2.3: Test verifies genesis hash is a valid SHA-256 hex string (64 characters)
- AC-2.4: Test verifies `computeScoringPathHash` produces a valid SHA-256 hex string from sample input (utility test only — freeside does NOT build or persist ScoringPathLog chains this cycle)

### FR-3: ADR-001 Naming Collision Resolution

**Ensure all governance type re-exports follow the aliasing convention established by ADR-001.**

The root barrel provides:
- `GovernanceTaskTypeSchema` → `governance/task-type.ts:TaskTypeSchema`
- `GovernanceTaskType` → `governance/task-type.ts:TaskType`
- `GovernanceReputationEventSchema` → `governance/reputation-event.ts:ReputationEventSchema`
- `GovernanceReputationEvent` → `governance/reputation-event.ts:ReputationEvent`

Core types keep unaliased names; governance variants get the `Governance*` prefix.

**Acceptance Criteria:**
- AC-3.1: Protocol barrel re-exports ONLY the aliased `Governance*` variants (`GovernanceTaskType`, `GovernanceTaskTypeSchema`, `GovernanceReputationEvent`, `GovernanceReputationEventSchema`) — the unaliased governance `TaskType`/`ReputationEvent` names are NOT re-exported at the barrel level to prevent top-level collisions. Consumers needing the unaliased names must import directly from `@0xhoneyjar/loa-hounfour/governance`
- AC-3.2: `pool-mapping.ts` import of `TaskType` continues to resolve to routing-policy type (zero behavioral change)
- AC-3.3: No TypeScript errors from ambiguous type resolution anywhere in the codebase
- AC-3.4: A barrel JSDoc comment documents ADR-001 aliasing rationale for future maintainers

### FR-4: Evaluation Geometry Adoption

**Use the explicit `evaluation_geometry` field on constraints instead of the `expression: "true"` sentinel.**

v7.11.0 adds `evaluation_geometry: 'expression' | 'native'` to the Constraint type. v7.10.1 adds structured `native_enforcement` metadata and `severity: 'info'` level.

**Acceptance Criteria:**
- AC-4.1: New constraint types (`NativeEnforcement`, `evaluation_geometry` literal union) re-exported through protocol barrel for consumer access
- AC-4.2: If freeside has direct constraint evaluation logic, verify it handles `evaluation_geometry` field; if not, document in SDD that the field is available for future use
- AC-4.3: No runtime constraint evaluation behavior is changed this cycle — type re-exports only

### FR-5: Contract and Conformance Vector Update

**Update spec/contracts/ to reflect v7.11.0 entrypoint consumption.**

The consumer-driven contract asserts: "freeside's protocol barrel (`themes/sietch/src/packages/core/protocol/index.ts`) re-exports these symbols from loa-hounfour (the provider)." The contract tests that the provider package exports the symbols freeside consumes — it does NOT test freeside's own barrel surface.

**Version strategy**: This is a deliberate contract version bump. The `provider_version_range` changes from `>=7.0.0` to `>=7.11.0` because the new entrypoints (governance schemas, scoring-path hash) do not exist in older hounfour versions. This means hounfour CI running the contract must use v7.11.0+. Any downstream system still on <7.11.0 is unaffected because the contract only runs in CI, not at runtime.

**Acceptance Criteria:**
- AC-5.1: `contract.json` entrypoints updated with all new governance symbols that the protocol barrel actually imports from hounfour (not speculative — only symbols with real `import` statements)
- AC-5.2: `provider_version_range` bumped to `>=7.11.0` — this is a deliberate contract version bump, documented in the contract changelog
- AC-5.3: `vectors-bundle.sha256` recomputed to include new conformance vector categories
- AC-5.4: `validate.mjs` passes against v7.11.0
- AC-5.5: Contract test (`contract-spec.test.ts`) updated to verify new entrypoints
- AC-5.6: All previously pinned entrypoints from the v7.0.0 contract remain (strict superset)

### FR-6: Version Pin Migration

**Migrate hounfour dependency from commit SHA to an immutable semver reference.**

Acceptable pin formats (in preference order):
1. npm registry: `@0xhoneyjar/loa-hounfour@7.11.0` (if published)
2. git tag: `github:0xHoneyJar/loa-hounfour#v7.11.0`
3. git tag commit SHA: `github:0xHoneyJar/loa-hounfour#<sha-of-v7.11.0-tag>` (only if tag resolution fails in the package manager)

Raw commit SHAs that do not correspond to a tagged release are NOT acceptable. If option 1 and 2 both fail during implementation, this is a blocker — escalate rather than silently falling back to an arbitrary SHA.

**Acceptance Criteria:**
- AC-6.1: `package.json` dependency uses one of the three acceptable formats above, verified to resolve to v7.11.0 content
- AC-6.2: `pnpm install` / `npm install` succeeds with the new pin
- AC-6.3: All existing tests pass after version bump
- AC-6.4: `CONTRACT_VERSION` import still resolves correctly

### FR-7: Launch Readiness Alignment (Issue #66 P0 Gaps)

**Verify and document closure of issue #66 P0 gaps relevant to freeside.**

| Gap (Issue #66) | Status | This Cycle |
|-----------------|--------|------------|
| Arrakis adopts loa-hounfour | Completed (cycle-034+) | Bump to v7.11.0 (FR-6) |
| Cross-system E2E smoke test | Out of scope | Requires loa-finn repo |
| Production deployment | Out of scope | Infrastructure cycle |
| NativeRuntimeAdapter spike | Out of scope | loa-finn scope |
| Integration test with real ES256 keys | Partially done | Existing JWT vectors |

**Acceptance Criteria:**
- AC-7.1: SDD or NOTES.md documents which P0 gaps are resolved, in-progress, or deferred
- AC-7.2: Any P0 gap within freeside's control is either addressed in this cycle or explicitly deferred with rationale

---

## 5. Technical & Non-Functional Requirements

### NFR-1: Zero Regression
All changes must pass the existing test suite. No existing conformance vectors, conservation tests, boundary tests, contract tests, or graduation tests may break.

### NFR-2: Schema Adoption Only
All v7.11.0 adoptions are schema-level: new type re-exports, new conformance tests, and new barrel entries. **No runtime evaluation logic changes.** Specifically: FR-2 tests the `computeScoringPathHash` utility in isolation (determinism, genesis validity) — freeside does not build or persist ScoringPathLog chains this cycle. FR-4 re-exports the `evaluation_geometry` type for consumer access but does not modify any constraint evaluation runtime behavior.

### NFR-3: ADR Compliance
All import aliasing follows ADR-001 root barrel precedence. Governance types use `Governance*` prefix at the root barrel level.

### NFR-4: Contract Backward Compatibility
The updated contract.json must be a strict superset of the previous version — all previously pinned entrypoints remain, new ones are added.

---

## 6. Scope & Prioritization

### In Scope (This Cycle)

| Priority | Requirement | Effort |
|----------|------------|--------|
| P0 | FR-6: Version pin migration (SHA → v7.11.0 tag) | Low |
| P0 | FR-1: Task-dimensional reputation schema adoption | Medium |
| P0 | FR-5: Contract and conformance vector update | Medium |
| P1 | FR-2: Scoring path hash chain integration | Low-Medium |
| P1 | FR-3: ADR-001 naming collision resolution | Low |
| P1 | FR-4: Evaluation geometry adoption | Low |
| P2 | FR-7: Launch readiness alignment documentation | Low |

### Out of Scope

- **Implementing task-dimensional routing** — this cycle adopts the schemas; routing logic that uses task-specific scores is a future cycle
- **Hash chain persistence** — this cycle imports the hash utility; storing and retrieving chains from a database is future work
- **Cross-system E2E smoke test** — requires docker-compose with loa-finn; separate infrastructure cycle
- **Production deployment to Fly.io** — infrastructure concern outside code adoption scope
- **NativeRuntimeAdapter spike** — loa-finn scope, not freeside
- **Governance proposal execution** — governance schemas are imported for type completeness; proposal workflows are future work

---

## 7. Risks & Dependencies

| Risk | Severity | Mitigation |
|------|----------|------------|
| v7.11.0 tag may not resolve correctly as git dependency | Medium | Test with `pnpm install`; if tag resolution fails, use tagged commit SHA (FR-6 escalation path) |
| New governance types may conflict with existing local types | Low | ADR-001 aliasing handles known collisions; only `Governance*` aliases re-exported at barrel level |
| Open `GovernanceTaskType` union could break closed-world handling if misused | Medium | Governance types are schema-only this cycle (AC-1.6); future routing adoption requires explicit open-world audit |
| Conformance vector count increase may slow CI | Low | Vectors are JSON fixtures, not executable tests; negligible CI impact |
| `@noble/hashes` transitive dependency from `computeScoringPathHash` | Low | Already a dependency via hounfour; no new dependency for freeside |
| Contract `provider_version_range` bump to `>=7.11.0` breaks older hounfour CI | Low | Contract only runs in CI, not runtime; hounfour CI already targets latest |
| Issue #66 P0 gaps beyond freeside's control may block launch | Medium | Document clearly which gaps are freeside vs loa-finn vs infrastructure |

---

## 8. Success Criteria

This cycle is complete when:

1. `package.json` pins loa-hounfour v7.11.0 via immutable semver reference (npm, git tag, or tagged-commit SHA)
2. Protocol barrel re-exports all v7.11.0 governance types using `Governance*` aliases only (ADR-001)
3. `computeScoringPathHash` and `SCORING_PATH_GENESIS_HASH` available through the barrel, utility-tested
4. `contract.json` lists all new entrypoints with `provider_version_range: ">=7.11.0"` (deliberate contract version bump)
5. All existing tests pass + new conformance/contract tests for v7.11.0 types
6. No TypeScript compilation errors
7. No governance `TaskType` introduced into routing/mapping code paths (schema-only adoption)
8. Launch readiness P0 gaps documented with status

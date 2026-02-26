# PRD: The Governance Substrate — loa-hounfour v8.2.0 Full Adoption

**Version:** 1.1.0
**Cycle:** cycle-043
**Date:** 2026-02-25
**Status:** Draft

> Sources: loa-hounfour v8.2.0 release notes (https://github.com/0xHoneyJar/loa-hounfour/releases/tag/v8.2.0),
> MIGRATION.md v7.11.0 → v8.2.0 section, ADR-006 through ADR-009,
> spec/contracts/contract.json (current consumer contract),
> themes/sietch/src/packages/core/protocol/index.ts (protocol barrel, 549 lines),
> packages/adapters/agent/ (agent gateway adapters),
> codebase-wide hounfour import analysis (50+ symbols across 15+ files)
>
> GPT-5.2 cross-model review: grimoires/loa/a2a/gpt-review/prd-findings-1.json (7 findings addressed in v1.1.0)

---

## 1. Problem Statement

Cycle-041 achieved full adoption of loa-hounfour v7.11.0 — 65+ symbols under consumer-driven contract, ADR-001 import guards passing, hash chain utilities available. The protocol foundation is solid.

But v8.2.0 (released 2026-02-25) introduces a **governance substrate layer** that transforms hounfour from a schema library into an enforcement framework. Three versions landed in rapid succession:

1. **v8.0.0** — `commons` module: 21 governance substrate schemas (`GovernedResource<T>`, `ConservationLaw`, `AuditTrail`, `StateMachine`, `DynamicContract`, error taxonomy). This is the Ostrom-isomorphic foundation (ADR-007) that maps 8 institutional design principles to protocol primitives.

2. **v8.1.0** — Governance Enforcement SDK: 5 pure utility functions (`evaluateGovernanceMutation()`, conservation law factories, checkpoint utilities, TTL validation, monotonic expansion). This closes the gap between "schemas exist" and "schemas are enforced" (ADR-008).

3. **v8.2.0** — Autopoietic feedback loop: `ModelPerformanceEvent` (4th `ReputationEvent` variant), `QualityObservation` schema, `'unspecified'` TaskType. This closes the Dixie → scoring → routing → Finn feedback loop (ADR-009).

**The opportunity**: We haven't launched yet. There is no production load, no backwards-compatibility debt, no migration risk for live users. This is the last clean window to adopt the governance substrate as our single source of truth before launch. Every conservation law, audit trail, dynamic contract, and mutation evaluation that we hand-roll locally is a future drift liability.

> Sources: loa-hounfour CHANGELOG v8.0.0–v8.2.0, ADR-006 through ADR-009

---

## 2. Goals & Success Metrics

| ID | Goal | Metric | Rationale |
|----|------|--------|-----------|
| G-1 | Upgrade dependency pin to v8.2.0 | `pnpm-lock.yaml` resolves `version: 8.2.0` | Foundation for all other goals |
| G-2 | Full commons module adoption — single source of truth | 0 local reimplementations of governance primitives | Eliminates drift between hounfour canonical schemas and freeside local types |
| G-3 | Wire all 5 Enforcement SDK utilities | Each utility called from at least 1 production code path | Closes schema-to-enforcement gap (ADR-008) |
| G-4 | ModelPerformanceEvent pipeline ready | Type plumbing, handler skeleton, exhaustive switch | Enables Dixie integration without freeside changes |
| G-5 | Protocol barrel updated with commons + v8.2.0 exports | All new symbols accessible via `@arrakis/core/protocol` only (no direct subpath imports from app code) | Maintains barrel-as-single-import-point pattern |
| G-6 | Contract spec updated with dual-accept rollout | `validateCompatibility` accepts `>=7.11.0 <9.0.0` during rollout (Phase A); tightened to `>=8.2.0` after loa-finn coordination (Phase C) | Safe version negotiation without breaking loa-finn |
| G-7 | Conformance tests aligned with 219 vectors | P0 vectors (audit hash, governed resource, reputation event) pass in CI (<30s); full 219 pass in nightly | Cross-language parity verification without CI bloat |

---

## 3. User & Stakeholder Context

### Primary Stakeholder: Engineering Team

This is an infrastructure upgrade. No user-facing changes. The beneficiaries are:

- **Gateway engineers**: `DynamicContract` validation + `ContractNegotiation` TTL enforcement replaces ad-hoc contract checking
- **Billing engineers**: `GovernedCredits` + conservation law factories replace hand-rolled balance invariants
- **Reputation engineers**: `ModelPerformanceEvent` pipeline enables model-level quality tracking
- **loa-dixie team**: Needs freeside ready to receive `ModelPerformanceEvent` before they can emit them

### Secondary: loa-finn (Coordinated Upgrade — Release Gate)

The `CONTRACT_VERSION` bump from 7.11.0 → 8.2.0 affects the S2S JWT negotiation with loa-finn. loa-finn must also be on v8.2.0 for fail-fast version negotiation to succeed.

**Rollout sequence** (blocking release criterion):
1. **Phase A**: Freeside upgrades to v8.2.0 with dual-accept window (`validateCompatibility` accepts `>=7.11.0 <9.0.0`)
2. **Phase B**: loa-finn upgrades to v8.2.0 (separate PR, tracked via GitHub issue)
3. **Phase C**: Freeside tightens `validateCompatibility` to `>=8.2.0` and updates `contract.json` provider_version_range

**Release gate**: Do NOT tighten the version window (Phase C) until loa-finn main is pinned to `>=8.2.0`. Phase A and B are independent; Phase C depends on both.

**Rollback plan**: If loa-finn upgrade is delayed, freeside operates safely in dual-accept mode indefinitely — all new commons/enforcement features are internal and do not require peer v8.2.0.

---

## 4. Functional Requirements

### FR-1: Dependency Pin Update

Update `@0xhoneyjar/loa-hounfour` from commit `7e2294b` (v7.11.0) to the v8.2.0 tag in:
- `package.json` (root)
- `packages/adapters/package.json`
- Run `pnpm install` to update lockfile
- Verify `pnpm-lock.yaml` resolves `version: 8.2.0`

> Source: package.json:3, packages/adapters/package.json

### FR-2: Protocol Barrel Extension — Commons Module

Add new export section to `themes/sietch/src/packages/core/protocol/index.ts` for the commons module. **All hounfour imports — including `/commons` — MUST go through the protocol barrel.** App code imports from `@arrakis/core/protocol`, never from `@0xhoneyjar/loa-hounfour/*` directly. Only the barrel file itself imports subpaths.

**Foundation schemas** (from `@0xhoneyjar/loa-hounfour/commons`):
- `InvariantSchema`, `ConservationLawSchema`
- `AuditEntrySchema`, `AuditTrailSchema`, `AUDIT_TRAIL_GENESIS_HASH`
- `StateSchema`, `TransitionSchema`, `StateMachineConfigSchema`
- `GovernanceClassSchema`, `GOVERNED_RESOURCE_FIELDS`, `GovernanceMutationSchema`

**Governed resources**:
- `GovernedCreditsSchema`, `GovernedReputationSchema`, `GovernedFreshnessSchema`

**Hash chain operations** (ADR-006):
- `HashChainDiscontinuitySchema`
- `QuarantineStatusSchema`, `QuarantineRecordSchema`
- `buildDomainTag`, `computeAuditEntryHash`, `verifyAuditTrailIntegrity`
- `createCheckpoint`, `verifyCheckpointContinuity`, `pruneBeforeCheckpoint`

**Dynamic contracts** (FR-4):
- `ProtocolCapabilitySchema`, `RateLimitTierSchema`, `ProtocolSurfaceSchema`, `DynamicContractSchema`
- `AssertionMethodSchema`, `ContractNegotiationSchema`
- `isNegotiationValid`, `computeNegotiationExpiry`
- `verifyMonotonicExpansion`

**Enforcement SDK**:
- `evaluateGovernanceMutation`
- Conservation law factories: `buildSumInvariant`, `buildNonNegativeInvariant`, `buildBoundedInvariant`, `createBalanceConservation`, `createNonNegativeConservation`, `createBoundedConservation`, `createMonotonicConservation`

**Error taxonomy**:
- `GovernanceErrorSchema` (6-variant discriminated union)

> Source: /tmp/loa-hounfour-v8.2.0/src/commons/index.ts, themes/sietch/src/packages/core/protocol/index.ts

### FR-3: Protocol Barrel Extension — Governance v8.2.0

Add new governance exports to the protocol barrel:

- `ModelPerformanceEventSchema` (4th `ReputationEvent` variant)
- `QualityObservationSchema` (standalone evaluation schema)
- `'unspecified'` TaskType literal (already in the TaskType union — just document)

**ADR-001 compliance**: `ModelPerformanceEventSchema` is a governance export. Follow the existing pattern — import from `/governance` subpath, export with `Governance` prefix if naming collision exists, or as-is if no collision.

> Source: /tmp/loa-hounfour-v8.2.0/src/governance/index.ts

### FR-4: DynamicContract Validation at Gateway

Wire `DynamicContract` and `ContractNegotiation` validation into the agent gateway request lifecycle:

1. Load `DynamicContract` mapping at gateway startup (defines reputation-state → protocol-surface mapping)
2. Call `verifyMonotonicExpansion()` on load to validate contract integrity
3. During request lifecycle, check `isNegotiationValid()` with explicit clock time for TTL enforcement
4. Filter model pool access by `granted_surface.capabilities`

**Integration point**: `packages/adapters/agent/request-lifecycle.ts` (state machine RECEIVED→FINALIZED)

> Source: packages/adapters/agent/request-lifecycle.ts, ADR-009

### FR-5: GovernedCredits for Billing Conservation

Replace local billing conservation invariants with canonical `GovernedCredits` + conservation law factories:

1. Use `createBalanceConservation()` factory for the lot_invariant (sum conservation across balance fields)
2. Wire `evaluateGovernanceMutation()` as authorization gate for credit mutations
3. Ensure `actor_id` is provided on all governance mutation calls (required since v8.1.0)

**Note on breaking change analysis**: While `GovernanceMutation` is NOT constructed in the current codebase (v7.11.0 pin is safe), FR-5 introduces NEW code that constructs mutations. The implementation MUST:
- Define the exact mutation shapes used for credit operations (balance adjustment, reservation, refund)
- Source `actor_id` from the authenticated request context (JWT `sub` claim or service identity)
- Include tests for both acceptance (valid mutation) and rejection (missing/empty `actor_id`, CAS version mismatch) paths

**Integration point**: `themes/sietch/src/packages/core/protocol/arrakis-conservation.ts` (conservation error taxonomy adapter)

> Source: themes/sietch/src/packages/core/protocol/arrakis-conservation.ts, /tmp/loa-hounfour-v8.2.0/src/commons/conservation-law-factories.ts

### FR-6: Audit Trail Hash Chain Integration

Wire the hash chain operational response (ADR-006) into audit logging:

1. Use `computeAuditEntryHash()` with domain-separated hashing for audit entries
2. Use `verifyAuditTrailIntegrity()` for periodic integrity checks
3. Wire `createCheckpoint()` + `pruneBeforeCheckpoint()` for operational pruning
4. Handle `HashChainDiscontinuity` via quarantine protocol

**Canonicalization requirement (ADR-006)**: All hash chain operations MUST use the hounfour library helpers end-to-end — no reimplementation of hashing or canonicalization. Specifically:
- Use `buildDomainTag()` for domain tag construction (format: `loa-commons:audit:<schema_$id>:<contract_version>`)
- Use `computeAuditEntryHash()` which internally applies RFC 8785 JCS canonicalization via `@noble/hashes` SHA-256
- The hashed payload fields are defined by the `AuditEntrySchema` — only `content_fields` participates in the hash (not metadata like timestamps)
- Validate against the audit trail hash reference conformance vectors (`vectors/conformance/commons/audit-trail/hash-reference-vector.json`)

**Do NOT**: Reimplement SHA-256 hashing, JSON canonicalization, or domain tag formatting. Divergent implementations will trigger quarantine on integrity verification.

> Source: ADR-006, /tmp/loa-hounfour-v8.2.0/src/commons/audit-trail-hash.ts

### FR-7: ModelPerformanceEvent Handler

Create exhaustive `ReputationEvent` handler that includes the new 4th variant:

1. Add `model_performance` case to any existing or new `ReputationEvent` switch/discriminator
2. Wire `QualityObservation` validation for structured evaluation output
3. Handle `'unspecified'` TaskType — route to aggregate-only scoring (no task-type cohort entry)
4. Create skeleton handler that logs + forwards to reputation scoring pipeline

**Follow-up**: Create GitHub issue on loa-dixie for `ModelPerformanceEvent` emission. Freeside receives; Dixie emits.

> Source: /tmp/loa-hounfour-v8.2.0/src/governance/reputation-event.ts, MIGRATION.md

### FR-8: Contract Spec & Version Negotiation Update (Phased)

**Phase A** (this cycle — immediate):

1. Update `spec/contracts/contract.json`:
   - `provider_version_range`: `>=7.11.0` → `>=7.11.0` (unchanged — dual-accept)
   - Add `@0xhoneyjar/loa-hounfour/commons` entrypoint with all consumed symbols
   - Update symbol counts in metadata
   - Update `conformance_vectors.vector_count` and `bundle_hash`

2. Update `CONTRACT_VERSION` constant in `arrakis-compat.ts` to `8.2.0`

3. Widen `validateCompatibility()` to accept `>=7.11.0 <9.0.0` (dual-accept window)

**Phase C** (after loa-finn upgrade — separate PR):

4. Tighten `provider_version_range` to `>=8.2.0`
5. Tighten `validateCompatibility()` to `>=8.2.0`

**Release gate**: Phase C MUST NOT merge until loa-finn main pins `>=8.2.0`.

> Source: spec/contracts/contract.json, themes/sietch/src/packages/core/protocol/arrakis-compat.ts

### FR-9: Conformance Test Alignment

1. Update `tests/unit/protocol-conformance.test.ts`:
   - CONTRACT_VERSION assertion: `7.11.0` → `8.2.0`
   - Add commons module conformance tests
   - Add ModelPerformanceEvent variant test
   - Add QualityObservation validation test

2. Add commons conformance vector runners in `spec/conformance/`:
   - Audit trail hash reference vectors (P0 — must pass in CI)
   - Dynamic contract monotonic expansion vectors (P0 — must pass in CI)
   - Governed resource validation vectors (P0 — must pass in CI)

3. Update ADR-001 three-layer test for new commons imports

**CI strategy for 219 vectors** (addressing 73x increase):
- **P0 vectors** (CI-blocking, <30s budget): Audit trail hash reference, governed resource schemas, reputation event variants, dynamic contract monotonic — approximately 40 vectors covering the symbols freeside actually consumes
- **Full suite** (nightly job): All 219 vectors run in parallel with cached hounfour dist
- **Determinism**: All clock-dependent vectors (TTL, negotiation expiry) use injected fixed clock times — no `Date.now()` in vector runners
- **Flake policy**: Vector failures are hard failures (no retry/skip) — canonicalization bugs must be caught immediately

> Source: tests/unit/protocol-conformance.test.ts, /tmp/loa-hounfour-v8.2.0/vectors/conformance/

### FR-10: ADR-001 Import Guard Extension

Extend ESLint import guards for the protocol barrel pattern:

1. Add `@0xhoneyjar/loa-hounfour/commons` to the **barrel file's** allowed import sources
2. **App code** (outside the barrel) remains restricted: all hounfour types imported via `@arrakis/core/protocol` only
3. Maintain existing `/governance` routing restrictions (governance symbols still go through barrel)
4. Update the ADR-001 three-layer test to verify commons symbols are NOT directly importable from app code

**Single rule**: Only `themes/sietch/src/packages/core/protocol/index.ts` may import from `@0xhoneyjar/loa-hounfour/*`. Everything else imports from the barrel.

> Source: themes/sietch/.eslintrc.cjs:39-50

---

## 5. Technical & Non-Functional Requirements

### NFR-1: Zero Breaking Changes for Existing Code

The v8.2.0 **dependency pin upgrade** (FR-1) must not break any existing functionality. Analysis confirms:
- `GovernanceMutation` is NOT constructed in the current codebase (v8.1.0 `actor_id` safe for pin upgrade)
- `ReputationEvent` has NO active discriminated union handlers (v8.2.0 4th variant safe for pin upgrade)
- All existing imports remain valid in v8.2.0

**Clarification**: FR-5 introduces NEW code that constructs `GovernanceMutation` — this is new functionality, not a breaking change to existing code. The `actor_id` requirement applies to this new code and must be handled in FR-5 implementation (see FR-5 note).

### NFR-2: Type Safety

All new commons types must flow through TypeScript strict mode. No `any` casts, no `@ts-ignore` for hounfour types.

### NFR-3: Test Coverage

Each enforcement SDK utility wired in production code must have:
- At least 1 unit test exercising the happy path
- At least 1 unit test exercising the error/rejection path
- Conformance vector validation where applicable

### NFR-4: Node.js Compatibility

v8.2.0 requires Node.js `>=22`. Current runtime is v24.11.1, engine constraint is `>=22`. No action needed.

### NFR-5: CI Performance Budget

The conformance vector expansion (3 → 219) must not degrade CI:
- P0 vector suite: <30 seconds wall time
- Full vector suite (nightly): <120 seconds wall time
- Parallel execution: vectors are independent and MUST run concurrently
- Caching: hounfour `dist/` cached between runs (vectors are deterministic)
- Clock injection: all TTL/expiry vectors use explicit clock parameter, never `Date.now()`

---

## 6. Scope & Prioritization

### In Scope (This Cycle)

| Priority | Item | FR | Goals |
|----------|------|----|-------|
| P0 | Dependency pin update | FR-1 | G-1 |
| P0 | Protocol barrel extension (commons + governance) | FR-2, FR-3 | G-2, G-5 |
| P0 | Contract spec + version negotiation (Phase A: dual-accept) | FR-8 | G-6 |
| P0 | Conformance test alignment (P0 vectors in CI) | FR-9 | G-7 |
| P0 | ADR-001 import guard extension | FR-10 | G-5 |
| P1 | DynamicContract validation at gateway | FR-4 | G-2, G-3 |
| P1 | GovernedCredits for billing conservation | FR-5 | G-2, G-3 |
| P1 | Audit trail hash chain integration | FR-6 | G-2, G-3 |
| P2 | ModelPerformanceEvent handler | FR-7 | G-4 |

### Out of Scope

| Item | Reason |
|------|--------|
| loa-dixie ModelPerformanceEvent emission | Separate repo — will create follow-up issue |
| loa-finn v8.2.0 upgrade (Phase B) | Separate repo — tracked via GitHub issue, required before Phase C |
| Contract version tightening (Phase C) | Blocked on loa-finn — separate PR after Phase B |
| Payment capacity in ProtocolSurface | Future additive per ADR-009 |
| Cross-language conformance (Python/Go/Rust) | TypeScript only for now |
| Runtime contract negotiation service | loa-finn responsibility per ADR-009 |

---

## 7. Risks & Dependencies

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| loa-finn not yet on v8.2.0 — version negotiation fails | Medium | High | Dual-accept window (Phase A) allows independent upgrade; Phase C gated on loa-finn |
| Commons schemas don't fit freeside's local billing types | Low | Medium | Conservation factories are composable — adapt, don't force-fit |
| Conformance vector count jump (3 → 219) overwhelms CI | Low | Low | P0/nightly split (NFR-5); parallel execution; cached hounfour dist |
| DynamicContract mapping not yet defined for arrakis | Medium | Medium | Define initial mapping as part of FR-4 implementation |
| GovernanceMutation actor_id sourcing unclear | Low | Medium | Source from JWT `sub` claim; define in FR-5 implementation with acceptance + rejection tests |

### Dependencies

| Dependency | Status | Impact | Gate |
|------------|--------|--------|------|
| loa-hounfour v8.2.0 released | Done (2026-02-25) | None | — |
| Node.js >=22 | Done (v24.11.1) | None | — |
| loa-finn v8.2.0 upgrade | Not started | CONTRACT_VERSION negotiation | Blocks Phase C only; Phase A/B independent |

---

## 8. v8.x Symbol Delta Checklist

Consumed symbol inventory diff from v7.11.0 → v8.2.0. Each symbol is either **ADOPT** (add to barrel + contract.json) or **DEFER** (not consumed, rationale given).

### New exports from `@0xhoneyjar/loa-hounfour/commons` (v8.0.0+)

| Symbol | Decision | FR |
|--------|----------|-----|
| `InvariantSchema` | ADOPT | FR-2 |
| `ConservationLawSchema` | ADOPT | FR-2, FR-5 |
| `AuditEntrySchema`, `AuditTrailSchema`, `AUDIT_TRAIL_GENESIS_HASH` | ADOPT | FR-2, FR-6 |
| `StateSchema`, `TransitionSchema`, `StateMachineConfigSchema` | ADOPT | FR-2 |
| `GovernanceClassSchema`, `GOVERNED_RESOURCE_FIELDS`, `GovernanceMutationSchema` | ADOPT | FR-2, FR-5 |
| `GovernedCreditsSchema` | ADOPT | FR-2, FR-5 |
| `GovernedReputationSchema` | ADOPT | FR-2 |
| `GovernedFreshnessSchema` | ADOPT | FR-2 |
| `HashChainDiscontinuitySchema` | ADOPT | FR-2, FR-6 |
| `QuarantineStatusSchema`, `QuarantineRecordSchema` | ADOPT | FR-2, FR-6 |
| `buildDomainTag`, `computeAuditEntryHash`, `verifyAuditTrailIntegrity` | ADOPT | FR-2, FR-6 |
| `createCheckpoint`, `verifyCheckpointContinuity`, `pruneBeforeCheckpoint` | ADOPT | FR-2, FR-6 |
| `ProtocolCapabilitySchema`, `RateLimitTierSchema`, `ProtocolSurfaceSchema` | ADOPT | FR-2, FR-4 |
| `DynamicContractSchema` | ADOPT | FR-2, FR-4 |
| `AssertionMethodSchema`, `ContractNegotiationSchema` | ADOPT | FR-2, FR-4 |
| `isNegotiationValid`, `computeNegotiationExpiry` | ADOPT | FR-2, FR-4 |
| `verifyMonotonicExpansion` | ADOPT | FR-2, FR-4 |
| `evaluateGovernanceMutation` | ADOPT | FR-2, FR-5 |
| Conservation law factories (7 functions) | ADOPT | FR-2, FR-5 |
| `GovernanceErrorSchema` (6-variant union) | ADOPT | FR-2 |
| `resetFactoryCounter` | DEFER | Testing utility only — not needed in production barrel |

### New exports from `@0xhoneyjar/loa-hounfour/governance` (v8.2.0)

| Symbol | Decision | FR |
|--------|----------|-----|
| `ModelPerformanceEventSchema` | ADOPT | FR-3, FR-7 |
| `QualityObservationSchema` | ADOPT | FR-3, FR-7 |
| `'unspecified'` TaskType literal | ADOPT (already in union) | FR-7 |

### Unchanged exports (verified compatible)

All 78 symbols in the current `contract.json` remain valid in v8.2.0. No removals, no signature changes. Verified via `pnpm tsc --noEmit` after pin update.

---

## 9. Follow-Up Actions

1. **GitHub Issue: loa-dixie** — "Emit `ModelPerformanceEvent` for model quality observations" with schema reference and example payload
2. **GitHub Issue: loa-finn** — "Upgrade to loa-hounfour v8.2.0 — `actor_id` required, CONTRACT_VERSION bump" with migration guide link
3. **Phase C PR**: After loa-finn upgrade, tighten version window (FR-8 Phase C)
4. **ADR**: Document the freeside adoption pattern for commons module (local ADR, not upstream)

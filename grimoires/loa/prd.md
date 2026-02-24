# PRD: The Naming — Engineering Excellence & Protocol Identity

**Version:** 1.1.0
**Cycle:** cycle-040
**Date:** 2026-02-24
**Status:** Draft

> Sources: Bridgebuilder review (bridge-20260224-d039eco, iteration 1-2),
> cycle-039 archive (PR #94), ground-truth/architecture.md, ground-truth/contracts.md,
> grimoires/loa/context/rfc31-hounfour.md, README.md

---

## 1. Problem Statement

Cycle 039 achieved full protocol convergence with loa-hounfour v7.9.2 — 513 files changed, 202 conformance vectors passing, shadow-to-enforce parsing deployed, conservation guard with fencing tokens, JWT boundary verification. The Bridgebuilder review (kaironic convergence, scores [4, 0]) surfaced six structural recommendations that represent the difference between "working software" and "excellent engineering."

These six gaps share a common root: **the codebase does operational things well but doesn't formalize the operational knowledge into enforceable contracts, documented strategies, or named identity.** Specifically:

1. **Shadow-to-enforce has no graduation criteria.** The `parseBoundaryMicroUsd` three-mode pattern (legacy/shadow/enforce) exists and is tested, but there are no explicit criteria for when shadow mode should graduate to enforce mode. Without criteria, the migration will stall — shadow mode becomes permanent rather than transitional.

2. **Conformance testing is unidirectional.** The 205-vector conformance suite runs in freeside's CI after hounfour releases, but not in hounfour's CI before release. This means breaking changes in hounfour can ship without freeside knowing until after the fact.

3. **Micro-USD validation lacks a first line of defense.** The `parseBoundaryMicroUsd` safety floor is the correct last line of defense, but API gateway inputs accept raw strings without OpenAPI schema constraints. Invalid inputs travel through the entire request path before being rejected at the boundary parser.

4. **Module-level env var caching has no invalidation strategy.** `config.ts` loads and validates environment variables at module import time. There is no TTL-based invalidation and no documentation that mode changes require cold restart.

5. **Post-merge synthesis is informal.** Field reports on GitHub issue #24 serve as post-merge ceremony informally, but there is no structural post-merge ritual that connects what was built to what it means. The Bridgebuilder reviews themselves are the closest thing, but they are pre-merge, not post-merge.

6. **The protocol has no name.** The README says "distribution platform." The PR title says "Protocol Convergence." The web4 manifesto says "social monies." But the code says something more specific: a community-governed economic protocol for AI inference, with conservation invariants, conviction-gated access, and transparent disagreement resolution. Without a name, the architecture has no north star to follow.

> Source: Bridgebuilder bridge-20260224-d039eco, iterations 1-2

---

## 2. Goals

| ID | Goal | Metric |
|----|------|--------|
| G-1 | Define and document shadow-to-enforce graduation criteria | SDD contains explicit graduation criteria with 3 measurable thresholds (divergence rate, time window, quarantine replay success rate) |
| G-2 | Establish consumer-driven contract testing between hounfour and freeside | Pact-pattern contract test spec exists; conformance vectors exportable for hounfour CI consumption |
| G-3 | Add schema-level validation at API gateway for micro-USD inputs | OpenAPI/Zod constraints reject invalid micro-USD strings before they reach the boundary parser |
| G-4 | Document cache invalidation strategy for module-level env var caching | Strategy documented in SDD; either TTL-based invalidation implemented or cold-restart requirement made explicit and enforced |
| G-5 | Design the Ceremony geometry — a structural post-merge synthesis ritual | Post-merge ceremony spec documented; at minimum one ceremony executed for cycle-039's merge |
| G-6 | Name the protocol and propagate the name through documentation and code | Protocol name chosen, README updated, BUTTERFREEZONE updated, protocol barrel module doc updated |

---

## 3. User & Stakeholder Context

### Primary Persona: Platform Engineer (Internal)

- Maintains the arrakis codebase across 39+ development cycles
- Needs clear graduation criteria to know when shadow mode is safe to promote
- Benefits from contract testing that catches upstream breaking changes early
- Needs env var behavior documented to avoid production surprises

### Secondary Persona: Protocol Author (loa-hounfour Maintainer)

- Publishes protocol releases consumed by freeside
- Benefits from consumer-driven contract tests that prevent accidental breaks
- Needs the protocol's identity named to guide future evolution

### Tertiary Persona: Community Operator

- Indirectly benefits from improved engineering rigor
- Benefits from named protocol identity for understanding what they're operating

---

## 4. Functional Requirements

### FR-1: Shadow-to-Enforce Graduation Criteria

**Define explicit, measurable criteria for graduating `parseBoundaryMicroUsd` from shadow mode to enforce mode.**

The criteria must include:

1. **Divergence rate threshold**: Maximum percentage of requests where shadow mode detects canonical/legacy divergence. Must be ≤ N% over a rolling window. Computable from existing `divergenceTotal / shadowTotal` counters.
2. **Observation time window**: Minimum duration in shadow mode before graduation is permitted. Computable from deployment timestamps.
3. **Would-reject rate threshold**: Maximum percentage of requests where canonical would reject but legacy accepts (`wouldRejectTotal / shadowTotal`). Must be 0% for a consecutive observation window — any non-zero value means canonical is stricter on real traffic.

All three criteria are computable from existing `parseBoundaryMicroUsd` metrics without new storage. No quarantine mechanism is required this cycle.

**Acceptance Criteria:**
- AC-1.1: SDD §X documents three graduation thresholds with specific numeric values
- AC-1.2: A `BoundaryGraduationCriteria` type is defined in the protocol layer
- AC-1.3: `parseBoundaryMicroUsd` metrics (`shadowTotal`, `wouldRejectTotal`, `divergenceTotal`) are sufficient to compute all three criteria — no new counters or storage required
- AC-1.4: A Prometheus gauge or internal health check reports current graduation status against the criteria. If exposed as an HTTP endpoint, it must be protected by admin JWT claim check and internal-only network policy (not tenant-accessible)
- AC-1.5: Graduation criteria are referenced in the existing mode-toggle test suite

### FR-2: Consumer-Driven Contract Testing (Pact Pattern)

**Establish a contract testing pattern between hounfour (provider) and freeside (consumer) so that freeside's conformance expectations can run in hounfour's CI.**

The contract is defined at the actual integration seam — exported entrypoints and semantic behaviors — not internal implementation details like counts or data structures.

**Acceptance Criteria:**
- AC-2.1: Freeside exports a contract specification (JSON/YAML) pinning the exact module entrypoints (paths + function signatures) it imports from hounfour
- AC-2.2: The contract includes a versioned bundle of conformance vectors (hash + count) as the behavioral contract — vectors ARE the test, not internal property/builtin counts
- AC-2.3: A `spec/contracts/` directory contains the exported contract and vectors bundle
- AC-2.4: Contract spec includes: module paths consumed, function signatures depended on, conformance vector bundle hash, minimum `CONTRACT_VERSION` semver range
- AC-2.5: A validation script verifies the current hounfour version satisfies the contract by running vectors and checking entrypoint availability
- AC-2.6: Documentation describes how hounfour's CI would consume the contract (README in spec/contracts/)
- AC-2.7: Counts (invariant count, evaluator builtin count) are informational metadata only, not gating criteria

### FR-3: Schema-Level Micro-USD Validation at API Gateway

**Add OpenAPI/Zod schema constraints on micro-USD input fields at the API gateway layer, so invalid inputs are rejected before reaching the boundary parser.**

The gateway schema must be mode-aware: in shadow mode, the schema matches legacy acceptance (no production breakage); in enforce mode, the schema tightens to canonical acceptance. This resolves the tension between NFR-3 (no production regressions) and the safety goal (reject invalid inputs early).

**Acceptance Criteria:**
- AC-3.1: A shared Zod micro-USD schema is defined once with two modes: `legacy` (accepts what `BigInt()` accepts — permissive) and `canonical` (matches `parseMicroUsd` — strict: non-negative integer string, no leading zeros except "0", max 18 digits)
- AC-3.2: The schema mode is driven by the same `BOUNDARY_PARSE_MODE` env var that controls `parseBoundaryMicroUsd`, ensuring gateway and boundary parser are always in the same mode
- AC-3.3: Invalid inputs return 400 with a structured error before reaching the boundary parser
- AC-3.4: In canonical/enforce mode, the gateway schema is strictly equal-or-tighter than `parseBoundaryMicroUsd` — it must never accept a string that the boundary parser would reject
- AC-3.5: In legacy/shadow mode, the gateway schema must not reject any inputs that production currently accepts (NFR-3 compliance)
- AC-3.6: Integration tests verify both modes: legacy accepts permissive inputs, canonical rejects leading zeros and non-integer strings

### FR-4: Cache Invalidation Strategy Documentation

**Document the env var caching behavior and make cold-restart a documented, enforced constraint.**

The chosen strategy is **cold-restart** for this cycle. TTL-based hot-reload is explicitly out of scope because `config.ts` is imported at module load time and many call sites capture config values in closures/constants. A partial hot-reload would create split-brain behavior within a single process — dangerous for economic invariants and auth. TTL-based invalidation may be reconsidered in a future cycle with a full call-site audit.

**Acceptance Criteria:**
- AC-4.1: SDD §X documents the current module-level env var caching behavior in `config.ts`
- AC-4.2: The strategy explicitly states that ALL env var changes (including `BOUNDARY_PARSE_MODE`, feature flags, secrets) require cold restart (process restart / ECS task replacement)
- AC-4.3: `config.ts` module doc comment states the cold-restart constraint
- AC-4.4: A startup log line emits a config fingerprint (hash of all loaded config keys) for audit and drift detection
- AC-4.5: Feature flags that support runtime re-evaluation (via Redis reads, not env vars) are explicitly enumerated and distinguished from env-var-backed flags that require cold restart

### FR-5: Ceremony Geometry — Post-Merge Synthesis Ritual

**Design and document a structural post-merge ceremony that connects what was built to what it means.**

**Acceptance Criteria:**
- AC-5.1: A ceremony spec is documented (format, participants, outputs, trigger conditions)
- AC-5.2: The ceremony produces a synthesis artifact (field report, architectural reflection, or decision record)
- AC-5.3: The ceremony is triggered after significant cycle merges (not every PR)
- AC-5.4: At minimum, a ceremony is executed for cycle-039's merge (PR #94) as the inaugural instance
- AC-5.5: The ceremony artifact references: what was built, why it matters, what it changes about the system's identity, what questions remain

### FR-6: Name the Protocol

**Choose a name for the economic protocol and propagate it through documentation and code.**

The name must capture: community-governed economic protocol for AI inference, with conservation invariants, conviction-gated access, and transparent disagreement resolution.

**Acceptance Criteria:**
- AC-6.1: A protocol name is chosen and documented
- AC-6.2: README.md "What is Freeside?" section references the protocol by name
- AC-6.3: BUTTERFREEZONE.md includes the protocol name in its summary
- AC-6.4: The protocol barrel (`themes/sietch/src/packages/core/protocol/index.ts`) module doc references the protocol name
- AC-6.5: The name is not a Dune reference (the codebase already has enough of those — the protocol deserves its own identity)

---

## 5. Technical & Non-Functional Requirements

### NFR-1: Zero Regression
All changes must pass the existing test suite. No existing conformance vectors, conservation tests, or boundary tests may break.

### NFR-2: Documentation-First
FR-1, FR-4, FR-5, and FR-6 are primarily documentation and specification work. They should produce artifacts that are verifiable by reading, not just by running tests.

### NFR-3: Backward Compatibility
FR-3 (schema validation) is mode-aware: in legacy/shadow mode, the gateway schema must not reject inputs that production currently accepts. In enforce mode, the schema tightens to match canonical acceptance. The gateway schema mode is always synchronized with `BOUNDARY_PARSE_MODE` to prevent inconsistency between gateway rejection and boundary parser acceptance.

### NFR-4: Observability
FR-1 (graduation criteria) requires that existing metrics are sufficient. If not, new metrics must be added without breaking existing dashboards.

---

## 6. Scope & Prioritization

### In Scope (This Cycle)

| Priority | Requirement | Effort |
|----------|------------|--------|
| P0 | FR-6: Name the protocol | Low (documentation) |
| P0 | FR-1: Shadow-to-enforce graduation criteria | Medium (spec + type + endpoint) |
| P1 | FR-3: Schema-level micro-USD validation | Medium (code + tests) |
| P1 | FR-4: Cache invalidation strategy | Low (documentation + small code) |
| P1 | FR-5: Ceremony geometry | Low (spec + inaugural execution) |
| P2 | FR-2: Consumer-driven contract testing | Medium (spec + script + docs) |

### Out of Scope

- Implementing the actual shadow→enforce graduation (that's a future operational decision)
- Running the contract tests in hounfour's CI (requires hounfour repo changes — this cycle provides the spec)
- TTL-based hot-reload for env vars (cold-restart is the chosen strategy; hot-reload requires a full call-site audit deferred to a future cycle)
- Quarantine storage or replay infrastructure (graduation criteria use existing metrics only)
- Renaming existing Dune references in the codebase (the protocol gets its own name; existing code names stay)

---

## 7. Risks & Dependencies

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Naming bikeshed — can't agree on protocol name | Medium | Low | User chooses; we propose 2-3 options with rationale |
| Schema validation too tight — rejects valid production inputs | Low | High | Schema derived from canonical `parseMicroUsd` spec; integration test coverage |
| Graduation criteria too strict — shadow mode never graduates | Low | Medium | Criteria based on observed divergence rates from cycle-039 bridge data |
| Contract spec too coupled to hounfour internals | Medium | Medium | Spec tests behaviors, not implementation details |

---

## 8. Success Criteria

This cycle succeeds when:
1. The SDD contains graduation criteria with three measurable thresholds
2. A contract testing spec exists in `spec/contracts/`
3. API routes validate micro-USD inputs at the schema level
4. Config caching strategy is documented and enforced
5. The inaugural ceremony is executed for PR #94
6. The protocol has a name that appears in README, BUTTERFREEZONE, and the protocol barrel

**Meta-criterion**: The Bridgebuilder, if re-run, would find zero of its six original recommendations still unaddressed.

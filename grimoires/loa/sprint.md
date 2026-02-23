# Sprint Plan: Merge Readiness — Bridgebuilder Findings & Rebase

**Version:** 2.1.0
**Date:** 2026-02-23
**Cycle:** cycle-038 (continuation)
**Source:** Bridgebuilder Deep Review Parts 1-3 (PR #90 comments)
**PRD:** grimoires/loa/prd.md v1.2.0
**SDD:** grimoires/loa/sdd.md v2.0.0
**Duration:** 2 sprints (Sprint 1–2)
**Team:** 1 engineer (AI-assisted)
**Global Sprint IDs:** 341–342
**Prerequisite:** Sprints 336–340 (The Ostrom Protocol) COMPLETE

---

## Context

The Ostrom Protocol implementation (Sprints 336-340) is complete: 51 files, 22 tests, 30 GPT-5.2 findings resolved. The Bridgebuilder Deep Review (3-part, posted to PR #90) identified 5 findings (2 MEDIUM, 2 LOW, 1 PRAISE) and 4 inquiry questions. PR #90 is currently in CONFLICTING merge state with 1 commit on main to rebase against. 93 uncommitted files need staging.

### Findings Summary

| # | Severity | Category | Title | Target File |
|---|----------|----------|-------|-------------|
| F-1 | MEDIUM | Architecture | Outbox propagation invariant gap | `conservation-guard.ts`, `governance-outbox-worker.ts` |
| F-2 | LOW | Design | Event sourcing lacks governance replay | `event-sourcing-service.ts` |
| F-3 | LOW | Numerical | BigInt division truncation bias | `velocity-service.ts` |
| F-4 | MEDIUM | Operational | Per-actor rate limit key cardinality | `governance-auth.ts` |
| F-5 | PRAISE | Architecture | Circuit breaker as governance resilience | `arrakis-conviction-bridge.ts` |

---

## Sprint 1: Git Housekeeping & Rebase

**Goal:** Commit all Cycle 038 work and rebase against main to resolve CONFLICTING merge state.

**Global Sprint ID:** 341

### Tasks

#### Task 1.1: Stage and Commit Cycle 038 Implementation
**Description:** Commit all 93 uncommitted files from Sprints 336-340 (The Ostrom Protocol). Group into logical commits for clean history.
**Acceptance Criteria:**
- AC-1.1.1: All implementation files staged and committed (services, adapters, migrations, tests)
- AC-1.1.2: State files committed (.run/, grimoires/loa/ artifacts)
- AC-1.1.3: GPT review findings committed (grimoires/loa/a2a/gpt-review/)
- AC-1.1.4: No secrets, no .env files, no node_modules in staged files
- AC-1.1.5: Commit messages follow conventional format: `feat(cycle-038): The Ostrom Protocol — economic memory, velocity, event sourcing & governance`
**Estimated Effort:** Small
**Dependencies:** None

#### Task 1.2: Rebase Against Main
**Description:** Rebase feature/launch-readiness against origin/main (1 commit: `581ed3c8 Launch Readiness: Production Stack, Payments & Agent Surfaces (#88)`). Resolve any merge conflicts.
**Acceptance Criteria:**
- AC-1.2.1: `git rebase origin/main` completes without errors
- AC-1.2.2: All merge conflicts resolved (if any)
- AC-1.2.3: TypeScript compilation still succeeds after rebase (`npx tsc --noEmit` or equivalent)
- AC-1.2.4: Full test suite passes after rebase (`pnpm test` or repo equivalent) — conservation invariants I-1..I-5 verified
- AC-1.2.5: PR merge state changes from CONFLICTING to MERGEABLE
**Estimated Effort:** Medium
**Dependencies:** Task 1.1

#### Task 1.3: Push and Verify PR State
**Description:** Force-push rebased branch and verify PR #90 is in mergeable state.
**Acceptance Criteria:**
- AC-1.3.1: `git push --force-with-lease` succeeds
- AC-1.3.2: `gh pr view 90 --json mergeable` returns MERGEABLE
- AC-1.3.3: CI checks pass (or only unrelated failures like Vercel)
**Estimated Effort:** Small
**Dependencies:** Task 1.2

### Sprint 1 Success Criteria
- All Cycle 038 work committed with clean history
- Branch rebased on latest main
- PR #90 shows MERGEABLE state
- No CI regressions from rebase

---

## Sprint 2: Bridgebuilder Findings Resolution

**Goal:** Address all 5 Bridgebuilder findings to elevate the codebase before merge.

**Global Sprint ID:** 342

### Tasks

#### Task 2.1: F-1 — Document Outbox Propagation Invariant Gap (MEDIUM)
**Files:** `packages/services/conservation-guard.ts`, `packages/services/governance-outbox-worker.ts`
**Description:** The window between governance lot entry commit and conservation guard Redis update is a known bound. Document this invariant gap explicitly, like Spanner documents clock uncertainty. Add a `governance_pending` Redis flag that the conservation guard checks, so the system is aware of in-flight governance propagation.

**Semantics of `governance_pending` flag:**
- **When pending=true**: `checkConservation()` includes `governancePending: true` in its result. The flag is **informational** — it signals that a limit change is in-flight. The conservation guard does NOT block debits (debits continue under the current Redis limit, which is still valid). The flag enables callers to make informed decisions (e.g., log warnings, defer optional limit-dependent operations).
- **Set timing**: The outbox worker sets `governance_pending:{community_id}` with TTL = `staleThresholdMinutes * 60` seconds BEFORE calling `updateLimit()`. This is outside the DB transaction (Redis write after claiming the outbox row).
- **Clear timing**: After successful `updateLimit()`, the worker DELetes the key. On failure, the key auto-expires via TTL.
- **Crash/retry safety**: If the worker crashes between set and updateLimit, the key expires via TTL (default 5min). The outbox row is not marked processed, so the next poll retries. Idempotent: setting the key again before retry is a no-op (same key, refreshed TTL).
- **Multi-worker concurrency**: Safe because outbox rows are claimed with `FOR UPDATE SKIP LOCKED` — only one worker processes a given community's policy at a time. The Redis key is per-community, not per-row.

**Acceptance Criteria:**
- AC-2.1.1: Conservation guard module header documents the outbox propagation invariant gap with reference to the Spanner external consistency parallel
- AC-2.1.2: Add `isGovernancePending(redis, communityId)` function to conservation-guard.ts that checks `governance_pending:{community_id}` Redis key; returns boolean
- AC-2.1.3: Governance outbox worker sets `governance_pending:{community_id}` Redis key (TTL = staleThresholdMinutes * 60s) before calling `updateLimit()`; DELetes key after successful `updateLimit()`
- AC-2.1.4: `checkConservation()` result extended with `governancePending: boolean` field
- AC-2.1.5: Outbox worker module header documents the "two generals problem" applied to economic governance
- AC-2.1.6: Unit test: pending flag set before updateLimit, cleared after; verify crash-recovery scenario (flag expires via TTL, outbox row retried on next poll)
**Estimated Effort:** Medium
**Dependencies:** None

#### Task 2.2: F-2 — Add replayGovernanceHistory() (LOW)
**File:** `packages/services/event-sourcing-service.ts`
**Description:** Add a governance-specific replay method that filters for governance entry types and returns a timeline of governance decisions rather than a balance reconstruction. This makes the dual nature of the ledger (economic events vs governance events) explicit.
**Acceptance Criteria:**
- AC-2.2.1: `replayGovernanceHistory(communityId, fromSequence?, limit?)` added to event sourcing service
- AC-2.2.2: Prerequisite check: confirm canonical governance entry_type values from the `replayStateWithClient` switch cases (currently `governance_debit` and `governance_credit`); update filter if entry types differ after rebase
- AC-2.2.3: Filters for `entry_type IN ('governance_debit', 'governance_credit')` entries (values confirmed from AC-2.2.2)
- AC-2.2.4: Returns `GovernanceReplayEvent[]` with fields: `id`, `communityId`, `entryType`, `amountMicro`, `sequenceNumber`, `correlationId`, `causationId`, `createdAt`
- AC-2.2.5: Exposed via factory `createEventSourcingService()` return object
- AC-2.2.6: Unit test with fixture lot_entries containing governance events — verifies replay returns expected governance timeline (not balance reconstruction)
- AC-2.2.7: Module header documents the distinction between economic replay (balance reconstruction) and governance replay (decision timeline), with Ethereum event log parallel
**Estimated Effort:** Small
**Dependencies:** None

#### Task 2.3: F-3 — Document BigInt Truncation Bias (LOW)
**File:** `packages/services/velocity-service.ts`
**Description:** BigInt division truncates toward zero, creating systematic velocity underestimation. Document the bias direction and add an optional `velocityCeiling` computation for alerting use cases that need conservative-safe estimates.
**Acceptance Criteria:**
- AC-2.3.1: Module header documents: "BigInt division truncates toward zero. Velocity is systematically underestimated; exhaustion time is systematically overestimated. This is conservative for budget protection but optimistic for alerting."
- AC-2.3.2: `computeSnapshot()` additionally computes `velocityCeilingMicroPerHour` = `velocityMicroPerHour + (totalSpend % effectiveWindow > 0n ? 1n : 0n)` — the truncation-corrected ceiling
- AC-2.3.3: `VelocitySnapshot` type extended with optional `velocityCeilingMicroPerHour: bigint`
- AC-2.3.4: Exhaustion prediction remains using floor (conservative for budget), but velocity alerts can use ceiling (conservative for alerting)
**Estimated Effort:** Small
**Dependencies:** None

#### Task 2.4: F-4 — Rate Limit Key Cardinality Metric (MEDIUM)
**File:** `packages/services/governance-auth.ts`
**Description:** Per-actor rate limit keys create Redis key cardinality proportional to `actors x roles x windows`. Document the expected cardinality and add a CloudWatch metric for operational awareness.
**Acceptance Criteria:**
- AC-2.4.1: Module header documents expected key cardinality: "Each active actor generates 2 Redis keys (daily + burst) with 24h/60s TTL respectively. For N actors per community: 2N keys. At ~100 bytes/key, 10k actors = ~2MB — negligible at current scale. Monitor governance_rate_limit_key_count for scaling trajectory."
- AC-2.4.2: `createGovernanceRateLimiter()` accepts a `MetricsPort` dependency; `checkRateLimit()` emits `governance_rate_limit_key_count` metric (count of keys checked per invocation — the total is observable via Redis INFO keyspace). Note: MetricsPort is already wired to CloudWatch via `emitEconomicMetric()` in the existing telemetry adapter (`packages/adapters/telemetry/economic-metrics.ts`) — no new infra required
- AC-2.4.3: Unit test: verify metric emission call with expected name and value when checkRateLimit is invoked
- AC-2.4.4: Document the Stripe hierarchical key structure parallel and the Count-Min Sketch probabilistic approach as future scaling option
**Estimated Effort:** Small
**Dependencies:** None

#### Task 2.5: F-5 — Document Circuit Breaker as Governance Resilience Pattern (PRAISE)
**File:** `packages/services/arrakis-conviction-bridge.ts`
**Description:** The circuit breaker is a governance resilience pattern, not just a reliability feature. When external consensus fails, the community falls back to internal governance (admin approval). Document this as a governance design principle, with Ostrom commons governance parallel.
**Acceptance Criteria:**
- AC-2.5.1: Module header extended with governance resilience documentation: the circuit breaker protects the community's ability to make decisions, not just the caller from a slow dependency
- AC-2.5.2: Document the failure mode distinction: microservice circuit breaker (response time SLA) vs governance circuit breaker (democratic process availability)
- AC-2.5.3: Document the fallback as a governance pattern: `{ score: null, fromFallback: true }` means "fall back to simpler but still legitimate governance" — matching Ostrom's fieldwork on commons governance systems with fallback mechanisms
- AC-2.5.4: Document the Conway Automaton contrast: ungoverned agents stop when infrastructure fails; governed agents fall back to a less-autonomous but still-operational mode
**Estimated Effort:** Small
**Dependencies:** None

#### Task 2.6: Final Commit, Test & Push
**Description:** Commit findings fixes, run full test suite, and push to update PR #90.
**Acceptance Criteria:**
- AC-2.6.1: All 5 findings addressed across one or more commits following conventional format (e.g., `fix(bridge-findings): F-1 governance_pending flag`, `docs(bridge-findings): F-5 circuit breaker governance resilience`). Squash-on-merge if clean single commit desired.
- AC-2.6.2: Full test suite passes locally (`pnpm test` or equivalent) — conservation invariants I-1..I-5 verified post-changes
- AC-2.6.3: Push succeeds
- AC-2.6.4: PR #90 remains MERGEABLE
- AC-2.6.5: GitHub CI checks pass (or only unrelated failures like Vercel)
**Estimated Effort:** Small
**Dependencies:** Tasks 2.1-2.5

### Sprint 2 Success Criteria
- All 5 Bridgebuilder findings addressed (2 MEDIUM functional, 2 LOW documentation+code, 1 PRAISE documentation)
- Conservation guard has governance_pending protection during outbox propagation
- Event sourcing supports governance-specific replay
- Velocity service documents and corrects truncation bias
- Rate limiter documents cardinality scaling trajectory
- Circuit breaker documented as governance resilience pattern
- PR #90 ready for human review and merge

---

## Risk Assessment

| Risk | Sprint | Mitigation |
|------|--------|------------|
| Rebase conflicts in heavily-modified files | 1 | Only 1 commit on main; conflicts likely minimal |
| F-1 Redis flag introduces new failure mode | 2 | TTL ensures flag auto-expires; worst case = brief debit pause |
| TypeScript compilation after rebase | 1 | Run tsc --noEmit immediately after rebase |

---

## Success Metrics

| Metric | Target | Source |
|--------|--------|--------|
| PR merge state | MERGEABLE | `gh pr view 90 --json mergeable` |
| Findings addressed | 5/5 | Bridgebuilder Deep Review |
| CI checks | Passing (excl. Vercel) | GitHub PR checks |
| Conservation invariants | Still hold | Existing test suite |

---

*Generated by Sprint Planning Agent — Cycle 038 Merge Readiness (Sprints 341-342)*

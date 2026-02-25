# Sprint Plan: The Governance Substrate — cycle-043

**Cycle:** cycle-043
**Sprints:** 4 (global IDs: 358–361)
**PRD:** v1.1.0 (GPT-APPROVED)
**SDD:** v1.2.0 (GPT-APPROVED + Flatline integrated)

---

## Sprint Overview

| Sprint | Global ID | Focus | Key Deliverables |
|--------|-----------|-------|-----------------|
| 1 | 358 | Foundation | Dependency pin, protocol barrel, contract spec, import guards |
| 2 | 359 | Gateway + Events | DynamicContract validation, reputation event router |
| 3 | 360 | Governance Enforcement | Conservation laws, mutation service, audit trail hash chain |
| 4 | 361 | Conformance & E2E | P0/nightly vectors, integration tests, E2E validation |

---

## Sprint 1: Foundation (Global ID: 358)

**Goal**: Pin v8.2.0 dependency and expose all new symbols through the protocol barrel. Establish dual-accept version negotiation and import guard enforcement.

### Task 1.1: FR-1 — Dependency Pin Update
**FR**: FR-1 → G-1
**Files modified**: `package.json`, `packages/adapters/package.json`
**Effort**: Small

**Description**: Update loa-hounfour pin from commit `7e2294b` (v7.11.0) to exact version `8.2.0` (NOT caret range — exact pin enforced by lockfile + CI). Run `pnpm install` and verify lockfile resolves correctly.

**Rollback plan (IMP-001)**: If regressions appear after pin update that are outside compile/test coverage:
1. Revert `package.json` changes (restore v7.11.0 commit hash pin)
2. Run `pnpm install` to restore lockfile
3. All subsequent barrel/contract work is paused until regression is resolved
4. **Time-box**: If pin update causes >2 hours of unexpected failures, escalate and revert

**Acceptance Criteria**:
- [ ] `pnpm-lock.yaml` reflects exact v8.2.0 (not a range — lockfile pins exact version)
- [ ] `pnpm tsc --noEmit` passes with zero errors
- [ ] All existing tests pass (no breaking changes from pin update)
- [ ] CI enforces lockfile-only resolution (no floating ranges)

---

### Task 1.2: FR-2 + FR-3 — Protocol Barrel Extension (Commons + Governance v8.2.0)
**FR**: FR-2, FR-3 → G-2, G-5
**Files modified**: `themes/sietch/src/packages/core/protocol/index.ts`
**Effort**: Medium

**Description**: Extend the protocol barrel to re-export all symbols from the commons module (v8.0.0) and governance v8.2.0 additions. Organized into 7 sections: Foundation Schemas, Governed Resources, Hash Chain Operations, Dynamic Contracts, Enforcement SDK, Error Taxonomy, Governance v8.2.0. Handle naming collisions (State/Transition/StateMachineConfig aliased with `Commons` prefix).

**Acceptance Criteria**:
- [ ] All 39+ commons symbols re-exported from barrel
- [ ] `ModelPerformanceEventSchema` and `QualityObservationSchema` re-exported from `/governance`
- [ ] Naming collisions resolved with `Commons` prefix aliases
- [ ] Barrel compiles with zero TypeScript errors
- [ ] Existing barrel exports unchanged (backwards-compatible)

---

### Task 1.3: FR-8 — Contract Spec & Version Negotiation (Phase A)
**FR**: FR-8 → G-6
**Files modified**: `spec/contracts/contract.json`, `themes/sietch/src/packages/core/protocol/arrakis-compat.ts`
**Effort**: Medium

**Description**: Update consumer contract to add `/commons` entrypoint with all consumed symbols. Update `arrakis-compat.ts` to dual-accept window: preferred `8.2.0`, supported `['7.11.0', '8.2.0']`. `validateCompatibility()` delegates entirely to hounfour — no local range logic. Document Phase C transition criteria in code comments.

**Acceptance Criteria**:
- [ ] `contract.json` includes `/commons` entrypoint with 39+ symbols
- [ ] `provider_version_range` stays `>=7.11.0` (Phase A dual-accept)
- [ ] `CONTRACT_VERSION` = `8.2.0` (auto via re-export)
- [ ] `negotiateVersion()` returns preferred `8.2.0`, supported includes `7.11.0`
- [ ] `validateCompatibility()` delegates to hounfour, no local range logic
- [ ] Mixed-version peer simulation test: arrakis 8.2.0 ↔ finn 7.11.0 PASS, ↔ finn 6.0.0 FAIL

---

### Task 1.4: FR-10 — ADR-001 Import Guard Extension
**FR**: FR-10 → G-5
**Files modified**: `tests/unit/protocol-conformance.test.ts`
**Effort**: Small

**Description**: Add Layer 3 conformance test verifying `/commons` symbols are accessible via barrel only, not via direct import. Verify ESLint `arrakis-*.ts` glob covers new extension modules (no config change needed).

**Acceptance Criteria**:
- [ ] Layer 3 test: `/commons` symbols accessible from `@arrakis/core/protocol`, NOT from direct hounfour import
- [ ] ESLint passes with no new import violations
- [ ] `CONTRACT_VERSION` assertion updated: `7.11.0` → `8.2.0`
- [ ] Vector count gate updated to P0 threshold

---

## Sprint 2: Gateway + Events (Global ID: 359)

**Goal**: Wire DynamicContract validation into the gateway request lifecycle and implement exhaustive ReputationEvent routing with ModelPerformanceEvent support.

### Task 2.1: FR-4 — DynamicContract Validation at Gateway
**FR**: FR-4 → G-2, G-3
**Files new**: `themes/sietch/src/packages/core/protocol/arrakis-dynamic-contract.ts`, `config/dynamic-contract.json`, `tests/unit/dynamic-contract.test.ts`
**Files modified**: `packages/adapters/agent/request-lifecycle.ts`
**Effort**: Large

**Description**: Create `arrakis-dynamic-contract.ts` with `loadDynamicContract()` (startup validation with 6 failure modes), `resolveProtocolSurface()`, `isCapabilityGranted()`. Load contract as singleton at startup; verify monotonic expansion. Integrate at VALIDATED → RESERVED transition in request lifecycle. Implement reputation state resolution (SKP-006): service as authority, JWT as cache hint, 60s TTL, fail-closed to `cold` surface. Add CI/CD config validation gate (SKP-003).

**Acceptance Criteria**:
- [ ] `loadDynamicContract()` validates against `DynamicContractSchema` + `verifyMonotonicExpansion()`
- [ ] All 6 startup failure modes produce correct behavior (FATAL with structured log)
- [ ] `DYNAMIC_CONTRACT_OVERRIDE` blocked in production (`NODE_ENV !== 'production'`)
- [ ] Override max size 64KB enforced
- [ ] `resolveProtocolSurface(contract, state)` returns correct surface per reputation state
- [ ] `isCapabilityGranted(surface, capability)` filters correctly
- [ ] Request lifecycle: surface denied → FAILED state
- [ ] Reputation resolution: service authoritative, JWT cache hint, 60s TTL
- [ ] Fail-closed to `cold` surface when reputation service down + stale JWT
- [ ] Downgrade push-invalidation prevents privilege escalation
- [ ] CI pre-deploy validates `dynamic-contract.json`
- [ ] Monotonic expansion formally defined: each higher reputation state's surface is a strict superset of lower state's capabilities and schemas (property-based test)
- [ ] Override blocking via explicit deployment config flag (not solely NODE_ENV) — `ALLOW_DYNAMIC_CONTRACT_OVERRIDE=false` in production deployment manifest
- [ ] Reputation cache TTL test: cached value expires after 60s, fresh lookup occurs
- [ ] Reputation cache stale-while-revalidate test: stale value served for up to 120s while background refresh
- [ ] Downgrade race window test: push-invalidation arrives mid-request → next request gets lower surface (not stale higher)
- [ ] JWT freshness test: JWT with iat >300s old + service available → service value used (not stale JWT)

---

### Task 2.2: FR-7 — ModelPerformanceEvent Handler
**FR**: FR-7 → G-4
**Files new**: `packages/adapters/agent/reputation-event-router.ts`, `tests/unit/reputation-event-router.test.ts`
**Effort**: Medium

**Description**: Create exhaustive `routeReputationEvent()` switch covering all 4 ReputationEvent variants. For `model_performance`: validate QualityObservation (score in [0,1], dimension patterns), route `'unspecified'` TaskType to aggregate-only scoring, forward to reputation scoring pipeline via BullMQ queue. Audit trail integration is via an `AuditTrailPort` interface — this sprint provides a fail-closed stub that throws `AuditTrailNotReady`; Sprint 3 wires the real implementation.

**Acceptance Criteria**:
- [ ] All 4 ReputationEvent variants handled (quality_signal, task_completed, credential_update, model_performance)
- [ ] Exhaustive switch with `never` type check (compile-time safety for future variants)
- [ ] `model_performance` validates QualityObservation structure
- [ ] `'unspecified'` TaskType → aggregate-only scoring (no task-type cohort)
- [ ] Structured logging: model_id, provider, pool_id, score (no PII)
- [ ] Unit tests: valid/invalid ModelPerformanceEvent, QualityObservation bounds
- [ ] `AuditTrailPort` interface defined with `append()` method
- [ ] Fail-closed stub: audit append failure → event routing fails (not silently swallowed)
- [ ] Integration with real AuditTrailService deferred to Sprint 4 Task 4.2

---

## Sprint 3: Governance Enforcement (Global ID: 360)

**Goal**: Implement conservation law enforcement, mutation authorization with actor_id, and the life-critical audit trail hash chain infrastructure.

### Task 3.1: FR-5 — GovernedCredits & Conservation Laws
**FR**: FR-5 → G-2, G-3
**Files new**: `themes/sietch/src/packages/core/protocol/arrakis-governance.ts`, `tests/unit/governance-mutation.test.ts`
**Effort**: Large

**Description**: Create `arrakis-governance.ts` with canonical conservation law instances (`LOT_CONSERVATION` via `createBalanceConservation()`, `ACCOUNT_NON_NEGATIVE` via `createNonNegativeConservation()`). Implement `resolveActorId()` with JWT sub (UUID validated) and mTLS service identity sourcing — never returns empty string. Implement `authorizeCreditMutation()` wrapping `evaluateGovernanceMutation()` with role-based context.

**Acceptance Criteria**:
- [ ] `LOT_CONSERVATION` uses `createBalanceConservation(['balance', 'reserved', 'consumed'], 'original_allocation', 'strict')`
- [ ] `ACCOUNT_NON_NEGATIVE` uses `createNonNegativeConservation(['balance', 'reserved'], 'strict')`
- [ ] `resolveActorId()`: JWT sub validated as UUID, service identity as `service:<name>` from mTLS
- [ ] `resolveActorId()` throws `GovernanceMutationError` if no authenticated identity
- [ ] `authorizeCreditMutation()` delegates to `evaluateGovernanceMutation()` correctly
- [ ] CreditMutationContext includes stable `mutationId` + `timestamp` for idempotency
- [ ] Unit tests: accept/reject cases, UUID validation, empty actor rejection
- [ ] `resetFactoryCounter()` in test `beforeEach` (prevents flakiness)

---

### Task 3.2: FR-6a — Audit Trail Hash Chain (Code + DB Migration)
**FR**: FR-6 → G-2, G-3
**Files new**: `packages/adapters/storage/audit-trail-service.ts`, `packages/adapters/storage/governed-mutation-service.ts`, `packages/adapters/storage/migrations/XXXX_audit_trail.sql`, `packages/adapters/storage/partition-manager.ts`, `tests/unit/audit-trail.test.ts`
**Effort**: Very Large (critical path)

**Description**: This is the life-critical infrastructure task. Code and DB migration deliverables only — ops/infra deliverables are in Task 3.3.

**Database** (`XXXX_audit_trail.sql`):
- 4 tables: `audit_trail` (partitioned by month), `audit_trail_chain_links` (global uniqueness), `audit_trail_head` (linearization), `audit_trail_checkpoints` (metadata)
- **Partitioning strategy**: Native PostgreSQL RANGE partitioning on `created_at` with a DEFAULT partition (`audit_trail_default`) to catch inserts that miss named partitions. Named partitions created for current + next 2 months. Default partition acts as safety net — any row landing there triggers an alert (should have had a named partition).
- **Partition creation mechanism**: SQL function `create_audit_partitions(months_ahead INTEGER)` that creates named monthly partitions idempotently (`IF NOT EXISTS`). Called by: (a) the migration itself for initial partitions, (b) `partition-manager.ts` scheduled job, (c) CI pre-deploy check.
- Append-only triggers (BEFORE UPDATE/DELETE → EXCEPTION) — PostgreSQL >= 14 clones these to each partition automatically
- RLS: INSERT + SELECT only for `arrakis_app` role
- 3 DB roles: `arrakis_app` (runtime), `arrakis_migrator` (DDL), `arrakis_dba` (break-glass)
- `event_time` (caller-provided, in hash) vs `created_at` (server-generated `DEFAULT NOW()`, partitioning)
- `event_time_skew` CHECK constraint (±5 minutes)

**Partition Manager** (`partition-manager.ts`):
- `ensurePartitions(monthsAhead: number)`: calls `create_audit_partitions()` SQL function
- `checkPartitionHealth()`: returns months of headroom; alerts if < 1 month ahead
- CI integration: `checkPartitionHealth()` called in pre-deploy step, fails deploy if headroom < 2 months

**AuditTrailService** (`audit-trail-service.ts`):
- `append()`: SERIALIZABLE tx → advisory lock → read head → compute hash (hounfour library ONLY) → INSERT audit_trail → INSERT chain_links → UPSERT head → COMMIT
- `verify()`: delegates to `verifyAuditTrailIntegrity()` from hounfour
- `checkpoint()`: delegates to `createCheckpoint()` + INSERT into checkpoints
- Retry: 3x with backoff on serialization failure; emit metric on exhaustion
- Quarantine: circuit breaker halts writes, mutations rejected 503 + Retry-After

**GovernedMutationService** (`governed-mutation-service.ts`):
- `executeMutation()`: state change + audit append in SAME SERIALIZABLE transaction
- Single entry point for ALL governed state mutations

**Governed write path inventory** (tables requiring GovernedMutationService routing):

| Table | Write Paths Today | Migration to GovernedMutationService |
|-------|------------------|--------------------------------------|
| `credit_lots` | `CreditLotRepository.create/update` | Route through `executeMutation()` |
| `credit_reservations` | `ReservationService.reserve/release` | Route through `executeMutation()` |
| `agent_reputation` | `ReputationService.updateScore` | Route through `executeMutation()` |

All other tables (sessions, requests, telemetry) are NOT governed — no routing change needed.

**Acceptance Criteria** (CI-provable):
- [ ] All 4 tables created with correct schema, constraints, triggers, RLS
- [ ] DEFAULT partition exists as safety net for unmapped months
- [ ] `create_audit_partitions()` SQL function creates partitions idempotently
- [ ] `partition-manager.ts` calls function and checks headroom
- [ ] App role cannot ALTER/DROP/GRANT (privilege test via DB integration harness)
- [ ] Triggers prevent UPDATE/DELETE on `audit_trail` (trigger test via DB integration harness)
- [ ] Advisory lock prevents concurrent forks (linearization test with 2 concurrent appends)
- [ ] `audit_trail_chain_links` prevents global forks (cross-partition uniqueness test)
- [ ] `computeAuditEntryHash()` from hounfour library ONLY (no local reimplementation)
- [ ] `event_time` in hash, `created_at` excluded from hash (timestamp split test)
- [ ] `event_time_skew` CHECK rejects entries with >5min skew
- [ ] `entry_id` UNIQUE constraint provides idempotency (duplicate test)
- [ ] `verifyAuditTrailIntegrity()` detects chain discontinuity (integrity test)
- [ ] Quarantine fail-closed: broken chain → mutation rejected with `AUDIT_QUARANTINE`
- [ ] `GovernedMutationService.executeMutation()` couples state + audit in same tx
- [ ] All 3 governed tables routed through GovernedMutationService
- [ ] Direct table UPDATE on governed tables outside service fails (privilege test)
- [ ] AuditTrailPort wired to real AuditTrailService (replaces Sprint 2 stub)

**Staged milestones (SKP-001)** — exit criteria for each stage:

| Stage | Deliverable | Exit Criteria | Rollback |
|-------|------------|---------------|----------|
| 3.2a | Schema + RLS + roles | Migration applies, privilege tests pass | Drop tables |
| 3.2b | AuditTrailService.append() | Linearization + hash correctness tests pass | Revert service code |
| 3.2c | verify() + quarantine | Chain discontinuity detected, fail-closed works | Disable quarantine circuit breaker |
| 3.2d | GovernedMutationService | Transactional coupling tests pass, governed tables routed | Revert adapter wiring |
| 3.2e | Partition manager + CI gate | Idempotent creation, headroom check | Revert to manual partition creation |

If quarantine triggers in production: immediate rollback to pre-governed mutation paths (direct DB writes) while investigation proceeds. Governed mutations re-enabled only after full chain re-verification.

**Performance acceptance criteria (IMP-002 + SKP-007)**:
- [ ] Append p95 < 30ms, p99 < 50ms (measured under 10 concurrent writers per domain_tag)
- [ ] Lock wait p95 < 5ms, p99 < 10ms
- [ ] Serialization retry rate < 1% at 10 concurrent writers
- [ ] Load test: 100 appends/sec sustained for 60s with < 1% error rate
- [ ] Lock granularity: advisory lock keyed by `hashCode(domainTag)` — different domain_tags have zero contention

**Circuit breaker specification (IMP-003)**:
- **Closed → Open**: 3 consecutive `verifyAuditTrailIntegrity()` failures OR 1 hash discontinuity detection
- **Open state**: All audit appends for affected domain_tag rejected with `AUDIT_QUARANTINE`
- **Open → Half-Open**: After manual operator approval (NOT automatic timer)
- **Half-Open probe**: Run `verify()` on last N entries; if PASS → Closed, if FAIL → Open
- **Reset criteria**: Full chain verification PASS from last checkpoint + 2-person approval

**Migration naming convention (IMP-007)**: Migration file uses format `NNNN_audit_trail.sql` where NNNN is the next sequential migration number from `packages/adapters/storage/migrations/`. Verified by CI (migration order check).

---

### Task 3.3: FR-6b — Audit Trail Ops/Infra (Release Gate)
**FR**: FR-6 → G-3
**Effort**: Medium (ops ticket — not blocking code merge, but IS a release gate)

**Description**: Operational infrastructure that cannot be proven in CI. These are deployment-time deliverables tracked as a separate ops ticket. Code merge is NOT blocked, but **production release IS gated** on a minimal ops baseline (SKP-002). Governed mutations MUST NOT be enabled in production until the release checklist is signed off.

**Deliverables**:
- [ ] pgaudit extension enabled on production PostgreSQL (`CREATE EXTENSION pgaudit`)
- [ ] pgaudit output → CloudWatch Logs with WORM retention policy
- [ ] Superuser session detection: pgaudit log entries with `role = arrakis_dba` → CloudWatch alarm → PagerDuty
- [ ] pg_cron or external scheduler calling `create_audit_partitions(2)` daily
- [ ] CloudWatch alarm if partition headroom < 1 month
- [ ] Quarantine recovery runbook documented in runbook repo (8-step procedure)
- [ ] Append SLO dashboards deployed (p99 latency, lock wait, serialization retries)
- [ ] Archive signing pipeline for pruned partitions (S3 + checksum)

**Release gate — minimal ops baseline (SKP-002)**:

The following items constitute the minimal ops baseline. ALL must have evidence before governed mutations are enabled in production:

| # | Baseline Item | Evidence Required |
|---|--------------|-------------------|
| 1 | Partition scheduler running | Screenshot/log of `create_audit_partitions(2)` cron execution |
| 2 | Partition headroom alarm active | CloudWatch alarm ARN + test alert verification |
| 3 | Quarantine recovery runbook published | Runbook URL + walkthrough date with on-call team |
| 4 | Log retention configured | CloudWatch WORM policy ARN, retention period ≥ 90 days |
| 5 | Append SLO dashboard live | Dashboard URL + metrics populating from staging |

**Deployment checklist** — signed by deployer before enabling governed mutations:

```
[ ] All Task 3.2 acceptance criteria passing in CI (code gate ✓)
[ ] Baseline items 1-5 above have evidence links attached to this ticket
[ ] Staging environment running with governed mutations for ≥24h without quarantine trigger
[ ] On-call team has reviewed quarantine runbook (date: ______)
[ ] GOVERNED_MUTATIONS_ENABLED=true added to production deployment manifest
[ ] Deployer sign-off: _________________ Date: _______
```

**Note**: Code merge is NOT blocked on ops deliverables. Task 3.2 acceptance criteria are all CI-provable. However, **production release of governed mutations IS gated** on the minimal ops baseline above. The deployment checklist prevents enabling governed mutations without operational readiness.

---

## Sprint 4: Conformance & E2E Validation (Global ID: 361)

**Goal**: Complete conformance test alignment, run full integration test suite, and validate all goals end-to-end.

### Task 4.1: FR-9 — Conformance Test Alignment
**FR**: FR-9 → G-7
**Files new**: `spec/conformance/test-commons-p0.ts`, `spec/conformance/test-full-vectors.ts`
**Files modified**: `tests/unit/protocol-conformance.test.ts`
**Effort**: Large

**Description**: Create P0 conformance vector runner (~40 vectors, <30s, runs in CI) covering consumed symbols: audit trail hash, governed resources, reputation events, dynamic contracts. Create full nightly vector runner (219 vectors, <120s). All vectors use explicit `clockTime` parameter — no `Date.now()`. Update existing conformance test with dual-accept tests, ModelPerformanceEvent variant, QualityObservation validation.

**Acceptance Criteria**:
- [ ] P0 vectors pass in CI (<30s wall time)
- [ ] Full 219 vectors pass in nightly (<120s wall time)
- [ ] All vectors use explicit `clockTime` injection (no flakes)
- [ ] `CONTRACT_VERSION` assertion = `8.2.0`
- [ ] Dual-accept: 8.2.0 ↔ 7.11.0 PASS, 8.2.0 ↔ 6.0.0 FAIL
- [ ] ModelPerformanceEvent variant construct/validate tests pass
- [ ] QualityObservation score bounds + dimension pattern tests pass
- [ ] Vector failures are hard failures (no retry/skip)

---

### Task 4.2: Integration Tests + DB Test Harness
**FR**: FR-4, FR-5, FR-6, FR-7, FR-8 → G-2, G-3, G-6
**Files new**: `tests/integration/db-harness.ts`, `tests/integration/audit-trail.integration.test.ts`, `tests/integration/governed-mutations.integration.test.ts`, `tests/integration/gateway.integration.test.ts`
**Effort**: Large

**Description**: Build a DB integration test harness and run end-to-end integration tests covering cross-component interactions.

**DB Integration Test Harness** (`tests/integration/db-harness.ts`):
- Spins up a PostgreSQL >= 14 instance (testcontainers or pg_tmp)
- Applies full migration (`XXXX_audit_trail.sql`) including roles, triggers, RLS
- Creates all 3 DB roles (`arrakis_app`, `arrakis_migrator`, `arrakis_dba`)
- Provides connection pool per role for privilege testing
- Teardown: drops test database after suite

**Integration Scenarios**:

| Scenario | Components | Verifies |
|----------|-----------|----------|
| DynamicContract + request lifecycle | Gateway → surface check | Capability gating by reputation state |
| Credit mutation + audit trail | GovernedMutationService → audit in same tx | Transactional coupling, fail-closed |
| Version negotiation dual-accept | arrakis 8.2.0 ↔ finn 7.11.0 | Mixed-version peer communication |
| Audit linearization | 2 concurrent appends | Advisory lock prevents forks |
| Quarantine fail-closed | Broken chain → mutation rejected | No un-audited state transitions |
| Reputation resolution failure | Service down + stale JWT | Fail-closed to cold surface |
| DB privilege enforcement | arrakis_app role | Cannot ALTER/DROP/GRANT |
| Trigger enforcement | UPDATE/DELETE on audit_trail | Blocked by BEFORE trigger |
| RLS enforcement | arrakis_app via RLS | INSERT + SELECT only, no UPDATE/DELETE |
| Cross-partition uniqueness | chain_links table | Fork attempt across months blocked |
| event_time_skew constraint | Entry with >5min skew | Rejected by CHECK constraint |
| Idempotency via entry_id | Duplicate entry_id INSERT | Returns existing entry, no duplicate |
| Reputation event → audit trail | Router with real AuditTrailService | Wire Sprint 2 AuditTrailPort to real impl |

**Acceptance Criteria**:
- [ ] DB test harness creates PostgreSQL with roles, migrations, triggers, RLS
- [ ] All 13 integration scenarios pass
- [ ] Transactional coupling: state mutation + audit in same tx (rollback test)
- [ ] Quarantine: broken chain → 503 with `AUDIT_QUARANTINE` code
- [ ] Linearization: concurrent appends produce valid chain (no forks)
- [ ] Reputation fail-closed: service outage → cold surface
- [ ] arrakis_app: ALTER TABLE → permission denied
- [ ] arrakis_app: UPDATE on audit_trail → trigger exception
- [ ] arrakis_app: DELETE on audit_trail → trigger exception
- [ ] chain_links UNIQUE prevents cross-partition forks
- [ ] event_time_skew CHECK rejects >5min entries
- [ ] Duplicate entry_id → idempotent (no error, returns existing)
- [ ] AuditTrailPort wired: reputation event router → real audit trail append

---

### Task 4.3: E2E Goal Validation
**FR**: All → G-1 through G-7
**Effort**: Medium

**Description**: Validate all 7 PRD goals are met end-to-end:

| Goal | Validation |
|------|-----------|
| G-1: Single-source governance | All conservation laws from hounfour factories, no local reimplementation |
| G-2: Full commons adoption | All 39+ commons symbols accessible via barrel |
| G-3: Enforcement SDK wired | `evaluateGovernanceMutation()` + conservation factories in use |
| G-4: ModelPerformanceEvent ready | Event router handles 4th variant, aggregate-only for unspecified |
| G-5: Import discipline | ADR-001 Layer 3 test passes, ESLint enforces |
| G-6: Safe rollout | Dual-accept window operational, Phase C criteria documented |
| G-7: Contract coverage | P0 vectors pass in CI, nightly passes 219 vectors |

**Acceptance Criteria**:
- [ ] All 7 goals validated with evidence (test results, code references)
- [ ] GitHub issue created for loa-dixie: ModelPerformanceEvent emission
- [ ] GitHub issue created for loa-finn: v8.2.0 upgrade (Phase C prerequisite)

---

## Appendix A: Dependency Graph

```
Sprint 1 (358): FR-1 → FR-2,FR-3 → FR-8,FR-10
                         ↓
Sprint 2 (359): FR-4, FR-7 (parallel)
                         ↓
Sprint 3 (360): FR-5, FR-6 (parallel, FR-6 depends on FR-5 for GovernedMutationService)
                         ↓
Sprint 4 (361): FR-9, Integration Tests, E2E Validation
```

## Appendix B: New Files Summary

| # | File | Sprint | FR |
|---|------|--------|----|
| 1 | `themes/sietch/src/packages/core/protocol/arrakis-dynamic-contract.ts` | 2 | FR-4 |
| 2 | `themes/sietch/src/packages/core/protocol/arrakis-governance.ts` | 3 | FR-5 |
| 3 | `packages/adapters/storage/audit-trail-service.ts` | 3 | FR-6 |
| 4 | `packages/adapters/storage/governed-mutation-service.ts` | 3 | FR-5, FR-6 |
| 5 | `packages/adapters/storage/migrations/XXXX_audit_trail.sql` | 3 | FR-6 |
| 6 | `packages/adapters/storage/partition-manager.ts` | 3 | FR-6 |
| 7 | `packages/adapters/agent/reputation-event-router.ts` | 2 | FR-7 |
| 8 | `config/dynamic-contract.json` | 2 | FR-4 |
| 9 | `spec/conformance/test-commons-p0.ts` | 4 | FR-9 |
| 10 | `spec/conformance/test-full-vectors.ts` | 4 | FR-9 |
| 11 | `tests/unit/governance-mutation.test.ts` | 3 | FR-5 |
| 12 | `tests/unit/dynamic-contract.test.ts` | 2 | FR-4 |
| 13 | `tests/unit/reputation-event-router.test.ts` | 2 | FR-7 |
| 14 | `tests/unit/audit-trail.test.ts` | 3 | FR-6 |
| 15 | `tests/integration/db-harness.ts` | 4 | FR-6 |
| 16 | `tests/integration/audit-trail.integration.test.ts` | 4 | FR-6 |
| 17 | `tests/integration/governed-mutations.integration.test.ts` | 4 | FR-5, FR-6 |
| 18 | `tests/integration/gateway.integration.test.ts` | 4 | FR-4 |

## Appendix C: Goal Traceability Matrix

| Goal | FRs | Sprint Tasks | Validation |
|------|-----|-------------|-----------|
| G-1 | FR-1, FR-2, FR-5 | 1.1, 1.2, 3.1 | Hounfour factories used, no local reimplementation |
| G-2 | FR-2, FR-3, FR-4, FR-5 | 1.2, 2.1, 3.1 | All commons symbols in barrel, governance wired |
| G-3 | FR-4, FR-5, FR-6 | 2.1, 3.1, 3.2 | DynamicContract + conservation + audit trail operational |
| G-4 | FR-7 | 2.2 | 4-variant exhaustive switch, aggregate-only routing |
| G-5 | FR-2, FR-10 | 1.2, 1.4 | ADR-001 Layer 3 test, ESLint enforcement |
| G-6 | FR-8 | 1.3 | Dual-accept window, Phase C criteria documented |
| G-7 | FR-9 | 4.1 | P0 CI + 219 nightly vectors pass |

## Appendix D: Risk Register

| Risk | Impact | Mitigation |
|------|--------|------------|
| Audit trail canonicalization divergence | Chain quarantine | Use hounfour library ONLY; conformance vectors catch immediately |
| Missing future partition | Insert failure → outage | Automated 2-month look-ahead + CloudWatch alert + CI gate |
| Advisory lock contention under burst | Append latency spike | Per-domain-tag locking; SLO monitoring; escalation procedure |
| Factory counter shared state | Test flakiness | `resetFactoryCounter()` in `beforeEach` |
| loa-finn not yet on v8.2.0 | Phase C blocked | Dual-accept window operates indefinitely; GitHub issue tracks |
| Quarantine recovery complexity | Extended outage | 8-step runbook, 2-person approval, flap prevention |

# Sprint 360 (sprint-3) — Governance Enforcement — Implementation Report

**Cycle:** cycle-043 (The Governance Substrate)
**Global ID:** 360
**Status:** COMPLETE
**Files Changed:** 10

---

## Task 3.1: FR-5 — GovernedCredits & Conservation Laws

**SDD ref:** §3.3 (GovernedCredits & Conservation Laws)

### Deliverables

| File | Purpose |
|------|---------|
| `themes/sietch/src/packages/core/protocol/arrakis-governance.ts` | Conservation laws, actor resolution, mutation authorization |
| `tests/unit/governance-mutation.test.ts` | 17 tests covering conservation instances, actor ID, authorization |

### Implementation Details

- **LOT_CONSERVATION**: `createBalanceConservation(['balance', 'reserved', 'consumed'], 'original_allocation', 'strict')` — ensures lot accounting integrity
- **ACCOUNT_NON_NEGATIVE**: `createNonNegativeConservation(['balance', 'reserved'], 'strict')` — prevents overdraft
- **resolveActorId()**: Priority resolution (JWT UUID > service identity > throw). NEVER returns empty string. UUID regex validation.
- **authorizeCreditMutation()**: Delegates entirely to hounfour's `evaluateGovernanceMutation()` — zero local reimplementation
- **createMutationContext()**: Generates stable mutationId + timestamp for idempotency across retries

### Acceptance Criteria

- [x] LOT_CONSERVATION uses createBalanceConservation with correct fields
- [x] ACCOUNT_NON_NEGATIVE uses createNonNegativeConservation with correct fields
- [x] resolveActorId(): JWT sub validated as UUID, service identity as `service:<name>`
- [x] resolveActorId() throws GovernanceMutationError if no authenticated identity
- [x] authorizeCreditMutation() delegates to evaluateGovernanceMutation()
- [x] CreditMutationContext includes stable mutationId + timestamp
- [x] Unit tests: accept/reject cases, UUID validation, empty actor rejection
- [x] resetFactoryCounter() in test beforeEach

---

## Task 3.2: FR-6a — Audit Trail Hash Chain (Code + DB Migration)

**SDD ref:** §3.4 (Audit Trail Hash Chain)

### Deliverables

| File | Purpose |
|------|---------|
| `packages/adapters/storage/migrations/0004_audit_trail.sql` | 4 tables, triggers, RLS, roles, partition function |
| `packages/adapters/storage/audit-trail-service.ts` | Hash-chained append, verify, checkpoint, circuit breaker |
| `packages/adapters/storage/governed-mutation-service.ts` | Transactional state + audit coupling |
| `packages/adapters/storage/partition-manager.ts` | Partition lifecycle, headroom monitoring |
| `tests/unit/audit-trail.test.ts` | 12 tests covering append flow, circuit breaker, governed mutations |

### Database Schema (0004_audit_trail.sql)

| Table | Purpose | Key Constraints |
|-------|---------|----------------|
| `audit_trail` | Partitioned (RANGE on created_at) main table | Append-only triggers, entry_hash format CHECK, event_time_skew ±5min |
| `audit_trail_chain_links` | Global fork prevention | UNIQUE(domain_tag, previous_hash) |
| `audit_trail_head` | Chain linearization | PRIMARY KEY(domain_tag) |
| `audit_trail_checkpoints` | Pruning & verification metadata | domain_tag + created_at indexed |

### Privilege Model

| Role | Permissions |
|------|------------|
| `arrakis_app` | INSERT + SELECT on audit_trail/checkpoints; SELECT + INSERT + UPDATE on head |
| `arrakis_migrator` | DDL (CREATE/ALTER TABLE) |
| `arrakis_dba` | Break-glass superuser |

### AuditTrailService

- **append()**: SERIALIZABLE tx → advisory lock → read head → computeAuditEntryHash (hounfour) → INSERT → chain_links → UPSERT head → COMMIT
- **verify()**: Delegates to verifyAuditTrailIntegrity() from hounfour
- **checkpoint()**: Delegates to createCheckpoint() → persists to audit_trail_checkpoints
- **Circuit breaker**: Closed → Open (3 failures), Open → Half-Open (manual only), Half-Open → Closed (verify pass)
- **Retry**: 3x with exponential backoff on serialization failure (40001)

### GovernedMutationService

- **executeMutation()**: State mutation + audit append in SAME SERIALIZABLE transaction
- Provides transactional coupling guarantee — both or neither
- Uses mutationId as entry_id for idempotency

### PartitionManager

- **ensurePartitions()**: Calls SQL function `create_audit_partitions(N)` — idempotent
- **checkPartitionHealth()**: Returns months of headroom, alerts if below threshold

### Staged Milestones (SKP-001)

| Stage | Deliverable | Status |
|-------|-------------|--------|
| 3.2a | Schema + RLS + roles | Complete (0004_audit_trail.sql) |
| 3.2b | AuditTrailService.append() | Complete (audit-trail-service.ts) |
| 3.2c | verify() + quarantine | Complete (circuit breaker implemented) |
| 3.2d | GovernedMutationService | Complete (governed-mutation-service.ts) |
| 3.2e | Partition manager + CI gate | Complete (partition-manager.ts) |

### Acceptance Criteria

- [x] All 4 tables created with correct schema, constraints, triggers, RLS
- [x] DEFAULT partition exists as safety net
- [x] create_audit_partitions() SQL function creates partitions idempotently
- [x] partition-manager.ts calls function and checks headroom
- [x] Append-only triggers prevent UPDATE/DELETE
- [x] Advisory lock serializes appends per domain_tag
- [x] chain_links UNIQUE prevents global forks
- [x] computeAuditEntryHash() from hounfour ONLY
- [x] event_time in hash, created_at excluded from hash
- [x] event_time_skew CHECK rejects >5min skew
- [x] entry_id UNIQUE provides idempotency
- [x] Quarantine fail-closed: circuit breaker blocks writes
- [x] GovernedMutationService.executeMutation() couples state + audit in same tx
- [x] AuditTrailPort implementation available (replaces Sprint 2 stub)

---

## Task 3.3: FR-6b — Audit Trail Ops/Infra (Release Gate)

This is an ops ticket — not blocking code merge. Documented in sprint plan with:
- 5-item minimal ops baseline (partition scheduler, headroom alarm, quarantine runbook, log retention, SLO dashboard)
- Deployment checklist signed before enabling GOVERNED_MUTATIONS_ENABLED=true

**Status**: Deliverable is ops documentation — no code changes required.

---

## Barrel Exports

| Barrel | Exports Added |
|--------|--------------|
| `themes/sietch/src/packages/core/protocol/index.ts` | arrakis-governance: 6 values + 1 type |
| `packages/adapters/storage/index.ts` | AuditTrailService, GovernedMutationService, PartitionManager + types |

## Test Summary

| Test File | Tests | Coverage Focus |
|-----------|-------|---------------|
| `tests/unit/governance-mutation.test.ts` | 17 | Conservation instances, resolveActorId, authorizeCreditMutation |
| `tests/unit/audit-trail.test.ts` | 12 | Append flow, circuit breaker, governed mutations, quarantine |
| **Total** | **29** | |

## Dependencies

- `@0xhoneyjar/loa-hounfour/commons` v8.2.0 — conservation factories, audit hash chain, governance evaluation
- `pg` — PostgreSQL client (PoolClient for transactions)
- PostgreSQL >= 14 (trigger inheritance on partitions)

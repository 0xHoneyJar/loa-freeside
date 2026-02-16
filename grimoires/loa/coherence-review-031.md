# Cross-Sprint Coherence Review: Cycle 031

**Cycle**: The Spacing Guild — Agent Economic Sovereignty & Peer Commerce
**Sprints reviewed**: 285-291 (migrations 056-060, 5 service files, 3 route files, 2 type files)
**Reviewer**: Task 8.6 (Sprint 291)
**Date**: 2026-02-16

---

## 1. Naming Conventions

### Tables

All new tables follow snake_case plural noun convention:

| Table | Convention | Status |
|-------|-----------|--------|
| `transfers` | snake_case plural | PASS |
| `tba_deposits` | snake_case plural | PASS |
| `agent_governance_proposals` | snake_case plural | PASS |
| `agent_governance_votes` | snake_case plural | PASS |
| `agent_governance_delegations` | snake_case plural | PASS |

### Columns

All columns follow snake_case. Monetary columns consistently use `_micro` suffix. Timestamp columns consistently use `_at` suffix.

| Pattern | Examples | Status |
|---------|----------|--------|
| `_micro` monetary | `amount_micro`, `original_micro`, `available_micro`, `current_spend_micro` | PASS |
| `_at` timestamps | `created_at`, `completed_at`, `bridged_at`, `cooldown_ends_at`, `expires_at`, `revoked_at` | PASS |
| FK references | `from_account_id`, `to_account_id`, `agent_account_id`, `proposer_account_id`, `voter_account_id` | PASS |

### TypeScript Types

- `SourceType` union in `billing-types.ts` includes `'transfer_in'` and `'tba_deposit'` — matches values written to `credit_lots.source_type`.
- `EntryType` union in `billing-types.ts` includes `'transfer_out'` — matches the credit_ledger CHECK constraint from migration 056.
- `EconomicEventType` in `economic-events.ts` lists all 11 new cycle-031 event types, grouped by domain with inline comments.

### Timestamp Format Inconsistency (Minor)

Migration 056 (`transfers` table, `credit_ledger` rebuild) uses `datetime('now')` for DEFAULT timestamps. Migrations 058, and all post-050 migrations use `strftime('%Y-%m-%dT%H:%M:%fZ', 'now')` (ISO-8601 with milliseconds). Migration 057 (`tba_deposits`) also uses `datetime('now')`.

- **Impact**: `datetime('now')` produces `YYYY-MM-DD HH:MM:SS` (no timezone, no milliseconds). `strftime('%Y-%m-%dT%H:%M:%fZ', 'now')` produces `YYYY-MM-DDTHH:MM:SS.sssZ` (ISO-8601 with millis and UTC marker).
- **Risk**: Low. Application code uses `sqliteTimestamp()` for all writes, so the DEFAULT is only hit on raw INSERTs without an explicit timestamp. But the inconsistency is worth noting for future migrations.
- **Affected**: Migrations 056 and 057 (`transfers`, `credit_ledger`, `tba_deposits`).

---

## 2. Event Type Consistency

### Peer Transfer Events

| Event Type | Emitter | Usage | Status |
|------------|---------|-------|--------|
| `PeerTransferInitiated` | PeerTransferService | After validation, before lot selection | PASS |
| `PeerTransferCompleted` | PeerTransferService | After lot-split and status update | PASS |
| `PeerTransferRejected` | PeerTransferService | On all rejection paths (pre-tx and in-tx) | PASS |

All three are in the `ECONOMIC_EVENT_TYPES` array. The event names follow `{Domain}{Action}{State}` pattern consistently. Event payloads all include `transferId`, `fromAccountId`, `toAccountId`, `amountMicro`, `timestamp`.

### TBA Deposit Events

| Event Type | Emitter | Usage | Status |
|------------|---------|-------|--------|
| `TbaBound` | AgentProvenanceVerifier | On TBA binding | PASS |
| `TbaDepositDetected` | (declared, not emitted) | Not emitted by TbaDepositBridge | NOTE |
| `TbaDepositBridged` | TbaDepositBridge | On successful bridge | PASS |
| `TbaDepositFailed` | TbaDepositBridge | On verification failure | PASS |

`TbaDepositDetected` is declared in `economic-events.ts` but never emitted by TbaDepositBridge. The bridge goes directly from validation to `TbaDepositBridged` or `TbaDepositFailed`. This is intentional (the detection step is internal), but the unused event type is dead code in the type vocabulary.

### Agent Governance Events

| Event Type | Emitter | Usage | Status |
|------------|---------|-------|--------|
| `AgentProposalSubmitted` | AgentGovernanceService | On proposal creation | PASS |
| `AgentProposalQuorumReached` | AgentGovernanceService | When quorum threshold met | PASS |
| `AgentProposalActivated` | AgentGovernanceService | After cooldown expires | PASS |
| `AgentProposalRejected` | (declared, not emitted) | Not emitted by any service | NOTE |

`AgentProposalRejected` is declared but never emitted. There is no explicit rejection flow — proposals either expire or get admin-overridden (neither emits this event). This is dead code in the type vocabulary.

---

## 3. API Route Patterns

### Mount Points

| Route | Mount | Convention | Status |
|-------|-------|-----------|--------|
| Transfers | `/api/transfers` | Plural noun, top-level resource | PASS |
| TBA Binding/Bridge | `/api/agent/tba` | Nested under agent namespace | PASS |
| Agent Governance | `/api/agent/governance` | Nested under agent namespace | PASS |

The transfer routes are mounted at top level (`/transfers`) while TBA and governance routes are nested under `/agent/`. This is consistent with the domain model: transfers are a general feature, while TBA and governance are agent-specific.

### HTTP Method/Status Conventions

| Operation | Method | Success | Error Codes | Status |
|-----------|--------|---------|-------------|--------|
| Create transfer | POST | 200 | 400, 402, 403, 409 | PASS |
| Get transfer | GET | 200 | 404 | PASS |
| List transfers | GET | 200 | 400 | PASS |
| Bind TBA | POST | 200 | 400, 404, 409 | PASS |
| Bridge deposit | POST | 200 | 400, 503 | PASS |
| List deposits | GET | 200 | 400, 403 | PASS |
| Submit proposal | POST | 201 | 400, 403, 409 | PASS |
| Cast vote | POST | 200 | 400, 403, 404, 409 | PASS |
| List proposals | GET | 200 | 400 | PASS |
| Get weight | GET | 200 | 400 | PASS |

Note: Proposal creation returns 201 (Created) while transfer creation returns 200. The 201 is arguably more correct for a new resource creation. The transfer route returns 200 because the same endpoint handles idempotent replays. Both choices are defensible.

### Service Injection Pattern

All three route files use the same pattern: module-level `let service: T | null = null`, exported `setService()` setter, private `getService()` getter that throws 503 if not initialized. Consistent.

---

## 4. Error Handling Patterns

### Error Code Convention

All services use `Object.assign(new Error(msg), { code: '...' })` for typed errors. The code vocabulary is consistent:

| Error Code | HTTP | Used By |
|------------|------|---------|
| `VALIDATION_ERROR` | 400 | TbaDepositBridge, AgentGovernanceService, routes |
| `NOT_FOUND` | 404 | AgentProvenanceVerifier, AgentGovernanceService |
| `CONFLICT` | 409 | AgentGovernanceService (duplicate proposal, duplicate vote) |
| `FORBIDDEN` | 403 | AgentGovernanceService (non-agent proposer/voter) |

Routes consistently map these codes to HTTP status codes. The pattern is uniform across all three route files.

### Event Emission Failure Handling

All services treat event emission failure as non-fatal:
- PeerTransferService: try/catch with `logger.warn`, no rethrow
- TbaDepositBridge: try/catch with `logger.warn`, no rethrow
- AgentGovernanceService: try/catch with `logger.warn`, no rethrow
- ReconciliationService: try/catch (silent), no rethrow

Consistent. Transfer integrity and governance state are prioritized over observability.

### SQLite BUSY Retry

Only PeerTransferService implements explicit BUSY retry (3-attempt backoff: 10ms, 50ms, 200ms). TbaDepositBridge relies on `db.transaction()` built-in behavior. AgentGovernanceService also relies on built-in behavior. This is acceptable: PeerTransferService has the highest contention risk (concurrent lot-split), while TBA bridging is typically single-threaded (chain watcher) and governance is low-throughput.

---

## 5. Inconsistencies Found

### CRITICAL: ReconciliationService Check 5 queries wrong table name

**File**: `themes/sietch/src/packages/adapters/billing/ReconciliationService.ts`, line 311
**Issue**: Check 5 (transfer conservation) queries `FROM ledger_entries` but the actual table is named `credit_ledger`.

```sql
-- Line 311 (WRONG):
FROM ledger_entries
WHERE entry_type IN ('transfer_out', 'transfer_in')

-- Should be:
FROM credit_ledger
WHERE entry_type IN ('transfer_out', 'transfer_in')
```

**Impact**: The query will throw a "no such table" error, which is caught by the try/catch and silently passes the check (`{ skipped: true }`). This means transfer conservation is never actually verified. The reconciliation run will always report this check as "passed" when it should be executing the validation.

**Fix**: Change `ledger_entries` to `credit_ledger` on line 311.

### CRITICAL: tba_deposits CHECK constraint conflicts with application code

**File**: Migration `057_tba_deposits.ts`, line 32
**Issue**: The schema defines `amount_micro INTEGER NOT NULL CHECK (amount_micro > 0)`, but the TbaDepositBridge inserts `amount_micro = 0` for both `detected` and `failed` status deposits (lines 124 and 518 of TbaDepositBridge.ts).

```sql
-- Schema constraint:
amount_micro INTEGER NOT NULL CHECK (amount_micro > 0)

-- Application inserts (TbaDepositBridge.ts lines 124, 518):
VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, 0, 'detected', ?)
VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, 0, 'failed', ?, ?)
```

**Impact**: Every initial deposit detection and failed deposit insert will be rejected by SQLite with a CHECK constraint violation. This means the entire TBA deposit bridge flow is broken at the database layer.

**Fix**: Change the CHECK constraint to `CHECK (amount_micro >= 0)` since the amount is only known after on-chain verification (the bridge updates it to the real value when transitioning to 'bridged' status).

### MODERATE: PeerTransferService recipient entry uses 'deposit' instead of 'transfer_in'

**File**: `PeerTransferService.ts`, line 343
**Issue**: The recipient's ledger entry uses `entry_type = 'deposit'` rather than a transfer-specific entry type. The `EntryType` union includes `'transfer_out'` but the code uses generic `'deposit'` for the incoming side.

```typescript
// Line 343:
VALUES (?, ?, ?, ?, ?, 'deposit', ?, ?, ?, ?, ?, ?)
```

Meanwhile, ReconciliationService Check 5 expects `entry_type = 'transfer_in'` entries in the ledger (line 310). These will never exist because PeerTransferService writes `'deposit'`.

**Impact**: Reconciliation Check 5's lot-entry cross-check (`transfer_in` lots vs `transfer_in` entries) will always show 0 for entry total, causing a false divergence. The `SourceType` includes `'transfer_in'` (lot level) but the `EntryType` union does not include `'transfer_in'`, and the credit_ledger CHECK constraint in migration 056 also omits it.

**Fix**: Either (a) add `'transfer_in'` to the `EntryType` union, the credit_ledger CHECK constraint, and change the recipient entry to use it, or (b) update ReconciliationService Check 5 to match on `entry_type = 'deposit'` and filter by source. Option (a) is cleaner for auditability.

### MINOR: Unused economic event types

**File**: `economic-events.ts`
- `TbaDepositDetected` — declared but never emitted by any service
- `AgentProposalRejected` — declared but never emitted by any service

**Impact**: No runtime impact. These are forward-declarations for potential future use. If they remain unused, they should be removed or documented as reserved.

### MINOR: Governance parameter dot-notation

All governance parameters use consistent dot-notation:

| Prefix | Keys | Status |
|--------|------|--------|
| `transfer.` | `max_single_micro`, `daily_limit_micro` | PASS |
| `governance.` | `agent_quorum_weight`, `agent_cooldown_seconds`, `max_delegation_per_creator`, `agent_weight_source`, `fixed_weight_per_agent`, `reputation_window_seconds`, `reputation_scale_factor`, `max_weight_per_agent` | PASS |

All 10 parameters seeded in migration 060 match the keys used in `CONFIG_FALLBACKS` and referenced by `PeerTransferService.checkGovernanceLimits()` and `AgentGovernanceService.resolveNumericParam()`. No mismatches.

---

## 6. Overall Assessment

The cycle-031 implementation is well-structured across its 7 sprints. Naming conventions, error handling patterns, event type vocabulary, API route structure, and service injection patterns are consistent. The codebase shows disciplined adherence to the existing conventions from earlier cycles.

**Two critical bugs must be fixed before merge:**

1. **ReconciliationService Check 5 queries `ledger_entries` instead of `credit_ledger`** — Transfer conservation is silently skipped, not actually verified. This is a correctness bug in the reconciliation safety net.

2. **`tba_deposits.amount_micro CHECK (amount_micro > 0)` vs application inserting 0** — The entire TBA deposit bridge flow will fail at the database layer on every initial detection. This is a blocking runtime bug.

**One moderate design issue should be addressed:**

3. **Recipient ledger entries use generic `'deposit'` instead of `'transfer_in'`** — Creates a mismatch between lot-level `source_type = 'transfer_in'` and entry-level `entry_type = 'deposit'`, and breaks the reconciliation cross-check. This weakens the conservation audit trail.

Outside of these three items, the cross-sprint integration is coherent and the code is production-quality.

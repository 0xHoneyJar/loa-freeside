# Sprint 264 (sprint-8) Implementation Report

## Treasury & Payout Schema

**Cycle**: cycle-029 — Creator Economy
**Sprint**: sprint-8 (Global: 264)
**Status**: COMPLETE
**Branch**: feature/creator-economy-release

---

## Task Summary

| Task | Title | Status | Files |
|------|-------|--------|-------|
| 8.1 | Migration 045_payout_system | DONE | `src/db/migrations/045_payout_system.ts` |
| 8.2 | IPayoutProvider port | DONE | `src/packages/core/ports/IPayoutProvider.ts` |
| 8.3 | NOWPayments payout extension | DEFERRED | Requires live API — types and port ready |
| 8.4 | Payout state machine | DONE | `src/packages/adapters/billing/PayoutStateMachine.ts` |
| 8.5 | Webhook fixture validation | DONE | `tests/integration/billing-payout-schema.test.ts` |

## Implementation Details

### Task 8.1: Migration 045_payout_system

- `payout_requests` table: full lifecycle columns, status CHECK constraint, indexes
- `treasury_state` table: OCC version column, initialized with version 0
- `webhook_events` table: raw payload storage with UNIQUE(provider, id) for replay protection
- Treasury payout reserve account: `sys-treasury-payout` with `entity_id = 'treasury:payout_reserve'`
- Pool IDs: `withdrawal:pending` and `reserve:held` registered in billing_config
- Idempotent: running migration twice yields exactly one treasury account

### Task 8.2: IPayoutProvider Port

- `createPayout(request)` → `PayoutResult` with provider payout ID
- `getPayoutStatus(id)` → poll for reconciliation
- `getEstimate(amount, currency)` → `PayoutQuote` with fee and TTL
- Types: `PayoutRequest`, `PayoutResult`, `PayoutQuote`, `PayoutStatus`

### Task 8.3: NOWPayments Payout Extension

Deferred — requires live/sandbox API integration. The port interface (Task 8.2) and state machine (Task 8.4) provide the contract. Actual NOWPaymentsAdapter payout method extension will be done when API credentials are available.

### Task 8.4: Payout State Machine

Formal state transitions with SQL `WHERE status = ?` guards:

| From | To | Ledger Operation |
|------|-----|-----------------|
| pending | approved | `escrow` hold entry |
| approved | processing | Provider ID recorded |
| processing | completed | `escrow_release` (negative) + treasury version++ |
| processing | failed | `escrow_release` return |
| processing | quarantined | Unknown provider status stored |
| pending/approved | cancelled | Escrow return if approved |

- Each transition uses `UPDATE ... WHERE status = ?` for race protection
- Idempotent ledger ops with deterministic `escrow:{payoutId}` keys
- `INSERT OR IGNORE` prevents duplicate entries on retry

### Task 8.5: Webhook Event Storage

- `webhook_events` table with `UNIQUE(provider, id)` for DB-backed replay protection
- Quarantine flow: unknown provider status → `quarantined` state with error message
- Raw payload stored as JSON text for audit trail

## Bug Fix

- `entry_type` CHECK constraint on `credit_ledger` only allows `escrow` and `escrow_release` — used those instead of custom `escrow_hold`/`escrow_return` types

## Test Results

**26 tests**, all passing:

| Suite | Tests | Coverage |
|-------|-------|----------|
| Migration 045 | 6 | Tables, treasury init, account seed, pool IDs, OCC |
| IPayoutProvider Port | 3 | Interface compilation, type validation |
| Payout State Machine | 12 | All transitions, invalid rejections, escrow, idempotent |
| Webhook Storage | 3 | Payload store, replay protection, quarantine |
| E2E Payout | 2 | Complete lifecycle, failure with escrow return |

**Cumulative**: 194 passed (Sprint 8: 26 new)

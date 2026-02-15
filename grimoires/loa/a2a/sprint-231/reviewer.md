# Sprint 231 (Local Sprint-2) — Implementation Report

## Sprint: x402 Integration + Payment Wiring

**Branch**: `feature/billing-payments-release`
**Status**: COMPLETE
**Tests**: 15/15 passing (integration), 37/37 total with Sprint 1

---

## Tasks Completed

### Task 2.1: Migration 031 — Crypto Payments V2

**File**: `src/db/migrations/031_crypto_payments_v2.ts`

Extended the `crypto_payments` table for multi-provider support:
- Added `provider` column (default: 'nowpayments')
- Added `provider_payment_id` for provider-specific IDs
- Added `account_id`, `amount_usd_micro`, `lot_id` for credit ledger linkage
- Added `raw_payload` for full webhook/tx data
- `UNIQUE(provider, provider_payment_id)` constraint enables NOWPayments + x402 coexistence
- Table recreation pattern with `PRAGMA foreign_keys = OFF/ON` wrapping
- Triggers for `payment_id` sync on insert/update
- Full rollback SQL provided

### Task 2.2: IPaymentService Port + PaymentServiceAdapter

**Files**:
- `src/packages/core/ports/IPaymentService.ts`
- `src/packages/adapters/billing/PaymentServiceAdapter.ts`

**Port** defines the payment orchestration contract:
- `PaymentProvider`: 'nowpayments' | 'x402'
- `PaymentStatus` with full state machine (`ALLOWED_TRANSITIONS`, `TERMINAL_STATUSES`)
- `WebhookProcessResult`, `TopUpResult`, `RefundResult`, `X402Payment` types
- `IPaymentService` interface: processWebhook, createTopUp, getStatus, refund, isValidTransition

**Adapter** orchestrates both providers → credit ledger:
- `processWebhook()`: Validates signature, enforces state machine, creates lot on 'finished'
- `createTopUp()`: Verifies x402 on-chain, credits full verified amount
- `refund()`: LIFO clawback of available_micro, debt creation for consumed portion
- `getStatus()`: Payment status lookup by ID
- `isValidTransition()`: Idempotent same-status, forward-only transitions

### Task 2.3: X402PaymentAdapter

**File**: `src/packages/adapters/billing/X402PaymentAdapter.ts`

8-point on-chain USDC verification on Base chain using viem:
1. Chain ID validation (Base = 8453)
2. Transaction receipt retrieval
3. Transaction status check (reverted = reject)
4. Confirmation count validation (default: 12)
5. USDC contract address match
6. Recipient (facilitator) address match
7. Amount verification (6 decimals → micro-USD 1:1)
8. Transfer event log parsing for exact amount/sender/recipient

Replay detection via `crypto_payments` table lookup before RPC calls.

### Task 2.4: x402 Express Middleware

**File**: `src/api/middleware/x402-middleware.ts`

- `createX402Middleware()`: Required gate — returns 402 with facilitator details
- `createOptionalX402Middleware()`: Optional — passes through if no header
- Parses `X-402-Payment` header (JSON-encoded)
- Zod validation: txHash (0x + 64 hex), chainId, from (0x + 40 hex), amount

### Task 2.5: Billing Routes

**File**: `src/api/routes/billing-routes.ts`

- `POST /api/billing/topup` — fully implemented with:
  - Zod validation, auth middleware, rate limiting (10/min)
  - `Idempotency-Key` header support
  - BigInt-as-string serialization via `serializeBigInt()`
  - Error mapping: 402 (verification failed), 409 (duplicate), 500 (internal)
- Stub routes (501): GET /balance, GET /history, GET /pricing, POST /internal/finalize

### Task 2.6: CryptoWebhookService — Credit Ledger Hook

**File**: `src/services/billing/CryptoWebhookService.ts` (modified)

- Added `creditLedgerHook` property with `setCreditLedgerHook()` setter
- On 'finished' payment: calls hook to create credit lot + deposit entry
- Non-blocking: ledger failure doesn't block subscription activation (DLQ in Sprint 3)

### Task 2.7: loa-hounfour Upgrade (DEFERRED)

Depends on external PR #1 being merged. Will be addressed in a later sprint.

---

## Bugs Found & Fixed

### Bug 1: `updated_at` Column Missing from `credit_lots`

**Symptom**: `SqliteError: no such column: updated_at` in refund tests
**Root Cause**: `PaymentServiceAdapter.refund()` referenced `updated_at` in the UPDATE query, but `credit_lots` schema (migration 030) doesn't include that column.
**Fix**: Removed `updated_at` from the UPDATE query.

### Bug 2: `lot_invariant` CHECK Constraint Violation

**Symptom**: `SqliteError: CHECK constraint failed: lot_invariant` when setting `available_micro = 0`
**Root Cause**: The lot invariant `available + reserved + consumed = original` was violated by zeroing `available_micro` without adjusting `original_micro`.
**Fix**: Changed clawback query to atomically reduce both:
```sql
UPDATE credit_lots
SET original_micro = original_micro - available_micro,
    available_micro = 0
WHERE id = ?
```
This maintains the invariant: `0 + reserved + consumed = (original - available)`.

---

## Test Results

```
Tests:  37 passed, 0 failed
  - Conformance (Sprint 1):  20 passed
  - Performance (Sprint 1):   2 passed
  - Integration (Sprint 2):  15 passed

Test Breakdown (Sprint 2):
  migration-031-structure:     3 tests
  payment-state-machine:       4 tests
  nowpayments-to-ledger:       2 tests
  x402-topup-flow:             2 tests
  refund-clawback:             2 tests
  getStatus:                   2 tests
```

---

## Architecture Decisions

1. **Multi-provider UNIQUE constraint**: `UNIQUE(provider, provider_payment_id)` allows same payment ID across providers while preventing duplicates within a provider.

2. **Refund clawback adjusts original_micro**: Rather than adding a separate "clawed_back" column, the refund reduces `original_micro` to maintain the lot invariant. This means `original_micro` represents "effective original" post-refund.

3. **Non-blocking credit ledger hook**: Subscription activation should never fail due to ledger issues. Failed deposits will be retried via DLQ (Sprint 3).

4. **x402 credits full verified amount**: Over-payments credit the full on-chain amount, not just the requested amount. This is intentional — the user sent more USDC, so they get more credits.

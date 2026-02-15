# Sprint 255 Implementation Report: loa-hounfour BillingEntry Schema Mapping

**Sprint:** 4 (Global ID: 255)
**Cycle:** 028 — The Forward Path
**Goal:** G-4 — loa-hounfour protocol adoption at boundary
**Status:** COMPLETE

---

## Summary

Defined the loa-hounfour `BillingEntry` protocol type, created a mapper from internal `LedgerEntry` to protocol format, and wired it to the S2S finalize endpoint via an optional `?format=loh` query parameter. This enables progressive protocol adoption — consuming services can opt into the loa-hounfour format without requiring arrakis to change its internal representation.

## Changes

### Task 4.1: Define BillingEntry type — COMPLETE

**File:** `themes/sietch/src/packages/core/protocol/billing-entry.ts`

Created:
- `ProtocolEntryType` — Union of all 15 entry types recognized by loa-hounfour
- `BillingEntry` — Protocol type with: `entry_id`, `account_id`, `total_micro` (string), `entry_type`, `reference_id`, `created_at`, `metadata`, `contract_version`
- `BILLING_ENTRY_CONTRACT_VERSION` = `'4.6.0'`

**File:** `themes/sietch/src/packages/core/protocol/index.ts`

- Re-exported `BillingEntry`, `ProtocolEntryType`, and `BILLING_ENTRY_CONTRACT_VERSION`

### Task 4.2: Create mapper module — COMPLETE

**File:** `themes/sietch/src/packages/adapters/billing/billing-entry-mapper.ts`

Created:
- `toLohBillingEntry(entry: LedgerEntry): BillingEntry` — Maps a single entry
- `toLohBillingEntries(entries: LedgerEntry[]): BillingEntry[]` — Batch conversion

Mapping rules:
| Internal (LedgerEntry) | Protocol (BillingEntry) |
|------------------------|------------------------|
| `id` | `entry_id` |
| `accountId` | `account_id` |
| `amountMicro` (bigint) | `total_micro` (string) |
| `entryType` | `entry_type` |
| `lotId ?? reservationId` | `reference_id` |
| `createdAt` | `created_at` |
| `metadata` | `metadata` |
| constant `'4.6.0'` | `contract_version` |

### Task 4.3: Mapper unit tests — COMPLETE

**File:** `tests/unit/billing/billing-entry-mapper.test.ts`

17 tests covering:
1. Deposit entry mapping (all fields)
2. Reserve entry mapping
3. Finalize entry mapping
4. Release entry mapping
5. Refund entry mapping
6. Grant entry mapping (large amounts)
7. BigInt precision preservation ($1B in micro-USD)
8. `lotId` priority over `reservationId` for reference_id
9. Fallback to `reservationId` when `lotId` is null
10. Null reference_id when both are null
11. Null metadata handling
12. `contract_version` always present
13. Shadow_charge entry mapping
14. Commons_contribution entry mapping
15. Escrow entry mapping
16. Batch mapping preserving order
17. Empty array batch mapping

### Task 4.4: Wire mapper to S2S boundary — COMPLETE

**File:** `themes/sietch/src/api/routes/billing-routes.ts`

Changes:
- Added imports for `BILLING_ENTRY_CONTRACT_VERSION` and `BillingEntry` type
- Modified finalize endpoint response to check `req.query.format`:
  - No format / any other value: returns native response (unchanged behavior)
  - `format=loh`: returns native response + `billing_entry` field containing the loa-hounfour formatted entry
- Included inline ADR documenting the "protocol adoption at boundary, not rewrite" pattern

## Files Changed

| File | Change |
|------|--------|
| `src/packages/core/protocol/billing-entry.ts` | New: BillingEntry type definition |
| `src/packages/core/protocol/index.ts` | Re-export BillingEntry, ProtocolEntryType, version |
| `src/packages/adapters/billing/billing-entry-mapper.ts` | New: toLohBillingEntry mapper |
| `src/api/routes/billing-routes.ts` | Added format=loh support to finalize endpoint |
| `tests/unit/billing/billing-entry-mapper.test.ts` | New: 17 mapper tests |

## Acceptance Criteria Verification

| AC | Status | Evidence |
|----|--------|----------|
| BillingEntry type defined with all required fields | ✅ | 8 fields matching loa-hounfour schema |
| Mapper converts internal entries to BillingEntry format | ✅ | toLohBillingEntry function |
| All required fields populated | ✅ | 17 unit tests verify each field |
| BigInt precision preserved | ✅ | Test with $1B value |
| Nullable field handling | ✅ | Tests for null metadata and null reference_id |
| contract_version always present | ✅ | Dedicated test |
| 8+ unit tests | ✅ | 17 tests, all passing |
| S2S finalize returns loh format optionally | ✅ | `?format=loh` query parameter |

## Design Decisions

**`total_micro` as string, not number:** BigInt cannot be directly serialized to JSON. Using string representation preserves full precision for micro-USD values up to `Number.MAX_SAFE_INTEGER` (and beyond). Consuming services parse with `BigInt(total_micro)`.

**`reference_id` priority: `lotId ?? reservationId`:** The lot ID is more specific (identifies the credit lot being operated on), while reservation ID is a higher-level reference. Lot ID takes priority when both are present, which happens for reserve/finalize/release entries. Deposit and grant entries typically only have a lot ID.

**Protocol adoption at boundary, not rewrite:** The finalize endpoint returns the BillingEntry alongside the native format, not instead of it. This follows the Strangler Fig pattern — consuming services can progressively adopt the new format while the native format remains stable. No existing integrations break.

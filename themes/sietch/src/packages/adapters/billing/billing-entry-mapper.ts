/**
 * BillingEntry Mapper — Internal to Protocol Conversion
 *
 * Maps arrakis internal LedgerEntry to the loa-hounfour BillingEntry protocol type.
 * This is the "protocol adoption at boundary, not rewrite" pattern — internal code
 * continues to use LedgerEntry, and conversion happens only at the S2S boundary.
 *
 * Mapping rules:
 *   LedgerEntry.id          → BillingEntry.entry_id
 *   LedgerEntry.accountId   → BillingEntry.account_id
 *   LedgerEntry.amountMicro → BillingEntry.total_micro (bigint → string)
 *   LedgerEntry.entryType   → BillingEntry.entry_type (same values)
 *   LedgerEntry.lotId ?? LedgerEntry.reservationId → BillingEntry.reference_id
 *   LedgerEntry.createdAt   → BillingEntry.created_at
 *   LedgerEntry.metadata    → BillingEntry.metadata
 *   constant "4.6.0"        → BillingEntry.contract_version
 *
 * Sprint refs: Sprint 255 Task 4.2
 *
 * @module packages/adapters/billing/billing-entry-mapper
 */

import type { LedgerEntry, FinalizeResult } from '../../core/ports/ICreditLedgerService.js';
import type { BillingEntry, ProtocolEntryType } from '../../core/protocol/billing-entry.js';
import { BILLING_ENTRY_CONTRACT_VERSION } from '../../core/protocol/billing-entry.js';

/**
 * Convert an internal LedgerEntry to a loa-hounfour BillingEntry.
 *
 * @param entry - Internal ledger entry from arrakis billing engine
 * @returns BillingEntry suitable for cross-system wire format
 */
export function toLohBillingEntry(entry: LedgerEntry): BillingEntry {
  return {
    entry_id: entry.id,
    account_id: entry.accountId,
    total_micro: entry.amountMicro.toString(),
    entry_type: entry.entryType as ProtocolEntryType,
    reference_id: entry.lotId ?? entry.reservationId ?? null,
    created_at: entry.createdAt,
    metadata: entry.metadata,
    contract_version: BILLING_ENTRY_CONTRACT_VERSION,
  };
}

/**
 * Convert a FinalizeResult to a loa-hounfour BillingEntry.
 *
 * Used at the S2S finalize boundary when ?format=loh is requested.
 * This ensures the same mapping logic governs all BillingEntry serialization.
 *
 * @param result - Finalize result from the billing engine
 * @returns BillingEntry suitable for cross-system wire format
 */
export function fromFinalizeResult(result: FinalizeResult): BillingEntry {
  return {
    entry_id: `finalize:${result.reservationId}`,
    account_id: result.accountId,
    total_micro: result.actualCostMicro.toString(),
    entry_type: 'finalize',
    reference_id: result.reservationId,
    created_at: result.finalizedAt,
    metadata: null,
    contract_version: BILLING_ENTRY_CONTRACT_VERSION,
  };
}

/**
 * Convert multiple internal LedgerEntries to BillingEntry format.
 */
export function toLohBillingEntries(entries: LedgerEntry[]): BillingEntry[] {
  return entries.map(toLohBillingEntry);
}

/**
 * BillingEntry — loa-hounfour Protocol Type
 *
 * Defines the BillingEntry type matching the loa-hounfour billing protocol schema.
 * This is the wire format used for cross-system billing interoperability between
 * arrakis (billing engine) and other services.
 *
 * Arrakis internally uses LedgerEntry (from ICreditLedgerService). The mapper
 * in adapters/billing/billing-entry-mapper.ts converts between the two.
 *
 * Sprint refs: Sprint 255 Task 4.1
 *
 * @module packages/core/protocol/billing-entry
 */

// =============================================================================
// Protocol Entry Types
// =============================================================================

/**
 * loa-hounfour protocol entry types.
 * A subset of arrakis EntryType, normalized for cross-system use.
 */
export type ProtocolEntryType =
  | 'deposit'
  | 'reserve'
  | 'finalize'
  | 'release'
  | 'refund'
  | 'grant'
  | 'shadow_charge'
  | 'shadow_reserve'
  | 'shadow_finalize'
  | 'commons_contribution'
  | 'revenue_share'
  | 'marketplace_sale'
  | 'marketplace_purchase'
  | 'escrow'
  | 'escrow_release';

// =============================================================================
// BillingEntry
// =============================================================================

/**
 * loa-hounfour BillingEntry schema.
 *
 * This is the canonical billing entry format for cross-system interoperability.
 * All monetary values are in micro-USD (bigint serialized as string on the wire).
 */
export interface BillingEntry {
  /** Unique entry identifier (maps from LedgerEntry.id) */
  entry_id: string;
  /** Account identifier */
  account_id: string;
  /** Total amount in micro-USD (maps from LedgerEntry.amountMicro) */
  total_micro: string;
  /** Protocol entry type */
  entry_type: ProtocolEntryType;
  /** Reference to related entity: lot ID, reservation ID, or other reference */
  reference_id: string | null;
  /** ISO 8601 creation timestamp */
  created_at: string;
  /** Optional metadata (JSON string) */
  metadata: string | null;
  /** Protocol version for compatibility checking */
  contract_version: string;
}

/** Current contract version for BillingEntry schema */
export const BILLING_ENTRY_CONTRACT_VERSION = '4.6.0';

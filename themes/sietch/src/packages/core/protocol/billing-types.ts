/**
 * Vendored loa-hounfour Billing Types
 *
 * Shared type definitions for cross-system billing between arrakis and loa-finn.
 * These types represent the wire format and domain concepts shared by both systems.
 *
 * Vendored from: loa-hounfour (pinned commit — see VENDORED.md)
 *
 * @module packages/core/protocol/billing-types
 */

// =============================================================================
// Agent Billing Configuration
// =============================================================================

/**
 * Configuration for an agent's billing account.
 * Shared between arrakis (billing) and loa-finn (inference).
 */
export interface AgentBillingConfig {
  /** The finnNFT token ID */
  tokenId: string;
  /** Daily spending cap in micro-USD */
  dailyCapMicro: bigint;
  /** Auto-refill threshold in micro-USD */
  refillThresholdMicro: bigint;
  /** Owner address (NFT holder) */
  ownerAddress: string;
  /** NFT-based identity anchor hash for sybil resistance */
  identityAnchor?: string;
}

// =============================================================================
// Credit Balance
// =============================================================================

/**
 * Canonical credit balance representation shared across systems.
 * All monetary values are in micro-USD (1 USD = 1,000,000 micro-USD).
 */
export interface CreditBalance {
  /** Account identifier */
  accountId: string;
  /** Pool identifier (null = all pools) */
  poolId: string | null;
  /** Available credits in micro-USD */
  availableMicro: bigint;
  /** Reserved (held) credits in micro-USD */
  reservedMicro: bigint;
}

// =============================================================================
// Usage Record
// =============================================================================

/**
 * Record of a single inference usage event.
 * Created by loa-finn, sent to arrakis for finalization.
 */
export interface UsageRecord {
  /** Reservation ID from arrakis */
  reservationId: string;
  /** Actual cost in micro-USD */
  actualCostMicro: bigint;
  /** Identity anchor for the agent (optional) */
  identityAnchor?: string;
  /** Timestamp of inference completion */
  completedAt: string;
}

// =============================================================================
// Billing Mode
// =============================================================================

/** Billing enforcement mode */
export type BillingMode = 'shadow' | 'soft' | 'live';

// =============================================================================
// Entity & Entry Types (Canonical)
// =============================================================================

/** Entity types supported by the credit system */
export type EntityType = 'agent' | 'person' | 'community' | 'mod' | 'protocol' | 'foundation' | 'commons';

/** Credit lot source types */
export type SourceType = 'deposit' | 'grant' | 'purchase' | 'transfer_in' | 'commons_dividend';

/** Ledger entry types */
export type EntryType =
  | 'deposit' | 'reserve' | 'finalize' | 'release' | 'refund'
  | 'grant' | 'shadow_charge' | 'shadow_reserve' | 'shadow_finalize'
  | 'commons_contribution' | 'revenue_share'
  | 'marketplace_sale' | 'marketplace_purchase'
  | 'escrow' | 'escrow_release';

/**
 * Vendored loa-hounfour Billing Types
 *
 * Shared type definitions for cross-system billing between arrakis and loa-finn.
 * These types represent the wire format and domain concepts shared by both systems.
 *
 * Vendored from: loa-hounfour (pinned commit, see @0xhoneyjar/loa-hounfour v7.0.0)
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
// Entity & Entry Types (Single Source of Truth — const arrays)
// =============================================================================

/** Canonical entity type values — derive all types from this array */
export const ENTITY_TYPES = [
  'agent', 'person', 'community', 'mod', 'protocol', 'foundation', 'commons',
] as const;

/** Entity types supported by the credit system */
export type EntityType = (typeof ENTITY_TYPES)[number];

/** Canonical source type values — derive all types from this array */
export const SOURCE_TYPES = [
  'deposit', 'grant', 'purchase', 'transfer_in', 'commons_dividend', 'tba_deposit',
] as const;

/** Credit lot source types */
export type SourceType = (typeof SOURCE_TYPES)[number];

/** Canonical entry type values — derive all types and CHECK expressions from this */
export const ENTRY_TYPES = [
  'deposit', 'reserve', 'finalize', 'release', 'refund',
  'grant', 'shadow_charge', 'shadow_reserve', 'shadow_finalize',
  'commons_contribution', 'revenue_share',
  'marketplace_sale', 'marketplace_purchase',
  'escrow', 'escrow_release',
  'transfer_out', 'transfer_in',
] as const;

/** Ledger entry type — derived from ENTRY_TYPES array */
export type EntryType = (typeof ENTRY_TYPES)[number];

/** Protocol entry type — unified with EntryType (no separate subset) */
export type ProtocolEntryType = EntryType;

// Compile-time bidirectional equality check
type _AssertExact<A, B> = A extends B ? (B extends A ? true : never) : never;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _entryTypeCheck: _AssertExact<EntryType, ProtocolEntryType> = true;

/**
 * Generate a SQL CHECK expression for a column from the canonical ENTRY_TYPES array.
 * Used in migrations and validated against sqlite_master in tests.
 */
export function buildEntryTypeCheck(column = 'entry_type'): string {
  const values = ENTRY_TYPES.map(t => `'${t}'`).join(', ');
  return `${column} IN (${values})`;
}

/**
 * Generate a SQL CHECK expression for source_type from the canonical SOURCE_TYPES array.
 */
export function buildSourceTypeCheck(column = 'source_type'): string {
  const values = SOURCE_TYPES.map(t => `'${t}'`).join(', ');
  return `${column} IN (${values})`;
}

// =============================================================================
// Constitutional Governance Types (Cycle 030)
// =============================================================================

/** System config governance states (mirrors SYSTEM_CONFIG_MACHINE) */
export type SystemConfigStatus = 'draft' | 'pending_approval' | 'cooling_down' | 'active' | 'superseded' | 'rejected';

/** Resolution source for a parameter lookup */
export type ParamSource = 'entity_override' | 'global_config' | 'compile_fallback';

/**
 * A constitutional parameter stored in system_config.
 * Maps 1:1 to the system_config table schema (migration 050).
 */
export interface SystemConfig {
  id: string;
  paramKey: string;
  entityType: string | null;
  valueJson: string;
  configVersion: number;
  activeFrom: string | null;
  status: SystemConfigStatus;
  proposedBy: string;
  proposedAt: string;
  approvedBy: string | null;
  approvalCount: number;
  requiredApprovals: number;
  cooldownEndsAt: string | null;
  activatedAt: string | null;
  supersededAt: string | null;
  supersededBy: string | null;
  metadata: string | null;
  createdAt: string;
}

/**
 * Result of resolving a constitutional parameter through the three-tier chain:
 *   1. entity-specific override
 *   2. global default
 *   3. compile-time fallback
 */
export interface ResolvedParam<T> {
  /** The resolved value */
  value: T;
  /** config_version from system_config (0 for compile fallback) */
  configVersion: number;
  /** Where the value was resolved from */
  source: ParamSource;
  /** system_config.id (null for compile fallback) */
  configId: string | null;
}

/**
 * Options for proposing a constitutional parameter change.
 */
export interface ProposeOpts {
  /** Entity type for entity-specific override (null for global) */
  entityType?: string | null;
  /** Admin ID of the proposer */
  proposerAdminId: string;
  /** Justification for the change (stored in metadata) */
  justification?: string;
}

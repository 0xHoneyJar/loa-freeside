import type { Address } from 'viem';

/**
 * BGT eligibility entry representing a wallet's claim/burn status
 */
export interface EligibilityEntry {
  /** Wallet address */
  address: Address;
  /** Total BGT claimed from reward vaults (raw bigint) */
  bgtClaimed: bigint;
  /** Total BGT burned/redeemed (raw bigint) */
  bgtBurned: bigint;
  /** Net BGT held (claimed - burned, raw bigint) */
  bgtHeld: bigint;
  /** Rank in the eligibility list (1-69 for eligible, undefined for others) */
  rank?: number;
  /** Assigned role based on rank */
  role: 'naib' | 'fedaykin' | 'none';
}

/**
 * Serialized eligibility entry for API responses and database storage
 */
export interface SerializedEligibilityEntry {
  address: string;
  bgtClaimed: string;
  bgtBurned: string;
  bgtHeld: string;
  rank?: number;
  role: 'naib' | 'fedaykin' | 'none';
}

/**
 * Diff result comparing previous and current eligibility snapshots
 */
export interface EligibilityDiff {
  /** Wallets that became newly eligible */
  added: EligibilityEntry[];
  /** Wallets that lost eligibility */
  removed: EligibilityEntry[];
  /** Wallets promoted to Naib (entered top 7) */
  promotedToNaib: EligibilityEntry[];
  /** Wallets demoted from Naib (left top 7) */
  demotedFromNaib: EligibilityEntry[];
}

/**
 * Claim event from reward vault RewardPaid event
 */
export interface ClaimEvent {
  /** Wallet that received the reward */
  recipient: Address;
  /** Amount of BGT claimed */
  amount: bigint;
}

/**
 * Burn event from BGT Transfer to 0x0
 */
export interface BurnEvent {
  /** Wallet that burned BGT */
  from: Address;
  /** Amount of BGT burned */
  amount: bigint;
}

/**
 * Health status of the service
 */
export interface HealthStatus {
  /** Last successful RPC query timestamp */
  lastSuccessfulQuery: Date | null;
  /** Last query attempt timestamp */
  lastQueryAttempt: Date | null;
  /** Number of consecutive query failures */
  consecutiveFailures: number;
  /** Whether service is in grace period (no revocations) */
  inGracePeriod: boolean;
}

/**
 * Admin override for manual eligibility adjustments
 */
export interface AdminOverride {
  id: number;
  /** Wallet address to override */
  address: string;
  /** Override action */
  action: 'add' | 'remove';
  /** Reason for the override */
  reason: string;
  /** Admin who created the override */
  createdBy: string;
  /** When the override was created */
  createdAt: Date;
  /** When the override expires (null = permanent) */
  expiresAt: Date | null;
  /** Whether the override is currently active */
  active: boolean;
}

/**
 * Audit log entry
 */
export interface AuditLogEntry {
  id: number;
  /** Type of event */
  eventType:
    | 'eligibility_update'
    | 'admin_override'
    | 'member_removed'
    | 'member_added'
    | 'naib_promotion'
    | 'naib_demotion'
    | 'grace_period_entered'
    | 'grace_period_exited';
  /** Event-specific data */
  eventData: Record<string, unknown>;
  /** When the event occurred */
  createdAt: Date;
}

/**
 * Discord wallet mapping (wallet address to Discord user ID)
 */
export interface WalletMapping {
  discordUserId: string;
  walletAddress: string;
  verifiedAt: Date;
}

/**
 * API response for /eligibility endpoint
 */
export interface EligibilityResponse {
  /** When the eligibility data was last updated */
  updated_at: string;
  /** Whether service is in grace period */
  grace_period: boolean;
  /** Top 69 eligible wallets */
  top_69: Array<{
    rank: number;
    address: string;
    bgt_held: number;
  }>;
  /** Top 7 wallet addresses (Naib council) */
  top_7: string[];
}

/**
 * API response for /health endpoint
 */
export interface HealthResponse {
  /** Service status */
  status: 'healthy' | 'degraded';
  /** Last successful query timestamp */
  last_successful_query: string | null;
  /** Next scheduled query timestamp */
  next_query: string;
  /** Whether service is in grace period */
  grace_period: boolean;
}

/**
 * Request body for POST /admin/override
 */
export interface AdminOverrideRequest {
  address: string;
  action: 'add' | 'remove';
  reason: string;
}

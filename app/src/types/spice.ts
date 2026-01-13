// SPICE Economy Types

export interface UserSpice {
  user_address: string;
  balance: number;
  total_earned: number;
  total_spent: number;
  total_loss_usd: number;
  tier: number;
  created_at: string;
  updated_at: string;
}

export interface SpiceTransaction {
  id: string;
  transaction_id: string;
  user_address: string;
  amount: number;
  balance_after: number;
  source_type: string;
  source_id: string | null;
  metadata: Record<string, unknown>;
  idempotency_key: string | null;
  authorizer: string;
  created_at: string;
}

export interface WalletMapping {
  id: string;
  discord_user_id: string;
  wallet_address: string;
  verified_at: string;
  created_at: string;
}

// RPC Result Types
export interface MutationResult {
  balance: number;
  total_earned: number;
  total_spent: number;
  transaction_id: string;
}

export interface ClaimResult {
  balance: number;
  tier: number;
  tier_name: string;
  transaction_id: string;
}

export interface LeaderboardEntry {
  rank: number;
  user_address: string;
  balance: number;
  tier: number;
  total_loss_usd: number;
}

export interface CampaignStats {
  total_losers: number;
  total_loss_usd: number;
  total_spice_claimed: number;
  tier_distribution: {
    tourist: number;
    outsider: number;
    fremen: number;
    fedaykin: number;
    naib: number;
    kwisatz_haderach: number;
  };
}

// Tier Information
export interface TierInfo {
  tier: number;
  name: string;
  title: string;
  minLoss: number;
  maxLoss: number;
  color: string;
}

export const TIERS: TierInfo[] = [
  { tier: 0, name: 'Tourist', title: 'Paper Hands', minLoss: 0, maxLoss: 100, color: '#6b6245' },
  { tier: 1, name: 'Outsider', title: 'Bag Holder', minLoss: 100, maxLoss: 1000, color: '#c9b99a' },
  { tier: 2, name: 'Fremen', title: 'Diamond Hands (Cope)', minLoss: 1000, maxLoss: 10000, color: '#f4a460' },
  { tier: 3, name: 'Fedaykin', title: 'Professional Loser', minLoss: 10000, maxLoss: 50000, color: '#c45c4a' },
  { tier: 4, name: 'Naib', title: 'Generational Wealth Destroyer', minLoss: 50000, maxLoss: 100000, color: '#5b8fb9' },
  { tier: 5, name: 'Kwisatz Haderach', title: 'The Liquidated One', minLoss: 100000, maxLoss: Infinity, color: '#ffd700' },
];

export function getTierByLoss(lossUsd: number): TierInfo {
  return TIERS.find((t) => lossUsd >= t.minLoss && lossUsd < t.maxLoss) ?? TIERS[0];
}

export function getTierByNumber(tier: number): TierInfo {
  return TIERS[tier] ?? TIERS[0];
}

// Source Types for Mutations
export type SpiceSourceType =
  | 'losers_claim'
  | 'store_purchase'
  | 'feature_unlock'
  | 'admin_grant'
  | 'referral_bonus'
  | 'mission_completion';

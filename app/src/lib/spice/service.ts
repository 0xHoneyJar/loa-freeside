import { supabase, isSupabaseConfigured } from '../clients/supabase';
import type {
  UserSpice,
  SpiceTransaction,
  MutationResult,
  ClaimResult,
  LeaderboardEntry,
  CampaignStats,
  SpiceSourceType,
} from '@/types/spice';

// =============================================================================
// Read Operations
// =============================================================================

/**
 * Get a user's SPICE balance and tier info
 */
export async function getUserSpice(address: string): Promise<UserSpice | null> {
  if (!isSupabaseConfigured() || !supabase) {
    console.warn('Supabase not configured');
    return null;
  }

  const { data, error } = await supabase
    .from('user_spice')
    .select('*')
    .eq('user_address', address.toLowerCase())
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      // No rows returned - user doesn't exist yet
      return null;
    }
    throw new Error(`Failed to fetch user spice: ${error.message}`);
  }

  return data as UserSpice;
}

/**
 * Get transaction history for a user
 */
export async function getTransactionHistory(
  address: string,
  limit = 50
): Promise<SpiceTransaction[]> {
  if (!isSupabaseConfigured() || !supabase) {
    console.warn('Supabase not configured');
    return [];
  }

  const { data, error } = await supabase
    .from('spice_transactions')
    .select('*')
    .eq('user_address', address.toLowerCase())
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(`Failed to fetch transactions: ${error.message}`);
  }

  return data as SpiceTransaction[];
}

/**
 * Get the SPICE leaderboard
 */
export async function getLeaderboard(limit = 100): Promise<LeaderboardEntry[]> {
  if (!isSupabaseConfigured() || !supabase) {
    console.warn('Supabase not configured');
    return [];
  }

  const { data, error } = await supabase.rpc('get_spice_leaderboard', {
    p_limit: limit,
  });

  if (error) {
    throw new Error(`Failed to fetch leaderboard: ${error.message}`);
  }

  return data as LeaderboardEntry[];
}

/**
 * Get campaign statistics
 */
export async function getCampaignStats(): Promise<CampaignStats | null> {
  if (!isSupabaseConfigured() || !supabase) {
    console.warn('Supabase not configured');
    return null;
  }

  const { data, error } = await supabase.rpc('get_campaign_stats');

  if (error) {
    throw new Error(`Failed to fetch campaign stats: ${error.message}`);
  }

  // RPC returns an array with single row
  return (data as CampaignStats[])?.[0] ?? null;
}

// =============================================================================
// Mutation Operations
// =============================================================================

/**
 * Apply a SPICE mutation (grant or spend)
 * This is the core atomic operation for all balance changes
 */
export async function mutateSpice(params: {
  address: string;
  amount: number;
  sourceType: SpiceSourceType;
  sourceId?: string;
  metadata?: Record<string, unknown>;
  idempotencyKey?: string;
  authorizer?: string;
}): Promise<MutationResult> {
  if (!isSupabaseConfigured() || !supabase) {
    throw new Error('Supabase not configured');
  }

  const { data, error } = await supabase.rpc('apply_spice_mutation', {
    p_user_address: params.address.toLowerCase(),
    p_amount: params.amount,
    p_source_type: params.sourceType,
    p_source_id: params.sourceId ?? null,
    p_metadata: params.metadata ?? {},
    p_idempotency_key: params.idempotencyKey ?? null,
    p_authorizer: params.authorizer ?? 'system',
  });

  if (error) {
    // Handle specific error types
    if (error.message.includes('spice-insufficient-balance')) {
      throw new Error('Insufficient SPICE balance');
    }
    throw new Error(`Mutation failed: ${error.message}`);
  }

  // RPC returns array with single row
  const result = (data as MutationResult[])?.[0];
  if (!result) {
    throw new Error('Mutation returned no result');
  }

  return result;
}

/**
 * Claim SPICE from the Losers campaign
 * This grants SPICE equal to the USD loss amount and assigns a tier
 */
export async function claimLoserSpice(params: {
  address: string;
  lossUsd: number;
  idempotencyKey?: string;
  metadata?: Record<string, unknown>;
}): Promise<ClaimResult> {
  if (!isSupabaseConfigured() || !supabase) {
    throw new Error('Supabase not configured');
  }

  const { data, error } = await supabase.rpc('claim_loser_spice', {
    p_user_address: params.address.toLowerCase(),
    p_loss_usd: Math.floor(params.lossUsd), // Round down to integer
    p_idempotency_key: params.idempotencyKey ?? null,
    p_metadata: params.metadata ?? {},
  });

  if (error) {
    throw new Error(`Claim failed: ${error.message}`);
  }

  // RPC returns array with single row
  const result = (data as ClaimResult[])?.[0];
  if (!result) {
    throw new Error('Claim returned no result');
  }

  return result;
}

/**
 * Spend SPICE (convenience wrapper for negative mutations)
 */
export async function spendSpice(params: {
  address: string;
  amount: number;
  sourceType: SpiceSourceType;
  sourceId?: string;
  metadata?: Record<string, unknown>;
  idempotencyKey?: string;
}): Promise<MutationResult> {
  if (params.amount <= 0) {
    throw new Error('Spend amount must be positive');
  }

  return mutateSpice({
    ...params,
    amount: -params.amount, // Negative for spending
  });
}

/**
 * Grant SPICE (convenience wrapper for positive mutations)
 */
export async function grantSpice(params: {
  address: string;
  amount: number;
  sourceType: SpiceSourceType;
  sourceId?: string;
  metadata?: Record<string, unknown>;
  idempotencyKey?: string;
  authorizer?: string;
}): Promise<MutationResult> {
  if (params.amount <= 0) {
    throw new Error('Grant amount must be positive');
  }

  return mutateSpice(params);
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Generate a unique idempotency key
 * Use this when making mutations to ensure exactly-once semantics
 */
export function generateIdempotencyKey(): string {
  return crypto.randomUUID();
}

/**
 * Format SPICE amount for display
 */
export function formatSpice(amount: number): string {
  return `◆ ${amount.toLocaleString()}`;
}

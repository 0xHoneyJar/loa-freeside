'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getUserSpice,
  getTransactionHistory,
  getLeaderboard,
  getCampaignStats,
  claimLoserSpice,
  spendSpice,
  generateIdempotencyKey,
} from '@/lib/spice/service';
import type { ClaimResult, MutationResult, SpiceSourceType } from '@/types/spice';
import { getTierByNumber } from '@/types/spice';

// =============================================================================
// Query Keys
// =============================================================================

export const spiceKeys = {
  all: ['spice'] as const,
  user: (address: string) => [...spiceKeys.all, 'user', address] as const,
  history: (address: string) => [...spiceKeys.all, 'history', address] as const,
  leaderboard: () => [...spiceKeys.all, 'leaderboard'] as const,
  stats: () => [...spiceKeys.all, 'stats'] as const,
};

// =============================================================================
// Queries
// =============================================================================

/**
 * Get user's SPICE balance and tier
 */
export function useUserSpice(address: string | null | undefined) {
  return useQuery({
    queryKey: spiceKeys.user(address ?? ''),
    queryFn: () => getUserSpice(address!),
    enabled: Boolean(address),
    staleTime: 30_000, // 30 seconds
  });
}

/**
 * Get user's transaction history
 */
export function useSpiceHistory(address: string | null | undefined, limit = 50) {
  return useQuery({
    queryKey: spiceKeys.history(address ?? ''),
    queryFn: () => getTransactionHistory(address!, limit),
    enabled: Boolean(address),
    staleTime: 30_000,
  });
}

/**
 * Get the SPICE leaderboard
 */
export function useSpiceLeaderboard(limit = 100) {
  return useQuery({
    queryKey: spiceKeys.leaderboard(),
    queryFn: () => getLeaderboard(limit),
    staleTime: 60_000, // 1 minute
  });
}

/**
 * Get campaign statistics
 */
export function useCampaignStats() {
  return useQuery({
    queryKey: spiceKeys.stats(),
    queryFn: () => getCampaignStats(),
    staleTime: 60_000, // 1 minute
  });
}

// =============================================================================
// Mutations
// =============================================================================

/**
 * Claim SPICE from the Losers campaign
 */
export function useClaimLoserSpice() {
  const queryClient = useQueryClient();

  return useMutation<
    ClaimResult,
    Error,
    { address: string; lossUsd: number; metadata?: Record<string, unknown> }
  >({
    mutationFn: async ({ address, lossUsd, metadata }) => {
      const idempotencyKey = generateIdempotencyKey();
      return claimLoserSpice({
        address,
        lossUsd,
        idempotencyKey,
        metadata,
      });
    },
    onSuccess: (_, variables) => {
      // Invalidate user's spice data
      queryClient.invalidateQueries({
        queryKey: spiceKeys.user(variables.address),
      });
      queryClient.invalidateQueries({
        queryKey: spiceKeys.history(variables.address),
      });
      // Invalidate global stats
      queryClient.invalidateQueries({
        queryKey: spiceKeys.stats(),
      });
      queryClient.invalidateQueries({
        queryKey: spiceKeys.leaderboard(),
      });
    },
  });
}

/**
 * Spend SPICE
 */
export function useSpendSpice() {
  const queryClient = useQueryClient();

  return useMutation<
    MutationResult,
    Error,
    {
      address: string;
      amount: number;
      sourceType: SpiceSourceType;
      sourceId?: string;
      metadata?: Record<string, unknown>;
    }
  >({
    mutationFn: async ({ address, amount, sourceType, sourceId, metadata }) => {
      const idempotencyKey = generateIdempotencyKey();
      return spendSpice({
        address,
        amount,
        sourceType,
        sourceId,
        metadata,
        idempotencyKey,
      });
    },
    onSuccess: (_, variables) => {
      // Invalidate user's spice data
      queryClient.invalidateQueries({
        queryKey: spiceKeys.user(variables.address),
      });
      queryClient.invalidateQueries({
        queryKey: spiceKeys.history(variables.address),
      });
    },
  });
}

// =============================================================================
// Derived Hooks
// =============================================================================

/**
 * Get formatted tier info for a user
 */
export function useUserTier(address: string | null | undefined) {
  const { data: userSpice, isLoading, error } = useUserSpice(address);

  const tierInfo = userSpice ? getTierByNumber(userSpice.tier) : null;

  return {
    tier: tierInfo,
    tierNumber: userSpice?.tier ?? 0,
    totalLossUsd: userSpice?.total_loss_usd ?? 0,
    isLoading,
    error,
  };
}

/**
 * ConvictionVoting — Conviction-weighted amendment approval (cycle-043 Phase II)
 *
 * Integrates conviction-weighted voting into the amendment approval process.
 * Stakeholders with higher governance tier have proportionally more weight,
 * following Ostrom Principle 3 (proportional equivalence between benefits and costs).
 *
 * Tier weights adapted from loa-dixie KnowledgePriorityStore pattern.
 *
 * SDD ref: Post-convergence Comment 2 §VI, loa-dixie PR #5
 * Sprint: 365, Task 4.2
 */

import type { AmendmentVote, GovernanceAmendment } from './amendment-service.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export type GovernanceTier = 'observer' | 'participant' | 'member' | 'steward' | 'sovereign';

export interface TierWeight {
  tier: GovernanceTier;
  weight: number;
}

export interface ConvictionResult {
  approve_weight: number;
  reject_weight: number;
  total_weight: number;
  voter_count: number;
  is_approved: boolean;
  is_rejected: boolean;
  has_sovereign_veto: boolean;
}

// ─── Default tier weights ────────────────────────────────────────────────────

const DEFAULT_TIER_WEIGHTS: ReadonlyMap<GovernanceTier, number> = new Map([
  ['observer', 0],
  ['participant', 1],
  ['member', 5],
  ['steward', 15],
  ['sovereign', 25],
]);

// ─── Functions ───────────────────────────────────────────────────────────────

/**
 * Resolve the conviction weight for a governance tier.
 * Falls back to weight=1 if tier is unrecognized.
 */
export function resolveConvictionWeight(
  tier: string | undefined,
  customWeights?: ReadonlyMap<string, number>,
): number {
  if (!tier) return 0;

  const custom = customWeights?.get(tier);
  if (custom !== undefined && Number.isFinite(custom)) {
    return Math.max(0, custom);
  }

  const defaultWeight = DEFAULT_TIER_WEIGHTS.get(tier as GovernanceTier);
  if (defaultWeight !== undefined && Number.isFinite(defaultWeight)) {
    return Math.max(0, defaultWeight);
  }

  return 0;
}

/**
 * Compute conviction totals for an amendment's votes.
 * Observer votes (weight 0) are treated as abstentions.
 */
export function computeConvictionResult(
  votes: AmendmentVote[],
  threshold: number,
  customWeights?: ReadonlyMap<string, number>,
): ConvictionResult {
  let approveWeight = 0;
  let rejectWeight = 0;
  let hasSovereignVeto = false;
  let voterCount = 0;

  for (const vote of votes) {
    // Sovereign veto applies regardless of weight
    if (vote.decision === 'reject' && vote.governance_tier === 'sovereign') {
      hasSovereignVeto = true;
    }

    const rawWeight = vote.conviction_weight ?? resolveConvictionWeight(vote.governance_tier, customWeights);
    const weight = Number.isFinite(rawWeight) ? Math.max(0, rawWeight) : 0;

    if (weight <= 0) continue; // Observer/invalid abstention

    voterCount++;

    if (vote.decision === 'approve') {
      approveWeight += weight;
    } else if (vote.decision === 'reject') {
      rejectWeight += weight;
    }
  }

  return {
    approve_weight: approveWeight,
    reject_weight: rejectWeight,
    total_weight: approveWeight + rejectWeight,
    voter_count: voterCount,
    is_approved: !hasSovereignVeto && approveWeight >= threshold,
    is_rejected: hasSovereignVeto || rejectWeight >= threshold,
    has_sovereign_veto: hasSovereignVeto,
  };
}

/**
 * Check if an amendment is approved based on conviction-weighted voting.
 */
export function isAmendmentApproved(
  amendment: GovernanceAmendment,
  customWeights?: ReadonlyMap<string, number>,
): boolean {
  const result = computeConvictionResult(
    amendment.votes,
    amendment.approval_threshold,
    customWeights,
  );
  return result.is_approved;
}

/**
 * Check if an amendment is rejected (sovereign veto or blocking weight).
 */
export function isAmendmentRejected(
  amendment: GovernanceAmendment,
  customWeights?: ReadonlyMap<string, number>,
): boolean {
  const result = computeConvictionResult(
    amendment.votes,
    amendment.approval_threshold,
    customWeights,
  );
  return result.is_rejected;
}

/**
 * Get the default tier weights map.
 */
export function getDefaultTierWeights(): ReadonlyMap<GovernanceTier, number> {
  return DEFAULT_TIER_WEIGHTS;
}

/**
 * ConvictionVoting — Unit tests (Task 4.2)
 */

import { describe, it, expect } from 'vitest';
import {
  resolveConvictionWeight,
  computeConvictionResult,
  isAmendmentApproved,
  isAmendmentRejected,
  getDefaultTierWeights,
} from '../../packages/adapters/storage/amendment-voting.js';
import type { AmendmentVote, GovernanceAmendment } from '../../packages/adapters/storage/amendment-service.js';

// ─── resolveConvictionWeight ─────────────────────────────────────────────────

describe('resolveConvictionWeight', () => {
  it('should return correct weights for default tiers', () => {
    expect(resolveConvictionWeight('observer')).toBe(0);
    expect(resolveConvictionWeight('participant')).toBe(1);
    expect(resolveConvictionWeight('member')).toBe(5);
    expect(resolveConvictionWeight('steward')).toBe(15);
    expect(resolveConvictionWeight('sovereign')).toBe(25);
  });

  it('should return 0 for unknown tiers', () => {
    expect(resolveConvictionWeight('unknown_tier')).toBe(0);
    expect(resolveConvictionWeight('admin')).toBe(0);
  });

  it('should return 0 for undefined/null tier', () => {
    expect(resolveConvictionWeight(undefined)).toBe(0);
  });

  it('should prefer custom weights over defaults', () => {
    const custom = new Map([['member', 10], ['custom_tier', 7]]);
    expect(resolveConvictionWeight('member', custom)).toBe(10); // Override default 5
    expect(resolveConvictionWeight('custom_tier', custom)).toBe(7);
  });

  it('should clamp negative custom weights to 0', () => {
    const custom = new Map([['evil_tier', -100]]);
    expect(resolveConvictionWeight('evil_tier', custom)).toBe(0);
  });

  it('should handle NaN/Infinity custom weights', () => {
    const custom = new Map([['nan_tier', NaN], ['inf_tier', Infinity]]);
    expect(resolveConvictionWeight('nan_tier', custom)).toBe(0);
    expect(resolveConvictionWeight('inf_tier', custom)).toBe(0);
  });
});

// ─── computeConvictionResult ─────────────────────────────────────────────────

describe('computeConvictionResult', () => {
  it('should compute approval at exact threshold', () => {
    const votes: AmendmentVote[] = [
      { voter_id: 'v1', voted_at: '', decision: 'approve', rationale: '', governance_tier: 'steward', conviction_weight: 15 },
      { voter_id: 'v2', voted_at: '', decision: 'approve', rationale: '', governance_tier: 'member', conviction_weight: 5 },
    ];

    const result = computeConvictionResult(votes, 20);

    expect(result.approve_weight).toBe(20);
    expect(result.is_approved).toBe(true);
    expect(result.is_rejected).toBe(false);
    expect(result.voter_count).toBe(2);
  });

  it('should not approve below threshold', () => {
    const votes: AmendmentVote[] = [
      { voter_id: 'v1', voted_at: '', decision: 'approve', rationale: '', governance_tier: 'member', conviction_weight: 5 },
    ];

    const result = computeConvictionResult(votes, 20);

    expect(result.approve_weight).toBe(5);
    expect(result.is_approved).toBe(false);
  });

  it('should detect sovereign veto regardless of weight', () => {
    const votes: AmendmentVote[] = [
      { voter_id: 'v1', voted_at: '', decision: 'approve', rationale: '', governance_tier: 'steward', conviction_weight: 30 },
      { voter_id: 'v2', voted_at: '', decision: 'reject', rationale: 'veto', governance_tier: 'sovereign', conviction_weight: 0 },
    ];

    const result = computeConvictionResult(votes, 20);

    // Approve weight exceeds threshold, but sovereign vetoed
    expect(result.approve_weight).toBe(30);
    expect(result.has_sovereign_veto).toBe(true);
    expect(result.is_approved).toBe(false);
    expect(result.is_rejected).toBe(true);
  });

  it('should treat observer votes as abstentions', () => {
    const votes: AmendmentVote[] = [
      { voter_id: 'obs1', voted_at: '', decision: 'approve', rationale: '', governance_tier: 'observer', conviction_weight: 0 },
      { voter_id: 'v1', voted_at: '', decision: 'approve', rationale: '', governance_tier: 'member', conviction_weight: 5 },
    ];

    const result = computeConvictionResult(votes, 5);

    // Observer vote doesn't count
    expect(result.voter_count).toBe(1);
    expect(result.approve_weight).toBe(5);
    expect(result.is_approved).toBe(true);
  });

  it('should handle empty votes', () => {
    const result = computeConvictionResult([], 10);

    expect(result.approve_weight).toBe(0);
    expect(result.reject_weight).toBe(0);
    expect(result.voter_count).toBe(0);
    expect(result.is_approved).toBe(false);
    expect(result.is_rejected).toBe(false);
  });

  it('should handle reject weight exceeding threshold', () => {
    const votes: AmendmentVote[] = [
      { voter_id: 'v1', voted_at: '', decision: 'reject', rationale: '', governance_tier: 'steward', conviction_weight: 15 },
      { voter_id: 'v2', voted_at: '', decision: 'reject', rationale: '', governance_tier: 'member', conviction_weight: 5 },
    ];

    const result = computeConvictionResult(votes, 20);

    expect(result.reject_weight).toBe(20);
    expect(result.is_rejected).toBe(true);
    expect(result.is_approved).toBe(false);
  });

  it('should use custom tier weights', () => {
    const custom = new Map([['local_elder', 50]]);
    const votes: AmendmentVote[] = [
      { voter_id: 'elder', voted_at: '', decision: 'approve', rationale: '', governance_tier: 'local_elder' },
    ];

    const result = computeConvictionResult(votes, 40, custom);

    expect(result.approve_weight).toBe(50);
    expect(result.is_approved).toBe(true);
  });

  it('should sanitize NaN/negative conviction weights', () => {
    const votes: AmendmentVote[] = [
      { voter_id: 'v1', voted_at: '', decision: 'approve', rationale: '', conviction_weight: NaN },
      { voter_id: 'v2', voted_at: '', decision: 'approve', rationale: '', conviction_weight: -5 },
      { voter_id: 'v3', voted_at: '', decision: 'approve', rationale: '', conviction_weight: 10 },
    ];

    const result = computeConvictionResult(votes, 10);

    // Only v3's weight counts
    expect(result.approve_weight).toBe(10);
    expect(result.voter_count).toBe(1);
  });
});

// ─── isAmendmentApproved / isAmendmentRejected ──────────────────────────────

describe('isAmendmentApproved', () => {
  it('should return true when conviction weight meets threshold', () => {
    const amendment = {
      approval_threshold: 10,
      votes: [
        { voter_id: 'v1', voted_at: '', decision: 'approve', rationale: '', conviction_weight: 10 },
      ],
    } as GovernanceAmendment;

    expect(isAmendmentApproved(amendment)).toBe(true);
  });

  it('should return false when vetoed', () => {
    const amendment = {
      approval_threshold: 10,
      votes: [
        { voter_id: 'v1', voted_at: '', decision: 'approve', rationale: '', conviction_weight: 20 },
        { voter_id: 'v2', voted_at: '', decision: 'reject', rationale: '', governance_tier: 'sovereign', conviction_weight: 25 },
      ],
    } as GovernanceAmendment;

    expect(isAmendmentApproved(amendment)).toBe(false);
  });
});

describe('isAmendmentRejected', () => {
  it('should return true on sovereign veto', () => {
    const amendment = {
      approval_threshold: 10,
      votes: [
        { voter_id: 'v1', voted_at: '', decision: 'reject', rationale: '', governance_tier: 'sovereign', conviction_weight: 25 },
      ],
    } as GovernanceAmendment;

    expect(isAmendmentRejected(amendment)).toBe(true);
  });
});

// ─── getDefaultTierWeights ───────────────────────────────────────────────────

describe('getDefaultTierWeights', () => {
  it('should return all 5 tiers with correct weights', () => {
    const tiers = getDefaultTierWeights();

    expect(tiers.size).toBe(5);
    expect(tiers.get('observer')).toBe(0);
    expect(tiers.get('participant')).toBe(1);
    expect(tiers.get('member')).toBe(5);
    expect(tiers.get('steward')).toBe(15);
    expect(tiers.get('sovereign')).toBe(25);
  });
});

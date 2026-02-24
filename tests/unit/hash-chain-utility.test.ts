/**
 * Hash Chain Utility Tests — Sprint 354, Task 2.3
 *
 * Validates computeScoringPathHash determinism and SCORING_PATH_GENESIS_HASH
 * format per SDD §3.2.2 (utility-only, no chain replay).
 *
 * @see grimoires/loa/sprint.md Task 2.3
 * @see grimoires/loa/sdd.md §3.2.2
 */

import { describe, it, expect } from 'vitest';
import {
  computeScoringPathHash,
  SCORING_PATH_GENESIS_HASH,
} from '@0xhoneyjar/loa-hounfour/governance';

// SHA-256 hex pattern: sha256: prefix + 64 hex chars
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;

// ---------------------------------------------------------------------------
// AC-2.3: Genesis hash valid SHA-256 hex (64 chars)
// ---------------------------------------------------------------------------

describe('SCORING_PATH_GENESIS_HASH', () => {
  it('is a valid sha256-prefixed hex string', () => {
    expect(SCORING_PATH_GENESIS_HASH).toMatch(SHA256_PATTERN);
  });

  it('has exactly 64 hex characters after the sha256: prefix', () => {
    const hex = SCORING_PATH_GENESIS_HASH.replace('sha256:', '');
    expect(hex).toHaveLength(64);
  });

  it('matches the expected genesis hash (sha256 of empty string)', () => {
    expect(SCORING_PATH_GENESIS_HASH).toBe(
      'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });
});

// ---------------------------------------------------------------------------
// AC-2.2: Hash determinism test (same input → same hash)
// ---------------------------------------------------------------------------

describe('computeScoringPathHash determinism', () => {
  // ScoringPathLog entry with domain-valid ScoringPath literal
  const sampleInput = {
    path: 'task_cohort' as const,
    model_id: 'model-001',
    task_type: 'review',
    reason: 'quality check',
    scored_at: '2026-01-15T00:00:00Z',
  };

  it('produces same hash for identical input', () => {
    const hash1 = computeScoringPathHash(sampleInput);
    const hash2 = computeScoringPathHash(sampleInput);
    expect(hash1).toBe(hash2);
  });

  it('produces different hash for different input', () => {
    const hashA = computeScoringPathHash(sampleInput);
    const hashB = computeScoringPathHash({
      ...sampleInput,
      path: 'aggregate' as const,
    });
    expect(hashA).not.toBe(hashB);
  });
});

// ---------------------------------------------------------------------------
// AC-2.4: computeScoringPathHash produces valid SHA-256 from sample input
// ---------------------------------------------------------------------------

describe('computeScoringPathHash output format', () => {
  it('produces a valid sha256-prefixed hex string', () => {
    const hash = computeScoringPathHash({
      path: 'tier_default' as const,
      model_id: 'model-test',
      task_type: 'moderation',
      scored_at: '2026-02-01T00:00:00Z',
    });
    expect(hash).toMatch(SHA256_PATTERN);
  });
});

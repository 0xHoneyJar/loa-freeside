import { describe, it, expect } from 'vitest';
import { resolveEligibility, classifyBand } from '../eligibility-resolver.js';

describe('resolveEligibility — sealed nft-balance rule (AC-3)', () => {
  it('qualifies a wallet at/above the threshold', () => {
    const r = resolveEligibility({ kind: 'nft-balance', threshold: 2 }, 3n);
    expect(r).toEqual({ ok: true, qualifies: true });
  });

  it('does not qualify a wallet below the threshold', () => {
    const r = resolveEligibility({ kind: 'nft-balance', threshold: 2 }, 1n);
    expect(r).toEqual({ ok: true, qualifies: false });
  });

  it('qualifies exactly at the threshold (>=)', () => {
    expect(resolveEligibility({ kind: 'nft-balance', threshold: 2 }, 2n)).toEqual({
      ok: true,
      qualifies: true,
    });
  });

  it.each(['erc20-balance', 'lp-stake', 'multi-contract', 'allowlist', 'staked-nft'])(
    'refuses out-of-scope gating kind "%s" with a typed refusal',
    (kind) => {
      const r = resolveEligibility({ kind, threshold: 1 }, 9n);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.refusal.code).toBe('unsupported-gating');
        expect(r.refusal.retryable).toBe(false);
      }
    },
  );

  it('refuses a non-positive threshold', () => {
    const r = resolveEligibility({ kind: 'nft-balance', threshold: 0 }, 5n);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.refusal.code).toBe('unsupported-gating');
  });
});

describe('classifyBand — bands only, no score', () => {
  it('ok when role and qualification agree', () => {
    expect(classifyBand(true, true)).toBe('ok');
    expect(classifyBand(false, false)).toBe('ok');
  });

  it('stale when a role-holder no longer qualifies', () => {
    expect(classifyBand(true, false)).toBe('stale');
  });

  it('missing when a qualifier has no role', () => {
    expect(classifyBand(false, true)).toBe('missing');
  });
});

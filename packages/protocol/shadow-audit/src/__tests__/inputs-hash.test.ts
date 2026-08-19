import { describe, it, expect } from 'vitest';

import { computeInputsHash, type AuditInputs } from '../index.js';

// Mixed-case contract so the checksum-insensitivity test is meaningful.
const ETH_CONTRACT = '0xAbCdEf0123456789aBcDeF0123456789AbCdEf01';
const BERA_CONTRACT = '0x1111111111111111111111111111111111111111';

const base: AuditInputs = {
  sources: [{ chain: '1', contract: ETH_CONTRACT, snapshot_block: 19000000 }],
  rule: { kind: 'nft-balance', threshold: 1 },
};

/** The same collection, deployed on two chains — the union S5-T3 introduced. */
const union: AuditInputs = {
  sources: [
    { chain: '1', contract: ETH_CONTRACT, snapshot_block: 19000000 },
    { chain: '80094', contract: BERA_CONTRACT, snapshot_block: 4200000 },
  ],
  rule: { kind: 'nft-balance', threshold: 1 },
};

describe('computeInputsHash (IMP-001)', () => {
  it('returns 64-char lowercase hex', () => {
    expect(computeInputsHash(base)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic for identical inputs', () => {
    expect(computeInputsHash(base)).toBe(computeInputsHash({ ...base }));
  });

  it('is insensitive to contract address checksum casing', () => {
    const lower = { ...base, sources: [{ ...base.sources[0]!, contract: ETH_CONTRACT.toLowerCase() }] };
    const upper = { ...base, sources: [{ ...base.sources[0]!, contract: '0x' + ETH_CONTRACT.slice(2).toUpperCase() }] };
    expect(computeInputsHash(lower)).toBe(computeInputsHash(upper));
  });

  it('is insensitive to input key order (JCS canonicalizes)', () => {
    const reordered: AuditInputs = {
      rule: { threshold: 1, kind: 'nft-balance' },
      sources: [{ snapshot_block: 19000000, contract: ETH_CONTRACT, chain: '1' }],
    };
    expect(computeInputsHash(reordered)).toBe(computeInputsHash(base));
  });

  it('changes when the snapshot block changes', () => {
    const moved = { ...base, sources: [{ ...base.sources[0]!, snapshot_block: 19000001 }] };
    expect(computeInputsHash(moved)).not.toBe(computeInputsHash(base));
  });

  it('changes when the gating threshold changes', () => {
    expect(
      computeInputsHash({ ...base, rule: { kind: 'nft-balance', threshold: 2 } }),
    ).not.toBe(computeInputsHash(base));
  });

  it('throws on malformed inputs (validated before hashing)', () => {
    expect(() =>
      computeInputsHash({ ...base, sources: [{ ...base.sources[0]!, contract: '0xbad' }] } as AuditInputs),
    ).toThrow();
  });

  // ── S5-T3: the fingerprint must cover the WHOLE source set ────────────────────────────────────
  //
  // A collection is the UNION of its deployments. If the hash covered only one of them, a bera-only run and
  // an eth+bera run of the SAME collection at the SAME blocks would produce the same inputs_hash — hence the
  // same run_id — for two different computations, and the determinism claim would be a lie.

  it('a union does NOT collide with the single source that addressed it', () => {
    expect(computeInputsHash(union)).not.toBe(computeInputsHash(base));
  });

  it('two DIFFERENT source-sets never collide (the single-source hash would have)', () => {
    const beraOnly: AuditInputs = {
      sources: [{ chain: '80094', contract: BERA_CONTRACT, snapshot_block: 4200000 }],
      rule: { kind: 'nft-balance', threshold: 1 },
    };
    // Under the old one-source hash, an eth-addressed audit and an eth+bera union both hashed
    // {chain:'1', contract: ETH, block} — identical. They are different computations.
    expect(new Set([computeInputsHash(base), computeInputsHash(beraOnly), computeInputsHash(union)]).size).toBe(3);
  });

  it('a change to ANY source block changes the hash (not just the addressed one)', () => {
    const otherBlock: AuditInputs = {
      ...union,
      sources: [union.sources[0]!, { ...union.sources[1]!, snapshot_block: 4200001 }],
    };
    expect(computeInputsHash(otherBlock)).not.toBe(computeInputsHash(union));
  });

  it('is insensitive to source ORDER (the registry may enumerate either way)', () => {
    const reversed: AuditInputs = { ...union, sources: [union.sources[1]!, union.sources[0]!] };
    expect(computeInputsHash(reversed)).toBe(computeInputsHash(union));
  });

  it('refuses a duplicate source (a registry defect, never hashed as a valid union)', () => {
    expect(() =>
      computeInputsHash({ ...base, sources: [base.sources[0]!, { ...base.sources[0]! }] }),
    ).toThrow(/duplicate source/);
  });

  it('refuses an empty source set (an audit of nothing has no fingerprint)', () => {
    expect(() => computeInputsHash({ ...base, sources: [] })).toThrow();
  });

  it('refuses a non-numeric chain (the chain id is the registry key + the sonar query scope)', () => {
    expect(() =>
      computeInputsHash({ ...base, sources: [{ ...base.sources[0]!, chain: 'ethereum' }] }),
    ).toThrow();
  });
});

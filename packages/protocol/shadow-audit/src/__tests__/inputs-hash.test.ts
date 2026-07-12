import { describe, it, expect } from 'vitest';

import { computeInputsHash, type AuditInputs } from '../index.js';

// Mixed-case contract so the checksum-insensitivity test is meaningful.
const base: AuditInputs = {
  chain: 'ethereum',
  contract: '0xAbCdEf0123456789aBcDeF0123456789AbCdEf01',
  snapshot_block: 19000000,
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
    const lower = { ...base, contract: base.contract.toLowerCase() };
    const upper = { ...base, contract: '0x' + base.contract.slice(2).toUpperCase() };
    expect(computeInputsHash(lower)).toBe(computeInputsHash(upper));
  });

  it('is insensitive to input key order (JCS canonicalizes)', () => {
    const reordered: AuditInputs = {
      rule: { threshold: 1, kind: 'nft-balance' },
      snapshot_block: 19000000,
      contract: base.contract,
      chain: 'ethereum',
    };
    expect(computeInputsHash(reordered)).toBe(computeInputsHash(base));
  });

  it('changes when the snapshot block changes', () => {
    expect(computeInputsHash({ ...base, snapshot_block: 19000001 })).not.toBe(
      computeInputsHash(base),
    );
  });

  it('changes when the gating threshold changes', () => {
    expect(
      computeInputsHash({ ...base, rule: { kind: 'nft-balance', threshold: 2 } }),
    ).not.toBe(computeInputsHash(base));
  });

  it('throws on malformed inputs (validated before hashing)', () => {
    expect(() => computeInputsHash({ ...base, contract: '0xbad' } as AuditInputs)).toThrow();
  });
});

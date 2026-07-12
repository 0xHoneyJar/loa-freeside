import { describe, expect, it } from 'vitest';
import {
  collectionEntityId,
  normalizeChainId,
  normalizeContractAddress,
} from '../schemas/identity.js';

describe('collection identity normalization (SDD §7 — single choke point)', () => {
  it('collapses mixed-case contract + numeric/string/leading-zero chain to ONE entity_id', () => {
    const canonical = '80094:0xabcdef0123456789abcdef0123456789abcdef01';
    // Every one of these MUST fold to the same identity.
    expect(collectionEntityId('80094', '0xABCDEF0123456789ABCDEF0123456789ABCDEF01')).toBe(canonical);
    expect(collectionEntityId('80094', '0xabcdef0123456789abcdef0123456789abcdef01')).toBe(canonical);
    expect(collectionEntityId('080094', '0xAbCdEf0123456789aBcDeF0123456789AbCdEf01')).toBe(canonical);
    expect(collectionEntityId(' 80094 ', ' 0xABCDEF0123456789ABCDEF0123456789ABCDEF01 ')).toBe(canonical);
  });

  it('rejects malformed inputs (no partial identity)', () => {
    expect(collectionEntityId('80094', '0xnothex')).toBeNull();
    expect(collectionEntityId('80094', '0xABCD')).toBeNull(); // too short
    expect(collectionEntityId('0x1', '0xabcdef0123456789abcdef0123456789abcdef01')).toBeNull(); // hex chain
    expect(collectionEntityId('-1', '0xabcdef0123456789abcdef0123456789abcdef01')).toBeNull();
    expect(collectionEntityId('0', '0xabcdef0123456789abcdef0123456789abcdef01')).toBeNull();
  });

  it('normalizeChainId strips leading zeros and rejects non-positive / non-decimal', () => {
    expect(normalizeChainId('080094')).toBe('80094');
    expect(normalizeChainId('1')).toBe('1');
    expect(normalizeChainId('00')).toBeNull();
    expect(normalizeChainId('0x1')).toBeNull();
    expect(normalizeChainId('')).toBeNull();
  });

  it('normalizeContractAddress lowercases and validates 20-byte hex', () => {
    expect(normalizeContractAddress('0xABCDEF0123456789ABCDEF0123456789ABCDEF01')).toBe(
      '0xabcdef0123456789abcdef0123456789abcdef01',
    );
    expect(normalizeContractAddress('abcdef0123456789abcdef0123456789abcdef01')).toBeNull(); // no 0x
  });
});

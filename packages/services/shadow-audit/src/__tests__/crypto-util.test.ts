import { describe, expect, it } from 'vitest';
import { timingSafeEqualStr } from '../crypto-util.js';

describe('timingSafeEqualStr', () => {
  it('accepts only the exact value', () => {
    expect(timingSafeEqualStr('expected-value', 'expected-value')).toBe(true);
    expect(timingSafeEqualStr('expected-value-x', 'expected-value')).toBe(false);
    expect(timingSafeEqualStr('expected-valu', 'expected-value')).toBe(false);
  });

  it('rejects oversized presented headers before hashing them', () => {
    expect(timingSafeEqualStr('x'.repeat(4097), 'expected-value')).toBe(false);
  });
});

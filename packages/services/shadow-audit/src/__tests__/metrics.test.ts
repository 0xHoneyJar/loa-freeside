import { describe, it, expect } from 'vitest';
import { kAnonCohort, holderTurnover, staleRiskBand } from '../metrics.js';

describe('kAnonCohort (AC-7)', () => {
  it('emits an exact count at/above k', () => {
    expect(kAnonCohort(5)).toEqual({ kind: 'exact', value: 5 });
    expect(kAnonCohort(42)).toEqual({ kind: 'exact', value: 42 });
  });

  it('buckets a sub-k cohort (never an exact small count)', () => {
    expect(kAnonCohort(4)).toEqual({ kind: 'bucketed', bucket: '<5' });
    expect(kAnonCohort(0)).toEqual({ kind: 'bucketed', bucket: '<5' });
  });

  it('honors a custom k', () => {
    expect(kAnonCohort(3, 1)).toEqual({ kind: 'exact', value: 3 });
    expect(kAnonCohort(9, 10)).toEqual({ kind: 'bucketed', bucket: '<10' });
  });
});

describe('holderTurnover', () => {
  it('is sold_lapsed / qualified@snapshot', () => {
    expect(holderTurnover(2, 4)).toBe(0.5);
  });

  it('is 0 when nobody qualified at snapshot', () => {
    expect(holderTurnover(0, 0)).toBe(0);
  });
});

describe('staleRiskBand', () => {
  it('low under 5%', () => {
    expect(staleRiskBand(0, 5)).toBe('low');
  });
  it('elevated at 5% up to 20%', () => {
    expect(staleRiskBand(1, 20)).toBe('elevated');
  });
  it('high at/above 20%', () => {
    expect(staleRiskBand(4, 20)).toBe('high');
  });
  it('low when there are no role-holders', () => {
    expect(staleRiskBand(0, 0)).toBe('low');
  });
});

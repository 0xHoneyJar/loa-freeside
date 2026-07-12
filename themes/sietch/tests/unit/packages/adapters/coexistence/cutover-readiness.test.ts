/**
 * cutover-readiness Unit Tests
 *
 * The pure cutover-graduation decision (extracted from MigrationEngine.checkReadiness).
 * CRITICAL TEST (arrakis-dkf9): a high accuracy % over a tiny sample must NOT graduate
 * a cutover — that would grant real community-access roles on statistically
 * meaningless data. A 3-member 3/3 = 100% sample is the canonical bug case.
 */

import { describe, it, expect } from 'vitest';
import {
  evaluateCutoverReadiness,
  type CutoverReadinessInput,
} from '../../../../../src/packages/adapters/coexistence/cutover-readiness.js';

// A baseline input that PASSES every gate — each test perturbs one dimension.
const ok = (over: Partial<CutoverReadinessInput> = {}): CutoverReadinessInput => ({
  shadowDays: 14,
  minShadowDays: 14,
  accuracyPercent: 100,
  minAccuracyPercent: 95,
  sampleSize: 50,
  minSampleSize: 30,
  incumbentConfigured: true,
  modeValid: true,
  currentMode: 'parallel',
  ...over,
});

describe('evaluateCutoverReadiness', () => {
  it('graduates when shadow days, accuracy, sample size, incumbent, and mode all clear', () => {
    const d = evaluateCutoverReadiness(ok());
    expect(d.ready).toBe(true);
    expect(d.reason).toBeUndefined();
    expect(d.checks).toEqual({
      shadowDaysCheck: true,
      accuracyCheck: true,
      sampleSizeCheck: true,
      incumbentConfigured: true,
      modeCheck: true,
    });
  });

  it('arrakis-dkf9: a tiny 3/3 = 100% sample does NOT graduate (sample-size floor)', () => {
    // The bug: 100% accuracy over 3 compared members cleared the 95% gate.
    const d = evaluateCutoverReadiness(ok({ accuracyPercent: 100, sampleSize: 3 }));
    expect(d.ready).toBe(false);
    expect(d.checks.accuracyCheck).toBe(true); // accuracy alone still "passes"...
    expect(d.checks.sampleSizeCheck).toBe(false); // ...but the sample floor blocks it
    expect(d.reason).toMatch(/Insufficient sample size: 3\/30/);
  });

  it('sample-size floor is inclusive at the boundary', () => {
    expect(evaluateCutoverReadiness(ok({ sampleSize: 30 })).ready).toBe(true);
    expect(evaluateCutoverReadiness(ok({ sampleSize: 29 })).ready).toBe(false);
  });

  it('a zero sample (no comparisons at all) does NOT graduate', () => {
    const d = evaluateCutoverReadiness(ok({ sampleSize: 0 }));
    expect(d.ready).toBe(false);
    expect(d.checks.sampleSizeCheck).toBe(false);
  });

  it('both gates exactly at their floor (95% over 30 members) graduates', () => {
    const d = evaluateCutoverReadiness(ok({ accuracyPercent: 95, sampleSize: 30 }));
    expect(d.ready).toBe(true);
  });

  it('still enforces the pre-existing gates — the floor is additive, not a replacement', () => {
    expect(evaluateCutoverReadiness(ok({ accuracyPercent: 94 })).ready).toBe(false);
    expect(evaluateCutoverReadiness(ok({ shadowDays: 13 })).ready).toBe(false);
    expect(evaluateCutoverReadiness(ok({ incumbentConfigured: false })).ready).toBe(false);
    expect(evaluateCutoverReadiness(ok({ modeValid: false })).ready).toBe(false);
  });

  it('the reason names every failing gate, including the sample floor', () => {
    const d = evaluateCutoverReadiness(
      ok({ accuracyPercent: 80, sampleSize: 5, shadowDays: 2 }),
    );
    expect(d.ready).toBe(false);
    expect(d.reason).toMatch(/Insufficient shadow days: 2\/14/);
    expect(d.reason).toMatch(/Insufficient sample size: 5\/30/);
    expect(d.reason).toMatch(/Insufficient accuracy: 80\.0%\/95%/);
  });

  it('preserves the exact mode-failure diagnostic (includes the offending mode)', () => {
    const d = evaluateCutoverReadiness(ok({ modeValid: false, currentMode: 'primary' }));
    expect(d.reason).toMatch(/Invalid mode for migration: primary \(must be shadow or parallel\)/);
  });
});

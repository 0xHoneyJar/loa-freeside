import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { AccessDecisionRecordSchema, BandSchema } from '../index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, '../../fixtures');

function record(): Record<string, any> {
  return JSON.parse(
    readFileSync(join(FIXTURES_DIR, 'access-decision-record.valid.json'), 'utf-8'),
  );
}

describe('AccessDecisionRecordSchema', () => {
  it('accepts the canonical valid record', () => {
    expect(AccessDecisionRecordSchema.safeParse(record()).success).toBe(true);
  });

  // The load-bearing invariant: bands only, never a numeric score.
  it('has NO numeric score: a smuggled `score` field is rejected (.strict)', () => {
    const withScore = record();
    withScore.score = 87;
    expect(AccessDecisionRecordSchema.safeParse(withScore).success).toBe(false);
  });

  it('exposes no `score` key on a parsed record', () => {
    const parsed = AccessDecisionRecordSchema.parse(record());
    expect(parsed).not.toHaveProperty('score');
  });

  it('band is constrained to exactly stale | missing | ok', () => {
    expect(BandSchema.options).toEqual(['stale', 'missing', 'ok']);
    const bad = record();
    bad.band = 'banned';
    expect(AccessDecisionRecordSchema.safeParse(bad).success).toBe(false);
  });

  it('requires a band', () => {
    const bad = record();
    delete bad.band;
    expect(AccessDecisionRecordSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects a non-ISO computed_at', () => {
    const bad = record();
    bad.provenance.computed_at = 'yesterday';
    expect(AccessDecisionRecordSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects a smuggled numeric field inside evidence (nested .strict)', () => {
    const bad = record();
    bad.evidence.numeric_score = 0.9;
    expect(AccessDecisionRecordSchema.safeParse(bad).success).toBe(false);
  });
});

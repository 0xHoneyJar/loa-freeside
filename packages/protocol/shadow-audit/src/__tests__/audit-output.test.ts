import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { AuditOutputSchema, CohortCountSchema } from '../index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, '../../fixtures');

function output(): Record<string, any> {
  return JSON.parse(readFileSync(join(FIXTURES_DIR, 'audit-output.valid.json'), 'utf-8'));
}
function recordFixture(): unknown {
  return JSON.parse(
    readFileSync(join(FIXTURES_DIR, 'access-decision-record.valid.json'), 'utf-8'),
  );
}

describe('AuditOutputSchema', () => {
  it('accepts a valid aggregate-only output (anonymous caller)', () => {
    expect(AuditOutputSchema.safeParse(output()).success).toBe(true);
  });

  it('accepts an output WITH records (authed caller)', () => {
    const authed = output();
    authed.records = [recordFixture()];
    expect(AuditOutputSchema.safeParse(authed).success).toBe(true);
  });

  it('requires run_id (IMP-007)', () => {
    const bad = output();
    delete bad.run_id;
    expect(AuditOutputSchema.safeParse(bad).success).toBe(false);
  });

  it('requires a 64-char lowercase hex inputs_hash (IMP-001)', () => {
    const bad = output();
    bad.inputs_hash = 'NOTAHASH';
    expect(AuditOutputSchema.safeParse(bad).success).toBe(false);
  });

  it('seals mode to dogfood-full (external is never an output)', () => {
    const bad = output();
    bad.mode = 'external';
    expect(AuditOutputSchema.safeParse(bad).success).toBe(false);
  });
});

describe('CohortCountSchema (k-anonymity, AC-7)', () => {
  it('accepts an exact count', () => {
    expect(CohortCountSchema.safeParse({ kind: 'exact', value: 9 }).success).toBe(true);
  });

  it('accepts a coarse bucket', () => {
    expect(CohortCountSchema.safeParse({ kind: 'bucketed', bucket: '<5' }).success).toBe(true);
  });

  it('rejects a negative exact count', () => {
    expect(CohortCountSchema.safeParse({ kind: 'exact', value: -1 }).success).toBe(false);
  });

  it('rejects a bare number (must be exact-or-bucketed, nothing else)', () => {
    expect(CohortCountSchema.safeParse(3).success).toBe(false);
  });
});

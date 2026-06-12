/**
 * canon-conformance.test.mjs — AS-10 / B6: asson's VENDORED canon primitives are
 * byte-identical to Legba's.
 *
 * HERMETIC (B1/B2): compares asson's `src/vendor/canon.mjs` against a CHECKED-IN
 * golden corpus (`test/fixtures/canon-golden.json`) whose `expected_*` values were
 * generated ONCE from the real Legba `legba-core.mjs` and committed. No filesystem
 * read of legba-core at test time — runs in CI, on any machine, offline.
 *
 * The propagation tripwire is a SEPARATE manual mode (run when re-vendoring):
 *   node test/canon-conformance.test.mjs --regen-against-legba <path-to-legba-core>
 * which regenerates the golden from live Legba; a `git diff` on the golden then
 * shows any drift loudly. A divergence is a gated event, never silent (B3).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { jcs, sha256 } from '../src/vendor/canon.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GOLDEN = join(__dirname, 'fixtures', 'canon-golden.json');

// ── re-vendor mode (manual, not CI): regenerate the golden from live Legba ──
const regenIdx = process.argv.indexOf('--regen-against-legba');
if (regenIdx !== -1) {
  const legbaPath = process.argv[regenIdx + 1];
  const legba = await import(legbaPath);
  const { cases } = JSON.parse(readFileSync(GOLDEN, 'utf8'));
  const regen = cases.map(({ input }) => ({
    input,
    expected_jcs: legba.jcs(input),
    expected_sha256: legba.sha256(Buffer.from(legba.jcs(input), 'utf8')),
  }));
  writeFileSync(GOLDEN, JSON.stringify({ generated_from: `legba-core.mjs @ ${legbaPath}`, cases: regen }, null, 2) + '\n');
  console.log(`regenerated ${regen.length} golden cases from ${legbaPath} — review the git diff`);
  process.exit(0);
}

const { cases } = JSON.parse(readFileSync(GOLDEN, 'utf8'));

test('AS-10: golden corpus is non-empty and covers ≥8 shapes', () => {
  assert.ok(cases.length >= 8, `expected ≥8 golden cases, got ${cases.length}`);
});

for (const [i, c] of cases.entries()) {
  test(`AS-10: vendored jcs() matches Legba golden — case ${i} (${JSON.stringify(c.input).slice(0, 30)})`, () => {
    assert.equal(jcs(c.input), c.expected_jcs, 'jcs output diverged from Legba');
  });
  test(`AS-10: vendored sha256() matches Legba golden — case ${i}`, () => {
    assert.equal(sha256(Buffer.from(jcs(c.input), 'utf8')), c.expected_sha256, 'sha256 diverged from Legba');
  });
}

/**
 * veve-schema.test.mjs — G-2 / AS-1: the veve manifest schema validates real veves
 * and rejects malformed ones. ajv is a DOCTOR/CLI-layer dep (B6: the zero-dep claim
 * scopes to the core primitives, not this validator).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const schema = JSON.parse(readFileSync(join(root, 'schemas', 'veve.schema.json'), 'utf8'));
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validate = ajv.compile(schema);

const wordcount = JSON.parse(readFileSync(join(root, 'examples', 'wordcount', 'veve.json'), 'utf8'));
const lexicon = JSON.parse(readFileSync(join(root, 'examples', 'lexicon-lint', 'veve.json'), 'utf8'));

test('AS-1: the wordcount example veve validates', () => {
  assert.ok(validate(wordcount), JSON.stringify(validate.errors));
});
test('AS-1: the lexicon-lint example veve validates', () => {
  assert.ok(validate(lexicon), JSON.stringify(validate.errors));
});

// ── ≥6 malformed fixtures, each rejected for a named reason ──
const bad = (mut) => { const v = structuredClone(wordcount); mut(v); return v; };

const invalids = [
  ['missing required name', bad(v => delete v.name)],
  ['bad name slug (trailing hyphen)', bad(v => { v.name = 'word-'; })],
  ['bad version (not semver)', bad(v => { v.version = '1.0'; })],
  ['bad determinism class enum', bad(v => { v.determinism.class = 'maybe'; })],
  ['bad determinism declared_by enum', bad(v => { v.determinism.declared_by = 'vibes'; })],
  ['additionalProperty on attestation', bad(v => { v.attestation = { ...(v.attestation ?? {}), rogue: 1 }; })],
  ['0.2.0 without liveness (allOf require)', () => { const v = structuredClone(wordcount); v.veve_version = '0.2.0'; delete v.liveness; return v; }],
  ['vector hash bad pattern', bad(v => { if (v.vectors?.[0]) v.vectors[0].expect_output_hash = 'notahash'; })],
  ['ladder level out of range', bad(v => { v.ladder.level = 9; })],
].map(([name, vOrFn]) => [name, typeof vOrFn === 'function' ? vOrFn() : vOrFn]);

assert.ok(invalids.length >= 6, 'need ≥6 invalid fixtures');

for (const [name, v] of invalids) {
  test(`AS-1: rejects malformed veve — ${name}`, () => {
    const ok = validate(v);
    assert.equal(ok, false, `expected rejection but validated: ${name}`);
  });
}

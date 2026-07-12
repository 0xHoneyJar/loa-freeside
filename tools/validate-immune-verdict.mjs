#!/usr/bin/env node
// =============================================================================
// tools/validate-immune-verdict.mjs — NFR-7 enforcement: validate ONE immune
// sensor verdict record against grimoires/loa/schemas/immune-verdict.schema.json.
//
//   exit 0 = valid   (the record ships)
//   exit 1 = invalid (the record does NOT ship — SDD §3.1)
//   exit 2 = usage/IO error (bad JSON in, schema unreadable) — never a false "valid"
//
// Usage:
//   node tools/validate-immune-verdict.mjs --json '<record>'   # record as arg
//   echo '<record>' | node tools/validate-immune-verdict.mjs   # record on stdin
//
// ajv 8.18 + ajv-formats are already root deps (for the date-time format).
// =============================================================================
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = join(HERE, '..', 'grimoires', 'loa', 'schemas', 'immune-verdict.schema.json');

function die(code, msg) {
  process.stderr.write(`validate-immune-verdict: ${msg}\n`);
  process.exit(code);
}

// Read the record from --json <record> (or bare arg) or from stdin.
function readRecord() {
  const args = process.argv.slice(2);
  const i = args.indexOf('--json');
  if (i !== -1) {
    if (i + 1 >= args.length) die(2, '--json requires a JSON record argument');
    return args[i + 1];
  }
  if (args.length === 1) return args[0];
  return readFileSync(0, 'utf8'); // stdin
}

let schema;
try {
  schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'));
} catch (e) {
  die(2, `cannot read schema at ${SCHEMA_PATH}: ${e.message}`);
}

let record;
try {
  const raw = readRecord();
  if (!raw || !raw.trim()) die(2, 'no verdict record provided (arg or stdin)');
  record = JSON.parse(raw);
} catch (e) {
  die(2, `input is not valid JSON: ${e.message}`);
}

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);

let validate;
try {
  validate = ajv.compile(schema);
} catch (e) {
  die(2, `schema failed to compile: ${e.message}`);
}

if (validate(record)) {
  process.stdout.write('valid\n');
  process.exit(0);
}

const errs = (validate.errors || [])
  .map((e) => `  ${e.instancePath || '/'} ${e.message}`)
  .join('\n');
process.stderr.write(`invalid:\n${errs}\n`);
process.exit(1);

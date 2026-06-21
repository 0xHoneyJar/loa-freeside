#!/usr/bin/env node
// =============================================================================
// validate-manifest.mjs — Sprint-1 T1/T4 · FR-0 + FR-1 (Flatline SKP-001)
// =============================================================================
// Validates tools/extraction/extraction-manifest.yaml for BOTH schema (shape)
// AND behavior (semantic invariants). Schema-alone is not enough (SKP-001): the
// manifest's whole point is to encode the FR-0 disposition rules, so the
// validator must enforce them — most importantly that a conservation/auth/
// balance assertion (classified BUG) can NEVER be parked as QUARANTINE-STRANDED.
//
// YAML parsing: node has no built-in YAML and adding an npm dep would desync the
// lockfiles, so we bridge through python3 + pyyaml (already a repo tooling dep —
// tools/lint-overlay-override-conflict.py). If python3/pyyaml is missing the
// script FAILS LOUDLY (never a silent pass — ci-sensors-must-not-be-numb).
//
// Usage:
//   node tools/extraction/validate-manifest.mjs [path]   # default: the manifest
//   node tools/extraction/validate-manifest.mjs --json    # machine-readable report
// Exit: 0 = valid, 1 = schema/behavior violation, 2 = cannot load (env/parse).
// =============================================================================
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const pathArg = args.find((a) => !a.startsWith('--'));
const MANIFEST = pathArg ? resolve(pathArg) : resolve(ROOT, 'tools/extraction/extraction-manifest.yaml');

const CLASSIFICATIONS = ['BUG', 'FLAKY', 'STRANDED', 'MIXED', 'NEEDS-BUG-CHECK', 'FIXED'];
const DISPOSITIONS = ['FIX-PLATFORM', 'QUARANTINE-STRANDED', 'STABILIZE-FLAKY', 'FIXED', 'PENDING'];

function die(code, msg) {
  if (asJson) console.log(JSON.stringify({ ok: false, fatal: msg }, null, 2));
  else console.error(`::error::${msg}`);
  process.exit(code);
}

// ── load YAML via python3 bridge ────────────────────────────────────────────
function loadManifest(p) {
  if (!existsSync(p)) die(2, `manifest not found: ${p}`);
  // default=str coerces YAML-typed dates (unquoted YYYY-MM-DD) to ISO strings.
  const py = 'import sys,yaml,json;json.dump(yaml.safe_load(open(sys.argv[1])),sys.stdout,default=str)';
  let out;
  try {
    out = execFileSync('python3', ['-c', py, p], { encoding: 'utf8' });
  } catch (e) {
    die(2, `cannot parse YAML (need python3 + pyyaml): ${e.message.split('\n')[0]}`);
  }
  try {
    return JSON.parse(out);
  } catch (e) {
    die(2, `manifest did not parse to JSON: ${e.message}`);
  }
}

// ── checks ────────────────────────────────────────────────────────────────
const errors = [];
const warnings = [];
const err = (id, m) => errors.push(`[${id}] ${m}`);
const warn = (id, m) => warnings.push(`[${id}] ${m}`);
const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
const nonEmpty = (s) => typeof s === 'string' && s.trim().length > 0;

const m = loadManifest(MANIFEST);

// ── SCHEMA ──
if (m == null || typeof m !== 'object') die(2, 'manifest root is not a mapping');
if (m.schema_version !== 1) err('SCHEMA-VER', `schema_version must be 1 (got ${JSON.stringify(m.schema_version)})`);
if (!Array.isArray(m.capabilities) || m.capabilities.length === 0) err('SCHEMA-CAPS', 'capabilities[] missing or empty');
if (!Array.isArray(m.clusters)) err('SCHEMA-CLUSTERS', 'clusters[] missing');

const caps = Array.isArray(m.capabilities) ? m.capabilities : [];
const clusters = Array.isArray(m.clusters) ? m.clusters : [];
const decisions = Array.isArray(m.decisions) ? m.decisions : [];
const quarantine = Array.isArray(m.quarantine) ? m.quarantine : [];

const capNames = new Set();
for (const [i, c] of caps.entries()) {
  const at = `capabilities[${i}]`;
  if (!nonEmpty(c?.name)) { err('CAP-NAME', `${at}.name missing`); continue; }
  capNames.add(c.name);
  if (!nonEmpty(c.destination)) err('CAP-DEST', `${at} (${c.name}) destination missing`);
  else if (c.destination !== 'STAYS-PLATFORM' && !/-api$/.test(c.destination))
    err('CAP-DEST-ENUM', `${at} (${c.name}) destination "${c.destination}" must be STAYS-PLATFORM or end in -api`);
  if (!Number.isInteger(c.phase)) err('CAP-PHASE', `${at} (${c.name}) phase must be an integer`);
  if (!nonEmpty(c.status)) err('CAP-STATUS', `${at} (${c.name}) status missing`);
}

const decisionIds = new Set(decisions.map((d) => d?.id).filter(Boolean));
for (const [i, d] of decisions.entries()) {
  const at = `decisions[${i}]`;
  for (const k of ['id', 'task', 'capability', 'outcome']) if (!nonEmpty(d?.[k])) err('DEC-FIELD', `${at}.${k} missing`);
  if (d?.capability && !capNames.has(d.capability)) err('DEC-CAP', `${at} references unknown capability "${d.capability}"`);
}

// capability.decision must resolve
for (const c of caps) {
  if (c?.decision && !decisionIds.has(c.decision))
    err('CAP-DECISION', `capability "${c.name}" decision "${c.decision}" has no entry in decisions[]`);
}

// ── CLUSTERS: schema + the cardinal behavior rule ──
const strandedFiles = new Set(); // files a quarantine entry is allowed to reference
for (const [i, cl] of clusters.entries()) {
  const at = `clusters[${i}]`;
  if (!nonEmpty(cl?.cluster)) err('CL-NAME', `${at}.cluster missing`);
  if (!nonEmpty(cl?.classification) || !CLASSIFICATIONS.includes(cl.classification))
    err('CL-CLASS', `${at} (${cl?.cluster}) classification "${cl?.classification}" not in {${CLASSIFICATIONS.join('|')}}`);
  if (!nonEmpty(cl?.disposition) || !DISPOSITIONS.includes(cl.disposition))
    err('CL-DISP', `${at} (${cl?.cluster}) disposition "${cl?.disposition}" not in {${DISPOSITIONS.join('|')}}`);
  if (cl?.capability && !capNames.has(cl.capability))
    err('CL-CAP', `${at} (${cl?.cluster}) references unknown capability "${cl.capability}"`);
  if (!nonEmpty(cl?.evidence)) warn('CL-EVIDENCE', `${at} (${cl?.cluster}) has no evidence string`);

  // B1 — THE CARDINAL RULE (FR-0): a BUG is NEVER quarantined. A conservation/
  // auth/balance assertion is BUG by definition, so a BUG→QUARANTINE pairing is
  // the masking failure the whole sprint exists to prevent.
  if (cl?.classification === 'BUG' && cl?.disposition === 'QUARANTINE-STRANDED')
    err('B1-BUG-QUARANTINED', `${at} (${cl?.cluster}) is classified BUG but disposition QUARANTINE-STRANDED — a BUG must NEVER be quarantined (FR-0)`);

  // collect the cluster identifiers that ARE legitimately stranded
  if (cl?.disposition === 'QUARANTINE-STRANDED' && nonEmpty(cl?.cluster))
    cl.cluster.split(';').forEach((t) => strandedFiles.add(t.trim()));
}

// ── QUARANTINE entries: teeth (no anonymous / eternal / masking quarantine) ──
for (const [i, q] of quarantine.entries()) {
  const at = `quarantine[${i}]`;
  if (!nonEmpty(q?.file)) { err('Q-FILE', `${at}.file missing`); continue; }
  // B5 — teeth: owner + expiry + signature + bead are mandatory
  if (!nonEmpty(q.owner)) err('B5-OWNER', `${at} (${q.file}) missing owner`);
  if (!isDate(q.expiry)) err('B5-EXPIRY', `${at} (${q.file}) expiry "${q.expiry}" must be YYYY-MM-DD`);
  if (!nonEmpty(q.stranded_signature)) err('B5-SIGNATURE', `${at} (${q.file}) missing stranded_signature (anti-masking teeth)`);
  if (!nonEmpty(q.bead)) err('B5-BEAD', `${at} (${q.file}) missing tracking bead`);
  if (q.capability && !capNames.has(q.capability)) err('Q-CAP', `${at} (${q.file}) unknown capability "${q.capability}"`);
  // B6 — a quarantined file must map to a STRANDED cluster, never a BUG/FIX one
  const tag = (q.cluster_tag || '').trim();
  if (tag && !strandedFiles.has(tag))
    err('B6-NOT-STRANDED', `${at} (${q.file}) cluster_tag "${tag}" is not a QUARANTINE-STRANDED cluster — cannot quarantine a non-stranded file`);
}

// ── report ──
const ok = errors.length === 0;
if (asJson) {
  console.log(JSON.stringify({
    ok, manifest: MANIFEST,
    counts: { capabilities: caps.length, clusters: clusters.length, decisions: decisions.length, quarantine: quarantine.length },
    errors, warnings,
  }, null, 2));
} else {
  for (const w of warnings) console.error(`::warning::${w}`);
  if (ok) {
    console.log(`✓ manifest valid — ${caps.length} capabilities, ${clusters.length} clusters, ${decisions.length} decisions, ${quarantine.length} quarantined (schema + behavior, SKP-001)`);
  } else {
    for (const e of errors) console.error(`::error::${e}`);
    console.error(`\nmanifest INVALID — ${errors.length} violation(s) in ${MANIFEST.replace(ROOT + '/', '')}`);
  }
}
process.exit(ok ? 0 : 1);

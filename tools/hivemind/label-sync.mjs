#!/usr/bin/env node
/*
 * label-sync — ensure the canonical COLON-form Hivemind labels exist in a repo,
 * and (with --migrate) collapse the bracket form into colon. DRY-RUN by default.
 * VENDORED from ~/.claude/laboratory/proposed-actions/label-sync.mjs; the only change
 * is the schema path (repo-relative, fresh-clone-safe; override with HIVEMIND_SCHEMA).
 *
 *   node label-sync.mjs <repo>                 dry-run: what labels would be created/migrated
 *   node label-sync.mjs <repo> --apply         create the canonical label set (additive, safe)
 *   node label-sync.mjs <repo> --apply --migrate   also re-label issues bracket→colon + delete bracket labels (DESTRUCTIVE)
 *
 * <repo> is the repo NAME only (org is prepended). e.g. `node label-sync.mjs loa-freeside`.
 * Run order: the auto-label Action (path) lands FIRST. Then --apply (additive). Then,
 * after operator confirms scope, --migrate (the destructive collapse). Never lead with migrate.
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dir = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const repo = args.find(a => !a.startsWith('--'));
const APPLY = args.includes('--apply');
const MIGRATE = args.includes('--migrate');
if (!repo) { console.error('usage: label-sync.mjs <repo> [--apply] [--migrate]'); process.exit(1); }
const ORG = '0xHoneyJar';
// vendored for fresh-clone (the Cloud Routine has no ~/.claude); override with HIVEMIND_SCHEMA
const SCHEMA = process.env.HIVEMIND_SCHEMA || join(__dir, 'hivemind-labels.v1.0.json');
const schema = JSON.parse(readFileSync(SCHEMA, 'utf8'));
const E = (f) => schema.properties?.[f]?.enum || [];

// the canonical colon-form label set (dim:value), with the GH label key per dimension
const DIMS = [['workstream', 'workstream'], ['artifact_type', 'artifact-type'], ['priority', 'priority']];
const canonical = [];
for (const [schemaKey, labelKey] of DIMS) for (const v of E(schemaKey)) canonical.push(`${labelKey}:${v}`);

const sh = (c) => { try { return execSync(c, { encoding: 'utf8', stdio: ['pipe','pipe','pipe'] }); } catch (e) { return ''; } };
const existing = sh(`gh label list --repo ${ORG}/${repo} --limit 300 --json name --jq '.[].name'`).split('\n').filter(Boolean);
// normalize the space-colon variant ("workstream: x" → "workstream:x") so --apply never
// creates a duplicate of a label that already exists in space form (the 4th-variant finding).
const norm = (l) => l.replace(/^(workstream|artifact-type|priority):\s+/i, '$1:');
const existingNorm = new Set(existing.map(norm));
const spaceVariants = existing.filter(l => /^(workstream|artifact-type|priority):\s+/i.test(l));
// M3: create on EXACT absence. Normalizing space→no-space made the canonical no-space
// label look "present" when only the space-form existed, so it was never created (and the
// rest of the toolchain then failed to apply the no-space label). existingNorm/spaceVariants
// stay for listing migration candidates only — never for skipping creation.
const existingExact = new Set(existing);
const toCreate = canonical.filter(l => !existingExact.has(l));
// bracket labels present (the migration source) — [W]/[A]/[PR] prefixed
const bracket = existing.filter(l => /^\[[AWP]R?\]\s/i.test(l) || /^\[(W|A|PR)\]/i.test(l));

console.log(`\n▸ ${ORG}/${repo}`);
console.log(`  canonical colon labels: ${canonical.length} · already present: ${canonical.length - toCreate.length} · to create: ${toCreate.length}`);
if (toCreate.length) console.log(`    + ${toCreate.slice(0, 6).join(', ')}${toCreate.length > 6 ? ` … +${toCreate.length - 6}` : ''}`);
if (bracket.length) console.log(`  bracket labels (migration source): ${bracket.length} → ${bracket.slice(0,5).join(', ')}${bracket.length>5?' …':''}`);

if (APPLY) {
  let n = 0;
  for (const l of toCreate) { sh(`gh label create ${JSON.stringify(l)} --repo ${ORG}/${repo} --color ededed --description "Hivemind taxonomy" --force`); n++; }
  console.log(`  ${'\x1b[32m'}✓ created ${n} canonical labels${'\x1b[0m'}`);
  if (MIGRATE && bracket.length) {
    console.log(`  ${'\x1b[33m'}--migrate: would re-label issues bracket→colon + delete ${bracket.length} bracket labels (run the per-repo migration script)${'\x1b[0m'}`);
  }
} else {
  console.log(`  ${'\x1b[2m'}DRY-RUN — run with --apply to create the canonical set (additive) · --apply --migrate to collapse bracket${'\x1b[0m'}`);
}

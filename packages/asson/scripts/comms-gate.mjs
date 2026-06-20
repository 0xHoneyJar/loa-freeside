#!/usr/bin/env node
/**
 * comms-gate.mjs — THREE INDEPENDENT LINTERS at one gate (cycle 5, AS-9 / B5).
 *
 * The competitive-REL comms boundary screens three ORTHOGONAL registers, each a
 * SEPARATE process with its own exit — NO orchestration, NO shared lexicon:
 *   1. legal register   — asson lexicon-lint (funds/custody terms, untagged testimony) [asson OWNS this]
 *   2. voice            — ai-stench-check.mjs (em dashes, "not X it's Y", delve/realm)
 *   3. product vocab    — vocabulary-bank (off-brand terms)                            [construct]
 * The gate ORs their exits: ANY linter flags → the boundary is blocked. asson owns
 * only the legal register; it never reaches into the other two's judgment. A linter
 * that isn't installed is SKIPPED (reported), never a silent pass.
 *
 * Usage: node comms-gate.mjs <comms-file>   → exit 0 clean · 1 blocked (≥1 linter flagged)
 * Linter paths override via ASSON_AISTENCH / ASSON_VOCABBANK (test isolation).
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const file = process.argv[2];
if (!file || !existsSync(file)) {
  console.error('usage: comms-gate.mjs <comms-file>');
  process.exit(2);
}
const text = readFileSync(file, 'utf8');

// Each linter runs INDEPENDENTLY in its own process; the gate reads only its exit code.
const linters = [
  {
    name: 'legal-register (asson)',
    run() {
      const bin = join(__dirname, '..', 'examples', 'lexicon-lint', 'bin', 'lexicon-lint.mjs');
      try {
        execFileSync('node', [bin], { input: JSON.stringify({ text, rel: 'competitive' }), encoding: 'utf8' });
        return { available: true, flagged: false };
      } catch (e) {
        return { available: true, flagged: e.status === 3, exit: e.status };
      }
    },
  },
  {
    name: 'voice (ai-stench)',
    run() {
      const bin = process.env.ASSON_AISTENCH || join(homedir(), '.claude', 'scripts', 'ai-stench-check.mjs');
      if (!existsSync(bin)) return { available: false };
      try {
        execFileSync('node', [bin], { input: text, encoding: 'utf8' });
        return { available: true, flagged: false };
      } catch (e) {
        return { available: true, flagged: e.status === 1, exit: e.status };
      }
    },
  },
  {
    name: 'product-vocab (vocabulary-bank)',
    run() {
      const bin = process.env.ASSON_VOCABBANK;
      if (!bin || !existsSync(bin)) return { available: false };
      try {
        execFileSync('node', [bin, file], { encoding: 'utf8' });
        return { available: true, flagged: false };
      } catch (e) {
        return { available: true, flagged: e.status !== 0, exit: e.status };
      }
    },
  },
];

let anyFlagged = false;
let ran = 0;
for (const l of linters) {
  const r = l.run();
  if (!r.available) {
    console.log(`  ~ ${l.name}: unavailable (skipped, not a pass)`);
    continue;
  }
  ran++;
  if (r.flagged) {
    anyFlagged = true;
    console.log(`  ✗ ${l.name}: FLAGGED (exit ${r.exit})`);
  } else {
    console.log(`  ✓ ${l.name}: clean`);
  }
}
console.log(`comms-gate: ${ran} linter(s) ran → ${anyFlagged ? 'BLOCKED' : 'clean'}`);
process.exit(anyFlagged ? 1 : 0);

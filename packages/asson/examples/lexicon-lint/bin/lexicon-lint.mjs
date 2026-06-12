#!/usr/bin/env node
// lexicon-lint — the cheapest gate in the stack: controlled-vocabulary linting for
// competitive-REL text. Reads JSON {text, rel?} on stdin, emits findings on stdout.
// re_executable: lexicon is data beside the bin (part of the attested tree), no ambient.
// Exit codes: 0 clean (or casual REL: findings are warn-tier), 3 findings at competitive REL,
// 2 malformed input. Findings carry replacements — refusals must teach.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const lexicon = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../data/lexicon.json'), 'utf8'));
let raw = '';
process.stdin.on('data', c => raw += c);
process.stdin.on('end', () => {
  let input;
  try { input = JSON.parse(raw); } catch { console.error('lexicon-lint: stdin must be JSON {text, rel?}'); process.exit(2); }
  if (typeof input.text !== 'string') { console.error('lexicon-lint: missing field "text"'); process.exit(2); }
  const rel = input.rel === 'casual' ? 'casual' : 'competitive';   // undeclared = competitive (fail-closed)
  const text = input.text; const lower = text.toLowerCase();
  const findings = [];

  for (const b of lexicon.banned) {
    const re = new RegExp('\\b' + b.term.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&') + '\\b', 'gi');
    for (const m of text.matchAll(re)) findings.push({
      type: 'banned_term', term: b.term, index: m.index,
      replacement: b.replacements.join(' | '), why: b.why,
    });
  }
  for (const h of lexicon.hedges) {
    const re = new RegExp('\\b' + h + '\\b', 'gi');
    for (const m of text.matchAll(re)) {
      const window = lower.slice(Math.max(0, m.index - 60), m.index + h.length + 60);
      if (!window.includes('[testimony:')) findings.push({
        type: 'untagged_testimony', term: h, index: m.index,
        replacement: `${h} [testimony: <person>, conf=<L/M/H>]`,
        why: 'hedged claims are testimony; untagged repetition launders testimony into fact',
      });
    }
  }
  findings.sort((a, b) => a.index - b.index);
  process.stdout.write(JSON.stringify({ rel, clean: findings.length === 0, findings }));
  process.exit(findings.length && rel === 'competitive' ? 3 : 0);
});

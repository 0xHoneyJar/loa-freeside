// instrument-truth-sensor.test.mjs — the meta-immune doctor's teeth.
//
// Expresses the divergence-detection CONTRACT with synthetic fixture records (no live files,
// no cheval, no hang). Asserts the three named cases from bead arrakis-estate-immune-epic-4xw6.1:
//   (a) a voice with recent finals but ABSENT from the probe table   -> INVISIBLE (lying)
//   (b) a voice the probe calls down/unknown but with fresh finals    -> DIVERGENT (lying)
//   (c) all-consistent                                                -> TRUTHFUL / exit 0
// plus the false-positive GUARD that makes the sensor honest:
//   (d) a voice the probe calls down that is genuinely STALE          -> CONSISTENT (NOT lying)
//   (e) the inverse lie: probe calls up, voice has gone silent        -> FALSE_HEALTHY (lying)
//
// Run: node tools/instrument-truth-sensor.test.mjs   (or: node --test tools/instrument-truth-sensor.test.mjs)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  voiceOf,
  analyzeVoiceTruth,
  DEFAULT_FRESHNESS_MS,
} from './instrument-truth-sensor.mjs';

// ── fixture builders ────────────────────────────────────────────────────────
// one MODELINV-shaped record; a successful "final" carries payload.final_model_id.
const SAMPLE_MODEL = {
  claude: 'anthropic:claude-headless',
  codex: 'openai:codex-headless',
  gemini: 'google:gemini-headless',
  cursor: 'cursor:cursor-headless',
  grok: 'xai:grok-build',
};
const rec = (voice, tsUtc, { final = true } = {}) => ({
  primitive_id: 'MODELINV',
  event_type: 'model.invoke.complete',
  ts_utc: tsUtc,
  payload: { final_model_id: final ? SAMPLE_MODEL[voice] : null },
});

const DAY = 86_400_000;
const NOW = '2026-06-26T12:00:00.000Z';
const nowMs = Date.parse(NOW);
const ago = (days) => new Date(nowMs - days * DAY).toISOString();

// ── voiceOf: provider-prefix -> canonical cheval voice ──────────────────────
test('voiceOf maps every observed provider prefix to a canonical voice', () => {
  assert.equal(voiceOf('anthropic:claude-headless'), 'claude');
  assert.equal(voiceOf('anthropic:claude-opus-4-8'), 'claude');
  assert.equal(voiceOf('bedrock:us.anthropic.claude-opus-4-8'), 'claude'); // anthropic via bedrock
  assert.equal(voiceOf('openai:codex-headless'), 'codex');
  assert.equal(voiceOf('google:gemini-headless'), 'gemini');
  assert.equal(voiceOf('cursor:cursor-headless'), 'cursor');
  assert.equal(voiceOf('xai:grok-build'), 'grok');
  assert.equal(voiceOf(null), null);
  assert.equal(voiceOf(''), null);
});

// ── (a) INVISIBLE: live voice the probe doesn't even list ───────────────────
test('(a) a fresh voice ABSENT from the probe table is flagged INVISIBLE (lying)', () => {
  const records = [rec('codex', ago(0.5)), rec('cursor', ago(0.5))];
  const probeTable = { codex: 'up' }; // cursor invisible to the probe
  const r = analyzeVoiceTruth({ records, probeTable, now: NOW });
  const cursor = r.voices.find((v) => v.voice === 'cursor');
  assert.equal(cursor.classification, 'INVISIBLE');
  assert.equal(cursor.lying, true);
  assert.equal(cursor.finals, 1);
  assert.deepEqual(r.lyingInstruments.map((v) => v.voice), ['cursor']);
  assert.equal(r.verdict, 'LYING');
  assert.equal(r.exitCode, 2);
});

// ── (b) DIVERGENT: probe says down/unknown, ground truth says alive ─────────
test('(b) a voice the probe calls "unknown" with fresh finals is flagged DIVERGENT (lying)', () => {
  const records = [rec('claude', ago(1.5)), rec('codex', ago(0.5))];
  const probeTable = { claude: 'unknown', codex: 'up' }; // the doctor.py probe artifact
  const r = analyzeVoiceTruth({ records, probeTable, now: NOW });
  const claude = r.voices.find((v) => v.voice === 'claude');
  assert.equal(claude.classification, 'DIVERGENT');
  assert.equal(claude.declared, 'unknown');
  assert.equal(claude.fresh, true);
  assert.equal(claude.lying, true);
  assert.equal(r.exitCode, 2);
});

test('(b′) "down" + fresh is also DIVERGENT', () => {
  const records = [rec('claude', ago(1))];
  const r = analyzeVoiceTruth({ records, probeTable: { claude: 'down' }, now: NOW });
  assert.equal(r.voices.find((v) => v.voice === 'claude').classification, 'DIVERGENT');
  assert.equal(r.exitCode, 2);
});

// ── (c) all-consistent -> TRUTHFUL / exit 0 ─────────────────────────────────
test('(c) declared health matching ground truth across all voices -> TRUTHFUL / exit 0', () => {
  const records = [rec('codex', ago(0.5)), rec('claude', ago(1))];
  const probeTable = { codex: 'up', claude: 'up' };
  const r = analyzeVoiceTruth({ records, probeTable, now: NOW });
  assert.equal(r.verdict, 'TRUTHFUL');
  assert.equal(r.exitCode, 0);
  assert.equal(r.lyingInstruments.length, 0);
  for (const v of r.voices) assert.equal(v.classification, 'CONSISTENT');
});

// ── (d) the false-positive GUARD: a genuinely-dead voice is NOT a lying instrument ──
test('(d) probe="down" + STALE finals (genuinely dead, e.g. gemini) is CONSISTENT, NOT flagged', () => {
  // gemini-shaped: it has finals, but the last one is well outside the freshness window.
  const records = [rec('gemini', ago(9)), rec('codex', ago(0.5))];
  const probeTable = { gemini: 'down', codex: 'up' };
  const r = analyzeVoiceTruth({ records, probeTable, now: NOW });
  const gemini = r.voices.find((v) => v.voice === 'gemini');
  assert.equal(gemini.fresh, false);
  assert.equal(gemini.finals, 1, 'still counts the historical final');
  assert.equal(gemini.classification, 'CONSISTENT');
  assert.equal(gemini.lying, false, 'legitimately down is divergence-free, not a lie');
  assert.equal(r.exitCode, 0);
});

// ── (e) the inverse lie: probe="up" but the voice has gone silent ────────────
test('(e) probe="up" + STALE finals is FALSE_HEALTHY (the inverse lie, also flagged)', () => {
  const records = [rec('grok', ago(20)), rec('codex', ago(0.5))];
  const probeTable = { grok: 'up', codex: 'up' };
  const r = analyzeVoiceTruth({ records, probeTable, now: NOW });
  const grok = r.voices.find((v) => v.voice === 'grok');
  assert.equal(grok.classification, 'FALSE_HEALTHY');
  assert.equal(grok.lying, true);
  assert.equal(r.exitCode, 2);
});

test('(e′) probe="up" for a voice with ZERO finals ever is FALSE_HEALTHY', () => {
  const records = [rec('codex', ago(0.5))];
  const probeTable = { codex: 'up', grok: 'up' }; // grok declared up but never produced a final
  const r = analyzeVoiceTruth({ records, probeTable, now: NOW });
  const grok = r.voices.find((v) => v.voice === 'grok');
  assert.equal(grok.finals, 0);
  assert.equal(grok.classification, 'FALSE_HEALTHY');
  assert.equal(r.exitCode, 2);
});

// ── a voice that is both invisible AND inactive is NOT a lie (nothing claims/does anything) ──
test('a stale, ABSENT voice is DARK and not flagged (no claim, no activity)', () => {
  const records = [rec('codex', ago(0.5)), rec('gemini', ago(30))];
  const probeTable = { codex: 'up' }; // gemini absent AND ancient
  const r = analyzeVoiceTruth({ records, probeTable, now: NOW });
  const gemini = r.voices.find((v) => v.voice === 'gemini');
  assert.equal(gemini.classification, 'DARK');
  assert.equal(gemini.lying, false);
  assert.equal(r.exitCode, 0);
});

// ── records with no final (failed invocations) don't manufacture a voice ────
test('records with final_model_id=null contribute no successful final', () => {
  const records = [rec('cursor', ago(0.5), { final: false }), rec('codex', ago(0.5))];
  const r = analyzeVoiceTruth({ records, probeTable: { codex: 'up' }, now: NOW });
  // cursor only ever had a null-final record -> never seen as a live voice -> not present
  assert.equal(r.voices.find((v) => v.voice === 'cursor'), undefined);
  assert.equal(r.exitCode, 0);
});

// ── `now` defaults to the newest record ts (robust against a stale log snapshot) ──
test('now defaults to the newest record ts when omitted', () => {
  // newest record is gemini @ -? ; build so the newest is codex, claude lags by 1.5d.
  const records = [rec('claude', '2026-06-24T00:00:00.000Z'), rec('codex', '2026-06-25T12:00:00.000Z')];
  const r = analyzeVoiceTruth({ records, probeTable: { claude: 'unknown', codex: 'up' } });
  assert.equal(r.reference, '2026-06-25T12:00:00.000Z');
  // claude lags the newest record by 1.5d < 3d default -> still fresh -> DIVERGENT against "unknown"
  assert.equal(r.voices.find((v) => v.voice === 'claude').fresh, true);
  assert.equal(r.exitCode, 2);
});

// ── freshness window is configurable; the default is the documented 3 days ──
test('freshnessMs default is 3 days and is honored', () => {
  assert.equal(DEFAULT_FRESHNESS_MS, 3 * DAY);
  const records = [rec('claude', ago(5)), rec('codex', ago(0.5))];
  // with a 7-day window claude @5d is fresh -> DIVERGENT; with the 3-day default it is stale -> CONSISTENT
  const wide = analyzeVoiceTruth({ records, probeTable: { claude: 'unknown', codex: 'up' }, now: NOW, freshnessMs: 7 * DAY });
  assert.equal(wide.voices.find((v) => v.voice === 'claude').classification, 'DIVERGENT');
  const narrow = analyzeVoiceTruth({ records, probeTable: { claude: 'unknown', codex: 'up' }, now: NOW });
  assert.equal(narrow.voices.find((v) => v.voice === 'claude').classification, 'CONSISTENT');
});

// ── I/O shell: exit-code-IS-the-verdict contract (the seam where the tool meets the OS) ──
// "exit-code-is-the-verdict" means the thin shell IS the contract. These spawn the real script and
// pin the fail-closed input contract: nothing that fails to parse may EVER produce a clean verdict.
// All bad-input paths must route through the same die(... INSUFFICIENT)/exit-1 the log path honors.
const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'instrument-truth-sensor.mjs');
const LINE = (voice, tsUtc) => JSON.stringify(rec(voice, tsUtc));
const runScript = (args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
const withFixtures = (fn) => {
  const dir = mkdtempSync(join(tmpdir(), 'instrument-truth-'));
  try { return fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
};
const writeLog = (dir, lines) => {
  const p = join(dir, 'log.jsonl');
  writeFileSync(p, lines.join('\n') + '\n');
  return p;
};
const writeProbe = (dir, value) => {
  const p = join(dir, 'probe.json');
  writeFileSync(p, typeof value === 'string' ? value : JSON.stringify(value));
  return p;
};

test('[shell] a consistent log + probe-table -> exit 0 TRUTHFUL', () => withFixtures((dir) => {
  const log = writeLog(dir, [LINE('codex', ago(0.5))]);
  const probe = writeProbe(dir, { codex: 'up' });
  const r = runScript([`--log=${log}`, `--probe-table=${probe}`, `--now=${NOW}`, '--json']);
  assert.equal(r.status, 0, r.stderr);
}));

test('[shell] a divergent log + probe-table -> exit 2 LYING', () => withFixtures((dir) => {
  const log = writeLog(dir, [LINE('claude', ago(0.5))]);
  const probe = writeProbe(dir, { claude: 'unknown' }); // declared unknown, but fresh finals -> DIVERGENT
  const r = runScript([`--log=${log}`, `--probe-table=${probe}`, `--now=${NOW}`, '--probe']);
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stdout, /LYING/);
}));

test('[shell] missing log file -> exit 1 INSUFFICIENT', () => withFixtures((dir) => {
  const r = runScript([`--log=${join(dir, 'does-not-exist.jsonl')}`, `--now=${NOW}`]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /INSUFFICIENT/);
}));

test('[shell] empty log (no records) -> exit 1 INSUFFICIENT', () => withFixtures((dir) => {
  const log = join(dir, 'empty.jsonl');
  writeFileSync(log, '');
  const r = runScript([`--log=${log}`, `--now=${NOW}`]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /INSUFFICIENT/);
}));

test('[shell] malformed --probe-table JSON -> exit 1 INSUFFICIENT (not a raw stack trace)', () => withFixtures((dir) => {
  const log = writeLog(dir, [LINE('codex', ago(0.5))]);
  const probe = writeProbe(dir, '{ not valid json');
  const r = runScript([`--log=${log}`, `--probe-table=${probe}`, `--now=${NOW}`]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /INSUFFICIENT/);
}));

test('[shell] --probe-table that parses to a JSON ARRAY -> exit 1 INSUFFICIENT (shape guard)', () => withFixtures((dir) => {
  const log = writeLog(dir, [LINE('codex', ago(0.5))]);
  const probe = writeProbe(dir, ['codex', 'up']); // typeof [] === 'object' footgun
  const r = runScript([`--log=${log}`, `--probe-table=${probe}`, `--now=${NOW}`]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /INSUFFICIENT/);
}));

test('[shell] missing --probe-table file -> exit 1 INSUFFICIENT', () => withFixtures((dir) => {
  const log = writeLog(dir, [LINE('codex', ago(0.5))]);
  const r = runScript([`--log=${log}`, `--probe-table=${join(dir, 'nope.json')}`, `--now=${NOW}`]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /INSUFFICIENT/);
}));

test('[shell] --freshness-days=abc (NaN) -> exit 1 INSUFFICIENT, never a false clean verdict', () => withFixtures((dir) => {
  const log = writeLog(dir, [LINE('codex', ago(0.5))]);
  const r = runScript([`--log=${log}`, '--freshness-days=abc', `--now=${NOW}`]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /INSUFFICIENT/);
}));

test('[shell] --now=garbage (unparseable date) -> exit 1 INSUFFICIENT', () => withFixtures((dir) => {
  const log = writeLog(dir, [LINE('codex', ago(0.5))]);
  const r = runScript([`--log=${log}`, '--now=garbage']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /INSUFFICIENT/);
}));

test('[shell] a frozen/stale log surfaces the stale-log warning (wall-clock anchor)', () => withFixtures((dir) => {
  // newest record is 30d before NOW; anchored to wall-clock (NOW), the whole log is stale.
  const log = writeLog(dir, [LINE('codex', ago(30))]);
  const probe = writeProbe(dir, { codex: 'up' }); // declared up but silent for 30d -> FALSE_HEALTHY
  const r = runScript([`--log=${log}`, `--probe-table=${probe}`, `--now=${NOW}`, '--probe']);
  assert.equal(r.status, 2, r.stderr); // outage IS detectable now (was the bridge-002 blind spot)
  assert.match(r.stdout, /log stale/);
}));

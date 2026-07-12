#!/usr/bin/env node
/**
 * instrument-truth-sensor.mjs — the meta-immune DOCTOR (read-only).
 *
 * Campaign: Estate Immune System · M0 / G-IMMUNE ("every verdict/health/goal/sensor re-derives
 * from a ground source; 0 lying instruments"). Bead: arrakis-estate-immune-epic-4xw6.1.
 * Pattern hoisted from ~/bonfire/gate-freeze.mjs — PURE testable core + thin I/O wrapper,
 * exit-code-IS-the-verdict, board/json/probe renderers, false-positive guard documented in-code.
 *
 * WHAT IT DETECTS — lying instruments. A health/verdict instrument whose DECLARED state diverges
 * from GROUND TRUTH. The verified first instance: cheval voice health. The static cheval doctor
 * (doctor.py) MISREPORTS the council — it calls `claude` "unknown" (a `--max-budget-usd 0.001`
 * probe artifact) while `.run/model-invoke.jsonl` shows ~500 successful finals, and it is BLIND to
 * `cursor` (45 fresh finals, the real idle capacity) which never appears in its probe table at all.
 * This sensor re-derives each voice's REAL health from the audit log (the ground source) and flags
 * any voice the static doctor would misreport.
 *
 * Operationalizes the operator's standing immune doctrine:
 *   - declaration != ground-truth, and the machine trusts the declaration  ([[map-territory-drift-unifying-failure]])
 *   - a gate's verdict is a number you read, not a vibe                     ([[gate-output-never-piped]])
 *   - exists != wired != runs != enforces                                  ([[verification-ladder-exists-to-verified]])
 *   - a check is INSUFFICIENT, not "clean", when it has no evidence        (absence of evidence != proof)
 *
 * THE FALSE-POSITIVE GUARD (the honest core): a voice that is legitimately DOWN is NOT a lying
 * instrument. Only a DIVERGENCE between what the probe declares and what the ground truth shows is
 * a lie. `gemini` is genuinely dead (Google retired the CLI; ~9 days since its last final) and the
 * probe correctly calls it "down" → CONSISTENT, NOT flagged. We flag the divergence, never the
 * outage. The inverse lie (probe says "up" but the voice has gone silent → FALSE_HEALTHY) is just
 * as dishonest and is also flagged.
 *
 * Read-only. Reads ONLY `.run/model-invoke.jsonl` — never invokes doctor.py or any slow/hanging
 * external command. Born from the morning-leverage ground-truth (2026-06-26).
 *
 * Usage:
 *   node tools/instrument-truth-sensor.mjs                 # human board (default log + static probe)
 *   node tools/instrument-truth-sensor.mjs --json          # machine
 *   node tools/instrument-truth-sensor.mjs --probe         # one-line STATUS tile (banner-style)
 *   node tools/instrument-truth-sensor.mjs --log=PATH      # point at a specific audit log
 *   node tools/instrument-truth-sensor.mjs --probe-table=FILE.json   # override the declared probe
 *   node tools/instrument-truth-sensor.mjs --freshness-days=N        # active window (default 3)
 *   node tools/instrument-truth-sensor.mjs --now=ISO                 # freshness anchor (default: WALL-CLOCK)
 *
 * Exit code is the verdict (so it can gate):
 *   0 = TRUTHFUL  (every instrument's declaration matches ground truth)
 *   2 = LYING     (>=1 instrument's declaration diverges from ground truth)
 *   1 = INSUFFICIENT / operational error (no ground-truth records, unreadable log) — never asserts
 *       "truthful" without evidence (that would be the very numbness this sensor exists to catch).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const DAY_MS = 86_400_000;
export const DEFAULT_FRESHNESS_MS = 3 * DAY_MS; // a voice is ACTIVE if it produced a final in this window
// Bounds how many lines are PARSED (the recent tail). The file READ itself is NOT bounded by this:
// readRecords() reads the whole file via readFileSync, then keeps only the last MAX_RECORDS lines to
// parse. Fine for the small audit log today; if this is ever pointed at a full audit stream, switch
// readRecords to an EOF-seeking byte-capped tail so the memory envelope matches this intent.
const MAX_RECORDS = 20_000;

// provider prefix (left of the first ':') -> canonical cheval voice. anthropic-via-bedrock is claude.
export const PROVIDER_VOICE = {
  anthropic: 'claude',
  bedrock: 'claude',
  openai: 'codex',
  google: 'gemini',
  cursor: 'cursor',
  xai: 'grok',
};

/**
 * AS-OF date of STATIC_DOCTOR_PROBE. Surfaced in every render so the declaration's STATIC nature is
 * first-class: this is a frozen snapshot, NOT a live read of doctor.py. A frozen baseline measures
 * the age of the baseline as much as the thing — so we make that age visible (and offer
 * --probe-table=FILE.json to re-ground) rather than letting the constant silently drift.
 */
export const STATIC_DOCTOR_PROBE_AS_OF = '2026-06-26';

/**
 * The STATIC cheval doctor's DECLARED coverage — the *declaration* side this sensor checks against
 * ground truth. This is a CONFIG constant (the probe's known coverage + verdicts as observed
 * 2026-06-26, GECKO-derived), NOT a live probe — invoking doctor.py here would hang. Override with
 * --probe-table=FILE.json to re-ground.
 *
 * The keys MIRROR doctor.py's contract-pinned `_PROBE_TABLE` — exactly {claude, codex, gemini}
 * (test_doctor.py::TestProbeTableContract). The new-company headless adapters (`cursor`, `grok`) are
 * deliberately ABSENT here BECAUSE they are absent from doctor.py's probe table — each ships its own
 * adapter-level health_check() instead. That invisibility is exactly the lie this sensor surfaces:
 * if such a voice produces fresh finals, it reads as INVISIBLE (a live-but-unlisted lie of omission);
 * if it is silent, it reads as DARK (nothing claimed, nothing done). Declaring `grok: 'up'` here
 * would instead MANUFACTURE a FALSE_HEALTHY whenever grok is idle — a self-inflicted false positive
 * about the constant, not a real lying instrument.
 */
export const STATIC_DOCTOR_PROBE = Object.freeze({
  claude: 'unknown', // probe artifact — reports unknown despite a live workhorse
  codex: 'up',
  gemini: 'down', // genuinely dead — the probe is correct here
  // cursor, grok: (absent — not in doctor.py's contract-pinned probe table)
});

const CLAIMS_HEALTHY = new Set(['up', 'healthy', 'ok']);

/** canonical voice for a MODELINV final_model_id, or null if unmappable/absent. */
export function voiceOf(modelId) {
  if (!modelId || typeof modelId !== 'string') return null;
  const prov = modelId.split(':', 1)[0];
  return PROVIDER_VOICE[prov] || null;
}

/**
 * Re-derive each voice's REAL health from already-parsed MODELINV records (the ground source).
 * Only a record carrying payload.final_model_id counts as a successful final.
 * @returns Map<voice, { finals, lastSuccessTs, lastSuccessMs }>
 */
export function deriveGroundTruth(records) {
  const truth = new Map();
  for (const r of records) {
    const fm = r?.payload?.final_model_id;
    const voice = voiceOf(fm);
    if (!voice) continue; // no successful final / unmappable
    const ts = r?.ts_utc || '';
    const ms = ts ? Date.parse(ts) : NaN;
    const cur = truth.get(voice) || { finals: 0, lastSuccessTs: null, lastSuccessMs: -Infinity };
    cur.finals += 1;
    if (Number.isFinite(ms) && ms > cur.lastSuccessMs) {
      cur.lastSuccessMs = ms;
      cur.lastSuccessTs = ts;
    }
    truth.set(voice, cur);
  }
  return truth;
}

/** newest ts_utc across records (the log's "present"), or null. */
export function newestTs(records) {
  let max = '';
  for (const r of records) {
    const ts = r?.ts_utc || '';
    if (ts > max) max = ts;
  }
  return max || null;
}

/**
 * THE PURE CORE. Compare the declared probe table against re-derived ground truth; classify each
 * voice; return the divergence verdict. No I/O — feed it fixture records in tests.
 *
 * @param {object[]} records   parsed MODELINV records
 * @param {Record<string,string>} probeTable  declared voice -> status ('up'|'down'|'unknown'|...).
 *        A voice ABSENT from the table is "invisible to the probe".
 * @param {string} [now]       ISO anchor for freshness; defaults to the newest record ts.
 * @param {number} [freshnessMs]  active window; defaults to DEFAULT_FRESHNESS_MS (3d).
 */
export function analyzeVoiceTruth({ records = [], probeTable = STATIC_DOCTOR_PROBE, now, freshnessMs = DEFAULT_FRESHNESS_MS } = {}) {
  const reference = now || newestTs(records);
  const refMs = reference ? Date.parse(reference) : NaN;
  const truth = deriveGroundTruth(records);

  // union of voices SEEN in the ground truth and voices DECLARED by the probe (so a declared-up
  // voice that never produced a final is still examined → FALSE_HEALTHY).
  const voiceNames = new Set([...truth.keys(), ...Object.keys(probeTable)]);

  const voices = [...voiceNames].map((voice) => {
    const g = truth.get(voice) || { finals: 0, lastSuccessTs: null, lastSuccessMs: -Infinity };
    const declaredRaw = Object.prototype.hasOwnProperty.call(probeTable, voice) ? probeTable[voice] : undefined;
    const declared = declaredRaw === undefined ? 'ABSENT' : declaredRaw;
    const ageMs = Number.isFinite(g.lastSuccessMs) && Number.isFinite(refMs) ? refMs - g.lastSuccessMs : Infinity;
    // fresh = produced a final within the active window of the reference. A final newer than the
    // reference (negative age) is trivially fresh; a never-seen voice (Infinity) is not.
    const fresh = g.lastSuccessTs != null && ageMs <= freshnessMs;

    let classification;
    if (declaredRaw === undefined) {
      // probe doesn't list this voice at all
      classification = fresh ? 'INVISIBLE' : 'DARK'; // live+unlisted = lie of omission; dead+unlisted = nothing claimed, nothing done
    } else if (CLAIMS_HEALTHY.has(String(declaredRaw).toLowerCase())) {
      classification = fresh ? 'CONSISTENT' : 'FALSE_HEALTHY'; // declared up: lie iff actually silent
    } else {
      // declared down/unknown/degraded: lie iff actually alive
      classification = fresh ? 'DIVERGENT' : 'CONSISTENT'; // the GUARD: genuinely-down stays CONSISTENT
    }
    const lying = classification === 'INVISIBLE' || classification === 'DIVERGENT' || classification === 'FALSE_HEALTHY';

    return {
      voice,
      finals: g.finals,
      lastSuccessTs: g.lastSuccessTs,
      ageDays: Number.isFinite(ageMs) ? Math.round((ageMs / DAY_MS) * 10) / 10 : null,
      fresh,
      declared,
      classification,
      lying,
    };
  }).sort((a, b) => b.finals - a.finals || a.voice.localeCompare(b.voice));

  const lyingInstruments = voices.filter((v) => v.lying);
  const verdict = lyingInstruments.length ? 'LYING' : 'TRUTHFUL';
  return {
    reference,
    freshnessMs,
    voices,
    lyingInstruments,
    verdict,
    exitCode: lyingInstruments.length ? 2 : 0,
  };
}

// ── I/O wrapper (the thin shell) ────────────────────────────────────────────

const ARGS = process.argv.slice(2);
const argVal = (k) => {
  const hit = ARGS.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.slice(k.length + 3) : undefined;
};
const MODE = ARGS.includes('--json') ? 'json' : ARGS.includes('--probe') ? 'probe' : 'board';

function defaultLogPath() {
  // tools/ -> repo-root/.run/model-invoke.jsonl
  return fileURLToPath(new URL('../.run/model-invoke.jsonl', import.meta.url));
}

/** read + parse a bounded tail of the MODELINV jsonl. throws only on unreadable file. */
export function readRecords(logPath) {
  const text = readFileSync(logPath, 'utf8');
  const lines = text.split('\n').filter((l) => l.trim());
  const tail = lines.length > MAX_RECORDS ? lines.slice(-MAX_RECORDS) : lines;
  const out = [];
  for (const line of tail) {
    try { out.push(JSON.parse(line)); } catch { /* skip a malformed line — robustness, never crash */ }
  }
  return out;
}

function die(msg, code = 1) {
  console.error(`instrument-truth: ${msg}`);
  process.exit(code);
}

/**
 * Resolve the declared probe table. Same fail-closed discipline as the log read: a missing/malformed
 * --probe-table (or a parse that succeeds but yields a non-object, e.g. a JSON array — the
 * `typeof [] === 'object'` footgun) routes through die(... INSUFFICIENT), never a raw stack trace and
 * never a silently-wrong classification. Returns { probeTable, source, asOf }.
 */
function loadProbeTable() {
  const file = argVal('probe-table') || process.env.LOA_DOCTOR_PROBE_TABLE;
  if (!file) return { probeTable: STATIC_DOCTOR_PROBE, source: 'static', asOf: STATIC_DOCTOR_PROBE_AS_OF };
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    die(`cannot read/parse probe table ${file} (${e.code || e.message}) — INSUFFICIENT, refusing to assert "truthful" without evidence`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    die(`probe table ${file} is not a JSON object (expected a voice -> status map) — INSUFFICIENT, refusing to assert "truthful" without evidence`);
  }
  return { probeTable: parsed, source: file, asOf: null };
}

function main() {
  const logPath = argVal('log') || process.env.LOA_MODELINV_LOG || defaultLogPath();

  // Validate numeric/date args at the boundary BEFORE any work. NaN comparisons silently return false,
  // which for a fail-closed sensor flips a typo from "guard" to "all clear" (e.g. --freshness-days=abc
  // -> every voice stale -> divergences collapse -> a false TRUTHFUL). Fail toward INSUFFICIENT instead.
  const freshDaysRaw = argVal('freshness-days');
  const freshDays = freshDaysRaw === undefined ? 3 : Number(freshDaysRaw);
  if (!Number.isFinite(freshDays) || freshDays < 0) {
    die(`--freshness-days=${freshDaysRaw} is not a non-negative number — INSUFFICIENT, refusing to assert "truthful" without evidence`);
  }
  const freshnessMs = freshDays * DAY_MS;

  const nowArg = argVal('now');
  if (nowArg !== undefined && Number.isNaN(Date.parse(nowArg))) {
    die(`--now=${nowArg} is not a parseable date — INSUFFICIENT, refusing to assert "truthful" without evidence`);
  }
  // Freshness is anchored to WALL-CLOCK by default, NOT the log's own newest record. Anchoring to the
  // newest record makes a frozen dispatch stream (the ultimate numb instrument) undetectable: the most
  // recent voice always reads age-0 against a clock that froze with it. Wall-clock is the external,
  // monotonic reference a watchdog needs. --now overrides it for deterministic tests.
  const now = nowArg || new Date().toISOString();

  let records;
  try {
    records = readRecords(logPath);
  } catch (e) {
    die(`cannot read ground-truth log ${logPath} (${e.code || e.message}) — INSUFFICIENT, refusing to assert "truthful" without evidence`);
  }
  if (!records.length) {
    die(`no MODELINV records in ${logPath} — INSUFFICIENT, refusing to assert "truthful" without evidence`);
  }

  const { probeTable, source: probeSource, asOf: probeAsOf } = loadProbeTable();
  const result = analyzeVoiceTruth({ records, probeTable, now, freshnessMs });
  result.logPath = logPath;
  result.recordCount = records.length;
  result.probeSource = probeSource;
  result.probeAsOf = probeAsOf;

  // First-class log-staleness signal: if the whole log's newest record predates the active window
  // (measured against the same wall-clock anchor), the dispatch stream itself may have stopped. Surface
  // it; the verdict is still driven by lying instruments (a frozen log surfaces declared-up voices as
  // FALSE_HEALTHY, which is the actionable, gateable signal).
  const newest = newestTs(records);
  const newestMs = newest ? Date.parse(newest) : NaN;
  const logAgeMs = Number.isFinite(newestMs) ? Date.parse(now) - newestMs : Infinity;
  result.newestRecordTs = newest;
  result.logAgeDays = Number.isFinite(logAgeMs) ? Math.round((logAgeMs / DAY_MS) * 10) / 10 : null;
  result.logStale = Number.isFinite(logAgeMs) ? logAgeMs > freshnessMs : true;

  if (MODE === 'json') console.log(JSON.stringify(result, null, 2));
  else if (MODE === 'probe') console.log(renderProbe(result));
  else console.log(renderBoard(result));
  process.exit(result.exitCode);
}

// ── renderers ───────────────────────────────────────────────────────────────

const GLYPH = {
  CONSISTENT: '✓',
  DARK: '·',
  INVISIBLE: '⚠',
  DIVERGENT: '⚠',
  FALSE_HEALTHY: '⚠',
};
const WHY = {
  INVISIBLE: 'live but absent from the probe table (lie of omission)',
  DIVERGENT: 'probe declares it down/unknown but it has fresh successful finals',
  FALSE_HEALTHY: 'probe declares it up but it has gone silent',
  CONSISTENT: 'declaration matches ground truth',
  DARK: 'absent from the probe and inactive — nothing claimed, nothing done',
};

function renderProbe(r) {
  const tag = r.verdict === 'LYING' ? '⚠ instrument-truth' : '✓ instrument-truth';
  const stale = r.logStale ? ` · ⚠ log stale (newest ${r.logAgeDays}d old — dispatch may have stopped)` : '';
  if (r.verdict === 'TRUTHFUL') {
    return `${tag} · ${r.voices.length} voices · all declarations match ground truth (${r.recordCount} records)${stale}`;
  }
  const names = r.lyingInstruments.map((v) => `${v.voice}:${v.classification}`).join(', ');
  return `${tag} · LYING: ${r.lyingInstruments.length}/${r.voices.length} instrument(s) diverge — ${names}${stale}`;
}

function renderBoard(r) {
  const L = [];
  L.push(`  ∴ instrument-truth · cheval voice health · re-derived from ${r.recordCount} MODELINV records`);
  L.push(`    ground-source: ${r.logPath}`);
  const decl = r.probeSource === 'static'
    ? `static snapshot as of ${r.probeAsOf} (NOT a live doctor.py read — re-ground with --probe-table)`
    : r.probeSource;
  L.push(`    declaration:   ${decl}`);
  L.push(`    reference(now): ${r.reference}   active-window: ${Math.round(r.freshnessMs / DAY_MS)}d`);
  if (r.logStale) {
    L.push(`    ⚠ log itself is STALE — newest record is ${r.logAgeDays}d old (> ${Math.round(r.freshnessMs / DAY_MS)}d window); the dispatch stream may have stopped.`);
  }
  L.push('');
  L.push(`    voice     finals  last-final   age   declared   verdict`);
  for (const v of r.voices) {
    const age = v.ageDays == null ? '   —' : `${String(v.ageDays).padStart(4)}d`;
    const last = (v.lastSuccessTs || '—').slice(0, 10).padEnd(10);
    L.push(`    ${GLYPH[v.classification]} ${v.voice.padEnd(8)} ${String(v.finals).padStart(5)}  ${last}  ${age}  ${String(v.declared).padEnd(8)}  ${v.classification}`);
  }
  L.push('');
  if (r.verdict === 'TRUTHFUL') {
    L.push(`    ✓ TRUTHFUL — every instrument's declaration matches ground truth.`);
  } else {
    L.push(`    ⚠ LYING — ${r.lyingInstruments.length} instrument(s) misreport reality:`);
    for (const v of r.lyingInstruments) {
      L.push(`      · ${v.voice} (${v.classification}): ${WHY[v.classification]} — ${v.finals} finals, last ${v.lastSuccessTs || 'never'}`);
    }
    L.push('');
    L.push(`    note: a voice that is genuinely DOWN is CONSISTENT, not a lie — only the DIVERGENCE`);
    L.push(`          between declared and real health is flagged. (exit 2 = >=1 lying instrument.)`);
  }
  return L.join('\n');
}

// main-guard: importing the module (tests) must NOT read files or exit.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}

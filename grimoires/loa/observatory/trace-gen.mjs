#!/usr/bin/env node
// trace-gen v2 — fold a real compose run into Observatory LevelData (obs-level/1).
//
//   node trace-gen.mjs <run-dir> [--audit f] [--invoke f] [--out f] [--enrage-s 300] [--url]
//   node trace-gen.mjs --selftest        # red test: prove the validator fires
//
// Producer truth (panel W1-3 · obs-panel-20260611):
//   rooms = STAGES (packet from/to · event.stage ?? event.target), never event-kinds;
//   liveness ABSOLUTE: live = clamp(dwell_s/enrage_s, 0, 1) — thresholded facts are
//   absolute, only comparative facts may normalize; custody windowed PER HOP
//   (packet mtime → next packet mtime); loiter only attested or loudly inferred.
// The treaty (W1-4): validate via level-contract before writing — exit 2 on violation.
import { readFileSync, readdirSync, writeFileSync, existsSync, statSync } from "node:fs";
import { join, basename } from "node:path";
import { validateLevel, defaultLevel, VERDICTS, SCHEMA, CONTRACT_REV } from "./level-contract.mjs";

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const flag = n => args.includes(`--${n}`);

// ── red selftest (S-4c): a wall is proven by going red ──
if (flag("selftest")) {
  const broken = {
    rooms: [{ id: 0, name: "a", construct: "a", spr: "noether", gx: 0, gy: 0, live: .5 },
            { id: 1, name: "b", construct: "b", spr: "arcade", gx: 1, gy: 0, live: .5 }],
    seams: [],                                                  // dangling: envelope has no seam
    envelopes: [{ from: 0, to: 1, payload: "x", keepers: 9, verdict: "TOTALLY_FINE" }],
  };
  const v = validateLevel(broken);
  if (v.ok) { console.error("✗ SELFTEST FAILED: validator passed a broken level"); process.exit(1); }
  console.error(`✓ selftest: validator rejected the broken level (${v.errors.length} violations):`);
  v.errors.forEach(e => console.error(`  · ${e}`));
  process.exit(0);
}

const runDir = args.find(a => !a.startsWith("--") && a !== opt("audit") && a !== opt("invoke") && a !== opt("out") && a !== opt("enrage-s"));
if (!runDir || !existsSync(runDir)) { console.error("usage: trace-gen.mjs <run-dir> [--audit f] [--invoke f] [--out f] [--enrage-s N] [--url] | --selftest"); process.exit(1); }
const ENRAGE_S = Number(opt("enrage-s", 300));

const jsonl = f => existsSync(f) ? readFileSync(f, "utf8").trim().split("\n").filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) : [];
const T = s => s ? Date.parse(s) : NaN;

// ── 1. orchestrator events ──
const events = jsonl(join(runDir, "orchestrator.jsonl"));
if (!events.length) console.error(`⚠ no orchestrator.jsonl in ${runDir}`);
const runId = events[0]?.run_id ?? basename(runDir);
const topic = events[0]?.topic ?? runId;
const t0 = T(events[0]?.timestamp), tN = T(events[events.length - 1]?.timestamp);

// ── 2. envelope packets, mtime-ordered (each carries its window for custody) ──
const envDir = join(runDir, "envelopes");
const envFiles = existsSync(envDir) ? readdirSync(envDir).filter(f => f.endsWith(".json"))
  .map(f => join(envDir, f)).sort((a, b) => statSync(a).mtimeMs - statSync(b).mtimeMs) : [];
if (!envFiles.length) console.error(`⚠ no envelopes/ in ${runDir} — the run emitted nothing that travels`);
const packets = envFiles.map(f => ({ file: basename(f), mtime: statSync(f).mtimeMs, ...JSON.parse(readFileSync(f, "utf8")) }));

// ── 3. rooms = STAGES (S-2). Packet from/to are primary; events map via stage ?? target;
//      an event with neither attaches to the CURRENT station — never minted per kind. ──
const stationNames = [];
const seen = new Set();
const station = n => { if (!seen.has(n)) { seen.add(n); stationNames.push(n); } return stationNames.indexOf(n); };
const dwellMs = {};                 // per-station dwell, accumulated to the CURRENT station
let cur = null, curT = t0;
for (const e of events) {
  const name = e.stage ?? (e.target ? basename(e.target) : null);
  const t = T(e.timestamp);
  if (cur !== null && Number.isFinite(t) && Number.isFinite(curT)) dwellMs[cur] = (dwellMs[cur] ?? 0) + (t - curT);
  if (name) { station(name); cur = name; }
  if (Number.isFinite(t)) curT = t;
}
for (const p of packets) { if (p.from) station(p.from); if (p.to) station(p.to); }
if (stationNames.length < 2) station("handoff-target");

const SPRS = ["noether", "arcade", "proto", "gecko", "vocab", "easel", "khole", "artisan"];
const rooms = stationNames.map((n, i) => {
  const dwell_s = (dwellMs[n] ?? 0) / 1000;
  const live = Math.max(0, Math.min(1, dwell_s / ENRAGE_S));   // S-1: ABSOLUTE
  return { id: i, name: String(n).slice(0, 28), construct: String(n).replace(/_/g, "-"), spr: SPRS[i % SPRS.length],
    gx: i % 4, gy: Math.floor(i / 4), live, dwell_s: Math.round(dwell_s * 10) / 10 };
});
rooms.forEach((r, i) => { if (r.gy % 2 === 1) r.gx = 3 - (i % 4); });  // snake the grid

// loiter: attested (livenessVerdict) or loudly inferred — never silent (G-9b)
const gaps = Object.values(dwellMs);
const maxGap = Math.max(...gaps, 1);
for (const r of rooms) {
  const d = (dwellMs[r.name] ?? 0);
  if (r.live >= 1 || (d >= 0.9 * maxGap && d / 1000 >= ENRAGE_S)) {
    r.live = 1;
    console.error(`⚠ loiter INFERRED for station '${r.name}' (dwell ${Math.round(d / 1000)}s ≥ enrage ${ENRAGE_S}s) — attestation absent`);
  }
}

// ── 4. spend (optional, honest absence — S-9) + custody PER HOP window (G-7a) ──
const invokes = opt("invoke") ? jsonl(opt("invoke")).filter(e => { const t = T(e.timestamp || e.ts); return t >= t0 && t <= tN; }) : [];
const audit = opt("audit") ? jsonl(opt("audit")).filter(e => { const t = T(e.timestamp || e.ts); return t >= t0 && t <= tN; }) : [];
if (opt("audit")) console.error(`audit moves in window: ${audit.length}`);
const custodyIn = (ta, tb) => {
  const hit = invokes.find(e => { const t = T(e.timestamp || e.ts); return t >= ta && t <= tb; });
  return hit?.model ?? hit?.model_id ?? null;
};

// ── 5. envelopes: verdict → closed enum (unmappable → EMITTED + stderr); phrasebook voice (E-15) ──
const PHRASEBOOK = {
  APPROVED: p => `LEGBA turns the key on <i>${p}</i>… it holds.`,
  CHECKPOINT: p => `the checkpoint presents <i>${p}</i> at the gate… accepted.`,
  EMITTED: p => `the packet <i>${p}</i> passes, seal unread — emitted, not yet attested.`,
  REJECTED: p => `LEGBA bars the door — <i>${p}</i> returns to sender.`,
  DENIED: p => `the gate stays shut. <i>${p}</i> is refused.`,
};
const mapVerdict = v => {
  if (!v) return "EMITTED";
  const u = String(v).toUpperCase();
  if (VERDICTS.includes(u)) return u;
  if (/APPROV|VALID|PASS|COMPLETE/.test(u)) return "APPROVED";
  if (/CHECKPOINT|SALVAGE/.test(u)) return "CHECKPOINT";
  if (/REJECT|FAIL/.test(u)) return "REJECTED";
  if (/DENI|REFUS|BLOCK/.test(u)) return "DENIED";
  console.error(`⚠ verdict '${v}' unmappable → EMITTED`);
  return "EMITTED";
};

const seams = [], envelopes = [];
for (let i = 0; i < Math.max(packets.length, stationNames.length - 1); i++) {
  const p = packets[i];
  const from = p?.from != null ? station(p.from) : Math.min(i, rooms.length - 2);
  const to = p?.to != null ? station(p.to) : Math.min(i + 1, rooms.length - 1);
  if (from === to) continue;
  if (!seams.some(([a, b]) => (a === from && b === to) || (a === to && b === from))) seams.push([from, to]);
  const verdict = mapVerdict(p?.verdict ?? p?.status ?? p?.event);
  const wa = p?.mtime ?? t0, wb = packets[i + 1]?.mtime ?? tN;     // per-hop custody window
  const keepers = 1;  // attestation counting needs Legba tokens/COMPLETED markers in-window; fallback 1
  if (p) console.error(`note: keepers=1 fallback for ${p.file} (no in-window attestation sources wired)`);
  envelopes.push({
    from, to, payload: p?.topic ?? p?.event ?? topic, keepers, verdict, wave: i,
    gateline: PHRASEBOOK[verdict](p?.file ?? "the handoff"),
    transform: {
      badge: "✦",
      line: p?.artifacts ? `artifacts land: <i>${Object.keys(p.artifacts).slice(0, 3).join(" · ")}</i>` : `<b>${rooms[to].construct}</b> receives the handoff`,
    },
    custody: custodyIn(wa, wb),
  });
}

// live mode (W3-3): a run with no terminal event is PARTIAL — the renderer holds a
// wait phase instead of the morgue, and the live poller splices growth in.
const lastEvt = String(events[events.length - 1]?.event ?? "");
const partial = flag("live") || (events.length > 0 && !/handoff|completed|jacked|final/i.test(lastEvt));
if (partial) console.error(`note: run is PARTIAL (last event '${lastEvt}') — emitting live level`);

const level = defaultLevel({
  schema: SCHEMA, id: runId, name: topic, partial,
  meta: { run_id: runId, generated_at: new Date().toISOString(), contract_rev: CONTRACT_REV, enrage_s: ENRAGE_S, sources: { runDir, audit: opt("audit") ?? null, invoke: opt("invoke") ?? null } },
  rooms, seams, envelopes,
});

// ── 6. the teeth (S-4b): validate before writing; exit 2 listing violations ──
const v = validateLevel(level);
if (!v.ok) { console.error("✗ level violates obs-level/1:"); v.errors.forEach(e => console.error(`  · ${e}`)); process.exit(2); }

const out = opt("out");
const json = JSON.stringify(level, null, 1);
if (out) { writeFileSync(out, json); console.error(`wrote ${out}`); } else console.log(json);
if (flag("url")) console.error(`door: game.html#level=${Buffer.from(JSON.stringify(level)).toString("base64")}`);

const keepers = envelopes.reduce((n, e) => n + e.keepers, 0);
console.error(`LevelData: ${rooms.length} rooms · ${envelopes.length} envelopes · ${keepers} gatekeepers · ${seams.length} seams`);
if (!envelopes.length || !keepers) { console.error("✗ VERIFY FAILED: need ≥1 envelope and ≥1 gatekeeper"); process.exit(2); }
console.error("✓ verify: envelope + gatekeeper present · contract obs-level/1 holds");

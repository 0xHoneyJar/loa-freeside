#!/usr/bin/env node
// trace-gen v3 — fold a real compose run into Observatory LevelData (obs-level/1).
//
//   node trace-gen.mjs <run-dir> [--audit f] [--invoke f] [--out f] [--enrage-s 300] [--url]
//   node trace-gen.mjs --selftest        # red test: prove the validator fires
//
// Two envelope dialects cross the membrane, auto-detected:
//   COMPOSE-HANDOFF (the real /compose Form C runtime) — the canonical
//     construct-handoff packet: {construct_slug, output_type, verdict:{}, …,
//     stage_index, gates_passed[], gates_failed[], output_refs[], evidence[]}.
//     Rooms = STAGES = the constructs themselves (the characters). The verdict
//     OBJECT folds to the closed enum via gates+output_type (not a raw string).
//     Seams = consecutive stages. The rationale (verdict.summary / evidence /
//     persona) becomes the door's voice. This is what makes the README true.
//   KICKOFF/LEGACY (older runs) — flat {from,to,verdict-string,topic,artifacts}.
//     Preserved for backward compat: from/to drive stations directly.
//
// Producer truth (panel W1-3 · obs-panel-20260611):
//   rooms = STAGES, never event-kinds; liveness ABSOLUTE: live =
//   clamp(dwell_s/enrage_s, 0, 1) — thresholded facts are absolute, only
//   comparative facts may normalize; custody windowed PER HOP; loiter only
//   attested or loudly inferred.
// The treaty (W1-4): validate via level-contract before writing — exit 2 on violation.
import { readFileSync, readdirSync, writeFileSync, existsSync, statSync } from "node:fs";
import { join, basename } from "node:path";
import { validateLevel, defaultLevel, VERDICTS, SCHEMA, CONTRACT_REV } from "./level-contract.mjs";
import { sprFor } from "./casts.mjs";

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

// ── 1. orchestrator events, normalized across both emitter dialects ──
// compose-dispatch.sh writes {event, ts, run_id, payload:{stage, construct,…}};
// the kickoff emitter writes flat {event, run_id, topic, target, timestamp}.
// Flatten so downstream reads ONE shape: e.event, e.ts, e.stage, e.construct, e.target.
const rawEvents = jsonl(join(runDir, "orchestrator.jsonl"));
if (!rawEvents.length) console.error(`⚠ no orchestrator.jsonl in ${runDir}`);
const events = rawEvents.map(e => {
  const p = (e.payload && typeof e.payload === "object") ? e.payload : {};
  return {
    event: e.event,
    ts: e.ts ?? e.timestamp ?? p.ts ?? null,
    run_id: e.run_id,
    topic: e.topic ?? p.topic ?? null,
    stage: p.stage ?? e.stage ?? null,           // integer stage index (compose-dispatch)
    construct: p.construct ?? e.construct ?? null,
    target: e.target ?? p.target ?? null,
    composition: e.composition ?? p.composition ?? null,
    handoff: p.handoff ?? null,
  };
});
const runId = events[0]?.run_id ?? basename(runDir);
const topic = events.find(e => e.topic)?.topic ?? events.find(e => e.composition)?.composition ?? runId;
const t0 = T(events[0]?.ts), tN = T(events[events.length - 1]?.ts);

// ── 2. envelope packets, mtime-ordered (each carries its window for custody) ──
const envDir = join(runDir, "envelopes");
const envFiles = existsSync(envDir) ? readdirSync(envDir).filter(f => f.endsWith(".json"))
  .map(f => join(envDir, f)).sort((a, b) => statSync(a).mtimeMs - statSync(b).mtimeMs) : [];
if (!envFiles.length) console.error(`⚠ no envelopes/ in ${runDir} — the run emitted nothing that travels`);
const packets = envFiles.map(f => ({ file: basename(f), mtime: statSync(f).mtimeMs, ...JSON.parse(readFileSync(f, "utf8")) }));

// A compose-handoff packet is the canonical construct-handoff schema: it names a
// construct and carries a verdict OBJECT. That signature decides the fold.
const isComposeHandoff = p => typeof p?.construct_slug === "string" && p?.verdict && typeof p.verdict === "object";
const COMPOSE = packets.length > 0 && packets.some(isComposeHandoff);
// Order compose stages by stage_index when present, else by stage_enter sequence
// (mtime already sorts them, but stage_index is the authoritative ordinal).
const stagePackets = COMPOSE
  ? packets.filter(isComposeHandoff).sort((a, b) =>
      (a.stage_index ?? 1e9) - (b.stage_index ?? 1e9) || a.mtime - b.mtime)
  : [];

// ── 3. rooms = STAGES (S-2). In a compose run a STAGE *is* a construct — the
//      character crosses the membrane and becomes a room. Otherwise fall back to
//      packet from/to + orchestrator target (kickoff/legacy shape). ──
const stationNames = [];
const seen = new Set();
const station = n => { if (!seen.has(n)) { seen.add(n); stationNames.push(n); } return stationNames.indexOf(n); };
const dwellMs = {};                 // per-station dwell, keyed by station NAME

if (COMPOSE) {
  // Each construct is a station. Dwell per stage = stage_enter→stage_exit window
  // for that construct (the room where time is allowed to be wild).
  const enterT = {}, exitT = {};
  for (const e of events) {
    if (e.construct == null) continue;
    const t = T(e.ts);
    if (!Number.isFinite(t)) continue;
    if (e.event === "stage_enter" && enterT[e.construct] == null) enterT[e.construct] = t;
    if (e.event === "stage_exit") exitT[e.construct] = t;
  }
  for (const p of stagePackets) {
    station(p.construct_slug);
    const a = enterT[p.construct_slug], b = exitT[p.construct_slug];
    if (Number.isFinite(a) && Number.isFinite(b) && b >= a) dwellMs[p.construct_slug] = b - a;
  }
} else {
  // legacy/kickoff: stations from orchestrator target + packet from/to
  let cur = null, curT = t0;
  for (const e of events) {
    const name = e.stage != null && typeof e.stage === "string" ? e.stage
               : (e.target ? basename(e.target) : null);
    const t = T(e.ts);
    if (cur !== null && Number.isFinite(t) && Number.isFinite(curT)) dwellMs[cur] = (dwellMs[cur] ?? 0) + (t - curT);
    if (name) { station(name); cur = name; }
    if (Number.isFinite(t)) curT = t;
  }
  for (const p of packets) { if (p.from) station(p.from); if (p.to) station(p.to); }
}
if (stationNames.length < 2) station("handoff-target");

const rooms = stationNames.map((n, i) => {
  const dwell_s = (dwellMs[n] ?? 0) / 1000;
  const live = Math.max(0, Math.min(1, dwell_s / ENRAGE_S));   // S-1: ABSOLUTE
  const construct = String(n).replace(/_/g, "-");
  return { id: i, name: String(n).slice(0, 28), construct, spr: sprFor(construct),
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

// ── 5. envelopes: verdict → closed enum; phrasebook voice (E-15) ──
const PHRASEBOOK = {
  APPROVED: p => `LEGBA turns the key on <i>${p}</i>… it holds.`,
  CHECKPOINT: p => `the checkpoint presents <i>${p}</i> at the gate… accepted.`,
  EMITTED: p => `the packet <i>${p}</i> passes, seal unread — emitted, not yet attested.`,
  REJECTED: p => `LEGBA bars the door — <i>${p}</i> returns to sender.`,
  DENIED: p => `the gate stays shut. <i>${p}</i> is refused.`,
};
// String-verdict mapper (legacy/kickoff packets carry a verdict STRING or status).
const mapVerdictStr = v => {
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
// Compose-handoff verdict fold: gates are authoritative (a failed gate bars the
// door → REJECTED); else output_type colors the pass; else the summary text is
// the last witness. This turns the verdict OBJECT into a door, not a guess.
const foldComposeVerdict = p => {
  const gf = Array.isArray(p.gates_failed) ? p.gates_failed.filter(g => g?.status === "failed") : [];
  const gp = Array.isArray(p.gates_passed) ? p.gates_passed.filter(g => g?.status === "passed") : [];
  if (gf.length) return "REJECTED";                         // a failed gate bars the door
  const summary = String(p.verdict?.summary ?? "");
  if (/\bcheckpoint\b|\bsalvage\b|present(ed|s)? at the gate/i.test(summary)) return "CHECKPOINT";
  if (/\b(refus|denied|blocked)\b/i.test(summary)) return "DENIED";
  if (gp.length) return "APPROVED";                         // gates met → key turns
  if (p.output_type === "Verdict") return "APPROVED";       // a verdict that named no failed gate held
  if (p.output_type === "Artifact" || p.output_type === "Signal" || p.output_type === "Intent") return "EMITTED";
  console.error(`⚠ compose verdict for ${p.construct_slug} unmappable (output_type=${p.output_type}) → EMITTED`);
  return "EMITTED";
};
// keepers = gatekeepers at the door. The attestations that gate a handoff ARE its
// passed gates (clamped 1..5 per contract); fall back to 1 when none are declared.
const composeKeepers = p => {
  const n = Array.isArray(p.gates_passed) ? p.gates_passed.filter(g => g?.status === "passed").length : 0;
  return Math.max(1, Math.min(5, n));
};
// the door's voice: the construct's verdict summary is the rationale; evidence and
// output_refs are what it carried across the gate.
const baseOf = r => { const s = typeof r === "string" ? r : String(r?.ref ?? r ?? ""); return s ? basename(s) : ""; };
const composeLine = (p, toRoom) => {
  const refs = Array.isArray(p.output_refs) ? p.output_refs.map(r => r?.ref ?? r).filter(x => typeof x === "string") : [];
  const ev = Array.isArray(p.evidence) ? p.evidence : [];
  if (refs.length) return `<b>${toRoom.construct}</b> receives <i>${refs.slice(0, 3).map(baseOf).join(" · ")}</i>`;
  if (ev.length) return `<b>${toRoom.construct}</b> takes the handoff — <i>${String(ev[0]).slice(0, 64)}</i>`;
  return `<b>${toRoom.construct}</b> receives the handoff`;
};
const summaryGloss = s => { s = String(s ?? "").replace(/\s+/g, " ").trim(); return s.length > 120 ? s.slice(0, 117) + "…" : s; };

const seams = [], envelopes = [];

if (COMPOSE) {
  // Each consecutive pair of stages is a corridor (seam) the packet travels.
  // Envelope i carries stage i's OUTPUT forward to stage i+1's room. The terminal
  // stage's output exits to a synthetic 'handoff-target' if it has nowhere to go.
  for (let i = 0; i < stagePackets.length; i++) {
    const p = stagePackets[i];
    const from = station(p.construct_slug);
    const nextP = stagePackets[i + 1];
    const to = nextP ? station(nextP.construct_slug)
                     : (stationNames.length > 1 ? rooms.length - 1 : station("handoff-target"));
    if (from === to) continue;
    if (!seams.some(([a, b]) => (a === from && b === to) || (a === to && b === from))) seams.push([from, to]);
    const verdict = foldComposeVerdict(p);
    const keepers = composeKeepers(p);
    const wa = p?.mtime ?? t0, wb = nextP?.mtime ?? tN;
    const persona = p.persona ? `${p.persona}: ` : "";
    envelopes.push({
      from, to, payload: p.output_type ?? "handoff", keepers, verdict, wave: i,
      gateline: PHRASEBOOK[verdict](`${persona}${summaryGloss(p.verdict?.summary) || p.construct_slug}`),
      transform: { badge: "✦", line: composeLine(p, rooms[to]) },
      custody: p.persona ?? custodyIn(wa, wb),
    });
  }
  // Rebuild rooms array if the synthetic terminal station was just appended.
  while (rooms.length < stationNames.length) {
    const i = rooms.length, n = stationNames[i];
    const construct = String(n).replace(/_/g, "-");
    rooms.push({ id: i, name: String(n).slice(0, 28), construct,
      spr: sprFor(construct), gx: i % 4, gy: Math.floor(i / 4), live: 0, dwell_s: 0 });
  }
  rooms.forEach((r, i) => { if (r.gy % 2 === 1) r.gx = 3 - (i % 4); });
} else {
  // legacy/kickoff fold (string verdicts, from/to or positional)
  for (let i = 0; i < Math.max(packets.length, stationNames.length - 1); i++) {
    const p = packets[i];
    const from = p?.from != null ? station(p.from) : Math.min(i, rooms.length - 2);
    const to = p?.to != null ? station(p.to) : Math.min(i + 1, rooms.length - 1);
    if (from === to) continue;
    if (!seams.some(([a, b]) => (a === from && b === to) || (a === to && b === from))) seams.push([from, to]);
    const verdict = mapVerdictStr(p?.verdict ?? p?.status ?? p?.event);
    const wa = p?.mtime ?? t0, wb = packets[i + 1]?.mtime ?? tN;
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
}

// live mode (W3-3): a run with no terminal event is PARTIAL — the renderer holds a
// wait phase instead of the morgue, and the live poller splices growth in.
const lastEvt = String(events[events.length - 1]?.event ?? "");
const partial = flag("live") || (events.length > 0 && !/handoff|complete|completed|jacked|final/i.test(lastEvt));
if (partial) console.error(`note: run is PARTIAL (last event '${lastEvt}') — emitting live level`);

const level = defaultLevel({
  schema: SCHEMA, id: runId, name: topic, partial,
  meta: { run_id: runId, generated_at: new Date().toISOString(), contract_rev: CONTRACT_REV, enrage_s: ENRAGE_S,
    fold: COMPOSE ? "compose-handoff" : "kickoff/legacy",
    sources: { runDir, audit: opt("audit") ?? null, invoke: opt("invoke") ?? null } },
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
console.error(`LevelData (${level.meta.fold}): ${rooms.length} rooms · ${envelopes.length} envelopes · ${keepers} gatekeepers · ${seams.length} seams`);
if (!envelopes.length || !keepers) { console.error("✗ VERIFY FAILED: need ≥1 envelope and ≥1 gatekeeper"); process.exit(2); }
console.error("✓ verify: envelope + gatekeeper present · contract obs-level/1 holds");

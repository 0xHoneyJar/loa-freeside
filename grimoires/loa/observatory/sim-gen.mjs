#!/usr/bin/env node
// sim-gen — the Observatory's FORWARD MODEL of the consumption gradient.
//
//   node sim-gen.mjs [--seed 7] [--greed 0.5] [--discipline 0.5] [--rooms 6] [--out f]
//
// A deterministic, seeded simulation of a party working a run: rooms METER
// (working burns the enrage clock for diminishing quality), gates are FREE
// (presenting costs nothing but risks the verdict). The policy knobs are the
// game design question made executable:
//   greed       0..1 — how long the agent keeps reading past "good enough"
//   discipline  0..1 — how early it presents a checkpoint instead of pushing
// The gradient lesson is structural, not prose: a greedy policy floods clocks
// and meets the reaper; a disciplined one ships CHECKPOINTs; the winning play
// is the substrate's own doctrine — present at the gate before the flood.
// Same seed → byte-identical LevelData (obs-level/1) → asson golden vectors.
import { writeFileSync } from "node:fs";
import { validateLevel, defaultLevel, SCHEMA, CONTRACT_REV } from "./level-contract.mjs";

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const SEED = Number(opt("seed", 7));
const GREED = Math.max(0, Math.min(1, Number(opt("greed", .5))));
const DISC = Math.max(0, Math.min(1, Number(opt("discipline", .5))));
const NROOMS = Math.max(2, Math.min(12, Number(opt("rooms", 6))));

// mulberry32 — tiny seeded RNG; determinism is the contract
function rng(seed) { let a = seed >>> 0; return () => {
  a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const R = rng(SEED);
const pick = arr => arr[Math.floor(R() * arr.length)];

const TASKS = ["Grounding Pass", "Schema Forge", "Verdict Loom", "Custody Ledger", "Drift Sweep",
  "Seam Audit", "Budget Sluice", "Token Mill", "Handoff Kiln", "Proof Cellar", "Clew Press", "Gate Argument"];
const CASTS = [["noether", "noether"], ["the-arcade", "arcade"], ["protocol", "proto"], ["gecko", "gecko"],
  ["vocabulary-bank", "vocab"], ["the-easel", "easel"], ["k-hole", "khole"], ["artisan", "artisan"]];
const PAYLOADS = ["typed handoff", "sealed contract", "grounded findings", "verdict packet",
  "custody chain", "distilled brief", "attested build", "golden vectors"];
const BADGES = ["✚", "»", "⚷", "◔", "❡", "◉", "✦", "⟁"];

// ── the simulation: one party, NROOMS tasks, the gradient decides the story ──
const rooms = [], envelopes = [], seams = [];
const usedTasks = new Set(), usedCasts = new Set();
for (let i = 0; i < NROOMS; i++) {
  let t; do { t = pick(TASKS); } while (usedTasks.has(t) && usedTasks.size < TASKS.length); usedTasks.add(t);
  let c; do { c = pick(CASTS); } while (usedCasts.has(c[0]) && usedCasts.size < CASTS.length); usedCasts.add(c[0]);
  rooms.push({ id: i, name: t, construct: c[0], spr: c[1], gx: i % 4, gy: Math.floor(i / 4), live: 0 });
}
rooms.forEach((r, i) => { if (r.gy % 2 === 1) r.gx = 3 - (i % 4); });

let reapedAt = -1;
for (let i = 0; i < NROOMS - 1; i++) {
  const difficulty = .3 + R() * .6;            // how much reading the task truly needs
  // work loop: each tick burns clock, buys diminishing quality
  let q = 0, clock = 0;
  const presentAt = Math.min(.95, difficulty * (.7 + .5 * GREED));  // greed reads past the need
  const panicAt = .55 + .4 * (1 - DISC);       // discipline presents well before the wall
  while (q < presentAt && clock < panicAt && clock < 1) {
    clock += .07 + R() * .05;                  // rooms METER
    q += (.16 + R() * .1) * (1 - q);           // diminishing returns — the loiter trap
  }
  let verdict, loiter = false;
  if (clock >= 1 || (clock >= panicAt && q < .35 && GREED > .7)) {   // flooded: the reaper's hop
    rooms[i].live = 1; reapedAt = i; verdict = "CHECKPOINT";
  } else {
    rooms[i].live = Math.round(clock * 100) / 100;
    verdict = q >= .72 ? "APPROVED" : q >= .45 ? "EMITTED" : (R() < .6 ? "REJECTED" : "EMITTED");
  }
  seams.push([i, i + 1]);
  const keepers = difficulty > .75 ? 3 : difficulty > .55 ? 2 : 1;   // stakes set the panel
  const payload = pick(PAYLOADS);
  const GATELINE = {
    APPROVED: `LEGBA turns the key on <i>${payload}</i>… it holds.`,
    CHECKPOINT: `the checkpoint presents <i>${payload}</i>… accepted. the work survives its author.`,
    EMITTED: `the packet <i>${payload}</i> passes, seal unread — emitted, not attested.`,
    REJECTED: `LEGBA bars the door — quality ${Math.round(q * 100)}% does not clear the bar.`,
  }[verdict];
  envelopes.push({ from: i, to: i + 1, payload, keepers, verdict, wave: i,
    loiter: reapedAt === i ? undefined : undefined,
    gateline: GATELINE,
    transform: { badge: BADGES[i % BADGES.length],
      line: `<b>${rooms[i + 1].construct}</b> receives ${payload} — quality ${Math.round(q * 100)}%` } });
  if (reapedAt === i) {
    // the flood: the NEXT room hosts the loiter→reap→salvage arc (renderer law: live≥1 attests)
    envelopes[envelopes.length - 1].verdict = "APPROVED";
    envelopes[envelopes.length - 1].loiter = true;
    rooms[i + 1].live = 1;
    if (i + 2 <= NROOMS - 1) {
      seams.push([i + 1, i + 2]);
      envelopes.push({ from: i + 1, to: i + 2, payload: "checkpoint · what the reaper left",
        keepers: 1, verdict: "CHECKPOINT", pale: true, wave: i + 1,
        gateline: "the checkpoint presents at the gate… accepted.",
        transform: { badge: "✓", line: `<b>${rooms[i + 2].construct}</b> takes the salvage` } });
      i++; // the salvage hop consumed the next leg
    }
    reapedAt = -2; // only one reap arc per sim run (the renderer renders one reaper)
  }
}
if (!rooms[NROOMS - 1].live) rooms[NROOMS - 1].live = Math.round((.2 + R() * .3) * 100) / 100;

const level = defaultLevel({
  schema: SCHEMA, id: `sim-${SEED}`, name: `the gradient, played (greed ${GREED} · discipline ${DISC})`,
  meta: { run_id: `sim-seed-${SEED}`, generated_at: `sim:${SEED}:${GREED}:${DISC}`, contract_rev: CONTRACT_REV,
    enrage_s: 300, sources: { simulator: "sim-gen.mjs", seed: SEED, greed: GREED, discipline: DISC } },
  rooms, seams, envelopes,
});
const v = validateLevel(level);
if (!v.ok) { console.error("✗ sim emitted an invalid level:"); v.errors.forEach(e => console.error("  · " + e)); process.exit(2); }
const json = JSON.stringify(level, null, 1);
const out = opt("out");
if (out) { writeFileSync(out, json); console.error(`wrote ${out}`); } else console.log(json);
console.error(`sim: ${rooms.length} rooms · ${envelopes.length} hops · verdicts ${envelopes.map(e => e.verdict[0]).join("")} · ${level.rooms.some(r => r.live >= 1) ? "REAP arc" : "clean run"}`);

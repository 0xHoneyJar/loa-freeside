# Software Design Document — The Observatory Graduation

> **Cycle**: observatory-graduation · **PRD**: `cycles/observatory-graduation/prd.md` (FLATLINE-REVIEWED)
> **Status**: FLATLINE-REVIEWED (3-model · 100% agreement · 6 HIGH integrated · 7 BLOCKERS addressed inline) — simstim-20260612-3693fe7e phase 4 complete
> **Flatline artifact**: cycles/observatory-graduation/flatline-sdd-review.json
> **Design inputs re-grounded**: every attested-convo mechanism is mapped to a verified surface below or explicitly marked `substrate-verb (out of MVP)` — discharging PRD assumption A-1.

## 1 · Architecture overview

Three planes, one contract:

```
PRODUCERS (attestable/deterministic)      CONTRACT (obs-level/1 rev 2)      CONSUMERS
trace-gen (fold real runs, --redact)  →                                  →  engine/game.html (sovereign file)
sim-gen   (forward model, episodes)   →   level-contract.mjs             →  Next.js shell (iframe, same-origin)
obs play  (agent episodes, FR-C)      →   + hardness-manifest.json       →  obs CLI consumers (any Loa repo)
asson liveness (watchdog verdicts)    →   + episode.schema (JSONL)       →  KEEPER/GECKO (clew intake, wave 3)
```

The carmack law holds at every seam: producers emit FACTS; the renderer supplies meaning and never invents state. The simulator is just another producer. The shell is just another consumer.

## 2 · Repository layout (post-graduation, crs)

```
construct-rooms-substrate/
├── observatory/                      # the capability (engine + producers + CLI)
│   ├── engine/game.html              # sovereign single file — rev-2 consumer
│   ├── contract/level-contract.mjs   # obs-level/1 rev 2 + redaction + episode schema
│   ├── contract/hardness-manifest.json
│   ├── producers/{trace-gen,sim-gen,serve}.mjs
│   ├── cli/{obs.mjs,veve.json}
│   └── VERIFY.md                     # G-2 checklist: doctrine concept → beat → ?phase index
└── app/observatory/                  # the shell (Next.js app router)
    ├── app/{layout.tsx,page.tsx}     # page iframes /observatory/game.html (same-origin)
    ├── app/api/sim/route.ts          # GET ?seed&greed&discipline → sim-gen JSON (no fs, safe public)
    ├── app/api/level/route.ts        # wave 2 — write-surface spec in §6 (NOT in MVP build)
    └── public/observatory/game.html  # build step copies the engine (single source: observatory/engine)
```

Move mechanics per PRD BLOCKER-4: crs branch `cycle/observatory-graduation`; artifacts arrive by PR; the loa-freeside copy stays live until merge (rollback path). Exact `app/` placement defers to crs's existing layout — checked at sprint 1. **A-2 fallback trigger criteria (flatline IMP-001)**: any of (a) crs CI path rules reject `app/`, (b) build tooling conflicts (lockfile/framework collisions), (c) maintainer veto at S1 review → the freeside-observatory repo decision fires, owner = operator, decided at S1 review — a decision point, never a stall.

## 3 · Contract evolution — obs-level/1 **rev 2**

All changes follow the standing evolution rule (unknown ignored · missing-optional defaulted · missing-required reject). `CONTRACT_REV = 2`. **Cross-rev behavior is explicit (flatline IMP-002)**: a rev-2 consumer accepts rev-1 levels (gate.hardness defaults `unknown`→HOLLOW, `clews` defaults empty); a rev-1 consumer given a rev-2 level ignores the unknown fields by design and `console.warn`s the rev mismatch (the existing CONTRACT_REV sensor) — no silent divergence; the warn names both revs.

### 3.1 Verdicts
`VERDICTS = [APPROVED, CHECKPOINT, EMITTED, REJECTED, DENIED, IMPASSE]`

`IMPASSE` is a gate ARRIVAL, not a refusal: the envelope presents empty-handed-but-honest and is ROUTED, never bounced. Renderer style: violet `#8a7fe8` family (distinct from rage-red refusal and steel checkpoint).

### 3.2 The gate block (per envelope — gates remain envelope-attached; PRD's `gates[]` honored in spirit, no new array)
```js
envelopes[].gate = {
  hardness: "hook" | "prose" | "unknown",   // DECLARED, joined from hardness-manifest; unknown → HOLLOW (fail-honest)
  mechanism: "<one line: what enforces>",    // e.g. "PreToolUse guard" | "warn-first exit code"
  help: "<the verb that would pass>",        // tier-2: rendered as the --help beat at the door
  teaches: "<corrected invocation>"          // tier-3: refusal gateline appends this (stderr-as-prompt)
}
```
Renderer: SOLID door bar + filled keeper glyphs when `hook`; HOLLOW (outline-only bar, 45% alpha keepers) when `prose`/`unknown`. The hardness manifest is the single authority (§3.4).

### 3.3 The thread
```js
level.clews = [{
  room: <id>,                 // where distress occurred
  divergence: <envelope idx>, // last known-good junction — the thread's far end
  routing: "retrace" | "rotate" | "heal",
  dropped_by: "agent" | "watchdog",
  packet_digest: "sha256:…"   // content-addressed distress packet
}]
```
Render: a violet thread polyline from the clew room back along traversed seams to the divergence envelope's room; routing beats — **retrace**: the envelope walks BACK along the thread (reverse travel, pale violet); **rotate**: the resident sprite swaps for a fresh instance (flash + same room, badge ↻); **heal**: the GECKO sprite walks in from the nearest corridor (the summon — reuses the reaper's entrance choreography at friendly tempo), inspects (2-beat), patches (door re-renders), exits. Watchdog-dropped clews render identically with a `◷` badge (involuntary) — voluntary and involuntary emit the same packet shape, per the three-prices doctrine.

**Re-grounding A-1**: the watchdog authority is `@freeside/asson/liveness#livenessVerdict` (exists, this branch). The REAL-substrate clew verb (asson-graduated `clew drop`) is **out of MVP** — this cycle renders the mechanics and simulates them; runtime emission lands with FR-G/asson ladder. The contract is designed so the future verb emits exactly this shape.

### 3.4 Hardness manifest (`contract/hardness-manifest.json`)
```json
{ "manifest_rev": 1, "substrate": "construct-rooms-substrate",
  "gates": { "compose-verify-run": { "hardness": "prose", "mechanism": "warn-first exit code", "help": "compose-verify-run <id> --require-executed" },
             "spiral-dispatch-guard": { "hardness": "hook", "mechanism": "PreToolUse deny" } } }
```
Hand-maintained (OSTROM-owned document) this cycle; producers join by gate name at fold time; misses → `unknown`. GECKO drift-sensing over it is wave 3. **This file is itself a G-1 instrument: editing it is a gate-design decision with a rendered beat.**

### 3.5 Episode schema (FR-C, JSON-lines)
```js
{ episode_id, tick, actor, action: "read" | "present" | "clew", observation_digest }
// digests (observation_digest, clews[].packet_digest) = sha256 over JCS-canonical JSON (RFC 8785:
// sorted keys, no insignificant whitespace — the repo's lib/jcs.sh convention) — producer/verifier agree by spec (IMP-004/006)
```
`sim-gen` gains `--episode-out <f.jsonl>`; **policies are pure decision functions** `decide({quality, clock, params}) → action` (IMP-005) shipped as named exports in `producers/policies.mjs` (greedy/disciplined/stuck — testable, documented). `obs play --policy <name> --seed N` resolves ONLY from the bundled registry — **no filesystem module loading in MVP (flatline SDD-B1/B7)**: an arbitrary `--policy-file` is a code-injection surface and is deferred behind a future local-dev-only flag spec (never honored when the `CI` env var is set). One construct-agent playing one registry policy end-to-end = MVP bar. **Policy behavioral contract (IMP-003)**: `decide(state) → action` must be pure (same state → same action), total (every state returns), and terminating (the sim enforces the tick cap); three conformance tests ship with the registry. The episode folds into a level (the replay) + emits the JSONL (the conformance surface).

### 3.6 Redaction (`--redact`, allowlist)
`redactLevel(level)` in level-contract: emits ONLY contract-enumerated fields; free-text fields (name/payload/gateline/transform.line) map through **salted keyed pseudonyms (flatline SDD-B3)**: `pseudonym(HMAC-SHA256(salt, text))` with a per-level random salt generated at redaction time and **discarded** — within-level consistency holds (same text → same pseudonym), cross-level linkage and dictionary reversal are infeasible (the embedded sim vocabulary is public; an unsalted hash would be enumerable in seconds). Topology + verdicts + timing preserved; **unknown fields dropped**; output stamped `meta.redacted: true`. Used by trace-gen `--redact` and the public ingestion path **re-redacts SERVER-SIDE unconditionally (flatline SDD-B2)** — client redaction is treated as untrusted; the server runs `redactLevel` on every ingested level regardless of `meta.redacted`, so allowed-but-leaky text fields are re-pseudonymized before storage. A client-claimed flag is never load-bearing.

## 4 · The vocabulary renderings (FR-A — engine changes)

| Doctrine | Beat | Mechanism |
|---|---|---|
| Receipts-not-rituals | Gate consumes the ENVELOPE visibly; gateline names evidence ("the seal", "the receipt"), never an act | phrasebook discipline + envelope-docks-at-gate (exists) |
| 3-tier awareness: signage | Room plates (exist) + a manifest panel on the title screen listing verbs | title bookend extension |
| 3-tier: --help | `gate.help` renders as a small tooltip plate above the door while the envelope waits | gate render, VT323 12px, dim |
| 3-tier: the-gate-teaches | On REJECTED/DENIED/IMPASSE the gateline appends `gate.teaches` in `<i>` — the refusal IS the documentation | log line + phrasebook |
| stderr-as-prompt | Same as above — `teaches` carries the corrected invocation verbatim | — |
| formation→observability→payoff | Level intro line names which layer each gate checks (gate.mechanism); morgue groups outcomes by layer | compile + morgue row |
| Hardness honesty | §3.2 solid/hollow | gate render |

## 5 · Shell design (FR-D)

Next.js 15 app router, minimal: one page iframing the same-origin engine; agentation in `layout.tsx` behind `NODE_ENV==='development'`; `/api/sim` runs sim-gen server-side (deterministic, no fs). **Abuse bounds (flatline SDD-B4/B6)**: params validated + clamped server-side (`rooms ≤ 12`, numeric ranges enforced, reject otherwise); responses carry long-lived cache headers keyed on params (identical request = CDN hit, the deterministic function is its own cache); **explicit per-IP token-bucket middleware (30 req/min)** — 'Vercel defaults' are NOT claimed as abuse control. Engine copied into `public/` at build (single source `observatory/engine/`, copy step in `next.config`/prebuild — never hand-edited). `file://` stays a local affordance of the engine file itself; the DEPLOYED path is always same-origin static. No cross-origin anywhere (BLOCKER-2 discharged).

## 6 · Security

- No secrets in any level: allowlist redaction (§3.6) gates the public ingestion path at schema level.
- agentation: dev-only, never in production bundle.
- `/api/sim`: pure function of clamped params; explicit token-bucket rate limit (§5); no fs/env access.
- `/api/level` (wave 2, spec'd now — flatline SDD-B5/IMP-008): Vercel Blob/KV storage · unguessable 128-bit id · server-side re-redaction (§3.6) · 256KB size cap · 7-day TTL · per-id delete token returned to uploader · same token-bucket middleware · no listing endpoint. Does not ship until all six hold.
- Engine: zero network calls except same-origin `?level=`/`?live=` fetches; no eval; embedded font/sprites.
- Episode files: digests only (`observation_digest`), never raw observations — agents can't exfiltrate via the conformance log.

## 7 · Testing & verification

| Surface | Test |
|---|---|
| Contract rev 2 | `--selftest` red tests extended: IMPASSE w/o clews entry rejected · bad routing enum rejected · unredacted ingestion rejected |
| Sim determinism | re-vectored golden hashes (3 policies × seeds), veve re-attested; vectors run in crs CI |
| Policies | unit: decision functions are pure (same input → same action) |
| Episode schema | JSONL validation in `obs play`; one full construct-agent episode in CI (haiku-tier) |
| Engine | agent-browser smoke: ?phase deterministic captures at the new beats (thread, heal summon, hollow gate) |
| Shell | build + iframe loads + /api/sim returns vector-matching bytes |
| G-2 | `VERIFY.md` checklist: every doctrine row in §4 → its `?phase=` index → screenshot |

## 8 · Sprint shape (input to Phase 5)

S1 **Graduate** (crs branch, move by PR, shell skeleton + agentation, k-hole diagnosis task) → S2 **Rev 2 + vocabulary** (contract, hardness manifest, FR-A beats, re-vector) → S3 **The thread** (clews, IMPASSE, retrace/rotate/heal, watchdog wiring) → S4 **Agents play** (policies.mjs, episode schema, obs play, one agent episode) → S5 **Share** (redaction, Vercel, gumi link) — S1–S4 = MVP; S5 = wave 2 head. KEEPER/GECKO intake (FR-G) explicitly NOT in these sprints (wave 3, cross-construct handoff markers per IMP-012).

## 9 · Risks carried into design

R-1 discharged by §3.2/§3.4 (declared data + fail-honest) · R-2 by §3.3 (clews are the ghost-door sensor) · R-3 by §2 (move mechanics) · R-5 by §7 (re-vector step is a named task) · R-6: S1 diagnosis task gates FR-B closure (IMP-006). New design risk: **manifest staleness** — hardness-manifest is hand-maintained and can drift from reality; accepted this cycle (fail-honest default bounds the damage: drift renders HOLLOW, never falsely SOLID), GECKO sensing is the wave-3 cure.

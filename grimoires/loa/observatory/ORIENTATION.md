# The Observatory — orientation brief (v0)

> A persistent lens onto compositions + the room substrate, rendered as an RPG map.
> **Status**: Studio (exploration). v0 prototype lives at `./index.html` (open it in a browser).
> Aesthetic is a guess until the operator's RPG video is the reference; the *data pipeline* is the engineering and it's real.

## The thesis (why this isn't a new thing to build)

The room substrate already speaks RPG. We are not imposing a metaphor — we are **rendering the structure that's already there**:

| RPG | Substrate | Already exists as |
|---|---|---|
| **Room** | a span — where time is allowed to be wild | `/compose` stage · Legba span |
| **Seam** | the non-deterministic corridor between two deterministic rooms | the stage→stage transition (the operator's "intentional non-determinism") |
| **Gate (door + key)** | where time is collected; opened by a verdict/token | review/audit verdict · Legba ed25519 gate token |
| **Character** | a construct (with its persona) | `.claude/constructs/packs/*` · the registry |
| **Liveness clock** | the enrage timer / chess clock / heartbeat per room | **asson cycle-4 `livenessVerdict`** (we just built the engine) |
| **The party / player** | the agent traversing | `.run/audit.jsonl` move-by-move |
| **Custody chain** | who carried what across the gate | `.run/model-invoke.jsonl` (hash-chained MODELINV) |

The `<convo>` on spans/gates/seams/liveness **is the design doc for the engine**, and asson cycle-4 already implements it (stall→reap, spin→compact, budget→checkpoint, pace→alert). The Observatory **shows what the watchdog senses.** Nothing new to invent in the substrate — only the lens.

## The PufferLib correlation (the operator's instinct, made precise)

A composition run **is an RL episode**: the agent (party) traverses an environment (the room map), takes actions (tool calls = moves), accrues budget cost in rooms (the **consumption gradient**), and presents at gates (checkpoints). PufferLib's value here is the *shape*: a fast, legible env-render of game state. The Observatory is that render with an RPG skin — and the operator's deeper claim holds: **the mechanism is model-free (soundness), the aesthetics are model-aware (ergonomics)** — so the *map* is the same whether Fable or Haiku walks it; only the clock magnitudes change per tier.

## The cost-gradient inversion, made visible

The whole loitering answer in one picture: **rooms meter, gates are free.** The Observatory draws budget drawing down inside a room (amber→red ring) and the gate glowing cheapest-in-the-neighborhood. When a room hits the enrage wall, the party doesn't lose — it **checkpoints and presents** (chess clock). You watch least-effort-seeking deliver the party to the drain. A loiterer shows as a party eddying in a seam with a reddening clock — *seen*, not inferred.

## Data contract (real-time mechanism)

v0 bakes a trace of the asson 5-cycle run. The real-time build swaps `TRACE` for a poll of the substrate that **already exists**:

```
rooms     ← .run/compose/<run>/*.seed.json   (constructs-as-characters per stage)
moves     ← .run/audit.jsonl                  (15.7k events this session — the heartbeat)
custody   ← .run/model-invoke.jsonl           (1k hash-chained MODELINV — gate tokens)
gates     ← grimoires/loa/a2a/*/COMPLETED     (+ Legba gate tokens when live)
liveness  ← @freeside/asson/liveness#livenessVerdict over the move log
```

A 30-line `trace-gen.mjs` folds those into the `trace.json` the page polls. **Real-time = poll + animate.** Composing it *into the subagent run* means the run emits to `.run/audit.jsonl` (it already does) and the Observatory tails it.

## The `/compose` build plan (constructs build it, then run-to-observe)

This is a FEEL+ARCH job across a clean construct party — author via `/compose` (Form C runtime), cut at seams:

| Stage | Construct (character) | Cut |
|---|---|---|
| visual direction (the RPG look, the operator's video) | **the-easel** + **artisan**/ALEXANDER (craft conscience) | moodboard → tokens |
| game-UX / progressive disclosure / the map feel | **the-arcade**/OSTROM | engagement + economy of attention |
| navigation / rooms-as-rooms / transitions | **rosenzu**/BEAUVOIR | route map + door atmosphere |
| motion / the liveness clocks, the party pulse | **kansei** | timing curves, haptic-of-the-eye |
| particle/eff/glow (gates, seams, enrage) | **webgl-particles** | GPU shaders if we go past canvas |
| presentation / landing-quality framing | **showcase** | section narrative |

Then the **second** use of `/compose`: run a real composition through it and let the Observatory render the run live — the tool observing the tool. The kakukuma pixel-builder + carmack-engine are reference shapes for the renderer if it graduates past canvas.

## What's open (lead with the doubt — MAY-LATITUDE-5)

- **The aesthetic is my guess.** I can't watch the mp4. The v0 proves the *pipeline*; the *look* needs your video as the reference (that's the-easel's first cut).
- **Real-time vs replay.** v0 is replay (step/play a baked trace). Live-tailing `.run/audit.jsonl` is a small step but it's the one that makes it "see updates in real time" — worth confirming that's the priority over polish.
- **Scope.** This is a Studio. Before a big `/compose` build, the operator-check: *does the v0's room/seam/gate/clock mapping match what you saw in the video?* If yes, I compose the visual party. If the shape is wrong, we fix the shape first — cheaper now than after the pixels.

---

## Fresh-session handoff (operator steer, 2026-06-12)

**The shape is confirmed** — dungeon-rooms is right. Refinements for the dedicated session:

- **This is a FRESH dedicated session** (operator): the aesthetic build pulls art/craft constructs (the-easel, artisan, kansei, the-mint) deliberately — not bolted onto this engineering session.
- **Aesthetic reference**: roguelike movement + environment — DelveSurvivors / Tales of Maj'Eyal / Crypt of the Necrodancer / DCSS / Vampire Survivors (the operator's video genre). Grid-based dungeon rooms (gumi: "five rooms, they know what's in the room, when there's a room to proceed to" — start simple, grid later for spatial reasoning, "like chess-board coordinates").
- **THE TARGET is `/compose`-level observability**: "I should be able to see this when I run `/compose` and just see how constructs interact at that level." The Observatory renders a LIVE `/compose` run — the tool observing the tool — and extends beyond `/compose` too.
- **The deeper why** (background, attested — Anthropic NL-autoencoder + rooms-substrate + arneson): capturing the agent's reasoning *as it moves* — traces/thought-process as study material. rooms-substrate (collaborative) + arneson (adversarial, gygax trust rule) both capture reasoning+evidence as the party goes; the Observatory makes that movement *visible*. "Claude as observer has been able to work and steer."
- **Open seam**: where Claude-Code-level and operator-level observation fit (vs the construct/composition level) — the operator + gumi flagged this as a thing to figure out IN the fresh session, not now.

**Seed status**: v0 pipeline proven (`index.html` renders rooms/seams/gates/clocks from the real data contract). Engine = asson cycle-4 liveness. The fresh session starts from here: confirm grid model → the-easel pulls the roguelike look → wire live `/compose` tail → the construct-interaction render.

---

## Reference study (2026-06-12 — the homework, redone properly)

The references are the BUILDING BLOCKS, not mood. Locked vision: pixel sprites · spectate (read-only) · rooms-graph (flexible count, grid later) · focus = construct-interactions + liveness/cost-gradient + gate/seam structure · framed like a real game.

- **carmack-engine** (project-purupuru, TS/Next/Canvas) = THE RENDERER. Grid dungeon-crawler engine, pure-JSON `LevelData` (grid tiles · doors · items-keyed-to-doors-by-ID · enemies · npcs) → raycast + depth-sorted billboard sprites, low-res canvas upscaled for crisp pixels. Its law `engine delivers facts / shell supplies meaning; engine never imports ui/levels` **IS the substrate pattern** (spans propose · gates validate). **Doors-with-keys = gates-with-tokens.** We TARGET this engine; we don't rebuild a renderer.
- **kakukuma** (0xHoneyJar, Rust/ratatui) = THE SPRITE PIPELINE. Terminal-native pixel editor with an AGENT-NATIVE CLI (snapshot/describe, render-on-demand, PNG/ANSI/JSON export, Unicode half-block 2x-res). → constructs get pixel sprites GENERATED by an agent (the-mint/the-easel drive it), exported PNG for carmack or ANSI for terminal.
- **PufferLib** (pufferai, C/CUDA) = THE FRAME. Composition run = RL episode in a vectorized env; "constellation" = multi-agent module; "ocean" = the env set. Mechanism model-free, ergonomics model-aware (already in the brief).

**Architecture (rewritten by the study):**
```
/compose run ──▶ trace-gen ──▶ LevelData(JSON)  ──▶ carmack-engine ──▶ spectate-able pixel dungeon
  (real logs)    (the seam)     rooms=chambers          (renderer)         construct sprites (kakukuma)
                                gates=doors+keys
                                seams=corridors
                                constructs=sprites/npcs
```
The v0 canvas (`index.html`) is RETIRED to a toy; carmack-engine + kakukuma is the real stack. `LevelData` is the new data contract (replaces the v0 TRACE shape).

**Still open / can't-verify**: the `.mp4` (no video capability) — if it shows movement/feel the three repos don't, that's the one gap. GIGIX reference: unresolved (couldn't identify the repo).

---

## Doctrine (panel synthesis gate · obs-panel-20260611 · waves 1+2 applied)

Four sentences ratified at the GYGAX synthesis gate, binding on every future fill:

1. **The motion law, as amended (KANSEI, adopted)**: a motion is decorative when it cites no datum; every motion names its source fact, and every motion's clock is sim-time.
2. **The signature corollary (THE-EASEL)**: every state change owes exactly one signature, fired once, derived from the fact that changed.
3. **The verb restatement (ALEXANDER)**: spectate-only means no verb may mutate the facts; every verb that moves through time routes through the pure fold (`seek`).
4. **The contract sentence (OSTROM)**: the contract = shape + units (absolute for thresholded facts; only comparative facts may normalize) + emission (append-only per run).

The full fold: `panel-patch-plan.md` (66 findings → 24 fills; waves 1+2 landed 2026-06-11, wave 3 + standing forks held). Level treaty: `level-contract.mjs` (obs-level/1). Run proof: `compose-verify-run obs-panel-20260611` → `valid_run` · envelope digest `sha256:da5560f3…99d12`.

# THE OBSERVATORY v3 — Panel Patch Plan
**Synthesis gate: GYGAX (homebrew, craft-gate) · composition run obs-panel-20260611 · stage 6 · cycle-053**
Folds: 01.gygax (G-1..15) · 02.the-arcade (S-1..10) · 03.the-easel (E-1..15+grace) · 04.artisan (A-1..12+grace) · 05.kansei (K-1..7+grace)
Line landings reference game.html / trace-gen.mjs **as read at this gate**; later fills inherit earlier shifts.

## Executive summary

1. 66 panel findings folded into **24 fills**: Wave 1 = 7 (engine correctness), Wave 2 = 12 (reward/legibility), Wave 3 = 5 (texture + standing forks). No finding dropped silently; 6 superseded/downgraded with reasons, 3 held as operator taste-forks.
2. Headline: the artifact breaks its own laws on the **time axis** (seek/step/pause/remainder — A-1, G-3, G-4, K-3 are one disease, one commit) and in its **producer** (relative liveness guarantees a false ENRAGE every run; rooms minted per event-kind — S-1/S-2 mean every renderer fix downstream faithfully renders fiction until they land).
3. Second headline: two evidence-grade renderer breaks — the gate snap **never renders** on solo-keeper gates (E-2, 7 of 8 level-1 gates) and the Strong Center **teleports four times per hop** (K-1, hand-traced 17.9/34/34/17.9px).
4. The pipeline's severed joint: `?level=` is documented and does not exist (G-1/A-6) — until W1-5, this is a cutscene wearing an engine's clothes.
5. KANSEI's amended motion clause is **ADOPTED** (reasoning in §Law Amendment): *a motion is decorative when it cites no datum; every motion's clock is sim-time.* One casualty: E-11's wall-clock seal carve-out is rejected — the world freezes on pause; the chrome lives in the DOM.
6. Value conflicts resolved: camera = K-4a (exact-preserving) over G-8/E-11 variants; work-dur = A-2 over G-6 (preserves level-1's 2.2s opening exactly); reaper timing = K-6 over E-4a's entrance (E-4a's pt=1.65 strike lands *after* the existing :245 "chamber goes quiet" line at pt=1.54 — broken sequence); refusal = E-10's single reversed-travel phase over G-2's retreat+retries (no `retries[]` field exists — renderer must not invent retries).
7. Rejected/downgraded: E-11 wall-clock seal · E-4a 3-snap visible entrance · G-2 retries regate beats (→ contract note) · G-6/G-8 value variants (findings shared, values superseded) · G-3 log-tail rebuild (→ A-1 full replay) · G-14 voice table (→ E-13 superset).
8. Three taste-forks held at the gate for the operator: travel micro-texture (E-1 tile-step vs K-1 pure carry), hover-inspect (G-10b), free-look-while-paused (G-15).
9. Commit pairings honored as the rooms named them, with two disclosed deviations: K-7 lands with A-1 (KANSEI's own LANDING line, not its priority line); E-15 phrasebook rides the W1-4 treaty (ALEXANDER's pairing — it keys off the enum it ships beside).
10. The protected-praise list (§end) is a gate condition on **every** fill: instant key snap, 0.8s travel floor, 50ms dt clamp, .18s beat width, comet trail, triple-gate cluster shape, pale-steel checkpoint, gateline voice, phase-compiler grammar, uniform keeper meter.

---

## Law amendment (decided at this gate)

**ADOPTED — KANSEI's amended clause**: *"a motion is decorative when it cites no datum; every motion names its source fact, and every motion's clock is sim-time."*

Reasoning: the original "zero decorative motion" only prohibits, and v3 proved a subtractive law fails twice — the artifact obeys it perfectly while underpaying all four thesis beats (THE-EASEL's framing), and frame-clocked motion *passes* it while citing the spectator's monitor, which is not a fact of the run (KANSEI's framing). The amendment gives the law a positive test that rules cleanly on every contested fill in this plan: K-5's amplitude cites `ck[]` (legal), K-2's lean cites the spec's custody-mass clause (legal), G-11's drain pulse cites `ck≥.6` (legal, clocked on simT), and the seal blink must move to simT — which rejects E-11's wall-clock carve-out. One law, zero exceptions, beats one law with a charming exception. Is the seal's "I am still watching" lost? No — that signal already lives in the DOM chrome (the ⏸ button, the CSS title prompt), outside the world frame, where wall-clock is honest.

Three sibling doctrine sentences land with it in ORIENTATION.md (part of fill W1-4): THE-EASEL's positive corollary ("every state change owes exactly one signature, fired once, derived from the fact that changed"), ALEXANDER's verb restatement ("spectate-only: no verb may mutate the facts; every verb that moves through time routes through the pure fold"), OSTROM's contract sentence ("the contract = shape + units (absolute for thresholded facts) + emission (append-only per run)").

---

## WAVE 1 — load-bearing correctness (the engine, not the cutscene)

Strict merge order W1-1 → W1-7. Renderer chain first (1–3), producer truth (4–5), then the joints that consume both (6–7).

### W1-1 · THE TIME FOLD — one pure reducer, every time verb through it
- **Sources**: A-1 (a–e) · G-3 · G-4 · K-3 · K-7 · G-9a · G-13
- **Mechanic**: displayed state becomes a pure function of `(phases, pi, pt)`. `seek(n)` resets world, replays terminal effects for `i<n` (A-1's exact clock integral `ck += live/1.4` per work/arrive phase, capped at `live`; gates → `keys[i]=keepers`; loiter → `ck=1`; arrive → badges + `curH`; reap → `reaped=true`), replays **all** log lines (A-1's full replay over G-3's tail-4 — `log()` already trims display to 6; full replay is simpler and the 40-cap bounds it), then `enterPhase(n)`. Pause leak: wrap the clock ticks at :242-244 in `if(playing){…}` (A-1b ≡ G-4's `sdt`; pick A-1b's guard — matches the simT accumulation guard style of W1-2). Remainder (K-3, one line): `while(… pt>=dur …){ const rem=pt-phases[pi].dur; enterPhase(pi+1); pt=Math.max(0,rem); }`. Cut-vs-pan (K-7, inside seek, after enterPhase): if camera error > `Math.min(W,H)*.6` → hard cut + `trail=[]`; else pan. Kills the boot pan for free. Reaper de-hardcode (G-9a/A-1d): hoist `reapIdx` once post-compile; draw at `roomTile[phases[reapIdx].room]`; guard existence (crash fix for <8-room levels). Status dedupe (A-1e/G-13): kill the `"work · work"` double-print at :347.
- **Exact values**: as in A-1's reducer block verbatim; K-7 threshold 0.6 screens; seek also clears simT-anchored effects (`flash.until=0; ripple=null`) and sets `simT = phases.slice(0,n).reduce((s,q)=>s+q.dur,0)` (K-4's reconstruction — land the line here, it activates in W1-2).
- **Landing**: game.html:205-217, 242-247, 308-309, 341, 347, 352-356, 362-363
- **[MECHANICAL]** · **Commit**: one determinism commit (A-1 + K-3 + K-7 + G-9a + G-13). Deviation disclosed: KANSEI's priority list paired K-7 with A-9's ⏮, but its own LANDING line says "inside A-1's seek(), same commit" — landing it later would ship violent deep-link swooshes for a whole wave.

### W1-2 · TWO CLOCKS, ONE PALETTE — simT everywhere, camera with a subject
- **Sources**: E-11 · K-4 (a–d) · E-12 · (G-8 superseded)
- **Mechanic**: `simT += dt*speed` inside advance()'s playing guard. All world rhythms re-clock to simT: trail (push with stamp, window `.17s` — K-4b), seal `(simT%.5)<.267` (K-4c — **frozen on pause**, per the adopted amendment; E-11's wall-clock seal REJECTED), ring wobble `sin(simT*12)*.2`, loiter jit placeholder until K-5. Camera: **K-4a wins** — `const k=1-Math.exp(-5*Math.max(1,speed)*dt)` — over G-8's `4.5+3*speed` (stiffens 1× from .08 to ~.117, a felt change citing no datum) and E-11's `×min(2.5,speed)` variant (softens *below* 1× at the ½× study gear, decentring exactly when the spectator leans in; K-4a's `max(1,speed)` floor protects it). K-4a reproduces today's praised 60Hz/1× feel exactly (1−e^(−5/60)=.0799). Token cache (E-12): `TK={}` refreshed at boot+resize for the 10 tokens; all draw-path `css(x)`→`TK[x]`; bg fill → `TK['--bg']` (kills the `#04050a` vs `#06070d` palette fork); hoist floor literals into `:root` tokens.
- **Landing**: game.html:21, 192-193, 214, 250-251, 260-264, 291, 295, 300, 316, 325
- **[MECHANICAL]** · **Commit**: K-4 lands WITH E-11's accumulator + E-12's cache (A-3 consumes TK in Wave 2). Doctrine sentences for the motion law ride W1-4's doc change, not here.

### W1-3 · THE PRODUCER STOPS LYING — absolute liveness, real stations, per-hop custody
- **Sources**: S-1 · S-2 · G-7a · G-9b · A-grace (dead gy)
- **Mechanic**: rooms = STAGES, not event-kinds (S-2): primary source = packet `from`/`to`; orchestrator events map via `e.stage ?? e.target`; neither → attach to current station, never mint. Dwell accumulates per *current station* (fixes the gap[i]→rooms[i] index misalignment). Liveness goes absolute (S-1): `live = clamp(dwell_s/enrage_s, 0, 1)` with `enrage_s` = asson `--enrage-s` (default 300); the rule pair is law — *thresholded facts absolute, only comparative facts may normalize*. Consumer side: compile() emits the loiter/reap pair ONLY when some `live ≥ 1.0` OR a livenessVerdict attests a reap (game.html:176-181 gains the guard; healthy run = no reaper, and that absence is the correct drama). Custody per hop (G-7a): window = packet mtime → next packet mtime, replacing `custodyFor(t0,tN)` (whole-run window = first MODELINV wins all hops — data-layer bug). Loiter inference (G-9b): read asson livenessVerdict when present; only INFER (gap ≥0.9×max AND ≥enrage_s) with a stderr warning, never silently. Delete the dead `gy` ternary at :49 (A-grace).
- **Exact values**: per S-1/S-2/G-7a verbatim; level-1 baked values already conform — game.html:91-98 untouched.
- **Landing**: trace-gen.mjs:38-44, 49, 54-61, 64-68, 86; game.html:176-181
- **[MECHANICAL]** · **Commit**: producer-truth commit (S-1+S-2+G-7a+G-9b). OSTROM's stated order — these precede the treaty.

### W1-4 · THE TREATY — contract, teeth, and the voice that survives generation
- **Sources**: S-3 · S-4 · S-5a · S-6a · E-15 · (G-1's validator list absorbed — S-3 is the superset) · doctrine sentences (§Law amendment)
- **Mechanic**: new `level-contract.mjs` beside trace-gen: `schema:"obs-level/1"`, `level.meta={run_id,generated_at,contract_rev:1,sources}`, ONE invariant list enforced both sides (contiguous ids · gx,gy ints · live∈[0,1] · name ≤28 · seams valid+unique · from≠to + seam exists · **verdict ∈ closed enum {APPROVED, CHECKPOINT, EMITTED, REJECTED, DENIED}**, unmappable → EMITTED + stderr · keepers int 1..5 · badge 1..2 chars). game.html inlines a copy with `CONTRACT_REV=1` drift warning (copy-by-value WITH a sensor). Evolution rule: unknown ignored, missing-optional defaulted, missing-required → reject whole. Keepers get a currency (S-4a): count of independent attestations in the hop window (Legba gate tokens + COMPLETED markers + distinct verdict events), clamp 1..5, fallback 1 with stderr note. Verify rewrite (S-4b): vacuous check → `validateLevel()`, exit 2 listing violations. **Red test** (S-4c): `--selftest` builds a broken level (dangling seam, out-of-enum verdict, keepers:9) and asserts rejection — proof the wall fires, shipped next to the wall. Temporal clauses NOW, renders later (S-5a/S-6a): `envelopes[].wave` (int, optional, default own index — backward compatible) + the append-only emission behavior clause, plus a contract note reserving `retries[]` (G-2's regate beats DOWNGRADED here — no data carries retries yet; the renderer must not invent them). Phrasebook (E-15): 5 deterministic gatelines keyed by the enum replace the flat template at trace-gen:81 — the voice survives generation. ORIENTATION.md gains the four doctrine sentences.
- **Landing**: new level-contract.mjs; trace-gen.mjs:78, 80-81, 90, 95-99 + `--selftest`; game.html (validator inline, consumed by W1-5); ORIENTATION.md
- **[MECHANICAL]** · **Commit**: treaty+teeth commit (S-3+S-4+S-5a+S-6a+E-15+doctrine). Deviation disclosed: EASEL ranked E-15 last; ALEXANDER paired it with the loader era — it lands here because it keys off the enum shipping in this commit.

### W1-5 · THE LOADER — the severed joint, rejoined
- **Sources**: G-1 (a–c) · A-6 (1–4)
- **Mechanic**: `const LEVEL`→`let`; `boot(L)` wraps genDungeon()+compile()+seek(0)+title text (de-hardcodes "level 1" at :61 → `${LEVEL.id} — ${LEVEL.name}`). Ingestion union of both rooms, four doors: (1) `?level=<url>` fetch (http; file:// fetch blocked — documented), (2) `#level=<base64>` (A-6 — file://-safe, and trace-gen gains `--url` printing the door it just built), (3) drag-and-drop level.json onto canvas (G-1b — works on file://; loading a level is not a sim verb), (4) `window.OBS_LEVEL` one-line test seam (G-1c). Every path validates via W1-4's inlined validator BEFORE state; reject whole on any failure, log `level load failed — {e.message}` cls rage, fall back to baked level 1.
- **Landing**: game.html:61, 89, 150, 186, 360-364; trace-gen.mjs:91-93
- **[MECHANICAL]** · **Commit**: loader commit; depends on W1-4 (validator). After this commit the core loop closes: run /compose → trace-gen → watch it.

### W1-6 · GATE TRUTH — the snap that fires, the gate that can say no
- **Sources**: E-2 · G-2 · A-8 · E-10 · E-9 · G-7b · A-7 · (K-praise guard: .18 beat width, instant key snap)
- **Mechanic**: **One beat clock** (E-2, evidence-grade): `B=dur/keepers`; keys turn at `Math.floor(pt/B+.5)`; keeper bounce window `pt∈[B·(kI+.5), +.18)` — key turn, bounce, and (later) E-13's tone fire on the SAME instant (.475s on every solo gate; .475/1.425/2.375 on the triple). **VERDICT_STYLE** (G-2): APPROVED `--ok` solid · CHECKPOINT `--steel` · EMITTED `--dim #8a7f66`, key HOLLOW (glyph alpha .6), bar alpha .45 · REJECTED/DENIED `--rage`. Kills the dead ternary at :172 (A-8): CHECKPOINT→steel, REJECTED/DENIED→rage, else steel. **The refusal beat** (E-10's grammar wins over G-2's retreat+retries — fewer parts, C0-continuous, no invented retries): on REJECTED/DENIED, gate phase keys turn `--rage`, keeper snap inverts (jab DOWN +2px), then ONE `{k:'refuse', path: reversed slice, line, cls:'rage'}` phase, **no** enter/arrive/transform (refusal = no mutation; the badge never lands). Duration deviation from E-10's flat .8: `dur=Math.max(.8, path.length*.10)` — the travel formula on the reversed path, per K-1's px/s discipline. envPos treats 'refuse' as travel-shaped (lands on W1-7's waypoint chain). **Badges become objects** `{g,c,t0}` (E-9): c = CHECKPOINT→steel, REJECTED/DENIED→rage, else gold; per-glyph fillText (E-3 consumes `t0` in Wave 2). **Custody rendered** (G-7b+A-7): trail color by carrier — opus|fable `#ffce6b` · sonnet `#9fb8d8` · haiku `#7fd98a` · unknown `#8a7f66`; seal core keeps gold/steel(pale) — core carries verdict, trail carries carrier; status appends A-7's markup `<span class="seg">⛓ <b>${h.custody}</b></span>`. **Gateline append REJECTED**: custody stays out of LEGBA's line — status is the telemetry channel, the gateline is the voice (protects E-15/EASEL-praise). Level 1 (no custody, all APPROVED/CHECKPOINT) renders byte-identically except the fixed snap.
- **Landing**: game.html:167-184, 212, 221-229, 246-247, 274-285, 302-303, 314-319, 342-347
- **[MECHANICAL]** · **Commit**: one gate-truth commit (E-2+G-2+A-8+E-10+E-9+G-7b/A-7), after W1-4 (enum) and ideally after W1-7 (final envPos); if landed before W1-7, the refuse branch is re-based in W1-7's rewrite.

### W1-7 · CONTINUITY + MASS — the Strong Center stops teleporting
- **Sources**: K-1 · K-2 (a–b) · A-5 (a–b) · E-1 (as taste-fork micro-texture)
- **Mechanic**: C0-continuous waypoint chain (K-1): travel → `path.slice(0,di), dur:Math.max(.8,di*.10)` (ends at prev, where the gate holds it — **travel floor preserved**); enter → `slice(Math.max(0,di-1)), dur:.65`; envPos interpolates px waypoints with docks substituted at the ends; guard `n<1`. Dock moves clear of the resident (A-5a): `{x:c.tx*T+T/2+26, y:c.ty*T+T/2+8}` — the two most important centers stop merging at the moment of the thesis. Keeper flank fix (A-5b): `o = keepers===1 ? 16 : (kI%2?-1:1)*18*(Math.floor(kI/2)+1)` — no keeper ever on the corridor axis. Disclosures: the triple gate's middle keeper moves 18px (cluster keeps its praised shape-class, loses its flaw); k=2 spacing widens ±9→±18 (ALEXANDER's "unchanged" claim is an arithmetic slip — current formula gives ±9; no k=2 gate exists in level 1, and ±18 matches the k≥3 grid). Mass (K-2): carry curve `a/(a+b)`, exponents 1.8/1.2 (10.4% at quarter-time, 39.7% at half); damped lean `7*Math.exp(-pt/.09)*Math.sin(20*pt)` for pt<.25 at the gate (strain toward the door, direction from prev→tile) and at arrive (compile stamps `ax,ay` from the path's last segment; the bowl seats 3.4px past the dock, dead by 250ms). `ease()` becomes unreferenced after Wave 2 (K-6 replaces its reaper use) — delete then.
- **[TASTE-FORK — travel micro-texture]**: **Option A** (E-1): per-tile easeOutQuad `uu=u*(2-u)` + `−2px·sin(π·uu)` hop arc — the discrete roguelike step, ticks per landing (feeds E-13); **Option B** (K-1 as written): linear within segment — one carried mass, no step texture. Both keep K-2's macro carry and K-1's continuity; the fork is genre-signature vs material-purity. Option A is the panel's majority read.
- **Landing**: game.html:169, 171, 173-174, 194, 221-228, 275
- **Commit**: K-1+K-2+A-5 one commit (KANSEI's pairing — split, the jumps grow to 27.2px).

---

## WAVE 2 — the reward and legibility systems

Strict order W2-1 → W2-12.

### W2-1 · LEVELS OF SCALE — time and space derive from facts
- **Sources**: A-2 · A-10 · (G-6 superseded on values, honored on finding)
- **Spec**: work dur = `Math.min(3.6, .9+2.6*live)` at :165 and :181 — **A-2's formula wins** over G-6's (preserves level-1's praised 2.2s opening *exactly*: .9+2.6·.5). G-6's absolute-data successor (`clamp(dwell_s/8, .8, 4.5)`) noted for the producer era once dwell_s ships. Space (A-10): chamber radius from facts — `RAD(r) = (loiter-target || live>=1) ? 3 : 2`; carveChamber generalizes; doorIndex `d<=RAD(...)`; clearances verified (GAPY=9 leaves 2, GAPX=11 leaves 4). Exactly one level-1 room grows: the geographic Strong Center becomes the dramatic one. E-5's fog Chebyshev must use RAD(r) (honored in W2-6).
- **Landing**: game.html:133-135, 156-158, 165, 181 · **[MECHANICAL]** · **Commit**: A-2+A-10 pair.

### W2-2 · THE WALL AND THE EDDY — one tension system, one datum
- **Sources**: A-3 (a–b) · K-5
- **Spec**: ring notch — 6px rage tick at 12 o'clock where the arc will close, drawn whenever u>0 (uses TK); HUD gauge gets the 60% warn-line via `.clock::after`. Eddy (K-5): two incommensurate sines `(sin(simT*7.3)+.6*sin(simT*11.9))*A` + orbit `jy=.5*cos(simT*9.1)*A`, amplitude `A=.6+1.4*min(1,ck[r.id])` — agitation rises with the flood, every pixel citing ck; beat period ≈1.37s, never visibly repeats inside the 6.5s loiter; freezes on pause (simT), slows at ½×.
- **Landing**: game.html:32, 291-294, 297-300 · **[MECHANICAL]** · **Commit**: A-3+K-5.

### W2-3 · TELEGRAPH → DREAD → STRIKE → SILENCE → WOUND — the climax as one instrument
- **Sources**: A-11 (a–b) · K-6 · E-4 (b–c kept; a superseded)
- **Spec**: telegraph (A-11): one-shot log at `ck≥.85` during loiter ("something stirs above the chamber…", rage; `tele` flag reset by seek) + FOV iris `.46→.40` contraction. Reap re-timed (K-6, total 2.8s unchanged): DREAD pt 0–.9 — **sprite draw skipped, body unseen** (E-4a REJECTED: visible body contradicts the dread beat; its pt=1.65 strike would land *after* the :245 log at pt=1.54 — K-6's 1.18 strike puts that log 360ms after the blow, already correctly placed). STRIKE pt .9–1.18: easeInQuad gravity, 150px in .28s, impact ≈1071px/s. IMPACT at pt=1.18: E-4b's effects anchor HERE — 5×5 floor flash white alpha .65 for 2 frames; one camera shake `4*exp(-(simT-strikeT)/.09)*sin((simT-strikeT)*70)`, render-only, dead in ~280ms, fires once. Rest position: one-tile-right amended by A-5's coordination → `rx=(c.tx+1)*T-cam.x+6` (never occludes the resident, 5px clear of the docked envelope). PERMANENCE (E-4c): post-strike resident at globalAlpha .55, clock ring frozen full-red — the chamber stays wounded; seek() reconstructs the wound.
- **Landing**: game.html:177, 244-245 (verify), 294, 308-311, 329-333 · **[MECHANICAL]** · **Commit**: A-11+K-6+E-4 one commit.

### W2-4 · THE TRANSFORM EARNS ITS THESIS — three beats, once each
- **Sources**: E-3 (1–3) · K-grace (flash decay)
- **Spec**: hold `flash={room, until:simT+.16}` with K's decay envelope (white hold 50ms, then overlay alpha `exp(-(ft-.05)/.07)` — afterimage gone ~250ms); badge punch-in 22px→12px ease-out over 240ms reading `t0` from W1-6's badge objects; one ripple `r=8+14*q`, lineWidth 2, alpha `.8*(1-q)`, 360ms, once. All simT-anchored; seek clears.
- **Landing**: game.html:209, 295, 302-303, +6 lines room loop · **[MECHANICAL]** · **Commit**: standalone; requires W1-1/W1-2.

### W2-5 · THE FORGE — work gets its signature and its words
- **Sources**: A-4 (a–b)
- **Spec**: 4 discrete forging quanta during work — `q=floor(min(1,pt/dur)*4)/4`; size `6+6q`, alpha `.35+.65q`, seal blink only at q≥.75 (snap grammar, no continuous ramp). compile() stamps `nh` (next hop) on work phases; status during work → `forging · ${nh.payload}` / `at rest` — retires the false `envelopes[0]` fallback permanently.
- **Landing**: game.html:165, 181, 313-326, 341 · **[MECHANICAL]** · **Commit**: standalone.

### W2-6 · MAP MEMORY + NAMES — the Void learns history
- **Sources**: E-5 · E-6 · (composes S-6's live fog)
- **Spec**: `visited` Set seeded with phases[0].room; reveal SNAPS at Chebyshev ≤ RAD(r) of the envelope's tile; unvisited rooms render flat `#0a0c14`, sprite/ring/name/badges skipped, corridor stubs still drawn (doors into dark IS the read). Escape hatches: `?reveal=1`; end phase reveals all; reset clears to seed. Names (E-6): every visited room wears a plate — active gold (rage when loitering) alpha 1.0; visited-idle `--dim` alpha .55; 12px double-painted (+1,+1 black first).
- **Landing**: game.html:133-135, 255-265, 288, 304-305, 353, 360-364 · **[MECHANICAL]** · **Commit**: E-5+E-6.

### W2-7 · ROLE TEMPERATURE + GOLD DISCIPLINE — one center per surface
- **Sources**: E-7 · E-8 · G-12
- **Spec**: temperature bands — keepers become the ONLY cold-steel monochrome (sprite rows drop 'b' for 's'); vocab 'b'→new PAL `v:'#8a7fe8'` indigo; G-12's proto re-palette s→a (amber, protocol-as-seal). Keepers gain constant faint steel glow (blur 3 idle / 9 active). Keys: unturned `#3a4158`→`#5a648a` (~2.9:1), font 13px. Gold discipline (E-8): `--warn` → `#f08c3a` true orange (ramp reads green→orange→red); status drops the inline gold on the payload — the ⟐ glyph alone marks the envelope. S-9's spend bar must use `--torch`, never `--gold`.
- **Landing**: game.html:21, 64, 74-75, 280-282, 345 · **[MECHANICAL]** · **Commit**: E-7+E-8+G-12 one palette/role commit.

### W2-8 · STUDY VERBS — the session loop closes
- **Sources**: S-7 · A-9 (a–b)
- **Spec**: `⏮` before #stp → `seek(Math.max(0,pi-1))`; speed cycle gains the study gear 1→2→4→½→1 (display '½×'); keyboard Space/←/→ as presentation bindings (verb count ≤6; all route through the fold).
- **Landing**: game.html:56, 349-358 · **[MECHANICAL]** · **Commit**: S-7+A-9.

### W2-9 · THE MORGUE + THE SHELF — the run presents, and runs accumulate
- **Sources**: G-5 · S-8 (a, b, d) · E-14b
- **Spec**: canvas morgue card at `end && pt>2.0` — 420×(56+18·rows), bg rgba(6,7,13,.92), 1px #2a3147; rows ALL derived: hops n/n · keys turned (Σ keepers) · transforms · ENRAGE × · REAPED × (rage row) · salvage (count CHECKPOINT) · deepest clock · run time Σdur@1×. Footer (S-8a): `run {meta.run_id} · {meta.generated_at}`. THE KEYRING (S-8d): every key turned as a ⚷ row colored by verdict. Shelf (S-8b): localStorage `obs.shelf`, max 12, `{id,name,hops,keys,reaped,enrage,ms,ts}` written once on entering end (dedupe by id). End-reveal (E-14b): FOV outer radius lerps `.46→.85·min(W,H)` over 2.5s, once — attention finished, dungeon revealed at rest.
- **Landing**: game.html end-phase branch, drawMorgue(), 329-333 · **[MECHANICAL]** · **Commit**: G-5+S-8(a,b,d)+E-14b. (S-8c title rows → W3-2.)

### W2-10 · THE GAME TEACHES — one-shot beats, honest disclosure
- **Sources**: S-10 · G-10a · S-5b
- **Spec**: three one-shot teaching lines guarded by `taught` Set: first clock ≥.6 → "the clock yellows — at the flood, the reaper comes"; first keepers≥2 gate → "three keys — this door trusts no single hand"; first CHECKPOINT → "a checkpoint is not a defeat — the party presents" (all dim italic, max 3/run). Badge recall (G-10a): during a room's work phase, status cycles its badge history (1 item/2s). Wave disclosure (S-5b): one log line per multi-hop wave — "wave N — the party splits: M envelopes in flight (shown in turn)".
- **Landing**: game.html:167, 241-247, 337-348 · **[MECHANICAL]** · **Commit**: one legibility-lines commit.

### W2-11 · THE SECOND CURRENCY — the spend bar
- **Sources**: S-9
- **Spec**: `rooms[].spend_micro` optional (producer sums cost_micro per station window; omit when absent — honest absence, no bar). Render: 2px `--torch` bar under the room name, width `clamp(spend/maxRoomSpend,0,1)*28`; status appends `· $X.XX` for the active room when present.
- **Landing**: trace-gen.mjs:63-68; game.html:288-306, 342-347 · **[MECHANICAL]** · **Commit**: standalone, after W1-4.

### W2-12 · THE DRAIN GLOW — the thesis pixel
- **Sources**: G-11
- **Spec**: destination door bar alpha pulses .55→.85 at 0.8Hz on simT ONLY while the active room's clock is past the warn band (cites `ck≥.6`) — the exit reads cheaper exactly when the room gets expensive. One-shot log per room (`drainNoted` Set): "the door is cheaper than the room — the drain pulls."
- **Landing**: game.html:284-285 · **[MECHANICAL]** · **Commit**: standalone tail of Wave 2.

---

## WAVE 3 — texture, garnish, and the standing forks

### W3-1 · THE SNAP SPEAKS — seven synthesized voices
- **Sources**: E-13 · G-14 (merged — E-13's table wins wholesale: key-turn 45ms; transform 1320+660Hz/90ms; enrage 3×120ms pulses-then-SILENCE; reap 55Hz 300ms + 80ms noise)
- **Spec**: AudioContext in title.onclick (the autoplay gesture); `bleep(type,f0,f1,ms,g)` ~30 lines; voices fire ONCE per state change at the beat instants W1-6/W1-7/W2-3 defined; step tick per waypoint landing only if W1-7 fork chose Option A. 🔊/🔇 in #ctl; `prefers-reduced-motion` → default muted.
- **[MECHANICAL]**, one named sub-fork: default state on first visit (sound-on vs muted) is the operator's call.
- **Landing**: game.html:56, 357, hooks at the beat sites · **Commit**: one audio commit.

### W3-2 · THE BOOKEND — the title gets pixels, a legend, and a memory
- **Sources**: E-14a · A-12 · S-8c
- **Spec**: 48×48 inline canvas above the h1 drawing the envelope exactly as in-game (rotated gold square, dark core, seal blinking on the .5s cadence). A-12's three legend lines (⟐ / ⚷ / ◔) in dim 11px under the subtitle. S-8c: last 5 shelf entries as dim read-only rows.
- **Landing**: game.html:43-51 (CSS), 61 · **[MECHANICAL]** · **Commit**: one title commit.

### W3-3 · LIVE MODE — the map reveals itself
- **Sources**: S-6b
- **Spec**: `?live=<url>` polls 2000ms; `level.partial:true` compiles phases-so-far + `{k:'wait', room:lastTo, dur:1e9}` where the resident idles and its clock ticks at WALL-CLOCK rate (`ck += dt/enrage_s` — the one place 1:1 time is correct, a *fact* clock); new envelopes splice before the wait without resetting pi; end only on the COMPLETED marker. Composes W2-6: rooms appear as the run reaches them — fog-of-war extended to time.
- **Landing**: game.html ~:360 poll loop + compile()/draw() wait branch · **[MECHANICAL]** · **Commit**: standalone.

### W3-4 · GRACE NOTES — the small agreements
- **Sources**: E-grace · A-grace
- **Spec**: loiter gate's verdict bar paints `--stone` between the loiter arrive and the checkpoint's gate, re-opened `--steel` by the checkpoint exit. Travel line gains the destination: "departs X **for Y** — carrying…". `#pp` guard at end: `if(phases[pi].k==='end')return;`.
- **Landing**: game.html:170, 267-286, 350 · **[MECHANICAL]** · **Commit**: one grace commit.

### W3-5 · STANDING TASTE-FORKS — held at the gate, operator's eye required
- **G-10b hover-inspect** — mousemove → nearest room ≤48px → one-line canvas tooltip. For: spectate-only bans CONTROL, not READING. Against: first pointer-reactive surface in a piece whose camera is the narrator.
- **G-15 free-look while paused** — drag-to-pan only while !playing, camera lerps home on resume. Mutates view, never sim. Against: if the spine means "the camera IS the narrator," this hands the camera to the audience.
- **W1-7 micro-texture** (restated for the ledger): E-1 tile-step (Option A) vs pure carry (Option B) — decided at W1-7 merge time.

---

## Rejected / superseded ledger

| Item | Source | Disposition | Reason |
|---|---|---|---|
| Wall-clock seal ("still watching") | E-11 | REJECTED | Violates the adopted amendment; the liveness signal already lives in DOM chrome. |
| 3-snap visible reaper entrance, strike at pt=1.65 | E-4a | SUPERSEDED by K-6 | Visible body contradicts the dread beat; 1.65 strike lands *after* the :245 log (pt=1.54). E-4's rest offset, strike effects, permanence KEPT. |
| retries[] regate beats | G-2 (part) | DOWNGRADED to W1-4 contract note | No `retries[]` field exists; the renderer must not invent retries. |
| 3-tile retreat + travel-home refusal | G-2 (part) | SUPERSEDED by E-10 | Two-phase retreat re-introduces a K-1-class discontinuity. E-10's dur amended to the travel formula. |
| Camera `4.5+3·speed` / `×min(2.5,speed)` | G-8 · E-11 | VALUES SUPERSEDED by K-4a | G-8 stiffens the praised 1× feel citing no datum; E-11 softens below 1× at the study gear. |
| Work dur `0.8+2.6·live` | G-6 | VALUES SUPERSEDED by A-2 | A-2 preserves level-1's 2.2s opening exactly. |
| Log tail rebuild [n−3,n] on seek | G-3 (part) | SUPERSEDED by A-1 full replay | log() already trims display; full replay simpler, bounded. |
| 4-voice audio values | G-14 | SUPERSEDED by E-13 | One table, one owner; E-13's enrage pulses-then-silence is the better grammar. |
| G-1 validator field list | G-1 (part) | ABSORBED into S-3 | S-3 is the superset; two validators would drift. |
| G-4 loiter-jitter pause exemption | G-4 (part) | SUPERSEDED by K-5 | The eddy now cites ck and clocks on simT — freezes on pause; no exemption needed. |

---

## Consistency table (law × fills × verdict)

| Standing law | Fills touching it | Verdict |
|---|---|---|
| **The ENVELOPE is the Strong Center** | W1-1 · W1-2 · W1-6 · W1-7 · W2-3 · W3-2 | **HOLDS, strengthened.** Center stops teleporting, stops merging with residents, stays centered at every gear. Custody colors the trail, never the core. |
| **LEVEL is pure-JSON facts; renderer never invents state** | W1-1 · W1-3 · W1-4 · W1-5 · W1-6 · W2-1 · W2-11 | **HOLDS, extended to the time axis and the producer.** The one prior violation in the trust channel — every key turning green — closes at W1-6. |
| **Spectate-only verbs** | W1-1 · W1-5 · W2-8 · W2-9 · W3-1 · W3-3 · W3-5 forks | **HOLDS** under the restated clause (no verb mutates facts). G-10b/G-15 held as forks, not landed. |
| **The Void is structural** | W2-6 · W2-9/E-14b · W3-3 | **HOLDS, deepened.** Void splits into never-seen vs seen-now-dark; live mode makes the Void honest epistemics. |
| **Density-as-clarity** | W2-7 · W2-10 · W2-11 · W3-2 · W2-9 | **HOLDS.** No new chrome in-world; every added pixel is a derived fact at minimum ink. |
| **Zero decorative motion — AS AMENDED** | W1-2 · W1-7 · W2-2 · W2-3 · W2-4 · W2-12 · W3-1 | **HOLDS under the amendment.** Every motion names its datum and clocks on simT. Uniform keeper meter deliberately NOT staggered — no per-keeper datum exists. |

---

## Protected praise (gate condition — no fill may break these)

1. **Instant key color snap** (:280) — grey → verdict color with no fade, ever.
2. **Travel floor** `Math.max(.8,…)` (:169) — preserved verbatim in K-1's re-based dur.
3. **dt clamp** `Math.min(.05,…)` (:239) — untouched.
4. **.18s beat width** (:277) — preserved in E-2's rewritten window.
5. **Trail-as-comet** alpha ramp — only re-clocked and custody-colored; shape untouched.
6. **Triple-gate cluster** — shape-class preserved; A-5b's 18px middle-keeper move removes the pass-through flaw.
7. **Pale-steel checkpoint envelope** — core color logic untouched.
8. **Gateline prose voice** — E-15 keeps it alive on generated levels; custody stays OUT of the gateline.
9. **Edge-only walls, FOV restraint, single status line** — untouched except the end-reveal.
10. **Phase compiler grammar** (:164-186) — its facts→meaning shape is the artifact's quiet masterpiece.
11. **Loiter 1.4× overfill physics** (:244) — preserved and exactly reproduced by the seek integral.
12. **Scanline overlay** at .5 — keeps; it earns its dimming as the piece's CRT register.
13. **Linear timeline** — correct; the run happened one way. S-5's wave field makes the one dishonest compression honest without adding branching.

---

```json
{
  "construct_slug": "gygax",
  "output_type": "Verdict",
  "verdict": {
    "summary": "Synthesis gate folded 5 room envelopes (66 findings) into one patch plan of 24 fills across 3 waves (W1=7 engine correctness, W2=12 reward/legibility, W3=5 texture+forks), strict merge order, atomic commit pairings honored, 9 rejections/supersessions with reasons, value conflicts resolved (camera=K-4a, work-dur=A-2, audio=E-13), KANSEI's amended motion clause ADOPTED, 3 taste-forks held for the operator, 6-law consistency table all-HOLDS, 13-item protected-praise gate condition."
  },
  "invocation_mode": "room",
  "cycle_id": "cycle-053",
  "persona": "GYGAX",
  "composition_run_id": "obs-panel-20260611",
  "stage_index": 6,
  "evidence": [
    "envelopes 01-05 read in full at .loa/constructs/substrates/.run/compose/obs-panel-20260611/envelopes/",
    "game.html:172 'steel':'steel' dead ternary verified",
    "game.html:222 dock -16,+8 inside resident box verified",
    "game.html:246-247+277 solo-gate snap impossibility verified",
    "game.html:309 roomTile[7] hardcode verified",
    "game.html:245 reap log at p.dur*.55=1.54s — the cross-check that decided K-6 over E-4a",
    "trace-gen.mjs:49 dead gy ternary, :59-60 relative liveness, :80 keepers:1, :86 custodyFor(t0,tN) whole-window verified"
  ]
}
```

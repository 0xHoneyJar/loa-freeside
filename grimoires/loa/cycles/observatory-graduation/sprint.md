# Sprint Plan — The Observatory Graduation

> **Cycle**: observatory-graduation · **PRD + SDD**: this dir (both FLATLINE-REVIEWED)
> **Status**: FLATLINE-REVIEWED (3-model · 100% agreement · 10 HIGH integrated · 10 BLOCKERS addressed inline) — simstim-20260612-3693fe7e phase 6 complete
> **Flatline artifact**: cycles/observatory-graduation/flatline-sprint-review.json
> **Execution home**: sprints S1–S5 are **crs-bound** (construct-rooms-substrate, branch `cycle/observatory-graduation`) — dispatched via /coord per PRD BLOCKER-4 contract. Beads: created in crs at /run time (loa-freeside beads is DEGRADED and is not this cycle's tracker).
> **MVP** = S1–S4 · wave 2 = S5 · out of scope per PRD §6.

## Sprint 1 — GRADUATE (crs)
**Goal**: the capability lives in its final home; the shell skeleton exists; the loiter is diagnosed.

| # | Task | Acceptance |
|---|---|---|
| 1.1 | crs branch `cycle/observatory-graduation`; move `observatory/{engine,contract,producers,cli}` by PR (loa-freeside copy untouched until merge) | PR open; `obs sim --seed 42` byte-matches the veve vector FROM the new home; engine opens file:// locally |
| 1.2 | Shell skeleton per SDD §5: `app/observatory/` route iframing same-origin engine + agentation (dev-only) + `/api/sim` with clamps + token-bucket middleware | `next build` green; iframe renders engine; `/api/sim?seed=42` byte-matches vector; agentation toolbar visible in dev only |
| 1.3 | A-2 checkpoint: crs CI/layout accepts the app per IMP-001 trigger criteria | Decision logged (accept / fire freeside-observatory fallback) — operator at S1 review |
| 1.4 | k-hole loiter diagnosis (R-6): root-cause from session logs/run dirs. **Structured format (IMP-004)**: `{symptom, evidence (paths/lines), root_cause, verdict_on_A3: confirmed|disproven|inconclusive}` | Finding in `decisions.md`; **if disproven/inconclusive → remediation path (IMP-005): one-day re-grounding spike updates SDD §3.3 mechanics BEFORE S3.4 may close** |
| 1.5 | `VERIFY.md` scaffold (G-2 checklist, empty rows for every §4 doctrine beat) | File exists; CI placeholder job runs selftest + vectors |

## Sprint 2 — REV 2 + THE VOCABULARY (crs)
**Goal**: the contract speaks IMPASSE and hardness; FR-A beats render.

| # | Task | Acceptance |
|---|---|---|
| 2.1 | level-contract rev 2: IMPASSE verdict · `envelopes[].gate{hardness,mechanism,help,teaches}` · `level.clews[]` · cross-rev behavior (SDD §3) · red tests for each new rejection · **HTML sanitization (flatline SP-B6)**: all level-sourced text rendered via a sanitizer (escape-by-default, whitelist `<b>/<i>`) — the log's innerHTML path is closed to untrusted levels | `--selftest` covers 3 new red cases; rev-1 level loads with hardness=unknown; **a level with `<script>` in gateline renders inert (test)**; rev-1 visual regression capture diff (IMP-008) |
| 2.2 | `hardness-manifest.json` v1 seeded with ≥6 real gates (compose-verify-run, PreToolUse guards, path-domain-check, audit-chain, adversarial-review COMPLETED block, beads preflight) | Manifest joins at fold time; unknown → HOLLOW verified by capture |
| 2.3 | Engine: hardness rendering (SOLID/HOLLOW doors+keepers) + tier-2 `gate.help` tooltip plate + tier-3 `gate.teaches` in refusal gatelines + IMPASSE violet styling | agent-browser captures at `?phase=` for each beat; VERIFY.md rows filled |
| 2.4 | Producers emit rev 2 (trace-gen joins manifest; sim-gen emits gate blocks); re-vector goldens; veve re-attested | New vector hashes in veve.json; CI green |

## Sprint 3 — THE THREAD (crs)
**Goal**: distress is a legal, rendered move; the dungeon gains its first summon.

| # | Task | Acceptance |
|---|---|---|
| 3.1 | sim-gen: stuck policy drops voluntary clew; watchdog (liveness-derived) drops involuntary clew at flood — identical packet shape, `dropped_by` differs; packet_digest = JCS-sha256 | Golden vector: stuck→clew story (G-4 third story) |
| 3.2 | Engine: thread polyline (clew room → divergence) · retrace beat (reverse walk, pale violet) · rotate beat (sprite swap + ↻ badge) · heal beat (GECKO sprite summon — reaper choreography at friendly tempo) · ◷ involuntary badge | Captures for all four beats; thread renders across ≥2 seams |
| 3.3 | The three prices render: clew ends the span (no continue) · signed (chain badge) · ordering visible (loiter burns > clew > finish in the morgue tally) | Morgue gains clew row; teaching line on first clew |
| 3.4 | FR-B closure gate: 1.4's diagnosis reviewed; if A-3 disproven, re-ground mechanics (IMP-006) | decisions.md entry with beat citation |

## Sprint 4 — AGENTS PLAY (crs)
**Goal**: the rehearsal seat is real — one construct-agent plays one episode.

| # | Task | Acceptance |
|---|---|---|
| 4.1 | `producers/policies.mjs` registry as pure decision functions + conformance tests: pure (same state→same action) · total over a sampled state grid · **bounded by the harness tick cap (flatline SP-B8: 'terminating' is not decidable for arbitrary functions — the SIM enforces the bound, the test verifies the cap fires)** | Tests green; functions documented |
| 4.2 | `obs play --policy <name> --seed N`: registry-only resolution (SDD-B1/B7), emits episode JSONL (schema-validated) + folded level | Episode validates; level renders the replay; **`--policy ./any/path.mjs` exits 2 (IMP-010: bypass attempt is a tested rejection)** |
| 4.3 | One construct-agent plays end-to-end (haiku-tier dispatch): invokes obs play, episode validates, level spectated | The episode's level + JSONL archived in cycle dir; G-4 satisfied with vectors |
| 4.4 | decisions.md: G-1 ledger live — log gate-design decisions with rendered-beat citations as they occur | **Trajectory explicit (IMP-003): ≥1 entry by S4 close, ≥3 by cycle end (G-1)** — same metric, two checkpoints, no conflict |

## Sprint 5 — SHARE (wave 2, crs)
**Goal**: gumi can watch.

| # | Task | Acceptance |
|---|---|---|
| 5.1 | `redactLevel` per SDD §3.6 + trace-gen `--redact`. **Spec complete (flatline SP-B7)**: salt = `crypto.randomBytes(16)`, function-scope only, never persisted/logged; allowed fields enumerated IN the contract (the allowlist is code, not prose); test fixtures include sensitive-looking strings (keys, repo names, emails); **topology leakage documented as accepted** (room count/shape/timing survive redaction — by design, it IS the share value) | Same level redacted twice → different salts, same topology; vocabulary un-reversible without salt; **fixture suite green; unredacted-ingestion rejection is an acceptance TEST (IMP-011)** |
| 5.2 | Vercel deploy — sim-first public surface. **Scope precise (flatline SP-B1/B3): /api/sim ships WITH its SDD §5 abuse bounds; /api/level does NOT ship (its six-condition spec is the pending one — the conflation is resolved)**; no auth on /api/sim by decision (pure clamped function + CDN cache; the burst test is the control) | Public URL renders baked level + /api/sim; **abuse tests pass: out-of-range params rejected, burst → 429 (token bucket verified)**; share link sent to gumi |
| 5.3 | G-3 attempt: live-spectate a real /compose run via serve + ?live= — **LOCAL-only this cycle (flatline SP-B2): the deployed engine restricts `?live=`/`?level=` fetches to same-origin relative paths (no cross-origin URLs — SSRF/exfil closed); live-spectate of real runs happens on localhost** | decisions.md entry on what the watching changed; deployed-engine fetch restriction has a test |

## Cross-cutting
- **Verification per sprint**: CI = selftest + vectors + policy tests + build; visual = agent-browser captures into VERIFY.md. **Determinism env pinned (flatline SP-B10)**: vectors run under Node ≥22, `LANG=C TZ=UTC`; digests = JCS canonical JSON; captures = agent-browser 1440×900 at deterministic `?phase=` seeks (the engine's sim-time law makes them reproducible) — baseline images checked into VERIFY.md.
- **/coord dispatch**: each sprint is a crs work order carrying {branch, artifact manifest, acceptance}; loa-freeside session reviews + gates. **Dispatch gates (flatline SP-B4)**: the S2 work order may not OPEN until S1.3's A-2 decision is logged in decisions.md — a mechanical precondition of the dispatch, not a convention. **Dependency arrows (SP-B5)**: S3.4 is blocked-by S1.4 (the sprint cannot close on an unchecked citation).
- **Cross-repo sync audit (flatline SP-B9)**: `coord-ledger.md` in this cycle dir maps sprint → work order → crs PR → review verdict; a sprint closes only when its ledger row is complete (the verifiable handoff mechanism; L6 handoff docs carry the artifact manifests). Tracker of record = crs beads (IMP-006); this ledger is the loa-freeside-side mirror.
- **Dual-state rollback (IMP-012)**: if the crs graduation PR is unmerged after two sprints, the operator decides abort/extend at a named checkpoint; loa-freeside remains canonical until merge — drift window bounded.
- **Out of these sprints** (PRD §6): FR-G KEEPER intake, GECKO manifest-drift sensing, asson `clew drop` runtime verb, gygax balance pass — marked blocked-by/wave-3, never silently absorbed (IMP-012).

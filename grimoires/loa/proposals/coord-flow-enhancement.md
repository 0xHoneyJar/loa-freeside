# /coord Flow Enhancement — Compose with /simstim + /run-bridge + Flatline

**Status**: Candidate (discussion-piece; not yet operator-ratified)
**Date**: 2026-05-25 PM
**Triggered by**: operator question 2026-05-25 PM — *"Is there a reason the bootstrapping doesn't include the sprint? Is there a reason we don't flatline-review all of the files?"*
**Distills back to**: `construct-freeside/skills/coordinating-cross-repo/SKILL.md` v0.9.0 (proposed) AND/OR new ADR-010 (Cross-Repo Coordination Rigor)

## The gap (operator surfaced)

Current `/coord` skill is a THIN DX layer:
- Scaffolds coordinator dir (bin/lib/cockpit/grimoires)
- Author task-manifest by hand
- `coord-bootstrap.sh` opens GitHub issues + creates beads
- Manual dispatch (operator spawns headless Agent in target cell repo; "no push")
- Manual review + PR
- `coord-sync.sh` flips bead external_status

**What's missing**: every gate Loa already has for rigor.
- No flatline-review on the master plan (PRD/SDD/Sprint authored by hand without multi-model adversarial pass)
- No /simstim composition (the meta-orchestrator that DOES drive PRD→SDD→Sprint with flatline at each)
- No /run-bridge composition per cell (the iterative excellence loop)
- No flatline-readiness check at bootstrap time
- No cost preview before fanning work to N cells

**Operator's insight verbatim**:
> "I think that bootstrapping should perform this whole flow up until the sprint then /run-bridge would run the sprints or tasks within each of the repos (if it's sprint sized. if it's implement sized then using implementation workflow and using /fagan correctly would ensure rigor)."

The /coord skill should COMPOSE existing Loa primitives, not bypass them.

## The Loa primitive stack (what we already have)

| Primitive | What it does | Cost | State |
|-----------|--------------|------|-------|
| **/simstim** | Meta-orchestrator: 8 phases (PREFLIGHT → DISCOVERY → ARCH → SDD-REVIEW → SPRINT → SPRINT-REVIEW → IMPL → DONE); FLATLINE at gates 2/4/6; HITL drives planning; HIGH_CONSENSUS auto-integrates; Phase 7 invokes /run sprint-plan | $25-65/cycle | `.run/simstim-state.json` |
| **/run sprint-plan** | Autonomous implement + review + audit cycle with circuit breaker | depends | `.run/sprint-plan-state.json` |
| **/run-bridge** | Iterative improvement loop: run sprint plan → BRIDGEBUILDER review (with GPT-5.3-codex cross-review dissent) → parse findings → new sprint → repeat until flatline (kaironic termination) | $10-20/depth-5 | `.run/bridge-state.json` |
| **/implement** | Single sprint implementation; smaller scope than /run sprint-plan | depends | per-sprint |
| **FLATLINE** (substrate) | Multi-model adversarial review (Opus + GPT-5.x + Gemini); 20+ scripts under .claude/scripts/flatline-* ; HIGH_CONSENSUS auto-integrate, BLOCKER halt | varies | `.run/flatline-state.json` + result envelope |
| **BRIDGEBUILDER** (persona = BEAUVIOUR) | Senior-FAANG-engineer voice (Google Stubby, Jeff Dean, Stripe, Netflix); dual-stream output (findings JSON + insights prose); used by /run-bridge | varies | per-review JSON |
| **/fagan** | NOT FOUND as direct skill; per operator framing applies to "implement-sized" work; likely composes flatline-review or bridgebuilder-review on a smaller scope. Open question: is /fagan a yet-to-be-authored skill, OR does operator mean "apply Fagan-inspection-style rigor via existing flatline-review on smaller surfaces"? |

The composition story the operator is sketching: **/coord becomes a /simstim-+-per-cell-/run-bridge orchestrator with FLATLINE-graded artifacts at every gate.**

## The redesigned /coord flow

### Phase 1: Scaffold (~5 min, mostly mechanical)

Current state — KEEP.

```
mkdir + git init + br init + vendor bin/lib + cockpit.sh + task-manifest.yaml authored by operator
```

Output: empty coordinator dir, ready for planning.

### Phase 2: Plan-through-sprint via /simstim (~30-60 min HITL + multi-model time + $25-65)

**NEW.** The bootstrap kicks off /simstim against the coordinator (not against a single repo). The master_cycle_label becomes the simstim cycle name. /simstim runs:

```
Phase 0: PREFLIGHT
   - flatline-readiness check (verify Opus + GPT-5.3-codex + Gemini providers available)
   - Cost preview to operator (estimate $X for plan-through-implement across N cells)
   - Operator GO gate

Phase 1: DISCOVERY → PRD
   - HITL interview with operator (mission objective, cells touched, success metrics)
   - PRD authored in coordinator's grimoires/loa/prd.md
   - Optionally: per-cell PRDs in each cell's child_cycle_path

Phase 2: FLATLINE-REVIEW (PRD)
   - Multi-model adversarial pass on the PRD
   - HIGH_CONSENSUS findings auto-integrate
   - BLOCKER halts → operator decides

Phase 3: ARCHITECTURE → SDD
   - HITL design session
   - SDD authored
   - Per-cell SDDs as needed

Phase 4: FLATLINE-REVIEW (SDD)
   - Same multi-model pass on SDD
   - Architectural decisions get FAANG-graded critique

Phase 5: SPRINT-PLAN
   - Beads tasks generated PER CELL from sprint plan
   - task-manifest.yaml refined from operator's hand-author (Phase 1 scaffold) to be plan-derived
   - coord-bootstrap.sh OPENS GitHub coord issues at this point (not before — issues should reflect the planned scope, not the scaffold guess)

Phase 6: FLATLINE-REVIEW (Sprint)
   - Multi-model pass on sprint plan
   - Last gate before implementation fan-out

Phase 7: IMPLEMENTATION
   - Per cell: /run-bridge OR /implement+/fagan (see Phase 3 below)
```

Output: master PRD/SDD/Sprint flatline-reviewed; beads task graph cross-repo-stitched; ready for execution.

### Phase 3: Per-cell execution (parallel-where-possible; gated where required)

For each cell with tasks in the manifest:

**If task is SPRINT-SIZED**:
- Dispatch `/run-bridge --depth N` against the cell's sprint
- /run-bridge: implement → bridgebuilder review → parse findings → new sprint → repeat until flatline
- Findings flow back to coordinator's beads + .run/bridge-state.json per cell
- Each /run-bridge iteration leaves a PR comment trail in the cell's PR

**If task is IMPLEMENT-SIZED (smaller)**:
- Dispatch `/implement` against the task
- Wrap with /fagan-style rigor — explicit operator interpretation needed (see Open Questions)
- Likely: invoke flatline-review-on-diff post-implement to gate the merge

**If task is auth-adjacent / sacred-no-touch / blast-radius-high**:
- Operator review gate per existing /coord pattern
- Manual dispatch + review (autonomous execution forbidden)

The coordinator's cockpit aggregates: per-cell state, bridge depth, flatline verdict, PR status. Single-pane operator view.

### Phase 4: Sync + close (existing; lightly enhanced)

- `coord-sync.sh` keeps bead external_status fresh
- When all PRs merge + all beads close, cycle closes
- **NEW**: distill artifact written automatically at `loa-freeside/grimoires/freeside-network/<mission>-<date>/` with:
  - Per-cell findings summary (from /run-bridge + flatline)
  - Cross-cell drift observations
  - Cost actual (vs preview)
  - Doctrine candidates for next ADR amendment

## What this distills back

### To /coord skill (v0.9.0 candidate)

- New verb: `/coord plan` — invokes /simstim against the coordinator
- New verb: `/coord execute` — invokes /run-bridge or /implement per cell beads in dispatch queue
- Existing verbs (status / sync / dispatch / init) compose cleanly
- New section in SKILL.md: "Cost model" (plan-through-implement cost preview per mission size)
- New section: "Gate matrix" (which Loa primitive composes per task class)

### To Loa substrate (potential ADR-010 or amendment to ADR-009)

- **/simstim --master-cycle <coordinator-dir>** flag — directs /simstim's artifact output to a coordinator's grimoires/loa/ instead of a single repo's
- **/run-bridge --child-cell <slug>** flag — directs /run-bridge to run against a child cell + report findings back to a parent coordinator's state
- **/coord-aware FLATLINE** — flatline-orchestrator.sh learns about coordinator context (so cross-cell findings can be cross-referenced)
- **/fagan formal skill** — IF /fagan doesn't exist yet, author it as the "implement-sized rigor wrap" (Fagan inspection = formal-review code-inspection method)

### To construct-freeside doctrine

- KRANZ-as-flight-director gets a richer methodology: not just "Coordinate → Mirror → Verify → Flip → Distill" but each act has Loa-primitive composition rules
- coordinating-cross-repo SKILL.md amendment: name the primitives + when each fires
- New ADR or vault concept: "Loa-Primitive Composition in Cluster Coordination"

## Cost model (estimated)

Per mission, depending on scope:

| Scope | Phase 1 | Phase 2 (/simstim) | Phase 3 (/run-bridge per cell) | Total estimate |
|-------|---------|--------------------|--------------------------------|----------------|
| Single-cell, small (1-2 sprints) | ~5 min | $25-35 | $10-20 | **$35-55** |
| Multi-cell, medium (W2 — 2 cells × 8 tasks) | ~10 min | $35-45 | $20-40 (2 cells × ~$10-20) | **$55-85** |
| Multi-cell, large (W3 — 4 cells × ~24 tasks, 4 phases) | ~15 min | $50-65 | $40-80 (4 cells × ~$10-20) | **$90-145** |

Compare to current /coord cost: ~$0 in API spend (manual dispatch) but hours of operator review + risk of un-reviewed findings.

The trade-off: pay $50-150 per mission for FAANG-graded multi-gate rigor + automated dispatch + per-cell iterative improvement, or pay $0 but eat the review burden + miss findings that flatline-review would catch.

## Studying the art behind /simstim and /flatline-review (the operator's prompt)

### What /simstim teaches

1. **Phases are sequenced + numbered** — never skip; gate at each
2. **HITL where it matters; autonomous where it doesn't** — discovery + architecture need human judgment; implementation should not
3. **Flatline at decision boundaries** — PRD, SDD, Sprint are decision boundaries; multi-model adversarial review at each
4. **HIGH_CONSENSUS auto-integrates; BLOCKER halts** — taste embedded in the protocol; not every finding needs operator action
5. **State at .run/simstim-state.json** — resumable; survives compaction; portable
6. **Plan Mode is REJECTED** — simstim phases ARE the plan; never collapse into "plan → implement"

### What /run-bridge teaches

1. **Kaironic termination** — runs until findings "flatline" (no more substantive iterations); not arbitrary depth
2. **Iterative improvement** — each loop generates a NEW sprint plan from findings; not just a review
3. **Single-iteration mode** — `--single-iteration` lets a parent skill intercept SIGNAL: lines per iteration
4. **GitHub trail** — every iteration leaves a PR comment for auditability
5. **Vision Registry** — speculative findings get captured separately from blocking ones
6. **Cross-review dissent** — Bridgebuilder (BEAUVIOUR) + GPT-5.3-codex; not a single voice

### Distilled meta-pattern

Both /simstim and /run-bridge embody: **"surface findings adversarially; integrate high-consensus automatically; halt on blockers; iterate until exhausted."**

This is the substrate /coord should inherit. The /coord skill as currently authored has none of these properties.

## Open questions for operator

1. **/fagan** — does it exist as a skill I haven't found, OR is it conceptual (apply Fagan-inspection-style rigor via flatline-review on a smaller surface)?
2. **Per-cell /simstim vs cluster-wide /simstim** — should each cell's child_cycle get its OWN /simstim, OR does the coordinator's /simstim drive cell-level planning too?
3. **Cost preview gate** — should /coord bootstrap require operator GO at the cost-preview step, OR proceed automatically given the operator has set `hounfour.metering.budget`?
4. **Distill artifact automation** — should the cycle-close distill be auto-generated by /coord, OR remain operator-authored?
5. **Existing W2 mission scaffold** — does the operator want me to RETROFIT the W2 mission to follow this redesigned flow (run /simstim against it now), OR ship W2 as-scaffolded and apply the redesign to W3?
6. **Flatline-review on the doctrine I just wrote** — should I kick off /flatline-review against ADR-009 + W2 PRD + W3 PRD now as a proof-of-concept (~30 min + ~$50)?

## Proposed sequence

1. **Operator answers Q1-Q6** (this proposal's open questions)
2. **Amend /coord SKILL.md** to v0.9.0 with the redesigned flow encoded
3. **Author /fagan skill** if it doesn't exist + operator confirms it should
4. **Test the redesigned flow on W3** (since W2 is mid-flight; W3 is fresh)
5. **Distill back**: ADR-010 (Loa-Primitive Composition) OR ADR-009 amendment + construct-freeside SKILL.md v0.9.0

## Status

Candidate. Discussion-piece pending operator answers to open questions. Distill into formal skill amendment + ADR after refinement.

## References

- /simstim SKILL.md: `.claude/skills/simstim-workflow/SKILL.md`
- /run-bridge SKILL.md: `.claude/skills/run-bridge/SKILL.md`
- /implement SKILL.md: `.claude/skills/implementing-tasks/SKILL.md`
- FLATLINE substrate: `.claude/scripts/flatline-*.sh` (20+ scripts)
- BRIDGEBUILDER persona: `.claude/data/bridgebuilder-persona.md` (= BEAUVIOUR per operator framing)
- /coord SKILL.md (current): `~/Documents/GitHub/construct-freeside/skills/coordinating-cross-repo/SKILL.md`
- coord-bootstrap.sh: `~/bonfire/loa-vps-setup/bin/coord-bootstrap.sh`
- ADR-009 (HEXAGONAL FEDERATION): `loa-freeside/decisions/009-freeside-hexagonal-federation.md`
- W2 mission (scaffolded; pre-redesign): `~/bonfire/missions/w2-score-on-profile/`
- This proposal: `loa-freeside/grimoires/loa/proposals/coord-flow-enhancement.md`

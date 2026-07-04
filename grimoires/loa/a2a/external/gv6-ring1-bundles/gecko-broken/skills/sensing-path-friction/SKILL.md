---
name: sensing-path-friction
description: "Sense when agents use the WRONG-WEIGHT coordination path (reach-in vs spawn-in-cell vs coord) and detect recurring manual cross-cell patterns (desire-paths) that want to become rails. Reads the mutation/audit trail read-only, classifies each cross-cell ACT by weight-used vs weight-needed, and emits a friction report + the STATUS|SIGNAL|MISMATCH coherence tile. DETECTOR-tier: surfaces, never fail-blocks. Sense-only — never mutates any cell."
allowed-tools: [Bash, Read, Grep, Glob, Write, Edit]
user-invocable: true
---

# Sensing-Path-Friction — the Path-Friction Doctor (sense-only)

## Purpose

The `sense-estate` doctor asks of one estate: *do the two things that should match, match?*
This doctor asks of the **coordination layer**: *did the agent use the right-weight path for the
task — and which recurring manual cross-cell acts want to become rails?*

It is the immune-relay for **posture** — the mounted-agent doctrine made observable. An agent should
act on its OWN cell (write-own), and act on ANOTHER cell only by spawning an agent INSIDE it.
Reaching across a blanket (editing another repo's files directly from outside) is a posture slip.
This skill senses those slips from the trail the agents already leave, and surfaces the recurring
ones as candidate rails.

It does NOT decide, gate, or fix. Path-weight is a **judgment** (intent), so this is a DETECTOR,
not a gate — you can't fail-block a judgment without a false-positive machine. It SURFACES; the
operator/agent decides. There is no action slot.

## The doctrine it implements (do not reinvent it)

| Idea | What it means here |
|---|---|
| **mounted-agent posture** | act on your OWN cell directly; act on ANOTHER cell only by spawning an agent INSIDE it. Reaching in from outside = a posture slip. |
| **the path gradient** | right-size the path to the task: L0 write-own · L1 spawn-in-cell · L2 `/coord` (coordinator + branch + review-gated PR) · L3 `/compose`. Pick the LIGHTEST path that fits (cost-of-failure × reversibility × blast-radius). |
| **the consumption gradient** | the regenerative path must be the path of LEAST resistance. If the correct path is steeper than reaching-in, agents reach in. OBSERVED LIVE (2026-06-06, clew lrn-20260606-gecko-a7fce3): an agent bypassed `/compose` for 4 consecutive builds despite compose-doctor reporting READY — raw Workflow was lighter than compiling a composition. a READY doctor does not mean the governed path is the least-resistance path; sense the WEIGHT DELTA (governed-path steps vs raw-path steps), not just availability. |
| **done-twice-becomes-a-path** | a recurring manual cross-cell act → auto-PROPOSE a lightweight composable rail (floor-raise, not a bespoke per-task tile). |
| **teeth-tier** | invariant > gate > DETECTOR. This is a DETECTOR. surface-not-decide. |

## Invocation

```bash
/sensing-path-friction                       # full friction report (acts + desire-paths) + the tile
/sensing-path-friction --tile                # ONE coherence tile line: STATUS|SIGNAL|MISMATCH
/sensing-path-friction --json                # machine envelope (acts + desire_paths + tile)
/sensing-path-friction --window 7            # only acts within the last N days
/sensing-path-friction --min-recur 3         # desire-path threshold (default 2 — "done twice")
/sensing-path-friction --audit <path>        # add an audit.jsonl to the read set (repeatable)
```

## Real input sources (grounded — DISCOVER, never assume)

The skill reads ONLY what already exists. Each field below was verified against a real path; the
ones that don't exist yet are marked **UNKNOWN** so a downstream consumer never trusts a guessed
field.

| Source | Path (grounded) | Shape lifted | Status |
|---|---|---|---|
| **mutation trail (Bash)** | `<repo>/.run/audit.jsonl` written by `.claude/hooks/audit/mutation-logger.sh` | `{ts, tool:"Bash", command, exit_code, cwd, model, provider, trace_id, team_id, team_member}` | **REAL** — `loa-freeside/.run/audit.jsonl` (~10k+ lines) |
| **write trail (Write/Edit)** | same file, written by `.claude/hooks/audit/write-mutation-logger.sh` | `{ts, tool:"Write"\|"Edit", file_path, cwd, …}` | **REAL** — file_path is the target-cell signal |
| **default audit hubs** | `~/Documents/GitHub/loa-freeside/.run/audit.jsonl` + `~/bonfire/.run/audit.jsonl` | (the same hubs `operator-port.sh` reads) | **REAL** — both present |
| **estate-coherence row** | `~/.claude/scripts/straylight-estate/estate-coherence.sh` `probe_*` registry | the `STATUS\|SIGNAL\|MISMATCH` tile contract this doctor's tile is byte-compatible with | **REAL** — orientation only; this skill does NOT write into it |
| **clew capture** | `>>clew@<construct>[/<skill>]: <why>` → `loa-clew-capture.sh` → `LEARNINGS.jsonl` | the emission format for a proposed rail | **REAL** — the doctor emits in this exact shape |
| per-act **ceremony label** (was it `/coord`? `/compose`?) | — | the `/coord` + `/compose` trails live elsewhere, NOT in `.run/audit.jsonl` | **UNKNOWN** from this source — the bash trail only shows the *mechanism* (`git -C`, `cd`), so `weight-used` is conservatively inferred as `reach-in`. Over-ceremony (heavier-than-needed) is therefore also UNKNOWN here. |
| **trace_id correlation** | `audit.jsonl.trace_id` | would let a multi-step cross-cell act be grouped into one "coordination episode" | **UNKNOWN** — the field exists in the schema but is empty (`""`) in every observed entry. |

## The load-bearing detail: the bonfire↔Documents/GitHub symlink

`~/bonfire/loa-freeside` is a **symlink** to `~/Documents/GitHub/loa-freeside` (verified:
`readlink ~/bonfire/loa-freeside`). So a `cwd` under `~/bonfire/X` writing a `file_path` under
`~/Documents/GitHub/X` is the **SAME logical cell**, NOT a reach-in. The script canonicalizes BOTH
sides (`canon()`) before comparing — without this, the doctor would emit thousands of phantom
reach-ins. A `cwd` at the workspace ROOT (`~/bonfire`, no repo segment) is the **hub** — an agent
acting *unmounted*, which the doctor labels `(hub)` (the strongest reach-in shape: no blanket of
its own to act within). Non-repo top-level dirs (`grimoires`, `.run`, `.beads`, `tmp`) are excluded
from being mistaken for cells.

## What it classifies

For each **cross-cell ACT** (a write/edit/command whose target path is OUTSIDE the acting cell's
repo, after symlink-canonicalization):

- **weight-USED** — inferred from the mechanism in the trail. A raw `git -C <other>` / `cd <other>`
  / Write to another cell's `file_path` from a foreign cwd is a direct **reach-in** (L0-against-
  another-cell). `/coord` and `/compose` leave no mark here → `reach-in` is the only observable
  weight (documented limitation).
- **weight-NEEDED** — inferred from cost-of-failure × reversibility × blast-radius:
  - `glance` — read-only inspection (`git status/log/diff/fetch/rev-parse/remote`). Reverses for
    free, zero blast-radius. Never needs coordination.
  - `spawn` (L1) — a single-cell write / branch / build-run. Wants an agent INSIDE the cell.
  - `coord` (L2) — irreversible (`git push`, `--force`, `reset --hard`, `gh pr/release create|merge`,
    `railway up`, deploy, a `gh api` write), OR touches ≥2 distinct cells in one act.
- **FLAG**:
  - `inspect` — a cross-cell read-only glance. Informational, NOT a slip.
  - `reach-in` — a cross-cell write/branch done direct that wanted **spawn-in-cell** (L1).
  - `under-ceremony` — reached in for something that wanted a **coordinator** (L2). The risky slip.
  - `over-ceremony` — heavier than needed. **UNKNOWN** from this source (see the table above).

## Desire-path detection

A `(source-cell → target-cell → task-shape)` pattern recurring **≥ `--min-recur`** times (default
2 — "done twice becomes a path") is a **rail that wants to exist**. Read-only glances are excluded
(a recurring glance is observability, not a rail). For each, the skill emits a clew in GECKO's
capture format:

```
>>clew@gecko/sensing-path-friction: pave <src>→<tgt>/<shape> (×N, wants <spawn|coord>) as a composable rail
```

Per the clew loop's governance: **SENSE is free; ACT is operator-paced.** The doctor surfaces ALL
candidate rails; it does NOT pre-sort by a heuristic and does NOT open PRs. The operator's eye (and
the `/clew` drain, one construct per invocation) is the only teach-filter.

## The output contract — the tile

The `--tile` mode emits **exactly one line**, three pipe-delimited fields, byte-compatible with the
`estate-coherence.sh` consumer (which splits on `|` into `{estate,status,signal,mismatch}`):

```
STATUS|SIGNAL|MISMATCH
```

- `STATUS ∈ {ok | drift | blind}`.
  - `ok` — no recurring desire-paths AND no under-ceremony slips (coordination is clean; the render
    layer dims it — silence is the good state).
  - `drift` — ≥1 desire-path (a rail wants to exist) OR ≥1 under-ceremony (a risky reach-in).
  - `blind` — the trail is absent/unparseable. Loud, not silent (the immune-system "silence is the
    bug" signal). Fail-CLOSED — never a guess.
- `SIGNAL` — `<N> cross-cell mutates · <N> reach-in · <N> under-ceremony · <N> glance · <N> desire-paths (top: <src>→<tgt>/<shape> ×N)`
- `MISMATCH` — `path-used ↔ path-needed (lightest-that-fits ↔ mounted-posture)`

Any raw `|` inside SIGNAL/MISMATCH is escaped to a space and control bytes stripped, so the line is
always exactly 3 fields.

## Workflow

1. **Run the sensor** (read-only). The script does the JSONL parse + classification:
   ```bash
   bash skills/sensing-path-friction/resources/path-friction.sh           # full report
   bash skills/sensing-path-friction/resources/path-friction.sh --tile    # the coherence tile
   bash skills/sensing-path-friction/resources/path-friction.sh --json    # machine envelope
   ```
   It defaults to the same audit hubs `operator-port.sh` reads; `--audit <path>` adds more.

2. **Surface the report** in GECKO's voice (lowercase, direct, warm). Lead with the tile. If `drift`,
   name the top desire-paths and the under-ceremony count. If `ok`, say so briefly — don't
   manufacture concern.

3. **Emit clews for the recurring desire-paths** — verbatim from the script's `>>clew@gecko/...`
   lines (one per rail). Do NOT pick a winner; surface them and let the operator's eye choose. The
   `/clew` drain turns a chosen one into a teaching PR (separately, operator-paced).

4. **Compose with the `report` surface** — when running inside a fuller health pass, fold the tile
   into the network-health report as a DETECTOR row (the friction row sits alongside the estate-
   coherence rows). Path-friction is surfaced, never enforced.

5. **(Optional) record the observation trail** — like `observe`, the skill MAY append ONE JSONL line
   to its OWN `grimoires/gecko/observations.jsonl` (never any observed cell):
   ```json
   {"timestamp":"…Z","stream_type":"Signal","schema_version":"1.0.0","doctor":"path-friction","status":"drift","mutates":11063,"reach_in":9203,"under_ceremony":1860,"desire_paths":433,"top":"loa-freeside→freeside-auth/file-mutate ×604"}
   ```

## Outputs

| Path | Description |
|------|-------------|
| stdout | the friction report (full) OR the single `STATUS\|SIGNAL\|MISMATCH` tile (`--tile`) OR the JSON envelope (`--json`) |
| stdout (clews) | `>>clew@gecko/sensing-path-friction: …` lines — candidate rails, in GECKO's capture format |
| `grimoires/gecko/observations.jsonl` | OPTIONAL append-only observation trail (the skill's OWN — never an observed cell) |

## Constraints — sense-only (the hard boundary, mirrors sense-estate)

- **Zero act/write/dispatch verbs against any cell's state.** No `gh pr`, no `git push`, no
  `br update`, no opening of `/coord` coordinators, no mutation of any repo. The doctor SENSES the
  paving; the rail-building (a `/clew` teaching PR, or a `/compose` rail) is a SEPARATE,
  operator-paced act.
- The skill MAY write only its OWN GECKO-grimoire trail (Step 5), exactly as `observe` does.
- Adding this skill adds **no `workflow.gates`** to `construct.yaml` and never will. GECKO stays
  sense-only.
- **Never fail-block.** Path-weight is a judgment; the doctor surfaces a JUDGMENT, it does not gate.
  A `drift` tile is a prompt for the operator, not a CI failure.
- **Never extrapolate.** If a weight cannot be read (e.g. was this a `/coord`?), it is marked
  conservatively (`reach-in`) or UNKNOWN — never invented. Over-ceremony is UNKNOWN from this source.
- **Never reach in itself** — the doctor reading the audit trail is the read-own posture; it never
  acts on another cell. (The doctor that warns against reaching in must not reach in.)
- Canonicalize the bonfire↔Documents/GitHub symlink before comparing cells — without it, the doctor
  manufactures phantom reach-ins. This is load-bearing.

## Composes with

- **`sense-estate`** (sibling) — the estate-coherence doctor (registry↔state). This is its
  coordination-layer sibling (path-used↔path-needed). Both emit the same tile contract.
- **`operator-port.sh`** (`estate-coherence` `probe_operator`) — senses the OPERATOR's recurring
  *same-cell* hand-touches (paving vs a viability band). This doctor is the orthogonal axis:
  recurring *cross-cell* coordination weight. Same audit trail, different question.
- **`report`** (GECKO sibling skill) — the synthesis surface the friction row folds into.
- **`/clew`** — the drain that turns a chosen desire-path into a teaching PR (operator-paced).
- **`/compose`** (construct-rooms-substrate) — where a paved rail would eventually LIVE as a
  composable path primitive any cell could inherit.

## Why this exists

Agents reach in because reaching in is the path of least resistance. Every reach-in is a small
posture debt; every recurring reach-in is a rail the system is missing. The trail already records
every one of them — nobody was reading it for *this* question. The doctor doesn't scold the reach-in
(sometimes a glance over the blanket is exactly right); it counts the ones that recur and says: *this
road has been walked enough times that it wants paving.* Whether to pave it is the operator's
business. The doctor just makes the desire-path visible before it becomes invisible habit.

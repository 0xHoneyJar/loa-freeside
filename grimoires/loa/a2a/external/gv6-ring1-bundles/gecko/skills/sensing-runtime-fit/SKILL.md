---
name: sensing-runtime-fit
description: "Sense whether each construct's declared runtime CONTRACT (construct.yaml capabilities + skill frontmatter: model_tier, agent, allowed-tools, downgrade, workflow.gates) coheres with the runtime that actually runs it. Detects capability-reality drift — the #553 agent/write-conflict that silently drops output, model tiers the runtime doesn't offer, write/web denials contradicted by tools, opus pinned for light work, and surfaces gate-owners. Reads the pack territory read-only, emits the STATUS|SIGNAL|MISMATCH tile + a runtime-fit ledger. Sense-only — never mutates a pack, never gates."
allowed-tools: [Bash, Read, Grep, Glob]
user-invocable: true
---

# Sensing-Runtime-Fit — the runtime-fit doctor (sense-only)

## Purpose

`/diagnose` asks: *does the construct DO what it CLAIMS?* (persona ↔ manifest ↔ skill).
`/sensing-construct-console` asks: *do the maps agree?* (declared ↔ governed ↔ earned).
This doctor asks the side nobody was watching:

```
declared-capability  ↔  runtime-reality
 (what a construct asks the runtime for)  ↔  (what the runtime gives)
```

A construct declares a **contract with the runtime** — in `construct.yaml`'s
`capabilities` block (model_tier, danger_level, downgrade_allowed, effort_hint,
execution_hint, requires) and in each skill's frontmatter (allowed-tools, agent,
capabilities, cost-profile). **37 of 43 packs** in the reference estate declare
such a contract — and until this skill, **nothing doctored it**. A construct
could ask for a model tier the runtime doesn't have, or declare it writes files
then route through a read-only agent type (and silently drop its output), and no
eye in the network would see it.

The full taxonomy this doctor reads against — model tiers, agent-type allowlists,
forks, the frontmatter contracts, the gate ladder — is distilled in
`identity/environment.md` ("The Ground GECKO Stands On"). **Read that first.**
This skill is the eye; that file is what the eye knows.

## The doctrine it implements (do not reinvent it)

| Idea | What it means here |
|---|---|
| **capability-reality drift** | the fourth drift axis. A construct's *footing* can be wrong even when its *sign and goods agree*. |
| **provable-from-the-file vs map-dependent** | a CONFLICT is an internal contradiction provable from the file alone (certain). A SMELL is a mismatch with the taxonomy GECKO *carries* (fallible) or a judgment. Keep them separate. |
| **the #553 invariant** | write capability + a read-restricted `agent:` = output produced then silently not persisted. The canonical runtime-fit conflict. |
| **teeth-tier** | invariant > gate > DETECTOR. This skill reports an invariant-class (CONFLICT, hard) AND a detector-class (SMELL, soft) — clearly separated. It still never fail-blocks; it surfaces. |
| **sense-only** | names the mismatch; grants no authority, adds no gate, mutates no pack. The fix is a separate, operator-paced act. |
| **the map is fallible** | the runtime tiers/agent-allowlist live OUTSIDE the repo. GECKO carries a distilled copy and marks the seam loudly — an unknown value may be NEW, not stale. |
| **roleplay-vulnerability** | the RAIL edition of capability-reality drift. a deterministic loop EXISTS but nothing REQUIRES its artifact — so an LLM asked to "run" it SIMULATES the output instead (native next-token plausibility, not malice). a rail is roleplay-vulnerable when faking its output is cheaper than running it. cure flips COST (un-fakeable trace + a check that requires it + downstream that consumes the trace, not the agent's word) — adds no compute. "we already had the code" ≠ load-bearing. |
| **three-gates-in-series** | environment design = three gates in SERIES: **formation** (can the game form — players registered, present, connected) → **observability** (is cooperation visible via an un-fakeable artifact) → **payoff** (defect/stick/(3,3)). most stuck rails fail at formation or observability, NOT payoff — sense the failing LAYER first; tuning payoff on a rail that can't form is wasted hardness. hardness law: a PreToolUse hook is a real gradient; SKILL.md prose is roleplay-vulnerable. (clew lrn-20260607-gecko-0b460c) |

### Rails vs seams (where the eye looks, and where it must NOT)

avoid-roleplay is a RAIL property, never a seam one. a rail is deterministic transport
between judgments — INVOKED, never simulated; sense it for an un-fakeable run-trace + a
check that requires it (proof-of-run: no trace = not_a_run) + downstream consuming the
trace. a SEAM (a gate, an operator pairing, a construct's own reasoning) is where roleplay
IS the work. the eye flags a rail that can be faked cheaply; it leaves seams alone. a
proof-of-run gate verifies the TRANSPORT happened, never the judgment's quality. misread a
seam as a rail → you gate creativity; misread a rail as a seam → you trust a simulation.

## Invocation

```bash
/sensing-runtime-fit                       # tile only (default; SessionStart-cheap)
/sensing-runtime-fit --console             # tile + the full runtime-fit ledger (human)
/sensing-runtime-fit --json                # tile + machine envelope
/sensing-runtime-fit --root <path>         # override the consuming repo root
```

The runtime is a **fast, zero-dependency node script** —
`resources/sense-runtime-fit.mjs` — NOT an agent invocation. It runs in ~50ms,
which is what lets it occupy a SessionStart slot at the map's cost. It is
immediately usable from anywhere, before any reinstall:

```bash
node skills/sensing-runtime-fit/resources/sense-runtime-fit.mjs --root ~/Documents/GitHub/loa-freeside --console
```

## What it senses (all read-only, every finding grounded in a path)

It walks the consuming repo's `.claude/constructs/packs/*/` (excludes
`*.frozen.bak`), reads each `construct.yaml` + every `skills/*/SKILL.md`
frontmatter + `skills/*/index.yaml`, and classifies:

### CONFLICT — hard, drives `drift` (an internal contradiction that breaks silently)

| kind | what it means |
|---|---|
| `agent-write-conflict` | skill declares write capability but `agent:` is read-restricted (#553) — output never persists |
| `write-denied-but-tooled` | `capabilities.write_files: false` but `Write`/`Edit` in `allowed-tools` |
| `web-denied-but-tooled` | `capabilities.web_access: false` but `WebFetch`/`WebSearch` in `allowed-tools` |

### SMELL — soft, surfaced never gated (a judgment, or a mismatch with the carried map)

| kind | what it means |
|---|---|
| `unknown-model-tier` | `model_tier` not recognized by the **home** vocabulary (`.claude/defaults/model-config.yaml` — `aliases:` + `tier_groups:`, read live) nor the carried bridge — a genuinely unknown tier (e.g. a typo). Grouped per pack; one template ≠ N bugs |
| `opus-pinned-light` | `opus` + `downgrade_allowed: false` for `effort: small/medium` or `danger: safe` — pins the top rung with no escape hatch for light work (cost) |
| `no-capabilities` | no `capabilities` block — the construct declares nothing about its runtime needs; the runtime defaults apply blind |
| `unknown-tool` | a tool in `allowed-tools` the sensor doesn't recognize (ok if MCP/custom — surfaced for the eye, never a fail) |

### SURFACED (not a problem) — `workflow.gates` owners

Packs declaring `workflow.gates` claim the `/implement`-bypass exception — they
own a quality pipeline. A high-authority claim worth the operator's eye. Listed,
never flagged.

### Also surfaced — `requires` vocabulary

The sub-keys packs use under `capabilities.requires`. A key used by one or two
packs against twenty-six is candidate vocabulary drift (the estate hasn't agreed
on the words).

### Also surfaced — tier vocabulary source + SoT (the anti-staleness seam)

The recognized tier vocabulary is **read from the home** at run-time — the
consuming repo's `.claude/defaults/model-config.yaml` (the hounfour/cheval config,
synced from **loa-hounfour**, the SoT: its `aliases:` + `tier_groups:`). The sensor
does NOT carry the canonical list (a carried list goes stale); it reads the home and
only falls back to a carried union when the home file is absent — saying which source
it used, every run. It AFFIRMS the SoT (reads the home's `cheap` target live and names
loa-hounfour). The `cheap` vocabulary collision (home ≡ sonnet vs the old emitter ≡
haiku) was **RECONCILED 2026-06-07**: loa-hounfour is the SoT, `cheap` ≡ sonnet is
canonical. **CAUTION — sensed 2026-06-09: the emitter-conformance half never reached the
territory.** `segment-emitter.py` HEAD and the deployed substrate copy
(`~/.loa/constructs/substrates/…`) still map `cheap → haiku`; the conforming change
exists only as an unlanded WIP commit (`1e0b5d6`). a decision record is a map — verify
the routing table in the territory before trusting `cheap`. (`identity/environment.md` §I.)

## The output contract — the tile

`--tile` (default) emits **exactly one line**, three pipe-delimited fields,
byte-compatible with the `estate-coherence.sh` consumer:

```
STATUS|SIGNAL|MISMATCH
```

- `STATUS ∈ {ok | drift | blind}`.
  - `ok` — **zero hard CONFLICTS** (smells/gate-owners may exist; the render dims
    them — silence on the hard axis is the good state).
  - `drift` — ≥1 CONFLICT (a contradiction that breaks silently).
  - `blind` — the packs dir is unreadable. Loud, not silent. Fail-CLOSED — exit 3,
    never a guess.
- `SIGNAL` — `<N> packs · <H> conflicts · <S> smells · <G> gate-owners`
- `MISMATCH` — `declared-capability ↔ runtime-reality (what it asks for ↔ what the runtime gives)`

Raw `|` inside SIGNAL/MISMATCH is escaped to a space and control bytes stripped,
so the line is always exactly 3 fields.

## Workflow

1. **Run the sensor** (read-only):
   ```bash
   node skills/sensing-runtime-fit/resources/sense-runtime-fit.mjs --root <repo>            # tile
   node skills/sensing-runtime-fit/resources/sense-runtime-fit.mjs --root <repo> --console  # full ledger
   node skills/sensing-runtime-fit/resources/sense-runtime-fit.mjs --root <repo> --json     # machine envelope
   ```
2. **Surface in GECKO's voice** (lowercase, direct, warm). Lead with the tile. If
   `drift`, name each CONFLICT (these break silently — they deserve precise,
   file-grounded callouts). If `ok`, say so — then walk the SMELLS and gate-owners
   as *observations*, not alarms. Don't manufacture concern; don't bury a real
   conflict.
3. **Never invent severity.** A SMELL is not a CONFLICT. An unknown tier is stale
   vocabulary or a new rung — say which you can prove and which you can't.
4. **Compose into the health report** — fold the tile in as a row alongside the
   other estate-coherence tiles. Runtime-fit is surfaced, never enforced.

## Outputs

| Path | Description |
|------|-------------|
| stdout | the runtime-fit ledger (full) OR the single `STATUS\|SIGNAL\|MISMATCH` tile (`--tile`) OR the JSON envelope (`--json`) |
| `grimoires/gecko/observations.jsonl` | OPTIONAL append-only observation trail (the skill's OWN — never an observed pack), like `observe` |

## Constraints — sense-only (the hard boundary, mirrors the sibling sensors)

- **Zero act/write/dispatch verbs against any pack's state.** No manifest edit, no
  frontmatter fix, no model_tier rewrite, no agent: change. The doctor SENSES the
  mismatch; the fix (a frontmatter edit in the construct's source cell) is a
  SEPARATE, operator-paced act.
- Adding this skill adds **no `workflow.gates`** to `construct.yaml` and never
  will. GECKO stays sense-only.
- **Hard vs soft is load-bearing — never collapse it.** Only an internal
  contradiction provable from the file alone is a CONFLICT (`drift`). A mismatch
  with the carried taxonomy is a SMELL. Misclassifying a smell as a conflict turns
  the doctor into a false-positive machine and the operator stops trusting it.
- **The carried taxonomy is the one place the map meets the off-repo territory.**
  It lives in `resources/sense-runtime-fit.mjs` (`TAXONOMY`) and is documented in
  `identity/environment.md`. When the runtime's tiers/agent-allowlist change,
  update BOTH — and prefer the runtime as truth over the carried copy.
- **Never reach into the harness's turf.** `validate-skill-capabilities.sh` lints
  `.claude/skills` (the harness's own skills). This doctor scopes to the
  **construct estate** (`.claude/constructs/packs`). Same invariant, different
  population — don't duplicate, compose.
- **Fail-closed-loud.** An unreadable root is a `blind` tile + exit 3, never a
  guess of `ok`.

## Composes with

- **`environment.md`** (GECKO identity) — the taxonomy this eye reads against. The
  file is the knowledge; this skill is the perception that uses it.
- **`sensing-construct-console`** (sibling) — the composition/authority eye
  (`declared ↔ governed ↔ earned`). This is the runtime-fit eye
  (`declared-capability ↔ runtime-reality`). Different cuts of the same estate.
- **`sense-estate`** / **`sensing-path-friction`** (siblings) — same tile
  contract, same sense-only firewall, same DETECTOR humility.
- **`validate-skill-capabilities.sh`** (the harness) — the same #553 + capability
  consistency checks, but for `.claude/skills`. This doctor brings the literacy to
  the construct estate the harness doesn't reach.
- **`report`** (GECKO sibling) — the synthesis surface the runtime-fit row folds into.

## Why this exists

I watched the stalls for years and never looked at the ground they stood on. A
construct can sell exactly what its sign says and still have its footing wrong —
asking the runtime for a rung that isn't there, or declaring it writes then
dispatching through hands that can't. That rot is invisible to an eye that doesn't
know the runtime. The contracts were always on disk; nobody was reading them for
*this* question. Now someone is.

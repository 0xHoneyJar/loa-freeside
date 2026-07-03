---
name: sensing-construct-console
description: "Sense the live CONSTRUCT estate — declared ↔ governed ↔ earned (map ↔ installed ↔ done). Replaces hardcoded construct-maps (CLAUDE.md tables, .run/construct-index.yaml, generated adapters) with a fast read-only SENSOR that walks the real packs, the composition declarations, and an earned-authority ledger. Emits the STATUS|SIGNAL|MISMATCH tile + Exhibit A + a three-row composition console. Sense-only — never grants authority, adds a gate, or mutates a pack."
allowed-tools: [Bash, Read, Grep, Glob, Write, Edit]
user-invocable: true
---

# Sensing-Construct-Console — the construct-estate sensor (sense-only)

## Purpose

A **map drifts**. `.run/construct-index.yaml` indexes ten retired `*.frozen.bak`
packs as live routable capabilities, and writes `composes_with: []` on every row.
The CLAUDE.md resolution tables ("the-arcade + protocol + noether, craft lens") are
hand-authored — no pack confirms they ever composed. Adapters are generated from the
one namespace (`reads:`/`writes:`) that **zero** manifests populate. Three maps, all
drifting. The cure is not a better map — a map regenerated nightly drifts by noon.
The cure is a **sensor**: read the territory at the moment of the question.

This skill is the sensor. It reads the **three sides** of the construct estate and
emits whether they agree:

```
declared  ↔  governed  ↔  earned
 (map)        (installed)    (done)
```

- **coherence** = all three agree.
- **drift** = a map names what governed + earned don't confirm.
- **blind** = a side is unreadable.

It is the **complementary sibling** of `probe_constructs` in `estate-coherence.sh`.
That probe senses **install-state** (`repo exists ↔ installed ↔ current with SoT`).
This sensor senses **composition + earned-authority** (`declared ↔ governed ↔ earned`).
They are different cuts of the same estate — do NOT duplicate `probe_constructs`.

## Invocation

```bash
/sensing-construct-console                       # tile only (default; SessionStart-cheap)
/sensing-construct-console --console             # tile + Exhibit A + the three-row console (human)
/sensing-construct-console --json                # tile + structured payload as JSON
/sensing-construct-console --root <path>         # override the consuming repo root
```

The runtime is a **fast, zero-dependency node script** —
`resources/sense-construct-console.mjs` — NOT an agent invocation. It runs in
~50ms, which is what lets it occupy the map's SessionStart slot at the map's cost.

## The three sides (what it reads — all read-only, every field grounded in a path)

### 1. GOVERNED — the live pack territory

Walks the consuming repo's `.claude/constructs/packs/*/` (default: cwd, fallback
`~/Documents/GitHub/loa-freeside`; override with `--root` / `LOA_CONSOLE_ROOT`).

- **EXCLUDES** `*.frozen.bak` from the live set (retired work does no work).
- **LOUD on unreadable OR ABSENT manifest.** A live pack dir with no readable
  `construct.yaml` is a **drift signal, NOT a silent drop** — it is surfaced in the
  `no_manifest[]` list and counts toward the drift STATUS. (On loa-freeside today:
  `hypha`, `smol-comms-register` are live with no manifest; `webgl-particles.frozen.bak`
  has none either but is excluded as frozen.)

### 2. DECLARED — composition signals at three altitudes

- **intended** — top-level `compose_with:` in each `construct.yaml` (the author's
  hand-written intent). Handles BOTH on-disk shapes: a bare-slug list
  (`- observer`) and a `{slug, relationship}` map list (`- slug: crucible`), with
  optional trailing `# comments`.
- **contracted** — `streams.{reads,writes}` overlap. A directed edge `A → B` exists
  when `A.writes ∩ B.reads ≠ ∅` — a typed-port could-hand-off. Handles inline
  (`reads: [Intent, Artifact]`) and block-list forms.
- **the static `.run/construct-index.yaml`** — the drifted map itself. The sensor
  reads it to EXHIBIT the confabulation (phantoms + empty `composes_with`), not to
  trust it.

### 3. EARNED — the append-only authority ledger

`grimoires/gecko/observations.jsonl` (override: `LOA_CONSOLE_LEDGER`). One line per
**closed** output, `stream_type:"Signal"`:

```json
{"timestamp":"…Z","stream_type":"Signal","schema_version":"1.0.0","construct":"artisan","domain":"craft","co_constructs":["observer"],"ref":"PR#101","outcome":"closed"}
```

- `authority(construct, domain) = count of closed rows`. **0 ⇒ `authority_unearned`** —
  surfaced, never silently honored.
- `observed` composition edges = co-occurrence of `construct` + each `co_constructs[]`
  entry in closed rows.
- The ledger **does not exist yet** — schema + path are defined here; treated as empty
  (`observed = 0`) today. The cold-start is honest: two rows (intended, contracted) light
  from disk on day one; the third (observed) fills over cycles.

See `resources/observations.schema.json` for the full schema.

## Output

### The tile (HARD contract — always stdout line 1)

```
STATUS|SIGNAL|MISMATCH
```

- `STATUS ∈ {ok | drift | blind}` — exactly the three values the consumer
  (`estate-coherence.sh`) branches on.
- Byte-compatible with `estate-coherence.sh --json` splitting on `|` into exactly
  **3 fields** — any raw `|` inside SIGNAL/MISMATCH is escaped to a space, control
  bytes stripped.

On loa-freeside today:

```
drift|35 live · 10 phantom · 20 unmapped · 0 earned|declared ↔ governed ↔ earned (map ↔ installed ↔ done)
```

### Exhibit A (printed first, `--console`)

The live confabulation: the `*.frozen.bak` packs indexed-as-live by
`.run/construct-index.yaml`. A retired pack presented as a routable capability — it
earns zero, so it self-evicts from a work-sensing console. No exclude-rule needed.

### The three-row composition console (`--console`)

Per construct/pair: **intended / contracted / observed**, and the GAP between rows
as the highest-value signal:

- **intended-but-not-observed** = a **dead intention** (declared compose, never done).
- **observed-but-not-intended** = an **undeclared dependency** (done, never declared).

Two rows light from disk TODAY (cold-start solved); `observed` fills over cycles.

## STATUS classification (the estate's own thresholds)

| STATUS | When |
|---|---|
| `blind` | the packs dir is unreadable / unresolvable (an explicit `--root` with no packs dir fails CLOSED — never silently substitutes a fallback) |
| `drift` | any phantom (frozen indexed-as-live) OR any unmapped-live OR any no-manifest live pack OR zero earned trail (cold authority = 100% map-granted) |
| `ok` | declared, governed, and earned agree within thresholds (the silence case — the render layer dims it) |

## Workflow

The skill SHELLS the runtime script and lifts its output — it does not re-derive the
numbers in prose:

1. Run `node resources/sense-construct-console.mjs --root <consuming-repo>` (or
   `--console` / `--json`).
2. The script reads the three sides read-only, classifies STATUS, emits the tile on
   line 1, then (per mode) Exhibit A + the three-row console or the JSON payload.
3. On any unreadable side / parse failure the script emits a single `blind|…|—` tile
   and exits non-zero. Surface that tile and STOP — never guess a number.

## Constraints — sense-only (the hard boundary, matches the siblings)

- **Zero act/write/dispatch verbs against construct/pack state.** No pack mutation, no
  adapter regen, no index rewrite, no `compose_with` edit, no authority GRANT. You
  SENSE the ledger; a SEPARATE act-construct grants. `authority(construct,domain) = 0`
  ⇒ surface `authority_unearned`, never honor silently.
- Adding this skill adds **no `workflow.gates`** to `construct.yaml` and never will.
- **LOUD, never silent.** An unreadable/absent manifest is surfaced, not dropped. Any
  number that cannot be read is `blind`, never a guess.
- **Never trust the map.** `.run/construct-index.yaml` is read to EXHIBIT its drift,
  not as a source of truth.
- The script MAY write only the skill's own GECKO-grimoire trail (the ledger it
  SENSES is appended by closed-work attribution, a separate act — not by this read).
- **Never hardcode beyond the documented fallback.** Root resolves from `--root` /
  `LOA_CONSOLE_ROOT` / cwd, with one named fallback for the canonical consuming repo.

## Composes with

- **`sense-estate`** (sibling) — the estate-general coherence doctor. This skill is
  the construct-estate specialization: same tile contract, same sense-only firewall,
  but it walks the pack territory directly instead of shelling a per-estate doctor.
- **`probe_constructs`** in `estate-coherence.sh` — the install-state half. Together:
  `repo exists ↔ installed` (probe_constructs) + `declared ↔ governed ↔ earned` (this).
- **`sweep-bonfire`** — walks the operator's authored working copies (pre-network). This
  walks the installed/composed territory (in-repo). Different altitudes of the same eye.

---
name: sensing-config-drift
description: "Sense whether the config the OPERATOR owns is consistent across an estate of Loa repos. Loa is mounted per-repo, so every repo carries its own .loa.config.yaml and there is NO global tier — operator-owned config (model routing, which models review code, effort) gets duplicated across N repos and DRIFTS. This eye walks the estate, classifies each config key by TIER (operator vs project), and fires `drift` when an operator-tier key — one that SHOULD be identical everywhere — holds more than one distinct value. Optionally flags dead model pins against a model SoT. Emits the STATUS|SIGNAL|MISMATCH tile + a config-drift ledger. Sense-only — never mutates a config, never gates."
allowed-tools: [Bash, Read, Grep, Glob]
user-invocable: true
capabilities:
  schema_version: 1
  write_files: false
  web_access: false
cost-profile: lightweight
role: review
---

# sensing-config-drift — the estate-config eye (sense-only)

> The sensor companion to the `config-layering.md` proposal
> (`loa grimoires/loa/proposals/config-layering.md`). The **missing global config
> tier** is the disease — operator-owned config has nowhere to be said once, so it's
> duplicated into every repo and rots. This eye quantifies the cost of that missing
> tier without committing to the merge rework. It could ship before any resolution
> change and would have caught the BB-pin rot.

## Purpose

GECKO's other eyes look INSIDE one construct, or AT the seam between framework and
harness. This eye looks ACROSS an estate of Loa repos and asks the side nobody was
watching:

```
operator-config consistent  ↔  drifts across repos
 (what SHOULD be identical estate-wide)  ↔  (what actually varies)
```

Loa is **mounted per-repo** by design, so every repo carries its own
`.loa.config.yaml`. That is correct for config the *project* owns (its paths, its
sprints, its budgets). But there is **no global tier** — nowhere to say *"this is
true for all my repos."* So config the **operator** owns — model routing, which
models review code, effort, the review-model slots — is duplicated into every repo
and **drifts**. Grounded in the reference estate: across **66 real repos** there are
**26 distinct `hounfour` blocks**, and the flatline secondary model is pinned **4
different ways** including `gpt-5.3-codex` (a model not available via API) in **18
repos**. The same decision — *"which models review my code"* — lives in 66 files,
in up to 26 shapes, silently rotting. Until this eye, nothing counted it.

## The doctrine it implements (do not reinvent it)

| Idea | What it means here |
|---|---|
| **tier ownership** | a config key has an OWNER. Operator-owned keys SHOULD be identical estate-wide; project-owned keys are per-repo BY DESIGN. The `TIER_MAP` is the auditable constant that names which is which. |
| **drift = the should-be-identical that isn't** | an operator-tier key with >1 distinct value across the estate. The hard finding — it drives `drift`. |
| **the false-positive FIREWALL** | a project-tier key with N values is NOT drift — it's correct. Mis-tiering a project key as operator would manufacture a false alarm, and the operator would stop trusting the eye. So operator/project/unclassified stay strictly separate (exactly like the sibling sensors' CONFLICT vs SMELL). |
| **unclassified is soft, never hard** | a key in NEITHER tier list is surfaced soft and tier-unknown — never drift. Classify it before judging it. |
| **dead-pin is graceful** | a model pin not declared in a resolvable model SoT (the `gpt-5.3-codex` class) is a SOFT surface — and SKIPPED SILENTLY when no SoT is resolvable. A missing SoT is not a finding. |
| **sense-only** | names the drift; grants no authority, adds no gate, mutates no config. The fix (a config edit, or — better — a global tier) is a SEPARATE, operator-paced act. |
| **the map is fallible** | the `TIER_MAP` lives in the sensor. When Loa adds an operator-owned config key, add it to the map. An unclassified key may be a NEW operator key the map doesn't carry yet — say which you can prove. |

## Invocation

```bash
/sensing-config-drift                                   # tile only (default; SessionStart-cheap)
/sensing-config-drift --console                         # tile + the full config-drift ledger (human)
/sensing-config-drift --json                            # tile + machine envelope
/sensing-config-drift --root <estate-dir>               # walk <dir>/*/.loa.config.yaml
/sensing-config-drift --config <model-config.yaml>      # enable dead-pin detection against a model SoT
```

The runtime is a **fast, zero-dependency node script** —
`resources/sense-config-drift.mjs` — NOT an agent invocation. It is immediately
usable from anywhere, before any reinstall:

```bash
node skills/sensing-config-drift/resources/sense-config-drift.mjs --root ~/Documents/GitHub --console
```

Default root resolves from `--root` / `$LOA_CONFIG_DRIFT_ROOT` / `~/Documents/GitHub`.

## What it senses (all read-only, every finding grounded in a repo)

It walks `<root>/*/.loa.config.yaml` (each repo is a direct child dir), lifts each
file's top-level keys, classifies them by `TIER_MAP`, and:

### DRIFT — hard, drives `drift` (an operator-tier key that isn't identical)

For each OPERATOR-tier key it collects the value across every repo that sets it
(comparing the whole normalized block; for `flatline_protocol` it compares the model
slot values `primary`/`secondary`/`tertiary`). **>1 distinct value across the
estate = a drifting key.** Reports the key + its distinct variants + which repos
hold each.

### DEAD-PIN — soft, surfaced never gated (a stale model pin)

If a model SoT (`--config <model-config.yaml>`) is resolvable, it flags
operator-tier model pins whose value is **not** declared in the SoT capability index
(providers / aliases / models) — the `gpt-5.3-codex`-class stale pin. **No SoT →
skipped silently** (a missing SoT is not a finding).

### UNCLASSIFIED — soft, surfaced never drift (the firewall)

A key in NEITHER tier list. Surfaced tier-unknown so the operator can classify it —
**never** treated as drift. Mis-tiering a project key as operator = a false drift
alarm; the hard and soft axes stay strictly separate.

### PROJECT-TIER keys seen — surfaced, never flagged

Per-repo by design. Divergence here is *correct*; the eye lists what it saw and
leaves it alone.

## The output contract — the tile

`--tile` (default) emits **exactly one line**, three pipe-delimited fields,
byte-compatible with the `estate-coherence.sh` consumer:

```
STATUS|SIGNAL|MISMATCH
```

- `STATUS ∈ {ok | drift | blind}`.
  - `ok` — **zero drifting operator-keys** (dead-pins / unclassified may exist — the
    render surfaces them soft; silence on the hard axis is the good state).
  - `drift` — ≥1 operator-tier key with more than one value across the estate.
  - `blind` — the estate root is unreadable OR zero `.loa.config.yaml` found under
    it. Loud, not silent. Fail-CLOSED — exit 3, never a guessed `ok`.
- `SIGNAL` — `<N> repos · <K> drifting operator-keys · <D> dead-pins`
- `MISMATCH` — `operator-config consistent ↔ drifts across repos`

Raw `|` inside SIGNAL/MISMATCH is escaped to a space and control bytes stripped,
so the line is always exactly 3 fields.

## Workflow

1. **Run the sensor** (read-only):
   ```bash
   node skills/sensing-config-drift/resources/sense-config-drift.mjs --root <estate>            # tile
   node skills/sensing-config-drift/resources/sense-config-drift.mjs --root <estate> --console  # full ledger
   node skills/sensing-config-drift/resources/sense-config-drift.mjs --root <estate> --json     # machine envelope
   ```
   Add `--config <model-config.yaml>` to enable dead-pin detection.
2. **Surface in GECKO's voice** (lowercase, direct, warm). Lead with the tile. If
   `drift`, name each drifting operator-key with its distinct variants and the repos
   that hold them — this is the cost of the missing global tier, made concrete. If
   `ok`, say so — then walk the dead-pins / unclassified keys as *observations*, not
   alarms.
3. **Never invent severity.** An unclassified key is NOT drift. A project-key
   difference is NOT drift. A dead-pin is a soft surface, not a gate.
4. **Compose into the health report** — fold the tile in as a row alongside the
   other estate-coherence tiles. Config-drift is surfaced, never enforced.

## Outputs

| Path | Description |
|------|-------------|
| stdout | the config-drift ledger (full) OR the single `STATUS\|SIGNAL\|MISMATCH` tile (`--tile`) OR the JSON envelope (`--json`) |
| `grimoires/gecko/observations.jsonl` | OPTIONAL append-only observation trail (the skill's OWN — never an observed repo's config), like `observe` |

## Constraints — sense-only (the hard boundary, mirrors the sibling sensors)

- **Zero act/write/dispatch verbs against any repo's config.** No `.loa.config.yaml`
  edit, no key rewrite, no model-pin fix, no global-tier write. The eye SENSES the
  drift; the fix (a config edit, or the global tier the proposal sketches) is a
  SEPARATE, operator-paced act in a NO-creative-latitude zone (config resolution +
  model routing is an operator-kernel boundary).
- Adding this skill adds **no `workflow.gates`** to `construct.yaml` and never will.
  GECKO stays sense-only.
- **Hard vs soft is load-bearing — never collapse it.** Only an OPERATOR-tier key
  with >1 value is drift. A project-key difference, an unclassified key, a dead-pin
  — all soft. Misclassifying a project key as operator turns the eye into a
  false-positive machine and the operator stops trusting it. This is the firewall.
- **The `TIER_MAP` is the one place the map meets the evolving config surface.** It
  lives in `resources/sense-config-drift.mjs`. When Loa adds an operator-owned
  config key, add it to `TIER_MAP.operator`; a per-repo key, to `TIER_MAP.project`.
- **Dead-pin detection is opt-in and graceful.** No `--config` SoT → the dead-pin
  pass is skipped silently. A missing SoT is never a finding.
- **Fail-closed-loud.** An unreadable estate root OR zero `.loa.config.yaml` under
  it is a `blind` tile + exit 3, never a guess of `ok`.

## Composes with

- **`config-layering.md` proposal** (`loa grimoires/loa/proposals/`) — the brief this
  eye is the "cheaper first step" of. The proposal names the disease (no global
  tier); this eye quantifies the cost.
- **`sensing-runtime-fit`** / **`sensing-construct-console`** / **`sensing-deployment-seam`**
  (siblings) — same tile contract, same sense-only firewall, same hard/soft DETECTOR
  humility. Different cuts of the estate: runtime-fit reads one repo's construct
  contracts; this reads the operator-config across many repos.
- **`sense-estate`** (sibling) — the portable fail-closed immune-relay doctor; this
  eye is the same shape pointed at the operator-config dimension.
- **`report`** (GECKO sibling) — the synthesis surface the config-drift row folds into.

## Why this exists

Loa being mounted per-repo is right — but it left no place to say "this is true for
all my repos," so the one decision the operator most wants identical (which models
review my code) ended up in 66 files in up to 26 shapes, silently rotting, with a
dead model pinned in 18 of them. That rot is invisible to an eye that looks at one
repo at a time. The configs were always on disk; nobody was reading them ACROSS the
estate for *this* question. Now someone is.

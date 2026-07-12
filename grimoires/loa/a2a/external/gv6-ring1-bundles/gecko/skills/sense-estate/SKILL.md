---
name: sense-estate
description: "Single-pass coherence sense of an ARBITRARY estate (a registry/state pair). Resolves the read-command from operator-local estate-config, shells the estate's own doctor read-only, emits exactly the STATUS|SIGNAL|MISMATCH tile. Sense-only — never mutates the estate."
allowed-tools: [Bash, Read, Grep, Glob, Write, Edit]
user-invocable: true
---

# Sense-Estate — Generalized Coherence Doctor (sense-only)

## Purpose

Sense an **arbitrary estate** — a *registry/state pair* (the "declared" side and the
"governed/surfaced" side that should match) — and emit the minimal coherence tile. This is the
estate-general sibling of `observe`: same single-pass, structured, **sense-only** shape, but the
target is any estate (`recall`, `beads`, …) instead of the construct registry.

It generalizes the live `estate-coherence.sh` `probe_*` pattern (`probe_recall`, `probe_beads`) into
one reusable skill: read the estate's existing on-disk doctor, wrap the read into the tile. It does
NOT re-implement recall indexing or beads alignment, and it does NOT decide whether the estate is
healthy beyond emitting the correct STATUS — the silence render-rule lives downstream in
`estate-coherence.sh` (not here).

## Invocation

```bash
/sense-estate recall            # sense the recall estate (resolves read_command from estates.yaml)
/sense-estate beads             # sense the beads estate
/sense-estate <slug>            # sense any estate wired in ~/.claude/estates.yaml
```

## The output contract — the tile (HARD constraint)

The skill emits **exactly one line**, three pipe-delimited fields, nothing else on stdout:

```
STATUS|SIGNAL|MISMATCH
```

- `STATUS ∈ {ok | drift | blind}` — exactly the three values the consumer
  (`estate-coherence.sh:143`) branches on.
- `SIGNAL` — a single human-readable string describing the sensed numbers.
- `MISMATCH` — the estate's own `X ↔ Y` phrase naming the two-things-that-should-match.

This is byte-compatible with what `estate-coherence.sh --json` splits on `|` into
`{estate,status,signal,mismatch}` (`estate-coherence.sh:147-157`). The consumer split MUST yield
**exactly 3 fields** — so any raw `|` inside SIGNAL or MISMATCH MUST be escaped to a space before
emission (see Delimiter safety).

Grounded examples from the live probes:

| estate | tile (live) |
|---|---|
| recall | `ok\|mode=query · 0 unstamped · 0 phantom · 142 cols\|indexed ↔ surfaced (declared ↔ governed)` |
| beads  | `drift\|412 beads · aligned 4% · 18 drift · 96 stale\|filed ↔ governed (carries a canonical Lab dim)` |
| (unreachable) | `blind\|recall-doctor unavailable\|—` |

## Portability — the read-command is RESOLVED, never hardcoded (Cluster B)

The skill MUST NOT bake a `~/.claude/...` or `~/bonfire/...` path. It resolves the estate's
read-command from the **operator-local estate-config** `~/.claude/estates.yaml` (a slug →
`{read_command, …}` map), via the safe resolver in `resources/validate-estates.sh`. The committed
skill carries only the estate slug + the `$STRAYLIGHT_ESTATE` / `$BEADS_ESTATE` indirection tokens;
the concrete path resolves at the operator's machine.

The estate-config schema + an EXAMPLE live in this skill's `resources/`:

| file | role |
|---|---|
| `resources/estates.example.yaml` | the slug→`{read_command}` schema reference (copy to `~/.claude/estates.yaml`, then `chmod 600`) |
| `resources/validate-estates.sh` | the SAFE resolver/validator — parses with `yq`/`jq` (never bash `eval`), enforces argv-array form, restricts interpreter args, binds a `timeout`, fails CLOSED to `blind` |

## Workflow

### Step 1: Resolve the read-command (SAFE)

Given the estate slug, run the resolver to obtain the validated argv-array read-command — never
construct it by string-splicing:

```bash
# Emits the validated argv as a JSON array on success, or "blind|<reason>|—" on any failure.
bash skills/sense-estate/resources/validate-estates.sh "$ESTATE_SLUG"
```

The resolver reads `~/.claude/estates.yaml` (or `$LOA_ESTATES_FILE` for tests), and for the given
slug:
- parses the YAML with `yq -o=json` (a real parser — **NEVER** `eval`, **NEVER** word-splitting);
- requires every `*_command` to be a YAML **array of strings** (argv form);
- requires `argv[0]` to be in the binary allowlist `{bash, sh, node, python3, jq}`;
- **rejects interpreter smuggling** — for `bash`/`sh`/`node`/`python3`, the args MUST be a script
  PATH (and its flags), and a `-e` / `-c` / `--eval` / `-` (read-from-stdin) arg is **rejected**;
- rejects any element carrying a shell metacharacter outside a bare `$NAME` token;
- token-expands only `$NAME` (`^[A-Z_][A-Z0-9_]*$`) from the `tokens:` map / process env.

Any reject, a missing/unparseable file, an unknown slug, or perms looser than `0600` → the resolver
prints a `blind|<reason>|—` line and exits non-zero. **You then emit that blind tile and STOP** —
never fall back to a guessed path.

### Step 2: Run the estate's doctor read-only (timeout-bound)

The resolver itself runs the validated argv under a `timeout` (default 15s) with `shell=False`
semantics (`"${cmd[@]}"`, never `eval`). It captures stdout. You do NOT re-spawn the command
yourself — let the resolver do the bounded, allowlisted exec. Read sources (resolved via the slug,
documented here for orientation, NOT hardcoded):

| estate | what is read | resolved token form (estates.yaml) | fields lifted |
|---|---|---|---|
| `recall` | the recall-doctor JSON receipt | `["bash", "$STRAYLIGHT_ESTATE/recall-doctor.sh", "--json"]` | `mode.{default,ok}`, `coverage.{indexed,phantoms[]}`, `unstamped_recent[]`, `freshness_min` |
| `beads`  | the pre-written commons report | `report_path: "$BEADS_ESTATE/commons-report.json"` (cheap SLURP — read, not exec) or `["node", "$BEADS_ESTATE/monitor.mjs", "--json"]` | `alignPct`, `estate.{beads,drift,stale}` |

### Step 3: Classify STATUS (from the read, not a global judgment)

| STATUS | When | Grounded rule |
|---|---|---|
| `blind` | the read-command is unresolvable / absent / errors / parse fails | recall: doctor unavailable / errored / parse fail (`estate-coherence.sh:32-34,42`); beads: no commons-report (`estate-coherence.sh:48`) |
| `drift` | a declared↔governed match is broken per the estate's thresholds | recall: `!modeOk \|\| unstamped>0 \|\| phantoms>0 \|\| freshness>1440` (`estate-coherence.sh:37`); beads: `alignPct<50 \|\| drift>20 \|\| stale>100` (`estate-coherence.sh:52`) |
| `ok` | declared and governed agree within thresholds | the silence case — the render layer dims it (`estate-coherence.sh:8-10`) |

The thresholds are the estate's own (the source of truth stays the per-estate doctor). For recall and
beads, reuse the exact predicates `estate-coherence.sh` already applies (above) so the tile is
byte-compatible.

### Step 4: Build SIGNAL + MISMATCH

- `SIGNAL` — one line summarizing the lifted numbers. Reuse the live phrasings:
  - recall: `mode=<default> · <N> unstamped · <N> phantom · <N> cols`
  - beads: `<N> beads · aligned <P>% · <N> drift · <N> stale`
- `MISMATCH` — the estate's `X ↔ Y` phrase (`mismatch_phrase` from estates.yaml, or the live default):
  - recall: `indexed ↔ surfaced (declared ↔ governed)`
  - beads: `filed ↔ governed (carries a canonical Lab dim)`

### Step 5: Delimiter safety, then emit (fault-tolerant)

Before emitting, **escape any raw `|`** in SIGNAL and MISMATCH to a space, and strip C0/C1 control
bytes, so the line is always parseable into exactly 3 fields. Then print the single tile line:

```
printf '%s|%s|%s\n' "$STATUS" "$SIGNAL" "$MISMATCH"
```

**Fault-tolerance (hard):** any probe absent / fails / parse-errors → `STATUS=blind`, a one-word
reason in SIGNAL, `—` in MISMATCH. **Never crash, never emit an empty line, never emit more than 3
fields.** Blind is loud, not silent — it is the immune-system "silence is the bug" signal.

### Step 6 (optional): record the observation trail

Like `observe`, the skill MAY append its own observation to `grimoires/gecko/observations.jsonl`
(its OWN trail) — never the observed estate. One JSONL line, `stream_type: "Signal"`:

```json
{"timestamp":"…Z","stream_type":"Signal","schema_version":"1.0.0","estate":"recall","status":"ok","signal":"mode=query · 0 unstamped · 0 phantom · 142 cols","mismatch":"indexed ↔ surfaced (declared ↔ governed)"}
```

## Outputs

| Path | Description |
|------|-------------|
| stdout | the single `STATUS\|SIGNAL\|MISMATCH` tile line (the contract) |
| `grimoires/gecko/observations.jsonl` | OPTIONAL append-only observation trail (the skill's own — never the estate) |

## Constraints — sense-only (the hard boundary, G-4 / A-2)

- **Zero act/write/dispatch verbs against estate state.** No `gh pr`, no `br update`, no
  `recall-stamp.sh apply`, no `align.mjs --apply`, no mutation of recall/beads/any estate's governed
  data. The doctor SENSES; the aligner/teeth (a SEPARATE construct) act.
- The skill MAY write only its OWN GECKO-grimoire trail (Step 6), exactly as `observe` does — never
  the observed estate.
- Adding this skill adds **no `workflow.gates`** to `construct.yaml` and never will. GECKO stays
  sense-only.
- Never extrapolate — if a number cannot be read, it is `blind`, not a guess.
- Never re-implement the estate's doctor — shell its existing read-command (resolved, allowlisted,
  timeout-bound). The numbers' source of truth stays the per-estate doctor.
- Never hardcode a `~`-path — resolve from `~/.claude/estates.yaml` via the safe resolver.

# packages/asson/

**Package**: `@freeside/asson` · **Domain**: network · **Status**: reference-drop v0.2.0 (pre ADR review) · see [CHANGELOG](CHANGELOG.md)

The CLI layer of the Loa ecosystem: how scripts graduate into CLIs, how CLIs declare
themselves, how builds are attested without public npm, and how finn's sandbox allowlist
is derived from declarations instead of hand-edited.

> The asson is the priest's rattle — the instrument of authority that summons and
> dismisses. A CLI is summoned by its **veve** (its manifest), made legal by the
> sandbox allowlist, and held to its word by vectors and attestations. Asson is the
> deterministic skeleton; [Legba](../../../legba-substrate) replays it.

> **Distinct from `packages/freeside-cli/`** (the ecosystem CLI whose verbs *operate*
> asson) and from `packages/cli/` (gaib, platform domain). See ADR-007 naming discipline.

## What's here

| path | what |
|---|---|
| `src/asson.mjs` | zero-dep core: JCS+sha256, tree-hash, ed25519 build attestation, vector run/harvest, CommandPolicy derivation, the doctor |
| `src/demo.mjs` | full lifecycle + three attacks + v0.2 liveness/fork demos — `pnpm demo` |
| `src/liveness.mjs` | the watchdog: stall/spin/budget/pace verdicts over **legba** span logs; checkpoint-on-eviction (chess clock) |
| `schemas/veve.schema.json` | the CLI self-declaration manifest (staging shape; production home is loa-hounfour) |
| `examples/wordcount/` | a complete L3 CLI: bin + veve + (demo-harvested) vectors |
| `examples/wordcount/effect-pattern.ts` | the Effect TS house dialect — determinism derived from the requirements channel |
| `examples/lexicon-lint/` | second L3 CLI: words-with-teeth graduated into a tool — banned terms, untagged testimony, REL-aware exits |
| `doctrine/harness-as-watershed.md` | the mental model (vault-format) |
| `doctrine/words-with-teeth.md` | REL declaration · controlled vocabulary · provenance tiers (vault-format) |
| `PROMPT.md` | paste into Claude Code at repo root to integrate (6 phases, invariants AS-1..AS-6) |

## The ladder (claims are cheap, evidence promotes)

L1 committed script → L2 promotion *sensed* from recorded recurrence → L3 CLI
(veve + passing vectors + valid attestation + honest determinism) → L4 legal
(finn CommandPolicy entry, generated never hand-authored) → L5 network (freeside
registry). `doctor` computes the earned level from evidence and flags drift from claims.

## Run it

```bash
cd packages/asson && node src/demo.mjs
```

Demonstrates: vector harvesting, build attestation, doctor pass, policy generation,
then three attacks caught — post-attestation code edit (tree-hash divergence),
ladder-level inflation (claim/earn drift), and determinism misdeclaration (LG-5).

## Safety and liveness (v0.2.0)

Legba (shipped) is safety: no skipped gate, no forged token, no tampered move. Asson 0.2.0
adds liveness: every L3 CLI declares its clock (`liveness.timeout_s`), the watchdog reads
legba move logs for stall/spin/budget/pace, and eviction emits a checkpoint packet instead
of discarding work — meter the span, make the gate free, never punish arrival. Soundness is
model-free (the clock exists for every model); magnitudes are ergonomics (tune per tier).
Veve validation is version-dispatched across {0.1.0, 0.2.0} — fork-train discipline,
practiced in the artifact.

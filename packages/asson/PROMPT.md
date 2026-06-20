# PROMPT.md — paste into Claude Code at the root of loa-freeside
# Drop target: packages/asson/ (this folder). Read this whole file before writing anything.

## ROLE

You are integrating **asson** — the CLI layer of the Loa ecosystem — into loa-freeside.
Asson governs how scripts graduate into CLIs, how CLIs declare themselves (veve manifests),
how builds are attested (house key ceremony), how golden vectors pin behavior, and how
finn's sandbox allowlist is derived. It is the deterministic skeleton that Legba's gates
replay. Read before you write; wire existing components instead of inventing parallels.

## CONTEXT — what exists and where this sits

- `packages/asson/` (this drop) — zero-dep reference core (`src/asson.mjs`), the veve schema
  (`schemas/veve.schema.json`), a working example CLI with full lifecycle demo
  (`node src/demo.mjs` from packages/asson), and the Effect house pattern
  (`examples/wordcount/effect-pattern.ts`).
- `packages/freeside-cli/` (`@freeside/freeside-cli`) — the ecosystem CLI, scaffold status,
  ADR-007 governs naming (do NOT confuse with `packages/cli/` gaib). Asson verbs land here.
- `packages/beacon-schema/` — BeaconV3 sealed self-declaration + `acvp-bindings.ts`. The
  veve is the CLI-scale sibling of the beacon; align field philosophy, do not merge schemas.
- `packages/sandbox/` (freeside) and **loa-finn `src/agent/sandbox.ts`** — `CommandPolicy`
  {binary, subcommands, deniedFlags, validatePaths} is the legality layer asson generates into.
- **loa-hounfour** — consumed by pinned git SHA (house no-npm discipline — keep it). All
  schemas migrate there eventually; this package's JSON Schemas are the staging shape.
- **legba** (operator substrate, separate workstream) — the recorder/gate layer. Asson and
  Legba share canonicalization and the ed25519 key-ceremony shape BY DESIGN: build
  attestations and run attestations are one trust story, two tenses.

## CORE MODEL (do not dilute)

- **veve** — every L3+ CLI ships `veve.json`: contract, determinism class + how it was
  declared (author < trace_audit < effect_type), golden vectors, ladder evidence, attestation.
- **ladder** — L1 committed script → L2 promotion proposed (sensed from recorded recurrence,
  never requested) → L3 CLI (veve + passing vectors + valid attestation + honest determinism)
  → L4 legal (finn CommandPolicy + construct manifest) → L5 network (freeside registry).
  The doctor computes EARNED level from evidence and diffs against CLAIMED; drift is a finding.
- **attestation** — tree_hash + git_commit + ed25519 over the unattested veve. Replaces npm
  provenance; distribution stays internal (pinned git SHAs / private registry / CAS-by-hash).
- **vectors** — harvested from live runs (the runs that proved the need pin the behavior),
  re-run by the doctor and by CI, JCS-normalized for JSON stdout.

## INVARIANTS (each gets at least one test naming its ID)

- AS-1 No CLI reaches L3 without: valid veve, ≥1 passing vector, valid attestation, and a
  determinism declaration consistent with its ambient list (LG-5 inherited).
- AS-2 Tree-hash attestation breaks on any single-byte change to any file in the CLI dir.
- AS-3 Earned ladder level is derivable from evidence alone; the claimed field never feeds
  any enforcement decision.
- AS-4 CommandPolicy entries are generated from veves, never hand-authored, and carry
  x_determinism + x_veve_tree_hash so the sandbox can (eventually) verify code identity
  at invocation time.
- AS-5 `declared_by: author` always yields a doctor warning. Effect-typed CLIs derive the
  class from the requirements channel; non-Effect CLIs may earn `trace_audit` via N clean
  sandboxed runs with network denied.
- AS-6 Vector hashing is canonical: JCS for stdout_json, raw bytes otherwise; exit codes
  are part of the pin.
- AS-7 No 0.2.0 CLI reaches L3 without a liveness declaration (timeout_s); daemons
  claiming L3 are a category error. The watchdog (src/liveness.mjs) consumes legba span
  logs; eviction ALWAYS checkpoints (chess clock) — never discards work, never punishes
  arrival at the gate.
- AS-8 rel_required travels into CommandPolicy as x_rel_required; competitive tools
  invoked in casual-REL rooms are doctor findings today and sandbox refusals once finn
  honors the field. The lexicon gate (examples/lexicon-lint) screens outbound
  competitive-REL text; every finding carries a replacement.

## NON-GOALS

- Publishing to public npm (third-party deps still arrive via lockfile + minimumReleaseAge
  + ignore-scripts; OUR artifacts move by pinned SHA and attestation).
- Forcing Effect onto every script. Effect is the dialect for L3+ CLIs where the ceremony
  pays; L0/L1 bash stays free — that freedom is load-bearing.
- Merging veve into BeaconV3. Siblings with aligned philosophy, different scales.

## PHASES

1. **Land the package.** `packages/asson/` joins the pnpm workspace as `@freeside/asson`
   (ADR-007 naming review). `node packages/asson/src/demo.mjs` green in CI.
2. **Schemas to staging discipline.** Validate veve.schema.json with ajv in tests; open the
   hounfour migration PROPOSAL doc (TypeBox + constraint file: determinism/ambient
   implication, vector minimums, attestation requiredness at L3).
3. **freeside-cli verbs.** Implement `loa freeside asson doctor` (scan workspace for
   veve.json, full doctor report, exit 1 on any L3+ claim drifting above earned),
   `asson harvest <dir> -- <argv...>`, `asson attest <dir>` (CI key), `asson policy`
   (emit CommandPolicy JSON for finn config).
4. **Key ceremony.** CI signing key generated per environment, key_id derivation per house
   rule, public keys published in the repo (OPERATORS.md pattern). Rotation = version bump.
5. **First real graduations.** Pick 2–3 recurring scripts (the recorder's watchlist or
   `git log` frequency as interim evidence), graduate them through the ladder for real,
   harvesting vectors from current behavior. These become the canonical worked examples.
6. **Sandbox handshake.** PROPOSAL to loa-finn: CommandPolicy gains optional
   x_veve_tree_hash verification at spawn (invoke-time code-identity check — the last inch
   between "attested at build" and "verified at run"), plus x_timeout_s as the
   sandbox-owned enrage timer and x_rel_required refusal.
7. **Wire the watchdog (v0.2).** The legba SubagentStop/heartbeat path runs
   livenessVerdict over the live span log per the composition stage's policy; reap/
   compact/checkpoint actions route through the existing gate so forced arrival is judged,
   not dropped. Map verdict actions onto hounfour timeout behaviors
   (src/integrity/liveness-properties.ts: reaper/escalation/reconciliation/manual) — the
   law already exists; cite it rather than redefining.
8. **Lexicon gate at the comms seam.** lexicon-lint (or its graduated successor) runs as
   a PreToolUse/outbound gate for competitive-REL channels; lexicon.json grows under
   collective-choice rules (proposals + fixtures), never ad-hoc edits.

## ACCEPTANCE

- Demo behaviors reproduced in CI: harvest → attest → doctor L3 → policy generation;
  attack fixtures for AS-2 (post-attestation edit), AS-3 (claim drift), AS-1/LG-5
  (determinism contradiction) — negative fixtures close findings by name, house style.
- One real script graduated end-to-end with its PR linking the evidence runs.
- `loa freeside asson doctor` wired into CI as a gate (mechanical checks fail-closed;
  `declared_by: author` remains warn-tier — judgment is surfaced, not blocked).

## STYLE

House voice throughout: invariants as numbered testable claims, honest-docs notes on what
schema enforces vs what policy enforces, refusal messages that teach ("DRIFT: claims L5,
earns L2 — claims are cheap, evidence promotes"). When unsure whether a doctor check is
fail-closed or warn-tier, ask: can it fail honestly on good work? If yes, it warns.

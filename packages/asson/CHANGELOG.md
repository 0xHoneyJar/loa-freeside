# Changelog — @freeside/asson

## 0.2.0 — fork-train "the clock at the crossroads" (2026-06-11)

Legba substrate shipped; asson now consumes its move logs. Safety said nothing bad
happens; 0.2.0 adds the half that says something good eventually does.

### Added
- **`src/liveness.mjs`** — watchdog over legba-format span logs, zero-dep:
  `budgetStatus` (soft walls warn 0.6 / compact 0.8 / exhausted), `detectStall`
  (the recorder makes silence loud), `detectSpin` (repeated tool+input_hash pairs —
  cycles visible from hashes alone, no semantic judgment), `paceCheck` (splits),
  `checkpointPacket` (chess clock: forced arrival ≠ failure, work never lost to the
  wall), `livenessVerdict` (precedence: reap > checkpoint_and_present >
  compact_then_present > compact > warn > pace_alert > continue).
- **veve 0.2.0**: required `liveness` block (`timeout_s` — the enrage timer; having a
  clock is soundness, the magnitude is ergonomics; `expected_p95_s` — gecko pace split;
  `mode` — daemons claiming L3 are a category error) and optional `rel_required`
  (the tool declares the Rules Enforcement Level its invocation demands; undeclared
  context = competitive, fail-closed).
- **`examples/lexicon-lint/`** — second worked L3 CLI: words-with-teeth §2 graduated
  into a tool. Banned terms with mandatory replacements ("offchain" entry written from
  the live specimen), untagged-testimony detection, REL-aware exit semantics
  (3 = findings at competitive; casual = warn-tier). Every finding carries a
  replacement — refusals teach.
- **CommandPolicy derivation** now emits `x_timeout_s` and `x_rel_required` so the
  finn sandbox can own the enrage timer and refuse competitive tools in casual rooms.
- **`doctrine/words-with-teeth.md`** — REL declaration, controlled vocabulary,
  provenance tiers, measurement-register mandate.

### Changed
- **Doctor is version-dispatched** across the window {0.1.0, 0.2.0} (the EIP lesson,
  practiced in the artifact): 0.1.0 veves remain valid with a fork-warn; 0.2.0 veves
  fail L3 without `timeout_s` (AS-7) and fail on daemon-claims; competitive
  `rel_required` is surfaced (AS-8).
- `wordcount` example upgraded to 0.2.0 with a liveness block.

### Invariants added
- **AS-7** No 0.2.0 CLI reaches L3 without a liveness declaration; oneshot termination
  is part of the L3 contract.
- **AS-8** A tool's `rel_required` travels into CommandPolicy; competitive tools in
  casual rooms are findings now, refusals once finn honors the field.

## 0.1.0 — initial reference drop
veve manifests · graduation ladder (claims are cheap, evidence promotes) · tree-hash
ed25519 build attestation · golden-vector harvest/run · CommandPolicy derivation ·
doctor · wordcount example · three attack demos.

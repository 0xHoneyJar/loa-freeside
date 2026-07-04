# Gecko — Seam / Handoff Contract

> Derived 1:1 from `construct.yaml` `streams:` + `events:`. This is the
> construct's declared seam — the typed ports it reads/writes and the
> events it emits/consumes. No freestanding handoff doc ships in-repo;
> this file grounds the seam in the manifest.

## Typed streams

- **reads:** Intent, Operator-Model
- **writes:** Signal, Verdict, Artifact

## Emitted events (publish belt)

- `gecko.health_observed` — Emitted after a single-pass observation completes
- `gecko.drift_detected` — Emitted when identity-reality drift exceeds threshold
- `gecko.patrol_complete` — Emitted when a full patrol cycle finishes
- `gecko.diagnosis_complete` — Emitted when a deep diagnosis of a construct finishes
- `gecko.path_friction_observed` — Emitted after a path-friction sense completes — wrong-weight coordination acts + recurring cross-cell desire-paths (DETECTOR-tier; surfaced, never gated)
- `gecko.runtime_fit_observed` — Emitted after a runtime-fit sense completes — capability-reality drift across the construct estate (CONFLICTS hard / drive drift, SMELLS soft / surfaced; DETECTOR-tier, never gated)

## Consumed events (consume belt)

- `forge.k-hole.emergence_complete` — Picks up research emergence for ecosystem pattern matching

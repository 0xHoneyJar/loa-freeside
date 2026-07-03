# Herald — Seam / Handoff Contract

> Derived 1:1 from `construct.yaml` `streams:` + `events:`. This is the
> construct's declared seam — the typed ports it reads/writes and the
> events it emits/consumes. No freestanding handoff doc ships in-repo;
> this file grounds the seam in the manifest.

## Typed streams

- **reads:** Intent, Artifact
- **writes:** Artifact

## Emitted events (publish belt)

- `forge.herald.announcement_grounded` — Announcement drafted from code reality with evidence citations
- `forge.herald.voice_synthesized` — Voice profile extracted or refined from content analysis
- `forge.herald.changes_chronicled` — Structured change timeline produced from git evidence
- `forge.herald.stench_gated` — Copy passed (or was held at) the AI-stench markov blanket

## Consumed events (consume belt)

- (none declared)

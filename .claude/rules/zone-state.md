---
paths:
  - "grimoires/**"
  - ".beads/**"
  - ".ck/**"
  - ".run/**"
origin: genesis
version: 1
enacted_by: cycle-049
---

# State Zone Rules

The State Zone (`grimoires/`, `.beads/`, `.ck/`, `.run/`) stores session-spanning state. Read/Write permitted.

- **Grimoires**: Planning artifacts (PRD, SDD, sprint), context docs, memory, observations
- **Beads**: Task tracking state (managed by `br` CLI)
- **Run**: Autonomous execution state (sprint-plan-state, bridge-state, simstim-state)
- Configurable paths via `.loa.config.yaml`: `LOA_GRIMOIRE_DIR`, `LOA_BEADS_DIR`
- Memory observations: `grimoires/loa/memory/observations.jsonl` — queried via `.claude/scripts/memory-query.sh`
- In Agent Teams mode, only the lead writes to `.run/*.json` (teammates report via SendMessage)

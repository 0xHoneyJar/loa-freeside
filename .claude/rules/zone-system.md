---
paths:
  - ".claude/**"
origin: genesis
version: 1
enacted_by: cycle-049
---

# System Zone Rules

The `.claude/` directory is the **System Zone** — framework-managed files that agents MUST NOT edit directly.

- **NEVER** modify files in `.claude/` — use `.claude/overrides/` or `.loa.config.yaml` for customization
- Framework updates modify `.claude/loa/CLAUDE.loa.md`, not user files
- Safety hooks (`team-role-guard-write.sh`) enforce this boundary in Agent Teams mode
- Authorized System Zone writes require explicit cycle-level approval in the PRD

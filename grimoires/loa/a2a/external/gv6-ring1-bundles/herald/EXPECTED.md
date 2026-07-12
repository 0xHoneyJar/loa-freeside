# EXPECTED — mid-tier bundle (herald) · 8/9

Source: `construct-herald` (schema_version 3, slug `herald`, v0.1.0).
Picked as the mid-tier exemplar: clean manifest + valid tier, fails **only** the
grounding-file check because herald ships no `identity/environment.md` (its
`identity/` holds `HERALD.md`, `persona.yaml`, `expertise.yaml` only). This is the
common ~8/9 shape flagged in the task.

| # | Check | Verdict | Reasoning |
|---|-------|---------|-----------|
| 1 | manifest parses | PASS | `manifest.json` is valid JSON from `construct.yaml`. |
| 2 | registry-required fields | PASS | `schema_version: 3`, `name: Herald`, `slug: herald`, `version: 0.1.0`. |
| 3 | model_tier in SoT vocabulary | PASS | `capabilities.model_tier: sonnet` ∈ SoT vocabulary. |
| 4 | write cap never routes through read-only agent type | PASS | `synthesizing-voice` declares `Write` but pins no `agent:`; no read-only agent type anywhere. |
| 5 | capability declarations match toolset | PASS | `requires.tool_calling: true` matches Bash/Read/Write; `vision: false`, none used. |
| 6 | skill prose uses canonical primitives | PASS | No `bd`; `git log --grep` is a git commit-message flag, not a code-search `grep`/`rg`. No task tracking. |
| 7 | grounding file exists (reality.md axis) | **FAIL** | construct-herald has **no** `identity/environment.md`. `reality.md` here is an honest absence stub — no harness-grounding axis document exists to carry. |
| 8 | genome hash chain verifies | PASS | Fabricated valid 2-link `genome.jsonl`; recomputes; parent links match. |
| 9 | proof-of-run valid_run verdict | PASS | `proof-of-run.json` verdict `valid_run`; content_hash recomputes. |

**Expected score: 8/9 — fails check 7 (missing grounding file).**

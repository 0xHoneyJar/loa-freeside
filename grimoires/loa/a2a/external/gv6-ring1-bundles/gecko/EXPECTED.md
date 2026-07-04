# EXPECTED — gecko bundle · 9/9

Source: `construct-gecko` (schema_version 3, slug `gecko`, v0.1.0).
Reference-grade bundle. The `identity/environment.md` here is the canonical reality.md shape.

| # | Check | Verdict | Reasoning |
|---|-------|---------|-----------|
| 1 | manifest parses | PASS | `manifest.json` is `construct.yaml` → JSON 1:1; valid JSON. |
| 2 | registry-required fields | PASS | `schema_version: 3`, `name: Gecko`, `slug: gecko`, `version: 0.1.0` all present. |
| 3 | model_tier in SoT vocabulary | PASS | `capabilities.model_tier: opus` ∈ SoT {cheap, mid, tiny, max, opus, sonnet, haiku} (aliases block in `.claude/defaults/model-config.yaml`). |
| 4 | write cap never routes through read-only agent type | PASS | No skill sets `agent:` to a read-only type. `observe` declares `Write` in allowed-tools but pins no agent (inherits caller). |
| 5 | capability declarations match toolset | PASS | `requires.tool_calling: true` matches Bash/Read/Write/Edit usage; `vision: false`, no vision tools invoked. |
| 6 | skill prose uses canonical primitives | PASS | No raw `bd` task tracking; no raw `grep`/`rg` code-search. Uses `gh api`, `curl`, `jq`, `git`. |
| 7 | grounding file exists (reality.md axis) | PASS | `reality.md` = `identity/environment.md` (302 lines) — "The Ground GECKO Stands On", the runtime/harness taxonomy axis. |
| 8 | genome hash chain verifies | PASS | `genome.jsonl` 2-link chain; each `genome_hash` recomputes over its canonical body; `link2.parent_hash == link1.genome_hash`. |
| 9 | proof-of-run valid_run verdict | PASS | `proof-of-run.json` verdict `valid_run`; `content_hash_verified` recomputes from core members. |

**Expected score: 9/9.**

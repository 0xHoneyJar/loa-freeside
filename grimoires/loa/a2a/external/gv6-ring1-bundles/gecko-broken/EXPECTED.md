# EXPECTED — broken bundle · 6/9

Base: gecko copy + 3 injected violations (see `INJECTIONS.md`).

| # | Check | Verdict | Reasoning |
|---|-------|---------|-----------|
| 1 | manifest parses | PASS | `manifest.json` still valid JSON — `quantum` is a legal string. |
| 2 | registry-required fields | PASS | schema_version/name/slug/version untouched. |
| 3 | model_tier in SoT vocabulary | **FAIL** | Injection (b): `model_tier: quantum` ∉ SoT vocabulary. |
| 4 | write cap never routes through read-only agent type | **FAIL** | Injection (a): `observe` declares `Write` + `agent: Explore` (read-only). |
| 5 | capability declarations match toolset | PASS | Toolset/requires untouched by the injections. |
| 6 | skill prose uses canonical primitives | PASS | Primitive usage untouched. |
| 7 | grounding file exists (reality.md axis) | PASS | `reality.md` copied intact from gecko (`environment.md`). |
| 8 | genome hash chain verifies | **FAIL** | Injection (c): link 1 mutated post-mint; stored `genome_hash` ≠ recompute; chain breaks. |
| 9 | proof-of-run valid_run verdict | PASS | `proof-of-run.json` verdict `valid_run`; content_hash recomputed over injected content. |

**Expected score: 6/9 — fails checks 3, 4, 8.**

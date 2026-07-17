---
source_type: ai-autogen
use_label: usable
read_state: read
as_of: 2026-07-06
generated_by: /ride Phase 2b hygiene audit (supersedes 2026-05-18)
---

# Hygiene Report — loa-freeside (Phase 2b)

> Generated 2026-07-06 by /ride. **FLAGGED for human decision — nothing auto-fixed.** CODE IS TRUTH.

## Tech-debt markers
| Marker | Count | Note |
|---|---|---|
| TODO | 36+ | scattered; a few near billing/settlement paths — triage for data-loss adjacency |
| `@ts-nocheck` | 27 files | **type-safety barrier** — whole files opted out of the strict TS the repo advertises |
| `@deprecated` | 15+ | verify callers migrated before removal |
| FIXME / HACK / XXX | present | lower volume |

## Committed build artifacts (tracked, should not be)
- **~100+ `.pyc`** under `.claude/**/__pycache__/` + `.claude/scripts/lib/__pycache__/` (Loa framework cache).
- `.claude/skills/riding-codebase/SKILL.md.bak` (a stray backup).
- **All inside `.claude/` System Zone** → not fixable in-repo without upstream Loa change (see the 2026-07-06 gitignore-only janitor commit `af96a214`, which deliberately did NOT add `*.pyc` rules to avoid shadowing these tracked files). Recommend upstream Loa fix.

## Dependency version conflicts (workspace)
- Semantic version drift across package.jsons on **viem**, **zod**, **jose** — different ranges in different packages. Risk: duplicate installs, subtle behavior divergence. Flag for a workspace-wide pin/dedupe pass.
- TypeScript spread 5.3–5.7 across packages.

## Naming / identity drift (RESOLVED in code, STALE in docs)
- Code namespace is **`@freeside/*` + `@0xhoneyjar/*`** (0 `@arrakis` refs remain), but `AGENTS.md` project instructions + the 2026-05-18 reality corpse still say `@arrakis/*`. → Update AGENTS.md's Chain Provider examples (`@arrakis/adapters/chain`) to `@freeside/adapters`.

## Structural
- Large commented-out blocks exist but are **mostly review/finding citations, not dead code** (verified sample) — leave unless a targeted cleanup is requested.
- No root `pnpm-workspace.yaml` (workspaces in root package.json) — intentional but non-standard; note for onboarding.
- Dual persistence (SQLite v1 + PostgreSQL) is intentional (coexistence), not debt — but the SQLite v1 path is a migration tail worth tracking for eventual retirement.

## Federation gaps (from registry live-probe 2026-06-19)
- **beacon `*.0xhoneyjar.xyz` subdomains 404 cluster-wide** (DNS + unshipped routes) — discovery is fixture/registry-only today.
- mint-api scaffolded (routeless), ledger-api not deployed, mediums-api npm-lib-only.
- Cluster secret-parity (`IDENTITY_API_JWT_SECRET` ↔ identity `JWT_SECRET`) has no CI canary → silent cluster-wide 401 risk on drift.

## Not flagged (deliberately)
Untracked local worktrees (`wt-*`, `.worktrees/`), `cycles/`, `.loa-harness/` — already gitignored by janitor commit `af96a214` (2026-07-06). `.beads/` churn + `grimoires/loa/*.md` symlink type-changes = active/concurrent state, out of scope.

---
source_type: ai-autogen
use_label: usable
read_state: read
as_of: 2026-07-19
generated_by: /ride Phase 2b hygiene audit (delta 9b0f4a12 → b5df718a)
git_sha: b5df718a
---

# Hygiene Report — loa-freeside (Phase 2b)

> Generated 2026-07-19 by /ride. **FLAGGED for human decision — nothing auto-fixed.** CODE IS TRUTH.

## Tech-debt markers (app code: packages/ apps/ themes/sietch/src tools/)
| Marker | Count | Note |
|---|---|---|
| Total markers | 85 | `grimoires/loa/reality/tech-debt.txt` (regenerated 2026-07-19) |
| TODO | 43 | a few near billing/settlement paths — triage for data-loss adjacency |
| `@ts-nocheck` | 28 files | **type-safety barrier** — whole files opted out of the strict TS the repo advertises (+1 vs 07-06) |
| `@deprecated` | 12 | verify callers migrated before removal |
| FIXME / HACK / XXX | remainder | lower volume |

## Committed build artifacts (tracked, should not be)
- **114 `.pyc`** tracked under `.claude/**/__pycache__/` (Loa framework cache) — count verified 2026-07-19 (`git ls-files | grep -c '\.pyc$'`). Plus NEW untracked `__pycache__` churn under `.claude/adapters/loa_cheval/` (cpython-314). All inside `.claude/` System Zone → needs upstream Loa fix, not in-repo.
- `.claude/skills/riding-codebase/SKILL.md.bak` (stray backup, still present).

## State-zone debris (NEW this delta)
- `.beads/.write.lock.orphaned-20260717` — orphaned beads write lock (verified present). Flag for `br` cleanup.
- Untracked `.beads/.br_history/*.jsonl` + `.beads/metadata.json` — beads-rust migration residue; verify gitignore intent (`validate-gitignore-state.sh`).

## Structural
- **23 loose `.ts` service files directly under `packages/services/`** (credit-lot-service, governance-*, velocity-*, x402-settlement, nowpayments-handler, conservation-guard, arrakis-conviction-bridge, …) — billing/economics logic outside any package boundary; extraction target per ADR-008 (claims D-1/D-2, hub-thinning ride 2026-07-17).
- `themes/sietch/src/packages/adapters/storage/schema.ts` — **nested parallel adapters tree inside sietch** duplicating root `packages/adapters/storage/schema.ts` shape (claim A-8 VERIFIED — pgTable defs in both).
- Dependency version drift persists across package.jsons on **viem**, **zod**, **jose**; TypeScript spread 5.3–5.7. The 6 NEW protocol packages add more package.json surfaces to keep in sync.
- No root `pnpm-workspace.yaml` (workspaces in root package.json) — intentional but non-standard.
- Dual persistence (SQLite v1 + PostgreSQL) intentional (coexistence); SQLite v1 path remains a migration tail worth tracking.

## Naming / identity drift
- Code namespace is **`@freeside/*` + `@0xhoneyjar/*`**; check `AGENTS.md` examples were fixed 07-06 — no `@arrakis` refs remain in code.
- Gateway Rust crate still named **`arrakis-gateway`**; registry cell `ordering` breaks the `*-api` cell naming convention (see consistency-report).

## Federation gaps (carried; last live-probe 2026-06-19)
- **beacon `*.0xhoneyjar.xyz` subdomains 404 cluster-wide** (DNS + unshipped routes) — discovery is fixture/registry-only.
- mint-api scaffolded (routeless), ledger-api scaffolded not deployed, mediums-api/events-api not-built.
- Cluster secret-parity (`IDENTITY_API_JWT_SECRET` ↔ identity `JWT_SECRET`) still has no CI canary → silent cluster-wide 401 risk on drift (plan exists: `specs/cluster-secret-parity-canary/`).

## Not flagged (deliberately)
Untracked local worktrees (`wt-*`, `.worktrees/`), `cycles/`, `.loa-harness/` — gitignored by janitor commit `af96a214`. `grimoires/loa/*` churn = active concurrent cycle state (collection-report coordinator branch), out of scope.

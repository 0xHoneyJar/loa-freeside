# RESUME: Shadow Access Audit build (feat/shadow-access-audit)

**State (2026-06-22):** planning COMPLETE; code build (Phase 7 `/run sprint-plan`) **not yet run** —
halted because the multi-model gates (cheval headless: flatline/review/audit) were failing that night
(3 flatlines degraded: full → single-model → empty). Per simstim Phase-7, code is NOT hand-written to
bypass dead gates. Tracking bead: `arrakis-5h12` (close only when merged/abandoned).

## Ready on this branch
- `grimoires/loa/prd.md` — v2.1 (KEEPER + 2-flatline + live-probed; dogfood-NFT scope)
- `grimoires/loa/sdd.md` — architecture, AC-traced
- `grimoires/loa/sprint.md` — Sprint 1: S1-T1..T9
- 9 beads in `.beads/` (S1-T1..T9, `arrakis-{gtit,2ub3,z2ia,m20x,d58y,8i9p,6hjk,og8n,f6ox}`)

## One-command resume (when cheval headless is healthy)

**Option A — from this worktree** (rooted here, cwd-aligned):
```
cd /Users/zksoju/Documents/GitHub/loa-freeside-shadow-audit
/run sprint-plan          # implements S1-T1..T9 through review+audit → draft PR
```

**Option B — no worktree** (your preference; the branch becomes the main checkout):
```
# from the main repo, after parking the extraction churn:
git worktree remove ../loa-freeside-shadow-audit
git checkout feat/shadow-access-audit
/run sprint-plan
```

## Pre-run sanity (cheval must be healthy — the thing that blocked it)
```
.claude/scripts/flatline-orchestrator.sh --doc grimoires/loa/sdd.md --phase sdd --json | jq .confidence
# want "full" (or at least not "degraded"). If degraded, the gates are still down — wait.
```

## Scope guard (do NOT let the build drift)
dogfood-NFT only (sonar's 8 THJ collections + our roles) · single-contract NFT gating (refuse the rest) ·
member-data-stateless · no shadow-mode/D4 · no external/arbitrary-contract data · no products 2-4.

## On completion
draft PR on feat/shadow-access-audit → review → merge → `git worktree remove` → close `arrakis-5h12`.

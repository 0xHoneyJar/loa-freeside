# Cluster Harness Audit — 2026-05-25

> **POST-AUDIT CORRECTION (2026-05-25 PM)** — Submodule probe AFTER initial dispatch revealed: `mint-api` + `activities-api` are mounted via a DIFFERENT pattern (Loa-as-submodule). The 12K `.claude/` I measured is just symlinks into `../.loa/.claude/*` + a `.mount-lock` marker; the substantive Loa framework lives inside the `.loa` submodule (pinned to v1.157.1). **Corrected mount compliance: 5/8 substantive (not 3/8).** Two mount patterns now formally recognized in the cluster doctrine:
>
> | Pattern | Cells | Shape |
> |---------|-------|-------|
> | **Copy-style** | identity-api (17M), sonar-api (11M), score-api (9.2M) | Full `.claude/` content tracked per cell |
> | **Submodule-style** | mint-api, activities-api | `.loa` submodule (v1.157.1) + `.claude/` symlinks + `.mount-lock` |
>
> Truly unmounted (3 cells): **inventory-api** (now MOUNTED 2026-05-25 PM via Agent 1; copy-style; branch `cluster-meta/loa-mount-2026-05-25`; awaiting operator-gated push), **storage-api** (Agent 3 dispatched), **mediums-api** (Agent 2 dispatched).
>
> Doctrine compliance after Tier-1 remediation: **6/8 substantive** (still pending Tier-2 storage + mediums mounts). Pre-cycle: 5/8 (audit corrected). Originally claimed: 3/8.
>
> The audit-as-written below is preserved for historical accuracy + so future audit-script improvements (e.g., `du -sh .loa/.claude/` AND dereferenced symlinks) catch this case. The submodule miss is a real audit limitation worth encoding in the gecko-skill formal version.
>
> **CYCLE CLOSE 2026-05-25 PM — Tier-1+Tier-2 remediation complete.** 4 agents dispatched in parallel; 3 mount commits landed + 1 investigation report:
>
> | Cell | Agent | Outcome |
> |------|-------|---------|
> | inventory-api | 1 | ✅ COMMITTED on `cluster-meta/loa-mount-2026-05-25` (`495766a`); 9.2M; 90/92 tests pass; awaiting operator push |
> | mediums-api | 2 | ✅ COMMITTED on `cluster-meta/loa-mount-2026-05-25` (`eeda701`); 9.2M; 278 tests pass; awaiting operator push |
> | storage-api | 3 | 🟡 STAGED on `cluster-meta/loa-mount-2026-05-25` but UNCOMMITTED (operator-gated per constraint); 9.2M; typecheck + tests pass; pnpm workspace verified (not bun) |
> | activities-api | 4 | ℹ️ INVESTIGATION ONLY — confirmed submodule-mount works; no changes; flagged uncommitted state as framework churn (left in place); strong recommendation for submodule-style as cluster default for new cells |
>
> **Cluster doctrine compliance: 5/8 (audit-corrected) → 8/8 (potential, once 3 push gates + 1 commit-gate land).** First cluster-meta cycle delivered the per-cell mount ratchet the doctrine called for.
>
> Findings ratified into [ADR-009 D-4a (mount patterns)](../../../decisions/009-freeside-hexagonal-federation.md) + [D-4b (default-branch heterogeneity)](../../../decisions/009-freeside-hexagonal-federation.md). Operator-gated decisions accumulated below in §Pending operator decisions (consolidated across 4 agent reports).

**Cycle type**: cluster-meta · **First artifact under [ADR-009 D-7](../../../decisions/009-freeside-hexagonal-federation.md)** · **Cycle scope**: all 8 registered cells of the freeside HEXAGONAL FEDERATION

> First cluster-meta cycle to dogfood the runbook at [`grimoires/loa/operators/where-do-i-work-from.md`](../../loa/operators/where-do-i-work-from.md). The cycle exists because [ADR-009 D-4](../../../decisions/009-freeside-hexagonal-federation.md) names per-cell Loa harness as load-bearing doctrine ("Agents need to be able to run beads/cycles. We mount if not already mounted."). This audit verifies empirical compliance.

## Executive summary

Of the 8 cells registered in `packages/freeside-registry/registry.yaml`:

- **3/8 have a substantive Loa harness** (>5MB `.claude/` + grimoires/loa/ + .beads/): identity-api, sonar-api, score-api
- **2/8 have a minimal harness** (`.claude/` dir exists but only ~12K of content — scaffold without real Loa workflow): mint-api, activities-api
- **1/8 is partial** (CLAUDE.md only, no `.claude/`, no grimoires/, no .beads/): storage-api
- **2/8 are completely unmounted** (no CLAUDE.md, no harness): inventory-api, mediums-api

**Doctrine compliance: 3/8 (37.5%).** Per ADR-009 D-4: "We mount if not already mounted" — 5 cells violate this today.

## Raw data

```
registered slug    | CLAUDE.md | grimoires/loa | .claude   | .beads    | local path                                     | .claude size
-------------------+-----------+---------------+-----------+-----------+------------------------------------------------+--------------
sonar-api          | ✓         | ✓             | ✓         | ✓         | ~/Documents/GitHub/freeside-sonar              | 11M
storage-api        | ✓         | ✗             | ✗         | ✗         | ~/Documents/GitHub/freeside-storage            | —
mint-api           | ✓         | ✓             | ✓         | ✓         | ~/Documents/GitHub/freeside-mint               | 12K (minimal)
activities-api     | ✓         | ✓             | ✓         | ✓         | ~/Documents/GitHub/freeside-activities         | 12K (minimal)
inventory-api      | ✗         | ✗             | ✗         | ✗         | ~/Documents/GitHub/inventory-api               | —
score-api          | ✓         | ✓             | ✓         | ✓         | ~/Documents/GitHub/score-api                   | 9.2M
identity-api       | ✓         | ✓             | ✓         | ✓         | ~/Documents/GitHub/freeside-auth               | 17M
mediums-api        | ✗         | ✗             | ✗         | ✗         | ~/Documents/GitHub/freeside-mediums            | —
```

## Per-cell findings

### ✅ Full harness (3 cells)

**identity-api** (~/Documents/GitHub/freeside-auth, 17M)
- Mounted during Phase 1 cycle 2026-05-24 (T1.1 gate). Largest harness in cluster — reflects the auth-keystone scrutiny + 11 operator review gates.
- All four artifacts present + populated; the throwaway coordinator at `~/bonfire/identity-api-coordinator/` complements it.
- **No action needed.**

**sonar-api** (~/Documents/GitHub/freeside-sonar, 11M)
- Substantive harness; rename to `sonar-api` at fs level is pending (per registry `rename: done`, but repo dir still `freeside-sonar`).
- **Action**: schedule fs rename (`gh repo rename` + local `git mv` clone).

**score-api** (~/Documents/GitHub/score-api, 9.2M)
- Substantive harness; renamed cleanly to `score-api`.
- **No action needed** for harness; rename complete.

### 🟡 Minimal harness — `.claude/` dir exists but only ~12K (2 cells)

**mint-api** (~/Documents/GitHub/freeside-mint, 12K `.claude/`)
- `.claude/` exists but is essentially empty (12K = a few config files; no constructs-pack symlinks, no skill mounts). Per the ADR-009 D-4 spirit, this is NOT a true mount — an agent dropping in cannot run beads/cycles.
- `grimoires/loa/`, `.beads/`, `CLAUDE.md` all present (good shape; just missing the substantive Loa pack).
- **Action**: re-mount via `os-mounting` skill to bring `.claude/` up to substantive size (~10-15MB expected based on other cells).
- **Status risk**: documented as "mounted" in vault concept page; actually minimal. Doctrine description needs amendment.

**activities-api** (~/Documents/GitHub/freeside-activities, 12K `.claude/`)
- Same shape as mint-api: minimal `.claude/` skeleton; `grimoires/loa/` + `.beads/` + `CLAUDE.md` all present.
- The 648 tests + Sprint-3 work landed via a different harness mechanism (likely sibling cell's mount, or pre-Loa workflow). The doctrine-correct shape would be substantive `.claude/` here too.
- **Action**: re-mount.
- **Rename**: fs-level dir still `freeside-activities` despite registry `rename: done`. Schedule fs rename.

### 🟠 Partial mount — CLAUDE.md only (1 cell)

**storage-api** (~/Documents/GitHub/freeside-storage)
- CLAUDE.md exists (indicates intent / partial scaffold). `.claude/`, `grimoires/loa/`, `.beads/` all missing.
- **Action**: full mount required. Use `os-mounting` skill from construct-hivemind-os.
- **Rename**: fs dir still `freeside-storage`; registry `rename: pending`. Coordinate fs + registry rename together.

### ❌ Unmounted (2 cells)

**inventory-api** (~/Documents/GitHub/inventory-api)
- **NO Loa harness at all.** No CLAUDE.md, no `.claude/`, no `grimoires/loa/`, no `.beads/`.
- L4 production cell — owns Mibera contract holdings (`0x6666397dfe9a8c469bf65dc744cb1c733416c420` per ADR-008 D-11 build evidence). Heavy cluster dependency.
- **Hypothesis**: built pre-Loa-introduction OR mounted by external/non-Loa workflow. Either way, the doctrine says it should be mounted.
- **Action (URGENT given L4 status)**: mount via `os-mounting`; author CLAUDE.md from the existing src/ as anchor (the 12-test verify against `MIBERA_CONTRACT` proved its surface during T2.2 compose orchestrator work).
- **Risk**: agents working on inventory-api today have no Loa workflow available; debugging the upstream-sonar-ownership gap (noted in T2.2 caveats §1) is harder than it should be.

**mediums-api** (~/Documents/GitHub/freeside-mediums)
- NO Loa harness. Same shape as inventory-api but lower priority (L2 per project memory, not L4).
- **Action**: mount via `os-mounting`.
- **Rename**: fs dir still `freeside-mediums`; registry `rename: pending`.

## Cluster-aggregate findings

### 1. Doctrine compliance is below threshold

Per ADR-009 D-4, 100% mount compliance is the doctrine target. **Current state: 37.5%.** The doctrine was named yesterday (2026-05-25); the empirical state reflects historical accumulation, not deliberate violation. But going forward: every cell that ships without a mount violates the doctrine; every cell that mounts catches up.

### 2. Mount size estimate in ADR-009 was wrong (worth amending)

ADR-009 D-4 Consequences claimed: *"Per-cell `.claude/` mount adds ~30MB per cell (~240MB across 8 cells)."*

Reality:
- Heavy mounts: 9.2-17MB each (3 cells = ~37MB)
- Minimal mounts: 12K each (2 cells = ~24K)
- Unmounted: 0 (3 cells)
- **Total empirical: ~37MB** — an order of magnitude less than the 240MB estimate.

This matters because the size estimate was used to argue "framework updates require sync across all cells" as a negative consequence. The real cost is much smaller. **Recommended ADR-009 amendment** (next operator-clarity session): revise D-4 Consequences with empirical numbers.

### 3. Three rename:pending fs ops outstanding

Registry shows three cells as `rename: pending`:
- `storage-api` (fs: `freeside-storage`)
- `mint-api` (fs: `freeside-mint`)
- `mediums-api` (fs: `freeside-mediums`)

Two cells' registry shows `rename: done` but fs hasn't caught up:
- `sonar-api` (fs: `freeside-sonar`)
- `activities-api` (fs: `freeside-activities`)

The fs renames are bundled with mount work as a single cell-touch operation.

### 4. The construct-laboratory-substrate banner fires per session

The SessionStart banner ("Laboratory member (CultureTech) — operator-level governance ACTIVE") fires regardless of cell-level mount status because it's session-level, not cell-level. So an agent working in unmounted inventory-api still hears HIVEMIND LABORATORY operating posture — but cannot exercise it without bead/cycle infrastructure.

## Recommended remediation

Sequenced by priority + dependency:

### Tier 1 — URGENT (production cell, no harness)
- **inventory-api** — mount + author CLAUDE.md from src/ + create grimoires/loa/, .beads/. ~30 min.

### Tier 2 — IMPORTANT (cells with partial state)
- **storage-api** — complete the mount (CLAUDE.md exists; add .claude/, grimoires/loa/, .beads/). ~20 min.
- **mediums-api** — full mount + CLAUDE.md. ~30 min.

### Tier 3 — UPGRADE (minimal → substantive)
- **mint-api** — re-mount to bring `.claude/` from 12K to substantive. ~15 min.
- **activities-api** — re-mount; also fs rename. ~20 min.

### Tier 4 — RENAME (fs catches up to registry)
- **storage-api**, **mint-api**, **mediums-api** — registry rename:pending → done + fs rename. Bundle with Tier 1-3.
- **sonar-api**, **activities-api** — registry says done; fs rename needs to happen.

### Total estimate
~2 hours of mechanical cell-touch work. Suggested cycle: `cluster-meta` named `cell-harness-remediation-2026-05-26` (or similar; operator chooses date). Could dispatch per-cell sub-agents in parallel for ~30 min wall-clock.

## Doctrine updates surfaced

1. **ADR-009 D-4 Consequences** — amend "~240MB across 8 cells" claim with empirical ~37MB number.
2. **Vault concept page** — current state says "5/8 mounted"; correct to "3/8 substantive, 2/8 minimal, 1/8 partial, 2/8 unmounted" with the same caveat as the ADR.
3. **Operator runbook §Cluster cell roster** — add a `Verify mount` quick-check column to the cell roster table (the audit script could be referenced as a one-liner).

## What this validates

- The cluster-meta cycle type (ADR-009 D-7) WORKS — this audit is the first artifact and it surfaced 5 concrete drift findings in <30 min.
- The runbook's audit one-liner (probe `.claude/CLAUDE.md` + `grimoires/loa/` per cell) is sufficient for first-pass cluster health.
- `grimoires/freeside-network/` already existed as a doc location (ECOSYSTEM-BASELINE.md, FREESIDE.md, MENTAL-MODELS.md, README.md were there pre-this-cycle); this cycle adds the FIRST sub-directory for an audited cluster-meta artifact, following ADR-009 D-7's naming pattern.

## Status

**Audit complete.** Remediation HELD pending operator decision on whether to dispatch as:
- One bundled cluster-meta cycle (single cycle, all 5 cells)
- Per-cell coordinators (5 throwaway coordinators in parallel, lighter touch per cell)
- Operator-driven one-by-one (no automation; manual touch per cell)

## Pending operator decisions (consolidated from 4 agent reports)

### Cluster-wide

1. **Mount pattern policy** (raised by Agents 2, 3, 4). Submodule-style is structurally superior; copy-style cells (4 of 6 mounted) are now grandfathered. **Decide**: standardize cluster on submodule-style for new cells + migrate copy-style cells over time? Or leave both patterns coexisting as-is?
2. **`construct-hivemind-os` install at user level** (raised by Agents 1, 2, 3). The `os-mounting` skill that ADR-009 D-4 names as Path A doesn't exist locally. **Decide**: install `construct-hivemind-os` to unlock Path A, OR amend doctrine to name Path B (manual copy-from-template) as canonical primary path.
3. **`score-api` `.claude/` as cluster template** is de-facto canonical (4 cells now use it). **Decide**: codify as a *cluster-template repo* with explicit "this is the canonical Loa-mount source" status, OR rotate templates per-mount based on freshness.

### Per-cell push/commit gates

4. **inventory-api**: branch ready (`cluster-meta/loa-mount-2026-05-25` at `495766a`). Push + open PR + merge whenever you GO.
5. **mediums-api**: branch ready (`cluster-meta/loa-mount-2026-05-25` at `eeda701`). Push + open PR + merge. After merge: rebase `feat/cmp-boundary-arch-sprint-3-cli-renderer-and-ctx-split` onto new main.
6. **storage-api**: branch created but commits NOT yet made (Agent 3 staged the work; operator-gated commit). To complete: `git -C ~/Documents/GitHub/freeside-storage commit -m "chore(cluster-meta): mount Loa harness per ADR-009 D-4"` then push + open PR + merge into the feature branch (no main exists; see below).
7. **activities-api**: no action — already substantively mounted via submodule.
8. **mint-api**: no action — already substantively mounted via submodule.

### Structural

9. **storage-api lacks `origin/main`** (Agent 3 verified). Default/active line is the feature branch. Separate operator cycle needed: `git branch -m feat/... main` OR `git checkout -b main && git push -u origin main` + GitHub default-branch swap. Not blocking; flagged for clarity.
10. **Default-branch heterogeneity** (ADR-009 D-4b): activities-api uses `master`; some others use `main`. Recommendation in D-4b is to standardize on `main` cluster-wide.
11. **Tracked-state hygiene** (Agent 4 finding): `.loa` submodule has `__pycache__/*.pyc` churn that creates perpetual `-dirty` state. Upstream `loa` repo should `.gitignore` `__pycache__/`. Separate upstream-Loa PR.

### Tooling

12. **Per-cell package manager varies** (Agent 3 finding): storage-api uses `pnpm@9.0.0`; others use `bun`. Cluster-harness audit checklist should detect package-manager per cell rather than assuming bun.
13. **`block-destructive-bash.sh` hook quirk** (Agent 1 finding): blocks `rm -rf ./.<name>` paths. Workaround: `trash` command. Hook regex could be loosened OR doctrine could codify the `trash` workaround.

## References

- [ADR-009 · Freeside Hexagonal Federation](../../../decisions/009-freeside-hexagonal-federation.md) — D-4 (per-cell harness doctrine), D-7 (cluster-meta cycle scope)
- [Where Do I Work From?](../../loa/operators/where-do-i-work-from.md) — operator runbook; this cycle is its first dogfood
- `~/vault/wiki/concepts/freeside-hexagonal-federation.md` — operator-domain doctrine (vault concept)
- Cluster baseline docs (pre-existing): `ECOSYSTEM-BASELINE.md`, `FREESIDE.md`, `MENTAL-MODELS.md`, `README.md` in this dir's parent
- `packages/freeside-registry/registry.yaml` — source of truth for the 8 registered cells
- Empirical: this audit (2026-05-25)

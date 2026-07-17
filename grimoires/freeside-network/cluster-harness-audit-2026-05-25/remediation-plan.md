# Cluster Harness Remediation Plan — 2026-05-25 PM

**Follow-up to** [audit-report.md](audit-report.md) — applies ADR-009 D-4 doctrine to the 5 non-compliant cells the audit surfaced.

## Dispatch decision matrix

Pre-dispatch probe of each cell's branch state surfaced a load-bearing constraint: **4/5 remediation targets are on active feature branches with WIP work.** Mounting Loa onto those branches would mix the harness-mount commit with in-flight feature work, making PR review noisier and rollback harder.

| Cell | Branch state | Dispatch | Reason |
|------|--------------|----------|--------|
| **inventory-api** | `main`, clean | ✅ **GO** | L4 prod, ZERO harness (URGENT); main is clean; safe to branch off |
| **storage-api** | `feat/cmp-boundary-arch-sprint-4-medium-capabilities-v140` | 🟡 **HOLD** | active WIP feature branch; branch coord required |
| **mediums-api** | `feat/cmp-boundary-arch-sprint-3-cli-renderer-and-ctx-split` | 🟡 **HOLD** | active WIP feature branch; branch coord required |
| **mint-api** | `feat/freeside-mint-genesis` (modified `.claude/constructs/.sync-state.json`) | 🟡 **HOLD** | active feature branch + sync-state churn |
| **activities-api** | `feat/acvp-modules-genesis` (modified `.claude/constructs/.sync-state.json` + `.loa` untracked) | 🟡 **HOLD** | active feature branch + Sprint-3 work in flight |

## Currently dispatched (background)

### Agent 1 — inventory-api mount

- Cell: `inventory-api` (~/Documents/GitHub/inventory-api)
- Branch: `cluster-meta/loa-mount-2026-05-25` (new, off main)
- Scope: ADDITION-ONLY (CLAUDE.md, `.claude/`, `grimoires/loa/`, `.beads/`, `.run/`)
- Template: `~/Documents/GitHub/score-api/.claude/` (9.2M substantive mount)
- Hard constraints: no push, no src/ touch, no package changes, no contract surface (.well-known/beacon.json) touch
- Mount mechanism: Path A (`os-mounting` skill from construct-hivemind-os) preferred; Path B (manual scaffold + selective copy) fallback
- Report-back: branch state, files added, mount size, CLAUDE.md content, pending operator decisions, tsc/build still works

Expected completion: ~10-15 min (mechanical work). Operator gates the push + PR after report.

## Held — branch coordination question

The 4 HOLD cells need an operator decision on **how to coordinate Loa-mount work with active feature branches**. Three honest options:

### Option α — Mount on each cell's CURRENT feature branch

- Pro: lowest coord overhead; mount lands alongside feature work
- Pro: feature branch's PR-review-cycle covers both
- Con: mount commits and feature commits get interleaved in history
- Con: revert-the-mount-only is hard if feature work depends on the mount
- Con: doctrine compliance + feature shipping become tangled — auditability suffers

### Option β — Wait for feature branches to merge, THEN mount on main

- Pro: clean separation; mount lands solely on main after feature work absorbed
- Pro: no interleaving; revert-the-mount-only is trivial
- Con: delays doctrine compliance until the feature branches close
- Con: feature branches may take days/weeks to merge — drift persists
- Con: agents working in those cells DURING the wait have no harness

### Option γ — Branch off each feature branch's base; mount on a separate `cluster-meta/loa-mount` branch per cell; coord with feature-branch owner on rebase strategy

- Pro: clean mount-only branch per cell; reviewable in isolation
- Pro: doctrine compliance happens NOW
- Con: when feature merges, may need rebase or merge-conflict resolution
- Con: cell maintainers must coordinate (2 active areas of work in one cell)

**My read**: γ for storage-api + mediums-api (their feature branches look medium-term-long-running); α for mint-api + activities-api (their sync-state churn suggests they're CURRENTLY tackling Loa wiring, so the mount work composes with their flow naturally).

But this is operator-decide territory — the policy choice matters more than my read.

## Per-cell recipe (for whichever path the operator picks)

### Tier 1 (URGENT) — inventory-api (already dispatched)

See Agent 1 above.

### Tier 2 — storage-api

Current: CLAUDE.md exists (3KB, last modified Apr 29); no `.claude/`, no `grimoires/loa/`, no `.beads/`.

Actions:
1. New branch off chosen base (per Option α/β/γ): `cluster-meta/loa-mount-2026-05-25`
2. ADD `.claude/` (template from score-api or sonar-api)
3. ADD `grimoires/loa/{cycles,notes,memory}` + `grimoires/loa/NOTES.md`
4. ADD `.beads/` (init via `br init`)
5. ADD `.run/` (state dir; .gitkeep)
6. UPDATE CLAUDE.md if needed (current looks pre-Loa; may need Loa framework reference added)
7. UPDATE .gitignore if needed

Hard constraints: no push, no src/ touch, no package changes.

### Tier 2 — mediums-api

Current: NO Loa harness at all. Also: feature branch has changes; clarify intent of those before mount.

Same recipe as storage-api but starts from a completely cold cell.

### Tier 3 — mint-api

Current: minimal `.claude/` (12K, has `.sync-state.json` modified — implies a sync attempt happened recently); `grimoires/loa/`, `.beads/`, CLAUDE.md present (probably scaffolded earlier).

Actions:
1. New branch off chosen base
2. RE-MOUNT `.claude/` to bring from 12K → substantive (~5-15MB). Use Path A or Path B.
3. Inspect why sync-state was modified — may be a clue about why mount didn't complete first time.
4. Existing CLAUDE.md + grimoires/loa/ + .beads/ — verify substantive; tighten if minimal.

### Tier 3 — activities-api

Same as mint-api but also has `.loa` untracked file — investigate before deciding whether to commit it.

Sprint-3 work landed via SOME harness mechanism (648 tests passing per memory). Identify what that mechanism is — there may be a sibling-shared mount or external orchestration that the audit didn't see.

## What this remediation cycle proves (when complete)

- Doctrine compliance ratchets from 3/8 → 8/8 (100%)
- The cluster-meta cycle type produces real operational improvement (not just docs)
- The mount-recipe converges on a reproducible pattern (the per-cell recipe above becomes a Loa skill in a future cycle)
- The audit → plan → dispatch → distill loop dogfoods the gecko + KRANZ + Hivemind Lab three-frame stack named in ADR-009 D-12

## Status — COMPLETE (2026-05-25 PM)

- **Audit**: complete (audit-report.md, with post-cycle correction header)
- **Plan**: complete (this doc)
- **Tier 1 dispatch (inventory-api)**: ✅ COMPLETE — Agent 1 mounted cleanly on `cluster-meta/loa-mount-2026-05-25` (`495766a`); PR #1 (or next available) opened on `0xHoneyJar/inventory-api` against main
- **Tier 2 dispatch (mediums-api + storage-api)**: ✅ COMPLETE
  - mediums-api: Agent 2 mounted on `cluster-meta/loa-mount-2026-05-25` (`eeda701`); PR opened
  - storage-api: Agent 3 mounted on `cluster-meta/loa-mount-2026-05-25`; commit landed in ship wave; PR opened
- **Tier 3 (mint-api + activities-api)**: ✅ NOT NEEDED — Agent 4 investigation confirmed both cells were already substantively mounted via submodule pattern (`.loa` pinned to v1.157.1). My initial audit miscounted because `du -sh .claude/` doesn't dereference symlinks. The gecko skill at `construct-freeside/skills/auditing-cluster-cells/` now uses the corrected probe.
- **Distill (cycle outputs)**: ✅ COMPLETE
  - ADR-009 amended with D-4a (mount patterns) + D-4b (default-branch heterogeneity) + D-12 (construct-frames as policies)
  - Vault concept page amended with §Current mount state + §Construct frames
  - Operator runbook amended with three-frame stack reference
  - master→main sweep landed: storage-api + activities-api renamed via `gh api .../branches/master/rename`; mint-api + inventory-api had origin/HEAD set
  - Stale ref prune on storage-api: 4 refs cleaned
  - **NEW**: `construct-freeside/skills/auditing-cluster-cells/` gecko-shaped audit skill (v0.8.0) — encodes the cycle's lessons (`git symbolic-ref` probe; submodule dereferencing; per-cell package manager detection); ships in PR #5 alongside v0.7.0 + v0.6.0

## Outcome

- Doctrine compliance: 3/8 audit-as-written → 5/8 audit-corrected → 8/8 post-Tier-1+Tier-2 (pending PR merges)
- Cluster default-branch homogeneity: 6/8 main + 2/8 master pre-sweep → 8/8 main post-sweep
- Gecko-shaped audit skill formalized in code, not just doctrine
- Three-frame stack (GECKO/KRANZ/Hivemind-Lab) dogfooded end-to-end in one cycle

## Open operator decisions (consolidated)

Carried forward to the operator-clarity session that ratifies ADR-008 + ADR-009. Full list in audit-report.md §Pending operator decisions. Most load-bearing:

1. **Mount-pattern policy** — operator framing 2026-05-25 PM: "I don't like submodules at all they are messy and flaky. We should consult Loa and BEAUVIOUR for FAANG principles." This reverses my prior ADR-009 D-4a recommendation. Submodule-style cells (mint-api + activities-api) become migration candidates to copy-style. Amendment pending.
2. **Loa-as-mounting-owner** — operator framing 2026-05-25 PM: "Loa skill comes from loa." The mount mechanism should be a Loa-native skill, not delegated to construct-hivemind-os. `os-mounting` reference in ADR-009 D-4 should be amended.
3. **ADR-008 + ADR-009 ratification timing** — both Proposed; operator-clarity session pending.

## References

- [audit-report.md](audit-report.md) — what the audit found
- [ADR-009 · Freeside Hexagonal Federation](../../../decisions/009-freeside-hexagonal-federation.md) — D-4 (per-cell harness doctrine), D-7 (cluster-meta cycle scope), D-12 (construct frames as policies)
- [Where Do I Work From?](../../loa/operators/where-do-i-work-from.md) — operator runbook (validated by this cycle)
- `~/vault/wiki/concepts/freeside-hexagonal-federation.md` — operator-domain doctrine (updated 2026-05-25 with audit findings)
- Template mount: `~/Documents/GitHub/score-api/.claude/` (substantive 9.2M reference)
- Agent 1 dispatch context: this plan + the agent's prompt + the cell's existing src/

---
session: 4
date: 2026-06-01
type: kickoff
status: planned
cycle: shadow-onboarding-substrate
run_id: 20260601-7aa3d2
---

# Session 4 — shadow-onboarding-substrate build (kickoff)

## Scope
- Build the medium-agnostic shadow-mode onboarding substrate + before/after comparison (5 sprints, 401–405).
- Cross-repo: worlds-api (substrate) → characters (actor) → dashboard (lens). Purupuru = test ground.
- Keystone-first: S0 ships the visualizable `Discrepancy` contract on mock; S1 the provable gate.
- Run THROUGH `code-implement-and-review` (review = /fagan), orchestrated cross-repo via `/coord`.

## Artifacts
- Build handoff: `specs/enhance-shadow-onboarding-build.md` (Run-via + load order + meta-notes)
- PRD / SDD / sprint: `cycles/shadow-onboarding-substrate/{prd,sdd,sprint}.md` (all flatline-hardened)
- Resume memory: `project_shadow-onboarding-cycle`

## Prior session
Planned + hardened + committed the full trilogy (PRD + SDD v1.2 + sprint v1.1, all 3 flatlined) on
branch `cycle/shadow-onboarding-substrate` (2 commits, not pushed). Also shipped 2 prod fixes this
session: config-service cutover (#59) + the `/auth` 502 IDENTITY_API_URL fix (both live/merged).

## Decisions made
- Shadow = universal preview/diff primitive; worlds-api owns + DISTRIBUTES the pure substrate (git-source); characters/dashboard are voiceless actors.
- `apply_mode` gate enforced substrate-side (`GateCheckedRoleWriter`); shadow ⇒ zero writes provable.
- The "after" surfaces latent non-member leads = growth intelligence (mocked MVP).
- FR-10 MVP authz floor (pulled in from deferred by flatline — go-live writes a real server).
- 2 design calls (operator-reviewable): WriteCapability = compile-time not runtime; authz TTL ≤10s + go_live re-check.
- score-api is Zerker's (flagged #164/#221) — latent data mocked.

## Next session entry
Paste the clipboard pointer. Bootstrap `/coord`, dispatch S0 (worlds pure core). Review the 2 design
calls early. `br doctor` clean before creating beads (beads DEGRADED).

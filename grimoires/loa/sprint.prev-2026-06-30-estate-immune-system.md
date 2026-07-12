# Sprint Plan — Estate Immune System · Sprint 1

> `/simstim` Phase 5 (autonomous). Implements the SDD (`sdd.md`). Tasks map to beads epic `arrakis-estate-immune-epic-4xw6`. Scoped by what's autonomously-safe vs gated. Draft PRs only (door frozen). `/run sprint-plan` requires a CLEAN working tree it can own — see the Phase-7 boundary note.

## Sprint goal
Ship the immune **doctor** layer (read-only sensors, autonomously-safe) and stage the gated fixes as draft PRs through the sanctioned cycle, while holding the operator-only mutations as blocked checkpoints.

## Tasks

| Bead | Task | Acceptance criteria | Lane |
|------|------|---------------------|------|
| .2 / G1 | gate-freeze re-freeze doctor | exit-2 on FROZEN; 13 fixture tests green; live-proven | ✅ DONE — draft PR #317 |
| .1 / M0 | meta-immune doctor: a read-only `tools/` sensor listing instruments that self-report vs re-derive from ground truth | sensor flags ≥1 known lying instrument (e.g. doctor.py's claude false-"unknown"); exit-code verdict; fixture test | draft-PR-safe (App-zone read-only) |
| .1 / M0 | the enforcing lint (CI) | a planted self-reporting instrument fails the lint (negative test) | sanctioned cycle (System-Zone) |
| .3 / G2 | invert STUB foot-gun + ≥2-family consensus + negative test | STUB fail-loud by default; `scoring.ts` dedupes by provider; a fabricated-convergence attempt fails the negative test | sanctioned cycle (System-Zone) |
| .4 / G3 | production `ResourceLedgerPort` adapter + read-only shadow-parity | adapter compiles; parity replay byte-exact vs `lot_balances`; ZERO writes | **BLOCKED** — money-path scope decision (R-2) |
| .5 / G4 | typed `@loa/sdk` read surface + no-bypass test | — | **OUT OF SCOPE** — in-flight on loa-cli branch (R-3) |
| .6 | OPERATOR: open the door (branch-protection + bypass) | — | **BLOCKED checkpoint** — operator-only |
| .7 | OPERATOR: ledger cutover swap | — | **BLOCKED checkpoint** — operator-only |

## Verification per sprint
Each shipped doctor: exit-code-as-verdict + a fixture test (no live external deps) + live-proven against the real estate. Each gated fix: a negative test that fails if the invariant regresses. Convergence metric: rotting-PR count, lying-instrument count, cursor/codex/local-PC utilization vs the 2026-06-26 baseline.

## ⚠️ Phase-7 (implementation) boundary
`/run sprint-plan` implements on the current branch's working tree. The operator's tree is dirty mid-PR (`fix/cursor-adapter-pgkill-stdin-bb966`, 292 files) — running the autonomous implementer there would pollute/risk unmerged work. **Phase 7 is held until a clean tree:** the operator launches `/run sprint-plan` (or `/simstim --from run`) from a clean branch off `origin/main` when back. The planning (Phases 1–6) is complete and committed; the gate-freeze doctor already shipped (PR #317).

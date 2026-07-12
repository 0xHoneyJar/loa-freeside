# Software Design Document — Estate Immune System

> `/simstim` Phase 3 (autonomous). Implements the PRD (`prd.md`). Full per-dimension detail: `grimoires/loa/context/goals/goal-{1,2,3,4}-*.md`. Beads epic `arrakis-estate-immune-epic-4xw6`.

## Architecture: the immune triad (doctor → aligner → teeth)

Each dimension ships three layers; the **doctor** (read-only sensor) is buildable independent of the gates, the **aligner**/**teeth** (the mutating fix) are gated. This split is load-bearing: it's what let the door's doctor (PR #317) ship while the door itself stays operator-gated.

```
ground source (git / deploy-probe / audit-chain / .run/model-invoke.jsonl)
      │  re-derive (never self-report)  ← M0 invariant
      ▼
  DOCTOR (read-only, loud, exit-code verdict, auto-files bead on regression)
      ▼
  ALIGNER (the fix — gated: System-Zone cycle / operator checkpoint)
      ▼
  TEETH (mechanical no-bypass: test / type-constraint / runtime assertion)
```

## Component designs

- **M0 — re-derive-from-ground-truth lint (FR-1).** A check over every verdict/health/goal/sensor instrument asserting it reads a ground source, not self-report. Lives App-zone (`tools/`) as the doctor; the enforcing lint is System-Zone (CI). Teeth: a planted self-reporting instrument fails the lint.
- **G-DOOR (FR-2).** Doctor = `tools/gate-freeze-sensor.mjs` (✅ shipped PR #317, pure `analyzeBacklog()` core + `gh` fetch, exit-2 on FROZEN, 13 fixture tests). Aligner = the gh-signoff/local-green protection config (operator-gated). Teeth = the sensor wired as a required CI check / banner row so a re-freeze is loud.
- **G-HONEST (FR-3).** Invert `spiral-orchestrator.sh:786` STUB default (fail-loud); `scoring.ts:137` dedupe by PROVIDER + require ≥2 distinct families for a BLOCKER; voice-attestation per council run; a planted-bug canary. Teeth = a negative test that fails if fabricated convergence can bank. System-Zone — sanctioned cycle.
- **G-GRADUATE (FR-4).** Build a production adapter implementing the existing `ResourceLedgerPort` (ledger-api) against the monolith `event-sourcing-service.ts`; read-only shadow-parity vs `lot_balances` (no writes, atomic rollback); cutover operator-gated. Teeth = the parity invariant as a gate. Money path — highest care.
- **G-REACH (FR-5).** Typed `@loa/sdk` façade (hand-written `.d.ts` + `package.json` exports) compiling DOWN to the same `loa-cli` dispatch + Ed25519 SpanMove; ~50-token discovery pointer; local exec (not isolate). Teeth = a test proving the façade can't reach a capability without a SpanMove. Coordinate with the in-flight loa-cli branch.

## Build sequencing (what's autonomously-safe vs gated)
- **Now, draft-PR-safe:** read-only doctors (gate-freeze ✅; M0 doctor next). App-zone, no collision, no false premise.
- **Sanctioned cycle (via `/run sprint-plan` on a clean tree):** M0 lint enforcement + G-HONEST System-Zone fixes — draft PRs only.
- **Operator-gated (blocked beads .6/.7):** the door's branch-protection edit; the ledger cutover swap.
- **Out of scope here:** FR-5 loa-cli code (in-flight on operator's branch).

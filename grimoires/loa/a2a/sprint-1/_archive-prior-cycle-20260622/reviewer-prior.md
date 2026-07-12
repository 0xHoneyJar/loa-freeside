# Implementation Report — Sprint 1 (global 403): The Eligibility Seam — The Noun

> Supersedes the prior Order-System sprint-1 report (preserved in git at commit `dc1e1c82`).
> **Branch**: `cycle/shadow-audit-runtime-ordering` · **Cycle**: `cycle-shadow-audit-eligibility-seam`
> **Run**: autonomous `/run sprint-1`. **Domain (ADR-007)**: `shared` only — no firewall crossing.

## Executive Summary

Authored the new shared protocol package `@freeside/eligibility-protocol`
(`packages/protocol/eligibility/`) — the FORK-sealed unified `EligibilityRule` noun
(reconciling three structurally-incompatible legacy shapes) + the `EligibilityVerdict`
(the decision output, `degraded` first-class). Shared-domain only (no platform paths → no
ADR-007 straddle). Acceptance meter green: `tsc --noEmit` exit 0, `vitest run` 13/13.

Beads: `arrakis-wpgh.1..4` + epic `arrakis-wpgh` closed.

## AC Verification

**G-1 — author the FORK-sealed unified `EligibilityRule`, retiring the 3 incompatible types via inward adapters; round-trip test green**
- Status: ✓ Met
- Evidence: `packages/protocol/eligibility/src/eligibility-rule.ts:54` (`EligibilityRuleSchema`, `.strict()`); branded `ChainIdSchema` `:24`; 4-variant `EligibilityRuleType` `:30`; discriminated `EligibilityThreshold` `:43`. Round-trip meter for all 3 legacy shapes: `src/__tests__/eligibility-protocol.test.ts` — coexistence (string chainId + bigint amount), chain (branded + string), worker (numeric chainId + minBalance). Each asserts no loss on `chainId` and `threshold`.

**G-1 acceptance — round-trip test green (proposal's meter)**
- Status: ✓ Met
- Evidence: `vitest run` → `Tests 13 passed (13)` (`VITEST_EXIT=0`).

**G-4 — replay-safe; threshold=string (FORK-2); AccessDecisionRecord stays `.strict()` bands-only**
- Status: ✓ Met (our half) / ⏸ not-in-scope (AccessDecisionRecord half)
- Evidence: replay losslessness, smuggled bigint amount rejected, numeric (non-string) amount rejected, FORK-1 non-integer/zero/negative/string chainId rejected — all in `src/__tests__/eligibility-protocol.test.ts` "replay safety (G-4)". The `AccessDecisionRecord` bands-only invariant is owned by shadow-audit's existing suite and was deliberately **untouched** (G-3 boundary).

**G-5 (foundation) — `degraded` is a first-class verdict outcome**
- Status: ✓ Met (the noun; the live score-checker degrade behavior is sprint 405)
- Evidence: `src/eligibility-verdict.ts:42` (`degraded` member of the discriminated union, requires `reason`+`code`). Full G-5 (the live checker emitting `degraded` for `activity_check`/`token_balance`) is sprint 405 per plan.

**G-3 — ordering ACL: never import shadow-audit**
- Status: ✓ Met (not regressed; this package independently honors the boundary)
- Evidence: `@freeside/eligibility-protocol` imports only `zod` (`grep -rn "shadow-audit" packages/protocol/eligibility/src` → only doc-comment mentions, 0 imports). This sprint added no consumer, so `ordering-protocol.test.ts:99` is unaffected; the ACL gate is exercised when the gate consumer lands (sprint 4).

## Tasks Completed

| Task | File(s) | Approach |
|------|---------|----------|
| 403.1 scaffold | `packages/protocol/eligibility/{package.json,tsconfig.json,src/index.ts}` | Mirrored `@freeside/ordering-protocol` exactly (ESM, `src/index.ts` entry, vitest, AGPL-3.0, zod peer). `pnpm install --prefer-offline` (deps resolved from store, 0 downloaded). |
| 403.2 rule | `src/eligibility-rule.ts` | Branded `ChainIdSchema` (FORK-1); 4-variant `EligibilityRuleType`; discriminated-union `EligibilityThreshold` with string `minAmount` (FORK-2); outer + member `.strict()`. |
| 403.3 verdict | `src/eligibility-verdict.ts` | `EligibilitySource` aligned to live `ArrakisEligibilityResult.source` (`native｜score_service｜native_degraded`); `EligibilityVerdict` discriminated on `status`, non-eligible members structurally require `reason`+`code`. |
| 403.4 tests | `src/__tests__/eligibility-protocol.test.ts` | 13 tests: canonical validate, 3-shape round-trip meter, replay + bigint/numeric/chainId rejection, `.strict()` extra-key rejection, refuse-without-reason rejection. |

## Technical Highlights

- **Reconciliation grounded in the 3 real shapes**: coexistence (`chainId: string`, `minAmount: bigint`), chain (`chainId: ChainId` branded, `parameters` bag, 4 ruleTypes), worker (`chainId: number`, `minBalance: string`, no ruleType) — confirmed at source before mapping.
- **Separate `EligibilityVerdict` noun** keeps "who may order" distinct from shadow-audit's `AccessDecisionRecord` ("who passes the audit rule") — the PRD §7 false-shared-kernel hedge, realized structurally.
- **Refuse-not-approximate is structural**: a non-eligible verdict cannot parse without `reason`+`code` (discriminated union), so a refusal can never be emitted without a stated cause (NFR-1).

## Testing Summary

- File: `packages/protocol/eligibility/src/__tests__/eligibility-protocol.test.ts` (13 tests).
- Run: `cd packages/protocol/eligibility && pnpm test` and `pnpm typecheck`.
- Result: `Tests 13 passed (13)`, `TSC_EXIT=0`, `VITEST_EXIT=0`.

## Known Limitations

- Round-trip adapters in the test are **local fixtures**, not the real `toProtocolRule()` for the 3 sites — those land in sprints 404 (coexistence+worker) / 405 (chain). This sprint proves the unified noun *can* hold all three losslessly; wiring the real sites is downstream by design.
- Full G-5 (the live score-checker emitting `degraded`) is sprint 405; this sprint delivers only the `degraded` verdict shape.
- The package is not yet consumed anywhere (the gate is sprint 4) — so the ordering ACL test is unexercised by this change.

## Verification Steps (for reviewer)

1. `cd packages/protocol/eligibility && pnpm install --prefer-offline`
2. `pnpm typecheck` → exit 0
3. `pnpm test` → 13 passed
4. `grep -rn "shadow-audit" packages/protocol/eligibility/src` → only doc-comment mentions (no imports)
5. Confirm all changed paths are under `packages/protocol/eligibility/` (shared domain — no straddle)

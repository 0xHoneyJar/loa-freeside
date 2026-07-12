# Implementation Report — sprint-bug-419

**Bug**: 20260712-486383 — shadow-audit presents a confidently-wrong audit when a role snapshot is mostly unmatched
**Bead**: arrakis-qlh6e (P0, `domain:shared`)
**Blocks**: EXPORT-1 live POST (freeside-characters#191)

---

## Executive Summary

The audit was **most confident exactly when the role data was least trustworthy**. `resolveMode` derived
`uncertain` from freshness alone, so a FRESH snapshot in which only 1 of 515 role-holders resolved to a
wallet produced a clean, deterministic, confident aggregate — computed over `roleWallets.size === 1`.

The fix makes role coverage a first-class input to confidence:

- **Below a documented floor (50%) the audit REFUSES** (`role-coverage-too-low`, 422) — mirroring this
  codebase's existing meaningful-or-refuse doctrine (`access-risk.ts` refuses `cohort-too-small` rather
  than serve a vacuous number). At 1/515 the aggregate is not uncertain, it is *meaningless*.
- **Between the floor and 90% it is served but LABELLED** (`coverage_uncertain`), with the unmatched
  count on the wire so a reader can bound the error.
- **The refusal NAMES what we cannot see** ("only 1 of 515 role-holders could be resolved…") rather than
  dressing the blind spot up as a number.

Verified against the **real 515-entry THJ export**, not a fixture.

## AC Verification

> **AC**: "A fresh-but-mostly-unmatched snapshot can no longer produce a confident aggregate"
**✓ Met** — `mode-resolver.ts:82-97` refuses below `ROLE_COVERAGE_FLOOR`; `mode-resolver.ts:99-103` ORs
`low-role-coverage` into uncertainty above it. Proven on the real snapshot (see Live Probe below) and by
`__tests__/mode-and-role.test.ts:98` (`REFUSES a fresh snapshot below the coverage floor — the real 1/515
THJ case`) + `__tests__/audit-service.test.ts:216` (`REFUSES the real 1/515 THJ snapshot…`).

> **AC**: "The unmatched count / coverage ratio is present in the audit output (JSON + HTML), not just the internal return value"
**✓ Met** — `audit-output.ts:44-70` adds `unmatched_role_holders`, `role_coverage`, `coverage_uncertain`
to `AuditAggregateSchema` (the only channel reaching JSON consumers). Populated at
`audit-service.ts:166-178`. JSON asserted at `__tests__/audit-router.test.ts:285` (GET /v1/audit);
HTML at `audit-router.ts:551-566` + asserted at `__tests__/audit-router.test.ts:303`.

> **AC**: "k-anon is not weakened: no exact-total + exact-ratio + suppressed-cohort combination that back-computes a suppressed numerator"
**✓ Met** — `audit-service.ts:169-170`: `role_coverage` is published **only** when the unmatched cohort is
exact (≥ k) or empty (zero identifies nobody); otherwise `null`. Same rule as `access-risk.ts`'s
`holder_turnover` ("rounding is not suppression"). Asserted by `__tests__/audit-service.test.ts:246`
(`SUPPRESSES the coverage ratio when the unmatched cohort is k-anon-suppressed`).

> **AC**: "`freeside-dashboard` strict decode still accepts the anon `GET /v1/audit` response"
**✓ Met** — mirrored in `freeside-dashboard/src/lib/freeside-worlds/access-audit/types.ts:35-56`
(Effect Schema, `onExcessProperty: "error"`). Dashboard suite green: 23 pass / 0 fail
(`bun test tests/unit/access-audit`). **Separate repo ⇒ separate PR (mandatory, not optional).**

> **AC**: "Live probe recorded against the real 1/515 snapshot"
**✓ Met** — see Live Probe. Run against the **real** 515-entry export from the live THJ guild.

> **AC**: "A healthy-coverage community still returns a normal confident aggregate (no false-positive uncertainty)"
**✓ Met** — `__tests__/audit-service.test.ts:257` (`still serves a CONFIDENT aggregate at full coverage`)
and `__tests__/mode-and-role.test.ts:152` (95% coverage ⇒ `uncertain: false`).

> **AC**: "No regressions"
**✓ Met** — shadow-audit 218/218, shadow-audit-protocol 48/48, dashboard access-audit 23/23.
⚠ ordering-service: 20 pass / **2 pre-existing failures** (`intake.test.ts`, `projection.test.ts` —
`metadata_snapshot` / ingredient counts). **Verified pre-existing**: both fail identically on a clean
`HEAD` worktree with none of my changes applied. Unrelated to shadow-audit; not fixed (out of scope).

## Live Probe (the settle gate)

Fakes cannot settle this — the sibling bug on this same service passed 199 green fake-based tests and
broke on the first real call. Probe input: the **actual** snapshot exported from the live THJ guild
(`community=thj, entries=515, matched=1, unmatched=514`), with the holder set sized to the real
Honeycomb collection (1813).

**Before (today's deployed behavior — guard disabled to reproduce):**
```json
"newly_eligible":      { "kind": "exact", "value": 1813 },   ← the ENTIRE holder set
"stale_access":        { "kind": "bucketed", "bucket": "<5" },
"stale_access_risk_band": "high",                            ← denominator of 1
"coverage_uncertain":  false
uncertain=false reasons=[]                                   ← CONFIDENT
```
Every one of the 1813 Honeycomb holders is reported as "has tokens but no role" — because we cannot
*see* their role. Contract-valid, deterministic, and wrong.

**After:**
```
=> REFUSED (role-coverage-too-low, retryable=false)
   only 1 of 515 role-holders could be resolved to a wallet (0% coverage; the floor is 50%).
   Every cohort would be computed over a matched set that the unmatched set dwarfs, so the audit
   would be confidently wrong. Link the missing members — or import them from your incumbent —
   and re-export.
```

⚠ **Not yet probed against the deployed Railway service** — the fix is not deployed. The refusal is
decided from the snapshot alone (before any chain call), so this probes the decisive real input; but
closing the gate *in prod* needs a deploy, which is operator-gated.

## Tasks Completed

| File | Change |
|---|---|
| `packages/services/shadow-audit/src/metrics.ts` | `roleCoverage(matched,total)` + documented `ROLE_COVERAGE_FLOOR` (0.5) / `ROLE_COVERAGE_CONFIDENT` (0.9), in the same "bands, not scores" style as `staleRiskBand` |
| `packages/services/shadow-audit/src/mode-resolver.ts` | Owns uncertainty: refuses below the floor; `uncertainReasons: ('stale-snapshot'\|'low-role-coverage')[]` names WHY |
| `packages/protocol/shadow-audit/src/schemas/refusal.ts` | `role-coverage-too-low` code + 422 status |
| `packages/protocol/shadow-audit/src/schemas/audit-output.ts` | Additive: `unmatched_role_holders`, `role_coverage` (nullable), `coverage_uncertain` |
| `packages/protocol/shadow-audit/fixtures/audit-output.valid.json` | Golden fixture updated |
| `packages/services/shadow-audit/src/audit-service.ts` | Populates the coverage fields under the k-anon rule; threads `uncertainReasons` |
| `packages/services/shadow-audit/src/http/audit-router.ts` | HTML names the blind spot instead of mislabelling a fresh-but-unseeable snapshot as "stale" |
| `packages/services/ordering/{bin/demo.ts,src/__tests__/*}` | Fakes updated for the widened `AuditServiceResult` (expected blast radius) |
| `freeside-dashboard/.../access-audit/{types.ts,mock-audit.ts}` + 2 tests | **Separate PR** — strict-decode mirror |

## Technical Highlights

- **Mutation-tested**: zeroing both thresholds fails 7 of the new tests (incl. the 1/515 refusal), so the
  tests bind to the behavior rather than merely passing next to it.
- **`newly_eligible` contamination** is handled by the *refusal*, not by a second denominator: below the
  floor it never ships; above it, the unmatched count is published so the reader can bound the error.
  (Per operator decision — no second denominator.)
- **`uncertain` was a no-op channel**: it never reached JSON (it had been *removed* from the top level
  because it broke the dashboard's strict decode). The signal now travels in the aggregate — the one
  channel every JSON consumer reads.

## Known Limitations

1. **Not deployed.** The live settle against `shadow-audit-api-production` requires a Railway deploy
   (operator-gated). Until then prod still serves the old behavior.
2. **The dashboard PR is mandatory** and must merge before `SHADOW_AUDIT_API_URL` is pointed at the live
   API. The seam is currently dormant (env unset), so the two can land independently without a prod break.
3. **Thresholds (50% / 90%) are a judgment call**, documented in `metrics.ts`. They are the kind of number
   that should move once we see a second community's real coverage.
4. **The real cure is upstream**: thj's members were never linked in identity-api (bead `arrakis-9c68c` —
   source-agnostic identity ingestion). This fix makes the blind spot *honest*, it does not make it *smaller*.

## Verification Steps (for the reviewer)

```bash
# service (218) + protocol (48)
pnpm --filter @freeside/shadow-audit-service test
pnpm --filter @freeside/shadow-audit-protocol test
cd packages/services/shadow-audit && npx tsc --noEmit

# dashboard mirror (23) — separate repo, bun not vitest
cd ~/Documents/GitHub/freeside-dashboard && bun test tests/unit/access-audit

# the teeth: zero the thresholds in metrics.ts → 7 tests must fail
```

**Note for anyone re-running this**: `@freeside/shadow-audit-protocol` is a pnpm `file:` dep — it is
**COPIED** into the store at install time. After editing the protocol package you MUST `pnpm install`
(or `--force` in a consumer) or the consumer keeps typechecking against the stale copy. This cost a
debug loop: the first test run failed with `unrecognized_keys` on the very fields I had just added.

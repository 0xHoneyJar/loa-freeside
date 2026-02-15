# Vendored Protocol Types — loa-hounfour

## Source

**Repository:** `0xHoneyJar/loa-hounfour` (private)
**Pinned Commit:** `pending` (loa-hounfour PRs #1 and #2 not yet merged)
**Protocol Version:** 4.6.0
**Vendored Date:** 2026-02-15

## Why Vendored?

loa-hounfour is not yet published as an npm package (PRs #1 and #2 are still open).
To unblock cross-system integration between arrakis and loa-finn, we vendor a
snapshot of the shared types directly into the arrakis codebase.

## Upgrade Instructions

When loa-hounfour is published to npm:

1. Install the package: `npm install @honeyjar/loa-hounfour`
2. Replace imports from `../../protocol/` with `@honeyjar/loa-hounfour`
3. Delete this `protocol/` directory
4. Run all tests to verify compatibility

## Files

| File | Purpose |
|------|---------|
| `billing-types.ts` | AgentBillingConfig, CreditBalance, UsageRecord |
| `guard-types.ts` | GuardResult, BillingGuardResponse |
| `state-machines.ts` | STATE_MACHINES (reservation, revenue_rule, payment) |
| `arithmetic.ts` | BigInt micro-USD helpers, BPS arithmetic |
| `compatibility.ts` | validateCompatibility() for cross-service version check |
| `index.ts` | Re-export barrel |

## Compatibility

Protocol version follows semver:
- **MAJOR** bump = breaking wire format change (both systems must upgrade)
- **MINOR** bump = additive change (backward compatible)
- **PATCH** bump = bug fix, no contract change

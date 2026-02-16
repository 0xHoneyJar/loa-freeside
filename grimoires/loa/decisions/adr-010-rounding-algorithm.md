# ADR-010: Largest-Remainder Rounding Algorithm

**Status:** Accepted
**Date:** 2026-02-16
**Decision Makers:** Engineering Team

## Context

Revenue distribution splits a charge into up to 5 shares using basis points (BPS). Integer division truncates, creating a remainder that must be deterministically assigned to avoid sum conservation violations.

## Decision

Use **largest-remainder (Hamilton quota)** method where the foundation share absorbs all rounding residue:

```
foundation_share = total_charge - sum(all_other_shares)
```

Code: `RevenueDistributionService.ts:200-230`, `ScoreRewardsService.ts:150-180`

## Alternatives Considered

| Method | Pros | Cons | Verdict |
|--------|------|------|---------|
| **Largest-remainder (Hamilton, 1855)** | Conserves sum exactly, deterministic, simple | Foundation absorbs all dust | **Chosen** |
| D'Hondt (Jefferson) | Used in EU parliament | Favors large accounts, complex | Rejected |
| Sainte-Lague (Webster) | More proportional than D'Hondt | Over-corrects for small accounts | Rejected |
| Round-half-up | Simple | Does NOT conserve sum (rounding errors accumulate) | Rejected |
| Banker's rounding | Reduces bias | Still doesn't guarantee sum conservation | Rejected |

## Conservation Invariant

For every distribution:
```
assert(referrer + commons + community + treasury + foundation === totalCharge)
```

This invariant is enforced at runtime in both `RevenueDistributionService` and `ScoreRewardsService`. A property-based test validates it holds for all valid BPS configurations (see `billing-revenue-rules.test.ts`).

## Consequences

- Foundation share is slightly larger than its BPS proportion (by at most 4 micro-USD per distribution)
- All other shares receive exactly their floor(BPS) amount
- Sum is always exactly conserved — no dust accumulation
- Deterministic: same inputs always produce same outputs regardless of evaluation order

## References

- Hamilton quota (1855) — proportional representation
- BigInt integer division in JavaScript guarantees floor behavior
- `bpsShare()` utility in `protocol/arithmetic.ts`

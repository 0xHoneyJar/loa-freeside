# ADR-011: 48-Hour Settlement Hold Duration

**Status:** Accepted
**Date:** 2026-02-16
**Decision Makers:** Engineering Team

## Context

Referrer earnings must be held for a period before settlement to allow for fraud detection, payment reversals, and crypto transaction finality. The hold duration directly impacts creator experience (longer = worse UX) and platform risk (shorter = more fraud exposure).

## Decision

**48-hour settlement hold** from earning creation to settlement eligibility.

Pre-computed at insertion time: `settle_after = created_at + 48 hours` (see ADR-013 for timestamp format).

Code: `SettlementService.ts`, `RevenueDistributionService.ts:recordReferrerEarning()`

## Alternatives Considered

| Duration | Pros | Cons | Verdict |
|----------|------|------|---------|
| **24 hours** | Better creator UX | Too short for BTC deep reorgs (6 confirmations at ~10min each = 60min, but reorgs can take hours). Insufficient for fraud pattern detection | Rejected |
| **48 hours** | Covers all crypto finality windows with margin. Sufficient for fraud scoring. Acceptable UX | Slightly slower than competitors | **Chosen** |
| **72 hours** | Maximum safety margin | Unnecessarily delays creator access. Poor UX for legitimate creators | Rejected |
| **Configurable** | Flexible | Over-engineering for current scale. Can be added later | Deferred |

## Crypto Finality Analysis

| Chain | Finality Time | 48h Coverage |
|-------|---------------|--------------|
| BTC | ~60 min (6 confirmations) | 48x margin |
| ETH L1 | ~13 min (finalized epoch) | 220x margin |
| ETH L2 (Optimism/Arbitrum) | 7 days (challenge period) for L1 finality, instant for L2 | Partial (L2 adequate) |
| Berachain | ~2 sec (PoL finality) | 86400x margin |

## Risk Analysis

- **Chargeback window**: Crypto payments are irreversible after finality. No traditional chargeback risk
- **Fraud detection**: 48h gives the `FraudCheckService` time to score registrations and flag suspicious activity
- **Clawback protection**: Once settled, earnings are immutable. The 48h window is the only clawback opportunity
- **Clock skew**: Now mitigated by pre-computing `settle_after` at insertion (BB-67-003)

## Consequences

- Creators must wait 48h before earnings become available for withdrawal
- Platform has a guaranteed window for fraud detection and reversal
- Settlement batch processing uses deterministic `settle_after` timestamp, not wall-clock

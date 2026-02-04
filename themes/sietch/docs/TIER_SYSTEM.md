# Sietch Tier System

**Last verified**: 2026-02-04
**Source**: `themes/sietch/src/services/TierService.ts`

This document explains the 9-tier membership system used in Sietch communities.

---

## Overview

Sietch uses a **hybrid tier system** that combines:
- **Rank-based tiers** (top positions) - Naib and Fedaykin
- **BGT-based tiers** (token holdings) - Usul through Hajra

Rank-based tiers take precedence: if you're in the top 69 holders, you get Naib or Fedaykin regardless of your actual BGT amount.

---

## Tier Hierarchy

Listed from highest to lowest:

| Tier | Requirement | Color | Hex | Description |
|------|-------------|-------|-----|-------------|
| **Naib** | Rank 1-7 | Gold | `#FFD700` | Tribal leaders of the sietch |
| **Fedaykin** | Rank 8-69 | Blue | `#4169E1` | Elite warriors, death commandos |
| **Usul** | 1,111+ BGT | Purple | `#9B59B6` | Base of the pillar - innermost identity |
| **Sayyadina** | 888+ BGT | Indigo | `#6610F2` | Fremen priestess rank - spiritual guide |
| **Mushtamal** | 690+ BGT | Teal | `#20C997` | Inner garden of the sietch |
| **Sihaya** | 420+ BGT | Green | `#28A745` | Desert spring - precious, life-giving |
| **Qanat** | 222+ BGT | Cyan | `#17A2B8` | Underground water channels |
| **Ichwan** | 69+ BGT | Orange | `#FD7E14` | Brotherhood - first acceptance |
| **Hajra** | 6.9+ BGT | Sand | `#C2B280` | Journey of seeking - on the path |

### BGT Thresholds (Exact Values)

<!-- Source: TierService.ts:25-35 -->

| Tier | Threshold (BGT) | Threshold (wei) |
|------|-----------------|-----------------|
| Hajra | 6.9 | 6,900,000,000,000,000,000 |
| Ichwan | 69 | 69,000,000,000,000,000,000 |
| Qanat | 222 | 222,000,000,000,000,000,000 |
| Sihaya | 420 | 420,000,000,000,000,000,000 |
| Mushtamal | 690 | 690,000,000,000,000,000,000 |
| Sayyadina | 888 | 888,000,000,000,000,000,000 |
| Usul | 1,111 | 1,111,000,000,000,000,000,000 |

---

## Rank Precedence Rules

### How Rank-Based Assignment Works

1. **Top 7 holders** by unredeemed BGT balance = **Naib** (always)
2. **Top 8-69 holders** by unredeemed BGT balance = **Fedaykin** (always)
3. **Position 70+** = assigned based on BGT threshold

### Example Scenarios

| Holder | BGT Balance | Rank | Assigned Tier | Why |
|--------|-------------|------|---------------|-----|
| Alice | 50,000 BGT | #3 | Naib | Rank 1-7 = Naib |
| Bob | 10,000 BGT | #25 | Fedaykin | Rank 8-69 = Fedaykin |
| Carol | 2,000 BGT | #70 | Usul | Rank 70+, 2000 > 1111 threshold |
| Dave | 500 BGT | #150 | Sihaya | Rank 70+, 500 > 420 threshold |
| Eve | 5 BGT | #500 | None | Below 6.9 BGT minimum |

---

## Eligibility Calculation

### Formula

```
Unredeemed BGT = Total BGT Claimed - Total BGT Burned
```

- **Claimed**: BGT received from Berachain reward vaults
- **Burned**: BGT redeemed/converted to BERA (transfers to `0x0` address)

### Data Sources

- BGT balance: `balanceOf(wallet)` on BGT contract
- Burn detection: Transfer events to `0x0000...0000`
- Contract: `0x656b95E550C07a9ffe548bd4085c72418Ceb1dba` (Berachain mainnet)

---

## Refresh & Revocation

### Refresh Cadence

| Event | Frequency |
|-------|-----------|
| Scheduled sync | Every 6 hours |
| On verification | Immediate |
| Manual trigger | Admin can force refresh |

The #census leaderboard shows the last update timestamp.

### Role Assignment Timing

- **New verification**: Role assigned immediately after wallet signature
- **Tier upgrade**: Applied on next scheduled sync (up to 6 hours)
- **Tier downgrade**: Applied on next scheduled sync with grace period

### Grace Period

When your eligibility drops below your current tier:

1. **24-hour grace period** begins (configurable via `GRACE_PERIOD_HOURS`)
2. You keep your current role during grace period
3. After grace period, role is removed on next sync
4. DM notification sent when tier changes

### Notification Behavior

| Event | Notification |
|-------|--------------|
| Tier upgrade | DM: "Congratulations! You've been promoted to {tier}" |
| Tier downgrade | DM: "Your tier has changed from {old} to {new}" |
| Role removal | DM: "You no longer meet the requirements for {tier}" |
| Grace period start | DM: "Warning: You have 24 hours before losing {tier}" |

---

## Channel Access Matrix

Which channels each tier can access:

| Channel | Hajra | Ichwan | Qanat | Sihaya | Mushtamal | Sayyadina | Usul | Fedaykin | Naib |
|---------|-------|--------|-------|--------|-----------|-----------|------|----------|------|
| #water-discipline | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| #census | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| #the-door | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| #general | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| #spice | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| #inner-depths | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| #inner-sanctum | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ |
| #council-rock | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |

**Note**: Actual channel access depends on your server's permission configuration.

---

## Special Roles

In addition to tier roles, these special roles may be assigned:

| Role | Criteria | Color |
|------|----------|-------|
| @Former Naib | Previously held Naib, was bumped | Silver `#C0C0C0` |
| @Taqwa | Registered on waitlist | Sand `#C2B280` |
| @Water Sharer | Holds Water Sharer badge | Aqua `#00D4FF` |
| @Engaged | Earned 5+ badges | Green `#28A745` |
| @Veteran | 90+ days tenure | Purple `#9B59B6` |

---

## FAQ

### How do I check my current tier?

Use the `/position` command to see your current rank, BGT balance, and tier.

### Why did my tier change?

Possible reasons:
1. Your BGT balance changed (claimed more, or burned some)
2. Others claimed/burned BGT, changing rankings
3. Data refresh picked up recent transactions

### How long until I get my new tier?

- After verification: Immediate
- After BGT change: Up to 6 hours (next sync)

### Can I have multiple tiers?

No. You have exactly one tier at a time. Rank-based tiers override BGT-based tiers.

### What if I'm exactly at the threshold?

You qualify for the tier. Example: 69.0 BGT qualifies for Ichwan (threshold is 69).

### Does staking BGT count?

Only liquid BGT in your wallet counts. Staked or locked BGT may not be detected.

### Why is there a grace period?

The 24-hour grace period prevents losing access due to temporary price/balance fluctuations and gives you time to react.

---

## Technical Reference

- **Tier calculation**: `TierService.calculateTier(bgtBalance, rank)`
- **Threshold constants**: `TierService.TIER_THRESHOLDS`
- **Tier order**: `TierService.TIER_ORDER`
- **Source file**: `themes/sietch/src/services/TierService.ts`

# Arrakis Verification Tiers Guide

This guide explains the different verification tiers available during coexistence mode and what features each tier unlocks.

## Overview

When your community uses Arrakis alongside an existing token-gating bot, you'll encounter three verification tiers:

| Tier | Description | Available Features |
|------|-------------|-------------------|
| **Incumbent Only** | Verified via original bot only | Basic channel access |
| **Arrakis Basic** | Verified via Arrakis (shadow/parallel) | Basic features + conviction ranking |
| **Arrakis Full** | Full Arrakis verification (primary/exclusive) | All social features |

## Tier Details

### Incumbent Only

**What it means**: You've been verified by the community's original token-gating bot (e.g., Collab.Land, Guild.xyz).

**Features available:**
- Basic channel access as configured by the incumbent bot
- Standard Discord roles

**To upgrade**: Connect your wallet through Arrakis verification when available.

### Arrakis Basic

**What it means**: You've connected your wallet and verified through Arrakis while the community is in shadow or parallel mode.

**Features available:**
- All incumbent features
- Conviction score tracking
- Conviction ranking visibility
- Directory search (find other members)
- Activity leaderboard visibility
- Badge showcase (display earned badges)

**Requirements:**
- Wallet connected via Arrakis
- Token holdings verified
- Community in parallel mode or higher

### Arrakis Full

**What it means**: You've achieved full verification status in a community using Arrakis as primary or exclusive.

**Features available:**
- All Basic features
- Full profile customization
- Profile visibility in community directory
- Badge claiming (claim new badges)
- Conviction history tracking
- Water sharing (give/receive water)
- Activity tracking
- Directory listing (appear in searches)

**Requirements:**
- Wallet connected via Arrakis
- Token holdings verified
- Community in primary or exclusive mode

## Feature Breakdown

### Profile Features

| Feature | Incumbent Only | Arrakis Basic | Arrakis Full |
|---------|----------------|---------------|--------------|
| Basic profile | - | - | X |
| Full profile visibility | - | - | X |
| Profile customization | - | - | X |
| Directory listing | - | - | X |

### Badge Features

| Feature | Incumbent Only | Arrakis Basic | Arrakis Full |
|---------|----------------|---------------|--------------|
| View badges | - | X | X |
| Badge showcase | - | X | X |
| Claim new badges | - | - | X |

### Social Features

| Feature | Incumbent Only | Arrakis Basic | Arrakis Full |
|---------|----------------|---------------|--------------|
| Conviction ranking | - | X | X |
| Directory search | - | X | X |
| Activity leaderboard | - | X | X |
| Conviction history | - | - | X |
| Water sharing | - | - | X |
| Activity tracking | - | - | X |

## How to Upgrade Your Tier

### From Incumbent Only to Arrakis Basic

1. Wait for your community to enter parallel mode
2. Look for the `/arrakis verify` command
3. Connect your wallet
4. Complete token verification
5. Your tier upgrades automatically

### From Arrakis Basic to Arrakis Full

Your tier upgrades automatically when:
- Your community transitions to primary mode, OR
- Your community completes takeover (exclusive mode)

No action required on your part!

## Tier Progression Timeline

```
Community Mode Timeline:

SHADOW ────> PARALLEL ────> PRIMARY ────> EXCLUSIVE
   |             |             |              |
   |         Arrakis        Arrakis         Arrakis
   |          Basic          Full            Full
   |             |             |              |
   v             v             v              v
Incumbent    Both tiers    All Full      All Full
  Only       available    features      features
```

## FAQ

### Why can't I access social features?

**Check these:**
1. Have you verified through Arrakis? Look for `/arrakis verify`
2. Is your community in parallel mode or higher? Ask your admin
3. Is your wallet properly connected? Try `/arrakis profile`

### When will I get Arrakis Full?

Arrakis Full is available when your community reaches primary or exclusive mode. This timing is controlled by your community admins based on:
- Shadow mode accuracy (95%+ required)
- Days in shadow mode (14+ required)
- Admin decision to proceed

### Will I lose access if there's a rollback?

During rollback:
- Your incumbent verification remains unchanged
- Arrakis features may temporarily reduce to Basic
- No token holdings are affected
- The system recovers automatically

### What happens after takeover?

After your community completes takeover:
- All members become Arrakis Full tier
- The incumbent bot is disabled
- All social features are unlocked
- Roles may be renamed (prefixes removed)

### Can I be in multiple tiers?

No. You have one tier per community based on:
1. Whether you've verified through Arrakis
2. Your community's current coexistence mode

## Getting Help

If you have questions about your tier:
- Use `/arrakis help` in Discord
- Contact your community admins
- Visit our support Discord

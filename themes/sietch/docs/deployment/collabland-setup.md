# Wallet Verification Setup Guide

> **Migrated**: This guide replaces the previous Collab.Land integration.
> Sietch now uses in-house EIP-191 wallet verification via the `/verify` slash command.
> No third-party subscription required.

## Overview

Sietch uses its own wallet verification system built on EIP-191 message signing. Users verify wallet ownership through a `/verify start` command in Discord, which generates a unique signing link.

## Prerequisites

1. Sietch Discord bot deployed and online
2. Discord server with tier roles created (Naib, Fedaykin)
3. Sietch API accessible at production URL
4. Wallet verification environment variables configured

## Step 1: Environment Configuration

Add to your `.env.local`:

```bash
# Wallet Verification (EIP-191) — replaces third-party token gating
WALLET_VERIFICATION_ENABLED=true
VERIFY_SESSION_EXPIRY_MINUTES=15
VERIFY_BASE_URL=https://your-domain.com/verify
```

See `.env.example` lines 345-360 for full configuration options.

## Step 2: Verification Channel Setup

1. Create a `#water-discipline` channel (or use existing)
2. Set permissions:
   - `@everyone`: View Channel, Send Messages
   - `@Sietch Bot`: Send Messages, Embed Links
3. Post a welcome message directing users to use `/verify start`

## Step 3: Role Hierarchy

Configure Discord role hierarchy (top to bottom):

```
@Admin (server admins)
@Sietch Bot
@Naib (top 7 BGT holders)
@Fedaykin (ranks 8-69)
@Trusted (10+ badges OR Helper badge — auto-assigned)
@Veteran (90+ days tenure — auto-assigned)
@Engaged (5+ badges OR 200+ activity — auto-assigned)
@Onboarded (completed onboarding — auto-assigned)
@everyone
```

**Important**: Sietch bot role must be positioned ABOVE all roles it manages.

## Step 4: Test Verification Flow

### Test Case 1: Eligible Naib Wallet

1. In Discord, run `/verify start`
2. Bot responds with a unique verification link
3. Click link, connect wallet, sign EIP-191 message
4. Return to Discord — Naib role should be assigned

### Test Case 2: Eligible Fedaykin Wallet

1. Use a wallet ranked 8-69
2. Run `/verify start` and complete signing
3. Expected: Fedaykin role assigned

### Test Case 3: Ineligible Wallet

1. Use a wallet not in top 69
2. Run `/verify start` and complete signing
3. Expected: No roles assigned, clear feedback message

### Test Case 4: Expired Session

1. Run `/verify start`
2. Wait >15 minutes without completing
3. Expected: Session expires, user prompted to try again

## Verification Session States

| State | Meaning |
|-------|---------|
| `pending` | Session created, user hasn't clicked link |
| `awaiting_signature` | Link clicked, waiting for wallet signature |
| `verified` | Signature valid, role assigned |
| `expired` | Session timed out (15 minutes default) |
| `failed` | Signature rejected or wallet ineligible |

## Troubleshooting

### Verification Not Working

1. Check bot is online: `curl https://your-domain.com/health`
2. Verify `WALLET_VERIFICATION_ENABLED=true` in env
3. Check bot has Manage Roles permission
4. Verify bot role is above managed roles in hierarchy

### Roles Not Updating

1. Check eligibility sync is running (trigger.dev task)
2. Verify API returns correct eligibility for wallet address
3. Check Discord role permissions (bot role above assigned roles)

### Session Expired Errors

- Default timeout is 15 minutes (configurable via `VERIFY_SESSION_EXPIRY_MINUTES`)
- User should run `/verify start` again
- Check server time is correct (NTP sync)

## Channel Access Configuration

| Channel | Required Role | Purpose |
|---------|--------------|---------|
| #water-discipline | @everyone | Verification channel |
| #the-door | @everyone | Announcements |
| #sietch-lounge | @Onboarded | Main chat |
| #introductions | @Onboarded | New member intros |
| #deep-desert | @Engaged | Active members |
| #stillsuit-lounge | @Veteran | Long-term members |
| #council-rock | @Naib | Top 7 BGT holders |

## Support

- **Discord**: Join our support server
- **Issues**: https://github.com/0xHoneyJar/arrakis/issues

# Collab.Land Integration Research

**Date**: December 17, 2025
**Sprint**: Sprint 2
**Task**: S2-T6

---

## Executive Summary

After researching Collab.Land's capabilities, we have identified two viable integration approaches for Sietch's token-gating requirements. The **recommended approach** is to use Collab.Land's Custom API Token Gate feature (available on premium tiers) to integrate with our existing `/eligibility` API endpoint.

---

## Collab.Land Overview

[Collab.Land](https://www.collab.land/) is a token-gating bot for Discord and Telegram communities. It allows communities to restrict access based on token ownership.

### Features Relevant to Sietch

1. **Token Gating**: Restrict channel/server access based on token holdings
2. **Role Assignment**: Automatically assign roles based on token criteria
3. **Wallet Verification**: Links Discord accounts to wallet addresses
4. **Custom API Token Gates**: Query external APIs for eligibility (premium feature)

---

## Integration Approaches

### Option A: Custom API Token Gate (Recommended)

**Description**: Collab.Land queries our `/eligibility/:address` endpoint to verify membership.

**Requirements**:
- Collab.Land Premium or Enterprise subscription
- API endpoint returning eligibility status per address
- Collab.Land "Custom API" token gate type

**How It Works**:
1. User connects wallet via Collab.Land verification
2. Collab.Land calls `GET /eligibility/{walletAddress}`
3. Our API returns `{ eligible: true/false, role: "naib"|"fedaykin"|"none" }`
4. Collab.Land assigns roles based on response

**API Response Format** (from our `/eligibility/:address` endpoint):
```json
{
  "address": "0x1234...abcd",
  "eligible": true,
  "rank": 5,
  "role": "naib",
  "bgt_held": 1234567.89
}
```

**Collab.Land Role Mapping**:
- `eligible: true` + `role: "naib"` → Assign "Naib" Discord role
- `eligible: true` + `role: "fedaykin"` → Assign "Fedaykin" Discord role
- `eligible: false` → Remove all Sietch roles

**Pros**:
- Clean separation of concerns
- Our API is the source of truth
- Collab.Land handles wallet verification UI
- Automatic role sync on wallet balance changes
- Well-documented and battle-tested

**Cons**:
- Requires premium Collab.Land subscription
- Slight delay in role updates (Collab.Land polls periodically)
- Dependency on external service

**Cost**: ~$99/month for Premium tier (includes Custom API gates)

---

### Option B: Direct Discord Role Management (Fallback)

**Description**: Our bot directly manages Discord roles without Collab.Land.

**Requirements**:
- Discord bot with MANAGE_ROLES permission
- Custom wallet verification flow
- Direct role assignment logic

**How It Works**:
1. User runs `/verify` command in Discord
2. Bot generates unique verification message
3. User signs message with wallet
4. Bot verifies signature and stores wallet mapping
5. On eligibility sync, bot updates roles directly

**Pros**:
- No external service dependency
- Complete control over verification flow
- No subscription cost

**Cons**:
- Must build wallet verification from scratch
- Must handle signature verification
- Less established than Collab.Land
- More code to maintain
- Users less familiar with custom verification flows

---

## Collab.Land Subscription Tiers

| Tier | Price | Custom API Gates | Notes |
|------|-------|------------------|-------|
| Free | $0 | ❌ | Basic ERC-20/721/1155 only |
| Premium | $99/mo | ✅ | Custom API, priority support |
| Enterprise | Custom | ✅ | SLA, dedicated support |

---

## Integration Decision

**Recommendation**: **Option A - Custom API Token Gate**

**Rationale**:
1. Collab.Land is industry standard for Discord token gating
2. Users are familiar with Collab.Land verification flow
3. Our API is already built and ready
4. Premium tier cost ($99/mo) is acceptable for project scope
5. Reduces development time significantly
6. Battle-tested security for wallet verification

---

## Implementation Steps (Sprint 3-4)

### Prerequisites
1. ✅ `/eligibility/:address` endpoint implemented (Sprint 2)
2. ⏳ Collab.Land Premium subscription
3. ⏳ Discord server created with roles

### Configuration Steps
1. Add Collab.Land bot to Sietch Discord server
2. Go to Collab.Land Command Center
3. Create new "Custom API" token gate:
   - Name: "Sietch Eligibility"
   - API URL: `https://sietch-api.example.com/eligibility/{wallet}`
   - Method: GET
   - Success Condition: `response.eligible === true`
4. Create role mappings:
   - Naib: `response.role === "naib"`
   - Fedaykin: `response.role === "fedaykin"`
5. Set verification channel (#water-discipline)
6. Configure verification message

### Testing Checklist
- [ ] Test with eligible Naib wallet → Gets Naib role
- [ ] Test with eligible Fedaykin wallet → Gets Fedaykin role
- [ ] Test with ineligible wallet → No roles assigned
- [ ] Test role removal when wallet becomes ineligible
- [ ] Test role promotion (Fedaykin → Naib)
- [ ] Test role demotion (Naib → Fedaykin)

---

## Alternative: Guild.xyz

If Collab.Land doesn't meet requirements, [Guild.xyz](https://guild.xyz/) is an alternative:

- **Pros**: Free, supports custom requirements, modern UI
- **Cons**: Less established, requires own verification flow

---

## References

- [Collab.Land Documentation](https://collabland.freshdesk.com/)
- [Custom API Token Gates](https://collabland.freshdesk.com/support/solutions/articles/70000634654)
- [Discord Bot Permissions](https://discord.com/developers/docs/topics/permissions)

---

*Research conducted for Sprint 2 - S2-T6*

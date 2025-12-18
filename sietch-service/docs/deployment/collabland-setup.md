# Collab.Land Configuration Guide

This guide documents the Collab.Land setup for Sietch Discord server token gating.

## Prerequisites

1. Collab.Land Premium subscription ($99/month)
2. Sietch Discord server created with roles (Naib, Fedaykin)
3. Sietch API deployed and accessible at production URL
4. Discord server admin permissions

## Step 1: Add Collab.Land Bot to Server

1. Go to [Collab.Land Bot Invite](https://discord.com/oauth2/authorize?client_id=704521096837464076&scope=bot%20applications.commands&permissions=8)
2. Select "Sietch" server from dropdown
3. Click "Authorize"
4. Complete CAPTCHA verification

## Step 2: Access Command Center

1. Go to [Collab.Land Command Center](https://cc.collab.land/)
2. Connect with Discord account
3. Select "Sietch" server from your communities
4. Navigate to "Token Gating Rules"

## Step 3: Create Custom API Token Gate

### Gate 1: Naib Role

1. Click "Create New Rule"
2. Select "Custom API" as gate type
3. Configure:
   - **Name**: `Sietch Naib Eligibility`
   - **Role to Assign**: Select "Naib" role
   - **API Method**: GET
   - **API URL**: `https://sietch-api.honeyjar.xyz/eligibility/{wallet}`
   - **Success Condition**: `response.eligible === true && response.role === "naib"`
4. Click "Save Rule"

### Gate 2: Fedaykin Role

1. Click "Create New Rule"
2. Select "Custom API" as gate type
3. Configure:
   - **Name**: `Sietch Fedaykin Eligibility`
   - **Role to Assign**: Select "Fedaykin" role
   - **API Method**: GET
   - **API URL**: `https://sietch-api.honeyjar.xyz/eligibility/{wallet}`
   - **Success Condition**: `response.eligible === true && response.role === "fedaykin"`
4. Click "Save Rule"

## Step 4: Configure Verification Channel

1. Go to "Verification Settings" in Command Center
2. Set verification channel: `#water-discipline`
3. Configure welcome message:

```
Welcome to Sietch verification!

To verify your eligibility, connect your wallet below.

Requirements:
- Must be in the top 69 BGT holders
- Must not have redeemed any BGT

Roles:
- Naib: Top 7 BGT holders
- Fedaykin: Ranks 8-69

Click the button below to begin verification.
```

4. Enable "Remove roles on failure" option
5. Set re-verification interval: 24 hours

## Step 5: Test Configuration

### Test Case 1: Eligible Naib Wallet

1. Use a test wallet in top 7
2. Run verification in #water-discipline
3. Expected: Naib role assigned

### Test Case 2: Eligible Fedaykin Wallet

1. Use a test wallet ranked 8-69
2. Run verification
3. Expected: Fedaykin role assigned

### Test Case 3: Ineligible Wallet

1. Use a wallet not in top 69
2. Run verification
3. Expected: No roles assigned, error message shown

### Test Case 4: Role Removal

1. Previously eligible wallet loses eligibility
2. Wait for re-verification (or trigger manually)
3. Expected: Roles removed

## API Response Format

The `/eligibility/:address` endpoint returns:

```json
{
  "address": "0x1234...abcd",
  "eligible": true,
  "rank": 5,
  "role": "naib",
  "bgt_held": 50000.123
}
```

For ineligible addresses:

```json
{
  "address": "0x5678...efgh",
  "eligible": false,
  "rank": null,
  "role": "none",
  "bgt_held": null
}
```

## Troubleshooting

### Verification Not Working

1. Check API endpoint is accessible: `curl https://sietch-api.honeyjar.xyz/health`
2. Verify API returns correct format for test address
3. Check Collab.Land bot has required permissions
4. Review Collab.Land Command Center logs

### Roles Not Updating

1. Check re-verification interval setting
2. Manually trigger re-verification in Command Center
3. Verify API returns updated eligibility status
4. Check Discord role permissions (bot role above assigned roles)

### API Timeout Errors

1. Check API response time (should be < 100ms)
2. Review nginx rate limiting settings
3. Check Collab.Land retry settings

## Discord Bot Permissions

Collab.Land bot requires:
- `MANAGE_ROLES` - To assign/remove roles
- `SEND_MESSAGES` - For verification messages
- `EMBED_LINKS` - For rich verification embeds
- `VIEW_CHANNEL` - Access to verification channel

Ensure Collab.Land bot role is positioned **above** Naib and Fedaykin roles in server settings.

## Monitoring

Monitor Collab.Land integration via:
1. Collab.Land Command Center dashboard
2. Sietch API `/health` endpoint
3. Discord server audit logs

## Integration with Sietch Onboarding

### Automatic Onboarding Trigger

When Collab.Land assigns the Naib or Fedaykin role to a new member, the Sietch bot detects this via the `guildMemberUpdate` event and automatically triggers the onboarding flow:

1. User verifies wallet with Collab.Land
2. Collab.Land assigns Naib or Fedaykin role based on BGT rank
3. Sietch bot detects the new role assignment
4. Sietch bot sends onboarding DM with pseudonym setup
5. User completes onboarding flow (choose nym, optional bio/PFP)
6. User receives @Onboarded role

### Role Hierarchy

After Collab.Land integration, the Discord role hierarchy should be:

```
@Admin (server admins)
@Collab.Land Bot
@Sietch Bot
@Naib (top 7 - Collab.Land assigned)
@Fedaykin (8-69 - Collab.Land assigned)
@Trusted (10+ badges OR Helper badge - Sietch auto-assigned)
@Veteran (90+ days tenure - Sietch auto-assigned)
@Engaged (5+ badges OR 200+ activity - Sietch auto-assigned)
@Onboarded (completed onboarding - Sietch assigned)
@everyone
```

**Important**: Sietch bot role must be positioned above any roles it needs to manage (@Trusted, @Veteran, @Engaged, @Onboarded).

### Channel Access Configuration

| Channel | Required Role | Purpose |
|---------|--------------|---------|
| #water-discipline | @everyone | Verification channel |
| #the-door | @everyone | Announcements |
| #sietch-lounge | @Onboarded | Main chat |
| #introductions | @Onboarded | New member intros |
| #deep-desert | @Engaged | Active members |
| #stillsuit-lounge | @Veteran | Long-term members |
| #council-rock | @Naib | Top 7 BGT holders |

### Existing Member Sync

For existing members who had access before v2.0:

1. Run migration script to create placeholder profiles
2. Send DM prompting them to complete onboarding
3. Until onboarding complete:
   - Can view channels based on Collab.Land role
   - Cannot use social features (profile, badges)
4. After onboarding complete:
   - Full access to social features
   - Automatic badge checks begin

## Support

- Collab.Land Support: https://collabland.freshdesk.com/
- API Issues: Check sietch-service logs
- Discord Server Issues: Contact server admins

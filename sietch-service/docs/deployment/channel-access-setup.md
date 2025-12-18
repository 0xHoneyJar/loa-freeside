# Channel Access Setup Guide

This guide documents the Discord channel and role permission configuration for Sietch v2.0.

## Role Hierarchy

Create roles in this order (top to bottom) in Discord Server Settings > Roles:

| Position | Role Name | Color | Assigned By |
|----------|-----------|-------|-------------|
| 1 | @Admin | Red | Manual |
| 2 | @Collab.Land | - | Collab.Land bot |
| 3 | @Sietch Bot | - | Bot role |
| 4 | @Naib | Gold (#F5A623) | Collab.Land (top 7) |
| 5 | @Fedaykin | Blue (#3498DB) | Collab.Land (8-69) |
| 6 | @Trusted | Purple (#9B59B6) | Sietch bot (10+ badges OR Helper) |
| 7 | @Veteran | Silver (#95A5A6) | Sietch bot (90+ days) |
| 8 | @Engaged | Green (#2ECC71) | Sietch bot (5+ badges OR 200+ activity) |
| 9 | @Onboarded | Gray | Sietch bot (completed onboarding) |
| 10 | @everyone | - | Default |

**Important**: The Sietch Bot role must be positioned ABOVE any roles it needs to manage (@Trusted, @Veteran, @Engaged, @Onboarded).

## Channel Structure

### Public Channels (No Role Required)

| Channel | Category | Purpose |
|---------|----------|---------|
| #water-discipline | Verification | Collab.Land verification channel |
| #the-door | Announcements | Eligibility announcements |
| #rules | Information | Server rules |
| #faq | Information | Frequently asked questions |

### Member Channels (@Onboarded Required)

| Channel | Category | Purpose |
|---------|----------|---------|
| #sietch-lounge | Community | Main community chat |
| #introductions | Community | New member introductions |
| #bot-commands | Community | Bot commands (/profile, /badges, etc.) |
| #census | Community | Leaderboard updates |

### Engagement Channels (@Engaged Required)

| Channel | Category | Purpose |
|---------|----------|---------|
| #deep-desert | Engagement | Active member discussions |
| #project-ideas | Engagement | Community project proposals |

### Veteran Channels (@Veteran Required)

| Channel | Category | Purpose |
|---------|----------|---------|
| #stillsuit-lounge | Veterans | Long-term member space |
| #mentorship | Veterans | Helping new members |

### Elite Channels (@Naib Required)

| Channel | Category | Purpose |
|---------|----------|---------|
| #council-rock | Naib | Top 7 BGT holder discussions |
| #governance | Naib | Governance proposals |

## Permission Configuration

### Step-by-Step Setup

#### 1. Configure @everyone Permissions

In Server Settings > Roles > @everyone:
- ❌ View Channels (deny by default)
- ❌ Send Messages
- ❌ Add Reactions

#### 2. Configure Public Channels

For each public channel:
1. Right-click channel > Edit Channel > Permissions
2. Add @everyone role
3. Set:
   - ✅ View Channel
   - ✅ Read Message History
   - ❌ Send Messages (except #water-discipline)

#### 3. Configure Member Channels

For each channel in the Community category:
1. Edit Channel > Permissions
2. Add @Onboarded role
3. Set:
   - ✅ View Channel
   - ✅ Send Messages
   - ✅ Read Message History
   - ✅ Add Reactions
   - ✅ Embed Links
   - ✅ Attach Files

#### 4. Configure Engagement Channels

For #deep-desert and #project-ideas:
1. Edit Channel > Permissions
2. Add @Engaged role
3. Set same permissions as member channels
4. Ensure @Onboarded does NOT have View Channel

#### 5. Configure Veteran Channels

For #stillsuit-lounge and #mentorship:
1. Edit Channel > Permissions
2. Add @Veteran role
3. Set same permissions as member channels
4. Ensure @Onboarded and @Engaged do NOT have View Channel

#### 6. Configure Naib Channels

For #council-rock and #governance:
1. Edit Channel > Permissions
2. Add @Naib role
3. Set same permissions as member channels
4. Ensure other roles do NOT have View Channel

### Category Permissions

Use category permissions for easier management:

1. Create category (e.g., "Community")
2. Set category permissions for @Onboarded
3. Sync channel permissions with category

## Environment Variables

Add these role IDs to your `.env`:

```bash
# Collab.Land assigned roles (existing)
DISCORD_ROLE_NAIB=your_naib_role_id
DISCORD_ROLE_FEDAYKIN=your_fedaykin_role_id

# Sietch bot managed roles (new in v2.0)
DISCORD_ROLE_ONBOARDED=your_onboarded_role_id
DISCORD_ROLE_ENGAGED=your_engaged_role_id
DISCORD_ROLE_VETERAN=your_veteran_role_id
DISCORD_ROLE_TRUSTED=your_trusted_role_id
```

### Getting Role IDs

1. Enable Developer Mode: Discord Settings > App Settings > Advanced > Developer Mode
2. Right-click each role in Server Settings > Roles
3. Click "Copy ID"

## Verification Checklist

After setup, verify:

- [ ] @Onboarded members can see #sietch-lounge
- [ ] @Onboarded members CANNOT see #deep-desert
- [ ] @Engaged members can see #deep-desert
- [ ] @Engaged members CANNOT see #stillsuit-lounge
- [ ] @Veteran members can see #stillsuit-lounge
- [ ] @Naib members can see #council-rock
- [ ] @Fedaykin members CANNOT see #council-rock
- [ ] Non-onboarded members can ONLY see public channels
- [ ] Sietch bot can assign/remove @Onboarded, @Engaged, @Veteran, @Trusted

## Role Qualification Criteria

| Role | Criteria | Removal |
|------|----------|---------|
| @Naib | Top 7 BGT holders | Collab.Land auto-removes |
| @Fedaykin | Ranks 8-69 BGT | Collab.Land auto-removes |
| @Trusted | 10+ badges OR Helper badge | When criteria no longer met |
| @Veteran | 90+ days tenure | Never (permanent) |
| @Engaged | 5+ badges OR 200+ activity | When criteria no longer met |
| @Onboarded | Completed onboarding | Never (permanent) |

## Troubleshooting

### Bot Cannot Assign Roles

1. Check bot role position is above target roles
2. Verify bot has "Manage Roles" permission
3. Check role IDs in .env match Discord

### Channel Not Visible

1. Check role has View Channel permission
2. Check category permissions aren't overriding
3. Verify user has the required role

### Permissions Not Syncing

1. Check if channel is synced with category
2. Use "Sync with Category" option if needed
3. Review individual permission overrides

## Support

- Discord Permission Calculator: https://discordapi.com/permissions.html
- Discord.js Permissions Guide: https://discordjs.guide/popular-topics/permissions.html

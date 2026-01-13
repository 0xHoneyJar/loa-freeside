# Discord Permission Matrix - Sietch v3.0

**Last Updated**: December 26, 2025
**Version**: 3.0
**Status**: Production Ready

---

## Overview

This document defines the complete permission matrix for all Discord roles and channels in Sietch v3.0 "The Great Expansion". The system uses 9 tier-based roles (Hajra through Naib) plus special badge roles.

---

## Role Hierarchy

### Tier Roles (BGT-Based)

| Rank | Role | Color | BGT Threshold | Member Count (Target) |
|------|------|-------|---------------|----------------------|
| 9 | `@Naib` | Gold (#FFD700) | Top 7 by rank | 7 |
| 8 | `@Fedaykin` | Blue (#4169E1) | Top 8-69 by rank | 62 |
| 7 | `@Usul` | Purple (#9B59B6) | 1111+ BGT | Variable |
| 6 | `@Sayyadina` | Indigo (#6610F2) | 888+ BGT | Variable |
| 5 | `@Mushtamal` | Teal (#20C997) | 690+ BGT | Variable |
| 4 | `@Sihaya` | Green (#28A745) | 420+ BGT | Variable |
| 3 | `@Qanat` | Cyan (#17A2B8) | 222+ BGT | Variable |
| 2 | `@Ichwan` | Orange (#FD7E14) | 69+ BGT | Variable |
| 1 | `@Hajra` | Sand (#C2B280) | 6.9+ BGT | Variable |

### Special Roles

| Role | Color | Criteria | Purpose |
|------|-------|----------|---------|
| `@Former Naib` | Silver (#C0C0C0) | Previously held Naib seat | Historical recognition |
| `@Water Sharer` | Aqua (#00D4FF) | Admin-awarded or shared badge | Badge sharing privilege |
| `@Taqwa` | Sand (#C2B280) | Waitlist registration | Cave Entrance access |
| `@Engaged` | Green | 5+ badges earned | Deep Desert access |
| `@Veteran` | Purple | 90+ days tenure | Stillsuit Lounge access |

---

## Channel Structure & Permissions

### 📜 STILLSUIT (Info - Public)

#### #water-discipline
- **Purpose**: Welcome, rules, Chatham House rule reminder
- **Permissions**:
  - `@everyone`: Read messages, View channel
  - `@everyone`: Cannot send messages (read-only)
  - Bot: Send messages, Embed links

#### #announcements
- **Purpose**: Weekly digest, important updates
- **Permissions**:
  - `@everyone`: Read messages, View channel
  - `@everyone`: Cannot send messages (read-only)
  - Bot: Send messages, Embed links, Mention @everyone

---

### 🚪 TIER 0: CAVE ENTRANCE (6.9+ BGT)

#### #cave-entrance
- **Purpose**: Main discussion for entry-level members
- **Permissions**:
  - `@Hajra`: View channel, Read message history (READ ONLY)
  - `@Ichwan+`: View channel, Send messages, Add reactions, Attach files, Embed links
  - Lower tiers: No access
  - Bot: All standard bot permissions

**Access Summary**:
- Read: Hajra+
- Write: Ichwan+

#### 🔊 cave-voices (Voice Channel)
- **Purpose**: Voice chat for Tier 0
- **Permissions**:
  - `@Hajra`: View channel (see member count only, cannot join)
  - `@Ichwan+`: View channel, Connect, Speak, Use voice activity
  - Bot: Standard VC permissions

**Access Summary**:
- See count: Hajra+
- Join/Speak: Ichwan+

---

### 🕳️ TIER 2: THE DEPTHS (222+ BGT)

#### #the-depths
- **Purpose**: Deeper discussions for established members
- **Permissions**:
  - `@Qanat`: View channel, Read message history (READ ONLY)
  - `@Sihaya+`: View channel, Send messages, Add reactions, Attach files, Embed links
  - Lower tiers: No access
  - Bot: All standard bot permissions

**Access Summary**:
- Read: Qanat+
- Write: Sihaya+

#### 🔊 depth-voices (Voice Channel)
- **Purpose**: Voice chat for Tier 2
- **Permissions**:
  - `@Qanat`: View channel (see member count only, cannot join)
  - `@Sihaya`: View channel (see member count only, cannot join)
  - `@Mushtamal+`: View channel, Connect, Speak, Use voice activity
  - Bot: Standard VC permissions

**Access Summary**:
- See count: Qanat+
- Join/Speak: Mushtamal+

---

### ⚡ TIER 3: INNER SANCTUM (888+ BGT)

#### #inner-sanctum
- **Purpose**: Elite discussions for highest BGT holders
- **Permissions**:
  - `@Sayyadina+`: View channel, Send messages, Read history, Add reactions, Attach files, Embed links
  - Lower tiers: No access
  - Bot: All standard bot permissions

**Access Summary**:
- Read/Write: Sayyadina+

#### 🔊 sanctum-voices (Voice Channel)
- **Purpose**: Voice chat for Tier 3
- **Permissions**:
  - `@Sayyadina`: View channel, Connect (see members, cannot speak)
  - `@Usul+`: View channel, Connect, Speak, Use voice activity
  - Lower tiers: No access
  - Bot: Standard VC permissions

**Access Summary**:
- See members: Sayyadina+
- Speak: Usul+

---

### ⚔️ FEDAYKIN COMMONS (Top 69)

All channels require `@Fedaykin` role or higher:

#### #general
- **Purpose**: Main community discussion
- **Permissions**:
  - `@Fedaykin+`: Full access (send, read, react, attach, embed)
  - Lower tiers: No access

#### #spice
- **Purpose**: Market insights, alpha, trading discussion
- **Permissions**: Same as #general

#### #water-shares
- **Purpose**: Ideas, proposals, community initiatives
- **Permissions**: Same as #general

#### #introductions
- **Purpose**: Member introductions and welcomes
- **Permissions**: Same as #general

#### #census
- **Purpose**: Live leaderboard, stats display
- **Permissions**:
  - `@Fedaykin+`: Read messages, View channel
  - `@Fedaykin+`: Cannot send messages (read-only, bot posts only)
  - Bot: Send messages, Embed links

#### #the-door
- **Purpose**: Member joins/departures + story fragments
- **Permissions**:
  - `@Fedaykin+`: Read messages, View channel
  - `@Fedaykin+`: Cannot send messages (read-only, bot posts only)
  - Bot: Send messages, Embed links

#### 🔊 fedaykin-voices
- **Purpose**: Main voice chat
- **Permissions**:
  - `@Fedaykin+`: Full VC access (connect, speak, video, screen share)
  - Bot: Standard VC permissions

---

### 🏛️ NAIB COUNCIL (Top 7 Only)

#### #council-rock
- **Purpose**: Private Naib discussions and strategy
- **Permissions**:
  - `@Naib`: Full access (send, read, react, attach, embed)
  - `@Former Naib`: No access (council is current Naib only)
  - All other roles: No access
  - Bot: Bot commands only

#### 🔊 council-chamber
- **Purpose**: Private Naib voice channel
- **Permissions**:
  - `@Naib`: Full VC access
  - All other roles: No access
  - Bot: Standard VC permissions

---

### 🏛️ NAIB ARCHIVES (Naib + Former Naib)

#### #naib-archives
- **Purpose**: Historical Naib discussions, Former Naib recognition
- **Permissions**:
  - `@Naib`: Full access
  - `@Former Naib`: Full access
  - All other roles: No access
  - Bot: Bot commands only

---

### 💧 THE OASIS (Water Sharer Badge)

#### #the-oasis
- **Purpose**: Exclusive space for Water Sharer badge holders
- **Permissions**:
  - `@Water Sharer`: Full access (send, read, react, attach, embed)
  - All other roles: No access
  - Bot: Bot commands only

---

### 🏜️ DEEP DESERT (Engaged Badge)

#### #deep-desert
- **Purpose**: Exclusive space for engaged members (5+ badges)
- **Permissions**:
  - `@Engaged`: Full access
  - All other roles: No access
  - Bot: Bot commands only

---

### 🧘 STILLSUIT LOUNGE (Veteran Badge)

#### #stillsuit-lounge
- **Purpose**: Exclusive space for long-term members (90+ days)
- **Permissions**:
  - `@Veteran`: Full access
  - All other roles: No access
  - Bot: Bot commands only

---

### 🛠️ WINDTRAP (Support)

#### #support
- **Purpose**: Technical help and troubleshooting
- **Permissions**:
  - `@Fedaykin+`: Full access
  - Lower tiers: No access

#### #bot-commands
- **Purpose**: Bot interaction space
- **Permissions**:
  - `@Fedaykin+`: Full access
  - Lower tiers: No access

---

## Role Assignment Logic

### Additive Tier Model

Members accumulate ALL roles from their tier and below:

| Member Tier | Discord Roles Assigned |
|-------------|------------------------|
| Hajra | `@Hajra` |
| Ichwan | `@Hajra`, `@Ichwan` |
| Qanat | `@Hajra`, `@Ichwan`, `@Qanat` |
| Sihaya | `@Hajra`, `@Ichwan`, `@Qanat`, `@Sihaya` |
| Mushtamal | `@Hajra`, `@Ichwan`, `@Qanat`, `@Sihaya`, `@Mushtamal` |
| Sayyadina | `@Hajra`, `@Ichwan`, `@Qanat`, `@Sihaya`, `@Mushtamal`, `@Sayyadina` |
| Usul | `@Hajra`, `@Ichwan`, `@Qanat`, `@Sihaya`, `@Mushtamal`, `@Sayyadina`, `@Usul` |
| Fedaykin | All BGT roles + `@Fedaykin` |
| Naib | All BGT roles + `@Fedaykin`, `@Naib` |

**Note**: Fedaykin and Naib skip intermediate BGT roles since qualification is rank-based.

---

## Permission Inheritance

Higher tiers inherit all permissions from lower tiers:

```
Hajra (read Cave Entrance)
  └─ Ichwan (write Cave Entrance)
      └─ Qanat (read The Depths)
          └─ Sihaya (write The Depths)
              └─ Mushtamal (VC access Tier 2)
                  └─ Sayyadina (read/write Inner Sanctum)
                      └─ Usul (VC access Tier 3)
                          └─ Fedaykin (Fedaykin Commons + all above)
                              └─ Naib (Naib Council + all above)
```

---

## Verification Checklist

### Tier 0 (Cave Entrance)

- [ ] Hajra can read #cave-entrance but not send
- [ ] Hajra can see cave-voices member count but not join
- [ ] Ichwan can send messages in #cave-entrance
- [ ] Ichwan can join and speak in cave-voices

### Tier 2 (The Depths)

- [ ] Qanat can read #the-depths but not send
- [ ] Qanat can see depth-voices member count but not join
- [ ] Sihaya can send messages in #the-depths
- [ ] Sihaya can see depth-voices member count but not join
- [ ] Mushtamal can join and speak in depth-voices

### Tier 3 (Inner Sanctum)

- [ ] Sayyadina can read/write #inner-sanctum
- [ ] Sayyadina can connect to sanctum-voices but not speak
- [ ] Usul can speak in sanctum-voices

### Fedaykin Commons

- [ ] Fedaykin can access all Fedaykin channels
- [ ] Fedaykin can join fedaykin-voices
- [ ] Fedaykin cannot access Naib Council

### Naib Council

- [ ] Naib can access #council-rock and council-chamber
- [ ] Naib can access #naib-archives
- [ ] Former Naib can access #naib-archives only
- [ ] Former Naib cannot access #council-rock

### Special Channels

- [ ] Water Sharer badge holders can access #the-oasis
- [ ] Engaged badge holders (5+) can access #deep-desert
- [ ] Veteran badge holders (90+ days) can access #stillsuit-lounge

---

## Bot Permissions

The Sietch bot requires the following server-wide permissions:

### General Permissions
- View Channels
- Manage Roles (for tier role assignment)
- Manage Channels (for role overrides)

### Text Permissions
- Send Messages
- Send Messages in Threads
- Embed Links
- Attach Files
- Add Reactions
- Use External Emojis
- Use External Stickers
- Mention @everyone, @here, and All Roles
- Manage Messages (for moderation)
- Read Message History

### Voice Permissions
- Connect
- Speak
- Video
- Use Voice Activity

### Application Commands
- Use Application Commands (for slash commands)

---

## Testing Notes

### Test Accounts Required

For comprehensive permission testing, create test accounts for each tier:

1. **test-hajra** - 6.9 BGT (read-only Cave Entrance)
2. **test-ichwan** - 69 BGT (write Cave Entrance)
3. **test-qanat** - 222 BGT (read-only The Depths)
4. **test-sihaya** - 420 BGT (write The Depths)
5. **test-mushtamal** - 690 BGT (VC access Tier 2)
6. **test-sayyadina** - 888 BGT (read/write Inner Sanctum)
7. **test-usul** - 1111 BGT (VC speak Tier 3)
8. **test-fedaykin** - Rank 30 (Fedaykin Commons)
9. **test-naib** - Rank 3 (Naib Council)

### Manual Testing Procedure

1. Create test accounts with Collab.Land token verification
2. Complete onboarding for each account
3. Verify channel visibility matches permission matrix
4. Test message sending permissions (should fail where read-only)
5. Test VC joining and speaking permissions
6. Test special badge channels (@Water Sharer, @Engaged, @Veteran)
7. Verify Naib/Former Naib separation

---

## Troubleshooting

### Common Permission Issues

**Issue**: Member can't see channels they should have access to
- **Fix**: Check role assignment in Discord server settings
- **Fix**: Verify tier sync ran successfully (check logs)
- **Fix**: Ensure channel overrides don't deny access

**Issue**: Member can send in read-only channel
- **Fix**: Check channel permissions - ensure `Send Messages` is denied
- **Fix**: Verify role hierarchy (higher roles shouldn't override denies)

**Issue**: VC member count not visible
- **Fix**: Ensure `View Channel` is granted but `Connect` is denied
- **Fix**: Check Discord desktop/mobile client versions (mobile may differ)

**Issue**: Bot can't assign roles
- **Fix**: Verify bot has `Manage Roles` permission
- **Fix**: Ensure bot's role is higher than tier roles in role hierarchy
- **Fix**: Check Discord API rate limits (may need throttling)

---

## Security Considerations

### Permission Escalation Prevention

- Bot role must be highest (below @everyone admin roles only)
- Tier roles should not have `Manage Roles` permission
- Channel overrides should use explicit denies, not just lack of grants
- Audit role assignments regularly (monthly recommended)

### Privacy Protection

- No wallet addresses should ever appear in channel topics or names
- Member lists should only show nyms, never wallet addresses
- Role names should not encode BGT amounts (use tier names instead)

---

## Change Log

| Date | Version | Changes |
|------|---------|---------|
| 2025-12-26 | 3.0 | Initial v3.0 permission matrix with 9 tiers |

---

**Document Owner**: Sietch Infrastructure Team
**Review Cadence**: Monthly or after any structural changes
**Next Review**: 2026-01-26

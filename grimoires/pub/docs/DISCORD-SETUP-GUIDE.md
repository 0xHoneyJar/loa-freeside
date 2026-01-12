# Discord Server Setup Guide

**Last Updated**: January 2026
**Version**: 3.0

This guide covers complete Discord server setup for Sietch, including bot creation, server structure, and all required tokens/IDs.

---

## Part 1: Create the Discord Bot

### Step 1: Discord Developer Portal

1. Go to https://discord.com/developers/applications
2. Click **"New Application"**
3. Name it "Sietch" (or your preferred name)
4. Accept the Terms of Service

### Step 2: Configure the Bot

1. Go to **"Bot"** in the left sidebar
2. Click **"Add Bot"** → Confirm
3. **Copy the TOKEN** → This becomes `DISCORD_BOT_TOKEN`
4. Enable **Privileged Gateway Intents**:
   - ✅ Presence Intent
   - ✅ Server Members Intent
   - ✅ Message Content Intent

> **Security**: Never share your bot token. If compromised, regenerate it immediately.

### Step 3: Generate Invite URL

1. Go to **"OAuth2"** → **"URL Generator"**
2. Select Scopes:
   - ✅ `bot`
   - ✅ `applications.commands`
3. Select Bot Permissions:
   - ✅ Manage Roles
   - ✅ Manage Channels
   - ✅ Send Messages
   - ✅ Send Messages in Threads
   - ✅ Embed Links
   - ✅ Attach Files
   - ✅ Add Reactions
   - ✅ Use External Emojis
   - ✅ Use External Stickers
   - ✅ Manage Messages
   - ✅ Read Message History
   - ✅ Mention @everyone
   - ✅ Connect (voice)
   - ✅ Speak (voice)
4. Copy the generated URL
5. Open the URL in browser to invite bot to your server

---

## Part 2: Discord Server Roles

Create roles in this exact order (top to bottom in Discord settings). The bot's role must be **above** all roles it manages.

### Tier Roles (BGT-Based)

| Role | Color | Hex Code | BGT Threshold |
|------|-------|----------|---------------|
| `@Naib` | Gold | `#FFD700` | Top 7 by rank |
| `@Fedaykin` | Blue | `#4169E1` | Top 8-69 by rank |
| `@Usul` | Purple | `#9B59B6` | 1111+ BGT |
| `@Sayyadina` | Indigo | `#6610F2` | 888+ BGT |
| `@Mushtamal` | Teal | `#20C997` | 690+ BGT |
| `@Sihaya` | Green | `#28A745` | 420+ BGT |
| `@Qanat` | Cyan | `#17A2B8` | 222+ BGT |
| `@Ichwan` | Orange | `#FD7E14` | 69+ BGT |
| `@Hajra` | Sand | `#C2B280` | 6.9+ BGT |

### Special Roles

| Role | Color | Hex Code | Criteria |
|------|-------|----------|----------|
| `@Former Naib` | Silver | `#C0C0C0` | Previously held Naib seat |
| `@Taqwa` | Sand | `#C2B280` | Waitlist registration |
| `@Water Sharer` | Aqua | `#00D4FF` | Badge holder (can share) |
| `@Engaged` | Green | `#28A745` | 5+ badges earned |
| `@Veteran` | Purple | `#9B59B6` | 90+ days tenure |

### Role Hierarchy

```
┌─────────────────────────────┐
│ Server Owner                │
├─────────────────────────────┤
│ @Sietch Bot (auto-created)  │  ← Bot role MUST be here
├─────────────────────────────┤
│ @Naib                       │
│ @Fedaykin                   │
│ @Usul                       │
│ @Sayyadina                  │
│ @Mushtamal                  │
│ @Sihaya                     │
│ @Qanat                      │
│ @Ichwan                     │
│ @Hajra                      │
├─────────────────────────────┤
│ @Former Naib                │
│ @Taqwa                      │
│ @Water Sharer               │
│ @Engaged                    │
│ @Veteran                    │
├─────────────────────────────┤
│ @everyone                   │
└─────────────────────────────┘
```

---

## Part 3: Channel Structure

### Category: 📜 STILLSUIT (Public Info)

| Channel | Type | Purpose | Permissions |
|---------|------|---------|-------------|
| `#water-discipline` | Text | Welcome, rules | Everyone: Read only |
| `#announcements` | Text | Weekly digest | Everyone: Read only, Bot: Send |

### Category: 🚪 CAVE ENTRANCE (Tier 0: 6.9+ BGT)

| Channel | Type | Purpose | Permissions |
|---------|------|---------|-------------|
| `#cave-entrance` | Text | Entry-level discussion | Hajra: Read, Ichwan+: Write |
| `cave-voices` | Voice | Voice chat | Hajra: View, Ichwan+: Join/Speak |

### Category: 🕳️ THE DEPTHS (Tier 2: 222+ BGT)

| Channel | Type | Purpose | Permissions |
|---------|------|---------|-------------|
| `#the-depths` | Text | Deeper discussions | Qanat: Read, Sihaya+: Write |
| `depth-voices` | Voice | Voice chat | Qanat+: View, Mushtamal+: Join/Speak |

### Category: ⚡ INNER SANCTUM (Tier 3: 888+ BGT)

| Channel | Type | Purpose | Permissions |
|---------|------|---------|-------------|
| `#inner-sanctum` | Text | Elite discussions | Sayyadina+: Read/Write |
| `sanctum-voices` | Voice | Voice chat | Sayyadina: Listen, Usul+: Speak |

### Category: ⚔️ FEDAYKIN COMMONS (Top 69)

| Channel | Type | Purpose | Permissions |
|---------|------|---------|-------------|
| `#general` | Text | Main discussion | Fedaykin+: Full |
| `#spice` | Text | Alpha/trading | Fedaykin+: Full |
| `#water-shares` | Text | Proposals | Fedaykin+: Full |
| `#introductions` | Text | Member intros | Fedaykin+: Full |
| `#census` | Text | Live leaderboard | Fedaykin+: Read, Bot: Send |
| `#the-door` | Text | Join/leave notices | Fedaykin+: Read, Bot: Send |
| `fedaykin-voices` | Voice | Main voice | Fedaykin+: Full |

### Category: 🏛️ NAIB COUNCIL (Top 7 Only)

| Channel | Type | Purpose | Permissions |
|---------|------|---------|-------------|
| `#council-rock` | Text | Private Naib discussion | Naib only |
| `council-chamber` | Voice | Private Naib voice | Naib only |

### Category: 🏛️ NAIB ARCHIVES

| Channel | Type | Purpose | Permissions |
|---------|------|---------|-------------|
| `#naib-archives` | Text | Historical discussions | Naib + Former Naib |

### Category: 💧 BADGE CHANNELS

| Channel | Type | Purpose | Permissions |
|---------|------|---------|-------------|
| `#the-oasis` | Text | Water Sharer exclusive | @Water Sharer only |
| `#deep-desert` | Text | Engaged exclusive | @Engaged only |
| `#stillsuit-lounge` | Text | Veteran exclusive | @Veteran only |

### Category: 🛠️ SUPPORT

| Channel | Type | Purpose | Permissions |
|---------|------|---------|-------------|
| `#support` | Text | Help/troubleshooting | Fedaykin+ |
| `#bot-commands` | Text | Bot interaction | Fedaykin+ |

---

## Part 4: Collecting IDs

### Enable Developer Mode

1. Open Discord
2. Go to **User Settings** → **Advanced**
3. Enable **Developer Mode**

### Copy IDs

Right-click the item and select "Copy ID":

| Item | How to Access | Environment Variable |
|------|---------------|---------------------|
| Server | Right-click server name | `DISCORD_GUILD_ID` |
| `#the-door` | Right-click channel | `DISCORD_CHANNEL_THE_DOOR` |
| `#census` | Right-click channel | `DISCORD_CHANNEL_CENSUS` |
| `#announcements` | Right-click channel | `DISCORD_CHANNEL_ANNOUNCEMENTS` |
| `#cave-entrance` | Right-click channel | `DISCORD_CHANNEL_CAVE_ENTRANCE` |
| `#the-oasis` | Right-click channel | `DISCORD_CHANNEL_OASIS` |
| `#deep-desert` | Right-click channel | `DISCORD_CHANNEL_DEEP_DESERT` |
| `#stillsuit-lounge` | Right-click channel | `DISCORD_CHANNEL_STILLSUIT_LOUNGE` |
| `#sietch-lounge` | Right-click channel | `DISCORD_CHANNEL_SIETCH_LOUNGE` |
| `#naib-council` | Right-click channel | `DISCORD_CHANNEL_NAIB_COUNCIL` |
| `#introductions` | Right-click channel | `DISCORD_CHANNEL_INTRODUCTIONS` |
| `@Naib` | Right-click role | `DISCORD_ROLE_NAIB` |
| `@Fedaykin` | Right-click role | `DISCORD_ROLE_FEDAYKIN` |
| `@Usul` | Right-click role | `DISCORD_ROLE_USUL` |
| `@Sayyadina` | Right-click role | `DISCORD_ROLE_SAYYADINA` |
| `@Mushtamal` | Right-click role | `DISCORD_ROLE_MUSHTAMAL` |
| `@Sihaya` | Right-click role | `DISCORD_ROLE_SIHAYA` |
| `@Qanat` | Right-click role | `DISCORD_ROLE_QANAT` |
| `@Ichwan` | Right-click role | `DISCORD_ROLE_ICHWAN` |
| `@Hajra` | Right-click role | `DISCORD_ROLE_HAJRA` |
| `@Taqwa` | Right-click role | `DISCORD_ROLE_TAQWA` |
| `@Former Naib` | Right-click role | `DISCORD_ROLE_FORMER_NAIB` |
| `@Water Sharer` | Right-click role | `DISCORD_ROLE_WATER_SHARER` |
| `@Engaged` | Right-click role | `DISCORD_ROLE_ENGAGED` |
| `@Veteran` | Right-click role | `DISCORD_ROLE_VETERAN` |

---

## Part 5: Other Required Secrets

### Berachain Configuration

| Secret | Source | Notes |
|--------|--------|-------|
| `BGT_ADDRESS` | [Berachain Docs](https://docs.berachain.com) | BGT token contract address |
| `BERACHAIN_RPC_URLS` | Berachain, Alchemy, Infura | Comma-separated for failover |

### Trigger.dev (Scheduled Jobs)

| Secret | Source | Notes |
|--------|--------|-------|
| `TRIGGER_PROJECT_ID` | https://trigger.dev | Create project first |
| `TRIGGER_SECRET_KEY` | Trigger.dev dashboard | Project settings → API Keys |

### API Security

| Secret | How to Generate | Notes |
|--------|-----------------|-------|
| `ADMIN_API_KEYS` | Your choice | Format: `key:name` or `$2b$hash:name` |
| `API_KEY_PEPPER` | `openssl rand -hex 32` | 32-byte random hex |

### Database & Cache

| Secret | Source | Notes |
|--------|--------|-------|
| `DATABASE_URL` | Terraform outputs / RDS | PostgreSQL connection string |
| `REDIS_URL` | Terraform outputs / ElastiCache | Redis connection string |

---

## Part 6: AWS Secrets Manager Format

Update the `arrakis/sietch-service/app-config` secret with this JSON structure:

```json
{
  "BGT_ADDRESS": "0x...",
  "BERACHAIN_RPC_URLS": "https://rpc1.berachain.com,https://rpc2.berachain.com",
  "TRIGGER_PROJECT_ID": "your-project-id",
  "TRIGGER_SECRET_KEY": "tr_xxx",
  "DISCORD_BOT_TOKEN": "MTIz...",
  "DISCORD_GUILD_ID": "123456789012345678",
  "DISCORD_CHANNEL_THE_DOOR": "123456789012345678",
  "DISCORD_CHANNEL_CENSUS": "123456789012345678",
  "DISCORD_CHANNEL_ANNOUNCEMENTS": "123456789012345678",
  "DISCORD_CHANNEL_CAVE_ENTRANCE": "123456789012345678",
  "DISCORD_CHANNEL_OASIS": "123456789012345678",
  "DISCORD_CHANNEL_DEEP_DESERT": "123456789012345678",
  "DISCORD_CHANNEL_STILLSUIT_LOUNGE": "123456789012345678",
  "DISCORD_ROLE_NAIB": "123456789012345678",
  "DISCORD_ROLE_FEDAYKIN": "123456789012345678",
  "DISCORD_ROLE_USUL": "123456789012345678",
  "DISCORD_ROLE_SAYYADINA": "123456789012345678",
  "DISCORD_ROLE_MUSHTAMAL": "123456789012345678",
  "DISCORD_ROLE_SIHAYA": "123456789012345678",
  "DISCORD_ROLE_QANAT": "123456789012345678",
  "DISCORD_ROLE_ICHWAN": "123456789012345678",
  "DISCORD_ROLE_HAJRA": "123456789012345678",
  "ADMIN_API_KEYS": "your_secure_key:admin"
}
```

### How to Update in AWS Console

1. Go to AWS Console → Secrets Manager
2. Find `arrakis/sietch-service/app-config`
3. Click **"Retrieve secret value"**
4. Click **"Edit"**
5. Replace placeholder values with real ones
6. Click **"Save"**

---

## Part 7: Verification Checklist

After setup, verify:

- [ ] Bot is online in server member list
- [ ] Bot role is above all tier roles
- [ ] All channels created with correct permissions
- [ ] All role IDs collected and saved
- [ ] All channel IDs collected and saved
- [ ] AWS Secrets Manager updated with real values
- [ ] ECS service restarted to pick up new secrets

### Test Commands

Once deployed, test with:
- `/ping` - Bot responsiveness
- `/status` - Service health
- `/leaderboard` - BGT rankings

---

## Troubleshooting

### Bot Can't Assign Roles

- Verify bot role is **above** target roles in hierarchy
- Check bot has "Manage Roles" permission
- Ensure role isn't @everyone or managed by integration

### Bot Can't See Channels

- Check channel permission overrides
- Verify bot role has "View Channel" permission
- Check category-level permissions

### Bot Token Invalid

- Regenerate token in Developer Portal
- Update `DISCORD_BOT_TOKEN` in Secrets Manager
- Restart ECS service

---

## Related Documentation

- [Permission Matrix](../../sietch-service/docs/discord/PERMISSION_MATRIX.md) - Detailed permission specs
- [Environment Variables](../../sietch-service/.env.example) - All configuration options
- [Deployment Guide](../loa/deployment/deployment-guide.md) - AWS deployment steps

---

**Document Owner**: Sietch Infrastructure Team
**Review Cadence**: On major Discord.js or Sietch version updates

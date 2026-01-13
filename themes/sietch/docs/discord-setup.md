# Discord Server Setup Guide

This guide documents the manual setup required for the Sietch Discord server.

## Server Structure

### Required Channels

| Channel | Type | Purpose |
|---------|------|---------|
| `#the-door` | Public/Private | Entry point - eligibility notifications, welcome messages |
| `#census` | Announcement | Leaderboard updates posted every 6 hours |
| `#rules` | Read-only | Server rules and guidelines |
| `#general` | Text | Main discussion channel for verified members |

### Required Roles

| Role | Color | Purpose |
|------|-------|---------|
| `Naib` | Gold/Yellow | Top 7 BGT holders (ranks 1-7) |
| `Fedaykin` | Blue | BGT holders ranked 8-69 |
| `Bot` | Gray | Bot service role |

## Bot Application Setup

### 1. Create Application

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Click "New Application"
3. Name: "Sietch Bot" (or your chosen name)
4. Accept the Terms of Service

### 2. Configure Bot

1. Navigate to the "Bot" section
2. Click "Add Bot"
3. Configure settings:
   - **Public Bot**: OFF (prevents others from adding your bot)
   - **Requires OAuth2 Code Grant**: OFF
   - **Presence Intent**: OFF
   - **Server Members Intent**: ON (required for member management)
   - **Message Content Intent**: OFF (not needed)

### 3. Get Bot Token

1. In the Bot section, click "Reset Token"
2. Copy the token securely
3. Add to environment variables as `DISCORD_BOT_TOKEN`

### 4. Generate Invite URL

1. Navigate to OAuth2 > URL Generator
2. Select scopes:
   - `bot`
   - `applications.commands`
3. Select bot permissions:
   - **General**: Read Messages/View Channels
   - **Text**: Send Messages, Embed Links, Attach Files, Read Message History
   - **Voice**: None needed
4. Copy the generated URL
5. Open URL and select your server

### 5. Get Required IDs

After inviting the bot, collect these IDs for configuration:

```bash
# Enable Developer Mode in Discord:
# User Settings > Advanced > Developer Mode

# Right-click server name > Copy ID
DISCORD_GUILD_ID=your_server_id

# Right-click each channel > Copy ID
DISCORD_CHANNEL_THE_DOOR=channel_id
DISCORD_CHANNEL_CENSUS=channel_id

# Right-click each role > Copy ID
DISCORD_ROLE_NAIB=role_id
DISCORD_ROLE_FEDAYKIN=role_id
```

## Channel Configuration

### #the-door

**Purpose**: Entry point for new members and eligibility notifications

**Permissions**:
- Everyone: Read Messages
- Bot: Send Messages, Embed Links

**Content to post**:
```
Welcome to the Sietch

You have been identified as one of the top 69 BGT stakers.

This is an exclusive community for the most committed BGT holders.

Rules:
1. Respect all members
2. No shilling or spam
3. What happens in the Sietch, stays in the Sietch

Your role will be assigned based on your rank:
- Naib (Top 20): Trusted advisors and decision makers
- Fedaykin (21-69): Valued community members

May your water never be taken.
```

### #census

**Purpose**: Automated leaderboard postings

**Permissions**:
- Everyone: Read Messages (no send)
- Bot: Send Messages, Embed Links

**Note**: Bot automatically posts rich embeds with the top 69 leaderboard every 6 hours.

### #rules

**Purpose**: Server rules and guidelines

**Permissions**:
- Everyone: Read Messages only
- Admins: Manage Messages

**Content to post**:
```
Sietch Rules

1. Eligibility
   - Only the top 69 BGT stakers are eligible
   - Rankings are updated every 6 hours
   - If you fall out of the top 69, you have a 24-hour grace period

2. Conduct
   - Treat all members with respect
   - No harassment, discrimination, or hate speech
   - Keep discussions constructive

3. Privacy
   - Do not share screenshots or content outside the Sietch
   - Wallet addresses are partially anonymized in public channels
   - Report any privacy concerns to moderators

4. Content
   - No shilling, spam, or unsolicited promotions
   - Stay on topic in designated channels
   - Use appropriate channels for different discussions

5. Enforcement
   - Violations may result in removal
   - Moderator decisions are final
   - Appeals can be made via DM to moderators

The spice must flow.
```

## Environment Variables

Add these to your `.env` file:

```bash
# Discord Configuration
DISCORD_BOT_TOKEN=your_bot_token_here
DISCORD_GUILD_ID=your_server_id_here
DISCORD_CHANNEL_THE_DOOR=the_door_channel_id
DISCORD_CHANNEL_CENSUS=census_channel_id
DISCORD_ROLE_NAIB=naib_role_id
DISCORD_ROLE_FEDAYKIN=fedaykin_role_id
```

## Verification Checklist

- [ ] Discord application created
- [ ] Bot added to application
- [ ] Server Members Intent enabled
- [ ] Bot token saved securely
- [ ] Bot invited to server
- [ ] All channels created
- [ ] All roles created
- [ ] Channel permissions configured
- [ ] Welcome message posted in #the-door
- [ ] Rules posted in #rules
- [ ] Environment variables configured
- [ ] Service started and bot shows online

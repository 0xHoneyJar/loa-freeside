# Getting Started with Gaib

This guide walks you through setting up Gaib and managing your first Discord server configuration.

## Prerequisites

1. **Node.js 18+** installed
2. **Discord Bot** with appropriate permissions
3. **Guild/Server ID** for the Discord server you want to manage

## Step 1: Create a Discord Bot

If you don't have a bot yet:

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications)
2. Click "New Application" and give it a name
3. Go to the "Bot" section
4. Click "Reset Token" and copy your bot token
5. Enable these Privileged Gateway Intents:
   - Server Members Intent (optional, for member-based features)
6. Under "Bot Permissions", select:
   - Manage Roles
   - Manage Channels
   - View Channels

## Step 2: Invite the Bot to Your Server

1. In the Developer Portal, go to OAuth2 > URL Generator
2. Select scopes: `bot`, `applications.commands`
3. Select permissions: `Manage Roles`, `Manage Channels`, `View Channels`
4. Copy the generated URL and open it in your browser
5. Select your server and authorize

## Step 3: Set Up Environment

```bash
# Set your bot token
export DISCORD_BOT_TOKEN="your-bot-token-here"

# Optionally set a default guild ID
export DISCORD_GUILD_ID="123456789012345678"
```

## Step 4: Initialize Your Project

```bash
# Create a new directory for your server config
mkdir my-discord-server
cd my-discord-server

# Initialize with the Sietch theme (Dune-inspired)
gaib server init --theme sietch --guild YOUR_GUILD_ID

# Or initialize a blank configuration
gaib server init --guild YOUR_GUILD_ID
```

This creates `discord-server.yaml` with your configuration.

## Step 5: Customize Your Configuration

Edit `discord-server.yaml`:

```yaml
version: "1.0"

server:
  name: "My Awesome Server"
  id: "123456789012345678"

# Use a theme for base configuration
theme:
  name: sietch
  variables:
    community_name: "My Community"
    primary_color: "#FF5500"

# Add custom roles (merge with theme)
roles:
  - name: "VIP [managed-by:arrakis-iac]"
    color: "#FFD700"
    hoist: true
    permissions:
      - VIEW_CHANNEL
      - SEND_MESSAGES
      - ATTACH_FILES

# Add custom channels (merge with theme)
channels:
  - name: "vip-lounge"
    type: text
    topic: "VIP members only [managed-by:arrakis-iac]"
    category: "The Gathering"
    permissions:
      VIP:
        allow: [VIEW_CHANNEL, SEND_MESSAGES]
      "@everyone":
        deny: [VIEW_CHANNEL]
```

## Step 6: Preview Changes

Before applying, always preview what will change:

```bash
gaib server plan
```

Output shows what will be created, updated, or deleted:

```
🔍 Execution Plan

  The following changes would be applied:

  3 to create, 0 to update, 0 to delete

Roles:
  + role: VIP [managed-by:arrakis-iac]

Channels:
  + channel: vip-lounge

Permissions:
  + permission: vip-lounge/VIP
  + permission: vip-lounge/@everyone
```

## Step 7: Apply Changes

When you're ready, apply the changes:

```bash
gaib server apply
```

You'll be prompted to confirm. To skip confirmation:

```bash
gaib server apply --auto-approve
```

## Step 8: Export Current State

To see what Gaib is managing:

```bash
gaib server state list
```

To export the current Discord state to YAML:

```bash
gaib server export --output exported.yaml
```

## Working with Workspaces

Use workspaces to manage different environments:

```bash
# Create a staging workspace
gaib server workspace new staging

# Switch to staging
gaib server workspace select staging

# List all workspaces
gaib server workspace list

# Show current workspace
gaib server workspace show
```

## Next Steps

- [Configuration Reference](./configuration.md) - Learn all configuration options
- [Theme Authoring](./themes.md) - Create your own themes
- [Command Reference](./commands.md) - All CLI commands

## Troubleshooting

### "Invalid or expired Discord bot token"

- Check your `DISCORD_BOT_TOKEN` environment variable
- Regenerate your token in the Discord Developer Portal

### "Bot is missing required permissions"

- Ensure your bot has `Manage Roles` and `Manage Channels` permissions
- The bot's role must be higher than roles it tries to manage
- Reinvite the bot with the correct permissions

### "Rate limited by Discord"

- Discord limits API requests
- Gaib automatically handles rate limits with exponential backoff
- For large changes, consider using `--parallelism=1` option

### "State is locked by another operation"

- Another Gaib process may be running
- Check with `gaib server lock-status`
- If stuck, use `gaib server force-unlock` (with caution)

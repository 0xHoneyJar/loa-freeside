# Configuration Reference

This document describes the complete Gaib configuration file format.

## File Structure

```yaml
version: "1.0"

server:
  name: "Server Name"
  id: "123456789012345678"

# Optional: Use a theme
theme:
  name: sietch
  variables:
    community_name: "My Community"

# Roles configuration
roles:
  - name: "Role Name [managed-by:arrakis-iac]"
    color: "#3498db"
    # ... role options

# Categories configuration
categories:
  - name: "Category Name [managed-by:arrakis-iac]"
    position: 0
    # ... category options

# Channels configuration
channels:
  - name: "channel-name"
    type: text
    # ... channel options
```

## Server Section

```yaml
server:
  name: "My Discord Server"  # Server name (informational)
  id: "123456789012345678"    # Guild ID (required for operations)
```

## Theme Section

Reference a theme for base configuration:

```yaml
theme:
  name: sietch              # Theme name
  variables:                # Override theme variables
    community_name: "My Community"
    primary_color: "#FF5500"
    welcome_message: "Hello!"
```

Theme configuration merges with your custom roles/channels. Custom definitions take precedence.

## Roles Configuration

```yaml
roles:
  - name: "Moderator [managed-by:arrakis-iac]"  # Name with managed marker
    color: "#3498db"                             # Hex color
    hoist: true                                  # Show separately in member list
    mentionable: false                           # Can be @mentioned
    position: 10                                 # Position (higher = higher rank)
    permissions:                                 # Permission flags
      - KICK_MEMBERS
      - BAN_MEMBERS
      - MANAGE_MESSAGES
      - MUTE_MEMBERS
```

### Role Permissions

Common permission flags:

| Permission | Description |
|------------|-------------|
| `ADMINISTRATOR` | Full administrator access |
| `MANAGE_GUILD` | Manage server settings |
| `MANAGE_ROLES` | Create/edit/delete roles |
| `MANAGE_CHANNELS` | Create/edit/delete channels |
| `KICK_MEMBERS` | Kick members |
| `BAN_MEMBERS` | Ban members |
| `MANAGE_MESSAGES` | Delete messages |
| `MUTE_MEMBERS` | Mute members in voice |
| `DEAFEN_MEMBERS` | Deafen members in voice |
| `MOVE_MEMBERS` | Move members between voice channels |
| `VIEW_CHANNEL` | View channels |
| `SEND_MESSAGES` | Send messages in text channels |
| `EMBED_LINKS` | Embed links in messages |
| `ATTACH_FILES` | Attach files |
| `ADD_REACTIONS` | Add reactions |
| `USE_EXTERNAL_EMOJIS` | Use emojis from other servers |
| `MENTION_EVERYONE` | Mention @everyone |
| `MANAGE_NICKNAMES` | Change other members' nicknames |
| `CONNECT` | Connect to voice channels |
| `SPEAK` | Speak in voice channels |
| `STREAM` | Stream video |
| `PRIORITY_SPEAKER` | Priority speaker in voice |

## Categories Configuration

```yaml
categories:
  - name: "Information [managed-by:arrakis-iac]"
    position: 0
    permissions:
      "@everyone":
        deny:
          - SEND_MESSAGES
      Moderator:
        allow:
          - MANAGE_CHANNELS
          - MANAGE_MESSAGES
```

## Channels Configuration

### Text Channels

```yaml
channels:
  - name: "general"
    type: text
    topic: "General discussion [managed-by:arrakis-iac]"
    category: "Information [managed-by:arrakis-iac]"  # Category name
    nsfw: false
    slowmode: 0                # Slowmode in seconds (0-21600)
    permissions:
      "@everyone":
        allow:
          - VIEW_CHANNEL
          - SEND_MESSAGES
        deny:
          - MENTION_EVERYONE
```

### Voice Channels

```yaml
channels:
  - name: "Voice Chat"
    type: voice
    topic: "[managed-by:arrakis-iac]"
    category: "Voice [managed-by:arrakis-iac]"
    bitrate: 64000            # Bitrate in bps (8000-384000)
    user_limit: 10            # Max users (0 = unlimited)
    permissions:
      "@everyone":
        allow:
          - VIEW_CHANNEL
          - CONNECT
          - SPEAK
```

### Announcement Channels

```yaml
channels:
  - name: "announcements"
    type: announcement
    topic: "Official announcements [managed-by:arrakis-iac]"
    category: "Information [managed-by:arrakis-iac]"
    permissions:
      "@everyone":
        deny:
          - SEND_MESSAGES
      Moderator:
        allow:
          - SEND_MESSAGES
```

### Forum Channels

```yaml
channels:
  - name: "ideas"
    type: forum
    topic: "Share your ideas [managed-by:arrakis-iac]"
    category: "Community [managed-by:arrakis-iac]"
```

### Stage Channels

```yaml
channels:
  - name: "Town Hall"
    type: stage
    topic: "Community events [managed-by:arrakis-iac]"
    category: "Events [managed-by:arrakis-iac]"
```

## Permission Overwrites

Channel-level permissions override role permissions:

```yaml
permissions:
  "@everyone":              # Everyone role
    allow:
      - VIEW_CHANNEL
    deny:
      - SEND_MESSAGES

  "Role Name":              # Specific role
    allow:
      - SEND_MESSAGES
      - ATTACH_FILES
    deny: []
```

## Managed Marker

Resources managed by Gaib should include `[managed-by:arrakis-iac]` in their name or topic:

```yaml
roles:
  - name: "Admin [managed-by:arrakis-iac]"

categories:
  - name: "General [managed-by:arrakis-iac]"

channels:
  - name: "chat"
    topic: "General chat [managed-by:arrakis-iac]"
```

The `--managed-only` flag (default: true) ensures only marked resources are modified.

## Backend Configuration

For remote state storage (optional):

```yaml
backend:
  s3:
    bucket: "my-gaib-state"
    region: "us-east-1"
    key_prefix: "discord/"
    dynamodb_table: "gaib-locks"  # For state locking
    encrypt: true
    kms_key_id: "alias/gaib"      # Optional KMS key
```

Or local backend (default):

```yaml
backend:
  local:
    path: ".gaib"
```

## Complete Example

```yaml
version: "1.0"

server:
  name: "My Gaming Community"
  id: "123456789012345678"

theme:
  name: sietch
  variables:
    community_name: "My Gaming Community"
    primary_color: "#7289DA"

# Custom roles to add
roles:
  - name: "Streamer [managed-by:arrakis-iac]"
    color: "#9146FF"
    hoist: true
    permissions:
      - PRIORITY_SPEAKER
      - STREAM

# Custom channels to add
channels:
  - name: "stream-announcements"
    type: text
    topic: "Stream notifications [managed-by:arrakis-iac]"
    category: "The Gathering"
    permissions:
      Streamer:
        allow:
          - SEND_MESSAGES
          - MENTION_EVERYONE
      "@everyone":
        deny:
          - SEND_MESSAGES
```

## Environment Variables

Configuration values can reference environment variables:

```yaml
server:
  id: "${DISCORD_GUILD_ID}"

backend:
  s3:
    bucket: "${GAIB_STATE_BUCKET}"
```

## Validation

Validate your configuration without applying:

```bash
gaib server plan --dry-run
```

This checks:
- YAML syntax
- Schema validation
- Theme resolution
- Permission flags

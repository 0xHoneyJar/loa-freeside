# Theme Authoring Guide

This guide explains how to create reusable themes for Gaib server configurations.

## What is a Theme?

A theme is a reusable server configuration template that defines roles, categories, channels, and permissions. Themes allow you to:

- Share server layouts across multiple Discord servers
- Create consistent branding and structure
- Use variables for customization without editing the theme

## Theme Structure

Themes are stored in the `themes/` directory (configurable):

```
themes/
├── sietch/
│   ├── theme.yaml       # Theme metadata
│   └── config.yaml      # Server configuration
└── my-custom-theme/
    ├── theme.yaml
    └── config.yaml
```

### theme.yaml

Theme metadata file:

```yaml
name: sietch
version: "1.0.0"
description: "Dune-inspired community server template"
author: "0xHoneyJar"

# Define variables users can override
variables:
  community_name:
    type: string
    default: "The Sietch"
    description: "Name of the community"

  primary_color:
    type: color
    default: "#D4A574"
    description: "Primary brand color for roles"

  welcome_message:
    type: string
    default: "Welcome to the desert of the real"
    description: "Message shown in welcome channel topic"

  enable_voice:
    type: boolean
    default: true
    description: "Include voice channels"

# Optional: Required bot permissions
permissions:
  - MANAGE_ROLES
  - MANAGE_CHANNELS
  - VIEW_CHANNELS
```

### config.yaml

The server configuration using variables:

```yaml
version: "1.0"

roles:
  - name: "Naib [managed-by:arrakis-iac]"
    color: "{{primary_color}}"
    hoist: true
    position: 100
    permissions:
      - ADMINISTRATOR

  - name: "Fedaykin [managed-by:arrakis-iac]"
    color: "{{primary_color}}"
    hoist: true
    position: 90
    permissions:
      - KICK_MEMBERS
      - BAN_MEMBERS
      - MANAGE_MESSAGES

  - name: "Fremen [managed-by:arrakis-iac]"
    color: "#B8860B"
    hoist: false
    position: 10
    permissions:
      - VIEW_CHANNEL
      - SEND_MESSAGES

categories:
  - name: "The Gathering [managed-by:arrakis-iac]"
    position: 0
    permissions:
      "@everyone":
        allow:
          - VIEW_CHANNEL

  - name: "The Council [managed-by:arrakis-iac]"
    position: 1
    permissions:
      "@everyone":
        deny:
          - VIEW_CHANNEL
      Fedaykin:
        allow:
          - VIEW_CHANNEL

channels:
  - name: "welcome"
    type: text
    topic: "{{welcome_message}} [managed-by:arrakis-iac]"
    category: "The Gathering [managed-by:arrakis-iac]"
    permissions:
      "@everyone":
        deny:
          - SEND_MESSAGES

  - name: "general"
    type: text
    topic: "General discussion for {{community_name}} [managed-by:arrakis-iac]"
    category: "The Gathering [managed-by:arrakis-iac]"

  - name: "council-chamber"
    type: text
    topic: "Private discussions [managed-by:arrakis-iac]"
    category: "The Council [managed-by:arrakis-iac]"

  # Conditional voice channels
  {{#if enable_voice}}
  - name: "Voice Chat"
    type: voice
    topic: "[managed-by:arrakis-iac]"
    category: "The Gathering [managed-by:arrakis-iac]"
    bitrate: 64000
  {{/if}}
```

## Using a Theme

### Initialize with a Theme

```bash
gaib server init --theme sietch --guild YOUR_GUILD_ID
```

This creates `discord-server.yaml`:

```yaml
version: "1.0"

server:
  name: "My Server"
  id: "YOUR_GUILD_ID"

theme:
  name: sietch
  variables:
    community_name: "My Community"
    primary_color: "#FF5500"
```

### Override Theme Variables

Customize the theme by setting variables:

```yaml
theme:
  name: sietch
  variables:
    community_name: "Spice Traders Guild"
    primary_color: "#9B59B6"
    welcome_message: "The spice must flow!"
    enable_voice: false
```

### Extend the Theme

Add custom roles and channels that merge with the theme:

```yaml
version: "1.0"

server:
  name: "My Server"
  id: "123456789012345678"

theme:
  name: sietch
  variables:
    community_name: "Spice Traders"

# Custom additions (merged with theme)
roles:
  - name: "Merchant [managed-by:arrakis-iac]"
    color: "#27AE60"
    hoist: true
    position: 50
    permissions:
      - VIEW_CHANNEL
      - SEND_MESSAGES
      - ATTACH_FILES

channels:
  - name: "trading-post"
    type: text
    topic: "Buy, sell, trade [managed-by:arrakis-iac]"
    category: "The Gathering [managed-by:arrakis-iac]"
```

## Creating Your Own Theme

### Step 1: Create Theme Directory

```bash
mkdir -p themes/my-theme
```

### Step 2: Create theme.yaml

```yaml
name: my-theme
version: "1.0.0"
description: "My custom server template"
author: "Your Name"

variables:
  server_name:
    type: string
    default: "My Server"
    description: "The server name"

  accent_color:
    type: color
    default: "#3498DB"
    description: "Accent color for roles"
```

### Step 3: Create config.yaml

```yaml
version: "1.0"

roles:
  - name: "Admin [managed-by:arrakis-iac]"
    color: "{{accent_color}}"
    hoist: true
    position: 100
    permissions:
      - ADMINISTRATOR

  - name: "Member [managed-by:arrakis-iac]"
    color: "#95A5A6"
    hoist: false
    position: 10

categories:
  - name: "General [managed-by:arrakis-iac]"
    position: 0

channels:
  - name: "chat"
    type: text
    topic: "Welcome to {{server_name}} [managed-by:arrakis-iac]"
    category: "General [managed-by:arrakis-iac]"
```

### Step 4: Test Your Theme

```bash
# Initialize a test config
gaib server init --theme my-theme --guild TEST_GUILD_ID

# Preview what would be created
gaib server plan --dry-run
```

## Variable Types

| Type | Description | Example |
|------|-------------|---------|
| `string` | Text value | `"My Server"` |
| `color` | Hex color code | `"#FF5500"` |
| `boolean` | True/false | `true` |
| `number` | Numeric value | `64000` |

## Template Syntax

Themes use Handlebars-style template syntax:

### Variable Substitution

```yaml
topic: "Welcome to {{community_name}}"
```

### Conditionals

```yaml
{{#if enable_feature}}
- name: "optional-channel"
  type: text
{{/if}}
```

### Default Values

```yaml
color: "{{accent_color | default: '#3498DB'}}"
```

## Merge Behavior

When using a theme with custom additions:

1. **Roles**: Custom roles are added; if names match, custom config wins
2. **Categories**: Same as roles
3. **Channels**: Same as roles
4. **Permissions**: Deep merged; explicit settings override theme

### Merge Example

Theme defines:
```yaml
roles:
  - name: "Admin [managed-by:arrakis-iac]"
    color: "#FF0000"
    permissions:
      - ADMINISTRATOR
```

User config:
```yaml
roles:
  - name: "Admin [managed-by:arrakis-iac]"
    color: "#00FF00"  # Override color only
```

Result:
```yaml
roles:
  - name: "Admin [managed-by:arrakis-iac]"
    color: "#00FF00"  # From user
    permissions:
      - ADMINISTRATOR  # From theme
```

## Best Practices

### Use Descriptive Variable Names

```yaml
# Good
variables:
  moderator_role_color:
    type: color
    default: "#E74C3C"

# Avoid
variables:
  color1:
    type: color
```

### Provide Sensible Defaults

Every variable should have a working default value:

```yaml
variables:
  welcome_channel_slowmode:
    type: number
    default: 5
    description: "Slowmode in seconds (0-21600)"
```

### Document Your Theme

Include a README.md in your theme directory:

```markdown
# My Theme

A brief description of what this theme provides.

## Variables

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `community_name` | string | "My Community" | ... |

## Included Resources

- 3 roles: Admin, Moderator, Member
- 2 categories: General, Staff
- 5 channels: welcome, general, announcements, staff-chat, logs
```

### Version Your Themes

Use semantic versioning:

```yaml
version: "1.0.0"  # Major.Minor.Patch
```

- **Major**: Breaking changes (renamed variables, removed resources)
- **Minor**: New features (new variables, new optional resources)
- **Patch**: Bug fixes

## Sharing Themes

### Local Themes

Place themes in your project's `themes/` directory.

### Global Themes

Configure a global themes directory:

```yaml
# gaib.yaml
themes:
  directories:
    - ./themes
    - ~/.gaib/themes
    - /opt/gaib/themes
```

### Publishing Themes

Share your theme by:

1. Creating a Git repository
2. Publishing to npm (if using the Gaib themes registry)
3. Sharing the theme directory directly

## Troubleshooting

### "Theme not found"

- Check the theme name matches the directory name
- Verify the themes directory is configured correctly
- Ensure theme.yaml exists in the theme directory

### "Invalid variable type"

- Check the variable type in theme.yaml
- Ensure the value matches the expected type (e.g., colors start with #)

### "Template rendering failed"

- Check for unclosed template tags (`{{` without `}}`)
- Verify all referenced variables are defined
- Check for syntax errors in conditionals

# Gaib - Discord Infrastructure as Code

Gaib is a CLI tool that lets you manage your Discord server configuration using declarative YAML files, similar to Terraform. Define your roles, channels, and permissions as code, track changes, and apply them safely.

## Features

- **Declarative Configuration**: Define your Discord server structure in YAML
- **Terraform-like Workflow**: Plan, apply, and destroy operations
- **State Management**: Track what resources are managed by Gaib
- **Workspaces**: Manage multiple environments (dev, staging, production)
- **Themes**: Reusable server configuration templates
- **Remote State**: Optional S3 backend with DynamoDB locking

## Quick Start

### 1. Initialize Configuration

```bash
# Initialize with a theme
gaib server init --theme sietch --guild YOUR_GUILD_ID

# Or create a blank configuration
gaib server init --guild YOUR_GUILD_ID
```

### 2. Preview Changes

```bash
gaib server plan
```

### 3. Apply Changes

```bash
gaib server apply
```

## Documentation

- [Getting Started](./getting-started.md) - Installation and first steps
- [Configuration Reference](./configuration.md) - Complete YAML configuration guide
- [Theme Authoring](./themes.md) - Creating reusable server templates
- [Command Reference](./commands.md) - All CLI commands

## Requirements

- Node.js 18+
- Discord bot with the following permissions:
  - Manage Roles
  - Manage Channels
  - View Channels

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `DISCORD_BOT_TOKEN` | Your Discord bot token | Yes |
| `DISCORD_GUILD_ID` | Default guild ID (can be overridden) | No |
| `AWS_REGION` | AWS region for S3 backend | For S3 |
| `AWS_ACCESS_KEY_ID` | AWS credentials | For S3 |
| `AWS_SECRET_ACCESS_KEY` | AWS credentials | For S3 |

## Support

- Issues: https://github.com/0xHoneyJar/arrakis/issues
- Documentation: This directory

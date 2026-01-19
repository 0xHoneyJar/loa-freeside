# Command Reference

Complete reference for all Gaib CLI commands.

## Global Options

These options are available for all commands:

| Option | Description |
|--------|-------------|
| `--json` | Output in JSON format for machine parsing |
| `--help` | Show help for the command |
| `--version` | Show version information |

## Server Commands

All server management commands are under `gaib server`.

### gaib server init

Initialize a new server configuration.

```bash
gaib server init [options]
```

**Options:**

| Option | Description | Default |
|--------|-------------|---------|
| `--guild <id>` | Discord guild ID | `$DISCORD_GUILD_ID` |
| `--theme <name>` | Use a theme template | none |
| `--output <file>` | Output file path | `discord-server.yaml` |
| `--force` | Overwrite existing file | false |

**Examples:**

```bash
# Initialize with a theme
gaib server init --theme sietch --guild 123456789012345678

# Initialize blank configuration
gaib server init --guild 123456789012345678

# Custom output file
gaib server init --guild 123456789012345678 --output my-server.yaml
```

### gaib server plan

Show execution plan without applying changes.

```bash
gaib server plan [options]
```

**Options:**

| Option | Description | Default |
|--------|-------------|---------|
| `--config <file>` | Configuration file | `discord-server.yaml` |
| `--workspace <name>` | Use specific workspace | `default` |
| `--managed-only` | Only show managed resources | true |
| `--dry-run` | Validate config without Discord API | false |
| `--json` | Output in JSON format | false |

**Examples:**

```bash
# Show plan
gaib server plan

# Validate config without connecting to Discord
gaib server plan --dry-run

# JSON output for CI/CD
gaib server plan --json
```

**Output Format:**

```
🔍 Execution Plan

  The following changes would be applied:

  3 to create, 1 to update, 0 to delete

Roles:
  + role: VIP [managed-by:arrakis-iac]

Channels:
  + channel: vip-lounge
  ~ channel: general
      topic: "Old topic" → "New topic"
```

### gaib server apply

Apply configuration changes to Discord.

```bash
gaib server apply [options]
```

**Options:**

| Option | Description | Default |
|--------|-------------|---------|
| `--config <file>` | Configuration file | `discord-server.yaml` |
| `--workspace <name>` | Use specific workspace | `default` |
| `--auto-approve` | Skip confirmation prompt | false |
| `--parallelism <n>` | Parallel operations | 5 |
| `--managed-only` | Only modify managed resources | true |
| `--json` | Output in JSON format | false |

**Examples:**

```bash
# Apply with confirmation
gaib server apply

# Apply without confirmation (CI/CD)
gaib server apply --auto-approve

# Slower apply to avoid rate limits
gaib server apply --parallelism 1

# JSON output
gaib server apply --json --auto-approve
```

**Output Format:**

```
✓ Apply Complete!

  3 created
  1 updated
  0 deleted

  Duration: 2.34s
```

### gaib server destroy

Remove all managed resources from Discord.

```bash
gaib server destroy [options]
```

**Options:**

| Option | Description | Default |
|--------|-------------|---------|
| `--config <file>` | Configuration file | `discord-server.yaml` |
| `--workspace <name>` | Use specific workspace | `default` |
| `--auto-approve` | Skip confirmation prompt | false |
| `--json` | Output in JSON format | false |

**Examples:**

```bash
# Destroy with confirmation
gaib server destroy

# Destroy without confirmation
gaib server destroy --auto-approve
```

**Warning:** This command removes all resources marked with `[managed-by:arrakis-iac]` from your Discord server.

### gaib server export

Export current Discord server state to YAML.

```bash
gaib server export [options]
```

**Options:**

| Option | Description | Default |
|--------|-------------|---------|
| `--guild <id>` | Discord guild ID | `$DISCORD_GUILD_ID` |
| `--output <file>` | Output file path | stdout |
| `--managed-only` | Only export managed resources | false |
| `--json` | Output in JSON format | false |

**Examples:**

```bash
# Export to file
gaib server export --output current-state.yaml

# Export only managed resources
gaib server export --managed-only --output managed.yaml

# Export to stdout
gaib server export
```

## State Commands

Commands for managing Gaib state.

### gaib server state list

List all resources in state.

```bash
gaib server state list [options]
```

**Options:**

| Option | Description | Default |
|--------|-------------|---------|
| `--workspace <name>` | Use specific workspace | `default` |
| `--json` | Output in JSON format | false |

**Examples:**

```bash
# List resources
gaib server state list

# JSON output
gaib server state list --json
```

**Output Format:**

```
ℹ Workspace: default
  State serial: 5

  role:
  Admin [managed-by:arrakis-iac]  1234567890  Admin [managed-by:arrakis-iac]
  Member [managed-by:arrakis-iac] 1234567891  Member [managed-by:arrakis-iac]

  channel:
  general                         1234567892  general

Total: 3 resource(s)
```

### gaib server state show

Show details for a specific resource.

```bash
gaib server state show <address> [options]
```

**Arguments:**

| Argument | Description |
|----------|-------------|
| `address` | Resource address (e.g., `role.Admin`) |

**Options:**

| Option | Description | Default |
|--------|-------------|---------|
| `--workspace <name>` | Use specific workspace | `default` |
| `--json` | Output in JSON format | false |

**Examples:**

```bash
# Show role details
gaib server state show "role.Admin [managed-by:arrakis-iac]"

# Show channel details
gaib server state show channel.general
```

### gaib server state rm

Remove a resource from state (does not delete from Discord).

```bash
gaib server state rm <address> [options]
```

**Arguments:**

| Argument | Description |
|----------|-------------|
| `address` | Resource address to remove |

**Options:**

| Option | Description | Default |
|--------|-------------|---------|
| `--workspace <name>` | Use specific workspace | `default` |
| `--json` | Output in JSON format | false |

**Examples:**

```bash
# Remove a resource from tracking
gaib server state rm channel.old-channel
```

### gaib server state import

Import an existing Discord resource into state.

```bash
gaib server state import <type> <discord_id> <name> [options]
```

**Arguments:**

| Argument | Description |
|----------|-------------|
| `type` | Resource type (role, category, channel) |
| `discord_id` | Discord snowflake ID |
| `name` | Name for the resource in state |

**Options:**

| Option | Description | Default |
|--------|-------------|---------|
| `--workspace <name>` | Use specific workspace | `default` |
| `--json` | Output in JSON format | false |

**Examples:**

```bash
# Import an existing role
gaib server state import role 1234567890 "Admin [managed-by:arrakis-iac]"
```

## Workspace Commands

Commands for managing workspaces.

### gaib server workspace list

List all workspaces.

```bash
gaib server workspace list [options]
```

**Options:**

| Option | Description | Default |
|--------|-------------|---------|
| `--json` | Output in JSON format | false |

### gaib server workspace new

Create a new workspace.

```bash
gaib server workspace new <name> [options]
```

**Arguments:**

| Argument | Description |
|----------|-------------|
| `name` | Name for the new workspace |

**Options:**

| Option | Description | Default |
|--------|-------------|---------|
| `--json` | Output in JSON format | false |

**Examples:**

```bash
# Create staging workspace
gaib server workspace new staging
```

### gaib server workspace select

Switch to a workspace.

```bash
gaib server workspace select <name> [options]
```

**Arguments:**

| Argument | Description |
|----------|-------------|
| `name` | Workspace name to select |

**Examples:**

```bash
# Switch to staging
gaib server workspace select staging
```

### gaib server workspace show

Show current workspace.

```bash
gaib server workspace show [options]
```

**Options:**

| Option | Description | Default |
|--------|-------------|---------|
| `--json` | Output in JSON format | false |

### gaib server workspace delete

Delete a workspace.

```bash
gaib server workspace delete <name> [options]
```

**Arguments:**

| Argument | Description |
|----------|-------------|
| `name` | Workspace name to delete |

**Options:**

| Option | Description | Default |
|--------|-------------|---------|
| `--force` | Delete without confirmation | false |
| `--json` | Output in JSON format | false |

## Lock Commands

Commands for managing state locks.

### gaib server lock-status

Check if state is locked.

```bash
gaib server lock-status [options]
```

**Options:**

| Option | Description | Default |
|--------|-------------|---------|
| `--workspace <name>` | Use specific workspace | `default` |
| `--json` | Output in JSON format | false |

### gaib server force-unlock

Force unlock a stuck state lock.

```bash
gaib server force-unlock [options]
```

**Options:**

| Option | Description | Default |
|--------|-------------|---------|
| `--workspace <name>` | Use specific workspace | `default` |
| `--lock-id <id>` | Specific lock ID to release | current lock |
| `--json` | Output in JSON format | false |

**Warning:** Only use this if you're certain no other operation is running.

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | General error |
| 2 | Configuration error |
| 3 | State error |
| 4 | Discord API error |
| 5 | Lock error |
| 6 | Validation error |

## Environment Variables

| Variable | Description |
|----------|-------------|
| `DISCORD_BOT_TOKEN` | Discord bot authentication token |
| `DISCORD_GUILD_ID` | Default guild ID |
| `GAIB_CONFIG` | Default config file path |
| `GAIB_WORKSPACE` | Default workspace name |
| `AWS_REGION` | AWS region for S3 backend |
| `AWS_ACCESS_KEY_ID` | AWS credentials for S3 |
| `AWS_SECRET_ACCESS_KEY` | AWS credentials for S3 |
| `NO_COLOR` | Disable colored output |

## JSON Output

All commands support `--json` for machine-readable output:

```bash
gaib server plan --json | jq '.summary'
```

**Success Response:**

```json
{
  "success": true,
  "data": { ... }
}
```

**Error Response:**

```json
{
  "success": false,
  "error": {
    "code": "E1001",
    "message": "Configuration file not found",
    "suggestion": "Run 'gaib server init' to create one"
  }
}
```

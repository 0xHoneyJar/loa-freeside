# Command Reference

Complete reference for all Gaib CLI commands.

## Global Options

These options are available for all commands:

| Option | Description |
|--------|-------------|
| `--no-color` | Disable colored output |
| `-q, --quiet` | Suppress non-essential output |
| `--json` | Output in JSON format for machine parsing |
| `--help` | Show help for the command |
| `--version` | Show version information |

---

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
| `-g, --guild <id>` | Discord guild ID | `$DISCORD_GUILD_ID` |
| `-t, --theme <name>` | Use a theme template | none |
| `-f, --file <path>` | Output file path | `discord-server.yaml` |
| `--force` | Overwrite existing file | false |
| `--json` | Output as JSON | false |

**Examples:**

```bash
# Initialize with a theme
gaib server init --theme sietch --guild 123456789012345678

# Initialize blank configuration
gaib server init --guild 123456789012345678

# Custom output file
gaib server init --guild 123456789012345678 --file my-server.yaml
```

### gaib server plan

Show execution plan without applying changes.

```bash
gaib server plan [options]
```

**Options:**

| Option | Description | Default |
|--------|-------------|---------|
| `-f, --file <path>` | Configuration file | `discord-server.yaml` |
| `-g, --guild <id>` | Override guild ID from config | - |
| `-w, --workspace <name>` | Use specific workspace | `default` |
| `--managed-only` | Only show managed resources | true |
| `--json` | Output in JSON format | false |

**Examples:**

```bash
# Show plan
gaib server plan

# Use specific config file
gaib server plan -f config.yaml

# JSON output for CI/CD
gaib server plan --json
```

### gaib server diff

Show detailed diff between config and current state.

```bash
gaib server diff [options]
```

**Options:**

| Option | Description | Default |
|--------|-------------|---------|
| `-f, --file <path>` | Configuration file | `discord-server.yaml` |
| `-g, --guild <id>` | Override guild ID from config | - |
| `-w, --workspace <name>` | Use specific workspace | `default` |
| `--no-permissions` | Exclude permission changes | false |
| `--managed-only` | Only show managed resources | true |
| `--json` | Output diff as JSON | false |

### gaib server apply

Apply configuration changes to Discord.

```bash
gaib server apply [options]
```

**Options:**

| Option | Description | Default |
|--------|-------------|---------|
| `-f, --file <path>` | Configuration file | `discord-server.yaml` |
| `-g, --guild <id>` | Override guild ID from config | - |
| `-w, --workspace <name>` | Use specific workspace | `default` |
| `--auto-approve` | Skip confirmation prompt | false |
| `--dry-run` | Show what would be applied | false |
| `--managed-only` | Only modify managed resources | true |
| `--json` | Output in JSON format | false |

**Examples:**

```bash
# Apply with confirmation
gaib server apply

# Apply without confirmation (CI/CD)
gaib server apply --auto-approve

# JSON output
gaib server apply --json --auto-approve
```

### gaib server destroy

Remove all managed resources from Discord.

```bash
gaib server destroy [options]
```

**Options:**

| Option | Description | Default |
|--------|-------------|---------|
| `-g, --guild <id>` | Discord guild/server ID (required) | - |
| `-w, --workspace <name>` | Use specific workspace | `default` |
| `--auto-approve` | Skip confirmation prompt | false |
| `--dry-run` | Show what would be destroyed | false |
| `-t, --target <types...>` | Target specific resource types | all |
| `--json` | Output in JSON format | false |

**Warning:** This command removes all resources marked with `[managed-by:arrakis-iac]` from your Discord server.

### gaib server teardown

**DANGEROUS:** Delete ALL server resources (not just managed ones).

```bash
gaib server teardown [options]
```

**Options:**

| Option | Description | Default |
|--------|-------------|---------|
| `-g, --guild <id>` | Discord guild/server ID (required) | - |
| `--confirm-teardown` | Required flag to enable teardown | false |
| `--dry-run` | Show what would be deleted | false |
| `--preserve-categories <names...>` | Categories to preserve | none |
| `--force` | Skip interactive prompts | false |
| `--json` | Output in JSON format | false |

**Safety Requirements:**

1. You MUST pass `--confirm-teardown` flag
2. You MUST type the server name exactly
3. You MUST enter a random 6-digit confirmation code
4. You MUST type "TEARDOWN" to execute

**Examples:**

```bash
# Preview what would be deleted
gaib server teardown --guild 123456789 --dry-run

# Execute teardown
gaib server teardown --guild 123456789 --confirm-teardown

# Preserve specific categories
gaib server teardown --guild 123456789 --confirm-teardown --preserve-categories "archived"
```

### gaib server export

Export current Discord server state to YAML.

```bash
gaib server export [options]
```

**Options:**

| Option | Description | Default |
|--------|-------------|---------|
| `-g, --guild <id>` | Discord guild/server ID | `$DISCORD_GUILD_ID` |
| `-o, --output <path>` | Output file path | stdout |
| `--include-unmanaged` | Include unmanaged resources | false |
| `--json` | Output as JSON instead of YAML | false |

---

## Workspace Commands

Workspace management commands are under `gaib server workspace`.

### gaib server workspace ls

List all workspaces.

```bash
gaib server workspace ls [options]
```

### gaib server workspace new

Create a new workspace and switch to it.

```bash
gaib server workspace new <name> [options]
```

**Examples:**

```bash
# Create staging workspace
gaib server workspace new staging
```

### gaib server workspace use

Switch to a workspace.

```bash
gaib server workspace use <name> [options]
```

**Options:**

| Option | Description |
|--------|-------------|
| `-c, --create` | Create workspace if it doesn't exist |
| `--json` | Output as JSON |

**Examples:**

```bash
# Switch to staging
gaib server workspace use staging

# Switch or create
gaib server workspace use staging --create
```

### gaib server workspace show

Show workspace details (defaults to current workspace).

```bash
gaib server workspace show [name] [options]
```

### gaib server workspace rm

Delete a workspace.

```bash
gaib server workspace rm <name> [options]
```

**Options:**

| Option | Description |
|--------|-------------|
| `-f, --force` | Delete without confirmation |
| `-y, --yes` | Skip confirmation prompt |
| `--json` | Output as JSON |

---

## State Commands

State management commands are under `gaib server state`.

### gaib server state ls

List all resources in state.

```bash
gaib server state ls [options]
```

**Options:**

| Option | Description | Default |
|--------|-------------|---------|
| `-w, --workspace <name>` | Use specific workspace | `default` |
| `--json` | Output in JSON format | false |

### gaib server state show

Show detailed information about a resource.

```bash
gaib server state show <address> [options]
```

**Arguments:**

| Argument | Description |
|----------|-------------|
| `address` | Resource address (e.g., `role.Admin`) |

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

**Options:**

| Option | Description |
|--------|-------------|
| `-w, --workspace <name>` | Use specific workspace |
| `-y, --yes` | Skip confirmation prompt |
| `--json` | Output as JSON |

### gaib server state mv

Move/rename a resource address in state.

```bash
gaib server state mv <source> <destination> [options]
```

### gaib server state pull

Refresh state from Discord (updates all resource attributes).

```bash
gaib server state pull [options]
```

**Options:**

| Option | Description |
|--------|-------------|
| `-g, --guild <id>` | Discord guild/server ID (required) |
| `-w, --workspace <name>` | Use specific workspace |
| `--json` | Output as JSON |

---

## Import Command

### gaib server import

Import an existing Discord resource into state.

```bash
gaib server import <address> <id> [options]
```

**Arguments:**

| Argument | Description |
|----------|-------------|
| `address` | Resource address (e.g., `role.Admin`) |
| `id` | Discord snowflake ID |

**Options:**

| Option | Description |
|--------|-------------|
| `-g, --guild <id>` | Discord guild/server ID (required) |
| `-w, --workspace <name>` | Use specific workspace |
| `--json` | Output as JSON |

**Examples:**

```bash
# Import an existing role
gaib server import role.Admin 1234567890 --guild 123456789
```

---

## Lock Commands

### gaib server locks

Show lock status for the current workspace.

```bash
gaib server locks [options]
```

**Options:**

| Option | Description |
|--------|-------------|
| `-w, --workspace <name>` | Use specific workspace |
| `--json` | Output as JSON |

### gaib server unlock

Force release a stuck state lock.

```bash
gaib server unlock [options]
```

**Options:**

| Option | Description |
|--------|-------------|
| `-w, --workspace <name>` | Use specific workspace |
| `-y, --yes` | Skip confirmation prompt |
| `--json` | Output as JSON |

**Warning:** Only use this if you're certain no other operation is running.

---

## Theme Commands

Theme management commands are under `gaib server theme`.

### gaib server theme ls

List available themes.

```bash
gaib server theme ls [options]
```

### gaib server theme info

Show detailed information about a theme.

```bash
gaib server theme info <name> [options]
```

---

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

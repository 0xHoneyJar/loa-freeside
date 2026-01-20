# gaib CLI Reference

> **Voice from the Outer World** - The Arrakis Developer CLI

## Overview

`gaib` (pronounced "gibe") is the command-line interface for managing Arrakis Discord bot development environments. The name derives from "Lisan al-Gaib" (لسان الغيب) - the Fremen term for "Voice from the Outer World" in Frank Herbert's *Dune*.

### Etymology

| Aspect | Details |
|--------|---------|
| **Arabic** | الغيب (*al-ghayb*) = "the unseen" / "the hidden" |
| **Dune** | "Lisan al-Gaib" = Voice from the Outer World |
| **Meaning** | Fremen prophecy of an off-world messiah |
| **CLI Context** | Managing sandboxed (isolated/hidden) Discord servers |

The name maintains thematic consistency with the Arrakis project while reflecting the CLI's role in managing isolated testing environments.

## Installation

```bash
# From the packages/cli directory
npm install
npm run build

# Link globally (optional)
npm link
```

## Command Groups

The CLI is organized into four command groups:

| Group | Description |
|-------|-------------|
| `gaib auth` | CLI session management (login/logout/whoami) |
| `gaib user` | User account management (admin only) |
| `gaib sandbox` | Sandbox environment management |
| `gaib server` | Discord Infrastructure-as-Code |

---

## gaib auth

Authentication management for local user accounts.

### Global Options

| Option | Description |
|--------|-------------|
| `--no-color` | Disable colored output |
| `-q, --quiet` | Suppress non-essential output |
| `--server <url>` | API server URL |

### gaib auth login

Log in with username and password.

```bash
gaib auth login [options]
```

| Option | Description |
|--------|-------------|
| `-u, --username <username>` | Username (prompts if not provided) |
| `--server <url>` | API server URL |
| `--json` | Output as JSON |

**Examples:**

```bash
# Interactive login
gaib auth login

# Login with specified username
gaib auth login -u testuser

# Use custom server
gaib auth login --server https://api.example.com
```

### gaib auth logout

Log out and clear stored credentials.

```bash
gaib auth logout [options]
```

| Option | Description |
|--------|-------------|
| `--json` | Output as JSON |

### gaib auth whoami

Display current authentication status.

```bash
gaib auth whoami [options]
```

| Option | Description |
|--------|-------------|
| `--json` | Output as JSON |

---

## gaib user

User account management (requires `admin` or `qa_admin` role).

### Global Options

| Option | Description |
|--------|-------------|
| `--no-color` | Disable colored output |
| `-q, --quiet` | Suppress non-essential output |
| `--server <url>` | API server URL |

### gaib user create

Create a new user account.

```bash
gaib user create [options]
```

| Option | Description | Default |
|--------|-------------|---------|
| `--username <username>` | Username (required, 3-32 alphanumeric/underscore) | - |
| `--roles <roles>` | Comma-separated roles | `qa_tester` |
| `--display-name <name>` | Display name | - |
| `--sandbox-access <ids>` | Comma-separated sandbox IDs | - |
| `--json` | Output as JSON | - |

**Examples:**

```bash
# Create QA tester
gaib user create --username testuser --roles qa_tester

# Create admin with display name
gaib user create --username admin --roles admin --display-name "Admin User"

# Create user with sandbox access
gaib user create --username qa1 --roles qa_tester --sandbox-access sb_123,sb_456
```

### gaib user ls

List users.

```bash
gaib user ls [options]
```

| Option | Description |
|--------|-------------|
| `--role <role>` | Filter by role (qa_tester, qa_admin, admin) |
| `--active` | Show only active users |
| `--inactive` | Show only inactive users |
| `--search <query>` | Search by username |
| `--limit <number>` | Maximum results (default: 20) |
| `--offset <number>` | Skip first N results |
| `--json` | Output as JSON |

### gaib user show

Show user details.

```bash
gaib user show <user-id> [options]
```

### gaib user set

Update user properties.

```bash
gaib user set <user-id> [options]
```

| Option | Description |
|--------|-------------|
| `--roles <roles>` | Comma-separated roles |
| `--display-name <name>` | Display name |
| `--sandbox-access <ids>` | Comma-separated sandbox IDs (replaces existing) |
| `--json` | Output as JSON |

### gaib user off

Disable a user account.

```bash
gaib user off <user-id> [options]
```

### gaib user on

Enable a user account.

```bash
gaib user on <user-id> [options]
```

### gaib user rm

Delete a user account (admin only).

```bash
gaib user rm <user-id> [options]
```

| Option | Description |
|--------|-------------|
| `--force` | Skip confirmation prompt |
| `--json` | Output as JSON |

### gaib user passwd

Reset user password (generates new password).

```bash
gaib user passwd <user-id> [options]
```

### gaib user access

List user's sandbox access.

```bash
gaib user access <user-id> [options]
```

### gaib user grant

Grant user access to a sandbox.

```bash
gaib user grant <user-id> <sandbox-id> [options]
```

### gaib user revoke

Revoke user access from a sandbox.

```bash
gaib user revoke <user-id> <sandbox-id> [options]
```

---

## gaib sandbox

Manage Discord server sandboxes for isolated testing environments.

### Global Options

| Option | Description |
|--------|-------------|
| `--no-color` | Disable colored output |
| `-q, --quiet` | Suppress non-essential output |

### gaib sandbox new

Create a new sandbox environment with isolated PostgreSQL schema, Redis namespace, and NATS subjects.

```bash
gaib sandbox new [name] [options]
```

| Option | Description | Default |
|--------|-------------|---------|
| `-t, --ttl <duration>` | Time-to-live (e.g., `24h`, `48h`, `7d`) | `24h` |
| `-g, --guild <id>` | Discord guild ID to register immediately | - |
| `--json` | Output as JSON | - |
| `-n, --dry-run` | Show what would be created | - |

**Examples:**

```bash
# Create with defaults (24h TTL, auto-generated name)
gaib sandbox new

# Create with custom name
gaib sandbox new my-feature-test

# Create with longer TTL
gaib sandbox new my-sandbox --ttl 48h

# Create and register a guild in one command
gaib sandbox new my-sandbox --guild 123456789012345678

# JSON output for scripting
gaib sandbox new --json
```

### gaib sandbox ls

List sandboxes with their status.

```bash
gaib sandbox ls [options]
```

| Option | Description |
|--------|-------------|
| `-o, --owner <username>` | Filter by owner |
| `-s, --status <status>` | Filter by status |
| `-a, --all` | Include destroyed sandboxes |
| `--json` | Output as JSON |

**Status Values:**

| Status | Description |
|--------|-------------|
| `running` | Active and healthy |
| `expired` | TTL exceeded, pending cleanup |
| `destroyed` | Cleaned up |
| `error` | Creation or operation failed |

### gaib sandbox status

Show detailed status and health information for a sandbox.

```bash
gaib sandbox status <name> [options]
```

| Option | Description |
|--------|-------------|
| `-w, --watch` | Live updates (refreshes periodically) |
| `-i, --interval <seconds>` | Refresh interval (default: 5) |
| `--json` | Output as JSON |

### gaib sandbox rm

Destroy a sandbox and clean up all resources.

```bash
gaib sandbox rm <name> [options]
```

| Option | Description |
|--------|-------------|
| `-y, --yes` | Skip confirmation prompt |
| `-n, --dry-run` | Show what would be destroyed |
| `--json` | Output as JSON |

**What Gets Cleaned Up:**

- PostgreSQL schema and all tables
- Redis keys with sandbox prefix
- NATS consumer subscriptions
- Guild routing mappings

### gaib sandbox env

Get connection environment variables for a sandbox.

```bash
gaib sandbox env <name> [options]
```

| Option | Description |
|--------|-------------|
| `--json` | Output as JSON instead of shell exports |

**Examples:**

```bash
# Print environment variables
gaib sandbox env my-sandbox

# Export to current shell
eval $(gaib sandbox env my-sandbox)

# JSON output
gaib sandbox env my-sandbox --json
```

**Output:**

```bash
export SANDBOX_ID="sb_abc123def456"
export SANDBOX_SCHEMA="sandbox_abc123def456"
export SANDBOX_REDIS_PREFIX="sandbox:abc123def456:"
export SANDBOX_NATS_PREFIX="sandbox.abc123def456."
```

### gaib sandbox link

Register a Discord guild to route events to a sandbox.

```bash
gaib sandbox link <sandbox> <guildId> [options]
```

| Option | Description |
|--------|-------------|
| `--json` | Output as JSON |

**Notes:**

- Guild IDs are found in Discord: Right-click server → Copy Server ID
- Requires Developer Mode enabled in Discord settings
- A guild can only be registered to one sandbox at a time
- Events from the guild will route to the sandbox instead of production

### gaib sandbox unlink

Unregister a Discord guild from a sandbox.

```bash
gaib sandbox unlink <sandbox> <guildId> [options]
```

| Option | Description |
|--------|-------------|
| `--json` | Output as JSON |

---

## gaib server

Infrastructure-as-Code for Discord servers (Terraform-like workflow).

See [Infrastructure-as-Code Guide](./iac.md) for detailed documentation.

### Quick Reference

```bash
# Initialize and apply
gaib server init --theme sietch --guild <id>
gaib server plan
gaib server apply

# Workspace management
gaib server workspace ls
gaib server workspace new staging
gaib server workspace use staging
gaib server workspace rm staging

# State management
gaib server import <address> <id>
gaib server state ls
gaib server state show <address>
gaib server state rm <address>
gaib server state mv <src> <dest>
gaib server state pull

# Lock management
gaib server locks
gaib server unlock

# Theme management
gaib server theme ls
gaib server theme info <name>
```

---

## Environment Variables

| Variable | Description |
|----------|-------------|
| `NO_COLOR` | Disable colored output (standard) |
| `FORCE_COLOR` | Force colored output |
| `GAIB_API_URL` | API endpoint for sandbox/auth management |
| `DISCORD_BOT_TOKEN` | Discord bot authentication token |
| `DISCORD_GUILD_ID` | Default guild ID for server commands |

## Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Success |
| `1` | General error |
| `2` | Invalid arguments |
| `3` | Resource not found |
| `4` | Permission denied |
| `5` | Network/API error |

## CLI Best Practices

The `gaib` CLI follows [clig.dev](https://clig.dev) guidelines:

- **Human-first output** by default, `--json` for scripts
- **Color control** via `--no-color`, `NO_COLOR` env, or non-TTY detection
- **Quiet mode** via `-q, --quiet` for minimal output
- **Consistent exit codes** for scripting
- **Helpful error messages** with suggested fixes

## Quick Reference

```bash
# Authentication
gaib auth login
gaib auth whoami

# User management (admin)
gaib user create --username testuser --roles qa_tester
gaib user ls --active
gaib user passwd <user-id>

# Sandbox workflow
gaib sandbox new my-sandbox --ttl 48h
gaib sandbox link my-sandbox <guild-id>
eval $(gaib sandbox env my-sandbox)
gaib sandbox status my-sandbox --watch
gaib sandbox rm my-sandbox

# Server IaC workflow
gaib server init --theme sietch --guild <id>
gaib server plan
gaib server apply
```

## See Also

- [Infrastructure-as-Code Guide](./iac.md) - Manage Discord server configuration with `gaib server` commands
- [Discord Test Server Setup](./discord-test-server-setup.md) - Create a test server with proper permissions
- [Sandbox Operations Runbook](./sandbox-runbook.md) - Operational procedures and troubleshooting

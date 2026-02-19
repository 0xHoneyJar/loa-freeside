# gaib CLI Reference

<!-- cite: loa-freeside:packages/cli/src/bin/gaib.ts -->
<!-- cite: loa-freeside:packages/cli/src/commands/ -->

`gaib` is the command-line interface for managing Freeside platform development environments, Discord server infrastructure-as-code, and user authentication.

**Version:** 0.1.0
**Package:** `packages/cli`

## Installation

```bash
cd packages/cli
pnpm install
pnpm build
# The gaib binary is available via: npx gaib
```

## Global Options

| Option | Description |
|--------|-------------|
| `--no-color` | Disable colored output (respects `NO_COLOR` env) |
| `-q, --quiet` | Suppress non-essential output |
| `--help, -h` | Show help |
| `--version, -V` | Show version |

## Commands

### gaib auth — Authentication

<!-- cite: loa-freeside:packages/cli/src/commands/auth/index.ts -->

| Command | Description |
|---------|-------------|
| `gaib auth login` | Log in with username and password |
| `gaib auth logout` | Log out and clear stored credentials |
| `gaib auth whoami` | Display current authentication status |

**Options (all auth commands):**
- `--server <url>` — API server URL
- `--json` — Output as JSON

**Example:**
```bash
gaib auth login -u admin --server https://api.example.com
gaib auth whoami --json
```

### gaib user — User Management

<!-- cite: loa-freeside:packages/cli/src/commands/user/index.ts -->

Requires `admin` or `qa_admin` role.

| Command | Description |
|---------|-------------|
| `gaib user create --username <name>` | Create a new user account |
| `gaib user ls` | List users (filter by `--role`, `--active`, `--search`) |
| `gaib user show <user-id>` | Show user details |
| `gaib user set <user-id>` | Update user properties (`--roles`, `--display-name`) |
| `gaib user on <user-id>` | Enable a user account |
| `gaib user off <user-id>` | Disable a user account |
| `gaib user rm <user-id>` | Delete a user account (`--force` to skip confirmation) |
| `gaib user passwd <user-id>` | Reset user password (generates new) |
| `gaib user access <user-id>` | List user's sandbox access |
| `gaib user grant <user-id> <sandbox-id>` | Grant sandbox access |
| `gaib user revoke <user-id> <sandbox-id>` | Revoke sandbox access |

**Roles:** `qa_tester` (default), `qa_admin`, `admin`

### gaib sandbox — Sandbox Management

<!-- cite: loa-freeside:packages/cli/src/commands/sandbox/index.ts -->

Isolated testing environments with dedicated database schema, Redis prefix, and NATS namespace.

| Command | Description |
|---------|-------------|
| `gaib sandbox new [name]` | Create a new sandbox (`-t 24h` TTL, `-g <guild>` link) |
| `gaib sandbox ls` | List sandboxes (`-o <owner>`, `-s <status>`, `-a` all) |
| `gaib sandbox status <name>` | Detailed status and health (`-w` watch mode) |
| `gaib sandbox rm <name>` | Destroy sandbox (`-y` skip confirmation, `-n` dry-run) |
| `gaib sandbox env <name>` | Get connection environment variables |
| `gaib sandbox link <sandbox> <guildId>` | Route Discord events to sandbox |
| `gaib sandbox unlink <sandbox> <guildId>` | Remove Discord routing |

**Example:**
```bash
gaib sandbox new my-test -t 48h -g 1234567890
gaib sandbox env my-test  # Outputs export statements
gaib sandbox status my-test -w  # Live monitoring
gaib sandbox rm my-test -y
```

**Environment output:**
```bash
export SANDBOX_ID="sb_abc123def456"
export SANDBOX_SCHEMA="sandbox_abc123def456"
export SANDBOX_REDIS_PREFIX="sandbox:abc123def456:"
export SANDBOX_NATS_PREFIX="sandbox.abc123def456."
```

### gaib server — Discord Infrastructure-as-Code

<!-- cite: loa-freeside:packages/cli/src/commands/server/index.ts -->

Terraform-like workflow for managing Discord server structure (roles, channels, categories, permissions).

#### Core Workflow

| Command | Description |
|---------|-------------|
| `gaib server init` | Initialize server config file (`-g <guild>`, `-t <theme>`) |
| `gaib server plan` | Preview changes without applying (dry-run) |
| `gaib server diff` | Show detailed diff between config and current Discord state |
| `gaib server apply` | Apply configuration changes (`--auto-approve`, `--dry-run`) |
| `gaib server destroy` | Destroy managed resources (`--auto-approve`, `--dry-run`) |
| `gaib server export` | Export current Discord server state to YAML |

#### State Management

| Command | Description |
|---------|-------------|
| `gaib server import <address> <id>` | Import existing Discord resource into state |
| `gaib server state ls` | List all resources in state |
| `gaib server state show <address>` | Show detailed resource info |
| `gaib server state rm <address>` | Remove resource from state (no Discord delete) |
| `gaib server state mv <source> <dest>` | Move/rename resource address |
| `gaib server state pull -g <guild>` | Refresh state from Discord |
| `gaib server locks` | Show lock status |
| `gaib server unlock` | Force release a stuck state lock |

#### Workspace Management

| Command | Description |
|---------|-------------|
| `gaib server workspace ls` | List all workspaces |
| `gaib server workspace new <name>` | Create and switch to new workspace |
| `gaib server workspace use <name>` | Switch to workspace (`-c` create if missing) |
| `gaib server workspace show [name]` | Show workspace details |
| `gaib server workspace rm <name>` | Delete workspace (`-f` force, `-y` skip prompt) |

#### Themes

| Command | Description |
|---------|-------------|
| `gaib server theme ls` | List available themes |
| `gaib server theme info <name>` | Show theme details |

#### Teardown (Dangerous)

```bash
gaib server teardown -g <guild> --confirm-teardown
```

Requires: `--confirm-teardown` flag, server name confirmation, random 6-digit code, and typing "TEARDOWN".

**Example workflow:**
```bash
gaib server init -g 1234567890 -t sietch
gaib server plan
gaib server apply --auto-approve
gaib server export -o backup.yaml
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `GAIB_API_URL` | API endpoint | `http://localhost:3000` |
| `DISCORD_BOT_TOKEN` | Discord bot token | — |
| `DISCORD_GUILD_ID` | Default guild ID | — |
| `NO_COLOR` | Disable colored output | — |

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | General error |
| 2 | Invalid arguments |
| 3 | Resource not found |
| 4 | Permission denied |
| 5 | Network/API error |

## Next Steps

- [INFRASTRUCTURE.md](INFRASTRUCTURE.md) — Deployment topology and Terraform modules
- [API-QUICKSTART.md](API-QUICKSTART.md) — Make your first agent call
- [DEVELOPER-GUIDE.md](DEVELOPER-GUIDE.md) — Full learning path and document index

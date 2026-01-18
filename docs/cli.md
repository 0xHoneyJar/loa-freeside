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

## Commands

### gaib sandbox

Manage Discord server sandboxes for isolated testing environments.

```bash
gaib sandbox <command> [options]
```

#### Global Options

| Option | Description |
|--------|-------------|
| `--no-color` | Disable colored output |
| `-q, --quiet` | Suppress non-essential output |
| `--json` | Output as JSON (machine-readable) |

---

### gaib sandbox create

Create a new sandbox environment with isolated PostgreSQL schema, Redis namespace, and NATS subjects.

```bash
gaib sandbox create [name] [options]
```

#### Arguments

| Argument | Description | Default |
|----------|-------------|---------|
| `name` | Sandbox name (alphanumeric, hyphens) | Auto-generated |

#### Options

| Option | Description | Default |
|--------|-------------|---------|
| `-t, --ttl <duration>` | Time-to-live (e.g., `24h`, `48h`, `7d`) | `24h` |
| `-g, --guild <id>` | Discord guild ID to register immediately | - |
| `--json` | Output as JSON | - |

#### Examples

```bash
# Create with defaults (24h TTL, auto-generated name)
gaib sandbox create

# Create with custom name
gaib sandbox create my-feature-test

# Create with longer TTL
gaib sandbox create my-sandbox --ttl 48h

# Create and register a guild in one command
gaib sandbox create my-sandbox --guild 123456789012345678

# JSON output for scripting
gaib sandbox create --json
```

#### Output

```
✓ Sandbox 'my-sandbox' created successfully

  ID:      sb_abc123def456
  Name:    my-sandbox
  Schema:  sandbox_abc123def456
  TTL:     24h
  Expires: 2026-01-19T12:00:00Z

  Next steps:
    gaib sandbox register-guild my-sandbox <guild-id>
    eval $(gaib sandbox connect my-sandbox)
```

---

### gaib sandbox list

List sandboxes with their status.

```bash
gaib sandbox list [options]
```

#### Options

| Option | Description | Default |
|--------|-------------|---------|
| `--all` | Include destroyed sandboxes | Running only |
| `--status <status>` | Filter by status | - |
| `--json` | Output as JSON | - |

#### Status Values

| Status | Description |
|--------|-------------|
| `running` | Active and healthy |
| `expired` | TTL exceeded, pending cleanup |
| `destroyed` | Cleaned up |
| `error` | Creation or operation failed |

#### Examples

```bash
# List your running sandboxes
gaib sandbox list

# Include all statuses
gaib sandbox list --all

# Filter by status
gaib sandbox list --status expired

# JSON output
gaib sandbox list --json
```

---

### gaib sandbox status

Show detailed status and health information for a sandbox.

```bash
gaib sandbox status <sandbox> [options]
```

#### Arguments

| Argument | Description |
|----------|-------------|
| `sandbox` | Sandbox name or ID |

#### Options

| Option | Description |
|--------|-------------|
| `--watch` | Live updates (refreshes every 2s) |
| `--json` | Output as JSON |

#### Examples

```bash
# Show status
gaib sandbox status my-sandbox

# Watch status in real-time
gaib sandbox status my-sandbox --watch

# JSON output
gaib sandbox status my-sandbox --json
```

#### Output

```
Sandbox: my-sandbox (sb_abc123def456)
Status:  running
Created: 2026-01-18T12:00:00Z
Expires: 2026-01-19T12:00:00Z
Owner:   developer@example.com

Health Checks:
  ✓ PostgreSQL schema: healthy
  ✓ Redis namespace: healthy
  ✓ NATS subjects: healthy

Registered Guilds:
  • 123456789012345678 (registered 2h ago)
  • 987654321098765432 (registered 1h ago)

Resource Usage:
  Database rows: 1,234
  Redis keys: 56
  Events processed: 10,432
```

---

### gaib sandbox connect

Get connection environment variables for a sandbox.

```bash
gaib sandbox connect <sandbox> [options]
```

#### Arguments

| Argument | Description |
|----------|-------------|
| `sandbox` | Sandbox name or ID |

#### Options

| Option | Description |
|--------|-------------|
| `--json` | Output as JSON |

#### Examples

```bash
# Print environment variables
gaib sandbox connect my-sandbox

# Export to current shell
eval $(gaib sandbox connect my-sandbox)

# JSON output
gaib sandbox connect my-sandbox --json
```

#### Output

```bash
export SANDBOX_ID="sb_abc123def456"
export SANDBOX_NAME="my-sandbox"
export SANDBOX_SCHEMA="sandbox_abc123def456"
export SANDBOX_REDIS_PREFIX="sandbox:abc123def456:"
export SANDBOX_NATS_PREFIX="sandbox.abc123def456."
```

---

### gaib sandbox register-guild

Register a Discord guild to route events to a sandbox.

```bash
gaib sandbox register-guild <sandbox> <guildId> [options]
```

#### Arguments

| Argument | Description |
|----------|-------------|
| `sandbox` | Sandbox name or ID |
| `guildId` | Discord guild ID (17-20 digit number) |

#### Options

| Option | Description |
|--------|-------------|
| `--json` | Output as JSON |

#### Notes

- Guild IDs are found in Discord: Right-click server → Copy Server ID
- Requires Developer Mode enabled in Discord settings
- A guild can only be registered to one sandbox at a time
- Events from the guild will route to the sandbox instead of production

#### Examples

```bash
# Register a guild
gaib sandbox register-guild my-sandbox 123456789012345678

# With alias
gaib sandbox reg my-sandbox 123456789012345678

# JSON output
gaib sandbox register-guild my-sandbox 123456789012345678 --json
```

---

### gaib sandbox unregister-guild

Unregister a Discord guild from a sandbox.

```bash
gaib sandbox unregister-guild <sandbox> <guildId> [options]
```

#### Arguments

| Argument | Description |
|----------|-------------|
| `sandbox` | Sandbox name or ID |
| `guildId` | Discord guild ID |

#### Options

| Option | Description |
|--------|-------------|
| `--json` | Output as JSON |

#### Notes

- After unregistering, events from the guild route to production
- The guild can be registered to a different sandbox afterward

#### Examples

```bash
# Unregister a guild
gaib sandbox unregister-guild my-sandbox 123456789012345678

# With alias
gaib sandbox unreg my-sandbox 123456789012345678
```

---

### gaib sandbox destroy

Destroy a sandbox and clean up all resources.

```bash
gaib sandbox destroy <sandbox> [options]
```

#### Arguments

| Argument | Description |
|----------|-------------|
| `sandbox` | Sandbox name or ID |

#### Options

| Option | Description |
|--------|-------------|
| `--force` | Skip confirmation prompt |
| `--json` | Output as JSON |

#### What Gets Cleaned Up

- PostgreSQL schema and all tables
- Redis keys with sandbox prefix
- NATS consumer subscriptions
- Guild routing mappings

#### Examples

```bash
# Destroy with confirmation
gaib sandbox destroy my-sandbox

# Skip confirmation
gaib sandbox destroy my-sandbox --force

# JSON output
gaib sandbox destroy my-sandbox --json
```

---

## Environment Variables

| Variable | Description |
|----------|-------------|
| `NO_COLOR` | Disable colored output (standard) |
| `FORCE_COLOR` | Force colored output |
| `GAIB_API_URL` | API endpoint for sandbox management |
| `GAIB_TOKEN` | Authentication token |

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
# Create and setup
gaib sandbox create my-sandbox --ttl 48h
gaib sandbox register-guild my-sandbox <guild-id>
eval $(gaib sandbox connect my-sandbox)

# Monitor
gaib sandbox list
gaib sandbox status my-sandbox --watch

# Cleanup
gaib sandbox unregister-guild my-sandbox <guild-id>
gaib sandbox destroy my-sandbox
```

## See Also

- [Sandbox Operations Runbook](./sandbox-runbook.md) - Operational procedures and troubleshooting
- [Gateway Proxy Architecture](./architecture/gateway-proxy.md) - Event routing details

# Sprint 85 Implementation Report

## Discord Server Sandboxes - CLI Commands

**Sprint**: 85
**Status**: Implementation Complete
**Date**: 2026-01-17

---

## Summary

Sprint 85 implements the CLI commands for Discord Server Sandboxes. This provides developers with a zero-config interface to create, manage, and connect to isolated sandbox environments for testing Arrakis Discord functionality.

## Tasks Completed

### Task 85.1: CLI Infrastructure
**Files**: `packages/cli/` (new package)

Created the `@arrakis/cli` package with:

- **`src/bin/bd.ts`**: CLI entry point for the `bd` command
- **`src/commands/index.ts`**: Command registry
- **`src/commands/sandbox/index.ts`**: Sandbox command group registration
- **`src/commands/sandbox/utils.ts`**: Shared utilities

**Shared Utilities**:
- `getSandboxManager(logger)` - Factory for SandboxManager with caching
- `getCurrentUser()` - Resolves developer username (SANDBOX_OWNER → USER → USERNAME → 'unknown')
- `parseTTL(ttlString)` - Parses TTL strings ('24h', '7d', '168')
- `formatDate(date)` - ISO date formatting
- `formatDuration(ms)` - Human-readable duration ('2d 5h', '45m')
- `timeUntil(date)` - Milliseconds until a date
- `handleError(error, json)` - Consistent error handling
- `createSilentLogger()` - Logger that suppresses output for clean CLI

### Task 85.2: Create Command
**File**: `packages/cli/src/commands/sandbox/create.ts`

```bash
bd sandbox create [name] [options]
```

**Options**:
- `-t, --ttl <duration>` - Time-to-live (default: '24h')
- `-g, --guild <id>` - Discord guild ID to register
- `--json` - Output as JSON

**Features**:
- Auto-generates sandbox name if not provided
- Validates TTL (max 168 hours / 7 days)
- Registers guild immediately if specified
- Shows connection instructions on success
- Supports JSON output for scripting

### Task 85.3: List Command
**File**: `packages/cli/src/commands/sandbox/list.ts`

```bash
bd sandbox list [options]
bd sandbox ls [options]  # alias
```

**Options**:
- `-o, --owner <username>` - Filter by owner
- `-s, --status <status>` - Filter by status (running, expired, etc.)
- `-a, --all` - Include destroyed sandboxes
- `--json` - Output as JSON

**Features**:
- Defaults to current user's sandboxes
- Color-coded status indicators
- Human-readable expiry times
- Formatted table output
- Guild count display

### Task 85.4: Destroy Command
**File**: `packages/cli/src/commands/sandbox/destroy.ts`

```bash
bd sandbox destroy <name> [options]
bd sandbox rm <name> [options]  # alias
```

**Options**:
- `-y, --yes` - Skip confirmation prompt
- `--json` - Output as JSON

**Features**:
- Interactive confirmation (unless --yes)
- Shows sandbox details before destruction
- Idempotent for already-destroyed sandboxes
- Full schema and resource cleanup

### Task 85.5: Connect Command
**File**: `packages/cli/src/commands/sandbox/connect.ts`

```bash
bd sandbox connect <name> [options]
```

**Options**:
- `--json` - Output as JSON instead of shell exports

**Features**:
- Outputs shell export statements for `eval`
- Environment variables:
  - `SANDBOX_ID` - Sandbox UUID
  - `SANDBOX_SCHEMA` - PostgreSQL schema name
  - `SANDBOX_REDIS_PREFIX` - Redis key prefix
  - `SANDBOX_NATS_PREFIX` - NATS subject prefix
- Validates sandbox is running
- Comments to stderr (safe for eval)

**Usage**:
```bash
eval $(bd sandbox connect my-sandbox)
# Now workers use this sandbox's isolated resources
```

### Task 85.6: CLI Tests
**Directory**: `packages/cli/src/commands/sandbox/__tests__/`

**Test files**:
- `utils.test.ts` - 24 tests for shared utilities
- `create.test.ts` - 6 tests for create command
- `list.test.ts` - 7 tests for list command
- `destroy.test.ts` - 6 tests for destroy command
- `connect.test.ts` - 7 tests for connect command

**Total**: 50 tests passing

**Coverage areas**:
- TTL parsing (hours, days, weeks, minutes)
- User identity resolution
- Duration formatting
- Error handling paths
- JSON output mode
- Sandbox not found scenarios
- Status validation

---

## Files Created

### Package Structure
```
packages/cli/
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── dist/                      (generated)
│   └── bin/
│       └── bd.js              (CLI entry point)
└── src/
    ├── index.ts               (package exports)
    ├── bin/
    │   └── bd.ts              (CLI entry point)
    └── commands/
        ├── index.ts           (command registry)
        └── sandbox/
            ├── index.ts       (command group)
            ├── utils.ts       (shared utilities)
            ├── create.ts      (create command)
            ├── list.ts        (list command)
            ├── destroy.ts     (destroy command)
            ├── connect.ts     (connect command)
            └── __tests__/
                ├── utils.test.ts
                ├── create.test.ts
                ├── list.test.ts
                ├── destroy.test.ts
                └── connect.test.ts
```

---

## Acceptance Criteria Verification

| Criterion | Status | Evidence |
|-----------|--------|----------|
| `bd sandbox` command group exists | ✅ | `bd sandbox --help` shows subcommands |
| `bd sandbox create` creates sandbox | ✅ | Creates sandbox with schema, returns details |
| TTL parsing supports duration strings | ✅ | `parseTTL('48h')`, `parseTTL('7d')` work |
| `bd sandbox list` shows user sandboxes | ✅ | Formatted table with status, expiry |
| `bd sandbox destroy` removes sandbox | ✅ | Confirmation prompt, full cleanup |
| `bd sandbox connect` outputs env vars | ✅ | `eval $(bd sandbox connect <name>)` works |
| JSON output mode | ✅ | All commands support `--json` flag |
| Unit tests cover core functionality | ✅ | 50 tests passing |
| TypeScript compiles without errors | ✅ | `npm run typecheck` passes |
| Package builds successfully | ✅ | `npm run build` generates dist/ |

---

## CLI Usage Examples

### Create a sandbox
```bash
# Default (24h TTL, auto-generated name)
bd sandbox create

# Custom name and TTL
bd sandbox create my-test --ttl 48h

# With guild registration
bd sandbox create my-test --guild 123456789012345678
```

### List sandboxes
```bash
# Your running sandboxes
bd sandbox list

# All statuses
bd sandbox list --all

# JSON output
bd sandbox list --json
```

### Connect to sandbox
```bash
# Export environment variables
eval $(bd sandbox connect my-test)

# Get JSON
bd sandbox connect my-test --json
```

### Destroy sandbox
```bash
# With confirmation
bd sandbox destroy my-test

# Skip confirmation
bd sandbox destroy my-test --yes
```

---

## Dependencies

### Runtime Dependencies
- `@arrakis/sandbox` - Sandbox management (Sprint 84)
- `commander@^12.1.0` - CLI framework
- `chalk@^5.3.0` - Terminal colors
- `cli-table3@^0.6.5` - Table formatting
- `ora@^8.0.1` - Spinners
- `ms@^2.1.3` - Duration parsing
- `postgres@^3.4.0` - PostgreSQL client

### Peer Dependencies
- `pino@>=8.0.0` - Logging (provided by consumer)

### Dev Dependencies
- `vitest@^1.0.0` - Testing framework
- `typescript@^5.3.0` - TypeScript compiler
- `tsx@^4.7.0` - TypeScript execution

---

## Technical Notes

### TTL Parsing
- Plain numbers interpreted as hours: `24` → 24 hours
- Duration strings via `ms` library: `24h`, `2d`, `1w`
- Minimum: 1 hour
- Maximum: 168 hours (7 days)

### User Identity Resolution
Resolution order:
1. `SANDBOX_OWNER` environment variable
2. `USER` environment variable (Unix)
3. `USERNAME` environment variable (Windows)
4. `'unknown'` fallback

### Environment Variables (from connect)
```bash
SANDBOX_ID=<uuid>
SANDBOX_SCHEMA=sandbox_<short_id>
SANDBOX_REDIS_PREFIX=sandbox:<uuid>:
SANDBOX_NATS_PREFIX=sandbox.<uuid>.
```

---

## Next Steps (Sprint 86)

1. **Redis Integration**: Implement Redis key prefixing
2. **NATS Integration**: Subject namespacing for events
3. **Event Router**: Route Discord events to correct sandbox
4. **Integration Tests**: End-to-end sandbox lifecycle

---

## Review Checklist

- [x] All tasks implemented per sprint plan
- [x] CLI commands follow Unix conventions
- [x] Error messages are user-friendly
- [x] JSON output supports scripting
- [x] TTL parsing handles all documented formats
- [x] Unit tests cover happy and error paths
- [x] TypeScript strict mode passes
- [x] Package builds and CLI runs correctly

---

**Implementation Engineer**: Claude (Implementing Tasks Agent)
**Sprint**: 85 - Discord Server Sandboxes - CLI Commands

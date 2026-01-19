# Sprint Plan: Gaib CLI v2.0

**Project**: Gaib - Discord Infrastructure as Code Platform
**Version**: 2.0.0
**PRD Reference**: `grimoires/loa/gaib-prd.md`
**SDD Reference**: `grimoires/loa/gaib-sdd.md`
**Created**: 2026-01-19
**Status**: READY FOR IMPLEMENTATION

---

## Executive Summary

This sprint plan breaks down the Gaib CLI v2.0 implementation into 6 sprints (96-101), building on the existing IaC foundation from Sprint 91-93. The plan covers:

- **Sprint 96**: Remote State Backend (S3 + DynamoDB)
- **Sprint 97**: Workspace Management
- **Sprint 98**: Apply & Destroy Commands
- **Sprint 99**: Import & State Commands
- **Sprint 100**: Theme System
- **Sprint 101**: Polish & Documentation

**Total Estimated Tasks**: 42 tasks across 6 sprints
**Dependency Chain**: 96 -> 97 -> 98 (parallel with 99) -> 100 -> 101

---

## Existing Foundation (Sprint 91-93)

The following components are already implemented and will be extended:

| Component | Path | Status |
|-----------|------|--------|
| ConfigParser | `packages/cli/src/commands/server/iac/ConfigParser.ts` | Reuse/Extend |
| DiffEngine | `packages/cli/src/commands/server/iac/DiffEngine.ts` | Reuse |
| StateReader | `packages/cli/src/commands/server/iac/StateReader.ts` | Reuse/Extend |
| StateWriter | `packages/cli/src/commands/server/iac/StateWriter.ts` | Reuse/Extend |
| DiscordClient | `packages/cli/src/commands/server/iac/DiscordClient.ts` | Reuse |
| RateLimiter | `packages/cli/src/commands/server/iac/RateLimiter.ts` | Reuse |
| RetryHandler | `packages/cli/src/commands/server/iac/RetryHandler.ts` | Reuse |
| Schemas | `packages/cli/src/commands/server/iac/schemas.ts` | Extend |
| init command | `packages/cli/src/commands/server/init.ts` | Extend |
| plan command | `packages/cli/src/commands/server/plan.ts` | Extend |
| diff command | `packages/cli/src/commands/server/diff.ts` | Reuse |
| export command | `packages/cli/src/commands/server/export.ts` | Reuse |

---

## Sprint 96: Remote State Backend

**Goal**: Implement pluggable state backend architecture with S3 + DynamoDB support

**Priority**: P0 (Foundation)
**Depends On**: None
**Blocks**: 97, 98, 99

### Tasks

#### 96.1: Create StateBackend Interface

**Description**: Define the abstract interface for state storage backends that supports multiple implementations (local, S3, future backends).

**Files**:
- `packages/cli/src/commands/server/iac/backends/StateBackend.ts` (new)

**Acceptance Criteria**:
- [ ] Interface defines read, write, lock, unlock, listWorkspaces, deleteWorkspace methods
- [ ] LockInfo and LockResult types defined
- [ ] Interface is generic enough for any backend implementation
- [ ] JSDoc documentation for all methods

**Complexity**: S

---

#### 96.2: Implement LocalBackend

**Description**: Refactor existing local state handling into the new StateBackend interface. This maintains backward compatibility.

**Files**:
- `packages/cli/src/commands/server/iac/backends/LocalBackend.ts` (new)
- `packages/cli/src/commands/server/iac/backends/LocalBackend.test.ts` (new)

**Acceptance Criteria**:
- [ ] Implements full StateBackend interface
- [ ] State stored in `.gaib/{workspace}/terraform.tfstate`
- [ ] File-based locking with `.terraform.lock` files
- [ ] Lists workspaces from directory structure
- [ ] Unit tests for all methods
- [ ] Backward compatible with existing local state

**Complexity**: M

---

#### 96.3: Implement S3Backend (State Operations)

**Description**: Implement S3-based state storage for remote state management.

**Files**:
- `packages/cli/src/commands/server/iac/backends/S3Backend.ts` (new)
- `packages/cli/src/commands/server/iac/backends/S3Backend.test.ts` (new)

**Dependencies**: @aws-sdk/client-s3

**Acceptance Criteria**:
- [ ] Implements StateBackend interface (read, write, listWorkspaces, deleteWorkspace)
- [ ] State stored at `{bucket}/{key_prefix}/{workspace}/terraform.tfstate`
- [ ] SSE-S3 encryption by default
- [ ] Optional KMS encryption with `kms_key_id` config
- [ ] Lists workspaces via S3 prefix listing
- [ ] Mock S3 client for unit tests

**Complexity**: L

---

#### 96.4: Implement DynamoDB Locking

**Description**: Add DynamoDB-based locking to S3Backend to prevent concurrent modifications.

**Files**:
- `packages/cli/src/commands/server/iac/backends/S3Backend.ts` (extend)

**Dependencies**: @aws-sdk/client-dynamodb

**Acceptance Criteria**:
- [ ] Conditional PutItem for lock acquisition (prevent race conditions)
- [ ] Lock info includes: id, operation, who, created timestamp
- [ ] GetItem to fetch existing lock info on conflict
- [ ] DeleteItem with condition for safe unlock
- [ ] Lock timeout detection (stale locks > 1 hour flagged)
- [ ] Integration test with localstack or moto

**Complexity**: M

---

#### 96.5: Create BackendFactory

**Description**: Factory for creating backend instances from configuration.

**Files**:
- `packages/cli/src/commands/server/iac/backends/BackendFactory.ts` (new)
- `packages/cli/src/commands/server/iac/backends/index.ts` (new)

**Acceptance Criteria**:
- [ ] `createBackend(config)` function
- [ ] `parseBackendConfig(raw)` parses gaib.yaml backend section
- [ ] Defaults to LocalBackend if no backend configured
- [ ] Clear error messages for invalid configurations
- [ ] Type-safe BackendConfig union type

**Complexity**: S

---

#### 96.6: Extend Configuration Schema

**Description**: Add backend configuration schema to gaib.yaml validation.

**Files**:
- `packages/cli/src/commands/server/iac/schemas.ts` (extend)

**Acceptance Criteria**:
- [ ] S3BackendSchema with all fields (bucket, region, key_prefix, etc.)
- [ ] LocalBackendSchema with path field
- [ ] BackendSchema with mutual exclusion (only one backend type)
- [ ] Version field `2.0` for new config format
- [ ] Backward compatibility with v1 configs (auto-upgrade)

**Complexity**: S

---

#### 96.7: Integrate Backend into Existing Commands

**Description**: Update init and plan commands to use the new backend system.

**Files**:
- `packages/cli/src/commands/server/init.ts` (extend)
- `packages/cli/src/commands/server/plan.ts` (extend)

**Acceptance Criteria**:
- [ ] `gaib init` prompts for backend type (local/s3)
- [ ] `gaib init --backend=s3` configures S3 backend
- [ ] `gaib plan` reads state from configured backend
- [ ] Existing local-only workflows still work

**Complexity**: M

---

### Sprint 96 Summary

| Task | Complexity | Files |
|------|------------|-------|
| 96.1 | S | 1 new |
| 96.2 | M | 2 new |
| 96.3 | L | 2 new |
| 96.4 | M | 1 extend |
| 96.5 | S | 2 new |
| 96.6 | S | 1 extend |
| 96.7 | M | 2 extend |

**Total**: 7 tasks, 8 new files, 3 extended files

---

## Sprint 97: Workspace Management

**Goal**: Implement workspace system for environment isolation (dev/staging/prod)

**Priority**: P0 (Core Feature)
**Depends On**: 96
**Blocks**: 98

### Tasks

#### 97.1: Create WorkspaceManager

**Description**: Core workspace management logic with CRUD operations.

**Files**:
- `packages/cli/src/commands/server/iac/WorkspaceManager.ts` (new)
- `packages/cli/src/commands/server/iac/WorkspaceManager.test.ts` (new)

**Acceptance Criteria**:
- [ ] `current()` returns current workspace name
- [ ] `select(name, create)` switches workspace
- [ ] `list()` returns all workspaces
- [ ] `create(name)` creates new workspace with empty state
- [ ] `delete(name)` removes workspace (with safety checks)
- [ ] `show(name)` returns workspace info (resources, serial, etc.)
- [ ] Current workspace persisted in `.gaib/workspace` file
- [ ] Cannot delete default workspace
- [ ] Cannot delete non-empty workspace without force

**Complexity**: M

---

#### 97.2: Implement `gaib workspace list`

**Description**: Command to list all available workspaces.

**Files**:
- `packages/cli/src/commands/server/workspace.ts` (new)

**Acceptance Criteria**:
- [ ] Lists all workspaces from backend
- [ ] Marks current workspace with `*`
- [ ] Shows resource count for each workspace
- [ ] `--json` flag for machine-readable output
- [ ] Works with both local and S3 backends

**Complexity**: S

---

#### 97.3: Implement `gaib workspace new`

**Description**: Command to create a new workspace.

**Files**:
- `packages/cli/src/commands/server/workspace.ts` (extend)

**Acceptance Criteria**:
- [ ] Creates workspace and switches to it
- [ ] Validates workspace name (alphanumeric, hyphens, underscores)
- [ ] Initializes empty state in new workspace
- [ ] Error if workspace already exists

**Complexity**: S

---

#### 97.4: Implement `gaib workspace select`

**Description**: Command to switch to a different workspace.

**Files**:
- `packages/cli/src/commands/server/workspace.ts` (extend)

**Acceptance Criteria**:
- [ ] Switches to specified workspace
- [ ] `--create` flag creates if doesn't exist
- [ ] Updates `.gaib/workspace` file
- [ ] Error if workspace doesn't exist (without --create)

**Complexity**: S

---

#### 97.5: Implement `gaib workspace show`

**Description**: Command to show workspace details.

**Files**:
- `packages/cli/src/commands/server/workspace.ts` (extend)

**Acceptance Criteria**:
- [ ] Shows workspace name, current flag
- [ ] Shows resource count and serial number
- [ ] Shows last modified timestamp
- [ ] Shows backend type
- [ ] `--json` flag for machine-readable output

**Complexity**: S

---

#### 97.6: Implement `gaib workspace delete`

**Description**: Command to delete a workspace.

**Files**:
- `packages/cli/src/commands/server/workspace.ts` (extend)

**Acceptance Criteria**:
- [ ] Deletes workspace state from backend
- [ ] Requires confirmation (type workspace name)
- [ ] Cannot delete 'default' workspace
- [ ] Cannot delete current workspace (switch first)
- [ ] Cannot delete non-empty workspace without `--force`

**Complexity**: S

---

#### 97.7: Update All Commands for Workspace Context

**Description**: Ensure all existing commands respect the current workspace.

**Files**:
- `packages/cli/src/commands/server/init.ts` (extend)
- `packages/cli/src/commands/server/plan.ts` (extend)
- `packages/cli/src/commands/server/diff.ts` (extend)

**Acceptance Criteria**:
- [ ] All commands read current workspace from WorkspaceManager
- [ ] Workspace name shown in command output
- [ ] State operations scoped to current workspace
- [ ] `--workspace` flag to override (optional)

**Complexity**: M

---

### Sprint 97 Summary

| Task | Complexity | Files |
|------|------------|-------|
| 97.1 | M | 2 new |
| 97.2 | S | 1 new |
| 97.3 | S | 1 extend |
| 97.4 | S | 1 extend |
| 97.5 | S | 1 extend |
| 97.6 | S | 1 extend |
| 97.7 | M | 3 extend |

**Total**: 7 tasks, 3 new files, 6 extended files

---

## Sprint 98: Apply & Destroy Commands

**Goal**: Implement full apply/destroy lifecycle with confirmation and progress

**Priority**: P0 (Core Feature)
**Depends On**: 96, 97
**Blocks**: 100 (partially)

### Tasks

#### 98.1: Create StateLock Utility

**Description**: High-level locking utility for operations that need exclusive access.

**Files**:
- `packages/cli/src/commands/server/iac/StateLock.ts` (new)
- `packages/cli/src/commands/server/iac/StateLock.test.ts` (new)

**Acceptance Criteria**:
- [ ] `acquire(operation)` acquires lock with operation context
- [ ] `release()` releases lock safely
- [ ] Generates unique lock ID per operation
- [ ] Includes hostname and username in lock info
- [ ] Clear error message when lock held by another
- [ ] Suggests `force-unlock` command for stale locks

**Complexity**: S

---

#### 98.2: Create ApplyEngine

**Description**: Core engine for applying configuration changes to Discord.

**Files**:
- `packages/cli/src/commands/server/iac/ApplyEngine.ts` (new)
- `packages/cli/src/commands/server/iac/ApplyEngine.test.ts` (new)

**Acceptance Criteria**:
- [ ] Takes ExecutionPlan and applies changes
- [ ] Respects parallelism limit for concurrent operations
- [ ] Progress callback for real-time updates
- [ ] Handles partial failures gracefully
- [ ] Returns ApplyResult with success/failure per resource
- [ ] Updates state after each successful operation
- [ ] Rolls back on critical failures (optional)

**Complexity**: L

---

#### 98.3: Implement `gaib apply` Command

**Description**: Full apply command with confirmation flow.

**Files**:
- `packages/cli/src/commands/server/apply.ts` (new)

**Acceptance Criteria**:
- [ ] Loads config and generates plan
- [ ] Acquires lock before apply
- [ ] Shows plan diff before confirmation
- [ ] Requires explicit "yes" confirmation
- [ ] `--auto-approve` skips confirmation
- [ ] `--target` limits to specific resources
- [ ] `--parallelism` controls concurrency
- [ ] Progress output during apply
- [ ] Updates state after successful apply
- [ ] Releases lock on completion/error
- [ ] Exit code 0 on success, 1 on failure

**Complexity**: L

---

#### 98.4: Create DestroyEngine

**Description**: Core engine for destroying managed resources.

**Files**:
- `packages/cli/src/commands/server/iac/DestroyEngine.ts` (new)
- `packages/cli/src/commands/server/iac/DestroyEngine.test.ts` (new)

**Acceptance Criteria**:
- [ ] Destroys resources in reverse dependency order
- [ ] Progress callback for real-time updates
- [ ] Tracks destroyed vs remaining resources
- [ ] Returns DestroyResult with success/failure per resource
- [ ] `--force` option for inconsistent state

**Complexity**: M

---

#### 98.5: Implement `gaib destroy` Command

**Description**: Full destroy command with strong safety measures.

**Files**:
- `packages/cli/src/commands/server/destroy.ts` (new)

**Acceptance Criteria**:
- [ ] Lists all resources to be destroyed
- [ ] Requires typing server name to confirm
- [ ] Second "Are you ABSOLUTELY sure?" confirmation
- [ ] `--auto-approve` skips confirmation (dangerous)
- [ ] `--target` limits to specific resources
- [ ] Progress output during destroy
- [ ] Clears state after successful destroy
- [ ] Exit code 0 on success, 1 on failure

**Complexity**: L

---

#### 98.6: Implement `gaib force-unlock` Command

**Description**: Admin command to force-release stale locks.

**Files**:
- `packages/cli/src/commands/server/force-unlock.ts` (new)

**Acceptance Criteria**:
- [ ] Takes lock ID as argument
- [ ] Shows warning about potential state corruption
- [ ] Requires confirmation
- [ ] Releases lock from backend
- [ ] Logs force-unlock event

**Complexity**: S

---

#### 98.7: Update CLI Registration

**Description**: Register apply, destroy, and force-unlock commands.

**Files**:
- `packages/cli/src/commands/server/index.ts` (extend)

**Acceptance Criteria**:
- [ ] All new commands registered
- [ ] Help text accurate
- [ ] Commands appear in `gaib server --help`

**Complexity**: S

---

### Sprint 98 Summary

| Task | Complexity | Files |
|------|------------|-------|
| 98.1 | S | 2 new |
| 98.2 | L | 2 new |
| 98.3 | L | 1 new |
| 98.4 | M | 2 new |
| 98.5 | L | 1 new |
| 98.6 | S | 1 new |
| 98.7 | S | 1 extend |

**Total**: 7 tasks, 9 new files, 1 extended file

---

## Sprint 99: Import & State Commands

**Goal**: Implement resource import and state management commands

**Priority**: P1 (Important)
**Depends On**: 96, 97
**Can Run**: Parallel with 98

### Tasks

#### 99.1: Extend DiscordClient for Resource Fetching

**Description**: Add methods to fetch individual resources by ID.

**Files**:
- `packages/cli/src/commands/server/iac/DiscordClient.ts` (extend)

**Acceptance Criteria**:
- [ ] `fetchResource(type, id)` method
- [ ] Supports: role, channel, category, server
- [ ] Returns resource in state-compatible format
- [ ] Clear error messages for not found / permission denied

**Complexity**: M

---

#### 99.2: Implement `gaib import` Command

**Description**: Import existing Discord resources into state.

**Files**:
- `packages/cli/src/commands/server/import.ts` (new)

**Acceptance Criteria**:
- [ ] Syntax: `gaib import <address> <id>`
- [ ] Address format: `discord_role.admin`, `discord_channel.general`
- [ ] Validates resource type
- [ ] Fetches resource from Discord API
- [ ] Adds to state with specified name
- [ ] Acquires lock during import
- [ ] Error if address already exists in state
- [ ] Help text with examples

**Complexity**: M

---

#### 99.3: Implement `gaib state list` Command

**Description**: List all resources in current state.

**Files**:
- `packages/cli/src/commands/server/state.ts` (new)

**Acceptance Criteria**:
- [ ] Lists all resources in state
- [ ] Shows type, name, and ID
- [ ] `--json` flag for machine output
- [ ] Empty message if no resources

**Complexity**: S

---

#### 99.4: Implement `gaib state show` Command

**Description**: Show detailed information about a specific resource.

**Files**:
- `packages/cli/src/commands/server/state.ts` (extend)

**Acceptance Criteria**:
- [ ] Syntax: `gaib state show <address>`
- [ ] Shows all attributes
- [ ] Shows dependencies
- [ ] `--json` flag for machine output
- [ ] Error if resource not found

**Complexity**: S

---

#### 99.5: Implement `gaib state rm` Command

**Description**: Remove a resource from state without affecting Discord.

**Files**:
- `packages/cli/src/commands/server/state.ts` (extend)

**Acceptance Criteria**:
- [ ] Syntax: `gaib state rm <address>`
- [ ] Removes from state only (not Discord)
- [ ] Requires confirmation
- [ ] Updates state serial
- [ ] Acquires lock during operation

**Complexity**: S

---

#### 99.6: Implement `gaib state mv` Command

**Description**: Rename a resource in state.

**Files**:
- `packages/cli/src/commands/server/state.ts` (extend)

**Acceptance Criteria**:
- [ ] Syntax: `gaib state mv <source> <destination>`
- [ ] Renames resource in state
- [ ] Updates references in other resources
- [ ] Acquires lock during operation

**Complexity**: M

---

#### 99.7: Implement `gaib state pull` Command

**Description**: Refresh state from actual Discord server.

**Files**:
- `packages/cli/src/commands/server/state.ts` (extend)

**Acceptance Criteria**:
- [ ] Fetches current state from Discord
- [ ] Updates state with actual values
- [ ] Reports drift from expected state
- [ ] Acquires lock during operation

**Complexity**: M

---

### Sprint 99 Summary

| Task | Complexity | Files |
|------|------------|-------|
| 99.1 | M | 1 extend |
| 99.2 | M | 1 new |
| 99.3 | S | 1 new |
| 99.4 | S | 1 extend |
| 99.5 | S | 1 extend |
| 99.6 | M | 1 extend |
| 99.7 | M | 1 extend |

**Total**: 7 tasks, 2 new files, 5 extended files

---

## Sprint 100: Theme System

**Goal**: Implement theme loading, merging, and the Sietch reference theme

**Priority**: P1 (Important)
**Depends On**: 96, 98
**Blocks**: None

### Tasks

#### 100.1: Create ThemeManifestSchema

**Description**: Define the schema for theme.yaml manifest files.

**Files**:
- `packages/cli/src/commands/server/themes/ThemeSchema.ts` (new)

**Acceptance Criteria**:
- [ ] Zod schema for theme manifest
- [ ] Supports: name, version, description, author, license
- [ ] Variables with type, default, required
- [ ] Files section (server.yaml, roles.yaml, channels.yaml)
- [ ] Optional extends for theme inheritance
- [ ] Tags for discovery

**Complexity**: S

---

#### 100.2: Implement ThemeLoader

**Description**: Load themes from local filesystem.

**Files**:
- `packages/cli/src/commands/server/themes/ThemeLoader.ts` (new)
- `packages/cli/src/commands/server/themes/ThemeLoader.test.ts` (new)

**Acceptance Criteria**:
- [ ] `load(name, source, variables)` method
- [ ] Loads manifest from theme.yaml
- [ ] Loads component files (server, roles, channels)
- [ ] Interpolates `${var}` syntax with variables
- [ ] Resolves defaults for unspecified variables
- [ ] Error for missing required variables
- [ ] Caching for loaded themes

**Complexity**: M

---

#### 100.3: Implement ThemeMerger

**Description**: Merge theme configuration with user overrides.

**Files**:
- `packages/cli/src/commands/server/themes/ThemeMerger.ts` (new)
- `packages/cli/src/commands/server/themes/ThemeMerger.test.ts` (new)

**Acceptance Criteria**:
- [ ] User config takes precedence over theme
- [ ] Merges roles by name (user overrides theme)
- [ ] Merges categories by name
- [ ] Merges channels by name
- [ ] Backend config from user only
- [ ] Hooks config from user only

**Complexity**: M

---

#### 100.4: Create Sietch Reference Theme

**Description**: Create the full Sietch theme as reference implementation.

**Files**:
- `themes/sietch/theme.yaml` (new)
- `themes/sietch/server.yaml` (new)
- `themes/sietch/roles.yaml` (new)
- `themes/sietch/channels.yaml` (new)
- `themes/sietch/README.md` (new)

**Acceptance Criteria**:
- [ ] Theme manifest with variables (community_name, primary_color)
- [ ] Complete role hierarchy (Naib, Sayyadina, Fedaykin, Fremen, Pilgrim)
- [ ] Channel structure matching Dune theme
- [ ] Permission configurations
- [ ] README with usage instructions

**Complexity**: M

---

#### 100.5: Implement `gaib theme list` Command

**Description**: List available themes.

**Files**:
- `packages/cli/src/commands/server/theme.ts` (new)

**Acceptance Criteria**:
- [ ] Lists themes from local `themes/` directory
- [ ] Shows name, version, description
- [ ] `--json` flag for machine output

**Complexity**: S

---

#### 100.6: Implement `gaib theme info` Command

**Description**: Show detailed theme information.

**Files**:
- `packages/cli/src/commands/server/theme.ts` (extend)

**Acceptance Criteria**:
- [ ] Syntax: `gaib theme info <name>`
- [ ] Shows manifest details
- [ ] Lists available variables with defaults
- [ ] Shows file structure
- [ ] `--json` flag for machine output

**Complexity**: S

---

#### 100.7: Integrate Themes into Init/Apply

**Description**: Allow specifying theme during init and applying theme configs.

**Files**:
- `packages/cli/src/commands/server/init.ts` (extend)
- `packages/cli/src/commands/server/iac/ConfigParser.ts` (extend)

**Acceptance Criteria**:
- [ ] `gaib init --theme sietch` option
- [ ] Theme reference in gaib.yaml
- [ ] ConfigParser loads and merges theme
- [ ] Variables can be set in gaib.yaml

**Complexity**: M

---

### Sprint 100 Summary

| Task | Complexity | Files |
|------|------------|-------|
| 100.1 | S | 1 new |
| 100.2 | M | 2 new |
| 100.3 | M | 2 new |
| 100.4 | M | 5 new |
| 100.5 | S | 1 new |
| 100.6 | S | 1 extend |
| 100.7 | M | 2 extend |

**Total**: 7 tasks, 11 new files, 3 extended files

---

## Sprint 101: Polish & Documentation

**Goal**: Error handling improvements, JSON output, CLI polish, documentation

**Priority**: P1 (Important)
**Depends On**: 98, 99, 100
**Blocks**: None (Release)

### Tasks

#### 101.1: Create Error Hierarchy

**Description**: Implement comprehensive error types for better error handling.

**Files**:
- `packages/cli/src/commands/server/iac/errors.ts` (new)

**Acceptance Criteria**:
- [ ] GaibError base class with code and recoverable flag
- [ ] ConfigError for configuration issues
- [ ] StateError and StateLockError for state issues
- [ ] DiscordApiError with status codes
- [ ] RateLimitError with retry info
- [ ] ValidationError with detailed issues

**Complexity**: S

---

#### 101.2: Implement Error Recovery

**Description**: Add error recovery strategies for common errors.

**Files**:
- `packages/cli/src/commands/server/iac/ErrorRecovery.ts` (new)

**Acceptance Criteria**:
- [ ] Recovery strategies for lock errors
- [ ] Auto-retry on rate limit errors
- [ ] Helpful suggestions for config errors
- [ ] Recovery context (operation, workspace, attempt)

**Complexity**: M

---

#### 101.3: Add --json Flag to All Commands

**Description**: Ensure all commands support machine-readable JSON output.

**Files**:
- All command files (extend)

**Acceptance Criteria**:
- [ ] `--json` flag on: plan, apply, destroy, import
- [ ] `--json` flag on: state list/show/rm/mv/pull
- [ ] `--json` flag on: workspace list/show
- [ ] `--json` flag on: theme list/info
- [ ] Consistent JSON structure across commands
- [ ] No ANSI colors in JSON mode

**Complexity**: M

---

#### 101.4: Improve Output Formatting

**Description**: Polish terminal output for better UX.

**Files**:
- `packages/cli/src/commands/server/iac/formatters.ts` (new)

**Acceptance Criteria**:
- [ ] `formatPlan()` with colored diff output
- [ ] `formatApplyResult()` with summary
- [ ] `formatDestroyResult()` with summary
- [ ] `formatStateList()` as table
- [ ] Progress spinners for long operations
- [ ] Respect `--no-color` flag

**Complexity**: M

---

#### 101.5: Update Help Text

**Description**: Ensure all commands have comprehensive help text.

**Files**:
- All command files (extend)

**Acceptance Criteria**:
- [ ] Clear description for each command
- [ ] Examples in help text
- [ ] All options documented
- [ ] Consistent formatting

**Complexity**: S

---

#### 101.6: Create User Documentation

**Description**: Write getting started guide and reference documentation.

**Files**:
- `docs/gaib/README.md` (new)
- `docs/gaib/getting-started.md` (new)
- `docs/gaib/configuration.md` (new)
- `docs/gaib/themes.md` (new)

**Acceptance Criteria**:
- [ ] Getting started guide with quick example
- [ ] Configuration reference (gaib.yaml)
- [ ] Theme authoring guide
- [ ] Command reference
- [ ] Troubleshooting section

**Complexity**: M

---

#### 101.7: Integration Tests

**Description**: End-to-end tests for full workflows.

**Files**:
- `packages/cli/tests/e2e/gaib-workflow.test.ts` (new)

**Acceptance Criteria**:
- [ ] Test: init -> plan -> apply -> destroy
- [ ] Test: workspace create -> switch -> delete
- [ ] Test: import -> state show -> state rm
- [ ] Test: theme apply
- [ ] Mock Discord API for tests

**Complexity**: L

---

### Sprint 101 Summary

| Task | Complexity | Files |
|------|------------|-------|
| 101.1 | S | 1 new |
| 101.2 | M | 1 new |
| 101.3 | M | ~10 extend |
| 101.4 | M | 1 new |
| 101.5 | S | ~10 extend |
| 101.6 | M | 4 new |
| 101.7 | L | 1 new |

**Total**: 7 tasks, 8 new files, ~20 extended files

---

## Dependency Graph

```
Sprint 96: Remote State Backend
    |
    v
Sprint 97: Workspace Management
    |
    +---------------------------+
    |                           |
    v                           v
Sprint 98: Apply & Destroy    Sprint 99: Import & State
    |                           |
    +---------------------------+
    |
    v
Sprint 100: Theme System
    |
    v
Sprint 101: Polish & Documentation
    |
    v
  RELEASE v2.0.0
```

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Discord API rate limits | HIGH | MEDIUM | RateLimiter already implemented |
| S3/DynamoDB permission issues | MEDIUM | HIGH | Document IAM requirements |
| State corruption | LOW | CRITICAL | Checksums, backup before apply |
| Theme variable escaping | LOW | MEDIUM | Thorough testing |
| Concurrent modification | MEDIUM | MEDIUM | DynamoDB locking |

---

## Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| All tests passing | 100% | CI/CD |
| Code coverage | >80% | Jest coverage |
| Plan operation | <5s | Benchmark |
| Apply operation (10 resources) | <30s | Benchmark |
| No breaking changes to v1 | 0 | Manual verification |

---

## Implementation Order

For maximum parallelism with a single developer:

1. **Sprint 96** (Foundation - must complete first)
2. **Sprint 97** (Workspaces - depends on 96)
3. **Sprint 98 + 99** (Apply/Destroy + State - can interleave)
4. **Sprint 100** (Themes - depends on 98)
5. **Sprint 101** (Polish - after all features)

---

## Next Steps

Start with:
```
/implement sprint-96
```

---

**Document Status**: READY FOR IMPLEMENTATION
**Sprint Plan By**: Planning Agent
**Date**: 2026-01-19

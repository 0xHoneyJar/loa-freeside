# Sprint 97: Workspace Management - Implementation Report

**Sprint**: 97
**Theme**: Workspace Management for Environment Isolation
**Status**: Complete
**Date**: 2026-01-19

## Summary

Implemented workspace management for the Gaib CLI, enabling environment isolation (dev/staging/production) with separate state files per workspace. This builds on Sprint 96's Remote State Backend foundation.

## Tasks Completed

| Task | Description | Status |
|------|-------------|--------|
| 97.1 | Create WorkspaceManager core logic | Complete |
| 97.2 | Implement `gaib workspace list` command | Complete |
| 97.3 | Implement `gaib workspace new` command | Complete |
| 97.4 | Implement `gaib workspace select` command | Complete |
| 97.5 | Implement `gaib workspace show` command | Complete |
| 97.6 | Implement `gaib workspace delete` command | Complete |
| 97.7 | Update existing commands for workspace context | Complete |

## Files Created

### 1. `packages/cli/src/commands/server/iac/WorkspaceManager.ts`

Core workspace management logic with:

- **WorkspaceManager class**: Full lifecycle management
  - `current()`: Returns current workspace (defaults to "default")
  - `list()`: Lists all workspaces with resource counts
  - `create(name, options)`: Creates new workspace with validation
  - `select(name, options)`: Switches to workspace (optionally creates)
  - `show(name?)`: Shows workspace details
  - `delete(name, options)`: Deletes workspace (with safety checks)
  - `exists(name)`: Checks workspace existence
  - `getState()/setState()`: State helpers for current workspace

- **WorkspaceError class**: Typed errors with codes:
  - `INVALID_NAME`: Invalid workspace name format
  - `WORKSPACE_EXISTS`: Workspace already exists
  - `WORKSPACE_NOT_FOUND`: Workspace doesn't exist
  - `CANNOT_DELETE_DEFAULT`: Cannot delete default workspace
  - `CANNOT_DELETE_CURRENT`: Cannot delete current workspace
  - `WORKSPACE_NOT_EMPTY`: Workspace has resources (requires --force)

- **Factory functions**:
  - `createWorkspaceManager()`: Auto-detects backend from config
  - `createWorkspaceManagerWithBackend()`: Uses explicit backend

- **Validation rules**:
  - Pattern: `/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/`
  - Max length: 64 characters
  - Must start with alphanumeric

### 2. `packages/cli/src/commands/server/workspace.ts`

CLI command implementations:

- `workspaceListCommand(options)`: Lists workspaces with current marker
- `workspaceNewCommand(name, options)`: Creates and switches to workspace
- `workspaceSelectCommand(name, options)`: Switches workspace (--create flag)
- `workspaceShowCommand(name?, options)`: Shows workspace details
- `workspaceDeleteCommand(name, options)`: Deletes with confirmation

All commands support:
- `--json` flag for machine-readable output
- `--quiet` flag for minimal output
- Proper error handling with WorkspaceError

### 3. `packages/cli/src/commands/server/iac/__tests__/WorkspaceManager.test.ts`

Comprehensive unit tests (40 tests):
- `current()`: 4 tests
- `list()`: 5 tests
- `create()`: 8 tests
- `select()`: 5 tests
- `show()`: 4 tests
- `delete()`: 5 tests
- `exists()`: 3 tests
- State helpers: 2 tests
- WorkspaceError: 3 tests

## Files Modified

### 1. `packages/cli/src/commands/server/index.ts`

- Added `registerWorkspaceCommand()` function
- Registered workspace subcommands: list, new, select, show, delete
- Added `-w, --workspace <name>` option to plan and diff commands
- Updated help text with workspace command examples

### 2. `packages/cli/src/commands/server/plan.ts`

- Added workspace context loading
- Displays current workspace in output
- Supports `--workspace` flag to override current workspace

### 3. `packages/cli/src/commands/server/diff.ts`

- Added workspace context loading
- Displays current workspace in output
- Supports `--workspace` flag to override current workspace

## Architecture

```
WorkspaceManager
       |
       v
  StateBackend (from Sprint 96)
       |
       +-- LocalBackend (.gaib/state.json)
       +-- S3Backend (s3://bucket/prefix/)
```

Workspace state is stored per-workspace in the backend:
- Local: `.gaib/workspaces/{name}/state.json`
- S3: `s3://bucket/prefix/{name}/state.json`

Current workspace tracked in: `.gaib/workspace`

## Usage Examples

```bash
# List workspaces
$ gaib server workspace list
* default     (0 resources)
  staging     (5 resources)
  production  (12 resources)

# Create new workspace
$ gaib server workspace new staging
Created and switched to workspace "staging".

# Switch workspace
$ gaib server workspace select production
Switched to workspace "production".

# Show workspace details
$ gaib server workspace show
Workspace:  production
Current:    yes
Backend:    local
Resources:  12
Serial:     24
Modified:   2026-01-19T10:30:00Z

# Delete workspace
$ gaib server workspace delete staging --yes
Deleted workspace "staging".

# Plan with workspace override
$ gaib server plan --workspace staging
Workspace: staging
Planning changes for guild 123456789...
```

## Test Results

```
 ✓ src/commands/server/iac/__tests__/WorkspaceManager.test.ts (40 tests) 101ms

 Test Files  1 passed (1)
      Tests  40 passed (40)
```

## Acceptance Criteria

| Criterion | Status |
|-----------|--------|
| Workspace creation with validation | Pass |
| Workspace listing with resource counts | Pass |
| Workspace selection/switching | Pass |
| Workspace deletion with safety checks | Pass |
| Current workspace persistence | Pass |
| Integration with existing commands | Pass |
| JSON output support | Pass |
| Unit test coverage | Pass (40 tests) |

## Dependencies

- Sprint 96: Remote State Backend (StateBackend interface)
- Commander.js for CLI
- Chalk for terminal formatting

## Notes

- Default workspace is always available and cannot be deleted
- Workspace names follow Terraform-like conventions
- Current workspace is persisted across CLI invocations
- Non-empty workspaces require `--force` flag to delete
- Backend is properly closed after each operation to prevent resource leaks

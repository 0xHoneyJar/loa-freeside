# Sprint 99: Import & State Commands - Implementation Report

**Sprint**: 99
**Date**: 2026-01-19
**Status**: Implementation Complete

## Summary

Implemented the Import & State Commands for the Gaib CLI, providing Terraform-like state management capabilities for importing existing Discord resources and manipulating state directly.

## Tasks Completed

### S-99.1: Extend DiscordClient for Resource Fetching
- Added `ResourceType` type: `'role' | 'channel' | 'category'`
- Added `FetchedResource` interface for standardized resource data
- Added `fetchRole()` method to fetch a single role by ID
- Added `fetchChannel()` method to fetch a single channel by ID
- Added `fetchResource()` method that normalizes Discord API data to state-compatible format
- Updated `iac/index.ts` exports

### S-99.2: Implement Import Command
- Created `import.ts` with full command implementation
- Features:
  - Parse resource address format: `discord_<type>.<name>` (e.g., `discord_role.admin`)
  - Fetch resource from Discord API by ID
  - Convert to StateResource format
  - Add to workspace state with locking
  - Validate resource doesn't already exist in state
  - JSON output mode for CI/CD integration

### S-99.3: Implement State List Command
- Lists all resources in current workspace state
- Groups resources by type (roles, channels, categories)
- Shows resource ID, name, and address
- Shows state serial number
- JSON output mode

### S-99.4: Implement State Show Command
- Shows detailed information about a specific resource
- Displays all attributes from state
- Validates resource exists
- JSON output mode

### S-99.5: Implement State Rm Command
- Removes a resource from state (does not delete from Discord)
- Requires confirmation (or `--yes` flag)
- Uses state locking during operation
- Increments state serial number
- JSON output mode

### S-99.6: Implement State Mv Command
- Moves/renames a resource address in state
- Validates source exists and destination doesn't
- Validates source and destination are same type
- Uses state locking during operation
- Increments state serial number
- JSON output mode

### S-99.7: Implement State Pull Command
- Refreshes all state resources from Discord
- Updates attributes with current Discord values
- Reports resources not found in Discord
- Uses state locking during operation
- Increments state serial only if changes made
- JSON output mode with detailed failure reporting

### S-99.8: CLI Registration
- Registered `gaib server import` command
- Registered `gaib server state` command group with subcommands:
  - `list` - List all resources
  - `show <address>` - Show resource details
  - `rm <address>` - Remove from state
  - `mv <source> <destination>` - Rename resource
  - `pull` - Refresh from Discord
- Updated help text with examples

## Files Created

| File | Lines | Purpose |
|------|-------|---------|
| `import.ts` | ~250 | Import command implementation |
| `state.ts` | ~810 | State commands (list, show, rm, mv, pull) |
| `iac/__tests__/import.test.ts` | ~270 | Import command unit tests |
| `iac/__tests__/state.test.ts` | ~440 | State commands unit tests |

## Files Modified

| File | Changes |
|------|---------|
| `iac/DiscordClient.ts` | Added fetchResource methods and types |
| `iac/index.ts` | Added ResourceType, FetchedResource exports |
| `index.ts` | Registered import and state commands |

## Test Coverage

Created comprehensive unit tests with 37 test cases:

- `import.test.ts` - 14 tests covering:
  - Address parsing (valid/invalid formats)
  - Resource type validation
  - State management (creation, duplicate detection)
  - Guild ID handling
  - Workspace handling
  - JSON output

- `state.test.ts` - 23 tests covering:
  - State list (empty, populated, JSON)
  - State show (found, not found, invalid address)
  - State rm (removal, confirmation, errors)
  - State mv (rename, type mismatch, conflicts)
  - State pull (update, failures, serial increment)
  - Workspace handling

## Architecture Decisions

1. **Lock-First Design**: All state-modifying operations (rm, mv, pull) acquire locks to prevent concurrent modifications.

2. **Address Format**: Uses Terraform-compatible format `discord_<type>.<name>` for resource addressing.

3. **State Preservation**: The `rm` command removes from state only - does not delete from Discord. This allows re-import if needed.

4. **Pull Safety**: The `pull` command reports resources not found in Discord but doesn't automatically remove them.

## Commands Added

```bash
# Import existing Discord resources
gaib server import discord_role.admin <role-id> --guild <id>
gaib server import discord_channel.general <channel-id> --guild <id>
gaib server import discord_category.info <category-id> --guild <id>

# List all resources in state
gaib server state list
gaib server state list --json

# Show resource details
gaib server state show discord_role.admin
gaib server state show discord_channel.general --json

# Remove from state (does not delete from Discord)
gaib server state rm discord_role.admin
gaib server state rm discord_role.admin --yes  # Skip confirmation

# Rename resource address
gaib server state mv discord_role.old_name discord_role.new_name

# Refresh state from Discord
gaib server state pull --guild <id>
gaib server state pull --guild <id> --json
```

## Notes for Reviewer

1. All tests pass (37/37)
2. Code follows existing patterns from Sprint 98 (ApplyEngine, StateLock)
3. JSON output mode supported for all commands for CI/CD integration
4. State locking prevents race conditions on concurrent operations
5. Error messages include actionable guidance

## Known Limitations

1. `state pull` requires guild ID to be specified (could auto-detect from state in future)
2. No `state push` command yet (would require careful conflict resolution)
3. Import only supports role, channel, category types (matching existing IaC support)

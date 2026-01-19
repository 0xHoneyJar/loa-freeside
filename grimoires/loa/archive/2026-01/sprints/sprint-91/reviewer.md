# Sprint 91 Implementation Report

**Sprint**: S-91 - IaC Core: Config Parsing & State Reading
**Engineer**: Claude
**Date**: 2026-01-18
**Status**: Complete

## Summary

Implemented the foundational Discord Infrastructure-as-Code (IaC) system for the gaib CLI. This sprint establishes the core components for parsing YAML configuration files and reading current Discord server state.

## Completed Tasks

### S-91.1: Directory Structure and Dependencies ✅

Created the IaC module directory structure and added required dependencies:

```
packages/cli/src/commands/server/iac/
├── index.ts           # Barrel export
├── schemas.ts         # Zod validation schemas
├── types.ts           # Internal state types
├── ConfigParser.ts    # YAML parsing and validation
├── StateReader.ts     # Discord state fetching
├── DiscordClient.ts   # Discord REST API wrapper
└── __tests__/
    ├── schemas.test.ts
    ├── ConfigParser.test.ts
    ├── StateReader.test.ts
    └── integration.test.ts
```

**Dependencies added to `package.json`**:
- `@discordjs/rest` ^2.4.0 - Discord REST API client
- `discord-api-types` ^0.37.100 - Discord type definitions
- `js-yaml` ^4.1.0 - YAML parsing
- `zod` ^3.23.8 - Schema validation
- `@types/js-yaml` ^4.0.9 - TypeScript types for js-yaml

### S-91.2: Zod Schemas for Configuration Validation ✅

Implemented comprehensive Zod schemas in `schemas.ts`:

- **PermissionFlag**: Enum covering all 36 Discord permission flags
- **PERMISSION_FLAGS**: Bitfield mapping for all permissions
- **ColorSchema**: Hex color validation with 3→6 digit normalization
- **RoleSchema**: Role configuration validation
- **CategorySchema**: Category configuration validation
- **ChannelSchema**: Channel configuration with type-specific validation
- **ServerConfigSchema**: Top-level config with cross-reference validation

**Key Features**:
- Supports shorthand color notation (#FFF → #FFFFFF)
- Validates channel name format (lowercase, alphanumeric, hyphens, underscores)
- Cross-reference validation (category/role references must exist)
- Duplicate name detection (case-insensitive)

### S-91.3: ConfigParser Component ✅

Implemented `ConfigParser.ts` with:

- `parseConfigFile(path)` - Parse from file path
- `parseConfigString(content)` - Parse from YAML string
- `validateConfig(config)` - Validate without file I/O
- `serializeConfig(config)` - Convert to clean YAML output
- `createEmptyConfig()` - Create minimal valid config

**Error Handling**:
- `ConfigError` class with error codes
- Detailed error messages with paths
- Warnings for potential issues (admin permissions, high positions)

### S-91.4: Internal State Representation Types ✅

Defined TypeScript types in `types.ts`:

- **ServerState**: Complete server state snapshot
- **RoleState**: Role with all properties and IaC tracking
- **CategoryState**: Category with permission overwrites
- **ChannelState**: Channel with type-specific fields
- **PermissionOverwriteState**: Allow/deny permission sets
- **Diff Types**: ServerDiff, ResourceChange, FieldChange
- **Apply Types**: ApplyResult, ApplyBatchResult

### S-91.5: StateReader Component ✅

Implemented `StateReader.ts` with:

- `readServerState(client, guildId, options)` - Fetch complete state
- `findRoleByName/findCategoryByName/findChannelByName` - Lookups
- `getEveryoneRole(state)` - Get @everyone role
- `getManagedResources(state)` - Filter IaC-managed resources
- `buildResourceMappings(state)` - Name→ID maps

**Features**:
- Parallel API fetching (guild, roles, channels)
- Permission bitfield→flag array conversion
- Role hierarchy sorting (position descending)
- Channel/category position sorting (ascending)
- IaC management detection via `[managed-by:arrakis-iac]` marker

### S-91.6: Discord REST Client Wrapper ✅

Implemented `DiscordClient.ts` with:

- `DiscordClient` class wrapping `@discordjs/rest`
- `fetchGuildData()` - Parallel fetch of guild, roles, channels
- `fetchGuild/fetchRoles/fetchChannels()` - Individual fetchers
- `validateGuildAccess()` - Verify bot access

**Error Handling**:
- `DiscordApiError` class with typed error codes
- Token masking for display
- HTTP status code mapping:
  - 401 → INVALID_TOKEN
  - 403 → MISSING_PERMISSIONS
  - 404 → GUILD_NOT_FOUND
  - 429 → RATE_LIMITED

### S-91.7: Unit Tests ✅

**schemas.test.ts** (55 tests):
- Permission bitfield conversion roundtrips
- Color normalization and validation
- Schema validation for roles, categories, channels
- Managed marker utilities

**ConfigParser.test.ts** (33 tests):
- YAML parsing (valid and invalid)
- Schema validation errors
- Cross-reference validation
- Config serialization roundtrip
- Error formatting

**StateReader.test.ts** (18 tests):
- Resource lookup utilities
- Managed resource filtering
- Resource mapping generation

### S-91.8: Integration Tests ✅

**integration.test.ts** (29 tests, 26 conditional):
- Discord API integration tests (require INTEGRATION_TEST=1)
- Token validation
- Guild data fetching
- State reading with all options
- Error handling scenarios

## Code Quality

### Test Coverage
- **106 unit tests** for IaC module
- **26 integration tests** (skipped by default, run with env vars)
- All tests passing

### Design Patterns
- **Barrel exports**: Clean public API via `index.ts`
- **Error hierarchy**: Typed errors with codes for CLI handling
- **Utility functions**: Reusable helpers for common operations
- **Type safety**: Full TypeScript coverage with Zod runtime validation

### SDD Alignment
- Follows SDD §4.1 (ConfigParser)
- Follows SDD §4.2 (StateReader)
- Follows SDD §4.7 (DiscordClient)
- Follows SDD §5 (schemas)

## Files Created

| File | Lines | Purpose |
|------|-------|---------|
| `index.ts` | 96 | Barrel export |
| `schemas.ts` | 506 | Zod schemas |
| `types.ts` | 350 | State types |
| `ConfigParser.ts` | 439 | YAML parsing |
| `StateReader.ts` | 345 | State fetching |
| `DiscordClient.ts` | 333 | REST client |
| `__tests__/schemas.test.ts` | 380 | Schema tests |
| `__tests__/ConfigParser.test.ts` | 425 | Parser tests |
| `__tests__/StateReader.test.ts` | 235 | Reader tests |
| `__tests__/integration.test.ts` | 295 | Integration tests |

**Total**: ~3,400 lines of code

## Known Issues

1. **Pre-existing sandbox test failures**: `create.test.ts` and `destroy.test.ts` have mock issues with `isInteractive()` - not related to Sprint 91

## Next Steps (Sprint 92)

1. Implement DiffEngine for comparing desired vs current state
2. Implement ApplyEngine for executing changes via Discord API
3. Add CLI commands: `gaib server init`, `gaib server plan`, `gaib server apply`

## Verification Commands

```bash
# Run unit tests
pnpm test -- src/commands/server/iac/__tests__

# Run integration tests (requires Discord credentials)
INTEGRATION_TEST=1 \
DISCORD_BOT_TOKEN=your-token \
DISCORD_GUILD_ID=your-guild \
pnpm test -- src/commands/server/iac/__tests__/integration.test.ts
```

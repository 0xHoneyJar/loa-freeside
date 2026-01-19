# Sprint Plan: Discord Infrastructure-as-Code

**Feature**: Discord Infrastructure-as-Code
**PRD Reference**: `grimoires/loa/discord-iac-prd.md`
**SDD Reference**: `grimoires/loa/discord-iac-sdd.md`
**Feature Branch**: `feature/discord-iac`
**Base Branch**: `staging`
**Team**: 1 AI developer (Claude) with human oversight
**Sprint Duration**: ~1 week per sprint
**Total Sprints**: 3 (S-91, S-92, S-93)

---

## Sprint Overview

| Sprint | Focus | Duration | Goal |
|--------|-------|----------|------|
| **S-91** | IaC Core - Config Parsing & State Reading | 1 week | Parse YAML configs and read Discord server state |
| **S-92** | IaC Engine - Diff Calculation & State Application | 1 week | Calculate diffs and apply changes to Discord |
| **S-93** | CLI Commands & Polish | 1 week | Expose functionality via gaib CLI commands |

---

## Sprint S-91: IaC Core - Config Parsing & State Reading

**Goal**: Establish the foundation by implementing YAML config parsing with validation and Discord state fetching

**Success Metrics**:
- Config files parse successfully with clear validation errors
- Zod schemas validate all configuration constraints
- Discord state can be fetched and mapped to internal representation
- >80% unit test coverage for core components

### Tasks

#### S-91.1: Set up directory structure and dependencies

**Description**: Create the IaC component directory structure and add required npm dependencies

**Acceptance Criteria**:
- [ ] Directory `packages/cli/src/commands/server/iac/` created
- [ ] `js-yaml` (^4.1.0) added to `packages/cli/package.json`
- [ ] `zod` dependency verified (already in workspace)
- [ ] TypeScript compilation works without errors

**Files to Create/Modify**:
- `packages/cli/src/commands/server/iac/` (new directory)
- `packages/cli/package.json` (modify dependencies)

**Dependencies**: None

**Complexity**: Low

---

#### S-91.2: Define Zod schemas for configuration validation

**Description**: Create comprehensive Zod schemas for YAML config validation including roles, channels, categories, permissions

**Acceptance Criteria**:
- [ ] `schemas.ts` defines all config schemas (PRD §4.2)
- [ ] Permission enum includes all MVP permissions
- [ ] Color validation regex works (#RRGGBB format)
- [ ] Schema exports TypeScript types via `z.infer`
- [ ] Schema validation catches common errors (duplicate names, invalid references)

**Files to Create/Modify**:
- `packages/cli/src/commands/server/iac/schemas.ts` (new)

**Dependencies**: S-91.1

**Complexity**: Medium

**Implementation Notes**:
```typescript
// Key schemas to implement:
- PermissionSchema (enum)
- ColorSchema (regex validation)
- RoleSchema (with defaults)
- CategorySchema
- ChannelSchema (with permissions)
- ServerConfigSchema (top-level)
```

---

#### S-91.3: Implement ConfigParser component

**Description**: Create ConfigParser class to parse YAML files and validate against Zod schemas

**Acceptance Criteria**:
- [ ] ConfigParser reads YAML files via `js-yaml`
- [ ] Validates config against ServerConfigSchema
- [ ] Provides detailed error messages for validation failures
- [ ] Validates cross-references (category names, role names in permissions)
- [ ] Detects duplicate resource names
- [ ] ConfigError class provides structured error information

**Files to Create/Modify**:
- `packages/cli/src/commands/server/iac/ConfigParser.ts` (new)

**Dependencies**: S-91.2

**Complexity**: Medium

**Implementation Notes**:
- Follow pattern from SDD §4.2.1
- Implement `parse(filePath)` and `validateConstraints(config)` methods
- Reference: PRD §4.2 for config schema

---

#### S-91.4: Implement types.ts for internal state representation

**Description**: Define TypeScript interfaces for Discord state representation (DiscordRole, DiscordChannel, etc.)

**Acceptance Criteria**:
- [ ] `types.ts` defines all internal state interfaces
- [ ] DiscordState, DiscordRole, DiscordChannel, DiscordCategory interfaces
- [ ] Diff, ResourceDiff, ApplyResult interfaces
- [ ] PermissionOverwrite interface matches Discord API structure
- [ ] All interfaces documented with TSDoc comments

**Files to Create/Modify**:
- `packages/cli/src/commands/server/iac/types.ts` (new)

**Dependencies**: S-91.1

**Complexity**: Low

**Implementation Notes**:
- Reference SDD §5.3 for complete interface definitions

---

#### S-91.5: Implement DiscordRestClient wrapper

**Description**: Create wrapper around @discordjs/rest with bot token authentication

**Acceptance Criteria**:
- [ ] DiscordRestClient initializes REST client with bot token
- [ ] `getClient()` method exposes underlying REST instance
- [ ] `verifyPermissions(guildId)` checks required bot permissions
- [ ] Validates bot has MANAGE_ROLES, MANAGE_CHANNELS, MANAGE_GUILD
- [ ] Clear error messages for missing permissions

**Files to Create/Modify**:
- `packages/cli/src/commands/server/iac/DiscordRestClient.ts` (new)
- `packages/cli/src/commands/server/utils.ts` (new - getBotToken helper)

**Dependencies**: S-91.4

**Complexity**: Low

**Implementation Notes**:
- Reference SDD §4.2.7
- Bot token from `DISCORD_BOT_TOKEN` environment variable

---

#### S-91.6: Implement StateReader component

**Description**: Fetch current Discord server state via Discord API and map to internal representation

**Acceptance Criteria**:
- [ ] StateReader fetches guild metadata, roles, channels via Discord API
- [ ] Separates categories from regular channels (type 4)
- [ ] Maps Discord API responses to DiscordState structure
- [ ] Filters out @everyone role (immutable)
- [ ] Uses ResourceTracker to detect managed resources
- [ ] Handles API errors gracefully with logging

**Files to Create/Modify**:
- `packages/cli/src/commands/server/iac/StateReader.ts` (new)

**Dependencies**: S-91.4, S-91.5

**Complexity**: High

**Implementation Notes**:
- Reference SDD §4.2.2
- Discord API endpoints: PRD Appendix B
- Use Promise.all for parallel fetching (guild, roles, channels)

---

#### S-91.7: Implement ResourceTracker component

**Description**: Track which Discord resources are managed by IaC via metadata tagging

**Acceptance Criteria**:
- [ ] ResourceTracker defines `MANAGED_TAG` constant (`[managed-by:arrakis-iac]`)
- [ ] `isManaged(resource)` checks for tag in description/topic
- [ ] `tagResource(description)` appends tag safely
- [ ] `untagResource(description)` removes tag cleanly
- [ ] Works with undefined/empty descriptions

**Files to Create/Modify**:
- `packages/cli/src/commands/server/iac/ResourceTracker.ts` (new)

**Dependencies**: None

**Complexity**: Low

**Implementation Notes**:
- Reference SDD §4.2.6
- Tag stored in channel `topic` field or role description

---

#### S-91.8: Unit tests for core components

**Description**: Comprehensive unit tests for ConfigParser, StateReader, ResourceTracker, and schemas

**Acceptance Criteria**:
- [ ] ConfigParser tests cover valid/invalid YAML, validation errors
- [ ] StateReader tests use mock Discord API responses
- [ ] ResourceTracker tests cover all tag operations
- [ ] Schema tests validate all constraints
- [ ] >80% code coverage for all components
- [ ] All tests pass in CI

**Files to Create/Modify**:
- `packages/cli/src/commands/server/iac/__tests__/ConfigParser.test.ts` (new)
- `packages/cli/src/commands/server/iac/__tests__/StateReader.test.ts` (new)
- `packages/cli/src/commands/server/iac/__tests__/ResourceTracker.test.ts` (new)
- `packages/cli/src/commands/server/iac/__tests__/schemas.test.ts` (new)

**Dependencies**: S-91.3, S-91.6, S-91.7

**Complexity**: Medium

**Implementation Notes**:
- Use vitest for testing
- Mock Discord API with test fixtures

---

### Sprint S-91 Success Criteria

**Definition of Done**:
- [ ] All S-91 tasks completed and accepted
- [ ] Unit tests pass with >80% coverage
- [ ] TypeScript compilation succeeds with no errors
- [ ] Code reviewed and approved
- [ ] Documentation comments added to all public APIs
- [ ] Can successfully parse YAML config and fetch Discord state

**Risk Assessment**:
- **Risk**: Discord API structure mismatches
  - **Mitigation**: Verify against `discord-api-types` package, test with real API responses
- **Risk**: Complex permission bitfield calculations
  - **Mitigation**: Reference existing `DiscordRest.ts` implementation, comprehensive unit tests

---

## Sprint S-92: IaC Engine - Diff Calculation & State Application

**Goal**: Implement the core IaC engine that calculates diffs and applies changes to Discord with proper ordering and rate limiting

**Success Metrics**:
- Diff engine accurately identifies creates/updates/deletes
- State writer applies changes in correct dependency order
- Rate limiting prevents Discord API errors
- Idempotent operations (re-running produces no changes)

### Tasks

#### S-92.1: Implement PermissionUtils helper

**Description**: Utility class for Discord permission bitfield calculations

**Acceptance Criteria**:
- [ ] PermissionUtils defines permission name → bigint mapping
- [ ] `calculateBits(permissions[])` converts array to bitfield
- [ ] Handles all MVP permissions (PRD §4.7)
- [ ] BigInt arithmetic for 53+ bit values
- [ ] Unit tests verify bit calculations

**Files to Create/Modify**:
- `packages/cli/src/commands/server/iac/PermissionUtils.ts` (new)
- `packages/cli/src/commands/server/iac/__tests__/PermissionUtils.test.ts` (new)

**Dependencies**: None

**Complexity**: Low

**Implementation Notes**:
- Reference SDD §4.2.3 (PermissionUtils class)
- Discord permission bits: VIEW_CHANNEL (1<<10), SEND_MESSAGES (1<<11), etc.

---

#### S-92.2: Implement DiffEngine component

**Description**: Calculate differences between desired config and current Discord state

**Acceptance Criteria**:
- [ ] DiffEngine calculates creates, updates, deletes for roles, channels, categories
- [ ] Correctly identifies when resources need updates (color, permissions, position, etc.)
- [ ] Only marks managed resources for deletion
- [ ] Preserves unmanaged resources (manual creations)
- [ ] Handles empty configs (no false positives)
- [ ] Comprehensive unit tests with multiple scenarios

**Files to Create/Modify**:
- `packages/cli/src/commands/server/iac/DiffEngine.ts` (new)
- `packages/cli/src/commands/server/iac/__tests__/DiffEngine.test.ts` (new)

**Dependencies**: S-91.4, S-92.1

**Complexity**: High

**Implementation Notes**:
- Reference SDD §4.2.3
- Reference PRD §4.6 for idempotency strategy
- Test scenarios from SDD §10.2 (creates, updates, deletes, preserve unmanaged)

---

#### S-92.3: Implement RateLimiter component

**Description**: Handle Discord API rate limits with token bucket and create cooldowns

**Acceptance Criteria**:
- [ ] RateLimiter implements token bucket for global 50 req/s limit
- [ ] Tracks 10-second cooldown for role/channel create operations
- [ ] `wait()` method blocks until rate limit allows request
- [ ] `handleRateLimit(retryAfterMs)` processes 429 responses
- [ ] Logs rate limit warnings
- [ ] Unit tests verify rate limiting behavior

**Files to Create/Modify**:
- `packages/cli/src/commands/server/iac/RateLimiter.ts` (new)
- `packages/cli/src/commands/server/iac/__tests__/RateLimiter.test.ts` (new)

**Dependencies**: None

**Complexity**: Medium

**Implementation Notes**:
- Reference SDD §4.2.5 and §9.2
- Discord limits: PRD §4.3, SDD §6.3
- Token bucket algorithm with refill logic

---

#### S-92.4: Implement RetryHandler component

**Description**: Exponential backoff retry logic for transient API errors

**Acceptance Criteria**:
- [ ] RetryHandler retries operations up to 3 times
- [ ] Exponential backoff with jitter (1s, 2s, 4s + random)
- [ ] Only retries on retryable errors (429, 5xx)
- [ ] Logs retry attempts with context
- [ ] Throws on non-retryable errors
- [ ] Unit tests verify retry behavior

**Files to Create/Modify**:
- `packages/cli/src/commands/server/iac/RetryHandler.ts` (new)
- `packages/cli/src/commands/server/iac/__tests__/RetryHandler.test.ts` (new)

**Dependencies**: None

**Complexity**: Low

**Implementation Notes**:
- Reference SDD §8.3
- Retry only on rate limits (429) and server errors (5xx)

---

#### S-92.5: Implement StateWriter component

**Description**: Apply configuration changes to Discord via REST API with proper ordering

**Acceptance Criteria**:
- [ ] StateWriter applies changes in dependency order (categories → roles → channels)
- [ ] Creates, updates, and deletes resources via Discord API
- [ ] Uses RateLimiter before each API call
- [ ] Uses RetryHandler for transient errors
- [ ] Tags created resources with ResourceTracker
- [ ] Resolves category/role names to IDs for references
- [ ] Returns ApplyResult with detailed success/failure info
- [ ] Logs all operations

**Files to Create/Modify**:
- `packages/cli/src/commands/server/iac/StateWriter.ts` (new)
- `packages/cli/src/commands/server/iac/__tests__/StateWriter.test.ts` (new)

**Dependencies**: S-91.5, S-91.7, S-92.2, S-92.3, S-92.4

**Complexity**: High

**Implementation Notes**:
- Reference SDD §4.2.4
- Discord API endpoints: PRD Appendix B
- Apply order: categories → roles → channels → permissions (SDD §2.2.1)

---

#### S-92.6: Integration tests for IaC engine

**Description**: Integration tests using MSW to mock Discord API

**Acceptance Criteria**:
- [ ] Integration test suite uses MSW to mock Discord API
- [ ] Tests complete flow: parse → fetch → diff → apply
- [ ] Verifies idempotency (re-running produces no changes)
- [ ] Tests error scenarios (rate limits, API errors)
- [ ] Tests dependency ordering (categories before channels)
- [ ] All integration tests pass

**Files to Create/Modify**:
- `packages/cli/src/commands/server/iac/__tests__/integration.test.ts` (new)

**Dependencies**: S-92.2, S-92.5

**Complexity**: High

**Implementation Notes**:
- Reference SDD §10.3
- Use MSW (Mock Service Worker) for HTTP mocking
- Mock Discord API endpoints: GET/POST/PATCH/DELETE for roles, channels, categories

---

### Sprint S-92 Success Criteria

**Definition of Done**:
- [ ] All S-92 tasks completed and accepted
- [ ] Unit and integration tests pass
- [ ] Can calculate diff accurately
- [ ] Can apply changes to Discord successfully
- [ ] Rate limiting works correctly
- [ ] Idempotent (re-running same config = no changes)
- [ ] Code reviewed and approved

**Risk Assessment**:
- **Risk**: Discord API rate limit complications
  - **Mitigation**: Conservative rate limiting, comprehensive testing, progress feedback
- **Risk**: Dependency ordering edge cases
  - **Mitigation**: Clear ordering rules, test complex scenarios
- **Risk**: Partial application failures
  - **Mitigation**: Detailed error reporting, idempotent design allows re-running

---

## Sprint S-93: CLI Commands & Polish

**Goal**: Expose IaC functionality via gaib CLI commands with excellent UX and documentation

**Success Metrics**:
- All CLI commands (init, plan, diff, export) functional
- Colored output and progress feedback
- Helpful error messages
- Complete documentation with examples

### Tasks

#### S-93.1: Create server command group

**Description**: Register server command group in gaib CLI with subcommands

**Acceptance Criteria**:
- [ ] `packages/cli/src/commands/server/index.ts` created
- [ ] Command group registered in main CLI (`packages/cli/src/bin/gaib.ts`)
- [ ] Subcommands registered: init, plan, diff, export
- [ ] Common options: --no-color, --quiet, --json
- [ ] Command structure follows sandbox pattern
- [ ] Help text displays correctly

**Files to Create/Modify**:
- `packages/cli/src/commands/server/index.ts` (new)
- `packages/cli/src/bin/gaib.ts` (modify - register server command)

**Dependencies**: None

**Complexity**: Low

**Implementation Notes**:
- Reference SDD §6.1
- Follow pattern from `packages/cli/src/commands/sandbox/index.ts`

---

#### S-93.2: Implement gaib server init command

**Description**: CLI command to apply configuration to Discord server

**Acceptance Criteria**:
- [ ] `gaib server init <guild-id>` command works
- [ ] `--config <file>` flag (default: server.yaml)
- [ ] `--dry-run` flag shows changes without applying
- [ ] `--force` flag skips confirmation prompt
- [ ] `--json` flag outputs JSON result
- [ ] Displays planned changes before applying (unless --force)
- [ ] Confirmation prompt (y/n) before applying
- [ ] Progress feedback during application (ora spinners)
- [ ] Summary of results (created/updated/deleted counts)
- [ ] Exit codes: 0=success, 1=validation error, 2=partial failure

**Files to Create/Modify**:
- `packages/cli/src/commands/server/init.ts` (new)

**Dependencies**: S-91.3, S-91.6, S-92.2, S-92.5, S-93.1

**Complexity**: High

**Implementation Notes**:
- Reference SDD §6.2
- Flow: parse config → verify permissions → fetch state → calculate diff → confirm → apply → report
- Use chalk for colored output, ora for spinners

---

#### S-93.3: Implement gaib server plan command

**Description**: CLI command to show planned changes without applying

**Acceptance Criteria**:
- [ ] `gaib server plan <guild-id>` command works
- [ ] `--config <file>` flag (default: server.yaml)
- [ ] `--json` flag outputs JSON result
- [ ] Displays creates (green), updates (yellow), deletes (red)
- [ ] Shows detailed diff for updates
- [ ] Summary line (X creates, Y updates, Z deletes)
- [ ] Exit codes: 0=success, 1=validation error

**Files to Create/Modify**:
- `packages/cli/src/commands/server/plan.ts` (new)

**Dependencies**: S-91.3, S-91.6, S-92.2, S-93.1

**Complexity**: Medium

**Implementation Notes**:
- Reference PRD §5.2 for output examples
- Colored output with chalk (green/yellow/red)

---

#### S-93.4: Implement gaib server diff command

**Description**: CLI command to detect configuration drift

**Acceptance Criteria**:
- [ ] `gaib server diff <guild-id>` command works
- [ ] `--config <file>` flag (default: server.yaml)
- [ ] `--json` flag outputs JSON result
- [ ] Displays differences between config and actual state
- [ ] Exit codes: 0=no drift, 1=drift detected, 2=error
- [ ] Clear output showing what drifted
- [ ] Suggestion to run `gaib server init` to fix

**Files to Create/Modify**:
- `packages/cli/src/commands/server/diff.ts` (new)

**Dependencies**: S-91.3, S-91.6, S-92.2, S-93.1

**Complexity**: Medium

**Implementation Notes**:
- Reference PRD §5.2 for output examples
- Similar to plan but focuses on drift detection

---

#### S-93.5: Implement gaib server export command

**Description**: CLI command to export current Discord server state to YAML

**Acceptance Criteria**:
- [ ] `gaib server export <guild-id>` command works
- [ ] `--output <file>` flag (default: stdout)
- [ ] `--managed-only` flag exports only IaC-managed resources
- [ ] Generates valid YAML that can be used as config
- [ ] Includes all roles, channels, categories with current settings
- [ ] Comments document special cases
- [ ] Exit codes: 0=success, 1=error

**Files to Create/Modify**:
- `packages/cli/src/commands/server/export.ts` (new)

**Dependencies**: S-91.6, S-93.1

**Complexity**: Medium

**Implementation Notes**:
- Reverse of ConfigParser: DiscordState → YAML
- Use `js-yaml` to generate YAML output
- Filter out @everyone role and system channels

---

#### S-93.6: Error message improvements

**Description**: Enhance error messages for common failure scenarios

**Acceptance Criteria**:
- [ ] Missing bot token shows clear setup instructions
- [ ] Missing bot permissions shows required permissions and how to add them
- [ ] Invalid YAML shows line numbers and specific issues
- [ ] Config validation errors show field paths and suggestions
- [ ] Rate limit errors show wait time and progress
- [ ] API errors show actionable recovery steps
- [ ] All error messages tested

**Files to Create/Modify**:
- `packages/cli/src/commands/server/utils.ts` (modify)
- Various command files (modify error handling)

**Dependencies**: S-93.2, S-93.3, S-93.4, S-93.5

**Complexity**: Medium

**Implementation Notes**:
- Reference PRD §5.3 for error message examples
- Reference SDD §7.2 for permission validation

---

#### S-93.7: CLI documentation

**Description**: Write comprehensive documentation for IaC feature

**Acceptance Criteria**:
- [ ] `docs/iac.md` created with full documentation
- [ ] Getting started guide (export → edit → plan → init)
- [ ] All commands documented with examples
- [ ] Configuration schema reference
- [ ] Common use cases (token-gated, dev/staging)
- [ ] Troubleshooting section
- [ ] Security best practices (bot token)
- [ ] Links from main README.md

**Files to Create/Modify**:
- `docs/iac.md` (new)
- `README.md` (modify - add IaC section)
- `docs/cli.md` (modify - add server commands)

**Dependencies**: S-93.5

**Complexity**: Medium

**Implementation Notes**:
- Include all examples from PRD Appendix A
- Reference SDD Appendix B for config examples

---

#### S-93.8: E2E tests with real Discord server

**Description**: End-to-end tests against a real Discord test server

**Acceptance Criteria**:
- [ ] E2E test suite runs against real Discord API (when credentials provided)
- [ ] Tests create/update/delete operations
- [ ] Tests idempotency (re-running produces no changes)
- [ ] Tests drift detection
- [ ] Tests export command
- [ ] Skips gracefully if TEST_GUILD_ID or DISCORD_BOT_TOKEN not set
- [ ] Cleans up test resources after run

**Files to Create/Modify**:
- `packages/cli/src/commands/server/iac/__tests__/e2e.test.ts` (new)
- Test fixture configs (new)

**Dependencies**: S-93.2, S-93.3, S-93.4, S-93.5

**Complexity**: High

**Implementation Notes**:
- Reference SDD §10.4
- Use environment variables for test guild ID and bot token
- Create minimal test config to avoid rate limits

---

### Sprint S-93 Success Criteria

**Definition of Done**:
- [ ] All S-93 tasks completed and accepted
- [ ] All CLI commands functional and tested
- [ ] E2E tests pass (when run with credentials)
- [ ] Documentation complete and reviewed
- [ ] CLI output is clear and helpful
- [ ] Error messages are actionable
- [ ] Code reviewed and approved
- [ ] Feature ready for merge to staging

**Risk Assessment**:
- **Risk**: Complex CLI UX edge cases
  - **Mitigation**: Manual testing with various scenarios, user feedback
- **Risk**: Documentation gaps
  - **Mitigation**: Comprehensive examples, troubleshooting section
- **Risk**: E2E test reliability
  - **Mitigation**: Minimal test resources, cleanup logic, graceful skipping

---

## Overall Project Success Criteria

**Feature is complete when**:
1. All sprint tasks (S-91, S-92, S-93) completed and accepted
2. All tests pass (unit, integration, E2E)
3. Code review approved
4. Documentation complete
5. CLI commands work as specified
6. Performance meets targets (PRD §6.1):
   - Config parsing: <100ms
   - State fetching: <2s for typical server
   - Diff calculation: <500ms
   - Apply: <10s for small changes, <60s for large
7. Reliability targets met (PRD §6.2):
   - 100% idempotency
   - 100% rate limit handling
   - 100% config validation
   - 100% unmanaged resource preservation

**Acceptance Testing Checklist**:
- [ ] Developer can export existing server config to YAML
- [ ] Developer can apply YAML config to create roles and channels
- [ ] Re-running the same config produces no changes (idempotent)
- [ ] Diff command accurately detects configuration drift
- [ ] Plan command shows what will change before applying
- [ ] Permission overwrites work correctly (allow/deny)
- [ ] Unmanaged resources (manual creations) are preserved
- [ ] Rate limits are handled gracefully with retries
- [ ] Error messages are helpful and actionable
- [ ] CLI output is clear and properly formatted
- [ ] Documentation covers getting started and all commands

---

## Dependencies & Prerequisites

**External Dependencies**:
- Discord API v10 (available)
- @discordjs/rest v2.6.0 (installed)
- discord-api-types v0.37.100 (installed)
- Commander.js v12.1.0 (installed)
- chalk v5.3.0 (installed)
- ora v8.0.1 (installed)
- js-yaml v4.1.0 (need to add)
- zod v3.23.8 (installed)

**Internal Dependencies**:
- gaib CLI infrastructure (complete)
- DiscordRest service (complete - reference for patterns)

**Environment Requirements**:
- Node.js 20+
- TypeScript 5+
- Discord bot token with required permissions (MANAGE_ROLES, MANAGE_CHANNELS, MANAGE_GUILD)
- Test Discord server (for E2E tests)

---

## Risk Management

### High-Priority Risks

1. **Discord API Rate Limits**
   - **Impact**: High (blocks operations)
   - **Mitigation**: Proactive rate limiting, exponential backoff, progress feedback
   - **Owner**: Sprint S-92

2. **Partial Application Failures**
   - **Impact**: High (inconsistent state)
   - **Mitigation**: Idempotent design, retry logic, manual recovery documentation
   - **Owner**: Sprint S-92

3. **Permission Bitfield Complexity**
   - **Impact**: Medium (incorrect permissions)
   - **Mitigation**: Reference existing code, comprehensive unit tests, validation
   - **Owner**: Sprint S-92

### Medium-Priority Risks

4. **Config Complexity (User Errors)**
   - **Impact**: Medium (user frustration)
   - **Mitigation**: Schema validation, helpful error messages, examples, templates
   - **Owner**: Sprint S-93

5. **Name-Based Resource Matching Issues**
   - **Impact**: Medium (mismatched resources)
   - **Mitigation**: Managed resource tagging, export command for baseline
   - **Owner**: Sprint S-91, S-92

---

## Performance Targets

| Metric | Target | Sprint | Measurement Method |
|--------|--------|--------|-------------------|
| Config Parsing | <100ms | S-91 | Unit test timing |
| State Fetching (50 roles, 50 channels) | <2s | S-91 | Integration test timing |
| Diff Calculation | <500ms | S-92 | Unit test timing |
| Small Apply (5 operations) | <10s | S-92 | Integration test timing |
| Large Apply (50 operations) | <60s | S-93 | E2E test timing |

---

## Definition of Done (All Sprints)

**Code Quality**:
- [ ] All TypeScript code compiles without errors
- [ ] ESLint passes with no warnings
- [ ] All tests pass (unit, integration, E2E)
- [ ] Test coverage >80% for core logic
- [ ] Code reviewed and approved

**Documentation**:
- [ ] All public APIs have TSDoc comments
- [ ] User-facing documentation complete
- [ ] Examples provided for common use cases
- [ ] Error messages are clear and actionable

**Testing**:
- [ ] Unit tests for all components
- [ ] Integration tests with mocked Discord API
- [ ] E2E tests with real Discord API (optional, with credentials)
- [ ] Manual testing of CLI commands

**Deployment**:
- [ ] Changes merged to feature branch
- [ ] No breaking changes to existing CLI
- [ ] Dependencies properly declared in package.json

---

## Post-Implementation: Optional Integration Tasks

These tasks are not part of the core 3-sprint plan but can be tackled as follow-up work:

### Sandbox Integration (Optional Sprint S-94)

**Goal**: Integrate IaC with existing sandbox workflow

**Tasks**:
- [ ] Add `--config <file>` flag to `gaib sandbox create` command
- [ ] Auto-apply Discord server config after sandbox creation
- [ ] Store config path in sandbox metadata
- [ ] Update sandbox documentation with IaC examples
- [ ] Integration tests for sandbox + IaC workflow

**Complexity**: Medium
**Estimated Time**: 2-3 days

---

## Document History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2026-01-18 | Claude (planning-sprints) | Initial sprint plan creation |

---

**Sources Referenced**:
- PRD: `grimoires/loa/discord-iac-prd.md`
- SDD: `grimoires/loa/discord-iac-sdd.md`
- Existing sprint history: `grimoires/loa/a2a/` (sprint-90 latest)
- SDD Implementation Plan: §11

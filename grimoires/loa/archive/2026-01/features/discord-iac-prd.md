# Product Requirements Document: Discord Infrastructure-as-Code

**Version**: 1.0
**Date**: January 18, 2026
**Status**: DRAFT - Pending Approval
**Feature Branch**: `feature/discord-iac`
**Base Branch**: `staging`

---

## Document Traceability

| Section | Primary Source | Secondary Sources |
|---------|---------------|-------------------|
| Discord API | apps/worker/src/services/DiscordRest.ts | @discordjs/rest package |
| CLI Structure | packages/cli/src/commands/sandbox/ | docs/cli.md |
| gaib CLI | packages/cli/src/bin/gaib.ts | Commander pattern |

**Related Documents**:
- `grimoires/loa/discord-server-sandboxes-prd.md` (Sandboxes feature)
- `docs/cli.md` (gaib CLI reference)
- Discord API v10 Documentation (discord.com/developers/docs)

---

## 1. Executive Summary

### 1.1 Product Overview

**Discord Infrastructure-as-Code (IaC)** extends the gaib CLI to enable declarative management of Discord server configurations. Define roles, channels, categories, permissions, and webhooks in a YAML file, then apply changes idempotently—just like Terraform for Discord.

**Key Value Proposition**: Reproducible Discord server configuration that can be version-controlled, tested in sandboxes, and deployed consistently across environments.

### 1.2 Problem Statement

**Current State:**
- Discord servers are configured manually through the UI
- Configuration is not version-controlled or reproducible
- Testing bot features requiring specific role/channel setups is time-consuming
- No way to detect configuration drift between environments
- Sandbox environments require manual Discord server setup

**Target State:**
- Define Discord server configuration as code (YAML)
- Apply configurations idempotently (safe to re-run)
- Detect drift between desired state and actual state
- Export existing server configurations for documentation
- Integrate with sandbox workflow for automated test environments

**Why Now:**
- Sandbox system is operational (Sprint 85-88)
- gaib CLI infrastructure exists and is proven
- Testing requires reproducible Discord server setups
- Manual configuration is becoming a bottleneck for QA

### 1.3 Vision

Discord IaC becomes the **standard way to manage Arrakis Discord server configurations**:

- **Phase 1 (MVP)**: Roles, channels, categories, and basic permissions
- **Phase 2 (Near-term)**: Webhooks, scheduled events, advanced permission overwrites
- **Phase 3 (Future)**: Server templates marketplace, multi-server orchestration, community sharing

### 1.4 Success Metrics

| Category | Metric | Target | Measurement |
|----------|--------|--------|-------------|
| **Usability** | Time to configure new sandbox server | <2 minutes | CLI timing |
| **Reliability** | Config application success rate | >95% | CLI exit codes |
| **Idempotency** | Re-running config causes changes | 0 changes | Diff command |
| **Adoption** | Sandboxes using IaC configs | 100% within 3 months | Usage analytics |
| **Drift Detection** | Time to detect config drift | <10 seconds | Diff command timing |
| **Developer Experience** | Lines of code to configure server | 50-100 YAML lines | Config file size |

---

## 2. User & Stakeholder Context

### 2.1 Primary Users

| User Type | Description | Primary Need |
|-----------|-------------|--------------|
| **Internal Developers** | Arrakis engineering team | Reproducible test server configs for feature development |
| **QA Engineers** | Testing team | Automated server setup for test scenarios |
| **DevOps** | Infrastructure team | Standardized server configurations across environments |

### 2.2 Secondary Users

| User Type | Description | Timeline |
|-----------|-------------|----------|
| **Community Operators** | Arrakis customers managing servers | Future (post-public release) |
| **Bot Developers** | Third-party developers | Future (developer platform) |

### 2.3 User Stories

**Internal Developer**:
```
As a developer testing token-gating features,
I want to define roles and channels in a config file,
So that my sandbox server is automatically configured for testing.
```

**QA Engineer**:
```
As a QA engineer testing a new tier system,
I want to apply a known-good server configuration,
So that I can test consistently across multiple sandboxes.
```

**DevOps Engineer**:
```
As a DevOps engineer,
I want to detect configuration drift between our docs and actual server state,
So that I can ensure production matches our documented setup.
```

**Sandbox User**:
```
As a developer using sandboxes,
I want my sandbox server to be automatically configured when created,
So that I don't waste time manually creating roles and channels.
```

---

## 3. Functional Requirements

### 3.1 Core Features (MVP - Phase 1)

#### FR-1: Configuration Format

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-1.1 | YAML-based configuration format | P0 |
| FR-1.2 | Support server name and description | P0 |
| FR-1.3 | Support role definitions (name, color, permissions, position, hoist, mentionable) | P0 |
| FR-1.4 | Support channel definitions (name, type, category, topic, nsfw, slowmode) | P0 |
| FR-1.5 | Support category definitions (name, position) | P0 |
| FR-1.6 | Support channel permission overwrites (role-based and member-based) | P0 |
| FR-1.7 | Configuration versioning field | P1 |
| FR-1.8 | Comments and documentation in YAML | P1 |

#### FR-2: Apply Command (gaib server init)

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-2.1 | CLI command `gaib server init <guild-id> --config server.yaml` applies configuration | P0 |
| FR-2.2 | Idempotent application (safe to re-run) | P0 |
| FR-2.3 | Create missing roles, channels, categories | P0 |
| FR-2.4 | Update existing resources if configuration changed | P0 |
| FR-2.5 | Support dry-run mode (`--dry-run`) showing planned changes | P0 |
| FR-2.6 | Respect Discord API rate limits | P0 |
| FR-2.7 | Handle permission hierarchy constraints | P0 |
| FR-2.8 | Preserve unmanaged resources (resources not in config) | P0 |
| FR-2.9 | Support `--force` flag to skip confirmation prompts | P1 |
| FR-2.10 | Output summary of changes made | P1 |

#### FR-3: Plan Command (gaib server plan)

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-3.1 | CLI command `gaib server plan <guild-id> --config server.yaml` shows planned changes | P0 |
| FR-3.2 | Display what will be created, updated, or deleted | P0 |
| FR-3.3 | Color-coded output (create=green, update=yellow, delete=red) | P1 |
| FR-3.4 | Show detailed diff for updates | P1 |
| FR-3.5 | Non-destructive (read-only operation) | P0 |

#### FR-4: Export Command (gaib server export)

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-4.1 | CLI command `gaib server export <guild-id>` exports current state | P0 |
| FR-4.2 | Output valid YAML that can be used as config | P0 |
| FR-4.3 | Include all roles, channels, categories, and permissions | P0 |
| FR-4.4 | Support `--output <file>` to write to file | P1 |
| FR-4.5 | Filter out @everyone role and default channels | P1 |
| FR-4.6 | Include comments documenting special cases | P2 |

#### FR-5: Diff Command (gaib server diff)

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-5.1 | CLI command `gaib server diff <guild-id> --config server.yaml` detects drift | P0 |
| FR-5.2 | Compare actual server state with config file | P0 |
| FR-5.3 | Display differences in human-readable format | P0 |
| FR-5.4 | Support `--json` output for automation | P1 |
| FR-5.5 | Exit code 0 if no drift, 1 if drift detected | P1 |

#### FR-6: Resource Tracking

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-6.1 | Track which resources are managed by IaC | P0 |
| FR-6.2 | Store metadata in channel/role descriptions or external database | P0 |
| FR-6.3 | Ignore unmanaged resources (created manually) | P0 |
| FR-6.4 | Support tagging resources with labels | P2 |

### 3.2 Future Features (Phase 2)

#### FR-7: Webhooks

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-7.1 | Support webhook definitions (name, channel, avatar) | P2 |
| FR-7.2 | Create and update webhooks | P2 |
| FR-7.3 | Store webhook URLs securely (not in config file) | P2 |

#### FR-8: Advanced Permissions

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-8.1 | Support stage channels | P2 |
| FR-8.2 | Support forum channels | P2 |
| FR-8.3 | Support threads configuration | P3 |
| FR-8.4 | Support voice channel settings (bitrate, user limit) | P2 |

#### FR-9: Destroy Command

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-9.1 | CLI command `gaib server destroy <guild-id> --config server.yaml` removes managed resources | P2 |
| FR-9.2 | Delete only resources defined in config | P2 |
| FR-9.3 | Require confirmation or `--force` flag | P2 |
| FR-9.4 | Support `--dry-run` mode | P2 |

### 3.3 Integration Requirements

#### FR-10: Sandbox Integration

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-10.1 | `gaib sandbox create --config server.yaml` applies config on creation | P1 |
| FR-10.2 | Auto-detect config file in current directory | P1 |
| FR-10.3 | Store config path with sandbox metadata | P2 |

---

## 4. Technical Requirements

### 4.1 Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        gaib CLI                                  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  gaib server init <guild-id> --config server.yaml       │   │
│  └────────────────────┬────────────────────────────────────┘   │
│                       │                                          │
│                       ▼                                          │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  1. Parse YAML config                                    │   │
│  │  2. Fetch current Discord server state (via API)         │   │
│  │  3. Calculate diff (create/update/delete)                │   │
│  │  4. Apply changes via Discord REST API                   │   │
│  │  5. Tag resources as managed (description metadata)      │   │
│  └─────────────────────────────────────────────────────────┘   │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                  Discord REST API (v10)                          │
│  - POST /guilds/{guild_id}/roles          (create role)         │
│  - PATCH /guilds/{guild_id}/roles/{id}    (update role)         │
│  - POST /guilds/{guild_id}/channels       (create channel)      │
│  - PATCH /channels/{id}                   (update channel)      │
│  - PUT /channels/{id}/permissions/{id}    (set permissions)     │
└─────────────────────────────────────────────────────────────────┘
```

### 4.2 Configuration Schema

**Example Configuration** (`server.yaml`):

```yaml
version: "1"

# Server metadata
server:
  name: "Arrakis Community"
  description: "Token-gated community for holders"

# Role definitions
roles:
  - name: "Holder"
    color: "#FFD700"
    permissions:
      - VIEW_CHANNEL
      - SEND_MESSAGES
      - READ_MESSAGE_HISTORY
      - ADD_REACTIONS
    hoist: true
    mentionable: true
    position: 2

  - name: "OG"
    color: "#FF6B35"
    permissions:
      - VIEW_CHANNEL
      - SEND_MESSAGES
      - READ_MESSAGE_HISTORY
      - ADD_REACTIONS
      - ATTACH_FILES
      - EMBED_LINKS
    hoist: true
    mentionable: true
    position: 3

  - name: "Naib"
    color: "#4ECDC4"
    permissions:
      - VIEW_CHANNEL
      - SEND_MESSAGES
      - READ_MESSAGE_HISTORY
      - ADD_REACTIONS
      - ATTACH_FILES
      - EMBED_LINKS
      - MANAGE_MESSAGES
    hoist: true
    mentionable: true
    position: 4

# Category definitions
categories:
  - name: "Information"
    position: 0

  - name: "Community"
    position: 1

  - name: "Token Gated"
    position: 2

# Channel definitions
channels:
  - name: "welcome"
    type: text
    category: "Information"
    topic: "Welcome to Arrakis!"
    position: 0
    permissions:
      "@everyone":
        allow: [VIEW_CHANNEL, READ_MESSAGE_HISTORY]
        deny: [SEND_MESSAGES]
      "Holder":
        allow: [SEND_MESSAGES]

  - name: "rules"
    type: text
    category: "Information"
    topic: "Community guidelines"
    position: 1
    permissions:
      "@everyone":
        allow: [VIEW_CHANNEL, READ_MESSAGE_HISTORY]
        deny: [SEND_MESSAGES]

  - name: "general"
    type: text
    category: "Community"
    topic: "General discussion"
    position: 0
    permissions:
      "@everyone":
        deny: [VIEW_CHANNEL]
      "Holder":
        allow: [VIEW_CHANNEL, SEND_MESSAGES, READ_MESSAGE_HISTORY]

  - name: "og-lounge"
    type: text
    category: "Token Gated"
    topic: "Exclusive channel for OG holders"
    position: 0
    nsfw: false
    slowmode: 0
    permissions:
      "@everyone":
        deny: [VIEW_CHANNEL]
      "OG":
        allow: [VIEW_CHANNEL, SEND_MESSAGES, READ_MESSAGE_HISTORY, ATTACH_FILES]

  - name: "naib-council"
    type: text
    category: "Token Gated"
    topic: "Council chambers for Naib members"
    position: 1
    permissions:
      "@everyone":
        deny: [VIEW_CHANNEL]
      "Naib":
        allow: [VIEW_CHANNEL, SEND_MESSAGES, READ_MESSAGE_HISTORY, ATTACH_FILES, MANAGE_MESSAGES]
```

### 4.3 Discord API Integration

**Required Discord Permissions (Bot)**:
- `MANAGE_ROLES` - Create/update/delete roles
- `MANAGE_CHANNELS` - Create/update/delete channels
- `MANAGE_GUILD` - Modify server settings
- `VIEW_CHANNEL` - Read existing state
- `ADMINISTRATOR` (optional) - For full control

**Discord API Endpoints Used**:

| Operation | Endpoint | Method |
|-----------|----------|--------|
| List roles | `/guilds/{guild_id}/roles` | GET |
| Create role | `/guilds/{guild_id}/roles` | POST |
| Modify role | `/guilds/{guild_id}/roles/{role_id}` | PATCH |
| Delete role | `/guilds/{guild_id}/roles/{role_id}` | DELETE |
| List channels | `/guilds/{guild_id}/channels` | GET |
| Create channel | `/guilds/{guild_id}/channels` | POST |
| Modify channel | `/channels/{channel_id}` | PATCH |
| Delete channel | `/channels/{channel_id}` | DELETE |
| Edit channel permissions | `/channels/{channel_id}/permissions/{overwrite_id}` | PUT |

**Rate Limits**:
- Most endpoints: 50 requests per second per guild
- Channel create: Special 10-second cooldown
- Role create: Special 10-second cooldown

### 4.4 State Management

**Approach**: Discord API as source of truth, YAML as desired state

```typescript
interface DiscordState {
  roles: Map<string, DiscordRole>;
  channels: Map<string, DiscordChannel>;
  categories: Map<string, DiscordCategory>;
}

interface DesiredState {
  roles: ConfigRole[];
  channels: ConfigChannel[];
  categories: ConfigCategory[];
}

class IaCEngine {
  async fetchCurrentState(guildId: string): Promise<DiscordState> {
    // Fetch from Discord API
  }

  async parseConfig(configPath: string): Promise<DesiredState> {
    // Parse YAML
  }

  calculateDiff(current: DiscordState, desired: DesiredState): Diff {
    // Compare and generate change plan
  }

  async apply(guildId: string, diff: Diff): Promise<ApplyResult> {
    // Execute changes via Discord API
  }
}
```

### 4.5 Resource Identification

**Challenge**: Matching config resources to actual Discord resources

**Solution**: Name-based matching with metadata tagging

```typescript
// Role matching
function findRoleByName(roles: DiscordRole[], name: string): DiscordRole | null {
  return roles.find(r => r.name === name) || null;
}

// Tag managed resources via description
const MANAGED_TAG = "[managed-by:arrakis-iac]";

function tagResource(resource: { description: string }): string {
  if (!resource.description) return MANAGED_TAG;
  if (resource.description.includes(MANAGED_TAG)) return resource.description;
  return `${resource.description} ${MANAGED_TAG}`;
}

function isManagedResource(resource: { description: string }): boolean {
  return resource.description?.includes(MANAGED_TAG) || false;
}
```

### 4.6 Idempotency Strategy

**Key Principle**: Re-running the same config should result in no changes

```typescript
class ChangeCalculator {
  shouldUpdateRole(current: DiscordRole, desired: ConfigRole): boolean {
    return (
      current.name !== desired.name ||
      current.color !== parseColor(desired.color) ||
      !permissionsMatch(current.permissions, desired.permissions) ||
      current.hoist !== desired.hoist ||
      current.mentionable !== desired.mentionable
    );
  }

  shouldUpdateChannel(current: DiscordChannel, desired: ConfigChannel): boolean {
    return (
      current.name !== desired.name ||
      current.topic !== desired.topic ||
      current.nsfw !== desired.nsfw ||
      current.rateLimitPerUser !== desired.slowmode ||
      !permissionOverwritesMatch(current.permissionOverwrites, desired.permissions)
    );
  }
}
```

### 4.7 Permission Model

**Discord Permission System**:
- Base permissions at role level
- Permission overwrites at channel level (allow/deny)
- Permission calculation: deny takes precedence over allow

**Configuration Model**:
```yaml
# Role-level permissions (granted globally)
roles:
  - name: "Member"
    permissions:
      - VIEW_CHANNEL
      - SEND_MESSAGES

# Channel-level overwrites (specific to channel)
channels:
  - name: "private"
    permissions:
      "@everyone":
        deny: [VIEW_CHANNEL]
      "Member":
        allow: [VIEW_CHANNEL, SEND_MESSAGES]
        deny: [MANAGE_MESSAGES]
```

**Permission Names** (subset for MVP):
- `VIEW_CHANNEL`
- `SEND_MESSAGES`
- `READ_MESSAGE_HISTORY`
- `ADD_REACTIONS`
- `ATTACH_FILES`
- `EMBED_LINKS`
- `MANAGE_MESSAGES`
- `MANAGE_CHANNELS`
- `MANAGE_ROLES`

### 4.8 Error Handling

**Failure Scenarios**:

| Scenario | Handling |
|----------|----------|
| Invalid YAML syntax | Exit with parse error, line number |
| Missing permissions | Exit with helpful message about required bot permissions |
| Rate limit exceeded | Retry with exponential backoff |
| Role hierarchy violation | Reorder operations to respect hierarchy |
| Discord API error | Display error, suggest fixes |
| Partial application | Rollback changes or continue with warning |

**Rollback Strategy**:
- Phase 1 (MVP): No automatic rollback, manual fix via re-running with previous config
- Phase 2: Track previous state and support rollback

---

## 5. User Experience

### 5.1 CLI Usage Flow

**Happy Path** (First-time setup):
```bash
# 1. Export existing server config as starting point
gaib server export 123456789012345678 > server.yaml

# 2. Edit config file
vim server.yaml

# 3. Preview changes (dry-run)
gaib server plan 123456789012345678 --config server.yaml

# 4. Apply configuration
gaib server init 123456789012345678 --config server.yaml

# 5. Verify no drift
gaib server diff 123456789012345678 --config server.yaml
```

**Sandbox Integration**:
```bash
# Create sandbox with automatic server configuration
gaib sandbox create my-test --config server.yaml --guild 123456789012345678

# Sandbox auto-applies config after creation
```

### 5.2 Output Examples

**Plan Command Output**:
```
Changes for guild 123456789012345678:

Roles:
  + Create "OG" (color: #FF6B35, position: 3)
  ~ Update "Holder"
      color: #FFFFFF → #FFD700
      position: 1 → 2
  - Delete "Deprecated Role" (not in config)

Channels:
  + Create "og-lounge" in category "Token Gated"
  ~ Update "general"
      topic: "" → "General discussion"
      permissions: @everyone: +VIEW_CHANNEL

Categories:
  + Create "Token Gated" (position: 2)

Summary: 3 creates, 2 updates, 1 delete

Run `gaib server init` to apply these changes.
```

**Diff Command Output** (drift detected):
```
Drift detected for guild 123456789012345678:

Role "Holder":
  - color: #FFD700 (in config)
  + color: #FFFFFF (actual)

Channel "general":
  - topic: "General discussion" (in config)
  + topic: "" (actual)

2 differences found.

Run `gaib server init` to sync with config.
```

### 5.3 Error Messages

**Missing Permissions**:
```
Error: Insufficient bot permissions

The bot is missing required permissions:
  - MANAGE_ROLES
  - MANAGE_CHANNELS

Please add these permissions in Discord Server Settings → Roles → Arrakis Bot.
```

**Invalid Config**:
```
Error: Invalid configuration file

  Line 15: Unknown permission "INVALID_PERMISSION"
  Valid permissions: VIEW_CHANNEL, SEND_MESSAGES, ...

  Line 23: Channel "foo" references non-existent category "Bar"
  Available categories: Information, Community, Token Gated
```

**Rate Limited**:
```
Warning: Discord API rate limit reached

Waiting 5 seconds before retrying... (2/3 retries)

Tip: Reduce number of changes or increase delay between operations.
```

---

## 6. Non-Functional Requirements

### 6.1 Performance

| Requirement | Target | Priority |
|-------------|--------|----------|
| Config file parsing | <100ms | P0 |
| State fetching (typical 50 roles, 50 channels) | <2 seconds | P0 |
| Diff calculation | <500ms | P0 |
| Apply small changes (5 operations) | <10 seconds | P1 |
| Apply full server config (50 operations) | <60 seconds | P1 |

### 6.2 Reliability

| Requirement | Target | Priority |
|-------------|--------|----------|
| Idempotency | 100% (re-run = no changes) | P0 |
| Handle rate limits gracefully | 100% | P0 |
| Validate config before applying | 100% | P0 |
| Preserve unmanaged resources | 100% | P0 |

### 6.3 Security

| Requirement | Description | Priority |
|-------------|-------------|----------|
| Bot token security | Never log or expose bot token | P0 |
| Permission validation | Verify bot has required permissions before operations | P0 |
| Audit trail | Log all changes made (what, when, by whom) | P1 |
| Config file validation | Reject configs with suspicious permissions | P1 |

### 6.4 Maintainability

| Requirement | Description | Priority |
|-------------|-------------|----------|
| Unit tests | >80% coverage for core logic | P0 |
| Integration tests | Test against mock Discord API | P0 |
| Documentation | Examples for common use cases | P0 |
| Schema validation | JSON Schema for config validation | P1 |

---

## 7. Risks & Mitigations

### 7.1 Technical Risks

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| Discord API rate limits | High | Medium | Implement backoff, batch operations, cache state |
| Partial application failures | High | Medium | Track applied changes, provide manual recovery instructions |
| Role hierarchy constraints | Medium | High | Calculate dependency order, apply in correct sequence |
| Permission conflicts | Medium | Medium | Validate before applying, warn on conflicts |
| Large servers (1000+ channels) | Medium | Low | Implement pagination, progressive application |

### 7.2 User Experience Risks

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| Accidental deletion of critical resources | High | Medium | Require confirmation, support unmanaged resource preservation |
| Complex YAML syntax | Medium | High | Provide examples, schema validation, helpful error messages |
| Confusing diff output | Medium | Medium | Use clear formatting, colors, detailed explanations |
| Lack of rollback capability | High | Medium | Document manual rollback, plan automatic rollback for Phase 2 |

### 7.3 Adoption Risks

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| Developers prefer manual UI configuration | Medium | Low | Showcase benefits: version control, reproducibility, automation |
| Learning curve for YAML syntax | Medium | Medium | Provide templates, examples, documentation |
| Fear of breaking production servers | High | Medium | Emphasize dry-run, diff, and sandbox testing |

---

## 8. Scope & Phasing

### 8.1 MVP Scope (Phase 1) - 3-4 weeks

**Must Have** (P0):
- ✅ YAML configuration format
- ✅ `gaib server init` command (apply)
- ✅ `gaib server plan` command (dry-run)
- ✅ `gaib server export` command
- ✅ `gaib server diff` command (drift detection)
- ✅ Role management (create, update)
- ✅ Channel management (create, update)
- ✅ Category management
- ✅ Basic permission overwrites
- ✅ Idempotent operations
- ✅ Resource tagging (managed vs unmanaged)
- ✅ Rate limit handling

**Should Have** (P1):
- ✅ Sandbox integration (`--config` flag)
- ✅ Colored CLI output
- ✅ `--dry-run` and `--force` flags
- ✅ Config validation

**Nice to Have** (P2):
- ⏭ `gaib server destroy` command
- ⏭ Auto-detect config file
- ⏭ Webhook support

### 8.2 Phase 2 - Future Enhancements

- Webhooks
- Voice channel settings (bitrate, user limit)
- Stage channels
- Forum channels
- Scheduled events
- Automatic rollback on failure
- Config templates library
- Multi-server orchestration

### 8.3 Phase 3 - Advanced Features

- Server templates marketplace
- Community config sharing
- Auto-sync (watch mode)
- Integration with CI/CD
- Terraform provider for Discord
- Advanced audit trail with revert capability

---

## 9. Dependencies & Prerequisites

### 9.1 External Dependencies

| Dependency | Type | Status |
|------------|------|--------|
| Discord API v10 | External API | ✅ Available |
| @discordjs/rest | npm package | ✅ Installed |
| Commander.js | npm package | ✅ Installed (in CLI) |
| js-yaml | npm package | ⏳ Need to add |
| chalk | npm package | ✅ Installed (in CLI) |

### 9.2 Internal Dependencies

| Dependency | Status | Notes |
|------------|--------|-------|
| gaib CLI infrastructure | ✅ Complete | Proven in sandbox commands |
| DiscordRest service | ✅ Complete | Already has role/channel methods |
| Sandbox system | ✅ Complete | Integration point for auto-config |

### 9.3 Prerequisites

| Requirement | Description |
|-------------|-------------|
| Discord Bot Token | Bot must have MANAGE_ROLES, MANAGE_CHANNELS, MANAGE_GUILD permissions |
| Guild ID | Discord server ID for operations |
| Node.js 20+ | Runtime environment |
| TypeScript 5+ | Development toolchain |

---

## 10. Acceptance Criteria

### 10.1 Functional Acceptance

- [ ] Developer can export existing server config to YAML
- [ ] Developer can apply YAML config to create roles and channels
- [ ] Re-running the same config produces no changes (idempotent)
- [ ] Diff command accurately detects configuration drift
- [ ] Plan command shows what will change before applying
- [ ] Permission overwrites work correctly (allow/deny)
- [ ] Unmanaged resources (manual creations) are preserved
- [ ] Rate limits are handled gracefully with retries

### 10.2 Integration Acceptance

- [ ] `gaib sandbox create --config server.yaml` applies config automatically
- [ ] Sandbox workflow documentation updated with IaC examples
- [ ] Developer can test config in sandbox before applying to production

### 10.3 Quality Acceptance

- [ ] Unit tests for config parsing, diff calculation, API calls
- [ ] Integration tests against mock Discord API
- [ ] Error messages are helpful and actionable
- [ ] CLI output is clear and properly formatted
- [ ] Documentation includes getting started guide and examples
- [ ] Performance meets targets (<2s for state fetch, <10s for apply)

---

## 11. Open Questions

| Question | Status | Owner |
|----------|--------|-------|
| Should we store config path in sandbox metadata? | Open | Product |
| Do we need a state file (like Terraform) or rely on Discord API? | Open | Engineering |
| How to handle @everyone role (immutable in Discord)? | Open | Engineering |
| Should destroy command be in MVP or Phase 2? | Open | Product |
| Config file naming convention (server.yaml, discord.yaml, .arrakis.yaml)? | Open | Product |
| Should we support multiple config files (modular configs)? | Open | Engineering |

---

## 12. Success Definition

**This feature is successful when**:

1. **Developers prefer IaC over manual configuration** for sandbox setup
2. **QA time reduced by 50%** due to automated server configuration
3. **Zero configuration drift incidents** in production (detected and fixed proactively)
4. **100% of sandboxes use IaC configs** within 3 months of launch
5. **Positive feedback** from internal users on ease of use and time savings

---

## Appendix A: Configuration Examples

### A.1 Minimal Config

```yaml
version: "1"

roles:
  - name: "Member"
    color: "#99AAB5"
    permissions: [VIEW_CHANNEL, SEND_MESSAGES]

channels:
  - name: "general"
    type: text
```

### A.2 Token-Gated Community Config

```yaml
version: "1"

server:
  name: "Token Holders"

roles:
  - name: "Holder"
    color: "#FFD700"
    permissions: [VIEW_CHANNEL, SEND_MESSAGES, READ_MESSAGE_HISTORY]
    hoist: true

  - name: "Whale"
    color: "#4169E1"
    permissions: [VIEW_CHANNEL, SEND_MESSAGES, READ_MESSAGE_HISTORY, ATTACH_FILES]
    hoist: true

categories:
  - name: "Public"
    position: 0
  - name: "Token Gated"
    position: 1

channels:
  - name: "welcome"
    type: text
    category: "Public"
    permissions:
      "@everyone":
        allow: [VIEW_CHANNEL, READ_MESSAGE_HISTORY]
        deny: [SEND_MESSAGES]

  - name: "holder-chat"
    type: text
    category: "Token Gated"
    permissions:
      "@everyone":
        deny: [VIEW_CHANNEL]
      "Holder":
        allow: [VIEW_CHANNEL, SEND_MESSAGES]

  - name: "whale-lounge"
    type: text
    category: "Token Gated"
    permissions:
      "@everyone":
        deny: [VIEW_CHANNEL]
      "Whale":
        allow: [VIEW_CHANNEL, SEND_MESSAGES, ATTACH_FILES]
```

### A.3 Development/Staging Config

```yaml
version: "1"

server:
  name: "[DEV] Arrakis Testing"

roles:
  - name: "Developer"
    color: "#E74C3C"
    permissions:
      - VIEW_CHANNEL
      - SEND_MESSAGES
      - READ_MESSAGE_HISTORY
      - ATTACH_FILES
      - EMBED_LINKS
      - MANAGE_MESSAGES
    hoist: true

categories:
  - name: "Testing"
    position: 0

channels:
  - name: "test-commands"
    type: text
    category: "Testing"
    topic: "Test slash commands here"

  - name: "test-events"
    type: text
    category: "Testing"
    topic: "Discord event logging"

  - name: "test-roles"
    type: text
    category: "Testing"
    topic: "Test role assignment"
```

---

## Appendix B: Discord API Endpoints Reference

### B.1 Roles

```
GET    /guilds/{guild.id}/roles
POST   /guilds/{guild.id}/roles
PATCH  /guilds/{guild.id}/roles/{role.id}
DELETE /guilds/{guild.id}/roles/{role.id}
PATCH  /guilds/{guild.id}/roles (modify positions)
```

### B.2 Channels

```
GET    /guilds/{guild.id}/channels
POST   /guilds/{guild.id}/channels
PATCH  /channels/{channel.id}
DELETE /channels/{channel.id}
PATCH  /guilds/{guild.id}/channels (modify positions)
```

### B.3 Permissions

```
PUT    /channels/{channel.id}/permissions/{overwrite.id}
DELETE /channels/{channel.id}/permissions/{overwrite.id}
```

---

## Document History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2026-01-18 | Claude (discovering-requirements) | Initial PRD creation |

---

**Sources Referenced**:
- [Guild Resource - Discord Developer Portal](https://discord.com/developers/docs/resources/guild)
- [Permissions - Discord Developer Portal](https://discord.com/developers/docs/topics/permissions)
- [API Reference - Discord Developer Portal](https://discord.com/developers/docs/reference)
- [discord-api-types documentation](https://discord-api-types.dev/api/discord-api-types-v10)

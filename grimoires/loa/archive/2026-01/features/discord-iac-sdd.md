# Software Design Document: Discord Infrastructure-as-Code

**Version**: 1.0
**Date**: January 18, 2026
**Status**: DRAFT - Ready for Sprint Planning
**Feature Branch**: `feature/discord-iac`
**Base Branch**: `staging`

---

## Document Traceability

| Component | Source Reference | Lines/Location |
|-----------|------------------|----------------|
| CLI Architecture | `packages/cli/src/bin/gaib.ts` | 1-32 |
| Discord REST Service | `apps/worker/src/services/DiscordRest.ts` | 1-343 |
| Sandbox Commands | `packages/cli/src/commands/sandbox/` | Multiple files |
| Commander Pattern | `packages/cli/src/commands/sandbox/index.ts` | 25-202 |
| Discord API Types | `discord-api-types` v0.37.100 | Package dependency |

**Related Documents**:
- `grimoires/loa/discord-iac-prd.md` (Product Requirements)
- `apps/worker/package.json` (Dependencies)
- Discord API v10 Documentation (discord.com/developers/docs)

---

## 1. Executive Summary

### 1.1 Overview

**Discord Infrastructure-as-Code (IaC)** extends the gaib CLI to enable declarative management of Discord server configurations. This SDD defines the architecture for defining roles, channels, categories, and permissions in YAML files, then applying them idempotently via the Discord REST API.

### 1.2 Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **Resource Identification** | Name-based with metadata tagging | Human-readable, survives Discord ID changes |
| **State Management** | Discord API as single source of truth | No state file to maintain, always synchronized |
| **Managed Resource Tracking** | `[managed-by:arrakis-iac]` in descriptions | Lightweight, survives even if state corrupted |
| **Configuration Format** | YAML with JSON Schema validation | Readable, validated, extensible |
| **Rate Limiting** | Queue with exponential backoff | Respects Discord limits, reliable |
| **Error Recovery** | No automatic rollback in MVP | Document partial state, manual recovery via re-apply |

### 1.3 Architecture Principles

1. **Idempotency First**: Re-running the same config must produce zero changes
2. **Non-Destructive by Default**: Preserve unmanaged resources (created manually)
3. **Fail-Safe Operations**: Validate before applying, preview with dry-run
4. **Observable**: Detailed logging, clear diff output, progress feedback
5. **Integration-Ready**: Designed for sandbox workflow integration

---

## 2. System Architecture

### 2.1 High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         gaib CLI                                 │
│                    (packages/cli/src/)                           │
│                                                                   │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  gaib server <command> <guild-id> [options]                │ │
│  │                                                            │ │
│  │  Commands:                                                 │ │
│  │  - init     Apply configuration (create/update)           │ │
│  │  - plan     Show planned changes (dry-run)                │ │
│  │  - diff     Detect configuration drift                    │ │
│  │  - export   Export current server config to YAML          │ │
│  └────────────────────────────────────────────────────────────┘ │
│                              │                                   │
│                              ▼                                   │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │              IaC Engine (Core Logic)                       │ │
│  │                                                            │ │
│  │  ┌──────────────────┐  ┌──────────────────┐              │ │
│  │  │ ConfigParser     │  │ StateReader      │              │ │
│  │  │ - Parse YAML     │  │ - Fetch Discord  │              │ │
│  │  │ - Validate       │  │   API state      │              │ │
│  │  │ - Schema check   │  │ - Map resources  │              │ │
│  │  └──────────────────┘  └──────────────────┘              │ │
│  │            │                     │                         │ │
│  │            └─────────┬───────────┘                         │ │
│  │                      ▼                                     │ │
│  │          ┌──────────────────────┐                         │ │
│  │          │    DiffEngine        │                         │ │
│  │          │ - Compare states     │                         │ │
│  │          │ - Calculate changes  │                         │ │
│  │          │ - Resolve order      │                         │ │
│  │          └──────────────────────┘                         │ │
│  │                      │                                     │ │
│  │                      ▼                                     │ │
│  │          ┌──────────────────────┐                         │ │
│  │          │   StateWriter        │                         │ │
│  │          │ - Apply changes      │                         │ │
│  │          │ - Rate limiting      │                         │ │
│  │          │ - Error handling     │                         │ │
│  │          └──────────────────────┘                         │ │
│  └────────────────────────────────────────────────────────────┘ │
│                              │                                   │
└──────────────────────────────┼───────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│               DiscordRestClient (Shared Service)                 │
│           (Wrapper around @discordjs/rest)                       │
│                                                                   │
│  Uses bot token (requires MANAGE_ROLES, MANAGE_CHANNELS)        │
└─────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Discord REST API v10                          │
│                                                                   │
│  Endpoints:                                                      │
│  - GET/POST/PATCH/DELETE /guilds/{guild_id}/roles               │
│  - GET/POST/PATCH/DELETE /guilds/{guild_id}/channels            │
│  - PUT/DELETE /channels/{channel_id}/permissions/{overwrite_id} │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 Data Flow

#### 2.2.1 Apply Configuration Flow (gaib server init)

```
┌─────────────┐
│ 1. Parse    │  Read YAML config file
│    YAML     │  → Validate against JSON Schema
│             │  → Resolve references (category names, role names)
└──────┬──────┘
       │
       ▼
┌─────────────┐
│ 2. Fetch    │  GET /guilds/{guild_id}/roles
│    Discord  │  GET /guilds/{guild_id}/channels
│    State    │  → Build current state map
│             │  → Filter managed resources only
└──────┬──────┘
       │
       ▼
┌─────────────┐
│ 3. Calculate│  Compare desired vs current
│    Diff     │  → Creates (in config, not in Discord)
│             │  → Updates (exists but different)
│             │  → Deletes (in Discord, not in config, managed)
│             │  → Resolve dependency order (categories → roles → channels)
└──────┬──────┘
       │
       ▼
┌─────────────┐
│ 4. Display  │  Print planned changes
│    Plan     │  → Color-coded output (green/yellow/red)
│             │  → Request confirmation (unless --force)
└──────┬──────┘
       │ [User confirms]
       ▼
┌─────────────┐
│ 5. Apply    │  Execute changes in order:
│    Changes  │  1. Create categories (position 0→N)
│             │  2. Create roles (position 0→N, base permissions)
│             │  3. Create channels (category parent, base settings)
│             │  4. Update channel permissions (overwrites)
│             │  5. Tag all resources with [managed-by:arrakis-iac]
│             │  → Rate limit handling (exponential backoff)
│             │  → Error recovery (log, continue or abort)
└──────┬──────┘
       │
       ▼
┌─────────────┐
│ 6. Report   │  Display summary:
│    Results  │  ✓ 3 roles created
│             │  ✓ 5 channels created
│             │  ✓ 12 permissions updated
│             │  ⚠ 1 warning (rate limited, retried)
└─────────────┘
```

#### 2.2.2 Diff Detection Flow (gaib server diff)

```
Parse YAML → Fetch Discord State → Calculate Diff → Display Differences
                                                    ↓
                                            Exit Code:
                                            0 = No drift
                                            1 = Drift detected
```

#### 2.2.3 Export Flow (gaib server export)

```
Fetch Discord State → Filter Resources → Generate YAML → Output
                      (all or managed)   (with comments)   (stdout or file)
```

---

## 3. Technology Stack

### 3.1 Core Dependencies

| Technology | Version | Purpose | Status |
|-----------|---------|---------|--------|
| **TypeScript** | 5.6.3 | Type-safe implementation | ✅ Installed |
| **Commander.js** | 12.1.0 | CLI framework | ✅ Installed |
| **@discordjs/rest** | 2.6.0 | Discord API client | ✅ Installed |
| **discord-api-types** | 0.37.100 | TypeScript types for Discord API | ✅ Installed |
| **chalk** | 5.3.0 | CLI colors | ✅ Installed |
| **ora** | 8.0.1 | CLI spinners | ✅ Installed |
| **js-yaml** | - | YAML parser | ⏳ Need to add |
| **ajv** | - | JSON Schema validator | ⏳ Need to add |
| **zod** | 3.23.8 | Runtime validation (alternative to ajv) | ✅ Installed |
| **pino** | 9.5.0 | Logging | ✅ Installed |

### 3.2 Design Choice: Zod vs AJV for Validation

**Decision**: Use **Zod** instead of AJV

**Rationale**:
- Already installed (`apps/worker` dependency)
- Better TypeScript integration (types derived from schemas)
- Excellent error messages
- Runtime validation with type inference
- Easier to maintain schemas in code

### 3.3 New CLI Package Dependencies

Add to `packages/cli/package.json`:
```json
{
  "dependencies": {
    "js-yaml": "^4.1.0",
    "zod": "^3.23.8",
    "@discordjs/rest": "^2.6.0",
    "discord-api-types": "^0.37.100"
  }
}
```

---

## 4. Component Design

### 4.1 Directory Structure

```
packages/cli/src/commands/server/
├── index.ts                    # Command registration (like sandbox/index.ts)
├── init.ts                     # Apply configuration
├── plan.ts                     # Show planned changes
├── diff.ts                     # Detect drift
├── export.ts                   # Export current state
├── utils.ts                    # Shared utilities
└── iac/
    ├── ConfigParser.ts         # YAML parsing & validation
    ├── StateReader.ts          # Fetch Discord state
    ├── StateWriter.ts          # Apply changes to Discord
    ├── DiffEngine.ts           # Calculate differences
    ├── ResourceTracker.ts      # Manage resource metadata
    ├── DiscordRestClient.ts    # Bot token Discord API wrapper
    ├── RateLimiter.ts          # Rate limit handling
    ├── schemas.ts              # Zod schemas for validation
    ├── types.ts                # TypeScript interfaces
    └── __tests__/
        ├── ConfigParser.test.ts
        ├── DiffEngine.test.ts
        ├── StateReader.test.ts
        └── integration.test.ts
```

### 4.2 Core Components

#### 4.2.1 ConfigParser

**Responsibility**: Parse and validate YAML configuration files

**Source Reference**: Pattern from `packages/cli/src/commands/sandbox/utils.ts` (YAML parsing utilities)

```typescript
// packages/cli/src/commands/server/iac/ConfigParser.ts

import yaml from 'js-yaml';
import { z } from 'zod';
import type { Logger } from 'pino';

/**
 * ConfigParser - Parse and validate Discord server configuration YAML
 *
 * Based on PRD §4.2 Configuration Schema
 */
export class ConfigParser {
  constructor(private readonly logger: Logger) {}

  /**
   * Parse and validate a YAML configuration file
   * @throws ConfigError if invalid
   */
  async parse(filePath: string): Promise<ServerConfig> {
    this.logger.debug({ filePath }, 'Parsing config file');

    // Read file
    const content = await fs.readFile(filePath, 'utf-8');

    // Parse YAML
    const raw = yaml.load(content) as unknown;

    // Validate with Zod
    const result = ServerConfigSchema.safeParse(raw);
    if (!result.success) {
      throw new ConfigError(
        'Invalid configuration',
        result.error.issues.map(i => ({
          path: i.path.join('.'),
          message: i.message,
        }))
      );
    }

    this.logger.info(
      {
        roles: result.data.roles.length,
        channels: result.data.channels.length,
        categories: result.data.categories.length,
      },
      'Config parsed successfully'
    );

    return result.data;
  }

  /**
   * Validate config against Discord constraints
   * - Role hierarchy rules
   * - Channel references to existing categories
   * - Permission conflicts
   */
  validateConstraints(config: ServerConfig): ValidationResult {
    const errors: ValidationError[] = [];

    // Check channel category references
    const categoryNames = new Set(config.categories.map(c => c.name));
    for (const channel of config.channels) {
      if (channel.category && !categoryNames.has(channel.category)) {
        errors.push({
          path: `channels.${channel.name}.category`,
          message: `Category "${channel.category}" not found in config`,
        });
      }
    }

    // Check role names in channel permissions
    const roleNames = new Set(config.roles.map(r => r.name));
    for (const channel of config.channels) {
      if (channel.permissions) {
        for (const roleName of Object.keys(channel.permissions)) {
          if (roleName !== '@everyone' && !roleNames.has(roleName)) {
            errors.push({
              path: `channels.${channel.name}.permissions`,
              message: `Role "${roleName}" not found in config`,
            });
          }
        }
      }
    }

    // Check duplicate names
    const allNames = [
      ...config.roles.map(r => r.name),
      ...config.channels.map(c => c.name),
      ...config.categories.map(c => c.name),
    ];
    const duplicates = allNames.filter((n, i) => allNames.indexOf(n) !== i);
    if (duplicates.length > 0) {
      errors.push({
        path: 'root',
        message: `Duplicate resource names: ${duplicates.join(', ')}`,
      });
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }
}

/**
 * Custom error for configuration issues
 */
export class ConfigError extends Error {
  constructor(
    message: string,
    public readonly errors: ValidationError[]
  ) {
    super(message);
    this.name = 'ConfigError';
  }
}
```

#### 4.2.2 StateReader

**Responsibility**: Fetch current Discord server state via API

**Source Reference**: `apps/worker/src/services/DiscordRest.ts` (Discord API patterns)

```typescript
// packages/cli/src/commands/server/iac/StateReader.ts

import type { REST } from '@discordjs/rest';
import { Routes } from 'discord-api-types/v10';
import type {
  RESTGetAPIGuildResult,
  RESTGetAPIGuildRolesResult,
  RESTGetAPIGuildChannelsResult,
} from 'discord-api-types/v10';
import type { Logger } from 'pino';

/**
 * StateReader - Fetch current Discord server state
 *
 * Based on PRD §4.3 Discord API Integration
 */
export class StateReader {
  constructor(
    private readonly rest: REST,
    private readonly logger: Logger
  ) {}

  /**
   * Fetch complete guild state
   */
  async fetchGuildState(guildId: string): Promise<DiscordState> {
    this.logger.debug({ guildId }, 'Fetching guild state');

    const [guild, roles, channels] = await Promise.all([
      this.fetchGuild(guildId),
      this.fetchRoles(guildId),
      this.fetchChannels(guildId),
    ]);

    // Separate channels into categories and regular channels
    const categories = channels.filter(c => c.type === 4); // GUILD_CATEGORY
    const regularChannels = channels.filter(c => c.type !== 4);

    const state: DiscordState = {
      guild: {
        id: guild.id,
        name: guild.name,
        description: guild.description ?? undefined,
      },
      roles: this.mapRoles(roles),
      channels: this.mapChannels(regularChannels),
      categories: this.mapCategories(categories),
    };

    this.logger.info(
      {
        roles: state.roles.size,
        channels: state.channels.size,
        categories: state.categories.size,
      },
      'Guild state fetched'
    );

    return state;
  }

  /**
   * Fetch guild metadata
   */
  private async fetchGuild(guildId: string): Promise<RESTGetAPIGuildResult> {
    return await this.rest.get(
      Routes.guild(guildId)
    ) as RESTGetAPIGuildResult;
  }

  /**
   * Fetch all roles in guild
   */
  private async fetchRoles(guildId: string): Promise<RESTGetAPIGuildRolesResult> {
    return await this.rest.get(
      Routes.guildRoles(guildId)
    ) as RESTGetAPIGuildRolesResult;
  }

  /**
   * Fetch all channels in guild
   */
  private async fetchChannels(guildId: string): Promise<RESTGetAPIGuildChannelsResult> {
    return await this.rest.get(
      Routes.guildChannels(guildId)
    ) as RESTGetAPIGuildChannelsResult;
  }

  /**
   * Map Discord API roles to internal representation
   */
  private mapRoles(roles: RESTGetAPIGuildRolesResult): Map<string, DiscordRole> {
    const map = new Map<string, DiscordRole>();

    for (const role of roles) {
      // Skip @everyone role (immutable)
      if (role.name === '@everyone') continue;

      map.set(role.name, {
        id: role.id,
        name: role.name,
        color: role.color,
        permissions: role.permissions,
        position: role.position,
        hoist: role.hoist,
        mentionable: role.mentionable,
        managed: ResourceTracker.isManaged(role),
      });
    }

    return map;
  }

  /**
   * Map Discord API channels to internal representation
   */
  private mapChannels(channels: RESTGetAPIGuildChannelsResult): Map<string, DiscordChannel> {
    const map = new Map<string, DiscordChannel>();

    for (const channel of channels) {
      map.set(channel.name, {
        id: channel.id,
        name: channel.name,
        type: channel.type,
        position: channel.position,
        parentId: channel.parent_id ?? undefined,
        topic: channel.topic ?? undefined,
        nsfw: channel.nsfw ?? false,
        rateLimitPerUser: channel.rate_limit_per_user ?? 0,
        permissionOverwrites: channel.permission_overwrites ?? [],
        managed: ResourceTracker.isManaged(channel),
      });
    }

    return map;
  }

  /**
   * Map Discord API categories to internal representation
   */
  private mapCategories(categories: RESTGetAPIGuildChannelsResult): Map<string, DiscordCategory> {
    const map = new Map<string, DiscordCategory>();

    for (const category of categories) {
      map.set(category.name, {
        id: category.id,
        name: category.name,
        position: category.position,
        managed: ResourceTracker.isManaged(category),
      });
    }

    return map;
  }
}
```

#### 4.2.3 DiffEngine

**Responsibility**: Calculate differences between desired and current state

**Design Pattern**: Three-way diff (creates, updates, deletes)

```typescript
// packages/cli/src/commands/server/iac/DiffEngine.ts

import type { Logger } from 'pino';

/**
 * DiffEngine - Calculate differences between desired and current state
 *
 * Based on PRD §4.6 Idempotency Strategy
 */
export class DiffEngine {
  constructor(private readonly logger: Logger) {}

  /**
   * Calculate diff between desired config and current Discord state
   */
  calculate(desired: ServerConfig, current: DiscordState): Diff {
    this.logger.debug('Calculating diff');

    const diff: Diff = {
      categories: this.diffCategories(desired.categories, current.categories),
      roles: this.diffRoles(desired.roles, current.roles),
      channels: this.diffChannels(desired.channels, current.channels),
    };

    const totalChanges =
      diff.categories.creates.length +
      diff.categories.updates.length +
      diff.categories.deletes.length +
      diff.roles.creates.length +
      diff.roles.updates.length +
      diff.roles.deletes.length +
      diff.channels.creates.length +
      diff.channels.updates.length +
      diff.channels.deletes.length;

    this.logger.info({ totalChanges }, 'Diff calculated');

    return diff;
  }

  /**
   * Diff categories
   */
  private diffCategories(
    desired: ConfigCategory[],
    current: Map<string, DiscordCategory>
  ): ResourceDiff<ConfigCategory, DiscordCategory> {
    const creates: ConfigCategory[] = [];
    const updates: Array<{ desired: ConfigCategory; current: DiscordCategory }> = [];
    const deletes: DiscordCategory[] = [];

    // Find creates and updates
    for (const desiredCat of desired) {
      const currentCat = current.get(desiredCat.name);

      if (!currentCat) {
        creates.push(desiredCat);
      } else if (this.shouldUpdateCategory(desiredCat, currentCat)) {
        updates.push({ desired: desiredCat, current: currentCat });
      }
    }

    // Find deletes (only managed categories)
    const desiredNames = new Set(desired.map(c => c.name));
    for (const [name, currentCat] of current) {
      if (!desiredNames.has(name) && currentCat.managed) {
        deletes.push(currentCat);
      }
    }

    return { creates, updates, deletes };
  }

  /**
   * Check if category needs update
   */
  private shouldUpdateCategory(
    desired: ConfigCategory,
    current: DiscordCategory
  ): boolean {
    return desired.position !== current.position;
  }

  /**
   * Diff roles
   */
  private diffRoles(
    desired: ConfigRole[],
    current: Map<string, DiscordRole>
  ): ResourceDiff<ConfigRole, DiscordRole> {
    const creates: ConfigRole[] = [];
    const updates: Array<{ desired: ConfigRole; current: DiscordRole }> = [];
    const deletes: DiscordRole[] = [];

    // Find creates and updates
    for (const desiredRole of desired) {
      const currentRole = current.get(desiredRole.name);

      if (!currentRole) {
        creates.push(desiredRole);
      } else if (this.shouldUpdateRole(desiredRole, currentRole)) {
        updates.push({ desired: desiredRole, current: currentRole });
      }
    }

    // Find deletes (only managed roles)
    const desiredNames = new Set(desired.map(r => r.name));
    for (const [name, currentRole] of current) {
      if (!desiredNames.has(name) && currentRole.managed) {
        deletes.push(currentRole);
      }
    }

    return { creates, updates, deletes };
  }

  /**
   * Check if role needs update
   */
  private shouldUpdateRole(desired: ConfigRole, current: DiscordRole): boolean {
    // Parse color (handle hex strings like "#FFD700")
    const desiredColor = this.parseColor(desired.color);

    return (
      desiredColor !== current.color ||
      !this.permissionsMatch(desired.permissions, current.permissions) ||
      desired.position !== current.position ||
      desired.hoist !== current.hoist ||
      desired.mentionable !== current.mentionable
    );
  }

  /**
   * Diff channels
   */
  private diffChannels(
    desired: ConfigChannel[],
    current: Map<string, DiscordChannel>
  ): ResourceDiff<ConfigChannel, DiscordChannel> {
    const creates: ConfigChannel[] = [];
    const updates: Array<{ desired: ConfigChannel; current: DiscordChannel }> = [];
    const deletes: DiscordChannel[] = [];

    // Find creates and updates
    for (const desiredChan of desired) {
      const currentChan = current.get(desiredChan.name);

      if (!currentChan) {
        creates.push(desiredChan);
      } else if (this.shouldUpdateChannel(desiredChan, currentChan)) {
        updates.push({ desired: desiredChan, current: currentChan });
      }
    }

    // Find deletes (only managed channels)
    const desiredNames = new Set(desired.map(c => c.name));
    for (const [name, currentChan] of current) {
      if (!desiredNames.has(name) && currentChan.managed) {
        deletes.push(currentChan);
      }
    }

    return { creates, updates, deletes };
  }

  /**
   * Check if channel needs update
   */
  private shouldUpdateChannel(
    desired: ConfigChannel,
    current: DiscordChannel
  ): boolean {
    return (
      desired.topic !== current.topic ||
      desired.nsfw !== current.nsfw ||
      desired.slowmode !== current.rateLimitPerUser ||
      !this.permissionOverwritesMatch(desired.permissions, current.permissionOverwrites)
    );
  }

  /**
   * Parse color string to integer
   * "#FFD700" → 16766720
   */
  private parseColor(color: string): number {
    return parseInt(color.replace('#', ''), 16);
  }

  /**
   * Check if permissions match
   */
  private permissionsMatch(
    desired: string[],
    current: string
  ): boolean {
    const desiredBits = PermissionUtils.calculateBits(desired);
    return desiredBits === BigInt(current);
  }

  /**
   * Check if permission overwrites match
   */
  private permissionOverwritesMatch(
    desired: Record<string, { allow: string[]; deny: string[] }> | undefined,
    current: PermissionOverwrite[]
  ): boolean {
    if (!desired && current.length === 0) return true;
    if (!desired || current.length !== Object.keys(desired).length) return false;

    // Complex comparison needed
    // For MVP: consider any permission change as requiring update
    return false; // Conservative: always update if permissions exist
  }
}

/**
 * Utility for Discord permission bit manipulation
 */
export class PermissionUtils {
  private static readonly PERMISSIONS: Record<string, bigint> = {
    VIEW_CHANNEL: 1n << 10n,
    SEND_MESSAGES: 1n << 11n,
    READ_MESSAGE_HISTORY: 1n << 16n,
    ADD_REACTIONS: 1n << 6n,
    ATTACH_FILES: 1n << 15n,
    EMBED_LINKS: 1n << 14n,
    MANAGE_MESSAGES: 1n << 13n,
    MANAGE_CHANNELS: 1n << 4n,
    MANAGE_ROLES: 1n << 28n,
  };

  /**
   * Calculate permission bitfield from array of permission names
   */
  static calculateBits(permissions: string[]): bigint {
    let bits = 0n;
    for (const perm of permissions) {
      const bit = this.PERMISSIONS[perm];
      if (bit) {
        bits |= bit;
      }
    }
    return bits;
  }
}
```

#### 4.2.4 StateWriter

**Responsibility**: Apply changes to Discord via REST API

**Source Reference**: `apps/worker/src/services/DiscordRest.ts` (REST patterns, rate limiting)

```typescript
// packages/cli/src/commands/server/iac/StateWriter.ts

import type { REST } from '@discordjs/rest';
import { Routes } from 'discord-api-types/v10';
import type { Logger } from 'pino';

/**
 * StateWriter - Apply configuration changes to Discord
 *
 * Based on PRD §4.8 Error Handling
 */
export class StateWriter {
  constructor(
    private readonly rest: REST,
    private readonly rateLimiter: RateLimiter,
    private readonly logger: Logger
  ) {}

  /**
   * Apply a diff to Discord
   */
  async apply(guildId: string, diff: Diff): Promise<ApplyResult> {
    this.logger.info({ guildId }, 'Applying changes to Discord');

    const result: ApplyResult = {
      success: true,
      created: { categories: 0, roles: 0, channels: 0 },
      updated: { categories: 0, roles: 0, channels: 0 },
      deleted: { categories: 0, roles: 0, channels: 0 },
      errors: [],
    };

    try {
      // Apply in dependency order:
      // 1. Categories (channels depend on them)
      // 2. Roles (permissions depend on them)
      // 3. Channels (depend on categories and roles)

      // 1. Create categories
      for (const category of diff.categories.creates) {
        await this.createCategory(guildId, category);
        result.created.categories++;
      }

      // 2. Create roles
      for (const role of diff.roles.creates) {
        await this.createRole(guildId, role);
        result.created.roles++;
      }

      // 3. Create channels
      for (const channel of diff.channels.creates) {
        await this.createChannel(guildId, channel);
        result.created.channels++;
      }

      // 4. Update resources
      for (const { desired, current } of diff.categories.updates) {
        await this.updateCategory(current.id, desired);
        result.updated.categories++;
      }

      for (const { desired, current } of diff.roles.updates) {
        await this.updateRole(guildId, current.id, desired);
        result.updated.roles++;
      }

      for (const { desired, current } of diff.channels.updates) {
        await this.updateChannel(current.id, desired);
        result.updated.channels++;
      }

      // 5. Delete resources (reverse order)
      for (const channel of diff.channels.deletes) {
        await this.deleteChannel(channel.id);
        result.deleted.channels++;
      }

      for (const role of diff.roles.deletes) {
        await this.deleteRole(guildId, role.id);
        result.deleted.roles++;
      }

      for (const category of diff.categories.deletes) {
        await this.deleteCategory(category.id);
        result.deleted.categories++;
      }

    } catch (error) {
      result.success = false;
      result.errors.push({
        message: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      });
      this.logger.error({ error }, 'Failed to apply changes');
    }

    return result;
  }

  /**
   * Create a category
   */
  private async createCategory(guildId: string, category: ConfigCategory): Promise<void> {
    await this.rateLimiter.wait();

    this.logger.debug({ name: category.name }, 'Creating category');

    await this.rest.post(
      Routes.guildChannels(guildId),
      {
        body: {
          name: category.name,
          type: 4, // GUILD_CATEGORY
          position: category.position,
        },
      }
    );
  }

  /**
   * Create a role
   */
  private async createRole(guildId: string, role: ConfigRole): Promise<void> {
    await this.rateLimiter.wait();

    this.logger.debug({ name: role.name }, 'Creating role');

    await this.rest.post(
      Routes.guildRoles(guildId),
      {
        body: {
          name: role.name,
          color: this.parseColor(role.color),
          permissions: PermissionUtils.calculateBits(role.permissions).toString(),
          hoist: role.hoist,
          mentionable: role.mentionable,
        },
      }
    );
  }

  /**
   * Create a channel
   */
  private async createChannel(guildId: string, channel: ConfigChannel): Promise<void> {
    await this.rateLimiter.wait();

    this.logger.debug({ name: channel.name }, 'Creating channel');

    await this.rest.post(
      Routes.guildChannels(guildId),
      {
        body: {
          name: channel.name,
          type: channel.type === 'text' ? 0 : 2, // TEXT or VOICE
          topic: channel.topic,
          nsfw: channel.nsfw,
          rate_limit_per_user: channel.slowmode,
          parent_id: await this.resolveParentId(guildId, channel.category),
        },
      }
    );
  }

  /**
   * Update a category
   */
  private async updateCategory(categoryId: string, category: ConfigCategory): Promise<void> {
    await this.rateLimiter.wait();

    this.logger.debug({ id: categoryId }, 'Updating category');

    await this.rest.patch(
      Routes.channel(categoryId),
      {
        body: {
          position: category.position,
        },
      }
    );
  }

  /**
   * Update a role
   */
  private async updateRole(guildId: string, roleId: string, role: ConfigRole): Promise<void> {
    await this.rateLimiter.wait();

    this.logger.debug({ id: roleId }, 'Updating role');

    await this.rest.patch(
      Routes.guildRole(guildId, roleId),
      {
        body: {
          name: role.name,
          color: this.parseColor(role.color),
          permissions: PermissionUtils.calculateBits(role.permissions).toString(),
          hoist: role.hoist,
          mentionable: role.mentionable,
        },
      }
    );
  }

  /**
   * Update a channel
   */
  private async updateChannel(channelId: string, channel: ConfigChannel): Promise<void> {
    await this.rateLimiter.wait();

    this.logger.debug({ id: channelId }, 'Updating channel');

    await this.rest.patch(
      Routes.channel(channelId),
      {
        body: {
          topic: channel.topic,
          nsfw: channel.nsfw,
          rate_limit_per_user: channel.slowmode,
        },
      }
    );

    // Update permissions if specified
    if (channel.permissions) {
      await this.updateChannelPermissions(channelId, channel.permissions);
    }
  }

  /**
   * Update channel permission overwrites
   */
  private async updateChannelPermissions(
    channelId: string,
    permissions: Record<string, { allow: string[]; deny: string[] }>
  ): Promise<void> {
    for (const [roleName, perms] of Object.entries(permissions)) {
      await this.rateLimiter.wait();

      const roleId = await this.resolveRoleId(roleName);

      await this.rest.put(
        Routes.channelPermission(channelId, roleId),
        {
          body: {
            type: 0, // Role overwrite
            allow: PermissionUtils.calculateBits(perms.allow).toString(),
            deny: PermissionUtils.calculateBits(perms.deny).toString(),
          },
        }
      );
    }
  }

  /**
   * Delete a channel
   */
  private async deleteChannel(channelId: string): Promise<void> {
    await this.rateLimiter.wait();

    this.logger.debug({ id: channelId }, 'Deleting channel');

    await this.rest.delete(Routes.channel(channelId));
  }

  /**
   * Delete a role
   */
  private async deleteRole(guildId: string, roleId: string): Promise<void> {
    await this.rateLimiter.wait();

    this.logger.debug({ id: roleId }, 'Deleting role');

    await this.rest.delete(Routes.guildRole(guildId, roleId));
  }

  /**
   * Delete a category
   */
  private async deleteCategory(categoryId: string): Promise<void> {
    await this.rateLimiter.wait();

    this.logger.debug({ id: categoryId }, 'Deleting category');

    await this.rest.delete(Routes.channel(categoryId));
  }

  // Helper methods...
  private parseColor(color: string): number {
    return parseInt(color.replace('#', ''), 16);
  }

  private async resolveParentId(guildId: string, categoryName?: string): Promise<string | undefined> {
    // Implementation: Look up category ID by name
    // Cache this mapping for efficiency
    return undefined;
  }

  private async resolveRoleId(roleName: string): Promise<string> {
    // Implementation: Look up role ID by name
    // Cache this mapping for efficiency
    return '';
  }
}
```

#### 4.2.5 RateLimiter

**Responsibility**: Handle Discord API rate limits

**Design Pattern**: Token bucket with exponential backoff

```typescript
// packages/cli/src/commands/server/iac/RateLimiter.ts

import type { Logger } from 'pino';

/**
 * RateLimiter - Discord API rate limit handling
 *
 * Based on PRD §4.3 Discord API Integration (Rate Limits)
 *
 * Discord rate limits:
 * - Global: 50 requests/second per guild
 * - Role/Channel create: 10-second cooldown
 * - Burst allowance: ~5-10 requests before hitting limit
 */
export class RateLimiter {
  private requestQueue: number[] = [];
  private readonly maxRequestsPerSecond: number;
  private readonly burstSize: number;
  private retryAfter: number | null = null;

  constructor(
    private readonly logger: Logger,
    options: { maxRequestsPerSecond?: number; burstSize?: number } = {}
  ) {
    this.maxRequestsPerSecond = options.maxRequestsPerSecond ?? 50;
    this.burstSize = options.burstSize ?? 10;
  }

  /**
   * Wait for rate limit allowance before making request
   */
  async wait(): Promise<void> {
    // Check if we're in a retry-after period
    if (this.retryAfter && Date.now() < this.retryAfter) {
      const waitMs = this.retryAfter - Date.now();
      this.logger.warn({ waitMs }, 'Rate limited, waiting');
      await this.sleep(waitMs);
      this.retryAfter = null;
    }

    // Token bucket algorithm
    const now = Date.now();
    const oneSecondAgo = now - 1000;

    // Remove requests older than 1 second
    this.requestQueue = this.requestQueue.filter(t => t > oneSecondAgo);

    // Check if we're at capacity
    if (this.requestQueue.length >= this.maxRequestsPerSecond) {
      const oldestRequest = this.requestQueue[0];
      const waitMs = 1000 - (now - oldestRequest);
      await this.sleep(waitMs);
    }

    // Add current request to queue
    this.requestQueue.push(Date.now());
  }

  /**
   * Handle rate limit response from Discord (429)
   */
  handleRateLimit(retryAfterMs: number): void {
    this.retryAfter = Date.now() + retryAfterMs;
    this.logger.warn({ retryAfterMs }, 'Rate limit response received');
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
```

#### 4.2.6 ResourceTracker

**Responsibility**: Track which resources are managed by IaC

**Design Pattern**: Metadata tagging in Discord descriptions

```typescript
// packages/cli/src/commands/server/iac/ResourceTracker.ts

/**
 * ResourceTracker - Track managed vs unmanaged resources
 *
 * Based on PRD §4.5 Resource Identification
 *
 * Strategy: Append "[managed-by:arrakis-iac]" to resource descriptions
 */
export class ResourceTracker {
  private static readonly MANAGED_TAG = '[managed-by:arrakis-iac]';

  /**
   * Check if a resource is managed by IaC
   */
  static isManaged(resource: { topic?: string }): boolean {
    return resource.topic?.includes(this.MANAGED_TAG) ?? false;
  }

  /**
   * Tag a resource as managed
   */
  static tagResource(description: string | undefined): string {
    if (!description) return this.MANAGED_TAG;
    if (description.includes(this.MANAGED_TAG)) return description;
    return `${description} ${this.MANAGED_TAG}`;
  }

  /**
   * Remove managed tag from description
   */
  static untagResource(description: string | undefined): string {
    if (!description) return '';
    return description.replace(this.MANAGED_TAG, '').trim();
  }
}
```

#### 4.2.7 DiscordRestClient

**Responsibility**: Wrapper around @discordjs/rest with bot token

**Source Reference**: `apps/worker/src/services/DiscordRest.ts` (lines 35-200)

```typescript
// packages/cli/src/commands/server/iac/DiscordRestClient.ts

import { REST } from '@discordjs/rest';
import type { Logger } from 'pino';

/**
 * DiscordRestClient - Bot token authenticated Discord API client
 *
 * Extends the existing DiscordRestService pattern with bot token auth
 */
export class DiscordRestClient {
  private readonly rest: REST;

  constructor(
    botToken: string,
    private readonly logger: Logger
  ) {
    this.rest = new REST({ version: '10' }).setToken(botToken);
    this.logger.debug('Discord REST client initialized');
  }

  /**
   * Get the underlying REST client for direct API calls
   */
  getClient(): REST {
    return this.rest;
  }

  /**
   * Verify bot has required permissions in guild
   */
  async verifyPermissions(guildId: string): Promise<PermissionCheckResult> {
    // Implementation: Check bot's permissions in guild
    // Required: MANAGE_ROLES, MANAGE_CHANNELS, MANAGE_GUILD
    return { hasPermissions: true, missing: [] };
  }
}
```

---

## 5. Data Architecture

### 5.1 Configuration Schema (YAML)

**File**: `server.yaml` (user-provided configuration)

```yaml
version: "1"

# Server metadata (optional)
server:
  name: "Arrakis Community"
  description: "Token-gated community"

# Role definitions
roles:
  - name: "Holder"
    color: "#FFD700"
    permissions:
      - VIEW_CHANNEL
      - SEND_MESSAGES
      - READ_MESSAGE_HISTORY
    hoist: true          # Display separately
    mentionable: true    # Can be @mentioned
    position: 2          # Order in role list (higher = more important)

# Category definitions
categories:
  - name: "Information"
    position: 0

# Channel definitions
channels:
  - name: "welcome"
    type: text           # text | voice
    category: "Information"
    topic: "Welcome to Arrakis!"
    position: 0
    nsfw: false
    slowmode: 0          # Seconds between messages
    permissions:
      "@everyone":
        allow: [VIEW_CHANNEL, READ_MESSAGE_HISTORY]
        deny: [SEND_MESSAGES]
      "Holder":
        allow: [SEND_MESSAGES]
```

### 5.2 Zod Schema Definition

**File**: `packages/cli/src/commands/server/iac/schemas.ts`

```typescript
import { z } from 'zod';

/**
 * Zod schemas for configuration validation
 */

// Permission names (subset for MVP)
const PermissionSchema = z.enum([
  'VIEW_CHANNEL',
  'SEND_MESSAGES',
  'READ_MESSAGE_HISTORY',
  'ADD_REACTIONS',
  'ATTACH_FILES',
  'EMBED_LINKS',
  'MANAGE_MESSAGES',
  'MANAGE_CHANNELS',
  'MANAGE_ROLES',
]);

// Color hex string (#RRGGBB)
const ColorSchema = z.string().regex(/^#[0-9A-Fa-f]{6}$/);

// Role definition
const RoleSchema = z.object({
  name: z.string().min(1).max(100),
  color: ColorSchema,
  permissions: z.array(PermissionSchema),
  hoist: z.boolean().optional().default(false),
  mentionable: z.boolean().optional().default(false),
  position: z.number().int().nonnegative().optional().default(0),
});

// Category definition
const CategorySchema = z.object({
  name: z.string().min(1).max(100),
  position: z.number().int().nonnegative().optional().default(0),
});

// Permission overwrite
const PermissionOverwriteSchema = z.object({
  allow: z.array(PermissionSchema).optional().default([]),
  deny: z.array(PermissionSchema).optional().default([]),
});

// Channel definition
const ChannelSchema = z.object({
  name: z.string().min(1).max(100),
  type: z.enum(['text', 'voice']),
  category: z.string().optional(),
  topic: z.string().max(1024).optional(),
  position: z.number().int().nonnegative().optional().default(0),
  nsfw: z.boolean().optional().default(false),
  slowmode: z.number().int().nonnegative().max(21600).optional().default(0),
  permissions: z.record(z.string(), PermissionOverwriteSchema).optional(),
});

// Server metadata
const ServerMetadataSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(1000).optional(),
});

// Full server config
export const ServerConfigSchema = z.object({
  version: z.literal('1'),
  server: ServerMetadataSchema.optional(),
  roles: z.array(RoleSchema).default([]),
  categories: z.array(CategorySchema).default([]),
  channels: z.array(ChannelSchema).default([]),
});

// TypeScript types derived from schemas
export type Permission = z.infer<typeof PermissionSchema>;
export type ConfigRole = z.infer<typeof RoleSchema>;
export type ConfigCategory = z.infer<typeof CategorySchema>;
export type ConfigChannel = z.infer<typeof ChannelSchema>;
export type ServerConfig = z.infer<typeof ServerConfigSchema>;
```

### 5.3 Internal State Representation

**File**: `packages/cli/src/commands/server/iac/types.ts`

```typescript
/**
 * Internal state representation (Discord API → Internal)
 */

/**
 * Discord server state snapshot
 */
export interface DiscordState {
  guild: {
    id: string;
    name: string;
    description?: string;
  };
  roles: Map<string, DiscordRole>;
  channels: Map<string, DiscordChannel>;
  categories: Map<string, DiscordCategory>;
}

/**
 * Discord role (from API)
 */
export interface DiscordRole {
  id: string;
  name: string;
  color: number;
  permissions: string; // Bitfield as string
  position: number;
  hoist: boolean;
  mentionable: boolean;
  managed: boolean; // Tracked by IaC
}

/**
 * Discord channel (from API)
 */
export interface DiscordChannel {
  id: string;
  name: string;
  type: number; // 0=text, 2=voice
  position: number;
  parentId?: string; // Category ID
  topic?: string;
  nsfw: boolean;
  rateLimitPerUser: number;
  permissionOverwrites: PermissionOverwrite[];
  managed: boolean; // Tracked by IaC
}

/**
 * Discord category (from API)
 */
export interface DiscordCategory {
  id: string;
  name: string;
  position: number;
  managed: boolean; // Tracked by IaC
}

/**
 * Permission overwrite structure
 */
export interface PermissionOverwrite {
  id: string; // Role or user ID
  type: 0 | 1; // 0=role, 1=member
  allow: string; // Bitfield
  deny: string; // Bitfield
}

/**
 * Diff result
 */
export interface Diff {
  categories: ResourceDiff<ConfigCategory, DiscordCategory>;
  roles: ResourceDiff<ConfigRole, DiscordRole>;
  channels: ResourceDiff<ConfigChannel, DiscordChannel>;
}

/**
 * Resource diff (creates, updates, deletes)
 */
export interface ResourceDiff<T, U> {
  creates: T[];
  updates: Array<{ desired: T; current: U }>;
  deletes: U[];
}

/**
 * Apply result
 */
export interface ApplyResult {
  success: boolean;
  created: {
    categories: number;
    roles: number;
    channels: number;
  };
  updated: {
    categories: number;
    roles: number;
    channels: number;
  };
  deleted: {
    categories: number;
    roles: number;
    channels: number;
  };
  errors: Array<{
    message: string;
    stack?: string;
  }>;
}
```

---

## 6. API Design

### 6.1 CLI Commands

**Command Group**: `gaib server`

**Source Reference**: `packages/cli/src/commands/sandbox/index.ts` (command registration pattern)

#### Command Structure

```typescript
// packages/cli/src/commands/server/index.ts

import { Command } from 'commander';

export function createServerCommand(): Command {
  const server = new Command('server')
    .description('Manage Discord server infrastructure as code')
    .option('--no-color', 'Disable colored output')
    .option('-q, --quiet', 'Suppress non-essential output');

  registerInitCommand(server);
  registerPlanCommand(server);
  registerDiffCommand(server);
  registerExportCommand(server);

  return server;
}

function registerInitCommand(parent: Command): void {
  parent
    .command('init <guild-id>')
    .description('Apply configuration to Discord server')
    .option('-c, --config <file>', 'Config file path', 'server.yaml')
    .option('-n, --dry-run', 'Show changes without applying')
    .option('-f, --force', 'Skip confirmation prompt')
    .option('--json', 'Output as JSON')
    .action(async (guildId: string, options) => {
      const { initCommand } = await import('./init.js');
      await initCommand(guildId, options);
    });
}

function registerPlanCommand(parent: Command): void {
  parent
    .command('plan <guild-id>')
    .description('Show planned changes without applying')
    .option('-c, --config <file>', 'Config file path', 'server.yaml')
    .option('--json', 'Output as JSON')
    .action(async (guildId: string, options) => {
      const { planCommand } = await import('./plan.js');
      await planCommand(guildId, options);
    });
}

function registerDiffCommand(parent: Command): void {
  parent
    .command('diff <guild-id>')
    .description('Detect configuration drift')
    .option('-c, --config <file>', 'Config file path', 'server.yaml')
    .option('--json', 'Output as JSON')
    .action(async (guildId: string, options) => {
      const { diffCommand } = await import('./diff.js');
      await diffCommand(guildId, options);
    });
}

function registerExportCommand(parent: Command): void {
  parent
    .command('export <guild-id>')
    .description('Export current server state to YAML')
    .option('-o, --output <file>', 'Output file path (default: stdout)')
    .option('--managed-only', 'Export only IaC-managed resources')
    .action(async (guildId: string, options) => {
      const { exportCommand } = await import('./export.js');
      await exportCommand(guildId, options);
    });
}
```

### 6.2 Command Usage Examples

#### gaib server init

```bash
# Apply configuration to Discord server
gaib server init 123456789012345678 --config server.yaml

# Dry-run mode (show what would change)
gaib server init 123456789012345678 --config server.yaml --dry-run

# Force apply without confirmation
gaib server init 123456789012345678 --config server.yaml --force

# JSON output for automation
gaib server init 123456789012345678 --config server.yaml --json
```

**Exit Codes**:
- `0`: Success (changes applied or no changes needed)
- `1`: Validation error (invalid config, missing permissions)
- `2`: Partial application (some changes failed)

#### gaib server plan

```bash
# Show planned changes
gaib server plan 123456789012345678 --config server.yaml

# JSON output
gaib server plan 123456789012345678 --config server.yaml --json
```

**Exit Codes**:
- `0`: Success (plan calculated)
- `1`: Validation error

#### gaib server diff

```bash
# Detect configuration drift
gaib server diff 123456789012345678 --config server.yaml

# JSON output
gaib server diff 123456789012345678 --config server.yaml --json
```

**Exit Codes**:
- `0`: No drift (config matches Discord)
- `1`: Drift detected
- `2`: Error (invalid config, API error)

#### gaib server export

```bash
# Export to stdout
gaib server export 123456789012345678

# Export to file
gaib server export 123456789012345678 --output server.yaml

# Export only managed resources
gaib server export 123456789012345678 --managed-only
```

**Exit Codes**:
- `0`: Success
- `1`: Error (API error, file write error)

### 6.3 Discord API Endpoints Used

**Source Reference**: PRD Appendix B (Discord API Endpoints)

| Resource | Endpoint | Method | Purpose |
|----------|----------|--------|---------|
| **Guild** | `/guilds/{guild_id}` | GET | Fetch guild metadata |
| **Roles** | `/guilds/{guild_id}/roles` | GET | List all roles |
| | `/guilds/{guild_id}/roles` | POST | Create role |
| | `/guilds/{guild_id}/roles/{role_id}` | PATCH | Update role |
| | `/guilds/{guild_id}/roles/{role_id}` | DELETE | Delete role |
| **Channels** | `/guilds/{guild_id}/channels` | GET | List all channels |
| | `/guilds/{guild_id}/channels` | POST | Create channel |
| | `/channels/{channel_id}` | PATCH | Update channel |
| | `/channels/{channel_id}` | DELETE | Delete channel |
| **Permissions** | `/channels/{channel_id}/permissions/{overwrite_id}` | PUT | Set permission overwrite |
| | `/channels/{channel_id}/permissions/{overwrite_id}` | DELETE | Delete permission overwrite |

**Rate Limits** (from PRD §4.3):
- Most endpoints: 50 requests/second per guild
- Role/Channel create: 10-second cooldown per resource
- Burst allowance: ~5-10 requests before hitting limit

**Required Bot Permissions**:
- `MANAGE_ROLES` (0x10000000) - Create/modify/delete roles
- `MANAGE_CHANNELS` (0x10) - Create/modify/delete channels
- `MANAGE_GUILD` (0x20) - Modify server settings
- `VIEW_CHANNEL` (0x400) - Read channel information

---

## 7. Security Architecture

### 7.1 Bot Token Management

**Challenge**: CLI needs Discord bot token for API authentication

**Solution**: Environment variable with secure defaults

```typescript
// packages/cli/src/commands/server/utils.ts

/**
 * Get Discord bot token from environment
 * @throws Error if token not found
 */
export function getBotToken(): string {
  const token = process.env.DISCORD_BOT_TOKEN;

  if (!token) {
    throw new Error(
      'DISCORD_BOT_TOKEN environment variable not set.\n' +
      'Set it with: export DISCORD_BOT_TOKEN=your_bot_token'
    );
  }

  return token;
}
```

**Usage**:
```bash
export DISCORD_BOT_TOKEN=your_bot_token_here
gaib server init 123456789012345678 --config server.yaml
```

**Security Considerations**:
- Never log bot token (redact in logs)
- Never include in config files (environment variable only)
- Use `.env` files with gitignore for local development
- CI/CD: Store as encrypted secret

### 7.2 Permission Validation

**Pre-flight Check**: Verify bot has required permissions before applying changes

```typescript
// packages/cli/src/commands/server/iac/DiscordRestClient.ts

async verifyPermissions(guildId: string): Promise<PermissionCheckResult> {
  const member = await this.rest.get(
    Routes.guildMember(guildId, '@me')
  ) as GuildMember;

  const permissions = BigInt(member.permissions);
  const required = [
    PermissionFlagsBits.ManageRoles,
    PermissionFlagsBits.ManageChannels,
    PermissionFlagsBits.ManageGuild,
  ];

  const missing = required.filter(p => !(permissions & p));

  return {
    hasPermissions: missing.length === 0,
    missing: missing.map(p => PermissionFlagsBits[p]),
  };
}
```

**Error Message** (if missing permissions):
```
Error: Bot missing required permissions

The bot needs these permissions to manage server infrastructure:
  - MANAGE_ROLES
  - MANAGE_CHANNELS

Please add these permissions in Discord:
Server Settings → Roles → Arrakis Bot → Enable permissions

Documentation: https://docs.arrakis.com/iac/permissions
```

### 7.3 Audit Logging

**Strategy**: Log all changes to Discord server for compliance

```typescript
// packages/cli/src/commands/server/iac/AuditLogger.ts

export class AuditLogger {
  async logChange(event: AuditEvent): Promise<void> {
    // Log to console (for CLI visibility)
    this.logger.info(event, 'Discord change applied');

    // Optional: Log to external audit trail (database, file)
    // For future: integrate with sandbox analytics
  }
}

interface AuditEvent {
  timestamp: Date;
  guildId: string;
  action: 'create' | 'update' | 'delete';
  resourceType: 'role' | 'channel' | 'category';
  resourceName: string;
  resourceId: string;
  user: string; // Who ran the command
  configFile: string; // Which config file
}
```

### 7.4 Safe Defaults

**Principle**: Non-destructive operations by default

| Operation | Default Behavior | Override Flag |
|-----------|------------------|---------------|
| **Unmanaged Resources** | Preserve (do not delete) | N/A (no override in MVP) |
| **Confirmation Prompt** | Always ask before applying | `--force` |
| **Dry-Run** | Must explicitly apply | `--dry-run` shows changes |
| **Deletes** | Only delete managed resources | N/A |

---

## 8. Error Handling & Recovery

### 8.1 Error Categories

| Category | Examples | Recovery Strategy |
|----------|----------|-------------------|
| **Validation Errors** | Invalid YAML, schema violations | Exit early, show validation errors |
| **Permission Errors** | Bot lacks MANAGE_ROLES | Exit early, show required permissions |
| **API Errors** | Rate limits, network errors | Retry with exponential backoff |
| **Partial Application** | Some changes applied, some failed | Log partial state, suggest re-running |
| **Discord Constraints** | Role hierarchy violations | Reorder operations, retry |

### 8.2 Error Handling Flow

```
┌─────────────────┐
│ Validation      │  → Invalid config → Exit with error
│ (Config + API)  │                     Show validation messages
└────────┬────────┘
         │ Valid
         ▼
┌─────────────────┐
│ Permission      │  → Missing perms → Exit with error
│ Check           │                    Show required permissions
└────────┬────────┘
         │ Authorized
         ▼
┌─────────────────┐
│ Apply Changes   │  → Rate limited → Wait and retry (3x)
│ (with retries)  │  → API error → Log and continue (or abort)
│                 │  → Constraint → Reorder and retry
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Report Results  │  → Partial success → Show what succeeded
│                 │                       Show what failed
│                 │                       Suggest re-running
└─────────────────┘
```

### 8.3 Retry Strategy

**Pattern**: Exponential backoff with jitter

```typescript
// packages/cli/src/commands/server/iac/RetryHandler.ts

export class RetryHandler {
  private readonly maxRetries = 3;
  private readonly baseDelayMs = 1000;

  async executeWithRetry<T>(
    operation: () => Promise<T>,
    context: string
  ): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error as Error;

        // Check if retryable
        if (!this.isRetryable(error)) {
          throw error;
        }

        // Calculate delay with exponential backoff + jitter
        const delay = this.baseDelayMs * Math.pow(2, attempt) + Math.random() * 1000;

        this.logger.warn(
          { attempt: attempt + 1, maxRetries: this.maxRetries, delayMs: delay },
          `${context} failed, retrying...`
        );

        await this.sleep(delay);
      }
    }

    throw lastError;
  }

  private isRetryable(error: unknown): boolean {
    if (error instanceof DiscordAPIError) {
      // Retry on rate limits, server errors, network errors
      return error.code === 429 || error.status >= 500;
    }
    return false;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
```

### 8.4 Rollback Strategy

**MVP Decision**: No automatic rollback

**Rationale**:
- Rollback is complex (need to track previous state)
- Discord operations are not transactional
- Partial rollback may leave inconsistent state
- Better: document partial state and suggest re-running with fixed config

**Future Enhancement** (Phase 2):
- Track changes in transaction log
- Implement rollback command (`gaib server rollback`)
- Store previous state snapshots

**Manual Recovery** (MVP):
```bash
# If apply fails partway through:

# 1. Check what was applied
gaib server diff 123456789012345678 --config server.yaml

# 2. Fix config or resolve issue
vim server.yaml

# 3. Re-run (idempotent, will skip already-applied changes)
gaib server init 123456789012345678 --config server.yaml
```

---

## 9. Rate Limiting Strategy

### 9.1 Discord Rate Limits

**Source**: PRD §4.3, Discord API Documentation

| Endpoint | Limit | Behavior |
|----------|-------|----------|
| **Global (per guild)** | 50 requests/second | 429 response with Retry-After header |
| **Role Create** | ~6 per 10 seconds | Hard limit, 10s cooldown |
| **Channel Create** | ~6 per 10 seconds | Hard limit, 10s cooldown |
| **Burst Allowance** | ~5-10 requests | Before hitting rate limit |

### 9.2 Rate Limiting Implementation

**Strategy**: Proactive rate limiting + reactive backoff

```typescript
// packages/cli/src/commands/server/iac/RateLimiter.ts

export class RateLimiter {
  // Token bucket for global limit (50 req/s)
  private globalBucket = new TokenBucket(50, 1000);

  // Cooldown tracking for create operations
  private lastRoleCreate: number = 0;
  private lastChannelCreate: number = 0;
  private readonly CREATE_COOLDOWN_MS = 10000; // 10 seconds

  async waitForCreate(resourceType: 'role' | 'channel'): Promise<void> {
    // Wait for global rate limit
    await this.globalBucket.acquire();

    // Wait for create-specific cooldown
    const lastCreate = resourceType === 'role' ? this.lastRoleCreate : this.lastChannelCreate;
    const timeSinceCreate = Date.now() - lastCreate;

    if (timeSinceCreate < this.CREATE_COOLDOWN_MS) {
      const waitMs = this.CREATE_COOLDOWN_MS - timeSinceCreate;
      this.logger.debug({ resourceType, waitMs }, 'Waiting for create cooldown');
      await this.sleep(waitMs);
    }

    // Update last create time
    if (resourceType === 'role') {
      this.lastRoleCreate = Date.now();
    } else {
      this.lastChannelCreate = Date.now();
    }
  }

  async waitForUpdate(): Promise<void> {
    // Only global rate limit applies
    await this.globalBucket.acquire();
  }
}

/**
 * Token bucket implementation
 */
class TokenBucket {
  private tokens: number;
  private lastRefill: number;

  constructor(
    private readonly capacity: number,
    private readonly refillMs: number
  ) {
    this.tokens = capacity;
    this.lastRefill = Date.now();
  }

  async acquire(): Promise<void> {
    // Refill tokens based on time passed
    this.refill();

    // Wait if no tokens available
    while (this.tokens < 1) {
      await this.sleep(100);
      this.refill();
    }

    this.tokens--;
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    const tokensToAdd = Math.floor(elapsed / this.refillMs) * this.capacity;

    if (tokensToAdd > 0) {
      this.tokens = Math.min(this.capacity, this.tokens + tokensToAdd);
      this.lastRefill = now;
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
```

### 9.3 Progress Feedback

**User Experience**: Show progress during rate-limited operations

```typescript
// Example: Creating 10 roles with 10s cooldown between each

import ora from 'ora';

const spinner = ora('Creating roles...').start();

for (let i = 0; i < roles.length; i++) {
  spinner.text = `Creating role ${i + 1}/${roles.length}: ${roles[i].name}`;
  await this.rateLimiter.waitForCreate('role');
  await this.stateWriter.createRole(guildId, roles[i]);
  spinner.succeed(`Created role: ${roles[i].name}`);

  if (i < roles.length - 1) {
    spinner.start(`Waiting for rate limit (10s cooldown)...`);
  }
}

spinner.succeed('All roles created');
```

---

## 10. Testing Strategy

### 10.1 Test Pyramid

```
                    ┌─────────────────┐
                    │  E2E Tests      │  (5%)
                    │  Real Discord   │
                    └─────────────────┘
                  ┌───────────────────────┐
                  │  Integration Tests    │  (15%)
                  │  Mock Discord API     │
                  └───────────────────────┘
              ┌─────────────────────────────────┐
              │  Unit Tests                     │  (80%)
              │  ConfigParser, DiffEngine, etc. │
              └─────────────────────────────────┘
```

### 10.2 Unit Tests

**Coverage Target**: >80% for core logic

**Test Files**:
```
packages/cli/src/commands/server/iac/__tests__/
├── ConfigParser.test.ts          # YAML parsing, validation
├── DiffEngine.test.ts             # Diff calculation logic
├── StateReader.test.ts            # State mapping
├── StateWriter.test.ts            # Change application
├── RateLimiter.test.ts            # Rate limiting logic
├── ResourceTracker.test.ts        # Managed resource tagging
└── PermissionUtils.test.ts        # Permission bitfield math
```

**Example Unit Test** (DiffEngine):
```typescript
// packages/cli/src/commands/server/iac/__tests__/DiffEngine.test.ts

import { describe, it, expect } from 'vitest';
import { DiffEngine } from '../DiffEngine.js';

describe('DiffEngine', () => {
  it('should detect new roles (creates)', () => {
    const desired: ServerConfig = {
      version: '1',
      roles: [
        { name: 'Holder', color: '#FFD700', permissions: ['VIEW_CHANNEL'] },
      ],
      categories: [],
      channels: [],
    };

    const current: DiscordState = {
      guild: { id: '123', name: 'Test' },
      roles: new Map(),
      channels: new Map(),
      categories: new Map(),
    };

    const engine = new DiffEngine(mockLogger);
    const diff = engine.calculate(desired, current);

    expect(diff.roles.creates).toHaveLength(1);
    expect(diff.roles.creates[0].name).toBe('Holder');
    expect(diff.roles.updates).toHaveLength(0);
    expect(diff.roles.deletes).toHaveLength(0);
  });

  it('should detect role changes (updates)', () => {
    const desired: ServerConfig = {
      version: '1',
      roles: [
        { name: 'Holder', color: '#FFD700', permissions: ['VIEW_CHANNEL'] },
      ],
      categories: [],
      channels: [],
    };

    const current: DiscordState = {
      guild: { id: '123', name: 'Test' },
      roles: new Map([
        ['Holder', {
          id: '456',
          name: 'Holder',
          color: 0xFFFFFF, // Different color
          permissions: '1024',
          position: 0,
          hoist: false,
          mentionable: false,
          managed: true,
        }],
      ]),
      channels: new Map(),
      categories: new Map(),
    };

    const engine = new DiffEngine(mockLogger);
    const diff = engine.calculate(desired, current);

    expect(diff.roles.creates).toHaveLength(0);
    expect(diff.roles.updates).toHaveLength(1);
    expect(diff.roles.updates[0].desired.name).toBe('Holder');
    expect(diff.roles.deletes).toHaveLength(0);
  });

  it('should detect deleted managed roles (deletes)', () => {
    const desired: ServerConfig = {
      version: '1',
      roles: [],
      categories: [],
      channels: [],
    };

    const current: DiscordState = {
      guild: { id: '123', name: 'Test' },
      roles: new Map([
        ['Holder', {
          id: '456',
          name: 'Holder',
          color: 0xFFD700,
          permissions: '1024',
          position: 0,
          hoist: false,
          mentionable: false,
          managed: true, // Managed by IaC
        }],
      ]),
      channels: new Map(),
      categories: new Map(),
    };

    const engine = new DiffEngine(mockLogger);
    const diff = engine.calculate(desired, current);

    expect(diff.roles.creates).toHaveLength(0);
    expect(diff.roles.updates).toHaveLength(0);
    expect(diff.roles.deletes).toHaveLength(1);
    expect(diff.roles.deletes[0].name).toBe('Holder');
  });

  it('should preserve unmanaged roles (no delete)', () => {
    const desired: ServerConfig = {
      version: '1',
      roles: [],
      categories: [],
      channels: [],
    };

    const current: DiscordState = {
      guild: { id: '123', name: 'Test' },
      roles: new Map([
        ['ManualRole', {
          id: '789',
          name: 'ManualRole',
          color: 0x000000,
          permissions: '0',
          position: 0,
          hoist: false,
          mentionable: false,
          managed: false, // NOT managed by IaC
        }],
      ]),
      channels: new Map(),
      categories: new Map(),
    };

    const engine = new DiffEngine(mockLogger);
    const diff = engine.calculate(desired, current);

    expect(diff.roles.deletes).toHaveLength(0); // Should NOT delete unmanaged role
  });
});
```

### 10.3 Integration Tests

**Goal**: Test against mock Discord API

**Approach**: Use MSW (Mock Service Worker) to intercept HTTP requests

```typescript
// packages/cli/src/commands/server/iac/__tests__/integration.test.ts

import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

const server = setupServer(
  // Mock GET /guilds/{guild_id}/roles
  http.get('https://discord.com/api/v10/guilds/:guildId/roles', () => {
    return HttpResponse.json([
      {
        id: '123',
        name: 'Holder',
        color: 16766720,
        permissions: '1024',
        position: 1,
        hoist: true,
        mentionable: true,
      },
    ]);
  }),

  // Mock POST /guilds/{guild_id}/roles
  http.post('https://discord.com/api/v10/guilds/:guildId/roles', async ({ request }) => {
    const body = await request.json();
    return HttpResponse.json({
      id: '456',
      name: body.name,
      color: body.color,
      permissions: body.permissions,
      position: body.position ?? 0,
      hoist: body.hoist ?? false,
      mentionable: body.mentionable ?? false,
    });
  }),
);

beforeAll(() => server.listen());
afterAll(() => server.close());

describe('IaC Integration', () => {
  it('should apply configuration to Discord', async () => {
    // Test full flow: parse config → fetch state → diff → apply
    // Assertions on final state
  });
});
```

### 10.4 E2E Tests

**Goal**: Test against real Discord API (test server)

**Approach**: Create dedicated test Discord server, run commands, verify results

```typescript
// packages/cli/src/commands/server/iac/__tests__/e2e.test.ts

import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';

describe('E2E: Discord IaC', () => {
  const testGuildId = process.env.TEST_GUILD_ID;
  const botToken = process.env.DISCORD_BOT_TOKEN;

  it('should apply config to real Discord server', () => {
    if (!testGuildId || !botToken) {
      console.log('Skipping E2E test (no TEST_GUILD_ID or DISCORD_BOT_TOKEN)');
      return;
    }

    // Run CLI command
    const result = execSync(
      `DISCORD_BOT_TOKEN=${botToken} gaib server init ${testGuildId} --config test-fixtures/server.yaml --json`,
      { encoding: 'utf-8' }
    );

    const output = JSON.parse(result);
    expect(output.success).toBe(true);
    expect(output.created.roles).toBeGreaterThan(0);
  });
});
```

---

## 11. Implementation Plan

### 11.1 Sprint Breakdown

**Total Estimate**: 3-4 weeks (3 sprints)

#### Sprint 1: Foundation & Core Logic (Week 1)

**Goal**: Build core components without CLI integration

**Tasks**:
1. Set up directory structure (`packages/cli/src/commands/server/iac/`)
2. Add dependencies (`js-yaml`, `zod`) to `packages/cli/package.json`
3. Define Zod schemas (`schemas.ts`)
4. Implement `ConfigParser` with validation
5. Implement `StateReader` (Discord API fetching)
6. Implement `DiffEngine` (diff calculation)
7. Implement `PermissionUtils` (bitfield calculations)
8. Unit tests for all core components (>80% coverage)

**Acceptance Criteria**:
- [ ] Config parsing works with validation errors
- [ ] State fetching returns structured DiscordState
- [ ] Diff calculation correctly identifies creates/updates/deletes
- [ ] All unit tests pass

#### Sprint 2: State Application & CLI Commands (Week 2)

**Goal**: Implement state application and CLI commands

**Tasks**:
1. Implement `DiscordRestClient` (bot token wrapper)
2. Implement `RateLimiter` (token bucket + cooldowns)
3. Implement `StateWriter` (apply changes to Discord)
4. Implement `ResourceTracker` (managed resource tagging)
5. Implement `RetryHandler` (exponential backoff)
6. Create CLI command group (`packages/cli/src/commands/server/index.ts`)
7. Implement `init` command (apply configuration)
8. Implement `plan` command (show planned changes)
9. Implement `diff` command (detect drift)
10. Integration tests with MSW (mock Discord API)

**Acceptance Criteria**:
- [ ] CLI commands registered and callable
- [ ] `gaib server init` applies configuration
- [ ] Rate limiting prevents Discord API errors
- [ ] Idempotent (re-running produces no changes)
- [ ] Integration tests pass

#### Sprint 3: Export, Polish, & Documentation (Week 3)

**Goal**: Complete remaining features and polish UX

**Tasks**:
1. Implement `export` command (export current state to YAML)
2. Add colored CLI output (chalk)
3. Add progress spinners (ora)
4. Implement confirmation prompts (unless `--force`)
5. Improve error messages (validation, permissions, API errors)
6. Add `--json` output mode for all commands
7. Write user documentation (`docs/iac.md`)
8. Write developer documentation (inline comments, README)
9. E2E tests against test Discord server
10. Performance testing (large server with 50+ roles/channels)

**Acceptance Criteria**:
- [ ] Export command generates valid YAML
- [ ] CLI output is clear and helpful
- [ ] Error messages are actionable
- [ ] Documentation covers all commands and examples
- [ ] E2E tests pass against real Discord server
- [ ] Performance meets targets (<2s fetch, <60s apply)

### 11.2 Sandbox Integration (Optional Sprint 4)

**Goal**: Integrate IaC with sandbox workflow

**Tasks**:
1. Add `--config` flag to `gaib sandbox create`
2. Auto-apply config after sandbox creation
3. Store config path in sandbox metadata
4. Update sandbox documentation with IaC examples

**Acceptance Criteria**:
- [ ] `gaib sandbox create --config server.yaml` applies config
- [ ] Sandbox workflow documentation updated

---

## 12. Technical Risks & Mitigations

### 12.1 High-Priority Risks

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| **Discord API Rate Limits** | High - Blocks operations | Medium | Proactive rate limiting, exponential backoff, progress feedback |
| **Partial Application Failures** | High - Inconsistent state | Medium | Retry logic, idempotent design, manual recovery docs |
| **Role Hierarchy Constraints** | Medium - Apply fails | High | Dependency ordering (categories → roles → channels), retry with reordering |
| **Permission Conflicts** | Medium - Unexpected behavior | Medium | Validate config before applying, warn on conflicts |
| **Large Server Performance** | Medium - Slow operations | Low | Pagination, parallel API calls where safe, progress feedback |

### 12.2 Medium-Priority Risks

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| **Config Complexity** | Medium - User errors | High | Schema validation, helpful error messages, examples, templates |
| **Name-Based Identification Issues** | Medium - Mismatched resources | Medium | Managed resource tagging, export command for baseline |
| **Discord API Changes** | Medium - Breaking changes | Low | Pin API version (v10), monitor Discord changelog, version config schema |
| **Bot Token Security** | High - Compromised bot | Low | Environment variable only, never log, document security best practices |

### 12.3 Risk Mitigation Summary

**Proactive Mitigations**:
1. **Rate Limiting**: Token bucket + cooldown tracking
2. **Idempotency**: Careful diff logic, skip no-op updates
3. **Validation**: Zod schemas + constraint checks
4. **Error Recovery**: Retry logic + helpful error messages
5. **Documentation**: Comprehensive examples + troubleshooting guide

**Reactive Mitigations**:
1. **Monitoring**: Log all API calls and errors
2. **User Feedback**: Collect issues, improve error messages
3. **Iteration**: Start with MVP, add features based on usage

---

## 13. Non-Functional Requirements

### 13.1 Performance Targets

| Metric | Target | Measurement |
|--------|--------|-------------|
| **Config Parsing** | <100ms | CLI startup time |
| **State Fetching** (50 roles, 50 channels) | <2 seconds | API latency |
| **Diff Calculation** | <500ms | In-memory computation |
| **Small Apply** (5 operations) | <10 seconds | End-to-end CLI time |
| **Large Apply** (50 operations) | <60 seconds | End-to-end CLI time |

### 13.2 Reliability Targets

| Metric | Target | Measurement |
|--------|--------|-------------|
| **Idempotency** | 100% | Re-run produces 0 changes |
| **Rate Limit Handling** | 100% | No unhandled 429 errors |
| **Config Validation** | 100% | Catch errors before applying |
| **Unmanaged Resource Preservation** | 100% | Never delete unmanaged resources |

### 13.3 Usability Targets

| Metric | Target | Measurement |
|--------|--------|-------------|
| **Time to First Success** | <5 minutes | From README to first apply |
| **Error Message Clarity** | >90% actionable | User feedback |
| **Documentation Coverage** | 100% | All commands documented with examples |

---

## 14. Future Enhancements (Phase 2+)

### 14.1 Phase 2 Features (Near-Term)

1. **Webhooks**: Create and manage webhooks in config
2. **Voice Channel Settings**: Bitrate, user limit
3. **Stage Channels**: Stage channel type support
4. **Forum Channels**: Forum channel type support
5. **Destroy Command**: `gaib server destroy` removes managed resources
6. **Automatic Rollback**: Rollback on failure (requires state tracking)
7. **Config Templates**: Library of common server configurations
8. **Watch Mode**: Auto-apply on config file changes

### 14.2 Phase 3 Features (Future)

1. **Server Templates Marketplace**: Community-shared configs
2. **Multi-Server Orchestration**: Manage multiple servers from one config
3. **CI/CD Integration**: GitHub Actions workflow for config validation
4. **Terraform Provider**: Full Terraform integration
5. **Advanced Audit Trail**: Database-backed audit log with revert capability
6. **Drift Auto-Remediation**: Automatically fix drift on detection

---

## Appendix A: Key Design Decisions Log

| Decision | Date | Rationale | Alternatives Considered |
|----------|------|-----------|-------------------------|
| **Use Zod for validation** | 2026-01-18 | Already installed, better TypeScript integration | AJV (more standards-compliant but separate types) |
| **Name-based resource matching** | 2026-01-18 | Human-readable, survives Discord ID changes | Discord IDs (brittle, not readable) |
| **Metadata tagging for managed resources** | 2026-01-18 | Lightweight, survives state file loss | State file (requires maintenance), External DB (too complex) |
| **No automatic rollback in MVP** | 2026-01-18 | Complex to implement correctly, manual recovery sufficient | Transaction log + rollback (Phase 2) |
| **Discord API as source of truth** | 2026-01-18 | Always synchronized, no state drift | Local state file (Terraform-style, more complex) |
| **Proactive rate limiting** | 2026-01-18 | Predictable performance, avoids 429 errors | Reactive only (poor UX) |

---

## Appendix B: Configuration Examples

### B.1 Minimal Config

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

### B.2 Token-Gated Community Config

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

### B.3 Development/Staging Config

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

## Document History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2026-01-18 | Claude (designing-architecture) | Initial SDD creation |

---

**Sources Referenced**:
- PRD: `grimoires/loa/discord-iac-prd.md`
- DiscordRest Service: `apps/worker/src/services/DiscordRest.ts`
- CLI Architecture: `packages/cli/src/bin/gaib.ts`, `packages/cli/src/commands/sandbox/`
- Discord API Types: `discord-api-types` v0.37.100
- Commander.js Documentation
- Zod Documentation

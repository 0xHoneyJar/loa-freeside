/**
 * Internal State Representation Types
 *
 * Sprint 91: Discord Infrastructure-as-Code - Config Parsing & State Reading
 *
 * Defines the internal representation of Discord server state.
 * These types bridge between YAML config and Discord API responses.
 *
 * @see SDD grimoires/loa/discord-iac-sdd.md §5.2
 * @module packages/cli/commands/server/iac/types
 */

import type { PermissionFlag, ChannelType } from './schemas.js';

// ============================================================================
// Resource Identifiers
// ============================================================================

/**
 * Discord snowflake ID (string format)
 */
export type Snowflake = string;

/**
 * Resource identifier that can be used to match config to Discord state
 */
export interface ResourceIdentifier {
  /** Name from config (primary identifier) */
  name: string;
  /** Discord ID if known (from existing resource) */
  id?: Snowflake;
}

// ============================================================================
// Role State
// ============================================================================

/**
 * Internal representation of a Discord role
 */
export interface RoleState {
  /** Discord role ID */
  id: Snowflake;
  /** Role name */
  name: string;
  /** Role color as hex string (#RRGGBB) */
  color: string;
  /** Whether role is displayed separately in member list */
  hoist: boolean;
  /** Whether role can be @mentioned */
  mentionable: boolean;
  /** Role permissions as array of flags */
  permissions: PermissionFlag[];
  /** Position in role hierarchy */
  position: number;
  /** Whether this role is managed by an integration */
  managed: boolean;
  /** Whether this is the @everyone role */
  isEveryone: boolean;
  /** Whether this role is managed by IaC */
  isIacManaged: boolean;
}

// ============================================================================
// Category State
// ============================================================================

/**
 * Internal representation of a Discord category
 */
export interface CategoryState {
  /** Discord channel ID */
  id: Snowflake;
  /** Category name */
  name: string;
  /** Position in channel list */
  position: number;
  /** Permission overwrites */
  permissionOverwrites: PermissionOverwriteState[];
  /** Whether this category is managed by IaC */
  isIacManaged: boolean;
}

// ============================================================================
// Channel State
// ============================================================================

/**
 * Internal representation of a Discord channel
 */
export interface ChannelState {
  /** Discord channel ID */
  id: Snowflake;
  /** Channel name */
  name: string;
  /** Channel type */
  type: ChannelType;
  /** Parent category ID (if in a category) */
  parentId?: Snowflake;
  /** Parent category name (resolved) */
  parentName?: string;
  /** Channel topic/description */
  topic?: string;
  /** Whether channel is NSFW */
  nsfw: boolean;
  /** Slowmode delay in seconds */
  slowmode: number;
  /** Position within category or root */
  position: number;
  /** Permission overwrites */
  permissionOverwrites: PermissionOverwriteState[];
  /** Voice channel: bitrate in bps */
  bitrate?: number;
  /** Voice channel: user limit */
  userLimit?: number;
  /** Whether this channel is managed by IaC */
  isIacManaged: boolean;
}

// ============================================================================
// Permission Overwrite State
// ============================================================================

/**
 * Type of permission overwrite target
 */
export type OverwriteType = 'role' | 'member';

/**
 * Internal representation of a permission overwrite
 */
export interface PermissionOverwriteState {
  /** Target ID (role or member ID) */
  id: Snowflake;
  /** Target name (resolved role name or member username) */
  name: string;
  /** Type of overwrite target */
  type: OverwriteType;
  /** Allowed permissions */
  allow: PermissionFlag[];
  /** Denied permissions */
  deny: PermissionFlag[];
}

// ============================================================================
// Server State
// ============================================================================

/**
 * Complete internal representation of a Discord server's IaC-relevant state
 */
export interface ServerState {
  /** Server (guild) ID */
  id: Snowflake;
  /** Server name */
  name: string;
  /** Server description */
  description?: string;
  /** All roles (including @everyone and managed roles) */
  roles: RoleState[];
  /** All categories */
  categories: CategoryState[];
  /** All channels (excluding categories) */
  channels: ChannelState[];
  /** Timestamp when state was fetched */
  fetchedAt: Date;
}

// ============================================================================
// Diff Types
// ============================================================================

/**
 * Type of change operation
 */
export type ChangeOperation = 'create' | 'update' | 'delete' | 'noop';

/**
 * Base interface for resource changes
 */
export interface ResourceChange<T> {
  /** Type of change */
  operation: ChangeOperation;
  /** Resource name */
  name: string;
  /** Current state (undefined if creating) */
  current?: T;
  /** Desired state (undefined if deleting) */
  desired?: T;
  /** Specific field changes (for updates) */
  changes?: FieldChange[];
}

/**
 * Change to a specific field
 */
export interface FieldChange {
  /** Field name */
  field: string;
  /** Current value */
  from: unknown;
  /** Desired value */
  to: unknown;
}

/**
 * Role-specific change
 */
export type RoleChange = ResourceChange<RoleState>;

/**
 * Category-specific change
 */
export type CategoryChange = ResourceChange<CategoryState>;

/**
 * Channel-specific change
 */
export type ChannelChange = ResourceChange<ChannelState>;

/**
 * Complete diff between desired config and current state
 */
export interface ServerDiff {
  /** Server ID */
  guildId: Snowflake;
  /** Whether any changes are needed */
  hasChanges: boolean;
  /** Summary of change counts */
  summary: DiffSummary;
  /** Role changes */
  roles: RoleChange[];
  /** Category changes (applied before channels) */
  categories: CategoryChange[];
  /** Channel changes */
  channels: ChannelChange[];
  /** Permission overwrite changes (applied after channels) */
  permissions: PermissionChange[];
}

/**
 * Summary of changes
 */
export interface DiffSummary {
  /** Total changes */
  total: number;
  /** Resources to create */
  create: number;
  /** Resources to update */
  update: number;
  /** Resources to delete */
  delete: number;
  /** Resources unchanged */
  noop: number;
}

/**
 * Permission overwrite change
 */
export interface PermissionChange {
  /** Change operation */
  operation: ChangeOperation;
  /** Channel or category ID */
  targetId: Snowflake;
  /** Channel or category name */
  targetName: string;
  /** Target type */
  targetType: 'channel' | 'category';
  /** Role or member ID */
  subjectId: Snowflake;
  /** Role or member name */
  subjectName: string;
  /** Subject type */
  subjectType: OverwriteType;
  /** Current permissions */
  current?: { allow: PermissionFlag[]; deny: PermissionFlag[] };
  /** Desired permissions */
  desired?: { allow: PermissionFlag[]; deny: PermissionFlag[] };
}

// ============================================================================
// Apply Result Types
// ============================================================================

/**
 * Result of applying a single change
 */
export interface ApplyResult {
  /** Whether the change succeeded */
  success: boolean;
  /** Operation attempted */
  operation: ChangeOperation;
  /** Resource type */
  resourceType: 'role' | 'category' | 'channel' | 'permission';
  /** Resource name */
  resourceName: string;
  /** New Discord ID (if created) */
  newId?: Snowflake;
  /** Error message (if failed) */
  error?: string;
  /** Time taken in milliseconds */
  durationMs: number;
}

/**
 * Result of applying all changes
 */
export interface ApplyBatchResult {
  /** Whether all changes succeeded */
  success: boolean;
  /** Individual results */
  results: ApplyResult[];
  /** Summary */
  summary: {
    total: number;
    succeeded: number;
    failed: number;
  };
  /** Total time taken in milliseconds */
  totalDurationMs: number;
}

// ============================================================================
// Utility Types
// ============================================================================

/**
 * Map of role names to Discord IDs
 */
export type RoleNameMap = Map<string, Snowflake>;

/**
 * Map of category names to Discord IDs
 */
export type CategoryNameMap = Map<string, Snowflake>;

/**
 * Map of channel names to Discord IDs
 */
export type ChannelNameMap = Map<string, Snowflake>;

/**
 * Combined name-to-ID mappings for all resources
 */
export interface ResourceMappings {
  roles: RoleNameMap;
  categories: CategoryNameMap;
  channels: ChannelNameMap;
}

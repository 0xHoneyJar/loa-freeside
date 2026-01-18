/**
 * State Reader - Discord Server State Fetching
 *
 * Sprint 91: Discord Infrastructure-as-Code - Config Parsing & State Reading
 *
 * Fetches current Discord server state and converts it to internal representation.
 * Maps Discord API responses to IaC state types.
 *
 * @see SDD grimoires/loa/discord-iac-sdd.md §4.2
 * @module packages/cli/commands/server/iac/StateReader
 */

import type { APIChannel, APIRole, APIOverwrite } from 'discord-api-types/v10';
import { ChannelType as DiscordChannelType, OverwriteType } from 'discord-api-types/v10';
import {
  DiscordClient,
  type RawGuildData,
  mapChannelType,
  isCategory,
} from './DiscordClient.js';
import {
  bitfieldToPermissions,
  intToColor,
  isManaged,
  type PermissionFlag,
  type ChannelType,
} from './schemas.js';
import type {
  ServerState,
  RoleState,
  CategoryState,
  ChannelState,
  PermissionOverwriteState,
  Snowflake,
  OverwriteType as IacOverwriteType,
} from './types.js';

// ============================================================================
// State Reader
// ============================================================================

/**
 * Options for reading server state
 */
export interface ReadOptions {
  /** Whether to include unmanaged resources (default: true) */
  includeUnmanaged?: boolean;
  /** Whether to include managed roles like bot roles (default: false) */
  includeManagedRoles?: boolean;
}

/**
 * Read the current state of a Discord server
 *
 * @param client - Discord API client
 * @param guildId - Discord guild ID
 * @param options - Reading options
 * @returns Current server state
 */
export async function readServerState(
  client: DiscordClient,
  guildId: Snowflake,
  options: ReadOptions = {}
): Promise<ServerState> {
  const { includeUnmanaged = true, includeManagedRoles = false } = options;

  // Fetch raw data from Discord
  const rawData = await client.fetchGuildData(guildId);

  // Build role name -> ID map for resolving permission overwrites
  const roleMap = new Map<Snowflake, string>();
  for (const role of rawData.roles) {
    roleMap.set(role.id, role.name);
  }

  // Convert roles
  const roles = convertRoles(rawData.roles, guildId, includeManagedRoles);

  // Separate categories from other channels
  const rawCategories = rawData.channels.filter(isCategory);
  const rawChannels = rawData.channels.filter((ch) => !isCategory(ch));

  // Build category ID -> name map
  const categoryMap = new Map<Snowflake, string>();
  for (const cat of rawCategories) {
    categoryMap.set(cat.id, cat.name);
  }

  // Convert categories
  const categories = convertCategories(rawCategories, roleMap);

  // Convert channels
  const channels = convertChannels(rawChannels, roleMap, categoryMap);

  // Filter by managed status if requested
  const filteredRoles = includeUnmanaged
    ? roles
    : roles.filter((r) => r.isIacManaged || r.isEveryone);
  const filteredCategories = includeUnmanaged
    ? categories
    : categories.filter((c) => c.isIacManaged);
  const filteredChannels = includeUnmanaged
    ? channels
    : channels.filter((c) => c.isIacManaged);

  return {
    id: guildId,
    name: rawData.guild.name,
    description: rawData.guild.description ?? undefined,
    roles: filteredRoles,
    categories: filteredCategories,
    channels: filteredChannels,
    fetchedAt: new Date(),
  };
}

// ============================================================================
// Role Conversion
// ============================================================================

/**
 * Convert Discord API roles to internal state
 */
function convertRoles(
  apiRoles: APIRole[],
  guildId: Snowflake,
  includeManagedRoles: boolean
): RoleState[] {
  return apiRoles
    .filter((role) => {
      // Always exclude managed roles (bots, integrations) unless requested
      if (role.managed && !includeManagedRoles) {
        return false;
      }
      return true;
    })
    .map((role) => ({
      id: role.id,
      name: role.name,
      color: intToColor(role.color),
      hoist: role.hoist,
      mentionable: role.mentionable,
      permissions: bitfieldToPermissions(role.permissions),
      position: role.position,
      managed: role.managed,
      isEveryone: role.id === guildId, // @everyone role has same ID as guild
      isIacManaged: isManaged(role.description ?? undefined),
    }))
    .sort((a, b) => b.position - a.position); // Sort by position descending (highest first)
}

// ============================================================================
// Category Conversion
// ============================================================================

/**
 * Convert Discord API categories to internal state
 */
function convertCategories(
  apiCategories: APIChannel[],
  roleMap: Map<Snowflake, string>
): CategoryState[] {
  return apiCategories
    .filter((ch): ch is APIChannel & { type: DiscordChannelType.GuildCategory } =>
      ch.type === DiscordChannelType.GuildCategory
    )
    .map((category) => ({
      id: category.id,
      name: category.name ?? 'Unnamed Category',
      position: category.position ?? 0,
      permissionOverwrites: convertPermissionOverwrites(
        category.permission_overwrites ?? [],
        roleMap
      ),
      isIacManaged: isManaged('topic' in category ? (category as unknown as { topic?: string }).topic : undefined),
    }))
    .sort((a, b) => a.position - b.position);
}

// ============================================================================
// Channel Conversion
// ============================================================================

/**
 * Convert Discord API channels to internal state
 */
function convertChannels(
  apiChannels: APIChannel[],
  roleMap: Map<Snowflake, string>,
  categoryMap: Map<Snowflake, string>
): ChannelState[] {
  return apiChannels
    .filter((ch) => {
      // Only include supported channel types
      const iacType = mapChannelType(ch.type);
      return iacType !== null;
    })
    .map((channel) => {
      const iacType = mapChannelType(channel.type) as ChannelType;
      const parentId = 'parent_id' in channel ? (channel.parent_id as Snowflake | undefined) : undefined;

      const state: ChannelState = {
        id: channel.id,
        name: channel.name ?? 'unnamed-channel',
        type: iacType,
        parentId,
        parentName: parentId ? categoryMap.get(parentId) : undefined,
        topic: 'topic' in channel ? (channel.topic ?? undefined) : undefined,
        nsfw: 'nsfw' in channel ? (channel.nsfw ?? false) : false,
        slowmode: 'rate_limit_per_user' in channel ? (channel.rate_limit_per_user ?? 0) : 0,
        position: channel.position ?? 0,
        permissionOverwrites: convertPermissionOverwrites(
          'permission_overwrites' in channel ? (channel.permission_overwrites ?? []) : [],
          roleMap
        ),
        isIacManaged: isManaged('topic' in channel ? (channel.topic ?? undefined) : undefined),
      };

      // Voice channel specific fields
      if ('bitrate' in channel && channel.bitrate) {
        state.bitrate = channel.bitrate;
      }
      if ('user_limit' in channel && channel.user_limit !== undefined) {
        state.userLimit = channel.user_limit;
      }

      return state;
    })
    .sort((a, b) => a.position - b.position);
}

// ============================================================================
// Permission Overwrite Conversion
// ============================================================================

/**
 * Convert Discord API permission overwrites to internal state
 */
function convertPermissionOverwrites(
  apiOverwrites: APIOverwrite[],
  roleMap: Map<Snowflake, string>
): PermissionOverwriteState[] {
  return apiOverwrites.map((overwrite) => {
    const type: IacOverwriteType = overwrite.type === OverwriteType.Role ? 'role' : 'member';
    const name =
      type === 'role'
        ? roleMap.get(overwrite.id) ?? 'Unknown Role'
        : `Member:${overwrite.id}`;

    return {
      id: overwrite.id,
      name,
      type,
      allow: bitfieldToPermissions(overwrite.allow),
      deny: bitfieldToPermissions(overwrite.deny),
    };
  });
}

// ============================================================================
// State Comparison Utilities
// ============================================================================

/**
 * Find a role by name in the state (case-insensitive)
 */
export function findRoleByName(
  state: ServerState,
  name: string
): RoleState | undefined {
  const lowerName = name.toLowerCase();
  return state.roles.find((r) => r.name.toLowerCase() === lowerName);
}

/**
 * Find a category by name in the state (case-insensitive)
 */
export function findCategoryByName(
  state: ServerState,
  name: string
): CategoryState | undefined {
  const lowerName = name.toLowerCase();
  return state.categories.find((c) => c.name.toLowerCase() === lowerName);
}

/**
 * Find a channel by name in the state (case-insensitive)
 */
export function findChannelByName(
  state: ServerState,
  name: string
): ChannelState | undefined {
  const lowerName = name.toLowerCase();
  return state.channels.find((c) => c.name.toLowerCase() === lowerName);
}

/**
 * Get the @everyone role from state
 */
export function getEveryoneRole(state: ServerState): RoleState | undefined {
  return state.roles.find((r) => r.isEveryone);
}

/**
 * Get all IaC-managed resources
 */
export function getManagedResources(state: ServerState): {
  roles: RoleState[];
  categories: CategoryState[];
  channels: ChannelState[];
} {
  return {
    roles: state.roles.filter((r) => r.isIacManaged),
    categories: state.categories.filter((c) => c.isIacManaged),
    channels: state.channels.filter((c) => c.isIacManaged),
  };
}

/**
 * Build resource name mappings from state
 */
export function buildResourceMappings(state: ServerState): {
  roles: Map<string, Snowflake>;
  categories: Map<string, Snowflake>;
  channels: Map<string, Snowflake>;
} {
  const roles = new Map<string, Snowflake>();
  const categories = new Map<string, Snowflake>();
  const channels = new Map<string, Snowflake>();

  for (const role of state.roles) {
    roles.set(role.name.toLowerCase(), role.id);
  }

  for (const category of state.categories) {
    categories.set(category.name.toLowerCase(), category.id);
  }

  for (const channel of state.channels) {
    channels.set(channel.name.toLowerCase(), channel.id);
  }

  return { roles, categories, channels };
}

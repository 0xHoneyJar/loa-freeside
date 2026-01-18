/**
 * Discord IaC Configuration Schemas
 *
 * Sprint 91: Discord Infrastructure-as-Code - Config Parsing & State Reading
 *
 * Zod schemas for validating YAML configuration files.
 * Defines the structure for roles, channels, categories, and permissions.
 *
 * @see PRD grimoires/loa/discord-iac-prd.md §4.2
 * @see SDD grimoires/loa/discord-iac-sdd.md §5
 * @module packages/cli/commands/server/iac/schemas
 */

import { z } from 'zod';

// ============================================================================
// Permission Definitions
// ============================================================================

/**
 * Discord permission flags supported in IaC configs.
 * These map to Discord's permission bitfield values.
 *
 * @see https://discord.com/developers/docs/topics/permissions#permissions-bitwise-permission-flags
 */
export const PermissionFlag = z.enum([
  // General permissions
  'CREATE_INSTANT_INVITE',
  'KICK_MEMBERS',
  'BAN_MEMBERS',
  'ADMINISTRATOR',
  'MANAGE_CHANNELS',
  'MANAGE_GUILD',
  'ADD_REACTIONS',
  'VIEW_AUDIT_LOG',
  'PRIORITY_SPEAKER',
  'STREAM',
  'VIEW_CHANNEL',
  'SEND_MESSAGES',
  'SEND_TTS_MESSAGES',
  'MANAGE_MESSAGES',
  'EMBED_LINKS',
  'ATTACH_FILES',
  'READ_MESSAGE_HISTORY',
  'MENTION_EVERYONE',
  'USE_EXTERNAL_EMOJIS',
  'VIEW_GUILD_INSIGHTS',
  'CONNECT',
  'SPEAK',
  'MUTE_MEMBERS',
  'DEAFEN_MEMBERS',
  'MOVE_MEMBERS',
  'USE_VAD',
  'CHANGE_NICKNAME',
  'MANAGE_NICKNAMES',
  'MANAGE_ROLES',
  'MANAGE_WEBHOOKS',
  'MANAGE_GUILD_EXPRESSIONS',
  'USE_APPLICATION_COMMANDS',
  'REQUEST_TO_SPEAK',
  'MANAGE_EVENTS',
  'MANAGE_THREADS',
  'CREATE_PUBLIC_THREADS',
  'CREATE_PRIVATE_THREADS',
  'USE_EXTERNAL_STICKERS',
  'SEND_MESSAGES_IN_THREADS',
  'USE_EMBEDDED_ACTIVITIES',
  'MODERATE_MEMBERS',
  'VIEW_CREATOR_MONETIZATION_ANALYTICS',
  'USE_SOUNDBOARD',
  'USE_EXTERNAL_SOUNDS',
  'SEND_VOICE_MESSAGES',
]);

export type PermissionFlag = z.infer<typeof PermissionFlag>;

/**
 * Discord permission bitfield values
 */
export const PERMISSION_FLAGS: Record<PermissionFlag, bigint> = {
  CREATE_INSTANT_INVITE: 1n << 0n,
  KICK_MEMBERS: 1n << 1n,
  BAN_MEMBERS: 1n << 2n,
  ADMINISTRATOR: 1n << 3n,
  MANAGE_CHANNELS: 1n << 4n,
  MANAGE_GUILD: 1n << 5n,
  ADD_REACTIONS: 1n << 6n,
  VIEW_AUDIT_LOG: 1n << 7n,
  PRIORITY_SPEAKER: 1n << 8n,
  STREAM: 1n << 9n,
  VIEW_CHANNEL: 1n << 10n,
  SEND_MESSAGES: 1n << 11n,
  SEND_TTS_MESSAGES: 1n << 12n,
  MANAGE_MESSAGES: 1n << 13n,
  EMBED_LINKS: 1n << 14n,
  ATTACH_FILES: 1n << 15n,
  READ_MESSAGE_HISTORY: 1n << 16n,
  MENTION_EVERYONE: 1n << 17n,
  USE_EXTERNAL_EMOJIS: 1n << 18n,
  VIEW_GUILD_INSIGHTS: 1n << 19n,
  CONNECT: 1n << 20n,
  SPEAK: 1n << 21n,
  MUTE_MEMBERS: 1n << 22n,
  DEAFEN_MEMBERS: 1n << 23n,
  MOVE_MEMBERS: 1n << 24n,
  USE_VAD: 1n << 25n,
  CHANGE_NICKNAME: 1n << 26n,
  MANAGE_NICKNAMES: 1n << 27n,
  MANAGE_ROLES: 1n << 28n,
  MANAGE_WEBHOOKS: 1n << 29n,
  MANAGE_GUILD_EXPRESSIONS: 1n << 30n,
  USE_APPLICATION_COMMANDS: 1n << 31n,
  REQUEST_TO_SPEAK: 1n << 32n,
  MANAGE_EVENTS: 1n << 33n,
  MANAGE_THREADS: 1n << 34n,
  CREATE_PUBLIC_THREADS: 1n << 35n,
  CREATE_PRIVATE_THREADS: 1n << 36n,
  USE_EXTERNAL_STICKERS: 1n << 37n,
  SEND_MESSAGES_IN_THREADS: 1n << 38n,
  USE_EMBEDDED_ACTIVITIES: 1n << 39n,
  MODERATE_MEMBERS: 1n << 40n,
  VIEW_CREATOR_MONETIZATION_ANALYTICS: 1n << 41n,
  USE_SOUNDBOARD: 1n << 42n,
  USE_EXTERNAL_SOUNDS: 1n << 45n,
  SEND_VOICE_MESSAGES: 1n << 46n,
};

/**
 * Convert permission flags array to bitfield string
 */
export function permissionsToBitfield(permissions: PermissionFlag[]): string {
  let bitfield = 0n;
  for (const perm of permissions) {
    bitfield |= PERMISSION_FLAGS[perm];
  }
  return bitfield.toString();
}

/**
 * Convert bitfield string to permission flags array
 */
export function bitfieldToPermissions(bitfield: string): PermissionFlag[] {
  const flags: PermissionFlag[] = [];
  const value = BigInt(bitfield);
  for (const [name, bit] of Object.entries(PERMISSION_FLAGS)) {
    if ((value & bit) === bit) {
      flags.push(name as PermissionFlag);
    }
  }
  return flags;
}

// ============================================================================
// Color Schema
// ============================================================================

/**
 * Discord color in hex format (#RRGGBB or #RGB)
 */
export const ColorSchema = z
  .string()
  .regex(/^#([0-9A-Fa-f]{6}|[0-9A-Fa-f]{3})$/, 'Color must be in hex format (#RRGGBB or #RGB)')
  .transform((color) => {
    // Normalize to 6-digit hex
    if (color.length === 4) {
      return `#${color[1]}${color[1]}${color[2]}${color[2]}${color[3]}${color[3]}`;
    }
    return color.toUpperCase();
  });

/**
 * Convert hex color to Discord integer format
 */
export function colorToInt(hex: string): number {
  return parseInt(hex.replace('#', ''), 16);
}

/**
 * Convert Discord integer color to hex format
 */
export function intToColor(value: number): string {
  return `#${value.toString(16).padStart(6, '0').toUpperCase()}`;
}

// ============================================================================
// Channel Types
// ============================================================================

/**
 * Supported channel types in IaC configs
 */
export const ChannelType = z.enum([
  'text',
  'voice',
  'announcement',
  'stage',
  'forum',
]);

export type ChannelType = z.infer<typeof ChannelType>;

/**
 * Discord API channel type values
 */
export const CHANNEL_TYPES: Record<ChannelType, number> = {
  text: 0,
  voice: 2,
  announcement: 5,
  stage: 13,
  forum: 15,
};

// ============================================================================
// Permission Overwrite Schema
// ============================================================================

/**
 * Permission overwrite for a channel
 * Can allow or deny specific permissions for a role or member
 */
export const PermissionOverwriteSchema = z.object({
  allow: z.array(PermissionFlag).optional().default([]),
  deny: z.array(PermissionFlag).optional().default([]),
});

export type PermissionOverwrite = z.infer<typeof PermissionOverwriteSchema>;

/**
 * Channel permissions mapping (role name or @everyone -> overwrite)
 */
export const ChannelPermissionsSchema = z.record(
  z.string().min(1, 'Role name cannot be empty'),
  PermissionOverwriteSchema
);

export type ChannelPermissions = z.infer<typeof ChannelPermissionsSchema>;

// ============================================================================
// Role Schema
// ============================================================================

/**
 * Role definition in IaC config
 */
export const RoleSchema = z.object({
  /** Role name (unique identifier in config) */
  name: z
    .string()
    .min(1, 'Role name cannot be empty')
    .max(100, 'Role name must be 100 characters or less'),

  /** Role color in hex format */
  color: ColorSchema.optional(),

  /** Whether the role is displayed separately in the member list */
  hoist: z.boolean().optional().default(false),

  /** Whether the role can be @mentioned */
  mentionable: z.boolean().optional().default(false),

  /** Role permissions (array of permission flags) */
  permissions: z.array(PermissionFlag).optional().default([]),

  /** Position in role hierarchy (higher = more power). Auto-assigned if not specified. */
  position: z.number().int().nonnegative().optional(),
});

export type RoleConfig = z.infer<typeof RoleSchema>;

// ============================================================================
// Category Schema
// ============================================================================

/**
 * Category definition in IaC config
 */
export const CategorySchema = z.object({
  /** Category name (unique identifier in config) */
  name: z
    .string()
    .min(1, 'Category name cannot be empty')
    .max(100, 'Category name must be 100 characters or less'),

  /** Position in the channel list (0 = top) */
  position: z.number().int().nonnegative().optional(),

  /** Category-level permission overwrites */
  permissions: ChannelPermissionsSchema.optional(),
});

export type CategoryConfig = z.infer<typeof CategorySchema>;

// ============================================================================
// Channel Schema
// ============================================================================

/**
 * Channel definition in IaC config
 */
export const ChannelSchema = z.object({
  /** Channel name (unique identifier in config) */
  name: z
    .string()
    .min(1, 'Channel name cannot be empty')
    .max(100, 'Channel name must be 100 characters or less')
    .regex(
      /^[a-z0-9-_]+$/,
      'Channel name must be lowercase and contain only letters, numbers, hyphens, and underscores'
    ),

  /** Channel type */
  type: ChannelType.optional().default('text'),

  /** Parent category name (must match a category in the config) */
  category: z.string().optional(),

  /** Channel topic/description */
  topic: z.string().max(1024, 'Topic must be 1024 characters or less').optional(),

  /** Whether the channel is NSFW */
  nsfw: z.boolean().optional().default(false),

  /** Slowmode delay in seconds (0 = disabled) */
  slowmode: z.number().int().min(0).max(21600).optional().default(0),

  /** Position within the category */
  position: z.number().int().nonnegative().optional(),

  /** Channel-level permission overwrites */
  permissions: ChannelPermissionsSchema.optional(),

  /** Voice channel: bitrate in bps (8000-384000) */
  bitrate: z.number().int().min(8000).max(384000).optional(),

  /** Voice channel: user limit (0 = unlimited, max 99) */
  userLimit: z.number().int().min(0).max(99).optional(),
});

export type ChannelConfig = z.infer<typeof ChannelSchema>;

// ============================================================================
// Server Config Schema
// ============================================================================

/**
 * Server metadata in IaC config
 */
export const ServerMetadataSchema = z.object({
  /** Server name (optional - won't change existing name if not specified) */
  name: z.string().min(2).max(100).optional(),

  /** Server description */
  description: z.string().max(120).optional(),
});

export type ServerMetadata = z.infer<typeof ServerMetadataSchema>;

/**
 * Top-level server configuration schema
 */
export const ServerConfigSchema = z
  .object({
    /** Config schema version */
    version: z.literal('1'),

    /** Server metadata (optional) */
    server: ServerMetadataSchema.optional(),

    /** Role definitions */
    roles: z.array(RoleSchema).optional().default([]),

    /** Category definitions */
    categories: z.array(CategorySchema).optional().default([]),

    /** Channel definitions */
    channels: z.array(ChannelSchema).optional().default([]),
  })
  .superRefine((config, ctx) => {
    // Validate unique role names
    const roleNames = new Set<string>();
    for (const role of config.roles) {
      if (roleNames.has(role.name.toLowerCase())) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate role name: "${role.name}"`,
          path: ['roles'],
        });
      }
      roleNames.add(role.name.toLowerCase());
    }

    // Validate unique category names
    const categoryNames = new Set<string>();
    for (const category of config.categories) {
      if (categoryNames.has(category.name.toLowerCase())) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate category name: "${category.name}"`,
          path: ['categories'],
        });
      }
      categoryNames.add(category.name.toLowerCase());
    }

    // Validate unique channel names
    const channelNames = new Set<string>();
    for (const channel of config.channels) {
      if (channelNames.has(channel.name.toLowerCase())) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate channel name: "${channel.name}"`,
          path: ['channels'],
        });
      }
      channelNames.add(channel.name.toLowerCase());
    }

    // Validate channel category references
    for (const channel of config.channels) {
      if (channel.category && !categoryNames.has(channel.category.toLowerCase())) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Channel "${channel.name}" references unknown category: "${channel.category}"`,
          path: ['channels'],
        });
      }
    }

    // Validate permission role references in channels
    for (const channel of config.channels) {
      if (channel.permissions) {
        for (const roleName of Object.keys(channel.permissions)) {
          if (
            roleName !== '@everyone' &&
            !roleNames.has(roleName.toLowerCase())
          ) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `Channel "${channel.name}" references unknown role in permissions: "${roleName}"`,
              path: ['channels'],
            });
          }
        }
      }
    }

    // Validate permission role references in categories
    for (const category of config.categories) {
      if (category.permissions) {
        for (const roleName of Object.keys(category.permissions)) {
          if (
            roleName !== '@everyone' &&
            !roleNames.has(roleName.toLowerCase())
          ) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `Category "${category.name}" references unknown role in permissions: "${roleName}"`,
              path: ['categories'],
            });
          }
        }
      }
    }
  });

export type ServerConfig = z.infer<typeof ServerConfigSchema>;

// ============================================================================
// Managed Resource Marker
// ============================================================================

/**
 * Marker added to resource descriptions to track managed resources
 */
export const MANAGED_MARKER = '[managed-by:arrakis-iac]';

/**
 * Check if a description indicates a managed resource
 */
export function isManaged(description: string | null | undefined): boolean {
  return description?.includes(MANAGED_MARKER) ?? false;
}

/**
 * Add managed marker to a description
 */
export function addManagedMarker(description: string | undefined): string {
  if (!description) {
    return MANAGED_MARKER;
  }
  if (description.includes(MANAGED_MARKER)) {
    return description;
  }
  return `${description} ${MANAGED_MARKER}`;
}

/**
 * Remove managed marker from a description
 */
export function removeManagedMarker(description: string | undefined): string {
  if (!description) {
    return '';
  }
  return description.replace(MANAGED_MARKER, '').trim();
}

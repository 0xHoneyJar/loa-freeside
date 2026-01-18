/**
 * Discord Infrastructure-as-Code Module
 *
 * Sprint 91: Discord Infrastructure-as-Code - Config Parsing & State Reading
 *
 * Exports all IaC components for managing Discord server configuration
 * as declarative YAML files.
 *
 * @module packages/cli/commands/server/iac
 */

// Configuration parsing and validation
export {
  parseConfigFile,
  parseConfigString,
  validateConfig,
  createEmptyConfig,
  serializeConfig,
  ConfigError,
  ConfigErrorCode,
  type ParseOptions,
  type ParseResult,
  type ConfigErrorDetail,
} from './ConfigParser.js';

// Zod schemas and types
export {
  ServerConfigSchema,
  RoleSchema,
  CategorySchema,
  ChannelSchema,
  PermissionFlag,
  ChannelType,
  ColorSchema,
  PermissionOverwriteSchema,
  ChannelPermissionsSchema,
  ServerMetadataSchema,
  PERMISSION_FLAGS,
  CHANNEL_TYPES,
  MANAGED_MARKER,
  permissionsToBitfield,
  bitfieldToPermissions,
  colorToInt,
  intToColor,
  isManaged,
  addManagedMarker,
  removeManagedMarker,
  type ServerConfig,
  type RoleConfig,
  type CategoryConfig,
  type ChannelConfig,
  type PermissionOverwrite,
  type ChannelPermissions,
  type ServerMetadata,
} from './schemas.js';

// Internal state types
export type {
  Snowflake,
  ResourceIdentifier,
  ServerState,
  RoleState,
  CategoryState,
  ChannelState,
  PermissionOverwriteState,
  OverwriteType,
  ChangeOperation,
  ResourceChange,
  FieldChange,
  RoleChange,
  CategoryChange,
  ChannelChange,
  ServerDiff,
  DiffSummary,
  PermissionChange,
  ApplyResult,
  ApplyBatchResult,
  RoleNameMap,
  CategoryNameMap,
  ChannelNameMap,
  ResourceMappings,
} from './types.js';

// Discord API client
export {
  DiscordClient,
  DiscordApiError,
  DiscordErrorCode,
  createClientFromEnv,
  isCategory,
  isTextChannel,
  isVoiceChannel,
  mapChannelType,
  type DiscordClientOptions,
  type RawGuildData,
} from './DiscordClient.js';

// State reading
export {
  readServerState,
  findRoleByName,
  findCategoryByName,
  findChannelByName,
  getEveryoneRole,
  getManagedResources,
  buildResourceMappings,
  type ReadOptions,
} from './StateReader.js';

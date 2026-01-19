/**
 * Discord Infrastructure-as-Code Module
 *
 * Sprint 91: Discord Infrastructure-as-Code - Config Parsing & State Reading
 * Sprint 92: Discord Infrastructure-as-Code - Diff Calculation & State Application
 * Sprint 96: Remote State Backend - Pluggable Backend Architecture
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

// Diff calculation (Sprint 92)
export {
  calculateDiff,
  formatDiff,
  getActionableChanges,
  type DiffOptions,
} from './DiffEngine.js';

// Rate limiting (Sprint 92)
export {
  RateLimiter,
  getDefaultRateLimiter,
  resetDefaultRateLimiter,
  type RateLimiterOptions,
  type OperationType,
} from './RateLimiter.js';

// Retry handling (Sprint 92)
export {
  RetryHandler,
  createRetryHandler,
  withRetry,
  isRetryableError,
  getRetryAfterMs,
  type RetryOptions,
  type RetryResult,
  type DiscordHttpError,
} from './RetryHandler.js';

// State writing (Sprint 92)
export {
  StateWriter,
  createWriterFromEnv,
  formatApplyResult,
  type ApplyOptions,
  type ResourceIdMap,
} from './StateWriter.js';

// State locking (Sprint 98)
export {
  StateLock,
  createStateLock,
  formatLockInfo,
  isLockStale,
  type LockOperation,
  type AcquireLockOptions,
  type LockedOperationResult,
} from './StateLock.js';

// Apply engine (Sprint 98)
export {
  ApplyEngine,
  createApplyEngine,
  createApplyEngineFromEnv,
  type ApplyEngineOptions,
  type ApplyEngineResult,
} from './ApplyEngine.js';

// Destroy engine (Sprint 98)
export {
  DestroyEngine,
  createDestroyEngine,
  createDestroyEngineFromEnv,
  type DestroyEngineOptions,
  type DestroyEngineResult,
} from './DestroyEngine.js';

// Backend schemas (Sprint 96)
export {
  LocalBackendSchema,
  S3BackendSchema,
  BackendSchema,
  DiscordConfigSchema,
  OutputSchema,
  GaibConfigSchema,
  parseGaibConfig,
  safeParseGaibConfig,
  type LocalBackendConfig,
  type S3BackendConfigSchema,
  type BackendConfig,
  type DiscordConfig,
  type OutputConfig,
  type GaibConfigFile,
} from './schemas.js';

// State backends (Sprint 96)
export {
  // Types
  type GaibState,
  type StateResource,
  type StateResourceInstance,
  type StateOutput,
  type LockInfo,
  type LockResult,
  type LockOptions,
  type StateBackend,
  type BackendType,
  type CreateStateOptions,
  type GaibConfig,

  // Utilities
  createEmptyState,
  generateLineage,
  generateLockId,
  isValidState,
  isValidBackendConfig,

  // Errors
  BackendError,
  StateLockError,
  StateLineageError,
  StateSerialError,
  BackendConfigError,

  // LocalBackend
  LocalBackend,
  createLocalBackend,
  getCurrentWorkspace,
  setCurrentWorkspace,

  // S3Backend
  S3Backend,
  createS3Backend,
  createS3BackendFromEnv,

  // BackendFactory
  BackendFactory,
  findConfigFile,
  loadConfigFile,
  withBackend,
  withLock,
} from './backends/index.js';

/**
 * State Backends Module
 *
 * Sprint 96: Remote State Backend
 *
 * Re-exports all backend types, interfaces, and implementations.
 *
 * @module packages/cli/commands/server/iac/backends
 */

// Types
export type {
  GaibState,
  StateResource,
  StateResourceInstance,
  StateOutput,
  LockInfo,
  LockResult,
  LockOptions,
  StateBackend,
  BackendType,
  BackendConfig,
  BackendConfigBase,
  LocalBackendConfig,
  S3BackendConfig,
  CreateStateOptions,
} from './types.js';

// Type guards and utilities
export {
  createEmptyState,
  generateLineage,
  generateLockId,
  isValidState,
  isValidBackendConfig,
} from './types.js';

// Errors
export {
  BackendError,
  StateLockError,
  StateLineageError,
  StateSerialError,
  BackendConfigError,
} from './types.js';

// LocalBackend
export { LocalBackend, createLocalBackend } from './LocalBackend.js';
export { getCurrentWorkspace, setCurrentWorkspace } from './LocalBackend.js';

// S3Backend
export { S3Backend, createS3Backend, createS3BackendFromEnv } from './S3Backend.js';

// BackendFactory
export { BackendFactory, findConfigFile, loadConfigFile } from './BackendFactory.js';
export { withBackend, withLock } from './BackendFactory.js';
export type { GaibConfig } from './BackendFactory.js';

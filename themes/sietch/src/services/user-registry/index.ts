/**
 * User Registry Module Exports
 * Sprint 176: Global User Registry
 *
 * @module services/user-registry
 */

// Types
export * from './types.js';

// Service
export {
  UserRegistryService,
  setUserRegistryDb,
  getUserRegistryService,
  isUserRegistryServiceInitialized,
} from './UserRegistryService.js';

// Recovery utilities
export {
  recoverIdentityAtTimestamp,
  rebuildIdentityFromEvents,
  verifyIdentityIntegrity,
  type RecoveredIdentityState,
} from './recovery.js';

/**
 * Storage Adapters
 *
 * Sprint S-19: Enhanced RLS & Drizzle Adapter
 *
 * Exports storage infrastructure for multi-tenant PostgreSQL with RLS.
 *
 * @see SDD §6.3 PostgreSQL Multi-Tenant
 * @module packages/adapters/storage
 */

// =============================================================================
// Tenant Context
// =============================================================================

export {
  TenantContext,
  createTenantContext,
  isValidTenantId,
  type TenantContextOptions,
  type TenantContextInfo,
} from './tenant-context.js';

// =============================================================================
// Drizzle Storage Adapter
// =============================================================================

export {
  DrizzleStorageAdapter,
  createDrizzleStorageAdapter,
} from './drizzle-storage-adapter.js';

// =============================================================================
// Lot Entry Repository
// =============================================================================

export {
  insertLotEntry,
  type InsertLotEntryParams,
  type InsertLotEntryResult,
  type LotEntryType,
} from './lot-entry-repository.js';

// =============================================================================
// Schema
// =============================================================================

export {
  communities,
  profiles,
  badges,
  communitiesRelations,
  profilesRelations,
  badgesRelations,
  type DrizzleCommunity,
  type DrizzleNewCommunity,
  type DrizzleProfile,
  type DrizzleNewProfile,
  type DrizzleBadge,
  type DrizzleNewBadge,
} from './schema.js';

// =============================================================================
// Audit Trail Service (cycle-043, FR-6 — hash-chained append-only audit trail)
// =============================================================================

export {
  AuditTrailService,
  AuditQuarantineError,
  type AuditEntry,
  type AuditTrailVerificationResult,
  type CheckpointResult,
  type AuditTrailServiceConfig,
} from './audit-trail-service.js';

// =============================================================================
// Governed Mutation Service (cycle-043, FR-6 — transactional state + audit)
// =============================================================================

export {
  GovernedMutationService,
  type MutationParams,
  type MutationResult,
  type GovernedMutationServiceConfig,
} from './governed-mutation-service.js';

// =============================================================================
// Partition Manager (cycle-043, FR-6 — audit trail partition lifecycle)
// =============================================================================

export {
  PartitionManager,
  type PartitionInfo,
  type PartitionHealthResult,
  type PartitionManagerConfig,
} from './partition-manager.js';

// =============================================================================
// Audit Helpers (cycle-043, bridge iteration 2 — shared advisory lock hashing)
// =============================================================================

export { advisoryLockKey, sleep } from './audit-helpers.js';

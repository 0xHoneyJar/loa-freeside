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

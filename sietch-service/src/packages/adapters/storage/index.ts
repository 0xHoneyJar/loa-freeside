/**
 * Storage Adapters - Database Layer
 *
 * Sprint 38: Drizzle Schema Design
 * Sprint 39: RLS Implementation
 *
 * Exports PostgreSQL schema, types, and tenant context for multi-tenant storage.
 *
 * @module packages/adapters/storage
 */

// Schema exports
export {
  // Tables
  communities,
  profiles,
  badges,
  manifests,
  shadowStates,
  // Relations
  communitiesRelations,
  profilesRelations,
  badgesRelations,
  manifestsRelations,
  shadowStatesRelations,
  // Types
  type Community,
  type NewCommunity,
  type Profile,
  type NewProfile,
  type Badge,
  type NewBadge,
  type Manifest,
  type NewManifest,
  type ShadowState,
  type NewShadowState,
  // JSONB Types
  type CommunitySettings,
  type ProfileMetadata,
  type BadgeMetadata,
  type ManifestContent,
  type ManifestRole,
  type ManifestChannel,
  type ManifestCategory,
  type ShadowResources,
} from './schema.js';

// Tenant Context exports (Sprint 39)
export {
  TenantContext,
  createTenantContext,
  isValidTenantId,
  type TenantContextOptions,
  type TenantContextInfo,
} from './TenantContext.js';

// Storage Adapter exports (Sprint 40)
export {
  DrizzleStorageAdapter,
  createDrizzleStorageAdapter,
} from './DrizzleStorageAdapter.js';

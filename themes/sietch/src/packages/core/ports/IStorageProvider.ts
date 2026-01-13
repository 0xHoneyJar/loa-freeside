/**
 * Storage Provider Interface
 *
 * Sprint 40: Drizzle Storage Adapter
 *
 * Defines the contract for storage operations in a multi-tenant environment.
 * All implementations must handle tenant isolation transparently.
 *
 * @module packages/core/ports/IStorageProvider
 */

import type {
  Community,
  NewCommunity,
  Profile,
  NewProfile,
  Badge,
  NewBadge,
  Manifest,
  NewManifest,
  ShadowState,
  NewShadowState,
} from '../../adapters/storage/schema.js';

// =============================================================================
// Common Types
// =============================================================================

/**
 * Query options for pagination and filtering
 */
export interface QueryOptions {
  /** Number of items to return (default: 50) */
  limit?: number;
  /** Offset for pagination */
  offset?: number;
  /** Order by field */
  orderBy?: string;
  /** Order direction */
  orderDirection?: 'asc' | 'desc';
}

/**
 * Result of a paginated query
 */
export interface PaginatedResult<T> {
  /** Items for the current page */
  items: T[];
  /** Total count of items */
  total: number;
  /** Whether there are more items */
  hasMore: boolean;
}

/**
 * Badge lineage node for Water Sharer chains
 */
export interface BadgeLineageNode {
  /** Badge ID */
  badgeId: string;
  /** Profile ID of badge owner */
  profileId: string;
  /** Display name of badge owner */
  displayName: string | null;
  /** When the badge was awarded */
  awardedAt: Date;
  /** Depth in lineage tree (0 = root) */
  depth: number;
}

/**
 * Transaction context for atomic operations
 */
export interface TransactionContext {
  /** Execute operations in this transaction */
  execute<T>(fn: () => Promise<T>): Promise<T>;
  /** Commit the transaction */
  commit(): Promise<void>;
  /** Rollback the transaction */
  rollback(): Promise<void>;
}

// =============================================================================
// Storage Provider Interface
// =============================================================================

/**
 * IStorageProvider defines the contract for multi-tenant storage operations.
 *
 * Implementations:
 * - DrizzleStorageAdapter: PostgreSQL with RLS
 *
 * All operations are automatically scoped to the tenant (community) specified
 * during construction. Cross-tenant access is prevented at the database level.
 */
export interface IStorageProvider {
  // ===========================================================================
  // Tenant Context
  // ===========================================================================

  /**
   * Get the current tenant ID
   */
  readonly tenantId: string;

  // ===========================================================================
  // Community Operations
  // ===========================================================================

  /**
   * Get community by ID (bypasses RLS for lookup)
   */
  getCommunity(id: string): Promise<Community | null>;

  /**
   * Get community by Discord guild ID
   */
  getCommunityByDiscordGuild(guildId: string): Promise<Community | null>;

  /**
   * Get community by Telegram chat ID
   */
  getCommunityByTelegramChat(chatId: string): Promise<Community | null>;

  /**
   * Create a new community
   */
  createCommunity(data: NewCommunity): Promise<Community>;

  /**
   * Update an existing community
   */
  updateCommunity(id: string, data: Partial<NewCommunity>): Promise<Community | null>;

  /**
   * Soft delete a community (set isActive = false)
   */
  deactivateCommunity(id: string): Promise<boolean>;

  // ===========================================================================
  // Profile Operations
  // ===========================================================================

  /**
   * Get profile by ID
   */
  getProfile(id: string): Promise<Profile | null>;

  /**
   * Get profile by Discord ID
   */
  getProfileByDiscordId(discordId: string): Promise<Profile | null>;

  /**
   * Get profile by Telegram ID
   */
  getProfileByTelegramId(telegramId: string): Promise<Profile | null>;

  /**
   * Get profile by wallet address
   */
  getProfileByWallet(walletAddress: string): Promise<Profile | null>;

  /**
   * Get all profiles (with pagination)
   */
  getProfiles(options?: QueryOptions): Promise<PaginatedResult<Profile>>;

  /**
   * Get profiles by tier
   */
  getProfilesByTier(tier: string, options?: QueryOptions): Promise<PaginatedResult<Profile>>;

  /**
   * Create a new profile
   */
  createProfile(data: NewProfile): Promise<Profile>;

  /**
   * Update an existing profile
   */
  updateProfile(id: string, data: Partial<NewProfile>): Promise<Profile | null>;

  /**
   * Delete a profile
   */
  deleteProfile(id: string): Promise<boolean>;

  /**
   * Update last seen timestamp
   */
  touchProfile(id: string): Promise<void>;

  // ===========================================================================
  // Badge Operations
  // ===========================================================================

  /**
   * Get badge by ID
   */
  getBadge(id: string): Promise<Badge | null>;

  /**
   * Get all badges for a profile
   */
  getBadgesForProfile(profileId: string): Promise<Badge[]>;

  /**
   * Get badges by type
   */
  getBadgesByType(badgeType: string, options?: QueryOptions): Promise<PaginatedResult<Badge>>;

  /**
   * Check if profile has a specific badge type
   */
  hasBadge(profileId: string, badgeType: string): Promise<boolean>;

  /**
   * Award a badge to a profile
   */
  awardBadge(data: NewBadge): Promise<Badge>;

  /**
   * Revoke a badge
   */
  revokeBadge(badgeId: string): Promise<boolean>;

  /**
   * Get badge lineage (Water Sharer chain)
   *
   * Uses recursive CTE to traverse the awarded_by chain.
   */
  getBadgeLineage(badgeId: string, maxDepth?: number): Promise<BadgeLineageNode[]>;

  /**
   * Get badges awarded by a profile (descendants)
   */
  getBadgesAwardedBy(profileId: string): Promise<Badge[]>;

  // ===========================================================================
  // Manifest Operations
  // ===========================================================================

  /**
   * Get current (active) manifest
   */
  getCurrentManifest(): Promise<Manifest | null>;

  /**
   * Get manifest by version
   */
  getManifestByVersion(version: number): Promise<Manifest | null>;

  /**
   * Get all manifest versions (with pagination)
   */
  getManifestHistory(options?: QueryOptions): Promise<PaginatedResult<Manifest>>;

  /**
   * Create a new manifest version
   *
   * Automatically increments version number.
   */
  createManifest(data: Omit<NewManifest, 'version'>): Promise<Manifest>;

  /**
   * Deactivate current manifest (before creating new one)
   */
  deactivateCurrentManifest(): Promise<void>;

  // ===========================================================================
  // Shadow State Operations
  // ===========================================================================

  /**
   * Get current shadow state
   */
  getCurrentShadowState(): Promise<ShadowState | null>;

  /**
   * Get shadow state by manifest version
   */
  getShadowStateByVersion(manifestVersion: number): Promise<ShadowState | null>;

  /**
   * Create a new shadow state
   */
  createShadowState(data: NewShadowState): Promise<ShadowState>;

  /**
   * Update shadow state status
   */
  updateShadowStateStatus(id: string, status: string): Promise<ShadowState | null>;

  // ===========================================================================
  // Transaction Support
  // ===========================================================================

  /**
   * Execute operations within a transaction
   *
   * @param fn - Async function containing operations
   * @returns Result of the function
   * @throws Rolls back on error
   */
  transaction<T>(fn: (tx: IStorageProvider) => Promise<T>): Promise<T>;

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  /**
   * Close database connections
   */
  close(): Promise<void>;
}

// =============================================================================
// Factory Types
// =============================================================================

/**
 * Options for creating a storage provider
 */
export interface StorageProviderOptions {
  /** Database connection string */
  connectionString: string;
  /** Tenant ID for RLS scoping */
  tenantId: string;
  /** Enable debug logging */
  debug?: boolean;
  /** Cache TTL in seconds (default: 300) */
  cacheTtl?: number;
}

/**
 * Factory function type for creating storage providers
 */
export type StorageProviderFactory = (
  options: StorageProviderOptions
) => Promise<IStorageProvider>;

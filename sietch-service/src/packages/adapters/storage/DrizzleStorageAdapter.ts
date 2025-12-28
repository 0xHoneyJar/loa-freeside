/**
 * Drizzle Storage Adapter
 *
 * Sprint 40: Drizzle Storage Adapter
 *
 * Implements IStorageProvider using Drizzle ORM with PostgreSQL.
 * All operations are automatically scoped to the tenant via RLS.
 *
 * Features:
 * - Automatic tenant isolation via TenantContext
 * - Transaction support with automatic rollback
 * - Badge lineage queries (recursive CTE)
 * - Connection pooling ready
 *
 * @module packages/adapters/storage/DrizzleStorageAdapter
 */

import { eq, and, desc, asc, sql, isNull } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import type {
  IStorageProvider,
  QueryOptions,
  PaginatedResult,
  BadgeLineageNode,
  StorageProviderOptions,
} from '../../core/ports/IStorageProvider.js';

import {
  communities,
  profiles,
  badges,
  manifests,
  shadowStates,
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
} from './schema.js';

import { TenantContext } from './TenantContext.js';

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 1000;
const DEFAULT_LINEAGE_DEPTH = 10;

// =============================================================================
// Drizzle Storage Adapter
// =============================================================================

/**
 * DrizzleStorageAdapter implements IStorageProvider using Drizzle ORM.
 *
 * All tenant-scoped operations are wrapped with TenantContext to ensure
 * RLS policies filter data correctly.
 *
 * @example
 * ```typescript
 * const adapter = await createDrizzleStorageAdapter({
 *   connectionString: process.env.DATABASE_URL,
 *   tenantId: communityId,
 * });
 *
 * const profile = await adapter.getProfileByDiscordId('123456');
 * ```
 */
export class DrizzleStorageAdapter implements IStorageProvider {
  private readonly db: PostgresJsDatabase;
  private readonly client: postgres.Sql;
  private readonly tenantContext: TenantContext;
  private readonly _tenantId: string;
  private readonly debug: boolean;

  /**
   * Creates a new DrizzleStorageAdapter
   *
   * @param db - Drizzle database instance
   * @param client - Postgres.js client (for closing)
   * @param tenantId - Tenant ID for RLS scoping
   * @param options - Additional options
   */
  constructor(
    db: PostgresJsDatabase,
    client: postgres.Sql,
    tenantId: string,
    options: { debug?: boolean } = {}
  ) {
    this.db = db;
    this.client = client;
    this._tenantId = tenantId;
    this.debug = options.debug ?? false;
    this.tenantContext = new TenantContext(db, { debug: this.debug });
  }

  /**
   * Get the current tenant ID
   */
  get tenantId(): string {
    return this._tenantId;
  }

  // ===========================================================================
  // Helper Methods
  // ===========================================================================

  /**
   * Execute a query within tenant context
   */
  private async withTenant<T>(fn: () => Promise<T>): Promise<T> {
    return this.tenantContext.withTenant(this._tenantId, fn);
  }

  /**
   * Normalize query options with defaults
   */
  private normalizeOptions(options?: QueryOptions): Required<QueryOptions> {
    return {
      limit: Math.min(options?.limit ?? DEFAULT_LIMIT, MAX_LIMIT),
      offset: options?.offset ?? 0,
      orderBy: options?.orderBy ?? 'createdAt',
      orderDirection: options?.orderDirection ?? 'desc',
    };
  }

  /**
   * Log debug messages
   */
  private log(message: string, data?: unknown): void {
    if (this.debug) {
      console.log(`[DrizzleStorageAdapter] ${message}`, data ?? '');
    }
  }

  // ===========================================================================
  // Community Operations
  // ===========================================================================

  async getCommunity(id: string): Promise<Community | null> {
    this.log('getCommunity', { id });
    // Community lookup bypasses RLS (need to find community before setting context)
    const result = await this.db
      .select()
      .from(communities)
      .where(eq(communities.id, id))
      .limit(1);

    return result[0] ?? null;
  }

  async getCommunityByDiscordGuild(guildId: string): Promise<Community | null> {
    this.log('getCommunityByDiscordGuild', { guildId });
    const result = await this.db
      .select()
      .from(communities)
      .where(eq(communities.discordGuildId, guildId))
      .limit(1);

    return result[0] ?? null;
  }

  async getCommunityByTelegramChat(chatId: string): Promise<Community | null> {
    this.log('getCommunityByTelegramChat', { chatId });
    const result = await this.db
      .select()
      .from(communities)
      .where(eq(communities.telegramChatId, chatId))
      .limit(1);

    return result[0] ?? null;
  }

  async createCommunity(data: NewCommunity): Promise<Community> {
    this.log('createCommunity', { data });
    const result = await this.db.insert(communities).values(data).returning();
    return result[0];
  }

  async updateCommunity(
    id: string,
    data: Partial<NewCommunity>
  ): Promise<Community | null> {
    this.log('updateCommunity', { id, data });
    const result = await this.db
      .update(communities)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(communities.id, id))
      .returning();

    return result[0] ?? null;
  }

  async deactivateCommunity(id: string): Promise<boolean> {
    this.log('deactivateCommunity', { id });
    const result = await this.db
      .update(communities)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(communities.id, id))
      .returning();

    return result.length > 0;
  }

  // ===========================================================================
  // Profile Operations
  // ===========================================================================

  async getProfile(id: string): Promise<Profile | null> {
    this.log('getProfile', { id });
    return this.withTenant(async () => {
      const result = await this.db
        .select()
        .from(profiles)
        .where(eq(profiles.id, id))
        .limit(1);

      return result[0] ?? null;
    });
  }

  async getProfileByDiscordId(discordId: string): Promise<Profile | null> {
    this.log('getProfileByDiscordId', { discordId });
    return this.withTenant(async () => {
      const result = await this.db
        .select()
        .from(profiles)
        .where(eq(profiles.discordId, discordId))
        .limit(1);

      return result[0] ?? null;
    });
  }

  async getProfileByTelegramId(telegramId: string): Promise<Profile | null> {
    this.log('getProfileByTelegramId', { telegramId });
    return this.withTenant(async () => {
      const result = await this.db
        .select()
        .from(profiles)
        .where(eq(profiles.telegramId, telegramId))
        .limit(1);

      return result[0] ?? null;
    });
  }

  async getProfileByWallet(walletAddress: string): Promise<Profile | null> {
    this.log('getProfileByWallet', { walletAddress });
    return this.withTenant(async () => {
      const result = await this.db
        .select()
        .from(profiles)
        .where(eq(profiles.walletAddress, walletAddress.toLowerCase()))
        .limit(1);

      return result[0] ?? null;
    });
  }

  async getProfiles(options?: QueryOptions): Promise<PaginatedResult<Profile>> {
    this.log('getProfiles', { options });
    const opts = this.normalizeOptions(options);

    return this.withTenant(async () => {
      const [items, countResult] = await Promise.all([
        this.db
          .select()
          .from(profiles)
          .orderBy(
            opts.orderDirection === 'asc'
              ? asc(profiles.createdAt)
              : desc(profiles.createdAt)
          )
          .limit(opts.limit)
          .offset(opts.offset),
        this.db.select({ count: sql<number>`count(*)` }).from(profiles),
      ]);

      const total = Number(countResult[0]?.count ?? 0);

      return {
        items,
        total,
        hasMore: opts.offset + items.length < total,
      };
    });
  }

  async getProfilesByTier(
    tier: string,
    options?: QueryOptions
  ): Promise<PaginatedResult<Profile>> {
    this.log('getProfilesByTier', { tier, options });
    const opts = this.normalizeOptions(options);

    return this.withTenant(async () => {
      const [items, countResult] = await Promise.all([
        this.db
          .select()
          .from(profiles)
          .where(eq(profiles.tier, tier))
          .orderBy(
            opts.orderDirection === 'asc'
              ? asc(profiles.createdAt)
              : desc(profiles.createdAt)
          )
          .limit(opts.limit)
          .offset(opts.offset),
        this.db
          .select({ count: sql<number>`count(*)` })
          .from(profiles)
          .where(eq(profiles.tier, tier)),
      ]);

      const total = Number(countResult[0]?.count ?? 0);

      return {
        items,
        total,
        hasMore: opts.offset + items.length < total,
      };
    });
  }

  async createProfile(data: NewProfile): Promise<Profile> {
    this.log('createProfile', { data });
    return this.withTenant(async () => {
      // Ensure community_id matches tenant
      const profileData = {
        ...data,
        communityId: this._tenantId,
        walletAddress: data.walletAddress?.toLowerCase(),
      };

      const result = await this.db.insert(profiles).values(profileData).returning();
      return result[0];
    });
  }

  async updateProfile(
    id: string,
    data: Partial<NewProfile>
  ): Promise<Profile | null> {
    this.log('updateProfile', { id, data });
    return this.withTenant(async () => {
      const updateData = {
        ...data,
        walletAddress: data.walletAddress?.toLowerCase(),
        updatedAt: new Date(),
      };

      const result = await this.db
        .update(profiles)
        .set(updateData)
        .where(eq(profiles.id, id))
        .returning();

      return result[0] ?? null;
    });
  }

  async deleteProfile(id: string): Promise<boolean> {
    this.log('deleteProfile', { id });
    return this.withTenant(async () => {
      const result = await this.db
        .delete(profiles)
        .where(eq(profiles.id, id))
        .returning();

      return result.length > 0;
    });
  }

  async touchProfile(id: string): Promise<void> {
    this.log('touchProfile', { id });
    await this.withTenant(async () => {
      await this.db
        .update(profiles)
        .set({ lastSeenAt: new Date() })
        .where(eq(profiles.id, id));
    });
  }

  // ===========================================================================
  // Badge Operations
  // ===========================================================================

  async getBadge(id: string): Promise<Badge | null> {
    this.log('getBadge', { id });
    return this.withTenant(async () => {
      const result = await this.db
        .select()
        .from(badges)
        .where(eq(badges.id, id))
        .limit(1);

      return result[0] ?? null;
    });
  }

  async getBadgesForProfile(profileId: string): Promise<Badge[]> {
    this.log('getBadgesForProfile', { profileId });
    return this.withTenant(async () => {
      return this.db
        .select()
        .from(badges)
        .where(
          and(eq(badges.profileId, profileId), isNull(badges.revokedAt))
        )
        .orderBy(desc(badges.awardedAt));
    });
  }

  async getBadgesByType(
    badgeType: string,
    options?: QueryOptions
  ): Promise<PaginatedResult<Badge>> {
    this.log('getBadgesByType', { badgeType, options });
    const opts = this.normalizeOptions(options);

    return this.withTenant(async () => {
      const [items, countResult] = await Promise.all([
        this.db
          .select()
          .from(badges)
          .where(
            and(eq(badges.badgeType, badgeType), isNull(badges.revokedAt))
          )
          .orderBy(
            opts.orderDirection === 'asc'
              ? asc(badges.awardedAt)
              : desc(badges.awardedAt)
          )
          .limit(opts.limit)
          .offset(opts.offset),
        this.db
          .select({ count: sql<number>`count(*)` })
          .from(badges)
          .where(
            and(eq(badges.badgeType, badgeType), isNull(badges.revokedAt))
          ),
      ]);

      const total = Number(countResult[0]?.count ?? 0);

      return {
        items,
        total,
        hasMore: opts.offset + items.length < total,
      };
    });
  }

  async hasBadge(profileId: string, badgeType: string): Promise<boolean> {
    this.log('hasBadge', { profileId, badgeType });
    return this.withTenant(async () => {
      const result = await this.db
        .select({ count: sql<number>`count(*)` })
        .from(badges)
        .where(
          and(
            eq(badges.profileId, profileId),
            eq(badges.badgeType, badgeType),
            isNull(badges.revokedAt)
          )
        );

      return Number(result[0]?.count ?? 0) > 0;
    });
  }

  async awardBadge(data: NewBadge): Promise<Badge> {
    this.log('awardBadge', { data });
    return this.withTenant(async () => {
      const badgeData = {
        ...data,
        communityId: this._tenantId,
      };

      const result = await this.db.insert(badges).values(badgeData).returning();
      return result[0];
    });
  }

  async revokeBadge(badgeId: string): Promise<boolean> {
    this.log('revokeBadge', { badgeId });
    return this.withTenant(async () => {
      const result = await this.db
        .update(badges)
        .set({ revokedAt: new Date() })
        .where(eq(badges.id, badgeId))
        .returning();

      return result.length > 0;
    });
  }

  async getBadgeLineage(
    badgeId: string,
    maxDepth: number = DEFAULT_LINEAGE_DEPTH
  ): Promise<BadgeLineageNode[]> {
    this.log('getBadgeLineage', { badgeId, maxDepth });
    return this.withTenant(async () => {
      // Recursive CTE to traverse badge lineage
      const result = await this.db.execute<{
        badge_id: string;
        profile_id: string;
        display_name: string | null;
        awarded_at: Date;
        depth: number;
      }>(sql`
        WITH RECURSIVE lineage AS (
          -- Base case: starting badge
          SELECT
            b.id as badge_id,
            b.profile_id,
            (p.metadata->>'displayName')::TEXT as display_name,
            b.awarded_at,
            0 as depth
          FROM badges b
          JOIN profiles p ON p.id = b.profile_id
          WHERE b.id = ${badgeId}::UUID

          UNION ALL

          -- Recursive case: find parent badge (awarded by)
          SELECT
            parent_b.id as badge_id,
            parent_b.profile_id,
            (parent_p.metadata->>'displayName')::TEXT as display_name,
            parent_b.awarded_at,
            lineage.depth + 1 as depth
          FROM lineage
          JOIN badges child_b ON child_b.id = lineage.badge_id
          JOIN badges parent_b ON parent_b.profile_id = child_b.awarded_by
            AND parent_b.badge_type = child_b.badge_type
            AND parent_b.revoked_at IS NULL
          JOIN profiles parent_p ON parent_p.id = parent_b.profile_id
          WHERE lineage.depth < ${maxDepth}
        )
        SELECT * FROM lineage ORDER BY depth ASC
      `);

      return result.map((row) => ({
        badgeId: row.badge_id,
        profileId: row.profile_id,
        displayName: row.display_name,
        awardedAt: row.awarded_at,
        depth: row.depth,
      }));
    });
  }

  async getBadgesAwardedBy(profileId: string): Promise<Badge[]> {
    this.log('getBadgesAwardedBy', { profileId });
    return this.withTenant(async () => {
      return this.db
        .select()
        .from(badges)
        .where(
          and(eq(badges.awardedBy, profileId), isNull(badges.revokedAt))
        )
        .orderBy(desc(badges.awardedAt));
    });
  }

  // ===========================================================================
  // Manifest Operations
  // ===========================================================================

  async getCurrentManifest(): Promise<Manifest | null> {
    this.log('getCurrentManifest');
    return this.withTenant(async () => {
      const result = await this.db
        .select()
        .from(manifests)
        .where(eq(manifests.isActive, true))
        .orderBy(desc(manifests.version))
        .limit(1);

      return result[0] ?? null;
    });
  }

  async getManifestByVersion(version: number): Promise<Manifest | null> {
    this.log('getManifestByVersion', { version });
    return this.withTenant(async () => {
      const result = await this.db
        .select()
        .from(manifests)
        .where(eq(manifests.version, version))
        .limit(1);

      return result[0] ?? null;
    });
  }

  async getManifestHistory(
    options?: QueryOptions
  ): Promise<PaginatedResult<Manifest>> {
    this.log('getManifestHistory', { options });
    const opts = this.normalizeOptions(options);

    return this.withTenant(async () => {
      const [items, countResult] = await Promise.all([
        this.db
          .select()
          .from(manifests)
          .orderBy(desc(manifests.version))
          .limit(opts.limit)
          .offset(opts.offset),
        this.db.select({ count: sql<number>`count(*)` }).from(manifests),
      ]);

      const total = Number(countResult[0]?.count ?? 0);

      return {
        items,
        total,
        hasMore: opts.offset + items.length < total,
      };
    });
  }

  async createManifest(
    data: Omit<NewManifest, 'version'>
  ): Promise<Manifest> {
    this.log('createManifest', { data });
    return this.withTenant(async () => {
      // Get next version number
      const currentManifest = await this.getCurrentManifest();
      const nextVersion = (currentManifest?.version ?? 0) + 1;

      const manifestData = {
        ...data,
        communityId: this._tenantId,
        version: nextVersion,
      };

      const result = await this.db
        .insert(manifests)
        .values(manifestData)
        .returning();

      return result[0];
    });
  }

  async deactivateCurrentManifest(): Promise<void> {
    this.log('deactivateCurrentManifest');
    await this.withTenant(async () => {
      await this.db
        .update(manifests)
        .set({ isActive: false })
        .where(eq(manifests.isActive, true));
    });
  }

  // ===========================================================================
  // Shadow State Operations
  // ===========================================================================

  async getCurrentShadowState(): Promise<ShadowState | null> {
    this.log('getCurrentShadowState');
    return this.withTenant(async () => {
      const result = await this.db
        .select()
        .from(shadowStates)
        .where(eq(shadowStates.status, 'applied'))
        .orderBy(desc(shadowStates.appliedAt))
        .limit(1);

      return result[0] ?? null;
    });
  }

  async getShadowStateByVersion(
    manifestVersion: number
  ): Promise<ShadowState | null> {
    this.log('getShadowStateByVersion', { manifestVersion });
    return this.withTenant(async () => {
      const result = await this.db
        .select()
        .from(shadowStates)
        .where(eq(shadowStates.manifestVersion, manifestVersion))
        .limit(1);

      return result[0] ?? null;
    });
  }

  async createShadowState(data: NewShadowState): Promise<ShadowState> {
    this.log('createShadowState', { data });
    return this.withTenant(async () => {
      const shadowData = {
        ...data,
        communityId: this._tenantId,
      };

      const result = await this.db
        .insert(shadowStates)
        .values(shadowData)
        .returning();

      return result[0];
    });
  }

  async updateShadowStateStatus(
    id: string,
    status: string
  ): Promise<ShadowState | null> {
    this.log('updateShadowStateStatus', { id, status });
    return this.withTenant(async () => {
      const result = await this.db
        .update(shadowStates)
        .set({ status })
        .where(eq(shadowStates.id, id))
        .returning();

      return result[0] ?? null;
    });
  }

  // ===========================================================================
  // Transaction Support
  // ===========================================================================

  async transaction<T>(
    fn: (tx: IStorageProvider) => Promise<T>
  ): Promise<T> {
    this.log('transaction start');

    return this.db.transaction(async (tx) => {
      // Create a transaction-scoped adapter
      const txAdapter = new DrizzleStorageAdapter(
        tx as unknown as PostgresJsDatabase,
        this.client,
        this._tenantId,
        { debug: this.debug }
      );

      try {
        const result = await fn(txAdapter);
        this.log('transaction commit');
        return result;
      } catch (error) {
        this.log('transaction rollback', { error });
        throw error;
      }
    });
  }

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  async close(): Promise<void> {
    this.log('close');
    await this.client.end();
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Creates a new DrizzleStorageAdapter
 *
 * @param options - Configuration options
 * @returns Configured storage adapter
 *
 * @example
 * ```typescript
 * const adapter = await createDrizzleStorageAdapter({
 *   connectionString: process.env.DATABASE_URL,
 *   tenantId: communityId,
 * });
 * ```
 */
export async function createDrizzleStorageAdapter(
  options: StorageProviderOptions
): Promise<DrizzleStorageAdapter> {
  const client = postgres(options.connectionString, {
    max: 10, // Connection pool size
    idle_timeout: 20,
    connect_timeout: 10,
  });

  const db = drizzle(client);

  return new DrizzleStorageAdapter(db, client, options.tenantId, {
    debug: options.debug,
  });
}

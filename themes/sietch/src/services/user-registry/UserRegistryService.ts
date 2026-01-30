/**
 * User Registry Service
 * Sprint 176: Global User Registry - Append-only, event-sourced identity store
 *
 * Core service for identity management with event sourcing.
 * All changes are recorded as immutable events for financial-grade audit trails.
 *
 * @module services/user-registry/UserRegistryService
 */

import { eq, and, or, ilike, desc, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import {
  userIdentities,
  identityEvents,
  identityWallets,
} from '../../db/pg-schema.js';
import { logger } from '../../utils/logger.js';
import {
  IdentityEventType,
  type EventSource,
  type CreateIdentityParams,
  type VerifyWalletParams,
  type RemoveWalletParams,
  type SuspendIdentityParams,
  type RestoreIdentityParams,
  type ListUsersParams,
  type PaginatedResult,
  type IdentityWithWallets,
  type IdentityEventRecord,
  type IdentityEventData,
  IdentityNotFoundError,
  WalletAlreadyLinkedError,
  IdentityAlreadyExistsError,
} from './types.js';

/**
 * User Registry Service
 *
 * Manages user identities with event sourcing for financial-grade audit trails.
 */
export class UserRegistryService {
  constructor(private db: PostgresJsDatabase) {}

  // ===========================================================================
  // Identity Creation & Lookup
  // ===========================================================================

  /**
   * Create a new identity for a Discord user
   *
   * If an identity already exists for this Discord ID, returns the existing identity.
   * This is idempotent - safe to call multiple times.
   */
  async createIdentity(params: CreateIdentityParams): Promise<IdentityWithWallets> {
    const {
      discordId,
      discordUsername,
      discordDiscriminator,
      discordAvatarHash,
      source,
      actorId,
      requestId,
    } = params;

    // Check for existing identity
    const existing = await this.db
      .select({ identityId: userIdentities.identityId })
      .from(userIdentities)
      .where(eq(userIdentities.discordId, discordId))
      .limit(1);

    if (existing.length > 0 && existing[0]) {
      logger.debug({ discordId, identityId: existing[0].identityId }, 'Identity already exists');
      // Return existing identity with wallets
      const existingIdentity = await this.getIdentityByDiscordId(discordId);
      if (existingIdentity) {
        return existingIdentity;
      }
      throw new IdentityAlreadyExistsError(discordId, existing[0].identityId);
    }

    // Create new identity with event in transaction
    const identityId = await this.db.transaction(async (tx) => {
      // Insert identity
      const newIdentityResult = await tx
        .insert(userIdentities)
        .values({
          discordId,
          discordUsername,
          discordDiscriminator,
          discordAvatarHash,
          status: 'active',
        })
        .returning({ identityId: userIdentities.identityId });

      if (!newIdentityResult[0]) {
        throw new Error('Failed to create identity');
      }
      const newIdentityId = newIdentityResult[0].identityId;

      // Record creation event
      await tx.insert(identityEvents).values({
        identityId: newIdentityId,
        eventType: IdentityEventType.IDENTITY_CREATED,
        eventData: {
          discord_id: discordId,
          discord_username: discordUsername,
          discord_discriminator: discordDiscriminator,
        } as IdentityEventData,
        source,
        actorId,
        requestId,
      });

      return newIdentityId;
    });

    logger.info({ identityId, discordId }, 'Created new identity');

    // Return the newly created identity with wallets
    const newIdentity = await this.getIdentityById(identityId);
    if (!newIdentity) {
      throw new Error('Failed to retrieve created identity');
    }
    return newIdentity;
  }

  /**
   * Get identity by Discord ID
   */
  async getIdentityByDiscordId(discordId: string): Promise<IdentityWithWallets | null> {
    const identityResult = await this.db
      .select()
      .from(userIdentities)
      .where(eq(userIdentities.discordId, discordId))
      .limit(1);

    const identity = identityResult[0];
    if (!identity) {
      return null;
    }

    // Get wallets
    const wallets = await this.db
      .select()
      .from(identityWallets)
      .where(
        and(
          eq(identityWallets.identityId, identity.identityId),
          eq(identityWallets.status, 'active')
        )
      );

    return {
      identity: {
        identityId: identity.identityId,
        discordId: identity.discordId,
        discordUsername: identity.discordUsername,
        discordDiscriminator: identity.discordDiscriminator,
        discordAvatarHash: identity.discordAvatarHash,
        primaryWallet: identity.primaryWallet,
        twitterHandle: identity.twitterHandle,
        telegramId: identity.telegramId,
        status: identity.status as 'active' | 'suspended' | 'deleted',
        createdAt: identity.createdAt,
        updatedAt: identity.updatedAt,
        version: identity.version,
      },
      wallets: wallets.map((w) => ({
        walletId: w.walletId,
        address: w.address,
        chainId: w.chainId,
        isPrimary: w.isPrimary,
        verifiedAt: w.verifiedAt,
        verificationSource: w.verificationSource,
        status: w.status as 'active' | 'removed',
      })),
    };
  }

  /**
   * Get identity by wallet address
   */
  async getIdentityByWallet(walletAddress: string): Promise<IdentityWithWallets | null> {
    const normalizedAddress = walletAddress.toLowerCase();

    // Find the wallet
    const walletResult = await this.db
      .select()
      .from(identityWallets)
      .where(
        and(
          eq(identityWallets.address, normalizedAddress),
          eq(identityWallets.status, 'active')
        )
      )
      .limit(1);

    if (walletResult.length === 0) {
      return null;
    }

    const walletRecord = walletResult[0];
    if (!walletRecord) {
      return null;
    }

    // Get the identity
    const identityResult = await this.db
      .select()
      .from(userIdentities)
      .where(eq(userIdentities.identityId, walletRecord.identityId))
      .limit(1);

    const identity = identityResult[0];
    if (!identity) {
      return null;
    }

    // Get all active wallets
    const wallets = await this.db
      .select()
      .from(identityWallets)
      .where(
        and(
          eq(identityWallets.identityId, identity.identityId),
          eq(identityWallets.status, 'active')
        )
      );

    return {
      identity: {
        identityId: identity.identityId,
        discordId: identity.discordId,
        discordUsername: identity.discordUsername,
        discordDiscriminator: identity.discordDiscriminator,
        discordAvatarHash: identity.discordAvatarHash,
        primaryWallet: identity.primaryWallet,
        twitterHandle: identity.twitterHandle,
        telegramId: identity.telegramId,
        status: identity.status as 'active' | 'suspended' | 'deleted',
        createdAt: identity.createdAt,
        updatedAt: identity.updatedAt,
        version: identity.version,
      },
      wallets: wallets.map((w) => ({
        walletId: w.walletId,
        address: w.address,
        chainId: w.chainId,
        isPrimary: w.isPrimary,
        verifiedAt: w.verifiedAt,
        verificationSource: w.verificationSource,
        status: w.status as 'active' | 'removed',
      })),
    };
  }

  /**
   * Get identity by ID
   */
  async getIdentityById(identityId: string): Promise<IdentityWithWallets | null> {
    const identityResult = await this.db
      .select()
      .from(userIdentities)
      .where(eq(userIdentities.identityId, identityId))
      .limit(1);

    const identity = identityResult[0];
    if (!identity) {
      return null;
    }

    // Get wallets
    const wallets = await this.db
      .select()
      .from(identityWallets)
      .where(
        and(
          eq(identityWallets.identityId, identity.identityId),
          eq(identityWallets.status, 'active')
        )
      );

    return {
      identity: {
        identityId: identity.identityId,
        discordId: identity.discordId,
        discordUsername: identity.discordUsername,
        discordDiscriminator: identity.discordDiscriminator,
        discordAvatarHash: identity.discordAvatarHash,
        primaryWallet: identity.primaryWallet,
        twitterHandle: identity.twitterHandle,
        telegramId: identity.telegramId,
        status: identity.status as 'active' | 'suspended' | 'deleted',
        createdAt: identity.createdAt,
        updatedAt: identity.updatedAt,
        version: identity.version,
      },
      wallets: wallets.map((w) => ({
        walletId: w.walletId,
        address: w.address,
        chainId: w.chainId,
        isPrimary: w.isPrimary,
        verifiedAt: w.verifiedAt,
        verificationSource: w.verificationSource,
        status: w.status as 'active' | 'removed',
      })),
    };
  }

  // ===========================================================================
  // Wallet Management
  // ===========================================================================

  /**
   * Verify and add a wallet to an identity
   *
   * @throws WalletAlreadyLinkedError if wallet is linked to another identity
   */
  async verifyWallet(params: VerifyWalletParams): Promise<void> {
    const {
      identityId,
      walletAddress,
      chainId = 80094,
      signature,
      message,
      isPrimary = false,
      source,
      actorId,
      requestId,
    } = params;

    const normalizedAddress = walletAddress.toLowerCase();

    // Check if wallet is already linked to another identity
    const existingWallet = await this.db
      .select()
      .from(identityWallets)
      .where(
        and(
          eq(identityWallets.address, normalizedAddress),
          eq(identityWallets.status, 'active')
        )
      )
      .limit(1);

    const existingWalletRecord = existingWallet[0];
    if (existingWalletRecord && existingWalletRecord.identityId !== identityId) {
      throw new WalletAlreadyLinkedError(normalizedAddress, existingWalletRecord.identityId);
    }

    // If wallet already linked to this identity, skip
    if (existingWalletRecord && existingWalletRecord.identityId === identityId) {
      logger.debug({ identityId, walletAddress: normalizedAddress }, 'Wallet already linked to this identity');
      return;
    }

    // Check if this is the first wallet (should be primary)
    const existingWallets = await this.db
      .select()
      .from(identityWallets)
      .where(
        and(
          eq(identityWallets.identityId, identityId),
          eq(identityWallets.status, 'active')
        )
      );

    const shouldBePrimary = isPrimary || existingWallets.length === 0;

    await this.db.transaction(async (tx) => {
      // Add wallet
      await tx.insert(identityWallets).values({
        identityId,
        address: normalizedAddress,
        chainId,
        isPrimary: shouldBePrimary,
        verificationSource: source,
        verificationSignature: signature,
        verificationMessage: message,
        status: 'active',
      });

      // Record event
      await tx.insert(identityEvents).values({
        identityId,
        eventType: IdentityEventType.WALLET_VERIFIED,
        eventData: {
          wallet_address: normalizedAddress,
          chain_id: chainId,
          signature,
          message,
          is_primary: shouldBePrimary,
          verification_source: source,
        } as IdentityEventData,
        source,
        actorId,
        requestId,
      });

      // Update primary wallet if needed
      if (shouldBePrimary) {
        await tx
          .update(userIdentities)
          .set({
            primaryWallet: normalizedAddress,
            updatedAt: new Date(),
          })
          .where(eq(userIdentities.identityId, identityId));
      }
    });

    logger.info(
      { identityId, walletAddress: normalizedAddress, isPrimary: shouldBePrimary },
      'Wallet verified and linked'
    );
  }

  /**
   * Get all wallets for an identity
   */
  async getWallets(identityId: string): Promise<Array<{
    walletId: string;
    address: string;
    chainId: number;
    isPrimary: boolean;
    verifiedAt: Date;
    verificationSource: string;
    status: 'active' | 'removed';
  }>> {
    const wallets = await this.db
      .select()
      .from(identityWallets)
      .where(
        and(
          eq(identityWallets.identityId, identityId),
          eq(identityWallets.status, 'active')
        )
      );

    return wallets.map((w) => ({
      walletId: w.walletId,
      address: w.address,
      chainId: w.chainId,
      isPrimary: w.isPrimary,
      verifiedAt: w.verifiedAt,
      verificationSource: w.verificationSource,
      status: w.status as 'active' | 'removed',
    }));
  }

  /**
   * Remove a wallet from an identity (soft delete)
   */
  async removeWallet(params: RemoveWalletParams): Promise<void> {
    const { identityId, walletAddress, reason, source, actorId, requestId } = params;
    const normalizedAddress = walletAddress.toLowerCase();

    await this.db.transaction(async (tx) => {
      // Soft delete the wallet
      await tx
        .update(identityWallets)
        .set({
          status: 'removed',
          removedAt: new Date(),
          removedReason: reason,
        })
        .where(
          and(
            eq(identityWallets.identityId, identityId),
            eq(identityWallets.address, normalizedAddress),
            eq(identityWallets.status, 'active')
          )
        );

      // Record event
      await tx.insert(identityEvents).values({
        identityId,
        eventType: IdentityEventType.WALLET_REMOVED,
        eventData: {
          wallet_address: normalizedAddress,
          reason,
          removed_by: actorId,
        } as IdentityEventData,
        source,
        actorId,
        requestId,
      });

      // Clear primary wallet if this was the primary
      const identity = await tx
        .select()
        .from(userIdentities)
        .where(eq(userIdentities.identityId, identityId))
        .limit(1);

      if (identity[0]?.primaryWallet === normalizedAddress) {
        await tx
          .update(userIdentities)
          .set({
            primaryWallet: null,
            updatedAt: new Date(),
          })
          .where(eq(userIdentities.identityId, identityId));
      }
    });

    logger.info({ identityId, walletAddress: normalizedAddress, reason }, 'Wallet removed');
  }

  // ===========================================================================
  // Event History
  // ===========================================================================

  /**
   * Get complete event history for an identity
   */
  async getEventHistory(identityId: string): Promise<IdentityEventRecord[]> {
    const events = await this.db
      .select()
      .from(identityEvents)
      .where(eq(identityEvents.identityId, identityId))
      .orderBy(identityEvents.occurredAt);

    return events.map((e) => ({
      eventId: e.eventId,
      identityId: e.identityId,
      eventType: e.eventType as IdentityEventType,
      eventData: e.eventData as IdentityEventData,
      occurredAt: e.occurredAt,
      source: e.source as EventSource,
      actorId: e.actorId,
      requestId: e.requestId,
    }));
  }

  // ===========================================================================
  // Admin Operations
  // ===========================================================================

  /**
   * Suspend an identity (admin action)
   */
  async suspendIdentity(params: SuspendIdentityParams): Promise<void> {
    const { identityId, reason, suspendedBy, expiresAt, source, requestId } = params;

    await this.db.transaction(async (tx) => {
      // Update status
      await tx
        .update(userIdentities)
        .set({
          status: 'suspended',
          updatedAt: new Date(),
        })
        .where(eq(userIdentities.identityId, identityId));

      // Record event
      await tx.insert(identityEvents).values({
        identityId,
        eventType: IdentityEventType.IDENTITY_SUSPENDED,
        eventData: {
          reason,
          suspended_by: suspendedBy,
          expires_at: expiresAt?.toISOString(),
        } as IdentityEventData,
        source,
        actorId: suspendedBy,
        requestId,
      });
    });

    logger.info({ identityId, reason, suspendedBy }, 'Identity suspended');
  }

  /**
   * Restore a suspended identity (admin action)
   */
  async restoreIdentity(params: RestoreIdentityParams): Promise<void> {
    const { identityId, reason, restoredBy, source, requestId } = params;

    await this.db.transaction(async (tx) => {
      await tx
        .update(userIdentities)
        .set({
          status: 'active',
          updatedAt: new Date(),
        })
        .where(eq(userIdentities.identityId, identityId));

      await tx.insert(identityEvents).values({
        identityId,
        eventType: IdentityEventType.IDENTITY_RESTORED,
        eventData: {
          reason,
          restored_by: restoredBy,
        } as IdentityEventData,
        source,
        actorId: restoredBy,
        requestId,
      });
    });

    logger.info({ identityId, reason, restoredBy }, 'Identity restored');
  }

  /**
   * List users with pagination and search
   */
  async listUsers(params: ListUsersParams): Promise<PaginatedResult<IdentityWithWallets>> {
    const { page = 1, limit = 50, search, status } = params;
    const offset = (page - 1) * limit;

    // Build where conditions
    const conditions = [];
    if (status) {
      conditions.push(eq(userIdentities.status, status));
    }
    if (search) {
      conditions.push(
        or(
          ilike(userIdentities.discordId, `%${search}%`),
          ilike(userIdentities.discordUsername, `%${search}%`),
          ilike(userIdentities.primaryWallet, `%${search}%`)
        )
      );
    }

    // Get total count
    const countResult = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(userIdentities)
      .where(conditions.length > 0 ? and(...conditions) : undefined);

    const total = Number(countResult[0]?.count ?? 0);

    // Get paginated identities
    const identitiesResult = await this.db
      .select()
      .from(userIdentities)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(userIdentities.createdAt))
      .limit(limit)
      .offset(offset);

    // Get wallets for each identity
    const items: IdentityWithWallets[] = await Promise.all(
      identitiesResult.map(async (identity) => {
        const wallets = await this.db
          .select()
          .from(identityWallets)
          .where(
            and(
              eq(identityWallets.identityId, identity.identityId),
              eq(identityWallets.status, 'active')
            )
          );

        return {
          identity: {
            identityId: identity.identityId,
            discordId: identity.discordId,
            discordUsername: identity.discordUsername,
            discordDiscriminator: identity.discordDiscriminator,
            discordAvatarHash: identity.discordAvatarHash,
            primaryWallet: identity.primaryWallet,
            twitterHandle: identity.twitterHandle,
            telegramId: identity.telegramId,
            status: identity.status as 'active' | 'suspended' | 'deleted',
            createdAt: identity.createdAt,
            updatedAt: identity.updatedAt,
            version: identity.version,
          },
          wallets: wallets.map((w) => ({
            walletId: w.walletId,
            address: w.address,
            chainId: w.chainId,
            isPrimary: w.isPrimary,
            verifiedAt: w.verifiedAt,
            verificationSource: w.verificationSource,
            status: w.status as 'active' | 'removed',
          })),
        };
      })
    );

    return {
      items,
      total,
      page,
      limit,
      hasMore: offset + items.length < total,
    };
  }

  /**
   * Get total identity count
   */
  async getIdentityCount(): Promise<number> {
    const result = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(userIdentities);

    return Number(result[0]?.count ?? 0);
  }

  /**
   * Export all identities for backup/analysis
   */
  async exportIdentities(): Promise<IdentityWithWallets[]> {
    const identities = await this.db
      .select()
      .from(userIdentities)
      .orderBy(userIdentities.createdAt);

    return Promise.all(
      identities.map(async (identity) => {
        const wallets = await this.db
          .select()
          .from(identityWallets)
          .where(eq(identityWallets.identityId, identity.identityId));

        return {
          identity: {
            identityId: identity.identityId,
            discordId: identity.discordId,
            discordUsername: identity.discordUsername,
            discordDiscriminator: identity.discordDiscriminator,
            discordAvatarHash: identity.discordAvatarHash,
            primaryWallet: identity.primaryWallet,
            twitterHandle: identity.twitterHandle,
            telegramId: identity.telegramId,
            status: identity.status as 'active' | 'suspended' | 'deleted',
            createdAt: identity.createdAt,
            updatedAt: identity.updatedAt,
            version: identity.version,
          },
          wallets: wallets.map((w) => ({
            walletId: w.walletId,
            address: w.address,
            chainId: w.chainId,
            isPrimary: w.isPrimary,
            verifiedAt: w.verifiedAt,
            verificationSource: w.verificationSource,
            status: w.status as 'active' | 'removed',
          })),
        };
      })
    );
  }
}

// =============================================================================
// Singleton Instance Management
// =============================================================================

let userRegistryServiceInstance: UserRegistryService | null = null;
let userRegistryDb: PostgresJsDatabase | null = null;

/**
 * Set the database connection for the user registry service
 */
export function setUserRegistryDb(db: PostgresJsDatabase): void {
  userRegistryDb = db;
  userRegistryServiceInstance = new UserRegistryService(db);
  logger.info('User Registry Service initialized');
}

/**
 * Get the user registry service instance
 * @throws Error if service not initialized
 */
export function getUserRegistryService(): UserRegistryService {
  if (!userRegistryServiceInstance) {
    throw new Error('User Registry Service not initialized. Call setUserRegistryDb() first.');
  }
  return userRegistryServiceInstance;
}

/**
 * Check if user registry service is initialized
 */
export function isUserRegistryServiceInitialized(): boolean {
  return userRegistryServiceInstance !== null;
}

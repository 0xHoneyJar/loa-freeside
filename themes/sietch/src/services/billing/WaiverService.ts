/**
 * Waiver Service (v4.0 - Sprint 26)
 *
 * Manages platform-granted fee waivers for complimentary access:
 * - Grant waivers with tier, reason, and expiration
 * - Revoke waivers with audit trail
 * - List and query waivers
 * - Check active waiver status
 *
 * Waivers take priority over paid subscriptions in the GatekeeperService.
 * Only one active waiver per community is allowed.
 */

import { logger } from '../../utils/logger.js';
import {
  createFeeWaiver,
  revokeFeeWaiver as revokeWaiverQuery,
  getActiveFeeWaiver,
  getFeeWaiversByCommunity,
  getAllActiveFeeWaivers,
  logBillingAuditEvent,
} from '../../db/billing-queries.js';
import { gatekeeperService } from './GatekeeperService.js';
import type {
  FeeWaiver,
  SubscriptionTier,
} from '../../types/billing.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Parameters for granting a fee waiver
 */
export interface GrantWaiverParams {
  /** Community to grant waiver to */
  communityId: string;
  /** Tier to grant (default: enterprise) */
  tier?: SubscriptionTier;
  /** Reason for granting waiver */
  reason: string;
  /** Admin username who granted */
  grantedBy: string;
  /** Optional expiration date */
  expiresAt?: Date;
  /** Optional internal notes */
  internalNotes?: string;
}

/**
 * Parameters for revoking a fee waiver
 */
export interface RevokeWaiverParams {
  /** Community whose waiver to revoke */
  communityId: string;
  /** Reason for revoking */
  reason: string;
  /** Admin username who revoked */
  revokedBy: string;
}

/**
 * Parameters for listing waivers
 */
export interface ListWaiversParams {
  /** Include expired and revoked waivers */
  includeInactive?: boolean;
  /** Filter by community ID */
  communityId?: string;
}

/**
 * Result of granting a waiver
 */
export interface GrantWaiverResult {
  /** Created waiver ID */
  id: string;
  /** Waiver details */
  waiver: FeeWaiver;
  /** Whether previous waiver was revoked */
  previousWaiverRevoked: boolean;
}

// =============================================================================
// Waiver Service Class
// =============================================================================

class WaiverService {
  // ---------------------------------------------------------------------------
  // Grant Waiver
  // ---------------------------------------------------------------------------

  /**
   * Grant a fee waiver to a community
   *
   * If the community already has an active waiver, it will be revoked first.
   * Invalidates entitlement cache after granting.
   *
   * @param params - Waiver parameters
   * @returns Grant result with waiver details
   * @throws Error if validation fails
   */
  async grantWaiver(params: GrantWaiverParams): Promise<GrantWaiverResult> {
    const { communityId, tier = 'enterprise', reason, grantedBy, expiresAt, internalNotes } = params;

    // Validate inputs
    this.validateGrantParams(params);

    logger.info(
      { communityId, tier, grantedBy, expiresAt },
      'Granting fee waiver'
    );

    // Check for existing active waiver
    const existingWaiver = getActiveFeeWaiver(communityId);
    let previousWaiverRevoked = false;

    if (existingWaiver) {
      logger.info(
        { communityId, existingWaiverId: existingWaiver.id },
        'Revoking existing waiver before granting new one'
      );

      // Revoke existing waiver
      await this.revokeWaiver({
        communityId,
        reason: `Superseded by new waiver (${reason})`,
        revokedBy: grantedBy,
      });

      previousWaiverRevoked = true;
    }

    // Create new waiver
    const waiverId = createFeeWaiver({
      communityId,
      tier,
      reason,
      grantedBy,
      expiresAt,
    });

    // Get full waiver object
    const waiver = getActiveFeeWaiver(communityId);
    if (!waiver) {
      throw new Error('Failed to create waiver');
    }

    // Log audit event
    logBillingAuditEvent(
      'waiver_granted',
      {
        waiverId,
        communityId,
        tier,
        reason,
        grantedBy,
        expiresAt: expiresAt?.toISOString(),
        internalNotes,
        previousWaiverRevoked,
      },
      communityId,
      grantedBy
    );

    // Invalidate entitlement cache
    await gatekeeperService.invalidateCache(communityId);

    logger.info(
      { waiverId, communityId, tier },
      'Fee waiver granted successfully'
    );

    return {
      id: waiverId,
      waiver,
      previousWaiverRevoked,
    };
  }

  /**
   * Validate grant waiver parameters
   */
  private validateGrantParams(params: GrantWaiverParams): void {
    if (!params.communityId || params.communityId.trim() === '') {
      throw new Error('Community ID is required');
    }

    if (!params.reason || params.reason.trim() === '') {
      throw new Error('Reason is required');
    }

    if (params.reason.length < 10) {
      throw new Error('Reason must be at least 10 characters');
    }

    if (!params.grantedBy || params.grantedBy.trim() === '') {
      throw new Error('grantedBy is required');
    }

    // Validate tier
    const validTiers: SubscriptionTier[] = [
      'starter',
      'basic',
      'premium',
      'exclusive',
      'elite',
      'enterprise',
    ];
    if (params.tier && !validTiers.includes(params.tier)) {
      throw new Error(`Invalid tier: ${params.tier}`);
    }

    // Validate expiration date
    if (params.expiresAt && params.expiresAt < new Date()) {
      throw new Error('Expiration date must be in the future');
    }
  }

  // ---------------------------------------------------------------------------
  // Revoke Waiver
  // ---------------------------------------------------------------------------

  /**
   * Revoke an active fee waiver
   *
   * Invalidates entitlement cache after revoking.
   *
   * @param params - Revocation parameters
   * @returns Whether waiver was successfully revoked
   * @throws Error if no active waiver exists
   */
  async revokeWaiver(params: RevokeWaiverParams): Promise<boolean> {
    const { communityId, reason, revokedBy } = params;

    // Validate inputs
    this.validateRevokeParams(params);

    logger.info({ communityId, revokedBy }, 'Revoking fee waiver');

    // Get active waiver
    const waiver = getActiveFeeWaiver(communityId);
    if (!waiver) {
      throw new Error(`No active waiver found for community ${communityId}`);
    }

    // Revoke waiver
    const success = revokeWaiverQuery(waiver.id, {
      revokedBy,
      revokeReason: reason,
    });

    if (!success) {
      throw new Error('Failed to revoke waiver');
    }

    // Log audit event
    logBillingAuditEvent(
      'waiver_revoked',
      {
        waiverId: waiver.id,
        communityId,
        tier: waiver.tier,
        reason,
        revokedBy,
        originalReason: waiver.reason,
      },
      communityId,
      revokedBy
    );

    // Invalidate entitlement cache
    await gatekeeperService.invalidateCache(communityId);

    logger.info(
      { waiverId: waiver.id, communityId },
      'Fee waiver revoked successfully'
    );

    return true;
  }

  /**
   * Validate revoke waiver parameters
   */
  private validateRevokeParams(params: RevokeWaiverParams): void {
    if (!params.communityId || params.communityId.trim() === '') {
      throw new Error('Community ID is required');
    }

    if (!params.reason || params.reason.trim() === '') {
      throw new Error('Reason is required');
    }

    if (params.reason.length < 10) {
      throw new Error('Reason must be at least 10 characters');
    }

    if (!params.revokedBy || params.revokedBy.trim() === '') {
      throw new Error('revokedBy is required');
    }
  }

  // ---------------------------------------------------------------------------
  // Query Waivers
  // ---------------------------------------------------------------------------

  /**
   * Get active fee waiver for a community
   *
   * @param communityId - Community to check
   * @returns Active waiver or null
   */
  getWaiver(communityId: string): FeeWaiver | null {
    return getActiveFeeWaiver(communityId);
  }

  /**
   * List fee waivers with optional filtering
   *
   * @param params - List parameters
   * @returns Array of waivers
   */
  listWaivers(params?: ListWaiversParams): FeeWaiver[] {
    const { includeInactive = false, communityId } = params || {};

    if (communityId) {
      // Get all waivers for specific community
      const waivers = getFeeWaiversByCommunity(communityId);

      if (!includeInactive) {
        // Filter to only active waivers
        return waivers.filter(
          (w) => !w.revokedAt && (!w.expiresAt || w.expiresAt > new Date())
        );
      }

      return waivers;
    }

    // Get all active waivers across all communities
    if (!includeInactive) {
      return getAllActiveFeeWaivers();
    }

    // Cannot get all waivers (including inactive) without community filter
    // This would require adding a new query function
    throw new Error(
      'Cannot list all waivers (including inactive) without community filter'
    );
  }

  /**
   * Check if community has an active waiver
   *
   * @param communityId - Community to check
   * @returns Whether active waiver exists
   */
  hasActiveWaiver(communityId: string): boolean {
    const waiver = getActiveFeeWaiver(communityId);
    return !!waiver;
  }

  /**
   * Get waiver count (active waivers only)
   *
   * @returns Count of active waivers
   */
  getActiveWaiverCount(): number {
    return getAllActiveFeeWaivers().length;
  }

  // ---------------------------------------------------------------------------
  // Waiver Info
  // ---------------------------------------------------------------------------

  /**
   * Get detailed waiver information for a community
   *
   * @param communityId - Community to check
   * @returns Waiver info or null
   */
  getWaiverInfo(communityId: string): {
    hasWaiver: boolean;
    waiver?: FeeWaiver;
    isExpiringSoon?: boolean;
    daysUntilExpiry?: number;
  } {
    const waiver = getActiveFeeWaiver(communityId);

    if (!waiver) {
      return { hasWaiver: false };
    }

    // Check if expiring soon (within 7 days)
    let isExpiringSoon = false;
    let daysUntilExpiry: number | undefined;

    if (waiver.expiresAt) {
      const now = new Date();
      const expiresAt = new Date(waiver.expiresAt);
      const diffMs = expiresAt.getTime() - now.getTime();
      const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

      daysUntilExpiry = diffDays;
      isExpiringSoon = diffDays <= 7 && diffDays > 0;
    }

    return {
      hasWaiver: true,
      waiver,
      isExpiringSoon,
      daysUntilExpiry,
    };
  }
}

// =============================================================================
// Export Singleton
// =============================================================================

export const waiverService = new WaiverService();

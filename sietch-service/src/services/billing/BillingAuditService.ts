/**
 * Billing Audit Service (v4.0 - Sprint 26)
 *
 * Manages billing-specific audit logging:
 * - Log subscription events
 * - Log waiver events
 * - Log payment events
 * - Log feature denial events
 * - Query audit logs with filtering
 *
 * Audit logs are separate from main audit_log for billing-specific events.
 * Retention policy: 90 days by default (configurable).
 */

import { logger } from '../../utils/logger.js';
import {
  logBillingAuditEvent as logAuditEvent,
  getBillingAuditLog,
} from '../../db/billing-queries.js';
import type {
  BillingAuditEntry,
  BillingAuditEventType,
} from '../../types/billing.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Audit log query parameters
 */
export interface QueryAuditLogParams {
  /** Maximum number of entries to return */
  limit?: number;
  /** Filter by event type */
  eventType?: BillingAuditEventType;
  /** Filter by community ID */
  communityId?: string;
  /** Only events since this date */
  since?: Date;
}

/**
 * Audit log query result
 */
export interface AuditLogQueryResult {
  /** Audit log entries */
  entries: BillingAuditEntry[];
  /** Total count matching query */
  total: number;
  /** Whether more entries exist */
  hasMore: boolean;
}

// =============================================================================
// Billing Audit Service Class
// =============================================================================

class BillingAuditService {
  // ---------------------------------------------------------------------------
  // Logging Methods
  // ---------------------------------------------------------------------------

  /**
   * Log subscription created event
   */
  logSubscriptionCreated(data: {
    communityId: string;
    tier: string;
    stripeSubscriptionId?: string;
    actor?: string;
  }): number {
    return logAuditEvent(
      'subscription_created',
      {
        tier: data.tier,
        stripeSubscriptionId: data.stripeSubscriptionId,
      },
      data.communityId,
      data.actor
    );
  }

  /**
   * Log subscription updated event
   */
  logSubscriptionUpdated(data: {
    communityId: string;
    oldTier?: string;
    newTier?: string;
    changes: Record<string, unknown>;
    actor?: string;
  }): number {
    return logAuditEvent(
      'subscription_updated',
      {
        oldTier: data.oldTier,
        newTier: data.newTier,
        changes: data.changes,
      },
      data.communityId,
      data.actor
    );
  }

  /**
   * Log subscription canceled event
   */
  logSubscriptionCanceled(data: {
    communityId: string;
    tier: string;
    reason?: string;
    actor?: string;
  }): number {
    return logAuditEvent(
      'subscription_canceled',
      {
        tier: data.tier,
        reason: data.reason,
      },
      data.communityId,
      data.actor
    );
  }

  /**
   * Log payment succeeded event
   */
  logPaymentSucceeded(data: {
    communityId: string;
    amount: number;
    stripeInvoiceId?: string;
    tier: string;
  }): number {
    return logAuditEvent(
      'payment_succeeded',
      {
        amount: data.amount,
        stripeInvoiceId: data.stripeInvoiceId,
        tier: data.tier,
      },
      data.communityId
    );
  }

  /**
   * Log payment failed event
   */
  logPaymentFailed(data: {
    communityId: string;
    amount?: number;
    stripeInvoiceId?: string;
    error?: string;
    graceUntil?: Date;
  }): number {
    return logAuditEvent(
      'payment_failed',
      {
        amount: data.amount,
        stripeInvoiceId: data.stripeInvoiceId,
        error: data.error,
        graceUntil: data.graceUntil?.toISOString(),
      },
      data.communityId
    );
  }

  /**
   * Log grace period started event
   */
  logGracePeriodStarted(data: {
    communityId: string;
    tier: string;
    graceUntil: Date;
    reason: string;
  }): number {
    return logAuditEvent(
      'grace_period_started',
      {
        tier: data.tier,
        graceUntil: data.graceUntil.toISOString(),
        reason: data.reason,
      },
      data.communityId
    );
  }

  /**
   * Log grace period ended event
   */
  logGracePeriodEnded(data: {
    communityId: string;
    tier: string;
    outcome: 'payment_succeeded' | 'subscription_suspended';
  }): number {
    return logAuditEvent(
      'grace_period_ended',
      {
        tier: data.tier,
        outcome: data.outcome,
      },
      data.communityId
    );
  }

  /**
   * Log waiver granted event
   */
  logWaiverGranted(data: {
    communityId: string;
    waiverId: string;
    tier: string;
    reason: string;
    grantedBy: string;
    expiresAt?: Date;
  }): number {
    return logAuditEvent(
      'waiver_granted',
      {
        waiverId: data.waiverId,
        tier: data.tier,
        reason: data.reason,
        expiresAt: data.expiresAt?.toISOString(),
      },
      data.communityId,
      data.grantedBy
    );
  }

  /**
   * Log waiver revoked event
   */
  logWaiverRevoked(data: {
    communityId: string;
    waiverId: string;
    tier: string;
    reason: string;
    revokedBy: string;
  }): number {
    return logAuditEvent(
      'waiver_revoked',
      {
        waiverId: data.waiverId,
        tier: data.tier,
        reason: data.reason,
      },
      data.communityId,
      data.revokedBy
    );
  }

  /**
   * Log feature denied event
   */
  logFeatureDenied(data: {
    communityId: string;
    feature: string;
    currentTier: string;
    requiredTier: string;
    userId?: string;
  }): number {
    return logAuditEvent(
      'feature_denied',
      {
        feature: data.feature,
        currentTier: data.currentTier,
        requiredTier: data.requiredTier,
        userId: data.userId,
      },
      data.communityId
    );
  }

  /**
   * Log entitlement cached event
   */
  logEntitlementCached(data: {
    communityId: string;
    tier: string;
    source: string;
    features: string[];
  }): number {
    return logAuditEvent(
      'entitlement_cached',
      {
        tier: data.tier,
        source: data.source,
        featureCount: data.features.length,
      },
      data.communityId
    );
  }

  /**
   * Log webhook processed event
   */
  logWebhookProcessed(data: {
    communityId?: string;
    eventId: string;
    eventType: string;
    result: string;
  }): number {
    return logAuditEvent(
      'webhook_processed',
      {
        eventId: data.eventId,
        eventType: data.eventType,
        result: data.result,
      },
      data.communityId
    );
  }

  /**
   * Log webhook failed event
   */
  logWebhookFailed(data: {
    communityId?: string;
    eventId: string;
    eventType: string;
    error: string;
  }): number {
    return logAuditEvent(
      'webhook_failed',
      {
        eventId: data.eventId,
        eventType: data.eventType,
        error: data.error,
      },
      data.communityId
    );
  }

  // ---------------------------------------------------------------------------
  // Query Methods
  // ---------------------------------------------------------------------------

  /**
   * Query audit log entries with filtering
   *
   * @param params - Query parameters
   * @returns Query result with entries
   */
  queryAuditLog(params?: QueryAuditLogParams): AuditLogQueryResult {
    const {
      limit = 100,
      eventType,
      communityId,
      since,
    } = params || {};

    // Get entries from database
    const entries = getBillingAuditLog({
      limit: limit + 1, // Get one extra to check if more exist
      eventType,
      communityId,
      since,
    });

    // Check if more entries exist
    const hasMore = entries.length > limit;
    const resultEntries = hasMore ? entries.slice(0, limit) : entries;

    return {
      entries: resultEntries,
      total: resultEntries.length,
      hasMore,
    };
  }

  /**
   * Get recent audit entries for a community
   *
   * @param communityId - Community to get logs for
   * @param limit - Maximum entries to return
   * @returns Audit log entries
   */
  getCommunityAuditLog(communityId: string, limit: number = 50): BillingAuditEntry[] {
    return getBillingAuditLog({
      communityId,
      limit,
    });
  }

  /**
   * Get audit entries by event type
   *
   * @param eventType - Event type to filter by
   * @param limit - Maximum entries to return
   * @returns Audit log entries
   */
  getAuditLogByType(
    eventType: BillingAuditEventType,
    limit: number = 100
  ): BillingAuditEntry[] {
    return getBillingAuditLog({
      eventType,
      limit,
    });
  }

  /**
   * Get recent audit entries (all communities)
   *
   * @param limit - Maximum entries to return
   * @returns Audit log entries
   */
  getRecentAuditLog(limit: number = 100): BillingAuditEntry[] {
    return getBillingAuditLog({ limit });
  }

  /**
   * Get audit entries since a specific date
   *
   * @param since - Starting date
   * @param communityId - Optional community filter
   * @param limit - Maximum entries to return
   * @returns Audit log entries
   */
  getAuditLogSince(
    since: Date,
    communityId?: string,
    limit: number = 100
  ): BillingAuditEntry[] {
    return getBillingAuditLog({
      since,
      communityId,
      limit,
    });
  }

  // ---------------------------------------------------------------------------
  // Utility Methods
  // ---------------------------------------------------------------------------

  /**
   * Get audit log statistics
   *
   * @param communityId - Optional community filter
   * @returns Statistics object
   */
  getStatistics(communityId?: string): {
    eventCounts: Record<BillingAuditEventType, number>;
    totalEvents: number;
    oldestEvent?: Date;
    newestEvent?: Date;
  } {
    // Get all entries (limited to 1000 for performance)
    const entries = getBillingAuditLog({
      limit: 1000,
      communityId,
    });

    // Count events by type
    const eventCounts: Record<string, number> = {};
    let oldestEvent: Date | undefined;
    let newestEvent: Date | undefined;

    for (const entry of entries) {
      // Count by event type
      eventCounts[entry.eventType] = (eventCounts[entry.eventType] || 0) + 1;

      // Track oldest/newest
      if (!oldestEvent || entry.createdAt < oldestEvent) {
        oldestEvent = entry.createdAt;
      }
      if (!newestEvent || entry.createdAt > newestEvent) {
        newestEvent = entry.createdAt;
      }
    }

    return {
      eventCounts: eventCounts as Record<BillingAuditEventType, number>,
      totalEvents: entries.length,
      oldestEvent,
      newestEvent,
    };
  }

  /**
   * Log a generic billing audit event
   *
   * For use when specific methods don't cover the event type.
   *
   * @param eventType - Event type
   * @param eventData - Event data object
   * @param communityId - Optional community ID
   * @param actor - Optional actor
   * @returns Audit entry ID
   */
  logEvent(
    eventType: BillingAuditEventType,
    eventData: Record<string, unknown>,
    communityId?: string,
    actor?: string
  ): number {
    return logAuditEvent(eventType, eventData, communityId, actor);
  }
}

// =============================================================================
// Export Singleton
// =============================================================================

export const billingAuditService = new BillingAuditService();

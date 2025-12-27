/**
 * Billing Database Queries (v4.0 - Sprint 23)
 *
 * Database operations for the billing system:
 * - Subscription CRUD operations
 * - Fee waiver management
 * - Webhook event tracking
 * - Billing audit logging
 */

import { randomUUID } from 'crypto';
import { getDatabase } from './queries.js';
import { logger } from '../utils/logger.js';
import type {
  Subscription,
  CreateSubscriptionParams,
  UpdateSubscriptionParams,
  FeeWaiver,
  CreateFeeWaiverParams,
  RevokeFeeWaiverParams,
  WebhookEvent,
  BillingAuditEntry,
  BillingAuditEventType,
  SubscriptionTier,
  SubscriptionStatus,
} from '../types/billing.js';

// =============================================================================
// Row Type Definitions
// =============================================================================

interface SubscriptionRow {
  id: string;
  community_id: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  tier: string;
  status: string;
  grace_until: number | null;
  current_period_start: number | null;
  current_period_end: number | null;
  created_at: string;
  updated_at: string;
}

interface FeeWaiverRow {
  id: string;
  community_id: string;
  tier: string;
  reason: string;
  granted_by: string;
  granted_at: string;
  expires_at: string | null;
  revoked_at: string | null;
  revoked_by: string | null;
  revoke_reason: string | null;
  created_at: string;
  updated_at: string;
}

interface WebhookEventRow {
  id: string;
  stripe_event_id: string;
  event_type: string;
  status: string;
  payload: string;
  error_message: string | null;
  received_at: string;
  processed_at: string | null;
  created_at: string;
}

interface BillingAuditRow {
  id: number;
  event_type: string;
  community_id: string | null;
  event_data: string;
  actor: string | null;
  created_at: string;
}

// =============================================================================
// Row to Object Converters
// =============================================================================

function rowToSubscription(row: SubscriptionRow): Subscription {
  return {
    id: row.id,
    communityId: row.community_id,
    stripeCustomerId: row.stripe_customer_id ?? undefined,
    stripeSubscriptionId: row.stripe_subscription_id ?? undefined,
    tier: row.tier as SubscriptionTier,
    status: row.status as SubscriptionStatus,
    graceUntil: row.grace_until ? new Date(row.grace_until * 1000) : undefined,
    currentPeriodStart: row.current_period_start
      ? new Date(row.current_period_start * 1000)
      : undefined,
    currentPeriodEnd: row.current_period_end
      ? new Date(row.current_period_end * 1000)
      : undefined,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

function rowToFeeWaiver(row: FeeWaiverRow): FeeWaiver {
  return {
    id: row.id,
    communityId: row.community_id,
    tier: row.tier as SubscriptionTier,
    reason: row.reason,
    grantedBy: row.granted_by,
    grantedAt: new Date(row.granted_at),
    expiresAt: row.expires_at ? new Date(row.expires_at) : undefined,
    revokedAt: row.revoked_at ? new Date(row.revoked_at) : undefined,
    revokedBy: row.revoked_by ?? undefined,
    revokeReason: row.revoke_reason ?? undefined,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

function rowToWebhookEvent(row: WebhookEventRow): WebhookEvent {
  return {
    id: row.id,
    stripeEventId: row.stripe_event_id,
    eventType: row.event_type,
    status: row.status as WebhookEvent['status'],
    payload: row.payload,
    errorMessage: row.error_message ?? undefined,
    receivedAt: new Date(row.received_at),
    processedAt: row.processed_at ? new Date(row.processed_at) : undefined,
    createdAt: new Date(row.created_at),
  };
}

function rowToBillingAuditEntry(row: BillingAuditRow): BillingAuditEntry {
  return {
    id: row.id,
    eventType: row.event_type as BillingAuditEventType,
    communityId: row.community_id ?? undefined,
    eventData: JSON.parse(row.event_data),
    actor: row.actor ?? undefined,
    createdAt: new Date(row.created_at),
  };
}

// =============================================================================
// Subscription Queries
// =============================================================================

/**
 * Get subscription by community ID
 */
export function getSubscriptionByCommunityId(
  communityId: string
): Subscription | null {
  const db = getDatabase();

  const row = db
    .prepare('SELECT * FROM subscriptions WHERE community_id = ?')
    .get(communityId) as SubscriptionRow | undefined;

  return row ? rowToSubscription(row) : null;
}

/**
 * Get subscription by Stripe subscription ID
 */
export function getSubscriptionByStripeId(
  stripeSubscriptionId: string
): Subscription | null {
  const db = getDatabase();

  const row = db
    .prepare('SELECT * FROM subscriptions WHERE stripe_subscription_id = ?')
    .get(stripeSubscriptionId) as SubscriptionRow | undefined;

  return row ? rowToSubscription(row) : null;
}

/**
 * Get subscription by ID
 */
export function getSubscriptionById(id: string): Subscription | null {
  const db = getDatabase();

  const row = db
    .prepare('SELECT * FROM subscriptions WHERE id = ?')
    .get(id) as SubscriptionRow | undefined;

  return row ? rowToSubscription(row) : null;
}

/**
 * Create a new subscription
 */
export function createSubscription(params: CreateSubscriptionParams): string {
  const db = getDatabase();
  const id = randomUUID();

  db.prepare(`
    INSERT INTO subscriptions (
      id, community_id, stripe_customer_id, stripe_subscription_id, tier, status
    ) VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    id,
    params.communityId,
    params.stripeCustomerId ?? null,
    params.stripeSubscriptionId ?? null,
    params.tier ?? 'starter',
    params.status ?? 'active'
  );

  logger.info({ id, communityId: params.communityId }, 'Created subscription');

  return id;
}

/**
 * Update an existing subscription
 */
export function updateSubscription(
  communityId: string,
  params: UpdateSubscriptionParams
): boolean {
  const db = getDatabase();

  const sets: string[] = ['updated_at = datetime(\'now\')'];
  const values: (string | number | null)[] = [];

  if (params.stripeCustomerId !== undefined) {
    sets.push('stripe_customer_id = ?');
    values.push(params.stripeCustomerId ?? null);
  }

  if (params.stripeSubscriptionId !== undefined) {
    sets.push('stripe_subscription_id = ?');
    values.push(params.stripeSubscriptionId ?? null);
  }

  if (params.tier !== undefined) {
    sets.push('tier = ?');
    values.push(params.tier);
  }

  if (params.status !== undefined) {
    sets.push('status = ?');
    values.push(params.status);
  }

  if (params.graceUntil !== undefined) {
    sets.push('grace_until = ?');
    values.push(params.graceUntil ? Math.floor(params.graceUntil.getTime() / 1000) : null);
  }

  if (params.currentPeriodStart !== undefined) {
    sets.push('current_period_start = ?');
    values.push(params.currentPeriodStart ? Math.floor(params.currentPeriodStart.getTime() / 1000) : null);
  }

  if (params.currentPeriodEnd !== undefined) {
    sets.push('current_period_end = ?');
    values.push(params.currentPeriodEnd ? Math.floor(params.currentPeriodEnd.getTime() / 1000) : null);
  }

  values.push(communityId);

  const result = db
    .prepare(`UPDATE subscriptions SET ${sets.join(', ')} WHERE community_id = ?`)
    .run(...values);

  if (result.changes > 0) {
    logger.info({ communityId, params }, 'Updated subscription');
    return true;
  }

  return false;
}

/**
 * Delete subscription by community ID (use with caution)
 */
export function deleteSubscription(communityId: string): boolean {
  const db = getDatabase();

  const result = db
    .prepare('DELETE FROM subscriptions WHERE community_id = ?')
    .run(communityId);

  if (result.changes > 0) {
    logger.info({ communityId }, 'Deleted subscription');
    return true;
  }

  return false;
}

/**
 * Get all subscriptions in grace period
 */
export function getSubscriptionsInGracePeriod(): Subscription[] {
  const db = getDatabase();
  const now = Math.floor(Date.now() / 1000);

  const rows = db
    .prepare(`
      SELECT * FROM subscriptions
      WHERE grace_until IS NOT NULL AND grace_until > ?
      ORDER BY grace_until ASC
    `)
    .all(now) as SubscriptionRow[];

  return rows.map(rowToSubscription);
}

/**
 * Get subscriptions with expired grace period
 */
export function getExpiredGracePeriodSubscriptions(): Subscription[] {
  const db = getDatabase();
  const now = Math.floor(Date.now() / 1000);

  const rows = db
    .prepare(`
      SELECT * FROM subscriptions
      WHERE grace_until IS NOT NULL AND grace_until <= ?
        AND status != 'unpaid'
      ORDER BY grace_until ASC
    `)
    .all(now) as SubscriptionRow[];

  return rows.map(rowToSubscription);
}

// =============================================================================
// Fee Waiver Queries
// =============================================================================

/**
 * Get active fee waiver for a community
 * Returns the waiver with highest tier if multiple exist
 */
export function getActiveFeeWaiver(communityId: string): FeeWaiver | null {
  const db = getDatabase();
  const now = new Date().toISOString();

  const row = db
    .prepare(`
      SELECT * FROM fee_waivers
      WHERE community_id = ?
        AND revoked_at IS NULL
        AND (expires_at IS NULL OR expires_at > ?)
      ORDER BY
        CASE tier
          WHEN 'enterprise' THEN 6
          WHEN 'elite' THEN 5
          WHEN 'exclusive' THEN 4
          WHEN 'premium' THEN 3
          WHEN 'basic' THEN 2
          WHEN 'starter' THEN 1
          ELSE 0
        END DESC
      LIMIT 1
    `)
    .get(communityId, now) as FeeWaiverRow | undefined;

  return row ? rowToFeeWaiver(row) : null;
}

/**
 * Get all fee waivers for a community (including inactive)
 */
export function getFeeWaiversByCommunity(communityId: string): FeeWaiver[] {
  const db = getDatabase();

  const rows = db
    .prepare(`
      SELECT * FROM fee_waivers
      WHERE community_id = ?
      ORDER BY granted_at DESC
    `)
    .all(communityId) as FeeWaiverRow[];

  return rows.map(rowToFeeWaiver);
}

/**
 * Create a new fee waiver
 */
export function createFeeWaiver(params: CreateFeeWaiverParams): string {
  const db = getDatabase();
  const id = randomUUID();

  db.prepare(`
    INSERT INTO fee_waivers (
      id, community_id, tier, reason, granted_by, expires_at
    ) VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    id,
    params.communityId,
    params.tier,
    params.reason,
    params.grantedBy,
    params.expiresAt?.toISOString() ?? null
  );

  logger.info(
    { id, communityId: params.communityId, tier: params.tier },
    'Created fee waiver'
  );

  return id;
}

/**
 * Revoke a fee waiver
 */
export function revokeFeeWaiver(
  waiverId: string,
  params: RevokeFeeWaiverParams
): boolean {
  const db = getDatabase();

  const result = db
    .prepare(`
      UPDATE fee_waivers
      SET revoked_at = datetime('now'),
          revoked_by = ?,
          revoke_reason = ?,
          updated_at = datetime('now')
      WHERE id = ? AND revoked_at IS NULL
    `)
    .run(params.revokedBy, params.revokeReason, waiverId);

  if (result.changes > 0) {
    logger.info({ waiverId, revokedBy: params.revokedBy }, 'Revoked fee waiver');
    return true;
  }

  return false;
}

/**
 * Get all active fee waivers
 */
export function getAllActiveFeeWaivers(): FeeWaiver[] {
  const db = getDatabase();
  const now = new Date().toISOString();

  const rows = db
    .prepare(`
      SELECT * FROM fee_waivers
      WHERE revoked_at IS NULL
        AND (expires_at IS NULL OR expires_at > ?)
      ORDER BY granted_at DESC
    `)
    .all(now) as FeeWaiverRow[];

  return rows.map(rowToFeeWaiver);
}

// =============================================================================
// Webhook Event Queries
// =============================================================================

/**
 * Check if a webhook event has been processed (idempotency check)
 */
export function isWebhookEventProcessed(stripeEventId: string): boolean {
  const db = getDatabase();

  const row = db
    .prepare('SELECT 1 FROM webhook_events WHERE stripe_event_id = ?')
    .get(stripeEventId);

  return !!row;
}

/**
 * Record a webhook event
 */
export function recordWebhookEvent(
  stripeEventId: string,
  eventType: string,
  payload: string,
  status: 'processing' | 'processed' | 'failed' = 'processed',
  errorMessage?: string
): string {
  const db = getDatabase();
  const id = randomUUID();

  db.prepare(`
    INSERT INTO webhook_events (
      id, stripe_event_id, event_type, status, payload, error_message, processed_at
    ) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
  `).run(id, stripeEventId, eventType, status, payload, errorMessage ?? null);

  logger.debug({ id, stripeEventId, eventType, status }, 'Recorded webhook event');

  return id;
}

/**
 * Update webhook event status
 */
export function updateWebhookEventStatus(
  stripeEventId: string,
  status: 'processing' | 'processed' | 'failed',
  errorMessage?: string
): boolean {
  const db = getDatabase();

  const result = db
    .prepare(`
      UPDATE webhook_events
      SET status = ?,
          error_message = ?,
          processed_at = datetime('now')
      WHERE stripe_event_id = ?
    `)
    .run(status, errorMessage ?? null, stripeEventId);

  return result.changes > 0;
}

/**
 * Get failed webhook events (for retry)
 */
export function getFailedWebhookEvents(limit: number = 100): WebhookEvent[] {
  const db = getDatabase();

  const rows = db
    .prepare(`
      SELECT * FROM webhook_events
      WHERE status = 'failed'
      ORDER BY received_at DESC
      LIMIT ?
    `)
    .all(limit) as WebhookEventRow[];

  return rows.map(rowToWebhookEvent);
}

/**
 * Get webhook event by Stripe event ID
 */
export function getWebhookEvent(stripeEventId: string): WebhookEvent | null {
  const db = getDatabase();

  const row = db
    .prepare('SELECT * FROM webhook_events WHERE stripe_event_id = ?')
    .get(stripeEventId) as WebhookEventRow | undefined;

  return row ? rowToWebhookEvent(row) : null;
}

// =============================================================================
// Billing Audit Log Queries
// =============================================================================

/**
 * Log a billing audit event
 */
export function logBillingAuditEvent(
  eventType: BillingAuditEventType,
  eventData: Record<string, unknown>,
  communityId?: string,
  actor?: string
): number {
  const db = getDatabase();

  const result = db
    .prepare(`
      INSERT INTO billing_audit_log (event_type, community_id, event_data, actor)
      VALUES (?, ?, ?, ?)
    `)
    .run(eventType, communityId ?? null, JSON.stringify(eventData), actor ?? null);

  return result.lastInsertRowid as number;
}

/**
 * Get billing audit log entries
 */
export function getBillingAuditLog(options: {
  limit?: number;
  eventType?: BillingAuditEventType;
  communityId?: string;
  since?: Date;
}): BillingAuditEntry[] {
  const db = getDatabase();
  const { limit = 100, eventType, communityId, since } = options;

  let query = 'SELECT * FROM billing_audit_log WHERE 1=1';
  const params: (string | number)[] = [];

  if (eventType) {
    query += ' AND event_type = ?';
    params.push(eventType);
  }

  if (communityId) {
    query += ' AND community_id = ?';
    params.push(communityId);
  }

  if (since) {
    query += ' AND created_at >= ?';
    params.push(since.toISOString());
  }

  query += ' ORDER BY created_at DESC LIMIT ?';
  params.push(limit);

  const rows = db.prepare(query).all(...params) as BillingAuditRow[];

  return rows.map(rowToBillingAuditEntry);
}

// =============================================================================
// Combined Entitlement Query
// =============================================================================

/**
 * Get effective tier for a community
 * Priority: Active waiver > Active subscription > Free tier
 */
export function getEffectiveTier(
  communityId: string
): { tier: SubscriptionTier; source: 'subscription' | 'waiver' | 'free' } {
  // Check for active waiver first
  const waiver = getActiveFeeWaiver(communityId);
  if (waiver) {
    return { tier: waiver.tier, source: 'waiver' };
  }

  // Check for active subscription
  const subscription = getSubscriptionByCommunityId(communityId);
  if (subscription && subscription.status === 'active') {
    return { tier: subscription.tier, source: 'subscription' };
  }

  // Check for subscription in grace period
  if (subscription && subscription.status === 'past_due' && subscription.graceUntil) {
    if (subscription.graceUntil > new Date()) {
      return { tier: subscription.tier, source: 'subscription' };
    }
  }

  // Default to free tier
  return { tier: 'starter', source: 'free' };
}

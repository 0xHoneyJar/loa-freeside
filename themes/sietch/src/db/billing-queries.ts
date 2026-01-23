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
import { getDatabase } from './connection.js';
import { logger } from '../utils/logger.js';
import { validateSubscriptionColumn } from '../utils/sql-safety.js';
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
  CryptoPayment,
  CryptoPaymentStatus,
  CryptoCurrency,
  CreateCryptoPaymentParams,
  UpdateCryptoPaymentParams,
  ListCryptoPaymentsOptions,
} from '../types/billing.js';

// =============================================================================
// Row Type Definitions
// =============================================================================

interface SubscriptionRow {
  id: string;
  community_id: string;
  payment_customer_id: string | null;
  payment_subscription_id: string | null;
  payment_provider: string;
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
  provider_event_id: string;
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

// Sprint 155: Crypto Payment Row
interface CryptoPaymentRow {
  id: string;
  payment_id: string;
  community_id: string;
  tier: string;
  price_amount: string;
  price_currency: string;
  pay_amount: string | null;
  pay_currency: string | null;
  pay_address: string | null;
  status: string;
  actually_paid: string | null;
  order_id: string | null;
  created_at: string;
  updated_at: string;
  expires_at: string | null;
  finished_at: string | null;
}

// =============================================================================
// Row to Object Converters
// =============================================================================

function rowToSubscription(row: SubscriptionRow): Subscription {
  return {
    id: row.id,
    communityId: row.community_id,
    paymentCustomerId: row.payment_customer_id ?? undefined,
    paymentSubscriptionId: row.payment_subscription_id ?? undefined,
    paymentProvider: row.payment_provider as 'paddle' | 'stripe' | 'nowpayments',
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
    providerEventId: row.provider_event_id,
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

// Sprint 155: Crypto Payment Converter
function rowToCryptoPayment(row: CryptoPaymentRow): CryptoPayment {
  return {
    id: row.id,
    paymentId: row.payment_id,
    communityId: row.community_id,
    tier: row.tier as SubscriptionTier,
    priceAmount: parseFloat(row.price_amount),
    priceCurrency: row.price_currency as 'usd',
    payAmount: row.pay_amount ? parseFloat(row.pay_amount) : undefined,
    payCurrency: row.pay_currency ? (row.pay_currency as CryptoCurrency) : undefined,
    payAddress: row.pay_address ?? undefined,
    status: row.status as CryptoPaymentStatus,
    actuallyPaid: row.actually_paid ? parseFloat(row.actually_paid) : undefined,
    orderId: row.order_id ?? undefined,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    expiresAt: row.expires_at ? new Date(row.expires_at) : undefined,
    finishedAt: row.finished_at ? new Date(row.finished_at) : undefined,
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
 * Get subscription by payment subscription ID
 */
export function getSubscriptionByPaymentId(
  paymentSubscriptionId: string
): Subscription | null {
  const db = getDatabase();

  const row = db
    .prepare('SELECT * FROM subscriptions WHERE payment_subscription_id = ?')
    .get(paymentSubscriptionId) as SubscriptionRow | undefined;

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
      id, community_id, payment_customer_id, payment_subscription_id, payment_provider, tier, status,
      current_period_start, current_period_end
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    params.communityId,
    params.paymentCustomerId ?? null,
    params.paymentSubscriptionId ?? null,
    params.paymentProvider ?? 'paddle',
    params.tier ?? 'starter',
    params.status ?? 'active',
    params.currentPeriodStart ? Math.floor(params.currentPeriodStart.getTime() / 1000) : null,
    params.currentPeriodEnd ? Math.floor(params.currentPeriodEnd.getTime() / 1000) : null
  );

  logger.info({ id, communityId: params.communityId }, 'Created subscription');

  return id;
}

/**
 * Update an existing subscription
 *
 * Uses column whitelist to prevent SQL injection (CRIT-3 fix)
 */
export function updateSubscription(
  communityId: string,
  params: UpdateSubscriptionParams
): boolean {
  const db = getDatabase();

  // CRIT-3 FIX: All column names validated through whitelist
  const sets: string[] = ["updated_at = datetime('now')"];
  const values: (string | number | null)[] = [];

  if (params.paymentCustomerId !== undefined) {
    const col = validateSubscriptionColumn('payment_customer_id');
    sets.push(`${col} = ?`);
    values.push(params.paymentCustomerId ?? null);
  }

  if (params.paymentSubscriptionId !== undefined) {
    const col = validateSubscriptionColumn('payment_subscription_id');
    sets.push(`${col} = ?`);
    values.push(params.paymentSubscriptionId ?? null);
  }

  if (params.paymentProvider !== undefined) {
    const col = validateSubscriptionColumn('payment_provider');
    sets.push(`${col} = ?`);
    values.push(params.paymentProvider);
  }

  if (params.tier !== undefined) {
    const col = validateSubscriptionColumn('tier');
    sets.push(`${col} = ?`);
    values.push(params.tier);
  }

  if (params.status !== undefined) {
    const col = validateSubscriptionColumn('status');
    sets.push(`${col} = ?`);
    values.push(params.status);
  }

  if (params.graceUntil !== undefined) {
    const col = validateSubscriptionColumn('grace_until');
    sets.push(`${col} = ?`);
    values.push(params.graceUntil ? Math.floor(params.graceUntil.getTime() / 1000) : null);
  }

  if (params.currentPeriodStart !== undefined) {
    const col = validateSubscriptionColumn('current_period_start');
    sets.push(`${col} = ?`);
    values.push(
      params.currentPeriodStart ? Math.floor(params.currentPeriodStart.getTime() / 1000) : null
    );
  }

  if (params.currentPeriodEnd !== undefined) {
    const col = validateSubscriptionColumn('current_period_end');
    sets.push(`${col} = ?`);
    values.push(
      params.currentPeriodEnd ? Math.floor(params.currentPeriodEnd.getTime() / 1000) : null
    );
  }

  values.push(communityId);

  // Safe: all column names are validated through whitelist
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
export function isWebhookEventProcessed(providerEventId: string): boolean {
  const db = getDatabase();

  const row = db
    .prepare('SELECT 1 FROM webhook_events WHERE provider_event_id = ?')
    .get(providerEventId);

  return !!row;
}

/**
 * Record a webhook event
 */
export function recordWebhookEvent(
  providerEventId: string,
  eventType: string,
  payload: string,
  status: 'processing' | 'processed' | 'failed' = 'processed',
  errorMessage?: string
): string {
  const db = getDatabase();
  const id = randomUUID();

  db.prepare(`
    INSERT INTO webhook_events (
      id, provider_event_id, event_type, status, payload, error_message, processed_at
    ) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
  `).run(id, providerEventId, eventType, status, payload, errorMessage ?? null);

  logger.debug({ id, providerEventId, eventType, status }, 'Recorded webhook event');

  return id;
}

/**
 * Update webhook event status
 */
export function updateWebhookEventStatus(
  providerEventId: string,
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
      WHERE provider_event_id = ?
    `)
    .run(status, errorMessage ?? null, providerEventId);

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
 * Get webhook event by provider event ID
 */
export function getWebhookEvent(providerEventId: string): WebhookEvent | null {
  const db = getDatabase();

  const row = db
    .prepare('SELECT * FROM webhook_events WHERE provider_event_id = ?')
    .get(providerEventId) as WebhookEventRow | undefined;

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

// =============================================================================
// Crypto Payment Queries (Sprint 155: NOWPayments Integration)
// =============================================================================

/**
 * Create a new crypto payment record
 * Called when a payment is created via NOWPayments API
 */
export function createCryptoPayment(params: CreateCryptoPaymentParams): string {
  const db = getDatabase();
  const id = `cp_${randomUUID()}`;

  db.prepare(`
    INSERT INTO crypto_payments (
      id, payment_id, community_id, tier, price_amount, price_currency,
      pay_amount, pay_currency, pay_address, status, order_id, expires_at
    ) VALUES (?, ?, ?, ?, ?, 'usd', ?, ?, ?, 'waiting', ?, ?)
  `).run(
    id,
    params.paymentId,
    params.communityId,
    params.tier,
    params.priceAmount,
    params.payAmount ?? null,
    params.payCurrency ?? null,
    params.payAddress ?? null,
    params.orderId ?? null,
    params.expiresAt?.toISOString() ?? null
  );

  logger.info(
    { id, paymentId: params.paymentId, communityId: params.communityId, tier: params.tier },
    'Created crypto payment'
  );

  return id;
}

/**
 * Get crypto payment by NOWPayments payment_id
 * Used for webhook processing to find the associated payment
 */
export function getCryptoPaymentByPaymentId(paymentId: string): CryptoPayment | null {
  const db = getDatabase();

  const row = db
    .prepare('SELECT * FROM crypto_payments WHERE payment_id = ?')
    .get(paymentId) as CryptoPaymentRow | undefined;

  return row ? rowToCryptoPayment(row) : null;
}

/**
 * Get crypto payment by internal ID (cp_xxx)
 */
export function getCryptoPaymentById(id: string): CryptoPayment | null {
  const db = getDatabase();

  const row = db
    .prepare('SELECT * FROM crypto_payments WHERE id = ?')
    .get(id) as CryptoPaymentRow | undefined;

  return row ? rowToCryptoPayment(row) : null;
}

/**
 * Get crypto payment by order ID (our internal reference)
 */
export function getCryptoPaymentByOrderId(orderId: string): CryptoPayment | null {
  const db = getDatabase();

  const row = db
    .prepare('SELECT * FROM crypto_payments WHERE order_id = ?')
    .get(orderId) as CryptoPaymentRow | undefined;

  return row ? rowToCryptoPayment(row) : null;
}

/**
 * Update crypto payment status
 * Called when webhook receives status update from NOWPayments
 */
export function updateCryptoPaymentStatus(
  paymentId: string,
  params: UpdateCryptoPaymentParams
): boolean {
  const db = getDatabase();

  const sets: string[] = ["updated_at = datetime('now')"];
  const values: (string | number | null)[] = [];

  if (params.status !== undefined) {
    sets.push('status = ?');
    values.push(params.status);
  }

  if (params.actuallyPaid !== undefined) {
    sets.push('actually_paid = ?');
    values.push(params.actuallyPaid);
  }

  if (params.finishedAt !== undefined) {
    sets.push('finished_at = ?');
    values.push(params.finishedAt.toISOString());
  }

  values.push(paymentId);

  const result = db
    .prepare(`UPDATE crypto_payments SET ${sets.join(', ')} WHERE payment_id = ?`)
    .run(...values);

  if (result.changes > 0) {
    logger.info({ paymentId, ...params }, 'Updated crypto payment status');
    return true;
  }

  return false;
}

/**
 * List crypto payments with optional filters
 */
export function listCryptoPayments(options: ListCryptoPaymentsOptions = {}): CryptoPayment[] {
  const db = getDatabase();
  const { communityId, status, limit = 100, offset = 0 } = options;

  let query = 'SELECT * FROM crypto_payments WHERE 1=1';
  const params: (string | number)[] = [];

  if (communityId) {
    query += ' AND community_id = ?';
    params.push(communityId);
  }

  if (status) {
    query += ' AND status = ?';
    params.push(status);
  }

  query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const rows = db.prepare(query).all(...params) as CryptoPaymentRow[];

  return rows.map(rowToCryptoPayment);
}

/**
 * Get pending crypto payments for a community
 * Useful for checking if there's an existing pending payment
 */
export function getPendingCryptoPayments(communityId: string): CryptoPayment[] {
  const db = getDatabase();

  const rows = db
    .prepare(`
      SELECT * FROM crypto_payments
      WHERE community_id = ?
        AND status IN ('waiting', 'confirming', 'confirmed', 'sending')
        AND (expires_at IS NULL OR expires_at > datetime('now'))
      ORDER BY created_at DESC
    `)
    .all(communityId) as CryptoPaymentRow[];

  return rows.map(rowToCryptoPayment);
}

/**
 * Get expired crypto payments that need cleanup
 */
export function getExpiredCryptoPayments(): CryptoPayment[] {
  const db = getDatabase();

  const rows = db
    .prepare(`
      SELECT * FROM crypto_payments
      WHERE status = 'waiting'
        AND expires_at IS NOT NULL
        AND expires_at <= datetime('now')
      ORDER BY expires_at ASC
    `)
    .all() as CryptoPaymentRow[];

  return rows.map(rowToCryptoPayment);
}

/**
 * Mark expired payments as expired
 * Called periodically to clean up stale payments
 */
export function markExpiredCryptoPayments(): number {
  const db = getDatabase();

  const result = db
    .prepare(`
      UPDATE crypto_payments
      SET status = 'expired', updated_at = datetime('now')
      WHERE status = 'waiting'
        AND expires_at IS NOT NULL
        AND expires_at <= datetime('now')
    `)
    .run();

  if (result.changes > 0) {
    logger.info({ count: result.changes }, 'Marked crypto payments as expired');
  }

  return result.changes;
}

/**
 * Get successfully completed crypto payments for a community
 */
export function getCompletedCryptoPayments(communityId: string): CryptoPayment[] {
  const db = getDatabase();

  const rows = db
    .prepare(`
      SELECT * FROM crypto_payments
      WHERE community_id = ?
        AND status = 'finished'
      ORDER BY finished_at DESC
    `)
    .all(communityId) as CryptoPaymentRow[];

  return rows.map(rowToCryptoPayment);
}

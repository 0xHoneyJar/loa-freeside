/**
 * Webhook Routes — Payout Provider Webhook Handler
 *
 * POST /api/webhooks/payout — HMAC-SHA-512 verified webhook
 *
 * Features:
 *   - HMAC-SHA-512 signature verification with key-sort canonicalization
 *   - 5-minute timestamp window for replay protection
 *   - DB-backed replay protection via webhook_events UNIQUE(provider, id)
 *   - State transitions via PayoutStateMachine
 *   - Always returns 200 OK (provider should not retry on our errors)
 *
 * SDD refs: §4.4 PayoutService
 * Sprint refs: Task 10.1
 *
 * @module api/routes/webhook.routes
 */

import { createHmac } from 'crypto';
import { Router, type Request, type Response } from 'express';
import { logger } from '../../utils/logger.js';
import type { PayoutStateMachine } from '../../packages/adapters/billing/PayoutStateMachine.js';
import type Database from 'better-sqlite3';

// =============================================================================
// Types
// =============================================================================

export interface WebhookPayload {
  /** Provider-assigned event ID */
  id: string;
  /** Event type (e.g. 'payout_completed', 'payout_failed') */
  type: string;
  /** Provider payout ID */
  payout_id: string;
  /** Payout status from provider */
  status: string;
  /** ISO timestamp from provider */
  timestamp: string;
  /** Additional data */
  data?: Record<string, unknown>;
}

/** Terminal statuses that mean payout is done */
const TERMINAL_COMPLETED = ['finished', 'completed', 'confirmed'];
const TERMINAL_FAILED = ['failed', 'expired', 'rejected', 'error'];
const RETRYABLE_FAILED = ['sending_failed'];

// =============================================================================
// Router Setup
// =============================================================================

export const webhookRouter = Router();

let stateMachine: PayoutStateMachine | null = null;
let webhookDb: Database.Database | null = null;
let webhookSecret: string = '';

export function setWebhookDeps(deps: {
  stateMachine: PayoutStateMachine;
  db: Database.Database;
  secret: string;
}): void {
  stateMachine = deps.stateMachine;
  webhookDb = deps.db;
  webhookSecret = deps.secret;
}

// =============================================================================
// Webhook Handler
// =============================================================================

/**
 * Verify HMAC-SHA-512 signature.
 * Canonicalizes payload by sorting keys alphabetically.
 */
export function verifyWebhookSignature(
  payload: Record<string, unknown>,
  signature: string,
  secret: string,
): boolean {
  if (!signature || !secret) return false;

  const canonical = canonicalize(payload);
  const expected = createHmac('sha512', secret)
    .update(canonical)
    .digest('hex');

  // Constant-time comparison
  if (expected.length !== signature.length) return false;
  let mismatch = 0;
  for (let i = 0; i < expected.length; i++) {
    mismatch |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return mismatch === 0;
}

/**
 * Canonicalize payload by sorting keys at all levels.
 */
function canonicalize(obj: unknown): string {
  if (obj === null || obj === undefined) return '';
  if (typeof obj !== 'object') return String(obj);
  if (Array.isArray(obj)) {
    return '[' + obj.map(canonicalize).join(',') + ']';
  }
  const sorted = Object.keys(obj as Record<string, unknown>).sort();
  const pairs = sorted.map(
    (k) => `"${k}":${canonicalize((obj as Record<string, unknown>)[k])}`,
  );
  return '{' + pairs.join(',') + '}';
}

/**
 * Check if timestamp is within the acceptable window.
 */
function isTimestampValid(timestamp: string, windowMs: number = 5 * 60 * 1000): boolean {
  const eventTime = new Date(timestamp).getTime();
  if (isNaN(eventTime)) return false;
  const now = Date.now();
  return Math.abs(now - eventTime) <= windowMs;
}

/**
 * Store webhook event for replay protection.
 * Returns false if event was already processed (duplicate).
 */
function storeWebhookEvent(
  db: Database.Database,
  provider: string,
  eventId: string,
  eventType: string,
  payload: string,
): boolean {
  try {
    db.prepare(`
      INSERT INTO webhook_events (id, provider, event_type, payload, processed_at, created_at)
      VALUES (?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    `).run(eventId, provider, eventType, payload);
    return true;
  } catch {
    // UNIQUE constraint violation = duplicate
    return false;
  }
}

/**
 * POST /webhooks/payout — Handle payout webhook
 */
webhookRouter.post('/payout', (req: Request, res: Response) => {
  // Always return 200 — provider should not retry on our errors
  if (!stateMachine || !webhookDb) {
    logger.warn('Webhook received but service not initialized');
    res.status(200).json({ status: 'ignored' });
    return;
  }

  const payload = req.body as WebhookPayload;
  const signature = req.headers['x-webhook-signature'] as string;

  // Verify HMAC signature
  if (webhookSecret && !verifyWebhookSignature(req.body, signature, webhookSecret)) {
    logger.warn({ eventId: payload?.id }, 'Webhook signature verification failed');
    res.status(200).json({ status: 'rejected', reason: 'invalid_signature' });
    return;
  }

  // Validate timestamp window (5 minutes)
  if (payload.timestamp && !isTimestampValid(payload.timestamp)) {
    logger.warn({ eventId: payload.id, timestamp: payload.timestamp }, 'Webhook timestamp outside window');
    res.status(200).json({ status: 'rejected', reason: 'timestamp_expired' });
    return;
  }

  // Replay protection via DB
  const isNew = storeWebhookEvent(
    webhookDb,
    'nowpayments',
    payload.id,
    payload.type,
    JSON.stringify(payload),
  );

  if (!isNew) {
    logger.info({ eventId: payload.id }, 'Webhook replay rejected (duplicate)');
    res.status(200).json({ status: 'duplicate' });
    return;
  }

  // Process the event
  try {
    processWebhookEvent(stateMachine, payload);
    res.status(200).json({ status: 'processed' });
  } catch (err) {
    logger.error({ err, eventId: payload.id }, 'Webhook processing error');
    res.status(200).json({ status: 'error' });
  }
});

/**
 * Process webhook event and transition payout state.
 */
export function processWebhookEvent(
  sm: PayoutStateMachine,
  payload: WebhookPayload,
): void {
  const { payout_id: providerPayoutId, status } = payload;

  // Find payout by provider_payout_id
  const payout = (sm as unknown as { db: Database.Database }).db.prepare(
    `SELECT id, status FROM payout_requests WHERE provider_payout_id = ?`,
  ).get(providerPayoutId) as { id: string; status: string } | undefined;

  if (!payout) {
    logger.warn({ providerPayoutId }, 'Webhook for unknown payout');
    return;
  }

  if (TERMINAL_COMPLETED.includes(status)) {
    sm.complete(payout.id);
  } else if (TERMINAL_FAILED.includes(status)) {
    sm.fail(payout.id, `Provider status: ${status}`);
  } else if (RETRYABLE_FAILED.includes(status)) {
    // Retryable: increment retry count but don't transition
    logger.info({ payoutId: payout.id, status }, 'Retryable failure — awaiting retry');
  } else {
    // Unknown status — quarantine
    sm.quarantine(payout.id, status);
  }
}

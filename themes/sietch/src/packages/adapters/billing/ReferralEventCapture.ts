/**
 * ReferralEventCapture — Fraud Signal Persistence
 *
 * Captures referral-related events with HMAC-SHA-256 hashed PII.
 * Raw IP, User-Agent, and fingerprint are never stored.
 *
 * Data classification: hashed event data is pseudonymized PII,
 * subject to 90-day retention (Sprint 7.5 cleanup).
 *
 * SDD refs: §4.7 Fraud Check Service
 * Sprint refs: Task 4.2
 *
 * @module packages/adapters/billing/ReferralEventCapture
 */

import { createHmac } from 'crypto';
import type Database from 'better-sqlite3';
import { logger } from '../../../utils/logger.js';

// =============================================================================
// Types
// =============================================================================

export type ReferralEventType = 'registration' | 'bonus_claim' | 'qualifying_action';

export interface EventCaptureInput {
  accountId: string;
  eventType: ReferralEventType;
  ip?: string;
  userAgent?: string;
  fingerprint?: string;
  referralCodeId?: string;
  metadata?: Record<string, unknown>;
}

// =============================================================================
// ReferralEventCapture
// =============================================================================

export class ReferralEventCapture {
  private db: Database.Database;
  private hmacKey: string;

  constructor(db: Database.Database, hmacKey?: string) {
    this.db = db;
    this.hmacKey = hmacKey ?? process.env.FRAUD_HASH_SECRET ?? 'default-dev-key';

    if (this.hmacKey === 'default-dev-key' && process.env.NODE_ENV === 'production') {
      logger.warn('FRAUD_HASH_SECRET not set in production — using default key');
    }
  }

  /**
   * Capture a referral event with HMAC-hashed PII.
   * Raw IP/UA/fingerprint are never stored.
   */
  capture(input: EventCaptureInput): void {
    try {
      const ipHash = input.ip ? this.hmac(input.ip) : null;
      const ipPrefix = input.ip ? this.extractIpPrefix(input.ip) : null;
      const uaHash = input.userAgent ? this.hmac(input.userAgent) : null;
      const fpHash = input.fingerprint ? this.hmac(input.fingerprint) : null;
      const metadata = input.metadata ? JSON.stringify(input.metadata) : null;

      this.db.prepare(`
        INSERT INTO referral_events
          (account_id, event_type, ip_hash, ip_prefix, user_agent_hash,
           fingerprint_hash, referral_code_id, metadata)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        input.accountId,
        input.eventType,
        ipHash,
        ipPrefix,
        uaHash,
        fpHash,
        input.referralCodeId ?? null,
        metadata,
      );

      logger.debug({
        event: 'referral.event.captured',
        accountId: input.accountId,
        eventType: input.eventType,
      }, 'Referral event captured');
    } catch (err) {
      // Non-fatal: don't block the main flow
      logger.warn({ error: err, accountId: input.accountId }, 'Failed to capture referral event');
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /**
   * HMAC-SHA-256 hash of a value using the configured key.
   * Prevents rainbow/dictionary reversal of IP ranges.
   */
  private hmac(value: string): string {
    return createHmac('sha256', this.hmacKey).update(value).digest('hex');
  }

  /**
   * Extract IP prefix for velocity checks.
   * IPv4: first 3 octets (e.g., "192.168.1")
   * IPv6: first 4 groups (e.g., "2001:db8:85a3:0000")
   */
  private extractIpPrefix(ip: string): string {
    if (ip.includes(':')) {
      // IPv6: take first 4 groups
      return ip.split(':').slice(0, 4).join(':');
    }
    // IPv4: take first 3 octets
    return ip.split('.').slice(0, 3).join('.');
  }
}

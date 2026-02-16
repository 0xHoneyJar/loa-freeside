/**
 * ReferralService — Referral Management Implementation
 *
 * Manages referral code lifecycle, registration with attribution,
 * 24h grace period rebind, and bonus triggering for qualifying actions.
 *
 * SDD refs: §4.1 ReferralService
 * Sprint refs: Tasks 1.3, 1.4
 *
 * @module packages/adapters/billing/ReferralService
 */

import { randomUUID } from 'crypto';
import type Database from 'better-sqlite3';
import type {
  IReferralService,
  ReferralCode,
  ReferralRegistration,
  QualifyingAction,
  ReferralStats,
  ReferralBonus,
  AttributionOutcome,
  ReferralCodeStatus,
  BonusStatus,
} from '../../core/ports/IReferralService.js';
import { logger } from '../../../utils/logger.js';

// =============================================================================
// Constants
// =============================================================================

/** Custom alphabet for nanoid-style code generation (no i/l/o to avoid confusion) */
const CODE_ALPHABET = '0123456789abcdefghjkmnpqrstuvwxyz';
const CODE_LENGTH = 10;
const ATTRIBUTION_MONTHS = 12;
const GRACE_PERIOD_HOURS = 24;
const DEFAULT_BONUS_CAP_PER_REFERRER = 50;

// =============================================================================
// Row Types
// =============================================================================

interface CodeRow {
  id: string;
  account_id: string;
  code: string;
  status: string;
  max_uses: number | null;
  use_count: number;
  expires_at: string | null;
  created_at: string;
  revoked_at: string | null;
  revoked_by: string | null;
}

interface RegistrationRow {
  id: string;
  referee_account_id: string;
  referrer_account_id: string;
  referral_code_id: string;
  created_at: string;
  attribution_expires_at: string;
}

interface BonusRow {
  id: string;
  referee_account_id: string;
  referrer_account_id: string;
  registration_id: string;
  qualifying_action: string;
  qualifying_action_id: string;
  amount_micro: number;
  status: string;
  risk_score: number | null;
  flag_reason: string | null;
  reviewed_by: string | null;
  fraud_check_at: string | null;
  granted_at: string | null;
  grant_id: string | null;
  created_at: string;
}

// =============================================================================
// Helpers
// =============================================================================

function generateCode(): string {
  const bytes = new Uint8Array(CODE_LENGTH);
  crypto.getRandomValues(bytes);
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return code;
}

import { sqliteTimestamp } from './protocol/timestamps';

const sqliteNow = sqliteTimestamp;

function addMonths(date: Date, months: number): string {
  const d = new Date(date);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString();
}

function rowToCode(row: CodeRow): ReferralCode {
  return {
    id: row.id,
    accountId: row.account_id,
    code: row.code,
    status: row.status as ReferralCodeStatus,
    maxUses: row.max_uses,
    useCount: row.use_count,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    revokedAt: row.revoked_at,
    revokedBy: row.revoked_by,
  };
}

function rowToRegistration(row: RegistrationRow): ReferralRegistration {
  return {
    id: row.id,
    refereeAccountId: row.referee_account_id,
    referrerAccountId: row.referrer_account_id,
    referralCodeId: row.referral_code_id,
    createdAt: row.created_at,
    attributionExpiresAt: row.attribution_expires_at,
  };
}

// =============================================================================
// Implementation
// =============================================================================

export class ReferralService implements IReferralService {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  // ---------------------------------------------------------------------------
  // Code Management (Task 1.3)
  // ---------------------------------------------------------------------------

  async createCode(accountId: string): Promise<ReferralCode> {
    // Check for existing active code
    const existing = this.db.prepare(
      `SELECT * FROM referral_codes WHERE account_id = ? AND status = 'active'`
    ).get(accountId) as CodeRow | undefined;

    if (existing) {
      logger.warn({ event: 'referral.code.exists', accountId }, 'Active referral code already exists');
      return rowToCode(existing);
    }

    // Generate unique code with collision check
    let code: string;
    let attempts = 0;
    do {
      code = generateCode();
      attempts++;
      if (attempts > 10) {
        throw new Error('Failed to generate unique referral code after 10 attempts');
      }
    } while (
      this.db.prepare('SELECT 1 FROM referral_codes WHERE code = ?').get(code)
    );

    const id = randomUUID().replace(/-/g, '').slice(0, 16);
    const now = sqliteNow();

    this.db.prepare(`
      INSERT INTO referral_codes (id, account_id, code, status, created_at)
      VALUES (?, ?, ?, 'active', ?)
    `).run(id, accountId, code, now);

    logger.info({ event: 'referral.code.created', accountId, codeId: id }, 'Referral code created');

    return {
      id,
      accountId,
      code,
      status: 'active',
      maxUses: null,
      useCount: 0,
      expiresAt: null,
      createdAt: now,
      revokedAt: null,
      revokedBy: null,
    };
  }

  async getCode(accountId: string): Promise<ReferralCode | null> {
    const row = this.db.prepare(
      `SELECT * FROM referral_codes WHERE account_id = ? AND status = 'active'`
    ).get(accountId) as CodeRow | undefined;

    return row ? rowToCode(row) : null;
  }

  async revokeCode(codeId: string, revokedBy: string): Promise<void> {
    const now = sqliteNow();
    const result = this.db.prepare(`
      UPDATE referral_codes
      SET status = 'revoked', revoked_at = ?, revoked_by = ?
      WHERE id = ? AND status = 'active'
    `).run(now, revokedBy, codeId);

    if (result.changes === 0) {
      throw new Error(`Code ${codeId} not found or not active`);
    }

    logger.info({ event: 'referral.code.revoked', codeId, revokedBy }, 'Referral code revoked');
  }

  // ---------------------------------------------------------------------------
  // Registration Flow (Task 1.4)
  // ---------------------------------------------------------------------------

  async register(refereeAccountId: string, code: string): Promise<ReferralRegistration> {
    // Execute 7-step registration within BEGIN IMMEDIATE for atomicity
    const registration = this.db.transaction(() => {
      const now = new Date();
      const nowStr = now.toISOString();

      // Step 1: Validate code exists and is active
      const codeRow = this.db.prepare(
        `SELECT * FROM referral_codes WHERE code = ? AND status = 'active'`
      ).get(code) as CodeRow | undefined;

      if (!codeRow) {
        this.logAttribution(refereeAccountId, code, 'rejected_expired', nowStr);
        throw new ReferralError('INVALID_CODE', 'Referral code not found or not active');
      }

      // Check expiry
      if (codeRow.expires_at && new Date(codeRow.expires_at) < now) {
        this.logAttribution(refereeAccountId, code, 'rejected_expired', nowStr);
        throw new ReferralError('CODE_EXPIRED', 'Referral code has expired');
      }

      // Check max uses
      if (codeRow.max_uses !== null && codeRow.use_count >= codeRow.max_uses) {
        this.logAttribution(refereeAccountId, code, 'rejected_max_uses', nowStr);
        throw new ReferralError('MAX_USES_REACHED', 'Referral code has reached maximum uses');
      }

      // Step 2: Check self-referral
      if (refereeAccountId === codeRow.account_id) {
        this.logAttribution(refereeAccountId, code, 'rejected_self', nowStr);
        throw new ReferralError('SELF_REFERRAL', 'Cannot use your own referral code');
      }

      // Step 3: Check existing binding
      const existingReg = this.db.prepare(
        `SELECT * FROM referral_registrations WHERE referee_account_id = ?`
      ).get(refereeAccountId) as RegistrationRow | undefined;

      if (existingReg) {
        // Check if within 24h grace period
        const regTime = new Date(existingReg.created_at);
        const gracePeriodEnd = new Date(regTime.getTime() + GRACE_PERIOD_HOURS * 60 * 60 * 1000);

        if (now > gracePeriodEnd) {
          this.logAttribution(refereeAccountId, code, 'rejected_existing', nowStr);
          throw new ReferralError('ALREADY_BOUND', 'Account already has a referral binding (grace period expired)');
        }

        // Grace period active — check if any qualifying actions exist (immutability guard)
        const hasQualifyingActions = this.db.prepare(
          `SELECT 1 FROM referral_bonuses WHERE referee_account_id = ? LIMIT 1`
        ).get(refereeAccountId);

        if (hasQualifyingActions) {
          this.logAttribution(refereeAccountId, code, 'rejected_existing', nowStr);
          throw new ReferralError('ATTRIBUTION_LOCKED', 'Attribution is locked after qualifying action');
        }

        // Rebind: delete existing registration
        this.db.prepare(
          `DELETE FROM referral_registrations WHERE referee_account_id = ?`
        ).run(refereeAccountId);

        // Decrement old code's use_count
        this.db.prepare(
          `UPDATE referral_codes SET use_count = use_count - 1 WHERE id = ?`
        ).run(existingReg.referral_code_id);

        this.logAttribution(refereeAccountId, code, 'rebound_grace', nowStr);
      }

      // Step 4: Insert registration
      const regId = randomUUID().replace(/-/g, '').slice(0, 16);
      const attributionExpiresAt = addMonths(now, ATTRIBUTION_MONTHS);

      this.db.prepare(`
        INSERT INTO referral_registrations
          (id, referee_account_id, referrer_account_id, referral_code_id, created_at, attribution_expires_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(regId, refereeAccountId, codeRow.account_id, codeRow.id, nowStr, attributionExpiresAt);

      // Step 5: Increment use_count
      this.db.prepare(
        `UPDATE referral_codes SET use_count = use_count + 1 WHERE id = ?`
      ).run(codeRow.id);

      // Step 6: Log attribution
      if (!existingReg) {
        this.logAttribution(refereeAccountId, code, 'bound', nowStr);
      }

      // Step 7: Return registration
      logger.info({
        event: 'referral.registered',
        refereeAccountId,
        referrerAccountId: codeRow.account_id,
        codeId: codeRow.id,
        registrationId: regId,
      }, 'Referral registration completed');

      return {
        id: regId,
        refereeAccountId,
        referrerAccountId: codeRow.account_id,
        referralCodeId: codeRow.id,
        createdAt: nowStr,
        attributionExpiresAt,
      };
    })();

    return registration;
  }

  async getReferrer(refereeAccountId: string): Promise<ReferralRegistration | null> {
    const row = this.db.prepare(
      `SELECT * FROM referral_registrations WHERE referee_account_id = ?`
    ).get(refereeAccountId) as RegistrationRow | undefined;

    return row ? rowToRegistration(row) : null;
  }

  isAttributionActive(registration: ReferralRegistration, at: Date): boolean {
    return at <= new Date(registration.attributionExpiresAt);
  }

  // ---------------------------------------------------------------------------
  // Bonus Triggering
  // ---------------------------------------------------------------------------

  async onQualifyingAction(refereeAccountId: string, action: QualifyingAction): Promise<void> {
    const registration = await this.getReferrer(refereeAccountId);
    if (!registration) {
      logger.debug({ event: 'referral.bonus.no_referrer', refereeAccountId }, 'No referral registration found');
      return;
    }

    if (!this.isAttributionActive(registration, new Date())) {
      logger.debug({ event: 'referral.bonus.expired', refereeAccountId }, 'Attribution expired');
      return;
    }

    // Check minimum economic value
    const MIN_DNFT_MICRO = 1_000_000n; // $1
    const MIN_CREDIT_MICRO = 5_000_000n; // $5
    const minAmount = action.type === 'dnft_creation' ? MIN_DNFT_MICRO : MIN_CREDIT_MICRO;
    if (action.amountMicro < minAmount) {
      logger.debug({
        event: 'referral.bonus.below_minimum',
        refereeAccountId,
        amountMicro: action.amountMicro.toString(),
        minimum: minAmount.toString(),
      }, 'Action below minimum economic value');
      return;
    }

    // Check per-referrer bonus cap
    const bonusCount = this.db.prepare(
      `SELECT COUNT(*) as count FROM referral_bonuses
       WHERE referrer_account_id = ? AND status NOT IN ('denied', 'expired')`
    ).get(registration.referrerAccountId) as { count: number };

    if (bonusCount.count >= DEFAULT_BONUS_CAP_PER_REFERRER) {
      logger.warn({
        event: 'referral.bonus.cap_reached',
        referrerAccountId: registration.referrerAccountId,
        count: bonusCount.count,
      }, 'Per-referrer bonus cap reached');
      return;
    }

    // Create pending bonus (idempotent via UNIQUE constraint)
    const bonusId = randomUUID().replace(/-/g, '').slice(0, 16);
    try {
      this.db.prepare(`
        INSERT INTO referral_bonuses
          (id, referee_account_id, referrer_account_id, registration_id,
           qualifying_action, qualifying_action_id, amount_micro, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')
      `).run(
        bonusId,
        refereeAccountId,
        registration.referrerAccountId,
        registration.id,
        action.type,
        action.actionId,
        Number(action.amountMicro),
      );

      logger.info({
        event: 'referral.bonus.created',
        bonusId,
        refereeAccountId,
        referrerAccountId: registration.referrerAccountId,
        action: action.type,
      }, 'Referral bonus created (pending 7-day hold)');
    } catch (err: unknown) {
      // Idempotency: UNIQUE constraint violation means bonus already exists
      if (err instanceof Error && err.message.includes('UNIQUE constraint')) {
        logger.debug({
          event: 'referral.bonus.duplicate',
          refereeAccountId,
          action: action.type,
          actionId: action.actionId,
        }, 'Bonus already exists for this action');
        return;
      }
      throw err;
    }
  }

  // ---------------------------------------------------------------------------
  // Stats
  // ---------------------------------------------------------------------------

  async getReferralStats(referrerAccountId: string): Promise<ReferralStats> {
    const now = new Date().toISOString();

    const totalReferees = this.db.prepare(
      `SELECT COUNT(*) as count FROM referral_registrations WHERE referrer_account_id = ?`
    ).get(referrerAccountId) as { count: number };

    const activeReferees = this.db.prepare(
      `SELECT COUNT(*) as count FROM referral_registrations
       WHERE referrer_account_id = ? AND attribution_expires_at > ?`
    ).get(referrerAccountId, now) as { count: number };

    const pendingBonuses = this.db.prepare(
      `SELECT COUNT(*) as count FROM referral_bonuses
       WHERE referrer_account_id = ? AND status = 'pending'`
    ).get(referrerAccountId) as { count: number };

    // Total earnings from referrer_earnings table (will be populated in Sprint 3)
    // For now, return 0 since the table doesn't exist yet
    const totalEarningsMicro = 0n;

    return {
      totalReferees: totalReferees.count,
      activeReferees: activeReferees.count,
      totalEarningsMicro,
      pendingBonuses: pendingBonuses.count,
    };
  }

  // ---------------------------------------------------------------------------
  // Private Helpers
  // ---------------------------------------------------------------------------

  private logAttribution(refereeAccountId: string, code: string, outcome: AttributionOutcome, effectiveAt: string): void {
    this.db.prepare(`
      INSERT INTO referral_attribution_log (referee_account_id, referral_code, outcome, effective_at)
      VALUES (?, ?, ?, ?)
    `).run(refereeAccountId, code, outcome, effectiveAt);
  }
}

// =============================================================================
// Errors
// =============================================================================

export type ReferralErrorCode =
  | 'INVALID_CODE'
  | 'CODE_EXPIRED'
  | 'MAX_USES_REACHED'
  | 'SELF_REFERRAL'
  | 'ALREADY_BOUND'
  | 'ATTRIBUTION_LOCKED';

export class ReferralError extends Error {
  public readonly code: ReferralErrorCode;

  constructor(code: ReferralErrorCode, message: string) {
    super(message);
    this.name = 'ReferralError';
    this.code = code;
  }
}

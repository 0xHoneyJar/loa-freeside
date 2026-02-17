/**
 * RevenueDistributionService — Zero-Sum Revenue Posting
 *
 * After every finalization, distributes the charge into up to five pools:
 *   referrer_share    = (charge * referrer_bps) / 10000  [if attribution active]
 *   commons_share     = (charge * commons_bps)  / 10000
 *   community_share   = (charge * community_bps) / 10000
 *   treasury_reserve  = (foundation_gross * treasury_bps) / 10000
 *   foundation_net    = charge - referrer - commons - community - treasury
 *
 * Rounding: All BPS splits use floor() (BigInt integer division).
 * Largest-remainder method: remainder assigned to foundation (stable ordering).
 * Conservation assert: sum of all shares === totalMicro.
 *
 * SDD refs: §1.4 RevenueDistributionService, §4.2 Revenue Rules Extension
 * Sprint refs: Tasks 3.3, 3.2
 *
 * @module packages/adapters/billing/RevenueDistributionService
 */

import { randomUUID } from 'crypto';
import type Database from 'better-sqlite3';
import { bpsShare, assertBpsSum } from '../../core/protocol/arithmetic.js';
import type { MicroUSD, BasisPoints } from '../../core/protocol/arithmetic.js';
import { logger } from '../../../utils/logger.js';
import type { IReferralService } from '../../core/ports/IReferralService.js';

// =============================================================================
// Types
// =============================================================================

export interface DistributionResult {
  commonsShare: bigint;
  communityShare: bigint;
  foundationShare: bigint;
  referrerShare: bigint;
  treasuryReserve: bigint;
  commonsAccountId: string;
  communityAccountId: string;
  foundationAccountId: string;
  referrerAccountId: string | null;
}

export interface DistributionConfig {
  commonsRateBps: bigint;
  communityRateBps: bigint;
  foundationRateBps: bigint;
  referrerRateBps: bigint;
  treasuryReserveBps: bigint;
  commonsAccountId: string;
  communityAccountId: string;
  foundationAccountId: string;
}

// =============================================================================
// RevenueDistributionService
// =============================================================================

/** Default treasury reserve: 0 bps (treasury not yet active) */
const DEFAULT_TREASURY_RESERVE_BPS = 0n;

export class RevenueDistributionService {
  private db: Database.Database;
  private configCache: DistributionConfig | null = null;
  /** Tracks whether the active config came from revenue_rules or billing_config */
  private configSource: 'revenue_rule' | 'billing_config' = 'billing_config';
  private referralService: IReferralService | null = null;

  constructor(db: Database.Database) {
    this.db = db;
  }

  /** Inject referral service for attribution lookups during distribution */
  setReferralService(service: IReferralService): void {
    this.referralService = service;
  }

  /**
   * Load distribution config. Priority:
   * 1. Active revenue rule (from revenue_rules table)
   * 2. Fallback to billing_config table values
   *
   * Cached after first load; call invalidateConfig() to refresh.
   */
  getConfig(): DistributionConfig {
    if (this.configCache) return this.configCache;

    // Try active revenue rule first (Task 8.5)
    const activeRule = this.getActiveRevenueRule();
    if (activeRule) {
      this.configSource = 'revenue_rule';
      this.configCache = {
        commonsRateBps: BigInt(activeRule.commons_bps),
        communityRateBps: BigInt(activeRule.community_bps),
        foundationRateBps: BigInt(activeRule.foundation_bps),
        referrerRateBps: BigInt(activeRule.referrer_bps ?? 0),
        treasuryReserveBps: this.getTreasuryReserveBps(),
        commonsAccountId: this.getConfigVal('commons_account_id'),
        communityAccountId: this.getConfigVal('community_account_id'),
        foundationAccountId: this.getConfigVal('foundation_account_id'),
      };
      return this.configCache;
    }

    // Fallback to billing_config values
    this.configSource = 'billing_config';
    this.configCache = {
      commonsRateBps: BigInt(this.getConfigVal('commons_rate_bps')),
      communityRateBps: BigInt(this.getConfigVal('community_rate_bps')),
      foundationRateBps: BigInt(this.getConfigVal('foundation_rate_bps')),
      referrerRateBps: 0n,
      treasuryReserveBps: DEFAULT_TREASURY_RESERVE_BPS,
      commonsAccountId: this.getConfigVal('commons_account_id'),
      communityAccountId: this.getConfigVal('community_account_id'),
      foundationAccountId: this.getConfigVal('foundation_account_id'),
    };

    // Validate base rates sum to 10000 bps (100%)
    assertBpsSum(
      this.configCache.commonsRateBps,
      this.configCache.communityRateBps,
      this.configCache.foundationRateBps,
    );

    return this.configCache;
  }

  /** Get the config source used for the last distribution */
  getConfigSource(): 'revenue_rule' | 'billing_config' {
    return this.configSource;
  }

  /**
   * Clear cached config. Call after admin updates rates.
   */
  invalidateConfig(): void {
    this.configCache = null;
  }

  /**
   * Calculate revenue distribution shares (5-way conserved split).
   *
   * Rounding policy: All BPS splits use floor() (BigInt integer division).
   * Largest-remainder: foundation absorbs residual micro-units.
   * Stable ordering: referrer → commons → community → treasury → foundation (gets remainder).
   *
   * Conservation: referrer + commons + community + treasury + foundation === totalMicro.
   *
   * @param referrerBps - Effective referrer BPS (0 if no attribution)
   */
  calculateShares(chargeMicro: MicroUSD, referrerBps?: BasisPoints): {
    referrerShare: MicroUSD;
    commonsShare: MicroUSD;
    communityShare: MicroUSD;
    treasuryReserve: MicroUSD;
    foundationShare: MicroUSD;
  };
  calculateShares(chargeMicro: bigint, referrerBps?: bigint): {
    referrerShare: bigint;
    commonsShare: bigint;
    communityShare: bigint;
    treasuryReserve: bigint;
    foundationShare: bigint;
  };
  calculateShares(chargeMicro: bigint, referrerBps?: bigint): {
    referrerShare: bigint;
    commonsShare: bigint;
    communityShare: bigint;
    treasuryReserve: bigint;
    foundationShare: bigint;
  } {
    const config = this.getConfig();
    const effectiveReferrerBps = referrerBps ?? 0n;

    // Floor each share via BigInt integer division
    const referrerShare = bpsShare(chargeMicro, effectiveReferrerBps);
    const commonsShare = bpsShare(chargeMicro, config.commonsRateBps);
    const communityShare = bpsShare(chargeMicro, config.communityRateBps);

    // Foundation gross = total - referrer - commons - community
    const foundationGross = chargeMicro - referrerShare - commonsShare - communityShare;

    // Treasury reserve from foundation gross (not additive to total)
    const treasuryReserve = bpsShare(foundationGross, config.treasuryReserveBps);

    // Foundation net absorbs all remainder — exact conservation
    const foundationShare = foundationGross - treasuryReserve;

    return { referrerShare, commonsShare, communityShare, treasuryReserve, foundationShare };
  }

  /**
   * Post revenue distribution entries within an existing transaction.
   *
   * 5-way conserved split: referrer → commons → community → treasury → foundation.
   * Foundation absorbs remainder (largest-remainder method).
   *
   * MUST be called within the same db.transaction() as finalize() to ensure
   * atomicity — if finalize rolls back, distribution entries are also rolled back.
   *
   * @param accountId - The account being charged (source / referee)
   * @param poolId - The pool being charged from
   * @param chargeMicro - The finalized charge amount
   * @param reservationId - The reservation being finalized
   * @param entrySeqBase - Base sequence number (distribution entries use seq+1..seq+5)
   */
  postDistribution(
    accountId: string,
    poolId: string,
    chargeMicro: bigint,
    reservationId: string,
    entrySeqBase: number,
  ): DistributionResult {
    if (chargeMicro <= 0n) {
      return {
        commonsShare: 0n,
        communityShare: 0n,
        foundationShare: 0n,
        referrerShare: 0n,
        treasuryReserve: 0n,
        commonsAccountId: '',
        communityAccountId: '',
        foundationAccountId: '',
        referrerAccountId: null,
      };
    }

    const config = this.getConfig();

    // Check for active referral attribution
    let referrerAccountId: string | null = null;
    let effectiveReferrerBps = 0n;

    if (this.referralService && config.referrerRateBps > 0n) {
      const registration = this.lookupActiveAttribution(accountId);
      if (registration) {
        referrerAccountId = registration.referrerAccountId;
        effectiveReferrerBps = config.referrerRateBps;
      }
    }

    const { referrerShare, commonsShare, communityShare, treasuryReserve, foundationShare } =
      this.calculateShares(chargeMicro, effectiveReferrerBps);

    // Conservation assert
    const total = referrerShare + commonsShare + communityShare + treasuryReserve + foundationShare;
    if (total !== chargeMicro) {
      throw new Error(
        `Conservation violation: ${total} !== ${chargeMicro} (referrer=${referrerShare}, commons=${commonsShare}, community=${communityShare}, treasury=${treasuryReserve}, foundation=${foundationShare})`
      );
    }

    const now = new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
    let seqOffset = 0;

    // Post referrer share (if attribution active)
    if (referrerShare > 0n && referrerAccountId) {
      seqOffset++;
      this.db.prepare(
        `INSERT INTO credit_ledger
         (id, account_id, pool_id, reservation_id, entry_seq, entry_type,
          amount_micro, description, created_at)
         VALUES (?, ?, 'referral:revenue_share', ?, ?, 'revenue_share', ?, ?, ?)`
      ).run(
        randomUUID(), referrerAccountId, reservationId,
        entrySeqBase + seqOffset, referrerShare.toString(),
        `Referral revenue share from ${accountId}`, now,
      );

      // Record in referrer_earnings for stats and audit
      this.recordReferrerEarning(
        referrerAccountId, accountId, reservationId,
        referrerShare, effectiveReferrerBps, chargeMicro, null,
      );
    }

    // Post commons contribution
    if (commonsShare > 0n) {
      seqOffset++;
      this.db.prepare(
        `INSERT INTO credit_ledger
         (id, account_id, pool_id, reservation_id, entry_seq, entry_type,
          amount_micro, description, created_at)
         VALUES (?, ?, ?, ?, ?, 'commons_contribution', ?, ?, ?)`
      ).run(
        randomUUID(), config.commonsAccountId, poolId, reservationId,
        entrySeqBase + seqOffset, commonsShare.toString(),
        `Commons share from ${accountId}`, now,
      );
    }

    // Post revenue share (community)
    if (communityShare > 0n) {
      seqOffset++;
      this.db.prepare(
        `INSERT INTO credit_ledger
         (id, account_id, pool_id, reservation_id, entry_seq, entry_type,
          amount_micro, description, created_at)
         VALUES (?, ?, ?, ?, ?, 'revenue_share', ?, ?, ?)`
      ).run(
        randomUUID(), config.communityAccountId, poolId, reservationId,
        entrySeqBase + seqOffset, communityShare.toString(),
        `Community revenue share from ${accountId}`, now,
      );
    }

    // Post treasury reserve (from foundation gross)
    if (treasuryReserve > 0n) {
      seqOffset++;
      this.db.prepare(
        `INSERT INTO credit_ledger
         (id, account_id, pool_id, reservation_id, entry_seq, entry_type,
          amount_micro, description, created_at)
         VALUES (?, ?, 'treasury', ?, ?, 'revenue_share', ?, ?, ?)`
      ).run(
        randomUUID(), config.foundationAccountId, reservationId,
        entrySeqBase + seqOffset, treasuryReserve.toString(),
        `Treasury reserve from ${accountId}`, now,
      );
    }

    // Post foundation share (net of treasury reserve)
    if (foundationShare > 0n) {
      seqOffset++;
      this.db.prepare(
        `INSERT INTO credit_ledger
         (id, account_id, pool_id, reservation_id, entry_seq, entry_type,
          amount_micro, description, created_at)
         VALUES (?, ?, ?, ?, ?, 'revenue_share', ?, ?, ?)`
      ).run(
        randomUUID(), config.foundationAccountId, poolId, reservationId,
        entrySeqBase + seqOffset, foundationShare.toString(),
        `Foundation revenue share from ${accountId}`, now,
      );
    }

    logger.info({
      event: 'billing.distribution',
      accountId,
      reservationId,
      chargeMicro: chargeMicro.toString(),
      referrerShare: referrerShare.toString(),
      commonsShare: commonsShare.toString(),
      communityShare: communityShare.toString(),
      treasuryReserve: treasuryReserve.toString(),
      foundationShare: foundationShare.toString(),
      referrerAccountId,
      source: this.configSource,
    }, 'Revenue distribution posted');

    return {
      referrerShare,
      commonsShare,
      communityShare,
      treasuryReserve,
      foundationShare,
      commonsAccountId: config.commonsAccountId,
      communityAccountId: config.communityAccountId,
      foundationAccountId: config.foundationAccountId,
      referrerAccountId,
    };
  }

  // ---------------------------------------------------------------------------
  // Private Helpers
  // ---------------------------------------------------------------------------

  /**
   * Look up the active revenue rule from revenue_rules table.
   * Returns null if the table doesn't exist or no active rule.
   */
  private getActiveRevenueRule(): {
    commons_bps: number;
    community_bps: number;
    foundation_bps: number;
    referrer_bps: number;
  } | null {
    try {
      const row = this.db.prepare(
        `SELECT commons_bps, community_bps, foundation_bps,
                COALESCE(referrer_bps, 0) as referrer_bps
         FROM revenue_rules WHERE status = 'active' LIMIT 1`
      ).get() as { commons_bps: number; community_bps: number; foundation_bps: number; referrer_bps: number } | undefined;
      return row ?? null;
    } catch {
      // Table may not exist yet (pre-migration 035) — fall through to billing_config
      return null;
    }
  }

  /** Read treasury_reserve_bps from billing_config, defaulting to 0 */
  private getTreasuryReserveBps(): bigint {
    try {
      const row = this.db.prepare(
        `SELECT value FROM billing_config WHERE key = 'treasury_reserve_bps'`
      ).get() as { value: string } | undefined;
      return row ? BigInt(row.value) : DEFAULT_TREASURY_RESERVE_BPS;
    } catch {
      return DEFAULT_TREASURY_RESERVE_BPS;
    }
  }

  /** Read a single value from billing_config */
  private getConfigVal(key: string): string {
    const row = this.db.prepare(
      `SELECT value FROM billing_config WHERE key = ?`
    ).get(key) as { value: string } | undefined;
    if (!row) throw new Error(`Missing billing_config key: ${key}`);
    return row.value;
  }

  /**
   * Look up active referral attribution for an account (synchronous).
   * Returns the registration if attribution is still active, null otherwise.
   */
  private lookupActiveAttribution(refereeAccountId: string): {
    referrerAccountId: string;
    registrationId: string;
  } | null {
    try {
      const row = this.db.prepare(
        `SELECT referrer_account_id, id FROM referral_registrations
         WHERE referee_account_id = ? AND attribution_expires_at > datetime('now')`
      ).get(refereeAccountId) as { referrer_account_id: string; id: string } | undefined;

      if (!row) return null;
      return { referrerAccountId: row.referrer_account_id, registrationId: row.id };
    } catch {
      // Table may not exist yet — no referral attribution
      return null;
    }
  }

  /**
   * Record a referrer earning for audit and stats.
   */
  private recordReferrerEarning(
    referrerAccountId: string,
    refereeAccountId: string,
    chargeReservationId: string,
    amountMicro: bigint,
    referrerBps: bigint,
    sourceChargeMicro: bigint,
    earningLotId: string | null,
  ): void {
    try {
      // Look up registration ID
      const reg = this.db.prepare(
        `SELECT id FROM referral_registrations WHERE referee_account_id = ? AND referrer_account_id = ?`
      ).get(refereeAccountId, referrerAccountId) as { id: string } | undefined;

      if (!reg) return;

      this.db.prepare(`
        INSERT INTO referrer_earnings
          (referrer_account_id, referee_account_id, registration_id,
           charge_reservation_id, earning_lot_id, amount_micro,
           referrer_bps, source_charge_micro, settle_after)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '+48 hours'))
      `).run(
        referrerAccountId, refereeAccountId, reg.id,
        chargeReservationId, earningLotId,
        Number(amountMicro), Number(referrerBps), Number(sourceChargeMicro),
      );
    } catch (err) {
      // Non-fatal: don't block distribution if earnings table missing
      logger.warn({ error: err, referrerAccountId, refereeAccountId }, 'Failed to record referrer earning');
    }
  }
}

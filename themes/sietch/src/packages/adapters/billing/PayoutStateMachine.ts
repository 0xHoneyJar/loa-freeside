/**
 * PayoutStateMachine — Payout Request Lifecycle
 *
 * Formal state transitions with SQL WHERE guards to prevent invalid moves.
 * Each transition uses UPDATE ... WHERE status = ? for race protection.
 * Idempotent ledger ops with deterministic keys per phase.
 *
 * States: pending → approved → processing → completed | failed | cancelled
 *         pending → cancelled
 *         processing → quarantined (unknown provider status)
 *
 * SDD refs: §4.4 PayoutService
 * Sprint refs: Task 8.4
 *
 * @module packages/adapters/billing/PayoutStateMachine
 */

import { randomUUID } from 'crypto';
import type Database from 'better-sqlite3';
import { logger } from '../../../utils/logger.js';

// =============================================================================
// Types
// =============================================================================

export type PayoutState = 'pending' | 'approved' | 'processing' | 'completed' | 'failed' | 'cancelled' | 'quarantined';

export interface TransitionResult {
  success: boolean;
  payoutId: string;
  fromState: PayoutState;
  toState: PayoutState;
  reason?: string;
}

interface PayoutRow {
  id: string;
  account_id: string;
  amount_micro: number;
  fee_micro: number;
  net_amount_micro: number;
  status: PayoutState;
  idempotency_key: string;
}

// =============================================================================
// Valid Transitions
// =============================================================================

const VALID_TRANSITIONS: Record<PayoutState, PayoutState[]> = {
  pending: ['approved', 'cancelled'],
  approved: ['processing', 'cancelled'],
  processing: ['completed', 'failed', 'quarantined'],
  completed: [],
  failed: [],
  cancelled: [],
  quarantined: ['processing', 'failed'],
};

// =============================================================================
// Constants
// =============================================================================

const ESCROW_POOL = 'withdrawal:pending';

// =============================================================================
// PayoutStateMachine
// =============================================================================

export class PayoutStateMachine {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  /**
   * Create a new payout request in pending state.
   */
  createRequest(
    accountId: string,
    amountMicro: number,
    feeMicro: number,
    payoutAddress: string,
    currency: string = 'usdc',
  ): { payoutId: string; idempotencyKey: string } {
    const payoutId = randomUUID();
    const netAmountMicro = amountMicro - feeMicro;
    const idempotencyKey = `payout:${accountId}:${payoutId}`;

    this.db.prepare(`
      INSERT INTO payout_requests
        (id, account_id, amount_micro, fee_micro, net_amount_micro,
         currency, payout_address, status, idempotency_key)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)
    `).run(payoutId, accountId, amountMicro, feeMicro, netAmountMicro,
           currency, payoutAddress, idempotencyKey);

    logger.info({
      event: 'payout.created',
      payoutId,
      accountId,
      amountMicro,
    }, 'Payout request created');

    return { payoutId, idempotencyKey };
  }

  /**
   * Transition payout to approved state.
   * Creates escrow ledger entry to hold funds.
   */
  approve(payoutId: string): TransitionResult {
    return this.transition(payoutId, 'pending', 'approved', (payout) => {
      this.db.prepare(`
        UPDATE payout_requests SET status = 'approved', approved_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE id = ? AND status = 'pending'
      `).run(payoutId);

      // Create escrow ledger entry
      const seqRow = this.db.prepare(
        `SELECT COALESCE(MAX(entry_seq), -1) + 1 as next_seq
         FROM credit_ledger WHERE account_id = ? AND pool_id = ?`
      ).get(payout.account_id, ESCROW_POOL) as { next_seq: number };

      this.db.prepare(`
        INSERT OR IGNORE INTO credit_ledger
          (id, account_id, pool_id, entry_seq, entry_type,
           amount_micro, description, idempotency_key, created_at)
        VALUES (?, ?, ?, ?, 'escrow', ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      `).run(
        randomUUID(), payout.account_id, ESCROW_POOL,
        seqRow.next_seq, payout.amount_micro,
        `Escrow hold for payout ${payoutId}`,
        `escrow:${payoutId}`,
      );
    });
  }

  /**
   * Transition payout to processing state.
   * Called when provider API has been invoked.
   */
  markProcessing(payoutId: string, providerPayoutId: string): TransitionResult {
    return this.transition(payoutId, 'approved', 'processing', () => {
      this.db.prepare(`
        UPDATE payout_requests
        SET status = 'processing', provider_payout_id = ?,
            processing_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE id = ? AND status = 'approved'
      `).run(providerPayoutId, payoutId);
    });
  }

  /**
   * Transition payout to completed state.
   * Releases escrow with compensating entry.
   */
  complete(payoutId: string): TransitionResult {
    return this.transition(payoutId, 'processing', 'completed', (payout) => {
      this.db.prepare(`
        UPDATE payout_requests
        SET status = 'completed', completed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE id = ? AND status = 'processing'
      `).run(payoutId);

      // Release escrow (compensating entry)
      const seqRow = this.db.prepare(
        `SELECT COALESCE(MAX(entry_seq), -1) + 1 as next_seq
         FROM credit_ledger WHERE account_id = ? AND pool_id = ?`
      ).get(payout.account_id, ESCROW_POOL) as { next_seq: number };

      this.db.prepare(`
        INSERT OR IGNORE INTO credit_ledger
          (id, account_id, pool_id, entry_seq, entry_type,
           amount_micro, description, idempotency_key, created_at)
        VALUES (?, ?, ?, ?, 'escrow_release', ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      `).run(
        randomUUID(), payout.account_id, ESCROW_POOL,
        seqRow.next_seq, -payout.amount_micro,
        `Escrow release for completed payout ${payoutId}`,
        `escrow_release:${payoutId}`,
      );

      // Update treasury state version (OCC)
      this.db.prepare(`
        UPDATE treasury_state
        SET version = version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE id = 1
      `).run();
    });
  }

  /**
   * Transition payout to failed state.
   * Returns escrowed funds to available balance.
   */
  fail(payoutId: string, errorMessage: string): TransitionResult {
    return this.transition(payoutId, 'processing', 'failed', (payout) => {
      this.db.prepare(`
        UPDATE payout_requests
        SET status = 'failed', error_message = ?,
            failed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE id = ? AND status = 'processing'
      `).run(errorMessage, payoutId);

      // Return escrowed funds
      const seqRow = this.db.prepare(
        `SELECT COALESCE(MAX(entry_seq), -1) + 1 as next_seq
         FROM credit_ledger WHERE account_id = ? AND pool_id = ?`
      ).get(payout.account_id, ESCROW_POOL) as { next_seq: number };

      this.db.prepare(`
        INSERT OR IGNORE INTO credit_ledger
          (id, account_id, pool_id, entry_seq, entry_type,
           amount_micro, description, idempotency_key, created_at)
        VALUES (?, ?, ?, ?, 'escrow_release', ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      `).run(
        randomUUID(), payout.account_id, ESCROW_POOL,
        seqRow.next_seq, -payout.amount_micro,
        `Escrow return for failed payout ${payoutId}: ${errorMessage}`,
        `escrow_return:${payoutId}`,
      );
    });
  }

  /**
   * Cancel a payout (only from pending or approved).
   */
  cancel(payoutId: string): TransitionResult {
    const payout = this.getPayout(payoutId);
    if (!payout) {
      return { success: false, payoutId, fromState: 'pending', toState: 'cancelled', reason: 'Payout not found' };
    }

    if (payout.status !== 'pending' && payout.status !== 'approved') {
      return {
        success: false, payoutId,
        fromState: payout.status, toState: 'cancelled',
        reason: `Cannot cancel payout in ${payout.status} state`,
      };
    }

    return this.db.transaction(() => {
      const fromState = payout.status;

      this.db.prepare(`
        UPDATE payout_requests
        SET status = 'cancelled', cancelled_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE id = ? AND status IN ('pending', 'approved')
      `).run(payoutId);

      // Return escrow if it was approved (escrow was created)
      if (fromState === 'approved') {
        const seqRow = this.db.prepare(
          `SELECT COALESCE(MAX(entry_seq), -1) + 1 as next_seq
           FROM credit_ledger WHERE account_id = ? AND pool_id = ?`
        ).get(payout.account_id, ESCROW_POOL) as { next_seq: number };

        this.db.prepare(`
          INSERT OR IGNORE INTO credit_ledger
            (id, account_id, pool_id, entry_seq, entry_type,
             amount_micro, description, idempotency_key, created_at)
          VALUES (?, ?, ?, ?, 'escrow_release', ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        `).run(
          randomUUID(), payout.account_id, ESCROW_POOL,
          seqRow.next_seq, -payout.amount_micro,
          `Escrow return for cancelled payout ${payoutId}`,
          `escrow_cancel:${payoutId}`,
        );
      }

      return { success: true, payoutId, fromState, toState: 'cancelled' as PayoutState };
    })();
  }

  /**
   * Quarantine a payout with unknown provider status.
   */
  quarantine(payoutId: string, providerStatus: string): TransitionResult {
    return this.transition(payoutId, 'processing', 'quarantined', () => {
      this.db.prepare(`
        UPDATE payout_requests
        SET status = 'quarantined', provider_status = ?,
            error_message = ?
        WHERE id = ? AND status = 'processing'
      `).run(providerStatus, `Unknown provider status: ${providerStatus}`, payoutId);
    });
  }

  /**
   * Get payout request by ID.
   */
  getPayout(payoutId: string): PayoutRow | null {
    return this.db.prepare(
      `SELECT * FROM payout_requests WHERE id = ?`
    ).get(payoutId) as PayoutRow | null;
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private transition(
    payoutId: string,
    expectedFrom: PayoutState,
    toState: PayoutState,
    action: (payout: PayoutRow) => void,
  ): TransitionResult {
    try {
      return this.db.transaction(() => {
        const payout = this.db.prepare(
          `SELECT * FROM payout_requests WHERE id = ? AND status = ?`
        ).get(payoutId, expectedFrom) as PayoutRow | undefined;

        if (!payout) {
          const existing = this.getPayout(payoutId);
          if (!existing) {
            return { success: false, payoutId, fromState: expectedFrom, toState, reason: 'Payout not found' };
          }
          return {
            success: false, payoutId,
            fromState: existing.status, toState,
            reason: `Invalid transition: ${existing.status} → ${toState}`,
          };
        }

        // Validate transition
        const allowed = VALID_TRANSITIONS[expectedFrom];
        if (!allowed.includes(toState)) {
          return {
            success: false, payoutId,
            fromState: expectedFrom, toState,
            reason: `Transition ${expectedFrom} → ${toState} not allowed`,
          };
        }

        action(payout);

        logger.info({
          event: 'payout.transition',
          payoutId,
          from: expectedFrom,
          to: toState,
        }, `Payout ${payoutId}: ${expectedFrom} → ${toState}`);

        return { success: true, payoutId, fromState: expectedFrom, toState };
      })();
    } catch (err) {
      logger.error({ err, payoutId }, 'Payout transition failed');
      return {
        success: false, payoutId,
        fromState: expectedFrom, toState,
        reason: `Error: ${(err as Error).message}`,
      };
    }
  }
}

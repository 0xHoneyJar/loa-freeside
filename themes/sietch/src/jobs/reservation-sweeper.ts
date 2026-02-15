/**
 * Reservation Sweeper Job
 *
 * BullMQ background job that releases expired reservations.
 * Runs every 60 seconds, transitions pending reservations past
 * their expires_at to 'expired' status and returns credits to lots.
 *
 * SDD refs: §1.5.2 Reservation State Machine (pending → expired)
 * Sprint refs: Task 1.6
 *
 * @module jobs/reservation-sweeper
 */

import type Database from 'better-sqlite3';
import { logger as defaultLogger } from '../utils/logger.js';

// =============================================================================
// Types
// =============================================================================

export interface ReservationSweeperConfig {
  /** SQLite database instance */
  db: Database.Database;
  /** Sweep interval in milliseconds. Default: 60000 (60s) */
  intervalMs?: number;
  /** Optional custom logger */
  logger?: typeof defaultLogger;
}

interface ExpiredReservation {
  id: string;
  account_id: string;
  pool_id: string | null;
  total_reserved_micro: string;
}

interface ReservationLotRow {
  lot_id: string;
  reserved_micro: string;
}

// =============================================================================
// Sweeper Implementation
// =============================================================================

/**
 * Create and start the reservation sweeper.
 * Uses setInterval for simplicity; migrates to BullMQ when queue infra is wired.
 */
export function createReservationSweeper(config: ReservationSweeperConfig) {
  const { db, intervalMs = 60_000 } = config;
  const log = config.logger ?? defaultLogger;
  let timer: ReturnType<typeof setInterval> | null = null;

  /**
   * Execute one sweep cycle.
   * Finds all pending reservations with expires_at < now() and expires them.
   */
  function sweep(): { expiredCount: number; durationMs: number } {
    const start = Date.now();

    // Find expired reservations
    const expired = db.prepare(`
      SELECT id, account_id, pool_id, total_reserved_micro
      FROM credit_reservations
      WHERE status = 'pending'
        AND expires_at < datetime('now')
    `).all() as ExpiredReservation[];

    if (expired.length === 0) {
      return { expiredCount: 0, durationMs: Date.now() - start };
    }

    // Process each expired reservation in a transaction
    const processOne = db.transaction((reservation: ExpiredReservation) => {
      // Return reserved amounts to lots
      const resLots = db.prepare(
        `SELECT lot_id, reserved_micro FROM reservation_lots
         WHERE reservation_id = ?`
      ).all(reservation.id) as ReservationLotRow[];

      for (const rl of resLots) {
        db.prepare(
          `UPDATE credit_lots
           SET reserved_micro = reserved_micro - ?,
               available_micro = available_micro + ?
           WHERE id = ?`
        ).run(rl.reserved_micro, rl.reserved_micro, rl.lot_id);
      }

      // Transition to expired
      db.prepare(
        `UPDATE credit_reservations SET status = 'expired' WHERE id = ?`
      ).run(reservation.id);

      // Update balance cache
      const poolId = reservation.pool_id ?? 'general';
      const balance = db.prepare(`
        SELECT
          COALESCE(SUM(available_micro), 0) as available_micro,
          COALESCE(SUM(reserved_micro), 0) as reserved_micro
        FROM credit_lots
        WHERE account_id = ?
          AND (pool_id = ? OR pool_id IS NULL OR pool_id = 'general')
          AND (expires_at IS NULL OR expires_at > datetime('now'))
      `).get(reservation.account_id, poolId) as {
        available_micro: string;
        reserved_micro: string;
      };

      db.prepare(`
        INSERT INTO credit_balances (account_id, pool_id, available_micro, reserved_micro, updated_at)
        VALUES (?, ?, ?, ?, datetime('now'))
        ON CONFLICT(account_id, pool_id)
        DO UPDATE SET available_micro = excluded.available_micro,
                      reserved_micro = excluded.reserved_micro,
                      updated_at = excluded.updated_at
      `).run(reservation.account_id, poolId, balance.available_micro, balance.reserved_micro);
    });

    for (const reservation of expired) {
      try {
        processOne(reservation);
      } catch (err) {
        log.error({ err, reservationId: reservation.id, event: 'billing.sweep.error' },
          'Failed to expire reservation');
      }
    }

    const durationMs = Date.now() - start;
    log.info({
      event: 'billing.sweep',
      expired_count: expired.length,
      duration_ms: durationMs,
    }, `Sweep completed: ${expired.length} reservations expired`);

    return { expiredCount: expired.length, durationMs };
  }

  return {
    /** Start the sweeper on the configured interval */
    start() {
      if (timer) return;
      log.info({ intervalMs, event: 'billing.sweep.start' }, 'Reservation sweeper started');
      timer = setInterval(() => {
        try {
          sweep();
        } catch (err) {
          log.error({ err, event: 'billing.sweep.unhandled' }, 'Unhandled sweep error');
        }
      }, intervalMs);
    },

    /** Stop the sweeper */
    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
        log.info({ event: 'billing.sweep.stop' }, 'Reservation sweeper stopped');
      }
    },

    /** Run a single sweep (for testing) */
    sweepOnce: sweep,
  };
}

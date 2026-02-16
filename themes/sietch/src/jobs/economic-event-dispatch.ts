/**
 * Economic Event Dispatch Job
 *
 * Async dispatcher that claims unpublished events from the outbox,
 * publishes to external consumers, and marks as published.
 * Includes stale claim recovery for crashed workers.
 *
 * Claim protocol (SQLite-compatible, no UPDATE...LIMIT RETURNING):
 *   1. SELECT unclaimed rowids
 *   2. UPDATE with worker ID (WHERE claimed_by IS NULL guards against races)
 *   3. SELECT claimed rows for processing
 *   4. Mark as published after external publish
 *
 * SDD refs: §SS4.3, §SS7.1
 * Sprint refs: Task 8.4
 *
 * @module jobs/economic-event-dispatch
 */

import { randomUUID } from 'crypto';
import type Database from 'better-sqlite3';
import { logger as defaultLogger } from '../utils/logger.js';
import { sqliteTimestamp } from '../packages/adapters/billing/protocol/timestamps.js';

// =============================================================================
// Types
// =============================================================================

export interface EconomicEventDispatchConfig {
  db: Database.Database;
  /** External publisher function. Receives event rows and publishes them. */
  publish?: (events: OutboxEvent[]) => Promise<void>;
  /** Batch size per claim cycle. Default: 100 */
  batchSize?: number;
  /** Poll interval in milliseconds. Default: 10000 (10s) */
  intervalMs?: number;
  /** Stale claim timeout in seconds. Default: 60 */
  staleClaimTimeoutSeconds?: number;
  /** Optional custom logger */
  logger?: typeof defaultLogger;
}

export interface OutboxEvent {
  rowid: number;
  event_id: string;
  event_type: string;
  entity_type: string;
  entity_id: string;
  correlation_id: string | null;
  idempotency_key: string | null;
  config_version: number | null;
  payload: string;
  created_at: string;
}

export interface DispatchResult {
  claimed: number;
  published: number;
  staleRecovered: number;
  errors: number;
}

// =============================================================================
// EconomicEventDispatchJob
// =============================================================================

export class EconomicEventDispatchJob {
  private db: Database.Database;
  private publish: (events: OutboxEvent[]) => Promise<void>;
  private batchSize: number;
  private intervalMs: number;
  private staleClaimTimeoutSeconds: number;
  private logger: typeof defaultLogger;
  private workerId: string;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(config: EconomicEventDispatchConfig) {
    this.db = config.db;
    this.publish = config.publish ?? (async () => {});
    this.batchSize = config.batchSize ?? 100;
    this.intervalMs = config.intervalMs ?? 10_000;
    this.staleClaimTimeoutSeconds = config.staleClaimTimeoutSeconds ?? 60;
    this.logger = config.logger ?? defaultLogger;
    this.workerId = `worker-${randomUUID().slice(0, 8)}`;
  }

  /**
   * Execute a single dispatch cycle: recover stale claims, claim new events, publish.
   */
  async execute(): Promise<DispatchResult> {
    const result: DispatchResult = { claimed: 0, published: 0, staleRecovered: 0, errors: 0 };

    try {
      // Step 0: Recover stale claims
      result.staleRecovered = this.recoverStaleClaims();

      // Step 1: SELECT unclaimed event rowids
      const unclaimed = this.db.prepare(`
        SELECT rowid FROM economic_events
        WHERE published_at IS NULL AND claimed_by IS NULL
        ORDER BY rowid
        LIMIT ?
      `).all(this.batchSize) as Array<{ rowid: number }>;

      if (unclaimed.length === 0) return result;

      const rowids = unclaimed.map(r => r.rowid);
      const now = sqliteTimestamp();

      // Step 2: Claim events atomically (WHERE claimed_by IS NULL prevents races)
      const placeholders = rowids.map(() => '?').join(',');
      const claimResult = this.db.prepare(`
        UPDATE economic_events
        SET claimed_by = ?, claimed_at = ?
        WHERE rowid IN (${placeholders})
          AND claimed_by IS NULL
          AND published_at IS NULL
      `).run(this.workerId, now, ...rowids);

      result.claimed = claimResult.changes;

      if (result.claimed === 0) return result;

      // Step 3: SELECT claimed rows for processing
      const claimed = this.db.prepare(`
        SELECT rowid, event_id, event_type, entity_type, entity_id,
               correlation_id, idempotency_key, config_version, payload, created_at
        FROM economic_events
        WHERE claimed_by = ? AND published_at IS NULL
      `).all(this.workerId) as OutboxEvent[];

      // Step 4: Publish externally
      await this.publish(claimed);

      // Step 5: Mark as published
      for (const event of claimed) {
        try {
          this.db.prepare(`
            UPDATE economic_events SET published_at = ?
            WHERE rowid = ? AND claimed_by = ?
          `).run(sqliteTimestamp(), event.rowid, this.workerId);
          result.published++;
        } catch (err) {
          result.errors++;
          this.logger.error({
            event: 'dispatch.publish_mark_error',
            eventId: event.event_id,
            error: err,
          }, 'Failed to mark event as published');
        }
      }

      this.logger.info({
        event: 'dispatch.cycle_complete',
        ...result,
      }, `Dispatch: ${result.published} published, ${result.staleRecovered} recovered`);

    } catch (err) {
      this.logger.error({ event: 'dispatch.cycle_error', error: err }, 'Dispatch cycle failed');
      result.errors++;
    }

    return result;
  }

  /**
   * Recover events claimed >60s ago without being published.
   */
  private recoverStaleClaims(): number {
    const result = this.db.prepare(`
      UPDATE economic_events
      SET claimed_by = NULL, claimed_at = NULL
      WHERE claimed_by IS NOT NULL
        AND published_at IS NULL
        AND claimed_at < datetime('now', '-' || ? || ' seconds')
    `).run(this.staleClaimTimeoutSeconds);

    if (result.changes > 0) {
      this.logger.warn({
        event: 'dispatch.stale_recovery',
        count: result.changes,
      }, `Recovered ${result.changes} stale claims`);
    }

    return result.changes;
  }

  start(): void {
    if (this.timer) return;

    this.logger.info({
      event: 'dispatch.started',
      workerId: this.workerId,
      intervalMs: this.intervalMs,
    }, `Economic event dispatcher started (worker: ${this.workerId})`);

    this.timer = setInterval(() => {
      this.execute().catch(err => {
        this.logger.error({ event: 'dispatch.tick_error', error: err }, 'Dispatch tick failed');
      });
    }, this.intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      this.logger.info({ event: 'dispatch.stopped', workerId: this.workerId },
        'Economic event dispatcher stopped');
    }
  }
}

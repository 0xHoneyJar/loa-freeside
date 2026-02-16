/**
 * BillingEventEmitter — Dual-write event emitter for billing services.
 *
 * Wraps event insertion into the `billing_events` table. Services pass their
 * active transaction handle to ensure atomicity: the event is inserted within
 * the same transaction as the primary write. If the transaction rolls back,
 * the event is also rolled back.
 *
 * Usage:
 *   const emitter = new BillingEventEmitter(db);
 *
 *   db.transaction(() => {
 *     // primary write...
 *     emitter.emit({ type: 'EarningRecorded', ... }, { db: db });
 *   })();
 *
 * SDD refs: §3 Data Architecture (dual-write), §13 Key Decisions (ADR-014)
 * Sprint refs: Task 18.3
 *
 * @module adapters/billing/BillingEventEmitter
 */

import type Database from 'better-sqlite3';
import type { BillingEvent } from './protocol/billing-events.js';
import { sqliteTimestamp } from './protocol/timestamps.js';

/**
 * Accepts either a Database instance or a Transaction (which in better-sqlite3
 * is the same Database object within a transaction context).
 */
export interface EmitOptions {
  db: Database.Database;
}

export class BillingEventEmitter {
  private insertStmt: Database.Statement | null = null;
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  /**
   * Emit a billing event within the caller's transaction context.
   *
   * The event is synchronously inserted into `billing_events`.
   * If the caller's transaction rolls back, the event row is also rolled back.
   *
   * @param event - The billing event to emit
   * @param opts - Must include `db` — the database handle (same instance within transaction)
   */
  emit(event: BillingEvent, opts?: EmitOptions): void {
    const target = opts?.db ?? this.db;

    // Lazy-prepare the statement on the target database
    const stmt = target.prepare(`
      INSERT INTO billing_events (id, type, aggregate_id, aggregate_type, payload, causation_id, created_at)
      VALUES (lower(hex(randomblob(16))), ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      event.type,
      event.aggregateId,
      event.aggregateType,
      JSON.stringify(event.payload),
      event.causationId ?? null,
      event.timestamp || sqliteTimestamp(),
    );
  }

  /**
   * Query events for an aggregate.
   * Used for temporal queries and debugging.
   */
  getEventsForAggregate(
    aggregateType: string,
    aggregateId: string,
    opts?: { before?: string; types?: string[] },
  ): Array<{ id: string; type: string; aggregate_id: string; aggregate_type: string; payload: string; causation_id: string | null; created_at: string }> {
    let sql = `SELECT * FROM billing_events WHERE aggregate_type = ? AND aggregate_id = ?`;
    const params: unknown[] = [aggregateType, aggregateId];

    if (opts?.before) {
      sql += ` AND created_at <= ?`;
      params.push(opts.before);
    }

    if (opts?.types && opts.types.length > 0) {
      const placeholders = opts.types.map(() => '?').join(',');
      sql += ` AND type IN (${placeholders})`;
      params.push(...opts.types);
    }

    sql += ` ORDER BY created_at ASC, rowid ASC`;

    return this.db.prepare(sql).all(...params) as Array<{
      id: string;
      type: string;
      aggregate_id: string;
      aggregate_type: string;
      payload: string;
      causation_id: string | null;
      created_at: string;
    }>;
  }

  /**
   * Temporal balance query — reconstruct balance from events.
   *
   * Replays LotMinted (+delta) and ReservationFinalized (-delta) events
   * for a specific account and pool, up to `asOf` timestamp.
   *
   * @param accountId - The account to query
   * @param poolId - The pool to query
   * @param asOf - Reconstruct balance at this point in time (SQLite format)
   * @returns Balance in micro-USD as bigint
   */
  getBalanceAtTime(accountId: string, poolId: string, asOf: string): bigint {
    const events = this.db.prepare(`
      SELECT type, payload FROM billing_events
      WHERE aggregate_type IN ('lot', 'reservation')
        AND created_at <= ?
        AND type IN ('LotMinted', 'ReservationFinalized')
      ORDER BY created_at ASC, rowid ASC
    `).all(asOf) as Array<{ type: string; payload: string }>;

    let balance = 0n;

    for (const event of events) {
      const payload = JSON.parse(event.payload);

      // Filter to matching account + pool
      if (payload.accountId !== accountId) continue;
      if (payload.poolId !== poolId && payload.poolId !== null) continue;

      if (event.type === 'LotMinted') {
        balance += BigInt(payload.amountMicro);
      } else if (event.type === 'ReservationFinalized') {
        // deltaMicro is signed — negative means consumed
        balance += BigInt(payload.deltaMicro);
      }
    }

    return balance;
  }
}

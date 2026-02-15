/**
 * SQLite Counter Backend
 *
 * Persistent counter using ON CONFLICT DO UPDATE SET total = total + ?.
 * Uses a composite key "accountId:YYYY-MM-DD" for daily spending tracking.
 *
 * Requires the daily_agent_spending table (migration 036):
 *   CREATE TABLE daily_agent_spending (
 *     agent_account_id TEXT NOT NULL,
 *     spending_date TEXT NOT NULL,
 *     total_spent_micro TEXT NOT NULL DEFAULT '0',
 *     updated_at TEXT NOT NULL,
 *     PRIMARY KEY (agent_account_id, spending_date)
 *   );
 *
 * @module packages/shared/atomic-counter/SqliteCounterBackend
 */

import type { ICounterBackend } from './types.js';
import type Database from 'better-sqlite3';

export class SqliteCounterBackend implements ICounterBackend {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  async increment(key: string, amount: bigint): Promise<bigint> {
    const { accountId, date } = this.parseKey(key);

    this.db.prepare(`
      INSERT INTO daily_agent_spending (agent_account_id, spending_date, total_spent_micro, updated_at)
      VALUES (?, ?, ?, datetime('now'))
      ON CONFLICT(agent_account_id, spending_date) DO UPDATE SET
        total_spent_micro = total_spent_micro + excluded.total_spent_micro,
        updated_at = datetime('now')
    `).run(accountId, date, amount.toString());

    // Read back the new total
    const row = this.db.prepare(
      `SELECT total_spent_micro FROM daily_agent_spending
       WHERE agent_account_id = ? AND spending_date = ?`
    ).get(accountId, date) as { total_spent_micro: number | string } | undefined;

    return row ? BigInt(row.total_spent_micro) : amount;
  }

  async get(key: string): Promise<bigint> {
    const { accountId, date } = this.parseKey(key);

    const row = this.db.prepare(
      `SELECT total_spent_micro FROM daily_agent_spending
       WHERE agent_account_id = ? AND spending_date = ?`
    ).get(accountId, date) as { total_spent_micro: number | string } | undefined;

    return row ? BigInt(row.total_spent_micro) : 0n;
  }

  async reset(key: string): Promise<void> {
    const { accountId, date } = this.parseKey(key);

    this.db.prepare(
      `DELETE FROM daily_agent_spending
       WHERE agent_account_id = ? AND spending_date = ?`
    ).run(accountId, date);
  }

  /**
   * Parse composite key "accountId:YYYY-MM-DD" into components.
   */
  private parseKey(key: string): { accountId: string; date: string } {
    const lastColon = key.lastIndexOf(':');
    if (lastColon === -1) {
      return { accountId: key, date: new Date().toISOString().slice(0, 10) };
    }
    return {
      accountId: key.substring(0, lastColon),
      date: key.substring(lastColon + 1),
    };
  }
}

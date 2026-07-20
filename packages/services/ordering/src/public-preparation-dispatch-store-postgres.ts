/**
 * Durable CR-204A dispatch ledger (Postgres).
 */

import type pg from "pg";
import type {
  PrepDispatchRecord,
  PublicPrepDispatchStore,
} from "./public-preparation-dispatch-store.js";

function rowToRecord(row: pg.QueryResultRow): PrepDispatchRecord {
  return {
    command_inbox_key: row.command_inbox_key,
    work_item_id: row.work_item_id,
    work_id: row.work_id,
    lease_epoch: Number(row.lease_epoch),
    ...(row.external_job_ref != null ? { external_job_ref: row.external_job_ref } : {}),
    ...(row.dispatched_at != null
      ? { dispatched_at_unix_ms: new Date(row.dispatched_at).getTime() }
      : {}),
    ...(row.acked_at != null ? { acked_at_unix_ms: new Date(row.acked_at).getTime() } : {}),
    ...(row.lost_response === true ? { lost_response: true } : {}),
  };
}

export class PostgresPublicPrepDispatchStore implements PublicPrepDispatchStore {
  constructor(private readonly pool: pg.Pool) {}

  async recordIntent(input: {
    command_inbox_key: string;
    work_item_id: string;
    work_id: string;
    lease_epoch: number;
    now_ms: number;
  }): Promise<PrepDispatchRecord> {
    const existing = await this.get(input.command_inbox_key);
    if (existing) return existing;
    const at = new Date(input.now_ms).toISOString();
    await this.pool.query(
      `INSERT INTO public_prep_dispatch (
         command_inbox_key, work_item_id, work_id, lease_epoch, dispatched_at, created_at, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$5,$5)
       ON CONFLICT (command_inbox_key) DO NOTHING`,
      [input.command_inbox_key, input.work_item_id, input.work_id, input.lease_epoch, at],
    );
    const row = await this.get(input.command_inbox_key);
    if (!row) throw new Error("public_prep_dispatch insert vanished");
    return row;
  }

  async recordAck(input: {
    command_inbox_key: string;
    external_job_ref: string;
    now_ms: number;
  }): Promise<PrepDispatchRecord | undefined> {
    const at = new Date(input.now_ms).toISOString();
    const result = await this.pool.query(
      `UPDATE public_prep_dispatch
       SET external_job_ref = $2, acked_at = $3, lost_response = FALSE, updated_at = $3
       WHERE command_inbox_key = $1
       RETURNING *`,
      [input.command_inbox_key, input.external_job_ref, at],
    );
    if (result.rows.length === 0) return undefined;
    return rowToRecord(result.rows[0]);
  }

  async get(commandInboxKey: string): Promise<PrepDispatchRecord | undefined> {
    const result = await this.pool.query(
      "SELECT * FROM public_prep_dispatch WHERE command_inbox_key = $1",
      [commandInboxKey],
    );
    if (result.rows.length === 0) return undefined;
    return rowToRecord(result.rows[0]);
  }

  async listPendingReconciliation(now_ms: number): Promise<readonly PrepDispatchRecord[]> {
    const staleBefore = new Date(now_ms - 5_000).toISOString();
    const result = await this.pool.query(
      `SELECT * FROM public_prep_dispatch
       WHERE acked_at IS NULL
         AND dispatched_at IS NOT NULL
         AND dispatched_at <= $1
       ORDER BY dispatched_at`,
      [staleBefore],
    );
    return result.rows.map(rowToRecord);
  }

  async markLostResponse(commandInboxKey: string): Promise<void> {
    await this.pool.query(
      `UPDATE public_prep_dispatch
       SET lost_response = TRUE, updated_at = NOW()
       WHERE command_inbox_key = $1`,
      [commandInboxKey],
    );
  }
}

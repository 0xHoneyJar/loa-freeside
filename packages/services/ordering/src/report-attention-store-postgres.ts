import type pg from "pg";

import {
  type AttentionReceipt,
  type AttentionReceiptKey,
  type ReportAttentionSourceKind,
  type ReportAttentionStore,
} from "./report-attention-store.js";

export class PostgresReportAttentionStore implements ReportAttentionStore {
  constructor(
    private readonly pool: pg.Pool,
    private readonly now: () => number = () => Math.floor(Date.now() / 1000),
  ) {}

  async hasSeen(key: AttentionReceiptKey): Promise<boolean> {
    const res = await this.pool.query(
      `SELECT 1 FROM report_attention_receipts
       WHERE subject_ref = $1
         AND source_kind = $2
         AND source_id = $3
         AND transition_sequence = $4
       LIMIT 1`,
      [key.subject_ref, key.source_kind, key.source_id, key.transition_sequence],
    );
    return res.rowCount !== null && res.rowCount > 0;
  }

  async markSeen(input: {
    readonly subject_ref: string;
    readonly source_kind: ReportAttentionSourceKind;
    readonly source_id: string;
    readonly transition_sequence: number;
    readonly community_ref: string;
  }): Promise<AttentionReceipt> {
    const seenAt = new Date(this.now() * 1000).toISOString();
    const res = await this.pool.query(
      `INSERT INTO report_attention_receipts (
         subject_ref, source_kind, source_id, transition_sequence, community_ref, seen_at
       ) VALUES ($1, $2, $3, $4, $5, $6::timestamptz)
       ON CONFLICT (subject_ref, source_kind, source_id, transition_sequence)
       DO UPDATE SET seen_at = report_attention_receipts.seen_at
       RETURNING subject_ref, source_kind, source_id, transition_sequence,
                 community_ref, EXTRACT(EPOCH FROM seen_at)::bigint AS seen_at_unix`,
      [
        input.subject_ref,
        input.source_kind,
        input.source_id,
        input.transition_sequence,
        input.community_ref,
        seenAt,
      ],
    );
    const row = res.rows[0] as {
      subject_ref: string;
      source_kind: ReportAttentionSourceKind;
      source_id: string;
      transition_sequence: string | number;
      community_ref: string;
      seen_at_unix: string | number;
    };
    return {
      subject_ref: row.subject_ref,
      source_kind: row.source_kind,
      source_id: row.source_id,
      transition_sequence: Number(row.transition_sequence),
      community_ref: row.community_ref,
      seen_at_unix: Number(row.seen_at_unix),
    };
  }
}

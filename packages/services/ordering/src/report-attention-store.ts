/**
 * CR-305 — idempotent per-subject attention receipts.
 *
 * Logical uniqueness: (subject_ref, source_kind, source_id, transition_sequence).
 * Mark-seen is an upsert of seen_at and never creates a receipt for a source
 * the subject cannot currently read (callers enforce ACL before upsert).
 */

export const REPORT_ATTENTION_SOURCE_KIND = "collection_report_order" as const;
export type ReportAttentionSourceKind = typeof REPORT_ATTENTION_SOURCE_KIND;

export interface AttentionReceiptKey {
  readonly subject_ref: string;
  readonly source_kind: ReportAttentionSourceKind;
  readonly source_id: string;
  readonly transition_sequence: number;
}

export interface AttentionReceipt extends AttentionReceiptKey {
  readonly community_ref: string;
  readonly seen_at_unix: number;
}

export interface ReportAttentionStore {
  hasSeen(key: AttentionReceiptKey): Promise<boolean>;
  markSeen(input: {
    readonly subject_ref: string;
    readonly source_kind: ReportAttentionSourceKind;
    readonly source_id: string;
    readonly transition_sequence: number;
    readonly community_ref: string;
  }): Promise<AttentionReceipt>;
}

export class InMemoryReportAttentionStore implements ReportAttentionStore {
  private readonly receipts = new Map<string, AttentionReceipt>();
  private readonly now: () => number;

  constructor(opts: { now?: () => number } = {}) {
    this.now = opts.now ?? (() => Math.floor(Date.now() / 1000));
  }

  private keyOf(k: AttentionReceiptKey): string {
    return `${k.subject_ref}\0${k.source_kind}\0${k.source_id}\0${k.transition_sequence}`;
  }

  async hasSeen(key: AttentionReceiptKey): Promise<boolean> {
    return this.receipts.has(this.keyOf(key));
  }

  async markSeen(input: {
    readonly subject_ref: string;
    readonly source_kind: ReportAttentionSourceKind;
    readonly source_id: string;
    readonly transition_sequence: number;
    readonly community_ref: string;
  }): Promise<AttentionReceipt> {
    const key: AttentionReceiptKey = {
      subject_ref: input.subject_ref,
      source_kind: input.source_kind,
      source_id: input.source_id,
      transition_sequence: input.transition_sequence,
    };
    const existing = this.receipts.get(this.keyOf(key));
    if (existing) return existing;
    const receipt: AttentionReceipt = {
      ...key,
      community_ref: input.community_ref,
      seen_at_unix: this.now(),
    };
    this.receipts.set(this.keyOf(key), receipt);
    return receipt;
  }
}

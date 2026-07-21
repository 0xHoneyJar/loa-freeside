/**
 * CR-204A dispatch outbox/inbox ledger for Sonar command correlation and reconciliation.
 */

export interface PrepDispatchRecord {
  readonly command_inbox_key: string;
  readonly work_item_id: string;
  readonly work_id: string;
  readonly lease_epoch: number;
  readonly external_job_ref?: string;
  readonly dispatched_at_unix_ms?: number;
  readonly acked_at_unix_ms?: number;
  readonly lost_response?: boolean;
}

export interface PublicPrepDispatchStore {
  recordIntent(input: {
    command_inbox_key: string;
    work_item_id: string;
    work_id: string;
    lease_epoch: number;
    now_ms: number;
  }): Promise<PrepDispatchRecord>;
  recordAck(input: {
    command_inbox_key: string;
    external_job_ref: string;
    now_ms: number;
  }): Promise<PrepDispatchRecord | undefined>;
  get(commandInboxKey: string): Promise<PrepDispatchRecord | undefined>;
  listPendingReconciliation(now_ms: number): Promise<readonly PrepDispatchRecord[]>;
  markLostResponse(commandInboxKey: string): Promise<void>;
}

type MutableDispatch = {
  -readonly [K in keyof PrepDispatchRecord]: PrepDispatchRecord[K];
};

export class InMemoryPublicPrepDispatchStore implements PublicPrepDispatchStore {
  private readonly rows = new Map<string, MutableDispatch>();

  async recordIntent(input: {
    command_inbox_key: string;
    work_item_id: string;
    work_id: string;
    lease_epoch: number;
    now_ms: number;
  }): Promise<PrepDispatchRecord> {
    const existing = this.rows.get(input.command_inbox_key);
    if (existing) {
      return structuredClone(existing);
    }
    const row: MutableDispatch = {
      command_inbox_key: input.command_inbox_key,
      work_item_id: input.work_item_id,
      work_id: input.work_id,
      lease_epoch: input.lease_epoch,
      dispatched_at_unix_ms: input.now_ms,
    };
    this.rows.set(input.command_inbox_key, row);
    return structuredClone(row);
  }

  async recordAck(input: {
    command_inbox_key: string;
    external_job_ref: string;
    now_ms: number;
  }): Promise<PrepDispatchRecord | undefined> {
    const row = this.rows.get(input.command_inbox_key);
    if (!row) return undefined;
    row.external_job_ref = input.external_job_ref;
    row.acked_at_unix_ms = input.now_ms;
    row.lost_response = false;
    return structuredClone(row);
  }

  async get(commandInboxKey: string): Promise<PrepDispatchRecord | undefined> {
    const row = this.rows.get(commandInboxKey);
    return row ? structuredClone(row) : undefined;
  }

  async listPendingReconciliation(now_ms: number): Promise<readonly PrepDispatchRecord[]> {
    const staleMs = 5_000;
    return [...this.rows.values()]
      .filter(
        (row) =>
          row.dispatched_at_unix_ms !== undefined &&
          row.acked_at_unix_ms === undefined &&
          now_ms - row.dispatched_at_unix_ms >= staleMs,
      )
      .map((row) => structuredClone(row));
  }

  async markLostResponse(commandInboxKey: string): Promise<void> {
    const row = this.rows.get(commandInboxKey);
    if (row) row.lost_response = true;
  }
}

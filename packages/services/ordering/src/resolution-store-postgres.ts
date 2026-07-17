/**
 * Postgres ResolutionStore adapter (CR-006 expand).
 *
 * Implements the same transactional/CAS + idempotency retention semantics as
 * InMemoryResolutionStore. Ordering is the sole writer; Sonar never touches
 * these tables.
 */

import pg from "pg";
import {
  IDEMPOTENCY_KEY_RETENTION_MS,
  deepCloneFreeze,
  type ConfirmedResolutionRecord,
  type ResolutionConfirmCommand,
  type ResolutionCreateCommand,
  type ResolutionRefreshCommand,
} from "@freeside/collection-resolution-protocol";
import type {
  IdempotencyLookupResult,
  IdempotencyRecord,
  ResolutionOperation,
  ResolutionSelectionStaleOutcome,
  ResolutionStore,
} from "./resolution-store.js";

function sealRecord(record: ConfirmedResolutionRecord): ConfirmedResolutionRecord {
  return deepCloneFreeze(record);
}

function rowToIdempotency(row: pg.QueryResultRow): IdempotencyRecord {
  return {
    operation: row.operation as ResolutionOperation,
    idempotency_key: row.idempotency_key,
    subject_id: row.subject_id,
    command_digest: row.command_digest,
    ...(row.accepted_digest != null ? { accepted_digest: row.accepted_digest } : {}),
    resolution_id: row.resolution_id,
    stored_at_unix_ms: Number(row.stored_at_unix_ms),
    response_confirmation_version: Number(row.response_confirmation_version),
    response_snapshot: sealRecord(row.response_snapshot as ConfirmedResolutionRecord),
    ...(row.response_selection_stale != null
      ? {
          response_selection_stale: deepCloneFreeze(
            row.response_selection_stale as ResolutionSelectionStaleOutcome,
          ),
        }
      : {}),
  };
}

function replayFromEntry(
  entry: IdempotencyRecord,
): Extract<IdempotencyLookupResult, { readonly kind: "replay" }> {
  return {
    kind: "replay",
    record: sealRecord(entry.response_snapshot),
    ...(entry.response_selection_stale !== undefined
      ? { selection_stale: deepCloneFreeze(entry.response_selection_stale) }
      : {}),
  };
}

export interface PostgresResolutionStoreOptions {
  readonly pool: pg.Pool;
  readonly idempotency_retention_ms?: number;
}

export class PostgresResolutionStore implements ResolutionStore {
  private readonly pool: pg.Pool;
  private readonly retentionMs: number;

  constructor(opts: PostgresResolutionStoreOptions) {
    this.pool = opts.pool;
    this.retentionMs = opts.idempotency_retention_ms ?? IDEMPOTENCY_KEY_RETENTION_MS;
  }

  static async connect(
    connectionString: string,
    opts: { migrate?: boolean; pool?: pg.Pool } = {},
  ): Promise<PostgresResolutionStore> {
    const pool = opts.pool ?? new pg.Pool({ connectionString, max: 5 });
    const store = new PostgresResolutionStore({ pool });
    if (opts.migrate ?? process.env.RUN_MIGRATIONS === "true") {
      await store.runMigrations();
    }
    return store;
  }

  async runMigrations(): Promise<void> {
    const { readFileSync } = await import("node:fs");
    const { dirname, join } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const dir = dirname(fileURLToPath(import.meta.url));
    const sql = readFileSync(join(dir, "../migrations/004_collection_resolutions.sql"), "utf8");
    await this.pool.query(sql);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async get(resolutionId: string): Promise<ConfirmedResolutionRecord | undefined> {
    const result = await this.pool.query(
      "SELECT record FROM collection_resolutions WHERE resolution_id = $1",
      [resolutionId],
    );
    if (result.rows.length === 0) return undefined;
    return sealRecord(result.rows[0].record as ConfirmedResolutionRecord);
  }

  async pruneIdempotency(nowMs: number, retentionMs = this.retentionMs): Promise<number> {
    const cutoff = nowMs - retentionMs;
    const result = await this.pool.query(
      "DELETE FROM collection_resolution_idempotency WHERE stored_at_unix_ms < $1",
      [cutoff],
    );
    return result.rowCount ?? 0;
  }

  async lookupIdempotency(input: {
    readonly operation: ResolutionOperation;
    readonly subject_id: string;
    readonly idempotency_key: string;
    readonly command_digest: string;
    readonly now_ms: number;
  }): Promise<IdempotencyLookupResult> {
    await this.pruneIdempotency(input.now_ms);
    const result = await this.pool.query(
      `SELECT * FROM collection_resolution_idempotency
       WHERE operation = $1 AND subject_id = $2 AND idempotency_key = $3`,
      [input.operation, input.subject_id, input.idempotency_key],
    );
    if (result.rows.length === 0) return { kind: "absent" };
    const entry = rowToIdempotency(result.rows[0]);
    if (entry.command_digest !== input.command_digest) return { kind: "conflict" };
    return replayFromEntry(entry);
  }

  private async insertIdempotency(
    client: pg.PoolClient,
    entry: IdempotencyRecord,
  ): Promise<void> {
    await client.query(
      `INSERT INTO collection_resolution_idempotency (
        operation, subject_id, idempotency_key, command_digest, accepted_digest,
        resolution_id, stored_at_unix_ms, response_confirmation_version,
        response_snapshot, response_selection_stale
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        entry.operation,
        entry.subject_id,
        entry.idempotency_key,
        entry.command_digest,
        entry.accepted_digest ?? null,
        entry.resolution_id,
        entry.stored_at_unix_ms,
        entry.response_confirmation_version,
        JSON.stringify(entry.response_snapshot),
        entry.response_selection_stale
          ? JSON.stringify(entry.response_selection_stale)
          : null,
      ],
    );
  }

  async createAtomic(input: {
    readonly record: ConfirmedResolutionRecord;
    readonly command: ResolutionCreateCommand;
    readonly command_digest: string;
    readonly now_ms: number;
  }): Promise<
    | { readonly kind: "created"; readonly record: ConfirmedResolutionRecord }
    | { readonly kind: "replay"; readonly record: ConfirmedResolutionRecord }
    | { readonly kind: "conflict" }
    | { readonly kind: "resolution_id_conflict" }
  > {
    await this.pruneIdempotency(input.now_ms);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const existing = await client.query(
        `SELECT * FROM collection_resolution_idempotency
         WHERE operation = 'create' AND subject_id = $1 AND idempotency_key = $2
         FOR UPDATE`,
        [input.record.requester_subject, input.command.idempotency_key],
      );
      if (existing.rows.length > 0) {
        const entry = rowToIdempotency(existing.rows[0]);
        await client.query("COMMIT");
        if (entry.command_digest !== input.command_digest) return { kind: "conflict" };
        return replayFromEntry(entry);
      }

      const idClash = await client.query(
        "SELECT 1 FROM collection_resolutions WHERE resolution_id = $1 FOR UPDATE",
        [input.record.resolution_id],
      );
      if (idClash.rows.length > 0) {
        await client.query("COMMIT");
        return { kind: "resolution_id_conflict" };
      }

      const sealed = sealRecord(input.record);
      await client.query(
        `INSERT INTO collection_resolutions (
          resolution_id, requester_subject, confirmation_version, expires_at, record
        ) VALUES ($1,$2,$3,$4,$5)`,
        [
          sealed.resolution_id,
          sealed.requester_subject,
          sealed.confirmation_version,
          sealed.expires_at,
          JSON.stringify(sealed),
        ],
      );
      await this.insertIdempotency(client, {
        operation: "create",
        idempotency_key: input.command.idempotency_key,
        subject_id: sealed.requester_subject,
        command_digest: input.command_digest,
        resolution_id: sealed.resolution_id,
        stored_at_unix_ms: input.now_ms,
        response_confirmation_version: sealed.confirmation_version,
        response_snapshot: sealRecord(sealed),
      });
      await client.query("COMMIT");
      return { kind: "created", record: sealRecord(sealed) };
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }

  async confirmCas(input: {
    readonly resolution_id: string;
    readonly expected_confirmation_version: number;
    readonly command: ResolutionConfirmCommand;
    readonly command_digest: string;
    readonly subject_id: string;
    readonly patch: Pick<
      ConfirmedResolutionRecord,
      | "selected_deployment_ids"
      | "confirmed_at"
      | "updated_at"
      | "confirmation_version"
    > & {
      readonly selected_collection_id?: ConfirmedResolutionRecord["selected_collection_id"];
    };
    readonly now_ms: number;
  }): Promise<
    | { readonly kind: "confirmed"; readonly record: ConfirmedResolutionRecord }
    | { readonly kind: "replay"; readonly record: ConfirmedResolutionRecord }
    | { readonly kind: "conflict" }
    | { readonly kind: "version_conflict"; readonly record: ConfirmedResolutionRecord }
    | { readonly kind: "subject_mismatch" }
    | { readonly kind: "not_found" }
  > {
    await this.pruneIdempotency(input.now_ms);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const existingIdem = await client.query(
        `SELECT * FROM collection_resolution_idempotency
         WHERE operation = 'confirm' AND subject_id = $1 AND idempotency_key = $2
         FOR UPDATE`,
        [input.subject_id, input.command.idempotency_key],
      );
      if (existingIdem.rows.length > 0) {
        const entry = rowToIdempotency(existingIdem.rows[0]);
        await client.query("COMMIT");
        if (entry.command_digest !== input.command_digest) return { kind: "conflict" };
        return replayFromEntry(entry);
      }

      const currentRes = await client.query(
        `SELECT record FROM collection_resolutions WHERE resolution_id = $1 FOR UPDATE`,
        [input.resolution_id],
      );
      if (currentRes.rows.length === 0) {
        await client.query("COMMIT");
        return { kind: "not_found" };
      }
      const current = sealRecord(currentRes.rows[0].record as ConfirmedResolutionRecord);
      if (current.requester_subject !== input.subject_id) {
        await client.query("COMMIT");
        return { kind: "subject_mismatch" };
      }
      if (current.confirmation_version !== input.expected_confirmation_version) {
        await client.query("COMMIT");
        return { kind: "version_conflict", record: current };
      }

      const next = sealRecord({
        ...current,
        selected_deployment_ids: deepCloneFreeze(input.patch.selected_deployment_ids),
        ...(input.patch.selected_collection_id !== undefined
          ? { selected_collection_id: deepCloneFreeze(input.patch.selected_collection_id) }
          : {}),
        confirmed_at: input.patch.confirmed_at,
        updated_at: input.patch.updated_at,
        confirmation_version: input.patch.confirmation_version,
        expires_at: current.expires_at,
      });

      await client.query(
        `UPDATE collection_resolutions
         SET record = $2, confirmation_version = $3, updated_at = NOW()
         WHERE resolution_id = $1`,
        [input.resolution_id, JSON.stringify(next), next.confirmation_version],
      );
      await this.insertIdempotency(client, {
        operation: "confirm",
        idempotency_key: input.command.idempotency_key,
        subject_id: input.subject_id,
        command_digest: input.command_digest,
        resolution_id: input.resolution_id,
        stored_at_unix_ms: input.now_ms,
        response_confirmation_version: next.confirmation_version,
        response_snapshot: sealRecord(next),
      });
      await client.query("COMMIT");
      return { kind: "confirmed", record: sealRecord(next) };
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }

  async refreshCas(input: {
    readonly resolution_id: string;
    readonly expected_confirmation_version: number;
    readonly command: ResolutionRefreshCommand;
    readonly command_digest: string;
    readonly accepted_digest?: string;
    readonly selection_stale?: ResolutionSelectionStaleOutcome;
    readonly subject_id: string;
    readonly patch: Partial<
      Pick<
        ConfirmedResolutionRecord,
        | "candidate_snapshot"
        | "candidate_snapshot_digest"
        | "capability_snapshot_version"
        | "selected_deployment_ids"
        | "selected_collection_id"
        | "confirmed_at"
        | "expires_at"
        | "updated_at"
        | "confirmation_version"
      >
    > & {
      readonly confirmation_version: number;
      readonly updated_at: string;
      readonly clear_selection?: boolean;
    };
    readonly now_ms: number;
  }): Promise<
    | {
        readonly kind: "refreshed";
        readonly record: ConfirmedResolutionRecord;
        readonly selection_stale?: ResolutionSelectionStaleOutcome;
      }
    | {
        readonly kind: "replay";
        readonly record: ConfirmedResolutionRecord;
        readonly selection_stale?: ResolutionSelectionStaleOutcome;
      }
    | { readonly kind: "conflict" }
    | { readonly kind: "version_conflict"; readonly record: ConfirmedResolutionRecord }
    | { readonly kind: "subject_mismatch" }
    | { readonly kind: "not_found" }
  > {
    await this.pruneIdempotency(input.now_ms);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const existingIdem = await client.query(
        `SELECT * FROM collection_resolution_idempotency
         WHERE operation = 'refresh' AND subject_id = $1 AND idempotency_key = $2
         FOR UPDATE`,
        [input.subject_id, input.command.idempotency_key],
      );
      if (existingIdem.rows.length > 0) {
        const entry = rowToIdempotency(existingIdem.rows[0]);
        await client.query("COMMIT");
        if (entry.command_digest !== input.command_digest) return { kind: "conflict" };
        return replayFromEntry(entry);
      }

      const currentRes = await client.query(
        `SELECT record FROM collection_resolutions WHERE resolution_id = $1 FOR UPDATE`,
        [input.resolution_id],
      );
      if (currentRes.rows.length === 0) {
        await client.query("COMMIT");
        return { kind: "not_found" };
      }
      const current = sealRecord(currentRes.rows[0].record as ConfirmedResolutionRecord);
      if (current.requester_subject !== input.subject_id) {
        await client.query("COMMIT");
        return { kind: "subject_mismatch" };
      }
      if (current.confirmation_version !== input.expected_confirmation_version) {
        await client.query("COMMIT");
        return { kind: "version_conflict", record: current };
      }

      const {
        clear_selection: clearSelection,
        selected_deployment_ids: selectedDeploymentIds,
        selected_collection_id: selectedCollectionId,
        confirmed_at: confirmedAt,
        expires_at: expiresAt,
        candidate_snapshot: candidateSnapshot,
        candidate_snapshot_digest: candidateSnapshotDigest,
        capability_snapshot_version: capabilitySnapshotVersion,
        confirmation_version: confirmationVersion,
        updated_at: updatedAt,
      } = input.patch;

      let next: ConfirmedResolutionRecord = {
        ...current,
        confirmation_version: confirmationVersion,
        updated_at: updatedAt,
        ...(candidateSnapshot !== undefined
          ? { candidate_snapshot: deepCloneFreeze(candidateSnapshot) }
          : {}),
        ...(candidateSnapshotDigest !== undefined
          ? { candidate_snapshot_digest: deepCloneFreeze(candidateSnapshotDigest) }
          : {}),
        ...(capabilitySnapshotVersion !== undefined
          ? { capability_snapshot_version: deepCloneFreeze(capabilitySnapshotVersion) }
          : {}),
        ...(expiresAt !== undefined ? { expires_at: expiresAt } : {}),
      };

      if (clearSelection === true) {
        const {
          selected_deployment_ids: _dropIds,
          selected_collection_id: _dropCollection,
          confirmed_at: _dropConfirmed,
          ...withoutSelection
        } = next;
        next = withoutSelection as ConfirmedResolutionRecord;
      } else {
        if (selectedDeploymentIds !== undefined) {
          next = {
            ...next,
            selected_deployment_ids: deepCloneFreeze(selectedDeploymentIds),
          };
        }
        if (selectedCollectionId !== undefined) {
          next = {
            ...next,
            selected_collection_id: deepCloneFreeze(selectedCollectionId),
          };
        }
        if (confirmedAt !== undefined) {
          next = { ...next, confirmed_at: confirmedAt };
        }
      }

      next = sealRecord(next);
      await client.query(
        `UPDATE collection_resolutions
         SET record = $2, confirmation_version = $3, expires_at = $4, updated_at = NOW()
         WHERE resolution_id = $1`,
        [input.resolution_id, JSON.stringify(next), next.confirmation_version, next.expires_at],
      );
      await this.insertIdempotency(client, {
        operation: "refresh",
        idempotency_key: input.command.idempotency_key,
        subject_id: input.subject_id,
        command_digest: input.command_digest,
        ...(input.accepted_digest !== undefined
          ? { accepted_digest: input.accepted_digest }
          : {}),
        resolution_id: input.resolution_id,
        stored_at_unix_ms: input.now_ms,
        response_confirmation_version: next.confirmation_version,
        response_snapshot: sealRecord(next),
        ...(input.selection_stale !== undefined
          ? { response_selection_stale: deepCloneFreeze(input.selection_stale) }
          : {}),
      });
      await client.query("COMMIT");
      return {
        kind: "refreshed",
        record: sealRecord(next),
        ...(input.selection_stale !== undefined
          ? { selection_stale: deepCloneFreeze(input.selection_stale) }
          : {}),
      };
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }
}

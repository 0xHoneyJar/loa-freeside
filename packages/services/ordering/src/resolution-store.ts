/**
 * Durable collection-resolution store port (CR-006).
 *
 * Ordering is the sole writer and system of record. Sonar never reads or writes
 * this store. The in-memory reference backend proves transactional/CAS and
 * idempotency semantics; a later Postgres adapter is mechanical behind this port.
 *
 * EXTERNAL IMPLEMENTATION BLOCKER: no production Postgres migration/adapter is
 * shipped by CR-006. Deploying durable resolution sessions to production requires
 * a Persistence adapter that implements `ResolutionStore` with the same atomic
 * create/confirm/refresh + idempotency retention guarantees.
 *
 * EXTERNAL AUTH/HTTP BLOCKER: no production authorization endpoint wiring is
 * shipped by CR-006; Dashboard/Sonar HTTP auth remains downstream (CR-007A).
 */

import type {
  ConfirmedResolutionRecord,
  ResolutionCreateCommand,
  ResolutionConfirmCommand,
  ResolutionRefreshCommand,
} from "@freeside/collection-resolution-protocol";
import {
  IDEMPOTENCY_KEY_RETENTION_MS,
  deepCloneFreeze,
} from "@freeside/collection-resolution-protocol";

export type ResolutionOperation = "create" | "confirm" | "refresh";

export interface IdempotencyRecord {
  readonly operation: ResolutionOperation;
  readonly idempotency_key: string;
  readonly subject_id: string;
  /** Exact client/server input fingerprint used for pre-probe conflict/replay. */
  readonly command_digest: string;
  /**
   * Optional accepted-command fingerprint including probe outputs (next
   * candidate snapshot digest, capability snapshot, expiry decision).
   */
  readonly accepted_digest?: string;
  readonly resolution_id: string;
  readonly stored_at_unix_ms: number;
  readonly response_confirmation_version: number;
  /**
   * Deeply immutable sealed record snapshot from the accepted command.
   * Replay returns this historical response even after later CAS transitions;
   * it never rolls current store truth back.
   */
  readonly response_snapshot: ConfirmedResolutionRecord;
}

export type IdempotencyLookupResult =
  | { readonly kind: "absent" }
  | { readonly kind: "replay"; readonly record: ConfirmedResolutionRecord }
  | { readonly kind: "conflict" };

export interface ResolutionStore {
  get(resolutionId: string): Promise<ConfirmedResolutionRecord | undefined>;

  /**
   * Look up an idempotency key without mutating. Used by create/confirm/refresh
   * to conflict or replay before probe / mutable session checks. Replay returns
   * the historical sealed response snapshot, not current store truth.
   */
  lookupIdempotency(input: {
    readonly operation: ResolutionOperation;
    readonly subject_id: string;
    readonly idempotency_key: string;
    readonly command_digest: string;
    readonly now_ms: number;
  }): Promise<IdempotencyLookupResult>;

  /**
   * Atomically insert a new resolution when absent. Idempotent on
   * (operation, subject, key) with exact-command conflict detection.
   */
  createAtomic(input: {
    readonly record: ConfirmedResolutionRecord;
    readonly command: ResolutionCreateCommand;
    readonly command_digest: string;
    readonly now_ms: number;
  }): Promise<
    | { readonly kind: "created"; readonly record: ConfirmedResolutionRecord }
    | { readonly kind: "replay"; readonly record: ConfirmedResolutionRecord }
    | { readonly kind: "conflict" }
  >;

  /**
   * Compare-and-swap confirm. Succeeds only when confirmation_version matches
   * expected. Concurrent losers observe the winner's record.
   */
  confirmCas(input: {
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
    | { readonly kind: "not_found" }
  >;

  /**
   * Compare-and-swap refresh that advances confirmation_version.
   * Selection may be preserved (byte-equivalent) or cleared (selection_stale).
   * Only an unchanged expired refresh supplies a new expires_at.
   */
  refreshCas(input: {
    readonly resolution_id: string;
    readonly expected_confirmation_version: number;
    readonly command: ResolutionRefreshCommand;
    readonly command_digest: string;
    readonly accepted_digest?: string;
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
    | { readonly kind: "refreshed"; readonly record: ConfirmedResolutionRecord }
    | { readonly kind: "replay"; readonly record: ConfirmedResolutionRecord }
    | { readonly kind: "conflict" }
    | { readonly kind: "version_conflict"; readonly record: ConfirmedResolutionRecord }
    | { readonly kind: "not_found" }
  >;

  /** Evict idempotency keys older than retention; used by tests and adapters. */
  pruneIdempotency(nowMs: number, retentionMs?: number): Promise<number>;
}

export interface InMemoryResolutionStoreOptions {
  readonly idempotency_retention_ms?: number;
}

const idempotencyMapKey = (
  operation: ResolutionOperation,
  subjectId: string,
  key: string,
): string => `${operation}:${subjectId}:${key}`;

const sealRecord = (record: ConfirmedResolutionRecord): ConfirmedResolutionRecord =>
  deepCloneFreeze(record);

const sealReplay = (entry: IdempotencyRecord): ConfirmedResolutionRecord =>
  sealRecord(entry.response_snapshot);

export class InMemoryResolutionStore implements ResolutionStore {
  private readonly records = new Map<string, ConfirmedResolutionRecord>();
  private readonly idempotency = new Map<string, IdempotencyRecord>();
  private readonly retentionMs: number;

  constructor(options: InMemoryResolutionStoreOptions = {}) {
    this.retentionMs = options.idempotency_retention_ms ?? IDEMPOTENCY_KEY_RETENTION_MS;
  }

  async get(resolutionId: string): Promise<ConfirmedResolutionRecord | undefined> {
    const record = this.records.get(resolutionId);
    return record === undefined ? undefined : sealRecord(record);
  }

  async lookupIdempotency(input: {
    readonly operation: ResolutionOperation;
    readonly subject_id: string;
    readonly idempotency_key: string;
    readonly command_digest: string;
    readonly now_ms: number;
  }): Promise<IdempotencyLookupResult> {
    await this.pruneIdempotency(input.now_ms);
    const key = idempotencyMapKey(input.operation, input.subject_id, input.idempotency_key);
    const existing = this.idempotency.get(key);
    if (existing === undefined) return { kind: "absent" };
    if (existing.command_digest !== input.command_digest) return { kind: "conflict" };
    return { kind: "replay", record: sealReplay(existing) };
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
  > {
    await this.pruneIdempotency(input.now_ms);
    const key = idempotencyMapKey(
      "create",
      input.record.requester_subject,
      input.command.idempotency_key,
    );
    const existing = this.idempotency.get(key);
    if (existing !== undefined) {
      if (existing.command_digest !== input.command_digest) {
        return { kind: "conflict" };
      }
      return { kind: "replay", record: sealReplay(existing) };
    }

    const sealed = sealRecord(input.record);
    this.records.set(sealed.resolution_id, sealed);
    this.idempotency.set(key, {
      operation: "create",
      idempotency_key: input.command.idempotency_key,
      subject_id: sealed.requester_subject,
      command_digest: input.command_digest,
      resolution_id: sealed.resolution_id,
      stored_at_unix_ms: input.now_ms,
      response_confirmation_version: sealed.confirmation_version,
      response_snapshot: sealRecord(sealed),
    });
    return { kind: "created", record: sealRecord(sealed) };
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
    | { readonly kind: "not_found" }
  > {
    await this.pruneIdempotency(input.now_ms);
    const key = idempotencyMapKey("confirm", input.subject_id, input.command.idempotency_key);
    const existing = this.idempotency.get(key);
    if (existing !== undefined) {
      if (existing.command_digest !== input.command_digest) {
        return { kind: "conflict" };
      }
      return { kind: "replay", record: sealReplay(existing) };
    }

    const current = this.records.get(input.resolution_id);
    if (current === undefined) return { kind: "not_found" };
    if (current.confirmation_version !== input.expected_confirmation_version) {
      return { kind: "version_conflict", record: sealRecord(current) };
    }

    // Confirm retains existing expires_at — never extends TTL.
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
    this.records.set(input.resolution_id, next);
    this.idempotency.set(key, {
      operation: "confirm",
      idempotency_key: input.command.idempotency_key,
      subject_id: input.subject_id,
      command_digest: input.command_digest,
      resolution_id: input.resolution_id,
      stored_at_unix_ms: input.now_ms,
      response_confirmation_version: next.confirmation_version,
      response_snapshot: sealRecord(next),
    });
    return { kind: "confirmed", record: sealRecord(next) };
  }

  async refreshCas(input: {
    readonly resolution_id: string;
    readonly expected_confirmation_version: number;
    readonly command: ResolutionRefreshCommand;
    readonly command_digest: string;
    readonly accepted_digest?: string;
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
    | { readonly kind: "refreshed"; readonly record: ConfirmedResolutionRecord }
    | { readonly kind: "replay"; readonly record: ConfirmedResolutionRecord }
    | { readonly kind: "conflict" }
    | { readonly kind: "version_conflict"; readonly record: ConfirmedResolutionRecord }
    | { readonly kind: "not_found" }
  > {
    await this.pruneIdempotency(input.now_ms);
    const key = idempotencyMapKey("refresh", input.subject_id, input.command.idempotency_key);
    const existing = this.idempotency.get(key);
    if (existing !== undefined) {
      if (existing.command_digest !== input.command_digest) {
        return { kind: "conflict" };
      }
      return { kind: "replay", record: sealReplay(existing) };
    }

    const current = this.records.get(input.resolution_id);
    if (current === undefined) return { kind: "not_found" };
    if (current.confirmation_version !== input.expected_confirmation_version) {
      return { kind: "version_conflict", record: sealRecord(current) };
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
      next = withoutSelection;
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

    const sealed = sealRecord(next);
    this.records.set(input.resolution_id, sealed);
    this.idempotency.set(key, {
      operation: "refresh",
      idempotency_key: input.command.idempotency_key,
      subject_id: input.subject_id,
      command_digest: input.command_digest,
      ...(input.accepted_digest !== undefined
        ? { accepted_digest: input.accepted_digest }
        : {}),
      resolution_id: input.resolution_id,
      stored_at_unix_ms: input.now_ms,
      response_confirmation_version: sealed.confirmation_version,
      response_snapshot: sealRecord(sealed),
    });
    return { kind: "refreshed", record: sealRecord(sealed) };
  }

  async pruneIdempotency(
    nowMs: number,
    retentionMs: number = this.retentionMs,
  ): Promise<number> {
    let removed = 0;
    for (const [key, record] of Array.from(this.idempotency.entries())) {
      if (nowMs - record.stored_at_unix_ms > retentionMs) {
        this.idempotency.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  /** Test seam: inspect retained idempotency entries. */
  idempotencySize(): number {
    return this.idempotency.size;
  }
}

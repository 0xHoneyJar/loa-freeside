/**
 * CR-201C admission capacity store + in-memory serializable admission transaction.
 *
 * One transaction locks authoritative counters, checks the recipe certificate,
 * and atomically writes capacity consumption, idempotency, order, root work/links,
 * and outbox events. There is no separate pre-admission reservation state.
 *
 * Three ledgers are non-interchangeable:
 *  - admission_rate: one-time tokens per accepted order
 *  - queued_work: durable envelopes held until fulfillment/terminal/cancel
 *  - active_execution: short leases acquired only at dispatch
 *
 * Subscriber fan-in consumes admission_rate per order but never duplicates the
 * shared-work queued envelope (one envelope per work_key_digest while held).
 */

import { createHash, randomUUID } from "node:crypto";
import {
  ACTIVE_EXECUTION_LEASE_MS,
  ADMISSION_SERIALIZATION_RETRIES,
  ADVISORY_LOCK_WAIT_BUDGET_MS,
  DEFAULT_ACTIVE_EXECUTION_LIMIT,
  DEFAULT_ADMISSION_RATE_LIMIT,
  DEFAULT_QUEUED_WORK_LIMIT,
} from "./admission-capacity-constants.js";
import {
  AdmissionIdempotencyConflictError,
  CapacityUnavailableError,
  type CapacityLedgerKind,
  type CapacityPoolRecord,
  type CapacityPoolScope,
  type CapacityReservationRecord,
  type CapacityTransferEvent,
  type OrderAdmissionIdempotencyRecord,
  type RecipeExpansionCertificate,
} from "./admission-capacity-types.js";
import { assertCertificateAdmissible } from "./recipe-expansion-certificate.js";
import { digestOf } from "./digest.js";
import type { NewOrder, OrderRecord, OrderStore, OutboxEvent } from "./store.js";
import type {
  JoinPublicWorkResult,
  SharedPreparationStore,
} from "./shared-preparation-store.js";
import type { PublicPreparationWorkKeyMaterial } from "./shared-preparation-types.js";
import { digestPublicWorkKey } from "./shared-preparation-work-key.js";
import { ORDER_LIFECYCLE_SUBJECTS, type OrderPlaced } from "@freeside/ordering-protocol";

export interface EnsurePoolInput extends CapacityPoolScope {
  readonly ledger_kind: CapacityLedgerKind;
  readonly limit_units: number;
}

export interface AdmitOrderInput {
  readonly requester_subject: string;
  readonly client_request_id: string;
  readonly order: Omit<NewOrder, "order_id"> & { order_id?: string };
  readonly body: Record<string, unknown>;
  readonly certificate: RecipeExpansionCertificate;
  readonly work_key: PublicPreparationWorkKeyMaterial;
  readonly order_tenant_scope_digest: string;
  readonly pool_scope: CapacityPoolScope;
  readonly now_ms: number;
  /** When true, shed before opening the transaction (advisory only). */
  readonly advisory_shed?: boolean;
  /** Simulated lock-wait ms for advisory shed tests. */
  readonly simulated_lock_wait_ms?: number;
}

export type AdmitOrderResult =
  | {
      readonly kind: "admitted";
      readonly order: OrderRecord;
      readonly created: boolean;
      readonly work_created: boolean;
      readonly work_id: string;
      readonly reservation_ids: readonly string[];
      readonly replay: boolean;
    }
  | { readonly kind: "capacity_unavailable"; readonly reason: string }
  | { readonly kind: "idempotency_conflict" };

export interface AdmissionCapacityStore {
  ensurePool(input: EnsurePoolInput & { now_ms: number }): Promise<CapacityPoolRecord>;
  getPool(poolId: string): Promise<CapacityPoolRecord | undefined>;
  listPools(): Promise<readonly CapacityPoolRecord[]>;
  getReservation(reservationId: string): Promise<CapacityReservationRecord | undefined>;
  listHeldReservations(orderId: string): Promise<readonly CapacityReservationRecord[]>;
  listTransferLog(reservationId: string): Promise<readonly CapacityTransferEvent[]>;
  getIdempotency(
    requester: string,
    clientRequestId: string,
  ): Promise<OrderAdmissionIdempotencyRecord | undefined>;
  admitOrder(input: AdmitOrderInput): Promise<AdmitOrderResult>;
  acquireActiveExecutionLease(input: {
    order_id: string;
    pool_scope: CapacityPoolScope;
    quantity?: number;
    lease_duration_ms?: number;
    now_ms: number;
  }): Promise<
    | { readonly kind: "acquired"; readonly reservation: CapacityReservationRecord }
    | { readonly kind: "capacity_unavailable"; readonly reason: string }
    | { readonly kind: "order_not_found" }
  >;
  releaseReservation(input: {
    reservation_id: string;
    expected_version: number;
    reason: string;
    now_ms: number;
  }): Promise<
    | { readonly kind: "released"; readonly reservation: CapacityReservationRecord }
    | { readonly kind: "already_released"; readonly reservation: CapacityReservationRecord }
    | { readonly kind: "version_mismatch" }
    | { readonly kind: "not_found" }
  >;
  releaseOrderCapacity(input: {
    order_id: string;
    reason: "fulfilled" | "terminal_failure" | "cancelled" | "abandoned";
    now_ms: number;
  }): Promise<{ readonly released: number }>;
  reconcileExpiredActiveLeases(input: {
    now_ms: number;
  }): Promise<{ readonly expired: number }>;
  snapshotAccounting(): Promise<{
    readonly admission_rate: { consumed: number; limit: number };
    readonly queued_work: { consumed: number; limit: number };
    readonly active_execution: { consumed: number; limit: number };
  }>;
}

type MutablePool = {
  -readonly [K in keyof CapacityPoolRecord]: CapacityPoolRecord[K];
};
type MutableReservation = {
  -readonly [K in keyof CapacityReservationRecord]: CapacityReservationRecord[K];
};

function poolKey(kind: CapacityLedgerKind, scope: CapacityPoolScope): string {
  return `${kind}\0${scope.network_ref}\0${scope.capability}\0${scope.community_ref ?? ""}`;
}

function reservationIdentity(input: {
  order_id: string;
  ledger_kind: CapacityLedgerKind;
  pool_id: string;
  quantity: number;
  work_key_digest?: string;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        order_id: input.order_id,
        ledger_kind: input.ledger_kind,
        pool_id: input.pool_id,
        quantity: input.quantity,
        work_key_digest: input.work_key_digest ?? null,
      }),
    )
    .digest("hex");
}

export interface InMemoryAdmissionCapacityStoreOptions {
  readonly orderStore: OrderStore;
  readonly preparationStore: SharedPreparationStore;
  readonly defaultLimits?: {
    admission_rate?: number;
    queued_work?: number;
    active_execution?: number;
  };
}

export class InMemoryAdmissionCapacityStore implements AdmissionCapacityStore {
  private readonly pools = new Map<string, MutablePool>();
  private readonly poolsByScope = new Map<string, string>();
  private readonly reservations = new Map<string, MutableReservation>();
  private readonly transferLog: CapacityTransferEvent[] = [];
  private readonly idempotency = new Map<string, OrderAdmissionIdempotencyRecord>();
  /** work_key_digest → shared queued envelope owner + quantity. */
  private readonly queuedEnvelopeByWork = new Map<
    string,
    { reservation_id: string; quantity: number }
  >();
  private readonly orderStore: OrderStore;
  private readonly preparationStore: SharedPreparationStore;
  private readonly defaults: Required<
    NonNullable<InMemoryAdmissionCapacityStoreOptions["defaultLimits"]>
  >;
  private txnTail: Promise<void> = Promise.resolve();
  private readonly maxRetries = ADMISSION_SERIALIZATION_RETRIES;

  constructor(opts: InMemoryAdmissionCapacityStoreOptions) {
    this.orderStore = opts.orderStore;
    this.preparationStore = opts.preparationStore;
    this.defaults = {
      admission_rate: opts.defaultLimits?.admission_rate ?? DEFAULT_ADMISSION_RATE_LIMIT,
      queued_work: opts.defaultLimits?.queued_work ?? DEFAULT_QUEUED_WORK_LIMIT,
      active_execution: opts.defaultLimits?.active_execution ?? DEFAULT_ACTIVE_EXECUTION_LIMIT,
    };
  }

  private idemKey(requester: string, clientRequestId: string): string {
    return `${requester}\0${clientRequestId}`;
  }

  private async withSerializableTxn<T>(fn: () => Promise<T>): Promise<T> {
    const prior = this.txnTail;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.txnTail = prior.then(() => gate);
    await prior;
    try {
      let lastErr: unknown;
      for (let attempt = 0; attempt < this.maxRetries; attempt += 1) {
        try {
          return await fn();
        } catch (err) {
          if (err instanceof Error && err.message === "serialization_retry") {
            lastErr = err;
            continue;
          }
          throw err;
        }
      }
      throw lastErr instanceof Error
        ? new CapacityUnavailableError("lock_timeout", lastErr.message)
        : new CapacityUnavailableError("lock_timeout");
    } finally {
      release();
    }
  }

  private ensurePoolLocked(input: EnsurePoolInput & { now_ms: number }): MutablePool {
    const key = poolKey(input.ledger_kind, input);
    const existingId = this.poolsByScope.get(key);
    if (existingId) {
      const existing = this.pools.get(existingId);
      if (existing) return existing;
    }
    const pool_id = `cap_${input.ledger_kind}_${randomUUID()}`;
    const pool: MutablePool = {
      pool_id,
      ledger_kind: input.ledger_kind,
      network_ref: input.network_ref,
      capability: input.capability,
      ...(input.community_ref !== undefined ? { community_ref: input.community_ref } : {}),
      limit_units: input.limit_units,
      consumed_units: 0,
      version: 0,
      updated_at_unix_ms: input.now_ms,
    };
    this.pools.set(pool_id, pool);
    this.poolsByScope.set(key, pool_id);
    return pool;
  }

  private getOrCreateDefaultPools(scope: CapacityPoolScope, now_ms: number): {
    admission: MutablePool;
    queued: MutablePool;
    active: MutablePool;
  } {
    return {
      admission: this.ensurePoolLocked({
        ledger_kind: "admission_rate",
        ...scope,
        limit_units: this.defaults.admission_rate,
        now_ms,
      }),
      queued: this.ensurePoolLocked({
        ledger_kind: "queued_work",
        ...scope,
        limit_units: this.defaults.queued_work,
        now_ms,
      }),
      active: this.ensurePoolLocked({
        ledger_kind: "active_execution",
        ...scope,
        limit_units: this.defaults.active_execution,
        now_ms,
      }),
    };
  }

  private consume(
    pool: MutablePool,
    quantity: number,
    now_ms: number,
  ): void {
    if (pool.consumed_units + quantity > pool.limit_units) {
      const reason =
        pool.ledger_kind === "admission_rate"
          ? "insufficient_admission_rate"
          : pool.ledger_kind === "queued_work"
            ? "insufficient_queued_work"
            : "insufficient_active_execution";
      throw new CapacityUnavailableError(reason);
    }
    pool.consumed_units += quantity;
    pool.version += 1;
    pool.updated_at_unix_ms = now_ms;
  }

  private releaseUnits(pool: MutablePool, quantity: number, now_ms: number): void {
    pool.consumed_units = Math.max(0, pool.consumed_units - quantity);
    pool.version += 1;
    pool.updated_at_unix_ms = now_ms;
  }

  /** Fan-in marker: order capacity consumed; shared queued envelope not duplicated. */
  private markFanInTransfer(input: {
    order_id: string;
    pool: MutablePool;
    work_key_digest: string;
    now_ms: number;
  }): MutableReservation {
    const reservation_id = `rsv_${randomUUID()}`;
    const row: MutableReservation = {
      reservation_id,
      order_id: input.order_id,
      pool_id: input.pool.pool_id,
      ledger_kind: "queued_work",
      quantity: 0,
      reservation_version: 1,
      state: "transferred",
      identity_digest: reservationIdentity({
        order_id: input.order_id,
        ledger_kind: "queued_work",
        pool_id: input.pool.pool_id,
        quantity: 0,
        work_key_digest: input.work_key_digest,
      }),
      work_key_digest: input.work_key_digest,
      created_at_unix_ms: input.now_ms,
    };
    this.reservations.set(reservation_id, row);
    this.transferLog.push({
      event_id: `cte_${randomUUID()}`,
      reservation_id,
      from_state: "held",
      to_state: "transferred",
      reason: "fan_in_share_envelope",
      event_version: 1,
      created_at_unix_ms: input.now_ms,
    });
    return row;
  }

  private holdReservation(input: {
    order_id: string;
    pool: MutablePool;
    quantity: number;
    work_key_digest?: string;
    lease_until_unix_ms?: number;
    now_ms: number;
  }): MutableReservation {
    const reservation_id = `rsv_${randomUUID()}`;
    const identity_digest = reservationIdentity({
      order_id: input.order_id,
      ledger_kind: input.pool.ledger_kind,
      pool_id: input.pool.pool_id,
      quantity: input.quantity,
      work_key_digest: input.work_key_digest,
    });
    const row: MutableReservation = {
      reservation_id,
      order_id: input.order_id,
      pool_id: input.pool.pool_id,
      ledger_kind: input.pool.ledger_kind,
      quantity: input.quantity,
      reservation_version: 1,
      state: "held",
      identity_digest,
      ...(input.work_key_digest !== undefined
        ? { work_key_digest: input.work_key_digest }
        : {}),
      ...(input.lease_until_unix_ms !== undefined
        ? { lease_until_unix_ms: input.lease_until_unix_ms }
        : {}),
      created_at_unix_ms: input.now_ms,
    };
    this.reservations.set(reservation_id, row);
    this.transferLog.push({
      event_id: `cte_${randomUUID()}`,
      reservation_id,
      from_state: "held",
      to_state: "held",
      reason: "created",
      event_version: 1,
      created_at_unix_ms: input.now_ms,
    });
    return row;
  }

  private transitionReservation(
    row: MutableReservation,
    to: CapacityReservationRecord["state"],
    reason: string,
    now_ms: number,
  ): void {
    const from = row.state;
    row.state = to;
    row.reservation_version += 1;
    if (to === "released" || to === "expired") {
      row.released_at_unix_ms = now_ms;
    }
    this.transferLog.push({
      event_id: `cte_${randomUUID()}`,
      reservation_id: row.reservation_id,
      from_state: from,
      to_state: to,
      reason,
      event_version: row.reservation_version,
      created_at_unix_ms: now_ms,
    });
  }

  async ensurePool(input: EnsurePoolInput & { now_ms: number }): Promise<CapacityPoolRecord> {
    return this.withSerializableTxn(async () => {
      return structuredClone(this.ensurePoolLocked(input));
    });
  }

  async getPool(poolId: string): Promise<CapacityPoolRecord | undefined> {
    const pool = this.pools.get(poolId);
    return pool ? structuredClone(pool) : undefined;
  }

  async listPools(): Promise<readonly CapacityPoolRecord[]> {
    return [...this.pools.values()].map((p) => structuredClone(p));
  }

  async getReservation(
    reservationId: string,
  ): Promise<CapacityReservationRecord | undefined> {
    const row = this.reservations.get(reservationId);
    return row ? structuredClone(row) : undefined;
  }

  async listHeldReservations(
    orderId: string,
  ): Promise<readonly CapacityReservationRecord[]> {
    return [...this.reservations.values()]
      .filter((r) => r.order_id === orderId && r.state === "held")
      .map((r) => structuredClone(r));
  }

  async listTransferLog(reservationId: string): Promise<readonly CapacityTransferEvent[]> {
    return this.transferLog
      .filter((e) => e.reservation_id === reservationId)
      .map((e) => structuredClone(e));
  }

  async getIdempotency(
    requester: string,
    clientRequestId: string,
  ): Promise<OrderAdmissionIdempotencyRecord | undefined> {
    const row = this.idempotency.get(this.idemKey(requester, clientRequestId));
    return row ? structuredClone(row) : undefined;
  }

  async admitOrder(input: AdmitOrderInput): Promise<AdmitOrderResult> {
    // Advisory shed before opening the transaction — never decides capacity alone.
    if (input.advisory_shed) {
      return { kind: "capacity_unavailable", reason: "advisory_shed" };
    }
    if (
      input.simulated_lock_wait_ms !== undefined &&
      input.simulated_lock_wait_ms > ADVISORY_LOCK_WAIT_BUDGET_MS
    ) {
      return { kind: "capacity_unavailable", reason: "lock_timeout" };
    }

    try {
      return await this.withSerializableTxn(async () => {
        try {
          assertCertificateAdmissible(input.certificate);
        } catch (err) {
          if (err instanceof CapacityUnavailableError) {
            return { kind: "capacity_unavailable", reason: err.reason };
          }
          throw err;
        }

        const body_digest = digestOf(input.body);
        const idemKey = this.idemKey(input.requester_subject, input.client_request_id);
        const prior = this.idempotency.get(idemKey);
        if (prior) {
          if (prior.body_digest !== body_digest) {
            return { kind: "idempotency_conflict" };
          }
          const order = await this.orderStore.get(prior.order_id);
          if (!order) {
            throw new Error("serialization_retry");
          }
          const join = await this.preparationStore.joinPublicWork({
            order_id: prior.order_id,
            order_tenant_scope_digest: input.order_tenant_scope_digest,
            work_key: input.work_key,
            now_ms: input.now_ms,
          });
          if (join.kind !== "joined") {
            throw new Error("serialization_retry");
          }
          return {
            kind: "admitted",
            order,
            created: false,
            work_created: false,
            work_id: join.work.work_id,
            reservation_ids: prior.reservation_ids,
            replay: true,
          };
        }

        const pools = this.getOrCreateDefaultPools(input.pool_scope, input.now_ms);
        const workKeyDigest = digestPublicWorkKey(input.work_key);
        const order_id = input.order.order_id ?? `ord_${randomUUID()}`;

        // Snapshot for rollback — rejected requests create neither reservation nor order.
        const snap = {
          admission: pools.admission.consumed_units,
          admissionVer: pools.admission.version,
          queued: pools.queued.consumed_units,
          queuedVer: pools.queued.version,
          envelope: this.queuedEnvelopeByWork.get(workKeyDigest),
        };
        const createdReservationIds: string[] = [];

        try {
          this.consume(pools.admission, 1, input.now_ms);

          // Fan-in: reuse existing queued envelope for this work key; never duplicate.
          let queuedReservation: MutableReservation | undefined;
          let createdQueuedEnvelope = false;
          const existingMeta = this.queuedEnvelopeByWork.get(workKeyDigest);
          const existingEnvelope = existingMeta
            ? this.reservations.get(existingMeta.reservation_id)
            : undefined;
          if (existingEnvelope && existingEnvelope.state === "held") {
            queuedReservation = this.markFanInTransfer({
              order_id,
              pool: pools.queued,
              work_key_digest: workKeyDigest,
              now_ms: input.now_ms,
            });
            createdReservationIds.push(queuedReservation.reservation_id);
          } else {
            this.consume(pools.queued, input.certificate.capacity_weight, input.now_ms);
            queuedReservation = this.holdReservation({
              order_id,
              pool: pools.queued,
              quantity: input.certificate.capacity_weight,
              work_key_digest: workKeyDigest,
              now_ms: input.now_ms,
            });
            this.queuedEnvelopeByWork.set(workKeyDigest, {
              reservation_id: queuedReservation.reservation_id,
              quantity: input.certificate.capacity_weight,
            });
            createdQueuedEnvelope = true;
            createdReservationIds.push(queuedReservation.reservation_id);
          }

          const admissionReservation = this.holdReservation({
            order_id,
            pool: pools.admission,
            quantity: 1,
            now_ms: input.now_ms,
          });
          createdReservationIds.push(admissionReservation.reservation_id);

          const placedEvent: OrderPlaced = {
            order_id,
            product: input.order.product,
            inputs_digest: input.order.inputs_digest,
          };
          const placed = await this.orderStore.placeOrder(
            {
              ...input.order,
              order_id,
            },
            {
              subject: ORDER_LIFECYCLE_SUBJECTS.placed,
              payload: placedEvent,
            } satisfies OutboxEvent,
          );

          const join: JoinPublicWorkResult = await this.preparationStore.joinPublicWork({
            order_id,
            order_tenant_scope_digest: input.order_tenant_scope_digest,
            work_key: input.work_key,
            now_ms: input.now_ms,
          });
          if (join.kind !== "joined") {
            throw new Error("serialization_retry");
          }

          // Join reused existing work after we allocated a new envelope → fold into fan-in.
          if (!join.created && createdQueuedEnvelope && queuedReservation) {
            this.releaseUnits(pools.queued, queuedReservation.quantity, input.now_ms);
            const meta = this.queuedEnvelopeByWork.get(workKeyDigest);
            if (meta?.reservation_id === queuedReservation.reservation_id) {
              this.queuedEnvelopeByWork.delete(workKeyDigest);
            }
            const existing = [...this.reservations.values()].find(
              (r) =>
                r.ledger_kind === "queued_work" &&
                r.state === "held" &&
                r.quantity > 0 &&
                r.work_key_digest === workKeyDigest &&
                r.reservation_id !== queuedReservation!.reservation_id,
            );
            if (existing) {
              this.queuedEnvelopeByWork.set(workKeyDigest, {
                reservation_id: existing.reservation_id,
                quantity: existing.quantity,
              });
            }
            this.transitionReservation(
              queuedReservation,
              "transferred",
              "fan_in_after_join",
              input.now_ms,
            );
            queuedReservation.quantity = 0;
          }

          const reservation_ids = [
            admissionReservation.reservation_id,
            queuedReservation.reservation_id,
          ];

          this.idempotency.set(idemKey, {
            requester_subject: input.requester_subject,
            client_request_id: input.client_request_id,
            body_digest,
            order_id,
            reservation_ids,
            stored_at_unix_ms: input.now_ms,
          });

          return {
            kind: "admitted",
            order: placed.record,
            created: placed.created,
            work_created: join.created,
            work_id: join.work.work_id,
            reservation_ids,
            replay: false,
          };
        } catch (err) {
          // Roll back — no reservation/order survives a rejected or aborted txn.
          pools.admission.consumed_units = snap.admission;
          pools.admission.version = snap.admissionVer;
          pools.queued.consumed_units = snap.queued;
          pools.queued.version = snap.queuedVer;
          if (snap.envelope === undefined) {
            this.queuedEnvelopeByWork.delete(workKeyDigest);
          } else {
            this.queuedEnvelopeByWork.set(workKeyDigest, snap.envelope);
          }
          for (const id of createdReservationIds) {
            this.reservations.delete(id);
          }
          if (err instanceof CapacityUnavailableError) {
            return { kind: "capacity_unavailable", reason: err.reason };
          }
          throw err;
        }
      });
    } catch (err) {
      if (err instanceof CapacityUnavailableError) {
        return { kind: "capacity_unavailable", reason: err.reason };
      }
      if (err instanceof AdmissionIdempotencyConflictError) {
        return { kind: "idempotency_conflict" };
      }
      throw err;
    }
  }

  async acquireActiveExecutionLease(input: {
    order_id: string;
    pool_scope: CapacityPoolScope;
    quantity?: number;
    lease_duration_ms?: number;
    now_ms: number;
  }): Promise<
    | { readonly kind: "acquired"; readonly reservation: CapacityReservationRecord }
    | { readonly kind: "capacity_unavailable"; readonly reason: string }
    | { readonly kind: "order_not_found" }
  > {
    return this.withSerializableTxn(async () => {
      const order = await this.orderStore.get(input.order_id);
      if (!order) return { kind: "order_not_found" };
      const pools = this.getOrCreateDefaultPools(input.pool_scope, input.now_ms);
      const quantity = input.quantity ?? 1;
      try {
        this.consume(pools.active, quantity, input.now_ms);
      } catch (err) {
        if (err instanceof CapacityUnavailableError) {
          return { kind: "capacity_unavailable", reason: err.reason };
        }
        throw err;
      }
      const lease_until =
        input.now_ms + (input.lease_duration_ms ?? ACTIVE_EXECUTION_LEASE_MS);
      const reservation = this.holdReservation({
        order_id: input.order_id,
        pool: pools.active,
        quantity,
        lease_until_unix_ms: lease_until,
        now_ms: input.now_ms,
      });
      return { kind: "acquired", reservation: structuredClone(reservation) };
    });
  }

  async releaseReservation(input: {
    reservation_id: string;
    expected_version: number;
    reason: string;
    now_ms: number;
  }): Promise<
    | { readonly kind: "released"; readonly reservation: CapacityReservationRecord }
    | { readonly kind: "already_released"; readonly reservation: CapacityReservationRecord }
    | { readonly kind: "version_mismatch" }
    | { readonly kind: "not_found" }
  > {
    return this.withSerializableTxn(async () => {
      const row = this.reservations.get(input.reservation_id);
      if (!row) return { kind: "not_found" };
      if (row.state !== "held") {
        return { kind: "already_released", reservation: structuredClone(row) };
      }
      if (row.reservation_version !== input.expected_version) {
        return { kind: "version_mismatch" };
      }
      const pool = this.pools.get(row.pool_id);
      if (pool && row.quantity > 0) {
        this.releaseUnits(pool, row.quantity, input.now_ms);
      }
      if (row.ledger_kind === "queued_work" && row.work_key_digest) {
        const meta = this.queuedEnvelopeByWork.get(row.work_key_digest);
        if (meta?.reservation_id === row.reservation_id) {
          this.queuedEnvelopeByWork.delete(row.work_key_digest);
        }
      }
      this.transitionReservation(row, "released", input.reason, input.now_ms);
      return { kind: "released", reservation: structuredClone(row) };
    });
  }

  async releaseOrderCapacity(input: {
    order_id: string;
    reason: "fulfilled" | "terminal_failure" | "cancelled" | "abandoned";
    now_ms: number;
  }): Promise<{ readonly released: number }> {
    return this.withSerializableTxn(async () => {
      let released = 0;
      const rows = [...this.reservations.values()].filter(
        (r) =>
          r.order_id === input.order_id &&
          (r.state === "held" || r.state === "transferred"),
      );
      for (const row of rows) {
        const pool = this.pools.get(row.pool_id);

        if (row.ledger_kind === "queued_work" && row.work_key_digest) {
          const otherSubscribers = [...this.reservations.values()].filter(
            (r) =>
              r.reservation_id !== row.reservation_id &&
              r.work_key_digest === row.work_key_digest &&
              r.ledger_kind === "queued_work" &&
              r.order_id !== input.order_id &&
              (r.state === "held" || r.state === "transferred"),
          );
          const meta = this.queuedEnvelopeByWork.get(row.work_key_digest);
          if (otherSubscribers.length > 0) {
            // Shared envelope remains; do not free units. Reassign owner bookkeeping.
            if (meta && meta.reservation_id === row.reservation_id) {
              this.queuedEnvelopeByWork.set(row.work_key_digest, {
                reservation_id: otherSubscribers[0]!.reservation_id,
                quantity: meta.quantity,
              });
            }
          } else {
            // Last subscriber: free the shared envelope quantity exactly once.
            const qty = meta?.quantity ?? row.quantity;
            if (pool && qty > 0) {
              this.releaseUnits(pool, qty, input.now_ms);
            }
            this.queuedEnvelopeByWork.delete(row.work_key_digest);
          }
          this.transitionReservation(row, "released", input.reason, input.now_ms);
          released += 1;
          continue;
        }

        if (pool && row.quantity > 0 && row.state === "held") {
          this.releaseUnits(pool, row.quantity, input.now_ms);
        }
        this.transitionReservation(row, "released", input.reason, input.now_ms);
        released += 1;
      }
      return { released };
    });
  }

  async reconcileExpiredActiveLeases(input: {
    now_ms: number;
  }): Promise<{ readonly expired: number }> {
    return this.withSerializableTxn(async () => {
      let expired = 0;
      for (const row of this.reservations.values()) {
        if (
          row.state !== "held" ||
          row.ledger_kind !== "active_execution" ||
          row.lease_until_unix_ms === undefined ||
          row.lease_until_unix_ms > input.now_ms
        ) {
          continue;
        }
        const pool = this.pools.get(row.pool_id);
        if (pool && row.quantity > 0) {
          this.releaseUnits(pool, row.quantity, input.now_ms);
        }
        this.transitionReservation(row, "expired", "lease_expiry_reconcile", input.now_ms);
        expired += 1;
      }
      return { expired };
    });
  }

  async snapshotAccounting(): Promise<{
    readonly admission_rate: { consumed: number; limit: number };
    readonly queued_work: { consumed: number; limit: number };
    readonly active_execution: { consumed: number; limit: number };
  }> {
    const sum = (kind: CapacityLedgerKind) => {
      let consumed = 0;
      let limit = 0;
      for (const p of this.pools.values()) {
        if (p.ledger_kind !== kind) continue;
        consumed += p.consumed_units;
        limit += p.limit_units;
      }
      return { consumed, limit };
    };
    return {
      admission_rate: sum("admission_rate"),
      queued_work: sum("queued_work"),
      active_execution: sum("active_execution"),
    };
  }
}

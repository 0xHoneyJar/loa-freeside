/**
 * CR-201C Postgres adapter — SERIALIZABLE admission transaction.
 * Capacity counters, idempotency, order, root work/links, and reservations
 * commit together. Advisory shed is caller-side before opening the txn.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import pg from "pg";
import { ORDER_LIFECYCLE_SUBJECTS, type OrderPlaced } from "@freeside/ordering-protocol";
import {
  ACTIVE_EXECUTION_LEASE_MS,
  DEFAULT_ACTIVE_EXECUTION_LIMIT,
  DEFAULT_ADMISSION_RATE_LIMIT,
  DEFAULT_QUEUED_WORK_LIMIT,
} from "./admission-capacity-constants.js";
import type {
  AdmissionCapacityStore,
  AdmitOrderInput,
  AdmitOrderResult,
  EnsurePoolInput,
} from "./admission-capacity-store.js";
import type {
  CapacityLedgerKind,
  CapacityPoolRecord,
  CapacityPoolScope,
  CapacityReservationRecord,
  CapacityTransferEvent,
  OrderAdmissionIdempotencyRecord,
} from "./admission-capacity-types.js";
import { CapacityUnavailableError } from "./admission-capacity-types.js";
import {
  isPoolScopeUniqueViolation,
  isPgSerializationFailure,
  safeRollback,
  shouldRetryAdmissionTxn,
} from "./admission-capacity-pg-errors.js";
import { assertCertificateAdmissible } from "./recipe-expansion-certificate.js";
import { digestOf } from "./digest.js";
import { PostgresSharedPreparationStore } from "./shared-preparation-store-postgres.js";
import type { JoinPublicWorkResult } from "./shared-preparation-store.js";
import { digestPublicWorkKey } from "./shared-preparation-work-key.js";
import type { OrderRecord } from "./store.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const ADMISSION_TXN_RETRIES = 8;

function rowToPool(row: pg.QueryResultRow): CapacityPoolRecord {
  return {
    pool_id: row.pool_id,
    ledger_kind: row.ledger_kind,
    network_ref: row.network_ref,
    capability: row.capability,
    ...(row.community_ref != null ? { community_ref: row.community_ref } : {}),
    limit_units: Number(row.limit_units),
    consumed_units: Number(row.consumed_units),
    version: Number(row.version),
    updated_at_unix_ms: new Date(row.updated_at).getTime(),
  };
}

function rowToReservation(row: pg.QueryResultRow): CapacityReservationRecord {
  return {
    reservation_id: row.reservation_id,
    order_id: row.order_id,
    pool_id: row.pool_id,
    ledger_kind: row.ledger_kind,
    quantity: Number(row.quantity),
    reservation_version: Number(row.reservation_version),
    state: row.state,
    identity_digest: row.identity_digest,
    ...(row.work_key_digest != null ? { work_key_digest: row.work_key_digest } : {}),
    ...(row.lease_until != null
      ? { lease_until_unix_ms: new Date(row.lease_until).getTime() }
      : {}),
    created_at_unix_ms: new Date(row.created_at).getTime(),
    ...(row.released_at != null
      ? { released_at_unix_ms: new Date(row.released_at).getTime() }
      : {}),
  };
}

function rowToOrder(row: pg.QueryResultRow): OrderRecord {
  return {
    order_id: row.order_id,
    product: row.product,
    placed_by: row.placed_by,
    inputs: row.inputs,
    placed_at_unix: Number(row.placed_at_unix),
    state: row.state,
    inputs_digest: row.inputs_digest,
    ingredients: row.ingredients ?? undefined,
    ingredient_jobs: row.ingredient_jobs ?? [],
    operator_audit: row.operator_audit ?? [],
    created_at_unix: Number(row.created_at_unix),
    updated_at_unix: Number(row.updated_at_unix),
  };
}

export interface PostgresAdmissionCapacityStoreOptions {
  readonly pool: pg.Pool;
  readonly preparationStore: PostgresSharedPreparationStore;
  readonly defaultLimits?: {
    admission_rate?: number;
    queued_work?: number;
    active_execution?: number;
  };
}

export class PostgresAdmissionCapacityStore implements AdmissionCapacityStore {
  private readonly pool: pg.Pool;
  private readonly preparationStore: PostgresSharedPreparationStore;
  private readonly defaults: Required<
    NonNullable<PostgresAdmissionCapacityStoreOptions["defaultLimits"]>
  >;

  constructor(opts: PostgresAdmissionCapacityStoreOptions) {
    this.pool = opts.pool;
    this.preparationStore = opts.preparationStore;
    this.defaults = {
      admission_rate: opts.defaultLimits?.admission_rate ?? DEFAULT_ADMISSION_RATE_LIMIT,
      queued_work: opts.defaultLimits?.queued_work ?? DEFAULT_QUEUED_WORK_LIMIT,
      active_execution: opts.defaultLimits?.active_execution ?? DEFAULT_ACTIVE_EXECUTION_LIMIT,
    };
  }

  static async connect(
    connectionString: string,
    opts: {
      migrate?: boolean;
      preparationStore?: PostgresSharedPreparationStore;
    } = {},
  ): Promise<PostgresAdmissionCapacityStore> {
    const pool = new pg.Pool({ connectionString, max: 10 });
    const preparationStore =
      opts.preparationStore ??
      (await PostgresSharedPreparationStore.connect(connectionString, {
        pool,
        migrate: opts.migrate ?? process.env.RUN_MIGRATIONS === "true",
      }));
    const store = new PostgresAdmissionCapacityStore({ pool, preparationStore });
    if (opts.migrate ?? process.env.RUN_MIGRATIONS === "true") {
      await store.runMigrations();
    }
    return store;
  }

  async runMigrations(): Promise<void> {
    for (const file of [
      "001_orders.sql",
      "007_shared_preparation_work.sql",
      "008_admission_capacity.sql",
      "009_public_prep_dispatch_and_kitchen_target.sql",
    ]) {
      const sql = readFileSync(join(__dirname, "../migrations", file), "utf8");
      await this.pool.query(sql);
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  private async lockOrCreatePool(
    client: pg.PoolClient,
    input: EnsurePoolInput & { now_ms: number },
  ): Promise<CapacityPoolRecord> {
    // Sentinel '' for public/default scope — UNIQUE forbids duplicate NULL rows.
    const communityRef = input.community_ref ?? "";
    const selectForUpdate = () =>
      client.query(
        `SELECT * FROM admission_capacity_pools
         WHERE ledger_kind = $1 AND network_ref = $2 AND capability = $3
           AND community_ref = $4
         FOR UPDATE`,
        [input.ledger_kind, input.network_ref, input.capability, communityRef],
      );

    const existing = await selectForUpdate();
    if (existing.rows.length > 0) return rowToPool(existing.rows[0]);
    const pool_id = `cap_${input.ledger_kind}_${randomUUID()}`;
    try {
      const inserted = await client.query(
        `INSERT INTO admission_capacity_pools (
          pool_id, ledger_kind, network_ref, capability, community_ref,
          limit_units, consumed_units, version, updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,0,0,to_timestamp($7/1000.0))
        RETURNING *`,
        [
          pool_id,
          input.ledger_kind,
          input.network_ref,
          input.capability,
          communityRef,
          input.limit_units,
          input.now_ms,
        ],
      );
      return rowToPool(inserted.rows[0]);
    } catch (err) {
      // Concurrent creator won — re-select the existing pool row.
      if (isPoolScopeUniqueViolation(err)) {
        const raced = await selectForUpdate();
        if (raced.rows.length > 0) return rowToPool(raced.rows[0]);
      }
      throw err;
    }
  }

  /** Bounded SERIALIZABLE retry for mutating capacity methods. */
  private async withSerializableRetry<T>(fn: () => Promise<T>): Promise<T> {
    let lastErr: unknown;
    for (let attempt = 0; attempt < ADMISSION_TXN_RETRIES; attempt += 1) {
      try {
        return await fn();
      } catch (err) {
        lastErr = err;
        if (
          isPgSerializationFailure(err) ||
          (err instanceof Error && err.message === "serialization_retry") ||
          isPoolScopeUniqueViolation(err)
        ) {
          continue;
        }
        throw err;
      }
    }
    throw lastErr instanceof Error
      ? lastErr
      : new Error("serialization_retry");
  }

  private async consumePool(
    client: pg.PoolClient,
    pool: CapacityPoolRecord,
    quantity: number,
    now_ms: number,
  ): Promise<CapacityPoolRecord> {
    if (pool.consumed_units + quantity > pool.limit_units) {
      const reason =
        pool.ledger_kind === "admission_rate"
          ? "insufficient_admission_rate"
          : pool.ledger_kind === "queued_work"
            ? "insufficient_queued_work"
            : "insufficient_active_execution";
      throw new CapacityUnavailableError(reason);
    }
    const updated = await client.query(
      `UPDATE admission_capacity_pools
       SET consumed_units = consumed_units + $2,
           version = version + 1,
           updated_at = to_timestamp($3/1000.0)
       WHERE pool_id = $1 AND version = $4
       RETURNING *`,
      [pool.pool_id, quantity, now_ms, pool.version],
    );
    if (updated.rows.length === 0) {
      throw new Error("serialization_retry");
    }
    return rowToPool(updated.rows[0]);
  }

  async ensurePool(input: EnsurePoolInput & { now_ms: number }): Promise<CapacityPoolRecord> {
    const client = await this.pool.connect();
    let txnClosed = false;
    try {
      await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
      const pool = await this.lockOrCreatePool(client, input);
      await client.query("COMMIT");
      txnClosed = true;
      return pool;
    } catch (err) {
      if (!txnClosed) {
        await safeRollback(client);
        txnClosed = true;
      }
      throw err;
    } finally {
      if (!txnClosed) {
        await safeRollback(client);
      }
      client.release();
    }
  }

  async getPool(poolId: string): Promise<CapacityPoolRecord | undefined> {
    const res = await this.pool.query(
      "SELECT * FROM admission_capacity_pools WHERE pool_id = $1",
      [poolId],
    );
    return res.rows[0] ? rowToPool(res.rows[0]) : undefined;
  }

  async listPools(): Promise<readonly CapacityPoolRecord[]> {
    const res = await this.pool.query("SELECT * FROM admission_capacity_pools");
    return res.rows.map(rowToPool);
  }

  async getReservation(
    reservationId: string,
  ): Promise<CapacityReservationRecord | undefined> {
    const res = await this.pool.query(
      "SELECT * FROM admission_capacity_reservations WHERE reservation_id = $1",
      [reservationId],
    );
    return res.rows[0] ? rowToReservation(res.rows[0]) : undefined;
  }

  async listHeldReservations(
    orderId: string,
  ): Promise<readonly CapacityReservationRecord[]> {
    const res = await this.pool.query(
      `SELECT * FROM admission_capacity_reservations
       WHERE order_id = $1 AND state = 'held'`,
      [orderId],
    );
    return res.rows.map(rowToReservation);
  }

  async listTransferLog(reservationId: string): Promise<readonly CapacityTransferEvent[]> {
    const res = await this.pool.query(
      `SELECT * FROM admission_capacity_transfer_log
       WHERE reservation_id = $1 ORDER BY event_version`,
      [reservationId],
    );
    return res.rows.map((row) => ({
      event_id: row.event_id,
      reservation_id: row.reservation_id,
      from_state: row.from_state,
      to_state: row.to_state,
      reason: row.reason,
      event_version: Number(row.event_version),
      created_at_unix_ms: new Date(row.created_at).getTime(),
    }));
  }

  async getIdempotency(
    requester: string,
    clientRequestId: string,
  ): Promise<OrderAdmissionIdempotencyRecord | undefined> {
    const res = await this.pool.query(
      `SELECT * FROM order_admission_idempotency
       WHERE requester_subject = $1 AND client_request_id = $2`,
      [requester, clientRequestId],
    );
    if (!res.rows[0]) return undefined;
    const row = res.rows[0];
    return {
      requester_subject: row.requester_subject,
      client_request_id: row.client_request_id,
      body_digest: row.body_digest,
      order_id: row.order_id,
      reservation_ids: row.reservation_ids,
      stored_at_unix_ms: new Date(row.stored_at).getTime(),
    };
  }

  async admitOrder(input: AdmitOrderInput): Promise<AdmitOrderResult> {
    if (input.advisory_shed) {
      return { kind: "capacity_unavailable", reason: "advisory_shed" };
    }
    let lastErr: unknown;
    for (let attempt = 0; attempt < ADMISSION_TXN_RETRIES; attempt += 1) {
      try {
        return await this.admitOrderAttempt(input);
      } catch (err) {
        lastErr = err;
        if (shouldRetryAdmissionTxn(err)) {
          continue;
        }
        throw err;
      }
    }
    void lastErr;
    return { kind: "capacity_unavailable", reason: "lock_timeout" };
  }

  /** Join primary + every additional certified root work key inside the open txn. */
  private async joinAllRootWorkKeysInTxn(
    client: pg.PoolClient,
    input: AdmitOrderInput,
    orderId: string,
  ): Promise<JoinPublicWorkResult> {
    const primary = await this.preparationStore.joinPublicWorkInTransaction(client, {
      order_id: orderId,
      order_tenant_scope_digest: input.order_tenant_scope_digest,
      work_key: input.work_key,
      kitchen_targets_by_deployment_digest: input.kitchen_targets_by_deployment_digest,
      now_ms: input.now_ms,
    });
    if (primary.kind !== "joined") return primary;

    for (const extra of input.additional_root_work_keys ?? []) {
      const join = await this.preparationStore.joinPublicWorkInTransaction(client, {
        order_id: orderId,
        order_tenant_scope_digest: input.order_tenant_scope_digest,
        work_key: extra,
        kitchen_targets_by_deployment_digest: input.kitchen_targets_by_deployment_digest,
        now_ms: input.now_ms,
      });
      if (join.kind !== "joined") return join;
    }
    return primary;
  }

  private async admitOrderAttempt(input: AdmitOrderInput): Promise<AdmitOrderResult> {
    const client = await this.pool.connect();
    /** Tracks whether COMMIT/ROLLBACK already ran — finally always cleans open txns. */
    let txnClosed = false;
    const commit = async () => {
      await client.query("COMMIT");
      txnClosed = true;
    };
    const rollback = async () => {
      await safeRollback(client);
      txnClosed = true;
    };

    try {
      await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");

      try {
        assertCertificateAdmissible(input.certificate);
      } catch (err) {
        await rollback();
        if (err instanceof CapacityUnavailableError) {
          return { kind: "capacity_unavailable", reason: err.reason };
        }
        throw err;
      }

      const body_digest = digestOf(input.body);
      const prior = await client.query(
        `SELECT * FROM order_admission_idempotency
         WHERE requester_subject = $1 AND client_request_id = $2
         FOR UPDATE`,
        [input.requester_subject, input.client_request_id],
      );
      if (prior.rows.length > 0) {
        const row = prior.rows[0];
        if (row.body_digest !== body_digest) {
          await rollback();
          return { kind: "idempotency_conflict" };
        }
        const orderRes = await client.query("SELECT * FROM orders WHERE order_id = $1", [
          row.order_id,
        ]);
        const join = await this.joinAllRootWorkKeysInTxn(client, input, row.order_id);
        if (join.kind !== "joined") {
          // Route through outer admission retry loop (do not bypass as typed deny).
          await rollback();
          throw new Error("serialization_retry");
        }
        await commit();
        return {
          kind: "admitted",
          order: rowToOrder(orderRes.rows[0]),
          created: false,
          work_created: false,
          work_id: join.work.work_id,
          reservation_ids: row.reservation_ids,
          replay: true,
        };
      }

      const scope = input.pool_scope;
      const admission = await this.lockOrCreatePool(client, {
        ledger_kind: "admission_rate",
        ...scope,
        limit_units: this.defaults.admission_rate,
        now_ms: input.now_ms,
      });
      const queued = await this.lockOrCreatePool(client, {
        ledger_kind: "queued_work",
        ...scope,
        limit_units: this.defaults.queued_work,
        now_ms: input.now_ms,
      });

      const workKeyDigest = digestPublicWorkKey(input.work_key);
      const order_id = input.order.order_id ?? `ord_${randomUUID()}`;

      await this.consumePool(client, admission, 1, input.now_ms);

      const heldEnvelope = await client.query(
        `SELECT * FROM admission_capacity_reservations
         WHERE work_key_digest = $1 AND ledger_kind = 'queued_work' AND state = 'held'
         FOR UPDATE`,
        [workKeyDigest],
      );

      const reservationIds: string[] = [];
      let queuedQty = 0;
      let queuedState: "held" | "transferred" = "held";
      if (heldEnvelope.rows.length > 0) {
        queuedState = "transferred";
        queuedQty = 0;
      } else {
        await this.consumePool(client, queued, input.certificate.capacity_weight, input.now_ms);
        queuedQty = input.certificate.capacity_weight;
      }

      const admissionRsv = `rsv_${randomUUID()}`;
      const queuedRsv = `rsv_${randomUUID()}`;
      reservationIds.push(admissionRsv, queuedRsv);

      const identity = (ledger: CapacityLedgerKind, poolId: string, qty: number) =>
        createHash("sha256")
          .update(
            JSON.stringify({
              order_id,
              ledger_kind: ledger,
              pool_id: poolId,
              quantity: qty,
              work_key_digest: workKeyDigest,
            }),
          )
          .digest("hex");

      const ts = Math.floor(input.now_ms / 1000);
      const placedEvent: OrderPlaced = {
        order_id,
        product: input.order.product,
        inputs_digest: input.order.inputs_digest,
      };
      const orderInsert = await client.query(
        `INSERT INTO orders (
          order_id, product, placed_by, inputs, inputs_digest, state,
          placed_at_unix, created_at_unix, updated_at_unix, ingredients,
          ingredient_jobs, operator_audit
        ) VALUES ($1,$2,$3,$4,$5,'placed',$6,$7,$7,$8,'[]'::jsonb,'[]'::jsonb)
        RETURNING *`,
        [
          order_id,
          input.order.product,
          input.order.placed_by,
          JSON.stringify(input.order.inputs),
          input.order.inputs_digest,
          input.order.placed_at_unix,
          ts,
          null,
        ],
      );
      await client.query(
        `INSERT INTO order_outbox (order_id, subject, payload, published)
         VALUES ($1,$2,$3,FALSE)`,
        [order_id, ORDER_LIFECYCLE_SUBJECTS.placed, JSON.stringify(placedEvent)],
      );

      await client.query(
        `INSERT INTO admission_capacity_reservations (
          reservation_id, order_id, pool_id, ledger_kind, quantity,
          reservation_version, state, identity_digest, work_key_digest, created_at
        ) VALUES
          ($1,$2,$3,'admission_rate',1,1,'held',$4,NULL,to_timestamp($7/1000.0)),
          ($5,$2,$6,'queued_work',$8,1,$9,$10,$11,to_timestamp($7/1000.0))`,
        [
          admissionRsv,
          order_id,
          admission.pool_id,
          identity("admission_rate", admission.pool_id, 1),
          queuedRsv,
          queued.pool_id,
          input.now_ms,
          queuedQty,
          queuedState,
          identity("queued_work", queued.pool_id, queuedQty),
          workKeyDigest,
        ],
      );
      await client.query(
        `INSERT INTO admission_capacity_transfer_log (
          event_id, reservation_id, from_state, to_state, reason, event_version, created_at
        ) VALUES
          ($1,$2,'held','held','created',1,to_timestamp($4/1000.0)),
          ($3,$5,'held',$6,$7,1,to_timestamp($4/1000.0))`,
        [
          `cte_${randomUUID()}`,
          admissionRsv,
          `cte_${randomUUID()}`,
          input.now_ms,
          queuedRsv,
          queuedState,
          queuedState === "transferred" ? "fan_in_share_envelope" : "created",
        ],
      );

      const join = await this.joinAllRootWorkKeysInTxn(client, input, order_id);
      if (join.kind !== "joined") {
        throw new Error("serialization_retry");
      }

      // Fold only when another held envelope already exists for this work key.
      if (!join.created && queuedState === "held" && queuedQty > 0) {
        const otherHeld = await client.query(
          `SELECT reservation_id FROM admission_capacity_reservations
           WHERE work_key_digest = $1
             AND ledger_kind = 'queued_work'
             AND state = 'held'
             AND reservation_id <> $2
           FOR UPDATE`,
          [workKeyDigest, queuedRsv],
        );
        if (otherHeld.rows.length > 0) {
          await client.query(
            `UPDATE admission_capacity_pools
             SET consumed_units = consumed_units - $2, version = version + 1
             WHERE pool_id = $1`,
            [queued.pool_id, queuedQty],
          );
          await client.query(
            `UPDATE admission_capacity_reservations
             SET state = 'transferred', quantity = 0, reservation_version = reservation_version + 1
             WHERE reservation_id = $1`,
            [queuedRsv],
          );
        }
      }

      await client.query(
        `INSERT INTO order_admission_idempotency (
          requester_subject, client_request_id, body_digest, order_id, reservation_ids, stored_at
        ) VALUES ($1,$2,$3,$4,$5::jsonb,to_timestamp($6/1000.0))`,
        [
          input.requester_subject,
          input.client_request_id,
          body_digest,
          order_id,
          JSON.stringify(reservationIds),
          input.now_ms,
        ],
      );

      await commit();
      return {
        kind: "admitted",
        order: rowToOrder(orderInsert.rows[0]),
        created: true,
        work_created: join.created,
        work_id: join.work.work_id,
        reservation_ids: reservationIds,
        replay: false,
      };
    } catch (err) {
      if (!txnClosed) {
        await rollback();
      }
      if (err instanceof CapacityUnavailableError) {
        return { kind: "capacity_unavailable", reason: err.reason };
      }
      if (shouldRetryAdmissionTxn(err)) {
        throw new Error("serialization_retry");
      }
      throw err;
    } finally {
      if (!txnClosed) {
        await safeRollback(client);
      }
      client.release();
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
    return this.withSerializableRetry(async () => {
      const client = await this.pool.connect();
      let txnClosed = false;
      try {
        await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
        const order = await client.query("SELECT order_id FROM orders WHERE order_id = $1", [
          input.order_id,
        ]);
        if (order.rows.length === 0) {
          await safeRollback(client);
          txnClosed = true;
          return { kind: "order_not_found" as const };
        }
        const active = await this.lockOrCreatePool(client, {
          ledger_kind: "active_execution",
          ...input.pool_scope,
          limit_units: this.defaults.active_execution,
          now_ms: input.now_ms,
        });
        const quantity = input.quantity ?? 1;
        try {
          await this.consumePool(client, active, quantity, input.now_ms);
        } catch (err) {
          await safeRollback(client);
          txnClosed = true;
          if (err instanceof CapacityUnavailableError) {
            return { kind: "capacity_unavailable" as const, reason: err.reason };
          }
          throw err;
        }
        const reservation_id = `rsv_${randomUUID()}`;
        const leaseUntil = input.now_ms + (input.lease_duration_ms ?? ACTIVE_EXECUTION_LEASE_MS);
        const inserted = await client.query(
          `INSERT INTO admission_capacity_reservations (
            reservation_id, order_id, pool_id, ledger_kind, quantity,
            reservation_version, state, identity_digest, lease_until, created_at
          ) VALUES ($1,$2,$3,'active_execution',$4,1,'held',$5,to_timestamp($6/1000.0),to_timestamp($7/1000.0))
          RETURNING *`,
          [
            reservation_id,
            input.order_id,
            active.pool_id,
            quantity,
            createHash("sha256").update(`${input.order_id}:active:${quantity}`).digest("hex"),
            leaseUntil,
            input.now_ms,
          ],
        );
        await client.query("COMMIT");
        txnClosed = true;
        return { kind: "acquired" as const, reservation: rowToReservation(inserted.rows[0]) };
      } catch (err) {
        if (!txnClosed) await safeRollback(client);
        txnClosed = true;
        throw err;
      } finally {
        if (!txnClosed) await safeRollback(client);
        client.release();
      }
    });
  }

  /**
   * Fan-in-aware queued envelope release on an open client (F1/F4).
   * Promotes a peer to held+quantity, or frees pool units only for last subscriber.
   */
  private async releaseQueuedEnvelopeOnClient(
    client: pg.PoolClient,
    row: CapacityReservationRecord,
    reason: string,
    now_ms: number,
  ): Promise<CapacityReservationRecord> {
    if (!row.work_key_digest) {
      const updated = await client.query(
        `UPDATE admission_capacity_reservations
         SET state = 'released',
             reservation_version = reservation_version + 1,
             released_at = to_timestamp($2/1000.0)
         WHERE reservation_id = $1
         RETURNING *`,
        [row.reservation_id, now_ms],
      );
      return rowToReservation(updated.rows[0]);
    }

    const others = await client.query(
      `SELECT reservation_id, quantity, state, reservation_version
       FROM admission_capacity_reservations
       WHERE work_key_digest = $1
         AND ledger_kind = 'queued_work'
         AND state IN ('held', 'transferred')
         AND reservation_id <> $2
       FOR UPDATE`,
      [row.work_key_digest, row.reservation_id],
    );

    if (others.rows.length > 0) {
      if (row.state === "held" && row.quantity > 0) {
        const peer = others.rows[0]!;
        const envelopeQty = row.quantity;
        await client.query(
          `UPDATE admission_capacity_reservations
           SET state = 'transferred',
               quantity = 0,
               reservation_version = reservation_version + 1
           WHERE reservation_id = $1`,
          [row.reservation_id],
        );
        const promoted = await client.query(
          `UPDATE admission_capacity_reservations
           SET state = 'held',
               quantity = $2,
               reservation_version = reservation_version + 1
           WHERE reservation_id = $1
           RETURNING reservation_version`,
          [peer.reservation_id, envelopeQty],
        );
        await client.query(
          `INSERT INTO admission_capacity_transfer_log (
            event_id, reservation_id, from_state, to_state, reason, event_version, created_at
          ) VALUES ($1,$2,$3,'held','envelope_ownership_promote',$4,to_timestamp($5/1000.0))`,
          [
            `cte_${randomUUID()}`,
            peer.reservation_id,
            peer.state,
            Number(promoted.rows[0]?.reservation_version ?? 1),
            now_ms,
          ],
        );
      }
    } else if (row.quantity > 0) {
      await client.query(
        `UPDATE admission_capacity_pools
         SET consumed_units = GREATEST(0, consumed_units - $2), version = version + 1
         WHERE pool_id = $1`,
        [row.pool_id, row.quantity],
      );
    }

    const updated = await client.query(
      `UPDATE admission_capacity_reservations
       SET state = 'released',
           reservation_version = reservation_version + 1,
           released_at = to_timestamp($2/1000.0)
       WHERE reservation_id = $1
       RETURNING *`,
      [row.reservation_id, now_ms],
    );
    await client.query(
      `INSERT INTO admission_capacity_transfer_log (
        event_id, reservation_id, from_state, to_state, reason, event_version, created_at
      ) VALUES ($1,$2,$3,'released',$4,$5,to_timestamp($6/1000.0))`,
      [
        `cte_${randomUUID()}`,
        row.reservation_id,
        row.state,
        reason,
        row.reservation_version + 1,
        now_ms,
      ],
    );
    return rowToReservation(updated.rows[0]);
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
    return this.withSerializableRetry(async () => {
      const client = await this.pool.connect();
      let txnClosed = false;
      try {
        await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
        const res = await client.query(
          `SELECT * FROM admission_capacity_reservations WHERE reservation_id = $1 FOR UPDATE`,
          [input.reservation_id],
        );
        if (res.rows.length === 0) {
          await safeRollback(client);
          txnClosed = true;
          return { kind: "not_found" as const };
        }
        const row = rowToReservation(res.rows[0]);
        if (row.state !== "held" && row.state !== "transferred") {
          await client.query("COMMIT");
          txnClosed = true;
          return { kind: "already_released" as const, reservation: row };
        }
        if (row.reservation_version !== input.expected_version) {
          await safeRollback(client);
          txnClosed = true;
          return { kind: "version_mismatch" as const };
        }

        if (row.ledger_kind === "queued_work" && row.work_key_digest) {
          const released = await this.releaseQueuedEnvelopeOnClient(
            client,
            row,
            input.reason,
            input.now_ms,
          );
          await client.query("COMMIT");
          txnClosed = true;
          return { kind: "released" as const, reservation: released };
        }

        if (row.quantity > 0 && row.state === "held") {
          await client.query(
            `UPDATE admission_capacity_pools
             SET consumed_units = GREATEST(0, consumed_units - $2), version = version + 1
             WHERE pool_id = $1`,
            [row.pool_id, row.quantity],
          );
        }
        const updated = await client.query(
          `UPDATE admission_capacity_reservations
           SET state = 'released',
               reservation_version = reservation_version + 1,
               released_at = to_timestamp($2/1000.0)
           WHERE reservation_id = $1
           RETURNING *`,
          [input.reservation_id, input.now_ms],
        );
        await client.query(
          `INSERT INTO admission_capacity_transfer_log (
            event_id, reservation_id, from_state, to_state, reason, event_version, created_at
          ) VALUES ($1,$2,$3,'released',$4,$5,to_timestamp($6/1000.0))`,
          [
            `cte_${randomUUID()}`,
            input.reservation_id,
            row.state,
            input.reason,
            row.reservation_version + 1,
            input.now_ms,
          ],
        );
        await client.query("COMMIT");
        txnClosed = true;
        return { kind: "released" as const, reservation: rowToReservation(updated.rows[0]) };
      } catch (err) {
        if (!txnClosed) await safeRollback(client);
        txnClosed = true;
        throw err;
      } finally {
        if (!txnClosed) await safeRollback(client);
        client.release();
      }
    });
  }

  async releaseOrderCapacity(input: {
    order_id: string;
    reason: "fulfilled" | "terminal_failure" | "cancelled" | "abandoned";
    now_ms: number;
  }): Promise<{ readonly released: number }> {
    /**
     * Fan-in-aware release (matches in-memory):
     * - admission_rate / active_execution: free units when held
     * - queued_work: free shared envelope only when last subscriber leaves;
     *   otherwise reassign held envelope ownership and leave pool units consumed
     */
    return this.withSerializableRetry(async () => {
      const client = await this.pool.connect();
      let txnClosed = false;
      try {
        await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
        const rows = await client.query(
          `SELECT * FROM admission_capacity_reservations
           WHERE order_id = $1 AND state IN ('held', 'transferred')
           FOR UPDATE`,
          [input.order_id],
        );
        let released = 0;

        const markReleased = async (
          reservationId: string,
          fromState: string,
          version: number,
        ) => {
          await client.query(
            `UPDATE admission_capacity_reservations
             SET state = 'released',
                 reservation_version = reservation_version + 1,
                 released_at = to_timestamp($2/1000.0)
             WHERE reservation_id = $1`,
            [reservationId, input.now_ms],
          );
          await client.query(
            `INSERT INTO admission_capacity_transfer_log (
              event_id, reservation_id, from_state, to_state, reason, event_version, created_at
            ) VALUES ($1,$2,$3,'released',$4,$5,to_timestamp($6/1000.0))`,
            [
              `cte_${randomUUID()}`,
              reservationId,
              fromState,
              input.reason,
              version + 1,
              input.now_ms,
            ],
          );
        };

        for (const raw of rows.rows) {
          const row = rowToReservation(raw);

          if (row.ledger_kind === "queued_work" && row.work_key_digest) {
            const others = await client.query(
              `SELECT reservation_id, quantity, state FROM admission_capacity_reservations
               WHERE work_key_digest = $1
                 AND ledger_kind = 'queued_work'
                 AND order_id <> $2
                 AND state IN ('held', 'transferred')
                 AND reservation_id <> $3
               FOR UPDATE`,
              [row.work_key_digest, input.order_id, row.reservation_id],
            );

            if (others.rows.length > 0) {
              if (row.state === "held" && row.quantity > 0) {
                const peer = others.rows[0]!;
                const envelopeQty = row.quantity;
                await client.query(
                  `UPDATE admission_capacity_reservations
                   SET state = 'transferred',
                       quantity = 0,
                       reservation_version = reservation_version + 1
                   WHERE reservation_id = $1`,
                  [row.reservation_id],
                );
                await client.query(
                  `UPDATE admission_capacity_reservations
                   SET state = 'held',
                       quantity = $2,
                       reservation_version = reservation_version + 1
                   WHERE reservation_id = $1`,
                  [peer.reservation_id, envelopeQty],
                );
              }
            } else if (row.quantity > 0) {
              await client.query(
                `UPDATE admission_capacity_pools
                 SET consumed_units = GREATEST(0, consumed_units - $2), version = version + 1
                 WHERE pool_id = $1`,
                [row.pool_id, row.quantity],
              );
            }

            await markReleased(row.reservation_id, row.state, row.reservation_version);
            released += 1;
            continue;
          }

          if (row.state === "held" && row.quantity > 0) {
            await client.query(
              `UPDATE admission_capacity_pools
               SET consumed_units = GREATEST(0, consumed_units - $2), version = version + 1
               WHERE pool_id = $1`,
              [row.pool_id, row.quantity],
            );
          }
          await markReleased(row.reservation_id, row.state, row.reservation_version);
          released += 1;
        }
        await client.query("COMMIT");
        txnClosed = true;
        return { released };
      } catch (err) {
        if (!txnClosed) await safeRollback(client);
        txnClosed = true;
        throw err;
      } finally {
        if (!txnClosed) await safeRollback(client);
        client.release();
      }
    });
  }

  async reconcileExpiredActiveLeases(input: {
    now_ms: number;
  }): Promise<{ readonly expired: number }> {
    return this.withSerializableRetry(async () => {
      const client = await this.pool.connect();
      let txnClosed = false;
      try {
        await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
        const expired = await client.query(
          `SELECT * FROM admission_capacity_reservations
           WHERE state = 'held' AND ledger_kind = 'active_execution'
             AND lease_until IS NOT NULL AND lease_until <= to_timestamp($1/1000.0)
           FOR UPDATE`,
          [input.now_ms],
        );
        for (const row of expired.rows) {
          if (Number(row.quantity) > 0) {
            await client.query(
              `UPDATE admission_capacity_pools
               SET consumed_units = GREATEST(0, consumed_units - $2), version = version + 1
               WHERE pool_id = $1`,
              [row.pool_id, row.quantity],
            );
          }
          await client.query(
            `UPDATE admission_capacity_reservations
             SET state = 'expired',
                 reservation_version = reservation_version + 1,
                 released_at = to_timestamp($2/1000.0)
             WHERE reservation_id = $1`,
            [row.reservation_id, input.now_ms],
          );
        }
        await client.query("COMMIT");
        txnClosed = true;
        return { expired: expired.rows.length };
      } catch (err) {
        if (!txnClosed) await safeRollback(client);
        txnClosed = true;
        throw err;
      } finally {
        if (!txnClosed) await safeRollback(client);
        client.release();
      }
    });
  }

  async snapshotAccounting(): Promise<{
    readonly admission_rate: { consumed: number; limit: number };
    readonly queued_work: { consumed: number; limit: number };
    readonly active_execution: { consumed: number; limit: number };
  }> {
    const sum = async (kind: CapacityLedgerKind) => {
      const res = await this.pool.query(
        `SELECT COALESCE(SUM(consumed_units),0) AS consumed,
                COALESCE(SUM(limit_units),0) AS limit_units
         FROM admission_capacity_pools WHERE ledger_kind = $1`,
        [kind],
      );
      return {
        consumed: Number(res.rows[0].consumed),
        limit: Number(res.rows[0].limit_units),
      };
    };
    return {
      admission_rate: await sum("admission_rate"),
      queued_work: await sum("queued_work"),
      active_execution: await sum("active_execution"),
    };
  }
}

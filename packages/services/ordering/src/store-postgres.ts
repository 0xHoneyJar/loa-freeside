import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

import type { OrderState } from './order-state.js';
import {
  OrderNotFoundError,
  OrderWriteBudgetExceededError,
  type NewOrder,
  type OrderPatch,
  type OrderRecord,
  type OrderStore,
  type OrderWriteBudget,
  type OutboxEntry,
  type OutboxEvent,
  type TransitionOpts,
  type GateLeakWorkClaim,
  type GateLeakOrderInput,
} from './store.js';
import { assertTransition } from './order-state.js';
import type { IngredientJob, OperatorAuditEntry, OrderProbeMeta } from './kitchen-types.js';
import type { GateLeakCommunityJoin } from '@freeside/ordering-protocol';

const __dirname = dirname(fileURLToPath(import.meta.url));

function rowToRecord(row: pg.QueryResultRow): OrderRecord {
  return {
    order_id: row.order_id,
    product: row.product,
    placed_by: row.placed_by,
    inputs: row.inputs,
    placed_at_unix: Number(row.placed_at_unix),
    state: row.state as OrderState,
    inputs_digest: row.inputs_digest,
    recipe_id: row.recipe_id ?? undefined,
    resolved_buildings: row.resolved_buildings ?? undefined,
    result_ref: row.result_ref ?? undefined,
    output: row.output ?? undefined,
    output_digest: row.output_digest ?? undefined,
    refusal: row.refusal ?? undefined,
    ingredients: row.ingredients
      ? { metadata_snapshot: 'optional', ...row.ingredients }
      : undefined,
    fulfillment: row.fulfillment ?? undefined,
    ingredient_jobs: (row.ingredient_jobs ?? []) as IngredientJob[],
    operator_audit: (row.operator_audit ?? []) as OperatorAuditEntry[],
    probe_meta: (row.probe_meta ?? undefined) as OrderProbeMeta | undefined,
    created_at_unix: Number(row.created_at_unix),
    updated_at_unix: Number(row.updated_at_unix),
  };
}

export interface PostgresOrderStoreOptions {
  pool: pg.Pool;
  now?: () => number;
}

export class PostgresOrderStore implements OrderStore {
  private readonly pool: pg.Pool;
  private readonly now: () => number;

  constructor(opts: PostgresOrderStoreOptions) {
    this.pool = opts.pool;
    this.now = opts.now ?? (() => Math.floor(Date.now() / 1000));
  }

  static async connect(connectionString: string, opts: { migrate?: boolean } = {}): Promise<PostgresOrderStore> {
    const pool = new pg.Pool({ connectionString, max: 5 });
    const store = new PostgresOrderStore({ pool });
    if (opts.migrate ?? process.env.RUN_MIGRATIONS === 'true') {
      await store.runMigrations();
    }
    return store;
  }

  async runMigrations(): Promise<void> {
    for (const file of ['001_orders.sql', '002_probe_meta.sql', '003_gate_leak.sql']) {
      const sql = readFileSync(join(__dirname, '../migrations', file), 'utf8');
      await this.pool.query(sql);
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async placeOrder(
    order: NewOrder,
    placedEvent: OutboxEvent,
    writeBudget?: OrderWriteBudget,
  ): Promise<{ created: boolean; record: OrderRecord }> {
    if (writeBudget && (!Number.isInteger(writeBudget.limit) || writeBudget.limit < 1)) {
      throw new Error('order write budget limit must be positive');
    }
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const existing = await client.query('SELECT * FROM orders WHERE order_id = $1', [order.order_id]);
      if (existing.rows.length > 0) {
        await client.query('COMMIT');
        return { created: false, record: rowToRecord(existing.rows[0]) };
      }

      if (writeBudget) {
        const consumed = await client.query(
          `INSERT INTO order_write_budget (bucket, window_started_at, used)
           VALUES ($1,$2,1)
           ON CONFLICT (bucket, window_started_at) DO UPDATE SET
             used = order_write_budget.used + 1
           WHERE order_write_budget.used < $3
           RETURNING used`,
          [writeBudget.bucket, writeBudget.window_started_at, writeBudget.limit],
        );
        if (consumed.rows.length === 0) throw new OrderWriteBudgetExceededError();
      }

      const ts = this.now();
      const insert = await client.query(
        `INSERT INTO orders (
          order_id, product, placed_by, inputs, inputs_digest, state,
          placed_at_unix, created_at_unix, updated_at_unix, ingredients,
          ingredient_jobs, operator_audit
        ) VALUES ($1,$2,$3,$4,$5,'placed',$6,$7,$7,$8,'[]'::jsonb,'[]'::jsonb)
        RETURNING *`,
        [
          order.order_id,
          order.product,
          order.placed_by,
          JSON.stringify(order.inputs),
          order.inputs_digest,
          order.placed_at_unix,
          ts,
          order.ingredients ? JSON.stringify(order.ingredients) : null,
        ],
      );
      await client.query(
        'INSERT INTO order_outbox (order_id, subject, payload) VALUES ($1,$2,$3)',
        [order.order_id, placedEvent.subject, JSON.stringify(placedEvent.payload)],
      );
      await client.query('COMMIT');
      return { created: true, record: rowToRecord(insert.rows[0]) };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  async get(orderId: string): Promise<OrderRecord | undefined> {
    const res = await this.pool.query('SELECT * FROM orders WHERE order_id = $1', [orderId]);
    if (res.rows.length === 0) return undefined;
    return rowToRecord(res.rows[0]);
  }

  async transition(
    orderId: string,
    expectedFrom: OrderState,
    to: OrderState,
    opts: TransitionOpts = {},
  ): Promise<{ ok: boolean; record?: OrderRecord }> {
    assertTransition(expectedFrom, to);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const res = await client.query('SELECT * FROM orders WHERE order_id = $1 FOR UPDATE', [orderId]);
      if (res.rows.length === 0) throw new OrderNotFoundError(orderId);
      const current = rowToRecord(res.rows[0]);
      if (current.state !== expectedFrom) {
        await client.query('COMMIT');
        return { ok: false, record: current };
      }

      const patch = opts.patch ?? {};
      const ts = this.now();
      const updated = await client.query(
        `UPDATE orders SET
          state = $2,
          updated_at_unix = $3,
          recipe_id = COALESCE($4, recipe_id),
          resolved_buildings = COALESCE($5, resolved_buildings),
          result_ref = COALESCE($6, result_ref),
          output = COALESCE($7, output),
          output_digest = COALESCE($8, output_digest),
          refusal = COALESCE($9, refusal),
          ingredients = COALESCE($10, ingredients),
          fulfillment = COALESCE($11, fulfillment),
          ingredient_jobs = COALESCE($12, ingredient_jobs),
          operator_audit = COALESCE($13, operator_audit),
          probe_meta = COALESCE($14, probe_meta)
        WHERE order_id = $1
        RETURNING *`,
        [
          orderId,
          to,
          ts,
          patch.recipe_id ?? null,
          patch.resolved_buildings ? JSON.stringify(patch.resolved_buildings) : null,
          patch.result_ref ?? null,
          patch.output ? JSON.stringify(patch.output) : null,
          patch.output_digest ?? null,
          patch.refusal ? JSON.stringify(patch.refusal) : null,
          patch.ingredients ? JSON.stringify(patch.ingredients) : null,
          patch.fulfillment ? JSON.stringify(patch.fulfillment) : null,
          patch.ingredient_jobs ? JSON.stringify(patch.ingredient_jobs) : null,
          patch.operator_audit ? JSON.stringify(patch.operator_audit) : null,
          patch.probe_meta ? JSON.stringify(patch.probe_meta) : null,
        ],
      );

      if (opts.event) {
        await client.query('INSERT INTO order_outbox (order_id, subject, payload) VALUES ($1,$2,$3)', [
          orderId,
          opts.event.subject,
          JSON.stringify(opts.event.payload),
        ]);
      }
      await client.query('COMMIT');
      return { ok: true, record: rowToRecord(updated.rows[0]) };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  async appendEvent(orderId: string, event: OutboxEvent): Promise<void> {
    const exists = await this.pool.query('SELECT 1 FROM orders WHERE order_id = $1', [orderId]);
    if (exists.rows.length === 0) throw new OrderNotFoundError(orderId);
    await this.pool.query('INSERT INTO order_outbox (order_id, subject, payload) VALUES ($1,$2,$3)', [
      orderId,
      event.subject,
      JSON.stringify(event.payload),
    ]);
  }

  async appendEventOnce(
    orderId: string,
    event: OutboxEvent,
    idempotencyKey: string,
  ): Promise<{ created: boolean }> {
    const exists = await this.pool.query('SELECT 1 FROM orders WHERE order_id = $1', [orderId]);
    if (exists.rows.length === 0) throw new OrderNotFoundError(orderId);
    const inserted = await this.pool.query(
      `INSERT INTO order_outbox (order_id, subject, payload, idempotency_key)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
       RETURNING seq`,
      [orderId, event.subject, JSON.stringify(event.payload), idempotencyKey],
    );
    return { created: inserted.rows.length > 0 };
  }

  async patchRecord(orderId: string, patch: OrderPatch): Promise<OrderRecord> {
    const current = await this.get(orderId);
    if (!current) throw new OrderNotFoundError(orderId);
    const ts = this.now();
    const res = await this.pool.query(
      `UPDATE orders SET
        updated_at_unix = $2,
        recipe_id = COALESCE($3, recipe_id),
        resolved_buildings = COALESCE($4, resolved_buildings),
        result_ref = COALESCE($5, result_ref),
        output = COALESCE($6, output),
        output_digest = COALESCE($7, output_digest),
        refusal = COALESCE($8, refusal),
        ingredients = COALESCE($9, ingredients),
        fulfillment = COALESCE($10, fulfillment),
        ingredient_jobs = COALESCE($11, ingredient_jobs),
        operator_audit = COALESCE($12, operator_audit),
        probe_meta = COALESCE($13, probe_meta)
      WHERE order_id = $1
      RETURNING *`,
      [
        orderId,
        ts,
        patch.recipe_id ?? null,
        patch.resolved_buildings ? JSON.stringify(patch.resolved_buildings) : null,
        patch.result_ref ?? null,
        patch.output ? JSON.stringify(patch.output) : null,
        patch.output_digest ?? null,
        patch.refusal ? JSON.stringify(patch.refusal) : null,
        patch.ingredients ? JSON.stringify(patch.ingredients) : null,
        patch.fulfillment ? JSON.stringify(patch.fulfillment) : null,
        patch.ingredient_jobs ? JSON.stringify(patch.ingredient_jobs) : null,
        patch.operator_audit ? JSON.stringify(patch.operator_audit) : null,
        patch.probe_meta ? JSON.stringify(patch.probe_meta) : null,
      ],
    );
    return rowToRecord(res.rows[0]);
  }

  async pendingOutbox(): Promise<OutboxEntry[]> {
    const res = await this.pool.query(
      'SELECT seq, order_id, subject, payload, published FROM order_outbox WHERE published = FALSE ORDER BY seq',
    );
    return res.rows.map((row) => ({
      seq: Number(row.seq),
      order_id: row.order_id,
      subject: row.subject,
      payload: row.payload,
      published: row.published,
    }));
  }

  async markPublished(seq: number): Promise<void> {
    await this.pool.query('UPDATE order_outbox SET published = TRUE WHERE seq = $1', [seq]);
  }

  async listByState(state: OrderState): Promise<OrderRecord[]> {
    const res = await this.pool.query('SELECT * FROM orders WHERE state = $1', [state]);
    return res.rows.map(rowToRecord);
  }

  async claimGateLeakWork(workKey: string, orderId: string): Promise<{ created: boolean; claim: GateLeakWorkClaim }> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const order = await client.query('SELECT product FROM orders WHERE order_id = $1 FOR SHARE', [orderId]);
      if (order.rows[0]?.product !== 'gate-leak') {
        throw new Error(`gate-leak work claim requires a gate-leak order: ${orderId}`);
      }
      const inserted = await client.query(
        `INSERT INTO gate_leak_work_claims (work_key, canonical_order_id, created_at_unix)
         VALUES ($1,$2,$3)
         ON CONFLICT (work_key) DO NOTHING
         RETURNING work_key, canonical_order_id`,
        [workKey, orderId, this.now()],
      );
      const row = inserted.rows[0] ?? (
        await client.query(
          'SELECT work_key, canonical_order_id FROM gate_leak_work_claims WHERE work_key = $1',
          [workKey],
        )
      ).rows[0];
      await client.query('COMMIT');
      return {
        created: inserted.rows.length > 0,
        claim: { work_key: row.work_key, canonical_order_id: row.canonical_order_id },
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async appendGateLeakInput(input: GateLeakOrderInput, event: OutboxEvent): Promise<{ created: boolean }> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const order = await client.query('SELECT product FROM orders WHERE order_id = $1 FOR SHARE', [
        input.gate_leak_order_id,
      ]);
      if (order.rows[0]?.product !== 'gate-leak') throw new Error('gate-leak order not found');
      const inserted = await client.query(
        `INSERT INTO gate_leak_order_inputs (
          gate_leak_order_id, input_name, input_value, supplied_at_unix
        ) VALUES ($1,$2,$3,$4)
        ON CONFLICT (gate_leak_order_id, input_name) DO NOTHING
        RETURNING gate_leak_order_id`,
        [input.gate_leak_order_id, input.input, input.value, input.supplied_at_unix],
      );
      if (inserted.rows.length === 0) {
        const existing = await client.query(
          `SELECT input_value FROM gate_leak_order_inputs
           WHERE gate_leak_order_id = $1 AND input_name = $2`,
          [input.gate_leak_order_id, input.input],
        );
        if (existing.rows[0]?.input_value !== input.value) throw new Error('conflicting gate-leak input');
      } else {
        await client.query('INSERT INTO order_outbox (order_id, subject, payload) VALUES ($1,$2,$3)', [
          input.gate_leak_order_id,
          event.subject,
          JSON.stringify(event.payload),
        ]);
      }
      await client.query('COMMIT');
      return { created: inserted.rows.length > 0 };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async getGateLeakInput(orderId: string): Promise<GateLeakOrderInput | undefined> {
    const result = await this.pool.query(
      `SELECT gate_leak_order_id, input_name, input_value, supplied_at_unix
       FROM gate_leak_order_inputs
       WHERE gate_leak_order_id = $1 AND input_name = 'access_started_at'`,
      [orderId],
    );
    const row = result.rows[0];
    if (!row) return undefined;
    return {
      gate_leak_order_id: row.gate_leak_order_id,
      input: 'access_started_at',
      value: row.input_value,
      supplied_at_unix: Number(row.supplied_at_unix),
    };
  }

  async appendGateLeakJoin(join: GateLeakCommunityJoin, event: OutboxEvent): Promise<{ created: boolean }> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const rows = await client.query(
        'SELECT order_id, product FROM orders WHERE order_id = ANY($1::text[]) FOR SHARE',
        [[join.gate_leak_order_id, join.community_onboarding_order_id]],
      );
      const products = new Map(rows.rows.map((row) => [row.order_id, row.product]));
      if (products.get(join.gate_leak_order_id) !== 'gate-leak') throw new Error('gate-leak order not found');
      if (products.get(join.community_onboarding_order_id) !== 'community-onboarding') {
        throw new Error('community-onboarding order not found');
      }
      const inserted = await client.query(
        `INSERT INTO gate_leak_order_joins (
          gate_leak_order_id, community_onboarding_order_id, joined_at_unix
        ) VALUES ($1,$2,$3)
        ON CONFLICT (gate_leak_order_id, community_onboarding_order_id) DO NOTHING
        RETURNING gate_leak_order_id`,
        [join.gate_leak_order_id, join.community_onboarding_order_id, join.joined_at_unix],
      );
      if (inserted.rows.length > 0) {
        await client.query('INSERT INTO order_outbox (order_id, subject, payload) VALUES ($1,$2,$3)', [
          join.gate_leak_order_id,
          event.subject,
          JSON.stringify(event.payload),
        ]);
      }
      await client.query('COMMIT');
      return { created: inserted.rows.length > 0 };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async listGateLeakJoins(gateLeakOrderId: string): Promise<GateLeakCommunityJoin[]> {
    const result = await this.pool.query(
      `SELECT gate_leak_order_id, community_onboarding_order_id, joined_at_unix
       FROM gate_leak_order_joins
       WHERE gate_leak_order_id = $1
       ORDER BY joined_at_unix, community_onboarding_order_id`,
      [gateLeakOrderId],
    );
    return result.rows.map((row) => ({
      gate_leak_order_id: row.gate_leak_order_id,
      community_onboarding_order_id: row.community_onboarding_order_id,
      joined_at_unix: Number(row.joined_at_unix),
    }));
  }
}

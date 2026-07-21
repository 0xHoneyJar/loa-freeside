import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

import type { OrderState } from './order-state.js';
import {
  OrderNotFoundError,
  type NewOrder,
  type OrderPatch,
  type OrderRecord,
  type OrderStore,
  type OutboxEntry,
  type OutboxEvent,
  type TransitionOpts,
} from './store.js';
import { assertTransition } from './order-state.js';
import type { IngredientJob, OperatorAuditEntry, OrderProbeMeta } from './kitchen-types.js';

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
    ingredients: row.ingredients ?? undefined,
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
    for (const file of [
      '001_orders.sql',
      '002_probe_meta.sql',
      '004_collection_resolutions.sql',
      '005_collection_report_list.sql',
      '006_report_attention_receipts.sql',
      '007_shared_preparation_work.sql',
      '008_admission_capacity.sql',
    ]) {
      const sql = readFileSync(join(__dirname, '../migrations', file), 'utf8');
      await this.pool.query(sql);
    }
  }

  /** Shared pool for sibling adapters (e.g. PostgresResolutionStore). */
  getPool(): pg.Pool {
    return this.pool;
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async placeOrder(order: NewOrder, placedEvent: OutboxEvent): Promise<{ created: boolean; record: OrderRecord }> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const existing = await client.query('SELECT * FROM orders WHERE order_id = $1', [order.order_id]);
      if (existing.rows.length > 0) {
        await client.query('COMMIT');
        return { created: false, record: rowToRecord(existing.rows[0]) };
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

  async listCollectionReports(query: {
    readonly community_ref: string;
    readonly placed_by: string;
    readonly limit: number;
    readonly cursor?: { readonly created_at_unix: number; readonly order_id: string };
  }): Promise<OrderRecord[]> {
    if (query.cursor) {
      const res = await this.pool.query(
        `SELECT * FROM orders
         WHERE product = 'collection-report'
           AND placed_by = $1
           AND (inputs ->> 'community_ref') = $2
           AND (
             created_at_unix < $3
             OR (created_at_unix = $3 AND order_id < $4)
           )
         ORDER BY created_at_unix DESC, order_id DESC
         LIMIT $5`,
        [
          query.placed_by,
          query.community_ref,
          query.cursor.created_at_unix,
          query.cursor.order_id,
          query.limit,
        ],
      );
      return res.rows.map(rowToRecord);
    }

    const res = await this.pool.query(
      `SELECT * FROM orders
       WHERE product = 'collection-report'
         AND placed_by = $1
         AND (inputs ->> 'community_ref') = $2
       ORDER BY created_at_unix DESC, order_id DESC
       LIMIT $3`,
      [query.placed_by, query.community_ref, query.limit],
    );
    return res.rows.map(rowToRecord);
  }
}

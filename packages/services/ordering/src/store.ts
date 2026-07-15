import type {
  ProductId,
  ResolvedBuilding,
  OrderRefusal,
  CommunityOnboardingIngredients,
  CommunityOnboardingOutput,
  GateLeakCommunityJoin,
} from '@freeside/ordering-protocol';
import { assertTransition, type OrderState } from './order-state.js';
import type { IngredientJob, OperatorAuditEntry, OrderProbeMeta } from './kitchen-types.js';

/**
 * Durable order-state store + transactional outbox (SDD §13 H-3 / H-4).
 *
 * This is the PORT. The MVP backend is in-memory (`InMemoryOrderStore`); a Postgres
 * adapter behind this same interface is the deploy step — the `Promise` return shapes and
 * the atomic `transition`/`placeOrder` semantics are drawn for that swap.
 *
 * Two correctness guarantees the port enforces:
 *  - **Idempotency (H-3):** `transition` is a compare-and-swap on `expectedFrom`. The
 *    orchestrator claims `placed → routing` exactly once; a redelivered `placed` finds the
 *    state already advanced, the CAS returns `{ ok: false }`, and the audit never re-runs.
 *  - **Outbox (H-4):** a state change and the lifecycle event it produces are written in
 *    one atomic step (`transition({ event })`). Terminal events publish FROM the durable
 *    outbox (`pendingOutbox` → publish → `markPublished`), never via a dual-write to NATS +
 *    DB — so `result_ref` can never dangle if the process dies between persist and publish.
 */

export interface OutboxEvent {
  subject: string;
  payload: unknown;
}

export interface OutboxEntry extends OutboxEvent {
  seq: number;
  order_id: string;
  published: boolean;
}

export interface NewOrder {
  order_id: string;
  product: ProductId;
  placed_by: string;
  inputs: Record<string, unknown>;
  placed_at_unix: number;
  inputs_digest: string;
  /** Preset #2 only — seeded at placement for poll UX. */
  ingredients?: CommunityOnboardingIngredients;
}

export interface OrderRecord {
  order_id: string;
  product: ProductId;
  placed_by: string;
  inputs: Record<string, unknown>;
  placed_at_unix: number;
  state: OrderState;
  inputs_digest: string;
  recipe_id?: string;
  resolved_buildings?: ResolvedBuilding[];
  /** Pointer to the persisted result (the store owns the body). */
  result_ref?: string;
  /** The product result body (an AuditOutput for access-risk-audit). Opaque to the Ordering context (EVANS). */
  output?: unknown;
  output_digest?: string;
  refusal?: OrderRefusal;
  /** Preset #2 only — ingredient checklist for poll UX. */
  ingredients?: CommunityOnboardingIngredients;
  /** Preset #2 terminal output — worlds-api canonical slug. */
  fulfillment?: CommunityOnboardingOutput;
  /** Kitchen V1 — GitHub triage issues filed per ingredient. */
  ingredient_jobs?: IngredientJob[];
  /** Kitchen V2 — operator advance-ingredient audit trail. */
  operator_audit?: OperatorAuditEntry[];
  /** Fulfillment-surface — last raw probe truth per ingredient (SDD D1). Legacy rows: absent. */
  probe_meta?: OrderProbeMeta;
  created_at_unix: number;
  updated_at_unix: number;
}

/** Fields a transition may patch onto the record (atomically, with the state change). */
export type OrderPatch = Partial<
  Pick<
    OrderRecord,
    | 'recipe_id'
    | 'resolved_buildings'
    | 'result_ref'
    | 'output'
    | 'output_digest'
    | 'refusal'
    | 'ingredients'
    | 'fulfillment'
    | 'ingredient_jobs'
    | 'operator_audit'
    | 'probe_meta'
  >
>;

export interface TransitionOpts {
  patch?: OrderPatch;
  /** Lifecycle event enqueued to the outbox in the SAME atomic step as the transition. */
  event?: OutboxEvent;
}

export interface GateLeakWorkClaim {
  work_key: string;
  canonical_order_id: string;
}

export interface GateLeakOrderInput {
  gate_leak_order_id: string;
  input: 'access_started_at';
  value: string;
  supplied_at_unix: number;
}

export interface OrderStore {
  /** Persist a new order in `placed` + enqueue its `placed` event. Idempotent on `order_id`. */
  placeOrder(order: NewOrder, placedEvent: OutboxEvent): Promise<{ created: boolean; record: OrderRecord }>;
  get(orderId: string): Promise<OrderRecord | undefined>;
  /** CAS transition: applies only when current state === `expectedFrom`. Returns `{ ok: false }` on a CAS miss. */
  transition(
    orderId: string,
    expectedFrom: OrderState,
    to: OrderState,
    opts?: TransitionOpts,
  ): Promise<{ ok: boolean; record?: OrderRecord }>;
  /** Enqueue an event WITHOUT a state change (e.g. `producing`, emitted 0..n times while in `producing`). */
  appendEvent(orderId: string, event: OutboxEvent): Promise<void>;
  /** Patch fields without a lifecycle transition (e.g. ingredient updates while `producing`). */
  patchRecord(orderId: string, patch: OrderPatch): Promise<OrderRecord>;
  pendingOutbox(): Promise<OutboxEntry[]>;
  markPublished(seq: number): Promise<void>;
  /** Kitchen worker — orders in a given lifecycle state. */
  listByState(state: OrderState): Promise<OrderRecord[]>;
  /** Subject-index claim, idempotent across distinct journeys. Shadow owns compute single-flight. */
  claimGateLeakWork(workKey: string, orderId: string): Promise<{ created: boolean; claim: GateLeakWorkClaim }>;
  /** Append the missing semantic prerequisite without rewriting the original order/digest. */
  appendGateLeakInput(input: GateLeakOrderInput, event: OutboxEvent): Promise<{ created: boolean }>;
  getGateLeakInput(orderId: string): Promise<GateLeakOrderInput | undefined>;
  /** Append-only join + outbox event in one store operation. Never patches either order. */
  appendGateLeakJoin(join: GateLeakCommunityJoin, event: OutboxEvent): Promise<{ created: boolean }>;
  listGateLeakJoins(gateLeakOrderId: string): Promise<GateLeakCommunityJoin[]>;
}

export class OrderNotFoundError extends Error {
  constructor(readonly orderId: string) {
    super(`order not found: ${orderId}`);
    this.name = 'OrderNotFoundError';
  }
}

export interface InMemoryOrderStoreOptions {
  /** Unix-seconds clock for created_at/updated_at. Injectable for deterministic tests. */
  now?: () => number;
}

/**
 * MVP in-memory backend. JS is single-threaded, so each method body runs to completion
 * without interleaving — the read-then-write in `transition`/`placeOrder` IS atomic. The
 * `Promise` surface is the durable port's shape; a Postgres adapter swaps in unchanged.
 */
export class InMemoryOrderStore implements OrderStore {
  private readonly orders = new Map<string, OrderRecord>();
  private readonly outbox: OutboxEntry[] = [];
  private readonly gateLeakWork = new Map<string, GateLeakWorkClaim>();
  private readonly gateLeakInputs = new Map<string, GateLeakOrderInput>();
  private readonly gateLeakJoins: GateLeakCommunityJoin[] = [];
  private seq = 0;
  private readonly now: () => number;

  constructor(opts: InMemoryOrderStoreOptions = {}) {
    this.now = opts.now ?? (() => Math.floor(Date.now() / 1000));
  }

  private enqueue(orderId: string, event: OutboxEvent): void {
    this.outbox.push({ seq: this.seq++, order_id: orderId, subject: event.subject, payload: event.payload, published: false });
  }

  async placeOrder(order: NewOrder, placedEvent: OutboxEvent): Promise<{ created: boolean; record: OrderRecord }> {
    const existing = this.orders.get(order.order_id);
    if (existing) return { created: false, record: existing };
    const ts = this.now();
    const record: OrderRecord = {
      order_id: order.order_id,
      product: order.product,
      placed_by: order.placed_by,
      inputs: order.inputs,
      placed_at_unix: order.placed_at_unix,
      state: 'placed',
      inputs_digest: order.inputs_digest,
      ingredients: order.ingredients,
      ingredient_jobs: [],
      operator_audit: [],
      created_at_unix: ts,
      updated_at_unix: ts,
    };
    this.orders.set(record.order_id, record);
    this.enqueue(record.order_id, placedEvent);
    return { created: true, record };
  }

  async get(orderId: string): Promise<OrderRecord | undefined> {
    return this.orders.get(orderId);
  }

  async transition(
    orderId: string,
    expectedFrom: OrderState,
    to: OrderState,
    opts: TransitionOpts = {},
  ): Promise<{ ok: boolean; record?: OrderRecord }> {
    // Legality of the (expectedFrom → to) pair is a programmer-error guard, checked first.
    assertTransition(expectedFrom, to);
    const record = this.orders.get(orderId);
    if (!record) throw new OrderNotFoundError(orderId);
    // CAS: a redelivery / concurrent claim that lost the race finds a different state.
    if (record.state !== expectedFrom) return { ok: false, record };
    const next: OrderRecord = {
      ...record,
      ...opts.patch,
      state: to,
      updated_at_unix: this.now(),
    };
    this.orders.set(orderId, next);
    if (opts.event) this.enqueue(orderId, opts.event);
    return { ok: true, record: next };
  }

  async appendEvent(orderId: string, event: OutboxEvent): Promise<void> {
    if (!this.orders.has(orderId)) throw new OrderNotFoundError(orderId);
    this.enqueue(orderId, event);
  }

  async patchRecord(orderId: string, patch: OrderPatch): Promise<OrderRecord> {
    const record = this.orders.get(orderId);
    if (!record) throw new OrderNotFoundError(orderId);
    const next: OrderRecord = { ...record, ...patch, updated_at_unix: this.now() };
    this.orders.set(orderId, next);
    return next;
  }

  async pendingOutbox(): Promise<OutboxEntry[]> {
    return this.outbox.filter((e) => !e.published).map((e) => ({ ...e }));
  }

  async markPublished(seq: number): Promise<void> {
    const entry = this.outbox.find((e) => e.seq === seq);
    if (entry) entry.published = true;
  }

  async listByState(state: OrderState): Promise<OrderRecord[]> {
    return [...this.orders.values()].filter((r) => r.state === state);
  }

  async claimGateLeakWork(workKey: string, orderId: string): Promise<{ created: boolean; claim: GateLeakWorkClaim }> {
    const existing = this.gateLeakWork.get(workKey);
    if (existing) return { created: false, claim: existing };
    const order = this.orders.get(orderId);
    if (!order || order.product !== 'gate-leak') throw new Error(`gate-leak work claim requires a gate-leak order: ${orderId}`);
    const claim = { work_key: workKey, canonical_order_id: orderId };
    this.gateLeakWork.set(workKey, claim);
    return { created: true, claim };
  }

  async appendGateLeakInput(input: GateLeakOrderInput, event: OutboxEvent): Promise<{ created: boolean }> {
    const order = this.orders.get(input.gate_leak_order_id);
    if (!order || order.product !== 'gate-leak') throw new Error('gate-leak order not found');
    const existing = this.gateLeakInputs.get(input.gate_leak_order_id);
    if (existing) {
      if (existing.input !== input.input || existing.value !== input.value) {
        throw new Error('conflicting gate-leak input');
      }
      return { created: false };
    }
    this.gateLeakInputs.set(input.gate_leak_order_id, { ...input });
    this.enqueue(input.gate_leak_order_id, event);
    return { created: true };
  }

  async getGateLeakInput(orderId: string): Promise<GateLeakOrderInput | undefined> {
    const input = this.gateLeakInputs.get(orderId);
    return input ? { ...input } : undefined;
  }

  async appendGateLeakJoin(join: GateLeakCommunityJoin, event: OutboxEvent): Promise<{ created: boolean }> {
    const gateLeak = this.orders.get(join.gate_leak_order_id);
    const onboarding = this.orders.get(join.community_onboarding_order_id);
    if (!gateLeak || gateLeak.product !== 'gate-leak') throw new Error('gate-leak order not found');
    if (!onboarding || onboarding.product !== 'community-onboarding') throw new Error('community-onboarding order not found');
    const exists = this.gateLeakJoins.some(
      (candidate) =>
        candidate.gate_leak_order_id === join.gate_leak_order_id &&
        candidate.community_onboarding_order_id === join.community_onboarding_order_id,
    );
    if (exists) return { created: false };
    this.gateLeakJoins.push({ ...join });
    this.enqueue(join.gate_leak_order_id, event);
    return { created: true };
  }

  async listGateLeakJoins(gateLeakOrderId: string): Promise<GateLeakCommunityJoin[]> {
    return this.gateLeakJoins
      .filter((join) => join.gate_leak_order_id === gateLeakOrderId)
      .map((join) => ({ ...join }));
  }
}

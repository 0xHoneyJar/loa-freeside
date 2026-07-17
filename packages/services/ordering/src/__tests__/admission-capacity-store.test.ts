import { describe, expect, it } from "vitest";
import { InMemoryAdmissionCapacityStore } from "../admission-capacity-store.js";
import {
  isHeldEnvelopeUniqueViolation,
  shouldRetryAdmissionTxn,
} from "../admission-capacity-pg-errors.js";
import { fixtureGateLeakCertificate } from "../recipe-expansion-certificate.js";
import { InMemorySharedPreparationStore } from "../shared-preparation-store.js";
import { InMemoryOrderStore } from "../store.js";
import {
  fixtureCommunityScopeDigest,
  fixturePublicWorkKey,
} from "./shared-preparation-fixtures.js";

function makeStore(limits?: {
  admission_rate?: number;
  queued_work?: number;
  active_execution?: number;
}) {
  const orderStore = new InMemoryOrderStore({ now: () => 1_700_000_000 });
  const preparationStore = new InMemorySharedPreparationStore();
  const capacity = new InMemoryAdmissionCapacityStore({
    orderStore,
    preparationStore,
    defaultLimits: limits,
  });
  return { orderStore, preparationStore, capacity };
}

function admitInput(
  overrides: Partial<{
    client_request_id: string;
    requester_subject: string;
    now_ms: number;
    advisory_shed: boolean;
    simulated_lock_wait_ms: number;
    capacity_weight: number;
  }> = {},
) {
  const work_key = fixturePublicWorkKey();
  const body = {
    resolution_id: "res_fixture",
    client_request_id: overrides.client_request_id ?? "req-1",
  };
  return {
    requester_subject: overrides.requester_subject ?? "subject-alice",
    client_request_id: overrides.client_request_id ?? "req-1",
    order: {
      product: "collection-report" as const,
      placed_by: overrides.requester_subject ?? "subject-alice",
      inputs: body,
      placed_at_unix: 1_700_000_000,
      inputs_digest: "digest-placeholder",
    },
    body,
    certificate: fixtureGateLeakCertificate(2),
    work_key,
    order_tenant_scope_digest: fixtureCommunityScopeDigest("community-alpha"),
    pool_scope: {
      network_ref: "eip155:1",
      capability: "ownership_index.v1",
    },
    now_ms: overrides.now_ms ?? 1_000,
    ...(overrides.advisory_shed !== undefined
      ? { advisory_shed: overrides.advisory_shed }
      : {}),
    ...(overrides.simulated_lock_wait_ms !== undefined
      ? { simulated_lock_wait_ms: overrides.simulated_lock_wait_ms }
      : {}),
  };
}

describe("CR-201C admission capacity store", () => {
  it("admits atomically: order + work link + capacity reservations + outbox", async () => {
    const { capacity, orderStore, preparationStore } = makeStore();
    const result = await capacity.admitOrder(admitInput());
    expect(result.kind).toBe("admitted");
    if (result.kind !== "admitted") return;

    expect(result.created).toBe(true);
    expect(result.work_created).toBe(true);
    expect(result.reservation_ids).toHaveLength(2);

    const order = await orderStore.get(result.order.order_id);
    expect(order?.state).toBe("placed");
    const outbox = await orderStore.pendingOutbox();
    expect(outbox.some((e) => e.order_id === result.order.order_id)).toBe(true);

    const work = await preparationStore.getWork(result.work_id);
    expect(work?.state).toBe("queued");
    const links = await preparationStore.listActiveLinks(result.work_id);
    expect(links).toHaveLength(1);

    const accounting = await capacity.snapshotAccounting();
    expect(accounting.admission_rate.consumed).toBe(1);
    expect(accounting.queued_work.consumed).toBe(1);
    expect(accounting.active_execution.consumed).toBe(0);
  });

  it("fan-in consumes admission_rate per order but not a second queued envelope", async () => {
    const { capacity, preparationStore } = makeStore();
    const first = await capacity.admitOrder(admitInput({ client_request_id: "a" }));
    const second = await capacity.admitOrder(
      admitInput({ client_request_id: "b", requester_subject: "subject-bob", now_ms: 2 }),
    );
    expect(first.kind).toBe("admitted");
    expect(second.kind).toBe("admitted");
    if (first.kind !== "admitted" || second.kind !== "admitted") return;

    expect(first.work_id).toBe(second.work_id);
    expect(first.work_created).toBe(true);
    expect(second.work_created).toBe(false);

    const links = await preparationStore.listActiveLinks(first.work_id);
    expect(links).toHaveLength(2);

    const accounting = await capacity.snapshotAccounting();
    expect(accounting.admission_rate.consumed).toBe(2);
    expect(accounting.queued_work.consumed).toBe(1);
  });

  it("idempotent replay returns the same order/reservations; conflict on body mismatch", async () => {
    const { capacity } = makeStore();
    const first = await capacity.admitOrder(admitInput({ client_request_id: "idem-1" }));
    expect(first.kind).toBe("admitted");
    if (first.kind !== "admitted") return;

    const replay = await capacity.admitOrder(admitInput({ client_request_id: "idem-1", now_ms: 5 }));
    expect(replay.kind).toBe("admitted");
    if (replay.kind !== "admitted") return;
    expect(replay.replay).toBe(true);
    expect(replay.order.order_id).toBe(first.order.order_id);
    expect(replay.reservation_ids).toEqual(first.reservation_ids);

    const conflict = await capacity.admitOrder({
      ...admitInput({ client_request_id: "idem-1", now_ms: 6 }),
      body: { resolution_id: "different", client_request_id: "idem-1" },
    });
    expect(conflict.kind).toBe("idempotency_conflict");

    const accounting = await capacity.snapshotAccounting();
    expect(accounting.admission_rate.consumed).toBe(1);
  });

  it("rejects with capacity_unavailable and creates neither order nor reservation", async () => {
    const { capacity, orderStore } = makeStore({ admission_rate: 1, queued_work: 10 });
    const first = await capacity.admitOrder(admitInput({ client_request_id: "ok" }));
    expect(first.kind).toBe("admitted");

    const denied = await capacity.admitOrder(
      admitInput({ client_request_id: "deny", requester_subject: "subject-bob", now_ms: 2 }),
    );
    expect(denied.kind).toBe("capacity_unavailable");
    if (denied.kind !== "capacity_unavailable") return;
    expect(denied.reason).toBe("insufficient_admission_rate");

    const orders = await orderStore.listByState("placed");
    expect(orders).toHaveLength(1);
    expect(await capacity.getIdempotency("subject-bob", "deny")).toBeUndefined();

    const accounting = await capacity.snapshotAccounting();
    expect(accounting.admission_rate.consumed).toBe(1);
  });

  it("advisory shed and lock-wait shed before txn create nothing", async () => {
    const { capacity, orderStore } = makeStore();
    const shed = await capacity.admitOrder(admitInput({ advisory_shed: true }));
    expect(shed).toEqual({ kind: "capacity_unavailable", reason: "advisory_shed" });

    const lock = await capacity.admitOrder(
      admitInput({ client_request_id: "lock", simulated_lock_wait_ms: 999 }),
    );
    expect(lock).toEqual({ kind: "capacity_unavailable", reason: "lock_timeout" });

    expect(await orderStore.listByState("placed")).toHaveLength(0);
    const accounting = await capacity.snapshotAccounting();
    expect(accounting.admission_rate.consumed).toBe(0);
  });

  it("active-execution leases are separate and reconcile on expiry exactly once", async () => {
    const { capacity } = makeStore({ active_execution: 2 });
    const admitted = await capacity.admitOrder(admitInput());
    expect(admitted.kind).toBe("admitted");
    if (admitted.kind !== "admitted") return;

    const lease = await capacity.acquireActiveExecutionLease({
      order_id: admitted.order.order_id,
      pool_scope: { network_ref: "eip155:1", capability: "ownership_index.v1" },
      lease_duration_ms: 1_000,
      now_ms: 10_000,
    });
    expect(lease.kind).toBe("acquired");
    if (lease.kind !== "acquired") return;

    let accounting = await capacity.snapshotAccounting();
    expect(accounting.active_execution.consumed).toBe(1);

    const expired = await capacity.reconcileExpiredActiveLeases({ now_ms: 12_000 });
    expect(expired.expired).toBe(1);
    accounting = await capacity.snapshotAccounting();
    expect(accounting.active_execution.consumed).toBe(0);

    const again = await capacity.reconcileExpiredActiveLeases({ now_ms: 13_000 });
    expect(again.expired).toBe(0);
  });

  it("terminal release frees admission + queued envelope exactly once", async () => {
    const { capacity } = makeStore();
    const admitted = await capacity.admitOrder(admitInput());
    expect(admitted.kind).toBe("admitted");
    if (admitted.kind !== "admitted") return;

    const first = await capacity.releaseOrderCapacity({
      order_id: admitted.order.order_id,
      reason: "fulfilled",
      now_ms: 50,
    });
    expect(first.released).toBeGreaterThanOrEqual(1);

    const second = await capacity.releaseOrderCapacity({
      order_id: admitted.order.order_id,
      reason: "fulfilled",
      now_ms: 51,
    });
    expect(second.released).toBe(0);

    const accounting = await capacity.snapshotAccounting();
    expect(accounting.admission_rate.consumed).toBe(0);
    expect(accounting.queued_work.consumed).toBe(0);
  });

  it("join failure rolls back capacity and leaves no orphan order", async () => {
    const orderStore = new InMemoryOrderStore({ now: () => 1_700_000_000 });
    const preparationStore = new InMemorySharedPreparationStore();
    preparationStore.joinPublicWork = async () => ({ kind: "serialization_retry" });
    const capacity = new InMemoryAdmissionCapacityStore({
      orderStore,
      preparationStore,
    });

    const denied = await capacity.admitOrder(admitInput({ client_request_id: "join-fail" }));
    expect(denied.kind).toBe("capacity_unavailable");
    if (denied.kind === "capacity_unavailable") {
      expect(denied.reason).toBe("lock_timeout");
    }

    expect(await orderStore.listByState("placed")).toHaveLength(0);
    expect(await capacity.getIdempotency("subject-alice", "join-fail")).toBeUndefined();
    const accounting = await capacity.snapshotAccounting();
    expect(accounting.admission_rate.consumed).toBe(0);
    expect(accounting.queued_work.consumed).toBe(0);
  });

  it("cancel after fan-in does not strand or double-spend the shared envelope", async () => {
    const { capacity } = makeStore();
    const a = await capacity.admitOrder(admitInput({ client_request_id: "fan-a" }));
    const b = await capacity.admitOrder(
      admitInput({ client_request_id: "fan-b", requester_subject: "subject-bob", now_ms: 2 }),
    );
    expect(a.kind).toBe("admitted");
    expect(b.kind).toBe("admitted");
    if (a.kind !== "admitted" || b.kind !== "admitted") return;

    await capacity.releaseOrderCapacity({
      order_id: a.order.order_id,
      reason: "cancelled",
      now_ms: 10,
    });
    let accounting = await capacity.snapshotAccounting();
    // Shared envelope still held by B; admission for A released.
    expect(accounting.admission_rate.consumed).toBe(1);
    expect(accounting.queued_work.consumed).toBe(1);

    await capacity.releaseOrderCapacity({
      order_id: b.order.order_id,
      reason: "cancelled",
      now_ms: 11,
    });
    accounting = await capacity.snapshotAccounting();
    expect(accounting.admission_rate.consumed).toBe(0);
    expect(accounting.queued_work.consumed).toBe(0);
  });

  it("F2: concurrent held-envelope unique violation maps to admission retry", () => {
    const uniqueErr = {
      code: "23505",
      constraint: "admission_capacity_reservations_work_held_unique_idx",
      detail: "Key (work_key_digest)=(abc) already exists.",
    };
    expect(isHeldEnvelopeUniqueViolation(uniqueErr)).toBe(true);
    expect(shouldRetryAdmissionTxn(uniqueErr)).toBe(true);
    expect(shouldRetryAdmissionTxn(new Error("serialization_retry"))).toBe(true);
    expect(shouldRetryAdmissionTxn({ code: "40001" })).toBe(true);
    expect(shouldRetryAdmissionTxn({ code: "23505", constraint: "orders_pkey" })).toBe(false);
  });

  it("F1: releasing envelope owner promotes peer to held with quantity", async () => {
    const { capacity } = makeStore();
    const a = await capacity.admitOrder(admitInput({ client_request_id: "own-a" }));
    const b = await capacity.admitOrder(
      admitInput({ client_request_id: "own-b", requester_subject: "subject-bob", now_ms: 2 }),
    );
    expect(a.kind).toBe("admitted");
    expect(b.kind).toBe("admitted");
    if (a.kind !== "admitted" || b.kind !== "admitted") return;

    const aQueued = (await capacity.listHeldReservations(a.order.order_id)).find(
      (r) => r.ledger_kind === "queued_work",
    );
    // Owner holds the envelope; fan-in peer is transferred.
    expect(aQueued?.state).toBe("held");
    expect(aQueued?.quantity).toBeGreaterThan(0);

    await capacity.releaseOrderCapacity({
      order_id: a.order.order_id,
      reason: "cancelled",
      now_ms: 10,
    });

    const bHeld = (await capacity.listHeldReservations(b.order.order_id)).find(
      (r) => r.ledger_kind === "queued_work",
    );
    expect(bHeld?.state).toBe("held");
    expect(bHeld?.quantity).toBeGreaterThan(0);

    // Subsequent admit must share the promoted held envelope (not create a second).
    const c = await capacity.admitOrder(
      admitInput({ client_request_id: "own-c", requester_subject: "subject-carol", now_ms: 11 }),
    );
    expect(c.kind).toBe("admitted");
    if (c.kind !== "admitted") return;
    expect(c.work_created).toBe(false);
    const accounting = await capacity.snapshotAccounting();
    expect(accounting.queued_work.consumed).toBe(1);
    expect(accounting.admission_rate.consumed).toBe(2); // B + C (A released)
  });

  it("F3: sole held envelope is not folded away when join reuses work", async () => {
    const { capacity, preparationStore } = makeStore();
    // Pre-create ready/active work so the next admit joins without creating work,
    // but is still the sole capacity envelope owner.
    const seed = await capacity.admitOrder(admitInput({ client_request_id: "seed" }));
    expect(seed.kind).toBe("admitted");
    if (seed.kind !== "admitted") return;

    // Detach seed order's capacity while leaving the shared work row active so a
    // later admit joins existing work (created=false) as the new sole envelope.
    await capacity.releaseOrderCapacity({
      order_id: seed.order.order_id,
      reason: "cancelled",
      now_ms: 5,
    });
    // Work row may still be active with zero subscribers — admit again with a
    // stubbed join that reports reused work while we are the only capacity holder.
    const realJoin = preparationStore.joinPublicWork.bind(preparationStore);
    let soleAdmit = false;
    preparationStore.joinPublicWork = async (input) => {
      const result = await realJoin(input);
      if (result.kind === "joined" && soleAdmit) {
        return { ...result, created: false };
      }
      return result;
    };

    soleAdmit = true;
    const only = await capacity.admitOrder(
      admitInput({ client_request_id: "sole", requester_subject: "subject-bob", now_ms: 6 }),
    );
    expect(only.kind).toBe("admitted");
    if (only.kind !== "admitted") return;

    const held = (await capacity.listHeldReservations(only.order.order_id)).find(
      (r) => r.ledger_kind === "queued_work",
    );
    expect(held?.state).toBe("held");
    expect(held?.quantity).toBeGreaterThan(0);
    const accounting = await capacity.snapshotAccounting();
    expect(accounting.queued_work.consumed).toBe(1);
  });

  it("F4: releaseReservation on shared envelope promotes peer instead of double-free", async () => {
    const { capacity } = makeStore();
    const a = await capacity.admitOrder(admitInput({ client_request_id: "rsv-a" }));
    const b = await capacity.admitOrder(
      admitInput({ client_request_id: "rsv-b", requester_subject: "subject-bob", now_ms: 2 }),
    );
    expect(a.kind).toBe("admitted");
    expect(b.kind).toBe("admitted");
    if (a.kind !== "admitted" || b.kind !== "admitted") return;

    const aQueued = (await capacity.listHeldReservations(a.order.order_id)).find(
      (r) => r.ledger_kind === "queued_work",
    );
    expect(aQueued).toBeDefined();
    if (!aQueued) return;

    const released = await capacity.releaseReservation({
      reservation_id: aQueued.reservation_id,
      expected_version: aQueued.reservation_version,
      reason: "cancel_queued",
      now_ms: 10,
    });
    expect(released.kind).toBe("released");

    const accounting = await capacity.snapshotAccounting();
    expect(accounting.queued_work.consumed).toBe(1);

    const bHeld = (await capacity.listHeldReservations(b.order.order_id)).find(
      (r) => r.ledger_kind === "queued_work",
    );
    expect(bHeld?.state).toBe("held");
    expect(bHeld?.quantity).toBeGreaterThan(0);
  });
});

import { describe, expect, it } from "vitest";
import { InMemoryAdmissionCapacityStore } from "../admission-capacity-store.js";
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
});

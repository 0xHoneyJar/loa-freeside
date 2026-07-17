import { describe, expect, it } from "vitest";
import { InMemoryAdmissionCapacityStore } from "../admission-capacity-store.js";
import { fixtureGateLeakCertificate } from "../recipe-expansion-certificate.js";
import { InMemorySharedPreparationStore } from "../shared-preparation-store.js";
import { InMemoryOrderStore } from "../store.js";
import {
  fixtureCommunityScopeDigest,
  fixturePublicWorkKey,
} from "./shared-preparation-fixtures.js";

function buildHarness(limits?: {
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
  const work_key = fixturePublicWorkKey();
  const certificate = fixtureGateLeakCertificate(2);
  const pool_scope = {
    network_ref: "eip155:1",
    capability: "ownership_index.v1" as const,
  };
  const tenant = fixtureCommunityScopeDigest("community-alpha");

  return {
    orderStore,
    preparationStore,
    capacity,
    work_key,
    certificate,
    pool_scope,
    tenant,
    admitEquivalent(n: number, clientRequestId: string) {
      return Promise.all(
        Array.from({ length: n }, (_, i) =>
          capacity.admitOrder({
            requester_subject: "subject-alice",
            client_request_id: clientRequestId,
            order: {
              product: "collection-report",
              placed_by: "subject-alice",
              inputs: { client_request_id: clientRequestId },
              placed_at_unix: 1_700_000_000,
              inputs_digest: `d-${clientRequestId}`,
            },
            body: { client_request_id: clientRequestId },
            certificate,
            work_key,
            order_tenant_scope_digest: tenant,
            pool_scope,
            now_ms: 1_000 + i,
          }),
        ),
      );
    },
    admitDistinct(n: number) {
      return Promise.all(
        Array.from({ length: n }, (_, i) =>
          capacity.admitOrder({
            requester_subject: `subject-${i}`,
            client_request_id: `req-${i}`,
            order: {
              product: "collection-report",
              placed_by: `subject-${i}`,
              inputs: { client_request_id: `req-${i}` },
              placed_at_unix: 1_700_000_000,
              inputs_digest: `d-${i}`,
            },
            body: { client_request_id: `req-${i}` },
            certificate,
            work_key,
            order_tenant_scope_digest: tenant,
            pool_scope,
            now_ms: 1_000 + i,
          }),
        ),
      );
    },
  };
}

describe("CR-201C admission capacity linearizability", () => {
  for (const n of [100, 500, 1_000] as const) {
    it(`${n} concurrent equivalent requests: one order, no over-admission, safe replay`, async () => {
      const h = buildHarness();
      const started = performance.now();
      const results = await h.admitEquivalent(n, "shared-idem");
      const elapsed = performance.now() - started;

      const admitted = results.filter((r) => r.kind === "admitted");
      expect(admitted).toHaveLength(n);
      const orderIds = new Set(
        admitted.map((r) => (r.kind === "admitted" ? r.order.order_id : "")),
      );
      expect(orderIds.size).toBe(1);

      const accounting = await h.capacity.snapshotAccounting();
      expect(accounting.admission_rate.consumed).toBe(1);
      expect(accounting.queued_work.consumed).toBe(1);

      const workIds = new Set(
        admitted.map((r) => (r.kind === "admitted" ? r.work_id : "")),
      );
      expect(workIds.size).toBe(1);
      // Bound: serializable mutex should finish well under a few seconds in-memory.
      expect(elapsed).toBeLessThan(15_000);
    });

    it(`${n} concurrent distinct requests: fan-in one envelope, exact accounting`, async () => {
      const h = buildHarness({ admission_rate: n + 10, queued_work: 10 });
      const started = performance.now();
      const results = await h.admitDistinct(n);
      const elapsed = performance.now() - started;

      const admitted = results.filter((r) => r.kind === "admitted");
      expect(admitted).toHaveLength(n);

      const orderIds = new Set(
        admitted.map((r) => (r.kind === "admitted" ? r.order.order_id : "")),
      );
      expect(orderIds.size).toBe(n);

      const workIds = new Set(
        admitted.map((r) => (r.kind === "admitted" ? r.work_id : "")),
      );
      expect(workIds.size).toBe(1);

      const workId = [...workIds][0]!;
      const links = await h.preparationStore.listActiveLinks(workId);
      expect(links).toHaveLength(n);

      const accounting = await h.capacity.snapshotAccounting();
      expect(accounting.admission_rate.consumed).toBe(n);
      expect(accounting.queued_work.consumed).toBe(1);
      expect(accounting.active_execution.consumed).toBe(0);
      expect(elapsed).toBeLessThan(30_000);
    });
  }

  it("capacity ceiling: no over-admission under concurrent pressure", async () => {
    const limit = 50;
    const h = buildHarness({ admission_rate: limit, queued_work: 100 });
    const results = await h.admitDistinct(200);
    const admitted = results.filter((r) => r.kind === "admitted");
    const denied = results.filter((r) => r.kind === "capacity_unavailable");
    expect(admitted).toHaveLength(limit);
    expect(denied).toHaveLength(200 - limit);

    const accounting = await h.capacity.snapshotAccounting();
    expect(accounting.admission_rate.consumed).toBe(limit);
    expect(accounting.queued_work.consumed).toBe(1);
  });

  it("release + retry + lease expiry cannot double-spend", async () => {
    const h = buildHarness({ admission_rate: 2, queued_work: 2, active_execution: 1 });
    const a = await h.capacity.admitOrder({
      requester_subject: "subject-a",
      client_request_id: "a",
      order: {
        product: "collection-report",
        placed_by: "subject-a",
        inputs: {},
        placed_at_unix: 1,
        inputs_digest: "a",
      },
      body: { k: "a" },
      certificate: h.certificate,
      work_key: h.work_key,
      order_tenant_scope_digest: h.tenant,
      pool_scope: h.pool_scope,
      now_ms: 1,
    });
    expect(a.kind).toBe("admitted");
    if (a.kind !== "admitted") return;

    const lease = await h.capacity.acquireActiveExecutionLease({
      order_id: a.order.order_id,
      pool_scope: h.pool_scope,
      lease_duration_ms: 100,
      now_ms: 1_000,
    });
    expect(lease.kind).toBe("acquired");

    await h.capacity.reconcileExpiredActiveLeases({ now_ms: 2_000 });
    await h.capacity.releaseOrderCapacity({
      order_id: a.order.order_id,
      reason: "terminal_failure",
      now_ms: 3_000,
    });
    // Second release is a no-op (no double-spend).
    await h.capacity.releaseOrderCapacity({
      order_id: a.order.order_id,
      reason: "terminal_failure",
      now_ms: 3_001,
    });

    const accounting = await h.capacity.snapshotAccounting();
    expect(accounting.admission_rate.consumed).toBe(0);
    expect(accounting.queued_work.consumed).toBe(0);
    expect(accounting.active_execution.consumed).toBe(0);

    // Retry after release succeeds.
    const retry = await h.capacity.admitOrder({
      requester_subject: "subject-a",
      client_request_id: "a-retry",
      order: {
        product: "collection-report",
        placed_by: "subject-a",
        inputs: {},
        placed_at_unix: 1,
        inputs_digest: "a2",
      },
      body: { k: "a2" },
      certificate: h.certificate,
      work_key: h.work_key,
      order_tenant_scope_digest: h.tenant,
      pool_scope: h.pool_scope,
      now_ms: 4_000,
    });
    expect(retry.kind).toBe("admitted");
  });

  it("rejected request after shed creates neither order nor reservation", async () => {
    const h = buildHarness();
    const denied = await h.capacity.admitOrder({
      requester_subject: "subject-x",
      client_request_id: "shed",
      order: {
        product: "collection-report",
        placed_by: "subject-x",
        inputs: {},
        placed_at_unix: 1,
        inputs_digest: "x",
      },
      body: { k: "x" },
      certificate: h.certificate,
      work_key: h.work_key,
      order_tenant_scope_digest: h.tenant,
      pool_scope: h.pool_scope,
      now_ms: 1,
      advisory_shed: true,
    });
    expect(denied.kind).toBe("capacity_unavailable");
    expect(await h.orderStore.listByState("placed")).toHaveLength(0);
    expect(await h.capacity.getIdempotency("subject-x", "shed")).toBeUndefined();
    const accounting = await h.capacity.snapshotAccounting();
    expect(accounting.admission_rate.consumed).toBe(0);
  });
});

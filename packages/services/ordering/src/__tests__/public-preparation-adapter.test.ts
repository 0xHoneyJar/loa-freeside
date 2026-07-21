import { describe, expect, it, vi } from "vitest";
import { ORDER_LIFECYCLE_SUBJECTS } from "@freeside/ordering-protocol";

import { InMemoryAdmissionCapacityStore } from "../admission-capacity-store.js";
import {
  COLLECTION_PREP_POOL_CAPABILITY,
  REPORT_GENERATION_POOL_CAPABILITY,
} from "../public-preparation-constants.js";
import { sonarCommandInboxKey } from "../public-preparation-dispatch-key.js";
import { InMemoryPublicPrepDispatchStore } from "../public-preparation-dispatch-store.js";
import { PublicPreparationAdapter } from "../public-preparation-adapter.js";
import { FixturePublicPreparationSonarPort } from "../public-preparation-sonar-port.js";
import { PublicPreparationWorker } from "../public-preparation-worker.js";
import { fixtureGateLeakCertificate } from "../recipe-expansion-certificate.js";
import { InMemorySharedPreparationStore } from "../shared-preparation-store.js";
import { buildPublicWorkKeyMaterial } from "../shared-preparation-work-key.js";
import { InMemoryOrderStore } from "../store.js";
import { CollectionReportOrchestrator } from "../collection-report-orchestrator.js";
import type { VersionedDigest } from "../shared-preparation-types.js";
import {
  fixtureCommunityScopeDigest,
  fixturePublicWorkKey,
  loadEvmFixtureCandidate,
} from "./shared-preparation-fixtures.js";

function validCollectionReportInputs() {
  return {
    schema_version: 1 as const,
    resolution_id: "res-fixture",
    candidate_snapshot_digest: {
      algorithm: "sha-256" as const,
      domain: "collection-resolution.candidate-snapshot",
      major_version: 1,
      digest: "ab".repeat(32),
    },
    community_ref: "community-alpha",
  };
}

function fixtureSecondDeployment(): VersionedDigest {
  return {
    algorithm: "sha-256",
    domain: "collection.deployment",
    major_version: 1,
    digest: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  };
}

function multiDeploymentIds(deployments: readonly VersionedDigest[]): VersionedDigest[] {
  if (deployments.length >= 2) return [...deployments.slice(0, 2)];
  return [deployments[0]!, fixtureSecondDeployment()];
}

async function completePrepWork(
  h: ReturnType<typeof makeHarness>,
  workId: string,
  advanceMs: (delta: number) => void,
): Promise<void> {
  await h.adapter.processWork(workId);
  for (const item of await h.preparationStore.listWorkItems(workId)) {
    const ref = item.external_job_ref;
    if (ref) h.sonar.markIndexed(ref);
  }
  advanceMs(31_000);
  await h.adapter.processWork(workId);
}

function makeHarness(nowMs?: number | (() => number)) {
  const clock = { value: typeof nowMs === "number" ? nowMs : Date.now() };
  const tick = typeof nowMs === "function" ? nowMs : () => clock.value;
  const orderStore = new InMemoryOrderStore({ now: () => Math.floor(tick() / 1000) });
  const preparationStore = new InMemorySharedPreparationStore();
  const dispatchStore = new InMemoryPublicPrepDispatchStore();
  const sonar = new FixturePublicPreparationSonarPort();
  const capacity = new InMemoryAdmissionCapacityStore({ orderStore, preparationStore });
  const adapter = new PublicPreparationAdapter({
    preparationStore,
    dispatchStore,
    sonar,
    orderStore,
    capacityStore: capacity,
    now: tick,
    workerId: "test-worker",
  });
  return { orderStore, preparationStore, dispatchStore, sonar, capacity, adapter, nowMs: tick, clock };
}

async function admitOrder(
  h: ReturnType<typeof makeHarness>,
  input: {
    order_id?: string;
    client_request_id: string;
    now_ms: number;
    work_key?: ReturnType<typeof fixturePublicWorkKey>;
    drive_producing?: boolean;
  },
) {
  const work_key = input.work_key ?? fixturePublicWorkKey();
  const inputs = validCollectionReportInputs();
  const result = await h.capacity.admitOrder({
    requester_subject: "subject-alice",
    client_request_id: input.client_request_id,
    order: {
      order_id: input.order_id,
      product: "collection-report",
      placed_by: "subject-alice",
      inputs,
      placed_at_unix: Math.floor(input.now_ms / 1000),
      inputs_digest: "digest",
    },
    body: inputs,
    certificate: fixtureGateLeakCertificate(work_key.deployment_ids.length * 2),
    work_key,
    order_tenant_scope_digest: fixtureCommunityScopeDigest("community-alpha"),
    pool_scope: { network_ref: "eip155:1", capability: "ownership_index.v1" },
    now_ms: input.now_ms,
  });
  if (result.kind === "admitted" && input.drive_producing !== false) {
    await h.orderStore.transition(result.order.order_id, "placed", "routing", {});
    await h.orderStore.transition(result.order.order_id, "routing", "producing", {});
  }
  return result;
}

describe("CR-204A public preparation adapter", () => {
  it("creates/joins work at admission before Sonar dispatch", async () => {
    const h = makeHarness();
    const now = h.clock;
    now.value = 1_000;
    const admitted = await admitOrder(h, { client_request_id: "req-a", now_ms: now.value });
    expect(admitted.kind).toBe("admitted");
    if (admitted.kind !== "admitted") return;
    expect(admitted.work_created).toBe(true);
    expect(h.sonar.dispatchCalls).toHaveLength(0);

    now.value = 2_000;
    await h.adapter.processWork(admitted.work_id);
    expect(h.sonar.dispatchCalls.length).toBeGreaterThan(0);
  });

  it("does not duplicate physical ingest on redelivered worker invocation", async () => {
    let now = 1_000;
    const h = makeHarness(() => now);
    const admitted = await admitOrder(h, { client_request_id: "dup", now_ms: now });
    if (admitted.kind !== "admitted") throw new Error("admit failed");

    now = 2_000;
    await h.adapter.processWork(admitted.work_id);
    const firstCalls = h.sonar.dispatchCalls.length;
    const firstKeys = new Set(h.sonar.dispatchCalls.map((c) => c.command_inbox_key));

    // Advance the live harness clock past PUBLIC_PREP_WORKER_LEASE_MS so reclaim runs.
    now += 31_000;
    const redelivered = await h.adapter.processWork(admitted.work_id);
    expect(redelivered.kind).not.toBe("busy");
    expect(h.sonar.dispatchCalls.length).toBe(firstCalls);
    expect(new Set(h.sonar.dispatchCalls.map((c) => c.command_inbox_key))).toEqual(firstKeys);
  });

  it("returns the same child job on Sonar replay of inbox key", async () => {
    let now = 1_000;
    const h = makeHarness(() => now);
    const admitted = await admitOrder(h, { client_request_id: "replay", now_ms: now });
    if (admitted.kind !== "admitted") throw new Error("admit failed");
    const work = await h.preparationStore.getWork(admitted.work_id);
    const items = await h.preparationStore.listWorkItems(admitted.work_id);
    const item = items[0]!;
    const inboxKey = sonarCommandInboxKey({
      generation: work!.generation,
      deployment_id: item.deployment_id,
      capability: item.capability,
      adapter_version: item.adapter_version,
    });

    const first = await h.sonar.dispatchChildJob({
      command_inbox_key: inboxKey,
      deployment_id: item.deployment_id,
      capability: item.capability,
      adapter_version: item.adapter_version,
      generation: work!.generation,
      lease_epoch: 1,
    });
    const second = await h.sonar.dispatchChildJob({
      command_inbox_key: inboxKey,
      deployment_id: item.deployment_id,
      capability: item.capability,
      adapter_version: item.adapter_version,
      generation: work!.generation,
      lease_epoch: 2,
    });
    expect(first.external_job_ref).toBe(second.external_job_ref);
  });

  it("repairs lost dispatch via reconciliation", async () => {
    let now = 1_000;
    const h = makeHarness(() => now);
    const admitted = await admitOrder(h, { client_request_id: "lost", now_ms: now });
    if (admitted.kind !== "admitted") throw new Error("admit failed");
    const items = await h.preparationStore.listWorkItems(admitted.work_id);
    const work = (await h.preparationStore.getWork(admitted.work_id))!;
    const item = items[0]!;
    const inboxKey = sonarCommandInboxKey({
      generation: work.generation,
      deployment_id: item.deployment_id,
      capability: item.capability,
      adapter_version: item.adapter_version,
    });
    await h.dispatchStore.recordIntent({
      command_inbox_key: inboxKey,
      work_item_id: item.work_item_id,
      work_id: work.work_id,
      lease_epoch: 0,
      now_ms: now,
    });

    now = 10_000;
    await h.adapter.reconcileLostDispatches(now);
    const refreshed = (await h.preparationStore.listWorkItems(admitted.work_id))[0]!;
    expect(refreshed.external_job_ref).toBeDefined();
  });

  it("keeps orders durable and retryable through Sonar outage", async () => {
    let now = 1_000;
    const h = makeHarness(() => now);
    const admitted = await admitOrder(h, { client_request_id: "outage", now_ms: now });
    if (admitted.kind !== "admitted") throw new Error("admit failed");

    h.sonar.setOutage(true);
    now = 2_000;
    const result = await h.adapter.processWork(admitted.work_id);
    expect(result.kind).toBe("retry_scheduled");

    const order = await h.orderStore.get(admitted.order.order_id);
    expect(order?.state).toBe("producing");
    const work = await h.preparationStore.getWork(admitted.work_id);
    expect(work?.state).toBe("retry_wait");
  });

  it("wakes retry_wait and resumes after scheduled time", async () => {
    let now = 1_000;
    const h = makeHarness(() => now);
    const admitted = await admitOrder(h, { client_request_id: "wake", now_ms: now });
    if (admitted.kind !== "admitted") throw new Error("admit failed");

    h.sonar.setOutage(true);
    now = 2_000;
    await h.adapter.processWork(admitted.work_id);
    const failed = await h.preparationStore.getWork(admitted.work_id);
    expect(failed?.state).toBe("retry_wait");

    h.sonar.setOutage(false);
    now = failed!.next_attempt_at_unix_ms! + 1;
    await h.adapter.tick();
    const woke = await h.preparationStore.getWork(admitted.work_id);
    expect(woke?.state).not.toBe("retry_wait");
  });

  it("reclaims expired lease once under contested reclaim", async () => {
    let now = 1_000;
    const h = makeHarness(() => now);
    const admitted = await admitOrder(h, { client_request_id: "lease", now_ms: now });
    if (admitted.kind !== "admitted") throw new Error("admit failed");

    now = 2_000;
    await h.preparationStore.acquireLease({
      work_id: admitted.work_id,
      worker_id: "worker-a",
      lease_duration_ms: 1_000,
      now_ms: now,
    });

    now = 10_000;
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        h.preparationStore.acquireLease({
          work_id: admitted.work_id,
          worker_id: `worker-${i}`,
          lease_duration_ms: 30_000,
          now_ms: now,
        }),
      ),
    );
    const winners = results.filter((r) => r.kind === "reclaimed" || r.kind === "acquired");
    expect(winners).toHaveLength(1);
  });

  it("requires every reject-policy child before parent ready (staged expansion)", async () => {
    let now = 1_000;
    const h = makeHarness(() => now);
    const candidate = loadEvmFixtureCandidate();
    const deployments = candidate.identity.deployments.map((d) => d.deployment_id);
    const workKey = buildPublicWorkKeyMaterial({
      capability: "ownership_index.v1",
      capability_version: "v1",
      collection_id: candidate.identity.collection_id,
      deployment_ids: multiDeploymentIds(deployments),
      finality_policies: candidate.finality_policies,
      source_identity: {
        schema_version: 1,
        producer: "sonar-api.fixture",
        upstream_evidence_source: "sonar.public-capability.v1",
      },
      readiness_policy_version: "gate-leak-public-prep.v1",
      adapter_version: "sonar-kitchen.v1",
    });
    const admitted = await admitOrder(h, {
      client_request_id: "multi",
      now_ms: now,
      work_key: workKey,
    });
    if (admitted.kind !== "admitted") throw new Error("admit failed");

    now = 2_000;
    await h.adapter.processWork(admitted.work_id);
    const items = await h.preparationStore.listWorkItems(admitted.work_id);
    expect(items.length).toBe(2);
    for (const item of await h.preparationStore.listWorkItems(admitted.work_id)) {
      if (item.external_job_ref) h.sonar.markIndexed(item.external_job_ref);
    }

    now += 31_000;
    await h.capacity.reconcileExpiredActiveLeases({ now_ms: now });
    const activeBefore = (await h.capacity.snapshotAccounting()).active_execution.consumed;
    const result = await h.adapter.processWork(admitted.work_id);
    expect(result.kind).toBe("advanced");
    const work = await h.preparationStore.getWork(admitted.work_id);
    expect(work?.state).toBe("ready");

    const order = await h.orderStore.get(admitted.order.order_id);
    const keys = (order?.ingredient_jobs ?? []).map((j) => j.idempotency_key);
    expect(keys).toHaveLength(2);
    expect(new Set(keys).size).toBe(2);
    for (const key of keys) {
      expect(key).toContain(admitted.order.order_id);
      expect(key).toContain("sonar");
    }

    // Ready path must release the active execution lease acquired on this tick.
    const activeAfter = (await h.capacity.snapshotAccounting()).active_execution.consumed;
    expect(activeAfter).toBe(activeBefore);
  });

  it("advances every linked eligible order when work becomes ready", async () => {
    let now = 1_000;
    const h = makeHarness(() => now);
    const workKey = fixturePublicWorkKey();
    const a = await admitOrder(h, { client_request_id: "fan-a", now_ms: now, work_key: workKey });
    now = 1_100;
    const b = await admitOrder(h, { client_request_id: "fan-b", now_ms: now, work_key: workKey });
    if (a.kind !== "admitted" || b.kind !== "admitted") throw new Error("admit failed");
    expect(a.work_id).toBe(b.work_id);

    now += 31_000;
    await completePrepWork(h, a.work_id, (delta) => {
      now += delta;
    });

    const orderA = await h.orderStore.get(a.order.order_id);
    const orderB = await h.orderStore.get(b.order.order_id);
    expect(orderA?.ingredient_jobs?.length).toBeGreaterThan(0);
    expect(orderB?.ingredient_jobs?.length).toBeGreaterThan(0);
    expect(orderA?.state).toBe("producing");
    expect(orderB?.state).toBe("producing");
  });

  it("projects one terminal Needs attention outcome to all subscribers", async () => {
    let now = 1_000;
    const h = makeHarness(() => now);
    const workKey = fixturePublicWorkKey();
    const a = await admitOrder(h, { client_request_id: "fail-a", now_ms: now, work_key: workKey });
    now = 1_100;
    const b = await admitOrder(h, { client_request_id: "fail-b", now_ms: now, work_key: workKey });
    if (a.kind !== "admitted" || b.kind !== "admitted") throw new Error("admit failed");

    now = 2_000;
    const lease = await h.preparationStore.acquireLease({
      work_id: a.work_id,
      worker_id: "w",
      lease_duration_ms: 30_000,
      now_ms: now,
    });
    if (lease.kind !== "acquired") throw new Error("lease failed");
    await h.preparationStore.transitionToPreparing({
      work_id: a.work_id,
      expected_lease_epoch: lease.work.lease_epoch,
      now_ms: now,
    });
    await h.preparationStore.recordTerminalFailure({
      work_id: a.work_id,
      expected_lease_epoch: lease.work.lease_epoch,
      failure: { code: "preparation_failed", reason: "fixture terminal" },
      now_ms: now + 1,
    });
    await h.adapter.processWork(a.work_id);

    const orderA = await h.orderStore.get(a.order.order_id);
    const orderB = await h.orderStore.get(b.order.order_id);
    expect(orderA?.state).toBe("failed");
    expect(orderB?.state).toBe("failed");
    expect(orderA?.refusal?.code).toBe("preparation_failed");
    expect(orderB?.refusal?.code).toBe("preparation_failed");
  });

  it("resumes after worker restart from durable state", async () => {
    let now = 1_000;
    const h = makeHarness(() => now);
    const admitted = await admitOrder(h, { client_request_id: "restart", now_ms: now });
    if (admitted.kind !== "admitted") throw new Error("admit failed");

    await completePrepWork(h, admitted.work_id, (delta) => {
      now += delta;
    });

    const work = await h.preparationStore.getWork(admitted.work_id);
    expect(work?.state).toBe("ready");
  });

  it("uses separate collection_prep and report_generation pool capability constants", () => {
    expect(COLLECTION_PREP_POOL_CAPABILITY).toBe("collection_prep");
    expect(REPORT_GENERATION_POOL_CAPABILITY).toBe("report_generation");
    expect(COLLECTION_PREP_POOL_CAPABILITY).not.toBe(REPORT_GENERATION_POOL_CAPABILITY);
  });

  it("collection-report orchestrator invokes adapter for linked producing orders", async () => {
    let now = 1_000;
    const h = makeHarness(() => now);
    const admitted = await admitOrder(h, { client_request_id: "orch", now_ms: now });
    if (admitted.kind !== "admitted") throw new Error("admit failed");

    const processSpy = vi.spyOn(h.adapter, "processWork");
    const orch = new CollectionReportOrchestrator({
      store: h.orderStore,
      resolver: { resolve: async () => ({ capability: "x", building: "b", endpoint: "e", source: "s" }) },
      now: () => now,
      preparationStore: h.preparationStore,
      publicPrepAdapter: h.adapter,
    });
    const record = await h.orderStore.get(admitted.order.order_id);
    await orch.process(admitted.order.order_id, record!);
    expect(processSpy).toHaveBeenCalledWith(admitted.work_id);
  });
});

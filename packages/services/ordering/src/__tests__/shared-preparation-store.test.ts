import { describe, expect, it } from "vitest";
import {
  countActiveRows,
  InMemorySharedPreparationStore,
  SharedPreparationFencingError,
  SharedPreparationStateError,
} from "../shared-preparation-store.js";
import {
  buildPublicWorkKeyMaterial,
  digestPublicWorkKey,
} from "../shared-preparation-work-key.js";
import { PUBLIC_PREP_CAPABILITIES } from "../shared-preparation-types.js";
import {
  fixtureCommunityScopeDigest,
  fixturePublicWorkKey,
  fixtureReadinessEvidence,
  fixtureWorkKeyDigest,
  loadEvmFixtureCandidate,
} from "./shared-preparation-fixtures.js";

describe("CR-201A public shared preparation store", () => {
  it("enforces one active work row per work key under 100 equivalent joiners", async () => {
    const store = new InMemorySharedPreparationStore();
    const workKey = fixturePublicWorkKey();
    const digest = fixtureWorkKeyDigest(workKey);
    const now = Date.parse("2026-07-17T22:00:00.000Z");

    const results = await Promise.all(
      Array.from({ length: 100 }, (_, index) =>
        store.joinPublicWork({
          order_id: `ord_join_${index}`,
          order_tenant_scope_digest: fixtureCommunityScopeDigest("community-alpha"),
          work_key: workKey,
          now_ms: now + index,
        }),
      ),
    );

    for (const result of results) {
      expect(result.kind).toBe("joined");
      if (result.kind !== "joined") continue;
      expect(result.work.work_key_digest).toBe(digest);
    }

    const workIds = new Set(
      results
        .filter((result): result is Extract<typeof result, { kind: "joined" }> => result.kind === "joined")
        .map((result) => result.work.work_id),
    );
    expect(workIds.size).toBe(1);
    expect(countActiveRows(store, digest)).toBe(1);

    const links = await store.listActiveLinks([...workIds][0]!);
    expect(links).toHaveLength(100);
  });

  it("does not share community-scoped keys across different scope digests", async () => {
    const store = new InMemorySharedPreparationStore();
    const candidate = loadEvmFixtureCandidate();
    const deploymentIds = candidate.identity.deployments.map((d) => d.deployment_id);

    const alphaKey = buildPublicWorkKeyMaterial({
      capability: "ownership_index.v1",
      capability_version: "v1",
      collection_id: candidate.identity.collection_id,
      deployment_ids: deploymentIds,
      finality_policies: candidate.finality_policies,
      source_identity: {
        schema_version: 1,
        producer: "sonar-api.fixture",
        upstream_evidence_source: "sonar.public-capability.v1",
      },
      readiness_policy_version: "gate-leak-public-prep.v1",
      adapter_version: "sonar-kitchen.v1",
    });

    const betaKey = buildPublicWorkKeyMaterial({
      ...{
        capability: "ownership_index.v1" as const,
        capability_version: "v1",
        collection_id: candidate.identity.collection_id,
        deployment_ids: deploymentIds,
        finality_policies: candidate.finality_policies,
        source_identity: {
          schema_version: 1,
          producer: "sonar-api.fixture",
          upstream_evidence_source: "sonar.public-capability.v1",
        },
        readiness_policy_version: "gate-leak-community-beta.v1",
        adapter_version: "sonar-kitchen.v1",
      },
    });

    expect(fixtureWorkKeyDigest(alphaKey)).not.toEqual(fixtureWorkKeyDigest(betaKey));

    const first = await store.joinPublicWork({
      order_id: "ord_alpha",
      order_tenant_scope_digest: fixtureCommunityScopeDigest("community-alpha"),
      work_key: alphaKey,
      now_ms: 1,
    });
    const second = await store.joinPublicWork({
      order_id: "ord_beta",
      order_tenant_scope_digest: fixtureCommunityScopeDigest("community-beta"),
      work_key: betaKey,
      now_ms: 2,
    });

    expect(first.kind).toBe("joined");
    expect(second.kind).toBe("joined");
    if (first.kind !== "joined" || second.kind !== "joined") return;
    expect(first.work.work_id).not.toEqual(second.work.work_id);
  });

  it("increments lease epoch on reclaim and rejects stale fenced writes", async () => {
    const store = new InMemorySharedPreparationStore();
    const workKey = fixturePublicWorkKey();
    const joined = await store.joinPublicWork({
      order_id: "ord_lease",
      order_tenant_scope_digest: fixtureCommunityScopeDigest("community-alpha"),
      work_key: workKey,
      now_ms: 1_000,
    });
    expect(joined.kind).toBe("joined");
    if (joined.kind !== "joined") return;

    const acquired = await store.acquireLease({
      work_id: joined.work.work_id,
      worker_id: "worker-a",
      lease_duration_ms: 30_000,
      now_ms: 2_000,
    });
    expect(acquired.kind).toBe("acquired");
    if (acquired.kind !== "acquired") return;
    expect(acquired.work.lease_epoch).toBe(1);

    const preparing = await store.transitionToPreparing({
      work_id: joined.work.work_id,
      expected_lease_epoch: 1,
      now_ms: 2_500,
    });
    expect(preparing.state).toBe("preparing");

    const reclaimed = await store.acquireLease({
      work_id: joined.work.work_id,
      worker_id: "worker-b",
      lease_duration_ms: 30_000,
      now_ms: 40_000,
    });
    expect(reclaimed.kind).toBe("reclaimed");
    if (reclaimed.kind !== "reclaimed") return;
    expect(reclaimed.work.lease_epoch).toBe(2);

    await expect(
      store.publishChildEvidence({
        work_item_id: (await store.listWorkItems(joined.work.work_id))[0]!.work_item_id,
        expected_lease_epoch: 1,
        evidence: fixtureReadinessEvidence(workKey.deployment_ids),
        now_ms: 40_500,
      }),
    ).rejects.toBeInstanceOf(SharedPreparationFencingError);
  });

  it("persists retry scheduling with CAS wake and stale wake rejection", async () => {
    const store = new InMemorySharedPreparationStore();
    const workKey = fixturePublicWorkKey();
    const joined = await store.joinPublicWork({
      order_id: "ord_retry",
      order_tenant_scope_digest: fixtureCommunityScopeDigest("community-alpha"),
      work_key: workKey,
      now_ms: 1_000,
    });
    if (joined.kind !== "joined") throw new Error("join failed");

    const lease = await store.acquireLease({
      work_id: joined.work.work_id,
      worker_id: "worker-a",
      lease_duration_ms: 30_000,
      now_ms: 2_000,
    });
    if (lease.kind !== "acquired") throw new Error("lease failed");

    await store.transitionToPreparing({
      work_id: joined.work.work_id,
      expected_lease_epoch: lease.work.lease_epoch,
      now_ms: 2_500,
    });

    const failed = await store.recordRetryableFailure({
      work_id: joined.work.work_id,
      expected_lease_epoch: lease.work.lease_epoch,
      next_attempt_at_unix_ms: 10_000,
      retry_deadline_unix_ms: 604_800_000,
      failure: { code: "dependency_unavailable", reason: "fixture capacity" },
      now_ms: 3_000,
    });
    expect(failed.state).toBe("retry_wait");
    expect(failed.attempt).toBe(1);
    expect(failed.lease_until_unix_ms).toBeUndefined();

    // Cannot bypass wake / next_attempt_at by transitioning from retry_wait.
    await expect(
      store.transitionToPreparing({
        work_id: joined.work.work_id,
        expected_lease_epoch: lease.work.lease_epoch,
        now_ms: 3_500,
      }),
    ).rejects.toBeInstanceOf(SharedPreparationStateError);

    const staleWake = await store.wakeRetryWait({
      work_id: joined.work.work_id,
      expected_attempt: 0,
      now_ms: 10_000,
    });
    expect(staleWake.kind).toBe("stale_wake");

    const earlyWake = await store.wakeRetryWait({
      work_id: joined.work.work_id,
      expected_attempt: failed.attempt,
      now_ms: 9_999,
    });
    expect(earlyWake.kind).toBe("stale_wake");

    const woke = await store.wakeRetryWait({
      work_id: joined.work.work_id,
      expected_attempt: failed.attempt,
      now_ms: 10_000,
    });
    expect(woke.kind).toBe("woke");
    if (woke.kind !== "woke") return;
    expect(woke.work.state).toBe("queued");

    // After wake, preparing is allowed from queued.
    const lease2 = await store.acquireLease({
      work_id: joined.work.work_id,
      worker_id: "worker-b",
      lease_duration_ms: 30_000,
      now_ms: 10_500,
    });
    expect(lease2.kind === "acquired" || lease2.kind === "reclaimed").toBe(true);
    if (lease2.kind !== "acquired" && lease2.kind !== "reclaimed") return;
    const preparing = await store.transitionToPreparing({
      work_id: joined.work.work_id,
      expected_lease_epoch: lease2.work.lease_epoch,
      now_ms: 11_000,
    });
    expect(preparing.state).toBe("preparing");
  });

  it("allows only one winner under contested lease reclaim", async () => {
    const store = new InMemorySharedPreparationStore();
    const workKey = fixturePublicWorkKey();
    const joined = await store.joinPublicWork({
      order_id: "ord_lease_race",
      order_tenant_scope_digest: fixtureCommunityScopeDigest("community-alpha"),
      work_key: workKey,
      now_ms: 1_000,
    });
    if (joined.kind !== "joined") throw new Error("join failed");

    const first = await store.acquireLease({
      work_id: joined.work.work_id,
      worker_id: "worker-0",
      lease_duration_ms: 5_000,
      now_ms: 2_000,
    });
    expect(first.kind).toBe("acquired");
    if (first.kind !== "acquired") return;
    expect(first.work.lease_epoch).toBe(1);

    const reclaimNow = 10_000; // past lease expiry
    const results = await Promise.all(
      Array.from({ length: 50 }, (_, index) =>
        store.acquireLease({
          work_id: joined.work.work_id,
          worker_id: `worker-${index + 1}`,
          lease_duration_ms: 30_000,
          now_ms: reclaimNow,
        }),
      ),
    );

    const winners = results.filter(
      (r) => r.kind === "reclaimed" || r.kind === "acquired",
    );
    const busy = results.filter((r) => r.kind === "busy");
    expect(winners).toHaveLength(1);
    expect(busy).toHaveLength(49);
    expect(winners[0]!.kind).toBe("reclaimed");
    if (winners[0]!.kind !== "reclaimed" && winners[0]!.kind !== "acquired") return;
    expect(winners[0]!.work.lease_epoch).toBe(2);

    const after = await store.getWork(joined.work.work_id);
    expect(after?.lease_epoch).toBe(2);
  });

  it("fans subscriber transitions through shared work and abandons on zero subscribers", async () => {
    const store = new InMemorySharedPreparationStore();
    const workKey = fixturePublicWorkKey();
    const joinedA = await store.joinPublicWork({
      order_id: "ord_fan_a",
      order_tenant_scope_digest: fixtureCommunityScopeDigest("community-alpha"),
      work_key: workKey,
      now_ms: 1,
    });
    const joinedB = await store.joinPublicWork({
      order_id: "ord_fan_b",
      order_tenant_scope_digest: fixtureCommunityScopeDigest("community-alpha"),
      work_key: workKey,
      now_ms: 2,
    });
    if (joinedA.kind !== "joined" || joinedB.kind !== "joined") throw new Error("join failed");
    expect(joinedA.work.work_id).toBe(joinedB.work.work_id);

    await store.detachSubscriber({
      order_id: "ord_fan_a",
      work_id: joinedA.work.work_id,
      now_ms: 10,
    });
    const mid = await store.getWork(joinedA.work.work_id);
    expect(mid?.state).toBe("queued");

    const abandoned = await store.detachSubscriber({
      order_id: "ord_fan_b",
      work_id: joinedA.work.work_id,
      now_ms: 11,
    });
    expect(abandoned.kind).toBe("detached");
    expect(abandoned.kind === "detached" ? abandoned.work?.state : undefined).toBe("abandoned");
  });

  it("supersedes active generation atomically before inserting successor", async () => {
    const store = new InMemorySharedPreparationStore();
    const workKey = fixturePublicWorkKey();
    const digest = fixtureWorkKeyDigest(workKey);
    const first = await store.joinPublicWork({
      order_id: "ord_gen_1",
      order_tenant_scope_digest: fixtureCommunityScopeDigest("community-alpha"),
      work_key: workKey,
      now_ms: 1,
    });
    if (first.kind !== "joined") throw new Error("join failed");

    const superseded = await store.supersedeActiveGeneration({
      work_key_digest: digest,
      now_ms: 2,
    });
    expect(superseded?.state).toBe("superseded");

    const second = await store.joinPublicWork({
      order_id: "ord_gen_2",
      order_tenant_scope_digest: fixtureCommunityScopeDigest("community-alpha"),
      work_key: workKey,
      now_ms: 3,
    });
    if (second.kind !== "joined") throw new Error("join failed");
    expect(second.work.generation).toBe(2);
    expect(second.created).toBe(true);
    expect(countActiveRows(store, digest)).toBe(1);
  });

  it("becomes ready only when all child deployments publish qualifying evidence", async () => {
    const store = new InMemorySharedPreparationStore();
    const workKey = fixturePublicWorkKey({ capability: "collection_identity.v1" });
    const joined = await store.joinPublicWork({
      order_id: "ord_ready",
      order_tenant_scope_digest: fixtureCommunityScopeDigest("community-alpha"),
      work_key: workKey,
      now_ms: 1,
    });
    if (joined.kind !== "joined") throw new Error("join failed");

    const lease = await store.acquireLease({
      work_id: joined.work.work_id,
      worker_id: "worker-a",
      lease_duration_ms: 30_000,
      now_ms: 2,
    });
    if (lease.kind !== "acquired") throw new Error("lease failed");
    await store.transitionToPreparing({
      work_id: joined.work.work_id,
      expected_lease_epoch: lease.work.lease_epoch,
      now_ms: 3,
    });

    const items = await store.listWorkItems(joined.work.work_id);
    const evidence = fixtureReadinessEvidence(workKey.deployment_ids);
    for (const item of items) {
      await store.publishChildEvidence({
        work_item_id: item.work_item_id,
        expected_lease_epoch: lease.work.lease_epoch,
        evidence,
        now_ms: 4,
      });
    }

    const pending = await store.finalizeReadyIfQualified({
      work_id: joined.work.work_id,
      expected_lease_epoch: lease.work.lease_epoch,
      readiness_evidence: evidence,
      now_ms: 5,
    });
    expect(pending.kind).toBe("ready");
    expect(pending.kind === "ready" ? pending.work.state : undefined).toBe("ready");
    expect(pending.kind === "ready" ? pending.work.readiness_evidence?.producer : undefined).toBe(
      "sonar-api.fixture",
    );
  });

  it("rejects restricted capabilities at work-key construction", () => {
    const candidate = loadEvmFixtureCandidate();
    expect(() =>
      buildPublicWorkKeyMaterial({
        capability: "discord_role_snapshot.v1",
        capability_version: "v1",
        collection_id: candidate.identity.collection_id,
        deployment_ids: candidate.identity.deployments.map((d) => d.deployment_id),
        finality_policies: candidate.finality_policies,
        source_identity: {
          schema_version: 1,
          producer: "shadow-audit.fixture",
          upstream_evidence_source: "shadow-audit.restricted",
        },
        readiness_policy_version: "gate-leak-public-prep.v1",
        adapter_version: "shadow-audit.v1",
      }),
    ).toThrow(/non-public capability/);
    expect(PUBLIC_PREP_CAPABILITIES).toEqual(["collection_identity.v1", "ownership_index.v1"]);
  });

  it("canonicalizes deployment_ids and finality_policies before hashing", () => {
    const candidate = loadEvmFixtureCandidate();
    const a = candidate.identity.deployments[0]!.deployment_id;
    const b = {
      algorithm: "sha-256" as const,
      domain: "collection.deployment",
      major_version: 1,
      digest: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    };
    const policyEvm = candidate.finality_policies[0]!;
    const policySol = {
      schema_version: 1 as const,
      network: {
        schema_version: 1 as const,
        network_namespace: "solana" as const,
        network_reference: "mainnet-beta",
      },
      finality_policy_version: "solana-confirmed.v1",
    };
    const forward = buildPublicWorkKeyMaterial({
      capability: "ownership_index.v1",
      capability_version: "v1",
      collection_id: candidate.identity.collection_id,
      deployment_ids: [b, a],
      finality_policies: [policySol, policyEvm],
      source_identity: {
        schema_version: 1,
        producer: "sonar-api.fixture",
        upstream_evidence_source: "sonar.public-capability.v1",
      },
      readiness_policy_version: "gate-leak-public-prep.v1",
      adapter_version: "sonar-kitchen.v1",
    });
    const reverse = buildPublicWorkKeyMaterial({
      capability: "ownership_index.v1",
      capability_version: "v1",
      collection_id: candidate.identity.collection_id,
      deployment_ids: [a, b],
      finality_policies: [policyEvm, policySol],
      source_identity: {
        schema_version: 1,
        producer: "sonar-api.fixture",
        upstream_evidence_source: "sonar.public-capability.v1",
      },
      readiness_policy_version: "gate-leak-public-prep.v1",
      adapter_version: "sonar-kitchen.v1",
    });
    expect(digestPublicWorkKey(forward)).toBe(digestPublicWorkKey(reverse));
    expect(forward.deployment_ids.map((d) => d.digest)).toEqual(
      reverse.deployment_ids.map((d) => d.digest),
    );
    expect(forward.finality_policies.map((p) => p.network.network_namespace)).toEqual(
      reverse.finality_policies.map((p) => p.network.network_namespace),
    );
  });

  it("rejects child evidence and finalize outside preparing", async () => {
    const store = new InMemorySharedPreparationStore();
    const workKey = fixturePublicWorkKey();
    const joined = await store.joinPublicWork({
      order_id: "ord_state",
      order_tenant_scope_digest: fixtureCommunityScopeDigest("community-alpha"),
      work_key: workKey,
      now_ms: 1,
    });
    if (joined.kind !== "joined") throw new Error("join failed");
    const lease = await store.acquireLease({
      work_id: joined.work.work_id,
      worker_id: "w",
      lease_duration_ms: 30_000,
      now_ms: 2,
    });
    if (lease.kind !== "acquired") throw new Error("lease failed");
    const item = (await store.listWorkItems(joined.work.work_id))[0]!;
    await expect(
      store.publishChildEvidence({
        work_item_id: item.work_item_id,
        expected_lease_epoch: lease.work.lease_epoch,
        evidence: fixtureReadinessEvidence(workKey.deployment_ids),
        now_ms: 3,
      }),
    ).rejects.toBeInstanceOf(SharedPreparationStateError);
    await expect(
      store.finalizeReadyIfQualified({
        work_id: joined.work.work_id,
        expected_lease_epoch: lease.work.lease_epoch,
        readiness_evidence: fixtureReadinessEvidence(workKey.deployment_ids),
        now_ms: 4,
      }),
    ).rejects.toBeInstanceOf(SharedPreparationStateError);
  });

  it("survives concurrent detach and join without abandoning an active subscriber", async () => {
    const store = new InMemorySharedPreparationStore();
    const workKey = fixturePublicWorkKey();
    const first = await store.joinPublicWork({
      order_id: "ord_race_a",
      order_tenant_scope_digest: fixtureCommunityScopeDigest("community-alpha"),
      work_key: workKey,
      now_ms: 1,
    });
    if (first.kind !== "joined") throw new Error("join failed");

    const rounds = await Promise.all(
      Array.from({ length: 40 }, async (_, index) => {
        if (index % 2 === 0) {
          return store.detachSubscriber({
            order_id: "ord_race_a",
            work_id: first.work.work_id,
            now_ms: 10 + index,
          });
        }
        return store.joinPublicWork({
          order_id: `ord_race_b_${index}`,
          order_tenant_scope_digest: fixtureCommunityScopeDigest("community-alpha"),
          work_key: workKey,
          now_ms: 10 + index,
        });
      }),
    );

    expect(rounds.length).toBe(40);
    const digest = fixtureWorkKeyDigest(workKey);
    const active = countActiveRows(store, digest);
    // Either still active with ≥1 subscriber, or abandoned after last detach — never two actives.
    expect(active).toBeLessThanOrEqual(1);
    if (active === 1) {
      const work = await store.getWork(first.work.work_id);
      const links = work ? await store.listActiveLinks(work.work_id) : [];
      // If the original row is still active it must have links; successor gens are ok too.
      const surviving = (await store.getWork(first.work.work_id))?.state;
      if (surviving && ["queued", "preparing", "retry_wait"].includes(surviving)) {
        expect(links.length).toBeGreaterThan(0);
      }
    }
  });
});

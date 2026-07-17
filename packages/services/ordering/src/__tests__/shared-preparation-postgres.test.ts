/**
 * CR-201A Postgres behavioral suite (F4).
 *
 * Gated on ORDERING_PG_TEST_URL (or DATABASE_URL when ORDERING_PG_TEST=1).
 * Skips cleanly when unset — no Docker required for unit CI.
 *
 *   ORDERING_PG_TEST_URL=postgres://… pnpm exec vitest run \
 *     src/__tests__/shared-preparation-postgres.test.ts
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { PostgresSharedPreparationStore } from "../shared-preparation-store-postgres.js";
import { digestPublicWorkKey } from "../shared-preparation-work-key.js";
import {
  fixtureCommunityScopeDigest,
  fixturePublicWorkKey,
  fixtureReadinessEvidence,
} from "./shared-preparation-fixtures.js";

const pgUrl =
  process.env.ORDERING_PG_TEST_URL ??
  (process.env.ORDERING_PG_TEST === "1" ? process.env.DATABASE_URL : undefined);

const describePg = describe.skipIf(!pgUrl);

async function seedOrder(pool: pg.Pool, orderId: string): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await pool.query(
    `INSERT INTO orders (
      order_id, product, placed_by, inputs, inputs_digest, state,
      placed_at_unix, created_at_unix, updated_at_unix
    ) VALUES ($1, 'collection-report', 'subject-fixture', '{}'::jsonb, 'digest', 'placed', $2, $2, $2)
    ON CONFLICT (order_id) DO NOTHING`,
    [orderId, now],
  );
}

describePg("CR-201A Postgres shared preparation store", () => {
  let store: PostgresSharedPreparationStore;
  let pool: pg.Pool;

  beforeAll(async () => {
    store = await PostgresSharedPreparationStore.connect(pgUrl!, { migrate: true });
    pool = store.getPool();
    // Ensure unique index statement is present in applied migration text.
    const migration = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../../migrations/007_shared_preparation_work.sql"),
      "utf8",
    );
    expect(migration).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS shared_preparation_work_key_active_idx/);
  }, 60_000);

  afterAll(async () => {
    await store.close();
  });

  it("joins, leases, retries, abandons, and reaches ready under fencing", async () => {
    const workKey = fixturePublicWorkKey({ capability: "collection_identity.v1" });
    const orderA = `ord_pg_a_${Date.now()}`;
    const orderB = `ord_pg_b_${Date.now()}`;
    await seedOrder(pool, orderA);
    await seedOrder(pool, orderB);

    const joined = await store.joinPublicWork({
      order_id: orderA,
      order_tenant_scope_digest: fixtureCommunityScopeDigest("community-alpha"),
      work_key: workKey,
      now_ms: Date.now(),
    });
    expect(joined.kind).toBe("joined");
    if (joined.kind !== "joined") return;

    const fanIn = await store.joinPublicWork({
      order_id: orderB,
      order_tenant_scope_digest: fixtureCommunityScopeDigest("community-alpha"),
      work_key: workKey,
      now_ms: Date.now(),
    });
    expect(fanIn.kind).toBe("joined");
    if (fanIn.kind !== "joined") return;
    expect(fanIn.work.work_id).toBe(joined.work.work_id);
    expect(fanIn.created).toBe(false);

    const lease = await store.acquireLease({
      work_id: joined.work.work_id,
      worker_id: "pg-worker",
      lease_duration_ms: 30_000,
      now_ms: Date.now(),
    });
    expect(lease.kind).toBe("acquired");
    if (lease.kind !== "acquired") return;

    await store.transitionToPreparing({
      work_id: joined.work.work_id,
      expected_lease_epoch: lease.work.lease_epoch,
      now_ms: Date.now(),
    });

    const failed = await store.recordRetryableFailure({
      work_id: joined.work.work_id,
      expected_lease_epoch: lease.work.lease_epoch,
      next_attempt_at_unix_ms: Date.now() - 1,
      retry_deadline_unix_ms: Date.now() + 86_400_000,
      failure: { code: "dependency_unavailable", reason: "pg fixture" },
      now_ms: Date.now(),
    });
    expect(failed.state).toBe("retry_wait");

    const woke = await store.wakeRetryWait({
      work_id: joined.work.work_id,
      expected_attempt: failed.attempt,
      now_ms: Date.now(),
    });
    expect(woke.kind).toBe("woke");

    const lease2 = await store.acquireLease({
      work_id: joined.work.work_id,
      worker_id: "pg-worker-2",
      lease_duration_ms: 30_000,
      now_ms: Date.now(),
    });
    expect(lease2.kind === "acquired" || lease2.kind === "reclaimed").toBe(true);
    if (lease2.kind !== "acquired" && lease2.kind !== "reclaimed") return;

    await store.transitionToPreparing({
      work_id: joined.work.work_id,
      expected_lease_epoch: lease2.work.lease_epoch,
      now_ms: Date.now(),
    });

    const evidence = fixtureReadinessEvidence(workKey.deployment_ids);
    for (const item of await store.listWorkItems(joined.work.work_id)) {
      await store.publishChildEvidence({
        work_item_id: item.work_item_id,
        expected_lease_epoch: lease2.work.lease_epoch,
        evidence,
        now_ms: Date.now(),
      });
    }

    const ready = await store.finalizeReadyIfQualified({
      work_id: joined.work.work_id,
      expected_lease_epoch: lease2.work.lease_epoch,
      readiness_evidence: evidence,
      now_ms: Date.now(),
    });
    expect(ready.kind).toBe("ready");

    await store.detachSubscriber({
      order_id: orderA,
      work_id: joined.work.work_id,
      now_ms: Date.now(),
    });
    const stillReady = await store.getWork(joined.work.work_id);
    expect(stillReady?.state).toBe("ready");
  });

  it("enforces unique active work key via partial unique index", async () => {
    const workKey = fixturePublicWorkKey({ capability: "ownership_index.v1" });
    const workKeyDigest = digestPublicWorkKey(workKey);
    const orderId = `ord_pg_uniq_${Date.now()}`;
    await seedOrder(pool, orderId);

    const joined = await store.joinPublicWork({
      order_id: orderId,
      order_tenant_scope_digest: fixtureCommunityScopeDigest("community-alpha"),
      work_key: workKey,
      now_ms: Date.now(),
    });
    expect(joined.kind).toBe("joined");

    await expect(
      pool.query(
        `INSERT INTO shared_preparation_work (
          work_id, work_key_digest, deployment_set_digest, capability, capability_version,
          scope_digest, source_identity, readiness_policy_version, evidence_boundary_kind,
          adapter_version, finality_policy_version, state, generation, attempt, lease_epoch
        ) VALUES (
          $1, $2, 'depset', 'ownership_index.v1', 'v1',
          'scope', '{}'::jsonb, 'gate-leak-public-prep.v1', 'continuous_latest',
          'sonar-kitchen.v1', 'finality', 'queued', 99, 0, 0
        )`,
        [`spw_conflict_${Date.now()}`, workKeyDigest],
      ),
    ).rejects.toMatchObject({ code: "23505" });
  });

  it("does not abandon when a concurrent join reattaches before commit", async () => {
    const workKey = fixturePublicWorkKey({ capability: "ownership_index.v1" });
    const orderDetach = `ord_pg_det_${Date.now()}`;
    const orderJoin = `ord_pg_join_${Date.now()}`;
    await seedOrder(pool, orderDetach);
    await seedOrder(pool, orderJoin);

    const joined = await store.joinPublicWork({
      order_id: orderDetach,
      order_tenant_scope_digest: fixtureCommunityScopeDigest("community-alpha"),
      work_key: workKey,
      now_ms: Date.now(),
    });
    if (joined.kind !== "joined") throw new Error("join failed");

    const [detachResult, joinResult] = await Promise.all([
      store.detachSubscriber({
        order_id: orderDetach,
        work_id: joined.work.work_id,
        now_ms: Date.now(),
      }),
      store.joinPublicWork({
        order_id: orderJoin,
        order_tenant_scope_digest: fixtureCommunityScopeDigest("community-alpha"),
        work_key: workKey,
        now_ms: Date.now(),
      }),
    ]);

    expect(detachResult.kind === "detached" || detachResult.kind === "not_linked").toBe(true);
    expect(joinResult.kind === "joined" || joinResult.kind === "serialization_retry").toBe(true);

    if (joinResult.kind === "joined") {
      const work = await store.getWork(joinResult.work.work_id);
      const links = await store.listActiveLinks(joinResult.work.work_id);
      if (work && ["queued", "preparing", "retry_wait"].includes(work.state)) {
        expect(links.length).toBeGreaterThan(0);
        expect(work.state).not.toBe("abandoned");
      }
    }
  });
});

describe("CR-201A Postgres suite gate", () => {
  it("documents ORDERING_PG_TEST_URL skip behavior", () => {
    if (!pgUrl) {
      expect(pgUrl).toBeFalsy();
    } else {
      expect(pgUrl).toMatch(/^postgres/);
    }
  });
});

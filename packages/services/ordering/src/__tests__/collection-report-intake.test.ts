import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { createIntakeApp } from "../intake.js";
import { InMemoryOrderStore } from "../store.js";
import { InMemoryResolutionStore } from "../resolution-store.js";
import { CollectionResolutionService } from "../resolution-service.js";
import { createCatalogResolveProbePort } from "../catalog-resolve-probe.js";
import { createFixturePublicAuthorizationService } from "../public-authorization-service.js";
import { InMemoryAdmissionCapacityStore } from "../admission-capacity-store.js";
import { InMemorySharedPreparationStore } from "../shared-preparation-store.js";
import { createAdmissionCapacityService } from "../admission-capacity-service.js";
import { buildPublicRootWorkKeysFromResolution } from "../collection-report-admission.js";
import { createHash } from "node:crypto";
import type {
  AuthorizationScope,
  ConfirmedResolutionRecord,
} from "@freeside/collection-resolution-protocol";
import { AuthorizationDeniedError } from "@freeside/public-authorization-protocol";

const fixturesDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../protocol/collection-resolution/fixtures",
);

const confirmedFixture = JSON.parse(
  readFileSync(join(fixturesDir, "confirmed-resolution.valid.json"), "utf8"),
) as ConfirmedResolutionRecord;

const scope = JSON.parse(
  readFileSync(join(fixturesDir, "authorization-scope.valid.json"), "utf8"),
) as AuthorizationScope;

function harness(
  nowMs = Date.parse("2026-07-16T08:10:00Z"),
  opts?: { denyLease?: boolean },
) {
  const store = new InMemoryOrderStore({ now: () => nowMs });
  const resolutionStore = new InMemoryResolutionStore();
  const resolutionService = new CollectionResolutionService({
    store: resolutionStore,
    sonar: createCatalogResolveProbePort(),
    clock: { nowMs: () => nowMs },
  });
  const preparationStore = new InMemorySharedPreparationStore();
  const admissionCapacity = createAdmissionCapacityService({
    store: new InMemoryAdmissionCapacityStore({ orderStore: store, preparationStore }),
    now: () => nowMs,
  });
  const authFixture = JSON.parse(
    readFileSync(
      join(
        dirname(fileURLToPath(import.meta.url)),
        "../../../../protocol/public-authorization/fixtures/acl/projection-baseline.valid.json",
      ),
      "utf8",
    ),
  );
  const publicAuth = createFixturePublicAuthorizationService(authFixture);
  if (opts?.denyLease) {
    publicAuth.acquireLease = () => {
      throw new AuthorizationDeniedError({
        reason: "permission_revoked",
        safe_code: "forbidden",
      });
    };
  }

  const app = createIntakeApp({
    store,
    now: () => nowMs,
    resolutionService,
    resolutionStore,
    publicAuth,
    admissionCapacity,
  });

  return { app, store, resolutionStore, preparationStore };
}

function seedResolution(store: InMemoryResolutionStore, record: ConfirmedResolutionRecord) {
  const internal = store as unknown as {
    records: Map<string, ConfirmedResolutionRecord>;
  };
  internal.records.set(record.resolution_id, structuredClone(record));
}

function orderBody(clientRequestId: string, digestOverride?: string) {
  return {
    product: "collection-report",
    placed_by: "subject-alice",
    client_request_id: clientRequestId,
    authorization_scope: scope,
    inputs: {
      schema_version: 1,
      resolution_id: confirmedFixture.resolution_id,
      candidate_snapshot_digest: digestOverride
        ? {
            ...confirmedFixture.candidate_snapshot_digest,
            digest: digestOverride,
          }
        : confirmedFixture.candidate_snapshot_digest,
      community_ref: "community-alpha",
    },
  };
}

describe("CR-202 collection-report intake", () => {
  it("admits via admitOrder with compiled recipe and idempotent replay", async () => {
    const { app, store, resolutionStore } = harness();
    await seedResolution(resolutionStore, confirmedFixture);

    const first = await app.request("/v1/orders", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(orderBody("req-cr-202-a")),
    });
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as { order_id: string; replay?: boolean };
    expect(firstBody.replay).toBe(false);

    const record = await store.get(firstBody.order_id);
    expect(record?.product).toBe("collection-report");
    expect(record?.state).toBe("placed");
    const inputs = record?.inputs as {
      recipe_expansion_certificate?: { compiler_version: string; worst_case_total_nodes: number };
    };
    expect(inputs.recipe_expansion_certificate?.compiler_version).toBe("gate-leak-public.v1");
    expect(inputs.recipe_expansion_certificate?.worst_case_total_nodes).toBeLessThanOrEqual(160);

    const replay = await app.request("/v1/orders", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(orderBody("req-cr-202-a")),
    });
    expect(replay.status).toBe(200);
    const replayBody = (await replay.json()) as { order_id: string; replay?: boolean };
    expect(replayBody.order_id).toBe(firstBody.order_id);
    expect(replayBody.replay).toBe(true);
  });

  it("returns idempotency_conflict when client_request_id is reused with different body", async () => {
    const { app, resolutionStore } = harness();
    await seedResolution(resolutionStore, confirmedFixture);

    const ok = await app.request("/v1/orders", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(orderBody("req-conflict")),
    });
    expect(ok.status).toBe(200);

    const conflict = await app.request("/v1/orders", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(orderBody("req-conflict", "f".repeat(64))),
    });
    expect(conflict.status).toBe(409);
    const body = (await conflict.json()) as { code: string };
    expect(body.code).toBe("idempotency_conflict");
  });

  it("returns candidate_digest_mismatch before order create", async () => {
    const { app, resolutionStore } = harness();
    await seedResolution(resolutionStore, confirmedFixture);

    const res = await app.request("/v1/orders", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(orderBody("req-digest", "dead".repeat(16))),
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("candidate_digest_mismatch");
  });

  it("returns resolution_expired before order create", async () => {
    const expired: ConfirmedResolutionRecord = {
      ...confirmedFixture,
      expires_at: "2026-07-16T08:00:00Z",
    };
    const { app, resolutionStore } = harness(Date.parse("2026-07-16T08:20:00Z"));
    await seedResolution(resolutionStore, expired);

    const res = await app.request("/v1/orders", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(orderBody("req-expired")),
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("resolution_expired");
  });

  it("requires client_request_id", async () => {
    const { app, resolutionStore } = harness();
    await seedResolution(resolutionStore, confirmedFixture);
    const body = orderBody("ignored");
    const { client_request_id: _drop, ...without } = body;

    const res = await app.request("/v1/orders", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(without),
    });
    expect(res.status).toBe(400);
    const parsed = (await res.json()) as { code: string };
    expect(parsed.code).toBe("client_request_id_required");
  });

  it("joins all certified root work keys including ownership_index (F1)", async () => {
    const { app, resolutionStore, preparationStore } = harness();
    await seedResolution(resolutionStore, confirmedFixture);

    const res = await app.request("/v1/orders", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(orderBody("req-roots")),
    });
    expect(res.status).toBe(200);
    const { order_id } = (await res.json()) as { order_id: string };

    const rootKeys = buildPublicRootWorkKeysFromResolution(confirmedFixture);
    expect(rootKeys.map((k) => k.capability).sort()).toEqual([
      "collection_identity.v1",
      "ownership_index.v1",
    ]);

    const scopeDigest = createHash("sha256")
      .update("community:community-alpha")
      .digest("hex");
    for (const work_key of rootKeys) {
      const join = await preparationStore.joinPublicWork({
        order_id,
        order_tenant_scope_digest: scopeDigest,
        work_key,
        now_ms: Date.parse("2026-07-16T08:10:00Z"),
      });
      expect(join.kind).toBe("joined");
      if (join.kind === "joined") {
        // Already created+linked at admission — not invented on re-join.
        expect(join.created).toBe(false);
        expect(join.work.capability).toBe(work_key.capability);
      }
    }
  });

  it("maps public-auth lease denial to authorization_denied (F2)", async () => {
    const { app, resolutionStore } = harness(Date.parse("2026-07-16T08:10:00Z"), {
      denyLease: true,
    });
    await seedResolution(resolutionStore, confirmedFixture);

    const res = await app.request("/v1/orders", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(orderBody("req-auth-deny")),
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { code: string; reason?: string };
    expect(body.code).toBe("authorization_denied");
    expect(body.code).not.toBe("resolution_scope_mismatch");
    expect(body.reason).toBe("permission_revoked");
  });

  it("replays idempotent order without live resolution row (F3)", async () => {
    const { app, resolutionStore } = harness();
    await seedResolution(resolutionStore, confirmedFixture);

    const first = await app.request("/v1/orders", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(orderBody("req-gone-res")),
    });
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as { order_id: string };

    // Drop the resolution after successful admission.
    const internal = resolutionStore as unknown as {
      records: Map<string, ConfirmedResolutionRecord>;
    };
    internal.records.delete(confirmedFixture.resolution_id);

    const replay = await app.request("/v1/orders", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(orderBody("req-gone-res")),
    });
    expect(replay.status).toBe(200);
    const replayBody = (await replay.json()) as { order_id: string; replay?: boolean };
    expect(replayBody.order_id).toBe(firstBody.order_id);
    expect(replayBody.replay).toBe(true);
  });
});

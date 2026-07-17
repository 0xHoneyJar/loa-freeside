import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { Hono } from "hono";

import { mountCapabilityDemandRoutes } from "../capability-demand-http.js";
import {
  InMemoryCapabilityDemandStore,
  type CapabilityDemandRecord,
} from "../capability-demand-store.js";
import {
  OPEN_DEMAND_LIMIT_PER_SUBJECT,
  OPEN_DEMAND_TTL_MS,
} from "../capability-demand-constants.js";
import { createFixturePublicAuthorizationService } from "../public-authorization-service.js";

const fixtureDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../protocol/public-authorization/fixtures/acl",
);

function readJson(name: string): unknown {
  return JSON.parse(readFileSync(join(fixtureDir, name), "utf8"));
}

const BASE_NOW = 1_752_768_000_000;
const TOKEN = "service-secret";

function demandCreateBody(overrides: Record<string, unknown> = {}) {
  return {
    command: {
      schema_version: 1,
      deployment_set_digest: "dep-set-1",
      network_ref: "ethereum-mainnet",
      token_standard: "erc721",
      required_capability: "ownership_index.v1",
      policy_version: "policy-1",
      resolution_id: "res-1",
      ...overrides,
    },
    authorization_scope: readJson("scope-demand-create.valid.json"),
  };
}

function appHarness(now: () => number = () => BASE_NOW) {
  const auth = createFixturePublicAuthorizationService(
    readJson("projection-baseline.valid.json"),
    now,
  );
  const store = new InMemoryCapabilityDemandStore();
  const app = new Hono();
  mountCapabilityDemandRoutes(app, {
    store,
    auth,
    serviceToken: TOKEN,
    now,
  });
  return { app, store, auth };
}

async function createDemand(
  app: Hono,
  overrides: Record<string, unknown> = {},
  scopeOverride?: unknown,
) {
  const res = await app.request("/v1/capability-demands", {
    method: "POST",
    headers: {
      authorization: `Bearer ${TOKEN}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      ...demandCreateBody(overrides),
      authorization_scope: scopeOverride ?? readJson("scope-demand-create.valid.json"),
    }),
  });
  return res;
}

describe("CR-208 capability demand lifecycle", () => {
  it("creates a typed support_request row in open state without creating orders", async () => {
    const { app } = appHarness();
    const res = await createDemand(app);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      row_kind: string;
      user_status: string;
      lifecycle_state: string;
      demand_id: string;
    };
    expect(body.row_kind).toBe("support_request");
    expect(body.user_status).toBe("open");
    expect(body.lifecycle_state).toBe("open");
    expect(body.demand_id.length).toBeGreaterThan(0);
  });

  it("replays equivalent canonical keys with different transport idempotency keys", async () => {
    const { app } = appHarness();
    const scopeA = {
      ...(readJson("scope-demand-create.valid.json") as Record<string, unknown>),
      idempotency_key: "transport-a",
    };
    const scopeB = {
      ...(readJson("scope-demand-create.valid.json") as Record<string, unknown>),
      idempotency_key: "transport-b",
    };
    const first = await createDemand(app, {}, scopeA);
    const second = await createDemand(app, {}, scopeB);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    const firstBody = (await first.json()) as { demand_id: string };
    const secondBody = (await second.json()) as { demand_id: string };
    expect(firstBody.demand_id).toBe(secondBody.demand_id);
  });

  it("enforces subject open-demand quota", async () => {
    const { app } = appHarness();
    for (let i = 0; i < OPEN_DEMAND_LIMIT_PER_SUBJECT; i += 1) {
      const scope = {
        ...(readJson("scope-demand-create.valid.json") as Record<string, unknown>),
        idempotency_key: `k-${i}`,
      };
      const res = await createDemand(
        app,
        {
          deployment_set_digest: `dep-${i}`,
          resolution_id: `res-${i}`,
        },
        scope,
      );
      expect(res.status).toBe(200);
    }
    const overflow = await createDemand(
      app,
      { deployment_set_digest: "dep-overflow", resolution_id: "res-overflow" },
      {
        ...(readJson("scope-demand-create.valid.json") as Record<string, unknown>),
        idempotency_key: "overflow",
      },
    );
    expect(overflow.status).toBe(429);
    const overflowBody = (await overflow.json()) as { code: string };
    expect(overflowBody.code).toBe("demand_quota_subject");
  });

  it("expires open demand after 90 days and blocks support transition CAS", async () => {
    let now = BASE_NOW;
    const { app, store } = appHarness(() => now);
    const created = await createDemand(app);
    const createdBody = (await created.json()) as { demand_id: string };

    now = BASE_NOW + OPEN_DEMAND_TTL_MS + 1;
    const listRes = await app.request(
      "/v1/capability-demands?community_ref=community-alpha&subject_id=subject-alice",
      { headers: { authorization: `Bearer ${TOKEN}` } },
    );
    const listBody = (await listRes.json()) as {
      items: Array<{ demand_id: string; lifecycle_state: string }>;
    };
    const expired = listBody.items.find((row) => row.demand_id === createdBody.demand_id);
    expect(expired?.lifecycle_state).toBe("expired");

    const support = await app.request("/v1/capability-demands/support-events", {
      method: "POST",
      headers: {
        authorization: `Bearer ${TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        schema_version: 1,
        event_id: "evt-expired",
        required_capability: "ownership_index.v1",
        deployment_set_digest: "dep-set-1",
        network_ref: "ethereum-mainnet",
        token_standard: "erc721",
      }),
    });
    const supportBody = (await support.json()) as { transitioned: unknown[]; intents: unknown[] };
    expect(supportBody.transitioned).toHaveLength(0);
    expect(supportBody.intents).toHaveLength(0);
    expect(await store.listIntents()).toHaveLength(0);
  });

  it("runs recognized unsupported -> support demand -> capability enabled -> continuation", async () => {
    const { app, store } = appHarness();
    const created = await createDemand(app);
    const createdBody = (await created.json()) as { demand_id: string; user_status: string };
    expect(createdBody.user_status).toBe("open");

    const support = await app.request("/v1/capability-demands/support-events", {
      method: "POST",
      headers: {
        authorization: `Bearer ${TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        schema_version: 1,
        event_id: "evt-1",
        required_capability: "ownership_index.v1",
        deployment_set_digest: "dep-set-1",
        network_ref: "ethereum-mainnet",
        token_standard: "erc721",
      }),
    });
    expect(support.status).toBe(200);
    const supportBody = (await support.json()) as {
      replay: boolean;
      transitioned: Array<{ demand_id: string; user_status: string; lifecycle_state: string }>;
      intents: Array<{ kind: string; intent_id: string }>;
    };
    expect(supportBody.replay).toBe(false);
    expect(supportBody.transitioned).toHaveLength(1);
    expect(supportBody.transitioned[0]?.demand_id).toBe(createdBody.demand_id);
    expect(supportBody.transitioned[0]?.user_status).toBe("support_ready");
    expect(supportBody.transitioned[0]?.lifecycle_state).toBe("notified");
    expect(supportBody.intents).toHaveLength(1);
    expect(supportBody.intents[0]?.kind).toBe("capability_demand.supported");

    const duplicate = await app.request("/v1/capability-demands/support-events", {
      method: "POST",
      headers: {
        authorization: `Bearer ${TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        schema_version: 1,
        event_id: "evt-1",
        required_capability: "ownership_index.v1",
        deployment_set_digest: "dep-set-1",
        network_ref: "ethereum-mainnet",
        token_standard: "erc721",
      }),
    });
    const dupBody = (await duplicate.json()) as { replay: boolean; intents: unknown[] };
    expect(dupBody.replay).toBe(true);
    expect(await store.listIntents()).toHaveLength(1);
  });

  it("withdraws open demand and prevents later support intent emission", async () => {
    const { app, store } = appHarness();
    const created = await createDemand(app);
    const createdBody = (await created.json()) as { demand_id: string };

    const withdrawn = await app.request(`/v1/capability-demands/${createdBody.demand_id}`, {
      method: "DELETE",
      headers: {
        authorization: `Bearer ${TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        authorization_scope: readJson("scope-demand-withdraw.valid.json"),
      }),
    });
    expect(withdrawn.status).toBe(200);
    expect(((await withdrawn.json()) as { user_status: string }).user_status).toBe("withdrawn");

    const support = await app.request("/v1/capability-demands/support-events", {
      method: "POST",
      headers: {
        authorization: `Bearer ${TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        schema_version: 1,
        event_id: "evt-withdrawn",
        required_capability: "ownership_index.v1",
        deployment_set_digest: "dep-set-1",
        network_ref: "ethereum-mainnet",
        token_standard: "erc721",
      }),
    });
    const supportBody = (await support.json()) as { intents: unknown[] };
    expect(supportBody.intents).toHaveLength(0);
    expect(await store.listIntents()).toHaveLength(0);
  });

  it("returns aggregate triage projection grouped by network, standard, and deployment", async () => {
    const { app } = appHarness();
    await createDemand(app);
    await createDemand(app, {
      deployment_set_digest: "dep-set-2",
      resolution_id: "res-2",
    }, {
      ...(readJson("scope-demand-create.valid.json") as Record<string, unknown>),
      idempotency_key: "other-demand",
    });

    const triage = await app.request("/v1/capability-demands/triage-aggregate", {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(triage.status).toBe(200);
    const body = (await triage.json()) as {
      schema_version: number;
      buckets: Array<{ unique_open_demand_count: number; network_ref: string }>;
    };
    expect(body.schema_version).toBe(1);
    expect(body.buckets.length).toBeGreaterThanOrEqual(2);
    expect(body.buckets.every((b) => b.network_ref === "ethereum-mainnet")).toBe(true);
  });

  it("never exposes Preparing semantics on support projections", async () => {
    const record: CapabilityDemandRecord = {
      demand_id: "d-1",
      requester_subject: "subject-alice",
      community_ref: "community-alpha",
      deployment_set_digest: "dep-set-1",
      network_ref: "ethereum-mainnet",
      token_standard: "erc721",
      required_capability: "ownership_index.v1",
      policy_version: "policy-1",
      resolution_id: "res-1",
      state: "notified",
      transition_sequence: 2,
      created_at_unix_ms: BASE_NOW,
      updated_at_unix_ms: BASE_NOW,
      expires_at_unix_ms: BASE_NOW + OPEN_DEMAND_TTL_MS,
      idempotency_key: "k1",
      support_intent_id: "intent-1",
    };
    const { toSupportRequestListItem } = await import("../capability-demand-projection.js");
    const projection = toSupportRequestListItem(record);
    expect(projection.row_kind).toBe("support_request");
    expect(projection.user_status).toBe("support_ready");
    expect(JSON.stringify(projection).toLowerCase()).not.toContain("preparing");
    expect(projection).not.toHaveProperty("eta");
    expect(projection).not.toHaveProperty("queue_position");
  });
});

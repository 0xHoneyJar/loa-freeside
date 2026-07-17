import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { mountCapabilityDemandRoutes } from "../capability-demand-http.js";
import { InMemoryCapabilityDemandStore } from "../capability-demand-store.js";
import { createFixturePublicAuthorizationService } from "../public-authorization-service.js";
import { mountCollectionResolutionRoutes } from "../resolution-http.js";
import { InMemoryResolutionStore } from "../resolution-store.js";
import { CollectionResolutionService } from "../resolution-service.js";

const fixtureDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../protocol/public-authorization/fixtures/acl",
);

function readJson(name: string): unknown {
  return JSON.parse(readFileSync(join(fixtureDir, name), "utf8"));
}

const NOW = 1_752_768_000_000;
const TOKEN = "service-secret";

function authApp() {
  const auth = createFixturePublicAuthorizationService(readJson("projection-baseline.valid.json"), () => NOW);
  const app = new Hono();
  mountCapabilityDemandRoutes(app, {
    store: new InMemoryCapabilityDemandStore(),
    auth,
    serviceToken: TOKEN,
    now: () => NOW,
  });
  return app;
}

describe("CR-007A public authorization HTTP", () => {
  it("denies capability-demand create without service bearer", async () => {
    const res = await authApp().request("/v1/capability-demands", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        command: {
          schema_version: 1,
          deployment_set_digest: "dep-set-1",
          network_ref: "ethereum-mainnet",
          token_standard: "erc721",
          required_capability: "ownership_index.v1",
          policy_version: "policy-1",
          resolution_id: "res-1",
        },
        authorization_scope: readJson("scope-demand-create.valid.json"),
      }),
    });
    expect(res.status).toBe(401);
  });

  it("creates capability demand for authorized subject", async () => {
    const res = await authApp().request("/v1/capability-demands", {
      method: "POST",
      headers: {
        authorization: `Bearer ${TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        command: {
          schema_version: 1,
          deployment_set_digest: "dep-set-1",
          network_ref: "ethereum-mainnet",
          token_standard: "erc721",
          required_capability: "ownership_index.v1",
          policy_version: "policy-1",
          resolution_id: "res-1",
        },
        authorization_scope: readJson("scope-demand-create.valid.json"),
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { demand_id: string; lifecycle_state: string };
    expect(body.demand_id.length).toBeGreaterThan(0);
    expect(body.lifecycle_state).toBe("open");
  });

  it("denies cross-community scope tampering on resolution create", async () => {
    const auth = createFixturePublicAuthorizationService(readJson("projection-baseline.valid.json"), () => NOW);
    const store = new InMemoryResolutionStore();
    const sonar = {
      resolveProbe: async () => ({
        capability_snapshot_version: {
          schema_version: 1 as const,
          registry_epoch: 1,
          registry_sequence: 1,
        },
        candidates: [],
        diagnostics: {
          schema_version: 1 as const,
          searched: [],
          timed_out: [],
          unavailable: [],
        },
      }),
    };
    const service = new CollectionResolutionService({ store, sonar });
    const app = new Hono();
    mountCollectionResolutionRoutes(app, {
      store,
      sonar,
      service,
      serviceToken: TOKEN,
      auth,
    });

    const scope = readJson("scope-report-create.valid.json") as Record<string, unknown>;
    const res = await app.request("/v1/collection-resolutions", {
      method: "POST",
      headers: {
        authorization: `Bearer ${TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        command: {
          schema_version: 1,
          identifier: "0xabc",
          environment: "mainnet",
          report_type: "gate_leak",
          report_version: "1",
          community_ref: "community-beta",
          idempotency_key: "k1",
        },
        authorization_scope: scope,
      }),
    });
    expect(res.status).toBe(403);
  });

  it("replays equivalent capability demand idempotency keys", async () => {
    const app = authApp();
    const body = {
      command: {
        schema_version: 1,
        deployment_set_digest: "dep-set-1",
        network_ref: "ethereum-mainnet",
        token_standard: "erc721",
        required_capability: "ownership_index.v1",
        policy_version: "policy-1",
        resolution_id: "res-1",
      },
      authorization_scope: readJson("scope-demand-create.valid.json"),
    };
    const headers = {
      authorization: `Bearer ${TOKEN}`,
      "content-type": "application/json",
    };
    const first = await app.request("/v1/capability-demands", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    const second = await app.request("/v1/capability-demands", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    const firstBody = (await first.json()) as { demand_id: string };
    const secondBody = (await second.json()) as { demand_id: string };
    expect(firstBody.demand_id).toBe(secondBody.demand_id);
  });
});

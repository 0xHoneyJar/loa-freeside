import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AuthorizationScope, ResolutionCreateCommand } from "@freeside/collection-resolution-protocol";
import { createCatalogResolveProbePort } from "../catalog-resolve-probe.js";
import { mountCollectionResolutionRoutes } from "../resolution-http.js";
import { InMemoryResolutionStore } from "../resolution-store.js";

const fixturesDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../protocol/collection-resolution/fixtures",
);

const createCommand = JSON.parse(
  readFileSync(join(fixturesDir, "create-command.valid.json"), "utf8"),
) as ResolutionCreateCommand;
const scope = JSON.parse(
  readFileSync(join(fixturesDir, "authorization-scope.valid.json"), "utf8"),
) as AuthorizationScope;

function app(token?: string) {
  const hono = new Hono();
  mountCollectionResolutionRoutes(hono, {
    store: new InMemoryResolutionStore(),
    sonar: createCatalogResolveProbePort(),
    serviceToken: token,
  });
  return hono;
}

describe("collection-resolutions HTTP", () => {
  it("creates a projection for a known address", async () => {
    const res = await app().request("/v1/collection-resolutions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        command: {
          ...createCommand,
          identifier: "0xED5AF388653567Af2F388E6224dC7C4b3241C544",
        },
        authorization_scope: scope,
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      candidates: Array<{ identity: { name: string } }>;
      candidate_snapshot_digest: { digest: string };
    };
    expect(body.candidates[0]?.identity.name).toBe("Azuki");
    expect(body.candidate_snapshot_digest.digest).toMatch(/^[a-f0-9]{64}$/);
  });

  it("requires bearer when token configured", async () => {
    const unauth = await app("secret").request("/v1/collection-resolutions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ command: createCommand, authorization_scope: scope }),
    });
    expect(unauth.status).toBe(401);

    const ok = await app("secret").request("/v1/collection-resolutions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer secret",
      },
      body: JSON.stringify({ command: createCommand, authorization_scope: scope }),
    });
    expect(ok.status).toBe(200);
  });
});

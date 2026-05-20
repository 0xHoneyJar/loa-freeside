/**
 * Integration test · GET /internal/freeside.json (cycle-049 S3 · FR-2/FR-3).
 *
 * In-process via Hono `app.request()` — no listening socket. OPERATOR_API_KEY
 * is set BEFORE the dynamic import of app.ts so auth.ts captures it at module
 * load (ESM imports hoist — a plain top-level assignment would run too late).
 */

process.env.OPERATOR_API_KEY = "test-operator-key";

import { test } from "node:test";
import assert from "node:assert/strict";

const app = (await import("../src/app.js")).default;

test("GET /internal/freeside.json · 401 without an operator token", async () => {
  const res = await app.request("/internal/freeside.json");
  assert.equal(res.status, 401);
  const body = await res.json();
  assert.equal(body.error, "unauthorized");
});

test("GET /internal/freeside.json · 401 with a wrong token", async () => {
  const res = await app.request("/internal/freeside.json", {
    headers: { Authorization: "Bearer not-the-key" },
  });
  assert.equal(res.status, 401);
});

test("GET /internal/freeside.json · 200 + a valid FreesideManifest with the operator token", async () => {
  const res = await app.request("/internal/freeside.json", {
    headers: { Authorization: "Bearer test-operator-key" },
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.version, 2);
  assert.equal(body.scope, "internal");
  assert.equal(typeof body.generated_at, "string");
  assert.ok(Array.isArray(body.modules));
});

test("GET /internal/freeside.json · aggregates freeside-score with its belts; skip-not-crash on modules that fail to load", async () => {
  const res = await app.request("/internal/freeside.json", {
    headers: { Authorization: "Bearer test-operator-key" },
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  // registry.yaml carries 6 remote (beacon_url-only) modules + freeside-score
  // (in-repo fixture). The 6 remote ones fail to load and are skipped — the
  // route still returns 200 with the one good module (SDD §5.1 / §6.1).
  const score = body.modules.find((m: { slug: string }) => m.slug === "freeside-score");
  assert.ok(score, "freeside-score must be present in the manifest");
  assert.equal(score.produces.length, 3);
  assert.equal(score.consumes.length, 1);
  assert.equal(score.consumes[0].from, "freeside-sonar");
  assert.equal(score.capabilities.tools.length, 6);
  assert.equal(score.visibility, "internal");
});

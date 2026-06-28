/**
 * END-TO-END meter for the BEACON federation security keystone (#378, no-registry-public-leak).
 *
 * The unit layers are already pinned: tenant-policy.test.ts proves gateway-visibility is never derived from
 * registry-visibility (fails closed to internal), and registry-membership.test.ts proves source-visibility is
 * carried as PROVENANCE, not policy. What was NOT pinned — and what the claim's "end-to-end" demands — is the
 * actual served surface: a request to `/.well-known/federation.json` must expose ONLY gateway-public tenants,
 * so registry-visibility can never promote a cell onto the auth-free public discovery surface. (Surfaced as a
 * chronic gap by the Refusal's worldline: asserted across the codebase, never exercised at the endpoint.)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import app from "../src/app.js";
import { TENANTS } from "../src/tenants.js";

const publicManifestSlugs = async (): Promise<string[]> => {
  const res = await app.request("/.well-known/federation.json");
  assert.equal(res.status, 200, "the public discovery surface must be reachable");
  const manifest = (await res.json()) as { tenants: Array<{ slug: string }> };
  return manifest.tenants.map((t) => t.slug).sort();
};

test("GET /.well-known/federation.json serves EXACTLY the gateway-public tenants — no leak, no omission (#378)", async () => {
  const served = await publicManifestSlugs();
  const gatewayPublic = TENANTS.filter((t) => t.visibility === "public").map((t) => t.slug).sort();
  // EXACT equality is the keystone end-to-end: every served member is gateway-public (no registry-visibility
  // leak), and every gateway-public member is served (no silent omission). The endpoint filter is honest.
  assert.deepEqual(served, gatewayPublic, "the public manifest must equal the gateway-public set exactly");
});

test("the registry-public / gateway-internal cell `score` never reaches the PUBLIC manifest (the keystone scenario)", async () => {
  // `score` is registry-public (it exists + is visible in the freeside registry) yet gateway-internal (its
  // gateway policy is internal/api-key — see tenant-policy.test.ts). It is the exact "can registry-visibility
  // promote a cell into the PUBLIC manifest?" question. The answer must be NO.
  const score = TENANTS.find((t) => t.slug === "score");
  assert.equal(score?.visibility, "internal", "fixture guard: `score` must be gateway-internal for this keystone to mean anything");
  const served = await publicManifestSlugs();
  assert.ok(!served.includes("score"), "`score` (registry-public, gateway-internal) LEAKED into the public federation manifest");
  assert.ok(served.length > 0, "positive control: gateway-public cells ARE served (the endpoint is not trivially empty)");
});

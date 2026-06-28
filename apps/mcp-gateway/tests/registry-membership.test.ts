/**
 * Meter for registry-membership (BEACON federation T1 / AC-1).
 * Pure derivation — no loader, no filesystem.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveMembers, type RegistryModuleView } from "../src/registry-membership.js";

const fixture: Record<string, RegistryModuleView> = {
  // deployed + https → member
  "activities-api": {
    visibility: "public",
    beacon_url: "https://activities.0xhoneyjar.xyz/.well-known/beacon.json",
    deployment_url: "https://activities-api-production.up.railway.app",
    runtime_state: "deployed",
  },
  // deployed, registry-public, trailing slash → member (normalized)
  "score-api": {
    visibility: "public",
    beacon_url: null,
    deployment_url: "https://score-api-production.up.railway.app/",
    runtime_state: "deployed",
  },
  // not-built + null deployment → excluded
  "ledger-api": {
    visibility: "internal",
    beacon_url: null,
    deployment_url: null,
    runtime_state: "not-built",
  },
  // scaffolded → excluded
  "billing-api": {
    visibility: "internal",
    beacon_url: null,
    deployment_url: null,
    runtime_state: "scaffolded",
  },
  // missing runtime_state → excluded (no honest deploy signal)
  "ghost-api": {
    visibility: "public",
    beacon_url: null,
    deployment_url: "https://ghost.up.railway.app",
  },
  // http (not https) → excluded (gateway never proxies plaintext)
  "plain-api": {
    visibility: "public",
    beacon_url: null,
    deployment_url: "http://plain.up.railway.app",
    runtime_state: "deployed",
  },
};

test("deriveMembers: only deployed cells with an https upstream become members (sorted)", () => {
  const members = deriveMembers(fixture);
  assert.deepEqual(
    members.map((m) => m.slug),
    ["activities-api", "score-api"],
  );
});

test("deriveMembers: normalizes the trailing slash off the upstream", () => {
  const score = deriveMembers(fixture).find((m) => m.slug === "score-api");
  assert.equal(score?.upstream, "https://score-api-production.up.railway.app");
});

test("deriveMembers: excludes not-built, scaffolded, stateless, and plaintext cells", () => {
  const slugs = deriveMembers(fixture).map((m) => m.slug);
  for (const excluded of ["ledger-api", "billing-api", "ghost-api", "plain-api"]) {
    assert.ok(!slugs.includes(excluded), `${excluded} must not be a member`);
  }
});

test("deriveMembers: carries registry source-visibility for provenance, not as policy", () => {
  const score = deriveMembers(fixture).find((m) => m.slug === "score-api");
  // score is registry-PUBLIC here; the gateway's internal policy is decided
  // elsewhere (tenant-policy.ts). Membership must not leak policy intent.
  assert.equal(score?.sourceVisibility, "public");
});

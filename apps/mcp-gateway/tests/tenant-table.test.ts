/**
 * Meter for the JOIN (BEACON federation T3 / AC-3) + the end-to-end security keystone.
 * Pure — buildTenants over fixtures, no I/O.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTenants } from "../src/tenant-table.js";
import type { RegistryMember } from "../src/registry-membership.js";
import { GATEWAY_NATIVE_TENANTS } from "../src/tenant-policy.js";

const scoreApi: RegistryMember = {
  slug: "score-api",
  upstream: "https://score-api-production.up.railway.app",
  sourceVisibility: "public",
  beaconUrl: null,
};

test("buildTenants JOINs gateway-native + registry members (RAW_TENANTS existence list replaced)", () => {
  const tenants = buildTenants([scoreApi], GATEWAY_NATIVE_TENANTS);
  const slugs = tenants.map((t) => t.slug);
  assert.ok(slugs.includes("codex"), "gateway-native codex present");
  assert.ok(slugs.includes("score"), "score-api routed to gateway slug `score`");
  const score = tenants.find((t) => t.slug === "score");
  assert.equal(score?.upstream, "https://score-api-production.up.railway.app");
  assert.equal(score?.visibility, "internal"); // gateway policy — NOT registry-public
  assert.equal(score?.access, "api-key");
});

// THE SECURITY KEYSTONE end-to-end — a registry-public cell must never become gateway-public
// through the join. This is the precise `public-leak` guard (registry-public ↛ public manifest).
test("registry-public member with no gateway policy → gateway-visibility INTERNAL (registry-public leak guard)", () => {
  const newPublicCell: RegistryMember = {
    slug: "shiny-new-cell",
    upstream: "https://shiny.up.railway.app",
    sourceVisibility: "public", // registry says PUBLIC …
    beaconUrl: null,
  };
  const t = buildTenants([newPublicCell], []).find((x) => x.slug === "shiny-new-cell");
  // … yet the gateway fails it closed: registry-visibility never promotes gateway-visibility.
  assert.equal(t?.visibility, "internal", "a registry-public cell must NOT reach the public federation manifest");
  assert.equal(t?.access, "api-key");
});

test("gateway-native wins on slug collision — a building cannot shadow codex", () => {
  const fakeCodex: RegistryMember = {
    slug: "codex",
    upstream: "https://evil.example",
    sourceVisibility: "public",
    beaconUrl: null,
  };
  const codex = buildTenants([fakeCodex], GATEWAY_NATIVE_TENANTS).filter((t) => t.slug === "codex");
  assert.equal(codex.length, 1);
  assert.equal(codex[0]?.upstream, "https://codex-mcp-production.up.railway.app"); // the native, not the impostor
});

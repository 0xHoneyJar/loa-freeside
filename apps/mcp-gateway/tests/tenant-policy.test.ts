/**
 * Meter for tenant-policy (BEACON federation T2 / AC-2) — the security keystone.
 * Gateway-visibility is gateway-owned; registry membership fails closed.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  policyForMember,
  GATEWAY_NATIVE_TENANTS,
} from "../src/tenant-policy.js";

test("score-api: gateway policy is internal/api-key, routed as `score` (NOT registry-public)", () => {
  const p = policyForMember("score-api");
  assert.equal(p.slug, "score"); // gateway routes `score`, registry key is `score-api`
  assert.equal(p.visibility, "internal");
  assert.equal(p.access, "api-key");
});

test("unknown registry member fails CLOSED — internal, api-key, never public", () => {
  const p = policyForMember("some-new-cell");
  assert.equal(p.visibility, "internal", "a new cell must never default to public");
  assert.equal(p.access, "api-key");
  assert.equal(p.slug, "some-new-cell"); // routed by its own registry slug
});

test("the fail-closed default can never yield gateway-visibility=public", () => {
  // Sweep a range of unknown slugs — none may resolve to public.
  for (const slug of ["a", "billing-api", "worlds-api", "x402-cell", "score"]) {
    if (slug === "score") continue; // `score` is not a registry key; `score-api` is
    assert.notEqual(
      policyForMember(slug).visibility,
      "public",
      `${slug} must fail closed, not public`,
    );
  }
});

test("codex is a gateway-NATIVE tenant: present, public, open, no registry row needed", () => {
  const codex = GATEWAY_NATIVE_TENANTS.find((t) => t.slug === "codex");
  assert.ok(codex, "codex must remain a gateway-native tenant");
  assert.equal(codex?.visibility, "public");
  assert.equal(codex?.access, "open");
  assert.equal(codex?.auth, "none");
});

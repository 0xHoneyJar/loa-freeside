import { test } from "node:test";
import assert from "node:assert/strict";
import { buildOrientationPacket, BEACON_EXIT } from "../src/orientation-packet.js";

const REG = { slug: "sonar-api", beacon_url: "https://sonar.0xhoneyjar.xyz/.well-known/beacon.json", deployment_url: "https://sonar-api-production.up.railway.app", runtime_state: "deployed" };
const BEACON = { publisher: "0xHoneyJar", is: "raw EVM collection index", is_not: ["Does NOT score", "Will NOT rank"], capabilities: ["index"], composes_with: {}, cycle_state: "active", mcp: {}, cli: {} };

test("beacon_valid → beacon fields populated, verdict valid, exit 0", () => {
  const p = buildOrientationPacket(REG, { classification: "beacon_valid", detail: "ok", target: REG.beacon_url }, BEACON);
  assert.equal(p.slug, "sonar-api");
  assert.equal(p.publisher, "0xHoneyJar");
  assert.equal(p.is_not?.length, 2);
  assert.deepEqual(p.transport, { mcp: true, cli: true });
  assert.equal(p.deployment_url, REG.deployment_url);
  assert.equal(p.verdict.beacon_valid, true);
  assert.equal(BEACON_EXIT[p.verdict.classification], 0);
});

test("beacon_dark → ALL beacon fields null, registry fields present, exit 4", () => {
  const p = buildOrientationPacket(REG, { classification: "beacon_dark", detail: "not_found", target: REG.beacon_url });
  assert.equal(p.publisher, null);
  assert.equal(p.is, null);
  assert.equal(p.is_not, null);
  assert.equal(p.capabilities, null);
  assert.equal(p.transport, null);
  assert.equal(p.runtime_state, "deployed");
  assert.equal(p.deployment_url, REG.deployment_url);
  assert.equal(p.verdict.beacon_valid, false);
  assert.equal(BEACON_EXIT[p.verdict.classification], 4);
});

test("beacon present but classification NOT valid → still null (no partial-fill)", () => {
  const p = buildOrientationPacket(REG, { classification: "beacon_invalid", detail: "invalid_beacon", target: REG.beacon_url }, BEACON);
  assert.equal(p.publisher, null);
  assert.equal(BEACON_EXIT[p.verdict.classification], 3);
});

test("missing registry runtime_state → 'unknown', never throws", () => {
  const p = buildOrientationPacket({ slug: "x", beacon_url: null }, { classification: "beacon_unreachable", detail: "transport_error", target: "" });
  assert.equal(p.runtime_state, "unknown");
  assert.equal(p.deployment_url, null);
  assert.equal(BEACON_EXIT[p.verdict.classification], 2);
});

test("void → exit 5, not reachable", () => {
  const p = buildOrientationPacket(REG, { classification: "beacon_void", detail: "off_host_redirect", target: REG.beacon_url });
  assert.equal(BEACON_EXIT[p.verdict.classification], 5);
  assert.equal(p.verdict.reachable, false);
});

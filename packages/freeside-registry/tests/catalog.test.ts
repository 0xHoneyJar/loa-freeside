import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildCatalog,
  type Registry,
  type BuildingBeaconSummary,
} from "../src/index.js";

const reg = (modules: Record<string, unknown>): Registry =>
  ({ version: 1, modules }) as unknown as Registry;

const entry = (o: Record<string, unknown> = {}) => ({
  git_url: "https://github.com/0xHoneyJar/sonar-api.git",
  beacon_url: "https://sonar.0xhoneyjar.xyz/.well-known/beacon.json",
  visibility: "public",
  owner: "0xHoneyJar",
  added: "2026-05-18",
  ...o,
});

const summary = (o: Partial<BuildingBeaconSummary> = {}): BuildingBeaconSummary => ({
  one_liner: "x",
  scope: ["a", "b"],
  is_not: ["Does NOT y"],
  capabilities: ["c"],
  status: "active",
  has_mcp: false,
  ...o,
});

test("buildCatalog: beacon present → reachable with enriched fields", () => {
  const c = buildCatalog(reg({ "sonar-api": entry() }), new Map([["sonar-api", summary({ one_liner: "indexer" })]]));
  assert.equal(c.buildings[0].reachable, true);
  assert.equal(c.buildings[0].one_liner, "indexer");
  assert.equal(c.buildings[0].has_mcp, false);
});

test("buildCatalog: beacon absent → reachable false, still listed", () => {
  const c = buildCatalog(reg({ "sonar-api": entry() }), new Map());
  assert.equal(c.buildings[0].reachable, false);
  assert.equal(c.buildings[0].one_liner, undefined);
  assert.equal(c.building_count, 1);
});

test("buildCatalog: visibility filter excludes internal from public view", () => {
  const c = buildCatalog(
    reg({ "a-api": entry(), "b-api": entry({ visibility: "internal" }) }),
    new Map(),
    ["public"],
  );
  assert.equal(c.building_count, 1);
  assert.equal(c.buildings[0].slug, "a-api");
});

test("buildCatalog: rename status carries through", () => {
  const c = buildCatalog(reg({ "storage-api": entry({ rename: "pending" }) }), new Map());
  assert.equal(c.buildings[0].rename, "pending");
});

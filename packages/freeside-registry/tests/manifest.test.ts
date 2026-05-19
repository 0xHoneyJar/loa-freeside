/**
 * Unit tests · @freeside/freeside-registry buildFreesideManifest (cycle-049 S2)
 *
 * Covers FR-2: aggregation into a FreesideManifest, the compact belt
 * projection (SDD §3.5), skip-not-crash resilience, and visibility filtering.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildFreesideManifest,
  type Registry,
  type ModuleEntry,
} from "../src/registry.js";
import { loadBeacon } from "../src/beacon-loader.js";

const moduleEntry = (over: Partial<ModuleEntry>): ModuleEntry => ({
  git_url: "https://github.com/0xHoneyJar/x.git",
  beacon_url: "https://x.0xhoneyjar.xyz/.well-known/beacon.json",
  visibility: "internal",
  owner: "0xHoneyJar",
  added: "2026-05-19",
  ...over,
});

test("buildFreesideManifest · aggregates the freeside-score fixture", () => {
  const registry: Registry = {
    version: 1,
    modules: {
      "freeside-score": moduleEntry({
        beacon_fixture: "tests/fixtures/freeside-score.beacon.yaml",
      }),
    },
  };
  const manifest = buildFreesideManifest(registry, loadBeacon);

  assert.equal(manifest.version, 2);
  assert.equal(manifest.scope, "internal");
  assert.equal(typeof manifest.generated_at, "string");
  assert.equal(manifest.modules.length, 1);

  const m = manifest.modules[0];
  assert.equal(m.slug, "freeside-score");
  assert.equal(m.one_liner.startsWith("Wallet + community scoring"), true);
  assert.equal(m.is_not.length, 3);
  assert.deepEqual(
    m.produces.map((p) => p.belt),
    ["wallet-scores", "rank-changes", "factor-metadata"],
  );
  assert.equal(m.consumes.length, 1);
  assert.equal(m.consumes[0].from, "freeside-sonar");
  assert.equal(m.consumes[0].belt, "chain-events");
  assert.equal(m.capabilities.tools.length, 6);
  assert.equal(m.visibility, "internal");

  // Compact projection (SDD §3.5): produces drops `schema`, consumes drops tag/why.
  assert.equal("schema" in m.produces[0], false);
  assert.equal("tag" in m.consumes[0], false);
  assert.equal("why" in m.consumes[0], false);
});

test("buildFreesideManifest · skips a malformed beacon, builds the rest (skip-not-crash)", () => {
  const registry: Registry = {
    version: 1,
    modules: {
      "freeside-score": moduleEntry({
        beacon_fixture: "tests/fixtures/freeside-score.beacon.yaml",
      }),
      "bad-module": moduleEntry({
        beacon_fixture: "tests/fixtures/freeside-score-malformed.beacon.yaml",
      }),
    },
  };
  const manifest = buildFreesideManifest(registry, loadBeacon);
  assert.equal(
    manifest.modules.length,
    1,
    "malformed module must be skipped, not crash the build",
  );
  assert.equal(manifest.modules[0].slug, "freeside-score");
});

test("buildFreesideManifest · skips a legacy V2 beacon", () => {
  const registry: Registry = {
    version: 1,
    modules: {
      "legacy-mod": moduleEntry({
        beacon_fixture: "tests/fixtures/legacy-v2.beacon.yaml",
      }),
    },
  };
  const manifest = buildFreesideManifest(registry, loadBeacon);
  assert.equal(manifest.modules.length, 0, "a V2-legacy beacon has no belts — skipped");
});

test("buildFreesideManifest · skips a remote-only (beacon_url) module", () => {
  const registry: Registry = {
    version: 1,
    modules: { "remote-mod": moduleEntry({}) }, // beacon_url only
  };
  const manifest = buildFreesideManifest(registry, loadBeacon);
  assert.equal(manifest.modules.length, 0);
});

test("buildFreesideManifest · visibilityFilter excludes non-matching modules", () => {
  const registry: Registry = {
    version: 1,
    modules: {
      "freeside-score": moduleEntry({
        beacon_fixture: "tests/fixtures/freeside-score.beacon.yaml",
      }),
    },
  };
  // freeside-score is visibility:internal — a public-only filter excludes it.
  const manifest = buildFreesideManifest(registry, loadBeacon, ["public"]);
  assert.equal(manifest.modules.length, 0);
});

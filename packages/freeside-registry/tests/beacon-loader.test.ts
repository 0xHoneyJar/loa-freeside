/**
 * Unit tests · @freeside/freeside-registry beacon-loader (cycle-049 S2)
 *
 * Covers FR-2 / NFR-4: fixture-aware resolution, path-safety, and the
 * V2/V3 decode-attempt discrimination (DEVIATION D-S2-1).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadBeacon } from "../src/beacon-loader.js";
import type { ModuleEntry } from "../src/registry.js";

/** A ModuleEntry with sensible defaults; `over` supplies the field under test. */
const entry = (over: Partial<ModuleEntry>): ModuleEntry => ({
  git_url: "https://github.com/0xHoneyJar/freeside-score.git",
  beacon_url: "https://score.0xhoneyjar.xyz/.well-known/beacon.json",
  visibility: "internal",
  owner: "0xHoneyJar",
  added: "2026-05-19",
  ...over,
});

test("loadBeacon · freeside-score fixture decodes clean as BeaconV3 (AC-3)", () => {
  const result = loadBeacon(
    entry({ beacon_fixture: "tests/fixtures/freeside-score.beacon.yaml" }),
  );
  assert.equal(result.kind, "v3");
  if (result.kind === "v3") {
    assert.equal(
      result.beacon.is.one_liner.startsWith("Wallet + community scoring"),
      true,
    );
    assert.equal(result.beacon.produces.length, 3);
    assert.equal(result.beacon.consumes.length, 1);
    assert.equal(result.beacon.consumes[0].from, "freeside-sonar");
    assert.equal(result.beacon.consumes[0].belt, "chain-events");
  }
});

test("loadBeacon · a V2 beacon is detected and tagged legacy (NFR-1)", () => {
  const result = loadBeacon(
    entry({ beacon_fixture: "tests/fixtures/legacy-v2.beacon.yaml" }),
  );
  assert.equal(result.kind, "legacy", "V2 beacon must surface as legacy, not v3/error");
});

test("loadBeacon · a malformed beacon classifies as error, never throws", () => {
  const result = loadBeacon(
    entry({ beacon_fixture: "tests/fixtures/freeside-score-malformed.beacon.yaml" }),
  );
  assert.equal(result.kind, "error");
});

test("loadBeacon · ..-traversal beacon_fixture is rejected", () => {
  const result = loadBeacon(entry({ beacon_fixture: "../../../etc/passwd" }));
  assert.equal(result.kind, "error");
  if (result.kind === "error") {
    assert.ok(
      result.error.includes("traversal"),
      `expected a path-traversal rejection, got: ${result.error}`,
    );
  }
});

test("loadBeacon · beacon_fixture is preferred over beacon_url", () => {
  // Entry carries BOTH an unreachable beacon_url and a real beacon_fixture.
  // A clean v3 result proves the fixture wins and beacon_url is never reached.
  const result = loadBeacon(
    entry({
      beacon_url: "https://unreachable.invalid/beacon.json",
      beacon_fixture: "tests/fixtures/freeside-score.beacon.yaml",
    }),
  );
  assert.equal(result.kind, "v3");
});

test("loadBeacon · beacon_url-only entry resolves to error (remote out of scope)", () => {
  const result = loadBeacon(entry({})); // no beacon_fixture
  assert.equal(result.kind, "error");
  if (result.kind === "error") {
    assert.ok(
      result.error.includes("remote"),
      `expected a remote-not-implemented error, got: ${result.error}`,
    );
  }
});

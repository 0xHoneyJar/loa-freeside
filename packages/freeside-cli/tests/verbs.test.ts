/**
 * Unit tests · @freeside/freeside-cli verbs (cycle-049 S3 · FR-4).
 *
 * `inspect` is exercised with an injected manifest fetcher (no live gateway);
 * `doctor` runs against the real registry + an injected malformed registry.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { inspectModule } from "../src/verbs/inspect.js";
import { doctor } from "../src/verbs/doctor.js";
import type { FreesideManifest, Registry } from "@freeside/freeside-registry";

/** A FreesideManifest carrying exactly the given slugs (minimal entries). */
const manifestWith = (slugs: ReadonlyArray<string>): FreesideManifest => ({
  version: 2,
  generated_at: new Date().toISOString(),
  scope: "internal",
  modules: slugs.map((slug) => ({
    slug,
    one_liner: "",
    is_not: [],
    produces: [],
    consumes: [],
    capabilities: { tools: [] },
    visibility: "internal" as const,
  })),
});

// ── inspect ────────────────────────────────────────────────────────────────

test("inspectModule · returns the validated BeaconV3 for freeside-score", async () => {
  const beacon = await inspectModule("freeside-score", {
    fetchManifest: async () => manifestWith(["freeside-score"]),
  });
  // loadBeacon already ran decodeBeaconV3 — assert the V3 shape is intact.
  assert.equal(beacon.is.one_liner.startsWith("Wallet + community scoring"), true);
  assert.equal(beacon.produces.length, 3);
  assert.equal(beacon.consumes.length, 1);
  assert.equal(beacon.consumes[0].from, "freeside-sonar");
  assert.equal(beacon.cycle_state.status, "active");
});

test("inspectModule · throws for an unregistered slug", async () => {
  await assert.rejects(
    () => inspectModule("does-not-exist", { fetchManifest: async () => manifestWith([]) }),
    /not found in registry/,
  );
});

test("inspectModule · throws when the slug is registered but absent from the live manifest", async () => {
  await assert.rejects(
    () => inspectModule("freeside-score", { fetchManifest: async () => manifestWith([]) }),
    /absent from the live/,
  );
});

// ── doctor ─────────────────────────────────────────────────────────────────

test("doctor · exits clean (summary.error === 0) on the real registry / fixture set", () => {
  const report = doctor();
  assert.equal(
    report.summary.error,
    0,
    "fixture set (freeside-score V3) + remote-as-warn must yield zero errors",
  );
  const scoreDecode = report.findings.find(
    (f) => f.slug === "freeside-score" && f.check === "beacon_decode",
  );
  assert.ok(scoreDecode, "freeside-score must have a beacon_decode finding");
  assert.equal(scoreDecode.severity, "ok");
});

test("doctor · a malformed beacon_fixture produces an error finding (injected registry)", () => {
  const badRegistry: Registry = {
    version: 1,
    modules: {
      "bad-building": {
        git_url: "https://github.com/0xHoneyJar/x.git",
        beacon_url: "https://x.0xhoneyjar.xyz/.well-known/beacon.json",
        beacon_fixture: "tests/fixtures/freeside-score-malformed.beacon.yaml",
        visibility: "internal",
        owner: "0xHoneyJar",
        added: "2026-05-19",
      },
    },
  };
  const report = doctor({ registry: badRegistry });
  assert.ok(
    report.summary.error > 0,
    "a malformed beacon_fixture must produce an error finding → CLI exit 1",
  );
});

test("doctor · exit-code contract — clean report maps to exit 0", () => {
  const report = doctor();
  assert.equal(report.summary.error > 0 ? 1 : 0, 0);
});

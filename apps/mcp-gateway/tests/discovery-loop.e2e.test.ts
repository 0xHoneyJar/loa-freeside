/**
 * FR-6 E2E — the closed discovery loop (cycle-049 S4 · AD-4).
 *
 * Proves the loop end-to-end against the `freeside-score` fixture beacon —
 * the cycle's binding acceptance bar (prd.md:32):
 *
 *   fixture beacon  →  registry aggregation  →  gateway /internal/freeside.json
 *                   →  freeside-cli inspectModule()  →  validated BeaconV3
 *
 * In-process (AD-4): imports the Hono `app` and calls `app.request()` — no
 * listening socket, no spawned gateway, no Railway, no network. Deterministic.
 *
 * OPERATOR_API_KEY is set BEFORE the dynamic import of app.ts so auth.ts
 * captures it at module load (ESM imports hoist).
 */

process.env.OPERATOR_API_KEY = "test-operator-key";

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { Effect, Schema } from "effect";
import { BeaconV3Schema } from "@freeside/beacon-schema";
import { inspectModule } from "@freeside/freeside-cli";
import type { FreesideManifest } from "@freeside/freeside-registry";

const app = (await import("../src/app.js")).default;
const { stopBeaconRefresh } = await import("../src/beacon-cache.js");

// Stop the 5min beacon-refresh interval after the suite (SDD §7.2 teardown).
after(() => stopBeaconRefresh());

/** Operator-gated GET against the in-process Hono app — no listening socket. */
const fetchFreesideManifest = async (): Promise<FreesideManifest> => {
  const res = await app.request("/internal/freeside.json", {
    headers: { Authorization: "Bearer test-operator-key" },
  });
  assert.equal(res.status, 200, "the gateway must serve /internal/freeside.json");
  return (await res.json()) as FreesideManifest;
};

test("FR-6 · discovery loop closed end-to-end against the freeside-score fixture", async () => {
  // ── leg 1: fixture beacon → registry aggregation → gateway route ──
  const manifest = await fetchFreesideManifest();
  assert.equal(manifest.version, 2);
  assert.equal(manifest.scope, "internal");

  const score = manifest.modules.find((m) => m.slug === "freeside-score");
  // STRICT E2E gate (SDD §5.1): prod skip-not-crash stays resilient, but the
  // E2E test fails LOUDLY if freeside-score is skipped from the manifest.
  assert.ok(
    score,
    "freeside-score MUST be present in the live manifest — the discovery loop is broken if it is skipped",
  );
  assert.equal(score.produces.length, 3, "freeside-score declares 3 produces belts");
  assert.deepEqual(
    score.produces.map((p) => p.belt),
    ["wallet-scores", "rank-changes", "factor-metadata"],
  );
  assert.equal(score.consumes.length, 1, "freeside-score declares 1 consumes belt");
  assert.equal(score.consumes[0].from, "freeside-sonar");

  // ── leg 2: gateway route → freeside-cli inspectModule() ──
  // inspectModule fetches the manifest through the SAME in-process app and
  // resolves + validates the full beacon — the CLI verb, exercised for real.
  const beacon = await inspectModule("freeside-score", {
    fetchManifest: fetchFreesideManifest,
  });

  // ── the loop closes: the inspected beacon is a clean BeaconV3 ──
  const reDecoded = Effect.runSyncExit(
    Schema.decodeUnknown(BeaconV3Schema)(beacon),
  );
  assert.equal(
    reDecoded._tag,
    "Success",
    "the beacon inspect returned must decode clean against BeaconV3Schema",
  );
  assert.equal(beacon.is.one_liner.startsWith("Wallet + community scoring"), true);
  assert.equal(beacon.produces.length, 3);
  assert.equal(beacon.consumes[0].tag, "SonarPort@2.1.0+a3f2c891d4e8b7c2");
});

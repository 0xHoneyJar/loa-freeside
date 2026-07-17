/**
 * Conformance · orientation classification vectors (beacon-consumer S1-T2, SDD D6).
 *
 * The vectors in test-vectors/orientation-conformance.json are the SHARED cross-impl
 * spec: freeside-cli's SSRF guards (host_guard/private_range) and both surfaces' exit
 * table (this file, classification) MUST agree. Here the single-owned builder + BEACON_EXIT
 * are driven through every classification row — proving the exit code table and the
 * missing-field policy honor the spec at the source of truth.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  buildOrientationPacket,
  BEACON_EXIT,
  type BeaconClassification,
  type OrientationBeaconInput,
} from "../src/orientation-packet.js";

const vectors = JSON.parse(
  readFileSync(fileURLToPath(new URL("../test-vectors/orientation-conformance.json", import.meta.url)), "utf8"),
) as {
  classification: Array<{
    name: string;
    unknown_slug?: boolean;
    expect: { classification?: BeaconClassification; exit: number; detail?: string };
  }>;
};

const SAMPLE_BEACON: OrientationBeaconInput = {
  publisher: "0xHoneyJar",
  is: "Reputation score API",
  is_not: ["Does NOT mint"],
  cycle_state: "active",
};

test("classification vectors — BEACON_EXIT maps each classification to its spec'd exit code", () => {
  for (const v of vectors.classification) {
    if (v.unknown_slug) {
      assert.equal(BEACON_EXIT.unknown_slug, v.expect.exit, `${v.name}: unknown_slug exit`);
      continue;
    }
    assert.ok(v.expect.classification, `${v.name}: vector must name a classification`);
    assert.equal(BEACON_EXIT[v.expect.classification!], v.expect.exit, `${v.name}: exit`);
  }
});

test("classification vectors — builder fills beacon fields ONLY for beacon_valid (missing-field policy)", () => {
  for (const v of vectors.classification) {
    if (v.unknown_slug || !v.expect.classification) continue;
    const cls = v.expect.classification;
    const probe = { classification: cls, detail: (v.expect.detail ?? "ok") as never, target: "https://x.0xhoneyjar.xyz/b" };
    const packet = buildOrientationPacket({ slug: "score-api", beacon_url: probe.target }, probe, SAMPLE_BEACON);

    assert.equal(packet.verdict.classification, cls, `${v.name}: verdict.classification`);
    assert.equal(packet.verdict.beacon_valid, cls === "beacon_valid", `${v.name}: verdict.beacon_valid`);
    if (cls === "beacon_valid") {
      assert.equal(packet.publisher, "0xHoneyJar", `${v.name}: valid → beacon fields present`);
    } else {
      assert.equal(packet.publisher, null, `${v.name}: non-valid → beacon fields null`);
      assert.equal(packet.is, null, `${v.name}: non-valid → is null`);
    }
    // registry-derived fields always render regardless of classification.
    assert.equal(packet.runtime_state, "unknown", `${v.name}: registry field always present`);
  }
});

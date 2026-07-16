import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decodeGateManifestSync } from "../src/index.js";
import { loadManifest } from "./test-helpers.js";

describe("GateManifest strict boundary", () => {
  it("decodes the canonical manifest", () => {
    const manifest = loadManifest();
    assert.equal(manifest.schema_version, 1);
    assert.equal(manifest.status, "pending_owner_approval");
  });

  it("rejects excess root properties", () => {
    const manifest = loadManifest();
    assert.throws(() =>
      decodeGateManifestSync({ ...manifest, unratified_extension: true }),
    );
  });

  it("rejects impossible calendar timestamps", () => {
    const manifest = loadManifest();
    for (const evaluatedAt of [
      "2026-99-99T00:00:00Z",
      "2026-02-30T00:00:00Z",
      "2026-07-16T24:00:00Z",
    ]) {
      assert.throws(() =>
        decodeGateManifestSync({
          ...manifest,
          evaluated_at: evaluatedAt,
        }),
      );
    }
  });

  it("accepts leap day only in a leap year", () => {
    const manifest = loadManifest();
    assert.doesNotThrow(() =>
      decodeGateManifestSync({
        ...manifest,
        evaluated_at: "2028-02-29T00:00:00Z",
      }),
    );
    assert.throws(() =>
      decodeGateManifestSync({
        ...manifest,
        evaluated_at: "2027-02-29T00:00:00Z",
      }),
    );
  });

  it("rejects evidence with no validity policy", () => {
    const manifest = loadManifest();
    const firstGate = manifest.gates[0];
    assert.ok(firstGate);
    const firstEvidence = firstGate.evidence[0];
    assert.ok(firstEvidence);
    const { validity: omittedValidity, ...withoutValidity } = firstEvidence;
    assert.ok(omittedValidity);
    assert.throws(() =>
      decodeGateManifestSync({
        ...manifest,
        gates: [
          {
            ...firstGate,
            evidence: [withoutValidity, ...firstGate.evidence.slice(1)],
          },
          ...manifest.gates.slice(1),
        ],
      }),
    );
  });
});

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  createStreamConsumerState,
  decodeFixtureScenarioBundle,
  fixtureRegistryFromBundle,
  ingestTrustEnvelope,
  FIXTURE_STREAM_ID,
} from "../index.js";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "../../fixtures/scenarios");

describe("Ordering replay consumer fixture contract", () => {
  it("Ordering-shaped inbox consumer ingests the same committed envelope vectors", () => {
    const bundle = decodeFixtureScenarioBundle(
      JSON.parse(readFileSync(join(fixturesDir, "producer-consumer.shared.json"), "utf8")),
    );
    const registry = fixtureRegistryFromBundle(bundle);
    const acceptedAtMs = Date.parse("2026-07-17T21:00:01.000Z");
    let state = createStreamConsumerState(FIXTURE_STREAM_ID, 1);

    for (const scenario of bundle.envelopes) {
      if (scenario.expect !== "accept") continue;
      const result = ingestTrustEnvelope({
        envelope: scenario.envelope,
        registry,
        acceptedAtMs,
        state,
      });
      expect(result.kind, scenario.id).toBe("accepted");
      if (result.kind === "accepted") {
        state = result.state;
      }
    }

    expect(state.highestContiguousSequence).toBeGreaterThan(0);
    expect(state.seenEventIds.size).toBeGreaterThan(0);
  });
});

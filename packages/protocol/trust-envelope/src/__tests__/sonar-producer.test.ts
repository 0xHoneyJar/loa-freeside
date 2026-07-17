import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  advanceTrustStreamProducer,
  createTrustStreamProducerState,
  decodeFixtureScenarioBundle,
  emitTrustEnvelope,
  fixtureSigners,
  verifyTrustEnvelope,
  fixtureRegistryFromBundle,
  FIXTURE_CAPABILITY,
  FIXTURE_STREAM_ID,
  FIXTURE_TENANT_SCOPE_DIGEST,
} from "../index.js";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "../../fixtures/scenarios");

describe("Sonar producer fixture contract", () => {
  it("Sonar-shaped producers emit envelopes that pass shared verification", () => {
    const bundle = decodeFixtureScenarioBundle(
      JSON.parse(readFileSync(join(fixturesDir, "producer-consumer.shared.json"), "utf8")),
    );
    const registry = fixtureRegistryFromBundle(bundle);
    const signers = fixtureSigners();
    let producer = createTrustStreamProducerState(FIXTURE_STREAM_ID, 1);
    const issuedAtMs = Date.parse("2026-07-17T21:00:00.000Z");
    const acceptedAtMs = Date.parse("2026-07-17T21:00:01.000Z");

    const emitted = emitTrustEnvelope({
      signer: signers.sonarPrimary,
      producer: "sonar-api",
      eventId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      streamId: producer.streamId,
      streamEpoch: producer.streamEpoch,
      sequence: producer.nextSequence,
      trustStream: true,
      issuedAtMs,
      tenantScopeDigest: FIXTURE_TENANT_SCOPE_DIGEST,
      capability: FIXTURE_CAPABILITY,
      body: { schema_version: 1, probe: "sonar-fixture" },
    });
    producer = advanceTrustStreamProducer(producer);

    expect(() =>
      verifyTrustEnvelope({
        envelope: emitted,
        registry,
        acceptedAtMs,
      }),
    ).not.toThrow();

    const fixturePrimary = bundle.envelopes.find((entry) => entry.id === "valid-primary");
    expect(fixturePrimary?.envelope.header.producer).toBe("sonar-api");
  });
});

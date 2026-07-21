import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  acceptsEnvelopeSchemaMinor,
  computeBodyDigest,
  decodeTrustEnvelope,
  emitTrustEnvelope,
  envelopeSigningBytes,
  fixtureSigners,
  mixedMinorRules,
  verifyEd25519Signature,
  verifyTrustEnvelope,
  ServiceKeyRegistry,
  FIXTURE_CAPABILITY,
  FIXTURE_STREAM_ID,
  FIXTURE_TENANT_SCOPE_DIGEST,
  TRUST_ENVELOPE_SCHEMA_MAJOR,
} from "../index.js";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "../../fixtures/scenarios");
const NOW = Date.parse("2026-07-17T21:00:00.000Z");

describe("trust envelope protocol (CR-009)", () => {
  it("decodes envelopes strictly and rejects excess properties", () => {
    const signers = fixtureSigners();
    const envelope = emitTrustEnvelope({
      signer: signers.sonarPrimary,
      producer: "sonar-api",
      eventId: "88888888-8888-4888-8888-888888888888",
      streamId: FIXTURE_STREAM_ID,
      streamEpoch: 1,
      sequence: 1,
      trustStream: true,
      issuedAtMs: NOW,
      tenantScopeDigest: FIXTURE_TENANT_SCOPE_DIGEST,
      capability: FIXTURE_CAPABILITY,
      body: { schema_version: 1, ok: true },
    });
    const decoded = decodeTrustEnvelope(envelope);
    expect(decoded.header.contract.major_version).toBe(TRUST_ENVELOPE_SCHEMA_MAJOR);
    expect(() =>
      decodeTrustEnvelope({
        ...envelope,
        unexpected: true,
      }),
    ).toThrow();
  });

  it("binds body digest and verifies Ed25519 signature bytes", () => {
    const signers = fixtureSigners();
    const body = { schema_version: 1, value: 42 };
    const envelope = emitTrustEnvelope({
      signer: signers.sonarPrimary,
      producer: "sonar-api",
      eventId: "99999999-9999-4999-8999-999999999999",
      streamId: FIXTURE_STREAM_ID,
      streamEpoch: 1,
      sequence: 1,
      trustStream: false,
      issuedAtMs: NOW,
      tenantScopeDigest: FIXTURE_TENANT_SCOPE_DIGEST,
      capability: FIXTURE_CAPABILITY,
      body,
    });
    expect(envelope.header.body_digest).toBe(computeBodyDigest(body));
    expect(
      verifyEd25519Signature(
        signers.sonarPrimary.publicKeyHex(),
        envelopeSigningBytes({ header: envelope.header, body: envelope.body }),
        envelope.signature,
      ),
    ).toBe(true);
  });

  it("documents explicit mixed-minor rules", () => {
    expect(mixedMinorRules.unknownMajor).toBe("fail_closed");
    expect(acceptsEnvelopeSchemaMinor(0, 0)).toBe(true);
    expect(acceptsEnvelopeSchemaMinor(1, 0)).toBe(false);
  });

  it("rejects unknown schema major before signature verification", () => {
    const bundle = JSON.parse(
      readFileSync(join(fixturesDir, "producer-consumer.shared.json"), "utf8"),
    ) as {
      registry: { keys: import("../contracts.js").ServiceSigningKey[] };
      envelopes: Array<{ envelope: ReturnType<typeof decodeTrustEnvelope> }>;
    };
    const registry = new ServiceKeyRegistry(bundle.registry.keys);
    const envelope = {
      ...structuredClone(bundle.envelopes[0]!.envelope),
      header: {
        ...bundle.envelopes[0]!.envelope.header,
        schema_version: 99 as unknown as 1,
      },
    };
    expect(() =>
      verifyTrustEnvelope({
        envelope,
        registry,
        acceptedAtMs: NOW + 1_000,
      }),
    ).toThrow(/unsupported trust-envelope schema major/);
  });
});

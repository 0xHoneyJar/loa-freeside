import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  FIXTURE_CAPABILITY,
  FIXTURE_SIGNING_KEY_IDS,
  FIXTURE_STREAM_ID,
  FIXTURE_TENANT_SCOPE_DIGEST,
  fixturePublicKeys,
  fixtureSigners,
} from "../dist/fixture-keys.js";
import { digestEpochBaselineMaterial, signStreamEpochBaseline } from "../dist/signing.js";
import { emitTrustEnvelope } from "../dist/producer.js";

const NOW = Date.parse("2026-07-17T21:00:00.000Z");
const ACCEPTED_AT = NOW + 1_000;

const signers = fixtureSigners();
const publicKeys = fixturePublicKeys();

const body = {
  schema_version: 1,
  deployment_id: "deploy-alpha-mainnet",
  capability_state: "ready",
};

const acceptedEnvelope = emitTrustEnvelope({
  signer: signers.sonarPrimary,
  producer: "sonar-api",
  eventId: "11111111-1111-4111-8111-111111111111",
  streamId: FIXTURE_STREAM_ID,
  streamEpoch: 1,
  sequence: 1,
  trustStream: true,
  issuedAtMs: NOW,
  tenantScopeDigest: FIXTURE_TENANT_SCOPE_DIGEST,
  capability: FIXTURE_CAPABILITY,
  body,
});

const rotatedEnvelope = emitTrustEnvelope({
  signer: signers.sonarRotated,
  producer: "sonar-api",
  eventId: "22222222-2222-4222-8222-222222222222",
  streamId: FIXTURE_STREAM_ID,
  streamEpoch: 1,
  sequence: 2,
  trustStream: true,
  issuedAtMs: NOW,
  tenantScopeDigest: FIXTURE_TENANT_SCOPE_DIGEST,
  capability: FIXTURE_CAPABILITY,
  body,
});

const revokedKeyEnvelope = emitTrustEnvelope({
  signer: signers.sonarRevoked,
  producer: "sonar-api",
  eventId: "33333333-3333-4333-8333-333333333333",
  streamId: FIXTURE_STREAM_ID,
  streamEpoch: 1,
  sequence: 3,
  trustStream: true,
  issuedAtMs: NOW,
  tenantScopeDigest: FIXTURE_TENANT_SCOPE_DIGEST,
  capability: FIXTURE_CAPABILITY,
  body,
});

const expiredEnvelope = emitTrustEnvelope({
  signer: signers.sonarPrimary,
  producer: "sonar-api",
  eventId: "44444444-4444-4444-8444-444444444444",
  streamId: FIXTURE_STREAM_ID,
  streamEpoch: 1,
  sequence: 4,
  trustStream: true,
  issuedAtMs: NOW - 600_000,
  ttlMs: 60_000,
  tenantScopeDigest: FIXTURE_TENANT_SCOPE_DIGEST,
  capability: FIXTURE_CAPABILITY,
  body,
});

const gapEnvelope = emitTrustEnvelope({
  signer: signers.sonarPrimary,
  producer: "sonar-api",
  eventId: "55555555-5555-4555-8555-555555555555",
  streamId: FIXTURE_STREAM_ID,
  streamEpoch: 1,
  sequence: 6,
  trustStream: true,
  issuedAtMs: NOW,
  tenantScopeDigest: FIXTURE_TENANT_SCOPE_DIGEST,
  capability: FIXTURE_CAPABILITY,
  body,
});

const epochTwoEnvelope = emitTrustEnvelope({
  signer: signers.sonarPrimary,
  producer: "sonar-api",
  eventId: "66666666-6666-4666-8666-666666666666",
  streamId: FIXTURE_STREAM_ID,
  streamEpoch: 2,
  sequence: 1,
  trustStream: true,
  issuedAtMs: NOW,
  tenantScopeDigest: FIXTURE_TENANT_SCOPE_DIGEST,
  capability: FIXTURE_CAPABILITY,
  body,
});

const tamperedBodyEnvelope = emitTrustEnvelope({
  signer: signers.sonarPrimary,
  producer: "sonar-api",
  eventId: "77777777-7777-4777-8777-777777777777",
  streamId: FIXTURE_STREAM_ID,
  streamEpoch: 1,
  sequence: 5,
  trustStream: false,
  issuedAtMs: NOW,
  tenantScopeDigest: FIXTURE_TENANT_SCOPE_DIGEST,
  capability: FIXTURE_CAPABILITY,
  body,
});
const tampered = structuredClone(tamperedBodyEnvelope);
(tampered.body as { capability_state: string }).capability_state = "tampered";

const baselineDigest = digestEpochBaselineMaterial({
  stream_id: FIXTURE_STREAM_ID,
  stream_epoch: 1,
  highest_sequence: 2,
  envelope_count: 2,
  envelopes: [acceptedEnvelope, rotatedEnvelope],
});

const epochBaseline = signStreamEpochBaseline(signers.sonarPrimary, {
  schema_version: 1,
  schema_minor: 0,
  algorithm: "Ed25519",
  producer: "sonar-api",
  stream_id: FIXTURE_STREAM_ID,
  stream_epoch: 2,
  highest_sequence: 2,
  envelope_count: 2,
  baseline_digest: baselineDigest,
  issued_at: new Date(NOW).toISOString(),
});

const bundle = {
  schema_version: 1 as const,
  accepted_at_ms: ACCEPTED_AT,
  registry: {
    schema_version: 1 as const,
    keys: [
      {
        signing_key_id: FIXTURE_SIGNING_KEY_IDS.sonarPrimary,
        public_key_hex: publicKeys[FIXTURE_SIGNING_KEY_IDS.sonarPrimary],
        producer: "sonar-api",
        capabilities: [FIXTURE_CAPABILITY],
        tenant_scope_digests: [FIXTURE_TENANT_SCOPE_DIGEST],
        activated_at: "2026-07-01T00:00:00.000Z",
      },
      {
        signing_key_id: FIXTURE_SIGNING_KEY_IDS.sonarRotated,
        public_key_hex: publicKeys[FIXTURE_SIGNING_KEY_IDS.sonarRotated],
        producer: "sonar-api",
        capabilities: [FIXTURE_CAPABILITY],
        tenant_scope_digests: [FIXTURE_TENANT_SCOPE_DIGEST],
        activated_at: "2026-07-10T00:00:00.000Z",
      },
      {
        signing_key_id: FIXTURE_SIGNING_KEY_IDS.sonarRevoked,
        public_key_hex: publicKeys[FIXTURE_SIGNING_KEY_IDS.sonarRevoked],
        producer: "sonar-api",
        capabilities: [FIXTURE_CAPABILITY],
        tenant_scope_digests: [FIXTURE_TENANT_SCOPE_DIGEST],
        activated_at: "2026-07-01T00:00:00.000Z",
        revoked_at: "2026-07-16T00:00:00.000Z",
      },
    ],
  },
  envelopes: [
    { id: "valid-primary", envelope: acceptedEnvelope, expect: "accept" as const },
    { id: "rotation-overlap-new-key", envelope: rotatedEnvelope, expect: "accept" as const },
    {
      id: "revoked-key",
      envelope: revokedKeyEnvelope,
      expect: "reject" as const,
      reject_reason: "revoked_signing_key",
      reject_stage: "verify",
    },
    {
      id: "expired",
      envelope: expiredEnvelope,
      expect: "reject" as const,
      reject_reason: "expired",
      reject_stage: "verify",
    },
    {
      id: "sequence-gap",
      envelope: gapEnvelope,
      expect: "reject" as const,
      reject_reason: "sequence_gap",
      reject_stage: "ingest",
    },
    {
      id: "epoch-without-baseline",
      envelope: epochTwoEnvelope,
      expect: "reject" as const,
      reject_reason: "epoch_baseline_required",
      reject_stage: "ingest",
    },
    {
      id: "tampered-body",
      envelope: tampered,
      expect: "reject" as const,
      reject_reason: "body_digest_mismatch",
      reject_stage: "verify",
    },
  ],
  baselines: [{ id: "epoch-2-complete", baseline: epochBaseline }],
};

const outDir = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/scenarios");
writeFileSync(join(outDir, "producer-consumer.shared.json"), `${JSON.stringify(bundle, null, 2)}\n`);

console.log(`Wrote ${join(outDir, "producer-consumer.shared.json")}`);

import type { ServiceSigningKey, StreamEpochBaseline, TrustEnvelope } from "./contracts.js";
import { TrustEnvelopeRejectedError, StreamEpochBaselineRejectedError } from "./errors.js";
import {
  baselineSigningBytes,
  computeBodyDigest,
  envelopeSigningBytes,
  verifyEd25519Signature,
} from "./signing.js";
import { ServiceKeyRegistry } from "./registry.js";
import { TRUST_ENVELOPE_MAX_FUTURE_SKEW_MS } from "./version.js";
import { assertSupportedSchemaMajor, assertSupportedSchemaMinor } from "./versioning.js";

export interface VerifyTrustEnvelopeInput {
  readonly envelope: TrustEnvelope;
  readonly registry: ServiceKeyRegistry;
  readonly acceptedAtMs: number;
  readonly consumerSupportedMinor?: number;
}

export const verifyTrustEnvelope = ({
  envelope,
  registry,
  acceptedAtMs,
  consumerSupportedMinor,
}: VerifyTrustEnvelopeInput): void => {
  assertSupportedSchemaMajor(envelope.header.schema_version);
  assertSupportedSchemaMinor(envelope.header.schema_minor, consumerSupportedMinor);

  if (computeBodyDigest(envelope.body) !== envelope.header.body_digest) {
    throw new TrustEnvelopeRejectedError({
      reason: "body_digest_mismatch",
    });
  }

  const key = registry.resolve(envelope.header.signing_key_id);
  if (key === undefined) {
    throw new TrustEnvelopeRejectedError({ reason: "unknown_signing_key" });
  }
  if (!registry.isActive(key, acceptedAtMs)) {
    throw new TrustEnvelopeRejectedError({ reason: "revoked_signing_key" });
  }
  if (!registry.bindsProducer(key, envelope.header.producer)) {
    throw new TrustEnvelopeRejectedError({ reason: "capability_not_bound" });
  }
  if (!registry.bindsCapability(key, envelope.header.capability)) {
    throw new TrustEnvelopeRejectedError({ reason: "capability_not_bound" });
  }
  if (!registry.bindsTenantScope(key, envelope.header.tenant_scope_digest)) {
    throw new TrustEnvelopeRejectedError({ reason: "tenant_scope_not_bound" });
  }

  const issuedAt = Date.parse(envelope.header.issued_at);
  const expiresAt = Date.parse(envelope.header.expires_at);
  if (issuedAt > acceptedAtMs + TRUST_ENVELOPE_MAX_FUTURE_SKEW_MS) {
    throw new TrustEnvelopeRejectedError({ reason: "issued_in_future" });
  }
  if (expiresAt <= acceptedAtMs) {
    throw new TrustEnvelopeRejectedError({ reason: "expired" });
  }

  const validSignature = verifyEd25519Signature(
    key.public_key_hex,
    envelopeSigningBytes({
      header: envelope.header,
      body: envelope.body,
    }),
    envelope.signature,
  );
  if (!validSignature) {
    throw new TrustEnvelopeRejectedError({ reason: "signature_invalid" });
  }
};

export interface VerifyStreamEpochBaselineInput {
  readonly baseline: StreamEpochBaseline;
  readonly registry: ServiceKeyRegistry;
  readonly acceptedAtMs: number;
  readonly previousEpoch: number;
  readonly expectedBaselineDigest: string;
}

export const verifyStreamEpochBaseline = ({
  baseline,
  registry,
  acceptedAtMs,
  previousEpoch,
  expectedBaselineDigest,
}: VerifyStreamEpochBaselineInput): void => {
  assertSupportedSchemaMajor(baseline.schema_version);

  if (baseline.stream_epoch <= previousEpoch) {
    throw new StreamEpochBaselineRejectedError({ reason: "epoch_not_advanced" });
  }
  if (baseline.baseline_digest !== expectedBaselineDigest) {
    throw new StreamEpochBaselineRejectedError({ reason: "baseline_incomplete" });
  }

  const key = registry.resolve(baseline.signing_key_id);
  if (key === undefined) {
    throw new StreamEpochBaselineRejectedError({ reason: "unknown_signing_key" });
  }
  if (!registry.isActive(key, acceptedAtMs)) {
    throw new StreamEpochBaselineRejectedError({ reason: "revoked_signing_key" });
  }

  const validSignature = verifyEd25519Signature(
    key.public_key_hex,
    baselineSigningBytes({
      schema_version: baseline.schema_version,
      schema_minor: baseline.schema_minor,
      algorithm: baseline.algorithm,
      signing_key_id: baseline.signing_key_id,
      producer: baseline.producer,
      stream_id: baseline.stream_id,
      stream_epoch: baseline.stream_epoch,
      highest_sequence: baseline.highest_sequence,
      envelope_count: baseline.envelope_count,
      baseline_digest: baseline.baseline_digest,
      issued_at: baseline.issued_at,
    }),
    baseline.signature,
  );
  if (!validSignature) {
    throw new StreamEpochBaselineRejectedError({ reason: "signature_invalid" });
  }
};

export const resolveActiveKey = (
  registry: ServiceKeyRegistry,
  signingKeyId: string,
  acceptedAtMs: number,
): ServiceSigningKey => {
  const key = registry.resolve(signingKeyId);
  if (key === undefined || !registry.isActive(key, acceptedAtMs)) {
    throw new TrustEnvelopeRejectedError({ reason: "revoked_signing_key" });
  }
  return key;
};

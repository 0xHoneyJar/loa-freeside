import type { TrustContractRef, TrustEnvelope, TrustEnvelopeHeader } from "./contracts.js";
import {
  TRUST_ENVELOPE_CONTRACT,
  TRUST_ENVELOPE_DEFAULT_TTL_MS,
  TRUST_ENVELOPE_SCHEMA_MINOR,
} from "./version.js";
import { computeBodyDigest, signTrustEnvelope, type TrustEnvelopeSigner } from "./signing.js";

export interface BuildTrustEnvelopeHeaderInput {
  readonly producer: string;
  readonly contract?: TrustContractRef;
  readonly eventId: string;
  readonly streamId: string;
  readonly streamEpoch: number;
  readonly sequence: number;
  readonly trustStream: boolean;
  readonly issuedAtMs: number;
  readonly ttlMs?: number;
  readonly tenantScopeDigest: string;
  readonly capability: string;
  readonly body: unknown;
  readonly schemaMinor?: number;
}

export const buildTrustEnvelopeHeader = (
  input: BuildTrustEnvelopeHeaderInput,
): TrustEnvelopeHeader => {
  const issuedAt = new Date(input.issuedAtMs).toISOString();
  const expiresAt = new Date(
    input.issuedAtMs + (input.ttlMs ?? TRUST_ENVELOPE_DEFAULT_TTL_MS),
  ).toISOString();
  return {
    schema_version: TRUST_ENVELOPE_CONTRACT.major_version,
    schema_minor: input.schemaMinor ?? TRUST_ENVELOPE_SCHEMA_MINOR,
    algorithm: "Ed25519",
    signing_key_id: "pending",
    producer: input.producer,
    contract: input.contract ?? TRUST_ENVELOPE_CONTRACT,
    event_id: input.eventId,
    stream_id: input.streamId,
    stream_epoch: input.streamEpoch,
    sequence: input.sequence,
    trust_stream: input.trustStream,
    issued_at: issuedAt,
    expires_at: expiresAt,
    tenant_scope_digest: input.tenantScopeDigest,
    capability: input.capability,
    body_digest: computeBodyDigest(input.body),
  };
};

export interface EmitTrustEnvelopeInput extends BuildTrustEnvelopeHeaderInput {
  readonly signer: TrustEnvelopeSigner;
}

export const emitTrustEnvelope = (input: EmitTrustEnvelopeInput): TrustEnvelope =>
  signTrustEnvelope(input.signer, {
    header: buildTrustEnvelopeHeader(input),
    body: input.body,
  });

export interface TrustStreamProducerState {
  readonly streamId: string;
  streamEpoch: number;
  nextSequence: number;
}

export const createTrustStreamProducerState = (
  streamId: string,
  streamEpoch = 1,
): TrustStreamProducerState => ({
  streamId,
  streamEpoch,
  nextSequence: 1,
});

export const advanceTrustStreamProducer = (
  state: TrustStreamProducerState,
): TrustStreamProducerState => ({
  ...state,
  nextSequence: state.nextSequence + 1,
});

export const resetTrustStreamEpoch = (
  state: TrustStreamProducerState,
): TrustStreamProducerState => ({
  streamId: state.streamId,
  streamEpoch: state.streamEpoch + 1,
  nextSequence: 1,
});

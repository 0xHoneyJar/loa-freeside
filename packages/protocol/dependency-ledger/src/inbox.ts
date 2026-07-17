import {
  assertSignedIntakeAllowed,
  KeyCustodyRejectedError,
  type KeyCustodyClass,
  type PinnedKeyRegistry,
  type TimeHealthSnapshot,
} from "@freeside/signing-key-custody-protocol";
import type { TrustEnvelope } from "@freeside/trust-envelope-protocol";
import {
  TrustEnvelopeRejectedError,
  createStreamConsumerState,
  ingestTrustEnvelope,
  type StreamConsumerState,
} from "@freeside/trust-envelope-protocol";

import {
  applyCompromiseDenial,
  applyEquivalenceRevocation,
  indexDerivativeEdge,
  refreshDerivativeClosure,
} from "./closure.js";
import {
  DEPENDENCY_EDGE_CAPABILITY,
  DEPENDENCY_EDGE_SUPPORTED_MINOR,
} from "./version.js";
import {
  decodeDependencyEdgeBody,
  derivativeKey,
  type DependencyLedgerInboxState,
  type LedgerEdgeRecord,
} from "./contracts.js";
import { DependencyLedgerRejectedError } from "./errors.js";

export interface IngestDependencyEdgeInput {
  readonly envelope: TrustEnvelope;
  readonly pinnedRegistry: PinnedKeyRegistry;
  readonly timeHealth: TimeHealthSnapshot;
  readonly acceptedAtMs: number;
  readonly state: DependencyLedgerInboxState;
  readonly intakeContext: KeyCustodyClass;
}

export type IngestDependencyEdgeResult =
  | {
      readonly kind: "accepted";
      readonly edge: LedgerEdgeRecord;
      readonly replay: boolean;
      readonly streamState: StreamConsumerState;
    }
  | {
      readonly kind: "rejected";
      readonly error:
        | DependencyLedgerRejectedError
        | TrustEnvelopeRejectedError
        | KeyCustodyRejectedError;
    };

const assertMixedMinor = (schemaMinor: number): void => {
  if (schemaMinor > DEPENDENCY_EDGE_SUPPORTED_MINOR) {
    throw new DependencyLedgerRejectedError({
      reason: "unsupported_schema_minor",
      remediation: "upgrade_consumer",
      safe_code: "unsupported_schema_minor",
    });
  }
};

const streamStateFor = (
  state: DependencyLedgerInboxState,
  streamId: string,
  streamEpoch: number,
): StreamConsumerState =>
  state.streamConsumers.get(streamId) ??
  createStreamConsumerState(streamId, streamEpoch);

export const ingestDependencyEdgeEnvelope = (
  input: IngestDependencyEdgeInput,
): IngestDependencyEdgeResult => {
  try {
    assertSignedIntakeAllowed({
      registry: input.pinnedRegistry,
      signingKeyId: input.envelope.header.signing_key_id,
      acceptedAtMs: input.acceptedAtMs,
      context: input.intakeContext,
      timeHealth: input.timeHealth,
    });
  } catch (error) {
    if (
      error instanceof TrustEnvelopeRejectedError ||
      error instanceof KeyCustodyRejectedError
    ) {
      return { kind: "rejected", error };
    }
    throw error;
  }

  const priorStream = streamStateFor(
    input.state,
    input.envelope.header.stream_id,
    input.envelope.header.stream_epoch,
  );

  const existingByEvent = input.state.edgesByEventId.get(input.envelope.header.event_id);
  if (existingByEvent !== undefined) {
    input.state.metrics = {
      ...input.state.metrics,
      duplicate_replays: input.state.metrics.duplicate_replays + 1,
    };
    return {
      kind: "accepted",
      edge: existingByEvent,
      replay: true,
      streamState: priorStream,
    };
  }

  const ingest = ingestTrustEnvelope({
    envelope: input.envelope,
    registry: input.pinnedRegistry.trustRegistry,
    acceptedAtMs: input.acceptedAtMs,
    state: priorStream,
  });

  if (ingest.kind === "rejected") {
    return { kind: "rejected", error: ingest.error };
  }

  if (input.envelope.header.capability !== DEPENDENCY_EDGE_CAPABILITY) {
    return {
      kind: "rejected",
      error: new DependencyLedgerRejectedError({
        reason: "capability_mismatch",
        remediation: "verify_producer_capability",
        safe_code: "capability_mismatch",
      }),
    };
  }

  if (ingest.replay) {
    const existing = input.state.edgesByEventId.get(input.envelope.header.event_id);
    input.state.metrics = {
      ...input.state.metrics,
      duplicate_replays: input.state.metrics.duplicate_replays + 1,
    };
    if (existing !== undefined) {
      input.state.streamConsumers.set(input.envelope.header.stream_id, ingest.state);
      return {
        kind: "accepted",
        edge: existing,
        replay: true,
        streamState: ingest.state,
      };
    }
  }

  let body;
  try {
    body = decodeDependencyEdgeBody(input.envelope.body);
    assertMixedMinor(body.schema_minor);
  } catch (error) {
    return {
      kind: "rejected",
      error: new DependencyLedgerRejectedError({
        reason: "invalid_dependency_edge_body",
        remediation: "fix_producer_payload",
        safe_code: "invalid_dependency_edge_body",
      }),
    };
  }

  if (body.edge_kind === "invalidation" && body.invalidation === undefined) {
    return {
      kind: "rejected",
      error: new DependencyLedgerRejectedError({
        reason: "invalid_invalidation_edge",
        safe_code: "invalid_invalidation_edge",
      }),
    };
  }

  const derivativeKeyValue = derivativeKey(body.derivative);
  const edge: LedgerEdgeRecord = {
    edge_id: body.edge_id,
    edge_kind: body.edge_kind,
    event_id: input.envelope.header.event_id,
    signing_key_id: input.envelope.header.signing_key_id,
    producer: input.envelope.header.producer,
    derivative_key: derivativeKeyValue,
    derivative: body.derivative,
    required_edge_ids: body.required_edge_ids,
    source_watermark: body.source_watermark,
    ...(body.invalidation !== undefined ? { invalidation: body.invalidation } : {}),
    accepted_at_ms: input.acceptedAtMs,
    schema_minor: body.schema_minor,
  };

  if (input.state.edgesByEdgeId.has(body.edge_id)) {
    const existing = input.state.edgesByEdgeId.get(body.edge_id)!;
    if (existing.event_id !== edge.event_id) {
      return {
        kind: "rejected",
        error: new DependencyLedgerRejectedError({
          reason: "edge_id_conflict",
          safe_code: "edge_id_conflict",
        }),
      };
    }
  }

  input.state.edgesByEventId.set(edge.event_id, edge);
  input.state.edgesByEdgeId.set(edge.edge_id, edge);
  input.state.streamConsumers.set(input.envelope.header.stream_id, ingest.state);
  indexDerivativeEdge(input.state, edge);

  if (
    body.edge_kind === "invalidation" &&
    body.invalidation?.reason === "signing_key_compromised" &&
    body.invalidation.compromised_signing_key_id !== undefined
  ) {
    applyCompromiseDenial(
      input.state,
      body.invalidation.compromised_signing_key_id,
      input.acceptedAtMs,
    );
  } else if (
    body.edge_kind === "invalidation" &&
    body.invalidation?.reason === "collection_equivalence_revoked" &&
    body.invalidation.equivalence_digest !== undefined
  ) {
    applyEquivalenceRevocation(
      input.state,
      body.invalidation.equivalence_digest,
      input.acceptedAtMs,
    );
  } else {
    refreshDerivativeClosure(input.state, derivativeKeyValue, input.acceptedAtMs);
  }

  return {
    kind: "accepted",
    edge,
    replay: false,
    streamState: ingest.state,
  };
};

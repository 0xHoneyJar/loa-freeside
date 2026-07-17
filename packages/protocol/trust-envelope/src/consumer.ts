import type { StreamEpochBaseline, TrustEnvelope } from "./contracts.js";
import { TrustEnvelopeRejectedError } from "./errors.js";
import { ServiceKeyRegistry } from "./registry.js";
import { TRUST_STREAM_MIN_RETENTION_MS } from "./version.js";
import { verifyStreamEpochBaseline, verifyTrustEnvelope } from "./verify.js";

export interface StreamConsumerState {
  readonly streamId: string;
  streamEpoch: number;
  highestContiguousSequence: number;
  readonly gaps: Set<number>;
  readonly seenEventIds: Set<string>;
  baselineInstalled: boolean;
  readonly retainedAcceptedAtMs: number[];
}

export interface IngestTrustEnvelopeInput {
  readonly envelope: TrustEnvelope;
  readonly registry: ServiceKeyRegistry;
  readonly acceptedAtMs: number;
  readonly state: StreamConsumerState;
  readonly retentionMs?: number;
}

export type IngestTrustEnvelopeResult =
  | { readonly kind: "accepted"; readonly state: StreamConsumerState; readonly replay: boolean }
  | {
      readonly kind: "rejected";
      readonly error: TrustEnvelopeRejectedError;
      readonly state: StreamConsumerState;
    };

export const createStreamConsumerState = (
  streamId: string,
  streamEpoch = 1,
): StreamConsumerState => ({
  streamId,
  streamEpoch,
  highestContiguousSequence: 0,
  gaps: new Set<number>(),
  seenEventIds: new Set<string>(),
  baselineInstalled: streamEpoch === 1,
  retainedAcceptedAtMs: [],
});

const cloneState = (state: StreamConsumerState): StreamConsumerState => ({
  ...state,
  gaps: new Set(state.gaps),
  seenEventIds: new Set(state.seenEventIds),
  retainedAcceptedAtMs: [...state.retainedAcceptedAtMs],
});

export const ingestTrustEnvelope = (
  input: IngestTrustEnvelopeInput,
): IngestTrustEnvelopeResult => {
  const state = cloneState(input.state);
  const retentionMs = input.retentionMs ?? TRUST_STREAM_MIN_RETENTION_MS;

  try {
    verifyTrustEnvelope({
      envelope: input.envelope,
      registry: input.registry,
      acceptedAtMs: input.acceptedAtMs,
    });
  } catch (error) {
    if (error instanceof TrustEnvelopeRejectedError) {
      return { kind: "rejected", error, state: input.state };
    }
    throw error;
  }

  if (input.envelope.header.stream_id !== state.streamId) {
    return {
      kind: "rejected",
      error: new TrustEnvelopeRejectedError({ reason: "epoch_mismatch" }),
      state: input.state,
    };
  }

  if (input.envelope.header.stream_epoch < state.streamEpoch) {
    return {
      kind: "rejected",
      error: new TrustEnvelopeRejectedError({
        reason: "epoch_resume_forbidden",
        remediation: "install_epoch_baseline",
      }),
      state: input.state,
    };
  }

  if (input.envelope.header.stream_epoch > state.streamEpoch) {
    return {
      kind: "rejected",
      error: new TrustEnvelopeRejectedError({
        reason: "epoch_baseline_required",
        remediation: "install_epoch_baseline",
      }),
      state: input.state,
    };
  }

  if (state.seenEventIds.has(input.envelope.header.event_id)) {
    return {
      kind: "rejected",
      error: new TrustEnvelopeRejectedError({ reason: "event_id_replay" }),
      state: input.state,
    };
  }

  const oldestRetained = state.retainedAcceptedAtMs[0];
  if (
    oldestRetained !== undefined &&
    input.acceptedAtMs - oldestRetained > retentionMs
  ) {
    return {
      kind: "rejected",
      error: new TrustEnvelopeRejectedError({
        reason: "retention_violation",
        remediation: "request_replay_range",
      }),
      state: input.state,
    };
  }

  state.seenEventIds.add(input.envelope.header.event_id);
  state.retainedAcceptedAtMs.push(input.acceptedAtMs);

  if (!input.envelope.header.trust_stream) {
    return { kind: "accepted", state, replay: false };
  }

  const sequence = input.envelope.header.sequence;
  if (sequence <= state.highestContiguousSequence) {
    return {
      kind: "rejected",
      error: new TrustEnvelopeRejectedError({ reason: "sequence_reuse" }),
      state: input.state,
    };
  }

  const expected = state.highestContiguousSequence + 1;
  if (sequence > expected) {
    for (let gap = expected; gap < sequence; gap += 1) {
      state.gaps.add(gap);
    }
    return {
      kind: "rejected",
      error: new TrustEnvelopeRejectedError({
        reason: "sequence_gap",
        remediation: "request_replay_range",
      }),
      state,
    };
  }

  state.highestContiguousSequence = sequence;
  state.gaps.delete(sequence);
  while (state.gaps.has(state.highestContiguousSequence + 1)) {
    state.highestContiguousSequence += 1;
    state.gaps.delete(state.highestContiguousSequence);
  }

  return { kind: "accepted", state, replay: false };
};

export interface InstallEpochBaselineInput {
  readonly baseline: StreamEpochBaseline;
  readonly registry: ServiceKeyRegistry;
  readonly acceptedAtMs: number;
  readonly state: StreamConsumerState;
  readonly expectedBaselineDigest: string;
}

export const installEpochBaseline = (
  input: InstallEpochBaselineInput,
): StreamConsumerState => {
  verifyStreamEpochBaseline({
    baseline: input.baseline,
    registry: input.registry,
    acceptedAtMs: input.acceptedAtMs,
    previousEpoch: input.state.streamEpoch,
    expectedBaselineDigest: input.expectedBaselineDigest,
  });

  return {
    ...input.state,
    streamEpoch: input.baseline.stream_epoch,
    highestContiguousSequence: input.baseline.highest_sequence,
    gaps: new Set<number>(),
    baselineInstalled: true,
  };
};

export const requestGapRepairRange = (
  state: StreamConsumerState,
): { fromSequence: number; toSequence: number } | undefined => {
  if (state.gaps.size === 0) return undefined;
  const sorted = [...state.gaps].sort((left, right) => left - right);
  const fromSequence = sorted[0];
  const toSequence = sorted[sorted.length - 1];
  if (fromSequence === undefined || toSequence === undefined) return undefined;
  return { fromSequence, toSequence };
};

export const replayEnvelopeIdempotently = (
  input: IngestTrustEnvelopeInput & { readonly prior: TrustEnvelope },
): IngestTrustEnvelopeResult => {
  if (input.prior.header.event_id !== input.envelope.header.event_id) {
    return {
      kind: "rejected",
      error: new TrustEnvelopeRejectedError({ reason: "event_id_replay" }),
      state: input.state,
    };
  }
  return ingestTrustEnvelope(input);
};

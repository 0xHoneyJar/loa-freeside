import type {
  DerivativeClosureRecord,
  DependencyLedgerInboxState,
  LedgerEdgeRecord,
} from "./contracts.js";
import { derivativeKey } from "./contracts.js";
import { DEFAULT_EDGE_REPAIR_DEADLINE_MS } from "./version.js";

const watermarkKey = (watermark: LedgerEdgeRecord["source_watermark"]): string =>
  `${watermark.stream_id}#${watermark.stream_epoch}`;

const watermarkSatisfied = (
  required: LedgerEdgeRecord["source_watermark"],
  observed: LedgerEdgeRecord["source_watermark"] | undefined,
): boolean => {
  if (observed === undefined) return false;
  if (observed.stream_id !== required.stream_id) return false;
  if (observed.stream_epoch !== required.stream_epoch) return false;
  return observed.sequence >= required.sequence;
};

const collectRequiredEdges = (
  edges: readonly LedgerEdgeRecord[],
): readonly string[] => {
  const required = new Set<string>();
  for (const edge of edges) {
    for (const edgeId of edge.required_edge_ids) {
      required.add(edgeId);
    }
  }
  return [...required];
};

export const evaluateDerivativeClosure = (
  derivativeKeyValue: string,
  edges: readonly LedgerEdgeRecord[],
  nowMs: number,
  existing?: DerivativeClosureRecord,
): DerivativeClosureRecord => {
  const derivative = edges[0]?.derivative ?? existing?.derivative;
  if (derivative === undefined) {
    throw new Error(`no derivative material for ${derivativeKeyValue}`);
  }

  const receivedEdgeIds = [...new Set(edges.map((edge) => edge.edge_id))];
  const requiredEdgeIds = collectRequiredEdges(edges);
  const missingRequired = requiredEdgeIds.filter(
    (edgeId) => !receivedEdgeIds.includes(edgeId),
  );

  const sourceWatermarks: Record<string, LedgerEdgeRecord["source_watermark"]> = {};
  for (const edge of edges) {
    const key = watermarkKey(edge.source_watermark);
    const prior = sourceWatermarks[key];
    if (
      prior === undefined ||
      edge.source_watermark.sequence > prior.sequence
    ) {
      sourceWatermarks[key] = edge.source_watermark;
    }
  }

  for (const edge of edges) {
    if (edge.edge_kind !== "invalidation" || edge.invalidation === undefined) {
      continue;
    }
    return {
      derivative_key: derivativeKeyValue,
      derivative,
      required_edge_ids: requiredEdgeIds,
      received_edge_ids: receivedEdgeIds,
      source_watermarks: sourceWatermarks,
      state: "denied",
      fulfillable: false,
      denied_reason: edge.invalidation.reason,
      quarantine_reason: edge.invalidation.reason,
    };
  }

  if (missingRequired.length > 0) {
    return {
      derivative_key: derivativeKeyValue,
      derivative,
      required_edge_ids: requiredEdgeIds,
      received_edge_ids: receivedEdgeIds,
      source_watermarks: sourceWatermarks,
      state: "quarantined",
      fulfillable: false,
      quarantine_reason: "missing_required_edges",
      repair_deadline_ms: (existing?.repair_deadline_ms ?? nowMs) + DEFAULT_EDGE_REPAIR_DEADLINE_MS,
    };
  }

  const delayedWatermark = edges.some(
    (edge) =>
      !watermarkSatisfied(
        edge.source_watermark,
        sourceWatermarks[watermarkKey(edge.source_watermark)],
      ),
  );
  if (delayedWatermark) {
    return {
      derivative_key: derivativeKeyValue,
      derivative,
      required_edge_ids: requiredEdgeIds,
      received_edge_ids: receivedEdgeIds,
      source_watermarks: sourceWatermarks,
      state: "quarantined",
      fulfillable: false,
      quarantine_reason: "source_watermark_gap",
      repair_deadline_ms: (existing?.repair_deadline_ms ?? nowMs) + DEFAULT_EDGE_REPAIR_DEADLINE_MS,
    };
  }

  return {
    derivative_key: derivativeKeyValue,
    derivative,
    required_edge_ids: requiredEdgeIds,
    received_edge_ids: receivedEdgeIds,
    source_watermarks: sourceWatermarks,
    state: "closed",
    fulfillable: true,
  };
};

export const applyCompromiseDenial = (
  state: DependencyLedgerInboxState,
  compromisedSigningKeyId: string,
  nowMs: number,
): readonly DerivativeClosureRecord[] => {
  const affected = state.reverseBySigningKey.get(compromisedSigningKeyId);
  if (affected === undefined || affected.size === 0) return [];

  const updated: DerivativeClosureRecord[] = [];
  for (const key of affected) {
    const edges = [...state.edgesByEdgeId.values()].filter(
      (edge) => edge.derivative_key === key,
    );
    const denied = evaluateDerivativeClosure(key, edges, nowMs, state.derivatives.get(key));
    const record: DerivativeClosureRecord = {
      ...denied,
      state: "denied",
      fulfillable: false,
      denied_reason: "signing_key_compromised",
      quarantine_reason: "signing_key_compromised",
    };
    state.derivatives.set(key, record);
    updated.push(record);
  }
  recomputeMetrics(state);
  return updated;
};

export const applyEquivalenceRevocation = (
  state: DependencyLedgerInboxState,
  equivalenceDigest: string,
  nowMs: number,
): readonly DerivativeClosureRecord[] => {
  const affected = state.reverseByEquivalenceDigest.get(equivalenceDigest);
  if (affected === undefined || affected.size === 0) return [];

  const updated: DerivativeClosureRecord[] = [];
  for (const key of affected) {
    const edges = [...state.edgesByEdgeId.values()].filter(
      (edge) => edge.derivative_key === key,
    );
    const denied: DerivativeClosureRecord = {
      derivative_key: key,
      derivative: edges[0]?.derivative ?? state.derivatives.get(key)!.derivative,
      required_edge_ids: collectRequiredEdges(edges),
      received_edge_ids: edges.map((edge) => edge.edge_id),
      source_watermarks: {},
      state: "denied",
      fulfillable: false,
      denied_reason: "collection_equivalence_revoked",
      quarantine_reason: "collection_equivalence_revoked",
      repair_deadline_ms: nowMs,
    };
    state.derivatives.set(key, denied);
    updated.push(denied);
  }
  recomputeMetrics(state);
  return updated;
};

export const recomputeMetrics = (state: DependencyLedgerInboxState): void => {
  let quarantined = 0;
  let denied = 0;
  let closed = 0;
  for (const record of state.derivatives.values()) {
    if (record.state === "quarantined") quarantined += 1;
    if (record.state === "denied") denied += 1;
    if (record.state === "closed") closed += 1;
  }

  state.metrics = {
    ...state.metrics,
    quarantined_derivatives: quarantined,
    denied_derivatives: denied,
    closed_derivatives: closed,
  };
};

export const indexDerivativeEdge = (
  state: DependencyLedgerInboxState,
  edge: LedgerEdgeRecord,
): void => {
  const signingKeys = state.reverseBySigningKey.get(edge.signing_key_id) ?? new Set<string>();
  signingKeys.add(edge.derivative_key);
  state.reverseBySigningKey.set(edge.signing_key_id, signingKeys);

  const equivalenceDigest = edge.invalidation?.equivalence_digest;
  if (equivalenceDigest !== undefined) {
    const equivalents =
      state.reverseByEquivalenceDigest.get(equivalenceDigest) ?? new Set<string>();
    equivalents.add(edge.derivative_key);
    state.reverseByEquivalenceDigest.set(equivalenceDigest, equivalents);
  }
};

export const refreshDerivativeClosure = (
  state: DependencyLedgerInboxState,
  derivativeKeyValue: string,
  nowMs: number,
): DerivativeClosureRecord => {
  const edges = [...state.edgesByEdgeId.values()].filter(
    (edge) => edge.derivative_key === derivativeKeyValue,
  );
  const record = evaluateDerivativeClosure(
    derivativeKeyValue,
    edges,
    nowMs,
    state.derivatives.get(derivativeKeyValue),
  );
  state.derivatives.set(derivativeKeyValue, record);
  recomputeMetrics(state);
  return record;
};

export { derivativeKey };

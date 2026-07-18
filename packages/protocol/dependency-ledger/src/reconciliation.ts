import type {
  DependencyLedgerInboxState,
  LedgerEdgeRecord,
} from "./contracts.js";
import { refreshDerivativeClosure } from "./closure.js";

export interface ReconciliationExpectation {
  readonly derivative_key: string;
  readonly expected_edge_ids: readonly string[];
  readonly expected_watermark?: LedgerEdgeRecord["source_watermark"];
}

export interface ReconciliationFinding {
  readonly kind:
    | "lost_edge"
    | "delayed_edge"
    | "conflicting_watermark"
    | "orphan_edge"
    | "backfill_complete";
  readonly derivative_key: string;
  readonly edge_id?: string;
  readonly detail: string;
}

export interface ReconciliationReport {
  readonly findings: readonly ReconciliationFinding[];
  readonly quarantined: readonly string[];
}

export const reconcileLedger = (
  state: DependencyLedgerInboxState,
  expectations: readonly ReconciliationExpectation[],
  nowMs: number,
): ReconciliationReport => {
  const findings: ReconciliationFinding[] = [];
  const quarantined: string[] = [];

  for (const expectation of expectations) {
    const received = [...state.edgesByEdgeId.values()].filter(
      (edge) => edge.derivative_key === expectation.derivative_key,
    );
    const receivedIds = new Set(received.map((edge) => edge.edge_id));

    for (const expectedEdgeId of expectation.expected_edge_ids) {
      if (!receivedIds.has(expectedEdgeId)) {
        findings.push({
          kind: "lost_edge",
          derivative_key: expectation.derivative_key,
          edge_id: expectedEdgeId,
          detail: "expected producer outbox edge missing from Ordering ledger",
        });
        state.metrics = {
          ...state.metrics,
          lost_edges: state.metrics.lost_edges + 1,
          pending_edges: state.metrics.pending_edges + 1,
        };
        quarantined.push(expectation.derivative_key);
      }
    }

    if (expectation.expected_watermark !== undefined) {
      const observed = received.find(
        (edge) =>
          edge.source_watermark.stream_id === expectation.expected_watermark!.stream_id &&
          edge.source_watermark.stream_epoch === expectation.expected_watermark!.stream_epoch,
      );
      if (
        observed !== undefined &&
        observed.source_watermark.sequence < expectation.expected_watermark.sequence
      ) {
        findings.push({
          kind: "delayed_edge",
          derivative_key: expectation.derivative_key,
          detail: "ledger watermark lags producer outbox",
        });
        quarantined.push(expectation.derivative_key);
      } else if (observed === undefined && expectation.expected_edge_ids.length > 0) {
        findings.push({
          kind: "delayed_edge",
          derivative_key: expectation.derivative_key,
          detail: "no watermark observed for expected stream",
        });
        quarantined.push(expectation.derivative_key);
      }
    }

    const missing = expectation.expected_edge_ids.filter((id) => !receivedIds.has(id));
    if (missing.length === 0 && expectation.expected_edge_ids.length > 0) {
      findings.push({
        kind: "backfill_complete",
        derivative_key: expectation.derivative_key,
        detail: "expected edge set present after repair",
      });
    }
  }

  for (const derivativeKey of new Set(quarantined)) {
    refreshDerivativeClosure(state, derivativeKey, nowMs);
  }

  return { findings, quarantined: [...new Set(quarantined)] };
};

export const findOrphanEdges = (
  state: DependencyLedgerInboxState,
  knownDerivativeKeys: ReadonlySet<string>,
): readonly ReconciliationFinding[] =>
  [...state.edgesByEdgeId.values()]
    .filter((edge) => !knownDerivativeKeys.has(edge.derivative_key))
    .map((edge) => ({
      kind: "orphan_edge" as const,
      derivative_key: edge.derivative_key,
      edge_id: edge.edge_id,
      detail: "edge references derivative unknown to reconciliation scope",
    }));

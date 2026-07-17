import type {
  DependencyLedgerInboxState,
  DerivativeClosureRecord,
  LedgerEdgeRecord,
  QuarantineMetrics,
  ReconciliationExpectation,
  ReconciliationReport,
} from "@freeside/dependency-ledger-protocol";
import {
  createDependencyLedgerInboxState,
  ingestDependencyEdgeEnvelope,
  reconcileLedger,
} from "@freeside/dependency-ledger-protocol";
import type { TrustEnvelope } from "@freeside/trust-envelope-protocol";
import type {
  KeyCustodyClass,
  PinnedKeyRegistry,
  TimeHealthSnapshot,
} from "@freeside/signing-key-custody-protocol";

export interface DependencyLedgerStore {
  ingestEnvelope(input: {
    envelope: TrustEnvelope;
    pinnedRegistry: PinnedKeyRegistry;
    timeHealth: TimeHealthSnapshot;
    acceptedAtMs: number;
    intakeContext: KeyCustodyClass;
  }): ReturnType<typeof ingestDependencyEdgeEnvelope>;
  getDerivative(derivativeKey: string): DerivativeClosureRecord | undefined;
  getEdgeByEventId(eventId: string): LedgerEdgeRecord | undefined;
  reconcile(
    expectations: readonly ReconciliationExpectation[],
    nowMs: number,
  ): ReconciliationReport;
  snapshotMetrics(): QuarantineMetrics;
  snapshotState(): DependencyLedgerInboxState;
}

export class InMemoryDependencyLedgerStore implements DependencyLedgerStore {
  readonly #state: DependencyLedgerInboxState = createDependencyLedgerInboxState();

  ingestEnvelope(input: {
    envelope: TrustEnvelope;
    pinnedRegistry: PinnedKeyRegistry;
    timeHealth: TimeHealthSnapshot;
    acceptedAtMs: number;
    intakeContext: KeyCustodyClass;
  }) {
    return ingestDependencyEdgeEnvelope({
      envelope: input.envelope,
      pinnedRegistry: input.pinnedRegistry,
      timeHealth: input.timeHealth,
      acceptedAtMs: input.acceptedAtMs,
      state: this.#state,
      intakeContext: input.intakeContext,
    });
  }

  getDerivative(derivativeKey: string): DerivativeClosureRecord | undefined {
    return this.#state.derivatives.get(derivativeKey);
  }

  getEdgeByEventId(eventId: string): LedgerEdgeRecord | undefined {
    return this.#state.edgesByEventId.get(eventId);
  }

  reconcile(
    expectations: readonly ReconciliationExpectation[],
    nowMs: number,
  ): ReconciliationReport {
    return reconcileLedger(this.#state, expectations, nowMs);
  }

  snapshotMetrics(): QuarantineMetrics {
    return { ...this.#state.metrics };
  }

  snapshotState(): DependencyLedgerInboxState {
    return this.#state;
  }
}

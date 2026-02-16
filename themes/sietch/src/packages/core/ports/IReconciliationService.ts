/**
 * IReconciliationService — Cross-System Reconciliation Port
 *
 * ADR-008 reconciliation: alert-only, never auto-correct.
 * Three conservation checks + cross-system consistency.
 *
 * SDD refs: §SS4.6
 * PRD refs: FR-9, FR-10
 *
 * @module core/ports/IReconciliationService
 */

// =============================================================================
// Types
// =============================================================================

export type ReconciliationStatus = 'passed' | 'divergence_detected' | 'error';

export interface ReconciliationCheck {
  name: string;
  status: 'passed' | 'failed';
  details: Record<string, unknown>;
}

export interface ReconciliationResult {
  id: string;
  startedAt: string;
  finishedAt: string;
  status: ReconciliationStatus;
  checks: ReconciliationCheck[];
  divergences: string[];
}

// =============================================================================
// IReconciliationService Interface
// =============================================================================

export interface IReconciliationService {
  /**
   * Run full reconciliation suite.
   * Checks lot conservation, receivable balances, budget consistency.
   * Emits ReconciliationCompleted or ReconciliationDivergence event.
   * Results persisted to reconciliation_runs table.
   */
  reconcile(): Promise<ReconciliationResult>;

  /**
   * Get reconciliation history.
   */
  getHistory(limit?: number): Promise<ReconciliationResult[]>;
}

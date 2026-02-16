/**
 * IAgentBudgetService — Agent Budget Service Port
 *
 * Per-agent daily spending caps with circuit breaker protection.
 * Budget is an authorized capacity constraint (not conserved funds).
 * The credit ledger remains the single source of truth for actual funds.
 *
 * Circuit states:
 *   closed  — normal operation, spending allowed
 *   warning — 80% of daily cap reached, spending still allowed
 *   open    — 100% of daily cap reached, spending rejected
 *
 * SDD refs: §SS4.2
 * PRD refs: FR-2
 *
 * @module packages/core/ports/IAgentBudgetService
 */

// =============================================================================
// Types
// =============================================================================

export type CircuitState = 'closed' | 'warning' | 'open';

export interface BudgetCheckResult {
  allowed: boolean;
  currentSpendMicro: bigint;
  dailyCapMicro: bigint;
  remainingMicro: bigint;
  circuitState: CircuitState;
}

export interface SpendingLimit {
  accountId: string;
  dailyCapMicro: bigint;
  currentSpendMicro: bigint;
  windowStart: string;
  windowDurationSeconds: number;
  circuitState: CircuitState;
}

// =============================================================================
// IAgentBudgetService Interface
// =============================================================================

export interface IAgentBudgetService {
  /**
   * Set or update the daily spending cap for an agent account.
   * Creates the spending limit row if it doesn't exist.
   */
  setDailyCap(accountId: string, capMicro: bigint): Promise<void>;

  /**
   * Get the current daily cap for an agent account.
   * Returns null if no cap is configured.
   */
  getDailyCap(accountId: string): Promise<SpendingLimit | null>;

  /**
   * Check if an agent can spend the given amount.
   * Uses Redis advisory fast-path with SQLite authoritative fallback.
   * Returns allowed=false when circuit is open.
   */
  checkBudget(accountId: string, amountMicro: bigint): Promise<BudgetCheckResult>;

  /**
   * Record a finalization against the agent's budget (standalone transaction).
   * Idempotent via (account_id, reservation_id) PK.
   */
  recordFinalization(accountId: string, reservationId: string, amountMicro: bigint): Promise<void>;

  /**
   * Record a finalization within an external transaction.
   * Used by AgentAwareFinalizer for atomic finalize + budget accounting.
   */
  recordFinalizationInTransaction(
    tx: { prepare(sql: string): any },
    accountId: string,
    reservationId: string,
    amountMicro: bigint,
  ): void;

  /**
   * Reset expired spending windows.
   * Recomputes current_spend_micro from finalizations within the new window.
   * Called by the budget-window-reset cron job.
   */
  resetExpiredWindows(): Promise<number>;

  /**
   * Get the current circuit breaker state for an agent.
   */
  getCircuitState(accountId: string): Promise<CircuitState | null>;
}

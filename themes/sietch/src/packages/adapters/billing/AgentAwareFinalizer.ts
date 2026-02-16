/**
 * AgentAwareFinalizer — Atomic finalize + budget accounting wrapper
 *
 * Single application service that ALL agent finalize entrypoints MUST use.
 * Wraps CreditLedgerAdapter.finalizeInTransaction() + AgentBudgetService
 * .recordFinalizationInTransaction() in the same BEGIN IMMEDIATE transaction.
 *
 * Non-agent accounts pass through to standard finalize().
 *
 * SDD refs: §SS4.2, §SS6.2
 * Sprint refs: Task 6.2
 *
 * @module adapters/billing/AgentAwareFinalizer
 */

import type Database from 'better-sqlite3';
import { logger } from '../../../utils/logger.js';
import type { ICreditLedgerService, FinalizeOptions, FinalizeResult } from '../../core/ports/ICreditLedgerService.js';
import type { AgentBudgetService } from './AgentBudgetService.js';

// =============================================================================
// Types
// =============================================================================

export interface AgentAwareFinalizerDeps {
  db: Database.Database;
  ledger: ICreditLedgerService;
  budgetService: AgentBudgetService;
}

export interface AgentFinalizeOptions extends FinalizeOptions {
  /** Account ID for the agent (required to determine if budget tracking applies) */
  accountId: string;
  /** Whether this account is an agent entity. If false, standard finalize is used. */
  isAgent: boolean;
}

// =============================================================================
// AgentAwareFinalizer
// =============================================================================

export class AgentAwareFinalizer {
  private db: Database.Database;
  private ledger: ICreditLedgerService;
  private budgetService: AgentBudgetService;

  constructor(deps: AgentAwareFinalizerDeps) {
    this.db = deps.db;
    this.ledger = deps.ledger;
    this.budgetService = deps.budgetService;
  }

  /**
   * Finalize a reservation with optional budget accounting.
   *
   * For agent accounts: both finalize and budget recording happen atomically
   * in one BEGIN IMMEDIATE transaction. If either fails, both roll back.
   *
   * For non-agent accounts: delegates directly to standard finalize().
   *
   * Budget exceeded at finalize time: finalize succeeds but circuit opens
   * immediately (next reserve will be rejected by checkBudget).
   */
  async finalize(
    reservationId: string,
    actualCostMicro: bigint,
    opts: AgentFinalizeOptions,
  ): Promise<FinalizeResult> {
    if (!opts.isAgent) {
      // Non-agent: standard finalize path, no budget accounting
      return this.ledger.finalize(reservationId, actualCostMicro, opts);
    }

    // Agent: atomic finalize + budget accounting
    const result = this.db.transaction(() => {
      // 1. Finalize within this transaction
      const finalizeResult = this.ledger.finalizeInTransaction(
        this.db,
        reservationId,
        actualCostMicro,
        opts,
      );

      // 2. Record budget finalization within same transaction
      this.budgetService.recordFinalizationInTransaction(
        this.db,
        opts.accountId,
        reservationId,
        actualCostMicro,
      );

      return finalizeResult;
    })();

    // Invalidate Redis cache async (non-blocking)
    this.invalidateRedisCache(opts.accountId);

    logger.info({
      event: 'agent_finalizer.complete',
      reservationId,
      accountId: opts.accountId,
      actualCostMicro: actualCostMicro.toString(),
    }, 'Agent-aware finalization complete');

    return result;
  }

  private invalidateRedisCache(accountId: string): void {
    // Budget service handles Redis internally on next checkBudget call
    // The TTL (60s) ensures eventual consistency
    logger.debug({ event: 'agent_finalizer.cache_note', accountId },
      'Redis budget cache will expire within TTL');
  }
}

/**
 * Budget Window Reset Job
 *
 * Hourly cron that resets expired agent spending windows.
 * Calls AgentBudgetService.resetExpiredWindows() to recompute
 * current_spend_micro from authoritative finalizations table
 * and transition circuit state back to 'closed' for new windows.
 *
 * SDD refs: §SS4.2, §SS7.1
 * Sprint refs: Task 5.4
 *
 * @module jobs/budget-window-reset
 */

import type Database from 'better-sqlite3';
import { logger as defaultLogger } from '../utils/logger.js';
import { AgentBudgetService } from '../packages/adapters/billing/AgentBudgetService.js';

// =============================================================================
// Types
// =============================================================================

export interface BudgetWindowResetConfig {
  /** SQLite database instance */
  db: Database.Database;
  /** Optional Redis client for cache invalidation */
  redis?: { get(key: string): Promise<string | null>; set(key: string, value: string, options?: { EX?: number }): Promise<unknown>; del(key: string): Promise<unknown> };
  /** Reset interval in milliseconds. Default: 3600000 (1 hour) */
  intervalMs?: number;
  /** Optional custom logger */
  logger?: typeof defaultLogger;
}

export interface BudgetWindowResetResult {
  windowsReset: number;
  durationMs: number;
}

// =============================================================================
// Budget Window Reset Job
// =============================================================================

export class BudgetWindowResetJob {
  private db: Database.Database;
  private redis: BudgetWindowResetConfig['redis'];
  private intervalMs: number;
  private logger: typeof defaultLogger;
  private timer: ReturnType<typeof setInterval> | null = null;
  private budgetService: AgentBudgetService;

  constructor(config: BudgetWindowResetConfig) {
    this.db = config.db;
    this.redis = config.redis;
    this.intervalMs = config.intervalMs ?? 3_600_000; // 1 hour
    this.logger = config.logger ?? defaultLogger;
    this.budgetService = new AgentBudgetService(this.db, this.redis);
  }

  /**
   * Execute a single window reset sweep.
   */
  async execute(): Promise<BudgetWindowResetResult> {
    const start = Date.now();

    try {
      const windowsReset = await this.budgetService.resetExpiredWindows();
      const durationMs = Date.now() - start;

      this.logger.info({
        event: 'budget_window_reset.complete',
        windowsReset,
        durationMs,
      }, `Budget window reset: ${windowsReset} windows reset in ${durationMs}ms`);

      return { windowsReset, durationMs };
    } catch (err) {
      const durationMs = Date.now() - start;
      this.logger.error({
        event: 'budget_window_reset.error',
        error: err,
        durationMs,
      }, 'Budget window reset failed');

      return { windowsReset: 0, durationMs };
    }
  }

  /**
   * Start the periodic reset job.
   */
  start(): void {
    if (this.timer) return;

    this.logger.info({
      event: 'budget_window_reset.started',
      intervalMs: this.intervalMs,
    }, `Budget window reset job started (interval: ${this.intervalMs}ms)`);

    this.timer = setInterval(() => {
      this.execute().catch(err => {
        this.logger.error({ event: 'budget_window_reset.tick_error', error: err },
          'Budget window reset tick failed');
      });
    }, this.intervalMs);
  }

  /**
   * Stop the periodic reset job.
   */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      this.logger.info({ event: 'budget_window_reset.stopped' },
        'Budget window reset job stopped');
    }
  }
}

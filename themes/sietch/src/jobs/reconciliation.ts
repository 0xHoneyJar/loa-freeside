/**
 * Reconciliation Cron Job
 *
 * Runs ReconciliationService.reconcile() every 6 hours.
 * Divergences are logged and emitted as events — never auto-corrected (ADR-008).
 *
 * SDD refs: §SS4.6
 * Sprint refs: Task 9.3
 *
 * @module jobs/reconciliation
 */

import type Database from 'better-sqlite3';
import { logger as defaultLogger } from '../utils/logger.js';
import { ReconciliationService } from '../packages/adapters/billing/ReconciliationService.js';
import type { BillingEventEmitter } from '../packages/adapters/billing/BillingEventEmitter.js';

export interface ReconciliationJobConfig {
  db: Database.Database;
  eventEmitter?: BillingEventEmitter;
  intervalMs?: number;
  logger?: typeof defaultLogger;
}

export class ReconciliationJob {
  private service: ReconciliationService;
  private intervalMs: number;
  private logger: typeof defaultLogger;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(config: ReconciliationJobConfig) {
    this.service = new ReconciliationService(config.db, config.eventEmitter);
    this.intervalMs = config.intervalMs ?? 21_600_000; // 6 hours
    this.logger = config.logger ?? defaultLogger;
  }

  async execute() {
    try {
      const result = await this.service.reconcile();
      this.logger.info({
        event: 'reconciliation_job.complete',
        status: result.status,
        checks: result.checks.length,
        divergences: result.divergences.length,
      }, `Reconciliation: ${result.status}`);
      return result;
    } catch (err) {
      this.logger.error({ event: 'reconciliation_job.error', error: err }, 'Reconciliation job failed');
      return null;
    }
  }

  start(): void {
    if (this.timer) return;
    this.logger.info({ event: 'reconciliation_job.started', intervalMs: this.intervalMs },
      `Reconciliation job started (interval: ${this.intervalMs}ms)`);
    this.timer = setInterval(() => { this.execute(); }, this.intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      this.logger.info({ event: 'reconciliation_job.stopped' }, 'Reconciliation job stopped');
    }
  }
}

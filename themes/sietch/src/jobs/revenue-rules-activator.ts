/**
 * Revenue Rules Activator Job (Sprint 237, Task 8.4)
 *
 * Background job that checks for revenue rules in 'cooling_down' state
 * whose cooldown has elapsed, and activates them. Follows the same
 * pattern as reservation-sweeper.ts and idempotency-sweeper.ts.
 *
 * Checks every 5 minutes by default.
 *
 * SDD refs: §1.4 CreditLedgerService
 * Sprint refs: Task 8.4
 *
 * @module jobs/revenue-rules-activator
 */

import type { IRevenueRulesService } from '../packages/core/ports/IRevenueRulesService.js';
import { logger as defaultLogger } from '../utils/logger.js';

// =============================================================================
// Types
// =============================================================================

export interface RevenueRulesActivatorConfig {
  /** Revenue rules service instance */
  rulesService: IRevenueRulesService;
  /** Check interval in milliseconds. Default: 300000 (5 minutes) */
  intervalMs?: number;
  /** Optional custom logger */
  logger?: typeof defaultLogger;
}

// =============================================================================
// Activator Implementation
// =============================================================================

export function createRevenueRulesActivator(config: RevenueRulesActivatorConfig) {
  const { rulesService, intervalMs = 300_000 } = config;
  const log = config.logger ?? defaultLogger;
  let timer: ReturnType<typeof setInterval> | null = null;

  /**
   * Execute one activation cycle.
   * Checks for cooling_down rules ready to activate.
   */
  async function check(): Promise<{ activatedCount: number }> {
    try {
      const activated = await rulesService.activateReadyRules();

      if (activated.length > 0) {
        log.info({
          event: 'billing.revenue_rules.activator.cycle',
          activated_count: activated.length,
          rule_ids: activated.map(r => r.id),
        }, `Revenue rules activator: ${activated.length} rule(s) activated`);
      }

      return { activatedCount: activated.length };
    } catch (err) {
      log.error({
        err,
        event: 'billing.revenue_rules.activator.error',
      }, 'Revenue rules activator error');
      return { activatedCount: 0 };
    }
  }

  return {
    /** Start the activator on the configured interval */
    start() {
      if (timer) return;
      log.info({
        intervalMs,
        event: 'billing.revenue_rules.activator.start',
      }, 'Revenue rules activator started');
      timer = setInterval(() => { check(); }, intervalMs);
    },

    /** Stop the activator */
    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
        log.info({
          event: 'billing.revenue_rules.activator.stop',
        }, 'Revenue rules activator stopped');
      }
    },

    /** Run a single check (for testing) */
    checkOnce: check,
  };
}

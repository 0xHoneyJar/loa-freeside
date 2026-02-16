/**
 * Fraud Rules Activator — Background Job
 *
 * Periodically checks for fraud rules whose cooldown period has elapsed
 * and auto-activates them (same pattern as revenue-rules-activator).
 *
 * SDD refs: §4.4 Fraud Rules Engine
 * Sprint refs: Task 15.5
 *
 * @module jobs/fraud-rules-activator
 */

import { logger as defaultLogger } from '../utils/logger.js';
import type { FraudRulesService } from '../packages/adapters/billing/FraudRulesService.js';

// =============================================================================
// Types
// =============================================================================

export interface FraudRulesActivatorConfig {
  /** Fraud rules service instance */
  rulesService: FraudRulesService;
  /** Check interval in milliseconds. Default: 300000 (5 minutes) */
  intervalMs?: number;
  /** Optional custom logger */
  logger?: typeof defaultLogger;
}

interface ActivatorResult {
  activatedCount: number;
}

// =============================================================================
// Factory
// =============================================================================

export function createFraudRulesActivator(config: FraudRulesActivatorConfig) {
  const {
    rulesService,
    intervalMs = 300_000,
    logger: log = defaultLogger,
  } = config;

  let timer: ReturnType<typeof setInterval> | null = null;

  async function check(): Promise<ActivatorResult> {
    try {
      const activated = await rulesService.activateReadyRules();

      if (activated.length > 0) {
        log.info({
          event: 'billing.fraud_rules.activator.cycle',
          activated_count: activated.length,
          rule_ids: activated.map(r => r.id),
        }, `Fraud rules activator: ${activated.length} rule(s) activated`);
      }

      return { activatedCount: activated.length };
    } catch (err) {
      log.error({
        event: 'billing.fraud_rules.activator.error',
        error: err,
      }, 'Fraud rules activator check failed');
      return { activatedCount: 0 };
    }
  }

  function start(): void {
    if (timer) return;
    log.info({
      event: 'billing.fraud_rules.activator.started',
      intervalMs,
    }, 'Fraud rules activator started');
    timer = setInterval(() => { check(); }, intervalMs);
  }

  function stop(): void {
    if (timer) {
      clearInterval(timer);
      timer = null;
      log.info({
        event: 'billing.fraud_rules.activator.stopped',
      }, 'Fraud rules activator stopped');
    }
  }

  return {
    start,
    stop,
    checkOnce: check,
  };
}

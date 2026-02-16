/**
 * Constitutional Config Activator — Background Job
 *
 * Periodically checks for system_config entries whose cooldown period has
 * elapsed and auto-activates them, superseding the previous active config.
 *
 * Follows the same pattern as fraud-rules-activator.ts.
 *
 * SDD refs: §4.1 ConstitutionalGovernanceService, §8.1 BullMQ Queues
 * Sprint refs: Sprint 276, Task 2.4
 *
 * @module jobs/config-activation
 */

import { logger as defaultLogger } from '../utils/logger.js';
import type { ConstitutionalGovernanceService } from '../packages/adapters/billing/ConstitutionalGovernanceService.js';

// =============================================================================
// Types
// =============================================================================

export interface ConfigActivatorConfig {
  /** Constitutional governance service instance */
  governanceService: ConstitutionalGovernanceService;
  /** Check interval in milliseconds. Default: 3600000 (1 hour) */
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

export function createConfigActivator(config: ConfigActivatorConfig) {
  const {
    governanceService,
    intervalMs = 3_600_000,
    logger: log = defaultLogger,
  } = config;

  let timer: ReturnType<typeof setInterval> | null = null;

  async function check(): Promise<ActivatorResult> {
    try {
      const activatedCount = await governanceService.activateExpiredCooldowns();

      if (activatedCount > 0) {
        log.info({
          event: 'constitutional.config.activator.cycle',
          activated_count: activatedCount,
        }, `Config activator: ${activatedCount} config(s) activated past cooldown`);
      }

      return { activatedCount };
    } catch (err) {
      log.error({
        event: 'constitutional.config.activator.error',
        error: err,
      }, 'Config activation check failed');
      return { activatedCount: 0 };
    }
  }

  function start(): void {
    if (timer) return;
    log.info({
      event: 'constitutional.config.activator.started',
      intervalMs,
    }, 'Config activator started');
    timer = setInterval(() => { check(); }, intervalMs);
  }

  function stop(): void {
    if (timer) {
      clearInterval(timer);
      timer = null;
      log.info({
        event: 'constitutional.config.activator.stopped',
      }, 'Config activator stopped');
    }
  }

  return {
    start,
    stop,
    checkOnce: check,
  };
}

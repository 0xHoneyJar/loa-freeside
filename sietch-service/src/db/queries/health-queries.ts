// =============================================================================
// Health Status Queries
// =============================================================================

import { getDatabase } from '../connection.js';
import type { HealthStatus } from '../../types/index.js';
import { config } from '../../config.js';
import { logger } from '../../utils/logger.js';
import { logAuditEvent } from './audit-queries.js';

/**
 * Get current health status
 */
export function getHealthStatus(): HealthStatus {
  const database = getDatabase();

  const row = database.prepare(`
    SELECT last_successful_query, last_query_attempt, consecutive_failures, in_grace_period
    FROM health_status
    WHERE id = 1
  `).get() as {
    last_successful_query: string | null;
    last_query_attempt: string | null;
    consecutive_failures: number;
    in_grace_period: number;
  };

  return {
    lastSuccessfulQuery: row.last_successful_query ? new Date(row.last_successful_query) : null,
    lastQueryAttempt: row.last_query_attempt ? new Date(row.last_query_attempt) : null,
    consecutiveFailures: row.consecutive_failures,
    inGracePeriod: row.in_grace_period === 1,
  };
}

/**
 * Update health status after successful query
 */
export function updateHealthStatusSuccess(): void {
  const database = getDatabase();

  database.prepare(`
    UPDATE health_status
    SET last_successful_query = datetime('now'),
        last_query_attempt = datetime('now'),
        consecutive_failures = 0,
        in_grace_period = 0,
        updated_at = datetime('now')
    WHERE id = 1
  `).run();
}

/**
 * Update health status after failed query
 */
export function updateHealthStatusFailure(): void {
  const database = getDatabase();

  database.prepare(`
    UPDATE health_status
    SET last_query_attempt = datetime('now'),
        consecutive_failures = consecutive_failures + 1,
        updated_at = datetime('now')
    WHERE id = 1
  `).run();

  // Check if we should enter grace period
  const health = getHealthStatus();
  if (health.lastSuccessfulQuery) {
    const hoursSinceSuccess =
      (Date.now() - health.lastSuccessfulQuery.getTime()) / (1000 * 60 * 60);
    if (hoursSinceSuccess >= config.gracePeriod.hours && !health.inGracePeriod) {
      enterGracePeriod();
    }
  }
}

/**
 * Enter grace period
 */
export function enterGracePeriod(): void {
  const database = getDatabase();

  database.prepare(`
    UPDATE health_status
    SET in_grace_period = 1,
        updated_at = datetime('now')
    WHERE id = 1
  `).run();

  logAuditEvent('grace_period_entered', { timestamp: new Date().toISOString() });
  logger.warn('Entered grace period - no revocations will occur');
}

/**
 * Exit grace period
 */
export function exitGracePeriod(): void {
  const database = getDatabase();

  database.prepare(`
    UPDATE health_status
    SET in_grace_period = 0,
        updated_at = datetime('now')
    WHERE id = 1
  `).run();

  logAuditEvent('grace_period_exited', { timestamp: new Date().toISOString() });
  logger.info('Exited grace period');
}

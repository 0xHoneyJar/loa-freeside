/**
 * Tenant Metrics Service
 * Sprint S-7: Multi-Tenancy & Integration
 *
 * Adds tenant labels to all metrics for per-tenant filtering.
 * Integrates with Prometheus via prom-client.
 */

import { Counter, Histogram, Gauge, Registry } from 'prom-client';
import type { TenantTier } from './TenantContext.js';

// --------------------------------------------------------------------------
// Metrics Registry
// --------------------------------------------------------------------------

// Use default registry for consistency with other metrics
const registry = new Registry();

// --------------------------------------------------------------------------
// Per-Tenant Metrics
// --------------------------------------------------------------------------

/**
 * Command execution counter
 */
export const tenantCommandsTotal = new Counter({
  name: 'arrakis_tenant_commands_total',
  help: 'Total commands executed per tenant',
  labelNames: ['community_id', 'tier', 'command', 'status'],
  registers: [registry],
});

/**
 * Command latency histogram
 */
export const tenantCommandLatency = new Histogram({
  name: 'arrakis_tenant_command_latency_seconds',
  help: 'Command processing latency per tenant',
  labelNames: ['community_id', 'tier', 'command'],
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [registry],
});

/**
 * Eligibility check counter
 */
export const tenantEligibilityChecks = new Counter({
  name: 'arrakis_tenant_eligibility_checks_total',
  help: 'Total eligibility checks per tenant',
  labelNames: ['community_id', 'tier', 'check_type', 'result'],
  registers: [registry],
});

/**
 * Active users gauge (per community)
 */
export const tenantActiveUsers = new Gauge({
  name: 'arrakis_tenant_active_users',
  help: 'Number of active users per tenant (last 24h)',
  labelNames: ['community_id', 'tier'],
  registers: [registry],
});

/**
 * Message processing rate
 */
export const tenantMessagesProcessed = new Counter({
  name: 'arrakis_tenant_messages_processed_total',
  help: 'Total messages processed per tenant',
  labelNames: ['community_id', 'tier', 'message_type'],
  registers: [registry],
});

/**
 * Error counter per tenant
 */
export const tenantErrors = new Counter({
  name: 'arrakis_tenant_errors_total',
  help: 'Total errors per tenant',
  labelNames: ['community_id', 'tier', 'error_type'],
  registers: [registry],
});

/**
 * Rate limit status
 */
export const tenantRateLimitStatus = new Gauge({
  name: 'arrakis_tenant_rate_limit_usage_ratio',
  help: 'Current rate limit usage ratio (0-1) per tenant',
  labelNames: ['community_id', 'tier', 'action'],
  registers: [registry],
});

// --------------------------------------------------------------------------
// Metric Helpers
// --------------------------------------------------------------------------

/**
 * Record a command execution
 */
export function recordCommand(
  communityId: string,
  tier: TenantTier,
  command: string,
  status: 'success' | 'error' | 'rate_limited',
  durationSeconds: number
): void {
  tenantCommandsTotal.inc({ community_id: communityId, tier, command, status });

  if (status === 'success') {
    tenantCommandLatency.observe({ community_id: communityId, tier, command }, durationSeconds);
  }
}

/**
 * Record an eligibility check
 */
export function recordEligibilityCheck(
  communityId: string,
  tier: TenantTier,
  checkType: 'single' | 'batch' | 'sync',
  result: 'eligible' | 'ineligible' | 'error'
): void {
  tenantEligibilityChecks.inc({ community_id: communityId, tier, check_type: checkType, result });
}

/**
 * Record a message processed
 */
export function recordMessage(
  communityId: string,
  tier: TenantTier,
  messageType: 'command' | 'event' | 'eligibility'
): void {
  tenantMessagesProcessed.inc({ community_id: communityId, tier, message_type: messageType });
}

/**
 * Record an error
 */
export function recordError(
  communityId: string,
  tier: TenantTier,
  errorType: 'handler' | 'validation' | 'rate_limit' | 'timeout' | 'unknown'
): void {
  tenantErrors.inc({ community_id: communityId, tier, error_type: errorType });
}

/**
 * Update rate limit usage ratio
 */
export function updateRateLimitUsage(
  communityId: string,
  tier: TenantTier,
  action: string,
  current: number,
  limit: number
): void {
  if (limit === -1) {
    // Unlimited - report as 0 usage
    tenantRateLimitStatus.set({ community_id: communityId, tier, action }, 0);
  } else {
    const ratio = Math.min(current / limit, 1);
    tenantRateLimitStatus.set({ community_id: communityId, tier, action }, ratio);
  }
}

/**
 * Update active users count
 */
export function updateActiveUsers(
  communityId: string,
  tier: TenantTier,
  count: number
): void {
  tenantActiveUsers.set({ community_id: communityId, tier }, count);
}

// --------------------------------------------------------------------------
// Registry Export
// --------------------------------------------------------------------------

/**
 * Get all tenant metrics as Prometheus text format
 */
export async function getTenantMetrics(): Promise<string> {
  return registry.metrics();
}

/**
 * Get the metrics registry
 */
export function getRegistry(): Registry {
  return registry;
}

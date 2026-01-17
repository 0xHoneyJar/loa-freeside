/**
 * Sandbox Metrics
 *
 * Sprint 87: Discord Server Sandboxes - Cleanup & Polish
 *
 * Prometheus-compatible metrics for sandbox operations.
 *
 * @see SDD §8.2 Monitoring & Metrics
 * @module packages/sandbox/metrics
 */

import { Counter, Histogram, Gauge, Registry } from 'prom-client';

// =============================================================================
// Registry
// =============================================================================

/**
 * Sandbox metrics registry
 *
 * Can be merged with the main application registry:
 * ```typescript
 * import { register } from 'prom-client';
 * import { sandboxRegistry } from '@arrakis/sandbox';
 * register.merge(sandboxRegistry);
 * ```
 */
export const sandboxRegistry = new Registry();

// =============================================================================
// Sandbox Lifecycle Metrics
// =============================================================================

export const sandboxesCreated = new Counter({
  name: 'sandbox_created_total',
  help: 'Total sandboxes created',
  labelNames: ['owner'] as const,
  registers: [sandboxRegistry],
});

export const sandboxesDestroyed = new Counter({
  name: 'sandbox_destroyed_total',
  help: 'Total sandboxes destroyed',
  labelNames: ['reason'] as const,
  registers: [sandboxRegistry],
});

export const sandboxesActive = new Gauge({
  name: 'sandbox_active_count',
  help: 'Currently active (running) sandboxes',
  registers: [sandboxRegistry],
});

export const sandboxCreationDuration = new Histogram({
  name: 'sandbox_creation_duration_seconds',
  help: 'Time to create a sandbox in seconds',
  buckets: [0.5, 1, 2, 5, 10, 30],
  registers: [sandboxRegistry],
});

// =============================================================================
// Cleanup Metrics
// =============================================================================

export const cleanupJobRuns = new Counter({
  name: 'sandbox_cleanup_runs_total',
  help: 'Total cleanup job executions',
  labelNames: ['status'] as const,
  registers: [sandboxRegistry],
});

export const cleanupSandboxes = new Counter({
  name: 'sandbox_cleanup_sandboxes_total',
  help: 'Total sandboxes cleaned up',
  labelNames: ['status'] as const,
  registers: [sandboxRegistry],
});

export const cleanupDuration = new Histogram({
  name: 'sandbox_cleanup_duration_seconds',
  help: 'Cleanup job duration in seconds',
  buckets: [1, 5, 10, 30, 60, 120],
  registers: [sandboxRegistry],
});

export const orphanedResourcesFound = new Gauge({
  name: 'sandbox_orphaned_resources',
  help: 'Number of orphaned resources detected',
  labelNames: ['type'] as const,
  registers: [sandboxRegistry],
});

// =============================================================================
// Schema Metrics
// =============================================================================

export const schemasCreated = new Counter({
  name: 'sandbox_schemas_created_total',
  help: 'Total PostgreSQL schemas created',
  registers: [sandboxRegistry],
});

export const schemasDropped = new Counter({
  name: 'sandbox_schemas_dropped_total',
  help: 'Total PostgreSQL schemas dropped',
  registers: [sandboxRegistry],
});

export const schemaOperationDuration = new Histogram({
  name: 'sandbox_schema_operation_duration_seconds',
  help: 'Schema operation duration in seconds',
  labelNames: ['operation'] as const,
  buckets: [0.1, 0.5, 1, 2, 5, 10],
  registers: [sandboxRegistry],
});

// =============================================================================
// Route Metrics
// =============================================================================

export const routeLookups = new Counter({
  name: 'sandbox_route_lookups_total',
  help: 'Total route lookups',
  labelNames: ['cache_hit'] as const,
  registers: [sandboxRegistry],
});

export const routeLookupDuration = new Histogram({
  name: 'sandbox_route_lookup_duration_seconds',
  help: 'Route lookup duration in seconds',
  labelNames: ['cache_hit'] as const,
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1],
  registers: [sandboxRegistry],
});

export const guildMappings = new Gauge({
  name: 'sandbox_guild_mappings_count',
  help: 'Current number of guild-to-sandbox mappings',
  registers: [sandboxRegistry],
});

// =============================================================================
// Event Routing Metrics
// =============================================================================

export const eventsRouted = new Counter({
  name: 'sandbox_events_routed_total',
  help: 'Total events routed',
  labelNames: ['destination'] as const,
  registers: [sandboxRegistry],
});

export const eventRoutingDuration = new Histogram({
  name: 'sandbox_event_routing_duration_seconds',
  help: 'Event routing duration in seconds',
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05],
  registers: [sandboxRegistry],
});

export const eventRoutingErrors = new Counter({
  name: 'sandbox_event_routing_errors_total',
  help: 'Total event routing errors',
  labelNames: ['error_type'] as const,
  registers: [sandboxRegistry],
});

// =============================================================================
// Health Metrics
// =============================================================================

export const sandboxHealthStatus = new Gauge({
  name: 'sandbox_health_status',
  help: 'Sandbox health status (0=unhealthy, 1=degraded, 2=healthy)',
  labelNames: ['sandbox_id'] as const,
  registers: [sandboxRegistry],
});

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Record sandbox creation
 */
export function recordSandboxCreated(owner: string, durationSeconds: number): void {
  sandboxesCreated.labels(owner).inc();
  sandboxCreationDuration.observe(durationSeconds);
}

/**
 * Record sandbox destruction
 */
export function recordSandboxDestroyed(reason: 'manual' | 'expired' | 'cleanup'): void {
  sandboxesDestroyed.labels(reason).inc();
}

/**
 * Record cleanup job execution
 */
export function recordCleanupRun(
  status: 'success' | 'failure',
  sandboxesCleaned: number,
  sandboxesFailed: number,
  durationSeconds: number
): void {
  cleanupJobRuns.labels(status).inc();
  cleanupSandboxes.labels('success').inc(sandboxesCleaned);
  cleanupSandboxes.labels('failure').inc(sandboxesFailed);
  cleanupDuration.observe(durationSeconds);
}

/**
 * Record route lookup
 */
export function recordRouteLookup(cacheHit: boolean, durationSeconds: number): void {
  routeLookups.labels(cacheHit ? 'true' : 'false').inc();
  routeLookupDuration.labels(cacheHit ? 'true' : 'false').observe(durationSeconds);
}

/**
 * Record event routing
 */
export function recordEventRouted(destination: 'sandbox' | 'production', durationSeconds: number): void {
  eventsRouted.labels(destination).inc();
  eventRoutingDuration.observe(durationSeconds);
}

/**
 * Update sandbox health status
 */
export function updateSandboxHealth(sandboxId: string, health: 'healthy' | 'degraded' | 'unhealthy'): void {
  const value = health === 'healthy' ? 2 : health === 'degraded' ? 1 : 0;
  sandboxHealthStatus.labels(sandboxId).set(value);
}

/**
 * Update active sandbox count
 */
export function updateActiveSandboxCount(count: number): void {
  sandboxesActive.set(count);
}

/**
 * Update guild mapping count
 */
export function updateGuildMappingCount(count: number): void {
  guildMappings.set(count);
}

/**
 * Update orphaned resource counts
 */
export function updateOrphanedResources(schemas: number, redisKeys: number): void {
  orphanedResourcesFound.labels('schema').set(schemas);
  orphanedResourcesFound.labels('redis_keys').set(redisKeys);
}

/**
 * Collect all sandbox metrics
 */
export async function collectSandboxMetrics(): Promise<string> {
  return sandboxRegistry.metrics();
}

/**
 * Drift Detection Metrics
 *
 * Sprint 123: DriftDetector Service
 *
 * Metrics for tracking ghost roles and drift detection operations.
 * Alert: Info alert if ghost_roles_count > 0 for 1 hour.
 *
 * @see grimoires/loa/sprint.md Sprint 123 Tasks 123.5, 123.6
 */

// =============================================================================
// Metrics Storage
// =============================================================================

interface DriftMetrics {
  /** Total drift checks performed */
  driftChecks: number;
  /** Ghost roles count by server */
  ghostRolesByServer: Map<string, number>;
  /** Last drift check timestamps by server */
  lastCheckByServer: Map<string, number>;
}

const metrics: DriftMetrics = {
  driftChecks: 0,
  ghostRolesByServer: new Map(),
  lastCheckByServer: new Map(),
};

// =============================================================================
// Recording Functions
// =============================================================================

/**
 * Record ghost roles for a server.
 *
 * Alert: Info alert if count > 0 for 1 hour
 *
 * @param serverId - Server ID
 * @param count - Number of ghost roles detected
 */
export function recordGhostRoles(serverId: string, count: number): void {
  metrics.ghostRolesByServer.set(serverId, count);
  metrics.lastCheckByServer.set(serverId, Date.now());
}

/**
 * Record a drift check operation.
 */
export function recordDriftCheck(): void {
  metrics.driftChecks++;
}

/**
 * Get ghost roles count for a server.
 */
export function getGhostRolesCount(serverId: string): number {
  return metrics.ghostRolesByServer.get(serverId) ?? 0;
}

/**
 * Get total ghost roles count across all servers.
 */
export function getTotalGhostRolesCount(): number {
  let total = 0;
  for (const count of metrics.ghostRolesByServer.values()) {
    total += count;
  }
  return total;
}

/**
 * Get servers with ghost roles.
 */
export function getServersWithGhostRoles(): string[] {
  const servers: string[] = [];
  for (const [serverId, count] of metrics.ghostRolesByServer.entries()) {
    if (count > 0) {
      servers.push(serverId);
    }
  }
  return servers;
}

// =============================================================================
// Metrics Export (Prometheus Format)
// =============================================================================

/**
 * Get drift metrics in Prometheus text format.
 */
export function getDriftMetricsPrometheus(): string {
  const lines: string[] = [];

  // Drift checks counter
  lines.push('# HELP sietch_drift_checks_total Total drift detection checks performed');
  lines.push('# TYPE sietch_drift_checks_total counter');
  lines.push(`sietch_drift_checks_total ${metrics.driftChecks}`);

  // Ghost roles gauge (per-server)
  // ALERT: Info if count > 0 for 1h
  lines.push('# HELP sietch_config_ghost_roles_count Number of ghost roles (deleted Discord roles in config) per server');
  lines.push('# TYPE sietch_config_ghost_roles_count gauge');
  for (const [serverId, count] of metrics.ghostRolesByServer.entries()) {
    lines.push(`sietch_config_ghost_roles_count{server_id="${serverId}"} ${count}`);
  }

  // Total ghost roles gauge
  const totalGhostRoles = getTotalGhostRolesCount();
  lines.push('# HELP sietch_config_ghost_roles_total Total ghost roles across all servers');
  lines.push('# TYPE sietch_config_ghost_roles_total gauge');
  lines.push(`sietch_config_ghost_roles_total ${totalGhostRoles}`);

  // Servers with drift gauge
  const serversWithDrift = getServersWithGhostRoles().length;
  lines.push('# HELP sietch_servers_with_drift Number of servers with detected drift');
  lines.push('# TYPE sietch_servers_with_drift gauge');
  lines.push(`sietch_servers_with_drift ${serversWithDrift}`);

  return lines.join('\n') + '\n';
}

/**
 * Get raw metrics data for testing.
 */
export function getDriftMetricsRaw(): DriftMetrics {
  return {
    driftChecks: metrics.driftChecks,
    ghostRolesByServer: new Map(metrics.ghostRolesByServer),
    lastCheckByServer: new Map(metrics.lastCheckByServer),
  };
}

/**
 * Reset all metrics (for testing).
 */
export function resetDriftMetrics(): void {
  metrics.driftChecks = 0;
  metrics.ghostRolesByServer.clear();
  metrics.lastCheckByServer.clear();
}

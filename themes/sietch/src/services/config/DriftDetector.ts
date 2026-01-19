/**
 * Drift Detector Service
 *
 * Sprint 123: DriftDetector Service
 *
 * Detects "ghost roles" - Discord roles referenced in the configuration
 * that have been deleted or renamed in Discord. Essential for dashboard
 * data integrity and alerting.
 *
 * Drift Types:
 * - ROLE_DELETED: Role ID in config but not in Discord
 * - ROLE_RENAMED: Role ID exists but name has changed
 *
 * @see grimoires/loa/sdd.md §4.3 DriftDetector
 */

import type { Guild, Role } from 'discord.js';
import { logger as defaultLogger } from '../../utils/logger.js';
import type { RoleMapping, CurrentConfiguration } from '../../db/types/config.types.js';
import {
  recordGhostRoles,
  recordDriftCheck,
  getDriftMetricsPrometheus,
} from './driftMetrics.js';

// =============================================================================
// Types
// =============================================================================

export type DriftType = 'ROLE_DELETED' | 'ROLE_RENAMED';

/**
 * Individual drift item representing a single role discrepancy
 */
export interface DriftItem {
  /** Type of drift */
  type: DriftType;
  /** Discord role ID from config */
  roleId: string;
  /** Role name as stored in config */
  configRoleName: string;
  /** Current role name in Discord (null if deleted) */
  currentRoleName: string | null;
  /** Tier ID the role is mapped to in config */
  tierId: string;
  /** Severity for alerting (DELETED > RENAMED) */
  severity: 'high' | 'medium';
  /** Suggestion for resolution */
  suggestion: string;
}

/**
 * Complete drift report for a server
 */
export interface DriftReport {
  /** Server ID */
  serverId: string;
  /** When the check was performed */
  checkedAt: Date;
  /** Whether any drift was detected */
  hasDrift: boolean;
  /** Total count of drift items */
  totalDriftCount: number;
  /** Count of deleted roles */
  deletedRolesCount: number;
  /** Count of renamed roles */
  renamedRolesCount: number;
  /** Individual drift items */
  items: DriftItem[];
  /** Role mappings that are healthy */
  healthyRolesCount: number;
}

export interface IDriftDetector {
  checkServerDrift(serverId: string, config: CurrentConfiguration): Promise<DriftReport>;
  clearCache(serverId: string): void;
}

export interface DriftDetectorConfig {
  /** Discord guild for role lookups */
  guild: Guild;
  /** Optional logger */
  logger?: typeof defaultLogger;
  /** Cache TTL in milliseconds (default: 1 hour) */
  cacheTtlMs?: number;
}

// =============================================================================
// Cache
// =============================================================================

interface CachedDriftReport {
  report: DriftReport;
  expiresAt: number;
}

const reportCache = new Map<string, CachedDriftReport>();
const DEFAULT_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

// =============================================================================
// DriftDetector Implementation
// =============================================================================

export class DriftDetector implements IDriftDetector {
  private readonly guild: Guild;
  private readonly logger: typeof defaultLogger;
  private readonly cacheTtlMs: number;

  constructor(config: DriftDetectorConfig) {
    this.guild = config.guild;
    this.logger = config.logger ?? defaultLogger;
    this.cacheTtlMs = config.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  }

  /**
   * Check for drift between config role mappings and Discord roles.
   *
   * Compares role IDs in roleMappings with actual Discord guild roles.
   * Detects two types of drift:
   * - ROLE_DELETED: Role ID exists in config but not in Discord
   * - ROLE_RENAMED: Role ID exists but name doesn't match
   *
   * Results are cached for 1 hour (configurable).
   */
  async checkServerDrift(
    serverId: string,
    config: CurrentConfiguration
  ): Promise<DriftReport> {
    // Check cache first
    const cached = reportCache.get(serverId);
    if (cached && cached.expiresAt > Date.now()) {
      this.logger.debug({ serverId }, 'Returning cached drift report');
      return cached.report;
    }

    recordDriftCheck();

    this.logger.debug(
      { serverId, roleMappingCount: Object.keys(config.roleMappings).length },
      'Starting drift check'
    );

    // Fetch current Discord roles
    const discordRoles = await this.fetchDiscordRoles();
    const discordRoleMap = new Map<string, Role>();
    for (const role of discordRoles) {
      discordRoleMap.set(role.id, role);
    }

    // Compare config roles against Discord
    const items: DriftItem[] = [];
    let healthyCount = 0;

    for (const [roleId, mapping] of Object.entries(config.roleMappings)) {
      // Skip if mapping is already marked as deleted
      if (mapping.status === 'deleted') {
        continue;
      }

      const discordRole = discordRoleMap.get(roleId);

      if (!discordRole) {
        // ROLE_DELETED: Role ID not in Discord
        items.push({
          type: 'ROLE_DELETED',
          roleId,
          configRoleName: mapping.roleName,
          currentRoleName: null,
          tierId: mapping.tierId,
          severity: 'high',
          suggestion: `Remove role mapping or map to a different role. The role "${mapping.roleName}" has been deleted from Discord.`,
        });
      } else if (discordRole.name !== mapping.roleName) {
        // ROLE_RENAMED: Role exists but name changed
        items.push({
          type: 'ROLE_RENAMED',
          roleId,
          configRoleName: mapping.roleName,
          currentRoleName: discordRole.name,
          tierId: mapping.tierId,
          severity: 'medium',
          suggestion: `Update role name in config from "${mapping.roleName}" to "${discordRole.name}" for consistency.`,
        });
      } else {
        // Role is healthy
        healthyCount++;
      }
    }

    const deletedCount = items.filter((i) => i.type === 'ROLE_DELETED').length;
    const renamedCount = items.filter((i) => i.type === 'ROLE_RENAMED').length;

    const report: DriftReport = {
      serverId,
      checkedAt: new Date(),
      hasDrift: items.length > 0,
      totalDriftCount: items.length,
      deletedRolesCount: deletedCount,
      renamedRolesCount: renamedCount,
      items,
      healthyRolesCount: healthyCount,
    };

    // Record metrics
    if (deletedCount > 0) {
      recordGhostRoles(serverId, deletedCount);
    }

    // Cache the result
    reportCache.set(serverId, {
      report,
      expiresAt: Date.now() + this.cacheTtlMs,
    });

    this.logger.info(
      {
        serverId,
        hasDrift: report.hasDrift,
        deletedRoles: deletedCount,
        renamedRoles: renamedCount,
        healthyRoles: healthyCount,
      },
      'Drift check completed'
    );

    return report;
  }

  /**
   * Clear cached drift report for a server.
   * Call this after role mappings are updated.
   */
  clearCache(serverId: string): void {
    reportCache.delete(serverId);
    this.logger.debug({ serverId }, 'Cleared drift report cache');
  }

  /**
   * Fetch all roles from Discord guild.
   */
  private async fetchDiscordRoles(): Promise<Role[]> {
    try {
      const roles = await this.guild.roles.fetch();
      return Array.from(roles.values());
    } catch (error) {
      this.logger.error({ error }, 'Failed to fetch Discord roles');
      throw new Error('Unable to fetch Discord roles for drift detection');
    }
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a DriftDetector instance.
 */
export function createDriftDetector(config: DriftDetectorConfig): DriftDetector {
  return new DriftDetector(config);
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Clear all cached drift reports (for testing).
 */
export function clearAllDriftCache(): void {
  reportCache.clear();
}

/**
 * Get cache size (for testing/metrics).
 */
export function getDriftCacheSize(): number {
  return reportCache.size;
}

// Re-export metrics
export { getDriftMetricsPrometheus } from './driftMetrics.js';

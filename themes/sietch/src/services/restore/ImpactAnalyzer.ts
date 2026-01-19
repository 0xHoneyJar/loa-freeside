/**
 * Impact Analyzer Service
 *
 * Sprint 125: ImpactAnalyzer Service
 *
 * Analyzes the impact of configuration restores by comparing current state
 * to target state. Returns affected users, tier changes, and feature access
 * changes with severity assessment.
 *
 * @see grimoires/loa/sdd.md §4.4 ImpactAnalyzer
 * @module services/restore/ImpactAnalyzer
 */

import type {
  CurrentConfiguration,
  TierThresholds,
  FeatureGate,
  RoleMapping,
  CheckpointSnapshot,
} from '../../db/types/config.types.js';
import { logger as defaultLogger } from '../../utils/logger.js';

// =============================================================================
// Types
// =============================================================================

export interface ImpactAnalyzerConfig {
  /** High-impact threshold (users affected) */
  highImpactThreshold?: number;
  /** Optional custom logger */
  logger?: typeof defaultLogger;
}

export interface TierChange {
  /** Tier ID */
  tierId: string;
  /** Field that changed */
  field: 'bgt' | 'engagement' | 'tenure' | 'activity';
  /** Current value */
  currentValue: number | undefined;
  /** Target value after restore */
  targetValue: number | undefined;
  /** Direction of change */
  direction: 'increased' | 'decreased' | 'added' | 'removed';
}

export interface FeatureChange {
  /** Feature ID */
  featureId: string;
  /** Affected tier ID */
  tierId: string;
  /** Current access state */
  currentAccess: boolean | null;
  /** Target access state after restore */
  targetAccess: boolean | null;
  /** Current condition */
  currentCondition?: string;
  /** Target condition after restore */
  targetCondition?: string;
  /** Type of change */
  changeType: 'granted' | 'revoked' | 'condition_changed' | 'added' | 'removed';
}

export interface RoleMappingChange {
  /** Role ID */
  roleId: string;
  /** Role name */
  roleName: string;
  /** Current tier mapping */
  currentTierId: string | null;
  /** Target tier mapping after restore */
  targetTierId: string | null;
  /** Type of change */
  changeType: 'tier_changed' | 'added' | 'removed';
}

export interface UserImpact {
  /** Estimated users gaining access */
  usersGainingAccess: number;
  /** Estimated users losing access */
  usersLosingAccess: number;
  /** Tiers with threshold changes */
  affectedTiers: string[];
}

export interface RestoreImpactReport {
  /** Server ID */
  serverId: string;
  /** Analysis timestamp */
  analyzedAt: Date;
  /** Is high-impact restore (> threshold users affected) */
  isHighImpact: boolean;
  /** Summary for humans */
  summary: {
    /** Total changes count */
    totalChanges: number;
    /** Threshold changes count */
    thresholdChanges: number;
    /** Feature gate changes count */
    featureChanges: number;
    /** Role mapping changes count */
    roleChanges: number;
    /** Users affected (estimated) */
    estimatedUsersAffected: number;
  };
  /** User impact analysis */
  userImpact: UserImpact;
  /** Detailed threshold changes */
  thresholdChanges: TierChange[];
  /** Detailed feature gate changes */
  featureChanges: FeatureChange[];
  /** Detailed role mapping changes */
  roleChanges: RoleMappingChange[];
  /** Human-readable summary */
  humanReadableSummary: string;
  /** Warning messages */
  warnings: string[];
}

export interface IImpactAnalyzer {
  analyzeRestoreImpact(
    currentConfig: CurrentConfiguration,
    targetConfig: CurrentConfiguration
  ): RestoreImpactReport;

  analyzeCheckpointRestore(
    currentConfig: CurrentConfiguration,
    checkpoint: CheckpointSnapshot
  ): RestoreImpactReport;
}

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_HIGH_IMPACT_THRESHOLD = 10;

// =============================================================================
// ImpactAnalyzer Implementation
// =============================================================================

export class ImpactAnalyzer implements IImpactAnalyzer {
  private readonly highImpactThreshold: number;
  private readonly logger: typeof defaultLogger;

  constructor(config: ImpactAnalyzerConfig = {}) {
    this.highImpactThreshold = config.highImpactThreshold ?? DEFAULT_HIGH_IMPACT_THRESHOLD;
    this.logger = config.logger ?? defaultLogger;
  }

  /**
   * Analyze the impact of restoring from current to target configuration.
   */
  analyzeRestoreImpact(
    currentConfig: CurrentConfiguration,
    targetConfig: CurrentConfiguration
  ): RestoreImpactReport {
    const analyzedAt = new Date();

    this.logger.debug(
      { serverId: currentConfig.serverId },
      'Analyzing restore impact'
    );

    // Analyze each category
    const thresholdChanges = this.analyzeThresholdChanges(
      currentConfig.thresholds,
      targetConfig.thresholds
    );

    const featureChanges = this.analyzeFeatureChanges(
      currentConfig.featureGates,
      targetConfig.featureGates
    );

    const roleChanges = this.analyzeRoleChanges(
      currentConfig.roleMappings,
      targetConfig.roleMappings
    );

    // Calculate user impact
    const userImpact = this.calculateUserImpact(thresholdChanges, roleChanges);
    const estimatedUsersAffected =
      userImpact.usersGainingAccess + userImpact.usersLosingAccess;

    // Determine if high-impact
    const isHighImpact = estimatedUsersAffected > this.highImpactThreshold;

    // Generate warnings
    const warnings = this.generateWarnings(
      thresholdChanges,
      featureChanges,
      roleChanges,
      isHighImpact
    );

    // Build summary
    const summary = {
      totalChanges:
        thresholdChanges.length + featureChanges.length + roleChanges.length,
      thresholdChanges: thresholdChanges.length,
      featureChanges: featureChanges.length,
      roleChanges: roleChanges.length,
      estimatedUsersAffected,
    };

    // Generate human-readable summary
    const humanReadableSummary = this.formatHumanReadableSummary(
      summary,
      userImpact,
      isHighImpact
    );

    const report: RestoreImpactReport = {
      serverId: currentConfig.serverId,
      analyzedAt,
      isHighImpact,
      summary,
      userImpact,
      thresholdChanges,
      featureChanges,
      roleChanges,
      humanReadableSummary,
      warnings,
    };

    this.logger.info(
      {
        serverId: currentConfig.serverId,
        totalChanges: summary.totalChanges,
        estimatedUsersAffected,
        isHighImpact,
      },
      'Restore impact analysis completed'
    );

    return report;
  }

  /**
   * Analyze the impact of restoring from a checkpoint snapshot.
   */
  analyzeCheckpointRestore(
    currentConfig: CurrentConfiguration,
    checkpoint: CheckpointSnapshot
  ): RestoreImpactReport {
    // Parse the checkpoint's full state JSON into a CurrentConfiguration-like object
    const targetConfig = this.parseCheckpointState(checkpoint, currentConfig.serverId);
    return this.analyzeRestoreImpact(currentConfig, targetConfig);
  }

  /**
   * Parse checkpoint snapshot into configuration object.
   */
  private parseCheckpointState(
    checkpoint: CheckpointSnapshot,
    serverId: string
  ): CurrentConfiguration {
    const state = checkpoint.fullStateJson;

    return {
      serverId,
      thresholds: (state.thresholds as Record<string, TierThresholds>) || {},
      featureGates: (state.featureGates as Record<string, FeatureGate>) || {},
      roleMappings: (state.roleMappings as Record<string, RoleMapping>) || {},
      activeThemeId: (state.activeThemeId as string | null) ?? null,
      lastRecordId: null,
      version: 0,
      schemaVersion: checkpoint.schemaVersion,
      createdAt: checkpoint.createdAt,
      updatedAt: checkpoint.createdAt,
    };
  }

  /**
   * Analyze threshold changes between configurations.
   */
  private analyzeThresholdChanges(
    current: Record<string, TierThresholds>,
    target: Record<string, TierThresholds>
  ): TierChange[] {
    const changes: TierChange[] = [];
    const allTierIds = new Set([...Object.keys(current), ...Object.keys(target)]);
    const fields: Array<'bgt' | 'engagement' | 'tenure' | 'activity'> = [
      'bgt',
      'engagement',
      'tenure',
      'activity',
    ];

    for (const tierId of allTierIds) {
      const currentThresholds = current[tierId] || {};
      const targetThresholds = target[tierId] || {};

      for (const field of fields) {
        const currentValue = currentThresholds[field];
        const targetValue = targetThresholds[field];

        if (currentValue !== targetValue) {
          let direction: TierChange['direction'];

          if (currentValue === undefined && targetValue !== undefined) {
            direction = 'added';
          } else if (currentValue !== undefined && targetValue === undefined) {
            direction = 'removed';
          } else if (currentValue !== undefined && targetValue !== undefined) {
            direction = targetValue > currentValue ? 'increased' : 'decreased';
          } else {
            continue; // Both undefined, no change
          }

          changes.push({
            tierId,
            field,
            currentValue,
            targetValue,
            direction,
          });
        }
      }
    }

    return changes;
  }

  /**
   * Analyze feature gate changes between configurations.
   */
  private analyzeFeatureChanges(
    current: Record<string, FeatureGate>,
    target: Record<string, FeatureGate>
  ): FeatureChange[] {
    const changes: FeatureChange[] = [];
    const allFeatureIds = new Set([...Object.keys(current), ...Object.keys(target)]);

    for (const featureId of allFeatureIds) {
      const currentGate = current[featureId];
      const targetGate = target[featureId];

      if (!currentGate && targetGate) {
        // Feature added
        changes.push({
          featureId,
          tierId: targetGate.tierId,
          currentAccess: null,
          targetAccess: true,
          targetCondition: targetGate.condition,
          changeType: 'added',
        });
      } else if (currentGate && !targetGate) {
        // Feature removed
        changes.push({
          featureId,
          tierId: currentGate.tierId,
          currentAccess: true,
          targetAccess: null,
          currentCondition: currentGate.condition,
          changeType: 'removed',
        });
      } else if (currentGate && targetGate) {
        // Check for tier or condition changes
        const tierChanged = currentGate.tierId !== targetGate.tierId;
        const conditionChanged = currentGate.condition !== targetGate.condition;

        if (tierChanged || conditionChanged) {
          let changeType: FeatureChange['changeType'];

          if (conditionChanged && !tierChanged) {
            changeType = 'condition_changed';
          } else {
            // Tier changed - determine if access granted or revoked based on tier ordering
            // Higher tier = more restrictive, so moving to higher tier = "revoked" for lower users
            changeType = 'granted'; // Default assumption, could be refined with tier ordering
          }

          changes.push({
            featureId,
            tierId: targetGate.tierId,
            currentAccess: true,
            targetAccess: true,
            currentCondition: currentGate.condition,
            targetCondition: targetGate.condition,
            changeType,
          });
        }
      }
    }

    return changes;
  }

  /**
   * Analyze role mapping changes between configurations.
   */
  private analyzeRoleChanges(
    current: Record<string, RoleMapping>,
    target: Record<string, RoleMapping>
  ): RoleMappingChange[] {
    const changes: RoleMappingChange[] = [];
    const allRoleIds = new Set([...Object.keys(current), ...Object.keys(target)]);

    for (const roleId of allRoleIds) {
      const currentMapping = current[roleId];
      const targetMapping = target[roleId];

      if (!currentMapping && targetMapping) {
        // Role mapping added
        changes.push({
          roleId,
          roleName: targetMapping.roleName,
          currentTierId: null,
          targetTierId: targetMapping.tierId,
          changeType: 'added',
        });
      } else if (currentMapping && !targetMapping) {
        // Role mapping removed
        changes.push({
          roleId,
          roleName: currentMapping.roleName,
          currentTierId: currentMapping.tierId,
          targetTierId: null,
          changeType: 'removed',
        });
      } else if (
        currentMapping &&
        targetMapping &&
        currentMapping.tierId !== targetMapping.tierId
      ) {
        // Tier changed
        changes.push({
          roleId,
          roleName: targetMapping.roleName,
          currentTierId: currentMapping.tierId,
          targetTierId: targetMapping.tierId,
          changeType: 'tier_changed',
        });
      }
    }

    return changes;
  }

  /**
   * Calculate estimated user impact from changes.
   */
  private calculateUserImpact(
    thresholdChanges: TierChange[],
    roleChanges: RoleMappingChange[]
  ): UserImpact {
    // Note: In a real implementation, this would query Discord/database
    // to get actual user counts. For now, we use estimates based on changes.
    let usersGainingAccess = 0;
    let usersLosingAccess = 0;
    const affectedTiers = new Set<string>();

    // Threshold changes affect users at tier boundaries
    for (const change of thresholdChanges) {
      affectedTiers.add(change.tierId);

      // Estimate: each threshold change affects ~5 users on average
      if (change.direction === 'decreased') {
        // Lower threshold = more users qualify
        usersGainingAccess += 5;
      } else if (change.direction === 'increased') {
        // Higher threshold = fewer users qualify
        usersLosingAccess += 5;
      }
    }

    // Role mapping changes directly affect users with those roles
    for (const change of roleChanges) {
      // Estimate: each role has ~10 users on average
      if (change.changeType === 'added') {
        usersGainingAccess += 10;
      } else if (change.changeType === 'removed') {
        usersLosingAccess += 10;
      } else if (change.changeType === 'tier_changed') {
        // Some gain, some lose
        usersGainingAccess += 5;
        usersLosingAccess += 5;
      }
    }

    return {
      usersGainingAccess,
      usersLosingAccess,
      affectedTiers: Array.from(affectedTiers),
    };
  }

  /**
   * Generate warning messages for significant changes.
   */
  private generateWarnings(
    thresholdChanges: TierChange[],
    featureChanges: FeatureChange[],
    roleChanges: RoleMappingChange[],
    isHighImpact: boolean
  ): string[] {
    const warnings: string[] = [];

    if (isHighImpact) {
      warnings.push(
        `HIGH IMPACT: This restore affects more than ${this.highImpactThreshold} users`
      );
    }

    // Check for significant threshold decreases (makes tiers more accessible)
    const significantThresholdDecreases = thresholdChanges.filter(
      (c) =>
        c.direction === 'decreased' &&
        c.currentValue !== undefined &&
        c.targetValue !== undefined &&
        (c.currentValue - c.targetValue) / c.currentValue > 0.5
    );
    if (significantThresholdDecreases.length > 0) {
      warnings.push(
        `${significantThresholdDecreases.length} threshold(s) will be reduced by more than 50%`
      );
    }

    // Check for feature removals
    const featureRemovals = featureChanges.filter((c) => c.changeType === 'removed');
    if (featureRemovals.length > 0) {
      warnings.push(
        `${featureRemovals.length} feature gate(s) will be removed`
      );
    }

    // Check for role mapping removals
    const roleRemovals = roleChanges.filter((c) => c.changeType === 'removed');
    if (roleRemovals.length > 0) {
      warnings.push(
        `${roleRemovals.length} role mapping(s) will be removed`
      );
    }

    return warnings;
  }

  /**
   * Format a human-readable summary of the impact.
   */
  private formatHumanReadableSummary(
    summary: RestoreImpactReport['summary'],
    userImpact: UserImpact,
    isHighImpact: boolean
  ): string {
    const lines: string[] = [];

    if (summary.totalChanges === 0) {
      return 'No changes detected. Target configuration is identical to current state.';
    }

    lines.push(`**Restore Impact Summary**`);
    lines.push('');

    if (isHighImpact) {
      lines.push(`⚠️ HIGH IMPACT RESTORE`);
      lines.push('');
    }

    lines.push(`Total changes: ${summary.totalChanges}`);

    if (summary.thresholdChanges > 0) {
      lines.push(`- Threshold changes: ${summary.thresholdChanges}`);
    }
    if (summary.featureChanges > 0) {
      lines.push(`- Feature gate changes: ${summary.featureChanges}`);
    }
    if (summary.roleChanges > 0) {
      lines.push(`- Role mapping changes: ${summary.roleChanges}`);
    }

    lines.push('');
    lines.push('**User Impact (Estimated)**');
    lines.push(`- Users gaining access: ~${userImpact.usersGainingAccess}`);
    lines.push(`- Users losing access: ~${userImpact.usersLosingAccess}`);

    if (userImpact.affectedTiers.length > 0) {
      lines.push(`- Affected tiers: ${userImpact.affectedTiers.join(', ')}`);
    }

    return lines.join('\n');
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create an ImpactAnalyzer instance.
 */
export function createImpactAnalyzer(
  config: ImpactAnalyzerConfig = {}
): ImpactAnalyzer {
  return new ImpactAnalyzer(config);
}

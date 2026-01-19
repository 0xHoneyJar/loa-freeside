/**
 * ImpactAnalyzer Tests
 *
 * Sprint 125: ImpactAnalyzer Service
 *
 * Tests for restore impact analysis functionality.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  ImpactAnalyzer,
  createImpactAnalyzer,
  type RestoreImpactReport,
} from '../../../src/services/restore/ImpactAnalyzer.js';
import type {
  CurrentConfiguration,
  TierThresholds,
  FeatureGate,
  RoleMapping,
  CheckpointSnapshot,
} from '../../../src/db/types/config.types.js';

// =============================================================================
// Test Fixtures
// =============================================================================

function createMockConfig(
  serverId: string,
  overrides: Partial<CurrentConfiguration> = {}
): CurrentConfiguration {
  return {
    serverId,
    thresholds: {},
    featureGates: {},
    roleMappings: {},
    activeThemeId: null,
    lastRecordId: null,
    version: 1,
    schemaVersion: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function createThresholds(
  bgt?: number,
  engagement?: number,
  tenure?: number,
  activity?: number
): TierThresholds {
  const thresholds: TierThresholds = {};
  if (bgt !== undefined) thresholds.bgt = bgt;
  if (engagement !== undefined) thresholds.engagement = engagement;
  if (tenure !== undefined) thresholds.tenure = tenure;
  if (activity !== undefined) thresholds.activity = activity;
  return thresholds;
}

function createFeatureGate(tierId: string, condition?: string): FeatureGate {
  return { tierId, condition };
}

function createRoleMapping(
  roleId: string,
  roleName: string,
  tierId: string,
  priority: number = 0
): RoleMapping {
  return {
    roleId,
    roleName,
    tierId,
    priority,
    status: 'active',
  };
}

function createCheckpointSnapshot(
  fullStateJson: Record<string, unknown>
): CheckpointSnapshot {
  return {
    id: 'checkpoint-1',
    serverId: 'server-123',
    schemaVersion: 1,
    triggerCommand: 'teardown',
    fullStateJson,
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  };
}

// =============================================================================
// Tests
// =============================================================================

describe('ImpactAnalyzer', () => {
  let analyzer: ImpactAnalyzer;

  beforeEach(() => {
    analyzer = createImpactAnalyzer({ highImpactThreshold: 10 });
  });

  describe('analyzeRestoreImpact()', () => {
    it('should return no changes for identical configurations', () => {
      const config = createMockConfig('server-123', {
        thresholds: {
          'tier-1': createThresholds(100),
        },
        featureGates: {
          'feature-1': createFeatureGate('tier-1'),
        },
        roleMappings: {
          'role-1': createRoleMapping('role-1', 'Role 1', 'tier-1'),
        },
      });

      const report = analyzer.analyzeRestoreImpact(config, config);

      expect(report.summary.totalChanges).toBe(0);
      expect(report.thresholdChanges).toHaveLength(0);
      expect(report.featureChanges).toHaveLength(0);
      expect(report.roleChanges).toHaveLength(0);
      expect(report.isHighImpact).toBe(false);
      expect(report.humanReadableSummary).toContain('No changes detected');
    });

    it('should detect threshold increases', () => {
      const current = createMockConfig('server-123', {
        thresholds: {
          'tier-1': createThresholds(100, 50),
        },
      });

      const target = createMockConfig('server-123', {
        thresholds: {
          'tier-1': createThresholds(200, 50), // BGT increased
        },
      });

      const report = analyzer.analyzeRestoreImpact(current, target);

      expect(report.thresholdChanges).toHaveLength(1);
      expect(report.thresholdChanges[0].tierId).toBe('tier-1');
      expect(report.thresholdChanges[0].field).toBe('bgt');
      expect(report.thresholdChanges[0].currentValue).toBe(100);
      expect(report.thresholdChanges[0].targetValue).toBe(200);
      expect(report.thresholdChanges[0].direction).toBe('increased');
    });

    it('should detect threshold decreases', () => {
      const current = createMockConfig('server-123', {
        thresholds: {
          'tier-1': createThresholds(200),
        },
      });

      const target = createMockConfig('server-123', {
        thresholds: {
          'tier-1': createThresholds(100), // BGT decreased
        },
      });

      const report = analyzer.analyzeRestoreImpact(current, target);

      expect(report.thresholdChanges).toHaveLength(1);
      expect(report.thresholdChanges[0].direction).toBe('decreased');
      expect(report.userImpact.usersGainingAccess).toBeGreaterThan(0);
    });

    it('should detect added thresholds', () => {
      const current = createMockConfig('server-123', {
        thresholds: {},
      });

      const target = createMockConfig('server-123', {
        thresholds: {
          'tier-1': createThresholds(100, 50),
        },
      });

      const report = analyzer.analyzeRestoreImpact(current, target);

      expect(report.thresholdChanges).toHaveLength(2); // bgt and engagement
      expect(report.thresholdChanges.every((c) => c.direction === 'added')).toBe(true);
    });

    it('should detect removed thresholds', () => {
      const current = createMockConfig('server-123', {
        thresholds: {
          'tier-1': createThresholds(100),
        },
      });

      const target = createMockConfig('server-123', {
        thresholds: {},
      });

      const report = analyzer.analyzeRestoreImpact(current, target);

      expect(report.thresholdChanges).toHaveLength(1);
      expect(report.thresholdChanges[0].direction).toBe('removed');
    });

    it('should detect feature gate additions', () => {
      const current = createMockConfig('server-123', {
        featureGates: {},
      });

      const target = createMockConfig('server-123', {
        featureGates: {
          'feature-1': createFeatureGate('tier-1'),
        },
      });

      const report = analyzer.analyzeRestoreImpact(current, target);

      expect(report.featureChanges).toHaveLength(1);
      expect(report.featureChanges[0].featureId).toBe('feature-1');
      expect(report.featureChanges[0].changeType).toBe('added');
    });

    it('should detect feature gate removals', () => {
      const current = createMockConfig('server-123', {
        featureGates: {
          'feature-1': createFeatureGate('tier-1'),
        },
      });

      const target = createMockConfig('server-123', {
        featureGates: {},
      });

      const report = analyzer.analyzeRestoreImpact(current, target);

      expect(report.featureChanges).toHaveLength(1);
      expect(report.featureChanges[0].changeType).toBe('removed');
      expect(report.warnings.some((w) => w.includes('feature gate(s) will be removed'))).toBe(
        true
      );
    });

    it('should detect feature gate condition changes', () => {
      const current = createMockConfig('server-123', {
        featureGates: {
          'feature-1': createFeatureGate('tier-1', 'has_badge'),
        },
      });

      const target = createMockConfig('server-123', {
        featureGates: {
          'feature-1': createFeatureGate('tier-1', 'is_verified'),
        },
      });

      const report = analyzer.analyzeRestoreImpact(current, target);

      expect(report.featureChanges).toHaveLength(1);
      expect(report.featureChanges[0].changeType).toBe('condition_changed');
      expect(report.featureChanges[0].currentCondition).toBe('has_badge');
      expect(report.featureChanges[0].targetCondition).toBe('is_verified');
    });

    it('should detect role mapping additions', () => {
      const current = createMockConfig('server-123', {
        roleMappings: {},
      });

      const target = createMockConfig('server-123', {
        roleMappings: {
          'role-1': createRoleMapping('role-1', 'New Role', 'tier-1'),
        },
      });

      const report = analyzer.analyzeRestoreImpact(current, target);

      expect(report.roleChanges).toHaveLength(1);
      expect(report.roleChanges[0].roleId).toBe('role-1');
      expect(report.roleChanges[0].changeType).toBe('added');
      expect(report.userImpact.usersGainingAccess).toBeGreaterThan(0);
    });

    it('should detect role mapping removals', () => {
      const current = createMockConfig('server-123', {
        roleMappings: {
          'role-1': createRoleMapping('role-1', 'Old Role', 'tier-1'),
        },
      });

      const target = createMockConfig('server-123', {
        roleMappings: {},
      });

      const report = analyzer.analyzeRestoreImpact(current, target);

      expect(report.roleChanges).toHaveLength(1);
      expect(report.roleChanges[0].changeType).toBe('removed');
      expect(report.userImpact.usersLosingAccess).toBeGreaterThan(0);
      expect(report.warnings.some((w) => w.includes('role mapping(s) will be removed'))).toBe(
        true
      );
    });

    it('should detect role mapping tier changes', () => {
      const current = createMockConfig('server-123', {
        roleMappings: {
          'role-1': createRoleMapping('role-1', 'Role 1', 'tier-1'),
        },
      });

      const target = createMockConfig('server-123', {
        roleMappings: {
          'role-1': createRoleMapping('role-1', 'Role 1', 'tier-2'),
        },
      });

      const report = analyzer.analyzeRestoreImpact(current, target);

      expect(report.roleChanges).toHaveLength(1);
      expect(report.roleChanges[0].changeType).toBe('tier_changed');
      expect(report.roleChanges[0].currentTierId).toBe('tier-1');
      expect(report.roleChanges[0].targetTierId).toBe('tier-2');
    });
  });

  describe('high-impact threshold', () => {
    it('should flag high-impact when users affected > threshold', () => {
      // Create many role changes to trigger high-impact
      const current = createMockConfig('server-123', {
        roleMappings: {
          'role-1': createRoleMapping('role-1', 'Role 1', 'tier-1'),
          'role-2': createRoleMapping('role-2', 'Role 2', 'tier-1'),
        },
      });

      const target = createMockConfig('server-123', {
        roleMappings: {},
      });

      const report = analyzer.analyzeRestoreImpact(current, target);

      // 2 role removals × 10 estimated users = 20 users losing access
      expect(report.isHighImpact).toBe(true);
      expect(report.warnings.some((w) => w.includes('HIGH IMPACT'))).toBe(true);
      expect(report.humanReadableSummary).toContain('HIGH IMPACT');
    });

    it('should not flag high-impact when users affected <= threshold', () => {
      const current = createMockConfig('server-123', {
        thresholds: {
          'tier-1': createThresholds(100),
        },
      });

      const target = createMockConfig('server-123', {
        thresholds: {
          'tier-1': createThresholds(110), // Small increase
        },
      });

      const report = analyzer.analyzeRestoreImpact(current, target);

      // 1 threshold change × 5 estimated users = 5 users
      expect(report.isHighImpact).toBe(false);
      expect(report.warnings.some((w) => w.includes('HIGH IMPACT'))).toBe(false);
    });

    it('should respect custom high-impact threshold', () => {
      const customAnalyzer = createImpactAnalyzer({ highImpactThreshold: 2 });

      const current = createMockConfig('server-123', {
        thresholds: {
          'tier-1': createThresholds(100),
        },
      });

      const target = createMockConfig('server-123', {
        thresholds: {
          'tier-1': createThresholds(50), // Decrease
        },
      });

      const report = customAnalyzer.analyzeRestoreImpact(current, target);

      // 1 threshold decrease × 5 users = 5 > 2 threshold
      expect(report.isHighImpact).toBe(true);
    });
  });

  describe('analyzeCheckpointRestore()', () => {
    it('should parse checkpoint and analyze impact', () => {
      const current = createMockConfig('server-123', {
        thresholds: {
          'tier-1': createThresholds(200),
        },
        featureGates: {
          'feature-1': createFeatureGate('tier-2'),
        },
      });

      const checkpoint = createCheckpointSnapshot({
        thresholds: {
          'tier-1': createThresholds(100), // Lower threshold
        },
        featureGates: {
          'feature-1': createFeatureGate('tier-1'), // Different tier
        },
      });

      const report = analyzer.analyzeCheckpointRestore(current, checkpoint);

      expect(report.serverId).toBe('server-123');
      expect(report.thresholdChanges).toHaveLength(1);
      expect(report.thresholdChanges[0].direction).toBe('decreased');
      expect(report.featureChanges).toHaveLength(1);
    });

    it('should handle empty checkpoint state', () => {
      const current = createMockConfig('server-123', {
        thresholds: {
          'tier-1': createThresholds(100),
        },
      });

      const checkpoint = createCheckpointSnapshot({});

      const report = analyzer.analyzeCheckpointRestore(current, checkpoint);

      expect(report.thresholdChanges).toHaveLength(1);
      expect(report.thresholdChanges[0].direction).toBe('removed');
    });
  });

  describe('warnings', () => {
    it('should warn on significant threshold decreases (>50%)', () => {
      const current = createMockConfig('server-123', {
        thresholds: {
          'tier-1': createThresholds(100),
        },
      });

      const target = createMockConfig('server-123', {
        thresholds: {
          'tier-1': createThresholds(40), // 60% decrease
        },
      });

      const report = analyzer.analyzeRestoreImpact(current, target);

      expect(
        report.warnings.some((w) => w.includes('reduced by more than 50%'))
      ).toBe(true);
    });

    it('should not warn on small threshold decreases', () => {
      const current = createMockConfig('server-123', {
        thresholds: {
          'tier-1': createThresholds(100),
        },
      });

      const target = createMockConfig('server-123', {
        thresholds: {
          'tier-1': createThresholds(80), // 20% decrease
        },
      });

      const report = analyzer.analyzeRestoreImpact(current, target);

      expect(
        report.warnings.some((w) => w.includes('reduced by more than 50%'))
      ).toBe(false);
    });
  });

  describe('human-readable summary', () => {
    it('should include all relevant information', () => {
      const current = createMockConfig('server-123', {
        thresholds: {
          'tier-1': createThresholds(100),
        },
        featureGates: {
          'feature-1': createFeatureGate('tier-1'),
        },
        roleMappings: {
          'role-1': createRoleMapping('role-1', 'Role 1', 'tier-1'),
        },
      });

      const target = createMockConfig('server-123', {
        thresholds: {
          'tier-1': createThresholds(50),
        },
        featureGates: {},
        roleMappings: {
          'role-1': createRoleMapping('role-1', 'Role 1', 'tier-2'),
        },
      });

      const report = analyzer.analyzeRestoreImpact(current, target);

      expect(report.humanReadableSummary).toContain('Total changes:');
      expect(report.humanReadableSummary).toContain('Threshold changes:');
      expect(report.humanReadableSummary).toContain('Feature gate changes:');
      expect(report.humanReadableSummary).toContain('Role mapping changes:');
      expect(report.humanReadableSummary).toContain('Users gaining access:');
      expect(report.humanReadableSummary).toContain('Users losing access:');
    });
  });

  describe('user impact calculation', () => {
    it('should estimate users gaining access on threshold decrease', () => {
      const current = createMockConfig('server-123', {
        thresholds: {
          'tier-1': createThresholds(100),
        },
      });

      const target = createMockConfig('server-123', {
        thresholds: {
          'tier-1': createThresholds(50),
        },
      });

      const report = analyzer.analyzeRestoreImpact(current, target);

      expect(report.userImpact.usersGainingAccess).toBeGreaterThan(0);
      expect(report.userImpact.affectedTiers).toContain('tier-1');
    });

    it('should estimate users losing access on threshold increase', () => {
      const current = createMockConfig('server-123', {
        thresholds: {
          'tier-1': createThresholds(50),
        },
      });

      const target = createMockConfig('server-123', {
        thresholds: {
          'tier-1': createThresholds(100),
        },
      });

      const report = analyzer.analyzeRestoreImpact(current, target);

      expect(report.userImpact.usersLosingAccess).toBeGreaterThan(0);
    });

    it('should track affected tiers', () => {
      const current = createMockConfig('server-123', {
        thresholds: {
          'tier-1': createThresholds(100),
          'tier-2': createThresholds(200),
        },
      });

      const target = createMockConfig('server-123', {
        thresholds: {
          'tier-1': createThresholds(50),
          'tier-2': createThresholds(150),
        },
      });

      const report = analyzer.analyzeRestoreImpact(current, target);

      expect(report.userImpact.affectedTiers).toContain('tier-1');
      expect(report.userImpact.affectedTiers).toContain('tier-2');
    });
  });
});

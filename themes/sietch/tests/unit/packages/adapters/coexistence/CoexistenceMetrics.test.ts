/**
 * CoexistenceMetrics Unit Tests
 *
 * Sprint 65: Full Social Layer & Polish
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  recordModeTransition,
  recordDivergence,
  recordDivergenceResolved,
  recordMigrationStart,
  recordMigrationComplete,
  recordRollback,
  recordTakeoverComplete,
  recordHealthCheck,
  recordAlertSent,
  recordEmergencyBackup,
  recordSocialLayerUnlock,
  recordFeatureUnlock,
  recordDiscountGenerated,
  recordDiscountRedeemed,
  recordDiscountExpired,
  setCommunitiesInMode,
  setDivergenceCounts,
  getCoexistenceMetrics,
  resetMetrics,
  getMetricsState,
} from '../../../../../src/packages/adapters/coexistence/CoexistenceMetrics.js';

describe('CoexistenceMetrics', () => {
  beforeEach(() => {
    resetMetrics();
  });

  describe('Mode transition metrics', () => {
    it('should record mode transition from undefined', () => {
      recordModeTransition(undefined, 'shadow');

      const state = getMetricsState();
      expect(state.communitiesByMode.get('shadow')).toBe(1);
    });

    it('should record mode transition between modes', () => {
      recordModeTransition(undefined, 'shadow');
      recordModeTransition('shadow', 'parallel');

      const state = getMetricsState();
      expect(state.communitiesByMode.get('shadow')).toBe(0);
      expect(state.communitiesByMode.get('parallel')).toBe(1);
    });

    it('should track multiple communities in different modes', () => {
      recordModeTransition(undefined, 'shadow');
      recordModeTransition(undefined, 'shadow');
      recordModeTransition(undefined, 'parallel');
      recordModeTransition(undefined, 'primary');

      const state = getMetricsState();
      expect(state.communitiesByMode.get('shadow')).toBe(2);
      expect(state.communitiesByMode.get('parallel')).toBe(1);
      expect(state.communitiesByMode.get('primary')).toBe(1);
    });

    it('should not go below zero on transition', () => {
      recordModeTransition('shadow', 'parallel');

      const state = getMetricsState();
      expect(state.communitiesByMode.get('shadow')).toBe(0);
    });

    it('should set communities in mode via bulk update', () => {
      setCommunitiesInMode('shadow', 10);
      setCommunitiesInMode('parallel', 5);

      const state = getMetricsState();
      expect(state.communitiesByMode.get('shadow')).toBe(10);
      expect(state.communitiesByMode.get('parallel')).toBe(5);
    });
  });

  describe('Divergence metrics', () => {
    it('should record divergence', () => {
      recordDivergence('false_positive');

      const state = getMetricsState();
      expect(state.totalDivergences).toBe(1);
      expect(state.unresolvedDivergences).toBe(1);
      expect(state.divergencesByType.get('false_positive')).toBe(1);
    });

    it('should record resolved divergence', () => {
      recordDivergence('false_negative', true);

      const state = getMetricsState();
      expect(state.totalDivergences).toBe(1);
      expect(state.unresolvedDivergences).toBe(0);
    });

    it('should record multiple divergence types', () => {
      recordDivergence('false_positive');
      recordDivergence('false_positive');
      recordDivergence('timing_difference');
      recordDivergence('threshold_mismatch');

      const state = getMetricsState();
      expect(state.totalDivergences).toBe(4);
      expect(state.divergencesByType.get('false_positive')).toBe(2);
      expect(state.divergencesByType.get('timing_difference')).toBe(1);
      expect(state.divergencesByType.get('threshold_mismatch')).toBe(1);
    });

    it('should decrement unresolved on resolution', () => {
      recordDivergence('false_positive');
      recordDivergence('false_negative');
      recordDivergenceResolved();

      const state = getMetricsState();
      expect(state.unresolvedDivergences).toBe(1);
    });

    it('should not go below zero on resolution', () => {
      recordDivergenceResolved();

      const state = getMetricsState();
      expect(state.unresolvedDivergences).toBe(0);
    });

    it('should set divergence counts via bulk update', () => {
      setDivergenceCounts(100, 25);

      const state = getMetricsState();
      expect(state.totalDivergences).toBe(100);
      expect(state.unresolvedDivergences).toBe(25);
    });
  });

  describe('Migration metrics', () => {
    it('should track migrations in progress', () => {
      recordMigrationStart();
      recordMigrationStart();

      const state = getMetricsState();
      expect(state.migrationsInProgress).toBe(2);
    });

    it('should decrement in-progress and increment completed on completion', () => {
      recordMigrationStart();
      recordMigrationStart();
      recordMigrationComplete();

      const state = getMetricsState();
      expect(state.migrationsInProgress).toBe(1);
      expect(state.migrationsCompleted).toBe(1);
    });

    it('should track rollbacks', () => {
      recordMigrationStart();
      recordRollback();

      const state = getMetricsState();
      expect(state.migrationsInProgress).toBe(0);
      expect(state.rollbacksTriggered).toBe(1);
    });

    it('should track takeover completions', () => {
      recordTakeoverComplete();
      recordTakeoverComplete();

      const state = getMetricsState();
      expect(state.takeoverCompleted).toBe(2);
    });
  });

  describe('Health monitoring metrics', () => {
    it('should track passed health checks', () => {
      recordHealthCheck(true);
      recordHealthCheck(true);
      recordHealthCheck(false);

      const state = getMetricsState();
      expect(state.healthChecksTotal).toBe(3);
      expect(state.healthChecksPassed).toBe(2);
      expect(state.healthChecksFailed).toBe(1);
    });

    it('should track alerts sent', () => {
      recordAlertSent();
      recordAlertSent();

      const state = getMetricsState();
      expect(state.alertsSent).toBe(2);
    });

    it('should track emergency backup activations', () => {
      recordEmergencyBackup();

      const state = getMetricsState();
      expect(state.emergencyBackupsActivated).toBe(1);
    });
  });

  describe('Social layer metrics', () => {
    it('should track social layer unlocks', () => {
      recordSocialLayerUnlock();
      recordSocialLayerUnlock();

      const state = getMetricsState();
      expect(state.socialLayerUnlocks).toBe(2);
    });

    it('should track feature unlocks by ID', () => {
      recordFeatureUnlock('badge_showcase');
      recordFeatureUnlock('badge_showcase');
      recordFeatureUnlock('directory_listing');

      const state = getMetricsState();
      expect(state.featuresUnlocked.get('badge_showcase')).toBe(2);
      expect(state.featuresUnlocked.get('directory_listing')).toBe(1);
    });
  });

  describe('Discount metrics', () => {
    it('should track discounts generated', () => {
      recordDiscountGenerated();

      const state = getMetricsState();
      expect(state.discountsGenerated).toBe(1);
    });

    it('should track discounts redeemed', () => {
      recordDiscountRedeemed();

      const state = getMetricsState();
      expect(state.discountsRedeemed).toBe(1);
    });

    it('should track discounts expired', () => {
      recordDiscountExpired();

      const state = getMetricsState();
      expect(state.discountsExpired).toBe(1);
    });

    it('should track full discount lifecycle', () => {
      recordDiscountGenerated();
      recordDiscountGenerated();
      recordDiscountRedeemed();
      recordDiscountExpired();

      const state = getMetricsState();
      expect(state.discountsGenerated).toBe(2);
      expect(state.discountsRedeemed).toBe(1);
      expect(state.discountsExpired).toBe(1);
    });
  });

  describe('Prometheus export', () => {
    it('should generate valid Prometheus format', () => {
      // Set up some metrics
      recordModeTransition(undefined, 'shadow');
      recordModeTransition(undefined, 'parallel');
      recordDivergence('false_positive');
      recordMigrationComplete();
      recordHealthCheck(true);
      recordSocialLayerUnlock();
      recordDiscountGenerated();

      const output = getCoexistenceMetrics();

      // Check format - should have HELP and TYPE lines
      expect(output).toContain('# HELP sietch_coexistence_communities_by_mode');
      expect(output).toContain('# TYPE sietch_coexistence_communities_by_mode gauge');
      expect(output).toContain('sietch_coexistence_communities_by_mode{mode="shadow"} 1');
      expect(output).toContain('sietch_coexistence_communities_by_mode{mode="parallel"} 1');

      // Divergences
      expect(output).toContain('# HELP sietch_coexistence_divergences_total');
      expect(output).toContain('sietch_coexistence_divergences_total 1');

      // Migrations
      expect(output).toContain('sietch_coexistence_migrations_completed_total 1');

      // Health checks
      expect(output).toContain('sietch_coexistence_health_checks_passed_total 1');

      // Social layer
      expect(output).toContain('sietch_coexistence_social_layer_unlocks_total 1');

      // Discounts
      expect(output).toContain('sietch_coexistence_discounts_generated_total 1');
    });

    it('should include divergence by type metrics', () => {
      recordDivergence('false_positive');
      recordDivergence('false_negative');
      recordDivergence('timing_difference');

      const output = getCoexistenceMetrics();

      expect(output).toContain('sietch_coexistence_divergences_by_type{type="false_positive"} 1');
      expect(output).toContain('sietch_coexistence_divergences_by_type{type="false_negative"} 1');
      expect(output).toContain('sietch_coexistence_divergences_by_type{type="timing_difference"} 1');
    });

    it('should include feature unlock metrics when present', () => {
      recordFeatureUnlock('badge_showcase');
      recordFeatureUnlock('directory_listing');

      const output = getCoexistenceMetrics();

      expect(output).toContain('sietch_coexistence_features_unlocked_total{feature="badge_showcase"} 1');
      expect(output).toContain('sietch_coexistence_features_unlocked_total{feature="directory_listing"} 1');
    });

    it('should not include feature metrics when no features unlocked', () => {
      const output = getCoexistenceMetrics();

      expect(output).not.toContain('sietch_coexistence_features_unlocked_total');
    });

    it('should end with newline', () => {
      const output = getCoexistenceMetrics();

      expect(output.endsWith('\n')).toBe(true);
    });
  });

  describe('resetMetrics', () => {
    it('should reset all metrics to initial state', () => {
      // Add various metrics
      recordModeTransition(undefined, 'shadow');
      recordDivergence('false_positive');
      recordMigrationStart();
      recordHealthCheck(true);
      recordSocialLayerUnlock();
      recordFeatureUnlock('test_feature');
      recordDiscountGenerated();

      // Reset
      resetMetrics();

      const state = getMetricsState();
      expect(state.communitiesByMode.get('shadow')).toBe(0);
      expect(state.totalDivergences).toBe(0);
      expect(state.migrationsInProgress).toBe(0);
      expect(state.healthChecksTotal).toBe(0);
      expect(state.socialLayerUnlocks).toBe(0);
      expect(state.featuresUnlocked.size).toBe(0);
      expect(state.discountsGenerated).toBe(0);
    });
  });
});

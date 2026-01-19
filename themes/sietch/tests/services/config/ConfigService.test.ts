/**
 * ConfigService Tests
 *
 * Sprint 118: ConfigService Core
 *
 * Tests all CRUD operations, transaction rollback, and concurrent writes.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { DASHBOARD_CONFIG_SCHEMA_SQL } from '../../../src/db/migrations/019_dashboard_config.js';
import {
  ConfigService,
  ConfigNotFoundError,
  OptimisticLockError,
} from '../../../src/services/config/ConfigService.js';

describe('ConfigService', () => {
  let db: Database.Database;
  let service: ConfigService;

  beforeEach(() => {
    // Create in-memory database with schema
    db = new Database(':memory:');
    db.exec(DASHBOARD_CONFIG_SCHEMA_SQL);

    // Create service instance with mock logger
    service = new ConfigService({
      db,
      logger: {
        info: () => {},
        debug: () => {},
        warn: () => {},
        error: () => {},
      } as any,
    });
  });

  afterEach(() => {
    db.close();
  });

  // ===========================================================================
  // Initialization Tests
  // ===========================================================================

  describe('initializeConfiguration', () => {
    it('should create a new configuration with defaults', async () => {
      const config = await service.initializeConfiguration('server-123');

      expect(config.serverId).toBe('server-123');
      expect(config.thresholds).toEqual({});
      expect(config.featureGates).toEqual({});
      expect(config.roleMappings).toEqual({});
      expect(config.version).toBe(1);
      expect(config.schemaVersion).toBe(1);
    });

    it('should handle race condition (duplicate insert)', async () => {
      // First initialization
      await service.initializeConfiguration('server-123');

      // Second initialization should return existing config
      const config = await service.initializeConfiguration('server-123');

      expect(config.serverId).toBe('server-123');
      expect(config.version).toBe(1);
    });
  });

  // ===========================================================================
  // getCurrentConfiguration Tests
  // ===========================================================================

  describe('getCurrentConfiguration', () => {
    it('should return existing configuration', async () => {
      // Initialize first
      await service.initializeConfiguration('server-123');

      // Get configuration
      const config = await service.getCurrentConfiguration('server-123');

      expect(config.serverId).toBe('server-123');
      expect(config.version).toBe(1);
    });

    it('should auto-initialize for new server', async () => {
      const config = await service.getCurrentConfiguration('new-server');

      expect(config.serverId).toBe('new-server');
      expect(config.version).toBe(1);
      expect(config.thresholds).toEqual({});
    });
  });

  // ===========================================================================
  // updateThresholds Tests
  // ===========================================================================

  describe('updateThresholds', () => {
    beforeEach(async () => {
      await service.initializeConfiguration('server-123');
    });

    it('should create new threshold', async () => {
      const records = await service.updateThresholds(
        'server-123',
        'user-1',
        [{ tierId: 'tier-1', field: 'bgt', newValue: 1000 }],
        1
      );

      expect(records).toHaveLength(1);
      expect(records[0].action).toBe('CREATE');
      expect(records[0].recordableType).toBe('ThresholdChange');

      // Verify head pointer updated
      const config = await service.getCurrentConfiguration('server-123');
      expect(config.thresholds['tier-1']?.bgt).toBe(1000);
      expect(config.version).toBe(2);
    });

    it('should update existing threshold', async () => {
      // Create initial
      await service.updateThresholds(
        'server-123',
        'user-1',
        [{ tierId: 'tier-1', field: 'bgt', newValue: 1000 }],
        1
      );

      // Update
      const records = await service.updateThresholds(
        'server-123',
        'user-1',
        [{ tierId: 'tier-1', field: 'bgt', newValue: 2000 }],
        2
      );

      expect(records).toHaveLength(1);
      expect(records[0].action).toBe('UPDATE');

      const config = await service.getCurrentConfiguration('server-123');
      expect(config.thresholds['tier-1']?.bgt).toBe(2000);
      expect(config.version).toBe(3);
    });

    it('should handle multiple changes atomically', async () => {
      const records = await service.updateThresholds(
        'server-123',
        'user-1',
        [
          { tierId: 'tier-1', field: 'bgt', newValue: 1000 },
          { tierId: 'tier-1', field: 'engagement', newValue: 50 },
          { tierId: 'tier-2', field: 'bgt', newValue: 5000 },
        ],
        1
      );

      expect(records).toHaveLength(3);

      const config = await service.getCurrentConfiguration('server-123');
      expect(config.thresholds['tier-1']?.bgt).toBe(1000);
      expect(config.thresholds['tier-1']?.engagement).toBe(50);
      expect(config.thresholds['tier-2']?.bgt).toBe(5000);
      expect(config.version).toBe(2);
    });

    it('should throw OptimisticLockError on version mismatch', async () => {
      await expect(
        service.updateThresholds(
          'server-123',
          'user-1',
          [{ tierId: 'tier-1', field: 'bgt', newValue: 1000 }],
          99 // Wrong version
        )
      ).rejects.toThrow(OptimisticLockError);
    });

    it('should throw ConfigNotFoundError for non-existent server', async () => {
      // Delete the config to simulate non-existence
      db.exec("DELETE FROM current_configurations WHERE server_id = 'server-123'");

      await expect(
        service.updateThresholds(
          'server-123',
          'user-1',
          [{ tierId: 'tier-1', field: 'bgt', newValue: 1000 }],
          1
        )
      ).rejects.toThrow(ConfigNotFoundError);
    });
  });

  // ===========================================================================
  // updateFeatureGates Tests
  // ===========================================================================

  describe('updateFeatureGates', () => {
    beforeEach(async () => {
      await service.initializeConfiguration('server-123');
    });

    it('should create new feature gate', async () => {
      const records = await service.updateFeatureGates(
        'server-123',
        'user-1',
        [{ featureId: 'feature-1', tierId: 'tier-1', newAccess: true }],
        1
      );

      expect(records).toHaveLength(1);
      expect(records[0].action).toBe('CREATE');

      const config = await service.getCurrentConfiguration('server-123');
      expect(config.featureGates['feature-1']?.tierId).toBe('tier-1');
    });

    it('should update existing feature gate', async () => {
      // Create
      await service.updateFeatureGates(
        'server-123',
        'user-1',
        [{ featureId: 'feature-1', tierId: 'tier-1', newAccess: true }],
        1
      );

      // Update
      const records = await service.updateFeatureGates(
        'server-123',
        'user-1',
        [{ featureId: 'feature-1', tierId: 'tier-2', newAccess: false }],
        2
      );

      expect(records[0].action).toBe('UPDATE');

      const config = await service.getCurrentConfiguration('server-123');
      expect(config.featureGates['feature-1']?.tierId).toBe('tier-2');
    });

    it('should support feature gate conditions', async () => {
      await service.updateFeatureGates(
        'server-123',
        'user-1',
        [{ featureId: 'feature-1', tierId: 'tier-1', newAccess: true, condition: 'OR has_badge:early_adopter' }],
        1
      );

      const config = await service.getCurrentConfiguration('server-123');
      expect(config.featureGates['feature-1']?.condition).toBe('OR has_badge:early_adopter');
    });
  });

  // ===========================================================================
  // updateRoleMappings Tests
  // ===========================================================================

  describe('updateRoleMappings', () => {
    beforeEach(async () => {
      await service.initializeConfiguration('server-123');
    });

    it('should create new role mapping', async () => {
      const records = await service.updateRoleMappings(
        'server-123',
        'user-1',
        [{ roleId: 'role-1', roleName: 'VIP Role', newTierId: 'tier-1' }],
        1
      );

      expect(records).toHaveLength(1);
      expect(records[0].action).toBe('CREATE');

      const config = await service.getCurrentConfiguration('server-123');
      expect(config.roleMappings['role-1']?.tierId).toBe('tier-1');
      expect(config.roleMappings['role-1']?.roleName).toBe('VIP Role');
      expect(config.roleMappings['role-1']?.status).toBe('active');
    });

    it('should update existing role mapping', async () => {
      // Create
      await service.updateRoleMappings(
        'server-123',
        'user-1',
        [{ roleId: 'role-1', roleName: 'VIP Role', newTierId: 'tier-1' }],
        1
      );

      // Update
      const records = await service.updateRoleMappings(
        'server-123',
        'user-1',
        [{ roleId: 'role-1', roleName: 'VIP Role', newTierId: 'tier-2', priority: 10 }],
        2
      );

      expect(records[0].action).toBe('UPDATE');

      const config = await service.getCurrentConfiguration('server-123');
      expect(config.roleMappings['role-1']?.tierId).toBe('tier-2');
      expect(config.roleMappings['role-1']?.priority).toBe(10);
    });

    it('should delete role mapping', async () => {
      // Create
      await service.updateRoleMappings(
        'server-123',
        'user-1',
        [{ roleId: 'role-1', roleName: 'VIP Role', newTierId: 'tier-1' }],
        1
      );

      // Delete
      const records = await service.updateRoleMappings(
        'server-123',
        'user-1',
        [{ roleId: 'role-1', roleName: 'VIP Role', newTierId: null }],
        2
      );

      expect(records[0].action).toBe('DELETE');

      const config = await service.getCurrentConfiguration('server-123');
      expect(config.roleMappings['role-1']).toBeUndefined();
    });
  });

  // ===========================================================================
  // getConfigHistory Tests
  // ===========================================================================

  describe('getConfigHistory', () => {
    beforeEach(async () => {
      await service.initializeConfiguration('server-123');
    });

    it('should return empty history for new server', async () => {
      const result = await service.getConfigHistory({ serverId: 'server-123' });

      expect(result.records).toHaveLength(0);
      expect(result.total).toBe(0);
      expect(result.hasMore).toBe(false);
    });

    it('should return history with payloads', async () => {
      // Make some changes
      await service.updateThresholds(
        'server-123',
        'user-1',
        [{ tierId: 'tier-1', field: 'bgt', newValue: 1000 }],
        1
      );

      const result = await service.getConfigHistory({ serverId: 'server-123' });

      expect(result.records).toHaveLength(1);
      expect(result.records[0].recordableType).toBe('ThresholdChange');
      expect(result.records[0].payload).toBeDefined();
      expect((result.records[0].payload as any).newValue).toBe(1000);
    });

    it('should filter by recordableType', async () => {
      // Make threshold and feature gate changes
      await service.updateThresholds(
        'server-123',
        'user-1',
        [{ tierId: 'tier-1', field: 'bgt', newValue: 1000 }],
        1
      );
      await service.updateFeatureGates(
        'server-123',
        'user-1',
        [{ featureId: 'feature-1', tierId: 'tier-1', newAccess: true }],
        2
      );

      const result = await service.getConfigHistory({
        serverId: 'server-123',
        recordableType: 'ThresholdChange',
      });

      expect(result.records).toHaveLength(1);
      expect(result.records[0].recordableType).toBe('ThresholdChange');
    });

    it('should support pagination', async () => {
      // Make multiple changes
      for (let i = 1; i <= 5; i++) {
        await service.updateThresholds(
          'server-123',
          'user-1',
          [{ tierId: `tier-${i}`, field: 'bgt', newValue: i * 1000 }],
          i
        );
      }

      // First page
      const page1 = await service.getConfigHistory({
        serverId: 'server-123',
        limit: 2,
        offset: 0,
      });

      expect(page1.records).toHaveLength(2);
      expect(page1.total).toBe(5);
      expect(page1.hasMore).toBe(true);

      // Second page
      const page2 = await service.getConfigHistory({
        serverId: 'server-123',
        limit: 2,
        offset: 2,
      });

      expect(page2.records).toHaveLength(2);
      expect(page2.hasMore).toBe(true);

      // Last page
      const page3 = await service.getConfigHistory({
        serverId: 'server-123',
        limit: 2,
        offset: 4,
      });

      expect(page3.records).toHaveLength(1);
      expect(page3.hasMore).toBe(false);
    });
  });

  // ===========================================================================
  // Transaction Rollback Tests
  // ===========================================================================

  describe('transaction rollback', () => {
    beforeEach(async () => {
      await service.initializeConfiguration('server-123');
    });

    it('should rollback on version mismatch', async () => {
      // First update succeeds
      await service.updateThresholds(
        'server-123',
        'user-1',
        [{ tierId: 'tier-1', field: 'bgt', newValue: 1000 }],
        1
      );

      // Second update with stale version should fail
      await expect(
        service.updateThresholds(
          'server-123',
          'user-2',
          [{ tierId: 'tier-1', field: 'bgt', newValue: 2000 }],
          1 // Stale version
        )
      ).rejects.toThrow(OptimisticLockError);

      // Verify data unchanged
      const config = await service.getCurrentConfiguration('server-123');
      expect(config.thresholds['tier-1']?.bgt).toBe(1000);
      expect(config.version).toBe(2);
    });
  });

  // ===========================================================================
  // Concurrent Write Tests
  // ===========================================================================

  describe('concurrent writes', () => {
    beforeEach(async () => {
      await service.initializeConfiguration('server-123');
    });

    it('should handle concurrent updates with optimistic locking', async () => {
      // Simulate concurrent updates
      const update1 = service.updateThresholds(
        'server-123',
        'user-1',
        [{ tierId: 'tier-1', field: 'bgt', newValue: 1000 }],
        1
      );

      const update2 = service.updateThresholds(
        'server-123',
        'user-2',
        [{ tierId: 'tier-2', field: 'bgt', newValue: 2000 }],
        1
      );

      // One should succeed, one should fail
      const results = await Promise.allSettled([update1, update2]);

      const succeeded = results.filter(r => r.status === 'fulfilled');
      const failed = results.filter(r => r.status === 'rejected');

      expect(succeeded).toHaveLength(1);
      expect(failed).toHaveLength(1);
      expect((failed[0] as PromiseRejectedResult).reason).toBeInstanceOf(OptimisticLockError);
    });
  });
});

/**
 * Migration 019: Dashboard Configuration Tables Tests
 *
 * Sprint 117: Database Schema
 *
 * Tests migration up/down operations and validates:
 * - Table creation and structure
 * - Index creation
 * - Constraint enforcement
 * - Rollback functionality
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { up, down, DASHBOARD_CONFIG_SCHEMA_SQL, DASHBOARD_CONFIG_ROLLBACK_SQL } from '../../../src/db/migrations/019_dashboard_config.js';

describe('Migration 019: Dashboard Configuration Tables', () => {
  let db: Database.Database;

  beforeEach(() => {
    // Create in-memory database for testing
    db = new Database(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  describe('up migration', () => {
    it('should create current_configurations table', () => {
      db.exec(DASHBOARD_CONFIG_SCHEMA_SQL);

      const tables = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='current_configurations'"
      ).all();

      expect(tables).toHaveLength(1);
    });

    it('should create config_records table', () => {
      db.exec(DASHBOARD_CONFIG_SCHEMA_SQL);

      const tables = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='config_records'"
      ).all();

      expect(tables).toHaveLength(1);
    });

    it('should create all delegated payload tables', () => {
      db.exec(DASHBOARD_CONFIG_SCHEMA_SQL);

      const delegatedTables = [
        'threshold_changes',
        'feature_gate_changes',
        'role_map_changes',
        'theme_changes',
        'checkpoint_snapshots',
      ];

      for (const tableName of delegatedTables) {
        const tables = db.prepare(
          `SELECT name FROM sqlite_master WHERE type='table' AND name='${tableName}'`
        ).all();
        expect(tables).toHaveLength(1);
      }
    });

    it('should create indexes for current_configurations', () => {
      db.exec(DASHBOARD_CONFIG_SCHEMA_SQL);

      const indexes = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='current_configurations'"
      ).all();

      expect(indexes.some((idx: any) => idx.name === 'idx_current_configs_updated')).toBe(true);
    });

    it('should create indexes for config_records', () => {
      db.exec(DASHBOARD_CONFIG_SCHEMA_SQL);

      const indexes = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='config_records'"
      ).all();

      const indexNames = indexes.map((idx: any) => idx.name);
      expect(indexNames).toContain('idx_config_records_server');
      expect(indexNames).toContain('idx_config_records_type');
      expect(indexNames).toContain('idx_config_records_user');
      expect(indexNames).toContain('idx_config_records_created');
    });

    it('should enforce action constraint on config_records', () => {
      db.exec(DASHBOARD_CONFIG_SCHEMA_SQL);

      const insertValid = db.prepare(`
        INSERT INTO config_records (id, server_id, user_id, action, recordable_type, recordable_id)
        VALUES ('test-id', 'server-1', 'user-1', 'CREATE', 'ThresholdChange', 'change-1')
      `);

      expect(() => insertValid.run()).not.toThrow();

      const insertInvalid = db.prepare(`
        INSERT INTO config_records (id, server_id, user_id, action, recordable_type, recordable_id)
        VALUES ('test-id-2', 'server-1', 'user-1', 'INVALID', 'ThresholdChange', 'change-2')
      `);

      expect(() => insertInvalid.run()).toThrow(/CHECK constraint failed/);
    });

    it('should enforce recordable_type constraint on config_records', () => {
      db.exec(DASHBOARD_CONFIG_SCHEMA_SQL);

      const validTypes = [
        'ThresholdChange',
        'FeatureGateChange',
        'RoleMapChange',
        'ThemeChange',
        'CheckpointSnapshot',
      ];

      for (const type of validTypes) {
        const insert = db.prepare(`
          INSERT INTO config_records (id, server_id, user_id, action, recordable_type, recordable_id)
          VALUES (?, 'server-1', 'user-1', 'CREATE', ?, 'change-1')
        `);
        expect(() => insert.run(`id-${type}`, type)).not.toThrow();
      }

      const insertInvalid = db.prepare(`
        INSERT INTO config_records (id, server_id, user_id, action, recordable_type, recordable_id)
        VALUES ('id-invalid', 'server-1', 'user-1', 'CREATE', 'InvalidType', 'change-1')
      `);

      expect(() => insertInvalid.run()).toThrow(/CHECK constraint failed/);
    });

    it('should enforce field constraint on threshold_changes', () => {
      db.exec(DASHBOARD_CONFIG_SCHEMA_SQL);

      const validFields = ['bgt', 'engagement', 'tenure', 'activity'];

      for (const field of validFields) {
        const insert = db.prepare(`
          INSERT INTO threshold_changes (id, tier_id, field, new_value)
          VALUES (?, 'tier-1', ?, 100)
        `);
        expect(() => insert.run(`id-${field}`, field)).not.toThrow();
      }

      const insertInvalid = db.prepare(`
        INSERT INTO threshold_changes (id, tier_id, field, new_value)
        VALUES ('id-invalid', 'tier-1', 'invalid_field', 100)
      `);

      expect(() => insertInvalid.run()).toThrow(/CHECK constraint failed/);
    });

    it('should enforce change_type constraint on theme_changes', () => {
      db.exec(DASHBOARD_CONFIG_SCHEMA_SQL);

      const validTypes = ['activate', 'deactivate', 'modify', 'create', 'delete'];

      for (const changeType of validTypes) {
        const insert = db.prepare(`
          INSERT INTO theme_changes (id, theme_name, change_type, config_snapshot)
          VALUES (?, 'test-theme', ?, '{}')
        `);
        expect(() => insert.run(`id-${changeType}`, changeType)).not.toThrow();
      }

      const insertInvalid = db.prepare(`
        INSERT INTO theme_changes (id, theme_name, change_type, config_snapshot)
        VALUES ('id-invalid', 'test-theme', 'invalid_type', '{}')
      `);

      expect(() => insertInvalid.run()).toThrow(/CHECK constraint failed/);
    });

    it('should set default values for current_configurations', () => {
      db.exec(DASHBOARD_CONFIG_SCHEMA_SQL);

      db.prepare(`
        INSERT INTO current_configurations (server_id)
        VALUES ('test-server')
      `).run();

      const row = db.prepare(`
        SELECT * FROM current_configurations WHERE server_id = 'test-server'
      `).get() as any;

      expect(row.thresholds).toBe('{}');
      expect(row.feature_gates).toBe('{}');
      expect(row.role_mappings).toBe('{}');
      expect(row.version).toBe(1);
      expect(row.schema_version).toBe(1);
      expect(row.created_at).toBeTruthy();
      expect(row.updated_at).toBeTruthy();
    });

    it('should set default schema_version on delegated tables', () => {
      db.exec(DASHBOARD_CONFIG_SCHEMA_SQL);

      db.prepare(`
        INSERT INTO threshold_changes (id, tier_id, field, new_value)
        VALUES ('test-id', 'tier-1', 'bgt', 1000)
      `).run();

      const row = db.prepare(`
        SELECT schema_version FROM threshold_changes WHERE id = 'test-id'
      `).get() as any;

      expect(row.schema_version).toBe(1);
    });
  });

  describe('down migration', () => {
    it('should drop all tables created by up migration', () => {
      db.exec(DASHBOARD_CONFIG_SCHEMA_SQL);

      // Verify tables exist
      const tablesBefore = db.prepare(`
        SELECT name FROM sqlite_master WHERE type='table' AND name IN (
          'current_configurations',
          'config_records',
          'threshold_changes',
          'feature_gate_changes',
          'role_map_changes',
          'theme_changes',
          'checkpoint_snapshots'
        )
      `).all();

      expect(tablesBefore).toHaveLength(7);

      // Run rollback
      db.exec(DASHBOARD_CONFIG_ROLLBACK_SQL);

      // Verify tables are gone
      const tablesAfter = db.prepare(`
        SELECT name FROM sqlite_master WHERE type='table' AND name IN (
          'current_configurations',
          'config_records',
          'threshold_changes',
          'feature_gate_changes',
          'role_map_changes',
          'theme_changes',
          'checkpoint_snapshots'
        )
      `).all();

      expect(tablesAfter).toHaveLength(0);
    });

    it('should be idempotent (running down twice should not fail)', () => {
      db.exec(DASHBOARD_CONFIG_SCHEMA_SQL);
      db.exec(DASHBOARD_CONFIG_ROLLBACK_SQL);

      // Running rollback again should not throw
      expect(() => db.exec(DASHBOARD_CONFIG_ROLLBACK_SQL)).not.toThrow();
    });
  });

  describe('CRUD operations', () => {
    beforeEach(() => {
      db.exec(DASHBOARD_CONFIG_SCHEMA_SQL);
    });

    it('should store and retrieve JSON in current_configurations', () => {
      const thresholds = JSON.stringify({
        'tier-1': { bgt: 1000, engagement: 50 },
        'tier-2': { bgt: 5000, engagement: 100 },
      });

      db.prepare(`
        INSERT INTO current_configurations (server_id, thresholds)
        VALUES ('test-server', ?)
      `).run(thresholds);

      const row = db.prepare(`
        SELECT thresholds FROM current_configurations WHERE server_id = 'test-server'
      `).get() as any;

      const parsed = JSON.parse(row.thresholds);
      expect(parsed['tier-1'].bgt).toBe(1000);
      expect(parsed['tier-2'].engagement).toBe(100);
    });

    it('should support optimistic locking via version field', () => {
      db.prepare(`
        INSERT INTO current_configurations (server_id)
        VALUES ('test-server')
      `).run();

      // Simulate optimistic lock update
      const result = db.prepare(`
        UPDATE current_configurations
        SET thresholds = '{"tier-1": {"bgt": 500}}', version = version + 1
        WHERE server_id = 'test-server' AND version = 1
      `).run();

      expect(result.changes).toBe(1);

      const row = db.prepare(`
        SELECT version FROM current_configurations WHERE server_id = 'test-server'
      `).get() as any;

      expect(row.version).toBe(2);
    });

    it('should support append-only history in config_records', () => {
      // Insert multiple records for same server
      const insertRecord = db.prepare(`
        INSERT INTO config_records (id, server_id, user_id, action, recordable_type, recordable_id)
        VALUES (?, 'server-1', 'user-1', ?, 'ThresholdChange', ?)
      `);

      insertRecord.run('record-1', 'CREATE', 'change-1');
      insertRecord.run('record-2', 'UPDATE', 'change-2');
      insertRecord.run('record-3', 'UPDATE', 'change-3');

      const records = db.prepare(`
        SELECT * FROM config_records WHERE server_id = 'server-1' ORDER BY created_at DESC
      `).all();

      expect(records).toHaveLength(3);
    });

    it('should support checkpoint snapshot with expiration', () => {
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      const fullState = JSON.stringify({
        thresholds: { 'tier-1': { bgt: 1000 } },
        featureGates: {},
        roleMappings: {},
      });

      db.prepare(`
        INSERT INTO checkpoint_snapshots (id, server_id, trigger_command, full_state_json, expires_at)
        VALUES ('checkpoint-1', 'server-1', 'DELETE_ALL_ROLES', ?, ?)
      `).run(fullState, expiresAt);

      const row = db.prepare(`
        SELECT * FROM checkpoint_snapshots WHERE id = 'checkpoint-1'
      `).get() as any;

      expect(row.trigger_command).toBe('DELETE_ALL_ROLES');
      expect(JSON.parse(row.full_state_json).thresholds['tier-1'].bgt).toBe(1000);
    });
  });
});

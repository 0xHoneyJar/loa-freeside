/**
 * ConfigService - Configuration Management
 *
 * Sprint 118: ConfigService Core
 *
 * Handles all configuration CRUD operations with transactional guarantees.
 * Writes to both history (config_records) and head pointer (current_configurations).
 *
 * @see grimoires/loa/sdd.md §4.1 ConfigService
 * @see grimoires/loa/prd.md §4.7 Data Architecture
 */

import { randomUUID } from 'crypto';
import type Database from 'better-sqlite3';
import type { Redis } from 'ioredis';
import { logger as defaultLogger } from '../../utils/logger.js';
import type { IConfigPublisher } from './ConfigPublisher.js';
import type { IConfigCache } from './ConfigCache.js';
import type {
  ConfigAction,
  ConfigHistoryQuery,
  ConfigHistoryResult,
  ConfigRecord,
  ConfigRecordRow,
  ConfigRecordWithPayload,
  CurrentConfiguration,
  CurrentConfigurationRow,
  FeatureGate,
  FeatureGateChange,
  FeatureGateChangeInput,
  FeatureGateChangeRow,
  RecordableType,
  RoleMapChange,
  RoleMapChangeInput,
  RoleMapChangeRow,
  RoleMapping,
  ThresholdChange,
  ThresholdChangeInput,
  ThresholdChangeRow,
  TierThresholds,
} from '../../db/types/config.types.js';

// =============================================================================
// Types
// =============================================================================

export interface ConfigServiceConfig {
  db: Database.Database;
  redis?: Redis;
  logger?: typeof defaultLogger;
  /** Optional publisher for Pub/Sub invalidation (Sprint 119) */
  publisher?: IConfigPublisher;
  /** Optional cache layer (Sprint 120) */
  cache?: IConfigCache;
}

export interface IConfigService {
  getCurrentConfiguration(serverId: string): Promise<CurrentConfiguration>;
  getConfigHistory(query: ConfigHistoryQuery): Promise<ConfigHistoryResult>;
  updateThresholds(
    serverId: string,
    userId: string,
    changes: ThresholdChangeInput[],
    expectedVersion: number
  ): Promise<ConfigRecord[]>;
  updateFeatureGates(
    serverId: string,
    userId: string,
    changes: FeatureGateChangeInput[],
    expectedVersion: number
  ): Promise<ConfigRecord[]>;
  updateRoleMappings(
    serverId: string,
    userId: string,
    changes: RoleMapChangeInput[],
    expectedVersion: number
  ): Promise<ConfigRecord[]>;
  initializeConfiguration(serverId: string): Promise<CurrentConfiguration>;
}

// =============================================================================
// Errors
// =============================================================================

export class ConfigNotFoundError extends Error {
  constructor(serverId: string) {
    super(`Configuration not found for server ${serverId}`);
    this.name = 'ConfigNotFoundError';
  }
}

export class OptimisticLockError extends Error {
  constructor(serverId: string, expected: number, actual: number) {
    super(
      `Version conflict for server ${serverId}: expected ${expected}, got ${actual}`
    );
    this.name = 'OptimisticLockError';
  }
}

// =============================================================================
// ConfigService Implementation
// =============================================================================

export class ConfigService implements IConfigService {
  private readonly db: Database.Database;
  private readonly redis?: Redis;
  private readonly logger: typeof defaultLogger;
  private readonly publisher?: IConfigPublisher;
  private readonly cache?: IConfigCache;

  // Prepared statements (lazy initialization)
  private statements?: {
    getCurrentConfig: Database.Statement;
    getCurrentConfigForUpdate: Database.Statement;
    insertCurrentConfig: Database.Statement;
    updateCurrentConfigThresholds: Database.Statement;
    updateCurrentConfigFeatureGates: Database.Statement;
    updateCurrentConfigRoleMappings: Database.Statement;
    insertConfigRecord: Database.Statement;
    insertThresholdChange: Database.Statement;
    insertFeatureGateChange: Database.Statement;
    insertRoleMapChange: Database.Statement;
    getConfigRecords: Database.Statement;
    getConfigRecordsWithType: Database.Statement;
    getThresholdChange: Database.Statement;
    getFeatureGateChange: Database.Statement;
    getRoleMapChange: Database.Statement;
    countConfigRecords: Database.Statement;
    countConfigRecordsWithType: Database.Statement;
  };

  constructor(config: ConfigServiceConfig) {
    this.db = config.db;
    this.redis = config.redis;
    this.logger = config.logger ?? defaultLogger;
    this.publisher = config.publisher;
    this.cache = config.cache;
  }

  // ===========================================================================
  // Prepared Statements (Lazy Initialization)
  // ===========================================================================

  private getStatements() {
    if (!this.statements) {
      this.statements = {
        getCurrentConfig: this.db.prepare(`
          SELECT * FROM current_configurations WHERE server_id = ?
        `),
        getCurrentConfigForUpdate: this.db.prepare(`
          SELECT * FROM current_configurations WHERE server_id = ?
        `),
        insertCurrentConfig: this.db.prepare(`
          INSERT INTO current_configurations (server_id, thresholds, feature_gates, role_mappings)
          VALUES (?, '{}', '{}', '{}')
        `),
        updateCurrentConfigThresholds: this.db.prepare(`
          UPDATE current_configurations
          SET thresholds = ?, last_record_id = ?, version = version + 1, updated_at = datetime('now')
          WHERE server_id = ? AND version = ?
        `),
        updateCurrentConfigFeatureGates: this.db.prepare(`
          UPDATE current_configurations
          SET feature_gates = ?, last_record_id = ?, version = version + 1, updated_at = datetime('now')
          WHERE server_id = ? AND version = ?
        `),
        updateCurrentConfigRoleMappings: this.db.prepare(`
          UPDATE current_configurations
          SET role_mappings = ?, last_record_id = ?, version = version + 1, updated_at = datetime('now')
          WHERE server_id = ? AND version = ?
        `),
        insertConfigRecord: this.db.prepare(`
          INSERT INTO config_records (id, server_id, user_id, action, recordable_type, recordable_id, metadata)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `),
        insertThresholdChange: this.db.prepare(`
          INSERT INTO threshold_changes (id, tier_id, field, old_value, new_value)
          VALUES (?, ?, ?, ?, ?)
        `),
        insertFeatureGateChange: this.db.prepare(`
          INSERT INTO feature_gate_changes (id, feature_id, tier_id, old_access, new_access, condition)
          VALUES (?, ?, ?, ?, ?, ?)
        `),
        insertRoleMapChange: this.db.prepare(`
          INSERT INTO role_map_changes (id, role_id, role_name, old_tier_id, new_tier_id, priority)
          VALUES (?, ?, ?, ?, ?, ?)
        `),
        getConfigRecords: this.db.prepare(`
          SELECT * FROM config_records
          WHERE server_id = ?
          ORDER BY created_at DESC
          LIMIT ? OFFSET ?
        `),
        getConfigRecordsWithType: this.db.prepare(`
          SELECT * FROM config_records
          WHERE server_id = ? AND recordable_type = ?
          ORDER BY created_at DESC
          LIMIT ? OFFSET ?
        `),
        getThresholdChange: this.db.prepare(`
          SELECT * FROM threshold_changes WHERE id = ?
        `),
        getFeatureGateChange: this.db.prepare(`
          SELECT * FROM feature_gate_changes WHERE id = ?
        `),
        getRoleMapChange: this.db.prepare(`
          SELECT * FROM role_map_changes WHERE id = ?
        `),
        countConfigRecords: this.db.prepare(`
          SELECT COUNT(*) as count FROM config_records WHERE server_id = ?
        `),
        countConfigRecordsWithType: this.db.prepare(`
          SELECT COUNT(*) as count FROM config_records WHERE server_id = ? AND recordable_type = ?
        `),
      };
    }
    return this.statements;
  }

  // ===========================================================================
  // Read Operations
  // ===========================================================================

  /**
   * Get current configuration for a server (from head pointer)
   * O(1) read from current_configurations table.
   *
   * Cache strategy (Sprint 120):
   * 1. Check cache (L1 -> L2)
   * 2. If miss, read from database
   * 3. Populate cache on miss
   */
  async getCurrentConfiguration(serverId: string): Promise<CurrentConfiguration> {
    // Try cache first (Sprint 120)
    if (this.cache) {
      const cached = await this.cache.get(serverId);
      if (cached) {
        return cached;
      }
    }

    const stmts = this.getStatements();
    const row = stmts.getCurrentConfig.get(serverId) as CurrentConfigurationRow | undefined;

    if (!row) {
      // Initialize with defaults for new server
      return this.initializeConfiguration(serverId);
    }

    const config = this.mapRowToCurrentConfiguration(row);

    // Populate cache (Sprint 120)
    if (this.cache) {
      await this.cache.set(serverId, config);
    }

    return config;
  }

  /**
   * Get configuration history for a server with optional filtering and pagination.
   */
  async getConfigHistory(query: ConfigHistoryQuery): Promise<ConfigHistoryResult> {
    const { serverId, recordableType, limit = 50, offset = 0 } = query;
    const stmts = this.getStatements();

    // Get total count
    let total: number;
    if (recordableType) {
      const countRow = stmts.countConfigRecordsWithType.get(serverId, recordableType) as { count: number };
      total = countRow.count;
    } else {
      const countRow = stmts.countConfigRecords.get(serverId) as { count: number };
      total = countRow.count;
    }

    // Get records
    let rows: ConfigRecordRow[];
    if (recordableType) {
      rows = stmts.getConfigRecordsWithType.all(serverId, recordableType, limit, offset) as ConfigRecordRow[];
    } else {
      rows = stmts.getConfigRecords.all(serverId, limit, offset) as ConfigRecordRow[];
    }

    // Map rows and load payloads
    const records: ConfigRecordWithPayload[] = [];
    for (const row of rows) {
      const record = this.mapRowToConfigRecord(row);
      const payload = await this.loadPayload(row.recordable_type, row.recordable_id);
      if (payload) {
        records.push({ ...record, payload });
      }
    }

    return {
      records,
      total,
      hasMore: offset + limit < total,
    };
  }

  // ===========================================================================
  // Write Operations
  // ===========================================================================

  /**
   * Update tier thresholds.
   * Atomic operation: delegated record + config record + head pointer update.
   */
  async updateThresholds(
    serverId: string,
    userId: string,
    changes: ThresholdChangeInput[],
    expectedVersion: number
  ): Promise<ConfigRecord[]> {
    const stmts = this.getStatements();
    const records: ConfigRecord[] = [];

    // Run in transaction
    const transaction = this.db.transaction(() => {
      // 1. Get current config and verify version
      const currentRow = stmts.getCurrentConfig.get(serverId) as CurrentConfigurationRow | undefined;
      if (!currentRow) {
        throw new ConfigNotFoundError(serverId);
      }
      if (currentRow.version !== expectedVersion) {
        throw new OptimisticLockError(serverId, expectedVersion, currentRow.version);
      }

      // Parse current thresholds
      const thresholds: Record<string, TierThresholds> = JSON.parse(currentRow.thresholds);

      // 2. Create delegated records and config records for each change
      for (const change of changes) {
        const oldValue = thresholds[change.tierId]?.[change.field] ?? null;
        const action: ConfigAction = oldValue === null ? 'CREATE' : 'UPDATE';

        // Insert delegated payload
        const changeId = randomUUID();
        stmts.insertThresholdChange.run(
          changeId,
          change.tierId,
          change.field,
          oldValue,
          change.newValue
        );

        // Insert config record
        const recordId = randomUUID();
        const now = new Date().toISOString();
        stmts.insertConfigRecord.run(
          recordId,
          serverId,
          userId,
          action,
          'ThresholdChange',
          changeId,
          '{}'
        );

        records.push({
          id: recordId,
          serverId,
          userId,
          action,
          recordableType: 'ThresholdChange',
          recordableId: changeId,
          schemaVersion: 1,
          createdAt: new Date(now),
        });

        // Update in-memory thresholds
        if (!thresholds[change.tierId]) {
          thresholds[change.tierId] = {};
        }
        const tierThresholds = thresholds[change.tierId];
        if (tierThresholds) {
          tierThresholds[change.field] = change.newValue;
        }
      }

      // 3. Update head pointer with optimistic lock
      const lastRecord = records[records.length - 1];
      if (!lastRecord) {
        throw new Error('No records created');
      }
      const lastRecordId = lastRecord.id;
      const result = stmts.updateCurrentConfigThresholds.run(
        JSON.stringify(thresholds),
        lastRecordId,
        serverId,
        expectedVersion
      );

      if (result.changes === 0) {
        throw new OptimisticLockError(serverId, expectedVersion, currentRow.version);
      }

      return records;
    });

    const result = transaction();

    // 4. Invalidate cache (Sprint 120)
    if (this.cache) {
      await this.cache.invalidate(serverId);
    }

    // 5. Publish invalidation (Sprint 119)
    if (this.publisher) {
      await this.publisher.publishInvalidations(result);
    }

    this.logger.info(
      { serverId, userId, changeCount: result.length },
      'Updated thresholds'
    );

    return result;
  }

  /**
   * Update feature gates.
   * Atomic operation: delegated record + config record + head pointer update.
   */
  async updateFeatureGates(
    serverId: string,
    userId: string,
    changes: FeatureGateChangeInput[],
    expectedVersion: number
  ): Promise<ConfigRecord[]> {
    const stmts = this.getStatements();
    const records: ConfigRecord[] = [];

    const transaction = this.db.transaction(() => {
      const currentRow = stmts.getCurrentConfig.get(serverId) as CurrentConfigurationRow | undefined;
      if (!currentRow) {
        throw new ConfigNotFoundError(serverId);
      }
      if (currentRow.version !== expectedVersion) {
        throw new OptimisticLockError(serverId, expectedVersion, currentRow.version);
      }

      const featureGates: Record<string, FeatureGate> = JSON.parse(currentRow.feature_gates);

      for (const change of changes) {
        const oldGate = featureGates[change.featureId];
        const oldAccess = oldGate ? (oldGate.tierId === change.tierId) : null;
        const action: ConfigAction = oldAccess === null ? 'CREATE' : 'UPDATE';

        const changeId = randomUUID();
        stmts.insertFeatureGateChange.run(
          changeId,
          change.featureId,
          change.tierId,
          oldAccess === null ? null : (oldAccess ? 1 : 0),
          change.newAccess ? 1 : 0,
          change.condition ?? null
        );

        const recordId = randomUUID();
        const now = new Date().toISOString();
        stmts.insertConfigRecord.run(
          recordId,
          serverId,
          userId,
          action,
          'FeatureGateChange',
          changeId,
          '{}'
        );

        records.push({
          id: recordId,
          serverId,
          userId,
          action,
          recordableType: 'FeatureGateChange',
          recordableId: changeId,
          schemaVersion: 1,
          createdAt: new Date(now),
        });

        featureGates[change.featureId] = {
          tierId: change.tierId,
          condition: change.condition,
        };
      }

      const lastRecord = records[records.length - 1];
      if (!lastRecord) {
        throw new Error('No records created');
      }
      const lastRecordId = lastRecord.id;
      const result = stmts.updateCurrentConfigFeatureGates.run(
        JSON.stringify(featureGates),
        lastRecordId,
        serverId,
        expectedVersion
      );

      if (result.changes === 0) {
        throw new OptimisticLockError(serverId, expectedVersion, currentRow.version);
      }

      return records;
    });

    const result = transaction();

    // Invalidate cache (Sprint 120)
    if (this.cache) {
      await this.cache.invalidate(serverId);
    }

    // Publish invalidation (Sprint 119)
    if (this.publisher) {
      await this.publisher.publishInvalidations(result);
    }

    this.logger.info(
      { serverId, userId, changeCount: result.length },
      'Updated feature gates'
    );

    return result;
  }

  /**
   * Update role mappings.
   * Atomic operation: delegated record + config record + head pointer update.
   */
  async updateRoleMappings(
    serverId: string,
    userId: string,
    changes: RoleMapChangeInput[],
    expectedVersion: number
  ): Promise<ConfigRecord[]> {
    const stmts = this.getStatements();
    const records: ConfigRecord[] = [];

    const transaction = this.db.transaction(() => {
      const currentRow = stmts.getCurrentConfig.get(serverId) as CurrentConfigurationRow | undefined;
      if (!currentRow) {
        throw new ConfigNotFoundError(serverId);
      }
      if (currentRow.version !== expectedVersion) {
        throw new OptimisticLockError(serverId, expectedVersion, currentRow.version);
      }

      const roleMappings: Record<string, RoleMapping> = JSON.parse(currentRow.role_mappings);

      for (const change of changes) {
        const oldMapping = roleMappings[change.roleId];
        const oldTierId = oldMapping?.tierId ?? null;
        const action: ConfigAction = change.newTierId === null
          ? 'DELETE'
          : oldTierId === null
            ? 'CREATE'
            : 'UPDATE';

        const changeId = randomUUID();
        stmts.insertRoleMapChange.run(
          changeId,
          change.roleId,
          change.roleName,
          oldTierId,
          change.newTierId,
          change.priority ?? 0
        );

        const recordId = randomUUID();
        const now = new Date().toISOString();
        stmts.insertConfigRecord.run(
          recordId,
          serverId,
          userId,
          action,
          'RoleMapChange',
          changeId,
          '{}'
        );

        records.push({
          id: recordId,
          serverId,
          userId,
          action,
          recordableType: 'RoleMapChange',
          recordableId: changeId,
          schemaVersion: 1,
          createdAt: new Date(now),
        });

        if (change.newTierId === null) {
          delete roleMappings[change.roleId];
        } else {
          roleMappings[change.roleId] = {
            roleId: change.roleId,
            roleName: change.roleName,
            tierId: change.newTierId,
            priority: change.priority ?? 0,
            status: 'active',
          };
        }
      }

      const lastRecord = records[records.length - 1];
      if (!lastRecord) {
        throw new Error('No records created');
      }
      const lastRecordId = lastRecord.id;
      const result = stmts.updateCurrentConfigRoleMappings.run(
        JSON.stringify(roleMappings),
        lastRecordId,
        serverId,
        expectedVersion
      );

      if (result.changes === 0) {
        throw new OptimisticLockError(serverId, expectedVersion, currentRow.version);
      }

      return records;
    });

    const result = transaction();

    // Invalidate cache (Sprint 120)
    if (this.cache) {
      await this.cache.invalidate(serverId);
    }

    // Publish invalidation (Sprint 119)
    if (this.publisher) {
      await this.publisher.publishInvalidations(result);
    }

    this.logger.info(
      { serverId, userId, changeCount: result.length },
      'Updated role mappings'
    );

    return result;
  }

  /**
   * Initialize configuration with defaults for a new server.
   */
  async initializeConfiguration(serverId: string): Promise<CurrentConfiguration> {
    const stmts = this.getStatements();

    try {
      stmts.insertCurrentConfig.run(serverId);
    } catch (error: any) {
      // Handle race condition: another process may have initialized
      if (error.code === 'SQLITE_CONSTRAINT_PRIMARYKEY') {
        const row = stmts.getCurrentConfig.get(serverId) as CurrentConfigurationRow;
        return this.mapRowToCurrentConfiguration(row);
      }
      throw error;
    }

    const row = stmts.getCurrentConfig.get(serverId) as CurrentConfigurationRow;
    const config = this.mapRowToCurrentConfiguration(row);

    this.logger.info({ serverId }, 'Initialized configuration');

    return config;
  }

  // ===========================================================================
  // Private Helpers
  // ===========================================================================

  private mapRowToCurrentConfiguration(row: CurrentConfigurationRow): CurrentConfiguration {
    return {
      serverId: row.server_id,
      thresholds: JSON.parse(row.thresholds),
      featureGates: JSON.parse(row.feature_gates),
      roleMappings: JSON.parse(row.role_mappings),
      activeThemeId: row.active_theme_id,
      lastRecordId: row.last_record_id,
      version: row.version,
      schemaVersion: row.schema_version,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }

  private mapRowToConfigRecord(row: ConfigRecordRow): ConfigRecord {
    return {
      id: row.id,
      serverId: row.server_id,
      userId: row.user_id,
      action: row.action,
      recordableType: row.recordable_type,
      recordableId: row.recordable_id,
      schemaVersion: row.schema_version,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      createdAt: new Date(row.created_at),
    };
  }

  private async loadPayload(
    type: RecordableType,
    id: string
  ): Promise<ThresholdChange | FeatureGateChange | RoleMapChange | null> {
    const stmts = this.getStatements();

    switch (type) {
      case 'ThresholdChange': {
        const row = stmts.getThresholdChange.get(id) as ThresholdChangeRow | undefined;
        if (!row) return null;
        return {
          id: row.id,
          schemaVersion: row.schema_version,
          tierId: row.tier_id,
          field: row.field,
          oldValue: row.old_value,
          newValue: row.new_value,
        };
      }
      case 'FeatureGateChange': {
        const row = stmts.getFeatureGateChange.get(id) as FeatureGateChangeRow | undefined;
        if (!row) return null;
        return {
          id: row.id,
          schemaVersion: row.schema_version,
          featureId: row.feature_id,
          tierId: row.tier_id,
          oldAccess: row.old_access === null ? null : row.old_access === 1,
          newAccess: row.new_access === 1,
          condition: row.condition ?? undefined,
        };
      }
      case 'RoleMapChange': {
        const row = stmts.getRoleMapChange.get(id) as RoleMapChangeRow | undefined;
        if (!row) return null;
        return {
          id: row.id,
          schemaVersion: row.schema_version,
          roleId: row.role_id,
          roleName: row.role_name,
          oldTierId: row.old_tier_id,
          newTierId: row.new_tier_id,
          priority: row.priority,
        };
      }
      default:
        return null;
    }
  }
}

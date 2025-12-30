/**
 * CoexistenceStorage - PostgreSQL Adapter for Coexistence Data
 *
 * Sprint 56: Shadow Mode Foundation - Incumbent Detection
 *
 * Implements ICoexistenceStorage interface using Drizzle ORM with PostgreSQL.
 * Handles storage for incumbent configurations and migration states.
 *
 * Security:
 * - All operations respect RLS policies via TenantContext
 * - Audit logging for state transitions
 *
 * @module packages/adapters/coexistence/CoexistenceStorage
 */

import { eq, and } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import {
  incumbentConfigs,
  migrationStates,
  type CoexistenceMode,
  type MigrationStrategy,
  type HealthStatus,
  type IncumbentProvider,
  type DetectedRole,
  type IncumbentCapabilities,
} from '../storage/schema.js';
import type {
  ICoexistenceStorage,
  StoredIncumbentConfig,
  SaveIncumbentInput,
  UpdateHealthInput,
  StoredMigrationState,
  SaveMigrationStateInput,
} from '../../core/ports/ICoexistenceStorage.js';
import { createLogger, type ILogger } from '../../infrastructure/logging/index.js';

// =============================================================================
// Constants
// =============================================================================

/** Default capabilities for unknown incumbents */
const DEFAULT_CAPABILITIES: IncumbentCapabilities = {
  hasBalanceCheck: true,
  hasConvictionScoring: false,
  hasTierSystem: false,
  hasSocialLayer: false,
};

// =============================================================================
// Implementation
// =============================================================================

/**
 * PostgreSQL implementation of ICoexistenceStorage
 */
export class CoexistenceStorage implements ICoexistenceStorage {
  private readonly logger: ILogger;

  constructor(
    private readonly db: PostgresJsDatabase,
    logger?: ILogger
  ) {
    this.logger = logger ?? createLogger({ service: 'CoexistenceStorage' });
  }

  // =========================================================================
  // Incumbent Configuration Methods
  // =========================================================================

  async getIncumbentConfig(communityId: string): Promise<StoredIncumbentConfig | null> {
    const result = await this.db
      .select()
      .from(incumbentConfigs)
      .where(eq(incumbentConfigs.communityId, communityId))
      .limit(1);

    if (result.length === 0) {
      return null;
    }

    return this.mapIncumbentConfig(result[0]);
  }

  async saveIncumbentConfig(input: SaveIncumbentInput): Promise<StoredIncumbentConfig> {
    const existing = await this.getIncumbentConfig(input.communityId);

    if (existing) {
      // Update existing
      const [updated] = await this.db
        .update(incumbentConfigs)
        .set({
          provider: input.provider,
          botId: input.botId ?? null,
          botUsername: input.botUsername ?? null,
          verificationChannelId: input.verificationChannelId ?? null,
          confidence: Math.round(input.confidence * 100), // Store as 0-100 integer
          manualOverride: input.manualOverride ?? false,
          detectedRoles: input.detectedRoles ?? [],
          capabilities: input.capabilities ?? DEFAULT_CAPABILITIES,
          updatedAt: new Date(),
        })
        .where(eq(incumbentConfigs.communityId, input.communityId))
        .returning();

      this.logger.info('Incumbent config updated', {
        communityId: input.communityId,
        provider: input.provider,
      });

      return this.mapIncumbentConfig(updated);
    }

    // Create new
    const [created] = await this.db
      .insert(incumbentConfigs)
      .values({
        communityId: input.communityId,
        provider: input.provider,
        botId: input.botId ?? null,
        botUsername: input.botUsername ?? null,
        verificationChannelId: input.verificationChannelId ?? null,
        confidence: Math.round(input.confidence * 100),
        manualOverride: input.manualOverride ?? false,
        detectedRoles: input.detectedRoles ?? [],
        capabilities: input.capabilities ?? DEFAULT_CAPABILITIES,
      })
      .returning();

    this.logger.info('Incumbent config created', {
      communityId: input.communityId,
      provider: input.provider,
    });

    return this.mapIncumbentConfig(created);
  }

  async updateIncumbentHealth(input: UpdateHealthInput): Promise<void> {
    await this.db
      .update(incumbentConfigs)
      .set({
        healthStatus: input.healthStatus,
        lastHealthCheck: input.lastHealthCheck,
        updatedAt: new Date(),
      })
      .where(eq(incumbentConfigs.communityId, input.communityId));

    this.logger.debug('Incumbent health updated', {
      communityId: input.communityId,
      healthStatus: input.healthStatus,
    });
  }

  async deleteIncumbentConfig(communityId: string): Promise<void> {
    await this.db
      .delete(incumbentConfigs)
      .where(eq(incumbentConfigs.communityId, communityId));

    this.logger.info('Incumbent config deleted', { communityId });
  }

  async hasIncumbent(communityId: string): Promise<boolean> {
    const result = await this.db
      .select({ id: incumbentConfigs.id })
      .from(incumbentConfigs)
      .where(eq(incumbentConfigs.communityId, communityId))
      .limit(1);

    return result.length > 0;
  }

  // =========================================================================
  // Migration State Methods
  // =========================================================================

  async getMigrationState(communityId: string): Promise<StoredMigrationState | null> {
    const result = await this.db
      .select()
      .from(migrationStates)
      .where(eq(migrationStates.communityId, communityId))
      .limit(1);

    if (result.length === 0) {
      return null;
    }

    return this.mapMigrationState(result[0]);
  }

  async saveMigrationState(input: SaveMigrationStateInput): Promise<StoredMigrationState> {
    const existing = await this.getMigrationState(input.communityId);

    if (existing) {
      // Update existing
      const [updated] = await this.db
        .update(migrationStates)
        .set({
          currentMode: input.currentMode,
          targetMode: input.targetMode ?? null,
          strategy: input.strategy ?? null,
          shadowStartedAt: input.shadowStartedAt ?? existing.shadowStartedAt,
          parallelEnabledAt: input.parallelEnabledAt ?? existing.parallelEnabledAt,
          primaryEnabledAt: input.primaryEnabledAt ?? existing.primaryEnabledAt,
          exclusiveEnabledAt: input.exclusiveEnabledAt ?? existing.exclusiveEnabledAt,
          rollbackCount: input.rollbackCount ?? existing.rollbackCount,
          lastRollbackAt: input.lastRollbackAt ?? existing.lastRollbackAt,
          lastRollbackReason: input.lastRollbackReason ?? existing.lastRollbackReason,
          readinessCheckPassed: input.readinessCheckPassed ?? existing.readinessCheckPassed,
          accuracyPercent: input.accuracyPercent !== undefined
            ? Math.round(input.accuracyPercent * 100) // Store as 0-10000 for 2 decimal places
            : existing.accuracyPercent,
          shadowDays: input.shadowDays ?? existing.shadowDays,
          updatedAt: new Date(),
        })
        .where(eq(migrationStates.communityId, input.communityId))
        .returning();

      this.logger.info('Migration state updated', {
        communityId: input.communityId,
        currentMode: input.currentMode,
      });

      return this.mapMigrationState(updated);
    }

    // Create new
    const [created] = await this.db
      .insert(migrationStates)
      .values({
        communityId: input.communityId,
        currentMode: input.currentMode,
        targetMode: input.targetMode ?? null,
        strategy: input.strategy ?? null,
        shadowStartedAt: input.shadowStartedAt ?? (input.currentMode === 'shadow' ? new Date() : null),
        parallelEnabledAt: input.parallelEnabledAt ?? null,
        primaryEnabledAt: input.primaryEnabledAt ?? null,
        exclusiveEnabledAt: input.exclusiveEnabledAt ?? null,
        rollbackCount: input.rollbackCount ?? 0,
        lastRollbackAt: input.lastRollbackAt ?? null,
        lastRollbackReason: input.lastRollbackReason ?? null,
        readinessCheckPassed: input.readinessCheckPassed ?? false,
        accuracyPercent: input.accuracyPercent !== undefined
          ? Math.round(input.accuracyPercent * 100)
          : null,
        shadowDays: input.shadowDays ?? 0,
      })
      .returning();

    this.logger.info('Migration state created', {
      communityId: input.communityId,
      currentMode: input.currentMode,
    });

    return this.mapMigrationState(created);
  }

  async getCurrentMode(communityId: string): Promise<CoexistenceMode> {
    const state = await this.getMigrationState(communityId);
    return state?.currentMode ?? 'shadow';
  }

  async updateMode(
    communityId: string,
    mode: CoexistenceMode,
    reason?: string
  ): Promise<void> {
    const existing = await this.getMigrationState(communityId);
    const now = new Date();

    // Determine which timestamp to update based on mode
    const timestamps: Partial<Record<string, Date>> = {};
    if (mode === 'shadow' && !existing?.shadowStartedAt) {
      timestamps.shadowStartedAt = now;
    } else if (mode === 'parallel' && !existing?.parallelEnabledAt) {
      timestamps.parallelEnabledAt = now;
    } else if (mode === 'primary' && !existing?.primaryEnabledAt) {
      timestamps.primaryEnabledAt = now;
    } else if (mode === 'exclusive' && !existing?.exclusiveEnabledAt) {
      timestamps.exclusiveEnabledAt = now;
    }

    if (existing) {
      await this.db
        .update(migrationStates)
        .set({
          currentMode: mode,
          ...timestamps,
          updatedAt: now,
        })
        .where(eq(migrationStates.communityId, communityId));
    } else {
      await this.db
        .insert(migrationStates)
        .values({
          communityId,
          currentMode: mode,
          shadowStartedAt: mode === 'shadow' ? now : null,
        });
    }

    this.logger.info('Coexistence mode updated', {
      communityId,
      mode,
      reason,
    });
  }

  async recordRollback(
    communityId: string,
    reason: string,
    targetMode: CoexistenceMode
  ): Promise<void> {
    const now = new Date();

    await this.db
      .update(migrationStates)
      .set({
        currentMode: targetMode,
        rollbackCount: migrationStates.rollbackCount,
        lastRollbackAt: now,
        lastRollbackReason: reason,
        updatedAt: now,
      })
      .where(eq(migrationStates.communityId, communityId));

    // Increment rollback count manually (Drizzle doesn't support increment in update)
    const state = await this.getMigrationState(communityId);
    if (state) {
      await this.db
        .update(migrationStates)
        .set({
          rollbackCount: state.rollbackCount + 1,
        })
        .where(eq(migrationStates.communityId, communityId));
    }

    this.logger.warn('Migration rollback recorded', {
      communityId,
      targetMode,
      reason,
    });
  }

  async initializeShadowMode(communityId: string): Promise<StoredMigrationState> {
    return this.saveMigrationState({
      communityId,
      currentMode: 'shadow',
      shadowStartedAt: new Date(),
    });
  }

  // =========================================================================
  // Query Methods
  // =========================================================================

  async getCommunitiesByMode(mode: CoexistenceMode): Promise<string[]> {
    const results = await this.db
      .select({ communityId: migrationStates.communityId })
      .from(migrationStates)
      .where(eq(migrationStates.currentMode, mode));

    return results.map(r => r.communityId);
  }

  async getReadyCommunities(): Promise<string[]> {
    const results = await this.db
      .select({ communityId: migrationStates.communityId })
      .from(migrationStates)
      .where(
        and(
          eq(migrationStates.readinessCheckPassed, true),
          eq(migrationStates.currentMode, 'shadow')
        )
      );

    return results.map(r => r.communityId);
  }

  async getIncumbentHealthOverview(): Promise<Map<string, HealthStatus>> {
    const results = await this.db
      .select({
        communityId: incumbentConfigs.communityId,
        healthStatus: incumbentConfigs.healthStatus,
      })
      .from(incumbentConfigs);

    const map = new Map<string, HealthStatus>();
    for (const r of results) {
      map.set(r.communityId, r.healthStatus as HealthStatus);
    }
    return map;
  }

  // =========================================================================
  // Private Helpers
  // =========================================================================

  private mapIncumbentConfig(row: typeof incumbentConfigs.$inferSelect): StoredIncumbentConfig {
    return {
      id: row.id,
      communityId: row.communityId,
      provider: row.provider as IncumbentProvider,
      botId: row.botId,
      botUsername: row.botUsername,
      verificationChannelId: row.verificationChannelId,
      detectedAt: row.detectedAt,
      confidence: row.confidence / 100, // Convert back to 0-1
      manualOverride: row.manualOverride,
      lastHealthCheck: row.lastHealthCheck,
      healthStatus: row.healthStatus as HealthStatus,
      detectedRoles: (row.detectedRoles as DetectedRole[]) ?? [],
      capabilities: (row.capabilities as IncumbentCapabilities) ?? DEFAULT_CAPABILITIES,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private mapMigrationState(row: typeof migrationStates.$inferSelect): StoredMigrationState {
    return {
      id: row.id,
      communityId: row.communityId,
      currentMode: row.currentMode as CoexistenceMode,
      targetMode: row.targetMode as CoexistenceMode | null,
      strategy: row.strategy as MigrationStrategy | null,
      shadowStartedAt: row.shadowStartedAt,
      parallelEnabledAt: row.parallelEnabledAt,
      primaryEnabledAt: row.primaryEnabledAt,
      exclusiveEnabledAt: row.exclusiveEnabledAt,
      rollbackCount: row.rollbackCount,
      lastRollbackAt: row.lastRollbackAt,
      lastRollbackReason: row.lastRollbackReason,
      readinessCheckPassed: row.readinessCheckPassed,
      accuracyPercent: row.accuracyPercent !== null ? row.accuracyPercent / 100 : null,
      shadowDays: row.shadowDays,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}

/**
 * Factory function to create CoexistenceStorage
 */
export function createCoexistenceStorage(
  db: PostgresJsDatabase,
  logger?: ILogger
): ICoexistenceStorage {
  return new CoexistenceStorage(db, logger);
}

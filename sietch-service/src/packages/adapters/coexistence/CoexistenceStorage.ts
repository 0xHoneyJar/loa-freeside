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

import { eq, and, isNull, gte, sql, count } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import {
  incumbentConfigs,
  migrationStates,
  shadowMemberStates,
  shadowDivergences,
  shadowPredictions,
  parallelRoleConfigs,
  parallelRoles,
  parallelMemberAssignments,
  type CoexistenceMode,
  type MigrationStrategy,
  type HealthStatus,
  type IncumbentProvider,
  type DetectedRole,
  type IncumbentCapabilities,
  type DivergenceType,
  type ShadowStateSnapshot,
  type TierRoleMapping,
  type RolePositionStrategy,
} from '../storage/schema.js';
import type {
  ICoexistenceStorage,
  StoredIncumbentConfig,
  SaveIncumbentInput,
  UpdateHealthInput,
  StoredMigrationState,
  SaveMigrationStateInput,
  StoredShadowMemberState,
  SaveShadowMemberInput,
  StoredDivergence,
  SaveDivergenceInput,
  StoredPrediction,
  SavePredictionInput,
  ValidatePredictionInput,
  DivergenceSummary,
  StoredParallelRoleConfig,
  SaveParallelRoleConfigInput,
  StoredParallelRole,
  SaveParallelRoleInput,
  StoredParallelMemberAssignment,
  SaveParallelMemberAssignmentInput,
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
  // Shadow Member State Methods (Sprint 57)
  // =========================================================================

  async getShadowMemberState(
    communityId: string,
    memberId: string
  ): Promise<StoredShadowMemberState | null> {
    const result = await this.db
      .select()
      .from(shadowMemberStates)
      .where(
        and(
          eq(shadowMemberStates.communityId, communityId),
          eq(shadowMemberStates.memberId, memberId)
        )
      )
      .limit(1);

    if (result.length === 0) {
      return null;
    }

    return this.mapShadowMemberState(result[0]);
  }

  async getShadowMemberStates(
    communityId: string,
    options: {
      limit?: number;
      offset?: number;
      divergenceType?: DivergenceType;
    } = {}
  ): Promise<StoredShadowMemberState[]> {
    const { limit = 100, offset = 0, divergenceType } = options;

    const conditions = [eq(shadowMemberStates.communityId, communityId)];
    if (divergenceType) {
      conditions.push(eq(shadowMemberStates.divergenceType, divergenceType));
    }

    const results = await this.db
      .select()
      .from(shadowMemberStates)
      .where(and(...conditions))
      .limit(limit)
      .offset(offset);

    return results.map(r => this.mapShadowMemberState(r));
  }

  async saveShadowMemberState(input: SaveShadowMemberInput): Promise<StoredShadowMemberState> {
    const existing = await this.getShadowMemberState(input.communityId, input.memberId);
    const now = new Date();

    if (existing) {
      // Update existing
      const [updated] = await this.db
        .update(shadowMemberStates)
        .set({
          incumbentRoles: input.incumbentRoles ?? existing.incumbentRoles,
          incumbentTier: input.incumbentTier !== undefined ? input.incumbentTier : existing.incumbentTier,
          incumbentLastUpdate: input.incumbentLastUpdate ?? existing.incumbentLastUpdate,
          arrakisRoles: input.arrakisRoles ?? existing.arrakisRoles,
          arrakisTier: input.arrakisTier !== undefined ? input.arrakisTier : existing.arrakisTier,
          arrakisConviction: input.arrakisConviction !== undefined ? input.arrakisConviction : existing.arrakisConviction,
          arrakisLastCalculated: input.arrakisLastCalculated ?? existing.arrakisLastCalculated,
          divergenceType: input.divergenceType !== undefined ? input.divergenceType : existing.divergenceType,
          divergenceReason: input.divergenceReason !== undefined ? input.divergenceReason : existing.divergenceReason,
          divergenceDetectedAt: input.divergenceDetectedAt !== undefined ? input.divergenceDetectedAt : existing.divergenceDetectedAt,
          lastSyncAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(shadowMemberStates.communityId, input.communityId),
            eq(shadowMemberStates.memberId, input.memberId)
          )
        )
        .returning();

      return this.mapShadowMemberState(updated);
    }

    // Create new
    const [created] = await this.db
      .insert(shadowMemberStates)
      .values({
        communityId: input.communityId,
        memberId: input.memberId,
        incumbentRoles: input.incumbentRoles ?? [],
        incumbentTier: input.incumbentTier ?? null,
        incumbentLastUpdate: input.incumbentLastUpdate ?? null,
        arrakisRoles: input.arrakisRoles ?? [],
        arrakisTier: input.arrakisTier ?? null,
        arrakisConviction: input.arrakisConviction ?? null,
        arrakisLastCalculated: input.arrakisLastCalculated ?? null,
        divergenceType: input.divergenceType ?? null,
        divergenceReason: input.divergenceReason ?? null,
        divergenceDetectedAt: input.divergenceDetectedAt ?? null,
        lastSyncAt: now,
      })
      .returning();

    this.logger.debug('Shadow member state created', {
      communityId: input.communityId,
      memberId: input.memberId,
    });

    return this.mapShadowMemberState(created);
  }

  async batchSaveShadowMemberStates(inputs: SaveShadowMemberInput[]): Promise<void> {
    if (inputs.length === 0) return;

    const now = new Date();

    // Use upsert pattern for batch operations
    for (const input of inputs) {
      await this.db
        .insert(shadowMemberStates)
        .values({
          communityId: input.communityId,
          memberId: input.memberId,
          incumbentRoles: input.incumbentRoles ?? [],
          incumbentTier: input.incumbentTier ?? null,
          incumbentLastUpdate: input.incumbentLastUpdate ?? null,
          arrakisRoles: input.arrakisRoles ?? [],
          arrakisTier: input.arrakisTier ?? null,
          arrakisConviction: input.arrakisConviction ?? null,
          arrakisLastCalculated: input.arrakisLastCalculated ?? null,
          divergenceType: input.divergenceType ?? null,
          divergenceReason: input.divergenceReason ?? null,
          divergenceDetectedAt: input.divergenceDetectedAt ?? null,
          lastSyncAt: now,
        })
        .onConflictDoUpdate({
          target: [shadowMemberStates.communityId, shadowMemberStates.memberId],
          set: {
            incumbentRoles: input.incumbentRoles ?? [],
            incumbentTier: input.incumbentTier ?? null,
            incumbentLastUpdate: input.incumbentLastUpdate ?? null,
            arrakisRoles: input.arrakisRoles ?? [],
            arrakisTier: input.arrakisTier ?? null,
            arrakisConviction: input.arrakisConviction ?? null,
            arrakisLastCalculated: input.arrakisLastCalculated ?? null,
            divergenceType: input.divergenceType ?? null,
            divergenceReason: input.divergenceReason ?? null,
            divergenceDetectedAt: input.divergenceDetectedAt ?? null,
            lastSyncAt: now,
            updatedAt: now,
          },
        });
    }

    this.logger.debug('Batch saved shadow member states', {
      count: inputs.length,
      communityId: inputs[0]?.communityId,
    });
  }

  async deleteShadowMemberState(communityId: string, memberId: string): Promise<void> {
    await this.db
      .delete(shadowMemberStates)
      .where(
        and(
          eq(shadowMemberStates.communityId, communityId),
          eq(shadowMemberStates.memberId, memberId)
        )
      );

    this.logger.debug('Shadow member state deleted', { communityId, memberId });
  }

  // =========================================================================
  // Shadow Divergence Methods (Sprint 57)
  // =========================================================================

  async saveDivergence(input: SaveDivergenceInput): Promise<StoredDivergence> {
    const [created] = await this.db
      .insert(shadowDivergences)
      .values({
        communityId: input.communityId,
        memberId: input.memberId,
        divergenceType: input.divergenceType,
        incumbentState: input.incumbentState,
        arrakisState: input.arrakisState,
        reason: input.reason ?? null,
      })
      .returning();

    this.logger.debug('Divergence recorded', {
      communityId: input.communityId,
      memberId: input.memberId,
      type: input.divergenceType,
    });

    return this.mapDivergence(created);
  }

  async getDivergences(
    communityId: string,
    options: {
      limit?: number;
      offset?: number;
      divergenceType?: DivergenceType;
      since?: Date;
      unresolved?: boolean;
    } = {}
  ): Promise<StoredDivergence[]> {
    const { limit = 100, offset = 0, divergenceType, since, unresolved } = options;

    const conditions = [eq(shadowDivergences.communityId, communityId)];
    if (divergenceType) {
      conditions.push(eq(shadowDivergences.divergenceType, divergenceType));
    }
    if (since) {
      conditions.push(gte(shadowDivergences.detectedAt, since));
    }
    if (unresolved) {
      conditions.push(isNull(shadowDivergences.resolvedAt));
    }

    const results = await this.db
      .select()
      .from(shadowDivergences)
      .where(and(...conditions))
      .limit(limit)
      .offset(offset)
      .orderBy(shadowDivergences.detectedAt);

    return results.map(r => this.mapDivergence(r));
  }

  async resolveDivergence(
    divergenceId: string,
    resolutionType: 'member_action' | 'sync_corrected' | 'manual'
  ): Promise<void> {
    await this.db
      .update(shadowDivergences)
      .set({
        resolvedAt: new Date(),
        resolutionType,
      })
      .where(eq(shadowDivergences.id, divergenceId));

    this.logger.debug('Divergence resolved', { divergenceId, resolutionType });
  }

  async getDivergenceSummary(communityId: string): Promise<DivergenceSummary> {
    // Get counts by divergence type
    const results = await this.db
      .select({
        divergenceType: shadowMemberStates.divergenceType,
        count: count(),
      })
      .from(shadowMemberStates)
      .where(eq(shadowMemberStates.communityId, communityId))
      .groupBy(shadowMemberStates.divergenceType);

    let totalMembers = 0;
    let matchCount = 0;
    let arrakisHigherCount = 0;
    let arrakisLowerCount = 0;
    let mismatchCount = 0;

    for (const r of results) {
      const c = Number(r.count);
      totalMembers += c;
      switch (r.divergenceType) {
        case 'match':
          matchCount = c;
          break;
        case 'arrakis_higher':
          arrakisHigherCount = c;
          break;
        case 'arrakis_lower':
          arrakisLowerCount = c;
          break;
        case 'mismatch':
          mismatchCount = c;
          break;
      }
    }

    // Accuracy = match / total (as percentage)
    const accuracyPercent = totalMembers > 0 ? (matchCount / totalMembers) * 100 : 0;

    return {
      communityId,
      totalMembers,
      matchCount,
      arrakisHigherCount,
      arrakisLowerCount,
      mismatchCount,
      accuracyPercent,
    };
  }

  // =========================================================================
  // Shadow Prediction Methods (Sprint 57)
  // =========================================================================

  async savePrediction(input: SavePredictionInput): Promise<StoredPrediction> {
    const [created] = await this.db
      .insert(shadowPredictions)
      .values({
        communityId: input.communityId,
        memberId: input.memberId,
        predictedRoles: input.predictedRoles,
        predictedTier: input.predictedTier ?? null,
        predictedConviction: input.predictedConviction ?? null,
      })
      .returning();

    this.logger.debug('Prediction saved', {
      communityId: input.communityId,
      memberId: input.memberId,
    });

    return this.mapPrediction(created);
  }

  async validatePrediction(input: ValidatePredictionInput): Promise<void> {
    await this.db
      .update(shadowPredictions)
      .set({
        actualRoles: input.actualRoles,
        actualTier: input.actualTier ?? null,
        validatedAt: new Date(),
        accurate: input.accurate,
        accuracyScore: input.accuracyScore,
        accuracyDetails: input.accuracyDetails ?? null,
      })
      .where(eq(shadowPredictions.id, input.predictionId));

    this.logger.debug('Prediction validated', {
      predictionId: input.predictionId,
      accurate: input.accurate,
      score: input.accuracyScore,
    });
  }

  async getUnvalidatedPredictions(
    communityId: string,
    limit: number = 100
  ): Promise<StoredPrediction[]> {
    const results = await this.db
      .select()
      .from(shadowPredictions)
      .where(
        and(
          eq(shadowPredictions.communityId, communityId),
          isNull(shadowPredictions.validatedAt)
        )
      )
      .limit(limit)
      .orderBy(shadowPredictions.predictedAt);

    return results.map(r => this.mapPrediction(r));
  }

  async calculateAccuracy(communityId: string, since?: Date): Promise<number> {
    const conditions = [
      eq(shadowPredictions.communityId, communityId),
      eq(shadowPredictions.accurate, true),
    ];

    if (since) {
      conditions.push(gte(shadowPredictions.predictedAt, since));
    }

    // Count accurate predictions
    const [accurateResult] = await this.db
      .select({ count: count() })
      .from(shadowPredictions)
      .where(and(...conditions));

    // Count total validated predictions
    const totalConditions = [
      eq(shadowPredictions.communityId, communityId),
      sql`${shadowPredictions.accurate} IS NOT NULL`,
    ];

    if (since) {
      totalConditions.push(gte(shadowPredictions.predictedAt, since));
    }

    const [totalResult] = await this.db
      .select({ count: count() })
      .from(shadowPredictions)
      .where(and(...totalConditions));

    const accurate = Number(accurateResult?.count ?? 0);
    const total = Number(totalResult?.count ?? 0);

    return total > 0 ? (accurate / total) * 100 : 0;
  }

  // =========================================================================
  // Parallel Role Configuration Methods (Sprint 58)
  // =========================================================================

  async getParallelRoleConfig(communityId: string): Promise<StoredParallelRoleConfig | null> {
    const result = await this.db
      .select()
      .from(parallelRoleConfigs)
      .where(eq(parallelRoleConfigs.communityId, communityId))
      .limit(1);

    if (result.length === 0) {
      return null;
    }

    return this.mapParallelRoleConfig(result[0]);
  }

  async saveParallelRoleConfig(input: SaveParallelRoleConfigInput): Promise<StoredParallelRoleConfig> {
    const existing = await this.getParallelRoleConfig(input.communityId);
    const now = new Date();

    if (existing) {
      // Update existing
      const [updated] = await this.db
        .update(parallelRoleConfigs)
        .set({
          namespace: input.namespace ?? existing.namespace,
          enabled: input.enabled ?? existing.enabled,
          positionStrategy: input.positionStrategy ?? existing.positionStrategy,
          tierRoleMapping: input.tierRoleMapping ?? existing.tierRoleMapping,
          customRoleNames: input.customRoleNames ?? existing.customRoleNames,
          grantPermissions: input.grantPermissions ?? existing.grantPermissions,
          setupCompletedAt: input.setupCompletedAt ?? existing.setupCompletedAt,
          lastSyncAt: input.lastSyncAt ?? existing.lastSyncAt,
          totalRolesCreated: input.totalRolesCreated ?? existing.totalRolesCreated,
          updatedAt: now,
        })
        .where(eq(parallelRoleConfigs.communityId, input.communityId))
        .returning();

      this.logger.debug('Parallel role config updated', {
        communityId: input.communityId,
      });

      return this.mapParallelRoleConfig(updated);
    } else {
      // Create new
      const [created] = await this.db
        .insert(parallelRoleConfigs)
        .values({
          communityId: input.communityId,
          namespace: input.namespace ?? '@arrakis-',
          enabled: input.enabled ?? false,
          positionStrategy: input.positionStrategy ?? 'below_incumbent',
          tierRoleMapping: input.tierRoleMapping ?? [],
          customRoleNames: input.customRoleNames ?? {},
          grantPermissions: input.grantPermissions ?? false,
          setupCompletedAt: input.setupCompletedAt ?? null,
          lastSyncAt: input.lastSyncAt ?? null,
          totalRolesCreated: input.totalRolesCreated ?? 0,
        })
        .returning();

      this.logger.debug('Parallel role config created', {
        communityId: input.communityId,
      });

      return this.mapParallelRoleConfig(created);
    }
  }

  async deleteParallelRoleConfig(communityId: string): Promise<void> {
    await this.db
      .delete(parallelRoleConfigs)
      .where(eq(parallelRoleConfigs.communityId, communityId));

    this.logger.debug('Parallel role config deleted', { communityId });
  }

  async isParallelEnabled(communityId: string): Promise<boolean> {
    const config = await this.getParallelRoleConfig(communityId);
    return config?.enabled ?? false;
  }

  // =========================================================================
  // Parallel Role Methods (Sprint 58)
  // =========================================================================

  async getParallelRole(
    communityId: string,
    discordRoleId: string
  ): Promise<StoredParallelRole | null> {
    const result = await this.db
      .select()
      .from(parallelRoles)
      .where(
        and(
          eq(parallelRoles.communityId, communityId),
          eq(parallelRoles.discordRoleId, discordRoleId)
        )
      )
      .limit(1);

    if (result.length === 0) {
      return null;
    }

    return this.mapParallelRole(result[0]);
  }

  async getParallelRoles(communityId: string): Promise<StoredParallelRole[]> {
    const results = await this.db
      .select()
      .from(parallelRoles)
      .where(eq(parallelRoles.communityId, communityId))
      .orderBy(parallelRoles.tier);

    return results.map(r => this.mapParallelRole(r));
  }

  async getParallelRoleByTier(
    communityId: string,
    tier: number
  ): Promise<StoredParallelRole | null> {
    const result = await this.db
      .select()
      .from(parallelRoles)
      .where(
        and(
          eq(parallelRoles.communityId, communityId),
          eq(parallelRoles.tier, tier)
        )
      )
      .limit(1);

    if (result.length === 0) {
      return null;
    }

    return this.mapParallelRole(result[0]);
  }

  async saveParallelRole(input: SaveParallelRoleInput): Promise<StoredParallelRole> {
    const existing = await this.getParallelRole(input.communityId, input.discordRoleId);
    const now = new Date();

    if (existing) {
      // Update existing
      const [updated] = await this.db
        .update(parallelRoles)
        .set({
          roleName: input.roleName,
          baseName: input.baseName,
          tier: input.tier,
          minConviction: input.minConviction,
          position: input.position,
          incumbentReferenceId: input.incumbentReferenceId ?? existing.incumbentReferenceId,
          color: input.color ?? existing.color,
          mentionable: input.mentionable ?? existing.mentionable,
          hoist: input.hoist ?? existing.hoist,
          updatedAt: now,
        })
        .where(
          and(
            eq(parallelRoles.communityId, input.communityId),
            eq(parallelRoles.discordRoleId, input.discordRoleId)
          )
        )
        .returning();

      this.logger.debug('Parallel role updated', {
        communityId: input.communityId,
        discordRoleId: input.discordRoleId,
      });

      return this.mapParallelRole(updated);
    } else {
      // Create new
      const [created] = await this.db
        .insert(parallelRoles)
        .values({
          communityId: input.communityId,
          discordRoleId: input.discordRoleId,
          roleName: input.roleName,
          baseName: input.baseName,
          tier: input.tier,
          minConviction: input.minConviction,
          position: input.position,
          incumbentReferenceId: input.incumbentReferenceId ?? null,
          color: input.color ?? null,
          mentionable: input.mentionable ?? false,
          hoist: input.hoist ?? false,
        })
        .returning();

      this.logger.debug('Parallel role created', {
        communityId: input.communityId,
        discordRoleId: input.discordRoleId,
        tier: input.tier,
      });

      return this.mapParallelRole(created);
    }
  }

  async updateParallelRolePosition(
    communityId: string,
    discordRoleId: string,
    position: number
  ): Promise<void> {
    await this.db
      .update(parallelRoles)
      .set({
        position,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(parallelRoles.communityId, communityId),
          eq(parallelRoles.discordRoleId, discordRoleId)
        )
      );

    this.logger.debug('Parallel role position updated', {
      communityId,
      discordRoleId,
      position,
    });
  }

  async updateParallelRoleMemberCount(
    communityId: string,
    discordRoleId: string,
    memberCount: number
  ): Promise<void> {
    await this.db
      .update(parallelRoles)
      .set({
        memberCount,
        lastMemberCountUpdate: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(parallelRoles.communityId, communityId),
          eq(parallelRoles.discordRoleId, discordRoleId)
        )
      );

    this.logger.debug('Parallel role member count updated', {
      communityId,
      discordRoleId,
      memberCount,
    });
  }

  async deleteParallelRole(communityId: string, discordRoleId: string): Promise<void> {
    await this.db
      .delete(parallelRoles)
      .where(
        and(
          eq(parallelRoles.communityId, communityId),
          eq(parallelRoles.discordRoleId, discordRoleId)
        )
      );

    this.logger.debug('Parallel role deleted', { communityId, discordRoleId });
  }

  async deleteAllParallelRoles(communityId: string): Promise<void> {
    await this.db
      .delete(parallelRoles)
      .where(eq(parallelRoles.communityId, communityId));

    this.logger.debug('All parallel roles deleted', { communityId });
  }

  // =========================================================================
  // Parallel Member Assignment Methods (Sprint 58)
  // =========================================================================

  async getParallelMemberAssignment(
    communityId: string,
    memberId: string
  ): Promise<StoredParallelMemberAssignment | null> {
    const result = await this.db
      .select()
      .from(parallelMemberAssignments)
      .where(
        and(
          eq(parallelMemberAssignments.communityId, communityId),
          eq(parallelMemberAssignments.memberId, memberId)
        )
      )
      .limit(1);

    if (result.length === 0) {
      return null;
    }

    return this.mapParallelMemberAssignment(result[0]);
  }

  async getParallelMemberAssignments(
    communityId: string,
    options?: {
      limit?: number;
      offset?: number;
      tier?: number;
    }
  ): Promise<StoredParallelMemberAssignment[]> {
    const conditions = [eq(parallelMemberAssignments.communityId, communityId)];

    if (options?.tier !== undefined) {
      conditions.push(eq(parallelMemberAssignments.assignedTier, options.tier));
    }

    let query = this.db
      .select()
      .from(parallelMemberAssignments)
      .where(and(...conditions))
      .orderBy(parallelMemberAssignments.lastSyncAt);

    if (options?.limit) {
      query = query.limit(options.limit) as typeof query;
    }

    if (options?.offset) {
      query = query.offset(options.offset) as typeof query;
    }

    const results = await query;
    return results.map(r => this.mapParallelMemberAssignment(r));
  }

  async saveParallelMemberAssignment(
    input: SaveParallelMemberAssignmentInput
  ): Promise<StoredParallelMemberAssignment> {
    const existing = await this.getParallelMemberAssignment(input.communityId, input.memberId);
    const now = new Date();

    if (existing) {
      // Update existing
      const [updated] = await this.db
        .update(parallelMemberAssignments)
        .set({
          assignedTier: input.assignedTier ?? existing.assignedTier,
          assignedRoleIds: input.assignedRoleIds ?? existing.assignedRoleIds,
          currentConviction: input.currentConviction ?? existing.currentConviction,
          incumbentTier: input.incumbentTier ?? existing.incumbentTier,
          incumbentRoleIds: input.incumbentRoleIds ?? existing.incumbentRoleIds,
          lastAssignmentAt: input.lastAssignmentAt ?? existing.lastAssignmentAt,
          lastSyncAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(parallelMemberAssignments.communityId, input.communityId),
            eq(parallelMemberAssignments.memberId, input.memberId)
          )
        )
        .returning();

      return this.mapParallelMemberAssignment(updated);
    } else {
      // Create new
      const [created] = await this.db
        .insert(parallelMemberAssignments)
        .values({
          communityId: input.communityId,
          memberId: input.memberId,
          assignedTier: input.assignedTier ?? null,
          assignedRoleIds: input.assignedRoleIds ?? [],
          currentConviction: input.currentConviction ?? null,
          incumbentTier: input.incumbentTier ?? null,
          incumbentRoleIds: input.incumbentRoleIds ?? [],
          lastAssignmentAt: input.lastAssignmentAt ?? null,
        })
        .returning();

      return this.mapParallelMemberAssignment(created);
    }
  }

  async batchSaveParallelMemberAssignments(
    inputs: SaveParallelMemberAssignmentInput[]
  ): Promise<void> {
    if (inputs.length === 0) return;

    const now = new Date();

    // Use upsert pattern for batch efficiency
    for (const input of inputs) {
      await this.db
        .insert(parallelMemberAssignments)
        .values({
          communityId: input.communityId,
          memberId: input.memberId,
          assignedTier: input.assignedTier ?? null,
          assignedRoleIds: input.assignedRoleIds ?? [],
          currentConviction: input.currentConviction ?? null,
          incumbentTier: input.incumbentTier ?? null,
          incumbentRoleIds: input.incumbentRoleIds ?? [],
          lastAssignmentAt: input.lastAssignmentAt ?? null,
        })
        .onConflictDoUpdate({
          target: [parallelMemberAssignments.communityId, parallelMemberAssignments.memberId],
          set: {
            assignedTier: input.assignedTier ?? null,
            assignedRoleIds: input.assignedRoleIds ?? [],
            currentConviction: input.currentConviction ?? null,
            incumbentTier: input.incumbentTier ?? null,
            incumbentRoleIds: input.incumbentRoleIds ?? [],
            lastAssignmentAt: input.lastAssignmentAt ?? null,
            lastSyncAt: now,
            updatedAt: now,
          },
        });
    }

    this.logger.debug('Batch parallel member assignments saved', {
      count: inputs.length,
    });
  }

  async deleteParallelMemberAssignment(communityId: string, memberId: string): Promise<void> {
    await this.db
      .delete(parallelMemberAssignments)
      .where(
        and(
          eq(parallelMemberAssignments.communityId, communityId),
          eq(parallelMemberAssignments.memberId, memberId)
        )
      );

    this.logger.debug('Parallel member assignment deleted', { communityId, memberId });
  }

  async getMembersByTier(communityId: string, tier: number): Promise<string[]> {
    const results = await this.db
      .select({ memberId: parallelMemberAssignments.memberId })
      .from(parallelMemberAssignments)
      .where(
        and(
          eq(parallelMemberAssignments.communityId, communityId),
          eq(parallelMemberAssignments.assignedTier, tier)
        )
      );

    return results.map(r => r.memberId);
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

  private mapShadowMemberState(row: typeof shadowMemberStates.$inferSelect): StoredShadowMemberState {
    return {
      id: row.id,
      communityId: row.communityId,
      memberId: row.memberId,
      incumbentRoles: (row.incumbentRoles as string[]) ?? [],
      incumbentTier: row.incumbentTier,
      incumbentLastUpdate: row.incumbentLastUpdate,
      arrakisRoles: (row.arrakisRoles as string[]) ?? [],
      arrakisTier: row.arrakisTier,
      arrakisConviction: row.arrakisConviction,
      arrakisLastCalculated: row.arrakisLastCalculated,
      divergenceType: row.divergenceType as DivergenceType | null,
      divergenceReason: row.divergenceReason,
      divergenceDetectedAt: row.divergenceDetectedAt,
      lastSyncAt: row.lastSyncAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private mapDivergence(row: typeof shadowDivergences.$inferSelect): StoredDivergence {
    return {
      id: row.id,
      communityId: row.communityId,
      memberId: row.memberId,
      divergenceType: row.divergenceType as DivergenceType,
      incumbentState: row.incumbentState as ShadowStateSnapshot,
      arrakisState: row.arrakisState as ShadowStateSnapshot,
      reason: row.reason,
      detectedAt: row.detectedAt,
      resolvedAt: row.resolvedAt,
      resolutionType: row.resolutionType,
      createdAt: row.createdAt,
    };
  }

  private mapPrediction(row: typeof shadowPredictions.$inferSelect): StoredPrediction {
    return {
      id: row.id,
      communityId: row.communityId,
      memberId: row.memberId,
      predictedRoles: (row.predictedRoles as string[]) ?? [],
      predictedTier: row.predictedTier,
      predictedConviction: row.predictedConviction,
      predictedAt: row.predictedAt,
      actualRoles: (row.actualRoles as string[]) ?? null,
      actualTier: row.actualTier,
      validatedAt: row.validatedAt,
      accurate: row.accurate,
      accuracyScore: row.accuracyScore,
      accuracyDetails: row.accuracyDetails,
      createdAt: row.createdAt,
    };
  }

  private mapParallelRoleConfig(
    row: typeof parallelRoleConfigs.$inferSelect
  ): StoredParallelRoleConfig {
    return {
      id: row.id,
      communityId: row.communityId,
      namespace: row.namespace,
      enabled: row.enabled,
      positionStrategy: row.positionStrategy as RolePositionStrategy,
      tierRoleMapping: (row.tierRoleMapping as TierRoleMapping[]) ?? [],
      customRoleNames: (row.customRoleNames as Record<string, string>) ?? {},
      grantPermissions: row.grantPermissions,
      setupCompletedAt: row.setupCompletedAt,
      lastSyncAt: row.lastSyncAt,
      totalRolesCreated: row.totalRolesCreated,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private mapParallelRole(row: typeof parallelRoles.$inferSelect): StoredParallelRole {
    return {
      id: row.id,
      communityId: row.communityId,
      discordRoleId: row.discordRoleId,
      roleName: row.roleName,
      baseName: row.baseName,
      tier: row.tier,
      minConviction: row.minConviction,
      position: row.position,
      incumbentReferenceId: row.incumbentReferenceId,
      color: row.color,
      mentionable: row.mentionable,
      hoist: row.hoist,
      memberCount: row.memberCount,
      lastMemberCountUpdate: row.lastMemberCountUpdate,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private mapParallelMemberAssignment(
    row: typeof parallelMemberAssignments.$inferSelect
  ): StoredParallelMemberAssignment {
    return {
      id: row.id,
      communityId: row.communityId,
      memberId: row.memberId,
      assignedTier: row.assignedTier,
      assignedRoleIds: (row.assignedRoleIds as string[]) ?? [],
      currentConviction: row.currentConviction,
      incumbentTier: row.incumbentTier,
      incumbentRoleIds: (row.incumbentRoleIds as string[]) ?? [],
      lastAssignmentAt: row.lastAssignmentAt,
      lastSyncAt: row.lastSyncAt,
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

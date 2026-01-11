// @ts-nocheck
// TODO: Fix TypeScript type errors
/**
 * ShadowLedger - Shadow Mode Observation & Divergence Detection
 *
 * Sprint 57: Shadow Mode Foundation - Shadow Ledger & Sync
 *
 * Tracks member states by comparing what the incumbent bot provides vs what
 * Arrakis would provide. Detects divergences and calculates accuracy for
 * migration readiness assessment.
 *
 * CRITICAL: This service NEVER performs Discord mutations.
 * It only reads guild information and stores shadow observations.
 *
 * @module packages/adapters/coexistence/ShadowLedger
 */

import type { Client, Guild, GuildMember } from 'discord.js';
import type {
  ICoexistenceStorage,
  StoredIncumbentConfig,
  DivergenceType,
  DivergenceSummary,
  SaveShadowMemberInput,
  StoredShadowMemberState,
  ShadowStateSnapshot,
} from '../../core/ports/ICoexistenceStorage.js';
import { createLogger, type ILogger } from '../../infrastructure/logging/index.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Options for shadow sync operation
 */
export interface ShadowSyncOptions {
  /** Community UUID */
  communityId: string;
  /** Discord guild ID */
  guildId: string;
  /** Process members in batches of this size (default: 100) */
  batchSize?: number;
  /** Skip members synced within this many hours (default: 6) */
  skipRecentHours?: number;
  /** Force full resync even if recently synced */
  forceFullSync?: boolean;
}

/**
 * Result of a shadow sync operation
 */
export interface ShadowSyncResult {
  /** Community UUID */
  communityId: string;
  /** Guild ID */
  guildId: string;
  /** Total members processed */
  membersProcessed: number;
  /** Members skipped (recently synced) */
  membersSkipped: number;
  /** New divergences detected */
  newDivergences: number;
  /** Divergences resolved */
  divergencesResolved: number;
  /** Current accuracy percentage */
  accuracyPercent: number;
  /** Duration in milliseconds */
  durationMs: number;
  /** Whether sync completed successfully */
  success: boolean;
  /** Error message if failed */
  error?: string;
}

/**
 * Member role prediction from Arrakis scoring
 *
 * This would typically come from the scoring engine, but for shadow mode
 * we simulate what Arrakis WOULD assign based on conviction scores.
 */
export interface ArrakisPrediction {
  /** Discord member ID */
  memberId: string;
  /** Predicted roles (role IDs) */
  roles: string[];
  /** Predicted tier (1-N) */
  tier: number | null;
  /** Conviction score (0-100) */
  conviction: number;
}

/**
 * Callback to get Arrakis predictions for members
 *
 * The ShadowLedger doesn't know how to calculate scores - that's the
 * scoring engine's job. This callback allows integration with the
 * actual conviction scoring system.
 */
export type GetArrakisPredictions = (
  communityId: string,
  memberIds: string[]
) => Promise<ArrakisPrediction[]>;

// =============================================================================
// Implementation
// =============================================================================

/**
 * Shadow Ledger Service
 *
 * Tracks divergences between incumbent bot access and what Arrakis would provide.
 * Used for accuracy measurement before migration.
 */
export class ShadowLedger {
  private readonly logger: ILogger;

  constructor(
    private readonly storage: ICoexistenceStorage,
    private readonly discordClient: Client,
    private readonly getPredictions: GetArrakisPredictions,
    logger?: ILogger
  ) {
    this.logger = logger ?? createLogger({ service: 'ShadowLedger' });
  }

  /**
   * Sync guild members and detect divergences
   *
   * This is the main entry point for shadow sync operations.
   * It reads member roles from Discord, gets Arrakis predictions,
   * and compares to detect divergences.
   *
   * CRITICAL: This method NEVER modifies Discord state.
   *
   * @param options - Sync options
   * @returns Sync result summary
   */
  async syncGuild(options: ShadowSyncOptions): Promise<ShadowSyncResult> {
    const startTime = Date.now();
    const {
      communityId,
      guildId,
      batchSize = 100,
      skipRecentHours = 6,
      forceFullSync = false,
    } = options;

    this.logger.info('Starting shadow sync', { communityId, guildId });

    try {
      // Verify we're in shadow mode
      const mode = await this.storage.getCurrentMode(communityId);
      if (mode !== 'shadow') {
        this.logger.warn('Shadow sync called but not in shadow mode', {
          communityId,
          currentMode: mode,
        });
        return {
          communityId,
          guildId,
          membersProcessed: 0,
          membersSkipped: 0,
          newDivergences: 0,
          divergencesResolved: 0,
          accuracyPercent: 0,
          durationMs: Date.now() - startTime,
          success: false,
          error: `Not in shadow mode (current: ${mode})`,
        };
      }

      // Get incumbent configuration
      const incumbentConfig = await this.storage.getIncumbentConfig(communityId);
      if (!incumbentConfig) {
        this.logger.warn('No incumbent configured for shadow sync', { communityId });
        return {
          communityId,
          guildId,
          membersProcessed: 0,
          membersSkipped: 0,
          newDivergences: 0,
          divergencesResolved: 0,
          accuracyPercent: 0,
          durationMs: Date.now() - startTime,
          success: false,
          error: 'No incumbent bot configured',
        };
      }

      // Fetch guild and members
      const guild = await this.discordClient.guilds.fetch(guildId);
      if (!guild) {
        throw new Error(`Guild not found: ${guildId}`);
      }

      // Ensure members are cached
      await guild.members.fetch();

      // Determine which members to process
      const skipCutoff = forceFullSync
        ? null
        : new Date(Date.now() - skipRecentHours * 60 * 60 * 1000);

      let membersProcessed = 0;
      let membersSkipped = 0;
      let newDivergences = 0;
      let divergencesResolved = 0;

      // Process members in batches
      const members = Array.from(guild.members.cache.values())
        .filter(m => !m.user.bot); // Skip bots

      for (let i = 0; i < members.length; i += batchSize) {
        const batch = members.slice(i, i + batchSize);

        // Check which members need syncing
        const memberInputs: SaveShadowMemberInput[] = [];
        const memberIds: string[] = [];

        for (const member of batch) {
          // Check if recently synced
          if (skipCutoff) {
            const existing = await this.storage.getShadowMemberState(
              communityId,
              member.id
            );
            if (existing && existing.lastSyncAt > skipCutoff) {
              membersSkipped++;
              continue;
            }
          }

          memberIds.push(member.id);
        }

        if (memberIds.length === 0) continue;

        // Get Arrakis predictions for this batch
        const predictions = await this.getPredictions(communityId, memberIds);
        const predictionMap = new Map(predictions.map(p => [p.memberId, p]));

        // Process each member
        for (const memberId of memberIds) {
          const member = batch.find(m => m.id === memberId);
          if (!member) continue;

          const prediction = predictionMap.get(memberId);

          // Get incumbent roles for this member
          const incumbentRoles = this.getIncumbentRoles(member, incumbentConfig);
          const incumbentTier = this.estimateIncumbentTier(incumbentRoles, incumbentConfig);

          // Compare and detect divergence
          const divergence = this.detectDivergence(
            { roles: incumbentRoles, tier: incumbentTier, conviction: null },
            {
              roles: prediction?.roles ?? [],
              tier: prediction?.tier ?? null,
              conviction: prediction?.conviction ?? 0,
            }
          );

          // Track new divergences
          const existingState = await this.storage.getShadowMemberState(
            communityId,
            memberId
          );
          const wasMatch = existingState?.divergenceType === 'match';
          const isMatch = divergence.type === 'match';

          if (!wasMatch && !isMatch) {
            // New divergence
            newDivergences++;
            await this.storage.saveDivergence({
              communityId,
              memberId,
              divergenceType: divergence.type,
              incumbentState: { roles: incumbentRoles, tier: incumbentTier },
              arrakisState: {
                roles: prediction?.roles ?? [],
                tier: prediction?.tier ?? null,
                conviction: prediction?.conviction ?? null,
              },
              reason: divergence.reason,
            });
          } else if (wasMatch && !isMatch) {
            // Divergence appeared
            newDivergences++;
          } else if (!wasMatch && isMatch) {
            // Divergence resolved
            divergencesResolved++;
          }

          // Update member state
          memberInputs.push({
            communityId,
            memberId,
            incumbentRoles,
            incumbentTier,
            incumbentLastUpdate: new Date(),
            arrakisRoles: prediction?.roles ?? [],
            arrakisTier: prediction?.tier ?? null,
            arrakisConviction: prediction?.conviction ?? null,
            arrakisLastCalculated: new Date(),
            divergenceType: divergence.type,
            divergenceReason: divergence.reason,
            divergenceDetectedAt: divergence.type !== 'match' ? new Date() : null,
          });

          membersProcessed++;
        }

        // Batch save member states
        if (memberInputs.length > 0) {
          await this.storage.batchSaveShadowMemberStates(memberInputs);
        }
      }

      // Calculate final accuracy
      const summary = await this.storage.getDivergenceSummary(communityId);

      this.logger.info('Shadow sync completed', {
        communityId,
        guildId,
        membersProcessed,
        membersSkipped,
        newDivergences,
        divergencesResolved,
        accuracyPercent: summary.accuracyPercent,
        durationMs: Date.now() - startTime,
      });

      return {
        communityId,
        guildId,
        membersProcessed,
        membersSkipped,
        newDivergences,
        divergencesResolved,
        accuracyPercent: summary.accuracyPercent,
        durationMs: Date.now() - startTime,
        success: true,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error('Shadow sync failed', {
        communityId,
        guildId,
        error: errorMessage,
      });

      return {
        communityId,
        guildId,
        membersProcessed: 0,
        membersSkipped: 0,
        newDivergences: 0,
        divergencesResolved: 0,
        accuracyPercent: 0,
        durationMs: Date.now() - startTime,
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Detect divergence between incumbent and Arrakis states
   *
   * Divergence Types:
   * - match: Incumbent and Arrakis would give same access
   * - arrakis_higher: Arrakis would give MORE access (conviction bonus)
   * - arrakis_lower: Arrakis would give LESS access (conviction penalty)
   * - mismatch: Different access but neither clearly higher/lower
   */
  detectDivergence(
    incumbent: ShadowStateSnapshot,
    arrakis: ShadowStateSnapshot
  ): { type: DivergenceType; reason: string | null } {
    // Compare by tier if both have tiers
    if (incumbent.tier !== null && arrakis.tier !== null) {
      if (arrakis.tier > incumbent.tier) {
        return {
          type: 'arrakis_higher',
          reason: `Arrakis tier ${arrakis.tier} > incumbent tier ${incumbent.tier}`,
        };
      }
      if (arrakis.tier < incumbent.tier) {
        return {
          type: 'arrakis_lower',
          reason: `Arrakis tier ${arrakis.tier} < incumbent tier ${incumbent.tier}`,
        };
      }
    }

    // Compare by role count
    const incumbentCount = incumbent.roles.length;
    const arrakisCount = arrakis.roles.length;

    if (incumbentCount === arrakisCount) {
      // Check if same roles (by ID)
      const incumbentSet = new Set(incumbent.roles);
      const arrakisSet = new Set(arrakis.roles);
      const allMatch = [...incumbentSet].every(r => arrakisSet.has(r)) &&
                       [...arrakisSet].every(r => incumbentSet.has(r));

      if (allMatch) {
        return { type: 'match', reason: null };
      }

      // Same count but different roles
      return {
        type: 'mismatch',
        reason: 'Different role sets with same count',
      };
    }

    if (arrakisCount > incumbentCount) {
      return {
        type: 'arrakis_higher',
        reason: `Arrakis would assign ${arrakisCount - incumbentCount} more roles`,
      };
    }

    return {
      type: 'arrakis_lower',
      reason: `Arrakis would assign ${incumbentCount - arrakisCount} fewer roles`,
    };
  }

  /**
   * Calculate accuracy percentage for a community
   *
   * Accuracy is defined as: (matches / total) * 100
   * where a "match" means Arrakis would give the same access as incumbent.
   */
  async calculateAccuracy(communityId: string): Promise<number> {
    const summary = await this.storage.getDivergenceSummary(communityId);
    return summary.accuracyPercent;
  }

  /**
   * Get divergence summary for a community
   */
  async getDivergenceSummary(communityId: string): Promise<DivergenceSummary> {
    return this.storage.getDivergenceSummary(communityId);
  }

  /**
   * Validate predictions against actual outcomes
   *
   * Called after a member's access changes to validate whether our
   * prediction was accurate.
   */
  async validatePredictions(communityId: string): Promise<{
    validated: number;
    accurate: number;
    inaccurate: number;
  }> {
    const predictions = await this.storage.getUnvalidatedPredictions(communityId);

    let validated = 0;
    let accurate = 0;
    let inaccurate = 0;

    for (const prediction of predictions) {
      // Get current shadow state to compare
      const state = await this.storage.getShadowMemberState(
        communityId,
        prediction.memberId
      );

      if (!state) continue;

      // Compare predicted vs actual (incumbent)
      const predictedSet = new Set(prediction.predictedRoles);
      const actualSet = new Set(state.incumbentRoles);

      const overlap = [...predictedSet].filter(r => actualSet.has(r)).length;
      const total = new Set([...predictedSet, ...actualSet]).size;
      const accuracyScore = total > 0 ? Math.round((overlap / total) * 100) : 100;

      const isAccurate = accuracyScore >= 80; // 80% match threshold

      await this.storage.validatePrediction({
        predictionId: prediction.id,
        actualRoles: state.incumbentRoles,
        actualTier: state.incumbentTier,
        accurate: isAccurate,
        accuracyScore,
        accuracyDetails: `Overlap: ${overlap}/${total} roles`,
      });

      validated++;
      if (isAccurate) {
        accurate++;
      } else {
        inaccurate++;
      }
    }

    this.logger.info('Predictions validated', {
      communityId,
      validated,
      accurate,
      inaccurate,
    });

    return { validated, accurate, inaccurate };
  }

  // =========================================================================
  // Private Helpers
  // =========================================================================

  /**
   * Get roles assigned by incumbent bot
   *
   * We identify incumbent-assigned roles by matching against the detected
   * role patterns from incumbent configuration.
   */
  private getIncumbentRoles(
    member: GuildMember,
    config: StoredIncumbentConfig
  ): string[] {
    const detectedRoleIds = new Set(config.detectedRoles.map(r => r.id));

    // Return roles that match detected incumbent roles
    return member.roles.cache
      .filter(r => detectedRoleIds.has(r.id))
      .map(r => r.id);
  }

  /**
   * Estimate incumbent tier based on roles
   *
   * This is a heuristic - we look for patterns in role names
   * that suggest tiering (tier-1, tier-2, whale, holder, etc.)
   */
  private estimateIncumbentTier(
    roles: string[],
    config: StoredIncumbentConfig
  ): number | null {
    if (roles.length === 0) return null;

    // Find highest tier from detected roles
    const detectedRoleMap = new Map(
      config.detectedRoles.map(r => [r.id, r])
    );

    let maxConfidence = 0;
    let estimatedTier: number | null = null;

    for (const roleId of roles) {
      const detected = detectedRoleMap.get(roleId);
      if (detected && detected.confidence > maxConfidence) {
        maxConfidence = detected.confidence;
        // Use 1-based tier based on confidence buckets
        if (detected.confidence >= 0.8) {
          estimatedTier = 3; // High confidence = higher tier
        } else if (detected.confidence >= 0.5) {
          estimatedTier = 2;
        } else {
          estimatedTier = 1;
        }
      }
    }

    return estimatedTier;
  }
}

/**
 * Factory function to create ShadowLedger
 */
export function createShadowLedger(
  storage: ICoexistenceStorage,
  discordClient: Client,
  getPredictions: GetArrakisPredictions,
  logger?: ILogger
): ShadowLedger {
  return new ShadowLedger(storage, discordClient, getPredictions, logger);
}

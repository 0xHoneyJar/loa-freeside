/**
 * MigrationPrompter - Migration Readiness and Prompt System
 *
 * Sprint 105: Migration System
 *
 * Manages migration readiness checks and admin prompts for communities
 * in shadow mode. Tracks accuracy, shadow duration, and prompts admins
 * when ready to transition to full mode.
 *
 * Thresholds:
 * - Soft prompt: 95% accuracy, 14+ days
 * - Full unlock: 98% accuracy, 30+ days
 *
 * @module services/discord/migration/MigrationPrompter
 */

import { createLogger, type ILogger } from '../../../packages/infrastructure/logging/index.js';

// =============================================================================
// Constants
// =============================================================================

/**
 * Readiness thresholds
 */
export const MIGRATION_THRESHOLDS = {
  /** Minimum accuracy for soft prompt (95%) */
  SOFT_PROMPT_ACCURACY: 0.95,
  /** Minimum days in shadow for soft prompt */
  SOFT_PROMPT_DAYS: 14,
  /** Minimum accuracy for full unlock (98%) */
  FULL_UNLOCK_ACCURACY: 0.98,
  /** Minimum days in shadow for full unlock */
  FULL_UNLOCK_DAYS: 30,
  /** Cooldown between prompts in days */
  PROMPT_COOLDOWN_DAYS: 7,
  /** Stop prompting after this many days */
  MAX_PROMPT_DAYS: 90,
  /** Minimum accuracy trend for prompt (must be stable or improving) */
  MIN_ACCURACY_TREND: -0.01, // Allow tiny dip
} as const;

/**
 * Migration modes
 */
export const MIGRATION_MODES = {
  SHADOW: 'shadow',
  GREENFIELD: 'greenfield',
  FULL: 'full',
} as const;

export type MigrationMode = (typeof MIGRATION_MODES)[keyof typeof MIGRATION_MODES];

/**
 * Prompt acknowledgment actions
 */
export const PROMPT_ACTIONS = {
  ENABLE_FULL: 'enable_full',
  VIEW_DETAILS: 'view_details',
  DISMISS: 'dismiss',
  DEFER: 'defer',
} as const;

export type PromptAction = (typeof PROMPT_ACTIONS)[keyof typeof PROMPT_ACTIONS];

// =============================================================================
// Types
// =============================================================================

/**
 * Readiness check result
 */
export interface ReadinessResult {
  isReady: boolean;
  isSoftReady: boolean;
  isFullReady: boolean;
  accuracy: number;
  accuracyTrend: number;
  daysInShadow: number;
  blockers: string[];
  recommendation: string;
}

/**
 * Migration prompt content
 */
export interface PromptContent {
  title: string;
  description: string;
  fields: Array<{ name: string; value: string; inline?: boolean }>;
  color: number;
  buttons: Array<{ id: string; label: string; style: 'primary' | 'secondary' | 'success' | 'danger' }>;
}

/**
 * Migration prompt record
 */
export interface MigrationPrompt {
  id: string;
  communityId: string;
  accuracy: number;
  daysInShadow: number;
  content: PromptContent;
  isReady: boolean;
  sentAt: Date;
  acknowledgedAt: Date | null;
  acknowledgedAction: PromptAction | null;
}

/**
 * Community shadow state
 */
export interface CommunityState {
  communityId: string;
  mode: MigrationMode;
  shadowStartedAt: Date | null;
  accuracy: number;
  accuracyHistory: Array<{ date: Date; accuracy: number }>;
  lastPromptAt: Date | null;
  promptCount: number;
}

/**
 * Storage adapter interface
 */
export interface IMigrationStorage {
  getCommunityState(communityId: string): Promise<CommunityState | null>;
  updateCommunityMode(communityId: string, mode: MigrationMode): Promise<void>;
  savePrompt(prompt: MigrationPrompt): Promise<void>;
  getLastPrompt(communityId: string): Promise<MigrationPrompt | null>;
  acknowledgePrompt(promptId: string, action: PromptAction): Promise<void>;
  getShadowCommunities(): Promise<CommunityState[]>;
}

/**
 * Notification adapter interface
 */
export interface IMigrationNotifier {
  sendPrompt(communityId: string, content: PromptContent): Promise<boolean>;
}

/**
 * Event emitter interface
 */
export interface IMigrationEvents {
  emit(event: 'prompt_sent', data: { communityId: string; prompt: MigrationPrompt }): void;
  emit(event: 'prompt_acknowledged', data: { communityId: string; action: PromptAction }): void;
  emit(event: 'migration_started', data: { communityId: string; fromMode: MigrationMode }): void;
  emit(event: 'migration_completed', data: { communityId: string; toMode: MigrationMode }): void;
}

// =============================================================================
// Implementation
// =============================================================================

/**
 * Migration Prompter service for managing shadow-to-full transitions
 */
export class MigrationPrompter {
  private readonly logger: ILogger;

  constructor(
    private readonly storage: IMigrationStorage,
    private readonly notifier?: IMigrationNotifier,
    private readonly events?: IMigrationEvents,
    logger?: ILogger
  ) {
    this.logger = logger ?? createLogger({ service: 'MigrationPrompter' });
  }

  /**
   * Check migration readiness for a community
   */
  async checkReadiness(communityId: string): Promise<ReadinessResult> {
    const state = await this.storage.getCommunityState(communityId);

    if (!state || state.mode !== MIGRATION_MODES.SHADOW) {
      return {
        isReady: false,
        isSoftReady: false,
        isFullReady: false,
        accuracy: 0,
        accuracyTrend: 0,
        daysInShadow: 0,
        blockers: ['Not in shadow mode'],
        recommendation: 'Community must be in shadow mode to check migration readiness',
      };
    }

    const daysInShadow = this.calculateDaysInShadow(state.shadowStartedAt);
    const accuracyTrend = this.calculateAccuracyTrend(state.accuracyHistory);
    const blockers: string[] = [];

    // Check soft readiness
    const isSoftReady =
      state.accuracy >= MIGRATION_THRESHOLDS.SOFT_PROMPT_ACCURACY &&
      daysInShadow >= MIGRATION_THRESHOLDS.SOFT_PROMPT_DAYS &&
      accuracyTrend >= MIGRATION_THRESHOLDS.MIN_ACCURACY_TREND;

    // Check full readiness
    const isFullReady =
      state.accuracy >= MIGRATION_THRESHOLDS.FULL_UNLOCK_ACCURACY &&
      daysInShadow >= MIGRATION_THRESHOLDS.FULL_UNLOCK_DAYS &&
      accuracyTrend >= MIGRATION_THRESHOLDS.MIN_ACCURACY_TREND;

    // Collect blockers
    if (state.accuracy < MIGRATION_THRESHOLDS.SOFT_PROMPT_ACCURACY) {
      blockers.push(`Accuracy ${(state.accuracy * 100).toFixed(1)}% below ${(MIGRATION_THRESHOLDS.SOFT_PROMPT_ACCURACY * 100).toFixed(0)}% threshold`);
    }
    if (daysInShadow < MIGRATION_THRESHOLDS.SOFT_PROMPT_DAYS) {
      blockers.push(`${daysInShadow} days in shadow (minimum ${MIGRATION_THRESHOLDS.SOFT_PROMPT_DAYS})`);
    }
    if (accuracyTrend < MIGRATION_THRESHOLDS.MIN_ACCURACY_TREND) {
      blockers.push('Accuracy trend is declining');
    }

    // Generate recommendation
    let recommendation = '';
    if (isFullReady) {
      recommendation = 'Community is ready for full migration. All thresholds met.';
    } else if (isSoftReady) {
      recommendation = 'Community meets soft thresholds. Consider migration or continue monitoring.';
    } else if (blockers.length === 1) {
      recommendation = `Almost ready. ${blockers[0]}`;
    } else {
      recommendation = `Not yet ready. ${blockers.length} blockers remain.`;
    }

    return {
      isReady: isSoftReady || isFullReady,
      isSoftReady,
      isFullReady,
      accuracy: state.accuracy,
      accuracyTrend,
      daysInShadow,
      blockers,
      recommendation,
    };
  }

  /**
   * Generate prompt content for a community
   */
  async generatePromptContent(communityId: string): Promise<PromptContent> {
    const readiness = await this.checkReadiness(communityId);

    const accuracyPercent = (readiness.accuracy * 100).toFixed(1);
    const trendEmoji = readiness.accuracyTrend >= 0 ? '📈' : '📉';
    const trendText = readiness.accuracyTrend >= 0 ? 'stable/improving' : 'declining';

    // Determine color based on readiness
    let color = 0x808080; // Gray (not ready)
    if (readiness.isFullReady) {
      color = 0x00ff00; // Green (fully ready)
    } else if (readiness.isSoftReady) {
      color = 0xffff00; // Yellow (soft ready)
    }

    const content: PromptContent = {
      title: readiness.isFullReady
        ? '🎉 Migration Ready!'
        : readiness.isSoftReady
          ? '🟡 Migration Almost Ready'
          : '📊 Migration Status Update',
      description: readiness.recommendation,
      fields: [
        {
          name: 'Shadow Accuracy',
          value: `${accuracyPercent}% ${trendEmoji} (${trendText})`,
          inline: true,
        },
        {
          name: 'Days in Shadow',
          value: `${readiness.daysInShadow} days`,
          inline: true,
        },
        {
          name: 'Status',
          value: readiness.isFullReady
            ? '✅ Fully Ready'
            : readiness.isSoftReady
              ? '🟡 Soft Ready'
              : '⏳ Monitoring',
          inline: true,
        },
      ],
      color,
      buttons: [],
    };

    // Add blockers if any
    if (readiness.blockers.length > 0) {
      content.fields.push({
        name: 'Blockers',
        value: readiness.blockers.map(b => `• ${b}`).join('\n'),
      });
    }

    // Add buttons based on readiness
    if (readiness.isFullReady || readiness.isSoftReady) {
      content.buttons.push({
        id: PROMPT_ACTIONS.ENABLE_FULL,
        label: 'Enable Full Features',
        style: 'success',
      });
    }

    content.buttons.push(
      { id: PROMPT_ACTIONS.VIEW_DETAILS, label: 'View Details', style: 'secondary' },
      { id: PROMPT_ACTIONS.DISMISS, label: 'Dismiss', style: 'secondary' }
    );

    return content;
  }

  /**
   * Send a migration prompt to admins
   */
  async sendPrompt(communityId: string): Promise<MigrationPrompt | null> {
    // Check if we should send a prompt
    const canSend = await this.canSendPrompt(communityId);
    if (!canSend.allowed) {
      this.logger.debug('Prompt not sent', { communityId, reason: canSend.reason });
      return null;
    }

    const readiness = await this.checkReadiness(communityId);
    const content = await this.generatePromptContent(communityId);

    const prompt: MigrationPrompt = {
      id: this.generatePromptId(),
      communityId,
      accuracy: readiness.accuracy,
      daysInShadow: readiness.daysInShadow,
      content,
      isReady: readiness.isReady,
      sentAt: new Date(),
      acknowledgedAt: null,
      acknowledgedAction: null,
    };

    // Save prompt record
    await this.storage.savePrompt(prompt);

    // Send via notifier if available
    if (this.notifier) {
      const sent = await this.notifier.sendPrompt(communityId, content);
      if (!sent) {
        this.logger.warn('Failed to send prompt via notifier', { communityId });
      }
    }

    this.events?.emit('prompt_sent', { communityId, prompt });
    this.logger.info('Migration prompt sent', { communityId, isReady: readiness.isReady });

    return prompt;
  }

  /**
   * Check if we can send a prompt (cooldown, max days, etc.)
   */
  async canSendPrompt(communityId: string): Promise<{ allowed: boolean; reason?: string }> {
    const state = await this.storage.getCommunityState(communityId);

    if (!state || state.mode !== MIGRATION_MODES.SHADOW) {
      return { allowed: false, reason: 'Not in shadow mode' };
    }

    const daysInShadow = this.calculateDaysInShadow(state.shadowStartedAt);

    // Check max prompt days
    if (daysInShadow > MIGRATION_THRESHOLDS.MAX_PROMPT_DAYS) {
      return { allowed: false, reason: 'Exceeded maximum prompt period' };
    }

    // Check cooldown
    if (state.lastPromptAt) {
      const daysSinceLastPrompt = this.calculateDaysSince(state.lastPromptAt);
      if (daysSinceLastPrompt < MIGRATION_THRESHOLDS.PROMPT_COOLDOWN_DAYS) {
        return { allowed: false, reason: `Cooldown: ${MIGRATION_THRESHOLDS.PROMPT_COOLDOWN_DAYS - daysSinceLastPrompt} days remaining` };
      }
    }

    return { allowed: true };
  }

  /**
   * Acknowledge a migration prompt
   */
  async acknowledgePrompt(promptId: string, action: PromptAction): Promise<void> {
    await this.storage.acknowledgePrompt(promptId, action);
    this.events?.emit('prompt_acknowledged', { communityId: '', action });

    this.logger.info('Prompt acknowledged', { promptId, action });
  }

  /**
   * Execute migration from shadow to full mode
   */
  async executeMigration(communityId: string, force = false): Promise<{ success: boolean; message: string }> {
    const readiness = await this.checkReadiness(communityId);

    if (!readiness.isReady && !force) {
      return {
        success: false,
        message: `Migration blocked: ${readiness.blockers.join(', ')}`,
      };
    }

    const state = await this.storage.getCommunityState(communityId);
    if (!state) {
      return { success: false, message: 'Community not found' };
    }

    const fromMode = state.mode;
    this.events?.emit('migration_started', { communityId, fromMode });

    try {
      await this.storage.updateCommunityMode(communityId, MIGRATION_MODES.FULL);

      this.events?.emit('migration_completed', { communityId, toMode: MIGRATION_MODES.FULL });
      this.logger.info('Migration completed', { communityId, fromMode, toMode: MIGRATION_MODES.FULL, forced: force });

      return {
        success: true,
        message: force
          ? 'Migration completed (forced - not all thresholds met)'
          : 'Migration completed successfully',
      };
    } catch (error) {
      this.logger.error('Migration failed', { communityId, error: String(error) });
      return { success: false, message: `Migration failed: ${String(error)}` };
    }
  }

  /**
   * Process all shadow communities for prompts (daily job)
   */
  async processAllCommunities(): Promise<{ processed: number; prompted: number; errors: number }> {
    const communities = await this.storage.getShadowCommunities();
    let processed = 0;
    let prompted = 0;
    let errors = 0;

    for (const community of communities) {
      try {
        processed++;

        const readiness = await this.checkReadiness(community.communityId);
        if (!readiness.isReady) continue;

        const prompt = await this.sendPrompt(community.communityId);
        if (prompt) prompted++;
      } catch (error) {
        errors++;
        this.logger.error('Error processing community', {
          communityId: community.communityId,
          error: String(error),
        });
      }
    }

    this.logger.info('Prompt job completed', { processed, prompted, errors });
    return { processed, prompted, errors };
  }

  // =========================================================================
  // Private Helpers
  // =========================================================================

  private calculateDaysInShadow(shadowStartedAt: Date | null): number {
    if (!shadowStartedAt) return 0;
    const now = new Date();
    const diffMs = now.getTime() - shadowStartedAt.getTime();
    return Math.floor(diffMs / (1000 * 60 * 60 * 24));
  }

  private calculateDaysSince(date: Date): number {
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    return Math.floor(diffMs / (1000 * 60 * 60 * 24));
  }

  private calculateAccuracyTrend(history: Array<{ date: Date; accuracy: number }>): number {
    if (history.length < 2) return 0;

    // Sort by date ascending
    const sorted = [...history].sort((a, b) => a.date.getTime() - b.date.getTime());

    // Calculate simple linear trend (difference between first and last week)
    const recentWeek = sorted.slice(-7);
    const priorWeek = sorted.slice(-14, -7);

    if (recentWeek.length === 0 || priorWeek.length === 0) return 0;

    const recentAvg = recentWeek.reduce((sum, h) => sum + h.accuracy, 0) / recentWeek.length;
    const priorAvg = priorWeek.reduce((sum, h) => sum + h.accuracy, 0) / priorWeek.length;

    return recentAvg - priorAvg;
  }

  private generatePromptId(): string {
    return `prompt-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }
}

/**
 * Factory function to create MigrationPrompter
 */
export function createMigrationPrompter(
  storage: IMigrationStorage,
  notifier?: IMigrationNotifier,
  events?: IMigrationEvents,
  logger?: ILogger
): MigrationPrompter {
  return new MigrationPrompter(storage, notifier, events, logger);
}

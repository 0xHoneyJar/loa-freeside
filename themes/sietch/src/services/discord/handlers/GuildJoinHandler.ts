/**
 * GuildJoinHandler - Intelligent Onboarding Orchestration
 *
 * Sprint 102: Foundation - Sandworm Sense
 *
 * Handles the bot joining a new guild (GUILD_CREATE event).
 * Orchestrates incumbent detection and mode selection for intelligent onboarding.
 *
 * Flow:
 * 1. Guild join event triggers handler
 * 2. IncumbentDetector scans for existing token-gating bots
 * 3. ModeSelector determines shadow/greenfield/hybrid mode
 * 4. Community config is created/updated with mode
 * 5. Completion event emitted for downstream handlers
 *
 * CRITICAL: This handler NEVER performs Discord mutations during detection.
 * All mutation decisions are deferred to the MigrationManager.
 *
 * @see PRD FR-1 Auto Detection
 * @see PRD FR-2 Shadow Activation
 * @see PRD FR-3 Greenfield
 * @see SDD §2.1 Component Design
 */

import type { Guild, Client } from 'discord.js';
import { createLogger, type ILogger } from '../../../packages/infrastructure/logging/index.js';
import {
  ModeSelector,
  createModeSelector,
  type OnboardingMode,
  type ModeSelectionResult,
} from './ModeSelector.js';
import { createIncumbentDetector } from '../../../packages/adapters/coexistence/IncumbentDetector.js';
import type { ICoexistenceStorage } from '../../../packages/core/ports/ICoexistenceStorage.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Result of the guild join onboarding process
 */
export interface OnboardingResult {
  /** Guild ID */
  guildId: string;
  /** Guild name */
  guildName: string;
  /** Selected onboarding mode */
  mode: OnboardingMode;
  /** Detection confidence */
  confidence: number;
  /** Detected incumbent provider (if any) */
  incumbentProvider: string | null;
  /** Whether admin confirmation is needed */
  requiresAdminConfirmation: boolean;
  /** Human-readable explanation */
  explanation: string;
  /** Timestamp of completion */
  completedAt: Date;
  /** Duration in milliseconds */
  durationMs: number;
}

/**
 * Options for the GuildJoinHandler
 */
export interface GuildJoinHandlerOptions {
  /** Maximum time for detection (default: 5000ms per NFR) */
  detectionTimeoutMs?: number;
  /** Skip detection for guilds with existing config */
  skipIfConfigExists?: boolean;
  /** Force re-detection even if config exists */
  forceRedetect?: boolean;
}

const DEFAULT_OPTIONS: Required<GuildJoinHandlerOptions> = {
  detectionTimeoutMs: 5000, // NFR from PRD: complete within 5 seconds
  skipIfConfigExists: true,
  forceRedetect: false,
};

// =============================================================================
// Implementation
// =============================================================================

/**
 * Handles guild join events for intelligent onboarding.
 */
export class GuildJoinHandler {
  private readonly log: ILogger;
  private readonly modeSelector: ModeSelector;

  constructor(
    private readonly coexistenceStorage: ICoexistenceStorage,
    private readonly discordClient: Client,
    private readonly options: GuildJoinHandlerOptions = {},
    logger?: ILogger
  ) {
    this.log = logger ?? createLogger({ service: 'GuildJoinHandler' });
    this.modeSelector = createModeSelector(this.log);
  }

  /**
   * Handle a guild join event.
   *
   * This is the main entry point called when the bot joins a new guild.
   *
   * @param guild - Discord Guild object
   * @returns Onboarding result
   */
  async handleGuildJoin(guild: Guild): Promise<OnboardingResult> {
    const startTime = Date.now();
    const opts = { ...DEFAULT_OPTIONS, ...this.options };

    this.log.info(
      { guildId: guild.id, guildName: guild.name, memberCount: guild.memberCount },
      'Guild join detected, starting intelligent onboarding'
    );

    try {
      // Step 1: Check for existing configuration
      if (opts.skipIfConfigExists && !opts.forceRedetect) {
        const existingConfig = await this.coexistenceStorage.getIncumbentConfig(guild.id);
        if (existingConfig) {
          this.log.info(
            { guildId: guild.id, provider: existingConfig.provider },
            'Guild already has incumbent config, skipping detection'
          );
          return this.createSkippedResult(guild, existingConfig, startTime);
        }
      }

      // Step 2: Run incumbent detection with timeout
      const detectionResult = await this.runDetectionWithTimeout(guild, opts.detectionTimeoutMs);

      // Step 3: Select onboarding mode based on detection
      const modeResult = this.modeSelector.select({
        provider: detectionResult.provider,
        confidence: detectionResult.confidence,
        memberCount: guild.memberCount,
        botId: detectionResult.info?.bot?.id,
        detectionMethod: detectionResult.detectionMethod,
      });

      // Step 4: Persist configuration if incumbent detected
      if (detectionResult.detected && detectionResult.info) {
        await this.persistIncumbentConfig(guild.id, detectionResult, modeResult.mode);
      }

      // Step 5: Initialize migration state based on mode
      await this.initializeMigrationState(guild.id, modeResult.mode);

      const result = this.createSuccessResult(guild, modeResult, startTime);

      this.log.info(
        {
          guildId: guild.id,
          mode: result.mode,
          confidence: result.confidence.toFixed(3),
          durationMs: result.durationMs,
          incumbentProvider: result.incumbentProvider,
        },
        'Guild onboarding complete'
      );

      return result;
    } catch (error) {
      this.log.error(
        { error, guildId: guild.id },
        'Guild onboarding failed'
      );

      // Return greenfield mode on error (safe default)
      return this.createErrorResult(guild, error as Error, startTime);
    }
  }

  /**
   * Run incumbent detection with a timeout.
   */
  private async runDetectionWithTimeout(
    guild: Guild,
    timeoutMs: number
  ): Promise<import('../../../packages/adapters/coexistence/IncumbentDetector.js').DetectionResult> {
    const detector = createIncumbentDetector(
      this.coexistenceStorage,
      this.discordClient,
      this.log
    );

    // Create a timeout promise
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(
        () => reject(new Error(`Detection timeout after ${timeoutMs}ms`)),
        timeoutMs
      );
    });

    // Race detection against timeout
    return Promise.race([
      detector.detectIncumbent(guild.id, { analyzeRoles: true }),
      timeoutPromise,
    ]);
  }

  /**
   * Persist incumbent configuration to storage.
   */
  private async persistIncumbentConfig(
    guildId: string,
    detectionResult: import('../../../packages/adapters/coexistence/IncumbentDetector.js').DetectionResult,
    mode: OnboardingMode
  ): Promise<void> {
    const info = detectionResult.info!;

    await this.coexistenceStorage.saveIncumbentConfig({
      communityId: guildId, // Using guildId as communityId for now
      provider: detectionResult.provider!,
      botId: info.bot?.id,
      botUsername: info.bot?.username,
      verificationChannelId: info.channels?.verification ?? undefined,
      confidence: detectionResult.confidence,
      detectedRoles: info.roles,
      capabilities: info.capabilities,
    });

    this.log.debug(
      { guildId, provider: detectionResult.provider, mode },
      'Incumbent config persisted'
    );
  }

  /**
   * Initialize migration state based on selected mode.
   */
  private async initializeMigrationState(
    guildId: string,
    mode: OnboardingMode
  ): Promise<void> {
    // Map OnboardingMode to CoexistenceMode
    const coexistenceMode =
      mode === 'shadow'
        ? 'shadow'
        : mode === 'greenfield'
          ? 'primary' // Greenfield starts in primary (Arrakis-first)
          : 'shadow'; // Hybrid defaults to shadow until admin confirms

    await this.coexistenceStorage.initializeShadowMode(guildId);

    this.log.debug(
      { guildId, mode, coexistenceMode },
      'Migration state initialized'
    );
  }

  // ===========================================================================
  // Result Builders
  // ===========================================================================

  private createSuccessResult(
    guild: Guild,
    modeResult: ModeSelectionResult,
    startTime: number
  ): OnboardingResult {
    return {
      guildId: guild.id,
      guildName: guild.name,
      mode: modeResult.mode,
      confidence: modeResult.confidence,
      incumbentProvider: modeResult.evidence.provider,
      requiresAdminConfirmation: modeResult.requiresAdminConfirmation,
      explanation: modeResult.explanation,
      completedAt: new Date(),
      durationMs: Date.now() - startTime,
    };
  }

  private createSkippedResult(
    guild: Guild,
    existingConfig: { provider: string; confidence: number },
    startTime: number
  ): OnboardingResult {
    return {
      guildId: guild.id,
      guildName: guild.name,
      mode: 'shadow', // Existing config implies shadow mode
      confidence: existingConfig.confidence / 100, // Convert from 0-100 to 0-1
      incumbentProvider: existingConfig.provider,
      requiresAdminConfirmation: false,
      explanation: `Previously detected ${existingConfig.provider}. Configuration already exists.`,
      completedAt: new Date(),
      durationMs: Date.now() - startTime,
    };
  }

  private createErrorResult(
    guild: Guild,
    error: Error,
    startTime: number
  ): OnboardingResult {
    return {
      guildId: guild.id,
      guildName: guild.name,
      mode: 'greenfield', // Safe default on error
      confidence: 0,
      incumbentProvider: null,
      requiresAdminConfirmation: true, // Recommend admin review on error
      explanation: `Detection failed: ${error.message}. Defaulting to greenfield mode.`,
      completedAt: new Date(),
      durationMs: Date.now() - startTime,
    };
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a GuildJoinHandler instance.
 */
export function createGuildJoinHandler(
  coexistenceStorage: ICoexistenceStorage,
  discordClient: Client,
  options?: GuildJoinHandlerOptions,
  logger?: ILogger
): GuildJoinHandler {
  return new GuildJoinHandler(coexistenceStorage, discordClient, options, logger);
}

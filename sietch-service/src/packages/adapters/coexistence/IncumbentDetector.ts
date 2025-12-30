/**
 * IncumbentDetector - Detect Token-Gating Bots in Discord Guilds
 *
 * Sprint 56: Shadow Mode Foundation - Incumbent Detection
 *
 * Detects incumbent token-gating solutions (Collab.Land, Matrica, Guild.xyz)
 * using multiple detection methods:
 * 1. Known bot IDs (highest confidence)
 * 2. Verification channel patterns
 * 3. Bot username patterns
 * 4. Role name patterns
 *
 * CRITICAL: This service NEVER performs Discord mutations.
 * It only reads guild information for detection purposes.
 *
 * @module packages/adapters/coexistence/IncumbentDetector
 */

import type { Client, Guild } from 'discord.js';
import type {
  ICoexistenceStorage,
  IncumbentInfo,
} from '../../core/ports/ICoexistenceStorage.js';
import type {
  IncumbentProvider,
  DetectedRole,
  IncumbentCapabilities,
} from '../storage/schema.js';
import { createLogger, type ILogger } from '../../infrastructure/logging/index.js';

// =============================================================================
// Known Incumbent Configuration
// =============================================================================

/**
 * Configuration for detecting known incumbent token-gating bots
 *
 * Sources:
 * - Collab.Land: https://collab.land/ (most common)
 * - Matrica: https://matrica.io/
 * - Guild.xyz: https://guild.xyz/
 */
export const KNOWN_INCUMBENTS: Record<
  Exclude<IncumbentProvider, 'other'>,
  {
    botIds: string[];
    channelPatterns: string[];
    rolePatterns: string[];
    usernamePatterns: string[];
    capabilities: IncumbentCapabilities;
  }
> = {
  collabland: {
    // Official Collab.Land bot ID
    botIds: ['704521096837464076'],
    channelPatterns: [
      'collabland-join',
      'collabland-config',
      'collab-land',
      'verify',
      'verification',
    ],
    rolePatterns: [
      'holder',
      'verified',
      'whale',
      'member',
      'nft-holder',
      'token-holder',
    ],
    usernamePatterns: ['collab.land', 'collabland'],
    capabilities: {
      hasBalanceCheck: true,
      hasConvictionScoring: false,
      hasTierSystem: true,
      hasSocialLayer: false,
    },
  },
  matrica: {
    // Matrica bot ID (if known - placeholder for now)
    botIds: [],
    channelPatterns: [
      'matrica-verify',
      'matrica',
      'matrica-join',
    ],
    rolePatterns: [
      'verified',
      'holder',
      'matrica-verified',
    ],
    usernamePatterns: ['matrica'],
    capabilities: {
      hasBalanceCheck: true,
      hasConvictionScoring: false,
      hasTierSystem: false,
      hasSocialLayer: false,
    },
  },
  'guild.xyz': {
    // Guild.xyz bot ID (if known - placeholder for now)
    botIds: [],
    channelPatterns: [
      'guild-join',
      'guild-verify',
      'guild',
    ],
    rolePatterns: [
      'guild-member',
      'verified',
      'guild-verified',
    ],
    usernamePatterns: ['guild.xyz', 'guild'],
    capabilities: {
      hasBalanceCheck: true,
      hasConvictionScoring: false,
      hasTierSystem: true,
      hasSocialLayer: false,
    },
  },
} as const;

/**
 * Detection confidence thresholds
 */
export const CONFIDENCE = {
  /** Bot ID match (definitive) */
  BOT_ID_MATCH: 0.95,
  /** Username pattern match */
  USERNAME_MATCH: 0.85,
  /** Channel pattern match */
  CHANNEL_MATCH: 0.70,
  /** Role pattern match only */
  ROLE_PATTERN_ONLY: 0.50,
  /** Generic bot with verify/token keywords */
  GENERIC_SUSPECT: 0.40,
  /** Role is likely token-gated (based on name) */
  ROLE_LIKELY_GATED: 0.80,
  /** Role might be token-gated */
  ROLE_MAYBE_GATED: 0.30,
} as const;

// =============================================================================
// Types
// =============================================================================

/**
 * Detection result before saving to storage
 */
export interface DetectionResult {
  detected: boolean;
  provider: IncumbentProvider | null;
  confidence: number;
  info: IncumbentInfo | null;
  detectionMethod: 'bot_id' | 'username' | 'channel' | 'role' | 'generic' | 'none';
}

/**
 * Options for detection behavior
 */
export interface DetectionOptions {
  /** Skip if already detected (default: true) */
  skipIfExists?: boolean;
  /** Force re-detection (default: false) */
  forceRedetect?: boolean;
  /** Include full role analysis (default: true) */
  analyzeRoles?: boolean;
}

// =============================================================================
// Implementation
// =============================================================================

/**
 * Detects incumbent token-gating bots in Discord guilds
 */
export class IncumbentDetector {
  private readonly logger: ILogger;

  constructor(
    private readonly storage: ICoexistenceStorage,
    private readonly discordClient: Client,
    logger?: ILogger
  ) {
    this.logger = logger ?? createLogger({ service: 'IncumbentDetector' });
  }

  /**
   * Detect incumbent token-gating bot in a guild
   *
   * Detection order (by confidence):
   * 1. Known bot ID match (0.95)
   * 2. Bot username pattern match (0.85)
   * 3. Verification channel pattern (0.70)
   * 4. Role pattern match (0.50)
   * 5. Generic suspect bot (0.40)
   *
   * @param guildId - Discord guild ID
   * @param options - Detection options
   * @returns Detection result
   */
  async detectIncumbent(
    guildId: string,
    options: DetectionOptions = {}
  ): Promise<DetectionResult> {
    const {
      skipIfExists = true,
      forceRedetect = false,
      analyzeRoles = true,
    } = options;

    // Check if already detected (unless forcing re-detection)
    if (skipIfExists && !forceRedetect) {
      const existingConfig = await this.storage.getIncumbentConfig(guildId);
      if (existingConfig) {
        this.logger.debug('Incumbent already detected', {
          guildId,
          provider: existingConfig.provider,
        });
        return {
          detected: true,
          provider: existingConfig.provider,
          confidence: existingConfig.confidence,
          info: null, // Don't rebuild full info for existing
          detectionMethod: 'none',
        };
      }
    }

    // Fetch guild
    const guild = await this.discordClient.guilds.fetch(guildId);
    if (!guild) {
      this.logger.warn('Guild not found', { guildId });
      return {
        detected: false,
        provider: null,
        confidence: 0,
        info: null,
        detectionMethod: 'none',
      };
    }

    // Ensure members are cached for detection
    await guild.members.fetch();

    // Try detection methods in order of confidence
    let result = this.detectByBotId(guild);
    if (result.detected) {
      if (analyzeRoles) {
        result.info = this.buildIncumbentInfo(guild, result.provider!, result.info?.bot ?? null);
      }
      return result;
    }

    result = this.detectByUsername(guild);
    if (result.detected) {
      if (analyzeRoles) {
        result.info = this.buildIncumbentInfo(guild, result.provider!, result.info?.bot ?? null);
      }
      return result;
    }

    result = this.detectByChannel(guild);
    if (result.detected) {
      if (analyzeRoles) {
        result.info = this.buildIncumbentInfo(guild, result.provider!, null);
      }
      return result;
    }

    result = this.detectGenericSuspect(guild);
    if (result.detected) {
      if (analyzeRoles) {
        result.info = this.buildIncumbentInfo(guild, 'other', result.info?.bot ?? null);
      }
      return result;
    }

    // No incumbent detected
    this.logger.info('No incumbent detected', { guildId });
    return {
      detected: false,
      provider: null,
      confidence: 0,
      info: null,
      detectionMethod: 'none',
    };
  }

  /**
   * Build complete incumbent information
   *
   * @param guild - Discord guild
   * @param provider - Incumbent provider type
   * @param botInfo - Bot info from detection (id, username, joinedAt) or null
   */
  buildIncumbentInfo(
    guild: Guild,
    provider: IncumbentProvider,
    botInfo: { id: string; username: string; joinedAt: Date } | null
  ): IncumbentInfo {
    const config = provider !== 'other'
      ? KNOWN_INCUMBENTS[provider]
      : KNOWN_INCUMBENTS.collabland; // Use collabland as default pattern source

    // Find verification channel
    const verificationChannel = guild.channels.cache.find((c) =>
      config.channelPatterns.some((p) =>
        c.name.toLowerCase().includes(p.toLowerCase())
      )
    );

    // Analyze roles for token-gating likelihood
    const roles = this.analyzeRoles(guild, config.rolePatterns);

    // Determine capabilities
    const capabilities = provider !== 'other'
      ? KNOWN_INCUMBENTS[provider].capabilities
      : {
          hasBalanceCheck: true,
          hasConvictionScoring: false,
          hasTierSystem: false,
          hasSocialLayer: false,
        };

    // Calculate overall confidence
    const confidence = botInfo
      ? CONFIDENCE.BOT_ID_MATCH
      : verificationChannel
        ? CONFIDENCE.CHANNEL_MATCH
        : CONFIDENCE.ROLE_PATTERN_ONLY;

    return {
      provider,
      confidence,
      bot: botInfo,
      channels: {
        verification: verificationChannel?.id ?? null,
        config: null, // Could be detected with more patterns
      },
      roles,
      capabilities,
    };
  }

  /**
   * Save detection result to storage
   *
   * @param communityId - Community UUID (not guild ID)
   * @param guildId - Discord guild ID
   * @param options - Detection options
   * @returns Saved configuration or null if no incumbent detected
   */
  async detectAndSave(
    communityId: string,
    guildId: string,
    options: DetectionOptions = {}
  ): Promise<IncumbentInfo | null> {
    const result = await this.detectIncumbent(guildId, options);

    if (!result.detected || !result.info) {
      return null;
    }

    // Save to storage
    await this.storage.saveIncumbentConfig({
      communityId,
      provider: result.provider!,
      botId: result.info.bot?.id,
      botUsername: result.info.bot?.username,
      verificationChannelId: result.info.channels.verification ?? undefined,
      confidence: result.confidence,
      detectedRoles: result.info.roles,
      capabilities: result.info.capabilities,
    });

    // Initialize shadow mode
    await this.storage.initializeShadowMode(communityId);

    this.logger.info('Incumbent detected and saved', {
      communityId,
      guildId,
      provider: result.provider,
      confidence: result.confidence,
      detectionMethod: result.detectionMethod,
    });

    return result.info;
  }

  // =========================================================================
  // Private Detection Methods
  // =========================================================================

  /**
   * Detect by known bot ID (highest confidence)
   */
  private detectByBotId(guild: Guild): DetectionResult {
    for (const [provider, config] of Object.entries(KNOWN_INCUMBENTS)) {
      for (const botId of config.botIds) {
        if (!botId) continue;

        const member = guild.members.cache.get(botId);
        if (member) {
          this.logger.info('Incumbent detected by bot ID', {
            guildId: guild.id,
            provider,
            botId,
          });

          return {
            detected: true,
            provider: provider as IncumbentProvider,
            confidence: CONFIDENCE.BOT_ID_MATCH,
            info: {
              provider: provider as IncumbentProvider,
              confidence: CONFIDENCE.BOT_ID_MATCH,
              bot: {
                id: member.id,
                username: member.user.username,
                joinedAt: member.joinedAt ?? new Date(),
              },
              channels: { verification: null, config: null },
              roles: [],
              capabilities: config.capabilities,
            },
            detectionMethod: 'bot_id',
          };
        }
      }
    }

    return {
      detected: false,
      provider: null,
      confidence: 0,
      info: null,
      detectionMethod: 'none',
    };
  }

  /**
   * Detect by bot username pattern
   */
  private detectByUsername(guild: Guild): DetectionResult {
    for (const [provider, config] of Object.entries(KNOWN_INCUMBENTS)) {
      const botMember = guild.members.cache.find(
        (m) =>
          m.user.bot &&
          config.usernamePatterns.some((p) =>
            m.user.username.toLowerCase().includes(p.toLowerCase())
          )
      );

      if (botMember) {
        this.logger.info('Incumbent detected by username', {
          guildId: guild.id,
          provider,
          username: botMember.user.username,
        });

        return {
          detected: true,
          provider: provider as IncumbentProvider,
          confidence: CONFIDENCE.USERNAME_MATCH,
          info: {
            provider: provider as IncumbentProvider,
            confidence: CONFIDENCE.USERNAME_MATCH,
            bot: {
              id: botMember.id,
              username: botMember.user.username,
              joinedAt: botMember.joinedAt ?? new Date(),
            },
            channels: { verification: null, config: null },
            roles: [],
            capabilities: config.capabilities,
          },
          detectionMethod: 'username',
        };
      }
    }

    return {
      detected: false,
      provider: null,
      confidence: 0,
      info: null,
      detectionMethod: 'none',
    };
  }

  /**
   * Detect by verification channel pattern
   */
  private detectByChannel(guild: Guild): DetectionResult {
    for (const [provider, config] of Object.entries(KNOWN_INCUMBENTS)) {
      const channel = guild.channels.cache.find((c) =>
        config.channelPatterns.some((p) =>
          c.name.toLowerCase().includes(p.toLowerCase())
        )
      );

      if (channel) {
        this.logger.info('Incumbent detected by channel', {
          guildId: guild.id,
          provider,
          channelName: channel.name,
        });

        return {
          detected: true,
          provider: provider as IncumbentProvider,
          confidence: CONFIDENCE.CHANNEL_MATCH,
          info: {
            provider: provider as IncumbentProvider,
            confidence: CONFIDENCE.CHANNEL_MATCH,
            bot: null,
            channels: { verification: channel.id, config: null },
            roles: [],
            capabilities: config.capabilities,
          },
          detectionMethod: 'channel',
        };
      }
    }

    return {
      detected: false,
      provider: null,
      confidence: 0,
      info: null,
      detectionMethod: 'none',
    };
  }

  /**
   * Detect generic suspect bots (verify/token in name)
   */
  private detectGenericSuspect(guild: Guild): DetectionResult {
    const suspectBot = guild.members.cache.find(
      (m) =>
        m.user.bot &&
        (m.user.username.toLowerCase().includes('verify') ||
          m.user.username.toLowerCase().includes('token') ||
          m.user.username.toLowerCase().includes('gate') ||
          m.user.username.toLowerCase().includes('holder'))
    );

    if (suspectBot) {
      this.logger.info('Generic suspect bot detected', {
        guildId: guild.id,
        username: suspectBot.user.username,
      });

      return {
        detected: true,
        provider: 'other',
        confidence: CONFIDENCE.GENERIC_SUSPECT,
        info: {
          provider: 'other',
          confidence: CONFIDENCE.GENERIC_SUSPECT,
          bot: {
            id: suspectBot.id,
            username: suspectBot.user.username,
            joinedAt: suspectBot.joinedAt ?? new Date(),
          },
          channels: { verification: null, config: null },
          roles: [],
          capabilities: {
            hasBalanceCheck: true,
            hasConvictionScoring: false,
            hasTierSystem: false,
            hasSocialLayer: false,
          },
        },
        detectionMethod: 'generic',
      };
    }

    return {
      detected: false,
      provider: null,
      confidence: 0,
      info: null,
      detectionMethod: 'none',
    };
  }

  /**
   * Analyze guild roles for token-gating likelihood
   */
  private analyzeRoles(guild: Guild, rolePatterns: string[]): DetectedRole[] {
    return guild.roles.cache
      .filter((r) => !r.managed && r.name !== '@everyone')
      .map((r) => {
        const matchesPattern = rolePatterns.some((p) =>
          r.name.toLowerCase().includes(p.toLowerCase())
        );

        return {
          id: r.id,
          name: r.name,
          memberCount: r.members.size,
          likelyTokenGated: matchesPattern,
          confidence: matchesPattern
            ? CONFIDENCE.ROLE_LIKELY_GATED
            : CONFIDENCE.ROLE_MAYBE_GATED,
        };
      })
      .sort((a, b) => b.confidence - a.confidence);
  }
}

/**
 * Factory function to create IncumbentDetector
 */
export function createIncumbentDetector(
  storage: ICoexistenceStorage,
  discordClient: Client,
  logger?: ILogger
): IncumbentDetector {
  return new IncumbentDetector(storage, discordClient, logger);
}

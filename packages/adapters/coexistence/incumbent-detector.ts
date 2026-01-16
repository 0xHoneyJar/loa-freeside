/**
 * IncumbentDetector
 *
 * Sprint S-24: Incumbent Detection & Shadow Ledger
 *
 * Auto-detects incumbent token-gating providers (Collab.Land, Matrica, Guild.xyz)
 * through bot ID matching, channel name patterns, and role name patterns.
 *
 * @see SDD §7.1.2 Incumbent Detection
 */

import type { Logger } from 'pino';
import type {
  IncumbentType,
  IncumbentInfo,
  Evidence,
  EvidenceType,
} from '@arrakis/core/domain';
import {
  KNOWN_INCUMBENT_BOTS,
  INCUMBENT_CHANNEL_PATTERNS,
  INCUMBENT_ROLE_PATTERNS,
  EVIDENCE_CONFIDENCE_WEIGHTS,
} from '@arrakis/core/domain';

// =============================================================================
// Types for Discord REST API
// =============================================================================

/**
 * Discord guild member with user info.
 */
export interface GuildMember {
  user: {
    id: string;
    username: string;
    bot?: boolean;
  };
  roles: string[];
}

/**
 * Discord channel.
 */
export interface GuildChannel {
  id: string;
  name: string;
  type: number;
}

/**
 * Discord role.
 */
export interface GuildRole {
  id: string;
  name: string;
  position: number;
  managed?: boolean;
}

/**
 * Discord REST service interface (minimal subset needed).
 */
export interface IDiscordRestService {
  getGuildMembers(
    guildId: string,
    options?: { limit?: number; after?: string }
  ): Promise<GuildMember[]>;
  getGuildChannels(guildId: string): Promise<GuildChannel[]>;
  getGuildRoles(guildId: string): Promise<GuildRole[]>;
}

// =============================================================================
// IncumbentDetector Implementation
// =============================================================================

/**
 * Options for incumbent detection.
 */
export interface DetectionOptions {
  /** Maximum members to fetch for bot detection */
  memberFetchLimit?: number;
  /** Skip channel pattern matching */
  skipChannelPatterns?: boolean;
  /** Skip role pattern matching */
  skipRolePatterns?: boolean;
  /** Minimum confidence threshold to report (0-1) */
  minConfidence?: number;
}

const DEFAULT_OPTIONS: Required<DetectionOptions> = {
  memberFetchLimit: 1000,
  skipChannelPatterns: false,
  skipRolePatterns: false,
  minConfidence: 0.3,
};

/**
 * Detects incumbent token-gating providers in a Discord guild.
 */
export class IncumbentDetector {
  private readonly discordRest: IDiscordRestService;
  private readonly log: Logger;

  constructor(discordRest: IDiscordRestService, logger: Logger) {
    this.discordRest = discordRest;
    this.log = logger.child({ component: 'IncumbentDetector' });
  }

  /**
   * Detect incumbent provider in a guild.
   *
   * Detection methods (in order of confidence):
   * 1. Bot ID matching (0.95 confidence) - Most reliable
   * 2. Channel name patterns (0.7 confidence) - Strong indicator
   * 3. Role name patterns (0.5 confidence) - Moderate indicator
   *
   * @param guildId - Discord guild ID
   * @param options - Detection options
   * @returns Incumbent info with confidence score
   */
  async detect(
    guildId: string,
    options: DetectionOptions = {}
  ): Promise<IncumbentInfo> {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    const evidence: Evidence[] = [];

    this.log.debug({ guildId }, 'Starting incumbent detection');

    // Step 1: Check for known bot IDs (highest confidence)
    const botEvidence = await this.detectByBotIds(guildId, opts.memberFetchLimit);
    evidence.push(...botEvidence);

    // Step 2: Check for verification channel patterns
    if (!opts.skipChannelPatterns) {
      const channelEvidence = await this.detectByChannelPatterns(guildId);
      evidence.push(...channelEvidence);
    }

    // Step 3: Check for token-gated role patterns
    if (!opts.skipRolePatterns) {
      const roleEvidence = await this.detectByRolePatterns(guildId);
      evidence.push(...roleEvidence);
    }

    // Aggregate evidence and calculate result
    const result = this.calculateResult(evidence, opts.minConfidence);

    this.log.info(
      {
        guildId,
        incumbentType: result.type,
        confidence: result.confidence.toFixed(3),
        evidenceCount: evidence.length,
      },
      'Incumbent detection complete'
    );

    return result;
  }

  /**
   * Detect incumbent by checking for known bot user IDs.
   */
  private async detectByBotIds(
    guildId: string,
    limit: number
  ): Promise<Evidence[]> {
    const evidence: Evidence[] = [];

    try {
      const members = await this.discordRest.getGuildMembers(guildId, { limit });
      const bots = members.filter((m) => m.user.bot);

      for (const bot of bots) {
        for (const [incumbentType, botIds] of Object.entries(KNOWN_INCUMBENT_BOTS)) {
          if (botIds.includes(bot.user.id)) {
            evidence.push({
              type: 'bot_id',
              value: `${incumbentType}:${bot.user.id}`,
              confidence: EVIDENCE_CONFIDENCE_WEIGHTS.bot_id,
            });

            this.log.debug(
              { guildId, botId: bot.user.id, incumbentType },
              'Found known incumbent bot'
            );
          }
        }
      }
    } catch (error) {
      this.log.warn({ guildId, error }, 'Failed to fetch guild members for bot detection');
    }

    return evidence;
  }

  /**
   * Detect incumbent by checking channel name patterns.
   */
  private async detectByChannelPatterns(guildId: string): Promise<Evidence[]> {
    const evidence: Evidence[] = [];

    try {
      const channels = await this.discordRest.getGuildChannels(guildId);

      for (const channel of channels) {
        for (const [incumbentType, pattern] of Object.entries(INCUMBENT_CHANNEL_PATTERNS)) {
          if (pattern.test(channel.name)) {
            evidence.push({
              type: 'channel_name',
              value: `${incumbentType}:${channel.name}`,
              confidence: EVIDENCE_CONFIDENCE_WEIGHTS.channel_name,
            });

            this.log.debug(
              { guildId, channelName: channel.name, incumbentType },
              'Found incumbent channel pattern'
            );
          }
        }
      }
    } catch (error) {
      this.log.warn({ guildId, error }, 'Failed to fetch guild channels for pattern detection');
    }

    return evidence;
  }

  /**
   * Detect incumbent by checking role name patterns.
   */
  private async detectByRolePatterns(guildId: string): Promise<Evidence[]> {
    const evidence: Evidence[] = [];

    try {
      const roles = await this.discordRest.getGuildRoles(guildId);

      for (const role of roles) {
        // Skip managed roles (bot-managed, integration roles)
        if (role.managed) continue;

        for (const [incumbentType, pattern] of Object.entries(INCUMBENT_ROLE_PATTERNS)) {
          if (pattern.test(role.name)) {
            evidence.push({
              type: 'role_name',
              value: `${incumbentType}:${role.name}`,
              confidence: EVIDENCE_CONFIDENCE_WEIGHTS.role_name,
            });

            this.log.debug(
              { guildId, roleName: role.name, incumbentType },
              'Found incumbent role pattern'
            );
          }
        }
      }
    } catch (error) {
      this.log.warn({ guildId, error }, 'Failed to fetch guild roles for pattern detection');
    }

    return evidence;
  }

  /**
   * Calculate the final detection result from evidence.
   *
   * Aggregation strategy:
   * 1. Sum confidence scores by incumbent type
   * 2. Select type with highest aggregate score
   * 3. Normalize confidence to 0-1 (3 strong evidences = 100%)
   */
  private calculateResult(
    evidence: Evidence[],
    minConfidence: number
  ): IncumbentInfo {
    if (evidence.length === 0) {
      return { type: 'none', confidence: 0, evidence: [] };
    }

    // Aggregate scores by incumbent type
    const typeScores = this.aggregateEvidenceByType(evidence);

    // Find the type with highest score
    const topResult = this.findTopType(typeScores);

    // Filter evidence for the winning type
    const relevantEvidence = evidence.filter((e) =>
      e.value.startsWith(`${topResult.type}:`)
    );

    // Check minimum confidence threshold
    if (topResult.confidence < minConfidence) {
      return { type: 'none', confidence: topResult.confidence, evidence };
    }

    return {
      type: topResult.type as IncumbentType,
      confidence: topResult.confidence,
      evidence: relevantEvidence,
    };
  }

  /**
   * Aggregate evidence confidence by incumbent type.
   */
  private aggregateEvidenceByType(evidence: Evidence[]): Map<string, number> {
    const scores = new Map<string, number>();

    for (const e of evidence) {
      const type = e.value.split(':')[0];
      if (!type) continue;

      const current = scores.get(type) ?? 0;
      scores.set(type, current + e.confidence);
    }

    return scores;
  }

  /**
   * Find the incumbent type with highest confidence score.
   */
  private findTopType(
    scores: Map<string, number>
  ): { type: string; confidence: number } {
    let topType = 'none';
    let topScore = 0;

    scores.forEach((score, type) => {
      if (score > topScore) {
        topType = type;
        topScore = score;
      }
    });

    // Normalize confidence to 0-1
    // 3 strong evidences (bot_id at 0.95 each) = ~2.85 = 100%
    const normalizedConfidence = Math.min(topScore / 3, 1);

    return { type: topType, confidence: normalizedConfidence };
  }

  /**
   * Get detection summary as a formatted string.
   */
  formatSummary(info: IncumbentInfo): string {
    if (info.type === 'none') {
      return 'No incumbent token-gating provider detected.';
    }

    const typeNames: Record<IncumbentType, string> = {
      collabland: 'Collab.Land',
      matrica: 'Matrica',
      guild_xyz: 'Guild.xyz',
      other: 'Unknown Provider',
      none: 'None',
    };

    const confidenceLevel =
      info.confidence >= 0.8 ? 'High' :
      info.confidence >= 0.5 ? 'Medium' : 'Low';

    return `Detected: ${typeNames[info.type]} (${confidenceLevel} confidence: ${(info.confidence * 100).toFixed(1)}%)`;
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create an IncumbentDetector instance.
 */
export function createIncumbentDetector(
  discordRest: IDiscordRestService,
  logger: Logger
): IncumbentDetector {
  return new IncumbentDetector(discordRest, logger);
}

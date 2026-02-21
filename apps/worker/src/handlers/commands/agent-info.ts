/**
 * /agent-info Command Handler (Sprint 4, Task 4.9)
 *
 * Displays personality summary for an NFT agent.
 * Available to any server member (not gated to holder).
 * Anti-narration safe — no forbidden identity terms.
 *
 * Flow:
 * 1. Parse optional tokenId from options
 * 2. If no tokenId: show caller's own agent (if they have one)
 * 3. Look up profile by wallet, resolve tier
 * 4. Map tier → access level → pool info
 * 5. Display personality summary embed
 *
 * @see SDD §4.1 Thread Management
 * @see PRD FR-3.3 /agent-info command
 */

import type { Logger } from 'pino';
import type { DiscordEventPayload, ConsumeResult } from '../../types.js';
import type { DiscordRestService } from '../../services/DiscordRest.js';
import {
  getCommunityByGuildId,
  getProfileByDiscordId,
} from '../../data/index.js';
import { createEmbed, createErrorEmbed, Colors } from '../../embeds/common.js';
import { DEFAULT_TIER_MAP } from '../../../../../packages/adapters/agent/tier-access-mapper.js';
import { ACCESS_LEVEL_POOLS } from '../../../../../packages/adapters/agent/pool-mapping.js';

// --------------------------------------------------------------------------
// Anti-Narration
// --------------------------------------------------------------------------

/**
 * Terms forbidden in agent personality descriptions.
 * Prevents agents from claiming sentience, consciousness, or identity.
 */
const ANTI_NARRATION_TERMS = [
  'sentient', 'conscious', 'alive', 'feelings', 'emotions',
  'self-aware', 'soul', 'spirit', 'being', 'person',
  'i am', 'i feel', 'i think', 'i believe', 'i want',
];

/**
 * Parse a raw tier value to an integer, returning 0 for non-integer values.
 */
function parseTier(raw: unknown): number {
  const parsed = typeof raw === 'number' ? raw : Number(raw);
  return Number.isInteger(parsed) ? parsed : 0;
}

/**
 * Sanitize text by removing anti-narration terms.
 * Returns cleaned text safe for display.
 */
function sanitizeAntiNarration(text: string): string {
  let sanitized = text;
  for (const term of ANTI_NARRATION_TERMS) {
    const regex = new RegExp(`\\b${term}\\b`, 'gi');
    sanitized = sanitized.replace(regex, '***');
  }
  return sanitized;
}

// --------------------------------------------------------------------------
// Tier Display
// --------------------------------------------------------------------------

/** Friendly names for access levels */
const ACCESS_LEVEL_LABELS: Record<string, string> = {
  free: 'Explorer',
  pro: 'Adept',
  enterprise: 'Architect',
};

/** Emphasis keywords per access level (personality flavor) */
const ACCESS_LEVEL_EMPHASIS: Record<string, string[]> = {
  free: ['efficient', 'concise', 'practical'],
  pro: ['analytical', 'thorough', 'creative'],
  enterprise: ['strategic', 'comprehensive', 'visionary'],
};

/** Pool display names */
const POOL_DISPLAY: Record<string, string> = {
  cheap: 'Quick Response',
  'fast-code': 'Code Specialist',
  reviewer: 'Analysis',
  reasoning: 'Deep Reasoning',
  architect: 'Architect',
};

// --------------------------------------------------------------------------
// Handler
// --------------------------------------------------------------------------

/**
 * Handle /agent-info [tokenId] — display personality summary
 */
export function createAgentInfoHandler(discord: DiscordRestService) {
  return async function handleAgentInfo(
    payload: DiscordEventPayload,
    logger: Logger,
  ): Promise<ConsumeResult> {
    const { interactionId, interactionToken, guildId, userId } = payload;

    if (!interactionId || !interactionToken) {
      logger.error({ eventId: payload.eventId }, 'Missing interaction credentials');
      return 'ack';
    }

    if (!guildId) {
      logger.error({ eventId: payload.eventId }, 'Missing guild ID');
      return 'ack';
    }

    const log = logger.child({ command: 'agent-info', userId, guildId });

    try {
      // Defer reply (ephemeral)
      await discord.deferReply(interactionId, interactionToken, true);

      // Get community
      const community = await getCommunityByGuildId(guildId);
      if (!community) {
        await discord.editOriginal(interactionToken, {
          embeds: [createErrorEmbed('This server is not configured for agent access.')],
        });
        return 'ack';
      }

      // Parse optional tokenId from options
      const data = payload.data;
      const options = (data?.['options'] as Array<{ name: string; value: string }>) ?? [];
      const tokenIdOption = options.find((o) => o.name === 'token-id');

      let targetUserId = userId;
      let tier: number;

      if (tokenIdOption?.value) {
        // Look up by tokenId — for now, tokenId is wallet:communityId composite
        // Display generic info based on tier from the tokenId lookup
        // Since tokenId maps to a wallet, resolve the profile
        const { getProfileByWallet } = await import('../../data/database.js');
        const profile = await getProfileByWallet(community.id, tokenIdOption.value);

        if (!profile) {
          await discord.editOriginal(interactionToken, {
            embeds: [createErrorEmbed('No agent found for that token ID.')],
          });
          return 'ack';
        }

        tier = parseTier(profile.tier ?? 0);
      } else {
        // No tokenId — show caller's own info
        if (!userId) {
          await discord.editOriginal(interactionToken, {
            embeds: [createErrorEmbed('Could not identify you. Try again.')],
          });
          return 'ack';
        }

        const profile = await getProfileByDiscordId(community.id, userId);
        if (!profile || !profile.walletAddress) {
          await discord.editOriginal(interactionToken, {
            embeds: [createErrorEmbed(
              'No linked wallet found. Complete onboarding to see your agent info.',
            )],
          });
          return 'ack';
        }

        tier = parseTier(profile.tier ?? 0);
        targetUserId = userId;
      }

      if (tier < 1) {
        await discord.editOriginal(interactionToken, {
          embeds: [createErrorEmbed(
            'No active NFT detected. Hold the community NFT to unlock agent access.',
          )],
        });
        return 'ack';
      }

      // Resolve tier → access level → pool info
      const mapping = DEFAULT_TIER_MAP.defaults[tier];
      if (!mapping) {
        await discord.editOriginal(interactionToken, {
          embeds: [createErrorEmbed('Unable to resolve agent configuration for this tier.')],
        });
        return 'ack';
      }

      const { accessLevel } = mapping;
      const poolConfig = ACCESS_LEVEL_POOLS[accessLevel];
      if (!poolConfig) {
        await discord.editOriginal(interactionToken, {
          embeds: [createErrorEmbed('Unable to resolve pool configuration for this access level.')],
        });
        return 'ack';
      }
      const agentName = sanitizeAntiNarration(`Tier ${tier} Agent`);
      const accessLabel = ACCESS_LEVEL_LABELS[accessLevel] ?? accessLevel;
      const emphasis = ACCESS_LEVEL_EMPHASIS[accessLevel] ?? [];
      const availablePools = poolConfig.allowed ?? [];
      const safeAliases = Array.isArray(mapping.aliases)
        ? mapping.aliases.map((a) => sanitizeAntiNarration(String(a)))
        : [];

      // Build embed
      const poolList = availablePools
        .map((p) => POOL_DISPLAY[p] ?? p)
        .join(', ');

      const emphasisDisplay = emphasis.length > 0
        ? emphasis.join(' | ')
        : 'Standard';

      const embed = createEmbed({
        title: `Agent Profile: ${agentName}`,
        description: `Personality summary for conviction tier **${tier}**`,
        color: tier >= 7 ? Colors.GOLD : tier >= 4 ? Colors.PURPLE : Colors.BLUE,
        fields: [
          { name: 'Conviction Tier', value: `${tier}`, inline: true },
          { name: 'Access Level', value: accessLabel, inline: true },
          { name: 'Default Pool', value: POOL_DISPLAY[poolConfig?.default] ?? poolConfig?.default ?? 'Standard', inline: true },
          { name: 'Available Capabilities', value: poolList || 'Quick Response', inline: false },
          { name: 'Emphasis', value: emphasisDisplay, inline: false },
          { name: 'Model Aliases', value: safeAliases.join(', ') || 'Standard', inline: false },
        ],
        footer: 'Agent capabilities are determined by NFT conviction tier',
      });

      await discord.editOriginal(interactionToken, { embeds: [embed] });

      log.info({ tier, accessLevel, targetUserId }, 'Agent info displayed');
      return 'ack';
    } catch (error) {
      log.error({ error }, 'Error handling /agent-info command');
      if (interactionToken) {
        await discord.editOriginal(interactionToken, {
          embeds: [createErrorEmbed('An error occurred while fetching agent info. Please try again.')],
        }).catch(() => {});
      }
      return 'ack';
    }
  };
}

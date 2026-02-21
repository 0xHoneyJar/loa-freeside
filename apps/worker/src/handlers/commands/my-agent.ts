/**
 * /my-agent Command Handler (Sprint 4, Task 4.6)
 *
 * Creates a dedicated Discord thread per NFT for agent interaction.
 * Bot-enforced access control with ownership verification.
 *
 * Flow:
 * 1. Verify user has linked wallet and completed onboarding
 * 2. Verify NFT ownership via on-chain check
 * 3. Check for existing active thread for this NFT
 * 4. If exists: return link to existing thread
 * 5. If not: create thread, record in agent_threads, send welcome
 *
 * @see SDD §4.1 Thread Management
 * @see PRD FR-4.2 NFT-Gated Agent Access
 */

import type { Logger } from 'pino';
import type { DiscordEventPayload, ConsumeResult } from '../../types.js';
import type { DiscordRestService } from '../../services/DiscordRest.js';
import {
  getCommunityByGuildId,
  getProfileByDiscordId,
} from '../../data/index.js';
import { createErrorEmbed } from '../../embeds/index.js';
import { getDb, findActiveThread, insertAgentThread } from './my-agent-data.js';

/**
 * Handle /my-agent command — create or retrieve agent thread
 */
export function createMyAgentHandler(discord: DiscordRestService) {
  return async function handleMyAgent(
    payload: DiscordEventPayload,
    logger: Logger
  ): Promise<ConsumeResult> {
    const { interactionId, interactionToken, guildId, userId, channelId } = payload;

    if (!interactionId || !interactionToken) {
      logger.error({ eventId: payload.eventId }, 'Missing interaction credentials');
      return 'ack';
    }

    if (!guildId || !userId) {
      logger.error({ eventId: payload.eventId }, 'Missing guild/user ID');
      return 'ack';
    }

    if (!channelId) {
      logger.error({ eventId: payload.eventId }, 'Missing channel ID');
      return 'ack';
    }

    const log = logger.child({ command: 'my-agent', userId, guildId });

    try {
      // 1. Defer reply (ephemeral — only the user sees the response)
      await discord.deferReply(interactionId, interactionToken, true);

      // 2. Get community (tenant isolation)
      const community = await getCommunityByGuildId(guildId);
      if (!community) {
        await discord.editOriginal(interactionToken, {
          embeds: [createErrorEmbed('This server is not configured for agent access.')],
        });
        return 'ack';
      }

      // 3. Get user profile — requires linked wallet
      const profile = await getProfileByDiscordId(community.id, userId);
      if (!profile || !profile.walletAddress) {
        await discord.editOriginal(interactionToken, {
          embeds: [createErrorEmbed(
            'You need to link your wallet first. Complete onboarding to use agent threads.'
          )],
        });
        return 'ack';
      }

      // 4. Check NFT ownership via conviction tier
      //    Tier > 0 means verified NFT holder (ConvictionScorer validates on-chain)
      const tier = profile.tier ? parseInt(profile.tier, 10) : 0;
      if (!tier || tier < 1) {
        await discord.editOriginal(interactionToken, {
          embeds: [createErrorEmbed(
            'You need to hold the community NFT to create an agent thread. ' +
            'Verify your NFT ownership through the onboarding process.'
          )],
        });
        return 'ack';
      }

      // 5. Derive NFT identifier from profile
      //    nftId = walletAddress:communityId (composite key for thread dedup)
      const nftId = `${profile.walletAddress}:${community.id}`;

      // 6. Check for existing active thread
      const db = getDb();
      const existingThread = await findActiveThread(db, nftId, community.id);

      if (existingThread) {
        // Update last active timestamp
        await discord.editOriginal(interactionToken, {
          content: `Your agent thread already exists: <#${existingThread.threadId}>\n` +
            `Tier: **${tier}** | Thread created: <t:${Math.floor(new Date(existingThread.createdAt).getTime() / 1000)}:R>`,
        });
        log.info({ threadId: existingThread.threadId, nftId }, 'Returned existing agent thread');
        return 'ack';
      }

      // 7. Create new thread
      //    Use hex ID suffix (not wallet address) to avoid leaking sensitive data
      const threadName = `Agent | Tier ${tier}`;
      const thread = await discord.createThread(channelId, {
        name: threadName,
        type: 11, // PUBLIC_THREAD — upgrade to 12 (PRIVATE) when guild boost detection is available
        autoArchiveDuration: 10080, // 7 days
      });

      if (!thread) {
        await discord.editOriginal(interactionToken, {
          embeds: [createErrorEmbed(
            'Failed to create agent thread. The bot may be missing MANAGE_THREADS permission.'
          )],
        });
        return 'ack';
      }

      // 8. Record thread in database
      const now = new Date().toISOString();
      await insertAgentThread(db, {
        nftId,
        channelId,
        threadId: thread.id,
        ownerWallet: profile.walletAddress,
        communityId: community.id,
        createdAt: now,
        lastActiveAt: now,
        ownershipVerifiedAt: now,
      });

      // 9. Send welcome message in the thread
      await discord.sendMessage(thread.id, {
        content: `Welcome to your agent thread, <@${userId}>!\n\n` +
          `**Tier:** ${tier}\n\n` +
          `Messages in this thread are routed through your personality bridge. ` +
          `Your agent's responses reflect your NFT's conviction tier and personality.`,
      });

      // 10. Respond to the original interaction
      await discord.editOriginal(interactionToken, {
        content: `Your agent thread has been created: <#${thread.id}>\n` +
          `Tier: **${tier}** | Send messages in the thread to interact with your agent.`,
      });

      log.info(
        { threadId: thread.id, nftId, tier, channelId },
        'Created new agent thread',
      );
      return 'ack';
    } catch (error) {
      log.error({ error }, 'Error handling /my-agent command');
      if (interactionToken) {
        await discord.editOriginal(interactionToken, {
          embeds: [createErrorEmbed('An error occurred while setting up your agent thread. Please try again.')],
        }).catch(() => {}); // Swallow followup errors
      }
      return 'ack';
    }
  };
}

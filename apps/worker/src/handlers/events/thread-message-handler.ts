/**
 * Thread Message Handler (Sprint 4, Task 4.7)
 *
 * Routes messages in agent threads through the personality bridge:
 * message.create → thread lookup → ownership verify → AgentGateway.stream() → Discord response
 *
 * Ownership verification is cached 60s in Redis per AC.
 * Streamed responses are buffered into 2000-char Discord messages.
 *
 * @see SDD §4.1 Thread Management
 * @see PRD FR-4.2 NFT-Gated Agent Access
 */

import type { Logger } from 'pino';
import type { Redis } from 'ioredis';
import type { IAgentGateway, AgentRequestContext, AccessLevel, ModelAlias } from '@arrakis/core/ports';
import type { GatewayEventPayload } from '@arrakis/nats-schemas';
import type { DiscordRestService } from '../../services/DiscordRest.js';
import type { NatsEventHandler } from '../../consumers/EventNatsConsumer.js';
import {
  getCommunityByGuildId,
  getProfileByDiscordId,
} from '../../data/index.js';
import { getDb, findThreadByThreadId, updateThreadLastActive } from '../commands/my-agent-data.js';
import { TierAccessMapper } from '../../../../../packages/adapters/agent/tier-access-mapper.js';
import { resolvePoolId } from '../../../../../packages/adapters/agent/pool-mapping.js';
import { randomUUID } from 'node:crypto';
import { normalizeWallet } from '../../utils/normalize-wallet.js';

// --------------------------------------------------------------------------
// Constants
// --------------------------------------------------------------------------

/** Maximum Discord message length */
const DISCORD_MAX_LENGTH = 2000;

/** Ownership verification cache TTL (seconds) */
const OWNERSHIP_CACHE_TTL_S = 60;

/** Redis key prefix for ownership verification cache */
const OWNERSHIP_CACHE_PREFIX = 'agent:ownership:verified:';

// --------------------------------------------------------------------------
// Types
// --------------------------------------------------------------------------

export interface ThreadMessageHandlerDeps {
  gateway: IAgentGateway;
  discord: DiscordRestService;
  redis: Redis;
  logger: Logger;
}

interface OwnershipResult {
  verified: boolean;
  walletAddress?: string;
  tier?: number;
  accessLevel?: AccessLevel;
  allowedModels?: ModelAlias[];
  communityId?: string;
  nftId?: string;
}

// --------------------------------------------------------------------------
// Ownership Verification (cached 60s in Redis)
// --------------------------------------------------------------------------

async function verifyOwnership(
  redis: Redis,
  threadId: string,
  userId: string,
  guildId: string,
  ownerWallet: string,
  communityId: string,
  log: Logger,
): Promise<OwnershipResult> {
  const normalizedOwnerWallet = normalizeWallet(ownerWallet);
  const cacheKey = `${OWNERSHIP_CACHE_PREFIX}${threadId}:${userId}:${communityId}:${normalizedOwnerWallet}`;

  // Check cache first
  try {
    const cached = await redis.get(cacheKey);
    if (cached) {
      const parsed = JSON.parse(cached) as OwnershipResult;
      log.debug({ threadId, userId, cached: true }, 'Ownership cache hit');
      return parsed;
    }
  } catch {
    // Cache miss or parse error — proceed to verify
  }

  // Verify via database
  const profile = await getProfileByDiscordId(communityId, userId);

  if (!profile || !profile.walletAddress) {
    return { verified: false };
  }

  // Check wallet matches thread owner (Sprint 321, high-4: consistent normalization)
  if (normalizeWallet(profile.walletAddress) !== normalizedOwnerWallet) {
    return { verified: false };
  }

  // Check tier
  const tier = profile.tier ? parseInt(profile.tier, 10) : 0;
  if (!tier || tier < 1) {
    return { verified: false };
  }

  // Resolve access level and allowed models
  const mapper = new TierAccessMapper();
  const access = await mapper.resolveAccess(tier);
  const allowedModels = mapper.getDefaultModels(tier);

  // Bridge iter2 (iter2-3): Normalize wallet in nftId construction for consistent matching
  const nftId = `${normalizeWallet(profile.walletAddress)}:${communityId}`;

  const result: OwnershipResult = {
    verified: true,
    walletAddress: profile.walletAddress,
    tier,
    accessLevel: access.accessLevel,
    allowedModels,
    communityId,
    nftId,
  };

  // Cache the result
  try {
    await redis.set(cacheKey, JSON.stringify(result), 'EX', OWNERSHIP_CACHE_TTL_S);
  } catch (err) {
    log.warn({ err }, 'Failed to cache ownership verification');
  }

  return result;
}

// --------------------------------------------------------------------------
// Discord Response Streaming
// --------------------------------------------------------------------------

/**
 * Stream AgentGateway response into Discord messages.
 * Buffers content chunks into 2000-char messages to respect Discord limits.
 */
async function streamToDiscord(
  gateway: IAgentGateway,
  request: import('@arrakis/core/ports').AgentInvokeRequest,
  discord: DiscordRestService,
  threadId: string,
  log: Logger,
): Promise<void> {
  let buffer = '';
  let sendingDisabled = false;
  let userNotified = false;

  // Must consume the entire stream to allow AgentGateway to finalize budget/usage.
  // Never return early — use sendingDisabled to skip Discord sends on failure.
  for await (const event of gateway.stream(request)) {
    if (event.type === 'content') {
      if (sendingDisabled) {
        continue;
      }
      buffer += event.data.text;

      // Flush when buffer approaches Discord limit
      while (buffer.length >= DISCORD_MAX_LENGTH) {
        const chunk = buffer.slice(0, DISCORD_MAX_LENGTH);
        buffer = buffer.slice(DISCORD_MAX_LENGTH);

        const result = await discord.sendMessage(threadId, { content: chunk });
        if (!result.success) {
          log.error({ threadId, error: result.error }, 'Failed to send streamed chunk');
          sendingDisabled = true;
          break;
        }
      }
    } else if (event.type === 'error') {
      log.error(
        { threadId, code: event.data.code, message: event.data.message },
        'Agent stream error',
      );
      if (!sendingDisabled && !userNotified) {
        await discord.sendMessage(threadId, {
          content: 'An error occurred while processing your message. Please try again.',
        }).catch(() => {});
        userNotified = true;
      }
      // Continue consuming stream for budget finalization
    }
    // 'usage' and 'done' events are handled by AgentGateway internally
  }

  // Flush remaining buffer if sending is still enabled
  if (!sendingDisabled && buffer.length > 0) {
    const result = await discord.sendMessage(threadId, { content: buffer });
    if (!result.success) {
      log.error({ threadId, error: result.error }, 'Failed to send final chunk');
    }
  }
}

// --------------------------------------------------------------------------
// Handler Factory
// --------------------------------------------------------------------------

/**
 * Create the message.create NATS event handler for agent thread routing.
 *
 * This handler:
 * 1. Ignores bot messages
 * 2. Looks up agent thread by channel_id (threads are channels in Discord)
 * 3. Verifies ownership (cached 60s)
 * 4. Routes through AgentGateway.stream() with full request context
 * 5. Streams response back to Discord with 2000-char buffering
 * 6. Updates thread lastActiveAt
 */
export function createThreadMessageHandler(
  deps: ThreadMessageHandlerDeps,
): NatsEventHandler {
  const { gateway, discord, redis } = deps;
  const log = deps.logger.child({ handler: 'thread-message' });

  return async function handleMessageCreate(
    payload: GatewayEventPayload,
    logger: Logger,
  ): Promise<void> {
    const { channel_id, user_id, guild_id, data } = payload;

    // Ignore messages without required fields
    if (!channel_id || !user_id || !guild_id) {
      return;
    }

    // Ignore bot messages
    const author = (data as Record<string, unknown>)?.['author'] as
      | { id?: string; bot?: boolean }
      | undefined;
    if (author?.bot) {
      return;
    }

    // Extract message content
    const content = (data as Record<string, unknown>)?.['content'] as string | undefined;
    if (!content || content.trim().length === 0) {
      return;
    }

    // Look up agent thread by Discord channel/thread ID
    const db = getDb();
    const thread = await findThreadByThreadId(db, channel_id);

    if (!thread) {
      // Not an agent thread — ignore silently
      return;
    }

    const msgLog = logger.child({
      handler: 'thread-message',
      threadId: channel_id,
      userId: user_id,
      communityId: thread.communityId,
    });

    // Verify ownership (cached 60s)
    const ownership = await verifyOwnership(
      redis,
      channel_id,
      user_id,
      guild_id,
      thread.ownerWallet,
      thread.communityId,
      msgLog,
    );

    if (!ownership.verified) {
      msgLog.debug('Non-owner message in agent thread — ignoring');
      return;
    }

    msgLog.info({ tier: ownership.tier, nftId: ownership.nftId }, 'Routing thread message through personality bridge');

    // Build AgentRequestContext
    const { poolId, allowedPools } = resolvePoolId(undefined, ownership.accessLevel!);
    const traceId = randomUUID();

    const context: AgentRequestContext = {
      tenantId: ownership.communityId!,
      userId: ownership.walletAddress!,
      nftId: ownership.nftId!,
      tier: ownership.tier!,
      accessLevel: ownership.accessLevel!,
      allowedModelAliases: ownership.allowedModels!,
      platform: 'discord',
      channelId: channel_id,
      idempotencyKey: `thread:${channel_id}:${payload.event_id}`,
      traceId,
      poolId,
      allowedPools,
    };

    // Stream response through personality bridge
    try {
      await streamToDiscord(
        gateway,
        {
          context,
          agent: 'personality-bridge',
          messages: [{ role: 'user', content }],
        },
        discord,
        channel_id,
        msgLog,
      );

      // Update thread activity timestamp
      await updateThreadLastActive(db, channel_id).catch((err) => {
        msgLog.warn({ err }, 'Failed to update thread lastActiveAt');
      });

      msgLog.info({ traceId }, 'Thread message processed successfully');
    } catch (err) {
      msgLog.error({ err, traceId }, 'Failed to route thread message');

      // Send user-friendly error
      await discord.sendMessage(channel_id, {
        content: 'Sorry, I encountered an error processing your message. Please try again.',
      }).catch((discordErr) => {
        msgLog.warn({ discordErr, channel_id }, 'Failed to send error notification to Discord');
      });
    }
  };
}

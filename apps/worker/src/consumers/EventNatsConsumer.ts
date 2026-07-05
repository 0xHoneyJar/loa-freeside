/**
 * NATS Event Consumer for Arrakis Workers
 * Sprint S-5: NATS JetStream Deployment
 * Sprint S-6: Worker Migration to NATS
 *
 * Consumes guild/member events from NATS per SDD §5.2
 * Integrates with database for community/member lifecycle
 */

import { z } from 'zod';
import type { JsMsg } from 'nats';
import type { Logger } from 'pino';
import { BaseNatsConsumer, BaseConsumerConfig, ProcessResult } from './BaseNatsConsumer.js';
import type { DiscordEventPayload } from '../types.js';
import {
  getEventHandler,
  defaultEventHandler,
  type HandlerFn,
} from '../handlers/index.js';
import {
  upsertCommunity,
  markCommunityInactive,
  upsertProfile,
  markProfileInactive,
  getCommunityByGuildId,
} from '../data/database.js';
import type { DiscordRestService } from '../services/DiscordRest.js';

// --------------------------------------------------------------------------
// Types — imported from shared NATS schema contract
// --------------------------------------------------------------------------

import {
  GatewayEventSchema,
  type GatewayEvent,
  type GatewayEventPayload,
  NATS_ROUTING,
} from '@freeside/nats-schemas';

export type { GatewayEventPayload };

/**
 * Event handler signature (NATS-native)
 */
export type NatsEventHandler = (
  payload: GatewayEventPayload,
  logger: Logger
) => Promise<void>;

/**
 * Convert NATS GatewayEventPayload to legacy DiscordEventPayload
 * This bridges the new Rust gateway format to existing handlers
 */
function toDiscordEventPayload(payload: GatewayEventPayload): DiscordEventPayload {
  return {
    eventId: payload.event_id,
    eventType: payload.event_type,
    timestamp: payload.timestamp,
    shardId: payload.shard_id,
    guildId: payload.guild_id ?? undefined,
    channelId: payload.channel_id ?? undefined,
    userId: payload.user_id ?? undefined,
    data: payload.data as Record<string, unknown> | undefined,
  };
}

/** Narrow the opaque `data` field (z.unknown()) to a record for property access */
function eventData(payload: GatewayEventPayload): Record<string, unknown> {
  return (payload.data ?? {}) as Record<string, unknown>;
}

// --------------------------------------------------------------------------
// Event Consumer
// --------------------------------------------------------------------------

export class EventNatsConsumer extends BaseNatsConsumer<GatewayEventPayload> {
  private readonly natsHandlers: Map<string, NatsEventHandler>;
  private readonly legacyHandlers: Map<string, HandlerFn>;

  constructor(
    config: BaseConsumerConfig,
    natsHandlers: Map<string, NatsEventHandler>,
    legacyHandlers: Map<string, HandlerFn>,
    logger: Logger
  ) {
    super(config, logger);
    this.natsHandlers = natsHandlers;
    this.legacyHandlers = legacyHandlers;
  }

  /**
   * Process a guild/member event
   * Tries NATS-native handlers first, then legacy handlers
   */
  async processMessage(
    payload: GatewayEventPayload,
    _msg: JsMsg
  ): Promise<ProcessResult> {
    // Validate at the NATS trust boundary
    const parsed = GatewayEventSchema.safeParse(payload);
    if (!parsed.success) {
      this.log.error(
        { issues: parsed.error.issues },
        'Invalid GatewayEventPayload from NATS'
      );
      return { success: false, retryable: false, error: new Error('Invalid GatewayEventPayload') };
    }

    const safePayload = parsed.data as GatewayEventPayload;
    const { event_id, event_type, guild_id, user_id } = safePayload;

    this.log.debug(
      { eventId: event_id, eventType: event_type, guildId: guild_id, userId: user_id },
      'Processing event'
    );

    // Try NATS-native handler first
    const natsHandler = this.natsHandlers.get(event_type);
    if (natsHandler) {
      try {
        await natsHandler(safePayload, this.log);
        this.log.debug({ eventId: event_id, eventType: event_type }, 'Event processed (NATS handler)');
        return { success: true };
      } catch (error) {
        this.log.error({ eventId: event_id, eventType: event_type, error }, 'NATS handler error');
        return { success: false, retryable: true, error: error instanceof Error ? error : new Error(String(error)) };
      }
    }

    // Try legacy handler with payload conversion
    const legacyHandler = this.legacyHandlers.get(event_type) ?? getEventHandler(event_type);
    if (legacyHandler) {
      const legacyPayload = toDiscordEventPayload(safePayload);
      try {
        const result = await legacyHandler(legacyPayload, this.log);
        this.log.debug({ eventId: event_id, eventType: event_type, result }, 'Event processed (legacy handler)');

        switch (result) {
          case 'ack':
            return { success: true };
          case 'nack':
            return { success: false, retryable: false };
          case 'nack-requeue':
            return { success: false, retryable: true };
          default:
            return { success: true };
        }
      } catch (error) {
        this.log.error({ eventId: event_id, eventType: event_type, error }, 'Legacy handler error');
        return { success: false, retryable: true, error: error instanceof Error ? error : new Error(String(error)) };
      }
    }

    // Use default handler as fallback
    const legacyPayload = toDiscordEventPayload(safePayload);
    try {
      await defaultEventHandler(legacyPayload, this.log);
      this.log.debug({ eventId: event_id, eventType: event_type }, 'Event processed (default handler)');
      return { success: true };
    } catch (error) {
      this.log.error(
        { eventId: event_id, eventType: event_type, error },
        'Default handler error'
      );
      return {
        success: false,
        retryable: true,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  }
}

// --------------------------------------------------------------------------
// Handler-local Zod sub-schemas
// --------------------------------------------------------------------------

const GuildJoinDataSchema = z.object({ name: z.string().min(1) });
const GuildLeaveDataSchema = z.object({});
const MemberJoinDataSchema = z.object({ username: z.string().optional() });
const MemberLeaveDataSchema = z.object({});
const MemberUpdateDataSchema = z.object({
  roles: z.array(z.string()).optional(),
  nick: z.string().nullable().optional(),
  tier: z.string().optional(),
});

// --------------------------------------------------------------------------
// Handler factories (closures over injected dependencies)
// --------------------------------------------------------------------------

function makeGuildJoinHandler(discordRest?: DiscordRestService) {
  return async function handleGuildJoin(
    payload: GatewayEventPayload,
    log: Logger
  ): Promise<void> {
    const { event_type, guild_id } = payload;

    if (!guild_id) {
      log.error({ eventType: event_type, guildId: null, reason: 'missing guild_id' }, 'guildJoin rejected');
      return;
    }

    const parsed = GuildJoinDataSchema.safeParse(eventData(payload));
    if (!parsed.success) {
      log.error({ eventType: event_type, guildId: guild_id, reason: parsed.error.message }, 'guildJoin data invalid');
      return;
    }

    const { community, outcome } = await upsertCommunity({
      discordGuildId: guild_id,
      name: parsed.data.name,
    });

    if (outcome === 'created' && discordRest) {
      const data = eventData(payload);
      const systemChannelId = data['system_channel_id'] as string | undefined;
      if (systemChannelId) {
        await discordRest.sendMessage(systemChannelId, {
          content: 'Thanks for adding the bot! Use `/setup` to configure your community.',
        });
      }
    }

    log.info({ event: 'guildJoin', guildId: guild_id, communityId: community.id, outcome });
  };
}

function makeGuildLeaveHandler() {
  return async function handleGuildLeave(
    payload: GatewayEventPayload,
    log: Logger
  ): Promise<void> {
    const { event_type, guild_id } = payload;

    if (!guild_id) {
      log.error({ eventType: event_type, guildId: null, reason: 'missing guild_id' }, 'guildLeave rejected');
      return;
    }

    const { outcome } = await markCommunityInactive({ discordGuildId: guild_id });

    if (outcome === 'unknown_guild') {
      log.warn({ event: 'guildLeave', guildId: guild_id, outcome });
    } else {
      log.info({ event: 'guildLeave', guildId: guild_id, outcome });
    }
  };
}

function makeMemberJoinHandler() {
  return async function handleMemberJoin(
    payload: GatewayEventPayload,
    log: Logger
  ): Promise<void> {
    const { event_type, guild_id, user_id } = payload;

    if (!guild_id || !user_id) {
      log.error(
        { eventType: event_type, guildId: guild_id, discordId: user_id, reason: 'missing guild_id or user_id' },
        'memberJoin rejected'
      );
      return;
    }

    const parsed = MemberJoinDataSchema.safeParse(eventData(payload));
    if (!parsed.success) {
      log.error({ eventType: event_type, guildId: guild_id, reason: parsed.error.message }, 'memberJoin data invalid');
      return;
    }

    const community = await getCommunityByGuildId(guild_id);
    if (!community || !community.isActive) {
      log.warn({ event: 'memberJoin', guildId: guild_id, discordId: user_id, reason: 'unknown or inactive guild' });
      return;
    }

    const { profile, outcome } = await upsertProfile({
      communityId: community.id,
      discordId: user_id,
      setJoinedAt: true,
    });

    // loa:shortcut: EligibilityRepository (ScyllaDB) wiring out of scope; add when OQ-3 resolved

    log.info({ event: 'memberJoin', guildId: guild_id, discordId: user_id, profileId: profile.id, outcome });
  };
}

function makeMemberLeaveHandler() {
  return async function handleMemberLeave(
    payload: GatewayEventPayload,
    log: Logger
  ): Promise<void> {
    const { event_type, guild_id, user_id } = payload;

    if (!guild_id || !user_id) {
      log.error(
        { eventType: event_type, guildId: guild_id, discordId: user_id, reason: 'missing guild_id or user_id' },
        'memberLeave rejected'
      );
      return;
    }

    const community = await getCommunityByGuildId(guild_id);
    if (!community) {
      log.warn({ event: 'memberLeave', guildId: guild_id, discordId: user_id, reason: 'unknown guild' });
      return;
    }

    const { outcome } = await markProfileInactive({
      communityId: community.id,
      discordId: user_id,
    });

    if (outcome === 'unknown_profile' || outcome === 'unknown_guild' as never) {
      log.warn({ event: 'memberLeave', guildId: guild_id, discordId: user_id, outcome });
    } else {
      log.info({ event: 'memberLeave', guildId: guild_id, discordId: user_id, outcome });
    }
  };
}

function makeMemberUpdateHandler() {
  return async function handleMemberUpdate(
    payload: GatewayEventPayload,
    log: Logger
  ): Promise<void> {
    const { event_type, guild_id, user_id } = payload;

    if (!guild_id || !user_id) {
      log.error(
        { eventType: event_type, guildId: guild_id, discordId: user_id, reason: 'missing guild_id or user_id' },
        'memberUpdate rejected'
      );
      return;
    }

    const parsed = MemberUpdateDataSchema.safeParse(eventData(payload));
    if (!parsed.success) {
      log.error({ eventType: event_type, guildId: guild_id, reason: parsed.error.message }, 'memberUpdate data invalid');
      return;
    }

    const community = await getCommunityByGuildId(guild_id);
    if (!community) {
      log.warn({ event: 'memberUpdate', guildId: guild_id, discordId: user_id, reason: 'unknown guild' });
      return;
    }

    const metadataPatch: Record<string, unknown> = {};
    const fieldsUpdated: string[] = [];

    if (parsed.data.nick !== undefined) {
      metadataPatch['displayName'] = parsed.data.nick ?? undefined;
      fieldsUpdated.push('displayName');
    }
    if (parsed.data.roles !== undefined) {
      fieldsUpdated.push('roles');
    }
    if (parsed.data.tier !== undefined) {
      fieldsUpdated.push('tier');
    }

    await upsertProfile({
      communityId: community.id,
      discordId: user_id,
      tier: parsed.data.tier,
      metadataPatch: Object.keys(metadataPatch).length > 0 ? metadataPatch : undefined,
      setJoinedAt: false,
    });

    log.info({ event: 'memberUpdate', guildId: guild_id, discordId: user_id, fieldsUpdated });
  };
}

// --------------------------------------------------------------------------
// Factory
// --------------------------------------------------------------------------

/**
 * Create default NATS-native event handlers map
 */
export function createDefaultNatsEventHandlers(
  discordRest?: DiscordRestService
): Map<string, NatsEventHandler> {
  const handlers = new Map<string, NatsEventHandler>();

  handlers.set('guild.join', makeGuildJoinHandler(discordRest));
  handlers.set('guild.leave', makeGuildLeaveHandler());
  handlers.set('member.join', makeMemberJoinHandler());
  handlers.set('member.leave', makeMemberLeaveHandler());
  handlers.set('member.update', makeMemberUpdateHandler());

  return handlers;
}

/**
 * Create event consumer with default config
 * @param natsHandlers - NATS-native handlers (optional, defaults provided)
 * @param legacyHandlers - Legacy handlers for migration support (optional)
 * @param logger - Pino logger instance
 */
export function createEventNatsConsumer(
  natsHandlers: Map<string, NatsEventHandler> | undefined,
  legacyHandlers: Map<string, HandlerFn> | undefined,
  logger: Logger
): EventNatsConsumer {
  const eventsStream = NATS_ROUTING.streams['EVENTS'];
  return new EventNatsConsumer(
    {
      streamName: eventsStream.name,
      consumerName: 'event-worker',
      filterSubjects: eventsStream.subjects,
      maxAckPending: 100,
      ackWait: 15_000,
      maxDeliver: 5,
      batchSize: 20,
    },
    natsHandlers ?? createDefaultNatsEventHandlers(),
    legacyHandlers ?? new Map(),
    logger
  );
}

// Legacy export for backwards compatibility
export { NatsEventHandler as EventHandler };

/**
 * NATS Event Consumer for Arrakis Workers
 * Sprint S-5: NATS JetStream Deployment
 * Sprint S-6: Worker Migration to NATS
 *
 * Consumes guild/member events from NATS per SDD §5.2
 * Integrates with database for community/member lifecycle
 */

import type { JsMsg } from 'nats';
import type { Logger } from 'pino';
import { BaseNatsConsumer, BaseConsumerConfig, ProcessResult } from './BaseNatsConsumer.js';
import type { DiscordEventPayload } from '../types.js';
import {
  getEventHandler,
  defaultEventHandler,
  type HandlerFn,
} from '../handlers/index.js';

// --------------------------------------------------------------------------
// Types — imported from shared NATS schema contract
// --------------------------------------------------------------------------

import {
  GatewayEventSchema,
  type GatewayEvent,
  type GatewayEventPayload,
  NATS_ROUTING,
} from '@arrakis/nats-schemas';

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
// Default Event Handlers
// --------------------------------------------------------------------------

/**
 * Handle guild.join event (bot added to server)
 */
async function handleGuildJoin(
  payload: GatewayEventPayload,
  log: Logger
): Promise<void> {
  const { guild_id } = payload;
  const data = eventData(payload);
  const guildName = data['name'] as string | undefined;
  const memberCount = data['member_count'] as number | undefined;

  log.info(
    { guildId: guild_id, guildName, memberCount },
    'Bot added to guild'
  );

  // TODO: Create community record in PostgreSQL if not exists
  // TODO: Send welcome message / setup prompt
}

/**
 * Handle guild.leave event (bot removed from server)
 */
async function handleGuildLeave(
  payload: GatewayEventPayload,
  log: Logger
): Promise<void> {
  const { guild_id } = payload;
  const data = eventData(payload);
  const unavailable = data['unavailable'] as boolean | undefined;

  if (unavailable) {
    log.warn({ guildId: guild_id }, 'Guild became unavailable (Discord outage)');
    return;
  }

  log.info({ guildId: guild_id }, 'Bot removed from guild');

  // TODO: Mark community as inactive / schedule cleanup
}

/**
 * Handle member.join event
 */
async function handleMemberJoin(
  payload: GatewayEventPayload,
  log: Logger
): Promise<void> {
  const { guild_id, user_id } = payload;
  const data = eventData(payload);
  const username = data['username'] as string | undefined;

  log.debug(
    { guildId: guild_id, userId: user_id, username },
    'Member joined guild'
  );

  // TODO: Create profile if not exists
  // TODO: Check eligibility rules and assign roles
}

/**
 * Handle member.leave event
 */
async function handleMemberLeave(
  payload: GatewayEventPayload,
  log: Logger
): Promise<void> {
  const { guild_id, user_id } = payload;

  log.debug({ guildId: guild_id, userId: user_id }, 'Member left guild');

  // TODO: Update profile last_active / mark as inactive
}

/**
 * Handle member.update event (role changes, nickname, etc.)
 */
async function handleMemberUpdate(
  payload: GatewayEventPayload,
  log: Logger
): Promise<void> {
  const { guild_id, user_id } = payload;
  const data = eventData(payload);
  const roles = data['roles'] as string[] | undefined;
  const nick = data['nick'] as string | undefined;

  log.debug(
    { guildId: guild_id, userId: user_id, roles, nick },
    'Member updated'
  );

  // TODO: Sync role changes with profile tier
}

// --------------------------------------------------------------------------
// Factory
// --------------------------------------------------------------------------

/**
 * Create default NATS-native event handlers map
 */
export function createDefaultNatsEventHandlers(): Map<string, NatsEventHandler> {
  const handlers = new Map<string, NatsEventHandler>();

  handlers.set('guild.join', handleGuildJoin);
  handlers.set('guild.leave', handleGuildLeave);
  handlers.set('member.join', handleMemberJoin);
  handlers.set('member.leave', handleMemberLeave);
  handlers.set('member.update', handleMemberUpdate);

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

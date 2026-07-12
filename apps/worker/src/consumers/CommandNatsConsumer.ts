/**
 * NATS Command Consumer for Arrakis Workers
 * Sprint S-5: NATS JetStream Deployment
 * Sprint S-6: Worker Migration to NATS
 *
 * Consumes slash commands from NATS per SDD §5.2.3
 * Bridges NATS payload to existing handler interface
 */

import type { JsMsg } from 'nats';
import type { Logger } from 'pino';
import { BaseNatsConsumer, BaseConsumerConfig, ProcessResult } from './BaseNatsConsumer.js';
import type { DiscordRestService } from '../services/DiscordRest.js';
import type { DiscordEventPayload } from '../types.js';
import {
  getCommandHandler,
  defaultCommandHandler,
  type HandlerFn,
} from '../handlers/index.js';

// --------------------------------------------------------------------------
// Types — imported from shared NATS schema contract
// --------------------------------------------------------------------------

import {
  InteractionPayloadSchema,
  type InteractionPayload,
  NATS_ROUTING,
} from '@freeside/nats-schemas';

export type { InteractionPayload };

/**
 * Convert NATS InteractionPayload to legacy DiscordEventPayload
 * This bridges the new Rust gateway format to existing handlers
 */
function toDiscordEventPayload(payload: InteractionPayload): DiscordEventPayload {
  return {
    eventId: payload.event_id,
    eventType: `interaction.command.${payload.data.command_name ?? 'unknown'}`,
    timestamp: payload.timestamp,
    shardId: payload.shard_id,
    guildId: payload.guild_id ?? undefined,
    channelId: payload.channel_id ?? undefined,
    userId: payload.user_id ?? undefined,
    interactionId: payload.data.interaction_id,
    interactionToken: payload.data.interaction_token,
    commandName: payload.data.command_name,
    subcommand: payload.data.subcommand,
    data: payload.data.options,
  };
}

// --------------------------------------------------------------------------
// Command Consumer
// --------------------------------------------------------------------------

export class CommandNatsConsumer extends BaseNatsConsumer<InteractionPayload> {
  private readonly discordRest: DiscordRestService;
  private readonly handlerRegistry: Map<string, HandlerFn>;

  constructor(
    config: BaseConsumerConfig,
    discordRest: DiscordRestService,
    handlerRegistry: Map<string, HandlerFn>,
    logger: Logger
  ) {
    super(config, logger);
    this.discordRest = discordRest;
    this.handlerRegistry = handlerRegistry;
  }

  /**
   * Process a slash command interaction
   * Converts NATS payload to legacy format and routes to registered handler
   */
  async processMessage(
    payload: InteractionPayload,
    _msg: JsMsg
  ): Promise<ProcessResult> {
    // Validate at the NATS trust boundary — reject malformed payloads early
    const parsed = InteractionPayloadSchema.safeParse(payload);
    if (!parsed.success) {
      this.log.error(
        { issues: parsed.error.issues },
        'Invalid InteractionPayload from NATS'
      );
      return { success: false, retryable: false, error: new Error('Invalid InteractionPayload') };
    }

    const safePayload = parsed.data;
    const { event_id, guild_id, user_id, data } = safePayload;
    const { interaction_id, interaction_token, command_name } = data;

    this.log.info(
      {
        eventId: event_id,
        guildId: guild_id,
        userId: user_id,
        command: command_name,
      },
      'Processing command'
    );

    // Convert to legacy payload format for existing handlers
    const legacyPayload = toDiscordEventPayload(safePayload);

    // Step 1: Route to handler (handlers manage their own defer/response flow)
    const handler = command_name
      ? (this.handlerRegistry.get(command_name) ?? getCommandHandler(command_name) ?? defaultCommandHandler)
      : defaultCommandHandler;

    try {
      const result = await handler(legacyPayload, this.log);

      this.log.info(
        { eventId: event_id, command: command_name, result },
        'Command processed'
      );

      // Map legacy ConsumeResult to ProcessResult
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
      this.log.error(
        { eventId: event_id, command: command_name, error },
        'Handler error'
      );

      // Try to send error followup if we have a token
      if (interaction_token) {
        try {
          await this.discordRest.sendFollowup(interaction_token, {
            content: 'An error occurred while processing your request.',
            flags: 64, // Ephemeral
          });
        } catch (followupError) {
          this.log.warn({ followupError }, 'Failed to send error followup');
        }
      }

      // Handler errors are terminal (don't retry indefinitely)
      return {
        success: false,
        retryable: false,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  }
}

// --------------------------------------------------------------------------
// Factory
// --------------------------------------------------------------------------

/**
 * Create command consumer with default config
 * @param discordRest - Discord REST service for responses
 * @param handlerRegistry - Map of command names to handler functions
 * @param logger - Pino logger instance
 */
export function createCommandNatsConsumer(
  discordRest: DiscordRestService,
  handlerRegistry: Map<string, HandlerFn>,
  logger: Logger
): CommandNatsConsumer {
  const commandsStream = NATS_ROUTING.streams['COMMANDS'];
  return new CommandNatsConsumer(
    {
      streamName: commandsStream.name,
      consumerName: 'command-worker',
      filterSubjects: commandsStream.subjects,
      maxAckPending: 50,
      ackWait: 30_000,
      maxDeliver: 3,
      batchSize: 10,
    },
    discordRest,
    handlerRegistry,
    logger
  );
}

import { randomUUID } from 'crypto';
import type {
  Client,
  GuildMember,
  Interaction,
  Message,
  PartialGuildMember,
} from 'discord.js';
import type { Logger } from 'pino';
import type { Publisher } from './publisher.js';
import { PRIORITY, type DiscordEventPayload, type EventType } from './types.js';

/**
 * Wire Discord.js event handlers to publish events to RabbitMQ
 * Per SDD Section 3.2.1 - no business logic, serialize and publish only
 */
export function wireEventHandlers(
  client: Client,
  publisher: Publisher,
  logger: Logger
): void {
  // Track handler registration
  const handlerLogger = logger.child({ component: 'handlers' });

  // Interaction events (slash commands, buttons, modals, autocomplete)
  client.on('interactionCreate', async (interaction) => {
    await handleInteraction(interaction, publisher, handlerLogger);
  });

  // Member events
  client.on('guildMemberAdd', async (member) => {
    await handleMemberJoin(member, publisher, handlerLogger);
  });

  client.on('guildMemberRemove', async (member) => {
    await handleMemberLeave(member, publisher, handlerLogger);
  });

  client.on('guildMemberUpdate', async (oldMember, newMember) => {
    await handleMemberUpdate(oldMember, newMember, publisher, handlerLogger);
  });

  // Guild events
  client.on('guildCreate', async (guild) => {
    await handleGuildJoin(guild.id, publisher, handlerLogger);
  });

  client.on('guildDelete', async (guild) => {
    await handleGuildLeave(guild.id, publisher, handlerLogger);
  });

  // Message events (low priority)
  client.on('messageCreate', async (message) => {
    // Skip bot messages and DMs
    if (message.author.bot || !message.guild) return;
    await handleMessageCreate(message, publisher, handlerLogger);
  });

  handlerLogger.info('Event handlers wired');
}

/**
 * Handle interaction events (commands, buttons, modals)
 */
async function handleInteraction(
  interaction: Interaction,
  publisher: Publisher,
  logger: Logger
): Promise<void> {
  if (!interaction.guild) return; // Skip DMs

  const shardId = interaction.client.shard?.ids[0] ?? 0;

  let eventType: EventType;
  let priority: number;
  let commandName: string | undefined;

  if (interaction.isChatInputCommand()) {
    eventType = 'interaction.command';
    priority = PRIORITY.COMMAND;
    commandName = interaction.commandName;
  } else if (interaction.isButton()) {
    eventType = 'interaction.button';
    priority = PRIORITY.BUTTON;
  } else if (interaction.isModalSubmit()) {
    eventType = 'interaction.modal';
    priority = PRIORITY.MODAL;
  } else if (interaction.isAutocomplete()) {
    eventType = 'interaction.autocomplete';
    priority = PRIORITY.AUTOCOMPLETE;
  } else {
    // Other interaction types - use button priority
    eventType = 'interaction.button';
    priority = PRIORITY.BUTTON;
  }

  const payload: DiscordEventPayload = {
    eventId: randomUUID(),
    eventType: commandName ? `${eventType}.${commandName}` : eventType,
    timestamp: Date.now(),
    shardId,
    guildId: interaction.guild.id,
    channelId: interaction.channelId ?? undefined,
    userId: interaction.user.id,
    interactionId: interaction.id,
    interactionToken: interaction.token,
    data: {
      type: interaction.type,
      commandName,
      customId: 'customId' in interaction ? interaction.customId : undefined,
      options: interaction.isChatInputCommand()
        ? serializeOptions(interaction.options.data)
        : undefined,
      values: 'values' in interaction ? interaction.values : undefined,
      fields: interaction.isModalSubmit()
        ? serializeModalFields(interaction.fields)
        : undefined,
      memberPermissions: interaction.memberPermissions?.toArray(),
    },
  };

  try {
    await publisher.publish(payload, priority);
    logger.debug(
      {
        eventType: payload.eventType,
        interactionId: interaction.id,
        guildId: interaction.guild.id,
        userId: interaction.user.id,
      },
      'Interaction published'
    );
  } catch (error) {
    logger.error(
      {
        eventType: payload.eventType,
        interactionId: interaction.id,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      'Failed to publish interaction'
    );
  }
}

/**
 * Handle member join events
 */
async function handleMemberJoin(
  member: GuildMember,
  publisher: Publisher,
  logger: Logger
): Promise<void> {
  const shardId = member.client.shard?.ids[0] ?? 0;

  const payload: DiscordEventPayload = {
    eventId: randomUUID(),
    eventType: 'member.join',
    timestamp: Date.now(),
    shardId,
    guildId: member.guild.id,
    userId: member.user.id,
    data: {
      userId: member.user.id,
      username: member.user.username,
      displayName: member.displayName,
      joinedAt: member.joinedAt?.toISOString(),
      pending: member.pending,
      roles: member.roles.cache.map((r) => r.id),
    },
  };

  try {
    await publisher.publish(payload, PRIORITY.MEMBER_EVENT);
    logger.debug({ guildId: member.guild.id, userId: member.user.id }, 'Member join published');
  } catch (error) {
    logger.error(
      { guildId: member.guild.id, userId: member.user.id, error: error instanceof Error ? error.message : 'Unknown error' },
      'Failed to publish member join'
    );
  }
}

/**
 * Handle member leave events
 */
async function handleMemberLeave(
  member: GuildMember | PartialGuildMember,
  publisher: Publisher,
  logger: Logger
): Promise<void> {
  const shardId = member.client.shard?.ids[0] ?? 0;

  const payload: DiscordEventPayload = {
    eventId: randomUUID(),
    eventType: 'member.leave',
    timestamp: Date.now(),
    shardId,
    guildId: member.guild.id,
    userId: member.user?.id ?? 'unknown',
    data: {
      userId: member.user?.id,
      username: member.user?.username,
    },
  };

  try {
    await publisher.publish(payload, PRIORITY.MEMBER_EVENT);
    logger.debug({ guildId: member.guild.id, userId: member.user?.id }, 'Member leave published');
  } catch (error) {
    logger.error(
      { guildId: member.guild.id, error: error instanceof Error ? error.message : 'Unknown error' },
      'Failed to publish member leave'
    );
  }
}

/**
 * Handle member update events (role changes, nickname changes)
 */
async function handleMemberUpdate(
  oldMember: GuildMember | PartialGuildMember,
  newMember: GuildMember,
  publisher: Publisher,
  logger: Logger
): Promise<void> {
  const shardId = newMember.client.shard?.ids[0] ?? 0;

  // Calculate role changes
  const oldRoles = new Set(oldMember.roles.cache.keys());
  const newRoles = new Set(newMember.roles.cache.keys());
  const addedRoles = [...newRoles].filter((r) => !oldRoles.has(r));
  const removedRoles = [...oldRoles].filter((r) => !newRoles.has(r));

  // Only publish if there are actual changes
  if (addedRoles.length === 0 && removedRoles.length === 0) {
    return;
  }

  const payload: DiscordEventPayload = {
    eventId: randomUUID(),
    eventType: 'member.update',
    timestamp: Date.now(),
    shardId,
    guildId: newMember.guild.id,
    userId: newMember.user.id,
    data: {
      userId: newMember.user.id,
      username: newMember.user.username,
      oldNickname: oldMember.nickname,
      newNickname: newMember.nickname,
      addedRoles,
      removedRoles,
      currentRoles: [...newMember.roles.cache.keys()],
    },
  };

  try {
    await publisher.publish(payload, PRIORITY.MEMBER_EVENT);
    logger.debug(
      { guildId: newMember.guild.id, userId: newMember.user.id, addedRoles, removedRoles },
      'Member update published'
    );
  } catch (error) {
    logger.error(
      { guildId: newMember.guild.id, userId: newMember.user.id, error: error instanceof Error ? error.message : 'Unknown error' },
      'Failed to publish member update'
    );
  }
}

/**
 * Handle guild join events
 */
async function handleGuildJoin(
  guildId: string,
  publisher: Publisher,
  logger: Logger
): Promise<void> {
  const payload: DiscordEventPayload = {
    eventId: randomUUID(),
    eventType: 'guild.join',
    timestamp: Date.now(),
    shardId: 0, // Will be corrected on receipt
    guildId,
    data: {
      guildId,
    },
  };

  try {
    await publisher.publish(payload, PRIORITY.GUILD_EVENT);
    logger.info({ guildId }, 'Guild join published');
  } catch (error) {
    logger.error(
      { guildId, error: error instanceof Error ? error.message : 'Unknown error' },
      'Failed to publish guild join'
    );
  }
}

/**
 * Handle guild leave events
 */
async function handleGuildLeave(
  guildId: string,
  publisher: Publisher,
  logger: Logger
): Promise<void> {
  const payload: DiscordEventPayload = {
    eventId: randomUUID(),
    eventType: 'guild.leave',
    timestamp: Date.now(),
    shardId: 0,
    guildId,
    data: {
      guildId,
    },
  };

  try {
    await publisher.publish(payload, PRIORITY.GUILD_EVENT);
    logger.info({ guildId }, 'Guild leave published');
  } catch (error) {
    logger.error(
      { guildId, error: error instanceof Error ? error.message : 'Unknown error' },
      'Failed to publish guild leave'
    );
  }
}

/**
 * Handle message create events (low priority)
 */
async function handleMessageCreate(
  message: Message,
  publisher: Publisher,
  logger: Logger
): Promise<void> {
  if (!message.guild) return;

  const shardId = message.client.shard?.ids[0] ?? 0;

  const payload: DiscordEventPayload = {
    eventId: randomUUID(),
    eventType: 'message.create',
    timestamp: Date.now(),
    shardId,
    guildId: message.guild.id,
    channelId: message.channel.id,
    userId: message.author.id,
    data: {
      messageId: message.id,
      authorId: message.author.id,
      channelId: message.channel.id,
      // Don't include full content - just metadata
      hasContent: message.content.length > 0,
      hasAttachments: message.attachments.size > 0,
      hasEmbeds: message.embeds.length > 0,
      mentionsEveryone: message.mentions.everyone,
    },
  };

  try {
    await publisher.publish(payload, PRIORITY.MESSAGE);
    logger.trace({ guildId: message.guild.id, messageId: message.id }, 'Message published');
  } catch (error) {
    logger.error(
      { guildId: message.guild.id, error: error instanceof Error ? error.message : 'Unknown error' },
      'Failed to publish message'
    );
  }
}

/**
 * Serialize command options for payload
 */
function serializeOptions(
  options: readonly { name: string; value?: unknown; type: number; options?: readonly unknown[] }[]
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const opt of options) {
    if (opt.options && Array.isArray(opt.options)) {
      result[opt.name] = serializeOptions(opt.options as typeof options);
    } else {
      result[opt.name] = opt.value;
    }
  }
  return result;
}

/**
 * Serialize modal fields for payload
 */
function serializeModalFields(fields: { fields: Map<string, { customId: string; value: string }> }): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, field] of fields.fields) {
    result[key] = field.value;
  }
  return result;
}

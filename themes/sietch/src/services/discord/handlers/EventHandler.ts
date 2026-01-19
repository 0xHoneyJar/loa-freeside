/**
 * Discord Event Handler
 *
 * Handles Discord client events: ready, disconnect, member updates, activity tracking.
 */

import type {
  Client,
  Guild,
  GuildMember,
  User,
  Message,
  MessageReaction,
  PartialMessageReaction,
  PartialUser,
} from 'discord.js';
import { config } from '../../../config.js';
import { logger } from '../../../utils/logger.js';
import { getMemberProfileByDiscordId } from '../../../db/index.js';
import { registerCommands } from '../../../discord/commands/index.js';
import { profileService } from '../../profile.js';
import {
  recordMessage,
  recordReactionGiven,
  recordReactionReceived,
} from '../../activity.js';
import { handleInteraction } from './InteractionHandler.js';
// Sprint 102: Import ready for full integration when storage adapter is wired
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { createGuildJoinHandler, type OnboardingResult } from './GuildJoinHandler.js';

/**
 * Set up Discord client event handlers
 */
export function setupEventHandlers(
  client: Client,
  state: {
    guild: Guild | null;
    isReady: boolean;
    reconnectAttempts: number;
  },
  onReconnect: () => Promise<void>
): void {
  client.on('ready', async () => {
    logger.info({ user: client.user?.tag }, 'Discord bot connected');
    state.isReady = true;
    state.reconnectAttempts = 0;

    // Fetch and cache the guild
    try {
      state.guild = await client.guilds.fetch(config.discord.guildId);
      logger.info({ guildName: state.guild.name }, 'Connected to guild');

      // Register slash commands
      if (client.user) {
        await registerCommands(client.user.id);
      }
    } catch (error) {
      logger.error({ error, guildId: config.discord.guildId }, 'Failed to fetch guild or register commands');
    }
  });

  client.on('disconnect', () => {
    logger.warn('Discord bot disconnected');
    state.isReady = false;
  });

  client.on('error', (error) => {
    logger.error({ error }, 'Discord client error');
  });

  client.on('warn', (message) => {
    logger.warn({ message }, 'Discord client warning');
  });

  // Handle reconnection
  client.on('shardDisconnect', () => {
    logger.warn('Discord shard disconnected, attempting reconnect...');
    void onReconnect();
  });

  // Handle slash commands and interactions
  client.on('interactionCreate', async (interaction) => {
    await handleInteraction(interaction);
  });

  // Handle role changes for auto-onboarding
  client.on('guildMemberUpdate', async (oldMember, newMember) => {
    // Ensure we have full member objects
    if (oldMember.partial) {
      try {
        await oldMember.fetch();
      } catch (error) {
        logger.warn({ error }, 'Could not fetch partial old member');
        return;
      }
    }
    await handleMemberUpdate(oldMember as GuildMember, newMember);
  });

  // Activity tracking: message create
  client.on('messageCreate', async (message) => {
    await handleMessageCreate(message);
  });

  // Activity tracking: reaction add
  client.on('messageReactionAdd', async (reaction, user) => {
    await handleReactionAdd(reaction, user);
  });

  // Activity tracking: reaction remove
  client.on('messageReactionRemove', async (reaction, user) => {
    await handleReactionRemove(reaction, user);
  });

  // Sprint 102: Intelligent Onboarding - Guild Join Handler
  // Note: guildCreate fires when bot joins a NEW guild (not on reconnect)
  client.on('guildCreate', async (guild) => {
    await handleGuildCreate(guild);
  });
}

/**
 * Handle member role updates for auto-onboarding detection
 */
async function handleMemberUpdate(
  oldMember: GuildMember,
  newMember: GuildMember
): Promise<void> {
  // Check if Naib or Fedaykin role was added
  const naibRoleId = config.discord.roles.naib;
  const fedaykinRoleId = config.discord.roles.fedaykin;

  const hadNaib = oldMember.roles.cache.has(naibRoleId);
  const hadFedaykin = oldMember.roles.cache.has(fedaykinRoleId);
  const hasNaib = newMember.roles.cache.has(naibRoleId);
  const hasFedaykin = newMember.roles.cache.has(fedaykinRoleId);

  // New role assignment detected
  const gainedAccess = (!hadNaib && !hadFedaykin) && (hasNaib || hasFedaykin);

  if (gainedAccess) {
    await triggerOnboardingIfNeeded(newMember.user, hasNaib ? 'naib' : 'fedaykin');
  }
}

/**
 * Trigger onboarding for a user if they haven't completed it
 */
async function triggerOnboardingIfNeeded(user: User, tier: 'naib' | 'fedaykin'): Promise<void> {
  // Check if user already has a profile
  const existingProfile = profileService.getProfileByDiscordId(user.id);
  if (existingProfile) {
    logger.debug({ userId: user.id }, 'User already has profile, skipping onboarding');
    return;
  }

  // Lazy import to avoid circular dependency
  const { onboardingService } = await import('../../onboarding.js');

  try {
    await onboardingService.startOnboarding(user, tier);
    logger.info({ userId: user.id, tier }, 'Triggered onboarding for new member');
  } catch (error) {
    logger.warn({ error, userId: user.id }, 'Could not start onboarding - DMs may be disabled');
  }
}

// ==========================================================================
// Activity Tracking Handlers (S8-T3)
// ==========================================================================

/**
 * Handle message create event for activity tracking
 */
async function handleMessageCreate(message: Message): Promise<void> {
  // Ignore bot messages
  if (message.author.bot) return;

  // Only track messages in our guild
  if (!message.guild || message.guild.id !== config.discord.guildId) return;

  // Only track messages from onboarded members
  const profile = getMemberProfileByDiscordId(message.author.id);
  if (!profile || !profile.onboardingComplete) return;

  try {
    await recordMessage(message.author.id, message.channel.id);
  } catch (error) {
    logger.error({ error, userId: message.author.id }, 'Failed to record message activity');
  }
}

/**
 * Handle reaction add event for activity tracking
 */
async function handleReactionAdd(
  reaction: MessageReaction | PartialMessageReaction,
  user: User | PartialUser
): Promise<void> {
  // Ignore bot reactions
  if (user.bot) return;

  // Fetch full reaction if partial
  if (reaction.partial) {
    try {
      await reaction.fetch();
    } catch (error) {
      logger.debug({ error }, 'Could not fetch partial reaction');
      return;
    }
  }

  // Only track reactions in our guild
  if (!reaction.message.guild || reaction.message.guild.id !== config.discord.guildId) return;

  // Only track reactions from onboarded members
  const profile = getMemberProfileByDiscordId(user.id);
  if (!profile || !profile.onboardingComplete) return;

  try {
    // Record reaction given by the user
    await recordReactionGiven(user.id, reaction.message.channel.id);

    // Record reaction received by the message author (if different and onboarded)
    const messageAuthorId = reaction.message.author?.id;
    if (messageAuthorId && messageAuthorId !== user.id) {
      const authorProfile = getMemberProfileByDiscordId(messageAuthorId);
      if (authorProfile?.onboardingComplete) {
        await recordReactionReceived(messageAuthorId, reaction.message.channel.id);
      }
    }
  } catch (error) {
    logger.error({ error, userId: user.id }, 'Failed to record reaction activity');
  }
}

/**
 * Handle reaction remove event for activity tracking
 * Note: We don't subtract points for removed reactions (activity is cumulative)
 */
async function handleReactionRemove(
  reaction: MessageReaction | PartialMessageReaction,
  user: User | PartialUser
): Promise<void> {
  // We don't track reaction removes for activity
  // Activity points are cumulative and don't decrease on reaction removal
  // The decay system handles activity reduction over time
  logger.debug({ userId: user.id, messageId: reaction.message.id }, 'Reaction removed (not tracked)');
}

// ==========================================================================
// Guild Join Handler (Sprint 102: Sandworm Sense)
// ==========================================================================

/**
 * Handle guild create event for intelligent onboarding
 *
 * This fires when the bot joins a NEW guild. It triggers incumbent detection
 * and mode selection (shadow/greenfield/hybrid).
 *
 * @see GuildJoinHandler for full implementation
 */
async function handleGuildCreate(guild: Guild): Promise<void> {
  logger.info(
    { guildId: guild.id, guildName: guild.name, memberCount: guild.memberCount },
    'Bot joined new guild, initiating intelligent onboarding'
  );

  try {
    // For now, we log the event. Full integration requires:
    // 1. ICoexistenceStorage implementation for SQLite
    // 2. Wiring up the createGuildJoinHandler factory
    //
    // The GuildJoinHandler is ready and tested - this is the integration point.
    //
    // TODO: Wire up full GuildJoinHandler when storage adapter is ready
    // const handler = createGuildJoinHandler(coexistenceStorage, client);
    // const result = await handler.handleGuildJoin(guild);
    // logger.info({ result }, 'Intelligent onboarding complete');

    logger.info(
      { guildId: guild.id },
      'Guild join logged. Full detection pending storage adapter integration.'
    );
  } catch (error) {
    logger.error(
      { error, guildId: guild.id },
      'Failed to handle guild join event'
    );
  }
}

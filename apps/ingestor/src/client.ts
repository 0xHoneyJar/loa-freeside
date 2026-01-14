import { Client, GatewayIntentBits, Options, Partials } from 'discord.js';
import type { Logger } from 'pino';
import type { Config } from './config.js';

/**
 * Create a zero-cache Discord client optimized for the Ingestor
 * Per SDD Section 3.2.1 - all caching disabled for minimal memory footprint
 */
export function createDiscordClient(config: Config, logger: Logger): Client {
  const client = new Client({
    intents: [
      // Guild intents
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],

    // Partials to receive events without cache
    partials: [Partials.GuildMember, Partials.Message, Partials.User, Partials.Channel],

    // CRITICAL: Disable ALL caching for minimal memory footprint
    makeCache: Options.cacheWithLimits({
      ...Options.DefaultMakeCacheSettings,
      // Disable all cache managers
      GuildMemberManager: 0,
      UserManager: 0,
      MessageManager: 0,
      PresenceManager: 0,
      VoiceStateManager: 0,
      GuildScheduledEventManager: 0,
      ThreadManager: 0,
      ThreadMemberManager: 0,
      ReactionManager: 0,
      ReactionUserManager: 0,
      StageInstanceManager: 0,
      GuildStickerManager: 0,
      GuildEmojiManager: 0,
      GuildBanManager: 0,
      GuildInviteManager: 0,
      AutoModerationRuleManager: 0,
      // Keep minimal guild cache for routing
      GuildManager: {
        maxSize: 0,
        keepOverLimit: (guild) => guild.id === guild.client.guilds.cache.first()?.id,
      },
    }),

    // Aggressive sweepers for any cached data
    sweepers: {
      ...Options.DefaultSweeperSettings,
      messages: {
        interval: 60, // Every 60 seconds
        lifetime: 60, // Remove messages older than 60 seconds
      },
      users: {
        interval: 60,
        filter: () => () => true, // Remove all users
      },
      guildMembers: {
        interval: 60,
        filter: () => () => true, // Remove all members
      },
      threadMembers: {
        interval: 60,
        filter: () => () => true,
      },
      threads: {
        interval: 60,
        lifetime: 60,
      },
    },

    // Sharding configuration
    shards: config.shardId !== undefined ? [config.shardId] : 'auto',
    shardCount: config.shardCount,

    // Other optimizations
    failIfNotExists: false,
    allowedMentions: { parse: [] }, // Don't parse mentions
  });

  // Log shard events
  client.on('shardReady', (shardId) => {
    logger.info({ shardId }, 'Shard ready');
  });

  client.on('shardDisconnect', (closeEvent, shardId) => {
    logger.warn({ shardId, code: closeEvent.code, reason: closeEvent.reason }, 'Shard disconnected');
  });

  client.on('shardReconnecting', (shardId) => {
    logger.info({ shardId }, 'Shard reconnecting');
  });

  client.on('shardError', (error, shardId) => {
    logger.error({ shardId, error: error.message }, 'Shard error');
  });

  client.on('shardResume', (shardId, replayedEvents) => {
    logger.info({ shardId, replayedEvents }, 'Shard resumed');
  });

  // Debug logging in development
  if (config.nodeEnv === 'development') {
    client.on('debug', (info) => {
      logger.debug({ info }, 'Discord debug');
    });
  }

  client.on('warn', (info) => {
    logger.warn({ info }, 'Discord warning');
  });

  client.on('error', (error) => {
    logger.error({ error: error.message }, 'Discord error');
  });

  return client;
}

/**
 * Connect the Discord client and wait for ready event
 */
export async function connectDiscord(client: Client, token: string, logger: Logger): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Discord client connection timeout (30s)'));
    }, 30000);

    client.once('ready', () => {
      clearTimeout(timeout);
      logger.info(
        {
          user: client.user?.tag,
          guilds: client.guilds.cache.size,
          shardId: client.shard?.ids[0],
        },
        'Discord client ready'
      );
      resolve();
    });

    client.login(token).catch((error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

/**
 * Gracefully disconnect the Discord client
 */
export async function disconnectDiscord(client: Client, logger: Logger): Promise<void> {
  logger.info('Disconnecting Discord client...');
  client.destroy();
  logger.info('Discord client disconnected');
}

import { z } from 'zod';

/**
 * Configuration schema with validation
 */
const configSchema = z.object({
  // Discord
  discordToken: z.string().min(1, 'DISCORD_BOT_TOKEN is required'),
  shardId: z.number().int().min(0).default(0),
  shardCount: z.number().int().min(1).default(1),

  // RabbitMQ
  rabbitmqUrl: z.string().url('RABBITMQ_URL must be a valid URL'),

  // Queue configuration
  exchangeName: z.string().default('arrakis.events'),
  interactionQueue: z.string().default('arrakis.interactions'),
  eventQueue: z.string().default('arrakis.events.guild'),

  // Health check
  healthPort: z.number().int().min(1).max(65535).default(8080),
  memoryThresholdMb: z.number().int().min(1).default(75),

  // Environment
  nodeEnv: z.enum(['development', 'staging', 'production', 'test']).default('development'),
  logLevel: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
});

export type Config = z.infer<typeof configSchema>;

/**
 * Parse environment variables into configuration
 */
export function loadConfig(): Config {
  const raw = {
    discordToken: process.env.DISCORD_BOT_TOKEN,
    shardId: process.env.SHARD_ID ? parseInt(process.env.SHARD_ID, 10) : 0,
    shardCount: process.env.SHARD_COUNT ? parseInt(process.env.SHARD_COUNT, 10) : 1,
    rabbitmqUrl: process.env.RABBITMQ_URL,
    exchangeName: process.env.EXCHANGE_NAME || 'arrakis.events',
    interactionQueue: process.env.INTERACTION_QUEUE || 'arrakis.interactions',
    eventQueue: process.env.EVENT_QUEUE || 'arrakis.events.guild',
    healthPort: process.env.PORT ? parseInt(process.env.PORT, 10) : 8080,
    memoryThresholdMb: process.env.MEMORY_THRESHOLD_MB
      ? parseInt(process.env.MEMORY_THRESHOLD_MB, 10)
      : 75,
    nodeEnv: process.env.NODE_ENV || 'development',
    logLevel: process.env.LOG_LEVEL || 'info',
  };

  const result = configSchema.safeParse(raw);

  if (!result.success) {
    const errors = result.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`);
    throw new Error(`Configuration validation failed:\n${errors.join('\n')}`);
  }

  return result.data;
}

// Singleton config instance
let configInstance: Config | null = null;

export function getConfig(): Config {
  if (!configInstance) {
    configInstance = loadConfig();
  }
  return configInstance;
}

// For testing - allow resetting config
export function resetConfig(): void {
  configInstance = null;
}

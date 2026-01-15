import { z } from 'zod';

/**
 * Configuration schema with validation
 */
const configSchema = z.object({
  // Message Broker (NATS - Sprint S-7+)
  // RabbitMQ has been deprecated as of Sprint S-7
  natsUrl: z.string().min(1, 'NATS_URL is required'), // NATS JetStream URL(s), comma-separated
  // rabbitmqUrl deprecated - use NATS_URL instead

  // RPC Pool (Sprint S-2)
  rpcProviders: z.array(z.object({
    name: z.string(),
    url: z.string().url(),
    priority: z.number().int().min(1),
    weight: z.number().int().min(1).default(1),
  })).default([
    { name: 'drpc', url: 'https://berachain.drpc.org', priority: 1, weight: 1 },
    { name: 'publicnode', url: 'https://berachain-rpc.publicnode.com', priority: 2, weight: 1 },
    { name: 'bartio', url: 'https://bartio.rpc.berachain.com', priority: 3, weight: 1 },
  ]),
  rpcTimeoutMs: z.number().int().min(1000).max(30000).default(10000),
  rpcErrorThreshold: z.number().int().min(1).max(100).default(50),
  rpcResetTimeoutMs: z.number().int().min(1000).max(300000).default(30000),

  // Queue configuration
  exchangeName: z.string().default('arrakis.events'),
  interactionQueue: z.string().default('arrakis.interactions'),
  eventQueue: z.string().default('arrakis.events.guild'),
  dlqQueue: z.string().default('arrakis.dlq'),

  // Consumer configuration
  interactionPrefetch: z.number().int().min(1).max(100).default(10),
  eventPrefetch: z.number().int().min(1).max(100).default(20),

  // Discord REST
  discordApplicationId: z.string().min(1, 'DISCORD_APPLICATION_ID is required'),
  discordBotToken: z.string().optional(), // For role management operations
  // Note: Worker primarily uses interaction tokens for responses

  // Database (PostgreSQL)
  databaseUrl: z.string().url('DATABASE_URL must be a valid PostgreSQL URL'),

  // Redis
  redisUrl: z.string().default('redis://localhost:6379'),

  // Health check
  healthPort: z.number().int().min(1).max(65535).default(8080),
  memoryThresholdMb: z.number().int().min(1).default(200),

  // Timeouts
  deferTimeoutMs: z.number().int().min(100).max(3000).default(2500),
  processingTimeoutMs: z.number().int().min(1000).max(30000).default(15000),

  // Environment
  nodeEnv: z.enum(['development', 'staging', 'production', 'test']).default('development'),
  logLevel: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
});

export type Config = z.infer<typeof configSchema>;

/**
 * Parse environment variables into configuration
 */
export function loadConfig(): Config {
  const env = process.env;

  // Parse RPC providers from env if provided (JSON array)
  let rpcProviders;
  if (env['RPC_PROVIDERS']) {
    try {
      rpcProviders = JSON.parse(env['RPC_PROVIDERS']);
    } catch {
      // Fall back to defaults if invalid JSON
      rpcProviders = undefined;
    }
  }

  const raw = {
    natsUrl: env['NATS_URL'],
    // rabbitmqUrl deprecated - removed in Sprint S-7
    rpcProviders,
    rpcTimeoutMs: env['RPC_TIMEOUT_MS'] ? parseInt(env['RPC_TIMEOUT_MS'], 10) : 10000,
    rpcErrorThreshold: env['RPC_ERROR_THRESHOLD'] ? parseInt(env['RPC_ERROR_THRESHOLD'], 10) : 50,
    rpcResetTimeoutMs: env['RPC_RESET_TIMEOUT_MS'] ? parseInt(env['RPC_RESET_TIMEOUT_MS'], 10) : 30000,
    exchangeName: env['EXCHANGE_NAME'] || 'arrakis.events',
    interactionQueue: env['INTERACTION_QUEUE'] || 'arrakis.interactions',
    eventQueue: env['EVENT_QUEUE'] || 'arrakis.events.guild',
    dlqQueue: env['DLQ_QUEUE'] || 'arrakis.dlq',
    interactionPrefetch: env['INTERACTION_PREFETCH']
      ? parseInt(env['INTERACTION_PREFETCH'], 10)
      : 10,
    eventPrefetch: env['EVENT_PREFETCH']
      ? parseInt(env['EVENT_PREFETCH'], 10)
      : 20,
    discordApplicationId: env['DISCORD_APPLICATION_ID'],
    databaseUrl: env['DATABASE_URL'],
    discordBotToken: env['DISCORD_BOT_TOKEN'],
    redisUrl: env['REDIS_URL'] || 'redis://localhost:6379',
    healthPort: env['PORT'] ? parseInt(env['PORT'], 10) : 8080,
    memoryThresholdMb: env['MEMORY_THRESHOLD_MB']
      ? parseInt(env['MEMORY_THRESHOLD_MB'], 10)
      : 200,
    deferTimeoutMs: env['DEFER_TIMEOUT_MS']
      ? parseInt(env['DEFER_TIMEOUT_MS'], 10)
      : 2500,
    processingTimeoutMs: env['PROCESSING_TIMEOUT_MS']
      ? parseInt(env['PROCESSING_TIMEOUT_MS'], 10)
      : 15000,
    nodeEnv: env['NODE_ENV'] || 'development',
    logLevel: env['LOG_LEVEL'] || 'info',
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

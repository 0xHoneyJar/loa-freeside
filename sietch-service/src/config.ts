import { z } from 'zod';
import { config as dotenvConfig } from 'dotenv';
import type { Address } from 'viem';
import { logger } from './utils/logger.js';

// Load environment variables from .env.local for development
dotenvConfig({ path: '.env.local' });
dotenvConfig(); // Fallback to .env

/**
 * Zod schema for validating Ethereum addresses
 */
const addressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid Ethereum address');

/**
 * Zod schema for validating comma-separated address lists
 */
const addressListSchema = z
  .string()
  .transform((val) => val.split(',').map((addr) => addr.trim()).filter(Boolean))
  .pipe(z.array(addressSchema));

/**
 * Admin API key schema: "key:name,key:name"
 */
const adminApiKeysSchema = z
  .string()
  .transform((val) => {
    const keys = new Map<string, string>();
    for (const pair of val.split(',')) {
      const [key, name] = pair.split(':');
      if (key && name) {
        keys.set(key.trim(), name.trim());
      }
    }
    return keys;
  });

/**
 * Configuration schema with Zod validation
 */
const configSchema = z.object({
  // Berachain RPC Configuration
  chain: z.object({
    rpcUrl: z.string().url(),
    bgtAddress: addressSchema,
    rewardVaultAddresses: addressListSchema,
  }),

  // trigger.dev Configuration
  triggerDev: z.object({
    projectId: z.string().min(1),
    secretKey: z.string().min(1),
  }),

  // Discord Configuration
  discord: z.object({
    botToken: z.string().min(1),
    guildId: z.string().min(1),
    channels: z.object({
      theDoor: z.string().min(1),
      census: z.string().min(1),
    }),
    roles: z.object({
      naib: z.string().min(1),
      fedaykin: z.string().min(1),
    }),
  }),

  // API Configuration
  api: z.object({
    port: z.coerce.number().int().min(1).max(65535).default(3000),
    host: z.string().default('0.0.0.0'),
    adminApiKeys: adminApiKeysSchema,
  }),

  // Database Configuration
  database: z.object({
    path: z.string().min(1),
  }),

  // Logging Configuration
  logging: z.object({
    level: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  }),

  // Grace Period Configuration
  gracePeriod: z.object({
    hours: z.coerce.number().int().min(1).default(24),
  }),
});

/**
 * Parse and validate configuration from environment variables
 */
function parseConfig() {
  const rawConfig = {
    chain: {
      rpcUrl: process.env.BERACHAIN_RPC_URL ?? '',
      bgtAddress: process.env.BGT_ADDRESS ?? '',
      rewardVaultAddresses: process.env.REWARD_VAULT_ADDRESSES ?? '',
    },
    triggerDev: {
      projectId: process.env.TRIGGER_PROJECT_ID ?? '',
      secretKey: process.env.TRIGGER_SECRET_KEY ?? '',
    },
    discord: {
      botToken: process.env.DISCORD_BOT_TOKEN ?? '',
      guildId: process.env.DISCORD_GUILD_ID ?? '',
      channels: {
        theDoor: process.env.DISCORD_CHANNEL_THE_DOOR ?? '',
        census: process.env.DISCORD_CHANNEL_CENSUS ?? '',
      },
      roles: {
        naib: process.env.DISCORD_ROLE_NAIB ?? '',
        fedaykin: process.env.DISCORD_ROLE_FEDAYKIN ?? '',
      },
    },
    api: {
      port: process.env.API_PORT ?? '3000',
      host: process.env.API_HOST ?? '0.0.0.0',
      adminApiKeys: process.env.ADMIN_API_KEYS ?? '',
    },
    database: {
      path: process.env.DATABASE_PATH ?? './data/sietch.db',
    },
    logging: {
      level: process.env.LOG_LEVEL ?? 'info',
    },
    gracePeriod: {
      hours: process.env.GRACE_PERIOD_HOURS ?? '24',
    },
  };

  const result = configSchema.safeParse(rawConfig);

  if (!result.success) {
    const errors = result.error.issues.map(
      (issue) => `  - ${issue.path.join('.')}: ${issue.message}`
    );
    logger.fatal({ errors: result.error.issues }, 'Configuration validation failed');
    throw new Error(`Configuration validation failed:\n${errors.join('\n')}`);
  }

  return result.data;
}

/**
 * Typed configuration object
 */
export interface Config {
  chain: {
    rpcUrl: string;
    bgtAddress: Address;
    rewardVaultAddresses: Address[];
  };
  triggerDev: {
    projectId: string;
    secretKey: string;
  };
  discord: {
    botToken: string;
    guildId: string;
    channels: {
      theDoor: string;
      census: string;
    };
    roles: {
      naib: string;
      fedaykin: string;
    };
  };
  api: {
    port: number;
    host: string;
    adminApiKeys: Map<string, string>;
  };
  database: {
    path: string;
  };
  logging: {
    level: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';
  };
  gracePeriod: {
    hours: number;
  };
}

// Parse configuration at module load time
const parsedConfig = parseConfig();

/**
 * Validated and typed configuration
 */
export const config: Config = {
  chain: {
    rpcUrl: parsedConfig.chain.rpcUrl,
    bgtAddress: parsedConfig.chain.bgtAddress as Address,
    rewardVaultAddresses: parsedConfig.chain.rewardVaultAddresses as Address[],
  },
  triggerDev: parsedConfig.triggerDev,
  discord: parsedConfig.discord,
  api: parsedConfig.api,
  database: parsedConfig.database,
  logging: parsedConfig.logging,
  gracePeriod: parsedConfig.gracePeriod,
};

/**
 * Validate an admin API key
 * @returns Admin name if valid, undefined if invalid
 */
export function validateApiKey(apiKey: string): string | undefined {
  return config.api.adminApiKeys.get(apiKey);
}

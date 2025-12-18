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
 * Zod schema for validating comma-separated URL lists
 */
const urlListSchema = z
  .string()
  .transform((val) => val.split(',').map((url) => url.trim()).filter(Boolean))
  .pipe(z.array(z.string().url()));

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
    rpcUrls: urlListSchema, // Support multiple RPC URLs for resilience
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
      // Social Layer channels (v2.0)
      sietchLounge: z.string().optional(),
      naibCouncil: z.string().optional(),
      introductions: z.string().optional(),
    }),
    roles: z.object({
      naib: z.string().min(1),
      fedaykin: z.string().min(1),
      // Dynamic roles (v2.0) - assigned by Sietch bot based on badges/tenure
      onboarded: z.string().optional(),
      engaged: z.string().optional(),
      veteran: z.string().optional(),
      trusted: z.string().optional(),
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

  // Social Layer Configuration (v2.0)
  socialLayer: z.object({
    // Activity decay settings
    activity: z.object({
      // Decay rate per period (0.0-1.0)
      decayRate: z.coerce.number().min(0).max(1).default(0.1),
      // Decay period in hours
      decayPeriodHours: z.coerce.number().int().min(1).default(6),
      // Points per activity type
      points: z.object({
        message: z.coerce.number().int().min(0).default(1),
        reactionGiven: z.coerce.number().int().min(0).default(1),
        reactionReceived: z.coerce.number().int().min(0).default(2),
      }),
    }),
    // Profile settings
    profile: z.object({
      // Nym change cooldown in days
      nymChangeCooldownDays: z.coerce.number().int().min(0).default(30),
      // Launch date for OG badge calculation
      launchDate: z.string().datetime().optional(),
      // Max bio length
      maxBioLength: z.coerce.number().int().min(0).default(160),
    }),
    // Avatar settings
    avatar: z.object({
      // Default size in pixels
      defaultSize: z.coerce.number().int().min(32).max(512).default(200),
      // Grid dimensions for drunken bishop
      gridWidth: z.coerce.number().int().min(5).max(50).default(17),
      gridHeight: z.coerce.number().int().min(5).max(50).default(9),
    }),
    // Image processing settings
    image: z.object({
      // Target PFP size
      pfpSize: z.coerce.number().int().min(64).max(512).default(256),
      // Max file size in KB
      maxFileSizeKB: z.coerce.number().int().min(100).max(2048).default(500),
      // WebP quality
      webpQuality: z.coerce.number().int().min(1).max(100).default(80),
    }),
  }),
});

/**
 * Parse and validate configuration from environment variables
 */
function parseConfig() {
  const rawConfig = {
    chain: {
      rpcUrls: process.env.BERACHAIN_RPC_URLS ?? process.env.BERACHAIN_RPC_URL ?? '',
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
        // Social Layer channels (v2.0)
        sietchLounge: process.env.DISCORD_CHANNEL_SIETCH_LOUNGE,
        naibCouncil: process.env.DISCORD_CHANNEL_NAIB_COUNCIL,
        introductions: process.env.DISCORD_CHANNEL_INTRODUCTIONS,
      },
      roles: {
        naib: process.env.DISCORD_ROLE_NAIB ?? '',
        fedaykin: process.env.DISCORD_ROLE_FEDAYKIN ?? '',
        // Dynamic roles (v2.0)
        onboarded: process.env.DISCORD_ROLE_ONBOARDED,
        engaged: process.env.DISCORD_ROLE_ENGAGED,
        veteran: process.env.DISCORD_ROLE_VETERAN,
        trusted: process.env.DISCORD_ROLE_TRUSTED,
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
    // Social Layer Configuration (v2.0)
    socialLayer: {
      activity: {
        decayRate: process.env.ACTIVITY_DECAY_RATE ?? '0.1',
        decayPeriodHours: process.env.ACTIVITY_DECAY_PERIOD_HOURS ?? '6',
        points: {
          message: process.env.ACTIVITY_POINTS_MESSAGE ?? '1',
          reactionGiven: process.env.ACTIVITY_POINTS_REACTION_GIVEN ?? '1',
          reactionReceived: process.env.ACTIVITY_POINTS_REACTION_RECEIVED ?? '2',
        },
      },
      profile: {
        nymChangeCooldownDays: process.env.NYM_CHANGE_COOLDOWN_DAYS ?? '30',
        launchDate: process.env.SOCIAL_LAYER_LAUNCH_DATE,
        maxBioLength: process.env.MAX_BIO_LENGTH ?? '160',
      },
      avatar: {
        defaultSize: process.env.AVATAR_DEFAULT_SIZE ?? '200',
        gridWidth: process.env.AVATAR_GRID_WIDTH ?? '17',
        gridHeight: process.env.AVATAR_GRID_HEIGHT ?? '9',
      },
      image: {
        pfpSize: process.env.PFP_SIZE ?? '256',
        maxFileSizeKB: process.env.MAX_PFP_SIZE_KB ?? '500',
        webpQuality: process.env.WEBP_QUALITY ?? '80',
      },
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
    rpcUrls: string[];
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
      // Social Layer channels (v2.0)
      sietchLounge?: string;
      naibCouncil?: string;
      introductions?: string;
    };
    roles: {
      naib: string;
      fedaykin: string;
      // Dynamic roles (v2.0)
      onboarded?: string;
      engaged?: string;
      veteran?: string;
      trusted?: string;
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
  // Social Layer Configuration (v2.0)
  socialLayer: {
    activity: {
      decayRate: number;
      decayPeriodHours: number;
      points: {
        message: number;
        reactionGiven: number;
        reactionReceived: number;
      };
    };
    profile: {
      nymChangeCooldownDays: number;
      launchDate?: string;
      maxBioLength: number;
    };
    avatar: {
      defaultSize: number;
      gridWidth: number;
      gridHeight: number;
    };
    image: {
      pfpSize: number;
      maxFileSizeKB: number;
      webpQuality: number;
    };
  };
}

// Parse configuration at module load time
const parsedConfig = parseConfig();

/**
 * Validated and typed configuration
 */
export const config: Config = {
  chain: {
    rpcUrls: parsedConfig.chain.rpcUrls,
    bgtAddress: parsedConfig.chain.bgtAddress as Address,
    rewardVaultAddresses: parsedConfig.chain.rewardVaultAddresses as Address[],
  },
  triggerDev: parsedConfig.triggerDev,
  discord: parsedConfig.discord,
  api: parsedConfig.api,
  database: parsedConfig.database,
  logging: parsedConfig.logging,
  gracePeriod: parsedConfig.gracePeriod,
  socialLayer: parsedConfig.socialLayer,
};

/**
 * Validate an admin API key
 * @returns Admin name if valid, undefined if invalid
 */
export function validateApiKey(apiKey: string): string | undefined {
  return config.api.adminApiKeys.get(apiKey);
}

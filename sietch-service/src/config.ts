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
 * Stripe price IDs schema: "tier:priceId,tier:priceId"
 */
const stripePriceIdsSchema = z
  .string()
  .transform((val) => {
    const prices = new Map<string, string>();
    if (!val) return prices;
    for (const pair of val.split(',')) {
      const [tier, priceId] = pair.split(':');
      if (tier && priceId) {
        prices.set(tier.trim(), priceId.trim());
      }
    }
    return prices;
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

  // Stripe Configuration (v4.0 - Sprint 23)
  stripe: z.object({
    secretKey: z.string().optional(),
    webhookSecret: z.string().optional(),
    priceIds: stripePriceIdsSchema,
  }),

  // Redis Configuration (v4.0 - Sprint 23)
  redis: z.object({
    url: z.string().url().optional(),
    maxRetries: z.coerce.number().int().min(0).max(10).default(3),
    connectTimeout: z.coerce.number().int().min(1000).max(30000).default(5000),
    // TTL for entitlement cache in seconds (5 minutes default)
    entitlementTtl: z.coerce.number().int().min(60).max(3600).default(300),
  }),

  // Feature Flags (v4.0 - Sprint 23)
  features: z.object({
    // Enable Stripe billing integration
    billingEnabled: z.coerce.boolean().default(false),
    // Enable Gatekeeper feature gating
    gatekeeperEnabled: z.coerce.boolean().default(false),
    // Enable Redis caching
    redisEnabled: z.coerce.boolean().default(false),
    // Enable score badges (Sprint 27)
    badgesEnabled: z.coerce.boolean().default(true),
    // Enable Telegram bot (v4.1 - Sprint 30)
    telegramEnabled: z.coerce.boolean().default(false),
  }),

  // Telegram Configuration (v4.1 - Sprint 30)
  telegram: z.object({
    botToken: z.string().optional(),
    webhookSecret: z.string().optional(),
    webhookUrl: z.string().url().optional(),
    verifyCallbackUrl: z.string().url().optional(),
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
      // Cave Entrance channel (v2.1) - for aspiring members in positions 70-100
      caveEntrance: z.string().optional(),
      // The Oasis channel (v3.0 - Sprint 17) - exclusive for Water Sharer badge holders
      oasis: z.string().optional(),
      // Announcements channel (v3.0 - Sprint 20) - weekly digest posts
      announcements: z.string().optional(),
    }),
    roles: z.object({
      naib: z.string().min(1),
      fedaykin: z.string().min(1),
      // Dynamic roles (v2.0) - assigned by Sietch bot based on badges/tenure
      onboarded: z.string().optional(),
      engaged: z.string().optional(),
      veteran: z.string().optional(),
      trusted: z.string().optional(),
      // Naib dynamics roles (v2.1) - assigned based on Naib seat status
      formerNaib: z.string().optional(),
      // Cave Entrance role (v2.1) - assigned to waitlist registrations
      taqwa: z.string().optional(),
      // Tier roles (v3.0) - assigned based on BGT threshold
      hajra: z.string().optional(),
      ichwan: z.string().optional(),
      qanat: z.string().optional(),
      sihaya: z.string().optional(),
      mushtamal: z.string().optional(),
      sayyadina: z.string().optional(),
      usul: z.string().optional(),
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
    // Stripe Configuration (v4.0 - Sprint 23)
    stripe: {
      secretKey: process.env.STRIPE_SECRET_KEY,
      webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
      priceIds: process.env.STRIPE_PRICE_IDS ?? '',
    },
    // Redis Configuration (v4.0 - Sprint 23)
    redis: {
      url: process.env.REDIS_URL,
      maxRetries: process.env.REDIS_MAX_RETRIES ?? '3',
      connectTimeout: process.env.REDIS_CONNECT_TIMEOUT ?? '5000',
      entitlementTtl: process.env.REDIS_ENTITLEMENT_TTL ?? '300',
    },
    // Feature Flags (v4.0 - Sprint 23)
    features: {
      billingEnabled: process.env.FEATURE_BILLING_ENABLED ?? 'false',
      gatekeeperEnabled: process.env.FEATURE_GATEKEEPER_ENABLED ?? 'false',
      redisEnabled: process.env.FEATURE_REDIS_ENABLED ?? 'false',
      telegramEnabled: process.env.FEATURE_TELEGRAM_ENABLED ?? 'false',
    },
    // Telegram Configuration (v4.1 - Sprint 30)
    telegram: {
      botToken: process.env.TELEGRAM_BOT_TOKEN,
      webhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET,
      webhookUrl: process.env.TELEGRAM_WEBHOOK_URL,
      verifyCallbackUrl: process.env.TELEGRAM_VERIFY_CALLBACK_URL,
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
        // Cave Entrance channel (v2.1)
        caveEntrance: process.env.DISCORD_CHANNEL_CAVE_ENTRANCE,
        // The Oasis channel (v3.0 - Sprint 17)
        oasis: process.env.DISCORD_CHANNEL_OASIS,
        // Announcements channel (v3.0 - Sprint 20)
        announcements: process.env.DISCORD_ANNOUNCEMENTS_CHANNEL_ID,
      },
      roles: {
        naib: process.env.DISCORD_ROLE_NAIB ?? '',
        fedaykin: process.env.DISCORD_ROLE_FEDAYKIN ?? '',
        // Dynamic roles (v2.0)
        onboarded: process.env.DISCORD_ROLE_ONBOARDED,
        engaged: process.env.DISCORD_ROLE_ENGAGED,
        veteran: process.env.DISCORD_ROLE_VETERAN,
        trusted: process.env.DISCORD_ROLE_TRUSTED,
        // Naib dynamics roles (v2.1)
        formerNaib: process.env.DISCORD_ROLE_FORMER_NAIB,
        // Cave Entrance role (v2.1)
        taqwa: process.env.DISCORD_ROLE_TAQWA,
        // Tier roles (v3.0)
        hajra: process.env.DISCORD_ROLE_HAJRA,
        ichwan: process.env.DISCORD_ROLE_ICHWAN,
        qanat: process.env.DISCORD_ROLE_QANAT,
        sihaya: process.env.DISCORD_ROLE_SIHAYA,
        mushtamal: process.env.DISCORD_ROLE_MUSHTAMAL,
        sayyadina: process.env.DISCORD_ROLE_SAYYADINA,
        usul: process.env.DISCORD_ROLE_USUL,
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
  // Stripe Configuration (v4.0 - Sprint 23)
  stripe: {
    secretKey?: string;
    webhookSecret?: string;
    priceIds: Map<string, string>;
  };
  // Redis Configuration (v4.0 - Sprint 23)
  redis: {
    url?: string;
    maxRetries: number;
    connectTimeout: number;
    entitlementTtl: number;
  };
  // Feature Flags (v4.0 - Sprint 23)
  features: {
    billingEnabled: boolean;
    gatekeeperEnabled: boolean;
    redisEnabled: boolean;
    badgesEnabled: boolean;
    telegramEnabled: boolean;
  };
  // Telegram Configuration (v4.1 - Sprint 30)
  telegram: {
    botToken?: string;
    webhookSecret?: string;
    webhookUrl?: string;
    verifyCallbackUrl?: string;
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
      // Cave Entrance channel (v2.1)
      caveEntrance?: string;
      // The Oasis channel (v3.0 - Sprint 17)
      oasis?: string;
      // Announcements channel (v3.0 - Sprint 20)
      announcements?: string;
    };
    roles: {
      naib: string;
      fedaykin: string;
      // Dynamic roles (v2.0)
      onboarded?: string;
      engaged?: string;
      veteran?: string;
      trusted?: string;
      // Naib dynamics roles (v2.1)
      formerNaib?: string;
      // Cave Entrance role (v2.1)
      taqwa?: string;
      // Tier roles (v3.0)
      hajra?: string;
      ichwan?: string;
      qanat?: string;
      sihaya?: string;
      mushtamal?: string;
      sayyadina?: string;
      usul?: string;
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
  stripe: parsedConfig.stripe,
  redis: parsedConfig.redis,
  features: parsedConfig.features,
  telegram: parsedConfig.telegram,
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

/**
 * Tier role colors for Discord (hex values)
 * Used when creating roles programmatically
 */
export const TIER_ROLE_COLORS = {
  hajra: 0xC2B280,     // Sand
  ichwan: 0xFD7E14,    // Orange
  qanat: 0x17A2B8,     // Cyan
  sihaya: 0x28A745,    // Green
  mushtamal: 0x20C997, // Teal
  sayyadina: 0x6610F2, // Indigo
  usul: 0x9B59B6,      // Purple
  fedaykin: 0x4169E1,  // Blue
  naib: 0xFFD700,      // Gold
} as const;

/**
 * Get tier role ID from config
 * Returns the Discord role ID for a given tier, or undefined if not configured
 */
export function getTierRoleId(tier: string): string | undefined {
  const roles = config.discord.roles;
  switch (tier) {
    case 'hajra':
      return roles.hajra;
    case 'ichwan':
      return roles.ichwan;
    case 'qanat':
      return roles.qanat;
    case 'sihaya':
      return roles.sihaya;
    case 'mushtamal':
      return roles.mushtamal;
    case 'sayyadina':
      return roles.sayyadina;
    case 'usul':
      return roles.usul;
    case 'fedaykin':
      return roles.fedaykin;
    case 'naib':
      return roles.naib;
    default:
      return undefined;
  }
}

/**
 * Check if all tier roles are configured
 * Returns list of missing tier role names
 */
export function getMissingTierRoles(): string[] {
  const missing: string[] = [];
  const roles = config.discord.roles;

  // BGT-based tiers (optional)
  if (!roles.hajra) missing.push('hajra');
  if (!roles.ichwan) missing.push('ichwan');
  if (!roles.qanat) missing.push('qanat');
  if (!roles.sihaya) missing.push('sihaya');
  if (!roles.mushtamal) missing.push('mushtamal');
  if (!roles.sayyadina) missing.push('sayyadina');
  if (!roles.usul) missing.push('usul');
  // Rank-based tiers (required)
  if (!roles.fedaykin) missing.push('fedaykin');
  if (!roles.naib) missing.push('naib');

  return missing;
}

/**
 * Check if The Oasis channel is configured
 */
export function isOasisChannelConfigured(): boolean {
  return !!config.discord.channels.oasis;
}

/**
 * Get The Oasis channel ID
 * Returns undefined if not configured
 */
export function getOasisChannelId(): string | undefined {
  return config.discord.channels.oasis;
}

// =============================================================================
// Billing Configuration Helpers (v4.0 - Sprint 23)
// =============================================================================

/**
 * Check if Stripe billing is enabled and configured
 */
export function isBillingEnabled(): boolean {
  return config.features.billingEnabled && !!config.stripe.secretKey;
}

/**
 * Check if Gatekeeper feature gating is enabled
 */
export function isGatekeeperEnabled(): boolean {
  return config.features.gatekeeperEnabled;
}

/**
 * Check if Redis caching is enabled and configured
 */
export function isRedisEnabled(): boolean {
  return config.features.redisEnabled && !!config.redis.url;
}

/**
 * Get Stripe price ID for a subscription tier
 * Returns undefined if not configured
 */
export function getStripePriceId(tier: string): string | undefined {
  return config.stripe.priceIds.get(tier);
}

/**
 * Check if all required Stripe configuration is present
 * Returns list of missing configuration keys
 */
export function getMissingStripeConfig(): string[] {
  const missing: string[] = [];

  if (!config.stripe.secretKey) missing.push('STRIPE_SECRET_KEY');
  if (!config.stripe.webhookSecret) missing.push('STRIPE_WEBHOOK_SECRET');
  if (config.stripe.priceIds.size === 0) missing.push('STRIPE_PRICE_IDS');

  return missing;
}

/**
 * Subscription tier pricing information
 * Monthly prices in USD
 */
export const SUBSCRIPTION_TIERS = {
  starter: { price: 0, maxMembers: 100, name: 'Starter' },
  basic: { price: 29, maxMembers: 500, name: 'Basic' },
  premium: { price: 99, maxMembers: 1000, name: 'Premium' },
  exclusive: { price: 199, maxMembers: 2500, name: 'Exclusive' },
  elite: { price: 449, maxMembers: 10000, name: 'Elite' },
  enterprise: { price: 0, maxMembers: Infinity, name: 'Enterprise' }, // Custom pricing
} as const;

/**
 * Get subscription tier info
 */
export function getSubscriptionTierInfo(tier: string): typeof SUBSCRIPTION_TIERS[keyof typeof SUBSCRIPTION_TIERS] | undefined {
  return SUBSCRIPTION_TIERS[tier as keyof typeof SUBSCRIPTION_TIERS];
}

// =============================================================================
// Telegram Configuration Helpers (v4.1 - Sprint 30)
// =============================================================================

/**
 * Check if Telegram bot is enabled and configured
 */
export function isTelegramEnabled(): boolean {
  return config.features.telegramEnabled && !!config.telegram.botToken;
}

/**
 * Check if all required Telegram configuration is present
 * Returns list of missing configuration keys
 */
export function getMissingTelegramConfig(): string[] {
  const missing: string[] = [];

  if (!config.telegram.botToken) missing.push('TELEGRAM_BOT_TOKEN');
  if (!config.telegram.webhookSecret) missing.push('TELEGRAM_WEBHOOK_SECRET');

  return missing;
}

/**
 * Check if Telegram is in production mode (webhook) vs development (polling)
 */
export function isTelegramWebhookMode(): boolean {
  return !!config.telegram.webhookUrl;
}

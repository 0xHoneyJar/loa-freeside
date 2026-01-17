/**
 * Cache Key Builder
 * Sprint S-12: Multi-Layer Caching
 *
 * Provides consistent cache key generation across the application.
 * Uses a hierarchical namespace:entityType:identifier pattern.
 *
 * Key Format: {namespace}:{entityType}:{identifier}[:{version}]
 *
 * Examples:
 * - vault:user:12345
 * - leaderboard:guild:67890:v2
 * - config:tenant:abc123
 * - rpc:balance:0x1234...abcd
 */

import type { CacheKeyComponents } from './types.js';

/**
 * Cache namespaces for different domains
 */
export enum CacheNamespace {
  /** User/vault data */
  VAULT = 'vault',
  /** Leaderboard scores */
  LEADERBOARD = 'lb',
  /** Configuration data */
  CONFIG = 'cfg',
  /** RPC call results */
  RPC = 'rpc',
  /** Session data */
  SESSION = 'sess',
  /** Guild data */
  GUILD = 'guild',
  /** Token metadata */
  TOKEN = 'token',
  /** Generic cache */
  GENERIC = 'gen',
}

/**
 * Entity types within namespaces
 */
export enum CacheEntityType {
  /** Individual user */
  USER = 'user',
  /** Discord guild */
  GUILD = 'guild',
  /** Wallet address */
  WALLET = 'wallet',
  /** Token contract */
  TOKEN = 'token',
  /** Aggregate/computed value */
  AGGREGATE = 'agg',
  /** List/collection */
  LIST = 'list',
  /** Single value */
  VALUE = 'val',
}

/**
 * Build a cache key from components
 */
export function buildCacheKey(components: CacheKeyComponents): string {
  const { namespace, entityType, identifier, version } = components;

  if (version) {
    return `${namespace}:${entityType}:${identifier}:${version}`;
  }

  return `${namespace}:${entityType}:${identifier}`;
}

/**
 * Parse a cache key into components
 */
export function parseCacheKey(key: string): CacheKeyComponents | null {
  const parts = key.split(':');

  if (parts.length < 3) {
    return null;
  }

  return {
    namespace: parts[0],
    entityType: parts[1],
    identifier: parts.slice(2, parts.length > 3 ? -1 : undefined).join(':'),
    version: parts.length > 3 ? parts[parts.length - 1] : undefined,
  };
}

/**
 * Cache key builders for common patterns
 */
export const CacheKeys = {
  /**
   * User vault data
   * @example vault:user:12345
   */
  userVault: (userId: string): string =>
    buildCacheKey({
      namespace: CacheNamespace.VAULT,
      entityType: CacheEntityType.USER,
      identifier: userId,
    }),

  /**
   * User position in leaderboard
   * @example lb:user:12345:guild:67890
   */
  userPosition: (userId: string, guildId: string): string =>
    buildCacheKey({
      namespace: CacheNamespace.LEADERBOARD,
      entityType: CacheEntityType.USER,
      identifier: `${userId}:guild:${guildId}`,
    }),

  /**
   * Guild leaderboard
   * @example lb:guild:67890
   */
  guildLeaderboard: (guildId: string): string =>
    buildCacheKey({
      namespace: CacheNamespace.LEADERBOARD,
      entityType: CacheEntityType.GUILD,
      identifier: guildId,
    }),

  /**
   * Tenant configuration
   * @example cfg:guild:67890
   */
  tenantConfig: (guildId: string): string =>
    buildCacheKey({
      namespace: CacheNamespace.CONFIG,
      entityType: CacheEntityType.GUILD,
      identifier: guildId,
    }),

  /**
   * RPC balance call
   * @example rpc:wallet:0x1234
   */
  rpcBalance: (walletAddress: string): string =>
    buildCacheKey({
      namespace: CacheNamespace.RPC,
      entityType: CacheEntityType.WALLET,
      identifier: walletAddress.toLowerCase(),
    }),

  /**
   * Token metadata
   * @example token:token:0xabcd
   */
  tokenMetadata: (tokenAddress: string): string =>
    buildCacheKey({
      namespace: CacheNamespace.TOKEN,
      entityType: CacheEntityType.TOKEN,
      identifier: tokenAddress.toLowerCase(),
    }),

  /**
   * Guild aggregate stats
   * @example guild:agg:67890
   */
  guildStats: (guildId: string): string =>
    buildCacheKey({
      namespace: CacheNamespace.GUILD,
      entityType: CacheEntityType.AGGREGATE,
      identifier: guildId,
    }),

  /**
   * Generic key builder
   */
  generic: (category: string, id: string): string =>
    buildCacheKey({
      namespace: CacheNamespace.GENERIC,
      entityType: category,
      identifier: id,
    }),
};

/**
 * Invalidation pattern builders for bulk invalidation
 */
export const InvalidationPatterns = {
  /**
   * All cache entries for a user
   * @example vault:user:12345
   */
  allForUser: (userId: string): string => `${CacheNamespace.VAULT}:${CacheEntityType.USER}:${userId}`,

  /**
   * All leaderboard entries for a guild
   * @example lb:guild:67890
   */
  guildLeaderboard: (guildId: string): string =>
    `${CacheNamespace.LEADERBOARD}:${CacheEntityType.GUILD}:${guildId}`,

  /**
   * All user positions in a guild (prefix match)
   * @example lb:user:
   */
  allUserPositionsInGuild: (guildId: string): string =>
    `${CacheNamespace.LEADERBOARD}:${CacheEntityType.USER}:`,

  /**
   * All config for a tenant
   * @example cfg:guild:67890
   */
  tenantConfig: (guildId: string): string =>
    `${CacheNamespace.CONFIG}:${CacheEntityType.GUILD}:${guildId}`,

  /**
   * All RPC cache (for chain reorg)
   * @example rpc:
   */
  allRpc: (): string => `${CacheNamespace.RPC}:`,

  /**
   * All entries in a namespace
   */
  namespace: (namespace: CacheNamespace): string => `${namespace}:`,
};

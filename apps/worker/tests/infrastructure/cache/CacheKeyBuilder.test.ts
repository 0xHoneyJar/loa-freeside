/**
 * Cache Key Builder Unit Tests
 * Sprint S-12: Multi-Layer Caching
 */

import { describe, it, expect } from 'vitest';
import {
  buildCacheKey,
  parseCacheKey,
  CacheKeys,
  InvalidationPatterns,
  CacheNamespace,
  CacheEntityType,
} from '../../../src/infrastructure/cache/CacheKeyBuilder.js';

describe('CacheKeyBuilder', () => {
  describe('buildCacheKey', () => {
    it('should build key without version', () => {
      const key = buildCacheKey({
        namespace: 'vault',
        entityType: 'user',
        identifier: '12345',
      });
      expect(key).toBe('vault:user:12345');
    });

    it('should build key with version', () => {
      const key = buildCacheKey({
        namespace: 'leaderboard',
        entityType: 'guild',
        identifier: '67890',
        version: 'v2',
      });
      expect(key).toBe('leaderboard:guild:67890:v2');
    });

    it('should handle identifiers with colons', () => {
      const key = buildCacheKey({
        namespace: 'rpc',
        entityType: 'call',
        identifier: 'eth:balance:0x123',
      });
      expect(key).toBe('rpc:call:eth:balance:0x123');
    });
  });

  describe('parseCacheKey', () => {
    it('should parse key without version', () => {
      const result = parseCacheKey('vault:user:12345');
      expect(result).toEqual({
        namespace: 'vault',
        entityType: 'user',
        identifier: '12345',
        version: undefined,
      });
    });

    it('should parse key with version', () => {
      const result = parseCacheKey('leaderboard:guild:67890:v2');
      expect(result).toEqual({
        namespace: 'leaderboard',
        entityType: 'guild',
        identifier: '67890',
        version: 'v2',
      });
    });

    it('should return null for invalid keys', () => {
      expect(parseCacheKey('invalid')).toBeNull();
      expect(parseCacheKey('too:short')).toBeNull();
    });

    it('should handle complex identifiers', () => {
      const result = parseCacheKey('rpc:call:eth:balance:0x123:v1');
      expect(result).toEqual({
        namespace: 'rpc',
        entityType: 'call',
        identifier: 'eth:balance:0x123',
        version: 'v1',
      });
    });
  });

  describe('CacheKeys', () => {
    it('userVault should generate correct key', () => {
      expect(CacheKeys.userVault('12345')).toBe('vault:user:12345');
    });

    it('userPosition should generate correct key', () => {
      expect(CacheKeys.userPosition('12345', '67890')).toBe('lb:user:12345:guild:67890');
    });

    it('guildLeaderboard should generate correct key', () => {
      expect(CacheKeys.guildLeaderboard('67890')).toBe('lb:guild:67890');
    });

    it('tenantConfig should generate correct key', () => {
      expect(CacheKeys.tenantConfig('67890')).toBe('cfg:guild:67890');
    });

    it('rpcBalance should lowercase wallet address', () => {
      expect(CacheKeys.rpcBalance('0xABCDef123')).toBe('rpc:wallet:0xabcdef123');
    });

    it('tokenMetadata should lowercase token address', () => {
      expect(CacheKeys.tokenMetadata('0xTOKEN123')).toBe('token:token:0xtoken123');
    });

    it('guildStats should generate correct key', () => {
      expect(CacheKeys.guildStats('67890')).toBe('guild:agg:67890');
    });

    it('generic should generate correct key', () => {
      expect(CacheKeys.generic('custom', 'id123')).toBe('gen:custom:id123');
    });
  });

  describe('InvalidationPatterns', () => {
    it('allForUser should return user vault pattern', () => {
      expect(InvalidationPatterns.allForUser('12345')).toBe('vault:user:12345');
    });

    it('guildLeaderboard should return guild leaderboard pattern', () => {
      expect(InvalidationPatterns.guildLeaderboard('67890')).toBe('lb:guild:67890');
    });

    it('allUserPositionsInGuild should return prefix pattern', () => {
      expect(InvalidationPatterns.allUserPositionsInGuild('67890')).toBe('lb:user:');
    });

    it('tenantConfig should return config pattern', () => {
      expect(InvalidationPatterns.tenantConfig('67890')).toBe('cfg:guild:67890');
    });

    it('allRpc should return rpc namespace pattern', () => {
      expect(InvalidationPatterns.allRpc()).toBe('rpc:');
    });

    it('namespace should return namespace pattern', () => {
      expect(InvalidationPatterns.namespace(CacheNamespace.VAULT)).toBe('vault:');
      expect(InvalidationPatterns.namespace(CacheNamespace.CONFIG)).toBe('cfg:');
    });
  });

  describe('CacheNamespace enum', () => {
    it('should have expected values', () => {
      expect(CacheNamespace.VAULT).toBe('vault');
      expect(CacheNamespace.LEADERBOARD).toBe('lb');
      expect(CacheNamespace.CONFIG).toBe('cfg');
      expect(CacheNamespace.RPC).toBe('rpc');
      expect(CacheNamespace.SESSION).toBe('sess');
      expect(CacheNamespace.GUILD).toBe('guild');
      expect(CacheNamespace.TOKEN).toBe('token');
      expect(CacheNamespace.GENERIC).toBe('gen');
    });
  });

  describe('CacheEntityType enum', () => {
    it('should have expected values', () => {
      expect(CacheEntityType.USER).toBe('user');
      expect(CacheEntityType.GUILD).toBe('guild');
      expect(CacheEntityType.WALLET).toBe('wallet');
      expect(CacheEntityType.TOKEN).toBe('token');
      expect(CacheEntityType.AGGREGATE).toBe('agg');
      expect(CacheEntityType.LIST).toBe('list');
      expect(CacheEntityType.VALUE).toBe('val');
    });
  });
});

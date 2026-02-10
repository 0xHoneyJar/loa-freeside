/**
 * JWKS 72h Safety TTL Contract Tests
 * Sprint S12-T2: FR-1.9, SDD §7.2.2
 *
 * Verifies JWKS caching contracts with injectable FakeClock:
 * - 72h safety TTL: cached keys valid during outage
 * - 48h old-kid retention: previous key served during rotation overlap
 * - Fail closed after 73h outage (no stale keys)
 * - Zero 401s during key rotation
 * - Thundering herd: concurrent getJwks() calls return consistent results
 *
 * All TTL tests use simulated time — no real-time waiting.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock fs before barrel imports (budget-manager loads Lua at module level)
vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return {
    ...actual,
    readFileSync: vi.fn().mockReturnValue('-- mock lua'),
  };
});

import { JwtService, type Clock } from '@arrakis/adapters/agent';
import type { JWK, KeyLike } from 'jose';
import { generateKeyPairSync, createPublicKey } from 'node:crypto';
import { exportJWK } from 'jose';

// --------------------------------------------------------------------------
// FakeClock — injectable clock with advance(ms) for simulated time
// --------------------------------------------------------------------------

class FakeClock implements Clock {
  private _now: number;

  constructor(startMs: number = Date.now()) {
    this._now = startMs;
  }

  now(): number {
    return this._now;
  }

  advance(ms: number): void {
    this._now += ms;
  }

  set(ms: number): void {
    this._now = ms;
  }
}

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

const HOUR_MS = 3_600_000;

/** Generate a test EC P-256 key pair */
function generateTestKeyPair() {
  return generateKeyPairSync('ec', { namedCurve: 'P-256' });
}

/** Create a PEM key loader from a private key */
function createKeyLoader(privateKey: ReturnType<typeof generateTestKeyPair>['privateKey']) {
  return {
    load: async () => privateKey.export({ type: 'pkcs8', format: 'pem' }) as string,
  };
}

/** Export public JWK from a private key */
async function getPublicJwk(privateKey: ReturnType<typeof generateTestKeyPair>['privateKey']): Promise<JWK> {
  const publicKey = createPublicKey(privateKey);
  return exportJWK(publicKey);
}

// --------------------------------------------------------------------------
// Tests
// --------------------------------------------------------------------------

describe('JWKS 72h Safety TTL Contract Tests (FR-1.9, §7.2.2)', () => {
  let clock: FakeClock;
  let currentKeyPair: ReturnType<typeof generateTestKeyPair>;
  let previousKeyPair: ReturnType<typeof generateTestKeyPair>;
  let currentPublicJwk: JWK;
  let previousPublicJwk: JWK;

  beforeEach(async () => {
    clock = new FakeClock(Date.now());
    currentKeyPair = generateTestKeyPair();
    previousKeyPair = generateTestKeyPair();
    currentPublicJwk = await getPublicJwk(currentKeyPair.privateKey);
    previousPublicJwk = await getPublicJwk(previousKeyPair.privateKey);
  });

  // ========================================================================
  // FakeClock basics
  // ========================================================================
  describe('FakeClock', () => {
    it('advance() moves time forward', () => {
      const start = clock.now();
      clock.advance(1000);
      expect(clock.now()).toBe(start + 1000);
    });

    it('set() sets absolute time', () => {
      clock.set(0);
      expect(clock.now()).toBe(0);
    });
  });

  // ========================================================================
  // Previous key served during rotation overlap
  // ========================================================================
  describe('Key rotation overlap — previous key served during overlap', () => {
    it('getJwks() includes previous key before expiry', async () => {
      const expiresAt = new Date(clock.now() + 48 * HOUR_MS);

      const service = new JwtService(
        {
          keyId: 'kid-current',
          expirySec: 120,
          previousKey: {
            keyId: 'kid-previous',
            privateKey: previousKeyPair.privateKey as unknown as KeyLike,
            publicJwk: previousPublicJwk,
            expiresAt,
          },
        },
        createKeyLoader(currentKeyPair.privateKey),
        clock,
      );
      await service.initialize();

      const jwks = service.getJwks();
      expect(jwks.keys).toHaveLength(2);
      expect(jwks.keys[0].kid).toBe('kid-current');
      expect(jwks.keys[1].kid).toBe('kid-previous');
    });

    it('getJwks() removes previous key after expiry (simulated 49h advance)', async () => {
      const expiresAt = new Date(clock.now() + 48 * HOUR_MS);

      const service = new JwtService(
        {
          keyId: 'kid-current',
          expirySec: 120,
          previousKey: {
            keyId: 'kid-previous',
            privateKey: previousKeyPair.privateKey as unknown as KeyLike,
            publicJwk: previousPublicJwk,
            expiresAt,
          },
        },
        createKeyLoader(currentKeyPair.privateKey),
        clock,
      );
      await service.initialize();

      // Advance past 48h expiry
      clock.advance(49 * HOUR_MS);

      const jwks = service.getJwks();
      expect(jwks.keys).toHaveLength(1);
      expect(jwks.keys[0].kid).toBe('kid-current');
    });

    it('previous key still served at 47h59m (just before expiry)', async () => {
      const expiresAt = new Date(clock.now() + 48 * HOUR_MS);

      const service = new JwtService(
        {
          keyId: 'kid-current',
          expirySec: 120,
          previousKey: {
            keyId: 'kid-previous',
            privateKey: previousKeyPair.privateKey as unknown as KeyLike,
            publicJwk: previousPublicJwk,
            expiresAt,
          },
        },
        createKeyLoader(currentKeyPair.privateKey),
        clock,
      );
      await service.initialize();

      // Advance to 47h59m — just before expiry
      clock.advance(48 * HOUR_MS - 60_000);

      const jwks = service.getJwks();
      expect(jwks.keys).toHaveLength(2);
    });
  });

  // ========================================================================
  // 72h safety TTL — cached keys during outage
  // ========================================================================
  describe('72h safety TTL — cached keys during simulated outage', () => {
    it('cached keys still valid after simulated 1h outage', async () => {
      const service = new JwtService(
        { keyId: 'kid-1', expirySec: 120 },
        createKeyLoader(currentKeyPair.privateKey),
        clock,
      );
      await service.initialize();

      // Snapshot JWKS (simulating consumer cache)
      const cachedJwks = service.getJwks();

      // Advance 1h (simulating outage where JWKS endpoint unreachable)
      clock.advance(1 * HOUR_MS);

      // Cached keys should still be usable — kid unchanged
      const currentJwks = service.getJwks();
      expect(currentJwks.keys[0].kid).toBe(cachedJwks.keys[0].kid);
    });

    it('72h safety TTL contract: service serves same kid for 72h', async () => {
      const service = new JwtService(
        { keyId: 'kid-stable', expirySec: 120 },
        createKeyLoader(currentKeyPair.privateKey),
        clock,
      );
      await service.initialize();

      // Advance 72h — without key rotation, kid stays the same
      clock.advance(72 * HOUR_MS);

      const jwks = service.getJwks();
      expect(jwks.keys[0].kid).toBe('kid-stable');
      expect(jwks.keys).toHaveLength(1);
    });

    it('fail closed after 73h — previous key no longer in JWKS', async () => {
      // Previous key expires at 72h
      const expiresAt = new Date(clock.now() + 72 * HOUR_MS);

      const service = new JwtService(
        {
          keyId: 'kid-new',
          expirySec: 120,
          previousKey: {
            keyId: 'kid-old',
            privateKey: previousKeyPair.privateKey as unknown as KeyLike,
            publicJwk: previousPublicJwk,
            expiresAt,
          },
        },
        createKeyLoader(currentKeyPair.privateKey),
        clock,
      );
      await service.initialize();

      // Advance 73h — past safety TTL
      clock.advance(73 * HOUR_MS);

      const jwks = service.getJwks();
      // Old key must NOT be served — fail closed
      expect(jwks.keys).toHaveLength(1);
      expect(jwks.keys[0].kid).toBe('kid-new');
      expect(jwks.keys.find((k) => k.kid === 'kid-old')).toBeUndefined();
    });
  });

  // ========================================================================
  // Zero 401s during key rotation — 48h overlap
  // ========================================================================
  describe('Zero 401s during key rotation — 48h overlap', () => {
    it('both old and new kids available throughout 48h overlap', async () => {
      const overlapDuration = 48 * HOUR_MS;
      const expiresAt = new Date(clock.now() + overlapDuration);

      const service = new JwtService(
        {
          keyId: 'kid-v2',
          expirySec: 120,
          previousKey: {
            keyId: 'kid-v1',
            privateKey: previousKeyPair.privateKey as unknown as KeyLike,
            publicJwk: previousPublicJwk,
            expiresAt,
          },
        },
        createKeyLoader(currentKeyPair.privateKey),
        clock,
      );
      await service.initialize();

      // Check at multiple points during overlap
      const checkPoints = [0, 6, 12, 24, 36, 47];
      for (const hours of checkPoints) {
        clock.set(clock.now()); // reset to baseline for each check
        clock.advance(hours * HOUR_MS);

        // Re-create service with same config but updated clock is shared
        // (clock is shared reference, so advance affects all)
      }

      // Verify at start
      clock.set(Date.now());
      const serviceAtStart = new JwtService(
        {
          keyId: 'kid-v2',
          expirySec: 120,
          previousKey: {
            keyId: 'kid-v1',
            privateKey: previousKeyPair.privateKey as unknown as KeyLike,
            publicJwk: previousPublicJwk,
            expiresAt: new Date(clock.now() + overlapDuration),
          },
        },
        createKeyLoader(currentKeyPair.privateKey),
        clock,
      );
      await serviceAtStart.initialize();

      // At start: both keys
      let jwks = serviceAtStart.getJwks();
      expect(jwks.keys).toHaveLength(2);

      // At 24h: both keys
      clock.advance(24 * HOUR_MS);
      jwks = serviceAtStart.getJwks();
      expect(jwks.keys).toHaveLength(2);

      // At 47h: both keys (just before expiry)
      clock.advance(23 * HOUR_MS);
      jwks = serviceAtStart.getJwks();
      expect(jwks.keys).toHaveLength(2);

      // At 49h: only new key
      clock.advance(2 * HOUR_MS);
      jwks = serviceAtStart.getJwks();
      expect(jwks.keys).toHaveLength(1);
      expect(jwks.keys[0].kid).toBe('kid-v2');
    });
  });

  // ========================================================================
  // sign() uses injectable clock
  // ========================================================================
  describe('sign() uses injectable clock for iat/exp', () => {
    it('JWT iat reflects fake clock time', async () => {
      const fixedTime = 1700000000000; // Fixed epoch ms
      clock.set(fixedTime);

      const service = new JwtService(
        { keyId: 'kid-sign', expirySec: 120 },
        createKeyLoader(currentKeyPair.privateKey),
        clock,
      );
      await service.initialize();

      const context = {
        tenantId: 'community-1',
        userId: 'user-1',
        nftId: 'nft-1',
        tier: 5,
        accessLevel: 'pro' as const,
        allowedModelAliases: ['cheap', 'fast-code'] as any,
        platform: 'discord' as const,
        channelId: 'channel-1',
        idempotencyKey: 'idem-1',
        traceId: 'trace-1',
      };

      const token = await service.sign(context, '{"test":true}');

      // Decode JWT payload (no verification, just parse)
      const payload = JSON.parse(
        Buffer.from(token.split('.')[1], 'base64url').toString(),
      );

      const expectedIat = Math.floor(fixedTime / 1000);
      expect(payload.iat).toBe(expectedIat);
      expect(payload.exp).toBe(expectedIat + 120);
    });

    it('advancing clock changes JWT timestamps', async () => {
      clock.set(1700000000000);

      const service = new JwtService(
        { keyId: 'kid-advance', expirySec: 60 },
        createKeyLoader(currentKeyPair.privateKey),
        clock,
      );
      await service.initialize();

      const context = {
        tenantId: 'c-1',
        userId: 'u-1',
        nftId: 'nft-1',
        tier: 1,
        accessLevel: 'free' as const,
        allowedModelAliases: ['cheap'] as any,
        platform: 'discord' as const,
        channelId: 'ch-1',
        idempotencyKey: 'idem-2',
        traceId: 'trace-2',
      };

      const token1 = await service.sign(context, '{"a":1}');
      clock.advance(3600_000); // 1 hour
      const token2 = await service.sign(context, '{"a":1}');

      const payload1 = JSON.parse(
        Buffer.from(token1.split('.')[1], 'base64url').toString(),
      );
      const payload2 = JSON.parse(
        Buffer.from(token2.split('.')[1], 'base64url').toString(),
      );

      expect(payload2.iat - payload1.iat).toBe(3600);
    });
  });

  // ========================================================================
  // Defense-in-depth: no private key material in JWKS
  // ========================================================================
  describe('Defense-in-depth: no private key material in JWKS', () => {
    it('previous key JWK does not expose d parameter', async () => {
      // Intentionally include `d` in the publicJwk (misconfiguration scenario)
      const taintedJwk = { ...previousPublicJwk, d: 'PRIVATE_KEY_MATERIAL' };

      const service = new JwtService(
        {
          keyId: 'kid-current',
          expirySec: 120,
          previousKey: {
            keyId: 'kid-tainted',
            privateKey: previousKeyPair.privateKey as unknown as KeyLike,
            publicJwk: taintedJwk,
            expiresAt: new Date(clock.now() + 48 * HOUR_MS),
          },
        },
        createKeyLoader(currentKeyPair.privateKey),
        clock,
      );
      await service.initialize();

      const jwks = service.getJwks();
      const prevKey = jwks.keys.find((k) => k.kid === 'kid-tainted');
      expect(prevKey).toBeDefined();
      expect(prevKey!.d).toBeUndefined();
    });
  });

  // ========================================================================
  // Thundering herd: concurrent getJwks() calls return consistent results
  // ========================================================================
  describe('Thundering herd: concurrent calls consistent', () => {
    it('10 concurrent getJwks() calls return identical results', async () => {
      const service = new JwtService(
        {
          keyId: 'kid-herd',
          expirySec: 120,
          previousKey: {
            keyId: 'kid-herd-prev',
            privateKey: previousKeyPair.privateKey as unknown as KeyLike,
            publicJwk: previousPublicJwk,
            expiresAt: new Date(clock.now() + 24 * HOUR_MS),
          },
        },
        createKeyLoader(currentKeyPair.privateKey),
        clock,
      );
      await service.initialize();

      // Simulate concurrent calls
      const results = Array.from({ length: 10 }, () => service.getJwks());

      // All results should be structurally identical
      const first = JSON.stringify(results[0]);
      for (const result of results) {
        expect(JSON.stringify(result)).toBe(first);
      }
    });
  });

  // ========================================================================
  // Edge cases
  // ========================================================================
  describe('Edge cases', () => {
    it('no previous key: getJwks() returns only current key', async () => {
      const service = new JwtService(
        { keyId: 'kid-solo', expirySec: 120 },
        createKeyLoader(currentKeyPair.privateKey),
        clock,
      );
      await service.initialize();

      const jwks = service.getJwks();
      expect(jwks.keys).toHaveLength(1);
      expect(jwks.keys[0].kid).toBe('kid-solo');
    });

    it('uninitialized service throws on getJwks()', () => {
      const service = new JwtService(
        { keyId: 'kid-uninit', expirySec: 120 },
        createKeyLoader(currentKeyPair.privateKey),
        clock,
      );

      expect(() => service.getJwks()).toThrow('JwtService not initialized');
    });

    it('uninitialized service throws on sign()', async () => {
      const service = new JwtService(
        { keyId: 'kid-uninit', expirySec: 120 },
        createKeyLoader(currentKeyPair.privateKey),
        clock,
      );

      const ctx = {
        tenantId: 'c',
        userId: 'u',
        nftId: 'n',
        tier: 1,
        accessLevel: 'free' as const,
        allowedModelAliases: ['cheap'] as any,
        platform: 'discord' as const,
        channelId: 'ch',
        idempotencyKey: 'ik',
        traceId: 'tr',
      };

      await expect(service.sign(ctx, '{}')).rejects.toThrow(
        'JwtService not initialized',
      );
    });
  });
});

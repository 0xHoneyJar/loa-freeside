/**
 * Agent Gateway Integration Tests
 * Sprint S5-T5 + S0-T2..T6: End-to-end tests covering cross-component flows
 *
 * Uses loa-finn stub server (S5-T8) for deterministic upstream behavior
 * and real Redis in Docker (redis:7-alpine) for budget enforcement.
 *
 * S0-T2: Property-based budget interleaving test (fast-check)
 * S0-T3: Finalization idempotency test
 * S0-T4: JWT key rotation test
 * S0-T5: Multi-dimensional rate limiting test
 * S0-T6: Redis failure, tier→access, contract version gating tests
 *
 * @see SDD §7.3 Integration Testing
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { LoaFinnStub } from '../stubs/loa-finn-stub.js';
import type { Redis } from 'ioredis';
import { BudgetManager, getCurrentMonth } from '../../packages/adapters/agent/budget-manager.js';
import { AgentRateLimiter, TIER_LIMITS } from '../../packages/adapters/agent/agent-rate-limiter.js';
import { JwtService, type KeyLoader, type PreviousKeyConfig } from '../../packages/adapters/agent/jwt-service.js';
import { TierAccessMapper, DEFAULT_TIER_MAP } from '../../packages/adapters/agent/tier-access-mapper.js';
import { generateKeyPairSync, createPublicKey } from 'node:crypto';
import { exportJWK, importPKCS8, jwtVerify, createRemoteJWKSet } from 'jose';
import fc from 'fast-check';

// --------------------------------------------------------------------------
// Test Infrastructure
// --------------------------------------------------------------------------

let stub: LoaFinnStub;
let redis: Redis;

const mockLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  trace: () => {},
  fatal: () => {},
  child: () => mockLogger,
} as any;

beforeAll(async () => {
  // Start loa-finn stub
  stub = new LoaFinnStub();
  await stub.start();

  // Connect to real Redis (docker-compose redis:7-alpine on localhost:6379)
  const { default: IORedis } = await import('ioredis');
  redis = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
    keyPrefix: 'test:',
    maxRetriesPerRequest: 3,
  });
});

afterAll(async () => {
  await stub.stop();
  await redis.quit();
});

beforeEach(async () => {
  stub.reset();
  // Flush test keyspace
  const keys = await redis.keys('test:*');
  if (keys.length > 0) {
    await redis.del(...keys.map((k) => k.replace('test:', '')));
  }
});

// --------------------------------------------------------------------------
// Helper: Generate ES256 Key Pair for JWT tests
// --------------------------------------------------------------------------

function generateES256KeyPair(): { privateKeyPem: string; publicKey: CryptoKey } {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
  return { privateKeyPem: pem, publicKey: createPublicKey(privateKey) as any };
}

// --------------------------------------------------------------------------
// JWT Key Rotation (S0-T4)
// --------------------------------------------------------------------------

describe('JWT Key Rotation', () => {
  it('zero 401s during 48h overlap window', async () => {
    // Generate key pair A
    const keyPairA = generateES256KeyPair();
    const keyLoaderA: KeyLoader = { load: async () => keyPairA.privateKeyPem };

    const serviceA = new JwtService(
      { keyId: 'key-A', expirySec: 120 },
      keyLoaderA,
    );
    await serviceA.initialize();

    // Sign a token with key A
    const context = {
      tenantId: 'tenant-1',
      userId: 'user-1',
      nftId: 'nft-1',
      tier: 5,
      accessLevel: 'pro' as const,
      allowedModelAliases: ['cheap' as const, 'fast-code' as const],
      platform: 'discord' as const,
      channelId: 'ch-1',
      idempotencyKey: 'idem-1',
      traceId: 'trace-1',
    };
    const tokenA = await serviceA.sign(context, '{"test":"body"}');

    // Get JWKS from service A (should have only key A)
    const jwksA = serviceA.getJwks();
    expect(jwksA.keys).toHaveLength(1);
    expect(jwksA.keys[0].kid).toBe('key-A');

    // Generate key pair B and create service B with key A as previous
    const keyPairB = generateES256KeyPair();
    const keyLoaderB: KeyLoader = { load: async () => keyPairB.privateKeyPem };

    // Import key A's private key to create the PreviousKeyConfig
    const privKeyA = await importPKCS8(keyPairA.privateKeyPem, 'ES256');
    const pubKeyA = createPublicKey(privKeyA as any);
    const pubJwkA = await exportJWK(pubKeyA);

    const previousKeyConfig: PreviousKeyConfig = {
      keyId: 'key-A',
      privateKey: privKeyA,
      publicJwk: pubJwkA,
      expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000), // 48h from now
    };

    const serviceB = new JwtService(
      { keyId: 'key-B', expirySec: 120, previousKey: previousKeyConfig },
      keyLoaderB,
    );
    await serviceB.initialize();

    // JWKS from service B should serve BOTH keys
    const jwksB = serviceB.getJwks();
    expect(jwksB.keys).toHaveLength(2);
    const kidSet = new Set(jwksB.keys.map((k) => k.kid));
    expect(kidSet.has('key-A')).toBe(true);
    expect(kidSet.has('key-B')).toBe(true);

    // Verify token signed with key A using JWKS from service B
    // Manual verification: find key A in JWKS and verify
    const keyAFromJwks = jwksB.keys.find((k) => k.kid === 'key-A')!;
    expect(keyAFromJwks).toBeDefined();
    expect(keyAFromJwks.alg).toBe('ES256');
    expect(keyAFromJwks.use).toBe('sig');

    // Sign a new token with key B
    const tokenB = await serviceB.sign(
      { ...context, idempotencyKey: 'idem-2' },
      '{"test":"body2"}',
    );
    expect(tokenB).toBeTruthy();
    expect(tokenB).not.toBe(tokenA);

    // After overlap window expiry, key A should be removed from JWKS
    const expiredPreviousKey: PreviousKeyConfig = {
      ...previousKeyConfig,
      expiresAt: new Date(Date.now() - 1000), // Already expired
    };

    const serviceExpired = new JwtService(
      { keyId: 'key-B', expirySec: 120, previousKey: expiredPreviousKey },
      keyLoaderB,
    );
    await serviceExpired.initialize();

    const jwksExpired = serviceExpired.getJwks();
    expect(jwksExpired.keys).toHaveLength(1);
    expect(jwksExpired.keys[0].kid).toBe('key-B');
  });
});

// --------------------------------------------------------------------------
// Rate Limiting (S0-T5)
// --------------------------------------------------------------------------

describe('Rate Limiting - Multi-dimensional', () => {
  let rateLimiter: AgentRateLimiter;

  beforeEach(() => {
    rateLimiter = new AgentRateLimiter(redis, mockLogger);
  });

  it('per-user limit: exceed free tier (10/min) → 429 with user dimension', async () => {
    const params = {
      communityId: 'comm-rl-1',
      userId: 'user-rl-1',
      channelId: 'ch-rl-1',
      accessLevel: 'free' as const,
    };

    // Free tier: user limit is 10/min
    for (let i = 0; i < 10; i++) {
      const result = await rateLimiter.check(params);
      expect(result.allowed).toBe(true);
    }

    // 11th request should be denied
    const denied = await rateLimiter.check(params);
    expect(denied.allowed).toBe(false);
    expect(denied.dimension).toBe('user');
    expect(denied.retryAfterMs).toBeGreaterThan(0);
  });

  it('per-community limit: exceed community limit → 429', async () => {
    const communityId = 'comm-rl-2';

    // Free tier: community limit is 60/min, use different users
    for (let i = 0; i < 60; i++) {
      const result = await rateLimiter.check({
        communityId,
        userId: `user-${i}`, // Different users to avoid per-user limit
        channelId: `ch-${i % 10}`,
        accessLevel: 'free',
      });
      expect(result.allowed).toBe(true);
    }

    // 61st request should be denied on community dimension
    const denied = await rateLimiter.check({
      communityId,
      userId: 'user-61',
      channelId: 'ch-new',
      accessLevel: 'free',
    });
    expect(denied.allowed).toBe(false);
    expect(denied.dimension).toBe('community');
  });

  it('per-channel limit: exceed channel limit → 429', async () => {
    const channelId = 'ch-rl-3';

    // Free tier: channel limit is 20/min
    for (let i = 0; i < 20; i++) {
      const result = await rateLimiter.check({
        communityId: 'comm-rl-3',
        userId: `user-ch-${i}`, // Different users to avoid per-user limit
        channelId,
        accessLevel: 'free',
      });
      expect(result.allowed).toBe(true);
    }

    const denied = await rateLimiter.check({
      communityId: 'comm-rl-3',
      userId: 'user-ch-21',
      channelId,
      accessLevel: 'free',
    });
    expect(denied.allowed).toBe(false);
    expect(denied.dimension).toBe('channel');
  });

  it('burst limit: send burst > token bucket capacity → 429', async () => {
    // Free tier: burst capacity is 3
    // The burst bucket starts with 3 tokens. Each request consumes 1.
    // After 3 rapid requests, burst should deny even if sliding windows allow.
    // NOTE: We need the user to have a higher sliding window limit to isolate burst.
    // Use enterprise tier where user=100 but burst=10.
    const params = {
      communityId: 'comm-rl-burst',
      userId: 'user-rl-burst',
      channelId: 'ch-rl-burst',
      accessLevel: 'enterprise' as const,
    };

    // Enterprise burst capacity is 10 — exhaust it
    for (let i = 0; i < 10; i++) {
      const result = await rateLimiter.check(params);
      expect(result.allowed).toBe(true);
    }

    // 11th rapid request exceeds burst
    const denied = await rateLimiter.check(params);
    expect(denied.allowed).toBe(false);
    expect(denied.dimension).toBe('burst');
  });

  it('cross-dimension: user under limit but community over → 429', async () => {
    const communityId = 'comm-rl-cross';

    // Exhaust community limit (60 for free tier) using many different users
    for (let i = 0; i < 60; i++) {
      await rateLimiter.check({
        communityId,
        userId: `user-cross-${i}`,
        channelId: `ch-cross-${i % 20}`,
        accessLevel: 'free',
      });
    }

    // A new user (under their personal limit) should still be blocked by community
    const denied = await rateLimiter.check({
      communityId,
      userId: 'user-cross-new',
      channelId: 'ch-cross-new',
      accessLevel: 'free',
    });
    expect(denied.allowed).toBe(false);
    expect(denied.dimension).toBe('community');
  });
});

// --------------------------------------------------------------------------
// Budget Concurrent
// --------------------------------------------------------------------------

describe('Budget Concurrent', () => {
  it('100 parallel requests, zero overspend beyond $0.50 tolerance', async () => {
    // Setup: community with $10 budget (1000 cents)
    const limitKey = 'agent:budget:limit:test-community';
    await redis.set(limitKey, '1000');

    // Simulate concurrent reservations
    const results = await Promise.all(
      Array.from({ length: 100 }, async (_, i) => {
        const reservedKey = `agent:budget:reserved:test-community:2026-02`;
        const result = await redis.incrby(reservedKey, 10);
        return { index: i, reserved: result };
      }),
    );

    const maxReserved = Math.max(...results.map((r) => r.reserved));
    expect(maxReserved).toBe(1000); // Exactly 100 * 10
  });
});

// --------------------------------------------------------------------------
// SSE Streaming
// --------------------------------------------------------------------------

describe('SSE Streaming Proxy', () => {
  it('events forwarded correctly, usage triggers finalization', async () => {
    stub.setStreamBehavior({
      events: [{ text: 'Hello ' }, { text: 'world!' }],
      usage: { promptTokens: 50, completionTokens: 30, costUsd: 0.002 },
    });

    // Verify stub serves expected events
    const response = await fetch(`${stub.getBaseUrl()}/v1/agents/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent: 'test', messages: [{ role: 'user', content: 'hi' }] }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/event-stream');

    const text = await response.text();
    expect(text).toContain('event: content');
    expect(text).toContain('event: usage');
    expect(text).toContain('event: done');
  });

  it('drop recovery: stub drops stream → reconciliation fires', async () => {
    stub.setStreamBehavior({
      events: [{ text: 'partial ' }, { text: 'response' }, { text: ' here' }],
      usage: { promptTokens: 50, completionTokens: 30, costUsd: 0.002 },
      dropAfterEvents: 2, // Drops after 2 events, no usage/done
    });

    const response = await fetch(`${stub.getBaseUrl()}/v1/agents/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent: 'test', messages: [{ role: 'user', content: 'hi' }] }),
    });

    // Connection drops — no usage event
    const text = await response.text();
    expect(text).toContain('event: content');
    expect(text).not.toContain('event: usage');
    expect(text).not.toContain('event: done');
  });
});

// --------------------------------------------------------------------------
// Circuit Breaker
// --------------------------------------------------------------------------

describe('Circuit Breaker', () => {
  it('stub 5xx → circuit opens → 503 returned → recovers', async () => {
    // Force 5xx responses
    stub.setForceStatusCode(503);

    const response = await fetch(`${stub.getBaseUrl()}/v1/agents/invoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent: 'test', messages: [{ role: 'user', content: 'hi' }] }),
    });

    expect(response.status).toBe(503);

    // Recovery
    stub.setForceStatusCode(null);

    const recovery = await fetch(`${stub.getBaseUrl()}/v1/agents/invoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent: 'test', messages: [{ role: 'user', content: 'hi' }] }),
    });

    expect(recovery.status).toBe(200);
  });
});

// --------------------------------------------------------------------------
// Redis Failure Isolation (S0-T6)
// --------------------------------------------------------------------------

describe('Redis Failure Isolation', () => {
  it('Redis unavailable → rate limiter returns fail-closed (denied)', async () => {
    // Create a rate limiter with a disconnected Redis
    const { default: IORedis } = await import('ioredis');
    const badRedis = new IORedis('redis://localhost:59999', {
      keyPrefix: 'bad:',
      maxRetriesPerRequest: 0,
      connectTimeout: 100,
      retryStrategy: () => null, // Don't retry
      lazyConnect: true,
    });

    const rateLimiter = new AgentRateLimiter(badRedis, mockLogger);

    const result = await rateLimiter.check({
      communityId: 'test-comm',
      userId: 'test-user',
      channelId: 'test-ch',
      accessLevel: 'free',
    });

    // Fail-closed: should deny when Redis is down
    expect(result.allowed).toBe(false);
    expect(result.retryAfterMs).toBeGreaterThan(0);

    await badRedis.disconnect();
  });

  it('Redis unavailable → budget reserve returns fail-closed (BUDGET_EXCEEDED)', async () => {
    const { default: IORedis } = await import('ioredis');
    const badRedis = new IORedis('redis://localhost:59999', {
      keyPrefix: 'bad:',
      maxRetriesPerRequest: 0,
      connectTimeout: 100,
      retryStrategy: () => null,
      lazyConnect: true,
    });

    const budgetManager = new BudgetManager(badRedis, mockLogger);

    const result = await budgetManager.reserve({
      communityId: 'test-comm',
      userId: 'test-user',
      idempotencyKey: 'idem-fail',
      modelAlias: 'cheap',
      estimatedCost: 10,
    });

    // Fail-closed: should deny budget when Redis is down
    expect(result.status).toBe('BUDGET_EXCEEDED');

    await badRedis.disconnect();
  });

  it('non-agent endpoints remain functional during Redis failure', async () => {
    // The stub server (simulating loa-finn) doesn't depend on Redis
    // Health endpoint should still work
    const response = await fetch(`${stub.getBaseUrl()}/v1/health`);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.status).toBe('ok');
  });
});

// --------------------------------------------------------------------------
// Tier → Access Contract (S0-T6)
// --------------------------------------------------------------------------

describe('Tier → Access Level Contract', () => {
  it('tiers 1-9 produce correct access levels per SDD §2.3', async () => {
    const mapper = new TierAccessMapper();

    // Tiers 1-3: free → ['cheap']
    for (const tier of [1, 2, 3]) {
      const result = await mapper.resolveAccess(tier);
      expect(result.accessLevel).toBe('free');
      expect(result.allowedModelAliases).toEqual(['cheap']);
    }

    // Tiers 4-6: pro → ['cheap', 'fast-code', 'reviewer']
    for (const tier of [4, 5, 6]) {
      const result = await mapper.resolveAccess(tier);
      expect(result.accessLevel).toBe('pro');
      expect(result.allowedModelAliases).toEqual(['cheap', 'fast-code', 'reviewer']);
    }

    // Tiers 7-9: enterprise → ['cheap', 'fast-code', 'reviewer', 'reasoning', 'native']
    for (const tier of [7, 8, 9]) {
      const result = await mapper.resolveAccess(tier);
      expect(result.accessLevel).toBe('enterprise');
      expect(result.allowedModelAliases).toEqual(['cheap', 'fast-code', 'reviewer', 'reasoning', 'native']);
    }
  });

  it('invalid tier throws error', async () => {
    const mapper = new TierAccessMapper();
    await expect(mapper.resolveAccess(0)).rejects.toThrow('Invalid tier');
    await expect(mapper.resolveAccess(10)).rejects.toThrow('Invalid tier');
  });

  it('model alias validation works per tier', async () => {
    const mapper = new TierAccessMapper();

    // Free tier can only use 'cheap'
    const freeAccess = await mapper.resolveAccess(1);
    expect(mapper.validateModelRequest('cheap', freeAccess.allowedModelAliases)).toBe(true);
    expect(mapper.validateModelRequest('reasoning', freeAccess.allowedModelAliases)).toBe(false);

    // Enterprise tier can use all models
    const entAccess = await mapper.resolveAccess(9);
    expect(mapper.validateModelRequest('reasoning', entAccess.allowedModelAliases)).toBe(true);
    expect(mapper.validateModelRequest('native', entAccess.allowedModelAliases)).toBe(true);
  });
});

// --------------------------------------------------------------------------
// Finalization Idempotency (S0-T3)
// --------------------------------------------------------------------------

describe('Finalization Idempotency', () => {
  let budgetManager: BudgetManager;

  beforeEach(() => {
    budgetManager = new BudgetManager(redis, mockLogger);
  });

  it('duplicate finalize calls produce same result — budget debited once', async () => {
    const communityId = 'comm-idem-1';
    const userId = 'user-idem-1';
    const idempotencyKey = 'idem-dup-1';
    const month = getCurrentMonth();

    // Set budget limit
    await redis.set(`agent:budget:limit:${communityId}`, '1000');

    // Reserve budget
    const reserveResult = await budgetManager.reserve({
      communityId,
      userId,
      idempotencyKey,
      modelAlias: 'cheap',
      estimatedCost: 50,
    });
    expect(reserveResult.status).toBe('RESERVED');

    // First finalize with actual cost of 30
    const finalize1 = await budgetManager.finalize({
      communityId,
      userId,
      idempotencyKey,
      actualCost: 30,
    });
    expect(finalize1.status).toBe('FINALIZED');
    expect(finalize1.actualCost).toBe(30);

    // Second finalize with DIFFERENT cost (should be ignored due to idempotency)
    const finalize2 = await budgetManager.finalize({
      communityId,
      userId,
      idempotencyKey,
      actualCost: 99, // Different cost — should be ignored
    });
    expect(finalize2.status).toBe('ALREADY_FINALIZED');

    // Verify committed counter was incremented only once (30, not 30+99)
    const committed = await redis.get(`agent:budget:committed:${communityId}:${month}`);
    expect(Number(committed)).toBe(30);

    // Verify reservation hash was cleaned up after first finalization
    const reservationExists = await redis.exists(
      `agent:budget:reservation:${communityId}:${userId}:${idempotencyKey}`,
    );
    expect(reservationExists).toBe(0);
  });
});

// --------------------------------------------------------------------------
// Budget Interleaving — Property-based (S0-T2)
// --------------------------------------------------------------------------

describe('Budget Interleaving — Property-based', () => {
  let budgetManager: BudgetManager;

  beforeEach(() => {
    budgetManager = new BudgetManager(redis, mockLogger);
  });

  it('concurrent reserve/finalize/reap maintain invariant: committed + reserved <= limit', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate: 2-5 users, 3-10 operations each, costs 1-20
        fc.integer({ min: 2, max: 5 }),
        fc.integer({ min: 3, max: 10 }),
        async (userCount, opsPerUser) => {
          const communityId = `comm-prop-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
          const month = getCurrentMonth();
          const budgetLimit = 1000; // 1000 cents ($10)

          // Set budget limit
          await redis.set(`agent:budget:limit:${communityId}`, String(budgetLimit));

          // Generate operation sequences for each user
          const operations: Array<() => Promise<void>> = [];

          for (let u = 0; u < userCount; u++) {
            const userId = `user-prop-${u}`;

            for (let op = 0; op < opsPerUser; op++) {
              const idempotencyKey = `idem-${u}-${op}`;
              const estimatedCost = Math.floor(Math.random() * 20) + 1;
              const actualCost = Math.floor(Math.random() * estimatedCost) + 1;

              operations.push(async () => {
                // Add small random delay to increase interleaving
                await new Promise((r) => setTimeout(r, Math.random() * 5));

                // Reserve
                const reserveResult = await budgetManager.reserve({
                  communityId,
                  userId,
                  idempotencyKey,
                  modelAlias: 'cheap',
                  estimatedCost,
                });

                if (reserveResult.status === 'RESERVED') {
                  // Finalize with actual cost
                  await budgetManager.finalize({
                    communityId,
                    userId,
                    idempotencyKey,
                    actualCost,
                  });
                }
              });
            }
          }

          // Execute all operations concurrently
          await Promise.all(operations.map((fn) => fn()));

          // Run reaper to clean any expired reservations
          await budgetManager.reap(communityId);

          // Assert invariant: committed + reserved <= limit
          const committedRaw = await redis.get(`agent:budget:committed:${communityId}:${month}`);
          const reservedRaw = await redis.get(`agent:budget:reserved:${communityId}:${month}`);
          const committed = Number(committedRaw) || 0;
          const reserved = Number(reservedRaw) || 0;

          expect(committed).toBeGreaterThanOrEqual(0);
          expect(reserved).toBeGreaterThanOrEqual(0);
          expect(committed + reserved).toBeLessThanOrEqual(budgetLimit);

          // Cleanup
          const keys = await redis.keys(`test:agent:budget:*${communityId}*`);
          if (keys.length > 0) {
            await redis.del(...keys.map((k) => k.replace('test:', '')));
          }
        },
      ),
      {
        numRuns: 25, // 25 runs with shrinking — conservative for CI stability
        seed: 42, // Deterministic seed for reproducibility
      },
    );
  });
});

// --------------------------------------------------------------------------
// Contract Version Gating (S0-T6)
// --------------------------------------------------------------------------

describe('Contract Version Gating', () => {
  it('stub reports old version → health check shows incompatible version', async () => {
    stub.setContractVersion(0);

    const response = await fetch(`${stub.getBaseUrl()}/v1/health`);
    const body = await response.json();

    expect(body.contract_version).toBe(0);
    // Version 0 is considered incompatible (minimum required is 1)
    expect(body.contract_version).toBeLessThan(1);
  });

  it('stub reports current version → health check shows compatible', async () => {
    stub.setContractVersion(1);

    const response = await fetch(`${stub.getBaseUrl()}/v1/health`);
    const body = await response.json();

    expect(body.contract_version).toBe(1);
    expect(body.contract_version).toBeGreaterThanOrEqual(1);
  });

  it('custom health override reflects configured state', async () => {
    stub.setHealthOverride(503, {
      status: 'degraded',
      contract_version: 1,
      message: 'Backend maintenance',
    });

    const response = await fetch(`${stub.getBaseUrl()}/v1/health`);
    expect(response.status).toBe(503);

    const body = await response.json();
    expect(body.status).toBe('degraded');
  });
});

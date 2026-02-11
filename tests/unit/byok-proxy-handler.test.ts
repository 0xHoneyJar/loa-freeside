/**
 * BYOK Proxy Handler Unit Tests
 * Sprint 3, Task 3.4: SSRF defense, replay protection, provider allowlist
 *
 * @see SDD §3.4.5 BYOK Proxy Handler
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';
import {
  BYOKProxyHandler,
  BYOKProxyError,
  isPrivateIP,
} from '../../packages/adapters/agent/byok-proxy-handler.js';
import { resolveEndpoint, getAllowedHostnames } from '../../packages/adapters/agent/byok-provider-endpoints.js';
import { BYOKManager } from '../../packages/adapters/agent/byok-manager.js';
import type { KMSAdapter, BYOKStore, BYOKKeyRecord } from '../../packages/adapters/agent/byok-manager.js';

// --------------------------------------------------------------------------
// Mock Factories
// --------------------------------------------------------------------------

function createMockKMS(): KMSAdapter {
  return {
    encrypt: vi.fn(async (p: Buffer) => { const o = Buffer.from(p); for (let i = 0; i < o.length; i++) o[i] ^= 0xAA; return o; }),
    decrypt: vi.fn(async (c: Buffer) => { const o = Buffer.from(c); for (let i = 0; i < o.length; i++) o[i] ^= 0xAA; return o; }),
  };
}

function createMockStore(): BYOKStore {
  const records: BYOKKeyRecord[] = [];
  return {
    insert: vi.fn(async (r: BYOKKeyRecord) => { records.push({ ...r, createdAt: new Date(), updatedAt: new Date(), revokedAt: null }); }),
    findActive: vi.fn(async (cid: string, prov: string) => records.find((r) => r.communityId === cid && r.provider === prov && !r.revokedAt) ?? null),
    listByCommunity: vi.fn(async (cid: string) => records.filter((r) => r.communityId === cid)),
    revoke: vi.fn(async (id: string) => { const r = records.find((rec) => rec.id === id); if (r) r.revokedAt = new Date(); }),
    rotateAtomic: vi.fn(async (rid: string, nr: BYOKKeyRecord) => {
      const old = records.find((rec) => rec.id === rid); if (old) old.revokedAt = new Date();
      records.push({ ...nr, createdAt: new Date(), updatedAt: new Date(), revokedAt: null });
    }),
  };
}

function createMockRedis() {
  const store = new Map<string, string>();
  const counters = new Map<string, number>();
  return {
    set: vi.fn(async (...args: any[]) => {
      const [key, value, ...rest] = args;
      // SETNX behavior
      if (rest.includes('NX')) {
        if (store.has(key)) return null;
        store.set(key, value);
        return 'OK';
      }
      store.set(key, value);
      return 'OK';
    }),
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    del: vi.fn(async (key: string) => { store.delete(key); return 1; }),
    exists: vi.fn(async (key: string) => store.has(key) ? 1 : 0),
    incr: vi.fn(async (key: string) => {
      const v = (counters.get(key) ?? 0) + 1;
      counters.set(key, v);
      return v;
    }),
    expire: vi.fn(async () => 1),
    _store: store,
    _counters: counters,
  };
}

function createMockLogger() {
  return {
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
    child: vi.fn().mockReturnThis(),
  };
}

function makeReqHash(body: string): string {
  return createHash('sha256').update(body).digest('hex');
}

async function makeHandler() {
  const kms = createMockKMS();
  const store = createMockStore();
  const redis = createMockRedis();
  const logger = createMockLogger();
  const byokManager = new BYOKManager(kms, store, redis as any, logger as any);

  // Pre-store a test key
  await byokManager.storeKey('c1', 'openai', Buffer.from('sk-test-key-AAAA'), 'admin');
  await byokManager.storeKey('c1', 'anthropic', Buffer.from('sk-ant-test-BBBB'), 'admin');

  const handler = new BYOKProxyHandler(byokManager, redis as any, logger as any);

  // Mock DNS to return public IP
  handler.dnsResolve = vi.fn(async () => [{ address: '104.18.7.96', family: 4 }]);

  // Mock HTTP fetch
  handler.httpFetch = vi.fn(async () => new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })) as any;

  return { handler, redis, logger, byokManager };
}

// --------------------------------------------------------------------------
// Provider Endpoints Allowlist
// --------------------------------------------------------------------------

describe('provider endpoints allowlist', () => {
  it('resolves openai chat.completions', () => {
    const ep = resolveEndpoint('openai', 'chat.completions');
    expect(ep).not.toBeNull();
    expect(ep!.hostname).toBe('api.openai.com');
    expect(ep!.port).toBe(443);
  });

  it('resolves anthropic messages', () => {
    const ep = resolveEndpoint('anthropic', 'messages');
    expect(ep).not.toBeNull();
    expect(ep!.hostname).toBe('api.anthropic.com');
  });

  // AC-4.19: Unknown provider → null
  it('returns null for unknown provider', () => {
    expect(resolveEndpoint('unknown-provider', 'chat.completions')).toBeNull();
  });

  // AC-4.20: Unknown operation → null
  it('returns null for unknown operation on valid provider', () => {
    expect(resolveEndpoint('openai', 'unknown-op')).toBeNull();
  });

  it('getAllowedHostnames returns expected hosts', () => {
    const hosts = getAllowedHostnames();
    expect(hosts).toContain('api.openai.com');
    expect(hosts).toContain('api.anthropic.com');
  });
});

// --------------------------------------------------------------------------
// AC-4.22: Private IP blocking
// --------------------------------------------------------------------------

describe('AC-4.22: private IP blocking', () => {
  // IPv4 private ranges
  it('blocks 10.0.0.0/8', () => expect(isPrivateIP('10.0.0.1')).toBe(true));
  it('blocks 172.16.0.0/12', () => expect(isPrivateIP('172.16.0.1')).toBe(true));
  it('blocks 192.168.0.0/16', () => expect(isPrivateIP('192.168.1.1')).toBe(true));
  it('blocks 127.0.0.0/8 (loopback)', () => expect(isPrivateIP('127.0.0.1')).toBe(true));
  it('blocks 169.254.0.0/16 (link-local)', () => expect(isPrivateIP('169.254.169.254')).toBe(true));
  it('allows public IPv4', () => expect(isPrivateIP('104.18.7.96')).toBe(false));
  it('allows public IPv4 (8.8.8.8)', () => expect(isPrivateIP('8.8.8.8')).toBe(false));

  // IPv6 private ranges
  it('blocks ::1 (loopback)', () => expect(isPrivateIP('::1')).toBe(true));
  it('blocks fc00::/7 (unique local)', () => expect(isPrivateIP('fc00::1')).toBe(true));
  it('blocks fd00::1 (unique local)', () => expect(isPrivateIP('fd00::1')).toBe(true));
  it('blocks fe80::/10 (link-local)', () => expect(isPrivateIP('fe80::1')).toBe(true));
  it('allows public IPv6', () => expect(isPrivateIP('2607:f8b0:4004:800::200e')).toBe(false));
});

// --------------------------------------------------------------------------
// AC-4.19: Unknown provider in JWT → 400
// --------------------------------------------------------------------------

describe('AC-4.19: unknown provider → 400', () => {
  it('rejects unknown provider', async () => {
    const { handler } = await makeHandler();
    const body = JSON.stringify({ model: 'test' });

    await expect(handler.handle({
      communityId: 'c1',
      provider: 'unknown-provider',
      operation: 'chat.completions',
      jti: 'jti-1',
      body,
      reqHash: makeReqHash(body),
    })).rejects.toThrow(BYOKProxyError);

    try {
      await handler.handle({
        communityId: 'c1', provider: 'unknown-provider', operation: 'chat.completions',
        jti: 'jti-1b', body, reqHash: makeReqHash(body),
      });
    } catch (err) {
      expect((err as BYOKProxyError).code).toBe('BYOK_UNKNOWN_PROVIDER');
      expect((err as BYOKProxyError).statusCode).toBe(400);
    }
  });
});

// --------------------------------------------------------------------------
// AC-4.20: Unknown operation → 400
// --------------------------------------------------------------------------

describe('AC-4.20: unknown operation → 400', () => {
  it('rejects unknown operation for valid provider', async () => {
    const { handler } = await makeHandler();
    const body = JSON.stringify({ model: 'test' });

    try {
      await handler.handle({
        communityId: 'c1', provider: 'openai', operation: 'invalid-op',
        jti: 'jti-2', body, reqHash: makeReqHash(body),
      });
    } catch (err) {
      expect((err as BYOKProxyError).code).toBe('BYOK_UNKNOWN_OPERATION');
      expect((err as BYOKProxyError).statusCode).toBe(400);
    }
  });
});

// --------------------------------------------------------------------------
// AC-4.6: JTI + req_hash replay protection
// --------------------------------------------------------------------------

describe('AC-4.6: replay protection', () => {
  it('rejects duplicate JTI', async () => {
    const { handler } = await makeHandler();
    const body = JSON.stringify({ model: 'gpt-4' });
    const hash = makeReqHash(body);

    // First request succeeds
    await handler.handle({
      communityId: 'c1', provider: 'openai', operation: 'chat.completions',
      jti: 'unique-jti-1', body, reqHash: hash,
    });

    // Same JTI → replay rejected
    await expect(handler.handle({
      communityId: 'c1', provider: 'openai', operation: 'chat.completions',
      jti: 'unique-jti-1', body, reqHash: hash,
    })).rejects.toThrow('Duplicate JTI');
  });

  it('rejects mismatched req_hash', async () => {
    const { handler } = await makeHandler();
    const body = JSON.stringify({ model: 'gpt-4' });

    await expect(handler.handle({
      communityId: 'c1', provider: 'openai', operation: 'chat.completions',
      jti: 'jti-hash-test', body, reqHash: 'wrong-hash-value',
    })).rejects.toThrow('hash mismatch');
  });
});

// --------------------------------------------------------------------------
// AC-4.22: DNS resolving to private IP → rejected
// --------------------------------------------------------------------------

describe('AC-4.22: DNS to private IP → SSRF blocked', () => {
  it('blocks DNS resolving to private IPv4', async () => {
    const { handler } = await makeHandler();
    handler.dnsResolve = vi.fn(async () => [{ address: '10.0.0.1', family: 4 }]);

    const body = JSON.stringify({ model: 'gpt-4' });
    await expect(handler.handle({
      communityId: 'c1', provider: 'openai', operation: 'chat.completions',
      jti: 'jti-ssrf-1', body, reqHash: makeReqHash(body),
    })).rejects.toThrow('private IP');
  });

  it('blocks DNS resolving to private IPv6', async () => {
    const { handler } = await makeHandler();
    handler.dnsResolve = vi.fn(async () => [{ address: 'fc00::1', family: 6 }]);

    const body = JSON.stringify({ model: 'test' });
    await expect(handler.handle({
      communityId: 'c1', provider: 'openai', operation: 'chat.completions',
      jti: 'jti-ssrf-2', body, reqHash: makeReqHash(body),
    })).rejects.toThrow('private IP');
  });
});

// --------------------------------------------------------------------------
// AC-4.23: Redirect attempt → rejected
// --------------------------------------------------------------------------

describe('AC-4.23: redirect → rejected', () => {
  it('rejects redirect from provider', async () => {
    const { handler } = await makeHandler();
    handler.httpFetch = vi.fn(async () => {
      throw new TypeError('fetch failed: redirect mode is set to error');
    }) as any;

    const body = JSON.stringify({ model: 'gpt-4' });
    await expect(handler.handle({
      communityId: 'c1', provider: 'openai', operation: 'chat.completions',
      jti: 'jti-redirect-1', body, reqHash: makeReqHash(body),
    })).rejects.toThrow('redirect');
  });
});

// --------------------------------------------------------------------------
// AC-4.11: Egress restricted to allowlisted domains
// --------------------------------------------------------------------------

describe('AC-4.11: allowlisted egress only', () => {
  it('successful request to openai', async () => {
    const { handler } = await makeHandler();
    const body = JSON.stringify({ model: 'gpt-4', messages: [] });

    const result = await handler.handle({
      communityId: 'c1', provider: 'openai', operation: 'chat.completions',
      jti: 'jti-success-1', body, reqHash: makeReqHash(body),
    });

    expect(result.status).toBe(200);
  });

  it('successful request to anthropic', async () => {
    const { handler } = await makeHandler();
    const body = JSON.stringify({ model: 'claude-3', messages: [] });

    const result = await handler.handle({
      communityId: 'c1', provider: 'anthropic', operation: 'messages',
      jti: 'jti-success-2', body, reqHash: makeReqHash(body),
    });

    expect(result.status).toBe(200);
  });
});

// --------------------------------------------------------------------------
// Redis unavailability policies (IMP-010)
// --------------------------------------------------------------------------

describe('Redis unavailability policies', () => {
  it('JTI check: fail-closed when Redis unavailable', async () => {
    const { handler, redis } = await makeHandler();
    redis.set.mockRejectedValueOnce(new Error('Redis connection refused'));

    const body = JSON.stringify({ model: 'gpt-4' });
    await expect(handler.handle({
      communityId: 'c1', provider: 'openai', operation: 'chat.completions',
      jti: 'jti-redis-down', body, reqHash: makeReqHash(body),
    })).rejects.toThrow('Replay protection unavailable');
  });

  it('rate limit: fail-open when Redis unavailable', async () => {
    const { handler, redis } = await makeHandler();

    // incr fails (rate limit uses incr), but set works (JTI uses set)
    redis.incr = vi.fn().mockRejectedValue(new Error('Redis connection refused'));

    const body = JSON.stringify({ model: 'gpt-4' });
    // Should succeed despite rate limit Redis failure (fail-open)
    const result = await handler.handle({
      communityId: 'c1', provider: 'openai', operation: 'chat.completions',
      jti: 'jti-rate-open', body, reqHash: makeReqHash(body),
    });

    expect(result.status).toBe(200);
  });
});

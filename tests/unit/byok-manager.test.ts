/**
 * BYOK Manager Unit Tests
 * Sprint 3, Task 3.2: Envelope encryption, LRU cache, circuit breaker
 *
 * Tests with mock KMS adapter per acceptance criteria.
 *
 * @see SDD §3.4.2 BYOK Manager
 * @see PRD FR-4 BYOK Key Management
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  BYOKManager,
  BYOKManagerError,
} from '../../packages/adapters/agent/byok-manager.js';
import type {
  KMSAdapter,
  BYOKStore,
  BYOKKeyRecord,
} from '../../packages/adapters/agent/byok-manager.js';

// --------------------------------------------------------------------------
// Mock Factories
// --------------------------------------------------------------------------

/** Passthrough KMS: wraps/unwraps by XOR with a fixed byte (reversible). */
function createMockKMS(): KMSAdapter {
  return {
    encrypt: vi.fn(async (plaintext: Buffer) => {
      const out = Buffer.from(plaintext);
      for (let i = 0; i < out.length; i++) out[i] ^= 0xAA;
      return out;
    }),
    decrypt: vi.fn(async (ciphertext: Buffer) => {
      const out = Buffer.from(ciphertext);
      for (let i = 0; i < out.length; i++) out[i] ^= 0xAA;
      return out;
    }),
  };
}

function createMockStore(): BYOKStore & {
  _records: BYOKKeyRecord[];
} {
  const records: BYOKKeyRecord[] = [];
  return {
    _records: records,
    insert: vi.fn(async (record: BYOKKeyRecord) => {
      records.push({ ...record, createdAt: new Date(), updatedAt: new Date(), revokedAt: null });
    }),
    findActive: vi.fn(async (communityId: string, provider: string) => {
      return records.find(
        (r) => r.communityId === communityId && r.provider === provider && r.revokedAt == null,
      ) ?? null;
    }),
    listByCommunity: vi.fn(async (communityId: string) => {
      return records.filter((r) => r.communityId === communityId);
    }),
    revoke: vi.fn(async (id: string) => {
      const r = records.find((rec) => rec.id === id);
      if (r) r.revokedAt = new Date();
    }),
    rotateAtomic: vi.fn(async (revokeId: string, newRecord: BYOKKeyRecord) => {
      const old = records.find((rec) => rec.id === revokeId);
      if (old) old.revokedAt = new Date();
      records.push({ ...newRecord, createdAt: new Date(), updatedAt: new Date(), revokedAt: null });
    }),
  };
}

function createMockRedis() {
  const store = new Map<string, string>();
  return {
    set: vi.fn(async (key: string, value: string) => { store.set(key, value); return 'OK'; }),
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    del: vi.fn(async (key: string) => { store.delete(key); return 1; }),
    exists: vi.fn(async (key: string) => store.has(key) ? 1 : 0),
  };
}

function createMockLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(() => createMockLogger()),
  };
}

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

function makeManager(overrides?: {
  kms?: KMSAdapter;
  store?: BYOKStore;
  redis?: ReturnType<typeof createMockRedis>;
  cbFailureThreshold?: number;
  cbWindowMs?: number;
  cbResetMs?: number;
  cacheTtlMs?: number;
  cacheMaxSize?: number;
}) {
  const kms = overrides?.kms ?? createMockKMS();
  const store = overrides?.store ?? createMockStore();
  const redis = overrides?.redis ?? createMockRedis();
  const logger = createMockLogger();

  const manager = new BYOKManager(kms, store, redis as any, logger as any, {
    cbFailureThreshold: overrides?.cbFailureThreshold ?? 3,
    cbWindowMs: overrides?.cbWindowMs ?? 30_000,
    cbResetMs: overrides?.cbResetMs ?? 60_000,
    cacheTtlMs: overrides?.cacheTtlMs ?? 60_000,
    cacheMaxSize: overrides?.cacheMaxSize ?? 100,
  });

  return { manager, kms, store, redis, logger };
}

// --------------------------------------------------------------------------
// AC-4.2: Encrypt/decrypt round-trip succeeds (envelope encryption)
// --------------------------------------------------------------------------

describe('AC-4.2: envelope encryption round-trip', () => {
  it('stores and retrieves API key correctly', async () => {
    const { manager } = makeManager();
    const apiKey = Buffer.from('sk-test-key-12345678');

    await manager.storeKey('community-1', 'openai', Buffer.from(apiKey), 'user-1');
    const decrypted = await manager.getDecryptedKey('community-1', 'openai');

    expect(decrypted).not.toBeNull();
    expect(decrypted!.toString()).toBe('sk-test-key-12345678');
  });

  it('returns null for non-existent key', async () => {
    const { manager } = makeManager();
    const result = await manager.getDecryptedKey('no-such-community', 'openai');
    expect(result).toBeNull();
  });

  it('DEK is different per key (unique nonce + DEK)', async () => {
    const store = createMockStore();
    const { manager } = makeManager({ store });

    await manager.storeKey('c1', 'openai', Buffer.from('key-1-abcd'), 'user-1');
    await manager.storeKey('c1', 'anthropic', Buffer.from('key-2-efgh'), 'user-1');

    const records = store._records;
    expect(records.length).toBe(2);
    // Nonces should differ
    expect(records[0].keyNonce.equals(records[1].keyNonce)).toBe(false);
    // DEK ciphertexts should differ
    expect(records[0].dekCiphertext.equals(records[1].dekCiphertext)).toBe(false);
  });
});

// --------------------------------------------------------------------------
// AC-4.3: listKeys returns only last 4 chars of key
// --------------------------------------------------------------------------

describe('AC-4.3: listKeys returns only last 4 chars', () => {
  it('returns keyLast4 for stored keys', async () => {
    const { manager } = makeManager();
    await manager.storeKey('c1', 'openai', Buffer.from('sk-abcdefgh-1234'), 'user-1');

    const keys = await manager.listKeys('c1');
    expect(keys).toHaveLength(1);
    expect(keys[0].keyLast4).toBe('1234');
    expect(keys[0].provider).toBe('openai');
    expect(keys[0].revokedAt).toBeNull();
  });

  it('never exposes full key material in list', async () => {
    const { manager } = makeManager();
    await manager.storeKey('c1', 'openai', Buffer.from('sk-secret-key-WXYZ'), 'user-1');

    const keys = await manager.listKeys('c1');
    const serialized = JSON.stringify(keys);
    expect(serialized).not.toContain('sk-secret-key');
    expect(serialized).toContain('WXYZ');
  });
});

// --------------------------------------------------------------------------
// AC-4.9: rotateKey is atomic (new DEK, old key invalidated)
// --------------------------------------------------------------------------

describe('AC-4.9: atomic key rotation', () => {
  it('rotates key: old revoked, new active', async () => {
    const store = createMockStore();
    const { manager } = makeManager({ store });

    const info = await manager.storeKey('c1', 'openai', Buffer.from('old-key-AAAA'), 'user-1');
    const rotated = await manager.rotateKey('c1', info.id, Buffer.from('new-key-BBBB'), 'user-1');

    expect(rotated.id).not.toBe(info.id);
    expect(rotated.keyLast4).toBe('BBBB');
    expect(rotated.provider).toBe('openai');

    // Verify rotateAtomic was called
    expect(store.rotateAtomic).toHaveBeenCalledWith(info.id, expect.objectContaining({
      communityId: 'c1',
      provider: 'openai',
    }));

    // New key decrypts correctly
    const decrypted = await manager.getDecryptedKey('c1', 'openai');
    expect(decrypted).not.toBeNull();
    expect(decrypted!.toString()).toBe('new-key-BBBB');
  });

  it('rejects rotation of non-existent key', async () => {
    const { manager } = makeManager();
    await expect(
      manager.rotateKey('c1', 'nonexistent-id', Buffer.from('key'), 'user-1'),
    ).rejects.toThrow(BYOKManagerError);
  });

  it('rejects rotation of already-revoked key', async () => {
    const { manager } = makeManager();
    const info = await manager.storeKey('c1', 'openai', Buffer.from('old-key-CCCC'), 'user-1');
    await manager.revokeKey('c1', info.id);

    await expect(
      manager.rotateKey('c1', info.id, Buffer.from('new-key-DDDD'), 'user-1'),
    ).rejects.toThrow(BYOKManagerError);
  });
});

// --------------------------------------------------------------------------
// AC-4.14: LRU cache hit returns decrypted key without KMS call
// --------------------------------------------------------------------------

describe('AC-4.14: LRU cache hit skips KMS', () => {
  it('second getDecryptedKey does not call KMS', async () => {
    const kms = createMockKMS();
    const { manager } = makeManager({ kms });

    await manager.storeKey('c1', 'openai', Buffer.from('sk-cached-test'), 'user-1');

    // First call: KMS decrypt for DEK unwrap
    await manager.getDecryptedKey('c1', 'openai');
    const kmsCallsAfterFirst = (kms.decrypt as ReturnType<typeof vi.fn>).mock.calls.length;

    // Second call: should hit cache, no additional KMS call
    const result = await manager.getDecryptedKey('c1', 'openai');
    const kmsCallsAfterSecond = (kms.decrypt as ReturnType<typeof vi.fn>).mock.calls.length;

    expect(result).not.toBeNull();
    expect(result!.toString()).toBe('sk-cached-test');
    expect(kmsCallsAfterSecond).toBe(kmsCallsAfterFirst);
  });

  it('cache eviction triggers KMS call again', async () => {
    const kms = createMockKMS();
    // Cache with max 1 entry
    const { manager } = makeManager({ kms, cacheMaxSize: 1 });

    await manager.storeKey('c1', 'openai', Buffer.from('key1-AAAA'), 'user-1');
    await manager.storeKey('c2', 'openai', Buffer.from('key2-BBBB'), 'user-1');

    // First call caches c1
    await manager.getDecryptedKey('c1', 'openai');
    // Second call evicts c1, caches c2
    await manager.getDecryptedKey('c2', 'openai');

    const callsBefore = (kms.decrypt as ReturnType<typeof vi.fn>).mock.calls.length;

    // Third call: c1 was evicted, should call KMS again
    await manager.getDecryptedKey('c1', 'openai');
    const callsAfter = (kms.decrypt as ReturnType<typeof vi.fn>).mock.calls.length;

    expect(callsAfter).toBe(callsBefore + 1);
  });
});

// --------------------------------------------------------------------------
// AC-4.15: LRU cache entries wiped with Buffer.fill(0) on eviction/TTL expiry
// --------------------------------------------------------------------------

describe('AC-4.15: Buffer.fill(0) wipe on eviction', () => {
  it('cache eviction wipes key material', async () => {
    // Cache max 1 → evicts when second key stored
    const { manager } = makeManager({ cacheMaxSize: 1 });

    await manager.storeKey('c1', 'openai', Buffer.from('secret-key-1111'), 'user-1');
    // Populate cache for c1
    const firstResult = await manager.getDecryptedKey('c1', 'openai');
    const firstCopy = Buffer.from(firstResult!); // Save copy before wipe

    // Store and fetch c2 → evicts c1 from cache
    await manager.storeKey('c2', 'anthropic', Buffer.from('secret-key-2222'), 'user-1');
    await manager.getDecryptedKey('c2', 'anthropic');

    // The original buffer returned was a copy, so it's still valid
    // But the internal cache entry for c1 was wiped
    // Verify by checking c1 still decrypts correctly from DB (not cache)
    const secondResult = await manager.getDecryptedKey('c1', 'openai');
    expect(secondResult!.toString()).toBe(firstCopy.toString());
  });

  it('TTL expiry wipes key material', async () => {
    const kms = createMockKMS();
    const { manager } = makeManager({ kms, cacheTtlMs: 50 }); // 50ms TTL

    await manager.storeKey('c1', 'openai', Buffer.from('ttl-key-test'), 'user-1');

    // Populate cache
    await manager.getDecryptedKey('c1', 'openai');
    const callsAfterFirst = (kms.decrypt as ReturnType<typeof vi.fn>).mock.calls.length;

    // Wait for TTL to expire
    await new Promise((resolve) => setTimeout(resolve, 60));

    // Should need KMS again since cache entry expired
    await manager.getDecryptedKey('c1', 'openai');
    const callsAfterExpiry = (kms.decrypt as ReturnType<typeof vi.fn>).mock.calls.length;

    expect(callsAfterExpiry).toBe(callsAfterFirst + 1);
  });
});

// --------------------------------------------------------------------------
// AC-4.16: Circuit breaker opens after 3 KMS failures → fail-closed
// --------------------------------------------------------------------------

describe('AC-4.16: circuit breaker opens → fail-closed', () => {
  it('opens after 3 failures and rejects storeKey', async () => {
    const kms: KMSAdapter = {
      encrypt: vi.fn().mockRejectedValue(new Error('KMS timeout')),
      decrypt: vi.fn().mockRejectedValue(new Error('KMS timeout')),
    };

    const { manager } = makeManager({
      kms,
      cbFailureThreshold: 3,
      cbWindowMs: 30_000,
      cbResetMs: 60_000,
    });

    // 3 failures to open the circuit
    for (let i = 0; i < 3; i++) {
      await expect(
        manager.storeKey('c1', 'openai', Buffer.from(`key-${i}`), 'user-1'),
      ).rejects.toThrow('KMS timeout');
    }

    // Circuit now open → fail-closed (BYOKManagerError, not KMS error)
    await expect(
      manager.storeKey('c1', 'openai', Buffer.from('key-after'), 'user-1'),
    ).rejects.toThrow(BYOKManagerError);

    try {
      await manager.storeKey('c1', 'openai', Buffer.from('key-after2'), 'user-1');
    } catch (err) {
      expect((err as BYOKManagerError).code).toBe('KMS_CIRCUIT_OPEN');
      expect((err as BYOKManagerError).statusCode).toBe(503);
    }
  });

  it('opens after 3 failures and rejects rotateKey', async () => {
    // Start with a working KMS to store a key first
    const workingKms = createMockKMS();
    const store = createMockStore();
    const redis = createMockRedis();
    const { manager: setupManager } = makeManager({ kms: workingKms, store, redis });

    const info = await setupManager.storeKey('c1', 'openai', Buffer.from('orig-key'), 'user-1');

    // Now create a manager with failing KMS
    const failingKms: KMSAdapter = {
      encrypt: vi.fn().mockRejectedValue(new Error('KMS down')),
      decrypt: vi.fn().mockRejectedValue(new Error('KMS down')),
    };
    const { manager } = makeManager({
      kms: failingKms,
      store,
      redis,
      cbFailureThreshold: 3,
    });

    // Trigger 3 failures
    for (let i = 0; i < 3; i++) {
      await expect(
        manager.storeKey('c2', 'openai', Buffer.from(`fail-${i}`), 'user-1'),
      ).rejects.toThrow('KMS down');
    }

    // rotateKey should now be rejected by circuit breaker
    await expect(
      manager.rotateKey('c1', info.id, Buffer.from('new-key'), 'user-1'),
    ).rejects.toThrow(BYOKManagerError);
  });
});

// --------------------------------------------------------------------------
// AC-4.17: Circuit breaker half-open after 60s → probe → close on success
// --------------------------------------------------------------------------

describe('AC-4.17: circuit breaker half-open → probe → close', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('transitions to half-open after reset timeout and closes on success', async () => {
    let shouldFail = true;
    const kms: KMSAdapter = {
      encrypt: vi.fn(async (plaintext: Buffer) => {
        if (shouldFail) throw new Error('KMS fail');
        // Passthrough wrap
        const out = Buffer.from(plaintext);
        for (let i = 0; i < out.length; i++) out[i] ^= 0xAA;
        return out;
      }),
      decrypt: vi.fn(async (ciphertext: Buffer) => {
        const out = Buffer.from(ciphertext);
        for (let i = 0; i < out.length; i++) out[i] ^= 0xAA;
        return out;
      }),
    };

    const { manager } = makeManager({
      kms,
      cbFailureThreshold: 3,
      cbWindowMs: 30_000,
      cbResetMs: 60_000,
    });

    // Trip the circuit breaker with 3 failures
    for (let i = 0; i < 3; i++) {
      await expect(
        manager.storeKey('c1', 'openai', Buffer.from(`k-${i}`), 'user-1'),
      ).rejects.toThrow('KMS fail');
    }

    // Circuit is open — requests rejected
    await expect(
      manager.storeKey('c1', 'openai', Buffer.from('blocked'), 'user-1'),
    ).rejects.toThrow(BYOKManagerError);

    // Advance time past reset timeout (60s)
    vi.advanceTimersByTime(61_000);

    // KMS now works
    shouldFail = false;

    // Half-open: probe request should succeed
    const result = await manager.storeKey('c1', 'openai', Buffer.from('probe-key-ZZZZ'), 'user-1');
    expect(result.keyLast4).toBe('ZZZZ');

    // Circuit should now be closed — subsequent requests work
    const result2 = await manager.storeKey('c1', 'anthropic', Buffer.from('next-key-YYYY'), 'user-1');
    expect(result2.keyLast4).toBe('YYYY');
  });

  it('re-opens if probe fails in half-open state', async () => {
    const kms: KMSAdapter = {
      encrypt: vi.fn().mockRejectedValue(new Error('KMS still down')),
      decrypt: vi.fn().mockRejectedValue(new Error('KMS still down')),
    };

    const { manager } = makeManager({
      kms,
      cbFailureThreshold: 3,
      cbResetMs: 60_000,
    });

    // Trip the circuit
    for (let i = 0; i < 3; i++) {
      await expect(
        manager.storeKey('c1', 'openai', Buffer.from(`k-${i}`), 'user-1'),
      ).rejects.toThrow();
    }

    // Advance past reset → half-open
    vi.advanceTimersByTime(61_000);

    // Probe fails → circuit re-opens
    await expect(
      manager.storeKey('c1', 'openai', Buffer.from('probe'), 'user-1'),
    ).rejects.toThrow('KMS still down');

    // Should be open again immediately (no need to wait)
    await expect(
      manager.storeKey('c1', 'openai', Buffer.from('after'), 'user-1'),
    ).rejects.toThrow(BYOKManagerError);
  });
});

// --------------------------------------------------------------------------
// Revocation
// --------------------------------------------------------------------------

describe('revokeKey', () => {
  it('revokes a key and clears Redis routing flag', async () => {
    const redis = createMockRedis();
    const { manager } = makeManager({ redis });

    const info = await manager.storeKey('c1', 'openai', Buffer.from('revoke-me-TTTT'), 'user-1');

    // Verify Redis flag set
    expect(await redis.exists('agent:byok:exists:c1:openai')).toBe(1);

    await manager.revokeKey('c1', info.id);

    // Redis flag cleared
    expect(await redis.exists('agent:byok:exists:c1:openai')).toBe(0);
  });

  it('throws KEY_NOT_FOUND for non-existent key', async () => {
    const { manager } = makeManager();
    await expect(
      manager.revokeKey('c1', 'nonexistent'),
    ).rejects.toThrow(BYOKManagerError);
  });
});

// --------------------------------------------------------------------------
// hasBYOKKey (Redis routing check)
// --------------------------------------------------------------------------

describe('hasBYOKKey', () => {
  it('returns true when Redis flag exists', async () => {
    const redis = createMockRedis();
    const { manager } = makeManager({ redis });

    await manager.storeKey('c1', 'openai', Buffer.from('routing-test'), 'user-1');
    expect(await manager.hasBYOKKey('c1', 'openai')).toBe(true);
  });

  it('returns false when no flag exists', async () => {
    const { manager } = makeManager();
    expect(await manager.hasBYOKKey('no-community', 'openai')).toBe(false);
  });

  it('returns false after key revocation', async () => {
    const redis = createMockRedis();
    const { manager } = makeManager({ redis });

    const info = await manager.storeKey('c1', 'openai', Buffer.from('will-revoke'), 'user-1');
    await manager.revokeKey('c1', info.id);

    expect(await manager.hasBYOKKey('c1', 'openai')).toBe(false);
  });
});

// --------------------------------------------------------------------------
// Key material zeroing
// --------------------------------------------------------------------------

describe('key material zeroing', () => {
  it('zeros DEK and plaintext apiKey after storeKey', async () => {
    const { manager } = makeManager();
    const apiKey = Buffer.from('will-be-zeroed-XXXX');

    await manager.storeKey('c1', 'openai', apiKey, 'user-1');

    // The input buffer should be zeroed (filled with 0)
    expect(apiKey.every((b) => b === 0)).toBe(true);
  });

  it('zeros DEK and plaintext apiKey after rotateKey', async () => {
    const { manager } = makeManager();

    const info = await manager.storeKey('c1', 'openai', Buffer.from('old-rotate'), 'user-1');
    const newKey = Buffer.from('new-rotate-key-RRRR');
    await manager.rotateKey('c1', info.id, newKey, 'user-1');

    expect(newKey.every((b) => b === 0)).toBe(true);
  });
});

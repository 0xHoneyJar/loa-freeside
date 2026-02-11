/**
 * BYOK Admin Routes Integration Tests
 * Sprint 3, Task 3.3: Full CRUD lifecycle via HTTP routes
 *
 * AC-4.1: store → list → rotate → revoke → verify revoked absent from active
 * AC-4.10: Admin-only access enforced (non-admin → 403)
 * AC-4.18: Integration test covering full lifecycle
 *
 * @see SDD §6.2 BYOK Admin API
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createBYOKRoutes } from '../../themes/sietch/src/api/routes/admin/byok.routes.js';
import { BYOKManager } from '../../packages/adapters/agent/byok-manager.js';
import type { KMSAdapter, BYOKStore, BYOKKeyRecord } from '../../packages/adapters/agent/byok-manager.js';

// --------------------------------------------------------------------------
// Mock Factories
// --------------------------------------------------------------------------

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

function createMockStore(): BYOKStore {
  const records: BYOKKeyRecord[] = [];
  return {
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
    child: vi.fn().mockReturnThis(),
  };
}

// --------------------------------------------------------------------------
// App factory
// --------------------------------------------------------------------------

function createTestApp(opts?: { adminRejects?: boolean }) {
  const kms = createMockKMS();
  const store = createMockStore();
  const redis = createMockRedis();
  const logger = createMockLogger();

  const byokManager = new BYOKManager(kms, store, redis as any, logger as any);

  const requireAdmin = (_req: any, res: any, next: any) => {
    if (opts?.adminRejects) {
      res.status(403).json({ error: 'FORBIDDEN', message: 'Admin access required' });
      return;
    }
    _req.caller = { userId: 'admin-user-1' };
    next();
  };

  const router = createBYOKRoutes({ byokManager, requireAdmin });

  const app = express();
  app.use(express.json());
  app.use('/api/admin', router);

  return { app, byokManager, store, redis };
}

// --------------------------------------------------------------------------
// AC-4.10: Admin-only access enforced
// --------------------------------------------------------------------------

describe('AC-4.10: admin-only access', () => {
  it('rejects non-admin with 403', async () => {
    const { app } = createTestApp({ adminRejects: true });

    const res = await request(app)
      .post('/api/admin/communities/c1/byok/keys')
      .send({ provider: 'openai', apiKey: 'sk-test12345678' });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('FORBIDDEN');
  });
});

// --------------------------------------------------------------------------
// AC-4.1 + AC-4.18: Full CRUD lifecycle
// --------------------------------------------------------------------------

describe('AC-4.1 + AC-4.18: full CRUD lifecycle', () => {
  let app: ReturnType<typeof createTestApp>['app'];

  beforeEach(() => {
    ({ app } = createTestApp());
  });

  it('store → list → rotate → revoke → verify revoked key absent', async () => {
    // 1. Store a key
    const storeRes = await request(app)
      .post('/api/admin/communities/c1/byok/keys')
      .send({ provider: 'openai', apiKey: 'sk-test-key-12345678' });

    expect(storeRes.status).toBe(201);
    expect(storeRes.body.provider).toBe('openai');
    expect(storeRes.body.keyLast4).toBe('5678');
    expect(storeRes.body.revokedAt).toBeNull();
    const keyId = storeRes.body.id;

    // 2. List keys — should show 1 active key
    const listRes = await request(app)
      .get('/api/admin/communities/c1/byok/keys');

    expect(listRes.status).toBe(200);
    expect(listRes.body.keys).toHaveLength(1);
    expect(listRes.body.keys[0].id).toBe(keyId);

    // 3. Rotate the key
    const rotateRes = await request(app)
      .post(`/api/admin/communities/c1/byok/keys/${keyId}/rotate`)
      .send({ apiKey: 'sk-new-rotated-key-WXYZ' });

    expect(rotateRes.status).toBe(200);
    expect(rotateRes.body.keyLast4).toBe('WXYZ');
    expect(rotateRes.body.id).not.toBe(keyId);
    const newKeyId = rotateRes.body.id;

    // 4. List — should show 2 keys (old revoked + new active)
    const listRes2 = await request(app)
      .get('/api/admin/communities/c1/byok/keys');

    expect(listRes2.status).toBe(200);
    expect(listRes2.body.keys).toHaveLength(2);

    const oldKey = listRes2.body.keys.find((k: any) => k.id === keyId);
    const newKey = listRes2.body.keys.find((k: any) => k.id === newKeyId);
    expect(oldKey.revokedAt).not.toBeNull();
    expect(newKey.revokedAt).toBeNull();

    // 5. Revoke the new key
    const revokeRes = await request(app)
      .delete(`/api/admin/communities/c1/byok/keys/${newKeyId}`);

    expect(revokeRes.status).toBe(204);

    // 6. List — both keys revoked
    const listRes3 = await request(app)
      .get('/api/admin/communities/c1/byok/keys');

    expect(listRes3.status).toBe(200);
    const activeKeys = listRes3.body.keys.filter((k: any) => k.revokedAt === null);
    expect(activeKeys).toHaveLength(0);
  });
});

// --------------------------------------------------------------------------
// BB3-5: BYOK feature gate
// --------------------------------------------------------------------------

describe('BB3-5: BYOK feature gate (byokEnabled=false)', () => {
  it('returns 404 BYOK_DISABLED on all routes when byokEnabled is false', async () => {
    const kms = createMockKMS();
    const store = createMockStore();
    const redis = createMockRedis();
    const logger = createMockLogger();
    const byokManager = new BYOKManager(kms, store, redis as any, logger as any);

    const requireAdmin = (_req: any, _res: any, next: any) => {
      _req.caller = { userId: 'admin-user-1' };
      next();
    };

    const router = createBYOKRoutes({ byokManager, requireAdmin, byokEnabled: false });

    const app = express();
    app.use(express.json());
    app.use('/api/admin', router);

    // POST store
    const storeRes = await request(app)
      .post('/api/admin/communities/c1/byok/keys')
      .send({ provider: 'openai', apiKey: 'sk-test12345678' });
    expect(storeRes.status).toBe(404);
    expect(storeRes.body.error).toBe('BYOK_DISABLED');

    // GET list
    const listRes = await request(app)
      .get('/api/admin/communities/c1/byok/keys');
    expect(listRes.status).toBe(404);
    expect(listRes.body.error).toBe('BYOK_DISABLED');

    // DELETE revoke
    const revokeRes = await request(app)
      .delete('/api/admin/communities/c1/byok/keys/00000000-0000-0000-0000-000000000000');
    expect(revokeRes.status).toBe(404);
    expect(revokeRes.body.error).toBe('BYOK_DISABLED');

    // POST rotate
    const rotateRes = await request(app)
      .post('/api/admin/communities/c1/byok/keys/00000000-0000-0000-0000-000000000000/rotate')
      .send({ apiKey: 'sk-new-key-12345678' });
    expect(rotateRes.status).toBe(404);
    expect(rotateRes.body.error).toBe('BYOK_DISABLED');
  });

  it('allows requests when byokEnabled is true (default)', async () => {
    const { app } = createTestApp();

    const storeRes = await request(app)
      .post('/api/admin/communities/c1/byok/keys')
      .send({ provider: 'openai', apiKey: 'sk-test12345678' });
    expect(storeRes.status).toBe(201);
  });
});

// --------------------------------------------------------------------------
// Validation
// --------------------------------------------------------------------------

describe('request validation', () => {
  let app: ReturnType<typeof createTestApp>['app'];

  beforeEach(() => {
    ({ app } = createTestApp());
  });

  it('rejects unknown provider', async () => {
    const res = await request(app)
      .post('/api/admin/communities/c1/byok/keys')
      .send({ provider: 'unknown-provider', apiKey: 'sk-12345678' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_REQUEST');
  });

  it('rejects too-short API key', async () => {
    const res = await request(app)
      .post('/api/admin/communities/c1/byok/keys')
      .send({ provider: 'openai', apiKey: 'short' });

    expect(res.status).toBe(400);
  });

  it('rejects invalid UUID keyId for revoke', async () => {
    const res = await request(app)
      .delete('/api/admin/communities/c1/byok/keys/not-a-uuid');

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_KEY_ID');
  });

  it('rejects invalid UUID keyId for rotate', async () => {
    const res = await request(app)
      .post('/api/admin/communities/c1/byok/keys/not-a-uuid/rotate')
      .send({ apiKey: 'sk-new-key-12345678' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_KEY_ID');
  });

  it('returns 404 for revoking non-existent key', async () => {
    const res = await request(app)
      .delete('/api/admin/communities/c1/byok/keys/00000000-0000-0000-0000-000000000000');

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('KEY_NOT_FOUND');
  });
});

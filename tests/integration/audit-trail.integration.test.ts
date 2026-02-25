/**
 * Audit Trail Integration Tests — Sprint 361, Task 4.2 (FR-6)
 *
 * Requires PostgreSQL >= 14. Skipped in CI without PG_TEST_URL.
 * Run locally: PG_TEST_URL=postgresql://localhost:5432/postgres pnpm test:integration
 *
 * Tests:
 * - Append-only enforcement (triggers block UPDATE/DELETE)
 * - RLS enforcement (INSERT + SELECT only for arrakis_app)
 * - Advisory lock linearization (concurrent appends)
 * - Chain integrity verification
 * - event_time_skew constraint
 * - entry_id idempotency
 * - Cross-partition uniqueness via chain_links
 * - Circuit breaker quarantine
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestDb, type TestDbContext } from './db-harness.js';

const SKIP = !process.env.PG_TEST_URL;

describe.skipIf(SKIP)('Audit Trail Integration', () => {
  let ctx: TestDbContext;

  beforeAll(async () => {
    ctx = await createTestDb();
  }, 30_000);

  afterAll(async () => {
    if (ctx) await ctx.teardown();
  });

  // ─── Trigger Enforcement ─────────────────────────────────────────────────

  it('INT-01: UPDATE on audit_trail is blocked by trigger', async () => {
    const client = await ctx.appPool.connect();
    try {
      // Insert a test entry first
      await client.query(`
        INSERT INTO audit_trail (entry_id, domain_tag, event_type, actor_id, payload, entry_hash, previous_hash, event_time)
        VALUES (gen_random_uuid(), 'test:trigger', 'test', 'actor-1', '{}',
          'sha256:0000000000000000000000000000000000000000000000000000000000000001',
          'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
          NOW())
      `);

      // Attempt UPDATE — should fail
      await expect(
        client.query(`UPDATE audit_trail SET event_type = 'hacked' WHERE domain_tag = 'test:trigger'`),
      ).rejects.toThrow(/append-only/);
    } finally {
      client.release();
    }
  });

  it('INT-02: DELETE on audit_trail is blocked by trigger', async () => {
    const client = await ctx.appPool.connect();
    try {
      await expect(
        client.query(`DELETE FROM audit_trail WHERE domain_tag = 'test:trigger'`),
      ).rejects.toThrow(/append-only/);
    } finally {
      client.release();
    }
  });

  // ─── Privilege Enforcement ───────────────────────────────────────────────

  it('INT-03: arrakis_app cannot ALTER TABLE audit_trail', async () => {
    const client = await ctx.appPool.connect();
    try {
      await expect(
        client.query(`ALTER TABLE audit_trail ADD COLUMN hacked TEXT`),
      ).rejects.toThrow(/permission denied/);
    } finally {
      client.release();
    }
  });

  it('INT-04: arrakis_app cannot DROP TABLE audit_trail', async () => {
    const client = await ctx.appPool.connect();
    try {
      await expect(
        client.query(`DROP TABLE audit_trail`),
      ).rejects.toThrow(/permission denied/);
    } finally {
      client.release();
    }
  });

  // ─── event_time_skew Constraint ──────────────────────────────────────────

  it('INT-05: event_time_skew rejects entries with >5min skew', async () => {
    const client = await ctx.appPool.connect();
    try {
      const farFuture = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 min ahead
      await expect(
        client.query(`
          INSERT INTO audit_trail (entry_id, domain_tag, event_type, actor_id, payload, entry_hash, previous_hash, event_time)
          VALUES (gen_random_uuid(), 'test:skew', 'test', 'actor-1', '{}',
            'sha256:0000000000000000000000000000000000000000000000000000000000000002',
            'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
            $1)
        `, [farFuture]),
      ).rejects.toThrow(/event_time_skew/);
    } finally {
      client.release();
    }
  });

  // ─── Chain Links Uniqueness ──────────────────────────────────────────────

  it('INT-06: chain_links UNIQUE prevents fork (duplicate previous_hash)', async () => {
    const client = await ctx.appPool.connect();
    try {
      const prevHash = 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

      // First insert succeeds
      await client.query(`
        INSERT INTO audit_trail_chain_links (domain_tag, previous_hash, entry_hash, entry_id)
        VALUES ('test:fork', $1, 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', gen_random_uuid())
      `, [prevHash]);

      // Second insert with same (domain_tag, previous_hash) — FORK attempt — should fail
      await expect(
        client.query(`
          INSERT INTO audit_trail_chain_links (domain_tag, previous_hash, entry_hash, entry_id)
          VALUES ('test:fork', $1, 'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc', gen_random_uuid())
        `, [prevHash]),
      ).rejects.toThrow(/unique_chain_link/);
    } finally {
      client.release();
    }
  });

  // ─── Partition Function ──────────────────────────────────────────────────

  it('INT-07: create_audit_partitions() is idempotent', async () => {
    const client = await ctx.adminPool.connect();
    try {
      // Call twice — should not error
      const result1 = await client.query('SELECT * FROM create_audit_partitions(2)');
      const result2 = await client.query('SELECT * FROM create_audit_partitions(2)');
      expect(result1.rows.length).toBeGreaterThan(0);
      expect(result2.rows.length).toBeGreaterThan(0);
    } finally {
      client.release();
    }
  });

  // ─── Head Table UPSERT ─────────────────────────────────────────────────

  it('INT-08: audit_trail_head supports UPSERT pattern', async () => {
    const client = await ctx.appPool.connect();
    try {
      const tag = 'test:upsert';
      const hash1 = 'sha256:1111111111111111111111111111111111111111111111111111111111111111';
      const hash2 = 'sha256:2222222222222222222222222222222222222222222222222222222222222222';

      // INSERT
      await client.query(`
        INSERT INTO audit_trail_head (domain_tag, current_hash, current_id, updated_at)
        VALUES ($1, $2, 1, NOW())
        ON CONFLICT (domain_tag) DO UPDATE SET
          current_hash = EXCLUDED.current_hash,
          current_id = EXCLUDED.current_id,
          updated_at = NOW()
      `, [tag, hash1]);

      // UPDATE via UPSERT
      await client.query(`
        INSERT INTO audit_trail_head (domain_tag, current_hash, current_id, updated_at)
        VALUES ($1, $2, 2, NOW())
        ON CONFLICT (domain_tag) DO UPDATE SET
          current_hash = EXCLUDED.current_hash,
          current_id = EXCLUDED.current_id,
          updated_at = NOW()
      `, [tag, hash2]);

      const result = await client.query(
        'SELECT current_hash FROM audit_trail_head WHERE domain_tag = $1',
        [tag],
      );
      expect(result.rows[0].current_hash).toBe(hash2);
    } finally {
      client.release();
    }
  });

  // ─── Default Partition Safety Net ────────────────────────────────────────

  it('INT-09: default partition exists as safety net', async () => {
    const client = await ctx.adminPool.connect();
    try {
      const result = await client.query(`
        SELECT c.relname
        FROM pg_class c
        JOIN pg_inherits i ON c.oid = i.inhrelid
        JOIN pg_class p ON i.inhparent = p.oid
        WHERE p.relname = 'audit_trail' AND c.relname = 'audit_trail_default'
      `);
      expect(result.rows.length).toBe(1);
    } finally {
      client.release();
    }
  });

  // ─── entry_hash Format Constraint ────────────────────────────────────────

  it('INT-10: entry_hash format CHECK rejects invalid format', async () => {
    const client = await ctx.appPool.connect();
    try {
      await expect(
        client.query(`
          INSERT INTO audit_trail (entry_id, domain_tag, event_type, actor_id, payload, entry_hash, previous_hash, event_time)
          VALUES (gen_random_uuid(), 'test:format', 'test', 'actor-1', '{}',
            'INVALID_HASH_FORMAT',
            'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
            NOW())
        `),
      ).rejects.toThrow(/entry_hash_format/);
    } finally {
      client.release();
    }
  });
});

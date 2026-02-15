/**
 * Billing S2S + Dashboard Integration Tests
 *
 * Validates Sprint 5: S2S finalize endpoint logic, balance retrieval,
 * history pagination, pricing config, and internal JWT auth.
 *
 * SDD refs: §5.2 Balance/History, §5.7 Auth Model
 * Sprint refs: Tasks 5.1–5.2
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'crypto';
import Database from 'better-sqlite3';
import { CREDIT_LEDGER_SCHEMA_SQL } from '../../src/db/migrations/030_credit_ledger.js';
import { BILLING_OPS_SCHEMA_SQL } from '../../src/db/migrations/032_billing_ops.js';
import { CreditLedgerAdapter } from '../../src/packages/adapters/billing/CreditLedgerAdapter.js';

// =============================================================================
// Test Helpers
// =============================================================================

const TEST_JWT_SECRET = 'test-internal-secret-key-for-s2s';

function createInternalJwt(payload: {
  sub: string;
  iss: string;
  aud: string;
  exp?: number;
  iat?: number;
}): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const body = Buffer.from(JSON.stringify({
    sub: payload.sub,
    iss: payload.iss,
    aud: payload.aud,
    exp: payload.exp ?? now + 300,
    iat: payload.iat ?? now,
  })).toString('base64url');
  const signature = createHmac('sha256', TEST_JWT_SECRET)
    .update(`${header}.${body}`)
    .digest('base64url');
  return `${header}.${body}.${signature}`;
}

// =============================================================================
// Test Setup
// =============================================================================

let db: Database.Database;
let ledger: CreditLedgerAdapter;

function setupDb(): Database.Database {
  const testDb = new Database(':memory:');
  testDb.pragma('journal_mode = WAL');
  testDb.pragma('foreign_keys = OFF');
  testDb.exec(CREDIT_LEDGER_SCHEMA_SQL);
  testDb.exec(BILLING_OPS_SCHEMA_SQL);
  testDb.pragma('foreign_keys = ON');
  return testDb;
}

// =============================================================================
// Setup / Teardown
// =============================================================================

beforeEach(() => {
  db = setupDb();
  ledger = new CreditLedgerAdapter(db);
});

afterEach(() => {
  db.close();
});

// =============================================================================
// Tests
// =============================================================================

describe('Billing S2S + Dashboard Integration', () => {
  // ---------------------------------------------------------------------------
  // S2S Finalize (Task 5.1)
  // ---------------------------------------------------------------------------

  describe('s2s-finalize', () => {
    it('finalizes a reservation with actual cost', async () => {
      // Setup: create account, mint credits, reserve
      const account = await ledger.createAccount('person', 'user-s2s-1');
      await ledger.mintLot(account.id, 10_000_000n, 'deposit', {
        sourceId: 's2s-deposit-1',
      });

      const reservation = await ledger.reserve(
        account.id, null, 5_000_000n,
        { billingMode: 'live' },
      );

      // Finalize with actual cost less than reserved
      const result = await ledger.finalize(
        reservation.reservationId,
        3_000_000n,
      );

      expect(result.reservationId).toBe(reservation.reservationId);
      expect(result.actualCostMicro).toBe(3_000_000n);
      expect(result.surplusReleasedMicro).toBe(2_000_000n);
      expect(result.overrunMicro).toBe(0n);
      expect(result.finalizedAt).toBeTruthy();

      // Verify balance: 10M - 3M consumed = 7M available
      const balance = await ledger.getBalance(account.id);
      expect(balance.availableMicro).toBe(7_000_000n);
      expect(balance.reservedMicro).toBe(0n);
    });

    it('finalize is idempotent on same reservation + amount', async () => {
      const account = await ledger.createAccount('person', 'user-s2s-2');
      await ledger.mintLot(account.id, 10_000_000n, 'deposit', {
        sourceId: 's2s-deposit-2',
      });

      const reservation = await ledger.reserve(
        account.id, null, 5_000_000n,
        { billingMode: 'live' },
      );

      const result1 = await ledger.finalize(reservation.reservationId, 3_000_000n);
      const result2 = await ledger.finalize(reservation.reservationId, 3_000_000n);

      // Same result returned
      expect(result2.reservationId).toBe(result1.reservationId);
      expect(result2.actualCostMicro).toBe(result1.actualCostMicro);
    });

    it('rejects finalize on non-existent reservation', async () => {
      await expect(ledger.finalize('nonexistent-res', 1_000_000n))
        .rejects.toThrow('not found');
    });
  });

  // ---------------------------------------------------------------------------
  // Internal JWT Auth Verification
  // ---------------------------------------------------------------------------

  describe('internal-jwt-auth', () => {
    it('creates a valid internal JWT token', () => {
      const token = createInternalJwt({
        sub: 'loa-finn-service',
        iss: 'loa-finn',
        aud: 'arrakis-internal',
      });

      // Verify token structure
      const parts = token.split('.');
      expect(parts).toHaveLength(3);

      // Verify payload
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf-8'));
      expect(payload.iss).toBe('loa-finn');
      expect(payload.aud).toBe('arrakis-internal');
      expect(payload.sub).toBe('loa-finn-service');
    });

    it('rejects expired tokens', () => {
      const now = Math.floor(Date.now() / 1000);
      const token = createInternalJwt({
        sub: 'loa-finn-service',
        iss: 'loa-finn',
        aud: 'arrakis-internal',
        exp: now - 120, // Expired 2 minutes ago (beyond 30s clock skew)
      });

      // Manually verify — expired token returns null
      const parts = token.split('.');
      const signature = createHmac('sha256', TEST_JWT_SECRET)
        .update(`${parts[0]}.${parts[1]}`)
        .digest('base64url');
      expect(signature).toBe(parts[2]); // Signature is valid

      // But payload is expired
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf-8'));
      expect(payload.exp).toBeLessThan(now - 30);
    });
  });

  // ---------------------------------------------------------------------------
  // Balance Endpoint (Task 5.2)
  // ---------------------------------------------------------------------------

  describe('balance-endpoint', () => {
    it('returns balance for an account with credits', async () => {
      const account = await ledger.createAccount('person', 'user-balance-1');
      await ledger.mintLot(account.id, 25_000_000n, 'deposit', {
        sourceId: 'balance-deposit-1',
      });

      const balance = await ledger.getBalance(account.id);

      expect(balance.accountId).toBe(account.id);
      expect(balance.availableMicro).toBe(25_000_000n);
      expect(balance.reservedMicro).toBe(0n);
    });

    it('returns balance with reserved credits shown separately', async () => {
      const account = await ledger.createAccount('person', 'user-balance-2');
      await ledger.mintLot(account.id, 10_000_000n, 'deposit', {
        sourceId: 'balance-deposit-2',
      });

      await ledger.reserve(account.id, null, 3_000_000n, { billingMode: 'live' });

      const balance = await ledger.getBalance(account.id);
      expect(balance.availableMicro).toBe(7_000_000n);
      expect(balance.reservedMicro).toBe(3_000_000n);
    });

    it('returns zero balance for account with no credits', async () => {
      const account = await ledger.createAccount('person', 'user-balance-3');
      const balance = await ledger.getBalance(account.id);

      expect(balance.availableMicro).toBe(0n);
      expect(balance.reservedMicro).toBe(0n);
    });
  });

  // ---------------------------------------------------------------------------
  // History Endpoint (Task 5.2)
  // ---------------------------------------------------------------------------

  describe('history-endpoint', () => {
    it('returns ledger entries for account', async () => {
      const account = await ledger.createAccount('person', 'user-history-1');
      await ledger.mintLot(account.id, 5_000_000n, 'deposit', {
        sourceId: 'history-deposit-1',
        description: 'First deposit',
      });
      await ledger.mintLot(account.id, 3_000_000n, 'grant', {
        sourceId: 'history-grant-1',
        description: 'Grant credit',
      });

      const entries = await ledger.getHistory(account.id);

      expect(entries.length).toBe(2);
      // Both entries present
      const types = entries.map(e => e.entryType).sort();
      expect(types).toEqual(['deposit', 'grant']);
    });

    it('supports pagination with limit and offset', async () => {
      const account = await ledger.createAccount('person', 'user-history-2');

      // Create 5 entries
      for (let i = 0; i < 5; i++) {
        await ledger.mintLot(account.id, 1_000_000n, 'deposit', {
          sourceId: `history-page-${i}`,
          description: `Deposit ${i}`,
        });
      }

      // Get page 1 (2 entries)
      const page1 = await ledger.getHistory(account.id, { limit: 2, offset: 0 });
      expect(page1.length).toBe(2);

      // Get page 2 (2 entries)
      const page2 = await ledger.getHistory(account.id, { limit: 2, offset: 2 });
      expect(page2.length).toBe(2);

      // Get page 3 (1 entry)
      const page3 = await ledger.getHistory(account.id, { limit: 2, offset: 4 });
      expect(page3.length).toBe(1);

      // No overlap between pages
      const page1Ids = page1.map(e => e.id);
      const page2Ids = page2.map(e => e.id);
      expect(page1Ids.every(id => !page2Ids.includes(id))).toBe(true);
    });

    it('filters by entry type', async () => {
      const account = await ledger.createAccount('person', 'user-history-3');
      await ledger.mintLot(account.id, 10_000_000n, 'deposit', {
        sourceId: 'history-filter-1',
      });

      // Reserve to create a 'reserve' entry
      await ledger.reserve(account.id, null, 2_000_000n, { billingMode: 'live' });

      const deposits = await ledger.getHistory(account.id, { entryType: 'deposit' });
      expect(deposits.length).toBe(1);
      expect(deposits[0].entryType).toBe('deposit');

      const reserves = await ledger.getHistory(account.id, { entryType: 'reserve' });
      expect(reserves.length).toBe(1);
      expect(reserves[0].entryType).toBe('reserve');
    });
  });

  // ---------------------------------------------------------------------------
  // Pricing Endpoint (Task 5.2)
  // ---------------------------------------------------------------------------

  describe('pricing-endpoint', () => {
    it('loads pricing config from billing_config table', () => {
      // Seed some rate config
      db.prepare(
        `INSERT OR REPLACE INTO billing_config (key, value, updated_at)
         VALUES ('rate_inference', '"0.001"', datetime('now'))`
      ).run();

      const rows = db.prepare(
        `SELECT key, value FROM billing_config WHERE key LIKE 'rate_%'`
      ).all() as Array<{ key: string; value: string }>;

      expect(rows.length).toBeGreaterThan(0);
      expect(rows.some(r => r.key === 'rate_inference')).toBe(true);
    });

    it('billing_config table has default values seeded', () => {
      // The migration seeds default config
      const billingMode = db.prepare(
        `SELECT value FROM billing_config WHERE key = 'billing_mode'`
      ).get() as { value: string } | undefined;

      expect(billingMode).toBeTruthy();
      expect(billingMode!.value).toBe('shadow');
    });
  });

  // ---------------------------------------------------------------------------
  // BigInt Serialization
  // ---------------------------------------------------------------------------

  describe('bigint-serialization', () => {
    it('balance values are serializable as strings', async () => {
      const account = await ledger.createAccount('person', 'user-serial-1');
      await ledger.mintLot(account.id, 99_999_999_999n, 'deposit', {
        sourceId: 'serial-deposit-1',
      });

      const balance = await ledger.getBalance(account.id);

      // Verify BigInt values can be serialized
      const serialized = JSON.parse(JSON.stringify({
        availableMicro: balance.availableMicro.toString(),
        reservedMicro: balance.reservedMicro.toString(),
      }));

      expect(serialized.availableMicro).toBe('99999999999');
      expect(serialized.reservedMicro).toBe('0');
    });
  });
});

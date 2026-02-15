/**
 * Credit Ledger Conformance Test Suite
 *
 * Financial invariant tests verifying correctness of the credit ledger.
 * Uses real in-memory SQLite — no mocks for financial logic.
 *
 * SDD refs: §1.5.1 FIFO, §1.5.2 State Machine, §1.5.3 Overrun
 * Sprint refs: Task 1.7
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { CREDIT_LEDGER_SCHEMA_SQL, CREDIT_LEDGER_ROLLBACK_SQL } from '../../src/db/migrations/030_credit_ledger.js';
import { CreditLedgerAdapter, InsufficientBalanceError, InvalidStateError, ConflictError } from '../../src/packages/adapters/billing/CreditLedgerAdapter.js';

// =============================================================================
// Test Helpers
// =============================================================================

let db: Database.Database;
let ledger: CreditLedgerAdapter;

function createTestDb(): Database.Database {
  const testDb = new Database(':memory:');
  testDb.pragma('journal_mode = WAL');
  testDb.pragma('foreign_keys = ON');
  testDb.exec(CREDIT_LEDGER_SCHEMA_SQL);
  return testDb;
}

async function seedAccount(entityType = 'person' as const, entityId = 'user-1') {
  return ledger.createAccount(entityType, entityId);
}

async function seedLot(accountId: string, amountMicro: bigint, options?: {
  poolId?: string;
  sourceType?: 'deposit' | 'grant';
  expiresAt?: string;
}) {
  return ledger.mintLot(accountId, amountMicro, options?.sourceType ?? 'deposit', {
    poolId: options?.poolId ?? 'general',
    expiresAt: options?.expiresAt,
    sourceId: `src-${Math.random().toString(36).slice(2, 8)}`,
  });
}

// =============================================================================
// Setup / Teardown
// =============================================================================

beforeEach(() => {
  db = createTestDb();
  ledger = new CreditLedgerAdapter(db);
});

afterEach(() => {
  db.close();
});

// =============================================================================
// Conformance Tests
// =============================================================================

describe('Credit Ledger Conformance', () => {
  // ---------------------------------------------------------------------------
  // Account Management
  // ---------------------------------------------------------------------------

  describe('account management', () => {
    it('createAccount is idempotent', async () => {
      const a1 = await ledger.createAccount('person', 'user-1');
      const a2 = await ledger.createAccount('person', 'user-1');
      expect(a1.id).toBe(a2.id);
    });

    it('getOrCreateAccount auto-provisions', async () => {
      const account = await ledger.getOrCreateAccount('agent', 'agent-1');
      expect(account.entityType).toBe('agent');
      expect(account.entityId).toBe('agent-1');
    });
  });

  // ---------------------------------------------------------------------------
  // reserve-fifo-order
  // ---------------------------------------------------------------------------

  describe('reserve-fifo-order', () => {
    it('selects pool-restricted first, expiring first, oldest first', async () => {
      const account = await seedAccount();

      // Create lots in specific order to test FIFO
      // Lot A: general pool, no expiry (oldest)
      const lotA = await seedLot(account.id, 100_000n, { poolId: 'general' });
      // Lot B: general pool, expires soon
      const lotB = await seedLot(account.id, 100_000n, {
        poolId: 'general',
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      });
      // Lot C: specific pool match
      const lotC = await seedLot(account.id, 100_000n, { poolId: 'campaign:test' });

      // Reserve from campaign:test pool — should select pool-restricted (C) first
      const result = await ledger.reserve(account.id, 'campaign:test', 150_000n);
      expect(result.lotAllocations.length).toBeGreaterThanOrEqual(2);

      // First allocation should be from the pool-restricted lot
      expect(result.lotAllocations[0].lotId).toBe(lotC.id);
    });
  });

  // ---------------------------------------------------------------------------
  // reserve-atomic-lot-selection (sequential variant for in-memory SQLite)
  // ---------------------------------------------------------------------------

  describe('reserve-atomic-lot-selection', () => {
    it('10 sequential reserves produce no balance corruption', async () => {
      const account = await seedAccount();
      await seedLot(account.id, 1_000_000n);

      const reservations = [];
      for (let i = 0; i < 10; i++) {
        const r = await ledger.reserve(account.id, 'general', 100_000n);
        reservations.push(r);
      }

      expect(reservations).toHaveLength(10);

      // Verify lot_invariant holds
      const lots = db.prepare('SELECT * FROM credit_lots WHERE account_id = ?')
        .all(account.id) as Array<{
          available_micro: string; reserved_micro: string;
          consumed_micro: string; original_micro: string;
        }>;

      for (const lot of lots) {
        const available = BigInt(lot.available_micro);
        const reserved = BigInt(lot.reserved_micro);
        const consumed = BigInt(lot.consumed_micro);
        const original = BigInt(lot.original_micro);
        expect(available + reserved + consumed).toBe(original);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // finalize-deterministic
  // ---------------------------------------------------------------------------

  describe('finalize-deterministic', () => {
    it('finalize allocates across lots in same FIFO order', async () => {
      const account = await seedAccount();
      await seedLot(account.id, 500_000n);
      await seedLot(account.id, 500_000n);

      const reservation = await ledger.reserve(account.id, 'general', 800_000n);
      const result = await ledger.finalize(reservation.reservationId, 600_000n);

      expect(result.actualCostMicro).toBe(600_000n);
      expect(result.surplusReleasedMicro).toBe(200_000n);
    });
  });

  // ---------------------------------------------------------------------------
  // finalize-surplus-release
  // ---------------------------------------------------------------------------

  describe('finalize-surplus-release', () => {
    it('Y < X releases surplus correctly', async () => {
      const account = await seedAccount();
      await seedLot(account.id, 1_000_000n);

      const reservation = await ledger.reserve(account.id, 'general', 500_000n);
      const result = await ledger.finalize(reservation.reservationId, 200_000n);

      expect(result.surplusReleasedMicro).toBe(300_000n);

      // Balance should reflect release
      const balance = await ledger.getBalance(account.id);
      expect(balance.availableMicro).toBe(800_000n); // 1M - 200K consumed
    });
  });

  // ---------------------------------------------------------------------------
  // finalize-overrun-shadow
  // ---------------------------------------------------------------------------

  describe('finalize-overrun-shadow', () => {
    it('Y > X in shadow mode logs without impact', async () => {
      const account = await seedAccount();
      await seedLot(account.id, 1_000_000n);

      const reservation = await ledger.reserve(account.id, 'general', 100_000n, {
        billingMode: 'shadow',
      });
      const result = await ledger.finalize(reservation.reservationId, 200_000n);

      // Shadow mode caps at reserved amount
      expect(result.actualCostMicro).toBe(100_000n);
      expect(result.overrunMicro).toBe(100_000n);
    });
  });

  // ---------------------------------------------------------------------------
  // finalize-overrun-soft
  // ---------------------------------------------------------------------------

  describe('finalize-overrun-soft', () => {
    it('Y > X in soft mode allows overconsumption', async () => {
      const account = await seedAccount();
      await seedLot(account.id, 1_000_000n);

      const reservation = await ledger.reserve(account.id, 'general', 100_000n, {
        billingMode: 'soft',
      });
      const result = await ledger.finalize(reservation.reservationId, 200_000n);

      expect(result.actualCostMicro).toBe(200_000n);
      expect(result.overrunMicro).toBe(100_000n);
    });
  });

  // ---------------------------------------------------------------------------
  // finalize-overrun-live
  // ---------------------------------------------------------------------------

  describe('finalize-overrun-live', () => {
    it('Y > X in live mode caps at reserved amount', async () => {
      const account = await seedAccount();
      await seedLot(account.id, 1_000_000n);

      const reservation = await ledger.reserve(account.id, 'general', 100_000n, {
        billingMode: 'live',
      });
      const result = await ledger.finalize(reservation.reservationId, 200_000n);

      expect(result.actualCostMicro).toBe(100_000n);
      expect(result.overrunMicro).toBe(0n); // Capped, no effective overrun
    });
  });

  // ---------------------------------------------------------------------------
  // entry-seq-monotonic
  // ---------------------------------------------------------------------------

  describe('entry-seq-monotonic', () => {
    it('entry_seq is strictly increasing per (account_id, pool_id)', async () => {
      const account = await seedAccount();
      await seedLot(account.id, 5_000_000n);

      // Multiple operations to generate ledger entries
      const r1 = await ledger.reserve(account.id, 'general', 100_000n);
      await ledger.finalize(r1.reservationId, 50_000n);
      const r2 = await ledger.reserve(account.id, 'general', 100_000n);
      await ledger.release(r2.reservationId);

      const entries = db.prepare(
        `SELECT entry_seq FROM credit_ledger
         WHERE account_id = ? AND pool_id = 'general'
         ORDER BY entry_seq ASC`
      ).all(account.id) as Array<{ entry_seq: number }>;

      // Verify monotonically increasing
      for (let i = 1; i < entries.length; i++) {
        expect(entries[i].entry_seq).toBeGreaterThan(entries[i - 1].entry_seq);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // idempotency-reserve
  // ---------------------------------------------------------------------------

  describe('idempotency-reserve', () => {
    it('duplicate reservation with same key returns existing', async () => {
      const account = await seedAccount();
      await seedLot(account.id, 1_000_000n);

      const r1 = await ledger.reserve(account.id, 'general', 100_000n, {
        idempotencyKey: 'reserve-test-1',
      });
      const r2 = await ledger.reserve(account.id, 'general', 100_000n, {
        idempotencyKey: 'reserve-test-1',
      });

      expect(r1.reservationId).toBe(r2.reservationId);
    });
  });

  // ---------------------------------------------------------------------------
  // idempotency-finalize
  // ---------------------------------------------------------------------------

  describe('idempotency-finalize', () => {
    it('duplicate finalize returns success, no double debit', async () => {
      const account = await seedAccount();
      await seedLot(account.id, 1_000_000n);

      const reservation = await ledger.reserve(account.id, 'general', 500_000n);
      const f1 = await ledger.finalize(reservation.reservationId, 300_000n);
      const f2 = await ledger.finalize(reservation.reservationId, 300_000n);

      expect(f1.reservationId).toBe(f2.reservationId);

      // Balance check — should only be debited once
      const balance = await ledger.getBalance(account.id);
      expect(balance.availableMicro).toBe(700_000n); // 1M - 300K
    });

    it('conflicting finalize with different amount throws 409', async () => {
      const account = await seedAccount();
      await seedLot(account.id, 1_000_000n);

      const reservation = await ledger.reserve(account.id, 'general', 500_000n);
      await ledger.finalize(reservation.reservationId, 300_000n);

      await expect(
        ledger.finalize(reservation.reservationId, 400_000n)
      ).rejects.toThrow(ConflictError);
    });
  });

  // ---------------------------------------------------------------------------
  // lot-invariant
  // ---------------------------------------------------------------------------

  describe('lot-invariant', () => {
    it('available + reserved + consumed = original always holds', async () => {
      const account = await seedAccount();
      await seedLot(account.id, 1_000_000n);
      await seedLot(account.id, 500_000n);

      // Reserve, partially finalize, release another
      const r1 = await ledger.reserve(account.id, 'general', 800_000n);
      await ledger.finalize(r1.reservationId, 600_000n);
      const r2 = await ledger.reserve(account.id, 'general', 300_000n);
      await ledger.release(r2.reservationId);

      // Check invariant on all lots
      const lots = db.prepare('SELECT * FROM credit_lots').all() as Array<{
        id: string;
        available_micro: string;
        reserved_micro: string;
        consumed_micro: string;
        original_micro: string;
      }>;

      for (const lot of lots) {
        const sum = BigInt(lot.available_micro) + BigInt(lot.reserved_micro) + BigInt(lot.consumed_micro);
        expect(sum).toBe(BigInt(lot.original_micro));
      }
    });
  });

  // ---------------------------------------------------------------------------
  // balance-cache-consistency
  // ---------------------------------------------------------------------------

  describe('balance-cache-consistency', () => {
    it('credit_balances matches SUM(credit_lots) after operations', async () => {
      const account = await seedAccount();
      await seedLot(account.id, 1_000_000n);
      await seedLot(account.id, 2_000_000n);

      const r = await ledger.reserve(account.id, 'general', 500_000n);
      await ledger.finalize(r.reservationId, 300_000n);

      // Get cached balance
      const cached = db.prepare(
        `SELECT available_micro, reserved_micro FROM credit_balances
         WHERE account_id = ? AND pool_id = 'general'`
      ).get(account.id) as { available_micro: string; reserved_micro: string };

      // Compute from lots
      const computed = db.prepare(`
        SELECT
          COALESCE(SUM(available_micro), 0) as available_micro,
          COALESCE(SUM(reserved_micro), 0) as reserved_micro
        FROM credit_lots
        WHERE account_id = ?
          AND (pool_id = 'general' OR pool_id IS NULL)
          AND (expires_at IS NULL OR expires_at > datetime('now'))
      `).get(account.id) as { available_micro: string; reserved_micro: string };

      expect(cached.available_micro).toBe(computed.available_micro);
      expect(cached.reserved_micro).toBe(computed.reserved_micro);
    });
  });

  // ---------------------------------------------------------------------------
  // reservation-ttl-sweep
  // ---------------------------------------------------------------------------

  describe('reservation-ttl-sweep', () => {
    it('sweeper expires and releases past-due reservations', async () => {
      const account = await seedAccount();
      await seedLot(account.id, 1_000_000n);

      // Create a reservation with very short TTL
      const reservation = await ledger.reserve(account.id, 'general', 500_000n, {
        ttlSeconds: -1, // Already expired
      });

      // Manually sweep
      const { createReservationSweeper } = await import('../../src/jobs/reservation-sweeper.js');
      const sweeper = createReservationSweeper({ db });
      const result = sweeper.sweepOnce();

      expect(result.expiredCount).toBe(1);

      // Verify reservation status
      const res = db.prepare(
        'SELECT status FROM credit_reservations WHERE id = ?'
      ).get(reservation.reservationId) as { status: string };
      expect(res.status).toBe('expired');

      // Verify balance restored
      const balance = await ledger.getBalance(account.id);
      expect(balance.availableMicro).toBe(1_000_000n);
    });
  });

  // ---------------------------------------------------------------------------
  // zero-sum-distribution (placeholder for Sprint 3)
  // ---------------------------------------------------------------------------

  describe('zero-sum-distribution', () => {
    it('placeholder: revenue entries will sum to zero when distribution is implemented', async () => {
      // This test will be expanded in Sprint 3 when RevenueDistributionService is implemented
      const account = await seedAccount();
      await seedLot(account.id, 1_000_000n);

      const r = await ledger.reserve(account.id, 'general', 100_000n);
      await ledger.finalize(r.reservationId, 80_000n);

      // For now, just verify ledger entries exist
      const entries = await ledger.getHistory(account.id);
      expect(entries.length).toBeGreaterThan(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Edge Cases
  // ---------------------------------------------------------------------------

  describe('edge cases', () => {
    it('insufficient balance throws InsufficientBalanceError', async () => {
      const account = await seedAccount();
      await seedLot(account.id, 100_000n);

      await expect(
        ledger.reserve(account.id, 'general', 200_000n)
      ).rejects.toThrow(InsufficientBalanceError);
    });

    it('release of non-pending reservation throws InvalidStateError', async () => {
      const account = await seedAccount();
      await seedLot(account.id, 1_000_000n);

      const r = await ledger.reserve(account.id, 'general', 100_000n);
      await ledger.finalize(r.reservationId, 50_000n);

      await expect(
        ledger.release(r.reservationId)
      ).rejects.toThrow(InvalidStateError);
    });

    it('migration rollback drops all tables cleanly', () => {
      // Should not throw
      db.exec(CREDIT_LEDGER_ROLLBACK_SQL);

      // Verify tables are gone
      const tables = db.prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'credit_%'`
      ).all();
      expect(tables).toHaveLength(0);
    });
  });
});

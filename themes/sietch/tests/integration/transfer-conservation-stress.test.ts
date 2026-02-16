/**
 * Transfer Conservation Stress Test (Sprint 291, Task 8.2)
 *
 * Property-based stress test: execute 100+ random peer transfers between
 * multiple accounts and verify conservation invariant holds after every batch.
 *
 * Conservation invariant: SUM(original_micro) across all credit_lots is
 * immutable — transfers redistribute, never create or destroy supply.
 *
 * SDD refs: §8.2 Transfer Conservation Stress Test
 * PRD refs: G-5 Conservation invariants
 * Sprint refs: Sprint 291 Task 8.2
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';

// Schema imports
import { CREDIT_LEDGER_SCHEMA_SQL } from '../../src/db/migrations/030_credit_ledger.js';
import { PEER_TRANSFERS_SQL, CREDIT_LEDGER_REBUILD_SQL } from '../../src/db/migrations/056_peer_transfers.js';
import { ECONOMIC_EVENTS_SQL } from '../../src/db/migrations/054_economic_events.js';

// Service imports
import { CreditLedgerAdapter } from '../../src/packages/adapters/billing/CreditLedgerAdapter.js';
import { PeerTransferService } from '../../src/packages/adapters/billing/PeerTransferService.js';
import { ReconciliationService } from '../../src/packages/adapters/billing/ReconciliationService.js';

// =============================================================================
// Test Helpers
// =============================================================================

let db: Database.Database;
let ledger: CreditLedgerAdapter;
let transferService: PeerTransferService;
let reconciliation: ReconciliationService;

function createTestDb(): Database.Database {
  const testDb = new Database(':memory:');
  testDb.pragma('journal_mode = WAL');
  testDb.pragma('foreign_keys = ON');

  testDb.exec(CREDIT_LEDGER_SCHEMA_SQL);
  // Rebuild credit_ledger to add 'transfer_out' entry_type (migration 056)
  testDb.pragma('foreign_keys = OFF');
  testDb.exec(CREDIT_LEDGER_REBUILD_SQL);
  testDb.pragma('foreign_keys = ON');
  testDb.exec(ECONOMIC_EVENTS_SQL);
  testDb.exec(PEER_TRANSFERS_SQL);

  // Agent identity (needed for PeerTransferService.isAgent())
  testDb.exec(`
    CREATE TABLE IF NOT EXISTS agent_identity (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL UNIQUE REFERENCES credit_accounts(id),
      chain_id INTEGER NOT NULL,
      contract_address TEXT NOT NULL,
      token_id TEXT NOT NULL,
      tba_address TEXT,
      creator_account_id TEXT NOT NULL REFERENCES credit_accounts(id),
      verified_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
  `);

  // Reconciliation runs (needed for ReconciliationService)
  testDb.exec(`
    CREATE TABLE IF NOT EXISTS reconciliation_runs (
      id TEXT PRIMARY KEY,
      started_at TEXT NOT NULL,
      finished_at TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('passed', 'divergence_detected', 'error')),
      checks_json TEXT NOT NULL,
      divergence_summary_json TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
  `);

  return testDb;
}

// Protocol account used as creator for agent identities
const PROTOCOL_ACCOUNT_ID = 'protocol-creator-' + randomUUID();

function ensureProtocolAccount(testDb: Database.Database): void {
  testDb.prepare(`
    INSERT OR IGNORE INTO credit_accounts (id, entity_type, entity_id, created_at)
    VALUES (?, 'protocol', 'stress-test-creator', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  `).run(PROTOCOL_ACCOUNT_ID);
}

function createAccount(testDb: Database.Database, externalId: string): string {
  const id = randomUUID();
  ensureProtocolAccount(testDb);
  testDb.prepare(`
    INSERT INTO credit_accounts (id, entity_type, entity_id, created_at)
    VALUES (?, 'agent', ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  `).run(id, externalId);
  // Register agent identity so PeerTransferService.isAgent() returns true
  testDb.prepare(`
    INSERT INTO agent_identity (id, account_id, chain_id, contract_address, token_id, creator_account_id, verified_at)
    VALUES (?, ?, 1, '0x1234567890abcdef1234567890abcdef12345678', ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  `).run(randomUUID(), id, randomUUID(), PROTOCOL_ACCOUNT_ID);
  return id;
}

function mintLot(testDb: Database.Database, accountId: string, amountMicro: bigint): string {
  const lotId = randomUUID();
  testDb.prepare(`
    INSERT INTO credit_lots (id, account_id, original_micro, available_micro, reserved_micro, consumed_micro, source_type, source_id, pool_id, created_at)
    VALUES (?, ?, ?, ?, 0, 0, 'deposit', ?, 'general', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  `).run(lotId, accountId, amountMicro.toString(), amountMicro.toString(), `src-${randomUUID()}`);
  return lotId;
}

/**
 * Seeded deterministic RNG (SplitMix32) for reproducible stress tests.
 * Avoids flakiness from Math.random() while preserving randomized coverage.
 */
function createRng(seed: number) {
  let t = seed >>> 0;
  return () => {
    t += 0x6D2B79F5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return (r ^ (r >>> 14)) >>> 0;
  };
}

function getTotalSupply(testDb: Database.Database): bigint {
  const row = testDb.prepare(`
    SELECT CAST(COALESCE(SUM(original_micro), 0) AS TEXT) as total FROM credit_lots
  `).get() as { total: string };
  return BigInt(row.total);
}

function getSumAvailable(testDb: Database.Database): bigint {
  const row = testDb.prepare(`
    SELECT CAST(COALESCE(SUM(available_micro), 0) AS TEXT) as total
    FROM credit_lots
  `).get() as { total: string };
  return BigInt(row.total);
}

function getAccountBalance(testDb: Database.Database, accountId: string): bigint {
  const row = testDb.prepare(`
    SELECT CAST(COALESCE(SUM(available_micro), 0) AS TEXT) as balance
    FROM credit_lots WHERE account_id = ?
  `).get(accountId) as { balance: string };
  return BigInt(row.balance);
}

// =============================================================================
// Setup / Teardown
// =============================================================================

beforeEach(() => {
  db = createTestDb();
  ledger = new CreditLedgerAdapter(db);
  transferService = new PeerTransferService(db, ledger);
  reconciliation = new ReconciliationService(db);
});

afterEach(() => {
  db.close();
});

// =============================================================================
// G-5: Conservation Stress Tests
// =============================================================================

describe('Transfer Conservation Stress Test (G-5)', () => {
  it('100 random transfers preserve total supply invariant', async () => {
    // Create 10 accounts with $100 each
    const numAccounts = 10;
    const initialBalance = BigInt(100_000_000); // $100
    const accounts: string[] = [];

    for (let i = 0; i < numAccounts; i++) {
      const id = createAccount(db, `stress-agent-${i}`);
      mintLot(db, id, initialBalance);
      accounts.push(id);
    }

    const expectedTotalSupply = BigInt(numAccounts) * initialBalance;
    expect(getTotalSupply(db)).toBe(expectedTotalSupply);

    // Deterministic RNG for reproducible stress tests
    const rng = createRng(0x1a2b3c4d);
    const randInt = (max: number) => rng() % max;

    // Execute 100 random transfers
    let completed = 0;
    let rejected = 0;
    const transferLog: Array<{ from: string; to: string; amount: bigint; status: string }> = [];

    for (let i = 0; i < 100; i++) {
      const fromIdx = randInt(numAccounts);
      let toIdx = randInt(numAccounts);
      while (toIdx === fromIdx) {
        toIdx = randInt(numAccounts);
      }

      const from = accounts[fromIdx];
      const to = accounts[toIdx];
      // Random amount between $1 and $15 (deterministic)
      const amount = BigInt(randInt(14_000_000) + 1_000_000);

      try {
        const result = await transferService.transfer(from, to, amount, {
          idempotencyKey: `stress-100-${i}`,
        });

        transferLog.push({ from, to, amount, status: result.status });
        if (result.status === 'completed') completed++;
        else rejected++;
      } catch {
        transferLog.push({ from, to, amount, status: 'error' });
        rejected++;
      }

      // Verify conservation after every 10 transfers
      if ((i + 1) % 10 === 0) {
        const currentSupply = getTotalSupply(db);
        expect(currentSupply).toBe(expectedTotalSupply);
      }
    }

    // At least some transfers should succeed
    expect(completed).toBeGreaterThan(0);

    // Final conservation check
    const finalSupply = getTotalSupply(db);
    expect(finalSupply).toBe(expectedTotalSupply);

    // Sum of all balances should equal total available supply
    let sumBalances = BigInt(0);
    for (const acct of accounts) {
      sumBalances += getAccountBalance(db, acct);
    }
    expect(sumBalances).toBe(getSumAvailable(db));

    // Full reconciliation passes
    const reconcResult = await reconciliation.reconcile();
    expect(reconcResult.status).toBe('passed');

    // Specifically verify transfer conservation check
    const transferCheck = reconcResult.checks.find(
      (c: any) => c.name === 'transfer_conservation',
    );
    expect(transferCheck).toBeDefined();
    expect(transferCheck!.status).toBe('passed');
  });

  it('sequential transfers between same pair preserve balance', async () => {
    const acctA = createAccount(db, 'seq-a');
    const acctB = createAccount(db, 'seq-b');

    // Mint $1000 each
    mintLot(db, acctA, BigInt(1_000_000_000));
    mintLot(db, acctB, BigInt(1_000_000_000));

    const initialTotal = getTotalSupply(db);

    // A sends B $10, 50 times = $500
    for (let i = 0; i < 50; i++) {
      await transferService.transfer(acctA, acctB, BigInt(10_000_000), {
        idempotencyKey: `seq-ab-${i}`,
      });
    }

    // B sends A $5, 50 times = $250
    for (let i = 0; i < 50; i++) {
      await transferService.transfer(acctB, acctA, BigInt(5_000_000), {
        idempotencyKey: `seq-ba-${i}`,
      });
    }

    // A: started 1000, sent 500, received 250 → 750
    expect(getAccountBalance(db, acctA)).toBe(BigInt(750_000_000));
    // B: started 1000, received 500, sent 250 → 1250
    expect(getAccountBalance(db, acctB)).toBe(BigInt(1_250_000_000));

    // Total unchanged
    expect(getTotalSupply(db)).toBe(initialTotal);

    // Reconciliation passes
    const result = await reconciliation.reconcile();
    expect(result.status).toBe('passed');
  });

  it('insufficient balance rejections do not alter supply', async () => {
    const acctA = createAccount(db, 'insuf-a');
    const acctB = createAccount(db, 'insuf-b');

    mintLot(db, acctA, BigInt(10_000_000)); // $10 only

    const supplyBefore = getTotalSupply(db);

    // Try to send $100 (exceeds balance)
    try {
      const result = await transferService.transfer(acctA, acctB, BigInt(100_000_000), {
        idempotencyKey: 'insuf-test',
      });
      expect(result.status).toBe('rejected');
    } catch {
      // Also acceptable — some implementations throw
    }

    // Supply unchanged
    expect(getTotalSupply(db)).toBe(supplyBefore);

    // Account A balance unchanged
    expect(getAccountBalance(db, acctA)).toBe(BigInt(10_000_000));
  });
});

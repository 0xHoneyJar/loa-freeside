/**
 * Deposit Bridge E2E Test (Sprint 291, Task 8.3)
 *
 * End-to-end deposit bridge test verifying:
 *   On-chain deposit detected → credit lot minted → balance updated →
 *   event emitted → reconciliation passes → idempotency holds
 *
 * Uses mocked on-chain verification (no live RPC).
 *
 * SDD refs: §8.2 Deposit Bridge E2E
 * PRD refs: G-2 TBA binding + deposit bridge
 * Sprint refs: Sprint 291 Task 8.3
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';

// Schema imports
import { CREDIT_LEDGER_SCHEMA_SQL } from '../../src/db/migrations/030_credit_ledger.js';
import { TBA_DEPOSITS_SQL } from '../../src/db/migrations/057_tba_deposits.js';
import { ECONOMIC_EVENTS_SQL } from '../../src/db/migrations/054_economic_events.js';

// Service imports
import { CreditLedgerAdapter } from '../../src/packages/adapters/billing/CreditLedgerAdapter.js';
import { TbaDepositBridge } from '../../src/packages/adapters/billing/TbaDepositBridge.js';
import { EconomicEventEmitter } from '../../src/packages/adapters/billing/EconomicEventEmitter.js';
import { ReconciliationService } from '../../src/packages/adapters/billing/ReconciliationService.js';
import type { TbaDepositBridgeConfig } from '../../src/packages/core/ports/ITbaDepositBridge.js';

// =============================================================================
// Test Constants
// =============================================================================

const ESCROW_ADDRESS = '0x742d35cc6634c0532925a3b844bc9e7595f2bd38';
const TOKEN_ADDRESS = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'; // USDC
const CHAIN_ID = 1;

const TEST_CONFIG: TbaDepositBridgeConfig = {
  acceptedTokens: [TOKEN_ADDRESS],
  escrowAddresses: { [CHAIN_ID]: ESCROW_ADDRESS },
  finalityDepth: 12,
  supportedChainIds: [CHAIN_ID],
};

// =============================================================================
// Test Helpers
// =============================================================================

let db: Database.Database;
let ledger: CreditLedgerAdapter;
let bridge: TbaDepositBridge;
let eventEmitter: EconomicEventEmitter;
let reconciliation: ReconciliationService;

function createTestDb(): Database.Database {
  const testDb = new Database(':memory:');
  testDb.pragma('journal_mode = WAL');
  testDb.pragma('foreign_keys = ON');

  testDb.exec(CREDIT_LEDGER_SCHEMA_SQL);
  // Drop and recreate credit_lots with 'tba_deposit' source_type (matching migration 060)
  testDb.pragma('foreign_keys = OFF');
  testDb.exec(`DROP TABLE IF EXISTS credit_lots`);
  testDb.exec(`
    CREATE TABLE credit_lots (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES credit_accounts(id),
      pool_id TEXT,
      source_type TEXT NOT NULL CHECK (source_type IN (
        'deposit', 'grant', 'purchase', 'transfer_in', 'commons_dividend', 'tba_deposit'
      )),
      source_id TEXT,
      original_micro INTEGER NOT NULL,
      available_micro INTEGER NOT NULL DEFAULT 0,
      reserved_micro INTEGER NOT NULL DEFAULT 0,
      consumed_micro INTEGER NOT NULL DEFAULT 0,
      expires_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      CONSTRAINT lot_balance CHECK (available_micro >= 0 AND reserved_micro >= 0 AND consumed_micro >= 0),
      CONSTRAINT lot_invariant CHECK (available_micro + reserved_micro + consumed_micro = original_micro)
    );
    CREATE INDEX IF NOT EXISTS idx_credit_lots_redemption
      ON credit_lots(account_id, pool_id, expires_at) WHERE available_micro > 0;
    CREATE INDEX IF NOT EXISTS idx_credit_lots_account ON credit_lots(account_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_credit_lots_source
      ON credit_lots(source_type, source_id) WHERE source_id IS NOT NULL;
  `);
  testDb.pragma('foreign_keys = ON');
  testDb.exec(ECONOMIC_EVENTS_SQL);
  testDb.exec(TBA_DEPOSITS_SQL);

  // Reconciliation runs
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

  // Agent identity (for TBA lookups)
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

  return testDb;
}

function createAccount(testDb: Database.Database, entityType: string, externalId: string): string {
  const id = randomUUID();
  testDb.prepare(`
    INSERT INTO credit_accounts (id, entity_type, entity_id, created_at)
    VALUES (?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  `).run(id, entityType, externalId);
  return id;
}

function bindTba(testDb: Database.Database, accountId: string, creatorId: string, tbaAddress: string): void {
  testDb.prepare(`
    INSERT INTO agent_identity (id, account_id, chain_id, contract_address, token_id, tba_address, creator_account_id, verified_at)
    VALUES (?, ?, ?, '0x1234567890abcdef1234567890abcdef12345678', ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  `).run(randomUUID(), accountId, CHAIN_ID, randomUUID(), tbaAddress, creatorId);
}

function getAccountBalance(testDb: Database.Database, accountId: string): bigint {
  const rows = testDb.prepare(`
    SELECT available_micro FROM credit_lots
    WHERE account_id = ?
  `).all(accountId) as Array<{ available_micro: string | number | null }>;
  return rows.reduce((acc, r) => acc + BigInt(String(r.available_micro ?? 0)), 0n);
}

function getDepositCount(testDb: Database.Database, status?: string): number {
  if (status) {
    return (testDb.prepare(`SELECT COUNT(*) as cnt FROM tba_deposits WHERE status = ?`).get(status) as { cnt: number }).cnt;
  }
  return (testDb.prepare(`SELECT COUNT(*) as cnt FROM tba_deposits`).get() as { cnt: number }).cnt;
}

function getEventCount(testDb: Database.Database, eventType: string): number {
  return (testDb.prepare(`SELECT COUNT(*) as cnt FROM economic_events WHERE event_type = ?`).get(eventType) as { cnt: number }).cnt;
}

// =============================================================================
// Setup / Teardown
// =============================================================================

beforeEach(() => {
  db = createTestDb();
  ledger = new CreditLedgerAdapter(db);
  eventEmitter = new EconomicEventEmitter(db);
  bridge = new TbaDepositBridge(db, TEST_CONFIG, ledger, eventEmitter);
  reconciliation = new ReconciliationService(db);
});

afterEach(() => {
  db.close();
  vi.restoreAllMocks();
});

// =============================================================================
// G-2: TBA Deposit Bridge E2E
// =============================================================================

describe('TBA Deposit Bridge E2E (G-2)', () => {
  it('successful deposit: detect → bridge → lot minted → balance updated', async () => {
    // Setup: creator and agent with TBA
    const creatorId = createAccount(db, 'person', 'creator-deposit');
    const agentId = createAccount(db, 'agent', 'agent-deposit');
    const tbaAddress = '0x' + 'ab'.repeat(20);
    bindTba(db, agentId, creatorId, tbaAddress);

    expect(getAccountBalance(db, agentId)).toBe(BigInt(0));

    const txHash = '0x' + 'ff'.repeat(32);
    const depositAmount = '50000000'; // 50 USDC = $50

    // Mock the on-chain verification to return success
    vi.spyOn(bridge as any, 'verifyOnChain').mockResolvedValue({
      valid: true,
      finalityReached: true,
      reason: null,
      confirmations: 20,
      receiptHash: '0x' + 'aa'.repeat(32),
      verifiedLogIndex: 0,
    });

    const result = await bridge.detectAndBridge({
      chainId: CHAIN_ID,
      txHash,
      tokenAddress: TOKEN_ADDRESS,
      amountRaw: depositAmount,
      fromAddress: tbaAddress,
      toAddress: ESCROW_ADDRESS,
      blockNumber: 19000000,
      logIndex: 0,
    });

    expect(result.status).toBe('bridged');
    expect(result.amountMicro).toBe(BigInt(depositAmount));
    expect(result.lotId).toBeDefined();
    expect(result.agentAccountId).toBe(agentId);

    // Agent balance updated
    expect(getAccountBalance(db, agentId)).toBe(BigInt(depositAmount));

    // Lot created with source_type='tba_deposit'
    const lot = db.prepare(`
      SELECT * FROM credit_lots WHERE account_id = ? AND source_type = 'tba_deposit'
    `).get(agentId) as any;
    expect(lot).toBeDefined();
    expect(BigInt(String(lot.original_micro))).toBe(BigInt(depositAmount));

    // Deposit record exists with status='bridged'
    expect(getDepositCount(db, 'bridged')).toBe(1);

    // Event emitted
    expect(getEventCount(db, 'TbaDepositBridged')).toBe(1);
  });

  it('idempotency: same tx_hash returns existing result', async () => {
    const creatorId = createAccount(db, 'person', 'creator-idem');
    const agentId = createAccount(db, 'agent', 'agent-idem');
    const tbaAddress = '0x' + 'de'.repeat(20);
    bindTba(db, agentId, creatorId, tbaAddress);

    const txHash = '0x' + 'ee'.repeat(32);

    vi.spyOn(bridge as any, 'verifyOnChain').mockResolvedValue({
      valid: true,
      finalityReached: true,
      reason: null,
      confirmations: 20,
      receiptHash: '0x' + 'bb'.repeat(32),
      verifiedLogIndex: 0,
    });

    const detection = {
      chainId: CHAIN_ID,
      txHash,
      tokenAddress: TOKEN_ADDRESS,
      amountRaw: '25000000',
      fromAddress: tbaAddress,
      toAddress: ESCROW_ADDRESS,
      blockNumber: 19000001,
      logIndex: 0,
    };

    // First call
    const result1 = await bridge.detectAndBridge(detection);
    expect(result1.status).toBe('bridged');

    // Second call — same tx_hash
    const result2 = await bridge.detectAndBridge(detection);
    expect(result2.depositId).toBe(result1.depositId);
    expect(result2.status).toBe('bridged');

    // Only one lot created (no duplicate)
    const lots = db.prepare(`
      SELECT COUNT(*) as cnt FROM credit_lots WHERE account_id = ? AND source_type = 'tba_deposit'
    `).get(agentId) as { cnt: number };
    expect(lots.cnt).toBe(1);

    // Only one deposit record
    expect(getDepositCount(db)).toBe(1);

    // Balance only credited once
    expect(getAccountBalance(db, agentId)).toBe(BigInt(25000000));
  });

  it('failed verification: deposit marked failed, no lot minted', async () => {
    const creatorId = createAccount(db, 'person', 'creator-fail');
    const agentId = createAccount(db, 'agent', 'agent-fail');
    const tbaAddress = '0x' + 'fa'.repeat(20);
    bindTba(db, agentId, creatorId, tbaAddress);

    vi.spyOn(bridge as any, 'verifyOnChain').mockResolvedValue({
      valid: false,
      finalityReached: false,
      reason: 'No matching Transfer found in receipt logs',
    });

    const result = await bridge.detectAndBridge({
      chainId: CHAIN_ID,
      txHash: '0x' + 'dd'.repeat(32),
      tokenAddress: TOKEN_ADDRESS,
      amountRaw: '10000000',
      fromAddress: tbaAddress,
      toAddress: ESCROW_ADDRESS,
      blockNumber: 19000002,
      logIndex: 0,
    });

    expect(result.status).toBe('failed');
    expect(result.lotId).toBeNull();
    expect(result.errorMessage).toContain('No matching Transfer');

    // No balance added
    expect(getAccountBalance(db, agentId)).toBe(BigInt(0));

    // No lots created
    const lots = db.prepare(`
      SELECT COUNT(*) as cnt FROM credit_lots WHERE account_id = ? AND source_type = 'tba_deposit'
    `).get(agentId) as { cnt: number };
    expect(lots.cnt).toBe(0);
  });

  it('multiple deposits accumulate correctly', async () => {
    const creatorId = createAccount(db, 'person', 'creator-multi');
    const agentId = createAccount(db, 'agent', 'agent-multi');
    const tbaAddress = '0x' + 'ab'.repeat(20);
    bindTba(db, agentId, creatorId, tbaAddress);

    vi.spyOn(bridge as any, 'verifyOnChain').mockResolvedValue({
      valid: true,
      finalityReached: true,
      reason: null,
      confirmations: 20,
      receiptHash: '0x' + 'aa'.repeat(32),
      verifiedLogIndex: 0,
    });

    const amounts = [10_000_000, 25_000_000, 50_000_000, 100_000_000];
    let expectedBalance = BigInt(0);

    for (let i = 0; i < amounts.length; i++) {
      const result = await bridge.detectAndBridge({
        chainId: CHAIN_ID,
        txHash: '0x' + i.toString(16).padStart(64, '0'),
        tokenAddress: TOKEN_ADDRESS,
        amountRaw: amounts[i].toString(),
        fromAddress: tbaAddress,
        toAddress: ESCROW_ADDRESS,
        blockNumber: 19000000 + i,
        logIndex: 0,
      });

      expect(result.status).toBe('bridged');
      expectedBalance += BigInt(amounts[i]);
    }

    // Total balance equals sum of all deposits
    expect(getAccountBalance(db, agentId)).toBe(expectedBalance);

    // 4 deposit records
    expect(getDepositCount(db, 'bridged')).toBe(4);

    // 4 lots
    const lotCount = db.prepare(`
      SELECT COUNT(*) as cnt FROM credit_lots WHERE account_id = ? AND source_type = 'tba_deposit'
    `).get(agentId) as { cnt: number };
    expect(lotCount.cnt).toBe(4);
  });

  it('deposit bridge conservation check passes (Check 6)', async () => {
    const creatorId = createAccount(db, 'person', 'creator-conserve');
    const agentId = createAccount(db, 'agent', 'agent-conserve');
    const tbaAddress = '0x' + 'cd'.repeat(20);
    bindTba(db, agentId, creatorId, tbaAddress);

    vi.spyOn(bridge as any, 'verifyOnChain').mockResolvedValue({
      valid: true,
      finalityReached: true,
      reason: null,
      confirmations: 20,
      receiptHash: '0x' + 'aa'.repeat(32),
      verifiedLogIndex: 0,
    });

    // Bridge a deposit
    await bridge.detectAndBridge({
      chainId: CHAIN_ID,
      txHash: '0x' + 'ab'.repeat(32),
      tokenAddress: TOKEN_ADDRESS,
      amountRaw: '75000000',
      fromAddress: tbaAddress,
      toAddress: ESCROW_ADDRESS,
      blockNumber: 19000000,
      logIndex: 0,
    });

    // Reconciliation should pass, including Check 6
    const reconcResult = await reconciliation.reconcile();
    expect(reconcResult.status).toBe('passed');

    const depositCheck = reconcResult.checks.find(
      (c: any) => c.name === 'deposit_bridge_conservation',
    );
    expect(depositCheck).toBeDefined();
    expect(depositCheck!.status).toBe('passed');
  });
});

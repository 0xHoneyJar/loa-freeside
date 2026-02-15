/**
 * Agent Wallet Prototype Tests
 *
 * Validates Sprint 6 + Sprint 9: ERC-6551 agent wallet prototype including
 * agent account creation, TBA deposit simulation, inference spending,
 * daily cap enforcement, refill detection, identity binding, and Redis spending.
 *
 * SDD refs: §8 Sprint 6
 * Sprint refs: Tasks 6.1–6.2, 9.3, 9.4
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { CREDIT_LEDGER_SCHEMA_SQL } from '../../src/db/migrations/030_credit_ledger.js';
import { CreditLedgerAdapter } from '../../src/packages/adapters/billing/CreditLedgerAdapter.js';
import {
  AgentWalletPrototype,
  type AgentWalletConfig,
} from '../../src/packages/adapters/billing/AgentWalletPrototype.js';

// =============================================================================
// Test Setup
// =============================================================================

let db: Database.Database;
let ledger: CreditLedgerAdapter;
let agentWallets: AgentWalletPrototype;

function setupDb(): Database.Database {
  const testDb = new Database(':memory:');
  testDb.pragma('journal_mode = WAL');
  testDb.pragma('foreign_keys = OFF');
  testDb.exec(CREDIT_LEDGER_SCHEMA_SQL);
  testDb.pragma('foreign_keys = ON');
  return testDb;
}

const defaultConfig: AgentWalletConfig = {
  tokenId: 'finn-42',
  dailyCapMicro: 10_000_000n, // $10/day
  refillThresholdMicro: 2_000_000n, // $2 refill trigger
  ownerAddress: '0x1234567890abcdef1234567890abcdef12345678',
};

// =============================================================================
// Setup / Teardown
// =============================================================================

beforeEach(() => {
  db = setupDb();
  ledger = new CreditLedgerAdapter(db);
  agentWallets = new AgentWalletPrototype(ledger);
});

afterEach(() => {
  db.close();
});

// =============================================================================
// Tests
// =============================================================================

describe('Agent Wallet Prototype', () => {
  // ---------------------------------------------------------------------------
  // Agent Account Creation
  // ---------------------------------------------------------------------------

  describe('agent-account', () => {
    it('creates an agent credit account with entity_type agent', async () => {
      const wallet = await agentWallets.createAgentWallet(defaultConfig);

      expect(wallet.account.entityType).toBe('agent');
      expect(wallet.account.entityId).toBe('finn-finn-42');
      expect(wallet.tbaAddress).toMatch(/^0x[a-f0-9]{40}$/);
      expect(wallet.config.dailyCapMicro).toBe(10_000_000n);
    });

    it('returns same account on duplicate creation (idempotent)', async () => {
      const wallet1 = await agentWallets.createAgentWallet(defaultConfig);
      const wallet2 = await agentWallets.createAgentWallet(defaultConfig);

      expect(wallet1.account.id).toBe(wallet2.account.id);
    });
  });

  // ---------------------------------------------------------------------------
  // TBA Deposit Simulation
  // ---------------------------------------------------------------------------

  describe('tba-deposit', () => {
    it('simulates a TBA USDC deposit into credit account', async () => {
      const wallet = await agentWallets.createAgentWallet(defaultConfig);

      const deposit = await agentWallets.simulateTbaDeposit(
        wallet,
        50_000_000n, // $50
        '0xabc123',
      );

      expect(deposit.lotId).toBeTruthy();
      expect(deposit.balanceMicro).toBe(50_000_000n);
    });
  });

  // ---------------------------------------------------------------------------
  // Agent Inference Spending
  // ---------------------------------------------------------------------------

  describe('agent-spending', () => {
    it('agent reserves and finalizes credits for inference', async () => {
      const wallet = await agentWallets.createAgentWallet(defaultConfig);
      await agentWallets.simulateTbaDeposit(wallet, 20_000_000n, '0xdeposit1');

      // Reserve for inference
      const spend = await agentWallets.reserveForInference(wallet, 1_000_000n);
      expect(spend.reservationId).toBeTruthy();
      expect(spend.amountMicro).toBe(1_000_000n);
      expect(spend.remainingBalanceMicro).toBe(19_000_000n);

      // Finalize with actual cost (less than reserved)
      const finalize = await agentWallets.finalizeInference(
        wallet,
        spend.reservationId,
        800_000n,
      );

      expect(finalize.finalizedMicro).toBe(800_000n);
      expect(finalize.releasedMicro).toBe(200_000n); // surplus released
      expect(finalize.remainingBalanceMicro).toBe(19_200_000n);
      expect(finalize.needsRefill).toBe(false);
    });

    it('enforces daily spending cap', async () => {
      const wallet = await agentWallets.createAgentWallet({
        ...defaultConfig,
        dailyCapMicro: 2_000_000n, // $2/day cap
      });
      await agentWallets.simulateTbaDeposit(wallet, 50_000_000n, '0xdeposit2');

      // First reservation within cap
      const spend1 = await agentWallets.reserveForInference(wallet, 1_500_000n);
      await agentWallets.finalizeInference(wallet, spend1.reservationId, 1_500_000n);

      // Second reservation exceeds daily cap
      await expect(
        agentWallets.reserveForInference(wallet, 1_000_000n),
      ).rejects.toThrow('daily cap exceeded');
    });

    it('detects when agent needs TBA refill', async () => {
      const wallet = await agentWallets.createAgentWallet({
        ...defaultConfig,
        refillThresholdMicro: 5_000_000n, // $5 threshold
      });
      await agentWallets.simulateTbaDeposit(wallet, 6_000_000n, '0xdeposit3');

      // Spend down to below threshold
      const spend = await agentWallets.reserveForInference(wallet, 3_000_000n);
      const result = await agentWallets.finalizeInference(
        wallet,
        spend.reservationId,
        3_000_000n,
      );

      // $3 remaining < $5 threshold
      expect(result.needsRefill).toBe(true);
      expect(result.remainingBalanceMicro).toBe(3_000_000n);

      const needsRefill = await agentWallets.needsRefill(wallet);
      expect(needsRefill).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Task 9.3: Identity Anchor Binding
  // ---------------------------------------------------------------------------

  describe('identity-binding', () => {
    it('creates wallet with identity anchor and verifies binding', async () => {
      const config: AgentWalletConfig = {
        ...defaultConfig,
        identityAnchor: 'anchor-hash-abc123',
      };
      const wallet = await agentWallets.createAgentWallet(config);

      expect(wallet.config.identityAnchor).toBe('anchor-hash-abc123');
      expect(wallet.tbaAddress).toMatch(/^0x[a-f0-9]{40}$/);

      // Verify binding
      expect(agentWallets.verifyIdentityBinding(wallet, 'anchor-hash-abc123')).toBe(true);
      expect(agentWallets.verifyIdentityBinding(wallet, 'wrong-anchor')).toBe(false);
    });

    it('identity anchor changes TBA address derivation', async () => {
      const walletNoAnchor = await agentWallets.createAgentWallet(defaultConfig);
      const walletWithAnchor = await agentWallets.createAgentWallet({
        ...defaultConfig,
        identityAnchor: 'my-anchor',
      });

      // TBA addresses should differ when anchor is included
      expect(walletNoAnchor.tbaAddress).not.toBe(walletWithAnchor.tbaAddress);
    });
  });

  // ---------------------------------------------------------------------------
  // Task 9.4: Redis-Backed Daily Spending
  // ---------------------------------------------------------------------------

  describe('redis-daily-spending', () => {
    it('persists daily spending to Redis and reads back', async () => {
      // Create a mock Redis client
      const store = new Map<string, string>();
      const mockRedis = {
        get: async (key: string) => store.get(key) ?? null,
        set: async (key: string, value: string) => { store.set(key, value); return 'OK'; },
        setex: async (key: string, _seconds: number, value: string) => { store.set(key, value); return 'OK'; },
        expire: async (_key: string, _seconds: number) => 1,
      };

      const redisWallets = new AgentWalletPrototype(ledger, mockRedis);
      const wallet = await redisWallets.createAgentWallet(defaultConfig);
      await redisWallets.simulateTbaDeposit(wallet, 20_000_000n, '0xredis1');

      // Reserve and finalize — should write to Redis
      const spend = await redisWallets.reserveForInference(wallet, 1_000_000n);
      await redisWallets.finalizeInference(wallet, spend.reservationId, 800_000n);

      // Verify Redis has the daily spend value
      const todayKey = `${wallet.account.id}:${new Date().toISOString().slice(0, 10)}`;
      const redisVal = store.get(`billing:agent:daily:${todayKey}`);
      expect(redisVal).toBe('800000');

      // getRemainingDailyBudget reads from Redis
      const remaining = await redisWallets.getRemainingDailyBudget(wallet);
      expect(remaining).toBe(10_000_000n - 800_000n);
    });

    it('falls back to in-memory when Redis unavailable', async () => {
      // Create a failing Redis client
      const failRedis = {
        get: async () => { throw new Error('Connection refused'); },
        set: async () => { throw new Error('Connection refused'); },
      };

      const fallbackWallets = new AgentWalletPrototype(ledger, failRedis as any);
      const wallet = await fallbackWallets.createAgentWallet(defaultConfig);
      await fallbackWallets.simulateTbaDeposit(wallet, 20_000_000n, '0xfallback1');

      // Should work via in-memory fallback
      const spend = await fallbackWallets.reserveForInference(wallet, 500_000n);
      await fallbackWallets.finalizeInference(wallet, spend.reservationId, 500_000n);

      const remaining = await fallbackWallets.getRemainingDailyBudget(wallet);
      expect(remaining).toBe(10_000_000n - 500_000n);
    });
  });
});

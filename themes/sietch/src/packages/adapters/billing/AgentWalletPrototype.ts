/**
 * AgentWalletPrototype — ERC-6551 Agent Wallet Proof of Concept
 *
 * Demonstrates agent self-funding via credit ledger:
 * 1. Create agent credit account (entity_type: 'agent')
 * 2. Simulate TBA deposit → credit lot minting
 * 3. Agent reserves credits for inference
 * 4. Agent finalizes after inference completes
 *
 * Daily spending tracking uses shared IAtomicCounter (Sprint 246):
 * - Primary: Redis (INCRBY cache with midnight UTC TTL)
 * - Fallback: SQLite (persistent source of truth)
 * - Bootstrap: InMemory (sync-only fallback for test/prototype mode)
 *
 * SDD refs: §8 Sprint 6, §2.3 Daily Spending
 * Sprint refs: Task 6.2, Tasks 3.1-3.5, Task 2.5
 *
 * @module packages/adapters/billing/AgentWalletPrototype
 */

import type {
  ICreditLedgerService,
  CreditAccount,
  BalanceResult,
  ReservationResult,
  FinalizeResult,
} from '../../core/ports/ICreditLedgerService.js';
import type { IAtomicCounter } from '../../core/protocol/atomic-counter.js';
import { createAtomicCounter } from '../../core/protocol/atomic-counter.js';
import { RedisCounterBackend } from './counters/RedisCounterBackend.js';
import { SqliteCounterBackend } from './counters/SqliteCounterBackend.js';
import { InMemoryCounterBackend } from './counters/InMemoryCounterBackend.js';
import type Database from 'better-sqlite3';

// =============================================================================
// Redis Interface — Re-exported from Shared Package (Sprint 254 Task 3.2)
// =============================================================================

import type { IRedisClient } from '../../shared/atomic-counter/types.js';

/** @deprecated Use IRedisClient from packages/shared/atomic-counter instead */
export type AgentRedisClient = IRedisClient;

// =============================================================================
// Types
// =============================================================================

export interface AgentWalletConfig {
  /** The finnNFT token ID */
  tokenId: string;
  /** Daily spending cap in micro-USD */
  dailyCapMicro: bigint;
  /** Auto-refill threshold in micro-USD (trigger deposit when balance drops below) */
  refillThresholdMicro: bigint;
  /** Owner address (NFT holder) */
  ownerAddress: string;
  /** Optional NFT-based identity anchor hash (loa-hounfour sybil resistance) */
  identityAnchor?: string;
}

export interface AgentWallet {
  /** Credit account for this agent */
  account: CreditAccount;
  /** Agent configuration */
  config: AgentWalletConfig;
  /** Simulated TBA address (deterministic from tokenId) */
  tbaAddress: string;
}

export interface AgentSpendResult {
  reservationId: string;
  amountMicro: bigint;
  remainingBalanceMicro: bigint;
}

export interface AgentFinalizeResult {
  finalizedMicro: bigint;
  releasedMicro: bigint;
  remainingBalanceMicro: bigint;
  needsRefill: boolean;
}

// =============================================================================
// AgentWalletPrototype
// =============================================================================

export class AgentWalletPrototype {
  private ledger: ICreditLedgerService;
  private counter: IAtomicCounter;
  private dailySpent: Map<string, bigint> = new Map();
  private db: Database.Database | null;

  /**
   * Create with explicit counter (preferred).
   */
  constructor(
    ledger: ICreditLedgerService,
    options: {
      counter: IAtomicCounter;
      db?: Database.Database | null;
    },
  );
  /**
   * Legacy constructor — builds counter chain from redis/db.
   * Kept for backward compatibility with existing tests.
   */
  constructor(
    ledger: ICreditLedgerService,
    redis?: AgentRedisClient | null,
    db?: Database.Database | null,
  );
  constructor(
    ledger: ICreditLedgerService,
    redisOrOptions?: AgentRedisClient | null | {
      counter: IAtomicCounter;
      db?: Database.Database | null;
    },
    legacyDb?: Database.Database | null,
  ) {
    this.ledger = ledger;

    // Detect which constructor signature was used
    if (redisOrOptions && typeof redisOrOptions === 'object' && 'counter' in redisOrOptions) {
      // New signature: (ledger, { counter, db? })
      this.counter = redisOrOptions.counter;
      this.db = redisOrOptions.db ?? null;
    } else {
      // Legacy signature: (ledger, redis?, db?)
      const redis = redisOrOptions as AgentRedisClient | null | undefined;
      this.db = legacyDb ?? null;
      this.counter = this.buildCounterChain(redis ?? null, this.db);
    }
  }

  /**
   * Build a counter chain from legacy redis/db arguments.
   * Replicates the original 3-layer fallback behavior.
   */
  private buildCounterChain(
    redis: AgentRedisClient | null,
    db: Database.Database | null,
  ): IAtomicCounter {
    const inMemory = new InMemoryCounterBackend();

    if (redis && db) {
      return createAtomicCounter({
        primary: new RedisCounterBackend(redis, 'billing:agent:daily:'),
        fallback: new SqliteCounterBackend(db),
        bootstrap: inMemory,
      });
    }
    if (redis) {
      return createAtomicCounter({
        primary: new RedisCounterBackend(redis, 'billing:agent:daily:'),
        fallback: inMemory,
      });
    }
    if (db) {
      return createAtomicCounter({
        primary: new SqliteCounterBackend(db),
        fallback: inMemory,
      });
    }
    return createAtomicCounter({ primary: inMemory });
  }

  /**
   * Create an agent wallet linked to a finnNFT.
   * Creates a credit account with entity_type: 'agent'.
   */
  async createAgentWallet(config: AgentWalletConfig): Promise<AgentWallet> {
    const account = await this.ledger.getOrCreateAccount('agent', `finn-${config.tokenId}`);

    // Include identity anchor in TBA address derivation if provided (Task 9.3)
    const tbaInput = config.identityAnchor
      ? `tba-${config.tokenId}-${config.identityAnchor}`
      : `tba-${config.tokenId}`;
    const tbaAddress = `0x${Buffer.from(tbaInput).toString('hex').padStart(40, '0').slice(0, 40)}`;

    // Persist identity anchor to SQLite (Sprint 243, Task 5.2)
    if (config.identityAnchor && this.db) {
      this.persistIdentityAnchor(account.id, config.identityAnchor, config.ownerAddress);
    }

    return {
      account,
      config,
      tbaAddress,
    };
  }

  /**
   * Verify that a wallet's identity anchor matches the expected value.
   * Used for sybil resistance — ensures agent wallet is bound to a verified NFT identity.
   */
  verifyIdentityBinding(wallet: AgentWallet, expectedAnchor: string): boolean {
    return wallet.config.identityAnchor === expectedAnchor;
  }

  /**
   * Simulate a TBA deposit — funds arriving from on-chain USDC transfer.
   * In production, this would be triggered by an on-chain event listener.
   */
  async simulateTbaDeposit(
    wallet: AgentWallet,
    amountMicro: bigint,
    txHash: string,
  ): Promise<{ lotId: string; balanceMicro: bigint }> {
    const lot = await this.ledger.mintLot(
      wallet.account.id,
      amountMicro,
      'deposit',
      {
        sourceId: `tba-deposit-${txHash}`,
        poolId: 'general',
        description: `TBA deposit from ${wallet.tbaAddress}`,
        idempotencyKey: `tba:${txHash}`,
      },
    );

    const balance = await this.ledger.getBalance(wallet.account.id);

    return {
      lotId: lot.id,
      balanceMicro: balance.availableMicro,
    };
  }

  /**
   * Agent reserves credits for an inference call.
   * Enforces daily spending cap via shared counter.
   */
  async reserveForInference(
    wallet: AgentWallet,
    estimatedCostMicro: bigint,
  ): Promise<AgentSpendResult> {
    const todayKey = `${wallet.account.id}:${new Date().toISOString().slice(0, 10)}`;
    const spent = await this.counter.get(todayKey);

    if (spent + estimatedCostMicro > wallet.config.dailyCapMicro) {
      throw new Error(
        `Agent daily cap exceeded: spent ${spent} + ${estimatedCostMicro} > cap ${wallet.config.dailyCapMicro}`
      );
    }

    const reservation = await this.ledger.reserve(
      wallet.account.id,
      null,
      estimatedCostMicro,
      {
        billingMode: 'live',
        description: `Agent inference: finn-${wallet.config.tokenId}`,
      },
    );

    const balance = await this.ledger.getBalance(wallet.account.id);

    return {
      reservationId: reservation.reservationId,
      amountMicro: reservation.totalReservedMicro,
      remainingBalanceMicro: balance.availableMicro,
    };
  }

  /**
   * Finalize an agent's inference reservation with actual cost.
   * Increments daily spending counter and enforces cap.
   */
  async finalizeInference(
    wallet: AgentWallet,
    reservationId: string,
    actualCostMicro: bigint,
  ): Promise<AgentFinalizeResult> {
    // Cap enforcement at finalize time
    const todayKey = `${wallet.account.id}:${new Date().toISOString().slice(0, 10)}`;
    const currentSpent = await this.counter.get(todayKey);

    let cappedCost = actualCostMicro;
    if (currentSpent + actualCostMicro > wallet.config.dailyCapMicro) {
      const remaining = wallet.config.dailyCapMicro - currentSpent;
      cappedCost = remaining > 0n ? remaining : 0n;
    }

    const result = await this.ledger.finalize(reservationId, cappedCost);

    // Increment counter via shared counter chain
    await this.counter.increment(todayKey, result.actualCostMicro);

    // Mirror to sync Map for getRemainingDailyBudgetSync
    const newSpent = currentSpent + result.actualCostMicro;
    this.dailySpent.set(todayKey, newSpent);

    const balance = await this.ledger.getBalance(wallet.account.id);

    return {
      finalizedMicro: result.actualCostMicro,
      releasedMicro: result.surplusReleasedMicro,
      remainingBalanceMicro: balance.availableMicro,
      needsRefill: balance.availableMicro < wallet.config.refillThresholdMicro,
    };
  }

  /**
   * Get the agent's current credit balance.
   */
  async getBalance(wallet: AgentWallet): Promise<BalanceResult> {
    return this.ledger.getBalance(wallet.account.id);
  }

  /**
   * Check if the agent needs a refill from its TBA.
   */
  async needsRefill(wallet: AgentWallet): Promise<boolean> {
    const balance = await this.ledger.getBalance(wallet.account.id);
    return balance.availableMicro < wallet.config.refillThresholdMicro;
  }

  /**
   * Get remaining daily budget for an agent (async).
   * Reads via shared counter chain.
   */
  async getRemainingDailyBudget(wallet: AgentWallet): Promise<bigint> {
    const todayKey = `${wallet.account.id}:${new Date().toISOString().slice(0, 10)}`;
    const spent = await this.counter.get(todayKey);
    // Mirror to sync Map for getRemainingDailyBudgetSync
    this.dailySpent.set(todayKey, spent);
    const remaining = wallet.config.dailyCapMicro - spent;
    return remaining > 0n ? remaining : 0n;
  }

  /**
   * Get remaining daily budget synchronously (in-memory Map only).
   * For test/prototype mode where Redis and SQLite may not be available.
   * @deprecated Use getRemainingDailyBudget (async) instead.
   */
  getRemainingDailyBudgetSync(wallet: AgentWallet): bigint {
    const todayKey = `${wallet.account.id}:${new Date().toISOString().slice(0, 10)}`;
    const spent = this.dailySpent.get(todayKey) ?? 0n;
    const remaining = wallet.config.dailyCapMicro - spent;
    return remaining > 0n ? remaining : 0n;
  }

  // ---------------------------------------------------------------------------
  // Private: Identity anchor persistence (Sprint 243, Task 5.2)
  // ---------------------------------------------------------------------------

  /**
   * Persist identity anchor to agent_identity_anchors table.
   * Idempotent: INSERT OR IGNORE skips if anchor already bound to this account.
   */
  private persistIdentityAnchor(
    accountId: string,
    identityAnchor: string,
    createdBy: string,
  ): void {
    if (!this.db) return;
    try {
      this.db.prepare(`
        INSERT OR IGNORE INTO agent_identity_anchors
          (agent_account_id, identity_anchor, created_by)
        VALUES (?, ?, ?)
      `).run(accountId, identityAnchor, createdBy);
    } catch {
      // Table may not exist in test setup — non-fatal
    }
  }

  /**
   * Look up stored identity anchor for an agent account.
   * Returns null if no anchor is bound or table doesn't exist.
   */
  getStoredAnchor(accountId: string): string | null {
    if (!this.db) return null;
    try {
      const row = this.db.prepare(
        `SELECT identity_anchor FROM agent_identity_anchors WHERE agent_account_id = ?`
      ).get(accountId) as { identity_anchor: string } | undefined;
      return row?.identity_anchor ?? null;
    } catch {
      return null;
    }
  }
}

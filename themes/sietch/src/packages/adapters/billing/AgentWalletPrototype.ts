/**
 * AgentWalletPrototype — ERC-6551 Agent Wallet Proof of Concept
 *
 * Demonstrates agent self-funding via credit ledger:
 * 1. Create agent credit account (entity_type: 'agent')
 * 2. Simulate TBA deposit → credit lot minting
 * 3. Agent reserves credits for inference
 * 4. Agent finalizes after inference completes
 *
 * This is a prototype — no on-chain TBA interaction.
 * On-chain integration deferred to V2.
 *
 * SDD refs: §8 Sprint 6
 * Sprint refs: Task 6.2
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

// =============================================================================
// Redis Interface (Task 9.4)
// =============================================================================

/** Minimal Redis interface for daily spending persistence */
interface AgentRedisClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<string>;
  /** Set key with TTL in seconds */
  setex?(key: string, seconds: number, value: string): Promise<string>;
  expire?(key: string, seconds: number): Promise<number>;
}

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

/** Redis key prefix for agent daily spending */
const DAILY_SPEND_PREFIX = 'billing:agent:daily:';

export class AgentWalletPrototype {
  private ledger: ICreditLedgerService;
  private dailySpent: Map<string, bigint> = new Map();
  private redis: AgentRedisClient | null;

  constructor(ledger: ICreditLedgerService, redis?: AgentRedisClient | null) {
    this.ledger = ledger;
    this.redis = redis ?? null;
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
   * Enforces daily spending cap.
   */
  async reserveForInference(
    wallet: AgentWallet,
    estimatedCostMicro: bigint,
  ): Promise<AgentSpendResult> {
    // Check daily cap — read from Redis first, fallback to in-memory
    const todayKey = `${wallet.account.id}:${new Date().toISOString().slice(0, 10)}`;
    const spent = await this.getDailySpent(todayKey);

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
   * Updates daily spending tracker and checks refill threshold.
   */
  async finalizeInference(
    wallet: AgentWallet,
    reservationId: string,
    actualCostMicro: bigint,
  ): Promise<AgentFinalizeResult> {
    const result = await this.ledger.finalize(reservationId, actualCostMicro);

    // Track daily spending — persist to Redis + in-memory
    const todayKey = `${wallet.account.id}:${new Date().toISOString().slice(0, 10)}`;
    const currentSpent = await this.getDailySpent(todayKey);
    const newSpent = currentSpent + result.actualCostMicro;
    this.dailySpent.set(todayKey, newSpent);
    await this.setDailySpent(todayKey, newSpent);

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
   * Get remaining daily budget for an agent.
   * Reads from Redis first, falls back to in-memory.
   */
  async getRemainingDailyBudget(wallet: AgentWallet): Promise<bigint> {
    const todayKey = `${wallet.account.id}:${new Date().toISOString().slice(0, 10)}`;
    const spent = await this.getDailySpent(todayKey);
    const remaining = wallet.config.dailyCapMicro - spent;
    return remaining > 0n ? remaining : 0n;
  }

  // ---------------------------------------------------------------------------
  // Private: Redis-backed daily spending (Task 9.4)
  // ---------------------------------------------------------------------------

  /** Read daily spent from Redis first, fallback to in-memory Map */
  private async getDailySpent(todayKey: string): Promise<bigint> {
    if (this.redis) {
      try {
        const redisKey = `${DAILY_SPEND_PREFIX}${todayKey}`;
        const val = await this.redis.get(redisKey);
        if (val !== null) {
          const parsed = BigInt(val);
          // Sync to in-memory for consistency
          this.dailySpent.set(todayKey, parsed);
          return parsed;
        }
      } catch {
        // Redis unavailable — fall through to in-memory
      }
    }
    return this.dailySpent.get(todayKey) ?? 0n;
  }

  /** Write daily spent to Redis with end-of-day TTL */
  private async setDailySpent(todayKey: string, amount: bigint): Promise<void> {
    if (!this.redis) return;
    try {
      const redisKey = `${DAILY_SPEND_PREFIX}${todayKey}`;
      const ttl = this.secondsUntilMidnightUtc();
      if (this.redis.setex) {
        await this.redis.setex(redisKey, ttl, amount.toString());
      } else {
        await this.redis.set(redisKey, amount.toString());
        if (this.redis.expire) {
          await this.redis.expire(redisKey, ttl);
        }
      }
    } catch {
      // Redis unavailable — in-memory Map is still updated by caller
    }
  }

  /** Seconds remaining until midnight UTC */
  private secondsUntilMidnightUtc(): number {
    const now = new Date();
    const midnight = new Date(Date.UTC(
      now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1,
    ));
    return Math.max(1, Math.floor((midnight.getTime() - now.getTime()) / 1000));
  }
}

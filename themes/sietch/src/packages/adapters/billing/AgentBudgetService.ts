/**
 * AgentBudgetService — Per-agent daily spending caps with circuit breaker
 *
 * Budget is authorized capacity (not conserved funds). The credit ledger
 * remains the single source of truth for actual funds. This service provides
 * a secondary constraint: agents cannot spend more than their daily cap.
 *
 * Architecture:
 *   - SQLite is authoritative for spend tracking (agent_budget_finalizations)
 *   - Redis provides advisory fast-path for checkBudget (60s TTL)
 *   - recordFinalizationInTransaction enables atomic finalize + budget accounting
 *
 * SDD refs: §SS4.2, §SS7.1
 * Sprint refs: Task 5.3
 *
 * @module adapters/billing/AgentBudgetService
 */

import type Database from 'better-sqlite3';
import { logger } from '../../../utils/logger.js';
import { sqliteTimestamp } from './protocol/timestamps.js';
import type {
  IAgentBudgetService,
  BudgetCheckResult,
  SpendingLimit,
  CircuitState,
} from '../../core/ports/IAgentBudgetService.js';
import type { BillingEventEmitter } from './BillingEventEmitter.js';

// =============================================================================
// Constants
// =============================================================================

/** Redis TTL for advisory budget counters (seconds) */
const REDIS_TTL_SECONDS = 60;

/** Circuit breaker warning threshold (80% of cap) */
const WARNING_THRESHOLD_PCT = 80;

/** Circuit breaker open threshold (100% of cap) */
const OPEN_THRESHOLD_PCT = 100;

// =============================================================================
// Redis interface (optional dependency)
// =============================================================================

interface IRedisClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options?: { EX?: number }): Promise<unknown>;
  del(key: string): Promise<unknown>;
}

// =============================================================================
// AgentBudgetService
// =============================================================================

export class AgentBudgetService implements IAgentBudgetService {
  private db: Database.Database;
  private redis: IRedisClient | null;
  private eventEmitter: BillingEventEmitter | null;

  constructor(db: Database.Database, redis?: IRedisClient, eventEmitter?: BillingEventEmitter) {
    this.db = db;
    this.redis = redis ?? null;
    this.eventEmitter = eventEmitter ?? null;
  }

  async setDailyCap(accountId: string, capMicro: bigint): Promise<void> {
    const now = sqliteTimestamp();

    this.db.prepare(`
      INSERT INTO agent_spending_limits (account_id, daily_cap_micro, window_start, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(account_id) DO UPDATE SET
        daily_cap_micro = excluded.daily_cap_micro,
        updated_at = excluded.updated_at
    `).run(accountId, Number(capMicro), now, now);

    // Invalidate Redis cache
    if (this.redis) {
      await this.redis.del(`agent_budget:${accountId}`);
    }

    logger.info({ event: 'budget.cap_set', accountId, capMicro: capMicro.toString() },
      'Agent daily cap set');
  }

  async getDailyCap(accountId: string): Promise<SpendingLimit | null> {
    const row = this.db.prepare(`
      SELECT account_id, daily_cap_micro, current_spend_micro,
             window_start, window_duration_seconds, circuit_state
      FROM agent_spending_limits WHERE account_id = ?
    `).get(accountId) as {
      account_id: string;
      daily_cap_micro: number;
      current_spend_micro: number;
      window_start: string;
      window_duration_seconds: number;
      circuit_state: CircuitState;
    } | undefined;

    if (!row) return null;

    return {
      accountId: row.account_id,
      dailyCapMicro: BigInt(row.daily_cap_micro),
      currentSpendMicro: BigInt(row.current_spend_micro),
      windowStart: row.window_start,
      windowDurationSeconds: row.window_duration_seconds,
      circuitState: row.circuit_state,
    };
  }

  async checkBudget(accountId: string, amountMicro: bigint): Promise<BudgetCheckResult> {
    // Try Redis advisory fast-path
    if (this.redis) {
      try {
        const cached = await this.redis.get(`agent_budget:${accountId}`);
        if (cached) {
          const parsed = JSON.parse(cached) as { cap: string; spend: string; state: CircuitState };
          const cap = BigInt(parsed.cap);
          const spend = BigInt(parsed.spend);
          const remaining = cap - spend;
          return {
            allowed: parsed.state !== 'open' && remaining >= amountMicro,
            currentSpendMicro: spend,
            dailyCapMicro: cap,
            remainingMicro: remaining > 0n ? remaining : 0n,
            circuitState: parsed.state,
          };
        }
      } catch {
        // Redis miss — fall through to SQLite
      }
    }

    // SQLite authoritative check
    const limit = await this.getDailyCap(accountId);

    if (!limit) {
      // No cap configured — unlimited
      return {
        allowed: true,
        currentSpendMicro: 0n,
        dailyCapMicro: 0n,
        remainingMicro: 0n,
        circuitState: 'closed',
      };
    }

    const remaining = limit.dailyCapMicro - limit.currentSpendMicro;

    const result: BudgetCheckResult = {
      allowed: limit.circuitState !== 'open' && remaining >= amountMicro,
      currentSpendMicro: limit.currentSpendMicro,
      dailyCapMicro: limit.dailyCapMicro,
      remainingMicro: remaining > 0n ? remaining : 0n,
      circuitState: limit.circuitState,
    };

    // Update Redis cache
    if (this.redis) {
      try {
        await this.redis.set(`agent_budget:${accountId}`, JSON.stringify({
          cap: limit.dailyCapMicro.toString(),
          spend: limit.currentSpendMicro.toString(),
          state: limit.circuitState,
        }), { EX: REDIS_TTL_SECONDS });
      } catch {
        // Redis write failure is non-fatal
      }
    }

    return result;
  }

  async recordFinalization(accountId: string, reservationId: string, amountMicro: bigint): Promise<void> {
    this.db.transaction(() => {
      this.recordFinalizationInTransaction(this.db, accountId, reservationId, amountMicro);
    })();
  }

  recordFinalizationInTransaction(
    tx: { prepare(sql: string): any },
    accountId: string,
    reservationId: string,
    amountMicro: bigint,
  ): void {
    const now = sqliteTimestamp();

    // Idempotent insert — INSERT OR IGNORE on PK (account_id, reservation_id)
    const result = tx.prepare(`
      INSERT OR IGNORE INTO agent_budget_finalizations
        (account_id, reservation_id, amount_micro, finalized_at)
      VALUES (?, ?, ?, ?)
    `).run(accountId, reservationId, Number(amountMicro), now);

    // If changes === 0, this is a duplicate — skip spend recomputation
    if (result.changes === 0) {
      logger.debug({ event: 'budget.finalization_duplicate', accountId, reservationId },
        'Duplicate finalization ignored');
      return;
    }

    // Get current spending limit
    const limit = tx.prepare(`
      SELECT id, daily_cap_micro, window_start, window_duration_seconds
      FROM agent_spending_limits WHERE account_id = ?
    `).get(accountId) as {
      id: string;
      daily_cap_micro: number;
      window_start: string;
      window_duration_seconds: number;
    } | undefined;

    if (!limit) {
      // No cap configured — nothing to track
      return;
    }

    // Check window expiry and reset if needed
    const windowStart = new Date(limit.window_start).getTime();
    const windowEnd = windowStart + limit.window_duration_seconds * 1000;
    const currentTime = Date.now();

    let effectiveWindowStart = limit.window_start;

    if (currentTime >= windowEnd) {
      // Window expired — reset to current time
      effectiveWindowStart = now;
      tx.prepare(`
        UPDATE agent_spending_limits SET window_start = ?, updated_at = ? WHERE id = ?
      `).run(now, now, limit.id);
    }

    // Compute actual spend from finalizations within current window (half-open interval)
    const windowEndTimestamp = new Date(
      new Date(effectiveWindowStart).getTime() + limit.window_duration_seconds * 1000
    ).toISOString();

    const spendRow = tx.prepare(`
      SELECT COALESCE(SUM(amount_micro), 0) as total_spend
      FROM agent_budget_finalizations
      WHERE account_id = ? AND finalized_at >= ? AND finalized_at < ?
    `).get(accountId, effectiveWindowStart, windowEndTimestamp) as { total_spend: number };

    const newSpend = BigInt(spendRow.total_spend);
    const cap = BigInt(limit.daily_cap_micro);

    // Compute circuit state
    const pctUsed = cap > 0n ? Number((newSpend * 100n) / cap) : 0;
    let newState: CircuitState = 'closed';
    if (pctUsed >= OPEN_THRESHOLD_PCT) {
      newState = 'open';
    } else if (pctUsed >= WARNING_THRESHOLD_PCT) {
      newState = 'warning';
    }

    // Update spending limit
    tx.prepare(`
      UPDATE agent_spending_limits
      SET current_spend_micro = ?, circuit_state = ?, updated_at = ?
      WHERE id = ?
    `).run(Number(newSpend), newState, now, limit.id);

    // Emit circuit breaker events
    if (this.eventEmitter) {
      if (newState === 'warning') {
        this.eventEmitter.emit({
          type: 'AgentBudgetWarning',
          aggregateType: 'account',
          aggregateId: accountId,
          timestamp: now,
          causationId: `budget:finalize:${reservationId}`,
          payload: {
            accountId,
            currentSpendMicro: newSpend.toString(),
            dailyCapMicro: cap.toString(),
            pctUsed,
          },
        }, { db: tx as any });
      } else if (newState === 'open') {
        this.eventEmitter.emit({
          type: 'AgentBudgetExhausted',
          aggregateType: 'account',
          aggregateId: accountId,
          timestamp: now,
          causationId: `budget:finalize:${reservationId}`,
          payload: {
            accountId,
            currentSpendMicro: newSpend.toString(),
            dailyCapMicro: cap.toString(),
          },
        }, { db: tx as any });
      }
    }

    logger.info({
      event: 'budget.finalization_recorded',
      accountId, reservationId,
      amountMicro: amountMicro.toString(),
      newSpend: newSpend.toString(),
      circuitState: newState,
    }, 'Budget finalization recorded');
  }

  async resetExpiredWindows(): Promise<number> {
    const now = sqliteTimestamp();
    const currentTime = Date.now();

    // Find all expired windows
    const expired = this.db.prepare(`
      SELECT id, account_id, window_duration_seconds
      FROM agent_spending_limits
      WHERE (julianday('now') - julianday(window_start)) * 86400 >= window_duration_seconds
    `).all() as Array<{
      id: string;
      account_id: string;
      window_duration_seconds: number;
    }>;

    if (expired.length === 0) return 0;

    let resetCount = 0;

    for (const row of expired) {
      this.db.transaction(() => {
        // Reset window start to now
        this.db.prepare(`
          UPDATE agent_spending_limits
          SET window_start = ?, updated_at = ?
          WHERE id = ?
        `).run(now, now, row.id);

        // Recompute spend from finalizations in new window
        const windowEnd = new Date(currentTime + row.window_duration_seconds * 1000).toISOString();
        const spendRow = this.db.prepare(`
          SELECT COALESCE(SUM(amount_micro), 0) as total_spend
          FROM agent_budget_finalizations
          WHERE account_id = ? AND finalized_at >= ? AND finalized_at < ?
        `).get(row.account_id, now, windowEnd) as { total_spend: number };

        const newSpend = BigInt(spendRow.total_spend);
        const cap = (this.db.prepare(
          `SELECT daily_cap_micro FROM agent_spending_limits WHERE id = ?`
        ).get(row.id) as { daily_cap_micro: number }).daily_cap_micro;

        const pctUsed = cap > 0 ? Number((newSpend * 100n) / BigInt(cap)) : 0;
        let newState: CircuitState = 'closed';
        if (pctUsed >= OPEN_THRESHOLD_PCT) newState = 'open';
        else if (pctUsed >= WARNING_THRESHOLD_PCT) newState = 'warning';

        this.db.prepare(`
          UPDATE agent_spending_limits
          SET current_spend_micro = ?, circuit_state = ?, updated_at = ?
          WHERE id = ?
        `).run(Number(newSpend), newState, now, row.id);
      })();

      resetCount++;
    }

    // Invalidate Redis cache for reset accounts
    if (this.redis) {
      for (const row of expired) {
        try {
          await this.redis.del(`agent_budget:${row.account_id}`);
        } catch {
          // Non-fatal
        }
      }
    }

    logger.info({ event: 'budget.windows_reset', count: resetCount },
      `Reset ${resetCount} expired budget windows`);

    return resetCount;
  }

  async getCircuitState(accountId: string): Promise<CircuitState | null> {
    const row = this.db.prepare(
      `SELECT circuit_state FROM agent_spending_limits WHERE account_id = ?`
    ).get(accountId) as { circuit_state: CircuitState } | undefined;

    return row?.circuit_state ?? null;
  }
}

/**
 * Score Distribution & Campaign Integration Tests (Sprint 12)
 *
 * Tests proportional reward distribution, largest-remainder conservation,
 * campaign integration, distribution cron, and rewards API.
 *
 * SDD refs: §4.5 ScoreRewardsService
 * Sprint refs: Tasks 12.1–12.4
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { CREDIT_LEDGER_SCHEMA_SQL } from '../../src/db/migrations/030_credit_ledger.js';
import { BILLING_OPS_SCHEMA_SQL, BILLING_SYSTEM_ACCOUNTS_SQL } from '../../src/db/migrations/032_billing_ops.js';
import { CAMPAIGNS_SCHEMA_SQL } from '../../src/db/migrations/033_campaigns.js';
import { WALLET_LINKS_SQL } from '../../src/db/migrations/046_wallet_links.js';
import { ScoreRewardsService, SCORE_REWARDS_POOL } from '../../src/packages/adapters/billing/ScoreRewardsService.js';
import { createScoreDistribution } from '../../src/jobs/score-distribution.js';

// =============================================================================
// Test Setup
// =============================================================================

let db: Database.Database;

function setupDb(): Database.Database {
  const testDb = new Database(':memory:');
  testDb.pragma('journal_mode = WAL');
  testDb.pragma('foreign_keys = OFF');
  testDb.exec(CREDIT_LEDGER_SCHEMA_SQL);
  testDb.exec(BILLING_OPS_SCHEMA_SQL);
  testDb.exec(BILLING_SYSTEM_ACCOUNTS_SQL);
  testDb.exec(CAMPAIGNS_SCHEMA_SQL);
  testDb.exec(WALLET_LINKS_SQL);
  testDb.pragma('foreign_keys = ON');
  return testDb;
}

function seedAccount(testDb: Database.Database, id: string): void {
  testDb.prepare(
    `INSERT OR IGNORE INTO credit_accounts (id, entity_type, entity_id, created_at, updated_at)
     VALUES (?, 'person', ?, datetime('now'), datetime('now'))`
  ).run(id, `entity-${id}`);
}

function linkWallet(testDb: Database.Database, accountId: string, address: string, chainId: number = 1): void {
  testDb.prepare(
    `INSERT INTO wallet_links (id, account_id, wallet_address, chain_id)
     VALUES (?, ?, ?, ?)`
  ).run(`link-${accountId}-${address}`, accountId, address.toLowerCase(), chainId);
}

function importScore(testDb: Database.Database, address: string, score: number, period: string, chainId: number = 1): void {
  testDb.prepare(
    `INSERT INTO score_snapshots (id, wallet_address, chain_id, score, snapshot_period)
     VALUES (?, ?, ?, ?, ?)`
  ).run(`snap-${address}-${period}`, address.toLowerCase(), chainId, score, period);
}

// =============================================================================
// Setup / Teardown
// =============================================================================

beforeEach(() => {
  db = setupDb();
  seedAccount(db, 'alice');
  seedAccount(db, 'bob');
  seedAccount(db, 'charlie');
});

afterEach(() => {
  db.close();
});

// =============================================================================
// Task 12.1: ScoreRewardsService — Proportional Distribution
// =============================================================================

describe('Task 12.1: ScoreRewardsService distribution', () => {
  it('distributes rewards proportionally by score', () => {
    const service = new ScoreRewardsService(db);
    const addr1 = '0x1111111111111111111111111111111111111111';
    const addr2 = '0x2222222222222222222222222222222222222222';

    linkWallet(db, 'alice', addr1);
    linkWallet(db, 'bob', addr2);
    importScore(db, addr1, 300, '2026-01');
    importScore(db, addr2, 700, '2026-01');

    const result = service.distributeRewards('2026-01', 10_000_000n, { minThresholdMicro: 0n });

    expect(result.success).toBe(true);
    expect(result.participantCount).toBe(2);
    expect(result.totalScore).toBe(1000);

    // bob (700/1000) = 7,000,000; alice (300/1000) = 3,000,000
    const bobEntry = result.entries.find(e => e.accountId === 'bob')!;
    const aliceEntry = result.entries.find(e => e.accountId === 'alice')!;
    expect(bobEntry.rewardMicro).toBe(7_000_000n);
    expect(aliceEntry.rewardMicro).toBe(3_000_000n);
  });

  it('property: sum of rewards === pool_size for random score sets', () => {
    // Run 10 trials with random scores to verify conservation invariant
    for (let trial = 0; trial < 10; trial++) {
      const trialDb = setupDb();
      const service = new ScoreRewardsService(trialDb);
      const period = `2026-${(trial + 1).toString().padStart(2, '0')}`;
      const poolSize = BigInt(Math.floor(Math.random() * 100_000_000) + 1_000_000);
      const numParticipants = Math.floor(Math.random() * 15) + 2;

      for (let i = 0; i < numParticipants; i++) {
        const accountId = `user-${trial}-${i}`;
        seedAccount(trialDb, accountId);
        const addr = `0x${(trial * 100 + i).toString(16).padStart(40, '0')}`;
        linkWallet(trialDb, accountId, addr);
        const score = Math.floor(Math.random() * 1000) + 1;
        importScore(trialDb, addr, score, period);
      }

      const result = service.distributeRewards(period, poolSize, { minThresholdMicro: 0n });
      expect(result.success).toBe(true);

      const totalRewards = result.entries.reduce((sum, e) => sum + e.rewardMicro, 0n);
      expect(totalRewards).toBe(poolSize);

      trialDb.close();
    }
  });

  it('single participant gets full pool', () => {
    const service = new ScoreRewardsService(db);
    const addr = '0x1111111111111111111111111111111111111111';
    linkWallet(db, 'alice', addr);
    importScore(db, addr, 500, '2026-01');

    const result = service.distributeRewards('2026-01', 5_000_000n, { minThresholdMicro: 0n });

    expect(result.success).toBe(true);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].rewardMicro).toBe(5_000_000n);
  });

  it('equal scores split evenly, remainder to last by stable sort', () => {
    const service = new ScoreRewardsService(db);
    const addr1 = '0x1111111111111111111111111111111111111111';
    const addr2 = '0x2222222222222222222222222222222222222222';
    const addr3 = '0x3333333333333333333333333333333333333333';

    linkWallet(db, 'alice', addr1);
    linkWallet(db, 'bob', addr2);
    linkWallet(db, 'charlie', addr3);
    importScore(db, addr1, 100, '2026-01');
    importScore(db, addr2, 100, '2026-01');
    importScore(db, addr3, 100, '2026-01');

    // 10,000,001 / 3 = 3,333,333 each, remainder 2 goes to last
    const result = service.distributeRewards('2026-01', 10_000_001n, { minThresholdMicro: 0n });

    expect(result.success).toBe(true);
    const rewards = result.entries.map(e => e.rewardMicro);
    const totalRewards = rewards.reduce((a, b) => a + b, 0n);
    expect(totalRewards).toBe(10_000_001n);

    // Last entry gets the remainder
    expect(rewards[rewards.length - 1]).toBe(3_333_335n);
  });

  it('enforces minimum pool threshold', () => {
    const service = new ScoreRewardsService(db);
    const addr = '0x1111111111111111111111111111111111111111';
    linkWallet(db, 'alice', addr);
    importScore(db, addr, 100, '2026-01');

    // Default threshold is $1 (1_000_000 micro)
    const result = service.distributeRewards('2026-01', 500_000n);

    expect(result.success).toBe(false);
    expect(result.error).toBe('BELOW_THRESHOLD');
  });

  it('rejects duplicate distribution for same period', () => {
    const service = new ScoreRewardsService(db);
    const addr = '0x1111111111111111111111111111111111111111';
    linkWallet(db, 'alice', addr);
    importScore(db, addr, 100, '2026-01');

    const first = service.distributeRewards('2026-01', 5_000_000n, { minThresholdMicro: 0n });
    expect(first.success).toBe(true);

    const second = service.distributeRewards('2026-01', 5_000_000n, { minThresholdMicro: 0n });
    expect(second.success).toBe(false);
    expect(second.error).toBe('ALREADY_DISTRIBUTED');
  });

  it('returns NO_PARTICIPANTS when no linked scores', () => {
    const service = new ScoreRewardsService(db);
    // No wallets linked, no scores imported

    const result = service.distributeRewards('2026-01', 5_000_000n, { minThresholdMicro: 0n });

    expect(result.success).toBe(false);
    expect(result.error).toBe('NO_PARTICIPANTS');
  });

  it('excludes unlinked wallets from distribution', () => {
    const service = new ScoreRewardsService(db);
    const addr1 = '0x1111111111111111111111111111111111111111';
    const addr2 = '0x2222222222222222222222222222222222222222';

    linkWallet(db, 'alice', addr1);
    linkWallet(db, 'bob', addr2);
    importScore(db, addr1, 500, '2026-01');
    importScore(db, addr2, 500, '2026-01');

    // Unlink bob's wallet
    db.prepare(`
      UPDATE wallet_links SET unlinked_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE account_id = 'bob'
    `).run();

    const result = service.distributeRewards('2026-01', 10_000_000n, { minThresholdMicro: 0n });

    expect(result.success).toBe(true);
    expect(result.participantCount).toBe(1);
    expect(result.entries[0].accountId).toBe('alice');
    expect(result.entries[0].rewardMicro).toBe(10_000_000n);
  });

  it('aggregates multiple wallets per account', () => {
    const service = new ScoreRewardsService(db);
    const addr1 = '0x1111111111111111111111111111111111111111';
    const addr2 = '0x2222222222222222222222222222222222222222';
    const addr3 = '0x3333333333333333333333333333333333333333';

    // alice has two wallets, bob has one
    linkWallet(db, 'alice', addr1);
    linkWallet(db, 'alice', addr2);
    linkWallet(db, 'bob', addr3);

    importScore(db, addr1, 200, '2026-01');
    importScore(db, addr2, 300, '2026-01');  // alice total = 500
    importScore(db, addr3, 500, '2026-01');  // bob total = 500

    const result = service.distributeRewards('2026-01', 10_000_000n, { minThresholdMicro: 0n });

    expect(result.success).toBe(true);
    expect(result.participantCount).toBe(2);

    const aliceEntry = result.entries.find(e => e.accountId === 'alice')!;
    const bobEntry = result.entries.find(e => e.accountId === 'bob')!;
    expect(aliceEntry.score).toBe(500);
    expect(bobEntry.score).toBe(500);
    // Equal scores -> 5M each, total = 10M
    expect(aliceEntry.rewardMicro + bobEntry.rewardMicro).toBe(10_000_000n);
  });
});

// =============================================================================
// Task 12.2: Campaign Integration
// =============================================================================

describe('Task 12.2: Campaign integration', () => {
  it('produces correct grant entries for CampaignAdapter', () => {
    const service = new ScoreRewardsService(db);
    const addr1 = '0x1111111111111111111111111111111111111111';
    const addr2 = '0x2222222222222222222222222222222222222222';

    linkWallet(db, 'alice', addr1);
    linkWallet(db, 'bob', addr2);
    importScore(db, addr1, 400, '2026-01');
    importScore(db, addr2, 600, '2026-01');

    const result = service.distributeRewards('2026-01', 10_000_000n, { minThresholdMicro: 0n });
    expect(result.success).toBe(true);

    // Verify entries can be mapped to GrantInput format
    const grantInputs = result.entries.map(e => ({
      accountId: e.accountId,
      amountMicro: e.rewardMicro,
    }));

    expect(grantInputs).toHaveLength(2);
    expect(grantInputs.every(g => g.amountMicro > 0n)).toBe(true);

    // Total grants must equal pool size
    const totalGrants = grantInputs.reduce((sum, g) => sum + g.amountMicro, 0n);
    expect(totalGrants).toBe(10_000_000n);
  });

  it('score:rewards pool is non-withdrawable by convention', () => {
    // Verify the pool constant is defined for non-withdrawable grants
    expect(SCORE_REWARDS_POOL).toBe('score:rewards');
  });

  it('records distribution in score_distributions table', () => {
    const service = new ScoreRewardsService(db);
    const addr = '0x1111111111111111111111111111111111111111';
    linkWallet(db, 'alice', addr);
    importScore(db, addr, 100, '2026-01');

    const result = service.distributeRewards('2026-01', 5_000_000n, { minThresholdMicro: 0n });
    expect(result.success).toBe(true);

    const dist = db.prepare(
      `SELECT * FROM score_distributions WHERE period = '2026-01'`
    ).get() as { id: string; period: string; pool_size_micro: number; participant_count: number; total_score: number };

    expect(dist).toBeTruthy();
    expect(dist.period).toBe('2026-01');
    expect(dist.pool_size_micro).toBe(5_000_000);
    expect(dist.participant_count).toBe(1);
    expect(dist.total_score).toBe(100);
  });
});

// =============================================================================
// Task 12.3: Score Distribution Cron
// =============================================================================

describe('Task 12.3: Score distribution cron', () => {
  it('runs distribution for specified period', () => {
    const addr = '0x1111111111111111111111111111111111111111';
    linkWallet(db, 'alice', addr);
    importScore(db, addr, 100, '2026-01');

    const cron = createScoreDistribution({
      db,
      poolSizeMicro: 5_000_000n,
      minThresholdMicro: 0n,
    });

    const result = cron.runOnce('2026-01');

    expect(result.distributed).toBe(true);
    expect(result.period).toBe('2026-01');
    expect(result.participantCount).toBe(1);
  });

  it('skips if already distributed', () => {
    const addr = '0x1111111111111111111111111111111111111111';
    linkWallet(db, 'alice', addr);
    importScore(db, addr, 100, '2026-01');

    const cron = createScoreDistribution({
      db,
      poolSizeMicro: 5_000_000n,
      minThresholdMicro: 0n,
    });

    const first = cron.runOnce('2026-01');
    expect(first.distributed).toBe(true);

    const second = cron.runOnce('2026-01');
    expect(second.distributed).toBe(false);
    expect(second.error).toBe('ALREADY_DISTRIBUTED');
  });

  it('uses default pool size when not configured', () => {
    const addr = '0x1111111111111111111111111111111111111111';
    linkWallet(db, 'alice', addr);
    importScore(db, addr, 100, '2026-01');

    const cron = createScoreDistribution({ db, minThresholdMicro: 0n });
    const result = cron.runOnce('2026-01');

    expect(result.distributed).toBe(true);

    // Verify default pool size ($50,000 = 50_000_000_000 micro)
    const dist = db.prepare(
      `SELECT pool_size_micro FROM score_distributions WHERE period = '2026-01'`
    ).get() as { pool_size_micro: number };
    expect(dist.pool_size_micro).toBe(50_000_000_000);
  });
});

// =============================================================================
// Task 12.4: Rewards History API
// =============================================================================

describe('Task 12.4: Score rewards history', () => {
  it('returns reward history for account', () => {
    const service = new ScoreRewardsService(db);
    const addr1 = '0x1111111111111111111111111111111111111111';
    const addr2 = '0x2222222222222222222222222222222222222222';

    linkWallet(db, 'alice', addr1);
    linkWallet(db, 'bob', addr2);
    importScore(db, addr1, 600, '2026-01');
    importScore(db, addr2, 400, '2026-01');

    service.distributeRewards('2026-01', 10_000_000n, { minThresholdMicro: 0n });

    const history = service.getRewardsHistory('alice');
    expect(history).toHaveLength(1);
    expect(history[0].period).toBe('2026-01');
    expect(history[0].rewardMicro).toBe(6_000_000); // 600/1000 * 10M
    expect(history[0].poolSizeMicro).toBe(10_000_000);
    expect(history[0].participantCount).toBe(2);
  });

  it('returns empty array for no rewards', () => {
    const service = new ScoreRewardsService(db);
    const history = service.getRewardsHistory('alice');
    expect(history).toHaveLength(0);
  });

  it('returns multiple periods ordered by period DESC', () => {
    const service = new ScoreRewardsService(db);
    const addr = '0x1111111111111111111111111111111111111111';
    linkWallet(db, 'alice', addr);

    // Two periods
    importScore(db, addr, 100, '2026-01');
    importScore(db, addr, 200, '2026-02');

    service.distributeRewards('2026-01', 5_000_000n, { minThresholdMicro: 0n });
    service.distributeRewards('2026-02', 8_000_000n, { minThresholdMicro: 0n });

    const history = service.getRewardsHistory('alice');
    expect(history).toHaveLength(2);
    expect(history[0].period).toBe('2026-02'); // Most recent first
    expect(history[1].period).toBe('2026-01');
    expect(history[0].rewardMicro).toBe(8_000_000);
    expect(history[1].rewardMicro).toBe(5_000_000);
  });
});

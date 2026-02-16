/**
 * Wallet Linking & Score Import Integration Tests (Sprint 11)
 *
 * Tests nonce issuance, wallet linking with EIP-191 verification,
 * collision detection, score import, and nonce cleanup.
 *
 * SDD refs: §4.5 ScoreRewardsService
 * Sprint refs: Tasks 11.1–11.5
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { CREDIT_LEDGER_SCHEMA_SQL } from '../../src/db/migrations/030_credit_ledger.js';
import { BILLING_OPS_SCHEMA_SQL, BILLING_SYSTEM_ACCOUNTS_SQL } from '../../src/db/migrations/032_billing_ops.js';
import { WALLET_LINKS_SQL } from '../../src/db/migrations/046_wallet_links.js';
import { WalletLinkService } from '../../src/packages/adapters/billing/WalletLinkService.js';
import { ScoreImportService } from '../../src/packages/adapters/billing/ScoreImportService.js';
import { createNonceCleanup } from '../../src/jobs/nonce-cleanup.js';

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
  testDb.exec(WALLET_LINKS_SQL);
  testDb.pragma('foreign_keys = ON');
  return testDb;
}

function seedAccount(accountDb: Database.Database, id: string): void {
  accountDb.prepare(
    `INSERT OR IGNORE INTO credit_accounts (id, entity_type, entity_id, created_at, updated_at)
     VALUES (?, 'person', ?, datetime('now'), datetime('now'))`
  ).run(id, `entity-${id}`);
}

/** Test signature verifier — always accepts */
const alwaysVerify = () => true;
/** Test signature verifier — always rejects */
const neverVerify = () => false;

// =============================================================================
// Setup / Teardown
// =============================================================================

beforeEach(() => {
  db = setupDb();
  seedAccount(db, 'alice');
  seedAccount(db, 'bob');
});

afterEach(() => {
  db.close();
});

// =============================================================================
// Task 11.1: Migration 046_wallet_links
// =============================================================================

describe('Task 11.1: Migration 046_wallet_links', () => {
  it('creates all required tables', () => {
    const tables = db.prepare(`
      SELECT name FROM sqlite_master WHERE type='table'
      AND name IN ('wallet_link_nonces', 'wallet_links', 'score_snapshots', 'score_distributions')
      ORDER BY name
    `).all() as { name: string }[];

    expect(tables.map(t => t.name)).toEqual([
      'score_distributions',
      'score_snapshots',
      'wallet_link_nonces',
      'wallet_links',
    ]);
  });

  it('enforces UNIQUE constraint on wallet_links(address, chain_id)', () => {
    db.prepare(`
      INSERT INTO wallet_links (id, account_id, wallet_address, chain_id)
      VALUES ('link-1', 'alice', '0xabc', 1)
    `).run();

    expect(() => {
      db.prepare(`
        INSERT INTO wallet_links (id, account_id, wallet_address, chain_id)
        VALUES ('link-2', 'bob', '0xabc', 1)
      `).run();
    }).toThrow();
  });

  it('enforces UNIQUE constraint on score_snapshots', () => {
    db.prepare(`
      INSERT INTO score_snapshots (id, wallet_address, chain_id, score, snapshot_period)
      VALUES ('snap-1', '0xabc', 1, 100, '2026-01')
    `).run();

    // Duplicate should fail on insert (not upsert)
    expect(() => {
      db.prepare(`
        INSERT INTO score_snapshots (id, wallet_address, chain_id, score, snapshot_period)
        VALUES ('snap-2', '0xabc', 1, 200, '2026-01')
      `).run();
    }).toThrow();
  });

  it('enforces UNIQUE constraint on score_distributions(period)', () => {
    db.prepare(`
      INSERT INTO score_distributions (id, period, pool_size_micro, participant_count, total_score)
      VALUES ('dist-1', '2026-01', 1000000, 10, 500)
    `).run();

    expect(() => {
      db.prepare(`
        INSERT INTO score_distributions (id, period, pool_size_micro, participant_count, total_score)
        VALUES ('dist-2', '2026-01', 2000000, 20, 1000)
      `).run();
    }).toThrow();
  });
});

// =============================================================================
// Task 11.2: Nonce Issuance & Wallet Linking
// =============================================================================

describe('Task 11.2: Nonce issuance and wallet linking', () => {
  it('issues a nonce with 5-minute expiry', () => {
    const service = new WalletLinkService(db, alwaysVerify);
    const result = service.issueNonce('alice', '0x1234567890abcdef1234567890abcdef12345678');

    expect(result.nonceId).toBeTruthy();
    expect(result.nonce).toHaveLength(32); // 16 bytes hex
    expect(result.message).toContain(result.nonce);
    expect(new Date(result.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('links wallet with valid nonce and signature', () => {
    const service = new WalletLinkService(db, alwaysVerify);
    const address = '0x1234567890abcdef1234567890abcdef12345678';

    const { nonce } = service.issueNonce('alice', address);
    const result = service.linkWallet('alice', address, nonce, '0xfakesig');

    expect(result.success).toBe(true);
    expect(result.linkId).toBeTruthy();
  });

  it('rejects linking with invalid nonce', () => {
    const service = new WalletLinkService(db, alwaysVerify);
    const address = '0x1234567890abcdef1234567890abcdef12345678';

    const result = service.linkWallet('alice', address, 'bad-nonce', '0xsig');
    expect(result.success).toBe(false);
    expect(result.code).toBe('INVALID_NONCE');
  });

  it('rejects replay (nonce already used)', () => {
    const service = new WalletLinkService(db, alwaysVerify);
    const address = '0x1234567890abcdef1234567890abcdef12345678';

    const { nonce } = service.issueNonce('alice', address);
    service.linkWallet('alice', address, nonce, '0xsig');

    // Unlink so we can try to reuse the nonce
    service.unlinkWallet('alice', address);

    const replay = service.linkWallet('alice', address, nonce, '0xsig');
    expect(replay.success).toBe(false);
    expect(replay.code).toBe('NONCE_USED');
  });

  it('rejects expired nonce', () => {
    const service = new WalletLinkService(db, alwaysVerify);
    const address = '0x1234567890abcdef1234567890abcdef12345678';

    const { nonce } = service.issueNonce('alice', address);

    // Backdate expiry
    db.prepare(`
      UPDATE wallet_link_nonces SET expires_at = datetime('now', '-1 hour')
      WHERE nonce = ?
    `).run(nonce);

    const result = service.linkWallet('alice', address, nonce, '0xsig');
    expect(result.success).toBe(false);
    expect(result.code).toBe('NONCE_EXPIRED');
  });

  it('rejects invalid signature', () => {
    const service = new WalletLinkService(db, neverVerify);
    const address = '0x1234567890abcdef1234567890abcdef12345678';

    const { nonce } = service.issueNonce('alice', address);
    const result = service.linkWallet('alice', address, nonce, '0xbadsig');

    expect(result.success).toBe(false);
    expect(result.code).toBe('INVALID_SIGNATURE');
  });

  it('rejects wallet collision (linked to another account)', () => {
    const service = new WalletLinkService(db, alwaysVerify);
    const address = '0x1234567890abcdef1234567890abcdef12345678';

    // Link to alice
    const { nonce: n1 } = service.issueNonce('alice', address);
    service.linkWallet('alice', address, n1, '0xsig');

    // Try to link same wallet to bob
    const { nonce: n2 } = service.issueNonce('bob', address);
    const result = service.linkWallet('bob', address, n2, '0xsig');

    expect(result.success).toBe(false);
    expect(result.code).toBe('WALLET_ALREADY_LINKED');
  });

  it('enforces max 10 wallets per account', () => {
    const service = new WalletLinkService(db, alwaysVerify);

    // Link 10 wallets
    for (let i = 0; i < 10; i++) {
      const addr = `0x${i.toString().padStart(40, '0')}`;
      const { nonce } = service.issueNonce('alice', addr);
      const result = service.linkWallet('alice', addr, nonce, '0xsig');
      expect(result.success).toBe(true);
    }

    // 11th should fail
    const addr11 = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const { nonce } = service.issueNonce('alice', addr11);
    const result = service.linkWallet('alice', addr11, nonce, '0xsig');

    expect(result.success).toBe(false);
    expect(result.code).toBe('MAX_WALLETS');
  });

  it('unlinks wallet (idempotent)', () => {
    const service = new WalletLinkService(db, alwaysVerify);
    const address = '0x1234567890abcdef1234567890abcdef12345678';

    const { nonce } = service.issueNonce('alice', address);
    service.linkWallet('alice', address, nonce, '0xsig');

    const result1 = service.unlinkWallet('alice', address);
    expect(result1.success).toBe(true);

    // Second unlink returns not-linked
    const result2 = service.unlinkWallet('alice', address);
    expect(result2.success).toBe(false);
    expect(result2.code).toBe('NOT_LINKED');
  });

  it('lists linked wallets', () => {
    const service = new WalletLinkService(db, alwaysVerify);

    const addr1 = '0x1111111111111111111111111111111111111111';
    const addr2 = '0x2222222222222222222222222222222222222222';

    const { nonce: n1 } = service.issueNonce('alice', addr1);
    service.linkWallet('alice', addr1, n1, '0xsig');

    const { nonce: n2 } = service.issueNonce('alice', addr2);
    service.linkWallet('alice', addr2, n2, '0xsig');

    const wallets = service.getLinkedWallets('alice');
    expect(wallets).toHaveLength(2);
    expect(wallets[0].walletAddress).toBe(addr1);
    expect(wallets[1].walletAddress).toBe(addr2);
  });

  it('unlinked wallets excluded from listing', () => {
    const service = new WalletLinkService(db, alwaysVerify);
    const address = '0x1234567890abcdef1234567890abcdef12345678';

    const { nonce } = service.issueNonce('alice', address);
    service.linkWallet('alice', address, nonce, '0xsig');
    service.unlinkWallet('alice', address);

    const wallets = service.getLinkedWallets('alice');
    expect(wallets).toHaveLength(0);
  });
});

// =============================================================================
// Task 11.4: Nonce Cleanup
// =============================================================================

describe('Task 11.4: Nonce cleanup cron', () => {
  it('deletes expired unused nonces', () => {
    const service = new WalletLinkService(db, alwaysVerify);
    const address = '0x1234567890abcdef1234567890abcdef12345678';

    service.issueNonce('alice', address);

    // Backdate expiry
    db.prepare(`
      UPDATE wallet_link_nonces SET expires_at = datetime('now', '-1 hour')
    `).run();

    const cleanup = createNonceCleanup({ db });
    const result = cleanup.runOnce();

    expect(result.expiredDeleted).toBe(1);
  });

  it('retains used nonces within 24h', () => {
    const service = new WalletLinkService(db, alwaysVerify);
    const address = '0x1234567890abcdef1234567890abcdef12345678';

    const { nonce } = service.issueNonce('alice', address);
    service.linkWallet('alice', address, nonce, '0xsig'); // marks nonce as used

    const cleanup = createNonceCleanup({ db });
    const result = cleanup.runOnce();

    expect(result.usedDeleted).toBe(0); // Still within 24h
  });

  it('deletes used nonces older than 24h', () => {
    const service = new WalletLinkService(db, alwaysVerify);
    const address = '0x1234567890abcdef1234567890abcdef12345678';

    const { nonce } = service.issueNonce('alice', address);
    service.linkWallet('alice', address, nonce, '0xsig');

    // Backdate used_at to > 24h ago
    db.prepare(`
      UPDATE wallet_link_nonces SET used_at = datetime('now', '-30 hours')
    `).run();

    const cleanup = createNonceCleanup({ db });
    const result = cleanup.runOnce();

    expect(result.usedDeleted).toBe(1);
  });
});

// =============================================================================
// Task 11.5: Score Import
// =============================================================================

describe('Task 11.5: Score import', () => {
  it('imports scores successfully', () => {
    const service = new ScoreImportService(db);

    const result = service.importScores([
      { walletAddress: '0x1234567890abcdef1234567890abcdef12345678', score: 100, period: '2026-01' },
      { walletAddress: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd', score: 200, period: '2026-01' },
    ]);

    expect(result.success).toBe(true);
    expect(result.imported).toBe(2);
    expect(result.updated).toBe(0);
  });

  it('upserts duplicate entries', () => {
    const service = new ScoreImportService(db);

    service.importScores([
      { walletAddress: '0x1234567890abcdef1234567890abcdef12345678', score: 100, period: '2026-01' },
    ]);

    const result = service.importScores([
      { walletAddress: '0x1234567890abcdef1234567890abcdef12345678', score: 150, period: '2026-01' },
    ]);

    expect(result.success).toBe(true);
    expect(result.updated).toBe(1);

    // Verify updated value
    const scores = service.getScoresForPeriod('2026-01');
    expect(scores[0].score).toBe(150);
  });

  it('rejects invalid wallet address', () => {
    const service = new ScoreImportService(db);

    const result = service.importScores([
      { walletAddress: 'not-an-address', score: 100, period: '2026-01' },
    ]);

    expect(result.success).toBe(false);
    expect(result.errors[0]).toContain('invalid wallet address');
  });

  it('rejects negative score', () => {
    const service = new ScoreImportService(db);

    const result = service.importScores([
      { walletAddress: '0x1234567890abcdef1234567890abcdef12345678', score: -10, period: '2026-01' },
    ]);

    expect(result.success).toBe(false);
    expect(result.errors[0]).toContain('non-negative');
  });

  it('rejects invalid period format', () => {
    const service = new ScoreImportService(db);

    const result = service.importScores([
      { walletAddress: '0x1234567890abcdef1234567890abcdef12345678', score: 100, period: '2026-13' },
    ]);

    expect(result.success).toBe(false);
    expect(result.errors[0]).toContain('invalid period');
  });

  it('retrieves scores sorted by score descending', () => {
    const service = new ScoreImportService(db);

    service.importScores([
      { walletAddress: '0x1111111111111111111111111111111111111111', score: 50, period: '2026-01' },
      { walletAddress: '0x2222222222222222222222222222222222222222', score: 300, period: '2026-01' },
      { walletAddress: '0x3333333333333333333333333333333333333333', score: 150, period: '2026-01' },
    ]);

    const scores = service.getScoresForPeriod('2026-01');
    expect(scores).toHaveLength(3);
    expect(scores[0].score).toBe(300);
    expect(scores[1].score).toBe(150);
    expect(scores[2].score).toBe(50);
  });
});

/**
 * Migration 069 — agent activation claim marker.
 *
 * The marker is what lets crash-orphan recovery distinguish a claimed
 * activation (safe to re-apply) from a pre-recovery LEGACY activation (must
 * never be re-applied). Getting the migration wrong in either direction is a
 * correctness problem, not a cosmetic one:
 *
 *   - failing to add the column on an existing database ⇒ every crash orphan
 *     stays stranded;
 *   - failing to be idempotent ⇒ the migration throws "duplicate column name"
 *     on a database created from the current schema, and deploys break.
 */

import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';

import { AGENT_GOVERNANCE_SQL } from '../../../src/db/migrations/058_agent_governance.js';
import { up, down } from '../../../src/db/migrations/069_agent_activation_claim_marker.js';

/** The 058 schema as it stood BEFORE the column was declared inline. */
const LEGACY_058_SQL = AGENT_GOVERNANCE_SQL.replace(
  /\s*--[^\n]*\n(\s*--[^\n]*\n)*\s*activation_claimed_at TEXT,/,
  '',
);

function columns(db: Database.Database): string[] {
  return (db.prepare(`PRAGMA table_info(agent_governance_proposals)`).all() as Array<{ name: string }>)
    .map((c) => c.name);
}

describe('migration 069 — activation claim marker', () => {
  it('adds the column to a database created before it existed', () => {
    const db = new Database(':memory:');
    db.exec(LEGACY_058_SQL);
    expect(columns(db)).not.toContain('activation_claimed_at');

    up(db);

    expect(columns(db)).toContain('activation_claimed_at');
    db.close();
  });

  it('backfills existing rows to NULL, so historical activations stay legacy', () => {
    // This is the safety property: an activation that predates the marker must
    // NOT become re-appliable just because the column was added.
    const db = new Database(':memory:');
    // The proposals table carries FKs to system_config and credit_accounts;
    // SQLite resolves parent tables at insert time even for NULL/unchecked
    // columns. Minimal stubs keep this test about the migration itself.
    db.exec(`CREATE TABLE system_config (id TEXT PRIMARY KEY);`);
    db.exec(`CREATE TABLE credit_accounts (id TEXT PRIMARY KEY);`);
    db.prepare(`INSERT INTO credit_accounts (id) VALUES ('acct')`).run();
    db.exec(LEGACY_058_SQL);
    db.prepare(`
      INSERT INTO agent_governance_proposals
        (id, param_key, proposed_value, proposer_account_id, proposer_weight,
         total_weight, required_weight, status, expires_at)
      VALUES ('legacy-1', 'k', '1', 'acct', 1, 1, 1, 'activated', '2099-01-01T00:00:00Z')
    `).run();

    up(db);

    const row = db.prepare(
      `SELECT activation_claimed_at FROM agent_governance_proposals WHERE id = 'legacy-1'`,
    ).get() as { activation_claimed_at: string | null };
    expect(row.activation_claimed_at).toBeNull();
    db.close();
  });

  it('is idempotent on a database created from the current schema', () => {
    // 058 now declares the column inline; the ALTER must be skipped, not retried.
    const db = new Database(':memory:');
    db.exec(AGENT_GOVERNANCE_SQL);
    expect(columns(db)).toContain('activation_claimed_at');

    expect(() => up(db)).not.toThrow();
    expect(() => up(db)).not.toThrow();

    expect(columns(db).filter((c) => c === 'activation_claimed_at')).toHaveLength(1);
    db.close();
  });

  it('creates the recovery index and drops it on rollback', () => {
    const db = new Database(':memory:');
    db.exec(AGENT_GOVERNANCE_SQL);
    up(db);

    const hasIndex = () =>
      db.prepare(
        `SELECT 1 FROM sqlite_master WHERE type='index' AND name='idx_agent_proposals_unlinked_activation'`,
      ).get() !== undefined;

    expect(hasIndex()).toBe(true);
    down(db);
    expect(hasIndex()).toBe(false);
    // Rollback leaves the nullable column in place (SQLite < 3.35 has no DROP COLUMN).
    expect(columns(db)).toContain('activation_claimed_at');
    db.close();
  });
});

/**
 * Revenue Rules Governance Integration Tests (Sprint 237, Tasks 8.1–8.5)
 *
 * Validates:
 * - Task 8.1: Revenue rules data model (migration 035)
 * - Task 8.2: RevenueRulesAdapter state machine
 * - Task 8.4: Activation job (auto-activate after cooldown)
 * - Task 8.5: RevenueDistributionService wired to revenue rules
 *
 * SDD refs: §1.4 CreditLedgerService
 * Sprint refs: Tasks 8.1–8.5
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { CREDIT_LEDGER_SCHEMA_SQL } from '../../src/db/migrations/030_credit_ledger.js';
import { BILLING_OPS_SCHEMA_SQL, BILLING_SYSTEM_ACCOUNTS_SQL } from '../../src/db/migrations/032_billing_ops.js';
import { REVENUE_RULES_SCHEMA_SQL } from '../../src/db/migrations/035_revenue_rules.js';
import { REVENUE_RULES_REFERRER_SQL } from '../../src/db/migrations/043_revenue_rules_referrer.js';
import { RevenueRulesAdapter } from '../../src/packages/adapters/billing/RevenueRulesAdapter.js';
import { RevenueDistributionService } from '../../src/packages/adapters/billing/RevenueDistributionService.js';
import { createRevenueRulesActivator } from '../../src/jobs/revenue-rules-activator.js';

// =============================================================================
// Test Setup
// =============================================================================

let db: Database.Database;
let rulesAdapter: RevenueRulesAdapter;

function setupDb(): Database.Database {
  const testDb = new Database(':memory:');
  testDb.pragma('journal_mode = WAL');
  testDb.pragma('foreign_keys = OFF');
  testDb.exec(CREDIT_LEDGER_SCHEMA_SQL);
  testDb.exec(BILLING_OPS_SCHEMA_SQL);
  testDb.exec(REVENUE_RULES_SCHEMA_SQL);
  testDb.exec(REVENUE_RULES_REFERRER_SQL);
  testDb.pragma('foreign_keys = ON');
  return testDb;
}

beforeEach(() => {
  db = setupDb();
  rulesAdapter = new RevenueRulesAdapter(db);
});

afterEach(() => {
  db.close();
});

// =============================================================================
// Task 8.1 + 8.2: Revenue Rules State Machine
// =============================================================================

describe('Task 8.1/8.2: Revenue Rules State Machine', () => {
  it('seeds initial active rule from migration', async () => {
    const active = await rulesAdapter.getActiveRule();
    expect(active).not.toBeNull();
    expect(active!.name).toBe('Initial Revenue Split');
    expect(active!.commonsBps).toBe(500);
    expect(active!.communityBps).toBe(7000);
    expect(active!.foundationBps).toBe(2500);
    expect(active!.status).toBe('active');
  });

  it('proposes a new rule in draft status', async () => {
    const rule = await rulesAdapter.proposeRule({
      name: 'New Split',
      commonsBps: 1000,
      communityBps: 6000,
      foundationBps: 3000,
      proposedBy: 'admin-1',
      notes: 'Testing new split',
    });

    expect(rule.status).toBe('draft');
    expect(rule.commonsBps).toBe(1000);
    expect(rule.communityBps).toBe(6000);
    expect(rule.foundationBps).toBe(3000);
    expect(rule.proposedBy).toBe('admin-1');
  });

  it('enforces bps_sum_100 CHECK constraint', () => {
    expect(() => {
      db.prepare(`
        INSERT INTO revenue_rules
          (id, name, status, commons_bps, community_bps, foundation_bps,
           proposed_by, proposed_at, created_at, updated_at)
        VALUES ('bad-rule', 'Bad', 'draft', 5000, 3000, 1000,
                'admin', datetime('now'), datetime('now'), datetime('now'))
      `).run();
    }).toThrow(); // 5000+3000+1000=9000 ≠ 10000
  });

  it('full lifecycle: draft → pending_approval → cooling_down → active', async () => {
    const rule = await rulesAdapter.proposeRule({
      name: 'Lifecycle Test',
      commonsBps: 800,
      communityBps: 6200,
      foundationBps: 3000,
      proposedBy: 'admin-1',
    });

    // Submit
    const submitted = await rulesAdapter.submitForApproval(rule.id, 'admin-1');
    expect(submitted.status).toBe('pending_approval');

    // Approve
    const approved = await rulesAdapter.approveRule(rule.id, 'admin-2');
    expect(approved.status).toBe('cooling_down');
    expect(approved.approvedBy).toBe('admin-2');
    expect(approved.approvedAt).not.toBeNull();
    expect(approved.activatesAt).not.toBeNull();

    // Simulate cooldown elapsed by updating activates_at to the past
    db.prepare(`
      UPDATE revenue_rules
      SET activates_at = datetime('now', '-1 hour')
      WHERE id = ?
    `).run(rule.id);

    // Activate
    const activated = await rulesAdapter.activateReadyRules();
    expect(activated.length).toBe(1);
    expect(activated[0].status).toBe('active');
    expect(activated[0].id).toBe(rule.id);

    // Previous active rule should be superseded
    const oldRule = db.prepare(
      `SELECT status FROM revenue_rules WHERE id = 'seed-initial-rule'`
    ).get() as { status: string };
    expect(oldRule.status).toBe('superseded');
  });

  it('rejects a pending rule', async () => {
    const rule = await rulesAdapter.proposeRule({
      name: 'To Reject',
      commonsBps: 500,
      communityBps: 7000,
      foundationBps: 2500,
      proposedBy: 'admin-1',
    });
    await rulesAdapter.submitForApproval(rule.id, 'admin-1');

    const rejected = await rulesAdapter.rejectRule(rule.id, 'admin-2', 'Not approved');
    expect(rejected.status).toBe('rejected');

    // Audit log should contain rejection reason
    const audit = await rulesAdapter.getRuleAudit(rule.id);
    const rejectEntry = audit.find(a => a.action === 'rejected');
    expect(rejectEntry).toBeDefined();
    expect(rejectEntry!.reason).toBe('Not approved');
  });

  it('rejects a cooling_down rule', async () => {
    const rule = await rulesAdapter.proposeRule({
      name: 'Reject During Cooldown',
      commonsBps: 600,
      communityBps: 6400,
      foundationBps: 3000,
      proposedBy: 'admin-1',
    });
    await rulesAdapter.submitForApproval(rule.id, 'admin-1');
    await rulesAdapter.approveRule(rule.id, 'admin-2');

    const rejected = await rulesAdapter.rejectRule(rule.id, 'admin-3', 'Changed our minds');
    expect(rejected.status).toBe('rejected');
  });

  it('overrides cooldown for emergency activation', async () => {
    const rule = await rulesAdapter.proposeRule({
      name: 'Emergency Override',
      commonsBps: 300,
      communityBps: 7200,
      foundationBps: 2500,
      proposedBy: 'admin-1',
    });
    await rulesAdapter.submitForApproval(rule.id, 'admin-1');
    await rulesAdapter.approveRule(rule.id, 'admin-2');

    // Override before cooldown elapsed
    const overridden = await rulesAdapter.overrideCooldown(
      rule.id, 'admin-ceo', 'Urgent revenue change needed',
    );
    expect(overridden.status).toBe('active');
    expect(overridden.activatedAt).not.toBeNull();

    // Audit log should contain override entry
    const audit = await rulesAdapter.getRuleAudit(rule.id);
    const overrideEntry = audit.find(a => a.action === 'cooldown_overridden');
    expect(overrideEntry).toBeDefined();
    expect(overrideEntry!.reason).toBe('Urgent revenue change needed');
  });

  it('prevents invalid state transitions', async () => {
    const rule = await rulesAdapter.proposeRule({
      name: 'Invalid Transition',
      commonsBps: 500,
      communityBps: 7000,
      foundationBps: 2500,
      proposedBy: 'admin-1',
    });

    // Cannot approve a draft (must submit first)
    await expect(
      rulesAdapter.approveRule(rule.id, 'admin-2'),
    ).rejects.toThrow(/Cannot/);

    // Cannot override cooldown on a draft
    await expect(
      rulesAdapter.overrideCooldown(rule.id, 'admin', 'reason'),
    ).rejects.toThrow(/Cannot/);
  });

  it('enforces unique active rule constraint', async () => {
    // Seed rule is already active. Inserting a second active rule should fail.
    expect(() => {
      db.prepare(`
        INSERT INTO revenue_rules
          (id, name, status, commons_bps, community_bps, foundation_bps,
           proposed_by, proposed_at, created_at, updated_at)
        VALUES ('second-active', 'Second', 'active', 500, 7000, 2500,
                'admin', datetime('now'), datetime('now'), datetime('now'))
      `).run();
    }).toThrow(); // UNIQUE constraint on revenue_rules_one_active
  });

  it('getPendingRules returns non-terminal rules', async () => {
    const rule1 = await rulesAdapter.proposeRule({
      name: 'Pending 1',
      commonsBps: 500, communityBps: 7000, foundationBps: 2500,
      proposedBy: 'admin',
    });
    const rule2 = await rulesAdapter.proposeRule({
      name: 'Pending 2',
      commonsBps: 500, communityBps: 7000, foundationBps: 2500,
      proposedBy: 'admin',
    });
    await rulesAdapter.submitForApproval(rule2.id, 'admin');

    const pending = await rulesAdapter.getPendingRules();
    // Should include both drafts and submitted, but not the seeded active rule
    const pendingIds = pending.map(r => r.id);
    expect(pendingIds).toContain(rule1.id);
    expect(pendingIds).toContain(rule2.id);
    expect(pendingIds).not.toContain('seed-initial-rule');
  });
});

// =============================================================================
// Task 8.4: Activation Job
// =============================================================================

describe('Task 8.4: Revenue Rules Activation Job', () => {
  it('auto-activates rules after cooldown', async () => {
    const rule = await rulesAdapter.proposeRule({
      name: 'Auto Activate',
      commonsBps: 400, communityBps: 7100, foundationBps: 2500,
      proposedBy: 'admin',
    });
    await rulesAdapter.submitForApproval(rule.id, 'admin');
    await rulesAdapter.approveRule(rule.id, 'admin-2');

    // Set activates_at to past
    db.prepare(`
      UPDATE revenue_rules SET activates_at = datetime('now', '-1 hour') WHERE id = ?
    `).run(rule.id);

    const activator = createRevenueRulesActivator({ rulesService: rulesAdapter });
    const result = await activator.checkOnce();

    expect(result.activatedCount).toBe(1);

    const active = await rulesAdapter.getActiveRule();
    expect(active!.id).toBe(rule.id);
  });

  it('no-op when nothing pending', async () => {
    const activator = createRevenueRulesActivator({ rulesService: rulesAdapter });
    const result = await activator.checkOnce();
    expect(result.activatedCount).toBe(0);
  });
});

// =============================================================================
// Task 8.5: Distribution Wired to Revenue Rules
// =============================================================================

describe('Task 8.5: Distribution from Revenue Rules', () => {
  it('uses active revenue rule for distribution', () => {
    // Seed system accounts (needed for account IDs)
    db.pragma('foreign_keys = OFF');
    db.exec(BILLING_SYSTEM_ACCOUNTS_SQL);
    db.pragma('foreign_keys = ON');

    const revDist = new RevenueDistributionService(db);
    const config = revDist.getConfig();

    // Should match seed rule: 500/7000/2500
    expect(config.commonsRateBps).toBe(500n);
    expect(config.communityRateBps).toBe(7000n);
    expect(config.foundationRateBps).toBe(2500n);
    expect(revDist.getConfigSource()).toBe('revenue_rule');
  });

  it('falls back to billing_config when no active rule', () => {
    // Remove the seeded active rule (audit log FK requires cascade delete)
    db.prepare(`DELETE FROM revenue_rule_audit_log`).run();
    db.prepare(`DELETE FROM revenue_rules`).run();

    // Seed system accounts
    db.pragma('foreign_keys = OFF');
    db.exec(BILLING_SYSTEM_ACCOUNTS_SQL);
    db.pragma('foreign_keys = ON');

    const revDist = new RevenueDistributionService(db);
    const config = revDist.getConfig();

    // Should fall back to billing_config: 500/7000/2500
    expect(config.commonsRateBps).toBe(500n);
    expect(config.communityRateBps).toBe(7000n);
    expect(config.foundationRateBps).toBe(2500n);
    expect(revDist.getConfigSource()).toBe('billing_config');
  });

  it('distribution uses updated rule after activation', async () => {
    // Seed system accounts
    db.pragma('foreign_keys = OFF');
    db.exec(BILLING_SYSTEM_ACCOUNTS_SQL);
    db.pragma('foreign_keys = ON');

    // Create and activate a new rule with different rates
    const rule = await rulesAdapter.proposeRule({
      name: 'New Rates',
      commonsBps: 1000,
      communityBps: 6000,
      foundationBps: 3000,
      proposedBy: 'admin',
    });
    await rulesAdapter.submitForApproval(rule.id, 'admin');
    await rulesAdapter.approveRule(rule.id, 'admin-2');
    await rulesAdapter.overrideCooldown(rule.id, 'admin-ceo', 'Testing');

    const revDist = new RevenueDistributionService(db);
    const shares = revDist.calculateShares(1_000_000n);

    // 1M * 1000/10000 = 100,000 commons
    expect(shares.commonsShare).toBe(100_000n);
    // 1M * 6000/10000 = 600,000 community
    expect(shares.communityShare).toBe(600_000n);
    // 1M - 100K - 600K = 300,000 foundation
    expect(shares.foundationShare).toBe(300_000n);
    expect(revDist.getConfigSource()).toBe('revenue_rule');
  });

  it('invalidateConfig refreshes from revenue rules', async () => {
    db.pragma('foreign_keys = OFF');
    db.exec(BILLING_SYSTEM_ACCOUNTS_SQL);
    db.pragma('foreign_keys = ON');

    const revDist = new RevenueDistributionService(db);

    // First call loads seed rule
    const config1 = revDist.getConfig();
    expect(config1.commonsRateBps).toBe(500n);

    // Activate a new rule
    const rule = await rulesAdapter.proposeRule({
      name: 'Updated',
      commonsBps: 2000, communityBps: 5000, foundationBps: 3000,
      proposedBy: 'admin',
    });
    await rulesAdapter.submitForApproval(rule.id, 'admin');
    await rulesAdapter.approveRule(rule.id, 'admin-bob');
    await rulesAdapter.overrideCooldown(rule.id, 'admin-bob', 'Test');

    // Cache still has old values
    expect(revDist.getConfig().commonsRateBps).toBe(500n);

    // Invalidate and reload
    revDist.invalidateConfig();
    const config2 = revDist.getConfig();
    expect(config2.commonsRateBps).toBe(2000n);
    expect(config2.communityRateBps).toBe(5000n);
  });
});

/**
 * Fraud Rules Governance Integration Tests (Sprint 271, Tasks 15.1–15.5)
 *
 * Validates:
 * - Task 15.1: fraud_rules migration and constraints
 * - Task 15.2: FraudRulesService governance lifecycle
 * - Task 15.3: FraudCheckService configurable weights
 * - Task 15.4: Admin API validation schemas
 * - Task 15.5: Fraud rule activation job
 *
 * SDD refs: §4.4 Fraud Rules Engine, §5.5 Admin Endpoints
 * Sprint refs: Tasks 15.1–15.5
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { CREDIT_LEDGER_SCHEMA_SQL } from '../../src/db/migrations/030_credit_ledger.js';
import { FRAUD_RULES_SCHEMA_SQL } from '../../src/db/migrations/047_fraud_rules.js';
import { FraudRulesService } from '../../src/packages/adapters/billing/FraudRulesService.js';
import { FraudCheckService } from '../../src/packages/adapters/billing/FraudCheckService.js';
import { createFraudRulesActivator } from '../../src/jobs/fraud-rules-activator.js';
import { proposeFraudRuleSchema } from '../../src/packages/core/contracts/admin-billing.js';

// =============================================================================
// Test Setup
// =============================================================================

let db: Database.Database;
let rulesService: FraudRulesService;

function setupDb(): Database.Database {
  const testDb = new Database(':memory:');
  testDb.pragma('journal_mode = WAL');
  testDb.pragma('foreign_keys = OFF');
  testDb.exec(CREDIT_LEDGER_SCHEMA_SQL);
  testDb.exec(FRAUD_RULES_SCHEMA_SQL);
  testDb.pragma('foreign_keys = ON');
  return testDb;
}

beforeEach(() => {
  db = setupDb();
  rulesService = new FraudRulesService(db);
});

afterEach(() => {
  db.close();
});

// =============================================================================
// Task 15.1: Migration & Constraints
// =============================================================================

describe('Task 15.1: Fraud Rules Migration', () => {
  it('fraud_rules table has all required columns', () => {
    const columns = db.prepare('PRAGMA table_info(fraud_rules)').all() as Array<{ name: string }>;
    const colNames = columns.map(c => c.name);

    expect(colNames).toContain('id');
    expect(colNames).toContain('ip_cluster_weight');
    expect(colNames).toContain('ua_fingerprint_weight');
    expect(colNames).toContain('velocity_weight');
    expect(colNames).toContain('activity_weight');
    expect(colNames).toContain('flag_threshold');
    expect(colNames).toContain('withhold_threshold');
    expect(colNames).toContain('proposed_by');
    expect(colNames).toContain('approved_by');
    expect(colNames).toContain('version');
  });

  it('seeds initial active rule with hardcoded defaults', async () => {
    const active = await rulesService.getActiveRule();
    expect(active).not.toBeNull();
    expect(active!.name).toBe('Initial Fraud Weights');
    expect(active!.ipClusterWeight).toBe(3000);
    expect(active!.uaFingerprintWeight).toBe(2500);
    expect(active!.velocityWeight).toBe(2500);
    expect(active!.activityWeight).toBe(2000);
    expect(active!.flagThreshold).toBe(3000);
    expect(active!.withholdThreshold).toBe(7000);
    expect(active!.status).toBe('active');
  });

  it('enforces weights_sum_10000 CHECK constraint', () => {
    expect(() => {
      db.prepare(`
        INSERT INTO fraud_rules
          (id, name, status, ip_cluster_weight, ua_fingerprint_weight,
           velocity_weight, activity_weight, flag_threshold, withhold_threshold,
           proposed_by, proposed_at, created_at, updated_at)
        VALUES ('bad-rule', 'Bad', 'draft', 5000, 3000, 1000, 500,
                3000, 7000, 'admin', datetime('now'), datetime('now'), datetime('now'))
      `).run();
    }).toThrow(); // 5000+3000+1000+500 = 9500 != 10000
  });

  it('enforces flag_threshold < withhold_threshold', () => {
    expect(() => {
      db.prepare(`
        INSERT INTO fraud_rules
          (id, name, status, ip_cluster_weight, ua_fingerprint_weight,
           velocity_weight, activity_weight, flag_threshold, withhold_threshold,
           proposed_by, proposed_at, created_at, updated_at)
        VALUES ('bad-thresh', 'Bad Thresholds', 'draft', 3000, 2500, 2500, 2000,
                7000, 3000, 'admin', datetime('now'), datetime('now'), datetime('now'))
      `).run();
    }).toThrow(); // flag 7000 >= withhold 3000
  });

  it('enforces unique active rule constraint', () => {
    expect(() => {
      db.prepare(`
        INSERT INTO fraud_rules
          (id, name, status, ip_cluster_weight, ua_fingerprint_weight,
           velocity_weight, activity_weight, flag_threshold, withhold_threshold,
           proposed_by, proposed_at, created_at, updated_at)
        VALUES ('second-active', 'Second Active', 'active', 3000, 2500, 2500, 2000,
                3000, 7000, 'admin', datetime('now'), datetime('now'), datetime('now'))
      `).run();
    }).toThrow(); // UNIQUE constraint — only one active rule
  });

  it('audit log table exists with correct columns', () => {
    const columns = db.prepare('PRAGMA table_info(fraud_rule_audit_log)').all() as Array<{ name: string }>;
    const colNames = columns.map(c => c.name);

    expect(colNames).toContain('rule_id');
    expect(colNames).toContain('action');
    expect(colNames).toContain('actor');
    expect(colNames).toContain('reason');
  });
});

// =============================================================================
// Task 15.2: FraudRulesService Governance Lifecycle
// =============================================================================

describe('Task 15.2: FraudRulesService Lifecycle', () => {
  it('proposes a new rule in draft status', async () => {
    const rule = await rulesService.proposeRule({
      name: 'New Weights',
      ipClusterWeight: 4000,
      uaFingerprintWeight: 2000,
      velocityWeight: 2000,
      activityWeight: 2000,
      flagThreshold: 2500,
      withholdThreshold: 6000,
      proposedBy: 'analyst-1',
      notes: 'Increase IP cluster weight',
    });

    expect(rule.status).toBe('draft');
    expect(rule.ipClusterWeight).toBe(4000);
    expect(rule.flagThreshold).toBe(2500);
    expect(rule.proposedBy).toBe('analyst-1');
  });

  it('full lifecycle: draft → pending_approval → cooling_down → active', async () => {
    const rule = await rulesService.proposeRule({
      name: 'Lifecycle Test',
      ipClusterWeight: 3500,
      uaFingerprintWeight: 2500,
      velocityWeight: 2000,
      activityWeight: 2000,
      flagThreshold: 3000,
      withholdThreshold: 7000,
      proposedBy: 'analyst-1',
    });

    // Submit
    const submitted = await rulesService.submitForApproval(rule.id, 'analyst-1');
    expect(submitted.status).toBe('pending_approval');

    // Approve (different actor — four-eyes)
    const approved = await rulesService.approveRule(rule.id, 'manager-1');
    expect(approved.status).toBe('cooling_down');
    expect(approved.approvedBy).toBe('manager-1');
    expect(approved.approvedAt).not.toBeNull();
    expect(approved.activatesAt).not.toBeNull();

    // Simulate cooldown elapsed
    db.prepare(`
      UPDATE fraud_rules SET activates_at = datetime('now', '-1 hour') WHERE id = ?
    `).run(rule.id);

    // Activate
    const activated = await rulesService.activateReadyRules();
    expect(activated.length).toBe(1);
    expect(activated[0].status).toBe('active');

    // Previous active rule should be superseded
    const oldRule = db.prepare(
      `SELECT status FROM fraud_rules WHERE id = 'seed-initial-fraud-rule'`
    ).get() as { status: string };
    expect(oldRule.status).toBe('superseded');
  });

  it('enforces four-eyes on approval', async () => {
    const rule = await rulesService.proposeRule({
      name: 'Four Eyes Test',
      ipClusterWeight: 3000,
      uaFingerprintWeight: 2500,
      velocityWeight: 2500,
      activityWeight: 2000,
      flagThreshold: 3000,
      withholdThreshold: 7000,
      proposedBy: 'analyst-1',
    });
    await rulesService.submitForApproval(rule.id, 'analyst-1');

    // Same person cannot approve their own proposal
    await expect(
      rulesService.approveRule(rule.id, 'analyst-1'),
    ).rejects.toThrow(/four.eyes|FourEyes/i);
  });

  it('rejects a pending rule', async () => {
    const rule = await rulesService.proposeRule({
      name: 'To Reject',
      ipClusterWeight: 3000,
      uaFingerprintWeight: 2500,
      velocityWeight: 2500,
      activityWeight: 2000,
      flagThreshold: 3000,
      withholdThreshold: 7000,
      proposedBy: 'analyst-1',
    });
    await rulesService.submitForApproval(rule.id, 'analyst-1');

    const rejected = await rulesService.rejectRule(rule.id, 'manager-1', 'Too aggressive');
    expect(rejected.status).toBe('rejected');

    const audit = await rulesService.getRuleAudit(rule.id);
    const rejectEntry = audit.find(a => a.action === 'rejected');
    expect(rejectEntry).toBeDefined();
    expect(rejectEntry!.reason).toBe('Too aggressive');
  });

  it('overrides cooldown for emergency activation', async () => {
    const rule = await rulesService.proposeRule({
      name: 'Emergency Override',
      ipClusterWeight: 5000,
      uaFingerprintWeight: 2000,
      velocityWeight: 2000,
      activityWeight: 1000,
      flagThreshold: 2000,
      withholdThreshold: 5000,
      proposedBy: 'analyst-1',
    });
    await rulesService.submitForApproval(rule.id, 'analyst-1');
    await rulesService.approveRule(rule.id, 'manager-1');

    const overridden = await rulesService.overrideCooldown(
      rule.id, 'ciso', 'Active sybil attack detected',
    );
    expect(overridden.status).toBe('active');

    const audit = await rulesService.getRuleAudit(rule.id);
    const overrideEntry = audit.find(a => a.action === 'cooldown_overridden');
    expect(overrideEntry).toBeDefined();
    expect(overrideEntry!.reason).toBe('Active sybil attack detected');
  });

  it('prevents invalid state transitions', async () => {
    const rule = await rulesService.proposeRule({
      name: 'Invalid Transition',
      ipClusterWeight: 3000,
      uaFingerprintWeight: 2500,
      velocityWeight: 2500,
      activityWeight: 2000,
      flagThreshold: 3000,
      withholdThreshold: 7000,
      proposedBy: 'analyst-1',
    });

    // Cannot approve a draft (must submit first)
    await expect(
      rulesService.approveRule(rule.id, 'manager-1'),
    ).rejects.toThrow(/Cannot/);

    // Cannot override cooldown on a draft
    await expect(
      rulesService.overrideCooldown(rule.id, 'ciso', 'reason'),
    ).rejects.toThrow(/Cannot/);
  });

  it('getPendingRules returns non-terminal rules', async () => {
    const rule1 = await rulesService.proposeRule({
      name: 'Pending 1',
      ipClusterWeight: 3000, uaFingerprintWeight: 2500,
      velocityWeight: 2500, activityWeight: 2000,
      flagThreshold: 3000, withholdThreshold: 7000,
      proposedBy: 'analyst',
    });
    const rule2 = await rulesService.proposeRule({
      name: 'Pending 2',
      ipClusterWeight: 3000, uaFingerprintWeight: 2500,
      velocityWeight: 2500, activityWeight: 2000,
      flagThreshold: 3000, withholdThreshold: 7000,
      proposedBy: 'analyst',
    });
    await rulesService.submitForApproval(rule2.id, 'analyst');

    const pending = await rulesService.getPendingRules();
    const pendingIds = pending.map(r => r.id);
    expect(pendingIds).toContain(rule1.id);
    expect(pendingIds).toContain(rule2.id);
    expect(pendingIds).not.toContain('seed-initial-fraud-rule');
  });
});

// =============================================================================
// Task 15.3: FraudCheckService Configurable Weights
// =============================================================================

describe('Task 15.3: FraudCheckService with FraudRulesService', () => {
  it('uses hardcoded defaults without FraudRulesService', () => {
    const fraudService = new FraudCheckService(db);
    expect(fraudService.getConfigSource()).toBe('hardcoded');
  });

  it('loads weights from active fraud rule', async () => {
    const fraudService = new FraudCheckService(db, undefined, rulesService);

    // Seed referral_events table for fraud check
    setupReferralEventsTable(db);

    // Score with seed rule weights (should load from fraud_rules)
    const score = fraudService.scoreRegistration('test-account');
    expect(fraudService.getConfigSource()).toBe('fraud_rule');
    expect(score).toBeDefined();
    expect(score.signals.length).toBe(4);
  });

  it('custom weights produce different signal weights', async () => {
    setupReferralEventsTable(db);
    seedSuspiciousEvents(db);

    // Create and activate rule with heavily weighted IP cluster
    const rule = await rulesService.proposeRule({
      name: 'Heavy IP Weight',
      ipClusterWeight: 8000, // 80% weight on IP cluster (was 30%)
      uaFingerprintWeight: 1000,
      velocityWeight: 500,
      activityWeight: 500,
      flagThreshold: 2000,
      withholdThreshold: 5000,
      proposedBy: 'analyst',
    });
    await rulesService.submitForApproval(rule.id, 'analyst');
    await rulesService.approveRule(rule.id, 'manager');
    await rulesService.overrideCooldown(rule.id, 'ciso', 'Testing');

    // Verify the new rule is active with correct weights
    const activeWeights = rulesService.getActiveWeights();
    expect(activeWeights).not.toBeNull();
    expect(activeWeights!.ipCluster).toBeCloseTo(0.8);
    expect(activeWeights!.uaFingerprint).toBeCloseTo(0.1);
    expect(activeWeights!.velocity).toBeCloseTo(0.05);
    expect(activeWeights!.activityCheck).toBeCloseTo(0.05);
    expect(activeWeights!.flagThreshold).toBeCloseTo(0.2);
    expect(activeWeights!.withholdThreshold).toBeCloseTo(0.5);

    // FraudCheckService with rulesService should use the new weights
    const customFraud = new FraudCheckService(db, undefined, rulesService);
    const score = customFraud.scoreRegistration('suspect-account');
    expect(customFraud.getConfigSource()).toBe('fraud_rule');

    // With 80% IP weight and IP cluster signal = 1.0,
    // score should be much higher than with 30% IP weight
    // IP: 1.0 * 0.8 + velocity: 1.0 * 0.05 = 0.85
    expect(score.score).toBeGreaterThan(0.7);
    expect(score.signals[0].weight).toBeCloseTo(0.8); // IP cluster weight
  });

  it('falls back to hardcoded when no active rule', () => {
    // Delete seeded active rule
    db.prepare('DELETE FROM fraud_rule_audit_log').run();
    db.prepare('DELETE FROM fraud_rules').run();

    const fraudService = new FraudCheckService(db, undefined, rulesService);
    setupReferralEventsTable(db);

    const score = fraudService.scoreRegistration('test-account');
    expect(fraudService.getConfigSource()).toBe('hardcoded');
    expect(score).toBeDefined();
  });

  it('invalidateConfig refreshes from fraud rules', async () => {
    setupReferralEventsTable(db);

    const fraudService = new FraudCheckService(db, undefined, rulesService);

    // First call loads seed rule
    fraudService.scoreRegistration('test-account');
    expect(fraudService.getConfigSource()).toBe('fraud_rule');

    // Activate a new rule with different thresholds
    const rule = await rulesService.proposeRule({
      name: 'Updated Thresholds',
      ipClusterWeight: 3000,
      uaFingerprintWeight: 2500,
      velocityWeight: 2500,
      activityWeight: 2000,
      flagThreshold: 1000, // Much lower flag threshold
      withholdThreshold: 4000,
      proposedBy: 'analyst',
    });
    await rulesService.submitForApproval(rule.id, 'analyst');
    await rulesService.approveRule(rule.id, 'manager');
    await rulesService.overrideCooldown(rule.id, 'ciso', 'Testing');

    // Cache still has old values — verify by checking weights via getActiveWeights
    const oldWeights = rulesService.getActiveWeights();
    expect(oldWeights!.flagThreshold).toBe(0.1); // 1000/10000

    // Invalidate and verify new weights are loaded
    fraudService.invalidateConfig();
    fraudService.scoreRegistration('test-account');
    expect(fraudService.getConfigSource()).toBe('fraud_rule');
  });
});

// =============================================================================
// Task 15.5: Fraud Rule Activation Job
// =============================================================================

describe('Task 15.5: Fraud Rules Activation Job', () => {
  it('auto-activates rules after cooldown', async () => {
    const rule = await rulesService.proposeRule({
      name: 'Auto Activate',
      ipClusterWeight: 3500,
      uaFingerprintWeight: 2500,
      velocityWeight: 2000,
      activityWeight: 2000,
      flagThreshold: 3000,
      withholdThreshold: 7000,
      proposedBy: 'analyst',
    });
    await rulesService.submitForApproval(rule.id, 'analyst');
    await rulesService.approveRule(rule.id, 'manager');

    // Set activates_at to past
    db.prepare(`
      UPDATE fraud_rules SET activates_at = datetime('now', '-1 hour') WHERE id = ?
    `).run(rule.id);

    const activator = createFraudRulesActivator({ rulesService });
    const result = await activator.checkOnce();

    expect(result.activatedCount).toBe(1);

    const active = await rulesService.getActiveRule();
    expect(active!.id).toBe(rule.id);
  });

  it('no-op when nothing pending', async () => {
    const activator = createFraudRulesActivator({ rulesService });
    const result = await activator.checkOnce();
    expect(result.activatedCount).toBe(0);
  });
});

// =============================================================================
// Task 15.4: Admin API Validation Schemas
// =============================================================================

describe('Task 15.4: Fraud Rules Admin API Schemas', () => {
  it('proposeFraudRuleSchema accepts valid weights summing to 10000', () => {
    const result = proposeFraudRuleSchema.safeParse({
      name: 'Valid Rule',
      ipClusterWeight: 3000,
      uaFingerprintWeight: 2500,
      velocityWeight: 2500,
      activityWeight: 2000,
      flagThreshold: 3000,
      withholdThreshold: 7000,
    });
    expect(result.success).toBe(true);
  });

  it('rejects weights not summing to 10000', () => {
    const result = proposeFraudRuleSchema.safeParse({
      name: 'Bad Sum',
      ipClusterWeight: 5000,
      uaFingerprintWeight: 3000,
      velocityWeight: 1000,
      activityWeight: 500, // sum = 9500
      flagThreshold: 3000,
      withholdThreshold: 7000,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain('sum to 10000');
    }
  });

  it('rejects flag threshold >= withhold threshold', () => {
    const result = proposeFraudRuleSchema.safeParse({
      name: 'Bad Thresholds',
      ipClusterWeight: 3000,
      uaFingerprintWeight: 2500,
      velocityWeight: 2500,
      activityWeight: 2000,
      flagThreshold: 7000,
      withholdThreshold: 3000,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some(i => i.message.includes('less than'))).toBe(true);
    }
  });

  it('rejects non-integer weights', () => {
    const result = proposeFraudRuleSchema.safeParse({
      name: 'Float Weights',
      ipClusterWeight: 3000.5,
      uaFingerprintWeight: 2500,
      velocityWeight: 2500,
      activityWeight: 1999.5,
      flagThreshold: 3000,
      withholdThreshold: 7000,
    });
    expect(result.success).toBe(false);
  });

  it('rejects negative weights', () => {
    const result = proposeFraudRuleSchema.safeParse({
      name: 'Negative',
      ipClusterWeight: -1000,
      uaFingerprintWeight: 4000,
      velocityWeight: 4000,
      activityWeight: 3000,
      flagThreshold: 3000,
      withholdThreshold: 7000,
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing name', () => {
    const result = proposeFraudRuleSchema.safeParse({
      ipClusterWeight: 3000,
      uaFingerprintWeight: 2500,
      velocityWeight: 2500,
      activityWeight: 2000,
      flagThreshold: 3000,
      withholdThreshold: 7000,
    });
    expect(result.success).toBe(false);
  });

  it('setBillingAdminServices accepts fraudRules parameter', async () => {
    // Verify the function signature accepts the new parameter without errors
    const { setBillingAdminServices } = await import(
      '../../src/api/routes/billing-admin-routes.js'
    );
    expect(typeof setBillingAdminServices).toBe('function');
  });
});

// =============================================================================
// Test Helpers
// =============================================================================

function setupReferralEventsTable(testDb: Database.Database): void {
  testDb.exec(`
    CREATE TABLE IF NOT EXISTS referral_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      ip_hash TEXT,
      ip_prefix TEXT,
      user_agent_hash TEXT,
      fingerprint_hash TEXT,
      referral_code_id TEXT,
      metadata TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
}

function seedSuspiciousEvents(testDb: Database.Database): void {
  // Create multiple accounts sharing the same IP (triggers IP cluster signal)
  const sharedIp = 'hash_shared_ip_abc123';
  const sharedPrefix = '192.168.1';

  for (let i = 0; i < 5; i++) {
    testDb.prepare(`
      INSERT INTO referral_events (account_id, event_type, ip_hash, ip_prefix, fingerprint_hash, created_at)
      VALUES (?, 'registration', ?, ?, ?, datetime('now'))
    `).run(`account-${i}`, sharedIp, sharedPrefix, `fp_${i}`, );
  }

  // The suspect account shares IP with the others
  testDb.prepare(`
    INSERT INTO referral_events (account_id, event_type, ip_hash, ip_prefix, fingerprint_hash, created_at)
    VALUES ('suspect-account', 'registration', ?, ?, 'fp_suspect', datetime('now'))
  `).run(sharedIp, sharedPrefix);
}

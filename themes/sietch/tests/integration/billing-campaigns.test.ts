/**
 * Billing Campaigns Integration Tests
 *
 * Validates Sprint 4: campaign engine, batch grants, budget enforcement,
 * per-wallet caps, campaign lifecycle.
 *
 * SDD refs: §1.4 CampaignService
 * Sprint refs: Tasks 4.1–4.4
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { CREDIT_LEDGER_SCHEMA_SQL } from '../../src/db/migrations/030_credit_ledger.js';
import { CAMPAIGNS_SCHEMA_SQL } from '../../src/db/migrations/033_campaigns.js';
import { CreditLedgerAdapter } from '../../src/packages/adapters/billing/CreditLedgerAdapter.js';
import { CampaignAdapter } from '../../src/packages/adapters/billing/CampaignAdapter.js';

// =============================================================================
// Test Setup
// =============================================================================

let db: Database.Database;
let ledger: CreditLedgerAdapter;
let campaigns: CampaignAdapter;

function setupDb(): Database.Database {
  const testDb = new Database(':memory:');
  testDb.pragma('journal_mode = WAL');
  testDb.pragma('foreign_keys = OFF');
  testDb.exec(CREDIT_LEDGER_SCHEMA_SQL);
  testDb.exec(CAMPAIGNS_SCHEMA_SQL);
  testDb.pragma('foreign_keys = ON');
  return testDb;
}

// =============================================================================
// Setup / Teardown
// =============================================================================

beforeEach(() => {
  db = setupDb();
  ledger = new CreditLedgerAdapter(db);
  campaigns = new CampaignAdapter(db, ledger);
});

afterEach(() => {
  db.close();
});

// =============================================================================
// Tests
// =============================================================================

describe('Billing Campaigns Integration', () => {
  // ---------------------------------------------------------------------------
  // Migration 033 — Campaign Tables
  // ---------------------------------------------------------------------------

  describe('migration-033-structure', () => {
    it('credit_campaigns table has correct columns', () => {
      const columns = db.prepare(
        `PRAGMA table_info(credit_campaigns)`
      ).all() as Array<{ name: string }>;

      const colNames = columns.map(c => c.name);
      expect(colNames).toContain('campaign_type');
      expect(colNames).toContain('budget_micro');
      expect(colNames).toContain('spent_micro');
      expect(colNames).toContain('grant_formula');
      expect(colNames).toContain('per_wallet_cap_micro');
    });

    it('credit_grants table has UNIQUE(campaign_id, account_id)', () => {
      // Insert a grant manually
      db.prepare(
        `INSERT INTO credit_campaigns (id, name, campaign_type, budget_micro, created_at, updated_at)
         VALUES ('camp-1', 'Test', 'promotional', 1000000, datetime('now'), datetime('now'))`
      ).run();

      const account = db.prepare(
        `INSERT INTO credit_accounts (id, entity_type, entity_id, created_at, updated_at)
         VALUES ('acc-uniq-1', 'person', 'user-uniq-1', datetime('now'), datetime('now'))`
      ).run();

      db.prepare(
        `INSERT INTO credit_grants (id, campaign_id, account_id, amount_micro, grant_formula, created_at)
         VALUES ('g-1', 'camp-1', 'acc-uniq-1', 1000, 'fixed_amount', datetime('now'))`
      ).run();

      expect(() => {
        db.prepare(
          `INSERT INTO credit_grants (id, campaign_id, account_id, amount_micro, grant_formula, created_at)
           VALUES ('g-2', 'camp-1', 'acc-uniq-1', 2000, 'fixed_amount', datetime('now'))`
        ).run();
      }).toThrow(); // UNIQUE constraint violation
    });
  });

  // ---------------------------------------------------------------------------
  // Campaign Lifecycle
  // ---------------------------------------------------------------------------

  describe('campaign-lifecycle', () => {
    it('creates a campaign in draft status', async () => {
      const campaign = await campaigns.createCampaign({
        name: 'Reverse Airdrop Q1',
        campaignType: 'reverse_airdrop',
        budgetMicro: 50_000_000n, // $50
        grantFormula: 'proportional_loss',
      });

      expect(campaign.status).toBe('draft');
      expect(campaign.budgetMicro).toBe(50_000_000n);
      expect(campaign.spentMicro).toBe(0n);
      expect(campaign.perWalletCapMicro).toBe(5_000_000n);
    });

    it('transitions draft → active → paused → completed', async () => {
      const campaign = await campaigns.createCampaign({
        name: 'Lifecycle Test',
        campaignType: 'promotional',
        budgetMicro: 10_000_000n,
        grantFormula: 'fixed_amount',
      });

      const active = await campaigns.activateCampaign(campaign.id);
      expect(active.status).toBe('active');

      const paused = await campaigns.pauseCampaign(campaign.id);
      expect(paused.status).toBe('paused');

      const completed = await campaigns.completeCampaign(campaign.id);
      expect(completed.status).toBe('completed');
    });

    it('rejects invalid transitions', async () => {
      const campaign = await campaigns.createCampaign({
        name: 'Invalid Transition',
        campaignType: 'promotional',
        budgetMicro: 1_000_000n,
        grantFormula: 'fixed_amount',
      });

      // draft → paused should fail
      await expect(campaigns.pauseCampaign(campaign.id))
        .rejects.toThrow('Invalid campaign transition');

      // draft → completed should fail
      await expect(campaigns.completeCampaign(campaign.id))
        .rejects.toThrow('Invalid campaign transition');
    });
  });

  // ---------------------------------------------------------------------------
  // Batch Grants
  // ---------------------------------------------------------------------------

  describe('batch-grants', () => {
    it('creates grants and credit lots for multiple accounts', async () => {
      const campaign = await campaigns.createCampaign({
        name: 'Batch Test',
        campaignType: 'reverse_airdrop',
        budgetMicro: 20_000_000n,
        grantFormula: 'fixed_amount',
      });
      await campaigns.activateCampaign(campaign.id);

      // Create test accounts
      const acc1 = await ledger.createAccount('person', 'user-batch-1');
      const acc2 = await ledger.createAccount('person', 'user-batch-2');
      const acc3 = await ledger.createAccount('person', 'user-batch-3');

      const result = await campaigns.batchGrant(campaign.id, [
        { accountId: acc1.id, amountMicro: 2_000_000n },
        { accountId: acc2.id, amountMicro: 3_000_000n },
        { accountId: acc3.id, amountMicro: 1_000_000n },
      ]);

      expect(result.totalGranted).toBe(3);
      expect(result.totalFailed).toBe(0);
      expect(result.totalAmountMicro).toBe(6_000_000n);

      // Verify lots created
      for (const grant of result.grants) {
        expect(grant.status).toBe('granted');
        expect(grant.lotId).toBeTruthy();
      }

      // Verify campaign spent updated
      const updated = await campaigns.getCampaign(campaign.id);
      expect(updated!.spentMicro).toBe(6_000_000n);

      // Verify account balances
      const balance1 = await ledger.getBalance(acc1.id);
      expect(balance1.availableMicro).toBe(2_000_000n);
    });

    it('rejects batch exceeding budget', async () => {
      const campaign = await campaigns.createCampaign({
        name: 'Budget Test',
        campaignType: 'promotional',
        budgetMicro: 5_000_000n,
        grantFormula: 'fixed_amount',
      });
      await campaigns.activateCampaign(campaign.id);

      const acc1 = await ledger.createAccount('person', 'user-budget-1');
      const acc2 = await ledger.createAccount('person', 'user-budget-2');

      await expect(campaigns.batchGrant(campaign.id, [
        { accountId: acc1.id, amountMicro: 3_000_000n },
        { accountId: acc2.id, amountMicro: 3_000_000n }, // total 6M > budget 5M
      ])).rejects.toThrow('exceed budget');
    });

    it('rejects grant exceeding per-wallet cap', async () => {
      const campaign = await campaigns.createCampaign({
        name: 'Cap Test',
        campaignType: 'promotional',
        budgetMicro: 50_000_000n,
        grantFormula: 'fixed_amount',
        perWalletCapMicro: 2_000_000n,
      });
      await campaigns.activateCampaign(campaign.id);

      const acc1 = await ledger.createAccount('person', 'user-cap-1');

      await expect(campaigns.batchGrant(campaign.id, [
        { accountId: acc1.id, amountMicro: 3_000_000n }, // exceeds 2M cap
      ])).rejects.toThrow('exceeds per-wallet cap');
    });

    it('rejects grants on non-active campaign', async () => {
      const campaign = await campaigns.createCampaign({
        name: 'Draft Campaign',
        campaignType: 'promotional',
        budgetMicro: 10_000_000n,
        grantFormula: 'fixed_amount',
      });
      // Still in draft

      const acc1 = await ledger.createAccount('person', 'user-draft-1');

      await expect(campaigns.batchGrant(campaign.id, [
        { accountId: acc1.id, amountMicro: 1_000_000n },
      ])).rejects.toThrow('must be active');
    });

    it('rejects batch exceeding max size', async () => {
      const campaign = await campaigns.createCampaign({
        name: 'Big Batch',
        campaignType: 'promotional',
        budgetMicro: 999_999_999_999n,
        grantFormula: 'fixed_amount',
      });
      await campaigns.activateCampaign(campaign.id);

      const grants = Array.from({ length: 1001 }, (_, i) => ({
        accountId: `acc-${i}`,
        amountMicro: 1000n,
      }));

      await expect(campaigns.batchGrant(campaign.id, grants))
        .rejects.toThrow('exceeds maximum 1000');
    });
  });

  // ---------------------------------------------------------------------------
  // getCampaign
  // ---------------------------------------------------------------------------

  describe('getCampaign', () => {
    it('returns null for non-existent campaign', async () => {
      const result = await campaigns.getCampaign('camp-nonexistent');
      expect(result).toBeNull();
    });
  });
});

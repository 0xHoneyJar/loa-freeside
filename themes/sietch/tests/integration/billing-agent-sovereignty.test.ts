/**
 * Agent Sovereignty E2E Integration Test (Sprint 291, Task 8.1)
 *
 * Full agent economic sovereignty lifecycle:
 *   Agent A earns referral revenue → transfers credits to Agent B →
 *   Agent A proposes governance change → Agent A + B vote → quorum →
 *   cooldown → parameter activated → reconciliation passes
 *
 * Uses real in-memory SQLite — no mocks for service logic.
 *
 * SDD refs: §8.2 Agent Sovereignty Proof
 * PRD refs: G-6 Agent economic self-sustainability proof
 * Sprint refs: Sprint 291 Task 8.1
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';

// Schema imports
import { CREDIT_LEDGER_SCHEMA_SQL } from '../../src/db/migrations/030_credit_ledger.js';
import { PEER_TRANSFERS_SQL, CREDIT_LEDGER_REBUILD_SQL } from '../../src/db/migrations/056_peer_transfers.js';
// CREDIT_LOTS_REBUILD_SQL not used — inline DROP+CREATE avoids SQLite FK reference issues
import { TBA_DEPOSITS_SQL } from '../../src/db/migrations/057_tba_deposits.js';
import { AGENT_GOVERNANCE_SQL } from '../../src/db/migrations/058_agent_governance.js';
import { ECONOMIC_EVENTS_SQL } from '../../src/db/migrations/054_economic_events.js';

// Service imports
import { CreditLedgerAdapter } from '../../src/packages/adapters/billing/CreditLedgerAdapter.js';
import { PeerTransferService } from '../../src/packages/adapters/billing/PeerTransferService.js';
import { AgentGovernanceService } from '../../src/packages/adapters/billing/AgentGovernanceService.js';
import { ConstitutionalGovernanceService } from '../../src/packages/adapters/billing/ConstitutionalGovernanceService.js';
import { ReconciliationService } from '../../src/packages/adapters/billing/ReconciliationService.js';

// =============================================================================
// Test Helpers
// =============================================================================

let db: Database.Database;
let ledger: CreditLedgerAdapter;
let transferService: PeerTransferService;
let governanceService: AgentGovernanceService;
let reconciliation: ReconciliationService;

function createTestDb(): Database.Database {
  const testDb = new Database(':memory:');
  testDb.pragma('journal_mode = WAL');
  testDb.pragma('foreign_keys = ON');

  // Base credit ledger schema
  testDb.exec(CREDIT_LEDGER_SCHEMA_SQL);
  // Rebuild credit_ledger to add 'transfer_out' entry_type (migration 056)
  testDb.pragma('foreign_keys = OFF');
  testDb.exec(CREDIT_LEDGER_REBUILD_SQL);

  // Drop and recreate credit_lots with 'tba_deposit' source_type (matching migration 060)
  // Inline DROP+CREATE avoids SQLite FK reference issues with ALTER TABLE RENAME
  testDb.exec(`DROP TABLE IF EXISTS credit_lots`);
  testDb.exec(`
    CREATE TABLE credit_lots (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES credit_accounts(id),
      pool_id TEXT,
      source_type TEXT NOT NULL CHECK (source_type IN (
        'deposit', 'grant', 'purchase', 'transfer_in', 'commons_dividend', 'tba_deposit'
      )),
      source_id TEXT,
      original_micro INTEGER NOT NULL,
      available_micro INTEGER NOT NULL DEFAULT 0,
      reserved_micro INTEGER NOT NULL DEFAULT 0,
      consumed_micro INTEGER NOT NULL DEFAULT 0,
      expires_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      CONSTRAINT lot_balance CHECK (available_micro >= 0 AND reserved_micro >= 0 AND consumed_micro >= 0),
      CONSTRAINT lot_invariant CHECK (available_micro + reserved_micro + consumed_micro = original_micro)
    );
    CREATE INDEX IF NOT EXISTS idx_credit_lots_redemption
      ON credit_lots(account_id, pool_id, expires_at) WHERE available_micro > 0;
    CREATE INDEX IF NOT EXISTS idx_credit_lots_account ON credit_lots(account_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_credit_lots_source
      ON credit_lots(source_type, source_id) WHERE source_id IS NOT NULL;
  `);
  testDb.pragma('foreign_keys = ON');

  // Economic events
  testDb.exec(ECONOMIC_EVENTS_SQL);

  // Cycle-031 schemas
  testDb.exec(PEER_TRANSFERS_SQL);
  testDb.exec(TBA_DEPOSITS_SQL);
  testDb.exec(AGENT_GOVERNANCE_SQL);

  // Reconciliation runs table (needed for ReconciliationService)
  testDb.exec(`
    CREATE TABLE IF NOT EXISTS reconciliation_runs (
      id TEXT PRIMARY KEY,
      started_at TEXT NOT NULL,
      finished_at TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('passed', 'divergence_detected', 'error')),
      checks_json TEXT NOT NULL,
      divergence_summary_json TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
  `);

  // Agent identity table (needed for provenance)
  testDb.exec(`
    CREATE TABLE IF NOT EXISTS agent_identity (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL UNIQUE REFERENCES credit_accounts(id),
      chain_id INTEGER NOT NULL,
      contract_address TEXT NOT NULL,
      token_id TEXT NOT NULL,
      tba_address TEXT,
      creator_account_id TEXT NOT NULL REFERENCES credit_accounts(id),
      verified_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
  `);

  // System config tables (needed for governance activation)
  testDb.exec(`
    CREATE TABLE IF NOT EXISTS system_config (
      id TEXT PRIMARY KEY,
      param_key TEXT NOT NULL,
      entity_type TEXT,
      value_json TEXT NOT NULL,
      config_version INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'active',
      proposed_by TEXT,
      proposed_at TEXT,
      approval_count INTEGER DEFAULT 0,
      required_approvals INTEGER DEFAULT 0,
      activated_at TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
    CREATE TABLE IF NOT EXISTS system_config_version_seq (
      param_key TEXT NOT NULL,
      entity_type TEXT,
      current_version INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (param_key, entity_type)
    );
  `);

  return testDb;
}

function createAccount(testDb: Database.Database, entityType: string, externalId: string): string {
  const id = randomUUID();
  testDb.prepare(`
    INSERT INTO credit_accounts (id, entity_type, entity_id, created_at)
    VALUES (?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  `).run(id, entityType, externalId);
  return id;
}

function createAgentIdentity(testDb: Database.Database, accountId: string, creatorAccountId: string): void {
  testDb.prepare(`
    INSERT INTO agent_identity (id, account_id, chain_id, contract_address, token_id, creator_account_id, verified_at)
    VALUES (?, ?, 1, '0x1234567890abcdef1234567890abcdef12345678', ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  `).run(randomUUID(), accountId, randomUUID(), creatorAccountId);
}

function mintDirectLot(testDb: Database.Database, accountId: string, amountMicro: number, sourceType: string): string {
  const lotId = randomUUID();
  testDb.prepare(`
    INSERT INTO credit_lots (id, account_id, original_micro, available_micro, reserved_micro, consumed_micro, source_type, source_id, pool_id, created_at)
    VALUES (?, ?, ?, ?, 0, 0, ?, ?, 'general', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  `).run(lotId, accountId, String(amountMicro), String(amountMicro), sourceType, `src-${randomUUID()}`);
  return lotId;
}

function getAccountBalance(testDb: Database.Database, accountId: string): bigint {
  const rows = testDb.prepare(`
    SELECT available_micro FROM credit_lots
    WHERE account_id = ?
  `).all(accountId) as Array<{ available_micro: string | number | null }>;
  return rows.reduce((acc, r) => acc + BigInt(String(r.available_micro ?? 0)), 0n);
}

function getEventCount(testDb: Database.Database, eventType: string): number {
  const row = testDb.prepare(`
    SELECT COUNT(*) as cnt FROM economic_events WHERE event_type = ?
  `).get(eventType) as { cnt: number };
  return row.cnt;
}

// =============================================================================
// Setup / Teardown
// =============================================================================

beforeEach(() => {
  db = createTestDb();
  ledger = new CreditLedgerAdapter(db);
  transferService = new PeerTransferService(db, ledger);
  const constitutionalGovernance = new ConstitutionalGovernanceService(db);
  governanceService = new AgentGovernanceService(db, undefined, constitutionalGovernance);
  reconciliation = new ReconciliationService(db);
});

afterEach(() => {
  db.close();
});

// =============================================================================
// G-6: Agent Sovereignty E2E Proof
// =============================================================================

describe('Agent Sovereignty E2E Proof (G-6)', () => {
  it('complete sovereignty lifecycle: earn → transfer → govern → reconcile', async () => {
    // =========================================================================
    // Phase 1: Setup — Create creator and two agent accounts
    // =========================================================================
    const creatorId = createAccount(db, 'person', 'creator-1');
    const agentAId = createAccount(db, 'agent', 'agent-a');
    const agentBId = createAccount(db, 'agent', 'agent-b');

    // Agent identity (for governance provenance)
    createAgentIdentity(db, agentAId, creatorId);
    createAgentIdentity(db, agentBId, creatorId);

    // =========================================================================
    // Phase 2: Agent A earns referral revenue (simulated via lot minting)
    // =========================================================================
    const earnAmount = 50_000_000; // $50
    mintDirectLot(db, agentAId, earnAmount, 'deposit');

    const agentABalance = getAccountBalance(db, agentAId);
    expect(agentABalance).toBe(BigInt(earnAmount));

    // =========================================================================
    // Phase 3: Agent A transfers credits to Agent B
    // =========================================================================
    const transferAmount = 20_000_000; // $20
    const transferResult = await transferService.transfer(
      agentAId,
      agentBId,
      BigInt(transferAmount),
      { idempotencyKey: `transfer-${randomUUID()}` },
    );

    expect(transferResult.status).toBe('completed');

    // Verify balances after transfer
    const agentAAfterTransfer = getAccountBalance(db, agentAId);
    const agentBAfterTransfer = getAccountBalance(db, agentBId);
    expect(agentAAfterTransfer).toBe(BigInt(earnAmount - transferAmount));
    expect(agentBAfterTransfer).toBe(BigInt(transferAmount));

    // Verify zero-sum: total supply unchanged
    const totalLots = db.prepare(`
      SELECT CAST(COALESCE(SUM(original_micro), 0) AS TEXT) as total FROM credit_lots
    `).get() as { total: string };
    expect(BigInt(totalLots.total)).toBe(BigInt(earnAmount));

    // Verify transfer_in lot created for Agent B
    const transferInLot = db.prepare(`
      SELECT * FROM credit_lots WHERE account_id = ? AND source_type = 'transfer_in'
    `).get(agentBId) as any;
    expect(transferInLot).toBeDefined();
    expect(BigInt(String(transferInLot.original_micro))).toBe(BigInt(transferAmount));

    // =========================================================================
    // Phase 4: Agent A proposes governance parameter change
    // =========================================================================
    // Seed governance params for quorum resolution
    db.prepare(`
      INSERT INTO system_config (id, param_key, entity_type, value_json, status, proposed_by, proposed_at, activated_at, created_at)
      VALUES (?, 'governance.agent_quorum_weight', NULL, '2', 'active', 'test', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    `).run(randomUUID());
    db.prepare(`
      INSERT INTO system_config (id, param_key, entity_type, value_json, status, proposed_by, proposed_at, activated_at, created_at)
      VALUES (?, 'governance.agent_cooldown_seconds', NULL, '0', 'active', 'test', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    `).run(randomUUID());
    db.prepare(`
      INSERT INTO system_config (id, param_key, entity_type, value_json, status, proposed_by, proposed_at, activated_at, created_at)
      VALUES (?, 'governance.agent_weight_source', NULL, '"fixed_allocation"', 'active', 'test', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    `).run(randomUUID());
    db.prepare(`
      INSERT INTO system_config (id, param_key, entity_type, value_json, status, proposed_by, proposed_at, activated_at, created_at)
      VALUES (?, 'governance.fixed_weight_per_agent', NULL, '1', 'active', 'test', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    `).run(randomUUID());
    db.prepare(`
      INSERT INTO system_config (id, param_key, entity_type, value_json, status, proposed_by, proposed_at, activated_at, created_at)
      VALUES (?, 'governance.max_weight_per_agent', NULL, '10', 'active', 'test', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    `).run(randomUUID());

    // Agent A proposes changing reservation TTL
    const proposal = await governanceService.proposeAsAgent(agentAId, {
      paramKey: 'reservation.default_ttl_seconds',
      value: 600, // Propose 10 minutes (current default is 300)
      justification: 'Agents need longer reservation windows for complex operations',
    });

    expect(proposal.status).toBe('open');
    expect(proposal.proposerWeight).toBe(1); // fixed_allocation = 1
    expect(proposal.totalWeight).toBe(1); // proposer's auto-vote

    // =========================================================================
    // Phase 5: Agent B votes → quorum reached (1 + 1 = 2 >= quorum of 2)
    // =========================================================================
    const afterVote = await governanceService.voteAsAgent(agentBId, proposal.id, {
      vote: 'support',
    });

    expect(afterVote.status).toBe('quorum_reached');
    expect(afterVote.totalWeight).toBe(2);

    // =========================================================================
    // Phase 6: Cooldown → activation (cooldown is 0 seconds in test config)
    // =========================================================================
    const activated = await governanceService.activateExpiredCooldowns();
    expect(activated).toBe(1);

    // Verify proposal is now activated
    const finalProposal = await governanceService.getProposal(proposal.id);
    expect(finalProposal!.status).toBe('activated');

    // =========================================================================
    // Phase 7: Full reconciliation — all 6 checks pass
    // =========================================================================
    const reconcResult = await reconciliation.reconcile();
    expect(reconcResult.status).toBe('passed');
    expect(reconcResult.checks.length).toBe(6);

    // Verify each check passed
    for (const check of reconcResult.checks) {
      expect(check.status).toBe('passed');
    }

    // Verify transfer conservation specifically
    const transferCheck = reconcResult.checks.find(c => c.name === 'transfer_conservation');
    expect(transferCheck).toBeDefined();
    expect(transferCheck!.details.orphanCompletedTransfers).toBe(0);

    // Verify deposit bridge conservation (vacuously true — no deposits)
    const depositCheck = reconcResult.checks.find(c => c.name === 'deposit_bridge_conservation');
    expect(depositCheck).toBeDefined();
    expect(depositCheck!.status).toBe('passed');
  });

  it('transfer conservation: multiple transfers remain zero-sum', async () => {
    // Create creator and agent accounts with identity
    const creatorId = createAccount(db, 'person', 'creator-multi');
    const accounts: string[] = [];
    for (let i = 0; i < 5; i++) {
      const acct = createAccount(db, 'agent', `agent-${i}`);
      createAgentIdentity(db, acct, creatorId);
      accounts.push(acct);
    }

    // Mint initial lots — $100 each
    const initialAmount = 100_000_000;
    for (const acct of accounts) {
      mintDirectLot(db, acct, initialAmount, 'deposit');
    }

    const totalBefore = db.prepare(`
      SELECT CAST(COALESCE(SUM(original_micro), 0) AS TEXT) as total FROM credit_lots
    `).get() as { total: string };

    // Execute 20 random transfers
    let completed = 0;
    let rejected = 0;

    for (let i = 0; i < 20; i++) {
      const from = accounts[Math.floor(Math.random() * accounts.length)];
      let to = accounts[Math.floor(Math.random() * accounts.length)];
      while (to === from) {
        to = accounts[Math.floor(Math.random() * accounts.length)];
      }

      const amount = BigInt(Math.floor(Math.random() * 10_000_000) + 1_000_000);

      try {
        const result = await transferService.transfer(from, to, amount, {
          idempotencyKey: `stress-${i}`,
        });
        if (result.status === 'completed') completed++;
        else rejected++;
      } catch {
        rejected++;
      }
    }

    expect(completed).toBeGreaterThan(0);

    // Verify global supply unchanged
    const totalAfter = db.prepare(`
      SELECT CAST(COALESCE(SUM(original_micro), 0) AS TEXT) as total FROM credit_lots
    `).get() as { total: string };
    expect(totalAfter.total).toBe(totalBefore.total);

    // Full reconciliation passes
    const result = await reconciliation.reconcile();
    expect(result.status).toBe('passed');
  });

  it('governance whitelist prevents agent proposals on sensitive params', async () => {
    const agentId = createAccount(db, 'agent', 'agent-blocked');

    for (const blockedKey of ['kyc.basic_threshold_micro', 'payout.min_micro', 'fraud_rule.cooldown_seconds', 'settlement.hold_seconds']) {
      await expect(
        governanceService.proposeAsAgent(agentId, {
          paramKey: blockedKey,
          value: 999,
        }),
      ).rejects.toThrow(/not proposable by agents/);
    }
  });

  it('duplicate vote rejected', async () => {
    const creatorId = createAccount(db, 'person', 'creator-dup');
    const agentId = createAccount(db, 'agent', 'agent-dup');
    createAgentIdentity(db, agentId, creatorId);

    // Seed minimal governance config
    db.prepare(`
      INSERT INTO system_config (id, param_key, entity_type, value_json, status, proposed_by, proposed_at, activated_at, created_at)
      VALUES (?, 'governance.agent_quorum_weight', NULL, '100', 'active', 'test', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    `).run(randomUUID());
    db.prepare(`
      INSERT INTO system_config (id, param_key, entity_type, value_json, status, proposed_by, proposed_at, activated_at, created_at)
      VALUES (?, 'governance.agent_weight_source', NULL, '"fixed_allocation"', 'active', 'test', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    `).run(randomUUID());
    db.prepare(`
      INSERT INTO system_config (id, param_key, entity_type, value_json, status, proposed_by, proposed_at, activated_at, created_at)
      VALUES (?, 'governance.fixed_weight_per_agent', NULL, '1', 'active', 'test', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    `).run(randomUUID());
    db.prepare(`
      INSERT INTO system_config (id, param_key, entity_type, value_json, status, proposed_by, proposed_at, activated_at, created_at)
      VALUES (?, 'governance.max_weight_per_agent', NULL, '10', 'active', 'test', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    `).run(randomUUID());

    const proposal = await governanceService.proposeAsAgent(agentId, {
      paramKey: 'governance.agent_cooldown_seconds',
      value: 3600,
    });

    // Agent A already voted (auto-vote on propose) — duplicate should fail
    await expect(
      governanceService.voteAsAgent(agentId, proposal.id, { vote: 'support' }),
    ).rejects.toThrow(/already voted/);
  });

  it('expired proposals cleaned up by cron', async () => {
    const agentId = createAccount(db, 'agent', 'agent-expire');

    // Seed config
    db.prepare(`
      INSERT INTO system_config (id, param_key, entity_type, value_json, status, proposed_by, proposed_at, activated_at, created_at)
      VALUES (?, 'governance.agent_quorum_weight', NULL, '100', 'active', 'test', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    `).run(randomUUID());
    db.prepare(`
      INSERT INTO system_config (id, param_key, entity_type, value_json, status, proposed_by, proposed_at, activated_at, created_at)
      VALUES (?, 'governance.agent_weight_source', NULL, '"fixed_allocation"', 'active', 'test', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    `).run(randomUUID());
    db.prepare(`
      INSERT INTO system_config (id, param_key, entity_type, value_json, status, proposed_by, proposed_at, activated_at, created_at)
      VALUES (?, 'governance.fixed_weight_per_agent', NULL, '1', 'active', 'test', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    `).run(randomUUID());
    db.prepare(`
      INSERT INTO system_config (id, param_key, entity_type, value_json, status, proposed_by, proposed_at, activated_at, created_at)
      VALUES (?, 'governance.max_weight_per_agent', NULL, '10', 'active', 'test', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    `).run(randomUUID());

    const proposal = await governanceService.proposeAsAgent(agentId, {
      paramKey: 'governance.reputation_scale_factor',
      value: 2,
    });

    // Manually expire the proposal
    db.prepare(`
      UPDATE agent_governance_proposals SET expires_at = '2020-01-01T00:00:00Z' WHERE id = ?
    `).run(proposal.id);

    const expired = await governanceService.expireStaleProposals();
    expect(expired).toBe(1);

    const updated = await governanceService.getProposal(proposal.id);
    expect(updated!.status).toBe('expired');
  });
});

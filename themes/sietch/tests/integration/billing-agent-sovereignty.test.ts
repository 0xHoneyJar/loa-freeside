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

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';

// Schema imports
import { CREDIT_LEDGER_SCHEMA_SQL } from '../../src/db/migrations/030_credit_ledger.js';
import { PEER_TRANSFERS_SQL, CREDIT_LEDGER_REBUILD_SQL } from '../../src/db/migrations/056_peer_transfers.js';
import { CREDIT_LOTS_REBUILD_SQL } from '../../src/db/migrations/060_credit_lots_tba_source.js';
import { TBA_DEPOSITS_SQL } from '../../src/db/migrations/057_tba_deposits.js';
import { AGENT_GOVERNANCE_SQL } from '../../src/db/migrations/058_agent_governance.js';
import { ECONOMIC_EVENTS_SQL } from '../../src/db/migrations/054_economic_events.js';
import { SYSTEM_CONFIG_SCHEMA_SQL } from '../../src/db/migrations/050_system_config.js';

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

  // Migration 060: Add 'tba_deposit' to credit_lots source_type CHECK
  // (Now uses safe CREATE→COPY→SWAP→DROP pattern — no FK corruption)
  testDb.exec(CREDIT_LOTS_REBUILD_SQL);
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

  // System config tables (needed for governance activation) — real migration
  // schema; a hand-rolled copy drifted (missing metadata) and made propose()
  // reject inside activateExpiredCooldowns.
  testDb.exec(SYSTEM_CONFIG_SCHEMA_SQL);

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

    // The approved parameter must actually APPLY: activation creates an
    // ACTIVE system_config row (a draft would never be read by resolution).
    const activeConfig = db.prepare(`
      SELECT status, value_json, proposed_by, metadata FROM system_config
      WHERE param_key = 'reservation.default_ttl_seconds' AND status = 'active'
    `).get() as
      | { status: string; value_json: string; proposed_by: string; metadata: string | null }
      | undefined;
    expect(activeConfig).toBeDefined();
    expect(activeConfig!.proposed_by).toBe(`agent-governance:${agentAId}`);
    // value_json must be JSON (resolution does JSON.parse)
    expect(JSON.parse(activeConfig!.value_json)).toBe(600);
    const configMeta = JSON.parse(activeConfig!.metadata ?? '{}');
    expect(configMeta.agentProposalId).toBe(proposal.id);

    // The proposal must record the config it activated (FK audit link
    // activated_config_id → system_config.id), exposed as activatedConfigId.
    const activatedConfigRow = db.prepare(`
      SELECT id FROM system_config
      WHERE param_key = 'reservation.default_ttl_seconds' AND status = 'active'
    `).get() as { id: string };
    expect(finalProposal!.activatedConfigId).toBe(activatedConfigRow.id);

    // Idempotency: a second sweep finds nothing to claim and creates no
    // duplicate config versions.
    expect(await governanceService.activateExpiredCooldowns()).toBe(0);
    const activeCount = db.prepare(`
      SELECT COUNT(*) as n FROM system_config
      WHERE param_key = 'reservation.default_ttl_seconds' AND status = 'active'
    `).get() as { n: number };
    expect(activeCount.n).toBe(1);

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

  it('rejects the reserved "__global__" entity scope', async () => {
    // '__global__' is the COALESCE sentinel for a NULL (global) scope; a
    // literal value would supersede the real global config but store a
    // phantom-scoped row that global resolution (entity_type IS NULL) never
    // finds. Must be rejected at the proposal boundary.
    const agentId = createAccount(db, 'agent', 'agent-global-sentinel');
    await expect(
      governanceService.proposeAsAgent(agentId, {
        paramKey: 'reservation.default_ttl_seconds',
        value: 600,
        entityType: '__global__',
      }),
    ).rejects.toThrow(/reserved/);
  });

  it('rejects a noncanonical entity scope (blank, miscased, arbitrary)', async () => {
    // A scope that is not a canonical ENTITY_TYPES value would activate an
    // entity_type that typed resolution never queries — the proposal would look
    // activated yet have no effect. Blank, wrong-case, and unknown scopes must
    // all be rejected; omitting entityType (global) stays valid.
    const agentId = createAccount(db, 'agent', 'agent-noncanonical-scope');
    for (const bad of ['', 'Agent', 'account', 'not-a-scope']) {
      await expect(
        governanceService.proposeAsAgent(agentId, {
          paramKey: 'reservation.default_ttl_seconds',
          value: 600,
          entityType: bad,
        }),
      ).rejects.toThrow(/canonical entity type/);
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

  it('does NOT activate a quorum_reached proposal past its expires_at (downtime ordering)', async () => {
    const agentId = createAccount(db, 'agent', 'agent-expired-cooldown');
    const proposalId = randomUUID();

    // A quorum_reached proposal whose cooldown has elapsed AND whose
    // expires_at has passed (scheduler was down). The hourly job runs
    // activation before expiry, so activation must refuse it (else the
    // expired proposal's config would be applied) and expiry must claim it.
    db.prepare(`
      INSERT INTO agent_governance_proposals
        (id, param_key, entity_type, proposed_value, proposer_account_id,
         proposer_weight, total_weight, required_weight, status,
         cooldown_ends_at, expires_at, created_at, updated_at)
      VALUES (?, 'reservation.default_ttl_seconds', NULL, '900', ?, 1, 2, 2,
              'quorum_reached', '2020-01-01T00:00:00Z', '2020-01-02T00:00:00Z',
              strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    `).run(proposalId, agentId);

    // Activation refuses the expired proposal — no config created.
    expect(await governanceService.activateExpiredCooldowns()).toBe(0);
    const noConfig = db.prepare(`
      SELECT 1 FROM system_config
      WHERE param_key = 'reservation.default_ttl_seconds' AND status = 'active'
    `).get();
    expect(noConfig).toBeUndefined();
    expect((await governanceService.getProposal(proposalId))!.status).toBe('quorum_reached');

    // The expiry phase then claims it.
    expect(await governanceService.expireStaleProposals()).toBe(1);
    expect((await governanceService.getProposal(proposalId))!.status).toBe('expired');
  });

  it('rejects a vote on an open proposal whose deadline has passed (no resurrection)', async () => {
    const proposerId = createAccount(db, 'agent', 'agent-vote-deadline-proposer');
    const voterId = createAccount(db, 'agent', 'agent-vote-deadline-voter');
    const proposalId = randomUUID();

    // An 'open' proposal whose expires_at is already in the past (the hourly
    // expiry phase has not run yet).
    db.prepare(`
      INSERT INTO agent_governance_proposals
        (id, param_key, entity_type, proposed_value, proposer_account_id,
         proposer_weight, total_weight, required_weight, status,
         expires_at, created_at, updated_at)
      VALUES (?, 'reservation.default_ttl_seconds', NULL, '900', ?, 1, 1, 2,
              'open', '2020-01-01T00:00:00Z',
              strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    `).run(proposalId, proposerId);

    await expect(
      governanceService.voteAsAgent(voterId, proposalId, { vote: 'support' }),
    ).rejects.toThrow(/voting deadline/);

    // Not resurrected: still open, deadline unchanged, never quorum_reached.
    const p = await governanceService.getProposal(proposalId);
    expect(p!.status).toBe('open');
    expect(p!.expiresAt).toBe('2020-01-01T00:00:00Z');
  });

  it('extends expires_at past cooldown at quorum so a long cooldown can still activate', async () => {
    const agentId = createAccount(db, 'agent', 'agent-long-cooldown');

    // Seed governance so a single proposer auto-reaches quorum, with a cooldown
    // (30d) longer than the default proposal expiry (7d).
    const seed = (key: string, value: string) =>
      db.prepare(`
        INSERT INTO system_config (id, param_key, entity_type, value_json, status, proposed_by, proposed_at, activated_at, created_at)
        VALUES (?, ?, NULL, ?, 'active', 'test', strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      `).run(randomUUID(), key, value);
    seed('governance.agent_quorum_weight', '1');
    seed('governance.agent_cooldown_seconds', String(30 * 24 * 60 * 60));
    seed('governance.agent_weight_source', '"fixed_allocation"');
    seed('governance.fixed_weight_per_agent', '1');
    seed('governance.max_weight_per_agent', '10');

    const proposal = await governanceService.proposeAsAgent(agentId, {
      paramKey: 'governance.reputation_scale_factor',
      value: 2,
    });
    expect(proposal.status).toBe('quorum_reached');

    // expires_at must now exceed cooldown_ends_at — otherwise the lifecycle
    // task's expires_at>now gate would expire the approved proposal before its
    // 30-day cooldown completes.
    const row = db.prepare(`
      SELECT cooldown_ends_at, expires_at FROM agent_governance_proposals WHERE id = ?
    `).get(proposal.id) as { cooldown_ends_at: string; expires_at: string };
    expect(Date.parse(row.expires_at)).toBeGreaterThan(Date.parse(row.cooldown_ends_at));
  });

  // ---------------------------------------------------------------------------
  // Competing proposals for one scope must resolve deterministically.
  //
  // Each activation supersedes the previously active config, so if two
  // proposals for the same (param_key, entity_type) are both approved, the
  // final active value must not depend on scan order or retry timing.
  // ---------------------------------------------------------------------------

  /** Insert a claimable (quorum_reached, cooldown elapsed, unexpired) proposal. */
  function seedClaimable(
    id: string,
    accountId: string,
    proposedValue: string,
    createdAt: string,
  ): void {
    db.prepare(`
      INSERT INTO agent_governance_proposals
        (id, param_key, entity_type, proposed_value, proposer_account_id,
         proposer_weight, total_weight, required_weight, status,
         cooldown_ends_at, expires_at, created_at, updated_at)
      VALUES (?, 'reservation.default_ttl_seconds', NULL, ?, ?, 1, 2, 2,
              'quorum_reached', '2020-01-01T00:00:00Z', '2099-01-01T00:00:00Z', ?, ?)
    `).run(id, proposedValue, accountId, createdAt, createdAt);
  }

  function activeValue(paramKey = 'reservation.default_ttl_seconds'): string | undefined {
    const row = db.prepare(`
      SELECT value_json FROM system_config WHERE param_key = ? AND status = 'active'
    `).get(paramKey) as { value_json: string } | undefined;
    return row?.value_json;
  }

  it('applies the NEWEST approved proposal last when two are activated in one sweep', async () => {
    const agentId = createAccount(db, 'agent', 'agent-order');
    // Inserted newest-first so an unordered scan would naturally apply the
    // OLDER value last and leave it active.
    seedClaimable(randomUUID(), agentId, '900', '2026-02-01T00:00:00Z');
    seedClaimable(randomUUID(), agentId, '600', '2026-01-01T00:00:00Z');

    expect(await governanceService.activateExpiredCooldowns()).toBe(2);

    expect(activeValue()).toBe('900');
  });

  it('is deterministic regardless of the order rows come back in', async () => {
    // Same scenario with the insert order reversed: the outcome must not move.
    const agentId = createAccount(db, 'agent', 'agent-order-2');
    seedClaimable(randomUUID(), agentId, '600', '2026-01-01T00:00:00Z');
    seedClaimable(randomUUID(), agentId, '900', '2026-02-01T00:00:00Z');

    await governanceService.activateExpiredCooldowns();

    expect(activeValue()).toBe('900');
  });

  it('does NOT let an older proposal retried on a later sweep overwrite a newer applied value', async () => {
    // The cross-sweep reversal: the older proposal failed once (claim released
    // back to quorum_reached) while the newer one succeeded. Retrying the older
    // one must not supersede the newer approved value.
    const agentId = createAccount(db, 'agent', 'agent-stale-retry');
    const olderId = randomUUID();
    seedClaimable(olderId, agentId, '600', '2026-01-01T00:00:00Z');
    seedClaimable(randomUUID(), agentId, '900', '2026-02-01T00:00:00Z');

    // Sweep 1 applies both in order; the newest wins.
    await governanceService.activateExpiredCooldowns();
    expect(activeValue()).toBe('900');

    // Simulate the older proposal having been released for retry.
    db.prepare(`
      UPDATE agent_governance_proposals SET status = 'quorum_reached' WHERE id = ?
    `).run(olderId);

    // Sweep 2 must close it as superseded, not re-apply it.
    expect(await governanceService.activateExpiredCooldowns()).toBe(0);
    expect(activeValue()).toBe('900');
    expect((await governanceService.getProposal(olderId))!.status).toBe('expired');
  });

  it('refuses a second in-flight proposal for a scope that is already quorum_reached', async () => {
    // Preventing the overlap at the source is what makes the reversal above
    // unreachable in normal operation.
    const agentId = createAccount(db, 'agent', 'agent-overlap');
    const seed = (key: string, value: string) =>
      db.prepare(`
        INSERT INTO system_config (id, param_key, entity_type, value_json, status, proposed_by, proposed_at, activated_at, created_at)
        VALUES (?, ?, NULL, ?, 'active', 'test', strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      `).run(randomUUID(), key, value);
    seed('governance.agent_quorum_weight', '1');
    seed('governance.agent_cooldown_seconds', '3600');
    seed('governance.agent_weight_source', '"fixed_allocation"');
    seed('governance.fixed_weight_per_agent', '1');
    seed('governance.max_weight_per_agent', '10');

    // Single proposer auto-reaches quorum.
    const first = await governanceService.proposeAsAgent(agentId, {
      paramKey: 'governance.reputation_scale_factor',
      value: 2,
    });
    expect(first.status).toBe('quorum_reached');

    await expect(
      governanceService.proposeAsAgent(agentId, {
        paramKey: 'governance.reputation_scale_factor',
        value: 3,
      }),
    ).rejects.toThrow(/Active proposal already exists/);

    // A different scope is unaffected.
    await expect(
      governanceService.proposeAsAgent(agentId, {
        paramKey: 'reservation.default_ttl_seconds',
        value: 900,
      }),
    ).resolves.toBeDefined();
  });

  // ---------------------------------------------------------------------------
  // The activation crash window.
  //
  // The claim writes the terminal status BEFORE the config exists. A thrown
  // error releases the claim; a hard crash (SIGKILL/OOM/eviction) cannot. The
  // claim marker is what makes that orphan recoverable without also
  // re-activating pre-recovery LEGACY rows.
  // ---------------------------------------------------------------------------

  /** An 'activated' proposal with no config — the shape a crash leaves behind. */
  function seedOrphan(id: string, accountId: string, claimedAt: string | null, createdAt: string): void {
    db.prepare(`
      INSERT INTO agent_governance_proposals
        (id, param_key, entity_type, proposed_value, proposer_account_id,
         proposer_weight, total_weight, required_weight, status,
         cooldown_ends_at, expires_at, activation_claimed_at, created_at, updated_at)
      VALUES (?, 'reservation.default_ttl_seconds', NULL, '900', ?, 1, 2, 2,
              'activated', '2020-01-01T00:00:00Z', '2099-01-01T00:00:00Z', ?, ?, ?)
    `).run(id, accountId, claimedAt, createdAt, createdAt);
  }

  it('stamps the claim marker on activation and clears it when the claim is released', async () => {
    const agentId = createAccount(db, 'agent', 'agent-claim-marker');
    const okId = randomUUID();
    seedClaimable(okId, agentId, '900', '2026-01-01T00:00:00Z');

    await governanceService.activateExpiredCooldowns();

    const claimed = db.prepare(
      `SELECT activation_claimed_at FROM agent_governance_proposals WHERE id = ?`,
    ).get(okId) as { activation_claimed_at: string | null };
    expect(claimed.activation_claimed_at).not.toBeNull();

    // A failing activation must release the claim AND clear the marker —
    // a released claim is retryable, not a crash orphan.
    const failId = randomUUID();
    seedClaimable(failId, agentId, '600', '2026-03-01T00:00:00Z');
    const boom = new ConstitutionalGovernanceService(db);
    vi.spyOn(boom, 'activateFromAgentGovernance').mockRejectedValue(new Error('db exploded'));
    const failing = new AgentGovernanceService(db, undefined, boom);

    await failing.activateExpiredCooldowns();

    const released = db.prepare(
      `SELECT status, activation_claimed_at FROM agent_governance_proposals WHERE id = ?`,
    ).get(failId) as { status: string; activation_claimed_at: string | null };
    expect(released.status).toBe('quorum_reached');
    expect(released.activation_claimed_at).toBeNull();
  });

  it('re-applies a claimed activation that crashed before its config was created', async () => {
    const agentId = createAccount(db, 'agent', 'agent-crash-orphan');
    const orphanId = randomUUID();
    // Claimed (marker set), terminal, no config — a hard crash mid-window.
    seedOrphan(orphanId, agentId, '2026-01-01T00:00:05Z', '2026-01-01T00:00:00Z');

    expect(activeValue()).toBeUndefined();

    const recovered = await governanceService.activateExpiredCooldowns();

    expect(recovered).toBe(1);
    expect(activeValue()).toBe('900');
    const p = await governanceService.getProposal(orphanId);
    expect(p!.status).toBe('activated');
    expect(p!.activatedConfigId).not.toBeNull();
  });

  it('recovery is idempotent — a second sweep neither re-creates nor duplicates', async () => {
    const agentId = createAccount(db, 'agent', 'agent-crash-idem');
    const orphanId = randomUUID();
    seedOrphan(orphanId, agentId, '2026-01-01T00:00:05Z', '2026-01-01T00:00:00Z');

    await governanceService.activateExpiredCooldowns();
    const firstConfig = (await governanceService.getProposal(orphanId))!.activatedConfigId;

    expect(await governanceService.activateExpiredCooldowns()).toBe(0);

    expect((await governanceService.getProposal(orphanId))!.activatedConfigId).toBe(firstConfig);
    const activeCount = db.prepare(`
      SELECT COUNT(*) AS n FROM system_config
      WHERE param_key = 'reservation.default_ttl_seconds' AND status = 'active'
    `).get() as { n: number };
    expect(activeCount.n).toBe(1);
  });

  it('does NOT re-apply a legacy activation that was never claimed', async () => {
    // The marker is the whole safety argument: an unclaimed 'activated' row
    // predates this mechanism, and re-running it would create a config that
    // supersedes whatever is active now.
    const agentId = createAccount(db, 'agent', 'agent-legacy');
    const legacyId = randomUUID();
    seedOrphan(legacyId, agentId, null, '2026-01-01T00:00:00Z');

    expect(await governanceService.activateExpiredCooldowns()).toBe(0);

    expect(activeValue()).toBeUndefined();
    const p = await governanceService.getProposal(legacyId);
    expect(p!.status).toBe('activated');
    expect(p!.activatedConfigId).toBeNull();
  });

  it('closes a crash orphan without applying when a newer proposal already activated', async () => {
    // Recovery must obey the same supersede rule as the main loop — a delayed
    // orphan must not resurrect an older value over a newer applied one.
    const agentId = createAccount(db, 'agent', 'agent-orphan-superseded');
    const orphanId = randomUUID();
    seedOrphan(orphanId, agentId, '2026-01-01T00:00:05Z', '2026-01-01T00:00:00Z');
    seedClaimable(randomUUID(), agentId, '1200', '2026-02-01T00:00:00Z');

    await governanceService.activateExpiredCooldowns();

    // The newer proposal's value is active…
    expect(activeValue()).toBe('1200');
    // …and the orphan is closed, not applied.
    const p = await governanceService.getProposal(orphanId);
    expect(p!.status).toBe('expired');
    expect(p!.activatedConfigId).toBeNull();
  });

  it('fails closed when constructed without a governance service (never activates without applying config)', async () => {
    const agentId = createAccount(db, 'agent', 'agent-no-governance');
    const proposalId = randomUUID();

    // A claimable proposal: quorum_reached, cooldown elapsed, not expired.
    db.prepare(`
      INSERT INTO agent_governance_proposals
        (id, param_key, entity_type, proposed_value, proposer_account_id,
         proposer_weight, total_weight, required_weight, status,
         cooldown_ends_at, expires_at, created_at, updated_at)
      VALUES (?, 'reservation.default_ttl_seconds', NULL, '900', ?, 1, 2, 2,
              'quorum_reached', '2020-01-01T00:00:00Z', '2099-01-01T00:00:00Z',
              strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    `).run(proposalId, agentId);

    // Service built WITHOUT the constitutional governance dependency (the
    // production-scheduler misconfiguration this guards against).
    const governanceless = new AgentGovernanceService(db);

    // Activates nothing — the proposal must stay quorum_reached (retryable),
    // never marked activated with no config behind it.
    expect(await governanceless.activateExpiredCooldowns()).toBe(0);
    expect((await governanceless.getProposal(proposalId))!.status).toBe('quorum_reached');
    const noConfig = db.prepare(`
      SELECT 1 FROM system_config
      WHERE param_key = 'reservation.default_ttl_seconds' AND status = 'active'
    `).get();
    expect(noConfig).toBeUndefined();
  });

  it('does NOT recover an activated proposal with no provenance-stamped config (legacy-safe)', async () => {
    const agentId = createAccount(db, 'agent', 'agent-orphan');
    const proposalId = randomUUID();

    // An 'activated' proposal with activated_config_id NULL and NO config
    // carrying its agentProposalId provenance. This conflates a rare
    // hard-crash-before-config orphan with a pre-recovery-mechanism legacy
    // activation, so recovery must NOT create a config here (doing so would
    // clobber a newer active config on upgrade).
    db.prepare(`
      INSERT INTO agent_governance_proposals
        (id, param_key, entity_type, proposed_value, proposer_account_id,
         proposer_weight, total_weight, required_weight, status,
         cooldown_ends_at, expires_at, created_at, updated_at)
      VALUES (?, 'reservation.default_ttl_seconds', NULL, '900', ?, 1, 2, 2,
              'activated', '2020-01-01T00:00:00Z', '2099-01-01T00:00:00Z',
              strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    `).run(proposalId, agentId);

    // Not recovered: no config created, proposal left untouched.
    expect(await governanceService.activateExpiredCooldowns()).toBe(0);
    const config = db.prepare(`
      SELECT 1 FROM system_config
      WHERE param_key = 'reservation.default_ttl_seconds' AND status = 'active'
    `).get();
    expect(config).toBeUndefined();
    const p = await governanceService.getProposal(proposalId);
    expect(p!.status).toBe('activated');
    expect(p!.activatedConfigId).toBeNull();

    // Idempotent — still nothing to recover on a second sweep.
    expect(await governanceService.activateExpiredCooldowns()).toBe(0);
  });

  it('activation is idempotent by proposal id (concurrent recovery cannot double-activate)', async () => {
    const svc = new ConstitutionalGovernanceService(db);
    const proposalId = randomUUID();
    const opts = { proposerAccountId: 'acct-x', agentProposalId: proposalId, totalWeight: 2 };

    const first = await svc.activateFromAgentGovernance('reservation.default_ttl_seconds', 750, opts);
    const second = await svc.activateFromAgentGovernance('reservation.default_ttl_seconds', 750, opts);

    // Second call is a no-op returning the SAME config — no second version
    // superseding the first.
    expect(second.id).toBe(first.id);
    const rows = db.prepare(`
      SELECT COUNT(*) as n FROM system_config WHERE param_key = 'reservation.default_ttl_seconds'
    `).get() as { n: number };
    expect(rows.n).toBe(1);
  });

  it('supersedes a pre-existing active config without a foreign-key violation', async () => {
    // Regression: superseded_by is an immediate FK to system_config(id) and
    // foreign_keys is ON. The prior code set superseded_by to the new id before
    // inserting that row, raising FOREIGN KEY constraint failed whenever a
    // param already had an active config (production seeds do).
    const svc = new ConstitutionalGovernanceService(db);
    // Seed the prior active config THROUGH the service so version allocation
    // stays consistent (a hand-inserted row would collide on the version index).
    const prior = await svc.activateFromAgentGovernance('reservation.default_ttl_seconds', 300, {
      proposerAccountId: 'acct-seed',
      agentProposalId: randomUUID(),
      totalWeight: 2,
    });

    // Second activation must supersede the prior active config — the path that
    // triggered the FK violation before the fix.
    const activated = await svc.activateFromAgentGovernance('reservation.default_ttl_seconds', 600, {
      proposerAccountId: 'acct-supersede',
      agentProposalId: randomUUID(),
      totalWeight: 2,
    });

    // New row is active; old row is superseded and points at the new one.
    expect(activated.id).not.toBe(prior.id);
    const priorRow = db.prepare(`SELECT status, superseded_by FROM system_config WHERE id = ?`).get(prior.id) as
      | { status: string; superseded_by: string | null }
      | undefined;
    expect(priorRow!.status).toBe('superseded');
    expect(priorRow!.superseded_by).toBe(activated.id);
    const activeCount = db.prepare(`
      SELECT COUNT(*) as n FROM system_config
      WHERE param_key = 'reservation.default_ttl_seconds' AND status = 'active'
    `).get() as { n: number };
    expect(activeCount.n).toBe(1);
  });

  it('recovers an activation whose config committed but activated_config_id/event did not', async () => {
    // Crash window between activateFromAgentGovernance's commit and the
    // link+event transaction: proposal is 'activated' with a real config
    // (provenance metadata present) but activated_config_id is NULL. The
    // metadata-based predicate used to exclude this row; it must now be
    // recovered and linked.
    const agentId = createAccount(db, 'agent', 'agent-link-orphan');
    const proposalId = randomUUID();
    const configId = randomUUID();

    db.prepare(`
      INSERT INTO agent_governance_proposals
        (id, param_key, entity_type, proposed_value, proposer_account_id,
         proposer_weight, total_weight, required_weight, status,
         cooldown_ends_at, expires_at, activated_config_id, created_at, updated_at)
      VALUES (?, 'reservation.default_ttl_seconds', NULL, '900', ?, 1, 2, 2,
              'activated', '2020-01-01T00:00:00Z', '2099-01-01T00:00:00Z', NULL,
              strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    `).run(proposalId, agentId);
    // Config already committed with this proposal's provenance.
    db.prepare(`
      INSERT INTO system_config
        (id, param_key, entity_type, value_json, config_version, status, proposed_by, activated_at, metadata, created_at)
      VALUES (?, 'reservation.default_ttl_seconds', NULL, '900', 1, 'active', 'agent-governance:acct',
              strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    `).run(configId, JSON.stringify({ source: 'agent-governance', agentProposalId: proposalId, totalWeight: 2 }));

    expect(await governanceService.activateExpiredCooldowns()).toBe(1);

    // Link is now completed to the already-committed config; no duplicate row.
    expect((await governanceService.getProposal(proposalId))!.activatedConfigId).toBe(configId);
    const rows = db.prepare(`
      SELECT COUNT(*) as n FROM system_config WHERE param_key = 'reservation.default_ttl_seconds' AND status = 'active'
    `).get() as { n: number };
    expect(rows.n).toBe(1);
  });

  it('keeps the claim when the config committed but linking threw (does not expire a live config)', async () => {
    // The other half of the crash window, and the dangerous one:
    // activateFromAgentGovernance COMMITS, then the link+event transaction
    // throws. Releasing the claim here clears the only marker that the change
    // went live; the retry re-enters the claim, which gates on
    // `expires_at > now`, so after downtime past the deadline the proposal is
    // closed 'expired' while its config is active and unlinked forever.
    const agentId = createAccount(db, 'agent', 'agent-link-throw');
    const proposalId = randomUUID();
    seedClaimable(proposalId, agentId, '900', '2026-01-01T00:00:00Z');

    const gov = new ConstitutionalGovernanceService(db);
    const svc = new AgentGovernanceService(db, undefined, gov);
    // Fail strictly AFTER the config commits — the link transaction only.
    const emitSpy = vi
      .spyOn(svc as unknown as { emitEventInTx: (...a: unknown[]) => void }, 'emitEventInTx')
      .mockImplementation(() => { throw new Error('link tx exploded'); });

    await svc.activateExpiredCooldowns();

    // The config IS live, so the claim must be retained, not released.
    expect(activeValue()).toBe('900');
    const afterThrow = db.prepare(
      `SELECT status, activation_claimed_at, activated_config_id
         FROM agent_governance_proposals WHERE id = ?`,
    ).get(proposalId) as { status: string; activation_claimed_at: string | null; activated_config_id: string | null };
    expect(afterThrow.status).toBe('activated');
    expect(afterThrow.activation_claimed_at).not.toBeNull();
    expect(afterThrow.activated_config_id).toBeNull();

    // Now simulate the downtime that made this lossy: the retry happens after
    // the proposal's deadline. Expiry must not claim an already-applied row...
    db.prepare(
      `UPDATE agent_governance_proposals SET expires_at = '2020-01-01T00:00:00Z' WHERE id = ?`,
    ).run(proposalId);
    expect(await governanceService.expireStaleProposals()).toBe(0);

    // ...and the next healthy sweep completes the link instead.
    emitSpy.mockRestore();
    expect(await governanceService.activateExpiredCooldowns()).toBe(1);

    const healed = await governanceService.getProposal(proposalId);
    expect(healed!.status).toBe('activated');
    expect(healed!.activatedConfigId).not.toBeNull();
    const activeRows = db.prepare(`
      SELECT COUNT(*) as n FROM system_config
      WHERE param_key = 'reservation.default_ttl_seconds' AND status = 'active'
    `).get() as { n: number };
    expect(activeRows.n).toBe(1);
  });
});

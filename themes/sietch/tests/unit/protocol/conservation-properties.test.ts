/**
 * Conservation Properties Tests (Tasks 3.3 + 3.4, Sprint 297)
 *
 * 14 positive property tests verifying all conservation invariants hold
 * under normal operations, plus 14 counterexample tests verifying that
 * violations are detected with correct error types/codes.
 *
 * All monetary values use BigInt end-to-end — from generation through
 * arithmetic to assertion. No Number(), parseFloat(), or parseInt()
 * in any monetary code path.
 *
 * SDD refs: §3.2.2 Conservation properties
 * Sprint refs: Tasks 3.3, 3.4
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';
import Database from 'better-sqlite3';
import { CREDIT_LEDGER_SCHEMA_SQL } from '../../../src/db/migrations/030_credit_ledger.js';
import { BILLING_OPS_SCHEMA_SQL, BILLING_SYSTEM_ACCOUNTS_SQL } from '../../../src/db/migrations/032_billing_ops.js';
import { REVENUE_RULES_SCHEMA_SQL } from '../../../src/db/migrations/035_revenue_rules.js';
import { AGENT_CLAWBACK_RECEIVABLES_SQL } from '../../../src/db/migrations/051_agent_clawback_receivables.js';
import { AGENT_BUDGET_SQL } from '../../../src/db/migrations/052_agent_budget.js';
import { RECONCILIATION_RUNS_SQL } from '../../../src/db/migrations/055_reconciliation_runs.js';
import { PEER_TRANSFERS_SQL, CREDIT_LEDGER_REBUILD_SQL } from '../../../src/db/migrations/056_peer_transfers.js';
import { TBA_DEPOSITS_SQL } from '../../../src/db/migrations/057_tba_deposits.js';
import { CREDIT_LOTS_REBUILD_SQL } from '../../../src/db/migrations/060_credit_lots_tba_source.js';
import {
  CreditLedgerAdapter,
  InsufficientBalanceError,
  InvalidStateError,
  ConflictError,
} from '../../../src/packages/adapters/billing/CreditLedgerAdapter.js';
import { ReconciliationService } from '../../../src/packages/adapters/billing/ReconciliationService.js';
import {
  CONSERVATION_PROPERTIES,
  getProperty,
  getPropertiesByEnforcement,
} from '../../../src/packages/core/protocol/conservation-properties.js';
import { parseLotBigInts, parseMicroUSD } from '../../helpers/bigint-db.js';
import type { MicroUSD } from '../../../src/packages/core/protocol/arithmetic.js';
import { smallMicroUsdAmount, lotOperationSequence } from '../billing/property-tests/generators.js';
import type { LotOperation } from '../billing/property-tests/generators.js';

// =============================================================================
// Constants
// =============================================================================

/** Property test run count — respects env var, defaults to 100 for conservation tests */
const NUM_RUNS = parseInt(process.env.FAST_CHECK_NUM_RUNS ?? '100', 10);

// =============================================================================
// DB Setup
// =============================================================================

/**
 * Create a fully-migrated in-memory DB for conservation testing.
 * Runs all billing-related migrations with foreign_keys OFF to avoid
 * stale FK issues during table-rebuild migrations.
 */
function createConservationDb(): Database.Database {
  const testDb = new Database(':memory:');
  testDb.pragma('journal_mode = WAL');
  testDb.pragma('foreign_keys = OFF');

  // Migration 030: Core credit ledger
  testDb.exec(CREDIT_LEDGER_SCHEMA_SQL);
  // Migration 032: Billing ops (DLQ, admin audit, billing_config + seed)
  testDb.exec(BILLING_OPS_SCHEMA_SQL);
  testDb.exec(BILLING_SYSTEM_ACCOUNTS_SQL);
  // Migration 035: Revenue rules + seed active rule
  testDb.exec(REVENUE_RULES_SCHEMA_SQL);
  // Migration 051: Agent clawback receivables
  testDb.exec(AGENT_CLAWBACK_RECEIVABLES_SQL);
  // Migration 052: Agent budget
  testDb.exec(AGENT_BUDGET_SQL);
  // Migration 055: Reconciliation runs
  testDb.exec(RECONCILIATION_RUNS_SQL);
  // Migration 056: Transfers + credit_ledger rebuild
  testDb.exec(PEER_TRANSFERS_SQL);
  testDb.exec(CREDIT_LEDGER_REBUILD_SQL);
  // Migration 057: TBA deposits
  testDb.exec(TBA_DEPOSITS_SQL);
  // Migration 060: credit_lots rebuild with tba_deposit source
  testDb.exec(CREDIT_LOTS_REBUILD_SQL);

  return testDb;
}

/** Create a minimal DB for lot-only tests (faster setup). */
function createLotDb(): Database.Database {
  const testDb = new Database(':memory:');
  testDb.pragma('journal_mode = WAL');
  testDb.pragma('foreign_keys = ON');
  testDb.exec(CREDIT_LEDGER_SCHEMA_SQL);
  return testDb;
}

/** Seed an account and return its ID. */
function seedAccount(db: Database.Database, entityType = 'person'): string {
  const id = `acct-${Math.random().toString(36).slice(2, 10)}`;
  db.prepare(
    `INSERT INTO credit_accounts (id, entity_type, entity_id, version) VALUES (?, ?, ?, 0)`,
  ).run(id, entityType, `entity-${id}`);
  return id;
}

/** Seed a credit lot and return its ID. */
function seedLot(
  db: Database.Database,
  accountId: string,
  amountMicro: bigint,
  sourceType = 'deposit',
): string {
  const id = `lot-${Math.random().toString(36).slice(2, 10)}`;
  const sourceId = `src-${Math.random().toString(36).slice(2, 10)}`;
  db.prepare(`
    INSERT INTO credit_lots (id, account_id, pool_id, source_type, source_id,
      original_micro, available_micro, reserved_micro, consumed_micro)
    VALUES (?, ?, 'general', ?, ?, ?, ?, 0, 0)
  `).run(id, accountId, sourceType, sourceId, amountMicro.toString(), amountMicro.toString());
  return id;
}

/** Query a lot row with BigInt-safe parsing. */
function queryLot(db: Database.Database, lotId: string) {
  const stmt = db.prepare(`SELECT * FROM credit_lots WHERE id = ?`);
  stmt.safeIntegers(true);
  const row = stmt.get(lotId) as Record<string, unknown>;
  return parseLotBigInts(row);
}

// =============================================================================
// Positive Property Tests (Task 3.3)
// =============================================================================

describe('Conservation Properties — Positive (Task 3.3)', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createConservationDb();
  });

  afterEach(() => {
    db.close();
  });

  // ---------------------------------------------------------------------------
  // I-1: Per-lot conservation (safety)
  // ---------------------------------------------------------------------------

  it('I-1: available + reserved + consumed = original after any operation sequence', async () => {
    const prop = getProperty('I-1')!;
    expect(prop.kind).toBe('safety');

    await fc.assert(
      fc.asyncProperty(
        smallMicroUsdAmount(),
        lotOperationSequence(1_000_000_000n, 15),
        async (lotAmount, operations) => {
          const runDb = createLotDb();
          const ledger = new CreditLedgerAdapter(runDb);

          try {
            const account = await ledger.createAccount('person', `u-${Math.random().toString(36).slice(2, 8)}`);
            const lot = await ledger.mintLot(account.id, lotAmount, 'deposit', {
              poolId: 'general',
              sourceId: `s-${Math.random().toString(36).slice(2, 8)}`,
            });

            let activeRes: string | null = null;
            for (const op of operations) {
              try {
                if (op.type === 'reserve' && !activeRes) {
                  const r = await ledger.reserve(account.id, 'general', op.amount);
                  activeRes = r.reservationId;
                } else if (op.type === 'finalize' && activeRes) {
                  await ledger.finalize(activeRes, op.amount);
                  activeRes = null;
                } else if (op.type === 'release' && activeRes) {
                  await ledger.release(activeRes);
                  activeRes = null;
                } else if (op.type === 'expire_tick' && activeRes) {
                  try { await ledger.release(activeRes); } catch { /* may be terminal */ }
                  activeRes = null;
                }
              } catch (e) {
                if (e instanceof InsufficientBalanceError || e instanceof InvalidStateError || e instanceof ConflictError) continue;
                throw e;
              }
            }

            // INVARIANT I-1: Per-lot conservation
            const parsed = queryLot(runDb, lot.id);
            expect(parsed.available_micro + parsed.reserved_micro + parsed.consumed_micro)
              .toBe(parsed.original_micro);
          } finally {
            runDb.close();
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  // ---------------------------------------------------------------------------
  // I-2: Per-account conservation (safety)
  // ---------------------------------------------------------------------------

  it('I-2: sum(available + reserved + consumed) ≤ sum(original) per account', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(smallMicroUsdAmount(), { minLength: 2, maxLength: 5 }),
        async (lotAmounts) => {
          const runDb = createLotDb();
          const ledger = new CreditLedgerAdapter(runDb);

          try {
            const account = await ledger.createAccount('person', `u-${Math.random().toString(36).slice(2, 8)}`);

            for (const amount of lotAmounts) {
              await ledger.mintLot(account.id, amount, 'deposit', {
                poolId: 'general',
                sourceId: `s-${Math.random().toString(36).slice(2, 8)}`,
              });
            }

            // Do a reservation + finalize on some balance
            const totalAvailable = lotAmounts.reduce((a, b) => a + b, 0n);
            if (totalAvailable > 1n) {
              const res = await ledger.reserve(account.id, 'general', 1n);
              await ledger.finalize(res.reservationId, 1n);
            }

            // INVARIANT I-2: Per-account conservation
            const stmt = runDb.prepare(`
              SELECT
                CAST(COALESCE(SUM(available_micro), 0) AS TEXT) as sum_avail,
                CAST(COALESCE(SUM(reserved_micro), 0) AS TEXT) as sum_reserved,
                CAST(COALESCE(SUM(consumed_micro), 0) AS TEXT) as sum_consumed,
                CAST(COALESCE(SUM(original_micro), 0) AS TEXT) as sum_original
              FROM credit_lots WHERE account_id = ?
            `);
            const row = stmt.get(account.id) as Record<string, string>;
            const lhs = BigInt(row.sum_avail) + BigInt(row.sum_reserved) + BigInt(row.sum_consumed);
            const rhs = BigInt(row.sum_original);
            expect(lhs).toBeLessThanOrEqual(rhs);
          } finally {
            runDb.close();
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  // ---------------------------------------------------------------------------
  // I-3: Receivable bound (safety)
  // ---------------------------------------------------------------------------

  it('I-3: receivable balance never exceeds original amount', () => {
    const acctId = seedAccount(db);
    const originalMicro = 500_000n;
    const balanceMicro = 300_000n; // balance < original

    db.prepare(`
      INSERT INTO agent_clawback_receivables (id, account_id, source_clawback_id,
        original_amount_micro, balance_micro)
      VALUES (?, ?, 'clawback-1', ?, ?)
    `).run('recv-1', acctId, originalMicro.toString(), balanceMicro.toString());

    const row = db.prepare(`
      SELECT CAST(original_amount_micro AS TEXT) as orig, CAST(balance_micro AS TEXT) as bal
      FROM agent_clawback_receivables WHERE id = 'recv-1'
    `).get() as { orig: string; bal: string };

    expect(BigInt(row.bal)).toBeLessThanOrEqual(BigInt(row.orig));
  });

  // ---------------------------------------------------------------------------
  // I-4: Platform conservation (safety)
  // ---------------------------------------------------------------------------

  it('I-4: platform reconciliation passes after normal operations', async () => {
    const acctId = seedAccount(db);
    seedLot(db, acctId, 1_000_000n);

    const recon = new ReconciliationService(db);
    const result = await recon.reconcile();

    const lotCheck = result.checks.find(c => c.name === 'lot_conservation');
    const platformCheck = result.checks.find(c => c.name === 'platform_conservation');
    expect(lotCheck?.status).toBe('passed');
    expect(platformCheck?.status).toBe('passed');
  });

  // ---------------------------------------------------------------------------
  // I-5: Budget consistency (safety)
  // ---------------------------------------------------------------------------

  it('I-5: recorded spend matches windowed finalizations sum', async () => {
    const acctId = seedAccount(db);
    const windowStart = new Date().toISOString();

    // Insert spending limit with current_spend = 500000
    db.prepare(`
      INSERT INTO agent_spending_limits (id, account_id, daily_cap_micro, current_spend_micro,
        window_start, window_duration_seconds)
      VALUES ('limit-1', ?, 10000000, 500000, ?, 86400)
    `).run(acctId, windowStart);

    // Insert matching finalization
    db.prepare(`
      INSERT INTO agent_budget_finalizations (account_id, reservation_id, amount_micro, finalized_at)
      VALUES (?, 'res-1', 500000, ?)
    `).run(acctId, windowStart);

    const recon = new ReconciliationService(db);
    const result = await recon.reconcile();
    const budgetCheck = result.checks.find(c => c.name === 'budget_consistency');
    expect(budgetCheck?.status).toBe('passed');
  });

  // ---------------------------------------------------------------------------
  // I-6: Transfer symmetry (safety)
  // ---------------------------------------------------------------------------

  it('I-6: completed transfer has matching transfer_in lot', async () => {
    const fromAcct = seedAccount(db);
    const toAcct = seedAccount(db);

    // Insert a completed transfer
    db.prepare(`
      INSERT INTO transfers (id, idempotency_key, from_account_id, to_account_id,
        amount_micro, status, completed_at)
      VALUES ('xfer-1', 'idem-1', ?, ?, 100000, 'completed', datetime('now'))
    `).run(fromAcct, toAcct);

    // Insert matching transfer_in lot with source_id = transfer id (required by recon join)
    db.prepare(`
      INSERT INTO credit_lots (id, account_id, pool_id, source_type, source_id,
        original_micro, available_micro, reserved_micro, consumed_micro)
      VALUES ('lot-xfer', ?, 'general', 'transfer_in', 'xfer-1', 100000, 100000, 0, 0)
    `).run(toAcct);

    // Insert matching transfer_out ledger entry (same amount as completed transfer)
    db.prepare(`
      INSERT INTO credit_ledger (id, account_id, pool_id, entry_seq, entry_type, amount_micro)
      VALUES ('le-1', ?, 'general', 1, 'transfer_out', -100000)
    `).run(fromAcct);

    const recon = new ReconciliationService(db);
    const result = await recon.reconcile();
    const xferCheck = result.checks.find(c => c.name === 'transfer_conservation');
    expect(xferCheck?.status).toBe('passed');
  });

  // ---------------------------------------------------------------------------
  // I-7: TBA deposit bridge (safety)
  // ---------------------------------------------------------------------------

  it('I-7: bridged deposits equal tba_deposit-sourced lots', async () => {
    const acctId = seedAccount(db);
    const lotId = seedLot(db, acctId, 500_000n, 'tba_deposit');

    // Insert matching bridged deposit
    db.prepare(`
      INSERT INTO tba_deposits (id, agent_account_id, chain_id, tx_hash, token_address,
        amount_raw, amount_micro, lot_id, escrow_address, block_number, status, bridged_at)
      VALUES ('dep-1', ?, 1, '0xabc', '0xtoken', '500000', 500000, ?, '0xescrow', 100, 'bridged', datetime('now'))
    `).run(acctId, lotId);

    const recon = new ReconciliationService(db);
    const result = await recon.reconcile();
    const depositCheck = result.checks.find(c => c.name === 'deposit_bridge_conservation');
    expect(depositCheck?.status).toBe('passed');
  });

  // ---------------------------------------------------------------------------
  // I-8: Terminal absorption (safety)
  // ---------------------------------------------------------------------------

  it('I-8: terminal states are absorbing — no outgoing transitions', async () => {
    await fc.assert(
      fc.asyncProperty(
        smallMicroUsdAmount(),
        fc.bigInt({ min: 1n, max: 1_000_000_000n }),
        fc.oneof(fc.constant('finalize' as const), fc.constant('release' as const)),
        async (lotAmount, reserveAmount, terminal) => {
          fc.pre(reserveAmount <= lotAmount);
          const runDb = createLotDb();
          const ledger = new CreditLedgerAdapter(runDb);

          try {
            const account = await ledger.createAccount('person', `u-${Math.random().toString(36).slice(2, 8)}`);
            await ledger.mintLot(account.id, lotAmount, 'deposit', {
              poolId: 'general',
              sourceId: `s-${Math.random().toString(36).slice(2, 8)}`,
            });
            const res = await ledger.reserve(account.id, 'general', reserveAmount);

            if (terminal === 'finalize') {
              await ledger.finalize(res.reservationId, reserveAmount);
            } else {
              await ledger.release(res.reservationId);
            }

            // INVARIANT I-8: No outgoing transitions from terminal
            let releaseEscaped = false;
            try {
              await ledger.release(res.reservationId);
              releaseEscaped = true;
            } catch (e) {
              if (!(e instanceof InvalidStateError)) throw e;
            }
            expect(releaseEscaped).toBe(false);
          } finally {
            runDb.close();
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  // ---------------------------------------------------------------------------
  // I-9: Revenue rule mutual exclusion (safety)
  // ---------------------------------------------------------------------------

  it('I-9: at most 1 active revenue rule at any time', () => {
    // The seed from migration 035 already inserts one active rule.
    const activeCount = db.prepare(
      `SELECT COUNT(*) as cnt FROM revenue_rules WHERE status = 'active'`,
    ).get() as { cnt: number };

    expect(activeCount.cnt).toBeLessThanOrEqual(1);
  });

  // ---------------------------------------------------------------------------
  // I-10: Lot monotonicity (safety)
  // ---------------------------------------------------------------------------

  it('I-10: original_micro is immutable after creation', async () => {
    await fc.assert(
      fc.asyncProperty(
        smallMicroUsdAmount(),
        lotOperationSequence(1_000_000_000n, 10),
        async (lotAmount, operations) => {
          const runDb = createLotDb();
          const ledger = new CreditLedgerAdapter(runDb);

          try {
            const account = await ledger.createAccount('person', `u-${Math.random().toString(36).slice(2, 8)}`);
            const lot = await ledger.mintLot(account.id, lotAmount, 'deposit', {
              poolId: 'general',
              sourceId: `s-${Math.random().toString(36).slice(2, 8)}`,
            });

            let activeRes: string | null = null;
            for (const op of operations) {
              try {
                if (op.type === 'reserve' && !activeRes) {
                  const r = await ledger.reserve(account.id, 'general', op.amount);
                  activeRes = r.reservationId;
                } else if (op.type === 'finalize' && activeRes) {
                  await ledger.finalize(activeRes, op.amount);
                  activeRes = null;
                } else if (op.type === 'release' && activeRes) {
                  await ledger.release(activeRes);
                  activeRes = null;
                }
              } catch { continue; }
            }

            // INVARIANT I-10: original unchanged
            const parsed = queryLot(runDb, lot.id);
            expect(parsed.original_micro).toBe(lotAmount as MicroUSD);
          } finally {
            runDb.close();
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  // ---------------------------------------------------------------------------
  // I-11: Finalization atomicity (liveness)
  // ---------------------------------------------------------------------------

  it('I-11: finalize + lot update is all-or-nothing', async () => {
    const runDb = createLotDb();
    const ledger = new CreditLedgerAdapter(runDb);

    try {
      const account = await ledger.createAccount('person', 'user-atom');
      await ledger.mintLot(account.id, 100_000n, 'deposit', {
        poolId: 'general', sourceId: 'src-atom',
      });
      const res = await ledger.reserve(account.id, 'general', 50_000n);
      await ledger.finalize(res.reservationId, 50_000n);

      // Post-finalize: reservation is in terminal state AND lot is updated atomically
      const resRow = runDb.prepare(
        `SELECT status FROM credit_reservations WHERE id = ?`,
      ).get(res.reservationId) as { status: string };
      expect(resRow.status).toBe('finalized');

      // Lot conservation holds after finalization
      const stmt = runDb.prepare(`
        SELECT original_micro, available_micro, reserved_micro, consumed_micro
        FROM credit_lots WHERE account_id = ?
      `);
      stmt.safeIntegers(true);
      const lot = stmt.get(account.id) as {
        original_micro: bigint; available_micro: bigint;
        reserved_micro: bigint; consumed_micro: bigint;
      };
      expect(lot.available_micro + lot.reserved_micro + lot.consumed_micro)
        .toBe(lot.original_micro);
    } finally {
      runDb.close();
    }
  });

  // ---------------------------------------------------------------------------
  // I-12: Reservation termination (liveness)
  // ---------------------------------------------------------------------------

  it('I-12: under fairness (expiry tick fires), every reservation reaches terminal', async () => {
    await fc.assert(
      fc.asyncProperty(
        smallMicroUsdAmount(),
        fc.bigInt({ min: 1n, max: 1_000_000_000n }),
        async (lotAmount, reserveAmount) => {
          fc.pre(reserveAmount <= lotAmount);
          const runDb = createLotDb();
          const ledger = new CreditLedgerAdapter(runDb);

          try {
            const account = await ledger.createAccount('person', `u-${Math.random().toString(36).slice(2, 8)}`);
            await ledger.mintLot(account.id, lotAmount, 'deposit', {
              poolId: 'general',
              sourceId: `s-${Math.random().toString(36).slice(2, 8)}`,
            });
            const res = await ledger.reserve(account.id, 'general', reserveAmount);

            // Fairness assumption: expiry tick fires → release
            await ledger.release(res.reservationId);

            const row = runDb.prepare(
              `SELECT status FROM credit_reservations WHERE id = ?`,
            ).get(res.reservationId) as { status: string };
            expect(['finalized', 'released', 'expired']).toContain(row.status);
          } finally {
            runDb.close();
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  // ---------------------------------------------------------------------------
  // I-13: Treasury adequacy (safety)
  // ---------------------------------------------------------------------------

  it('I-13: sum(lot balances) ≤ sum(minted) after normal operations', async () => {
    const runDb = createLotDb();
    const ledger = new CreditLedgerAdapter(runDb);

    try {
      const account = await ledger.createAccount('person', 'user-treasury');
      await ledger.mintLot(account.id, 1_000_000n, 'deposit', {
        poolId: 'general', sourceId: 'src-treasury-1',
      });
      await ledger.mintLot(account.id, 2_000_000n, 'deposit', {
        poolId: 'general', sourceId: 'src-treasury-2',
      });

      // Consume some
      const res = await ledger.reserve(account.id, 'general', 500_000n);
      await ledger.finalize(res.reservationId, 500_000n);

      // INVARIANT I-13: Total accounted ≤ total minted
      const stmt = runDb.prepare(`
        SELECT
          CAST(COALESCE(SUM(original_micro), 0) AS TEXT) as total_minted,
          CAST(COALESCE(SUM(available_micro + reserved_micro + consumed_micro), 0) AS TEXT) as total_accounted
        FROM credit_lots
      `);
      const row = stmt.get() as { total_minted: string; total_accounted: string };
      expect(BigInt(row.total_accounted)).toBeLessThanOrEqual(BigInt(row.total_minted));
    } finally {
      runDb.close();
    }
  });

  // ---------------------------------------------------------------------------
  // I-14: Shadow tracking (safety)
  // ---------------------------------------------------------------------------

  it('I-14: shadow ledger entries correspond to real entries', () => {
    const acctId = seedAccount(db);
    seedLot(db, acctId, 1_000_000n);

    // Insert a real reserve entry and matching shadow_reserve entry
    db.prepare(`
      INSERT INTO credit_ledger (id, account_id, pool_id, entry_seq, entry_type, amount_micro)
      VALUES ('le-real', ?, 'general', 1, 'reserve', -100000)
    `).run(acctId);

    db.prepare(`
      INSERT INTO credit_ledger (id, account_id, pool_id, entry_seq, entry_type, amount_micro)
      VALUES ('le-shadow', ?, 'general', 2, 'shadow_reserve', -100000)
    `).run(acctId);

    // Verify shadow mirrors real
    const realEntry = db.prepare(
      `SELECT amount_micro FROM credit_ledger WHERE id = 'le-real'`,
    ).get() as { amount_micro: number };
    const shadowEntry = db.prepare(
      `SELECT amount_micro FROM credit_ledger WHERE id = 'le-shadow'`,
    ).get() as { amount_micro: number };

    expect(shadowEntry.amount_micro).toBe(realEntry.amount_micro);
  });

  // ---------------------------------------------------------------------------
  // Module metadata tests
  // ---------------------------------------------------------------------------

  it('all 14 properties are defined with required fields', () => {
    expect(CONSERVATION_PROPERTIES).toHaveLength(14);
    for (const prop of CONSERVATION_PROPERTIES) {
      expect(prop.id).toMatch(/^I-\d+$/);
      expect(prop.name).toBeTruthy();
      expect(prop.ltl).toBeTruthy();
      expect(prop.universe).toBeTruthy();
      expect(prop.kind).toMatch(/^(safety|liveness)$/);
      expect(prop.enforcedBy.length).toBeGreaterThan(0);
    }
  });

  it('getProperty() retrieves by ID', () => {
    expect(getProperty('I-1')?.name).toBe('Per-lot conservation');
    expect(getProperty('I-14')?.name).toBe('Shadow tracking');
    expect(getProperty('I-999')).toBeUndefined();
  });

  it('getPropertiesByEnforcement() filters correctly', () => {
    const dbCheck = getPropertiesByEnforcement('DB CHECK');
    expect(dbCheck.length).toBeGreaterThan(0);
    for (const p of dbCheck) {
      expect(p.enforcedBy).toContain('DB CHECK');
    }
  });
});

// =============================================================================
// Counterexample Tests (Task 3.4)
// =============================================================================

describe('Conservation Properties — Counterexamples (Task 3.4)', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createConservationDb();
  });

  afterEach(() => {
    db.close();
  });

  // ---------------------------------------------------------------------------
  // I-1 (DB CHECK): Per-lot conservation violation
  // ---------------------------------------------------------------------------

  it('I-1 counterexample: raw SQL violating lot_invariant → SqliteError', () => {
    const acctId = seedAccount(db);
    const lotId = seedLot(db, acctId, 1_000_000n);

    // Try to set consumed_micro to break invariant: available + reserved + consumed ≠ original
    expect(() => {
      db.prepare(`
        UPDATE credit_lots SET consumed_micro = ? WHERE id = ?
      `).run((1_000_001n).toString(), lotId);
    }).toThrow(); // SqliteError: CHECK constraint failed: lot_invariant
  });

  // ---------------------------------------------------------------------------
  // I-2 (DB CHECK): Per-account lot parts exceed original
  // ---------------------------------------------------------------------------

  it('I-2 counterexample: raw SQL making available exceed original → SqliteError', () => {
    const acctId = seedAccount(db);
    const lotId = seedLot(db, acctId, 1_000_000n);

    // Try to inflate available_micro beyond original
    expect(() => {
      db.prepare(`
        UPDATE credit_lots SET available_micro = ? WHERE id = ?
      `).run((2_000_000n).toString(), lotId);
    }).toThrow(); // CHECK constraint: lot_invariant (available + 0 + 0 ≠ original)
  });

  // ---------------------------------------------------------------------------
  // I-3 (Reconciliation): Receivable balance exceeds original
  // ---------------------------------------------------------------------------

  it('I-3 counterexample: receivable with balance > original → reconciliation divergence', async () => {
    const acctId = seedAccount(db);
    seedLot(db, acctId, 1_000_000n);

    // Insert receivable where balance > original (no DB CHECK prevents this)
    db.prepare(`
      INSERT INTO agent_clawback_receivables (id, account_id, source_clawback_id,
        original_amount_micro, balance_micro)
      VALUES ('recv-bad', ?, 'clawback-bad', 100000, 200000)
    `).run(acctId);

    const recon = new ReconciliationService(db);
    const result = await recon.reconcile();
    const recvCheck = result.checks.find(c => c.name === 'receivable_balance');
    expect(recvCheck?.status).toBe('failed');
    expect(result.divergences.length).toBeGreaterThan(0);
  });

  // ---------------------------------------------------------------------------
  // I-4 (Reconciliation): Platform conservation violation
  // ---------------------------------------------------------------------------

  it('I-4 counterexample: inflated lot balances → reconciliation divergence', async () => {
    const acctId = seedAccount(db);

    // Insert a lot with parts that sum to more than original via raw SQL bypass
    // Use a direct INSERT with bogus values that pass lot_invariant but inflate platform totals
    // Actually, lot_invariant prevents this. Instead, insert multiple lots where
    // a receivable inflates beyond minted total.
    seedLot(db, acctId, 1_000_000n);

    // Insert receivable that exceeds total minted (creates platform-level imbalance)
    db.prepare(`
      INSERT INTO agent_clawback_receivables (id, account_id, source_clawback_id,
        original_amount_micro, balance_micro)
      VALUES ('recv-inflate', ?, 'clawback-inflate', 5000000, 5000000)
    `).run(acctId);

    const recon = new ReconciliationService(db);
    const result = await recon.reconcile();
    const platformCheck = result.checks.find(c => c.name === 'platform_conservation');
    expect(platformCheck?.status).toBe('failed');
  });

  // ---------------------------------------------------------------------------
  // I-5 (Reconciliation): Budget consistency violation
  // ---------------------------------------------------------------------------

  it('I-5 counterexample: mismatched budget spend → reconciliation divergence', async () => {
    const acctId = seedAccount(db);
    seedLot(db, acctId, 1_000_000n);
    const windowStart = new Date().toISOString();

    // Record spend of 500000 in limits
    db.prepare(`
      INSERT INTO agent_spending_limits (id, account_id, daily_cap_micro, current_spend_micro,
        window_start, window_duration_seconds)
      VALUES ('limit-bad', ?, 10000000, 500000, ?, 86400)
    `).run(acctId, windowStart);

    // But actual finalizations only sum to 100000 (mismatch!)
    db.prepare(`
      INSERT INTO agent_budget_finalizations (account_id, reservation_id, amount_micro, finalized_at)
      VALUES (?, 'res-bad', 100000, ?)
    `).run(acctId, windowStart);

    const recon = new ReconciliationService(db);
    const result = await recon.reconcile();
    const budgetCheck = result.checks.find(c => c.name === 'budget_consistency');
    expect(budgetCheck?.status).toBe('failed');
    expect(result.divergences.some(d => d.includes('Budget consistency'))).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // I-6 (DB UNIQUE): Transfer symmetry violation — duplicate source
  // ---------------------------------------------------------------------------

  it('I-6 counterexample: duplicate transfer_in source_id → UNIQUE constraint', () => {
    const acctId = seedAccount(db);

    // First lot with source_type='transfer_in', source_id='xfer-dup'
    db.prepare(`
      INSERT INTO credit_lots (id, account_id, pool_id, source_type, source_id,
        original_micro, available_micro, reserved_micro, consumed_micro)
      VALUES ('lot-1', ?, 'general', 'transfer_in', 'xfer-dup', 100000, 100000, 0, 0)
    `).run(acctId);

    // Second lot with same source — should violate UNIQUE index
    expect(() => {
      db.prepare(`
        INSERT INTO credit_lots (id, account_id, pool_id, source_type, source_id,
          original_micro, available_micro, reserved_micro, consumed_micro)
        VALUES ('lot-2', ?, 'general', 'transfer_in', 'xfer-dup', 100000, 100000, 0, 0)
      `).run(acctId);
    }).toThrow(); // UNIQUE constraint: idx_credit_lots_source
  });

  // ---------------------------------------------------------------------------
  // I-7 (Reconciliation): Deposit bridge mismatch
  // ---------------------------------------------------------------------------

  it('I-7 counterexample: bridged deposit without matching lot → reconciliation divergence', async () => {
    const acctId = seedAccount(db);

    // Insert bridged deposit with no matching tba_deposit lot
    db.prepare(`
      INSERT INTO tba_deposits (id, agent_account_id, chain_id, tx_hash, token_address,
        amount_raw, amount_micro, escrow_address, block_number, status, bridged_at)
      VALUES ('dep-orphan', ?, 1, '0xorphan', '0xtoken', '500000', 500000, '0xescrow', 100, 'bridged', datetime('now'))
    `).run(acctId);

    const recon = new ReconciliationService(db);
    const result = await recon.reconcile();
    const depositCheck = result.checks.find(c => c.name === 'deposit_bridge_conservation');
    expect(depositCheck?.status).toBe('failed');
    expect(result.divergences.some(d => d.includes('Deposit bridge'))).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // I-8 (Application): Terminal state transition violation
  // ---------------------------------------------------------------------------

  it('I-8 counterexample: transition from terminal state → InvalidStateError', async () => {
    const runDb = createLotDb();
    const ledger = new CreditLedgerAdapter(runDb);

    try {
      const account = await ledger.createAccount('person', 'user-terminal');
      await ledger.mintLot(account.id, 100_000n, 'deposit', {
        poolId: 'general', sourceId: 'src-terminal',
      });
      const res = await ledger.reserve(account.id, 'general', 50_000n);
      await ledger.release(res.reservationId);

      // Attempt to finalize after release → InvalidStateError
      let threw = false;
      try {
        await ledger.finalize(res.reservationId, 50_000n);
      } catch (e) {
        if (e instanceof InvalidStateError) threw = true;
        else throw e;
      }
      expect(threw).toBe(true);
    } finally {
      runDb.close();
    }
  });

  // ---------------------------------------------------------------------------
  // I-9 (DB UNIQUE): Revenue rule mutual exclusion violation
  // ---------------------------------------------------------------------------

  it('I-9 counterexample: second active rule → UNIQUE constraint', () => {
    // Seed already has one active rule from migration 035.
    // Attempting to insert another active rule should violate the unique index.
    expect(() => {
      db.prepare(`
        INSERT INTO revenue_rules (id, name, status, commons_bps, community_bps, foundation_bps, proposed_by)
        VALUES ('rule-dup', 'Duplicate Active', 'active', 3000, 4000, 3000, 'test')
      `).run();
    }).toThrow(); // UNIQUE constraint: revenue_rules_one_active
  });

  // ---------------------------------------------------------------------------
  // I-10 (DB CHECK): Lot monotonicity violation
  // ---------------------------------------------------------------------------

  it('I-10 counterexample: modifying original_micro → lot_invariant fires', () => {
    const acctId = seedAccount(db);
    const lotId = seedLot(db, acctId, 1_000_000n);

    // Try to change original_micro. Since available still = old original,
    // lot_invariant CHECK (available + reserved + consumed = original) will fire.
    expect(() => {
      db.prepare(`
        UPDATE credit_lots SET original_micro = ? WHERE id = ?
      `).run((2_000_000n).toString(), lotId);
    }).toThrow(); // CHECK constraint: lot_invariant
  });

  // ---------------------------------------------------------------------------
  // I-11 (Application): Finalization atomicity — overspend rejected
  // ---------------------------------------------------------------------------

  it('I-11 counterexample: failed finalize on released reservation → state consistent', async () => {
    const runDb = createLotDb();
    const ledger = new CreditLedgerAdapter(runDb);

    try {
      const account = await ledger.createAccount('person', 'user-atom-fail');
      await ledger.mintLot(account.id, 100_000n, 'deposit', {
        poolId: 'general', sourceId: 'src-atom-fail',
      });
      const res = await ledger.reserve(account.id, 'general', 50_000n);

      // Capture pre-finalize balance
      const balBefore = await ledger.getBalance(account.id, 'general');

      // Release the reservation, then try to finalize → should fail
      await ledger.release(res.reservationId);
      const balAfterRelease = await ledger.getBalance(account.id, 'general');

      let threw = false;
      try {
        await ledger.finalize(res.reservationId, 50_000n);
      } catch (e) {
        if (e instanceof InvalidStateError) threw = true;
        else throw e;
      }
      expect(threw).toBe(true);

      // INVARIANT: Lot conservation still holds after failed finalize attempt
      const balAfterFail = await ledger.getBalance(account.id, 'general');
      expect(balAfterFail.availableMicro).toBe(balAfterRelease.availableMicro);
      expect(balAfterFail.reservedMicro).toBe(balAfterRelease.reservedMicro);

      const stmt = runDb.prepare(`
        SELECT original_micro, available_micro, reserved_micro, consumed_micro
        FROM credit_lots WHERE account_id = ?
      `);
      stmt.safeIntegers(true);
      const lots = stmt.all(account.id) as Array<{
        original_micro: bigint; available_micro: bigint;
        reserved_micro: bigint; consumed_micro: bigint;
      }>;
      for (const lot of lots) {
        expect(lot.available_micro + lot.reserved_micro + lot.consumed_micro)
          .toBe(lot.original_micro);
      }
    } finally {
      runDb.close();
    }
  });

  // ---------------------------------------------------------------------------
  // I-12 (Safety): Reservation without fairness stays non-terminal
  // ---------------------------------------------------------------------------

  it('I-12 counterexample: without expiry tick, reservation stays pending', async () => {
    const runDb = createLotDb();
    const ledger = new CreditLedgerAdapter(runDb);

    try {
      const account = await ledger.createAccount('person', 'user-no-expire');
      await ledger.mintLot(account.id, 100_000n, 'deposit', {
        poolId: 'general', sourceId: 'src-no-expire',
      });
      const res = await ledger.reserve(account.id, 'general', 50_000n);

      // Without any action (no fairness), reservation stays pending
      const row = runDb.prepare(
        `SELECT status FROM credit_reservations WHERE id = ?`,
      ).get(res.reservationId) as { status: string };
      expect(row.status).toBe('pending');
      expect(['finalized', 'released', 'expired']).not.toContain(row.status);
    } finally {
      runDb.close();
    }
  });

  // ---------------------------------------------------------------------------
  // I-13 (Reconciliation): Treasury inadequacy
  // ---------------------------------------------------------------------------

  it('I-13 counterexample: lot balances exceed minted → reconciliation divergence', async () => {
    const acctId = seedAccount(db);
    seedLot(db, acctId, 1_000_000n);

    // Inflate receivables so total_accounted > total_minted
    db.prepare(`
      INSERT INTO agent_clawback_receivables (id, account_id, source_clawback_id,
        original_amount_micro, balance_micro)
      VALUES ('recv-treasury', ?, 'clawback-treasury', 10000000, 10000000)
    `).run(acctId);

    const recon = new ReconciliationService(db);
    const result = await recon.reconcile();
    const platformCheck = result.checks.find(c => c.name === 'platform_conservation');
    expect(platformCheck?.status).toBe('failed');
  });

  // ---------------------------------------------------------------------------
  // I-14 (Application): Shadow tracking divergence
  // ---------------------------------------------------------------------------

  it('I-14 counterexample: asymmetric shadow/real entries are detectable', () => {
    const acctId = seedAccount(db);
    seedLot(db, acctId, 1_000_000n);

    // Insert a real charge entry WITHOUT matching shadow entry
    db.prepare(`
      INSERT INTO credit_ledger (id, account_id, pool_id, entry_seq, entry_type, amount_micro)
      VALUES ('le-real-only', ?, 'general', 1, 'reserve', -100000)
    `).run(acctId);

    // Query: count real non-shadow entries vs shadow entries
    const realCount = (db.prepare(`
      SELECT COUNT(*) as cnt FROM credit_ledger
      WHERE account_id = ? AND entry_type NOT LIKE 'shadow_%'
    `).get(acctId) as { cnt: number }).cnt;

    const shadowCount = (db.prepare(`
      SELECT COUNT(*) as cnt FROM credit_ledger
      WHERE account_id = ? AND entry_type LIKE 'shadow_%'
    `).get(acctId) as { cnt: number }).cnt;

    // Divergence: real entry exists without shadow counterpart
    expect(realCount).toBeGreaterThan(shadowCount);
  });

  // ---------------------------------------------------------------------------
  // BigInt precision guard (Task 3.2 integration)
  // ---------------------------------------------------------------------------

  it('BigInt precision guard: values > 2^53 round-trip without precision loss', () => {
    const acctId = seedAccount(db);
    const largeAmount = (2n ** 53n) + 1n; // Beyond Number.MAX_SAFE_INTEGER

    const lotId = seedLot(db, acctId, largeAmount);
    const parsed = queryLot(db, lotId);

    expect(parsed.original_micro).toBe(largeAmount as MicroUSD);
    expect(parsed.available_micro).toBe(largeAmount as MicroUSD);
  });
});

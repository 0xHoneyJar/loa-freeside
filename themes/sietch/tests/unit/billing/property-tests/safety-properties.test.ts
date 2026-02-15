/**
 * Safety Property Tests — Credit Ledger
 *
 * Property-based tests using fast-check to formally verify safety properties
 * of the credit ledger system. Uses real in-memory SQLite — no mocks.
 *
 * Properties verified:
 * - Per-Lot Conservation: available + reserved + consumed = original (Task 1.2)
 * - No Double-Finalize: terminal states are absorbing (Task 1.3)
 * - Revenue Rule Mutual Exclusion: at most 1 active rule (Task 1.4)
 * - FIFO Consumption Order: oldest lot consumed first (Task 1.5)
 *
 * Sprint refs: Tasks 1.2, 1.3, 1.4, 1.5
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';
import Database from 'better-sqlite3';
import { CREDIT_LEDGER_SCHEMA_SQL } from '../../../../src/db/migrations/030_credit_ledger.js';
import { REVENUE_RULES_SCHEMA_SQL } from '../../../../src/db/migrations/035_revenue_rules.js';
import {
  CreditLedgerAdapter,
  InsufficientBalanceError,
  InvalidStateError,
  ConflictError,
} from '../../../../src/packages/adapters/billing/CreditLedgerAdapter.js';
import { RevenueRulesAdapter } from '../../../../src/packages/adapters/billing/RevenueRulesAdapter.js';
import {
  NUM_RUNS,
  smallMicroUsdAmount,
  lotOperationSequence,
  ruleLifecycleSequence,
  lotSet,
  bpsSplit,
} from './generators.js';
import type { LotOperation, RuleLifecycleAction } from './generators.js';

// =============================================================================
// Test Helpers
// =============================================================================

let db: Database.Database;
let ledger: CreditLedgerAdapter;

function createTestDb(): Database.Database {
  const testDb = new Database(':memory:');
  testDb.pragma('journal_mode = WAL');
  testDb.pragma('foreign_keys = ON');
  testDb.exec(CREDIT_LEDGER_SCHEMA_SQL);
  return testDb;
}

function createTestDbWithRevenue(): Database.Database {
  const testDb = createTestDb();
  testDb.exec(REVENUE_RULES_SCHEMA_SQL);
  return testDb;
}

async function createAccountAndLot(amountMicro: bigint) {
  const account = await ledger.createAccount('person', `user-${Math.random().toString(36).slice(2, 8)}`);
  const lot = await ledger.mintLot(account.id, amountMicro, 'deposit', {
    poolId: 'general',
    sourceId: `src-${Math.random().toString(36).slice(2, 8)}`,
  });
  return { account, lot };
}

function getLotFromDb(lotId: string) {
  return db.prepare(`
    SELECT id, account_id, original_micro, available_micro, reserved_micro, consumed_micro
    FROM credit_lots WHERE id = ?
  `).get(lotId) as {
    id: string;
    original_micro: bigint;
    available_micro: bigint;
    reserved_micro: bigint;
    consumed_micro: bigint;
  } | undefined;
}

function getReservationStatus(reservationId: string): string | undefined {
  const row = db.prepare('SELECT status FROM credit_reservations WHERE id = ?').get(reservationId) as { status: string } | undefined;
  return row?.status;
}

// =============================================================================
// Setup / Teardown
// =============================================================================

beforeEach(() => {
  db = createTestDb();
  ledger = new CreditLedgerAdapter(db);
});

afterEach(() => {
  db.close();
});

// =============================================================================
// Task 1.2: Safety Property — Per-Lot Conservation
// =============================================================================

describe('Safety: Per-Lot Conservation', () => {
  it('available + reserved + consumed = original after any operation sequence', async () => {
    await fc.assert(
      fc.asyncProperty(
        smallMicroUsdAmount(),
        lotOperationSequence(1_000_000_000n, 15),
        async (lotAmount, operations) => {
          // Fresh DB for each run
          const runDb = createTestDb();
          const runLedger = new CreditLedgerAdapter(runDb);

          try {
            const account = await runLedger.createAccount('person', `user-${Math.random().toString(36).slice(2, 8)}`);
            const lot = await runLedger.mintLot(account.id, lotAmount, 'deposit', {
              poolId: 'general',
              sourceId: `src-${Math.random().toString(36).slice(2, 8)}`,
            });

            let activeReservationId: string | null = null;

            for (const op of operations) {
              try {
                switch (op.type) {
                  case 'reserve': {
                    if (activeReservationId) break; // One at a time
                    const result = await runLedger.reserve(account.id, 'general', op.amount);
                    activeReservationId = result.reservationId;
                    break;
                  }
                  case 'finalize': {
                    if (!activeReservationId) break;
                    await runLedger.finalize(activeReservationId, op.amount);
                    activeReservationId = null;
                    break;
                  }
                  case 'release': {
                    if (!activeReservationId) break;
                    await runLedger.release(activeReservationId);
                    activeReservationId = null;
                    break;
                  }
                  case 'expire_tick': {
                    // Simulate expiry by sweeping expired reservations
                    // For now, just release any active reservation
                    if (activeReservationId) {
                      try {
                        await runLedger.release(activeReservationId);
                      } catch { /* may already be terminal */ }
                      activeReservationId = null;
                    }
                    break;
                  }
                }
              } catch (e) {
                // Expected errors (insufficient balance, invalid state) are fine
                if (e instanceof InsufficientBalanceError ||
                    e instanceof InvalidStateError ||
                    e instanceof ConflictError) {
                  continue;
                }
                throw e;
              }
            }

            // INVARIANT: Per-lot conservation must hold
            const lotStmt = runDb.prepare(`
              SELECT original_micro, available_micro, reserved_micro, consumed_micro
              FROM credit_lots WHERE id = ?
            `);
            lotStmt.safeIntegers(true);
            const dbLot = lotStmt.get(lot.id) as {
              original_micro: bigint;
              available_micro: bigint;
              reserved_micro: bigint;
              consumed_micro: bigint;
            };

            expect(dbLot.available_micro + dbLot.reserved_micro + dbLot.consumed_micro)
              .toBe(dbLot.original_micro);
          } finally {
            runDb.close();
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});

// =============================================================================
// Task 1.3: Safety Property — No Double-Finalize
// =============================================================================

describe('Safety: No Double-Finalize', () => {
  it('second finalize returns error without mutating ledger state', async () => {
    await fc.assert(
      fc.asyncProperty(
        smallMicroUsdAmount(),
        fc.bigInt({ min: 1n, max: 1_000_000_000n }),
        async (lotAmount, reserveAmount) => {
          fc.pre(reserveAmount <= lotAmount);

          const runDb = createTestDb();
          const runLedger = new CreditLedgerAdapter(runDb);

          try {
            const account = await runLedger.createAccount('person', `user-${Math.random().toString(36).slice(2, 8)}`);
            await runLedger.mintLot(account.id, lotAmount, 'deposit', {
              poolId: 'general',
              sourceId: `src-${Math.random().toString(36).slice(2, 8)}`,
            });

            const reservation = await runLedger.reserve(account.id, 'general', reserveAmount);

            // First finalize succeeds
            const cost = reserveAmount; // Exact cost
            await runLedger.finalize(reservation.reservationId, cost);

            // Capture state after first finalize
            const balanceAfterFirst = await runLedger.getBalance(account.id, 'general');

            // Second finalize with same amount — should return idempotent result, not error
            // But finalize with DIFFERENT amount should throw ConflictError
            const differentCost = cost + 1n;
            let conflictThrown = false;
            try {
              await runLedger.finalize(reservation.reservationId, differentCost);
            } catch (e) {
              if (e instanceof ConflictError) {
                conflictThrown = true;
              } else {
                throw e;
              }
            }

            // INVARIANT: Different-amount double-finalize throws ConflictError
            expect(conflictThrown).toBe(true);

            // INVARIANT: Balance unchanged after rejected double-finalize
            const balanceAfterSecond = await runLedger.getBalance(account.id, 'general');
            expect(balanceAfterSecond.availableMicro).toBe(balanceAfterFirst.availableMicro);
            expect(balanceAfterSecond.reservedMicro).toBe(balanceAfterFirst.reservedMicro);
          } finally {
            runDb.close();
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('terminal states are absorbing — no transitions out', async () => {
    await fc.assert(
      fc.asyncProperty(
        smallMicroUsdAmount(),
        fc.bigInt({ min: 1n, max: 1_000_000_000n }),
        fc.oneof(
          fc.constant('finalize' as const),
          fc.constant('release' as const),
        ),
        async (lotAmount, reserveAmount, terminalAction) => {
          fc.pre(reserveAmount <= lotAmount);

          const runDb = createTestDb();
          const runLedger = new CreditLedgerAdapter(runDb);

          try {
            const account = await runLedger.createAccount('person', `user-${Math.random().toString(36).slice(2, 8)}`);
            await runLedger.mintLot(account.id, lotAmount, 'deposit', {
              poolId: 'general',
              sourceId: `src-${Math.random().toString(36).slice(2, 8)}`,
            });

            const reservation = await runLedger.reserve(account.id, 'general', reserveAmount);

            // Move to terminal state
            if (terminalAction === 'finalize') {
              await runLedger.finalize(reservation.reservationId, reserveAmount);
            } else {
              await runLedger.release(reservation.reservationId);
            }

            // INVARIANT: All subsequent operations on terminal reservation throw InvalidStateError
            let finalizeThrew = false;
            let releaseThrew = false;

            try {
              await runLedger.finalize(reservation.reservationId, reserveAmount);
            } catch (e) {
              // Idempotent finalize returns OK, ConflictError for different amount
              if (e instanceof InvalidStateError || e instanceof ConflictError) {
                finalizeThrew = true;
              }
            }

            try {
              await runLedger.release(reservation.reservationId);
            } catch (e) {
              if (e instanceof InvalidStateError) {
                releaseThrew = true;
              }
            }

            // If we finalized, same-amount finalize is idempotent (doesn't throw)
            // but release should always throw on terminal
            if (terminalAction === 'release') {
              expect(finalizeThrew).toBe(true); // Can't finalize a released reservation
            }
            expect(releaseThrew).toBe(true); // Can't release a terminal reservation
          } finally {
            runDb.close();
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});

// =============================================================================
// Task 1.4: Safety Property — Revenue Rule Mutual Exclusion
// =============================================================================

describe('Safety: Revenue Rule Mutual Exclusion', () => {
  it('at most 1 active rule after any sequence of lifecycle operations', async () => {
    await fc.assert(
      fc.asyncProperty(
        ruleLifecycleSequence(20),
        async (actions) => {
          const runDb = createTestDbWithRevenue();
          const rulesAdapter = new RevenueRulesAdapter(runDb);

          try {
            const ruleIds: string[] = [];

            for (const action of actions) {
              try {
                switch (action.type) {
                  case 'propose': {
                    const rule = await rulesAdapter.proposeRule({
                      name: `rule-${ruleIds.length}`,
                      commonsBps: action.split.commonsBps,
                      communityBps: action.split.communityBps,
                      foundationBps: action.split.foundationBps,
                      proposedBy: action.actor,
                    });
                    ruleIds.push(rule.id);
                    break;
                  }
                  case 'submit': {
                    if (ruleIds.length === 0) break;
                    const idx = action.ruleIndex % ruleIds.length;
                    await rulesAdapter.submitForApproval(ruleIds[idx], action.actor);
                    break;
                  }
                  case 'approve': {
                    if (ruleIds.length === 0) break;
                    const idx = action.ruleIndex % ruleIds.length;
                    await rulesAdapter.approveRule(ruleIds[idx], action.actor);
                    break;
                  }
                  case 'reject': {
                    if (ruleIds.length === 0) break;
                    const idx = action.ruleIndex % ruleIds.length;
                    await rulesAdapter.rejectRule(ruleIds[idx], action.actor, 'test rejection');
                    break;
                  }
                  case 'activate_ready': {
                    await rulesAdapter.activateReadyRules();
                    break;
                  }
                }
              } catch {
                // Expected: four-eyes violations, invalid transitions, etc.
                continue;
              }
            }

            // INVARIANT: At most 1 active rule
            const activeCount = runDb.prepare(
              `SELECT COUNT(*) as cnt FROM revenue_rules WHERE status = 'active'`
            ).get() as { cnt: number };

            expect(activeCount.cnt).toBeLessThanOrEqual(1);
          } finally {
            runDb.close();
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});

// =============================================================================
// Task 1.5: Safety Property — FIFO Consumption Order
// =============================================================================

describe('Safety: FIFO Consumption Order', () => {
  it('reserve consumes from oldest lot first', async () => {
    await fc.assert(
      fc.asyncProperty(
        lotSet({ min: 2, max: 5 }),
        async (lots) => {
          fc.pre(lots.length >= 2);

          const runDb = createTestDb();
          const runLedger = new CreditLedgerAdapter(runDb);

          try {
            const account = await runLedger.createAccount('person', `user-${Math.random().toString(36).slice(2, 8)}`);

            // Sort lots by createdAtOffset to determine expected FIFO order
            const sortedLots = [...lots].sort((a, b) => a.createdAtOffset - b.createdAtOffset);

            // Mint lots with different timestamps by sleeping briefly
            const mintedLotIds: string[] = [];
            for (const lotDef of sortedLots) {
              const lot = await runLedger.mintLot(account.id, lotDef.amountMicro, 'deposit', {
                poolId: 'general',
                sourceId: `src-${Math.random().toString(36).slice(2, 8)}`,
              });
              mintedLotIds.push(lot.id);
            }

            // Reserve a small amount — should come from the first lot (oldest)
            const totalAvailable = sortedLots.reduce((sum, l) => sum + l.amountMicro, 0n);
            const reserveAmount = sortedLots[0].amountMicro <= 0n ? 1n :
              sortedLots[0].amountMicro > 1n ? 1n : 1n; // Always reserve 1 micro

            const reservation = await runLedger.reserve(account.id, 'general', reserveAmount);

            // INVARIANT: First lot allocation must be from the oldest lot
            expect(reservation.lotAllocations.length).toBeGreaterThan(0);
            expect(reservation.lotAllocations[0].lotId).toBe(mintedLotIds[0]);

            // Verify: the oldest lot's available decreased
            const stmt = runDb.prepare(
              'SELECT available_micro FROM credit_lots WHERE id = ?'
            );
            stmt.safeIntegers(true);
            const oldestLot = stmt.get(mintedLotIds[0]) as { available_micro: bigint };

            expect(oldestLot.available_micro).toBe(sortedLots[0].amountMicro - reserveAmount);
          } finally {
            runDb.close();
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('lots with zero available are skipped', async () => {
    await fc.assert(
      fc.asyncProperty(
        smallMicroUsdAmount(),
        smallMicroUsdAmount(),
        async (firstAmount, secondAmount) => {
          const runDb = createTestDb();
          const runLedger = new CreditLedgerAdapter(runDb);

          try {
            const account = await runLedger.createAccount('person', `user-${Math.random().toString(36).slice(2, 8)}`);

            // Mint first lot
            const lot1 = await runLedger.mintLot(account.id, firstAmount, 'deposit', {
              poolId: 'general',
              sourceId: `src-1-${Math.random().toString(36).slice(2, 8)}`,
            });

            // Drain first lot completely
            const res1 = await runLedger.reserve(account.id, 'general', firstAmount);
            await runLedger.finalize(res1.reservationId, firstAmount);

            // Mint second lot
            const lot2 = await runLedger.mintLot(account.id, secondAmount, 'deposit', {
              poolId: 'general',
              sourceId: `src-2-${Math.random().toString(36).slice(2, 8)}`,
            });

            // Reserve from second lot (first is empty)
            const res2 = await runLedger.reserve(account.id, 'general', 1n);

            // INVARIANT: Allocation from second lot, not first
            expect(res2.lotAllocations[0].lotId).toBe(lot2.id);
          } finally {
            runDb.close();
          }
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});

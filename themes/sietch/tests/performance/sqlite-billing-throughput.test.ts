/**
 * SQLite Write Throughput Load Test
 *
 * Validates SQLite write performance meets SDD §3.1 SLOs.
 * Mixed load: reserve/finalize + background sweeper + webhook deposits.
 *
 * Pass criteria: p99 reserve < 100ms, p99 finalize < 100ms under mixed load.
 * If p99 > 100ms: flag for dedicated writer queue before Sprint 2.
 *
 * SDD refs: §3.1 SQLite Write Throughput SLOs
 * Sprint refs: Task 1.9
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { CREDIT_LEDGER_SCHEMA_SQL } from '../../src/db/migrations/030_credit_ledger.js';
import { CreditLedgerAdapter } from '../../src/packages/adapters/billing/CreditLedgerAdapter.js';
import { createReservationSweeper } from '../../src/jobs/reservation-sweeper.js';

// =============================================================================
// Helpers
// =============================================================================

function percentile(sorted: number[], p: number): number {
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

async function timeMs(fn: () => Promise<unknown>): Promise<number> {
  const start = performance.now();
  await fn();
  return performance.now() - start;
}

// =============================================================================
// Load Test
// =============================================================================

describe('SQLite Billing Write Throughput', () => {
  let db: Database.Database;
  let ledger: CreditLedgerAdapter;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.pragma('busy_timeout = 5000');
    db.exec(CREDIT_LEDGER_SCHEMA_SQL);
    ledger = new CreditLedgerAdapter(db);
  });

  afterEach(() => {
    db.close();
  });

  it('WAL mode and busy_timeout are active', () => {
    const journalMode = db.pragma('journal_mode', { simple: true });
    // In-memory databases report 'memory'; file-backed databases report 'wal'
    expect(['wal', 'memory']).toContain(journalMode);

    const busyTimeout = db.pragma('busy_timeout', { simple: true });
    expect(Number(busyTimeout)).toBe(5000);
  });

  it('50 reserve/finalize cycles under mixed load meet p99 < 100ms', async () => {
    const CYCLE_COUNT = 50;
    const DEPOSIT_COUNT = 5;
    const reserveLatencies: number[] = [];
    const finalizeLatencies: number[] = [];

    // Seed account with enough credits
    const account = await ledger.createAccount('person', 'load-test-user');
    for (let i = 0; i < 10; i++) {
      await ledger.mintLot(account.id, 100_000_000n, 'deposit', {
        sourceId: `seed-${i}`,
        poolId: 'general',
      });
    }

    // Start sweeper in background (simulates concurrent background writes)
    const sweeper = createReservationSweeper({ db, intervalMs: 50 });
    sweeper.start();

    // Concurrent webhook deposits (simulates parallel deposit writes)
    const depositPromises: Promise<void>[] = [];
    for (let d = 0; d < DEPOSIT_COUNT; d++) {
      depositPromises.push(
        (async () => {
          for (let i = 0; i < 10; i++) {
            await ledger.mintLot(account.id, 1_000_000n, 'deposit', {
              sourceId: `webhook-${d}-${i}`,
              poolId: 'general',
            });
            // Small delay to spread writes
            await new Promise(r => setTimeout(r, 5));
          }
        })()
      );
    }

    // Run reserve/finalize cycles
    const startTime = performance.now();
    for (let i = 0; i < CYCLE_COUNT; i++) {
      const reserveMs = await timeMs(async () => {
        const r = await ledger.reserve(account.id, 'general', 10_000n);
        // Store reservation ID for finalize
        (globalThis as any).__lastRes = r.reservationId;
      });
      reserveLatencies.push(reserveMs);

      const finalizeMs = await timeMs(async () => {
        await ledger.finalize((globalThis as any).__lastRes, 8_000n);
      });
      finalizeLatencies.push(finalizeMs);
    }

    // Wait for deposit writers to finish
    await Promise.all(depositPromises);

    // Stop sweeper
    sweeper.stop();

    const totalTimeMs = performance.now() - startTime;

    // Sort latencies for percentile calculation
    reserveLatencies.sort((a, b) => a - b);
    finalizeLatencies.sort((a, b) => a - b);

    const reserveP50 = percentile(reserveLatencies, 50);
    const reserveP99 = percentile(reserveLatencies, 99);
    const finalizeP50 = percentile(finalizeLatencies, 50);
    const finalizeP99 = percentile(finalizeLatencies, 99);
    const totalCycles = CYCLE_COUNT;
    const tps = (totalCycles * 2) / (totalTimeMs / 1000); // 2 ops per cycle

    // Log results for CI visibility
    console.log('\n========================================');
    console.log('SQLite Billing Write Throughput Results');
    console.log('========================================');
    console.log(`Cycles:           ${totalCycles}`);
    console.log(`Parallel deposits: ${DEPOSIT_COUNT} writers x 10 deposits`);
    console.log(`Sweeper:           50ms interval`);
    console.log('----------------------------------------');
    console.log(`Reserve p50:       ${reserveP50.toFixed(2)}ms`);
    console.log(`Reserve p99:       ${reserveP99.toFixed(2)}ms`);
    console.log(`Finalize p50:      ${finalizeP50.toFixed(2)}ms`);
    console.log(`Finalize p99:      ${finalizeP99.toFixed(2)}ms`);
    console.log(`Write TPS:         ${tps.toFixed(1)}`);
    console.log(`Total time:        ${totalTimeMs.toFixed(0)}ms`);
    console.log('========================================');

    if (reserveP99 > 100) {
      console.warn('⚠️ Reserve p99 > 100ms — flag for dedicated writer queue before Sprint 2');
    }
    if (finalizeP99 > 100) {
      console.warn('⚠️ Finalize p99 > 100ms — flag for dedicated writer queue before Sprint 2');
    }

    // Pass criteria
    expect(reserveP99).toBeLessThan(100);
    expect(finalizeP99).toBeLessThan(100);

    // Verify lot invariant still holds after load test
    const lots = db.prepare('SELECT * FROM credit_lots WHERE account_id = ?')
      .all(account.id) as Array<{
        available_micro: string; reserved_micro: string;
        consumed_micro: string; original_micro: string;
      }>;

    for (const lot of lots) {
      const sum = BigInt(lot.available_micro) + BigInt(lot.reserved_micro) + BigInt(lot.consumed_micro);
      expect(sum).toBe(BigInt(lot.original_micro));
    }
  }, 30_000); // 30s timeout for load test
});

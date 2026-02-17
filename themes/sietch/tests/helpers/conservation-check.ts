/**
 * Conservation Assertion Helper (Task 4.3, Sprint 298)
 *
 * Runs full ReconciliationService post-scenario to verify conservation
 * invariants (I-1, I-2, I-4 minimum) hold after any test scenario.
 * Uses BigInt-safe row parsing throughout.
 *
 * SDD refs: §3.3.3 Conservation assertion
 * Sprint refs: Task 4.3
 */

import { expect } from 'vitest';
import type Database from 'better-sqlite3';
import { ReconciliationService } from '../../src/packages/adapters/billing/ReconciliationService.js';
import type { ReconciliationResult } from '../../src/packages/core/ports/IReconciliationService.js';

/**
 * Assert that all core conservation invariants hold in the given database.
 *
 * Runs the full ReconciliationService.reconcile() and verifies:
 * - I-1: Lot conservation (per-account)
 * - I-2: Platform conservation
 * - I-4: All reconciliation checks pass
 *
 * @throws {AssertionError} if any conservation check fails
 */
export async function assertConservation(db: Database.Database): Promise<ReconciliationResult> {
  const recon = new ReconciliationService(db);
  const result = await recon.reconcile();

  // I-1 / I-2: Lot conservation (per-account)
  const lotCheck = result.checks.find(c => c.name === 'lot_conservation');
  expect(lotCheck?.status, `I-1/I-2 lot conservation: ${JSON.stringify(lotCheck?.details)}`).toBe('passed');

  // I-4: Platform conservation
  const platformCheck = result.checks.find(c => c.name === 'platform_conservation');
  expect(platformCheck?.status, `I-4 platform conservation: ${JSON.stringify(platformCheck?.details)}`).toBe('passed');

  // Overall: no divergences
  expect(result.divergences, `Divergences found: ${result.divergences.join('; ')}`).toHaveLength(0);

  return result;
}

/**
 * Variant that allows specific checks to be skipped (e.g., when testing
 * scenarios that intentionally corrupt transfer/deposit state).
 */
export async function assertCoreConservation(
  db: Database.Database,
  skipChecks: string[] = [],
): Promise<ReconciliationResult> {
  const recon = new ReconciliationService(db);
  const result = await recon.reconcile();

  for (const check of result.checks) {
    if (skipChecks.includes(check.name)) continue;
    expect(check.status, `${check.name}: ${JSON.stringify(check.details)}`).toBe('passed');
  }

  return result;
}

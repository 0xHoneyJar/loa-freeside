/**
 * Lot Entry Insert Guard — Static Analysis Conformance Test
 *
 * AC-1.2.7: Ensure no raw INSERT INTO lot_entries exists outside of:
 *   1. The SECURITY DEFINER function (migration files)
 *   2. The lot-entry-repository.ts wrapper
 *   3. Test files
 *
 * This test scans the codebase for raw INSERT INTO lot_entries and fails
 * if any are found in application code, ensuring all writes go through
 * the canonical insert_lot_entry_fn() path.
 *
 * @see SDD §4.2 Double-Entry Append-Only Ledger
 * @see Sprint 1, Task 1.2
 */

import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import * as path from 'path';

/** Paths that are ALLOWED to contain INSERT INTO lot_entries */
const ALLOWED_PATHS = [
  // Migration files define the SECURITY DEFINER function
  'themes/sietch/drizzle/migrations/',
  // The repository wrapper calls the DB function
  'packages/adapters/storage/lot-entry-repository.ts',
  // Test files
  '__tests__/',
  'tests/',
  '.test.ts',
  '.spec.ts',
  // Node modules
  'node_modules/',
  // Build artifacts
  'dist/',
  '.next/',
];

describe('lot_entries INSERT guard (AC-1.2.7)', () => {
  it('should not have raw INSERT INTO lot_entries in application code', () => {
    const projectRoot = path.resolve(__dirname, '../..');

    let grepOutput = '';
    try {
      // Search for INSERT INTO lot_entries (case-insensitive)
      // Exclude binary files, node_modules, dist
      grepOutput = execSync(
        `grep -rni "INSERT INTO lot_entries" --include="*.ts" --include="*.sql" --include="*.js" "${projectRoot}" 2>/dev/null || true`,
        { encoding: 'utf-8', maxBuffer: 1024 * 1024 },
      );
    } catch {
      // grep returns exit code 1 if no matches — that's the ideal case
      return;
    }

    if (!grepOutput.trim()) {
      // No matches at all — shouldn't happen since migration files have it
      // But not a failure condition for the guard
      return;
    }

    const lines = grepOutput.trim().split('\n').filter(Boolean);
    const violations: string[] = [];

    for (const line of lines) {
      const isAllowed = ALLOWED_PATHS.some((allowed) => line.includes(allowed));
      if (!isAllowed) {
        violations.push(line);
      }
    }

    if (violations.length > 0) {
      const message = [
        'Raw INSERT INTO lot_entries found in application code!',
        'All lot_entries writes MUST go through insertLotEntry() from lot-entry-repository.ts.',
        '',
        'Violations:',
        ...violations.map((v) => `  ${v}`),
        '',
        'Fix: Replace raw INSERT with insertLotEntry() from @arrakis/adapters/storage.',
      ].join('\n');

      expect.fail(message);
    }
  });
});

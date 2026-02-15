/**
 * Lot Invariant Verification Tool
 *
 * Scans all credit lots and verifies the fundamental invariant:
 *   available_micro + reserved_micro + consumed_micro = original_micro
 *
 * Usage:
 *   npx tsx scripts/verify-lot-invariants.ts [path-to-db]
 *
 * Exit codes:
 *   0 - No violations found
 *   1 - Violations found (with lot IDs)
 *   2 - Database error
 *
 * Sprint refs: Task 6.5
 */

import Database from 'better-sqlite3';

const dbPath = process.argv[2];
if (!dbPath) {
  console.error('Usage: npx tsx scripts/verify-lot-invariants.ts <path-to-db>');
  process.exit(2);
}

let db: Database.Database;
try {
  db = new Database(dbPath, { readonly: true });
  db.pragma('journal_mode = WAL');
} catch (err) {
  console.error(`Failed to open database: ${(err as Error).message}`);
  process.exit(2);
}

interface LotRow {
  id: string;
  original_micro: number | bigint;
  available_micro: number | bigint;
  reserved_micro: number | bigint;
  consumed_micro: number | bigint;
}

try {
  const stmt = db.prepare(`
    SELECT id, original_micro, available_micro, reserved_micro, consumed_micro
    FROM credit_lots
  `);
  stmt.safeIntegers(true);

  const lots = stmt.all() as LotRow[];
  let totalLots = 0;
  let violations = 0;
  const violatedIds: string[] = [];

  for (const lot of lots) {
    totalLots++;
    const original = BigInt(lot.original_micro);
    const available = BigInt(lot.available_micro);
    const reserved = BigInt(lot.reserved_micro);
    const consumed = BigInt(lot.consumed_micro);
    const sum = available + reserved + consumed;

    if (sum !== original) {
      violations++;
      violatedIds.push(lot.id);
      console.error(
        `VIOLATION: lot ${lot.id} — original=${original}, available=${available}, reserved=${reserved}, consumed=${consumed}, sum=${sum}`,
      );
    }
  }

  console.log(`\nLot Invariant Verification`);
  console.log(`========================`);
  console.log(`Total lots checked: ${totalLots}`);
  console.log(`Violations found:   ${violations}`);

  if (violations > 0) {
    console.log(`\nViolated lot IDs:`);
    for (const id of violatedIds) {
      console.log(`  - ${id}`);
    }
    process.exit(1);
  } else {
    console.log(`\nAll lots satisfy: available + reserved + consumed = original`);
    process.exit(0);
  }
} catch (err) {
  console.error(`Database query error: ${(err as Error).message}`);
  process.exit(2);
} finally {
  db.close();
}

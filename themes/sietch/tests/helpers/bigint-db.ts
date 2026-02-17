/**
 * BigInt-Safe DB Access Helper (Task 3.2, Sprint 297)
 *
 * Parses monetary columns from SQLite rows to BigInt, ensuring
 * no precision loss for values > 2^53.
 *
 * SDD refs: §3.2.4
 * Sprint refs: Task 3.2
 */

import type { MicroUSD } from '../../src/packages/core/protocol/arrakis-arithmetic.js';

/**
 * Monetary column names in credit_lots rows.
 */
const LOT_MONETARY_COLUMNS = [
  'original_micro',
  'available_micro',
  'reserved_micro',
  'consumed_micro',
] as const;

/**
 * A credit_lots row with BigInt monetary values.
 */
export interface ParsedLotRow {
  id: string;
  account_id: string;
  pool_id: string | null;
  source_type: string;
  original_micro: MicroUSD;
  available_micro: MicroUSD;
  reserved_micro: MicroUSD;
  consumed_micro: MicroUSD;
  expires_at: string | null;
  created_at: string;
}

/**
 * Parse a raw credit_lots row, converting all monetary columns to BigInt.
 * Handles both string (from CAST) and number (from SQLite integer) inputs.
 *
 * @throws {TypeError} if a monetary column cannot be converted to BigInt
 */
export function parseLotBigInts(row: Record<string, unknown>): ParsedLotRow {
  const result = { ...row } as Record<string, unknown>;

  for (const col of LOT_MONETARY_COLUMNS) {
    const val = row[col];
    if (typeof val === 'bigint') {
      result[col] = val;
    } else if (typeof val === 'string') {
      result[col] = BigInt(val);
    } else if (typeof val === 'number') {
      result[col] = BigInt(val);
    } else {
      throw new TypeError(`Cannot convert ${col}=${String(val)} (${typeof val}) to BigInt`);
    }
  }

  return result as unknown as ParsedLotRow;
}

/**
 * Parse a single monetary value from a DB row to MicroUSD.
 */
export function parseMicroUSD(val: unknown): MicroUSD {
  if (typeof val === 'bigint') return val as MicroUSD;
  if (typeof val === 'string') return BigInt(val) as MicroUSD;
  if (typeof val === 'number') return BigInt(val) as MicroUSD;
  throw new TypeError(`Cannot convert ${String(val)} (${typeof val}) to MicroUSD`);
}

/**
 * Canonical timestamp module for all billing services.
 *
 * SQLite's `datetime('now')` returns `YYYY-MM-DD HH:MM:SS` (space-separated, no timezone).
 * All billing services MUST use this format for internal timestamps stored in SQLite columns.
 *
 * ISO 8601 (`YYYY-MM-DDTHH:MM:SS.sssZ`) is ONLY for external API responses and webhook payloads.
 *
 * WARNING: Do NOT mix formats in SQLite columns. String comparison of space (0x20) vs 'T' (0x54)
 * breaks chronological ordering. See BB-67-001 / ADR-013.
 */

/** Branded type for SQLite-format timestamps. Prevents accidental use of ISO 8601 strings. */
export type SqliteTimestamp = string & { readonly __brand: 'sqlite_ts' };

/**
 * Returns the current time in SQLite-compatible format: `YYYY-MM-DD HH:MM:SS`
 * Matches the output of SQLite's `datetime('now')`.
 */
export function sqliteTimestamp(date?: Date): SqliteTimestamp {
  return (date ?? new Date())
    .toISOString()
    .replace('T', ' ')
    .replace(/\.\d+Z$/, '') as SqliteTimestamp;
}

/**
 * Returns a future time in SQLite-compatible format.
 * @param offsetSeconds - Number of seconds to add to the current time
 */
export function sqliteFutureTimestamp(offsetSeconds: number, from?: Date): SqliteTimestamp {
  const base = from ?? new Date();
  return new Date(base.getTime() + offsetSeconds * 1000)
    .toISOString()
    .replace('T', ' ')
    .replace(/\.\d+Z$/, '') as SqliteTimestamp;
}

/**
 * Validates and brands a string read from a SQLite *_at column.
 * Use this at the DB read boundary to ensure type safety.
 * @throws Error if the string is not in SQLite timestamp format
 */
export function parseSqliteTimestamp(raw: string): SqliteTimestamp {
  if (!isSqliteFormat(raw)) {
    throw new Error(`Invalid SQLite timestamp format: "${raw}". Expected YYYY-MM-DD HH:MM:SS`);
  }
  return raw as SqliteTimestamp;
}

/**
 * Returns the current time in ISO 8601 format: `YYYY-MM-DDTHH:MM:SS.sssZ`
 * Use ONLY for external API responses and webhook payloads. Never for SQLite columns.
 */
export function isoTimestamp(date?: Date): string {
  return (date ?? new Date()).toISOString();
}

/**
 * Validates that a timestamp string is in SQLite format (not ISO 8601).
 * Returns true if the string matches `YYYY-MM-DD HH:MM:SS`.
 */
export function isSqliteFormat(timestamp: string): boolean {
  return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(timestamp);
}

/**
 * Validates that a timestamp string is in ISO 8601 format.
 * Returns true if the string contains 'T' separator.
 */
export function isIsoFormat(timestamp: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(timestamp);
}

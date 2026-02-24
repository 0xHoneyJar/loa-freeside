/**
 * Dead-letter Quarantine for micro-USD parse failures
 *
 * Quarantines DB rows where parseBoundaryMicroUsd fails instead of
 * silently skipping them. Supports dedup via source_fingerprint and
 * idempotent replay via replayed_at guard.
 *
 * @see grimoires/loa/sprint.md Sprint 4, Task 4.4
 * @see grimoires/loa/sdd.md §3.6 IMP-006
 */

import { createHash } from 'crypto';
import type Database from 'better-sqlite3';

// =============================================================================
// Types
// =============================================================================

export interface QuarantineEntry {
  id: number;
  originalRowId: string;
  tableName: string;
  rawValue: string;
  context: string;
  errorCode: string;
  reason: string | null;
  sourceFingerprint: string;
  replayedAt: string | null;
  replayAttempts: number;
  lastReplayError: string | null;
  createdAt: string;
}

export interface QuarantineParams {
  originalRowId: string;
  tableName: string;
  rawValue: string;
  context: string;
  errorCode: string;
  reason?: string;
}

/** Raw row interface matching the micro_usd_parse_failures SQLite table schema */
interface QuarantineRow {
  id: number;
  original_row_id: string;
  table_name: string;
  raw_value: string;
  context: string;
  error_code: string;
  reason: string | null;
  source_fingerprint: string;
  replayed_at: string | null;
  replay_attempts: number;
  last_replay_error: string | null;
  created_at: string;
}

// =============================================================================
// Fingerprint
// =============================================================================

/**
 * Compute source_fingerprint for dedup: sha256(table_name || original_row_id || raw_value || error_code)
 */
export function computeSourceFingerprint(
  tableName: string,
  originalRowId: string,
  rawValue: string,
  errorCode: string,
): string {
  return createHash('sha256')
    .update(`${tableName}||${originalRowId}||${rawValue}||${errorCode}`)
    .digest('hex');
}

// =============================================================================
// Quarantine Operations
// =============================================================================

/**
 * Quarantine a failed parse result. Uses ON CONFLICT DO NOTHING for dedup.
 * Returns true if a new row was inserted, false if already quarantined.
 */
export function quarantineParseFailure(
  db: Database.Database,
  params: QuarantineParams,
): boolean {
  const fingerprint = computeSourceFingerprint(
    params.tableName,
    params.originalRowId,
    params.rawValue,
    params.errorCode,
  );

  const result = db.prepare(`
    INSERT INTO micro_usd_parse_failures (
      original_row_id, table_name, raw_value, context, error_code, reason, source_fingerprint
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (source_fingerprint) DO NOTHING
  `).run(
    params.originalRowId,
    params.tableName,
    params.rawValue,
    params.context,
    params.errorCode,
    params.reason ?? null,
    fingerprint,
  );

  return result.changes > 0;
}

/**
 * Get quarantined rows that have not been replayed yet.
 */
export function getUnreplayedQuarantineEntries(
  db: Database.Database,
  limit = 100,
): QuarantineEntry[] {
  const rows = db.prepare(`
    SELECT * FROM micro_usd_parse_failures
    WHERE replayed_at IS NULL
    ORDER BY created_at ASC
    LIMIT ?
  `).all(limit) as QuarantineRow[];

  return rows.map(rowToEntry);
}

/**
 * Mark a quarantined row as replayed (success).
 * Sets replayed_at and increments replay_attempts in one update.
 */
export function markReplayed(
  db: Database.Database,
  id: number,
): boolean {
  const result = db.prepare(`
    UPDATE micro_usd_parse_failures
    SET replayed_at = datetime('now'),
        replay_attempts = replay_attempts + 1
    WHERE id = ? AND replayed_at IS NULL
  `).run(id);

  return result.changes > 0;
}

/**
 * Record a replay failure. Increments replay_attempts and records the error.
 * Does NOT set replayed_at (row can be retried).
 */
export function recordReplayFailure(
  db: Database.Database,
  id: number,
  error: string,
): boolean {
  const result = db.prepare(`
    UPDATE micro_usd_parse_failures
    SET replay_attempts = replay_attempts + 1,
        last_replay_error = ?
    WHERE id = ?
  `).run(error, id);

  return result.changes > 0;
}

/**
 * Purge quarantined rows older than the specified number of days.
 * Returns the count of deleted rows.
 */
export function purgeQuarantineEntries(
  db: Database.Database,
  retentionDays = 30,
): number {
  const result = db.prepare(`
    DELETE FROM micro_usd_parse_failures
    WHERE created_at < datetime('now', '-' || ? || ' days')
  `).run(retentionDays);

  return result.changes;
}

/**
 * Count total quarantined entries (for metrics/monitoring).
 */
export function countQuarantineEntries(
  db: Database.Database,
): { total: number; unreplayed: number; replayed: number } {
  const row = db.prepare(`
    SELECT
      COUNT(*) as total,
      COUNT(CASE WHEN replayed_at IS NULL THEN 1 END) as unreplayed,
      COUNT(CASE WHEN replayed_at IS NOT NULL THEN 1 END) as replayed
    FROM micro_usd_parse_failures
  `).get() as { total: number; unreplayed: number; replayed: number };

  return {
    total: row.total,
    unreplayed: row.unreplayed,
    replayed: row.replayed,
  };
}

// =============================================================================
// Row Mapper
// =============================================================================

function rowToEntry(row: QuarantineRow): QuarantineEntry {
  return {
    id: row.id,
    originalRowId: row.original_row_id,
    tableName: row.table_name,
    rawValue: row.raw_value,
    context: row.context,
    errorCode: row.error_code,
    reason: row.reason,
    sourceFingerprint: row.source_fingerprint,
    replayedAt: row.replayed_at,
    replayAttempts: row.replay_attempts,
    lastReplayError: row.last_replay_error,
    createdAt: row.created_at,
  };
}

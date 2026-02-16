/**
 * Migration 055: Reconciliation Runs (Sprint 283, Task 9.2)
 *
 * Persists reconciliation results for history queries and audit trail.
 *
 * SDD refs: §SS4.6
 * PRD refs: FR-9, FR-10
 */

export const RECONCILIATION_RUNS_SQL = `
CREATE TABLE IF NOT EXISTS reconciliation_runs (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL CHECK (status IN ('passed', 'divergence_detected', 'error')),
  checks_json TEXT NOT NULL DEFAULT '[]',
  divergence_summary_json TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
`;

export const RECONCILIATION_RUNS_ROLLBACK_SQL = `
DROP TABLE IF EXISTS reconciliation_runs;
`;

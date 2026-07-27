/**
 * Migration 069: Agent activation claim marker
 *
 * Closes the activation crash window in AgentGovernanceService.
 *
 * THE WINDOW. `activateExpiredCooldowns` claims a quorum_reached proposal by
 * writing the terminal status `activated` BEFORE creating the config it
 * applies (the proposal-status CHECK constraint has no in-progress state). A
 * thrown error releases the claim, but a hard crash — SIGKILL, OOM, container
 * eviction — cannot. The proposal is then permanently `activated` with
 * `activated_config_id IS NULL` and no config: invisible to expiry, invisible
 * to normal activation, and falsely reported as applied.
 *
 * WHY IT COULD NOT BE RECOVERED BEFORE. That row set was indistinguishable
 * from pre-recovery-mechanism LEGACY activations, whose configs (if any) were
 * created without provenance metadata. Re-running activation for a legacy row
 * would CREATE a config that supersedes whatever is currently active —
 * clobbering newer values on upgrade. Silent config corruption is worse than a
 * stranded proposal, so recovery was correctly limited to link-only.
 *
 * THE MARKER. `activation_claimed_at` is written by the claim itself and
 * cleared when a failed activation releases it. It therefore exists ONLY on
 * rows claimed by the current code path:
 *
 *   claimed + activated + no config  → hard-crash orphan, safe to re-activate
 *   NULL    + activated + no config  → legacy, must be left alone
 *
 * Additive and nullable, so every pre-existing row backfills to NULL — i.e.
 * every historical activation is treated as legacy. Zero-downtime safe.
 *
 * SDD refs: §4.4 AgentGovernanceService
 */

/** Column name guarded by `up()` — SQLite has no ADD COLUMN IF NOT EXISTS. */
const COLUMN = 'activation_claimed_at';

export const AGENT_ACTIVATION_CLAIM_MARKER_SQL = `
ALTER TABLE agent_governance_proposals ADD COLUMN ${COLUMN} TEXT;
`;

/**
 * Partial index for the two recovery arms, which scan terminal-but-unlinked
 * proposals on every hourly sweep.
 */
export const AGENT_ACTIVATION_CLAIM_MARKER_INDEX_SQL = `
CREATE INDEX IF NOT EXISTS idx_agent_proposals_unlinked_activation
  ON agent_governance_proposals(status, activated_config_id)
  WHERE status = 'activated' AND activated_config_id IS NULL;
`;

interface MigrationDb {
  exec(sql: string): void;
  prepare(sql: string): { all(...params: unknown[]): unknown[] };
}

/**
 * Run migration forward. Idempotent: a database created from the current
 * 058 schema already declares the column, so the ALTER is skipped rather than
 * failing with "duplicate column name".
 */
export function up(db: MigrationDb): void {
  const columns = db.prepare(`PRAGMA table_info(agent_governance_proposals)`).all() as Array<{ name: string }>;
  if (columns.length === 0) return; // table not created yet — 058 declares the column inline
  if (!columns.some((c) => c.name === COLUMN)) {
    db.exec(AGENT_ACTIVATION_CLAIM_MARKER_SQL);
  }
  db.exec(AGENT_ACTIVATION_CLAIM_MARKER_INDEX_SQL);
}

/**
 * Rollback. SQLite < 3.35 has no DROP COLUMN and the column is nullable and
 * harmless to leave; only the index is removed.
 */
export function down(db: MigrationDb): void {
  db.exec(`DROP INDEX IF EXISTS idx_agent_proposals_unlinked_activation;`);
}

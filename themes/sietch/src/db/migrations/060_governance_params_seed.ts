/**
 * Migration 060: Governance Parameter Seed (Sprint 289, Task 6.2)
 *
 * Seeds ALL 10 new parameters (2 transfer + 8 governance) into system_config
 * as active rows. Uses INSERT OR IGNORE for idempotency.
 *
 * The 2 transfer params were added to CONFIG_SCHEMA/FALLBACKS in Sprint 3 (Task 3.3).
 * The 8 governance params were added to CONFIG_SCHEMA/FALLBACKS in Sprint 6 (Task 6.2).
 * This migration makes them available as database rows for constitutional governance.
 *
 * SDD refs: §3.3 Constitutional Parameters
 * PRD refs: FR-1.7, FR-3.1
 */

// =============================================================================
// Parameter Seed Data
// =============================================================================

const SEED_PARAMS = [
  // Transfer params (Sprint 3)
  { key: 'transfer.max_single_micro', value: 100_000_000, description: 'Max single transfer ($100)' },
  { key: 'transfer.daily_limit_micro', value: 500_000_000, description: 'Daily transfer limit ($500)' },

  // Governance params (Sprint 6)
  { key: 'governance.agent_quorum_weight', value: 10, description: 'Quorum weight threshold' },
  { key: 'governance.agent_cooldown_seconds', value: 86_400, description: 'Cooldown (24h)' },
  { key: 'governance.max_delegation_per_creator', value: 5, description: 'Max delegations per creator' },
  { key: 'governance.agent_weight_source', value: '"delegation"', description: 'Weight computation strategy' },
  { key: 'governance.fixed_weight_per_agent', value: 1, description: 'Fixed weight per agent' },
  { key: 'governance.reputation_window_seconds', value: 2_592_000, description: 'Reputation window (30d)' },
  { key: 'governance.reputation_scale_factor', value: 1, description: 'Reputation scale factor' },
  { key: 'governance.max_weight_per_agent', value: 10, description: 'Max weight cap per agent' },
];

// =============================================================================
// Migration SQL
// =============================================================================

function generateSeedSQL(): string {
  const statements: string[] = [];

  for (let i = 0; i < SEED_PARAMS.length; i++) {
    const p = SEED_PARAMS[i];
    const id = `seed-060-${String(i + 1).padStart(3, '0')}`;
    const valueJson = typeof p.value === 'string' ? p.value : JSON.stringify(p.value);

    // Ensure version sequence exists
    statements.push(`
      INSERT OR IGNORE INTO system_config_version_seq (param_key, entity_type, current_version)
      VALUES ('${p.key}', NULL, 0);
    `);

    // Bump version
    statements.push(`
      UPDATE system_config_version_seq
      SET current_version = current_version + 1
      WHERE param_key = '${p.key}' AND entity_type IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM system_config
          WHERE param_key = '${p.key}' AND entity_type IS NULL AND status = 'active'
        );
    `);

    // Seed active config row (skip if already active)
    statements.push(`
      INSERT OR IGNORE INTO system_config (
        id, param_key, entity_type, value_json, config_version,
        status, proposed_by, proposed_at, approval_count, required_approvals,
        activated_at, created_at
      )
      SELECT
        '${id}',
        '${p.key}',
        NULL,
        '${valueJson}',
        (SELECT current_version FROM system_config_version_seq WHERE param_key = '${p.key}' AND entity_type IS NULL),
        'active',
        'migration-060',
        strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
        2,
        2,
        strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
        strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE NOT EXISTS (
        SELECT 1 FROM system_config
        WHERE param_key = '${p.key}' AND entity_type IS NULL AND status = 'active'
      );
    `);
  }

  return statements.join('\n');
}

export const GOVERNANCE_SEED_SQL = generateSeedSQL();

export const GOVERNANCE_SEED_ROLLBACK_SQL = `
-- Remove seeded config rows
DELETE FROM system_config WHERE proposed_by = 'migration-060';
-- Note: version sequences are NOT rolled back (monotonic)
`;

/**
 * Run migration forward.
 */
export function up(db: { exec(sql: string): void }): void {
  db.exec(GOVERNANCE_SEED_SQL);
}

/**
 * Rollback migration.
 */
export function down(db: { exec(sql: string): void }): void {
  db.exec(GOVERNANCE_SEED_ROLLBACK_SQL);
}

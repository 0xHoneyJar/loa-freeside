/**
 * Migration 058: Agent Governance Tables (Sprint 289, Task 6.1)
 *
 * Creates three tables for agent governance participation:
 *   - agent_governance_proposals: parameter change proposals by agents
 *   - agent_governance_votes: weighted votes on proposals
 *   - agent_governance_delegations: creator→agent weight delegation
 *
 * One open proposal per (param_key, entity_type) enforced by partial unique index.
 * One vote per (proposal_id, voter_account_id) enforced by composite PK.
 * One delegation per (creator, agent) enforced by unique constraint.
 *
 * SDD refs: §3.1.3 agent_governance_proposals, §3.1.4 agent_governance_votes, §4.4.2a delegations
 * PRD refs: FR-3.1 through FR-3.8
 */

// =============================================================================
// Agent Governance Tables
// =============================================================================

export const AGENT_GOVERNANCE_SQL = `
-- =============================================================================
-- agent_governance_proposals: Parameter change proposals by agents
-- =============================================================================
-- Agents can propose changes to whitelisted governance parameters.
-- Proposals accumulate weighted votes until quorum, then enter cooldown.

CREATE TABLE IF NOT EXISTS agent_governance_proposals (
  id TEXT PRIMARY KEY,
  param_key TEXT NOT NULL,
  entity_type TEXT,
  proposed_value TEXT NOT NULL,
  justification TEXT,
  proposer_account_id TEXT NOT NULL REFERENCES credit_accounts(id),
  proposer_weight REAL NOT NULL CHECK (proposer_weight >= 0),
  total_weight REAL NOT NULL DEFAULT 0 CHECK (total_weight >= 0),
  required_weight REAL NOT NULL CHECK (required_weight > 0),
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'quorum_reached', 'activated', 'rejected', 'expired', 'admin_overridden')),
  cooldown_ends_at TEXT,
  activated_config_id TEXT REFERENCES system_config(id),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- One open proposal per parameter (prevents proposal flooding)
CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_proposals_active
  ON agent_governance_proposals(param_key, COALESCE(entity_type, '__global__'))
  WHERE status = 'open';

CREATE INDEX IF NOT EXISTS idx_agent_proposals_status
  ON agent_governance_proposals(status);

CREATE INDEX IF NOT EXISTS idx_agent_proposals_proposer
  ON agent_governance_proposals(proposer_account_id);

-- =============================================================================
-- agent_governance_votes: Weighted votes on proposals
-- =============================================================================
-- Each agent can vote once per proposal. Weight is computed server-side.

CREATE TABLE IF NOT EXISTS agent_governance_votes (
  proposal_id TEXT NOT NULL REFERENCES agent_governance_proposals(id),
  voter_account_id TEXT NOT NULL REFERENCES credit_accounts(id),
  vote TEXT NOT NULL CHECK (vote IN ('support', 'oppose')),
  weight REAL NOT NULL CHECK (weight >= 0),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (proposal_id, voter_account_id)
);

CREATE INDEX IF NOT EXISTS idx_agent_votes_voter
  ON agent_governance_votes(voter_account_id);

-- =============================================================================
-- agent_governance_delegations: Creator → Agent weight delegation
-- =============================================================================
-- Creators can delegate governance weight to their agents.
-- Per-creator cap enforced by governance.max_delegation_per_creator parameter.

CREATE TABLE IF NOT EXISTS agent_governance_delegations (
  id TEXT PRIMARY KEY,
  creator_account_id TEXT NOT NULL REFERENCES credit_accounts(id),
  agent_account_id TEXT NOT NULL REFERENCES credit_accounts(id),
  weight REAL NOT NULL CHECK (weight > 0),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  revoked_at TEXT,
  UNIQUE (creator_account_id, agent_account_id)
);

CREATE INDEX IF NOT EXISTS idx_agent_delegations_agent
  ON agent_governance_delegations(agent_account_id)
  WHERE active = 1;

CREATE INDEX IF NOT EXISTS idx_agent_delegations_creator
  ON agent_governance_delegations(creator_account_id)
  WHERE active = 1;
`;

export const AGENT_GOVERNANCE_ROLLBACK_SQL = `
DROP INDEX IF EXISTS idx_agent_delegations_creator;
DROP INDEX IF EXISTS idx_agent_delegations_agent;
DROP TABLE IF EXISTS agent_governance_delegations;
DROP INDEX IF EXISTS idx_agent_votes_voter;
DROP TABLE IF EXISTS agent_governance_votes;
DROP INDEX IF EXISTS idx_agent_proposals_proposer;
DROP INDEX IF EXISTS idx_agent_proposals_status;
DROP INDEX IF EXISTS idx_agent_proposals_active;
DROP TABLE IF EXISTS agent_governance_proposals;
`;

/**
 * Run migration forward.
 */
export function up(db: { exec(sql: string): void }): void {
  db.exec(AGENT_GOVERNANCE_SQL);
}

/**
 * Rollback migration.
 */
export function down(db: { exec(sql: string): void }): void {
  db.exec(AGENT_GOVERNANCE_ROLLBACK_SQL);
}

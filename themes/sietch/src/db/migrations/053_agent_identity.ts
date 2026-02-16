/**
 * Migration 053: Agent Identity & Provenance (Sprint 281, Task 7.1)
 *
 * Creates the agent_identity table for canonical on-chain identity anchoring.
 * Each agent has a unique (chain_id, contract_address, token_id) tuple that
 * serves as its immutable identity anchor. Creator provenance links agent
 * accounts to their creator accounts for KYC cascade.
 *
 * SDD refs: §SS3.1, §SS4.5
 * PRD refs: FR-3
 */

export const AGENT_IDENTITY_SQL = `
-- =============================================================================
-- agent_identity: Canonical on-chain identity anchor for agents
-- =============================================================================
-- Each agent has exactly one identity record linking it to its creator
-- and its on-chain NFT identity (chain_id, contract_address, token_id).
-- tba_address is reserved for Phase 2 ERC-6551 TBA binding.

CREATE TABLE IF NOT EXISTS agent_identity (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  account_id TEXT NOT NULL UNIQUE REFERENCES credit_accounts(id),
  chain_id INTEGER NOT NULL,
  contract_address TEXT NOT NULL,
  token_id TEXT NOT NULL,
  tba_address TEXT,
  creator_account_id TEXT NOT NULL REFERENCES credit_accounts(id),
  creator_signature TEXT,
  verified_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (chain_id, contract_address, token_id)
);

-- Index for creator lookups (all agents owned by a creator)
CREATE INDEX IF NOT EXISTS idx_agent_identity_creator
  ON agent_identity(creator_account_id);
`;

export const AGENT_IDENTITY_ROLLBACK_SQL = `
DROP INDEX IF EXISTS idx_agent_identity_creator;
DROP TABLE IF EXISTS agent_identity;
`;

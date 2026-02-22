/**
 * Migration 063: Agent Threads (Cycle 036, Task 1.3)
 *
 * Creates the agent_threads table for tracking Discord thread ownership
 * by NFT holders. Each thread is tied to an NFT and a community, with
 * periodic ownership re-verification.
 *
 * SDD refs: §4.1 Thread Management
 * PRD refs: FR-4.2 NFT-Gated Agent Access
 */

export const AGENT_THREADS_SQL = `
-- =============================================================================
-- agent_threads: NFT-gated Discord thread registry
-- =============================================================================
-- Each agent thread is owned by an NFT holder and tied to a community.
-- Ownership is periodically re-verified (ownership_verified_at).
-- thread_id is the Discord thread snowflake ID.

CREATE TABLE IF NOT EXISTS agent_threads (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  nft_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  thread_id TEXT NOT NULL UNIQUE,
  owner_wallet TEXT NOT NULL,
  community_id TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_active_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ownership_verified_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Active threads per community
CREATE INDEX IF NOT EXISTS idx_agent_threads_community
  ON agent_threads(community_id, is_active)
  WHERE is_active = 1;

-- Threads per NFT (for ownership queries)
CREATE INDEX IF NOT EXISTS idx_agent_threads_nft
  ON agent_threads(nft_id);

-- Threads per wallet (for user dashboard)
CREATE INDEX IF NOT EXISTS idx_agent_threads_wallet
  ON agent_threads(owner_wallet);

-- Stale ownership check (threads needing re-verification)
CREATE INDEX IF NOT EXISTS idx_agent_threads_verify
  ON agent_threads(ownership_verified_at)
  WHERE is_active = 1;
`;

export const AGENT_THREADS_ROLLBACK_SQL = `
DROP INDEX IF EXISTS idx_agent_threads_verify;
DROP INDEX IF EXISTS idx_agent_threads_wallet;
DROP INDEX IF EXISTS idx_agent_threads_nft;
DROP INDEX IF EXISTS idx_agent_threads_community;
DROP TABLE IF EXISTS agent_threads;
`;

/**
 * Migration 066: Agent Messages (Cycle 036, Sprint 1, Task 1.4)
 *
 * Creates the agent_messages table for storing conversation messages across
 * all surfaces (web, Discord, Telegram, API). Separate from agent_threads
 * metadata (migration 063) per GPT finding F-5.
 *
 * This table is the single source of truth for conversation history,
 * enabling cross-channel synchronization (Sprint 4, Task 4.6).
 *
 * Indexed on (thread_id, created_at) for efficient history queries.
 *
 * SDD refs: §4.1 Thread Management, §4.6 Channel Synchronization
 * PRD refs: FR-3.1 Discord Threads, FR-3.7 Web Chat
 *
 * PORTABILITY NOTE (Bridge high-2): This migration uses SQLite-specific syntax.
 * For PostgreSQL (RDS production), equivalent migration required:
 *   - lower(hex(randomblob(16))) → gen_random_uuid()::text
 *   - strftime('%Y-%m-%dT%H:%M:%fZ', 'now') → NOW()
 *   - REFERENCES agent_threads(thread_id) recommended for FK integrity (medium-1)
 * See: themes/sietch/src/db/migrations/README.md for dialect strategy.
 */

export const AGENT_MESSAGES_SQL = `
-- =============================================================================
-- agent_messages: Cross-channel conversation message store
-- =============================================================================
-- Stores all messages from all surfaces (web, discord, telegram, api).
-- Linked to agent_threads via thread_id for unified conversation history.
-- source field tracks message origin for channel sync.

CREATE TABLE IF NOT EXISTS agent_messages (
  message_id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  thread_id TEXT NOT NULL,
  nft_id TEXT NOT NULL,
  community_id TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'discord'
    CHECK (source IN ('web', 'discord', 'telegram', 'api')),
  author_wallet TEXT,
  discord_user_id TEXT,
  content TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user'
    CHECK (role IN ('user', 'assistant', 'system')),
  token_usage_input INTEGER NOT NULL DEFAULT 0 CHECK (token_usage_input >= 0),
  token_usage_output INTEGER NOT NULL DEFAULT 0 CHECK (token_usage_output >= 0),
  pool_id TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Primary query pattern: fetch conversation history for a thread (paginated)
CREATE INDEX IF NOT EXISTS idx_agent_messages_thread_created
  ON agent_messages(thread_id, created_at);

-- Query by NFT (for admin dashboards)
CREATE INDEX IF NOT EXISTS idx_agent_messages_nft
  ON agent_messages(nft_id, created_at);

-- Query by community (for admin dashboards)
CREATE INDEX IF NOT EXISTS idx_agent_messages_community
  ON agent_messages(community_id, created_at);

-- Query by source (for channel sync metrics)
CREATE INDEX IF NOT EXISTS idx_agent_messages_source
  ON agent_messages(source, created_at);
`;

export const AGENT_MESSAGES_ROLLBACK_SQL = `
DROP INDEX IF EXISTS idx_agent_messages_source;
DROP INDEX IF EXISTS idx_agent_messages_community;
DROP INDEX IF EXISTS idx_agent_messages_nft;
DROP INDEX IF EXISTS idx_agent_messages_thread_created;
DROP TABLE IF EXISTS agent_messages;
`;

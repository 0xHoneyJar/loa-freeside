-- ScyllaDB Schema for Arrakis Scaling Initiative
-- Sprint S-3: ScyllaDB & Observability Foundation
-- Per SDD §6.3

-- Create keyspace (if not exists)
-- Note: For ScyllaDB Cloud Serverless, keyspace may be pre-created
CREATE KEYSPACE IF NOT EXISTS arrakis
WITH replication = {
  'class': 'NetworkTopologyStrategy',
  'aws-us-east-1': 3
} AND durable_writes = true;

USE arrakis;

-- =============================================================================
-- Table 1: scores (hot path - current scores with rank ordering)
-- Partition: community_id
-- Clustering: current_rank ASC, profile_id ASC (for leaderboard queries)
-- =============================================================================
CREATE TABLE IF NOT EXISTS scores (
    community_id UUID,
    profile_id UUID,
    conviction_score DECIMAL,
    activity_score DECIMAL,
    current_rank INT,
    updated_at TIMESTAMP,
    PRIMARY KEY ((community_id), current_rank, profile_id)
) WITH CLUSTERING ORDER BY (current_rank ASC, profile_id ASC)
   AND default_time_to_live = 0
   AND gc_grace_seconds = 86400
   AND compaction = {'class': 'LeveledCompactionStrategy'};

-- =============================================================================
-- Table 2: scores_by_profile (lookup by profile)
-- Partition: community_id, profile_id (direct lookup)
-- =============================================================================
CREATE TABLE IF NOT EXISTS scores_by_profile (
    community_id UUID,
    profile_id UUID,
    conviction_score DECIMAL,
    activity_score DECIMAL,
    current_rank INT,
    updated_at TIMESTAMP,
    PRIMARY KEY ((community_id, profile_id))
) WITH default_time_to_live = 0
   AND gc_grace_seconds = 86400
   AND compaction = {'class': 'LeveledCompactionStrategy'};

-- =============================================================================
-- Table 3: score_history (time-series with TTL)
-- Partition: community_id, profile_id, day (time-bucketed)
-- Clustering: event_time DESC (newest first)
-- TTL: 90 days (7776000 seconds)
-- =============================================================================
CREATE TABLE IF NOT EXISTS score_history (
    community_id UUID,
    profile_id UUID,
    day DATE,
    event_time TIMESTAMP,
    score_before DECIMAL,
    score_after DECIMAL,
    delta DECIMAL,
    event_type TEXT,
    tx_hash TEXT,
    PRIMARY KEY ((community_id, profile_id, day), event_time)
) WITH CLUSTERING ORDER BY (event_time DESC)
   AND default_time_to_live = 7776000
   AND gc_grace_seconds = 86400
   AND compaction = {'class': 'TimeWindowCompactionStrategy', 'compaction_window_size': 1, 'compaction_window_unit': 'DAYS'};

-- =============================================================================
-- Table 4: leaderboards (pre-computed, paginated)
-- Partition: community_id, leaderboard_type, bucket (pagination bucket)
-- Clustering: rank ASC
-- =============================================================================
CREATE TABLE IF NOT EXISTS leaderboards (
    community_id UUID,
    leaderboard_type TEXT,
    bucket INT,
    rank INT,
    profile_id UUID,
    display_name TEXT,
    score DECIMAL,
    tier TEXT,
    updated_at TIMESTAMP,
    PRIMARY KEY ((community_id, leaderboard_type, bucket), rank)
) WITH CLUSTERING ORDER BY (rank ASC)
   AND default_time_to_live = 0
   AND gc_grace_seconds = 86400
   AND compaction = {'class': 'LeveledCompactionStrategy'};

-- =============================================================================
-- Table 5: eligibility_snapshots (cached eligibility checks)
-- Partition: community_id, profile_id
-- TTL: 5 minutes (300 seconds) - short-lived cache
-- =============================================================================
CREATE TABLE IF NOT EXISTS eligibility_snapshots (
    community_id UUID,
    profile_id UUID,
    wallet_address TEXT,
    rule_id UUID,
    is_eligible BOOLEAN,
    token_balance TEXT,
    checked_at TIMESTAMP,
    block_number BIGINT,
    PRIMARY KEY ((community_id, profile_id), rule_id)
) WITH default_time_to_live = 300
   AND gc_grace_seconds = 60
   AND compaction = {'class': 'LeveledCompactionStrategy'};

-- =============================================================================
-- Indexes (materialized views for common query patterns)
-- =============================================================================

-- Index for looking up profiles by wallet address within a community
CREATE INDEX IF NOT EXISTS idx_eligibility_wallet
ON eligibility_snapshots (wallet_address);

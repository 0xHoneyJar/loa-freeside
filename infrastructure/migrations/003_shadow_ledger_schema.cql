-- Shadow Ledger Schema (ScyllaDB)
--
-- Sprint S-24: Incumbent Detection & Shadow Ledger
--
-- ScyllaDB tables for shadow mode coexistence tracking.
-- Tracks incumbent vs Arrakis eligibility for proving accuracy.
--
-- @see SDD §7.1.3 Shadow Ledger Schema

-- =============================================================================
-- Shadow Member State
-- =============================================================================

-- Current shadow state per member
-- Partitioned by guild_id for guild-level queries
CREATE TABLE IF NOT EXISTS arrakis.shadow_member_state (
    guild_id TEXT,
    user_id TEXT,
    incumbent_roles SET<TEXT>,      -- Snapshot of current roles
    arrakis_eligible BOOLEAN,       -- Would Arrakis grant access?
    arrakis_tier TEXT,              -- What tier would Arrakis assign?
    conviction_score DECIMAL,       -- Conviction score from Arrakis
    divergence_flag BOOLEAN,        -- Does incumbent != Arrakis?
    last_sync_at TIMESTAMP,
    PRIMARY KEY ((guild_id), user_id)
) WITH comment = 'Shadow mode member state tracking'
  AND compaction = {'class': 'SizeTieredCompactionStrategy'}
  AND gc_grace_seconds = 86400
  AND default_time_to_live = 7776000; -- 90 days

-- Index for querying divergent members
CREATE INDEX IF NOT EXISTS shadow_member_state_divergence_idx
    ON arrakis.shadow_member_state (divergence_flag);

-- =============================================================================
-- Divergence Tracking
-- =============================================================================

-- Divergence history between incumbent and Arrakis states
-- Partitioned by (guild_id, user_id) for member-level queries
-- Clustered by detected_at DESC for newest-first retrieval
CREATE TABLE IF NOT EXISTS arrakis.shadow_divergences (
    guild_id TEXT,
    user_id TEXT,
    detected_at TIMESTAMP,
    incumbent_state TEXT,           -- JSON: {hasRole, roles}
    arrakis_state TEXT,             -- JSON: {eligible, tier, score}
    divergence_type TEXT,           -- 'false_positive' | 'false_negative'
    resolved BOOLEAN,
    resolved_at TIMESTAMP,
    PRIMARY KEY ((guild_id, user_id), detected_at)
) WITH CLUSTERING ORDER BY (detected_at DESC)
  AND comment = 'Divergence tracking between incumbent and Arrakis'
  AND compaction = {'class': 'TimeWindowCompactionStrategy', 'compaction_window_unit': 'DAYS', 'compaction_window_size': 7}
  AND gc_grace_seconds = 86400
  AND default_time_to_live = 7776000; -- 90 days

-- Index for querying by divergence type
CREATE INDEX IF NOT EXISTS shadow_divergences_type_idx
    ON arrakis.shadow_divergences (divergence_type);

-- Index for querying unresolved divergences
CREATE INDEX IF NOT EXISTS shadow_divergences_resolved_idx
    ON arrakis.shadow_divergences (resolved);

-- =============================================================================
-- Prediction Tracking
-- =============================================================================

-- Prediction tracking for accuracy validation
-- Partitioned by guild_id for guild-level queries
CREATE TABLE IF NOT EXISTS arrakis.shadow_predictions (
    prediction_id UUID,
    guild_id TEXT,
    user_id TEXT,
    predicted_at TIMESTAMP,
    prediction_type TEXT,           -- 'role_grant' | 'role_revoke' | 'tier_change'
    predicted_value TEXT,
    verified_at TIMESTAMP,
    actual_value TEXT,
    correct BOOLEAN,
    PRIMARY KEY ((guild_id), prediction_id)
) WITH comment = 'Prediction tracking for shadow mode accuracy validation'
  AND compaction = {'class': 'SizeTieredCompactionStrategy'}
  AND gc_grace_seconds = 86400
  AND default_time_to_live = 7776000; -- 90 days

-- Index for querying unverified predictions
CREATE INDEX IF NOT EXISTS shadow_predictions_verified_idx
    ON arrakis.shadow_predictions (verified_at);

-- Index for querying by correctness
CREATE INDEX IF NOT EXISTS shadow_predictions_correct_idx
    ON arrakis.shadow_predictions (correct);

-- =============================================================================
-- Materialized Views (for efficient queries)
-- =============================================================================

-- Guild-level divergence summary (for dashboard)
CREATE MATERIALIZED VIEW IF NOT EXISTS arrakis.shadow_divergences_by_guild AS
    SELECT guild_id, detected_at, divergence_type, resolved
    FROM arrakis.shadow_divergences
    WHERE guild_id IS NOT NULL
      AND detected_at IS NOT NULL
      AND user_id IS NOT NULL
    PRIMARY KEY ((guild_id), detected_at, user_id)
WITH CLUSTERING ORDER BY (detected_at DESC)
  AND comment = 'Divergences grouped by guild for dashboard queries';

-- User predictions by verification status (for batch verification)
CREATE MATERIALIZED VIEW IF NOT EXISTS arrakis.shadow_predictions_unverified AS
    SELECT guild_id, prediction_id, user_id, predicted_at, prediction_type, predicted_value
    FROM arrakis.shadow_predictions
    WHERE guild_id IS NOT NULL
      AND prediction_id IS NOT NULL
      AND verified_at IS NULL
    PRIMARY KEY ((guild_id), predicted_at, prediction_id)
WITH CLUSTERING ORDER BY (predicted_at ASC)
  AND comment = 'Unverified predictions for batch verification';

-- =============================================================================
-- Coexistence Configuration (PostgreSQL - for reference)
-- =============================================================================
-- Note: Coexistence config is stored in PostgreSQL communities table
-- This comment documents the expected schema additions:
--
-- ALTER TABLE communities ADD COLUMN coexistence_mode TEXT DEFAULT 'disabled';
-- ALTER TABLE communities ADD COLUMN incumbent_info JSONB;
-- ALTER TABLE communities ADD COLUMN shadow_sync_interval_hours INT DEFAULT 6;
-- ALTER TABLE communities ADD COLUMN last_shadow_sync_at TIMESTAMP;
-- ALTER TABLE communities ADD COLUMN shadow_accuracy DECIMAL(5,4);
-- ALTER TABLE communities ADD COLUMN shadow_start_date DATE;

-- =============================================================================
-- Migration 0015a: Event Sourcing Indexes — CONCURRENTLY
-- Sprint 4, Task 4.2 (AC-4.2.1 through AC-4.2.4)
--
-- IMPORTANT: This migration MUST run with transaction: false
-- CREATE INDEX CONCURRENTLY cannot run inside a transaction block.
-- =============================================================================

-- AC-4.2.1: Replay index — sequence-ordered events per community
-- Used by replayState() to fetch events in monotonic order
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_lot_entries_replay
    ON lot_entries(community_id, sequence_number ASC)
    WHERE sequence_number IS NOT NULL;

-- AC-4.2.2: Velocity index — time-ordered entries for hourly rollup
-- Used by debit-rollup-job to aggregate lot_entries by hour
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_lot_entries_velocity
    ON lot_entries(community_id, created_at, id)
    WHERE entry_type = 'debit';

-- =============================================================================
-- AC-4.2.4: Operational verification
-- After applying this migration, run to verify no INVALID indexes:
--
--   SELECT indexname, indexdef
--   FROM pg_indexes
--   WHERE tablename = 'lot_entries'
--     AND indexdef LIKE '%INVALID%';
--
-- Expected result: 0 rows
-- =============================================================================

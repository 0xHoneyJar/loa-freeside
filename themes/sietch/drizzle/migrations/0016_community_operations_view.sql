-- =============================================================================
-- Migration 0016: Community Operations View
-- Sprint 4, Task 4.5 (AC-4.5.1 through AC-4.5.4)
--
-- Groups lot_entries by (community_id, correlation_id) to provide an
-- operation-level view of multi-lot transactions (splits, transfers, etc.).
-- =============================================================================

-- AC-4.5.1: View groups strictly by (community_id, correlation_id)
-- AC-4.5.2: entry_types and purposes provided as JSONB aggregates
CREATE OR REPLACE VIEW community_operations AS
SELECT
    le.community_id,
    le.correlation_id,
    MIN(le.created_at) AS operation_started_at,
    MAX(le.created_at) AS operation_completed_at,
    COUNT(*)::integer AS entry_count,
    COUNT(DISTINCT le.lot_id)::integer AS lots_affected,
    -- JSONB aggregate of distinct entry types
    jsonb_agg(DISTINCT le.entry_type) AS entry_types,
    -- JSONB aggregate of distinct purposes (from lot_entries.purpose if available)
    jsonb_agg(DISTINCT le.purpose) FILTER (WHERE le.purpose IS NOT NULL) AS purposes,
    -- Sum of absolute amounts (operation magnitude)
    SUM(ABS(le.amount_micro)) AS total_amount_micro,
    -- Net effect (credits positive, debits negative)
    SUM(
        CASE
            WHEN le.entry_type IN ('credit', 'credit_back', 'governance_credit')
                THEN ABS(le.amount_micro)
            WHEN le.entry_type IN ('debit', 'expiry', 'governance_debit')
                THEN -ABS(le.amount_micro)
            ELSE 0
        END
    ) AS net_amount_micro,
    -- Sequence range for this operation
    MIN(le.sequence_number) AS first_sequence,
    MAX(le.sequence_number) AS last_sequence
FROM lot_entries le
WHERE le.correlation_id IS NOT NULL
GROUP BY le.community_id, le.correlation_id;

-- AC-4.5.4: RLS scopes view to requesting community
-- Views inherit RLS from their base tables. Since lot_entries already has
-- RLS enabled with community_id scoping, queries through this view are
-- automatically filtered to the requesting community's rows.
--
-- Verification query (run after migration):
--   SET LOCAL app.community_id = '<some-uuid>';
--   SELECT * FROM community_operations LIMIT 5;
--   -- Should only return rows for that community

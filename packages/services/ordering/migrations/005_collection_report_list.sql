-- CR-206 — cursor list for collection-report orders by community.
-- community_ref lives on inputs JSON (resolution binding).

CREATE INDEX IF NOT EXISTS orders_collection_report_community_cursor_idx
  ON orders (
    ((inputs ->> 'community_ref')),
    created_at_unix DESC,
    order_id DESC
  )
  WHERE product = 'collection-report';

CREATE INDEX IF NOT EXISTS orders_collection_report_subject_cursor_idx
  ON orders (
    placed_by,
    ((inputs ->> 'community_ref')),
    created_at_unix DESC,
    order_id DESC
  )
  WHERE product = 'collection-report';

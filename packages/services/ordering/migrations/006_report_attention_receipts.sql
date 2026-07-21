-- CR-305 — per-subject report-attention seen receipts.
-- Keyed by (subject_ref, source_kind, source_id, transition_sequence).
-- Mark-seen never mutates order lifecycle state.

CREATE TABLE IF NOT EXISTS report_attention_receipts (
  subject_ref TEXT NOT NULL,
  source_kind TEXT NOT NULL,
  source_id TEXT NOT NULL,
  transition_sequence BIGINT NOT NULL,
  community_ref TEXT NOT NULL,
  seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (subject_ref, source_kind, source_id, transition_sequence)
);

CREATE INDEX IF NOT EXISTS report_attention_receipts_subject_community_idx
  ON report_attention_receipts (subject_ref, community_ref);

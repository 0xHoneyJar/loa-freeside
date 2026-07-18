# Changelog

## 0.2.0

- Breaking: `AuditInputs` now seals `{ sources, rule }` rather than the
  single-deployment `{ chain, contract, snapshot_block, rule }` shape.
- Breaking: `AccessDecisionRecord.provenance.evidence_source` is now required
  so each balance can be re-derived against the exact deployment that supplied
  it. Pre-0.2 records must be migrated with their source `{ chain, contract }`
  before parsing, or retained under the producer's 0.1 protocol lineage.
- Existing stored `inputs_hash` and derived `run_id` values are not comparable
  with values emitted by 0.2.0. Replay and correlation consumers must retain
  the producer protocol version or treat pre-0.2 values as a separate lineage.

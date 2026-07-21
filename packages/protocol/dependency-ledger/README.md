# `@freeside/dependency-ledger-protocol`

CR-012A public Ordering reverse-dependency ledger and inbox closure for
collection-report. Distinct from producer-local outboxes — Ordering is the
authoritative reverse index without claiming a cross-service transaction.

## Scope

- **Dependency edge body contract** — evidence and invalidation edges carried
  inside CR-009 trust envelopes (`collection-report.dependency-edge.v1`).
- **Inbox intake** — chains CR-013 `gateSignedIntake()` with CR-009
  `ingestTrustEnvelope()` before persisting edges idempotently by `event_id`.
- **Closure + quarantine** — derivatives stay unfulfillable until required edge
  sets and producer watermarks close; equivalence revocation and key compromise
  enumerate reachable derivatives and deny fulfillment.
- **Reconciliation** — bidirectional lost/delayed edge detection with quarantine
  metrics for repair deadlines.
- **Shared fixtures** — lost, duplicated, delayed, compromise, backfill, and
  mixed-minor enforcement vectors for G1B-2 (`EV-G1B2-closure-backfill`).

## CR-011A dependency (honest)

This package implements the **Ordering consumer/inbox** side only. Sonar
public trust-stream producer adoption (**CR-011A**, bead `f09.43`) is still
open — G1B-1 end-to-end replay (`EV-G1B1-sonar-ordering-replay`) cannot pass
until that producer lands. Ordering intake is ready against CR-009/CR-013
contracts using shared fixture envelopes.

## Adoption

1. Pin a CR-013 registry snapshot and healthy `TimeHealthSnapshot`.
2. Construct `DependencyLedgerInboxState` per Ordering instance.
3. Call `ingestDependencyEdgeEnvelope()` for each signed producer outbox edge.
4. Gate fulfillment on `DerivativeClosureRecord.fulfillable === true`.
5. Run `reconcileLedger()` on a schedule against producer outbox expectations.

## Related

- `@freeside/trust-envelope-protocol` — CR-009 envelope wire contract
- `@freeside/signing-key-custody-protocol` — CR-013 intake gate + registry
- `grimoires/loa/coordination/collection-report/owner-acceptance.md` — ledger ownership

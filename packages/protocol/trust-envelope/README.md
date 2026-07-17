# `@freeside/trust-envelope-protocol`

CR-009 signed trust-envelope wire contract for collection-report Ordering
dependency intake. Distinct from the events-pillar `acvp-l1-v2` NATS envelope.

The package owns:

- strict header/body envelope schemas and decoders;
- Ed25519 signing bytes (JCS + SHA-256 digest, empty-string signature placeholder);
- fixture service-key registry binding (producer, capability, tenant scope);
- producer signing helpers and consumer inbox/stream verification;
- shared rotation, revocation, replay, expiry, gap-repair, retention, and
  disaster-recovery fixtures consumed by planned producers and Ordering replay.

Canonical rules:

- header fields bind producer, signing key, contract, event ID, stream ID,
  epoch/sequence, issued/expiry, tenant/privacy scope digest, capability, and
  body digest;
- `event_id` is the idempotency key; contiguous sequence is enforced only when
  `trust_stream` is true;
- epoch reset requires a signed complete baseline before a new epoch is accepted;
- unknown contract major or required-field violation fails closed; mixed-minor
  acceptance is explicit in `versioning.ts`;
- Ordering database `accepted_at` evaluates issued/expiry (30s future skew).

Production signing-key custody remains CR-013. This package publishes wire
semantics and non-production fixture keys only.

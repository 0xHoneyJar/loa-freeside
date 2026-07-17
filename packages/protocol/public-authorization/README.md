# `@freeside/public-authorization-protocol`

CR-007A public subject-resource-action contract for T0/T1 boundaries.

Ordering is the grant authority for `report:create`, `report:read`, and
capability-demand permissions on the public path. Identity API membership
streams and restricted grants (`report:identity-read`, artifact access) are
CR-007B.

This package defines:

- public permission literals and the protected resource/action matrix;
- BFF wire scopes with strict decoders;
- membership/grant projection watermarks and 30-second authorization leases;
- fixture-backed ACL vectors for cross-user, cross-community, revoked
  membership, and client scope tampering.

HTTP wiring and durable projection ingestion remain in `@freeside/ordering-service`.

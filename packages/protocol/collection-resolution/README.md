# `@freeside/collection-resolution-protocol`

CR-006's versioned, shared durable resolution and stale-selection wire contract.

The package owns resolution create/confirm/refresh commands, the immutable
confirmed-resolution record shape (including the complete original create-request
material required to re-probe), order-admission bindings, selection validation,
selection-relevant freshness comparison, local capability admission
compatibility, deep-clone/freeze boundary helpers, and domain-separated digests.
Ordering is the sole writer and system of record; Sonar remains a stateless probe
consumer of CR-001 candidates and never persists resolution sessions.

External input must enter through the exported `decode*` functions. They decode
`unknown` with excess-property errors enabled. Candidate snapshot digests and
selection digests are always recomputed server-side; client-supplied digests are
never order truth.

Canonical rules:

- schema version is `1`;
- resolution sessions expire exactly 15 minutes after server create; confirm
  retains the existing `expires_at`; only an unchanged expired refresh may
  establish the next 15-minute server expiry under the protocol;
- refresh is bound to the persisted immutable original request — a supplied
  request must match it canonically, so collection A can never be refreshed as B;
- a valid selection is exactly one candidate deployment or a non-empty subset of
  one explicitly evidenced logical-equivalence group;
- every selection-relevant candidate semantic (recognition, index/readiness,
  metadata quality, deployments, grouping, network, standard, provenance,
  finality, identity, capability, authorization) participates in stale detection;
  only an explicit narrow display-only allowlist is ignored;
- compatible newer local capability snapshots are checked field-by-field
  (operation, identity_digest, health, standard, finality, equivalence/revocation,
  authorization, registry sequence); a recognize view cannot satisfy prepare;
  capability views are a strict unique set keyed by `(deployment_id, operation)` —
  identical and contradictory duplicates both fail closed;
- retained idempotency keys replay the exact historical sealed response even after
  later CAS transitions or session expiry; replay never rolls current store truth back;
- exact-command fingerprints use RFC-8785 canonical material (not raw
  `JSON.stringify`); create consults the idempotency ledger before Sonar probe;
  confirm consults retained accepted commands before expiry/digest/selection/CAS;
- optional refresh `suppliedRequest` is strict-decoded (excess-property-free)
  before comparison; unchecked caller input is never cloned into fingerprints;
- any selection-relevant change yields typed `selection_stale` and requires
  reconfirmation;
- order input carries only `resolution_id`, `candidate_snapshot_digest`, and
  scope — raw client candidate metadata is refused.

The fixtures are protocol publication artifacts. `Dashboard` and `Sonar`
consumer-shaped tests intentionally decode the same committed files; HTTP
authorization endpoints and production Postgres adapters remain downstream work
(CR-007A / persistence adapter).

## Pre-existing Ordering failures (out of CR-006 scope)

These failures are **not** introduced by the collection-resolution surface; they
come from a schema drift around a `metadata_snapshot` ingredient key that is
referenced by Ordering community-onboarding / fulfillment code but is absent
from the current Ordering protocol ingredient schema:

| Suite | Symptom |
|-------|---------|
| `packages/services/ordering` `tsc --noEmit` | Multiple `TS2339` / `TS2353` / `TS2345` on `metadata_snapshot` in `community-onboarding-orchestrator.ts`, `fulfillment-orchestrator.ts`, and their tests |
| `intake.test.ts` / `projection.test.ts` | Expect `ingredients.metadata_snapshot: "pending"` or reject unrecognized `metadata_snapshot` key |

Do not treat these as CR-006 regressions. Resolution-focused suites
(`resolution-service` / `resolution-store`) and this protocol package are the
acceptance surface for CR-006.

---
artifact: projection
projection_type: consumer-contract-guide
rendered_from: precis.md @ content_hash 4fc9104c4e76a869
status: awaiting-P3-acceptance
taint: fixture-simulated
use_label: use_as_background_only
date: 2026-07-19
---

# Consumer Contract Guide — Collection-Report (CR) Protocol Surfaces

## How to read this

- Every claim below cites its `[E*-NNN]` id from the précis (`grimoires/loa/precis/cr-contract-corpus/precis.md`) — that document, not this guide, is canonical.
- Items under **OPEN TENSIONS** are unresolved as of the corpus freeze — do not build on them as settled; verify current behavior before depending on them.
- This guide is a rendering: it reorganizes and phrases précis claims for sonar-api, freeside-dashboard, freeside-characters, and ordering-cell consumers. It adds no new claims and drops no carried/unresolved claim.
- MUST/NEVER rows are `invariant`-class claims; "kept out by design" bullets are `boundary`-class; "compat commitments" are `versioning`-class. `rationale` and `rejected-alternative` claims from the précis are process/historical notes, not consumer-facing commitments, and are not rendered here.
- Review-thread-sourced claims (`model_output` provenance) are evidence, never authority, per the précis reading guide.

## Collection Protocol

`packages/protocol/collection` (CR-001)

### MUST / NEVER

| Rule | Citation |
|---|---|
| The collection-protocol compatibility harness (CR #480) binds package identity, schema identity, source identity, and the complete compatibility fixture set together into one verifiable manifest. | [E1-057] |
| The harness pack/verify CLIs build from a fresh isolated staging copy rather than trusting the checkout's existing dist/ output, so stale or tampered generated files cannot influence the produced artifact. | [E1-060] |
| The harness's manifest/identity JSON parsing detects and rejects duplicate JSON keys before schema decoding, avoiding JSON.parse last-writer-wins ambiguity so no two readers see different documents. | [E1-061] |
| A collection maps to exactly one world, and global (chain, contract) uniqueness is enforced as a repository-level key. | [E3-034] |
| Collection identity is composite on chainId — the same contract address is a different collection on a different chain — so the chainId prefix must never be stripped. | [E3-041] |
| External input to the collection protocol enters only through the exported decode* functions, which decode unknown with excess-property errors enabled and validate digest integrity for deployment, identity, and candidate contracts. | [E4-002] |
| Canonicalization follows RFC 8785/JCS object-key ordering, NFC-normalizes strings/keys before UTF-8 encoding, rejects lone Unicode surrogates and non-JSON values with typed errors, and treats arrays as ordered unless the schema declares a sorted-set rule. | [E4-003] |
| EVM collection/deployment identity uses lowercase comparison form while preserving the original display address; Solana identity comparison is case-sensitive; logical collection_id excludes mutable name/symbol/image/alias data. | [E4-004] |
| Canonical string encoding rejects lone Unicode surrogate values with a typed CanonicalEncodingError before any JSON stringification (RFC 8785). | [E4-007] |
| Canonicalizing an object sorts entries by NFC-normalized key in UTF-16 lexical order and fails if two distinct original keys collide after NFC normalization. | [E4-008] |
| Canonicalization has no representation for undefined/unsupported JSON value types; absent properties must be omitted, never encoded as undefined. | [E4-009] |
| sortCanonicalSet sorts members bytewise by canonicalized key and fails with DuplicateCanonicalSetMemberError if two members canonicalize identically, enforcing sorted-set uniqueness at the primitive shared by every sorted-set field. | [E4-010] |
| Every versioned digest is a SHA-256 hash over a canonical envelope of {domain, major_version, value}, so digest domain and contract major version are cryptographically bound into the preimage, not metadata alongside it. | [E4-011] |
| The protocol defines eight domain-separated digest domains (deployment, identity, candidate, provenance, work_key, evidence, cache_key, report_input) as compile-time frozen constants. | [E4-012] |
| An EVM CollectionDeploymentRef is valid only if normalized_address equals the lowercase raw address; a Solana ref only if normalized_address retains exact original case — a schema-level filter, not documentation. | [E4-013] |
| A deployment_id VersionedDigest is schema-valid only if tagged with the collection.deployment v1 digest domain; other-domain/version digests are rejected at decode time, not just at comparison. | [E4-014] |
| CollectionDeployments must be a non-empty array forming a strictly sorted, unique set keyed by each deployment's versioned deployment_id; duplicate/out-of-order lists are schema-invalid. | [E4-015] |
| A CollectionIdentity's equivalence_basis cardinality is enforced against its deployments: single_deployment requires exactly one deployment; every other kind requires at least two. | [E4-016] |
| A CollectionCandidate's finality_policies must cover every network referenced by its identity's deployments exactly once (no missing, no duplicate), enforced as a struct-level filter. | [E4-017] |
| Digest-bearing decoders (deployment, identity, candidate) recompute the canonical digest material and reject with ContractIntegrityError if the supplied deployment_id/collection_id does not match — decoders trust schema shape but never trust a caller-supplied digest value. | [E4-018] |
| The protocol distinguishes 'ordered' from 'sorted-set' semantics per field: deployments/finality_policies/deployment_ids/evidence_digests are sorted sets keyed by a versioned digest or network key, while provenance/ranking_reasons are ordered arrays in source-precedence / resolver-ranking order. | [E4-020] |
| Solana public-key validity base58-decodes the string and requires exactly 32 bytes (minimal big-endian length plus leading '1'/zero-byte characters); the 32-44 character count is only a pre-filter. The excluded base58 chars are {0, uppercase O, uppercase I, lowercase l} — lowercase 'o' is valid, so case-differing keys are legitimate distinct identities. | [E4-022] |
| An EIP-155 network reference must be a positive decimal string; '0' is explicitly rejected. | [E4-023] |
| RegistrySequence values are bounded decimal strings within the unsigned 64-bit range, rejecting leading-zero, non-numeric, and overflow forms, with BigInt used for comparison to avoid lexical-ordering and precision bugs. | [E4-024] |
| A CapabilityRegistryBaseline is valid only if it introduces a genuinely new registry epoch (previous_registry_epoch != version.registry_epoch), resets registry_sequence to '0', and its baseline_digest uses the capability.registry-baseline v1 domain. | [E4-025] |
| compareCapabilityRegistryVersions refuses to order two registry versions across different epochs, failing with RegistryEpochMismatchError rather than falling back to a heuristic ordering. | [E4-026] |
| advanceCapabilityRegistryVersion permits an epoch_reset transition only with an installed baseline whose previous/version fields exactly match current and candidate and whose candidate sequence is '0'; a same-epoch advance requires strictly increasing sequence or fails with RegistrySequenceRegressionError. | [E4-027] |

### Kept out by design

- Downstream consumers (Sonar, Dashboard) must pin the produced tarball plus manifest and run the shared verify-only entrypoint before install/tests, and must consume the package's own fixtures rather than fork/duplicate the schemas. [E1-063]
- Token standard must never be assumed erc721 when ERC-165 is inconclusive; it must be classified unknown and routed to ratify-only. [E3-037]
- CR-001's collection-protocol package is the versioned, shared cross-VM collection wire contract (identity/candidate/provenance/readiness/token-standard/equivalence/registry-version/finality-policy/digest), covering EVM and Solana. [E4-001]
- The collection_id digest is computed only from schema_version, the ordered set of deployment_ids, and equivalence_basis — display metadata (name, symbol, image, collection_key) is deliberately excluded from identity-defining material; collection_key is a belt routing alias, not the identity. [E4-019]

### Compat commitments

- The collection protocol is pinned at COLLECTION_PROTOCOL_VERSION 1.0.0 / SCHEMA_VERSION 1, with every struct's schema_version a literal pinned to that version — no schema-version negotiation within v1. [E4-021]

## Collection Resolution

`packages/protocol/collection-resolution` (CR-006 / CR-303)

### MUST / NEVER

| Rule | Citation |
|---|---|
| The collection-resolutions HTTP endpoint (POST /v1/collection-resolutions create/confirm/refresh) is authenticated via service-token auth. | [E1-065] |
| CR-303 admits collection-report orders only when bound to a confirmed resolution digest. | [E1-067] |
| Candidate snapshot digests and selection digests are always recomputed server-side; client-supplied digests are never treated as order truth. | [E4-029] |
| A resolution session expires exactly 15 minutes after server create; confirm retains the existing expires_at (no extension); only an unchanged, expired refresh may establish the next 15-minute expiry. | [E4-030] |
| A refresh command is bound to the persisted immutable original create-request material and must match it canonically — a collection identified as A can never be refreshed as if it were collection B — and the resolution record binds request/scope/candidate snapshot/selection/capability/expiry immutably. | [E4-031] |
| A valid selection is exactly one candidate deployment, or a non-empty subset of one explicitly evidenced logical-equivalence group — cross-candidate composition is never valid. | [E4-032] |
| Every selection-relevant candidate semantic (recognition, index/readiness, metadata quality, deployments, grouping, network, standard, provenance, finality, identity, capability, authorization) participates in staleness detection; only a narrow display-only allowlist is ignored. | [E4-033] |
| Retained idempotency keys always replay the exact historical sealed response, even after later CAS transitions or session expiry — replay never rolls current store truth backward. | [E4-035] |
| Exact-command fingerprints are computed from RFC-8785 canonical material rather than raw JSON.stringify; create consults the idempotency ledger before probing Sonar, and confirm consults retained accepted commands before checking expiry/digest/selection/CAS. | [E4-036] |
| An optional refresh suppliedRequest is strict-decoded (excess-property-free) before comparison to the persisted original request; unchecked caller input is never cloned into fingerprint material. | [E4-037] |
| Any selection-relevant change to a candidate snapshot yields a typed selection_stale signal and requires reconfirmation before the resolution can be used further. | [E4-038] |
| Public create/refresh projections carry the server-computed candidate_snapshot_digest (so clients can echo it into confirm) but omit the requester, authorization scope, original request, request digest, and full candidate snapshot fields. | [E4-039] |
| SelectionStaleError enumerates eighteen distinct staleness reasons, giving the staleness taxonomy per-cause granularity rather than one generic 'stale' reason. | [E4-043] |
| SelectionRejectedError's taxonomy explicitly names address_only_identity, alias_guessing, and client_digest_forgery as distinct refusal categories — the schema anticipates and names these selection-boundary attacks rather than folding them into a generic rejection. | [E4-044] |
| Order admission binding carries only resolution_id, candidate_snapshot_digest, and scope; assertNoRawCandidateOrderFields enumerates a fixed forbidden-key list (candidates, candidate_snapshot, selected_deployment_ids, deployments, identity, token_standard, provenance) and fails with ContractIntegrityError, mechanically enforcing that raw client candidate metadata is never order truth. | [E4-048] |
| LocalCapabilityDeploymentView: every field participates in admission compatibility and UI omission never authorizes ignoring a field; a recognize-operation view can never satisfy a prepare-operation admission; views form a strict unique set keyed by (deployment_id, operation). | [E4-049] |
| decodeLocalCapabilitySnapshot canonicalizes views as a unique sorted set keyed by (deployment_id, operation); identical duplicates and contradictory duplicates both fail closed, never resolved by first-match. | [E4-050] |
| The single owning decodeCollectionCandidate decoder (verifying deployment_id and collection_id against canonical digest material beyond shape) is the one every candidate-bearing boundary must compose — there is no lighter shape-only path. | [E4-051] |
| The display-only freshness allowlist is exactly ranking_reasons, identity.name, identity.symbol, and identity.image; every other candidate field participates in selection-relevant staleness comparison. | [E4-052] |
| Admission requires exactly a prepare-operation capability view per selected deployment; a recognize-only or missing view cannot satisfy admission, and a degraded-health view is tolerated only when the local registry version is not newer than required. | [E4-055] |
| Local capability registry receipts have a staleness ceiling: if receipt_age_ms exceeds staleness_ceiling_ms, admission fails closed with CapabilityViewStaleError (receipt_stale) before any per-deployment compatibility check. | [E4-056] |
| A valid selection can never span more than 32 deployments (MAX_SELECTED_DEPLOYMENTS); exceeding it fails with SelectionRejectedError ceiling_exceeded. | [E4-057] |
| rejectAddressOnlyIdentity refuses selection input supplying a bare address without selected_deployment_ids, and separately refuses any input carrying an alias field — both are identity-guessing shortcuts refused at the selection boundary. | [E4-059] |

### Kept out by design

- CR-006 designates Ordering as the sole writer and system of record for resolution sessions; Sonar remains a stateless probe consumer of CR-001 candidates and never persists resolution sessions. [E4-028]
- Admission evaluation is scoped to only the selected deployment set: capability views for unrelated deployments in the same snapshot are decoded but neither consulted nor digest-bound, so adding an unrelated collection's view never changes an already-valid order decision. [E4-054]

### Compat commitments

- CR-006 production persistence lands via expand migration 004 adding a durable collection_resolutions table plus an idempotency ledger (sealed digests, Sonar resolve-probe client, catalog fallback). [E1-064]
- CR-006 is pinned at protocol 1.0.0 / SCHEMA_VERSION 1; RESOLUTION_TTL_MS is 15 minutes and IDEMPOTENCY_KEY_RETENTION_MS is 24 hours, after which reuse of a key is treated as a new command. [E4-045]

## Dependency Ledger

`packages/protocol/dependency-ledger` (CR-012A)

### MUST / NEVER

| Rule | Citation |
|---|---|
| Inbox intake chains CR-013 gateSignedIntake() with CR-009 ingestTrustEnvelope() before persisting edges idempotently by event_id — signature/custody gating strictly before trust-envelope ingestion, strictly before idempotent persistence. | [E4-062] |
| Derivatives stay unfulfillable until required edge sets and producer watermarks close; equivalence revocation and signing-key compromise each enumerate every reachable derivative through a reverse index and deny fulfillment for all of them. | [E4-063] |
| The dependency-ledger adoption contract requires consumers to gate fulfillment strictly on DerivativeClosureRecord.fulfillable === true and to run reconcileLedger() on a schedule against producer outbox expectations. | [E4-065] |
| DEFAULT_EDGE_REPAIR_DEADLINE_MS sets a 5-minute repair deadline before unresolved dependency-edge gaps escalate. | [E4-066] |
| A dependency edge is valid only if edge_kind==='invalidation' implies an invalidation payload is present; an invalidation-kind edge with no invalidation is rejected with invalid_invalidation_edge. | [E4-069] |
| Edge ingestion is idempotent by event_id: a duplicate event_id short-circuits to the existing edge (incrementing duplicate_replays) before re-running trust-envelope/capability checks; a second edge_id with a different event_id is rejected as edge_id_conflict. | [E4-070] |
| An incoming envelope must declare capability exactly DEPENDENCY_EDGE_CAPABILITY (collection-report.dependency-edge.v1); any other value is rejected as capability_mismatch even after passing signed-intake and trust-envelope checks. | [E4-071] |
| Any invalidation edge (signing_key_compromised or collection_equivalence_revoked) is an absolute veto: the first invalidation edge forces state 'denied' and fulfillable:false, overriding whatever required/watermark state the remaining edges imply. | [E4-072] |
| A derivative reaches 'closed' (fulfillable:true) only when every required_edge_id has been received AND every edge's source_watermark sequence is satisfied by the best-known watermark; missing required edges or a lagging watermark quarantine it instead. | [E4-073] |
| applyCompromiseDenial and applyEquivalenceRevocation each use a reverse index to enumerate every derivative reachable from a compromised key or revoked equivalence digest and force each to 'denied' — the denial is deliberately global across all affected derivatives, not scoped to the one edge that reported it. | [E4-074] |
| Reconciliation classifies gaps as lost_edge (an expected producer-outbox edge entirely absent) and delayed_edge (a watermark lagging the expected sequence or unobserved); both quarantine the affected derivative via refreshDerivativeClosure. | [E4-075] |

### Kept out by design

- The CR-012A dependency-ledger inbox deliberately excludes fake Ready/fulfillment unlock, the CR-007B restricted path, Postgres persistence, production registry pin, and shared-work fan-in (reserved for CR-201A/204A). [E2-025]
- The dependency-ledger package (CR-012A) is Ordering's public reverse-dependency ledger and inbox closure, distinct from producer-local outboxes — Ordering is the authoritative reverse index without claiming a cross-service transaction. [E4-061]
- findOrphanEdges defines an orphan as an edge whose derivative_key is not in the caller-supplied knownDerivativeKeys set — orphan detection is scoped to the reconciliation caller's declared known-derivative universe, not the ledger's full internal state. [E4-076]

### Compat commitments

- The dependency-ledger protocol commits to fixture test vectors covering lost, duplicate, delayed, compromise, backfill, and mixed-minor scenarios as its compatibility contract. [E2-028]
- The dependency-edge body is versioned as collection-report.dependency-edge major 1 / supported minor 0; assertMixedMinor rejects any incoming edge with schema_minor > 0 as unsupported_schema_minor (remediation upgrade_consumer), enforcing the mixed-minor window mechanically. [E4-067]

## Public Authorization

`packages/protocol/public-authorization` (CR-007A)

### MUST / NEVER

| Rule | Citation |
|---|---|
| Public-auth HTTP mounts are refused (not mounted) in deployed environments when write posture is disabled_no_token (no SERVICE_TOKEN); deployed envs default public auth disabled and report routes fail-closed without auth. | [E2-009] |
| CR-007A public-path permissions are a closed set of five literals (report:create, report:read, demand:create, demand:read, demand:withdraw); restricted grants (report:identity-read, artifact access) and Identity API membership streams are explicitly CR-007B, not this package. | [E5-001] |
| Client-supplied community_ref/subject_id claims on a PublicAuthorizationScope are never authoritative; Ordering revalidates them against its own membership/grant projections at the boundary, and HTTP edges never trust query scope alone. | [E5-002] |
| Public-path authorization leases have a fixed maximum lifetime of 30,000ms (30s) for interactive protected reads and mutations. | [E5-003] |
| Membership/grant projection watermarks are fresh only within a 60,000ms (60s) ceiling; once exceeded, authorization fails closed regardless of underlying membership/grant state. | [E5-004] |
| authorizePublicOperation fails closed with reason unsupported_permission whenever the requested resource+action has no entry in REQUIRED_PERMISSION — there is no default-allow for unmapped operations. | [E5-005] |
| authorizePublicOperation runs a fixed independent gate order — permission-match, projection freshness, authoritative-scope (tamper), membership, then grant — and any single gate failing aborts the whole check fail-closed with its own reason code; Cache-Control: no-store on the lease path. | [E5-006] |
| A caller-supplied community_ref not matching the server's authoritativeCommunityRef is rejected as reason scope_tamper / safe_code authorization_scope_mismatch — a distinct fail-closed gate independent of membership/grant checks. | [E5-007] |
| A caller-supplied subject_id not matching authoritativeSubjectId is rejected under a distinct reason (cross_subject) from community tampering (scope_tamper), but both map to the identical public safe_code authorization_scope_mismatch — the BFF-facing response never reveals which dimension was tampered. | [E5-008] |
| Every public-authorization wire schema (scope, watermarks, lease, denial) decodes with errors:'all' and onExcessProperty:'error' — any excess/unknown field on the wire fails the decode, not just a schema_version mismatch. | [E5-013] |

### Kept out by design

- PUBLIC_AUTH_MODE must remain unset in production (ordering.0xhoneyjar.xyz) until CR-007B Identity projections land; fixture subjects must never be promoted as real community members. [E2-008]
- The AuthorizationDenial envelope returned to BFF callers is narrowed to {schema_version, code, reason} (closed literal enums on both fields), so no cross-tenant or cross-subject identifying detail is surfaced in a denial. [E5-009]
- The CR-006->public-authorization bridge (resolutionScopeToPublic) accepts only report:create and refuses (scope_tamper) to synthesize a scope for any resolution scope missing an explicit community_ref — it will not infer or default a community. [E5-010]
- HTTP wiring and durable projection ingestion are deliberately kept out of the public-authorization package; both remain owned by @freeside/ordering-service. This package is contract/decision logic only. [E5-011]

## Signing-Key Custody

`packages/protocol/signing-key-custody` (CR-013)

### MUST / NEVER

| Rule | Citation |
|---|---|
| SigningKeyRegistryDocument requires at least one key, integer registry_generation >= 1, max_staleness_ms >= 1, a 64-hex distribution_digest, and a schema_version pinned to the single custody schema literal — an empty-keys registry or fractional/zero staleness cannot decode. | [E5-014] |
| Fixture signing keys are identified purely mechanically: any signing_key_id containing the literal substring '-fixture-' is fixture, any id without it is production — there is no separate out-of-band flag; CR-013 also maintains a pinned registry distribution with explicit fixture-vs-production key-class separation. | [E5-015] |
| A key's custody_backend must match its key_class: fixture keys must use 'local-fixture'; production keys must use one of aws-kms/gcp-kms/azure-keyvault/vault-transit/cloudhsm. Any other pairing is a key_class_backend_mismatch. | [E5-016] |
| validateKeyClassMechanics rejects any key whose declared key_class disagrees with its signing_key_id naming pattern (invalid_key_id_pattern); a production key wearing a fixture-shaped id additionally carries remediation emergency_revoke rather than a soft warning. | [E5-017] |
| PinnedKeyRegistry's constructor enforces every key's key_class matches the enclosing document's key_class_scope; a mismatch throws ContractIntegrityError at construction, before any intake request is evaluated. | [E5-019] |
| A registry document is stale purely from observedAtMs minus its own published_at exceeding its own max_staleness_ms — staleness is registry-local and self-declared, not a fixed global constant. | [E5-020] |
| resolveForIntake evaluates a fixed gate order — registry freshness, key existence, key-class authorization for the requested context, compromise flag, then active/revoked status — and the first failing gate wins. | [E5-021] |
| Production and fixture signing material can never satisfy each other's intake context: assertProductionAuthorizedKey rejects any non-production key_class as fixture_key_in_production_context (fail_closed_until_recovery), and assertFixtureKeyOnly symmetrically rejects any non-fixture key_class as production_key_in_fixture_context. | [E5-022] |
| The signer-layer authorization check mirrors the registry's prod/fixture boundary: a production context paired with a local-fixture backend (or non-production keyClass) is rejected as fixture_key_in_production_context before any signing. | [E5-023] |
| signWithBackend requires a remote backend's healthCheck() to report ok before attempting sign(); a failing health check surfaces as SigningBackendError(operation:health_check) rather than allowing a raw sign against a possibly-unavailable KMS/HSM. | [E5-024] |
| validateRotationOverlap rejects any RotationEvent whose overlap_ends_at is not strictly after overlap_starts_at as rotation_overlap_invalid, independent of whether the evaluation instant falls inside that window. | [E5-025] |
| applyCompromiseToKeys always sets compromise:true AND back-fills revoked_at from the compromise event's detected_at when the key had no prior revoked_at — a compromise can never leave a key merely flagged-but-unrevoked. | [E5-027] |
| applyRevocationToKeys sets revoked_at from the event and defaults compromise to false only when previously undefined — an existing compromise:true is never silently reset by a later revocation. | [E5-028] |
| EmergencyRevocationPlan's quarantine_signed_intake field is typed as the literal true, not boolean — emergency revocation and quarantining signed intake are contractually inseparable; no representable plan revokes a compromised key without also quarantining intake. | [E5-029] |
| Database clock-skew evaluation fails closed with insufficient_time_sources whenever fewer than MIN_INDEPENDENT_TIME_SOURCES (2) authoritative sources are supplied, before any offset/uncertainty is computed; CR-013 time-health blocks signed intake when clock skew exceeds 2s or time sources are insufficient. | [E5-030] |
| When authoritative time sources span more than one region, the per-region median unix_ms is computed and intake blocks as time_source_divergence if the spread across regional medians exceeds 500ms (default) — this regional check runs independently of and prior to the raw db-vs-source skew comparison. | [E5-031] |
| If a lastGoodAt timestamp is provided and its age exceeds 15x maxSkewMs (30s at the 2s default), intake blocks as database_clock_unknown even when instantaneous measured skew would pass — a prolonged absence of a passing check is treated as an unknown clock, not 'probably still fine'. | [E5-032] |
| The skew comparison against the 2s ceiling uses effectiveSkew = \|measuredOffset\| + maxSourceUncertainty, so a source with wide uncertainty bounds tightens the practical margin rather than being ignored. | [E5-033] |

### Kept out by design

- satisfiesProductionReleaseGate requires every key in a set to independently pass assertProductionAuthorizedKey (production key_class + production backend + valid id), so a fixture-scoped registry can structurally never satisfy a production release gate (G1B-4). [E5-018]
- PinnedKeyRegistry.overlappingRotationWindow delegates directly to the trust-envelope ServiceKeyRegistry.overlappingRotationWindow, deliberately reusing CR-009's key-activity definition rather than defining a separate CR-013 notion of 'active'. [E5-026]
- The signing-key-custody package excludes private key material from the repo entirely: production custody is KMS/HSM-backed via RemoteSigningBackend, LocalFixtureSigningBackend (in-process signing) is fixture-only, and the package is expand-only with no production private keys committed. [E5-035]

## Trust Envelope

`packages/protocol/trust-envelope` (CR-009)

### MUST / NEVER

| Rule | Citation |
|---|---|
| CR-009 ratifies the Ordering trust-envelope wire contract with Ed25519/JCS signing, strict decoders, stream sequencing, and epoch baselines, plus shared producer/consumer fixtures for rotation, revocation, replay, expiry, gap-repair, and disaster recovery. | [E3-023] |
| A CR-009 TrustEnvelopeHeader binds producer, signing_key_id, contract ref, event_id, stream_id, stream_epoch, sequence, trust_stream flag, issued_at/expires_at, tenant_scope_digest, capability, and body_digest into one struct signed as a unit — none of these fields can be altered independently of the signature. | [E5-036] |
| event_id is the idempotency key for every envelope, but contiguous-sequence enforcement (gap detection, ordering) applies only when trust_stream is true — non-trust-stream envelopes get event_id-only deduplication with no ordering semantics. | [E5-037] |
| Epoch reset is fail-closed both directions: a trust-stream envelope whose stream_epoch is below the consumer's current epoch is rejected as epoch_resume_forbidden, and one above current is rejected as epoch_baseline_required until a signed StreamEpochBaseline for the new epoch is installed. | [E5-038] |
| Mixed-minor acceptance is explicit and asymmetric: unknown major always fails closed (rejected before signature verification); a consumer accepts any envelope schema_minor <= its supported minor and rejects anything higher; strict decoders reject unknown/excess fields regardless of minor. | [E5-039] |
| verifyTrustEnvelope runs a fixed gate order — schema major/minor, body-digest match, key existence, key active/revoked, producer binding, capability binding, tenant-scope binding, issued-in-future, expiry, then Ed25519 signature — each an independent fail-closed check, signature verification last. | [E5-042] |
| Minimum trust-stream retention is 86,400,000ms (24h), covering live resolution/order reconciliation (SDD §11.1); the consumer rejects further ingestion as retention_violation (remediation request_replay_range) once the oldest retained acceptedAt falls outside that window. | [E5-044] |
| replayEnvelopeIdempotently short-circuits as a true idempotent replay (accepted, replay:true, no re-verification) only when the prior envelope's event_id equals the incoming event_id AND that event_id is already in seenEventIds; a mismatched prior/incoming event_id is rejected outright as event_id_replay. | [E5-048] |
| Installing a new stream-epoch baseline requires the baseline's stream_epoch strictly greater than the previous epoch (epoch_not_advanced otherwise), its baseline_digest exactly equal to an independently-computed expectedBaselineDigest (baseline_incomplete otherwise), and a valid Ed25519 signature from a known active key — only then does the consumer reset its gap set and adopt highest_sequence as the new floor. | [E5-049] |
| A ServiceSigningKey is 'active' only if compromise is not true, activated_at is at/before the evaluation instant, and (when present) revoked_at is strictly after it. The compromise check is evaluated first and short-circuits regardless of activation/revocation timing. | [E5-050] |
| overlappingRotationWindow requires previous and next keys to share the same producer, both be independently active at the instant, and have different signing_key_ids — a rotation can never be valid across two producers, and rotation into an already-revoked/compromised key never counts as a valid overlap. | [E5-051] |
| Signing bytes for both TrustEnvelope and StreamEpochBaseline are computed over the JCS-canonicalized structure with the signature field forced to an empty-string placeholder, then SHA-256 hex-digested and UTF-8 encoded — canonicalization strictly before hashing, and the signature never covers itself. signTrustEnvelope rewrites signing_key_id + body_digest before signing so a producer cannot desync body from signature. | [E5-052] |
| jcsCanonicalize fails closed (throws) rather than silently coercing whenever its input is not JSON-representable (functions, symbols, Infinity, NaN, BigInt without toJSON, or undefined at root) — canonicalization never lossy-serializes an unrepresentable value. | [E5-055] |

### Kept out by design

- The CR-009 trust envelope is explicitly declared distinct from the events-pillar acvp-l1-v2 NATS envelope despite a superficially similar 'signed envelope' shape — the two are not interchangeable. [E5-053]
- Production signing-key custody is out of scope for the trust-envelope package and remains owned by CR-013; this package publishes wire semantics and non-production fixture keys only. [E5-054]

### Compat commitments

- The compatibility commitment 'required-field additions require a major bump' is stated only as a doc comment and an inert mixedMinorRules constant (never consulted by any decoder), so nothing mechanically prevents a future minor from adding a required field — the guarantee rests on author discipline, not code. [E5-040]
- Trust-stream sequence acceptance is strictly contiguous, one envelope at a time: on sequence_gap the consumer records the missing range for repair but must NOT commit the envelope's event_id and must NOT advance highestContiguousSequence, so redelivery after gap repair remains possible. This corrects the v1.0.0 release logic (commit 0804dfb1, which committed event_id and auto-advanced across gaps via a while-loop) with no package.json version bump (fix commit 0791a090). [E5-045]

## Collection-Report Gates

`packages/collection-report-gates` (CR-019)

### MUST / NEVER

| Rule | Citation |
|---|---|
| check-gate-manifest exits 0 for a valid manifest, 1 for validation findings, and 2 for usage/I-O errors — distinguishing 'ran and found problems' from 'could not run'. | [E4-078] |
| Static contract/schema evidence must declare valid_until:superseded; dynamic security/privacy/external-policy/load/operational evidence must declare max_age_days plus a renewal owner. | [E4-079] |
| A gate can never pass or resolve No-go using unrecorded or expired evidence, and evaluation uses the manifest's own evaluated_at instant rather than wall-clock time — making gate evaluation deterministic and replayable. | [E4-080] |
| Before a manifest may set status:owner_approved, approvals must contain one signed Ed25519 digest receipt per distinct gate owner, each binding owner + signing instant + exact approval-scope manifest digest, with the owner-to-key binding from an independently supplied keyring; individual gate states still advance only with their own evidence — approval and gate-state progression are separate authority tracks. | [E4-081] |
| Each required ACCEPT-* task must carry a domain-separated repository-owner Ed25519 receipt binding acceptance task, repository, repo-owner role, exact reviewed commit, immutable GitHub tree URI, artifact digest, accepted/rejected state, and validity interval before its tier can become release-ready; file presence, filenames, and prose are never interpreted as acceptance. | [E4-083] |
| Tier reports distinguish 'structurally possible' from 'release-ready' as separate claims, and a pending branch is never described as ready merely because no No-go has closed it — tier tables and checkpoint diagrams remain summaries and cannot independently authorize release. | [E4-084] |
| Task/gate reference IDs must be one canonical, fully-suffixed ID (CR-NNN with optional single uppercase suffix, or ACCEPT-<REPO>); ranges are forbidden in the manifest. | [E4-085] |
| Owner roles must match a kebab-case role-name pattern and are never person names — an authorization/approval identity in the manifest is always a role. | [E4-087] |
| Repository acceptance is a separate authority domain from manifest gate-owner approval: repositoryAcceptanceSigningPayload uses a distinct domain-separation prefix, so a gate-owner signature can never be replayed as repository-owner acceptance. | [E4-089] |
| An Evidence item's validity is a schema-level union (ValiditySuperseded \| ValidityExpiring) with no default — a missing validity policy is invalid, making every evidence item's validity shape-required. | [E4-090] |
| IsoTimestamp validation is two-stage: a regex shape check plus a real-instant filter that round-trips the parsed Date's UTC components against the original string — a shape-valid but calendrically impossible timestamp is rejected. | [E4-091] |
| A Tier's tasks field is the exhaustive transitive closure of tasks required to release that tier (cumulative over lower tiers), and validate.ts recomputes and rejects drift — the list can never silently under-claim its closure. | [E4-092] |
| A Checkpoint's serial_spine requires every task in stage n+1 to transitively depend on at least one task in stage n and no earlier-stage task to depend on a later-stage task; both directions are validated mechanically (CHECKPOINT_ORDER_CONTRADICTION). Allowing disconnected stage arrays was rejected because it would let a checkpoint diagram imply sequencing the authoritative DAG does not enforce. | [E4-093] |
| A FeatureFlag's controlled_by_gates listing means every listed gate must be 'pass' before the flag may be enabled (PREMATURE_FLAG). | [E4-094] |
| validate.ts enforces that a 'pass' gate can never depend on a non-pass gate (IMPOSSIBLE_BRANCH) and that any evidence attached to a passing gate must have been recorded (PASS_WITHOUT_EVIDENCE). | [E4-096] |
| A gate may be state 'no_go' only if it declares an on_no_go consequence block; a no_go gate with no on_no_go is rejected as an impossible branch, so only gates with real go/no-go semantics may carry no_go. | [E4-097] |
| A gate's on_no_go.closes_tiers is validated against each named tier's actual gate-dependency transitive closure (NO_GO_TIER_VIOLATION if the tier's closure doesn't include the gate), and a claimed preserves_tiers entry is rejected symmetrically if the closure does include it. | [E4-098] |
| Tier task-closure validation is bidirectional: a declared tier.tasks list is TIER_NOT_CLOSED if it misses anything the recomputed transitive closure requires and TIER_OVERCLAIM if it contains tasks outside that closure — the declared closure can neither under- nor over-claim relative to the computed DAG. | [E4-099] |
| Repository-acceptance coverage requires every repository owning a CR task inside a tier's transitive closure to have a corresponding ACCEPT-* boundary-acceptance task for that tier (sprint.md §13: an unaccepted boundary remains blocked); a missing one triggers ACCEPTANCE_MISSING. | [E4-101] |
| A flag can be enabled only if it names a release tier, manifest status is owner_approved, every controlled_by_gates gate is 'pass', and every ACCEPT-* task for that tier has current valid repository-owner acceptance — any single missing condition is PREMATURE_FLAG. | [E4-102] |
| A tier is release_ready only when there are zero manifest-wide findings, the tier is structurally possible, manifest status is owner_approved, every transitively-required gate is 'pass', and every acceptance task has current valid owner acceptance — release_ready is a conjunction across the whole manifest's validity, not a per-tier-local check. | [E4-103] |
| The task-reference resolver distinguishes three unknown-reference outcomes — genuinely unknown (UNKNOWN_CR), implicit-suffix with known suffixed variants (IMPLICIT_SUFFIX), and task-kind mismatch (TASK_KIND_MISMATCH) — never collapsed into one generic reference error; UNKNOWN_CR is task-wide (TASK_ID_PATTERN includes ACCEPT-*). | [E4-104] |
| Dependency-cycle detection runs independently over the task-dependency and gate-dependency graphs using a deterministic three-color DFS over lexically sorted IDs, so cycle findings are reproducible rather than declaration-order-dependent. | [E4-105] |
| Dynamic evidence validity has four coupled temporal constraints against evaluated_at: unrecorded evidence must not carry an absolute valid_until, recorded evidence must carry a concrete valid_until, valid_until must be strictly after recorded_at, and valid_until must not exceed recorded_at + max_age_days — each violation a distinct finding. | [E4-106] |
| When evidence with a dynamic validity policy has valid_until at or before evaluated_at, the gate is marked hasExpiredEvidence and, if its declared state is still pass/pending, raises EXPIRED_EVIDENCE calling that state 'dishonest — it must be expired'. | [E4-107] |
| Manifest gate-owner approval verification requires: the approval's owner owns a declared gate, it was signed no later than evaluated_at, its manifest_digest equals the independently recomputed approval-scope digest, its key_id matches an independently pinned authority record, and the Ed25519 signature verifies — any single failure yields a distinct finding. Non-gate-owner approvals invalidate the manifest via MANIFEST_APPROVAL_MISSING (no authorization bypass). | [E4-108] |
| Repository-acceptance receipt verification cross-checks that artifact_uri exactly equals the GitHub tree URI derived from repository + reviewed_commit, that the validity window holds at evaluated_at, and that the signing key is independently pinned per-repository (never receipt-asserted) before a receipt counts as accepted. | [E4-109] |

### Kept out by design

- CR-019 makes the collection-report release boundary executable via a versioned manifest + strict Effect schemas + deterministic validation + CI CLI; the checked-in manifest ships status:pending_owner_approval with every gate pending, every flag disabled, no evidence recorded — the package does not approve a release, and status stays pending until every gate owner signs. [E4-077]
- Manifest gate-owner approval and repository-owner acceptance are separate input/authority domains — neither receipt type satisfies the other — and the validator never accepts a public key asserted by a receipt itself; keys come from an independently supplied, independently governed keyring. [E4-082]

### Compat commitments

- GateManifest.status is a closed two-value literal (pending_owner_approval | owner_approved); the manifest becomes the mechanical gate input after owner approval — no intermediate status value. [E4-095]

## Cross-Cutting / Ordering-Admission

Ordering-service admission, orchestration, dispatch, capacity, and gate-coordination logic spanning CR-000, CR-002, CR-201A/C, CR-202, CR-204A, CR-206, CR-208, CR-303, CR-305, and the acceptance/gate-manifest process — no single package boundary owns this behavior.

### MUST / NEVER

| Rule | Citation |
|---|---|
| Gate U-1 is fail-closed by default: CR-000 Discord-viability / privacy-security status that is unknown or pending at the deadline resolves to No-go for the T2 tier. | [E1-015] |
| The coordinator gate table's governing rule is that absence of a signature or artifact is evidence of an unmet condition, never permission to infer or invent one. | [E1-016] |
| Gate Leak (CR-002 #478) enforces a single active immutable gate mapping at any time, protected by cryptographic configuration and reveal-evidence integrity checks. | [E1-040] |
| Gate Leak readiness recomputes the compute-input digest server-side from evidence rather than trusting a caller-declared digest — result identity belongs to the verifier, not the presenter. | [E1-043] |
| Gate Leak mapping transitions (ratifyGateMapping, revokeGateMappingVersion) verify the stored aggregate's integrity before idempotency lookup or CAS/transition branching, so replay logic never trusts a tampered denormalized digest field. | [E1-047] |
| GET /v1/collection-reports list/detail (CR-206) re-checks the query's subject+community ACL scope against the stored placed_by / inputs.community_ref on each record, never trusting request-auth query scope alone. | [E1-069] |
| Collection-report list pagination uses a cursor over the immutable (created_at_unix, order_id) pair. | [E1-070] |
| CollectionReportOrchestrator drives collection-report orders through an ordered lifecycle: placed -> routing -> producing, then hold. | [E2-003] |
| capability_demand is an idempotent resource with an open->notified lifecycle plus closed/declined/expired terminal states, with quota and expiry enforcement. | [E2-021] |
| shared_preparation_work_key_active_idx is a partial index on work_key_digest for active states (queued/preparing/retry_wait) enforcing a single active public shared-preparation work per work_key, combined with an advisory transactional lock and unique-violation->serialization_retry mapping on join. | [E2-030] |
| Shared preparation work requires multi-deployment child evidence gating before the parent can transition to ready. | [E2-031] |
| Admission capacity is modeled as three non-interchangeable ledgers: admission_rate, queued_work, and active_execution. | [E2-037] |
| CR-201C admission runs as one serializable transaction that atomically locks capacity counters, checks a recipe-expansion certificate, and writes capacity consumption, idempotency, order, root work/links, and outbox, with no separate pre-admission reservation state. | [E2-038] |
| Collection-report intake's client_request_id makes replay idempotent (same request returns the same order), while reuse of the same client_request_id with a different body returns idempotency_conflict before digest validation runs. | [E2-043] |
| The CR-204A public preparation adapter dispatches Sonar child work idempotently via inbox keys, with dispatch outbox/inbox reconciliation, worker leases, child-evidence aggregation, and retry/terminal fan-out to linked orders. | [E2-048] |
| CR-204A projects a distinct per-child Sonar idempotency key suffixed by work_item_id, avoiding multi-deployment idempotency-key collisions. | [E2-052] |
| CR-202 admission joins all certified root work keys (ownership_index + collection_identity) in the same transaction and allows idempotent replay even without a live resolution row. | [E3-005] |
| Fan-in on shared work consumes order capacity without duplicating the shared-work envelope. | [E3-008] |
| Capacity release is fan-in-aware to prevent double-freeing and reassigns the shared envelope owner, and failed joins roll back order/outbox so no orphan admission is left behind. | [E3-009] |
| Fold/refund of a fan-in capacity envelope may only occur when another held envelope exists; releaseReservation routes through fan-in-aware queued release. | [E3-010] |
| Every admission-transaction BEGIN path must ROLLBACK before releasing the client, and SERIALIZABLE retries are bounded rather than unbounded. | [E3-011] |
| CR-201A's shared preparation store (shared_preparation_work / preparation_work_items / report_work_links) enforces active work-key uniqueness, lease fencing, retry CAS, and subscriber fan-in, restricted to controlled-fixture work keys only. | [E3-012] |
| CR-201A parent and child preparation-work rows must be updated in the same transaction. | [E3-014] |
| Contested lease reclaim on a work key serializes to a single winner (acquireLease/transition/publish/finalize/retry/wake under the work-key lock), and transitionToPreparing is restricted to queued-only so wake CAS is the sole retry_wait exit. | [E3-015] |
| When a parent preparation-work item enters retry_wait, its ready/preparing/failed children are invalidated (evidence_envelope nulled) in the same transaction so finalize cannot reuse pre-retry child evidence after wake. | [E3-016] |
| Finalize must reject unless readiness_evidence.freshness.qualified is true, so a join can never reuse unqualified ready rows. | [E3-017] |
| acquireLease is refused while the parent is in retry_wait, and a child's evidence is only accepted once the parent is in the preparing state. | [E3-018] |

### Kept out by design

- The collection-report owner-acceptance PR (#473) is a coordination/acceptance record only: it implements no CR and must not be read as production enablement, Discord viability, or human privacy/security approval. [E1-013]
- The acceptance artifact explicitly refuses to invent CR-000 Discord-viability or privacy/security co-signatures that are absent. [E1-014]
- CR-206 explicitly defers identity-row paging, encrypted export, CR-015 disclosure fences, and artifact byte-retrieval audit to the full CR-206 scope; this PR is a partial slice. [E1-071]
- CR-208 capability-demand lifecycle is recognition-only: it deliberately does not create report orders or shared preparation work from demand paths. [E2-020]
- support_request projections are typed distinctly and must never carry Preparing / report-order semantics, keeping the demand lane's vocabulary out of the order lifecycle. [E2-022]
- The CR-201A migration is expand-only (IF NOT EXISTS), pins privacy_class and sharing_scope to public with an allowlisted capability set, and keeps work_tenant_scope_digest NULL for public rows. [E2-033]
- The public work-key's lack of tenant/community scoping is intentional design: cross-tenant fan-in into one shared-preparation row is the CR-201A public-sharing model, with tenancy isolation living only on report_work_links, not the work key. [E2-035]
- The gate-leak recipe compiler enforces a deterministic worst-case bound of at most 160 nodes before admission is allowed. [E2-044]
- CR slices must not fabricate downstream readiness or a customer-facing Gate Leak artifact ahead of real capability — the recurring 'No fake Ready' boundary applied at CR-201A, CR-007A, and CR-013. [E3-013]

### Compat commitments

- CR-305 defines the V1 report-attention transition_sequence as updated_at_unix. [E2-001]
- CR capacity/resolution schema changes ship as expand-only migrations (additive, IF NOT EXISTS) — e.g. CR-201C migration 008 and CR-006 collection-resolutions. [E3-007]

## OPEN TENSIONS — check before you build

All 34 unresolved-tension claims from the précis, grouped by surface. Unresolved means the fresh S3 judge could not settle it during this corpus pass — treat as open, not as a known bug or a non-issue.

**Collection Protocol**

- CollectionEvidenceReference leaves evidence_digest as a bare VersionedDigest without constraining the digest domain, so an unrelated domain (e.g. collection.cache-key) can pass boundary validation — an open gap on the CR-001 protocol not confirmed fixed. [E1-025]
- The harness pack flow only requires source_commit to be an ancestor of HEAD (reachability), not equal to HEAD, so an artifact's protocol-identity.json can name an older commit while the packed bytes came from current HEAD (HIGH). [E1-058]
- The artifact verifier fully decompresses an untrusted tarball into memory (gunzipSync) before any size/member validation, creating a decompression-bomb resource-exhaustion risk (MEDIUM). [E1-062]
- The collection protocol's fixtures are protocol publication artifacts decoded by Dashboard- and Sonar-consumer-shaped tests, but actual cross-repository adoption by those consumers remains open under CR-005. [E4-006]

**Collection Resolution**

- The replay principle 'the second observation of an idempotent operation must mean the same thing as the first' is not fully honored on the stale-refresh branch, which discards a replay projection and throws a fresh SelectionStaleError instead of preserving the original outcome. [E1-055]
- Refresh idempotency fingerprints key off the persisted effectiveRequest but not the caller-supplied suppliedRequest, so a retry with a different supplied request than the original can incorrectly replay the first outcome instead of being fingerprinted as a distinct command. [E1-056]
- Confirm/refresh idempotency keys are scoped only to operation+subject+idempotency_key, not resolution_id, so reusing the same key/body across two resolutions for the same subject can replay the first resolution's response against the second (HIGH). [E1-059]
- CR-007A public authorization is ratified and wired at the Ordering HTTP edge, but production Postgres adapters and Identity grant-stream ingestion for collection-resolution remain downstream/open work. [E4-041]

**Dependency Ledger**

- The dependency-ledger implements only the Ordering consumer/inbox side of CR-012A; Sonar's public trust-stream producer (CR-011A, bead f09.43) is still open, and G1B-1 end-to-end replay (EV-G1B1-sonar-ordering-replay) cannot pass until that producer lands. [E4-064]

**Signing-Key Custody**

- Wiring Ordering's PinnedKeyRegistry and gateSignedIntake() ahead of CR-009 verification, plus the production registry distribution channel with live KMS/HSM backends, remain open follow-ups not delivered in the CR-013 slice. [E2-018]

**Trust Envelope**

- TrustEnvelopeRejectedError declares reasons unknown_schema_major and schema_minor_unsupported, but the schema-version guards (assertSupportedSchemaMajor/Minor) throw a plain Error, so no code path can produce a TrustEnvelopeRejectedError carrying either reason — a consumer pattern-matching on that error's .reason will never observe them. [E5-041]

**Collection-Report Gates**

- The raw task-reference range scanner (scanRawTaskRefs) does not cover tier.entry_tasks, so a forbidden range placed there produces a generic SCHEMA_INVALID rather than the intended RANGE_FORBIDDEN rejection — an open validation-coverage gap. [E1-039]

**Cross-Cutting / Ordering-Admission**

- The owner-acceptance doc's two descriptions of the public Ordering-path CR set disagree (deploy-sequence CR-006/007A/201A/202/204A/208 vs gate U-10 CR-201A/C/202/204A/206/208), an unresolved drift until CR-019 formalizes one canonical manifest. [E1-018]
- The owner-acceptance doc's frontmatter is contradictory: non_gating_conditional_record / gating:false yet blocks_release:true, an unresolved conflict for any release/gate automation consuming the file. [E1-019]
- It is unverified whether CR-010 (a shared-protocol artifact-manifest deliverable) is genuinely gated on G-1 Go per sprint chain C3, or whether the deploy-sequence reference is a typo for a restricted-path CR. [E1-020]
- The CR asterisk-suffix notation (CR-201*, CR-204*) denoting variant families is used but never defined, leaving ambiguous whether it includes restricted/blocked B-variants alongside public-path A-variants. [E1-021]
- CR-002 and gate G1 remain open/unsatisfied because the three recorded-shape community fixtures used for Gate Leak testing are synthetic, not the required three-live-community evidence. [E1-041]
- Gate Leak readiness binds evidence to context.pins.gateway_epoch but never checks discord.attestation.gateway_resume_sequence against context.pins.gateway_sequence, so evidence from a different resume sequence within the same epoch could satisfy readiness against a stale sequence pin (HIGH). [E1-044]
- evaluateOwnershipFinalityProof never recomputes/validates attestation_digest, so a caller bypassing decodeOwnershipIndexEvidence could present a forged-digest attestation and still receive proven:true (HIGH). [E1-045]
- Stored gate-mapping command material is never checked for the gate-config:ratify permission against the version's ratifier_permission, so a self-consistent persisted version without the ratify permission can decode as a validly ratified mapping (HIGH). [E1-046]
- It is undocumented whether missing ownership finality attestations are a valid V1 wire state or intentionally unrepresentable — the partial-ownership disclose/allow policy branches are currently unreachable through the public evidence decoder when finality is missing. [E1-048]
- The capability-demand lifecycle's supported intermediate state is collapsed into an atomic open->notified transition in the in-memory store and is not yet separately observable. [E2-023]
- Capability-demand persistence is in-memory only; Postgres persistence and the transactional outbox are deferred. [E2-024]
- recordRetryableFailure persists retry_deadline but wakeRetryWait never enforces it against current time, so work can be woken indefinitely past its retry deadline with no transition to failed. [E2-034]
- The admission_capacity_reservations quantity>0 CHECK contradicts the fan-in design: Postgres admitOrder inserts fan-in queued rows with quantity 0, violating the CHECK it must satisfy (CRITICAL). [E2-039]
- Fan-in release/ownership-handoff for shared queued capacity may not correctly reassign envelope ownership, risking over-admission or stranded transferred reservations in both Postgres and in-memory stores (CRITICAL/HIGH). [E2-040]
- CR-201C's atomic-admission invariant is proven only for the in-memory store; Postgres adapter parity (fan-in persistence, release accounting, pool uniqueness, retries) was called merge-blocking for any non-memory deployment path. [E2-041]
- The UNIQUE(ledger_kind, network_ref, capability, community_ref) pool constraint allows duplicate pools for the default (NULL community_ref) scope in Postgres (NULLs distinct), splitting consumed_units and bypassing the intended capacity limit (HIGH). [E2-042]
- CR-202 admission joins only the primary root work key (collection_identity.v1); capacity accounting for the second root (ownership_index.v1) remained flagged incomplete even after joinAllRootWorkKeys began joining both roots. [E2-045]
- The idempotent-replay fast path in admitCollectionReportOrder skips re-joining certified root work keys on replay (unlike admitOrder), so clients retrying after a subscriber detach get success without re-attaching to shared preparation (HIGH). [E2-047]
- The active-execution capacity lease acquired during shared-preparation dispatch is released only on the ready exit path; retry, terminal-failure, and not-all-ready idle exits leave the reservation held until lease expiry/reconcile (HIGH). [E2-049]
- The active-execution pool_scope.network_ref is derived incorrectly by splitting finality_policy_version on ':' and taking only the namespace (eip155 instead of eip155:1), landing capacity accounting on a different pool key than admission's network_ref (HIGH). [E2-050]
- The CR-204A dispatch ledger is in-memory only (InMemoryPublicPrepDispatchStore); lost-response reconciliation and intent/ack correlation do not survive process restart until a durable dispatch store is added. [E2-053]
- A CR-000 authority surface is named as expected but not yet defined within the corpus window. [E3-032]

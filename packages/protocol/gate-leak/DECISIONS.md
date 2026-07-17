# CR-002 Decision Record — Gate Leak readiness and work-key scopes

Status: ratified with the package; every decision here is enforced by a
schema, transition function, or table test in this package unless it names an
external enforcement site. This record resolves the TBDs shared persistence
(SDD §6.3) needs before G1. Where a decision is provisional it says so
explicitly.

## D-1 Package location and dependency direction

`packages/protocol/gate-leak`, sibling of the CR-001 package, standalone pnpm
package following the identical build/test conventions. It depends on
`@freeside/collection-protocol` through its published `^1.0.0` contract (with
a package-local pnpm override for monorepo development) and re-uses its scalars,
canonical encoder, digest envelope,
`CollectionWorkKeyMaterial`, and `CapabilityRegistryVersion`. Nothing in
CR-001 imports this package; the direction can never invert.
The package-local toolchain declares Node `>=22.12.0`, the first supported
Node 22 minor for its TypeScript/Vitest stack; installs on older Node 22
minors are intentionally refused instead of failing later in CI.

## D-2 Capability identity

Capability IDs carry their major version as one literal (`ownership_index.v1`).
A v2 is a new union member and therefore a new work key; a v2 id presented to
the v1 contract fails closed (tested). The wire schema version of this package
is `1`.

## D-3 Evidence-boundary derivation per capability (SDD 6.3)

| Capability | Derivation |
|---|---|
| `collection_identity.v1` | `continuous_latest` (invalidated by capability-registry advance and equivalence revocation) |
| `ownership_index.v1` | `continuous_latest` (freshness on reuse, adapter finality/max-source-age policy) |
| `gate_mapping.v1` | immutable ratified mapping version in the key |
| `discord_role_snapshot.v1` | acquisition demand (capture-policy version + authorization epoch + Ordering-assigned generation), then exact producer-issued snapshot ID |
| `identity_link_snapshot.v1` | acquisition demand, then exact link-snapshot ID |
| `gate_leak_compute.v1` | exact compute-input digest |

Acquisition and consumption are distinct work types with distinct keys
(tested); callers can neither choose the boundary kind nor supply a
generation/snapshot ID — Ordering derives them server-side.

Per SDD 6.3, BOTH Discord snapshot work-key forms (acquisition demand and
exact-snapshot consumption) additionally bind the ratified configuration
identity: `mapping_version_id` and `mapping_config_digest` are required
fields. A relinked mapping version over the same configuration, or a
different configuration, yields a different key (same/different vectors
pinned in the fixture table); stripping the binding fails decode.

## D-4 `ownership_index.v1` deployment coverage

The answer to the sprint's question ("one deployment or the full ratified
logical collection?") is: the FULL SELECTED deployment set. Every deployment
in the confirmed selection needs qualifying ownership evidence before
readiness. The ratified mapping binds the same set by
`deployment_set_digest`, so the selected set is itself ratified configuration,
not an ad-hoc subset, and the compute input carries the same digest. Partial
coverage refuses with `partial_deployment_coverage` (D-10).

## D-5 Work-key scope material, canonical sets, and collision resistance

The canonical key is the keyed JCS object of the per-capability input schema,
digested under `gate-leak.work-key` v1. Community and guild are separate
fields, so no concatenation of scope strings can collide across boundaries
(tested with a crafted colliding-concat pair). Global public inputs
structurally exclude tenant identity: the schema has no such field and excess
properties are decode errors. Restricted inputs require
`privacy_class: restricted_community` plus community/guild (and cohort digest
for identity-link work), so restricted evidence can never join a public or
different-tenant work item merely because the deployment set matches.

Every logical set is canonicalized before digesting and strict-decoded as
sorted unique:

- deployment sets: `digestDeploymentSet` validates domain membership, refuses
  duplicates and the EMPTY set (`EmptyDeploymentSelectionError`), and sorts
  bytewise before digesting — permutations of the same logical set digest
  identically;
- role IDs: `RoleIdSet` strict-decodes sorted unique everywhere (work keys,
  mapping versions, Discord evidence, disclosure keys); `canonicalRoleIdSet`
  sorts arbitrary input and refuses duplicates;
- authorization watermarks: `AuthorizationWatermarkSet` strict-decodes sorted
  unique by a stable comparator over every identity field (authority, epoch,
  schema_version, sequence); `canonicalAuthorizationWatermarkSet` sorts
  unordered constructor input and refuses duplicates; identity-link evidence
  watermarks must equal `ComputeAttemptPins.authorization_watermarks` by exact
  canonical identity/value before readiness;
- disclosure-ledger dimensions: `GateLeakDisclosureLedgerKey.role_ids` is a
  `RoleIdSet`; canonicalized permutations produce identical ledger keys, so
  the privacy ledger cannot be fragmented by reordering.

Digest functions (`digestGateLeakWorkKey`, `digestGateLeakComputeInput`,
`digestGateLeakDisclosureKey`) re-VALIDATE their input against the strict
schema before digesting, so an in-process value that bypassed decoding cannot
mint a fragmented or colliding key.

## D-6 Identifier forms

`CommunityRef` is the server-issued community identifier
(`^[a-z0-9][a-z0-9._-]{0,127}$` — covers slugs and UUIDs); guild, role, and
Discord user IDs are snowflakes (`^[0-9]{17,20}$`); operator subjects use
`SubjectRef` (`^[a-z0-9][a-z0-9:._-]{0,127}$`). Balances and stream sequences
are decimal strings (no float or bigint wire forms).

## D-7 Safe public reason codes

Two ratified vocabularies with machine-checkable metadata:

- Order surface (28 codes): `unsupported_gate_rule`,
  `gate_mapping_not_ratified`, `gate_mapping_revoked`,
  `gate_mapping_malformed`, `mapping_integrity_violation`,
  `gate_config_ratify_required`, `identity_reveal_not_authorized`,
  `mapping_churn_limit_exceeded`, `report_churn_limit_exceeded`,
  `purpose_policy_missing`, `consent_purpose_mismatch`,
  `empty_deployment_selection`, `partial_deployment_coverage`,
  `evidence_scope_mismatch`, `evidence_version_below_floor`,
  `compute_input_binding_mismatch`, `restricted_evidence_expired`,
  `evidence_window_misaligned`, `ownership_evidence_stale`,
  `ownership_finality_unproven`,
  `discord_snapshot_stale`, `identity_snapshot_stale`,
  `watermark_mutation_restart`, `capture_contention`,
  `identity_invalidation_stale`, `authorization_revoked`,
  `cohort_too_large`, `insufficient_coverage`.
- Row surface (7 codes, the artifact allowlist):
  `eligible_balance_confirmed`, `proven_zero_balance`,
  `identity_link_missing`, `consent_unavailable`, `identity_unavailable`,
  `ownership_evidence_unavailable`, `authority_evidence_unavailable`.

Invariants (schema/test-enforced): only `proven_zero_balance` is actionable;
every indeterminate code forbids wallet exposure and carries
`adverse_inference: false`; no copy implies the out-of-scope direction.
Missing, refused, withdrawn, and revoked consent collapse upstream into ONE
`consent_unavailable` state so the refusal channel cannot distinguish
decliners (sibling-channel discipline). Generic lifecycle codes
(`preparation_failed`, `capacity_unavailable`, `report_failed`,
`retry_exhausted`, `selection_stale`, …) remain SDD §13 property owned by
Ordering and are deliberately NOT redefined here.

## D-8 Classification semantics

Input cohort is exactly the distinct non-bot members of the pinned mapped-role
snapshot; bots are excluded upstream and surface only as
`excluded_bot_count`. Per subject: `eligible` iff any consented linked wallet
has proven balance ≥ 1 on ANY selected deployment; `proven_ineligible` iff
EVERY (wallet, selected deployment) pair is proven and zero; otherwise
`indeterminate` with the specific gap reason. A selected deployment absent
from a wallet's evidence counts as unavailable, never as zero. Rows sort by
Discord user ID; classification is deterministic and pure.

## D-9 Wallet minimization on rows

Eligible rows carry only the wallets that prove eligibility;
`proven_ineligible` rows carry every compared wallet (all are needed to
justify the definitive claim); indeterminate rows carry none — enforced by
schema filter, so a consent-unavailable row with a wallet cannot decode.

## D-10 Partial-deployment policy

The V1 recipe pins `partial_policy: reject` on all six requirements. The
readiness evaluator refuses partial ownership coverage with
`partial_deployment_coverage`. A future recipe may declare
`disclose`/`allow`, but readiness then returns an explicit
`disclosed_coverage_gap` naming the missing deployment digests — permitted
partial coverage is always disclosed; silent partiality is unrepresentable.
Missing finality attestations are therefore a representable wire state:
`decodeOwnershipIndexEvidence` accepts the empty attestation set, while
readiness applies the selected recipe's `reject`/`disclose`/`allow` policy.
The V1 recipe still rejects that state.

## D-11 Coverage threshold

`GATE_LEAK_COVERAGE_POLICY_V1`: 8000 basis points (80%), integer arithmetic
only (`definitive * 10_000 >= 8000 * cohort`), rounded-down 10-point coverage
band via integer floor. The actionable measure member's coverage band is a
schema literal of {80, 90, 100}; presenting an actionable measure below the
floor cannot decode. Lowering the threshold therefore requires a NEW policy
version and schema major — the same release evidence cannot be reused, per the
sprint. An empty cohort presents `insufficient_coverage`.

## D-12 Disclosure bands and epoch

Fixed bands `0`, `1-9`, `10-24`, `25-49`, `50-99`, `100+`; one disclosure per
equivalent query per 7-day epoch. This package defines the ledger KEY schema
(community, guild, logical collection, mapped-role set, rule digest,
disclosure-policy version, epoch index) and its digest; the transactional
ledger, fencing, and withholding logic are Ordering's (CR-015). Cohort and
indeterminate counts surface only as bands.

## D-13 Gate-mapping aggregate: single-active invariant and integrity

Shadow Audit owns the aggregate keyed by community + guild + logical
collection. Versions are immutable, carry ratifier subject and the literal
`gate-config:ratify` permission, provenance, rule + config digests, effective
and revoked times, and an idempotency key. Writes are optimistic-concurrency
transitions (`expected_aggregate_version`) that append audit events; a version
conflict returns the current active version for review and never overwrites.
Ratification is idempotent per key **only when the incoming command is
byte/canonically equivalent** to the recorded command: every version stores a
`command_digest` over the full ratify command (scope, roles, rule, provenance,
reveal basis, authority, CAS expectation, effective time, idempotency key;
permissions sorted). Reuse of a key with a different field returns
`IdempotencyConflictError` and never succeeds, even if the stored mapping is
unchanged. `inferred` provenance is unrepresentable
in a ratified version — hypotheses are a separate type that cannot reach
readiness. Revocation moves pinned orders to Needs attention with
`gate_mapping_revoked`; relink is a new explicit ratification (tested).

**At most one active version, everywhere.** The aggregate schema refuses more
than one non-revoked version at decode; `ratifyGateMapping` refuses a NEW
distinct ratification while any version is active with the typed
`ActiveMappingExistsError` (`required_action: revoke_then_relink`) — only
idempotent replay of the recorded command is permitted;
`mappingSatisfiesReadiness` reports a two-active aggregate as
`gate_mapping_malformed` and NEVER selects an oldest (or any) winner among
competing active versions. History remains immutable and append-only.
Two-active adversarial probes cover the persisted shape (decode refusal), the
in-process shape (readiness + transition refusal), and the write path.

**Cryptographic integrity.** `mapping_version_id` is the digest of
`{config_digest, command_digest, effective_at, idempotency_key, provenance,
ratifier_subject, identity_reveal_basis}`; `config_digest` is the digest of
`{community_ref, guild_ref, collection_id, deployment_set_digest, role_ids,
eligibility_rule}` (exported as `computeGateMappingConfigDigest`).
`command_digest` is recomputed from the persisted `command_material` (the exact
ratify command) and is itself an input to `mapping_version_id`, so a caller
cannot graft a changed-command digest onto an existing version identity and
then replay a changed command. `verifyGateMappingVersionIntegrity` recomputes
rule digest, config digest, command digest, and version ID from the version's
own fields/material and checks command-material consistency with the
denormalized fields; `decodeGateMappingVersion` and `decodeGateMappingAggregate`
run it after structural decode. A version whose role_ids, config fields,
command digest, or command material were tampered while retaining the old
digests or version ID fails with `MappingIntegrityError` naming the exact
mismatches (fixture + in-process probes).

**Integrity-first transitions.** Every public transition that consumes an
existing mapping aggregate (`ratifyGateMapping`, `revokeGateMappingVersion`)
strict-decodes its incoming command, then strict-decodes and verifies the
aggregate and all versions BEFORE idempotency lookup or any other branch.
Typed in-process objects are not treated as validated wire values.
`ratifyGateMapping` never compares against a raw
stored `command_digest` field and never returns replay from an unverified
in-memory object — replay and conflict digests are recomputed from verified
`command_material`. A grafted command digest, material, version ID, role set,
config field, or reveal evidence on a JS object fails `MappingIntegrityError`
exactly as persisted decode would; verified same-command replay and
changed-command `IdempotencyConflictError` behavior are unchanged.

**Append-only history semantics.** `aggregate_version` equals the audit-event
count; event counters are contiguous from 1; audit timestamps are ordered;
every event references a stored mapping ID under `gate-config:ratify`;
version order matches ratification order; and each version has exactly one
ratification plus, when revoked, exactly one later revocation at `revoked_at`.
The ratification event also binds actor, effective time, and the command's
prior aggregate counter. Structural shape without these relationships is a
`MalformedMappingAggregateError` at decode, readiness, and transition
boundaries.

## D-14 Identity-reveal basis (bound evidence)

A new mapping reveals identity rows only with BOUND integration evidence OR a
second distinct approver holding `privacy:approve-gate-audit` (self-approval
and a non-privacy permission literal are refused at both transition and
schema). `pending` mappings can show only non-identifying setup state
(`identity_reveal_not_authorized`).

Integration evidence is cryptographically and configuration bound: its
`evidence_digest` MUST live in the `gate-leak.integration-evidence` v1 domain
(an unrelated-domain digest cannot decode), it MUST carry `bound_config_digest`
equal to the exact mapping configuration digest it evidences plus the
producing `authority` and `observed_at`. The schema refuses a version whose
reveal binds a different config digest (graft probe), and `ratifyGateMapping`
refuses a command whose evidence binds a configuration other than the one
being ratified (`IntegrationEvidenceMismatchError`).

## D-15 Churn limits

`GATE_LEAK_CHURN_POLICY_V1`: 5 new mapping versions and 10 distinct-collection
Gate Leak orders per community per rolling 24h. The mapping limit is enforced
inside the ratify transition against a required, same-transaction
`CommunityMappingChurnWindow` supplied by persistence (revoked versions and
sibling collection/guild aggregates still count toward creation rate). The
transition rejects a wrong-community, future-dated, or target-history-omitting
window. The order limit ships as `evaluateGateLeakOrderChurn`, whose
enforcement site is Ordering admission. Raising either requires privacy
review and a new policy version.

## D-16 Watermark pins and restart conditions

`ComputeAttemptPins` pins mapping version, consent-policy version, identity
tombstone watermark, Gateway epoch/sequence, CR-001 capability-registry
version, and all authorization watermarks. Any tracked mutation before
finalization restarts acquisition (`watermark_mutation_restart`); a tombstone
gap is `identity_invalidation_stale`. Two mutations never restart silently:
mapping revocation (`gate_mapping_revoked`, operator relink) and authorization
revocation (`authorization_revoked`, detach). Replacement evidence is never
selected silently.

The pins are PART OF the exact compute input: `GateLeakComputeInput.pins` is
required, schema filters force `pins.mapping_version_id` and
`pins.consent_policy_version` to equal the input's own bindings, and the pins
are inside the digested material — so a cached result can never be reused
detached from the watermarks it was computed under. Detached pins fail decode;
different pins are a different result identity (different digest, tested).

## D-17 Five-minute evidence alignment

Ownership, Discord, and Identity observation windows must pairwise overlap or
have nearest boundaries ≤ 300 seconds apart
(`EVIDENCE_ALIGNMENT_POLICY_V1`). The verdict returns the full as-of interval
(min start → max end) the artifact must report; an atomic-snapshot claim is
unrepresentable. 300s aligns; 301s refuses (tested boundary).

## D-18 Cohort and capture ceilings

50,000 human subjects, 500-subject pages, cohort digest + cardinality +
inclusion-rule version + source snapshot in the restricted work key. Oversize
is `cohort_too_large` remediation — truncation is not a code path. Discord
capture: ≤ 1,000 reconciliation deltas, ≤ 300s window, ≤ 3 generations, and a
completeness attestation (baseline pages, cursors, Gateway session/epoch/
resume, gaps, reconciliation result); any defect is `capture_contention`.

## D-19 Version invalidation of reuse

`qualifiesForReuse` refuses on capability, adapter, readiness-policy, or
finality-policy change, on missing deployment coverage, and on stale
freshness. Same/different work-key digests for every scope and version axis
are pinned in `fixtures/work-key-digest-vectors.valid.json` and recomputed in
tests.

## D-20 Representative community configurations and the migration contract

Three recorded configurations ship as executable fixtures (single-deployment
EVM on eip155:80094; two-chain logical collection with registry equivalence
and second-approver reveal; Solana mainnet with rule-refusal and
unauthorized-ratifier cases). They prove: authoritative mapping source is the
Shadow Audit aggregate; ratify/revoke/conflict/relink behavior; migration and
refusal; and legacy parity — definitive legacy verdicts map unchanged
(`ok`→`eligible`, `stale`→`proven_ineligible`), while legacy missing-authority
leak treatment is INTENTIONALLY replaced by `indeterminate`, and the legacy
promotion direction (holdings without role) is out of scope.

Honest limitation: the fixtures are recorded-SHAPE stand-ins with synthetic
identifiers, generated and asserted against hand-stated golden expectations.
**They do NOT satisfy the external three-live-community G1 evidence gate** —
each fixture's description says so explicitly. Full G1 sign-off must
additionally replay operator-supplied exports from the three live communities
through these same decoders and transitions; that external evidence cannot be
manufactured from inside this repository and is the one open evidence gap this
record tracks.

## D-21 Enforcement-site boundary

This package is Contract + Construct plane only: schemas, digests, and pure
transitions. Persistence (shared_preparation_work rows, lease epochs, CAS),
authorization recheck timing, and the disclosure ledger are Execution-plane
obligations of Ordering/Shadow Audit/Identity per the SDD; each function here
names the reason codes those sites must project.

## D-22 Readiness proves all six capabilities from evidence

`evaluateGateLeakReadiness` accepts no caller assertions. Its context is the
six decoded evidence envelopes plus the order scope, consent-purpose policy,
attempt pins, claimed compute input, and Ordering's evaluation clock. It
proves, per capability:

1. `collection_identity.v1` — adapter floor, deployment coverage of the exact
   selection, collection match, capability-registry binding to the pins;
2. `ownership_index.v1` — adapter floor, COMPLETE per-deployment coverage
   of every selected deployment (a `partial` completeness flag is a gap),
   closed per-deployment finality attestations under the recipe's supported
   V1 policies (`ownership-finality.eip155-finalized-block.v1` /
   `ownership-finality.solana-finalized-commitment.v1`) bound to verified
   CR-001 `CollectionDeploymentRef`s (namespace derived from the ref, never
   self-declared) with digest integrity, exact finalized source identity
   bound into coverage, and source currency against `evaluated_at` using
   the recipe's ownership finality/max-source-age policy
   (`ownership_finality_unproven` / `ownership_evidence_stale` when
   exceeded; clock-skew-safe within `CLOCK_SKEW_POLICY_V1`);
3. `gate_mapping.v1` — single-active ratified version, digest-integrity
   verification, community/guild scope match, and `deployment_set_digest`
   equal to the recomputed digest of the selection (immutable version — no
   max-source-age at `evaluated_at`);
4. `discord_role_snapshot.v1` — community/guild scope, EXACT mapping
   version/config/role-set binding, Gateway-epoch pin binding, the
   complete-capture attestation, and snapshot freshness against `evaluated_at`
   (`discord_snapshot_stale`);
5. `identity_link_snapshot.v1` — community/guild scope, versioned
   `community_gate_audit` consent, gap-free invalidation at the pinned
   tombstone watermark, authorization watermark set equal to the attempt pins,
   unexpired shortest-retention bound, cohort ceiling, and snapshot freshness
   within the Identity propagation objective (`identity_snapshot_stale`);
6. `gate_leak_compute.v1` — the compute input must bind, by digest or
   identifier, every envelope above, the cohort lineage (subject-set digest,
   cardinality, source snapshot), the recipe's readiness-policy version, the
   envelope-derived as-of interval, and the FULL pins.

Evidence observation windows come from the envelopes themselves; the 5-minute
alignment and the as-of interval are derived, not asserted. The ready verdict
returns a SERVER-recomputed `compute_input_digest`. Refusals project the D-7
codes (`evidence_scope_mismatch`, `evidence_version_below_floor`,
`compute_input_binding_mismatch`, `consent_purpose_mismatch`,
`restricted_evidence_expired`, `gate_mapping_malformed`,
`mapping_integrity_violation`, …), one per violated proof.

## D-23 Empty deployment sets are unrepresentable work

An empty selected deployment set would make the `proven_ineligible`
universal quantifier vacuously true — an unavailable wallet would become a
leak finding from nothing. It is refused everywhere with a tagged error or
reason code: schemas require non-empty sorted-unique sets; `digestDeploymentSet`
and `validateSelectedDeploymentSet` fail with `EmptyDeploymentSelectionError`;
`classifyGateLeakSubject`/`classifyGateLeakSubjects` are Effects that refuse
before quantifying; `qualifiesForReuse` refuses an empty required set;
`evaluateGateLeakReadiness` returns `empty_deployment_selection` before
evaluating anything else.

## D-24 Identity-link snapshot provenance

`IdentityLinkSnapshotEvidence` carries, as required fields: community and
guild scope; purpose-scoped consent provenance (the literal
`community_gate_audit` purpose, its policy version, the authoritative grant
source, and verification time); invalidation provenance (the versioned
`identity-api.tombstone.v1` stream, the gap-free watermark incorporated, and
verification time — covering unlink, consent withdrawal, and subject
deletion); the shortest-applicable retention policy version and concrete
`retain_until` bound; non-empty authorization watermarks; and the MVCC token,
subject-set, and page-root digests in their own gate-leak digest domains.
Readiness enforces scope, consent-policy, watermark, retention, and cohort
bindings against the pins and compute input.

## D-25 Ownership finality is a closed per-deployment attestation contract

Free-form `finality_policy_versions: string[]` is not readiness authority, and
a self-declared `network_namespace` on an attestation is not finality
authority either. Each finality attestation carries a strict CR-001
`CollectionDeploymentRef`; decode/recompute of its `deployment_id` goes
through the exact `@freeside/collection-protocol` package. Network namespace
and network reference are DERIVED from that verified ref.

| Policy version | Derived namespace | Source identity |
|---|---|---|
| `ownership-finality.eip155-finalized-block.v1` | `eip155` | finalized block height |
| `ownership-finality.solana-finalized-commitment.v1` | `solana` | finalized slot |

The selected deployment set and `collection_identity.v1` evidence both carry
the same verified refs. Readiness builds an exact
`deployment_id → verified network` map from those refs and passes it into
finality proof. Coverage `source_position_kind`, adapter/policy, block-height
vs slot fields, and finality policy must match the derived actual VM.

Each selected deployment must present exactly one attestation binding the
verified deployment ref, supported policy version, `finality_status:
"finalized"`, the exact finalized source reference, finalized observation
time, adapter version, and a versioned `attestation_digest` in the
`gate-leak.ownership-finality` v1 domain (recomputed on decode over the
verified ref + derived namespace). A boolean alone cannot claim finality.

An EIP-155 deployment carrying a Solana policy/slot attestation (or the
inverse), even with a correctly minted digest over the false claim, fails
typed integrity/readiness. Detached/grafted full refs, hybrid refs, duplicate
attestations, wrong network reference, and attestation/coverage deployment
mismatch likewise refuse (`ownership_finality_unproven` /
`ownership_evidence_stale` / `partial_deployment_coverage`).

# `@freeside/gate-leak-protocol`

CR-002's ratified Gate Leak recipe: the versioned capability contracts,
canonical work-key scopes, safe public reason codes, and the one-directional
classification semantics that gate G1 shared-work persistence.

Built on CR-001 (`@freeside/collection-protocol`) for cross-VM identity,
RFC 8785/JCS canonical encoding, and domain-separated digests. Identity
semantics are imported, never restated.

## The six ratified capabilities

| Capability | Shareability | Privacy | Evidence boundary |
|---|---|---|---|
| `collection_identity.v1` | global | public chain | `continuous_latest` |
| `ownership_index.v1` | global while freshness-qualified | public chain | `continuous_latest` |
| `gate_mapping.v1` | community + guild | restricted | immutable mapping version |
| `discord_role_snapshot.v1` | community + guild | restricted | acquisition, then exact snapshot |
| `identity_link_snapshot.v1` | community + subjects | restricted | acquisition, then exact snapshot |
| `gate_leak_compute.v1` | order, or result cache by exact input digest | restricted | exact input digest |

Work-key inputs are one schema per capability (`work-keys.ts`). Global public
keys have no field that could carry a user, community, guild, or order
identity — excess properties are decode errors, so tenant identity cannot
enter shared work. Community-scoped keys require community, guild, and
configuration identity; Discord snapshot keys (acquisition AND exact-snapshot
consumption) additionally bind the ratified mapping version and configuration
digest per SDD 6.3. Digests are computed over the keyed JCS object, so scope
values are field-separated and cannot collide by concatenation.

Every logical set (deployment IDs, role IDs, disclosure-ledger dimensions) is
canonicalized before digesting and strict-decoded as sorted unique: equivalent
permutations produce identical keys, duplicates refuse, and the EMPTY selected
deployment set refuses with a tagged error everywhere — in schemas, digest
functions, classification, and readiness — so a vacuous "every deployment
proven" can never exist.

## One-directional Gate Leak semantics

Among non-bot members who currently hold the mapped Discord role, each record
is `eligible`, `proven_ineligible`, or `indeterminate`.

- Only `proven_ineligible` (every consented linked wallet proven zero across
  every selected deployment) is an actionable leak finding.
- Missing links, unavailable consent, deleted identity, and stale or
  incomplete evidence are `indeterminate` — a coverage gap, never adverse
  inference. Indeterminate rows structurally carry zero wallet identifiers.
- Eligible holders who lack the role are out of scope: they cannot appear in
  any row, band, or denominator, and no copy may imply that direction.

Definitive coverage is `(eligible + proven_ineligible) / cohort`. Below 80%
(integer basis-point arithmetic; the v1 floor is a schema literal) the
actionable band is structurally absent and the result presents
`insufficient_coverage` plus the indeterminate band. At or above 80% the
actionable band appears with a rounded-DOWN 10-point coverage band and the
fixed disclosure bands `0`, `1-9`, `10-24`, `25-49`, `50-99`, `100+`.

## V1 rule

Exactly `hold_at_least_one` on any selected deployment, all collection tokens
in scope. Quantity, all-of-deployments, token-ID, trait, time-held, staking,
delegation, and composite rules are refused with `unsupported_gate_rule` and
never approximated.

## Readiness proves, never trusts

`evaluateGateLeakReadiness` takes the six DECODED evidence envelopes — never
caller booleans or pre-summarized coverage — and proves each capability:
collection identity coverage and registry binding, complete per-deployment
ownership coverage, a single-active integrity-verified ratified mapping bound
to the exact selected deployment set, a complete Discord capture bound to that
mapping version/config and role set, a community-scoped identity-link snapshot
with purpose-scoped consent, invalidation, retention, and authorization
provenance, and a compute input whose digests bind every envelope plus the
full `ComputeAttemptPins`. The compute-input digest in the ready verdict is
recomputed server-side. A gate-mapping aggregate can never hold two active
versions (schema + transition + readiness all refuse; readiness never picks an
"oldest active"), and version integrity is re-derived from the version's own
fields plus persisted command material, so tampered role_ids, config fields,
or a grafted `command_digest` cannot ride an existing `mapping_version_id`.
In-process transitions re-verify the stored aggregate before idempotency
lookup, so the same grafts fail `MappingIntegrityError` without ever
comparing against a raw stored digest.
Ownership finality is proven by closed per-deployment attestations that each
bind a verified CR-001 `CollectionDeploymentRef` (EVM finalized-block /
Solana finalized-commitment). Network namespace is derived from that ref —
never self-declared — and never by free-form policy strings or a bare boolean.

## Module map

| Module | Owns |
|---|---|
| `capabilities.ts` | Capability registry, ratified V1 recipe, versioned policy constants |
| `work-keys.ts` | Canonical per-capability work-key input schemas + digests, set canonicalization, empty-set refusal |
| `reason-codes.ts` | Safe public reason codes (order + row) with safety metadata |
| `gate-rule.ts` | V1 rule, typed refusal of unsupported rules, digest domains |
| `mapping.ts` | `gate_mapping.v1` aggregate: single-active ratify/revoke, integrity verification, bound reveal basis, churn |
| `evidence.ts` | Six evidence envelopes, 5-minute alignment, watermark pins/restart, reuse invalidation |
| `compute.ts` | Row allowlist, classification, coverage measure, disclosure bands, pins-bound compute input, ledger key |
| `readiness.ts` | Evidence-proving recipe readiness composition (partial-policy handling) |
| `migration.ts` | Legacy Mibera band mapping onto the tri-state contract |

## Fixtures

`fixtures/` is generated by `scripts/generate-fixtures.mjs` (deterministic; no
clock or randomness). Every digest is computed through the canonical encoder;
golden expectations are hand-stated from the sprint text and asserted at
generation time, so fixtures are an oracle rather than a snapshot.

Community configuration fixtures are recorded-SHAPE stand-ins for the three
representative configurations (single-deployment EVM, two-chain logical
collection, Solana). Their addresses and snowflakes are deliberately synthetic
and must never be read as production identifiers. **They do NOT satisfy the
external three-live-community G1 evidence gate**; replaying operator-supplied
live exports through these decoders is the open external evidence tracked in
`DECISIONS.md` §20.

Regenerate: `pnpm build && node scripts/generate-fixtures.mjs`.

## Verification

```
pnpm install
pnpm typecheck
pnpm build
pnpm test
```

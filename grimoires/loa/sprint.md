# Sprint Plan — Labelled Entities on the Worldline Spine (collections-sot)

> Cycle: collections-sot. Implements sdd.md (flatline-SDD-integrated `38d25000`) + prd.md
> (`d92e4e34`). Previous plan archived: sprint.prev-2026-07-03-sandwich-line-run.md.
> All three sprints are `/run sprint-plan`-executable and in-repo:
> `shared/shadow-mode` (protocol + services) + `shared/shadow-audit` + `network/freeside-cli`.
> No cross-repo write (worlds-api `/lookup` is READ-only authority for the world-binding proposal).
>
> Core architecture (SDD §11.5): the append-only observation chain IS the source of truth;
> `collection_entities` is a re-folded projection. Every derive/ratify is an appended
> `collection.label.{observed,ratified}` observation, keyed on the collection's OWN worldline
> (`chain_id = entity_id = ${chain}:${contract}`). NO mutable label upsert. Ratify = /recall
> force-chain (cockpit grant). Shadow-audit reads the ratified set fail-closed.
>
> Sequencing (NOT beads blocked-by): S1 → S2 → S3. G-4 (settle gate) depends only on S1+S2.
> Reuse-shaping (FR-7) is a factoring discipline across all three (one internal `LabelledEntity`
> interface + the collections impl), not a separate task.
>
> Slice rule: S1+S2 landing alone = "spine holds a ratified collection, unconsumed" — the cycle
> report must say so if S3's shadow-audit collapse slips. The settle gate is S3-T2 (the kill-test).

## Sprint 1: the labelled entity on the spine (FR-1 + identity norm, `shared/shadow-mode`)

### S1-T1 — identity normalization choke point [SDD §7]
Single function pair for `entity_id`: chain → canonical numeric string, contract → lowercased
`0x`+40hex. Reuse/lift `packages/services/ordering/src/contract-address.ts`
(`normalizeChainId`/`normalizeContractAddress`) into a shared util both ordering and shadow-mode
import (no copy-paste). **AC**: a normalization test pins mixed-case contract + numeric-vs-string
chain inputs to ONE `entity_id`; no checksum-case identity; `collection_key` is the only alias.

### S1-T2 — CollectionEntity + observation schemas [SDD §2, §11.5 IMP-001]
`packages/protocol/shadow-mode/src/schemas/collection-entity.ts`:
`CollectionEntity { entity_id, chain, contract, labels: CollectionLabels, provenance: LabelProvenance[] }`,
`CollectionLabels = { token_standard: 'erc721'|'erc1155'|'unknown', collection_key, world?, role? }`.
The two observation shapes (both `ShadowObservation`-compatible, JCS-hashable):
`collection.label.observed {entity_id,chain,contract,label,value,source_type}` and
`collection.label.ratified {entity_id,label,value,ratified_by}`. `SubjectKind` enum GAINS
`'collection'` (the ONLY edit to `subject.ts`; no new required field on `ShadowSubject`).
**AC**: schemas parse/round-trip; member-subject type suite compiles unchanged; a collection
observation JCS-hashes deterministically (byte-exact fixture).

### S1-T3 — store: append + fold + sibling tables [SDD §2, §11.5]
`ILedgerStore` gains `appendCollectionObservation(obs, grant)` (chain write, `chain_id = entity_id`),
`getCollectionEntity(entity_id)` (FOLDS the projection: latest `ratified` wins for subjective,
latest `observed` for derived, derived-vs-later-ratified on same label → `contested`),
`listCollectionEntities()`, `labelProvenance(entity_id)`. In-memory adapter implements the fold;
migration `0003_labelled_collections.sql` adds `collection_entities` (projection) +
`collection_label_provenance` (append-only) + the enum value. NO `upsertCollectionEntity`.
**AC**: member-subject regression suite stays green; a collection entity round-trips (append →
fold → read); its observations verify on the chain (`verifyChain(entity_id)` green); a tamper
test freezes that collection's chain without touching member chains.

## Sprint 2: distillation + ratification (FR-2 + FR-3, `network/freeside-cli`)

### S2-T1 — the ground() distiller [SDD §3, §9]
`freeside collections sync` (READ-only): (a) belt GraphQL `TrackedHolder distinct_on collectionKey`;
(b) on-chain ERC-165 `supportsInterface(0x80ac58cd|0xd9b67a26)` per contract over a per-chain public
RPC list (8s timeout + one retry; both-false/revert/transient-fail → `unknown`, logged — SDD §11.5
IMP-006); (c) world-binding proposal = reverse `/v1/worlds/lookup` where it resolves else key-prefix
heuristic, flagged `proposed`. Prints a ratifiable diff vs the SoT; `collection_key` normalized
`_`→`-` with the transform shown. Exit 0 = fully-ratified & coherent, non-zero otherwise.
Factor as `LabelledEntity.ground(): DerivedLabels[]` (FR-7 seam). **AC (the 24-collection proof)**:
`sync` reproduces `self-grounded-collections-registry.txt` (20 erc721 + 4 erc1155); a normalization
test pins `apdao_seat`→`apdao-seat`; an ERC-165-revert fixture → `unknown` (never erc721).

### S2-T2 — propose (born-low, additive) [SDD §3]
`freeside collections propose`: distill into born-low entities — every derived label
`source_type: ai-derived`, `read_state: unread`; subjective labels (world, role) blank +
`unratified`. Appends `collection.label.observed` per label (never overwrites a ratified label).
MUTATING-command guard: refuse without a writable ledger; refuse in `RAILWAY_ENVIRONMENT`/
`NODE_ENV=production` without `--yes` (SDD §11.5 IMP-008). **AC**: propose over the 24 writes
born-low observations; a re-propose is idempotent (same event_id → no dup); a ratified label
survives a re-propose untouched.

### S2-T3 — ratify = the force-chain [SDD §4, §11.5 SKP-001]
`freeside collections ratify <key> <label> <value>`: flips `ai-derived → operator-validated` ONLY
with a fresh cockpit grant (the `memory-promotion-guard` shape: `~/.claude/.recall-cockpit-grant`,
15-min TTL, one grant = one write); appends a `collection.label.ratified` observation. The agent has
NO code path that writes `operator-validated` without the grant (sole sanctioned writer;
out-of-band DB writes caught by `verifyChain`). **AC (SKP-003)**: a self-ratify without a grant is
blocked (test asserts the guard); a ratify appends an append-only provenance row + re-folds the
projection; a member subject cannot be collection-ratified (kind guard).

## Sprint 3: query + settle gate + drift (FR-4 + FR-5 + FR-6)

### S3-T1 — queryable like /recall [SDD §5]
`freeside collections query "<q>"` (lexical this cycle): ranked entities matching collection_key /
contract / world / role, each with a provenance badge (`ai-derived`/`operator-validated`/
`contested`); `contested` withheld unless `--show-contested` (mirrors /recall). JSON (agent) + terse
table (human). Leave the QMD-source export shape documented (one doc per entity, frontmatter =
trust-fields) as the follow-up seam — NOT built this cycle. **AC (G-3)**: "collections in mibera"
returns the mibera-family entities; "0x6666…c420" returns the mibera entity with its badge; a
contested label is withheld by default.

### S3-T2 — settle gate: shadow-audit collapse (KILL-TEST) [SDD §6, §11.5 IMP-002]
`packages/services/shadow-audit/bin/http.ts`: `loadRegistryFromEnv` → `loadRegistry` reads the
ratified collection entities (ledger projection query; assumption-guarded build-time snapshot as the
fallback, per the role-snapshot precedent) and builds the same `registryFromMap` shape. FAIL-CLOSED
precedence: include a collection ONLY when `standard ∈ {erc721,erc1155}` AND `world` is
`operator-validated` AND no `contested`/`orphaned` label — everything else excluded + logged.
`COLLECTION_REGISTRY` env becomes an optional deprecated break-glass override (env wins if set).
**AC (kill-test, G-4)**: boot with NO `COLLECTION_REGISTRY` → `GET /v1/collections/:chain/:contract`
serves the ratified set; with the env set → override honored; an `unratified`/`unknown` collection
is NEVER served. The FR-1a operator ask is retired.

### S3-T3 — drift sensor [SDD §8]
`freeside collections drift`: re-derives every DERIVED label and classifies per entity — `coherent` /
`drifted` (derived changed → auto-overwrite via a new `observed`, log) / `orphaned` (in SoT, no longer
belt-tracked) / `unratified` / `unknown_standard`. **Drift on a RATIFIED label → `contested`, never a
silent overwrite.** Exit non-zero on any `contested`/`orphaned` (CI/cron, fails loud). **AC**: a
fixture where a derived standard changed → `drifted`+overwritten; a ratified world changed under it →
`contested`, not overwritten; an un-belt-tracked entity → `orphaned` + non-zero exit.

## Goal traceability

| Goal | Met by |
|------|--------|
| G-1 collections are labelled entities on the ledger spine | S1-T2, S1-T3 |
| G-2 agent self-distills, operator ratifies (derive-don't-ask) | S2-T1, S2-T2, S2-T3 |
| G-3 queryable like /recall | S3-T1 |
| G-4 settle gate: shadow-audit reads the SoT (env retired) | S3-T2 (depends S1+S2) |
| G-5 drift sensed, ratified truth never silently overwritten | S3-T3, S2-T3 |
| G-6 reuse-shaped (pattern generalizes past collections) | FR-7 seam in S1-T3/S2-T1 (factoring, all sprints) |

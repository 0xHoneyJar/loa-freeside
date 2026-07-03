# Software Design Document — Labelled Entities on the Worldline Spine

> Cycle `collections-sot` · implements prd.md (flatline-v2-integrated `d92e4e34`). Grounded in the
> shadow-mode ledger built PR #429 (the spine this consumes) + the proven derive-don't-ask keystone.
> Previous SDD archived: sdd.prev-2026-07-03-sandwich-line.md.

## 1. Architecture overview

Collections become **labelled entities on the existing hash-chained ledger** — reusing the spine
(PostgresLedgerStore, chain, freeze/verify, /recall governance) without disturbing member subjects.

```
RAW SIGNALS (bottom)                    DISTILL                    LABELLED ENTITY (queryable)
belt TrackedHolder ─┐                                             CollectionEntity
on-chain ERC-165  ──┼─► freeside collections sync ─► propose ─► (chain,contract) + labels{standard,
worlds /lookup ─────┘   (derive, READ-only)          (born-low)   collection_key, world, role} + provenance
                                                          │              │
                                          operator ratify (force-chain)  │  freeside collections query
                                          ai-derived → operator-validated│  (lexical, provenance-badged)
                                                          ▼              ▼
                                        shadow-audit reads the entities (settle gate) — env var retired
                                        freeside collections drift (re-derive, fail loud)
```

Design axis (SKP-001 resolution): collections are a **sibling labelled-entity**, NOT crammed into the
member-shaped `ShadowSubject`. The ledger's hash-chain + store machinery is generic (it hashes
observations); we add a collection observation/entity pair alongside members. Member `subjects`
untouched — the only shared change is additive.

## 2. FR-1 — the labelled entity on the spine (`packages/{protocol,services}/shadow-mode`)

- **Protocol** (`packages/protocol/shadow-mode/src/schemas/`): new `collection-entity.ts` —
  `CollectionEntity { entity_id, chain, contract, labels: CollectionLabels, provenance: LabelProvenance[] }`
  where `CollectionLabels = { token_standard: 'erc721'|'erc1155'|'unknown', collection_key, world?, role? }`.
  Identity = `entity_id = ${chain}:${contract}` (normalized, §7). `SubjectKind` enum GAINS `'collection'`
  (additive — the ONLY change to `subject.ts`; no new required field on `ShadowSubject`, member rows
  read unchanged).
- **Store** (`packages/services/shadow-mode/`): sibling table `0003_labelled_collections.sql` —
  `collection_entities(entity_id PK, chain, contract, labels jsonb, first_seen_at, updated_at)` +
  `collection_label_provenance(entity_id, label, source_type, read_state, ratified_by, ratified_at,
  event_id)` (append-only). Each entity ALSO appends a `collection.observed` observation to the
  existing hash chain (community_id = the world, or a `_unbound` sentinel until ratified) — so the
  entity's history is tamper-evident on the SAME worldline as members. `ILedgerStore` gains
  `upsertCollectionEntity` / `getCollectionEntity` / `listCollectionEntities` / `labelProvenance` —
  additive to the port (in-memory + Postgres both implement).
- **AC**: member-subject regression suite stays green (the additive enum + table can't touch it);
  a collection entity round-trips through both stores; its observation verifies on the chain.

## 3. FR-2 — the distillation engine (`freeside collections sync|propose`, freeside-cli)

- `sync` (READ-only): (a) belt GraphQL `TrackedHolder distinct_on collectionKey → {collectionKey,
  chainId, contract}`; (b) on-chain ERC-165 `supportsInterface(0x80ac58cd|0xd9b67a26)` per contract
  via a public RPC per chain (`unknown` when both false/revert); (c) world-binding proposal = reverse
  `/v1/worlds/lookup?chain&contract` where it resolves, else key-prefix heuristic (`apdao_*`→apdao,
  `puru_*`→purupuru, mibera-family→mibera), flagged `proposed`. Prints a ratifiable diff vs the SoT.
  Exit 0 = fully-ratified & coherent; non-zero = un-ratified/un-derivable rows exist (CI-usable).
- `propose`: distill into born-low entities — every derived label `source_type: ai-derived`,
  `read_state: unread`; subjective labels (world, role) blank + `unratified`. Writes are additive
  (upsert by entity_id, never overwrite a ratified label).
- **Hazard cures**: `collection_key` normalized `_`→`-` (event-schema grammar `/^[a-z][a-z0-9-]*$/`,
  `packages/events/src/schemas/nft-activity.ts`) — the diff shows the transform; `token_standard:
  unknown` when ERC-165 un-derivable, never assume erc721 (RATIFY-ONLY).
- **AC (IMP-002, the 24-collection proof)**: `sync` against live belt + public RPCs reproduces the
  committed `self-grounded-collections-registry.txt` (20 erc721 + 4 erc1155); a normalization test
  pins `_`→`-`; an ERC-165-revert fixture → `unknown`.

## 4. FR-3 — ratification = the /recall force-chain (agent-never-self-ratifies)

- A label flips `ai-derived → operator-validated` ONLY via `freeside collections ratify <key>`, which
  requires a fresh cockpit grant (the `memory-promotion-guard` hook shape: `touch
  ~/.claude/.recall-cockpit-grant`, 15-min TTL, one grant = one write). The agent has NO code path
  that writes `operator-validated` without the grant. Each ratify appends a `collection.label.ratified`
  provenance row (append-only) — the audit trail is the hash-chained ledger itself.
- DERIVED labels: the agent re-derives + overwrites freely (ground truth wins). RATIFIED labels: the
  agent NEVER flips; a re-derive that disagrees raises `contested` (FR-6).
- **AC (SKP-003)**: a self-ratify attempt without a grant is blocked (test asserts the guard); a
  ratify writes an append-only provenance row; a member subject cannot be collection-ratified (kind guard).

## 5. FR-4 — queryable like /recall (`freeside collections query`, lexical this cycle)

- A lexical query verb over the labelled entities: `freeside collections query "<q>"` → ranked entities
  with a provenance badge (`ai-derived`/`operator-validated`/`contested`), governed by the label
  trust-fields (contested withheld unless `--show-contested`, mirroring /recall). Matches on
  collection_key, contract, world, role. Returns JSON (agent) + a terse table (human).
- **QMD-source shape (not built this cycle, but the seam):** the entity export format is a
  QMD-registerable document set (one doc per entity, frontmatter = the trust-fields) so a follow-up
  registers it as a first-class /recall source for semantic+rerank parity — no schema change needed then.
- **AC (G-3)**: "collections in mibera" returns the mibera-family entities; "who owns 0x6666…c420"
  returns the mibera entity with its badge; a contested label is withheld by default.

## 6. FR-5 — settle gate: shadow-audit collapse (`packages/services/shadow-audit/bin/http.ts`)

- `loadRegistryFromEnv` becomes `loadRegistry`: reads the ratified collection entities (via a
  shadow-mode ledger projection query, or — assumption-guarded — a build-time snapshot committed to
  the image, the role-snapshot precedent) and builds the same `registryFromMap` shape. The
  `COLLECTION_REGISTRY` env becomes an optional deprecated override (env wins if set, for break-glass).
- **Kill-test AC**: boot shadow-audit with NO `COLLECTION_REGISTRY` env → `GET
  /v1/collections/:chain/:contract` serves the ratified set correctly; with the env set → env override
  honored (back-compat). The FR-1a operator ask is retired: no hand-authored registry needed.

## 7. Identity normalization (SKP-002a — single choke point)

`entity_id`, all lookups, and the belt/on-chain/worlds joins normalize through ONE function pair
(reuse `packages/services/ordering/src/contract-address.ts` `normalizeChainId`/`normalizeContractAddress`,
or lift to a shared util): chain → canonical numeric string; contract → lowercased `0x…40hex`. NO
checksum-case identity, NO aliasing on identity (`collection_key` is the only alias). **AC**: a
normalization test pins mixed-case + numeric/string chain inputs to one `entity_id`.

## 8. FR-6 — drift sensor (`freeside collections drift`)

Re-derives every DERIVED label (belt + on-chain) and classifies per entity:
`coherent` (matches) · `drifted` (derived label changed — auto-overwrite, log) · `orphaned` (in SoT,
no longer belt-tracked) · `unratified` (subjective label still blank) · `unknown_standard` (ERC-165
un-derivable). **Drift on a RATIFIED label → `contested`, never a silent overwrite.** Exit non-zero
on any `contested`/`orphaned`. Wire as a CI/cron check (fails loud). **AC**: a fixture where a derived
standard changed → `drifted`+overwritten; a ratified world changed under it → `contested`, not overwritten.

## 9. FR-7 — reuse-shaping

Factor the loop as `ground(): DerivedLabels[]` → `propose(entity, derived)` → `ratify(key, label)` →
`drift()` over a minimal `LabelledEntity { identity, derived_labels, subjective_labels, provenance }`.
Collections supply the concrete `ground()` (belt + ERC-165 + worlds) + label-map; a second entity kind
(e.g. RPC endpoints) supplies its own and inherits propose/ratify/drift/query. `// loa:shortcut: not
a framework — one internal interface + the collections impl; extract only when the 2nd kind lands.`

## 10. Security & privacy

Public data only (chain/contract/standard are on-chain-public; no member PII on collection entities —
the collection is a contract, not a person). Ratify auth = the cockpit-grant hook (no new secret).
Public RPCs for reads (no authed-RPC secret in the file). The query verb withholds `contested` by default.

## 11. Test strategy

Additive-ledger regression (member subjects untouched) · store round-trip + chain-verify for a
collection entity · sync reproduces the 24-collection proof + `_`→`-` + unknown-standard · self-ratify
blocked without grant + append-only provenance · query returns right entity + withholds contested ·
shadow-audit kill-test (no env → serves ratified set) · drift classes (drifted-overwrite vs
contested-preserve). Every non-trivial branch leaves a runnable check.

## 11.5 Flatline SDD integration (6 blocker-theme cures — the mutable-vs-chain model, resolved)

**The root fix (SKP-002/003, IMP-004): the append-only chain IS the source of truth; the entity table
is a derived PROJECTION** — exactly like member subjects fold from observations. There is NO direct
mutable label upsert. Every label change — a derive OR a ratify — is a NEW append-only observation on
the chain; `collection_entities` is re-folded from the observations (current label = the latest
observation for that (entity, label)). This makes provenance intrinsic (the chain), tamper-evidence
automatic (`verifyChain`), and divergence structurally impossible (one source). `upsertCollectionEntity`
is REMOVED from the port; the port gains `appendCollectionObservation` (goes through the chain) +
`getCollectionEntity` (folds). (Supersedes §2's upsert wording.)

- **Collection worldline keyed by the CONTRACT, not the world (SKP-003):** a collection observation's
  `chain_id` (ledger sense) = `entity_id` (`${chain}:${contract}`), so each collection has its OWN
  worldline. There is NO `_unbound` world chain. `world` is a LABEL on the entity (absent until
  ratified — the single unratified representation, IMP-009), never the chain key.

- **Collection observation event schema (IMP-001), explicit:** `collection.label.observed`
  `{ entity_id, chain, contract, label, value, source_type }` (a derive) and `collection.label.ratified`
  `{ entity_id, label, value, ratified_by }` (a ratify). Both are `ShadowObservation`-shaped, JCS-hashed,
  chained. The fold: latest `ratified` wins over `observed` for a subjective label; latest `observed`
  wins for a derived label; a derived-`observed` that contradicts a later `ratified` on the SAME label
  → `contested` (surfaced, not folded silently).

- **Ratification enforcement boundary (SKP-001 CRITICAL), stated honestly:** the grant-gated CLI is the
  SOLE sanctioned writer of a `collection.label.ratified` observation — there is NO service ratify
  endpoint this cycle (no non-CLI writer exists to guard). An out-of-band direct DB insert is caught by
  `verifyChain` (tamper-evidence) — the chain makes forgery loud, exactly as for member observations.
  `// loa:shortcut: a db superuser can still append a raw row; the chain makes it EVIDENT, and no
  service path mints ratify events — revisit if a service-side ratify endpoint is ever added.`

- **Shadow-audit projection precedence (IMP-002, IMP-009) — FAIL-CLOSED:** the registry shadow-audit
  builds includes a collection ONLY when `standard ∈ {erc721,erc1155}` (never `unknown`) AND `world`
  is `operator-validated` AND no `contested` label. `unratified` / `unknown_standard` / `contested`
  / `orphaned` entities are EXCLUDED — a not-yet-true label never produces an audit (money/ops
  fail-closed). Deterministic precedence: validated-and-coherent → included; anything else → excluded + logged.

- **Migration / rollback (IMP-003):** `0003` is additive (new tables + enum value); no member data
  touched. Rollback = the `COLLECTION_REGISTRY` env override (FR-5) — set it and shadow-audit ignores
  the SoT. Backfill = `propose` over the 24; no destructive step.

- **RPC determinism (IMP-006):** per-chain public RPC list with a 8s timeout + one retry; a transient
  failure → `standard: unknown` (logged), never a crash — so `sync`/`drift` are CI-deterministic
  (a flaky RPC degrades to `unknown`, it does not fail the run non-deterministically).

- **CLI contract (IMP-007, IMP-008):** `sync`/`query`/`drift` = READ-only (no creds; stable JSON:
  `{entity_id, chain, contract, labels, provenance, status}`; exit 0 coherent / non-zero otherwise).
  `propose`/`ratify` = MUTATING: refuse unless a writable ledger is configured (`DATABASE_URL` or the
  in-memory test store) AND, for `ratify`, a fresh cockpit grant; refuse in a `RAILWAY_ENVIRONMENT`/
  `NODE_ENV=production` context without an explicit `--yes` (no accidental prod/CI writes).

## 12. Cross-repo & sequencing

Mostly in-repo (loa-freeside `shared/shadow-mode` + shadow-audit + freeside-cli). No worlds-api write
(reframe removed the dual store; worlds `/lookup` is a read-authority for the world-binding proposal).
Sprint slicing: S1 = the entity + store (FR-1) + identity norm (§7); S2 = the distillation engine +
ratify (FR-2/3); S3 = query + shadow-audit collapse + drift (FR-4/5/6). G-4 (settle gate) depends only
on S1+S2. Reuse-shaping (FR-7) is a factoring discipline across all three, not a separate task.

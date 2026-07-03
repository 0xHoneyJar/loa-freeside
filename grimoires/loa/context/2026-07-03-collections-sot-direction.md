---
status: candidate
created: 2026-07-03
author: swarm-4 (ml-sot-consumers + EVANS + ml-sot-engine) + operator "build SoT agent-first, stop asking me — we have to organize" + proven derive-don't-ask keystone
mode: arch
plannable: true
source_construct_affinity: [worlds-api, shadow-audit, sonar-api, freeside-registry, evans, recall]
---

# Next-cycle direction — The Self-Grounding Collections Registry (derive-don't-ask)

## The thesis (one sentence)
Give the estate a single Source-of-Truth for "which NFT collections exist and their {chain, contract,
token_standard, world}" that the **agent self-populates from ground truth** (belt-gateway pull +
on-chain ERC-165 standard detection + the reverse world-lookup) and the **operator only ratifies** —
killing the ≥5 hand-maintained copies that make the operator the integration bus for facts.

## Why now (operator signal, not just a feature)
The operator: *"these questions [contract addresses / token standards / which collections / RPC URLs]
are ones you're asking me too often — meaning we have to organize."* Every one of those questions is
the **operator-as-integration-bus** disease at the fact altitude. The organizing principle is
**derive-don't-ask**: the agent grounds every fact it can from the world; the operator ratifies
instead of hand-authoring.

## The keystone — PROVEN this session (zero operator input)
- **chain + contract + collection_key** pulled live from belt-gateway `TrackedHolder`
  (24 collections, `distinct_on: collectionKey`).
- **token_standard derived ON-CHAIN** via ERC-165 `supportsInterface` (erc721=`0x80ac58cd`,
  erc1155=`0xd9b67a26`) against public RPCs — correctly classified 20 erc721 + **4 erc1155** (the
  puru/Base set), catching the exact "silently-wrong standard" case the operator would otherwise
  have to answer. Full self-grounded table: `grimoires/loa/context/self-grounded-collections-registry.txt`.
- **world binding** derivable-with-ratify: `apdao_seat`→apdao and the 19 mibera-family keys→mibera
  bind from the existing reverse index + key prefix; `puru_*` (4) points at a **purupuru world not on
  the deployment registry** — the one field the ratification loop is for.

## SoT HOME (EVANS verdict — Option A: the WORLDS bounded context owns collections)
- **World = aggregate root**, **Collection = entity** identified by `(chain, contract)`. `collection_key`
  is a belt ROUTING ALIAS (NATS topic segment `/^[a-z][a-z0-9-]*$/`), NOT the identity. `role`
  (primary/companion/lore) is world-scoped semantics.
- **worlds-api already owns the reverse half**: `GET /v1/worlds/lookup?chain&contract → {world_slug}`.
  The SoT is the FORWARD half (`world → collections[]`), an additive world-manifest field (1.2 → 1.3).
- **Invariant: one collection ↔ exactly one world** (the WHO×WHAT ladder needs an unambiguous owner
  for score/inventory roll-up); global `(chain, contract)` uniqueness is a repository-level key.
- Rejected: Option C (indexer-owns) inverts ADR-008 belt direction (closer-to-raw publishes, closer-to-
  meaning governs); Option B (dedicated cell) splits an aggregate with no independent language (YAGNI).

## THE ENGINE (derive-don't-ask, reusing existing estate governance)
- **Field truth-location**: DERIVED (chain, contract, standard, collection_key, deployed_at, name-candidate);
  RATIFY-ONLY (world, role, opt_in — subjective, no ground to check); SECRET (authed RPC — but public
  RPCs suffice for reads, so ZERO secrets in the file). Operator touch → review a diff + author 3
  subjective fields per new collection.
- **Ratification = the /recall COCKPIT with the store swapped** (`~/.claude/skills/recall/SKILL.md`):
  rows born `source_type: ai-derived`/`read_state: unread` (rank low), operator promotes with one
  gesture (skimmed-ok→sign→stake). **The teeth carry over**: point `memory-promotion-guard.sh` at the
  SoT file → the agent physically cannot flip a row to `operator-validated` without a fresh cockpit
  grant. This is not new governance — it's /recall with a different store.
- **CLI verbs (agent-first, modeled on freeside-cli inspect/doctor)**: `freeside collections sync`
  (derive-all, READ-only, prints ratifiable diff) → `propose` (writes born-low rows, subjective fields
  blank+flagged) → `ratify <key>` (operator's one gesture) → `drift` (CI/cron sensor, re-derive+compare,
  non-zero on drift; re-derives but NEVER ratifies — drift on an operator-validated row raises contested,
  never silently overwrites operator truth).

## Consumers to COLLAPSE (ml-sot-consumers map — every read replaces a hand-authored copy)
1. **shadow-audit `COLLECTION_REGISTRY` env** (`bin/http.ts:40-63`) — highest drift/money-stakes; reads
   the SoT at boot instead of a hand-typed env var. **This retires the FR-1a operator ask entirely.**
2. **sonar `constants.ts` + `tracked-erc721/constants.ts` + `svm/collection-registry.ts`** — the
   fragmented hand-authored master → becomes a materialized VIEW derived from the SoT (belt direction).
3. **dashboard `CONTRACT_REGISTRY: {}` (empty placeholder, literally "populated when upstream publishes")
   + audit/member zero-address placeholders** — the ready-made consumer, currently null → reads SoT.
4. **worlds `purupuru.yaml nft_contracts: []`** (empty scaffold) → subsumed by the `collections` field.
Preserve the good patterns: score-api's opaque `collection_key` join handle; sonar SVM registry's
ID-vs-presentation split.

## Two grounded HAZARDS (must be in the design)
1. **collection_key charset drift (LIVE):** belt returns underscores (`apdao_seat`); the consuming
   event schema `packages/events/src/schemas/nft-activity.ts:42,73` pins `/^[a-z][a-z0-9-]*$/`
   (hyphens, NO underscores). Sync MUST normalize `_`→`-` and the diff must show the transform.
2. **standard NOT always ERC-165-derivable:** legacy ERC-721s omit 165 → `supportsInterface` reverts /
   false-for-both. Classify `standard: unknown` → RATIFY-ONLY, NEVER assume erc721.

## The generalizing win (the operator's "organize")
This establishes the reusable **self-grounding registry pattern**: agent grounds from the world →
operator ratifies via the /recall cockpit → consumers read the projection. Collections is the FIRST
instance; the pattern retires operator-as-integration-bus for any estate fact currently held in the
operator's head. Scope THIS cycle to collections; design the engine so the pattern generalizes.

## Non-goals (defer with triggers)
- A dedicated collections-registry building (Option B) — trigger: collections grow an independent
  lifecycle (per-collection deploy/revenue).
- Migrating sonar's tracked-set to read the SoT — trigger: after the SoT is populated + ratified
  (sonar is the producer of belt's data; flip it to consumer once the SoT is authoritative).
- Shared collections (one collection in multiple worlds) — model as read-only reference if ever real;
  the one-world invariant holds for now.

## Open forks for /plan-and-analyze
- SoT physical form: the `collections` block in each `world.yaml` (EVANS's additive 1.3) vs a
  worlds-api-owned table with a manifest projection. (EVANS leans manifest-additive; the durable
  manifest-index work last cycle is the persistence precedent.)
- Ratification surface: reuse the exact `/recall` cockpit + memory-promotion-guard, or a worlds-api
  `ratify` route. (The recall-cockpit reuse is the cheaper, proven path.)
- Cycle scope: SoT + populate + ratify + ONE consumer collapse (shadow-audit env → read) as the
  settle gate, vs also collapsing sonar/dashboard.

## Related
worlds-api world-manifest.schema.json (additive 1.3), shadow-audit bin/http.ts COLLECTION_REGISTRY,
packages/events/src/schemas/nft-activity.ts (key grammar), ~/.claude/skills/recall/SKILL.md,
grimoires/loa/context/self-grounded-collections-registry.txt, [[project_sandwich-line-cycle]]
(the shadow-audit deploy this unblocks), [[feedback_ground-deployed-state-before-asserting]].

---
cutover: sonar-token-entity-mibera
date: 2026-05-27
persona: KRANZ
scope: cross-repo (freeside-sonar + inventory-api)
status: PR open · MIGRATION CONTEXT — Envio framework being ported to Ponder (sonar-ponder-coordinator); invariant survives port
reversibility: revert-clean per PR; substrate write is additive
acceptance_threshold: inventory-api `getNftsForOwner(soju|jani|zerker, MIBERA)` returns non-empty array bytes-matched against `cast call ownerOf` for 10 random tokenIds
related_pr: https://github.com/0xHoneyJar/sonar-api/pull/38
related_doctrine: (none — substrate-write pattern; future distill candidate)
related_memory: token-entity-gap · envio-to-ponder-port
---

# Cutover: Sonar Token Entity Write for Mibera Handlers

> KRANZ Coordinate-act conclusion: per-token ownership is the gate to inventory-api live mode and mibera-honeyroad stash UI. The `Token` entity is already declared in sonar's schema (`schema.graphql:326-335`); Mibera handlers don't write to it. This cutover closes that gap.

> **Status note (2026-05-28):** PR #38 implements the substrate write in Envio's handler API. The cluster is concurrently porting the indexer from Envio → Ponder (per `sonar-ponder-coordinator`). The PR #38 code becomes a substrate-invariant reference for the Ponder rewrite; the implementation API changes but the semantic contract (per-token Token entity + staking-gate + burn-flag + idempotency) is preserved. See memory `envio-to-ponder-port`.

## Scope

| Layer | Repo | Change |
|---|---|---|
| Substrate write | freeside-sonar / sonar-api | Insert `Token.set(...)` calls in Mibera handlers; staking-gate the write |
| Re-index | freeside-sonar (Envio OR Ponder) | Re-index from genesis on affected contracts |
| Consumer flip | inventory-api | Swap `tokenIds: []` hardcode → live sonar Token query (separate runbook: `move-3b-inventory-api-flip-2026-05-27`) |

## Coordinate (Act 1) — read the room

- Audit: `Token` entity exists at `schema.graphql:326-335`. Declared, unused for Mibera.
- Telemetry: `inventory-api/src/live-sonar.ts:6-9` documents the gap. `inventory-api/src/inventory.ts:73` hardcodes `tokenIds: []`.
- Dependencies: `STAKING_CONTRACT_KEYS` from `src/handlers/mibera-staking/constants.ts` (paddlefi `0x242b...4e1`, jiko `0x8778...246`) — staking transfers must NOT stamp `owner = stakingContract`.
- Reference impl: `src/lib/erc721-holders.ts:54-73` writes `Token` for crayons via `processErc721Transfer`. Has overlap with `TrackedHolder` write path; don't double-write.

## Mirror (Act 2) — substrate move (LANDED IN PR #38)

**Branch:** `feat/token-entity-mibera-handlers` off `main` (drift fix: branched off origin/main `f2d0bfd6`, NOT the runbook's claim `6ad33270` — origin/main was 561 commits ahead at dispatch time).

**Files:**
- `src/lib/set-token-owner.ts` — new helper with staking-skip gate
- `src/handlers/mibera-collection.ts` — `setTokenOwner(...)` call inserted after `MiberaTransfer.set`
- `src/handlers/tracked-erc721.ts` — same insertion after holder-adjust
- `src/lib/__tests__/set-token-owner.test.ts` — 9/9 tests covering: normal transfer, paddlefi staking-skip, jiko staking-skip, burn-address flag, idempotency on re-index

**Schema diff:** NONE (`Token` entity exists at `schema.graphql:326-335`).

## Substrate invariants (load-bearing across framework port)

These survive Envio → Ponder:

1. **Per-token Token entity:** `Token { id, collection, chainId, tokenId, owner, isBurned, mintedAt, lastTransferTime }`. `id = ${collection}_${chainId}_${tokenId}`
2. **Staking-gate:** when transfer destination is in `STAKING_CONTRACT_KEYS`, DO NOT stamp `owner = stakingContract`. Preserve prior owner.
3. **Burn-flag:** `isBurned: true` when destination is burn address.
4. **Idempotency on re-index:** entity writes are upserts; same input second call is no-op.
5. **Apply to family:** mibera-collection, tracked-erc721 (covers Apiology, tarot, fractures, lore). NOT mibera-sets (ERC1155).

## Verify (Act 3) — three-layer gate (gated on indexer-port completion)

**Layer 1 — Smoke canary:** existing handler tests pass + new `set-token-owner.test.ts` covering staking-skip, burn-flag, idempotency. ✅ GREEN at PR open.

**Layer 2 — Parity sample (operator-driven, post-indexer-port):**
- After Envio re-index OR Ponder reindex completes, query GraphQL for 10 random Mibera `(tokenId, owner)` pairs
- `cast call $MIBERA_COLLECTION_ADDRESS "ownerOf(uint256)" $tokenId --rpc-url $BERACHAIN_RPC`
- Compare: sonar `owner` lowercase == chain `ownerOf` lowercase for all 10
- Acceptance: 10/10 identical, 0 drift, parity report committed

**Layer 3 — Operator gate:** review parity report + GO for inventory-api Flip PR.

## Flip (Act 4) — consumer swap (separate PR in inventory-api)

See `move-3b-inventory-api-flip-2026-05-27.runbook.md`.

## Re-index trigger contracts (operator action)

After substrate write merges + framework port stable, re-index from genesis on:
- `0x6666397dfe9a8c469bf65dc744cb1c733416c420` — Mibera main collection (Berachain 80094)
- `0xfc2d7ebfeb2714fce13caf234a95db129ecc43da` — Apiology DAO seat NFT (80094)
- `0x4b08a069381efbb9f08c73d6b2e975c9be3c4684` — mibera_tarot (80094)
- 10 fracture contracts + 7 lore contracts (lore is chainId 10 Optimism) — full list in `src/handlers/tracked-erc721/constants.ts`

## Distill (Act 5)

Pattern: "schema-declared entity unwritten by consumer handlers" — generalizable detection across other tracked collections. Distillation candidate to construct-freeside.

## Out-of-scope

- Multi-collection inventory-api refactor (separate cycle)
- Asset bytes pipeline (Mibera assets already at `assets.0xhoneyjar.xyz`)
- Midi-backfill discord-relax (DROPPED per operator)

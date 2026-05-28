---
cutover: inventory-api-flip-to-live-ownership
date: 2026-05-27
persona: KRANZ
scope: single-repo (inventory-api)
status: drafted · gated on (a) Move-3 substrate write in indexer (Envio PR #38 OR Ponder rewrite — invariant survives port) AND (b) indexer re-index complete AND (c) Layer-2 parity 10/10 green
reversibility: revert-clean per PR (consumer swap of one hardcoded `tokenIds: []` → live query call); revert returns the dark-stash state
acceptance_threshold: `getNftsForOwner(<wallet>, MIBERA)` returns non-empty array for soju/jani/zerker known wallets; bytes-match cast call ownerOf for 10 random tokenIds; `getHoldings(addr)` ACVP envelope reports `source: live`
related_runbook: move-3-sonar-token-entity-2026-05-27.runbook.md
related_memory: token-entity-gap · envio-to-ponder-port
---

# Cutover: inventory-api Flip to Live Ownership (Move 3b)

> KRANZ Coordinate-act framing: this is the CONSUMER half of Move 3. The PRODUCER half (sonar / Ponder writing per-token ownership) is Move 3a. This Flip happens AFTER the producer's substrate write is live + re-indexed + parity-verified. The runbook is indexer-agnostic — whether Envio's `context.Token.set` (PR #38) or Ponder's equivalent ships the data, the consumer query shape stays the same.

## Coordinate (Act 1)

- **Substrate dependency:** indexer GraphQL exposes per-token ownership at `Token { id, collection, chainId, tokenId, owner, isBurned }`. Invariant survives Envio → Ponder port.
- **Current consumer state:** `inventory-api/src/inventory.ts:73` hardcodes `tokenIds: []` in the live branch
- **Documented gap:** `inventory-api/src/live-sonar.ts:6-9` carries the verbatim gap comment; `docs/sonar-ownership-gap.md:14-23` is the filed change-request with acceptance criteria
- **Single-collection scope:** `inventory.ts:61,67,81` only resolves `MIBERA_CONTRACT`. Multi-collection is a separate refactor.
- **Staking nuance survives the port:** indexer-side staking-gate must preserve user as owner.

## Mirror (Act 2)

**Branch:** `feat/inventory-live-ownership` off `inventory-api` `main`.

### Change 1 — `src/live-sonar.ts` (add live ownership query)

Add `liveOwnerTokenIds(address, collectionKey)` per `docs/sonar-ownership-gap.md` acceptance: query indexer GraphQL for `Token` entities filtered by `owner = address.toLowerCase() AND collection = COLLECTION_ADDRESS[collectionKey] AND isBurned = false`. Returns `bigint[]` of tokenIds, sorted ascending.

### Change 2 — `src/inventory.ts:73` (swap hardcode)

```diff
-  tokenIds: [],  // SUBSTRATE GAP: see live-sonar.ts:6-9
+  tokenIds: await liveOwnerTokenIds(address, "MIBERA"),
```

Adjust ACVP envelope: `source: "live"` on success; `source: "degraded"` on indexer-unreachable fallback.

### Change 3 — `docs/sonar-ownership-gap.md`

Update status from "OPEN" to "CLOSED — substrate landed in {indexer-PR-URL} + consumed in {this-PR-URL}".

### Change 4 — `README.md`

Update Modes table: Live mode shifts from "🟡 partial" to "✅ full".

## Verify (Act 3) — three-layer

**Layer 1 — Smoke:** `SONAR_GRAPHQL_ENDPOINT=<live-belt-gateway> npm test -- live-smoke` in inventory-api. New `live-ownership-smoke.test.ts` asserts: known wallets return non-empty token arrays; unknown wallets return empty (not error); staking-edge wallets return their unstaked + staked tokens correctly.

**Layer 2 — Parity sample (operator-driven):** For 10 random Mibera tokenIds, `cast call ownerOf` vs `getNftsForOwner($owner).tokenIds` containing `$tokenId`. Acceptance: 10/10 chain-vs-consumer parity.

**Layer 3 — Operator gate:** Review PR + parity report. Confirm staking edge.

## Flip (Act 4) — single PR merge

Merge → watch indexer GraphQL error rate + inventory-api 5xx for 30min post-merge. Green → next-step (mibera-honeyroad stash UI swap, separate Move).

## Dispatch gate

Do NOT dispatch this runbook until:
- [ ] Indexer Move 3a is live (PR #38 merged OR Ponder rewrite shipped with equivalent semantic)
- [ ] Indexer re-index from genesis is complete on all 13 Mibera-family contracts
- [ ] Layer-2 parity 10/10 against indexer GraphQL: operator-confirmed
- [ ] Staking gate confirmed working (wallet with known staked Mibera returns user as owner, not staking contract)

## Out-of-scope

- Multi-collection support — separate cycle
- Mibera-honeyroad stash UI swap — separate Move (consumes this PR's now-live `getNftsForOwner`)
- ACVP envelope completeness verification (`complete: true` requires holder_count match against on-chain totalSupply)
- Ponder vs Envio framework choice — orthogonal; this runbook works against either

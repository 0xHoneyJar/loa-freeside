---
status: candidate
mode: arch
domain: shared
authored: 2026-07-10
use_label: usable
money_ops: true
pending: operator-greenlight
related:
  - "2026-07-10-shadow-audit-mvp-definition-of-done.md"
---

# Shadow-Audit COLLECTION_REGISTRY — grounded candidate (pending operator greenlight)

> Money/ops: a wrong address → silently-wrong audit. Every entry below is dual-sourced from
> `sonar-api/config.yaml` (envio indexer — what is actually indexed) AND
> `sonar-api/src/handlers/constants.ts` `ADDRESS_TO_COLLECTION` (canonical belt id → address).
> Keys are `<chainId>/<lowercase-address>`; all sourced collections are **erc721** (every contract
> emits `Transfer(address,address,uint256 tokenId)`). `crayons_factory` OMITTED (verify-or-omit — it is
> a factory emitting `Factory__NewERC721Base`, not an ownable ERC721; registering it yields an empty audit).

## GREENLIT scope (operator, 2026-07-10): ALL verified chains — skip Zora

Operator decision: *"our own community is the most multichain there is."* thj/Honey Jar holders span every
chain — register the full verified set. Skip Zora 7777777 only (its plain JSON-RPC is unverified in cluster
config; dropping it omits HoneyJar3-on-Zora, an accepted gap). Post-deploy §5 spot-check against a known
holder is the address-correctness gate. Chains: **1, 10, 8453, 42161, 80094** (5 verified RPCs).

```json
{
  "1/0xa20cf9b0874c3e46b344deaeea9c2e0c3e1db37d": {"collection":"HoneyJar1","standard":"erc721"},
  "1/0x3f4dd25ba6fb6441bfd1a869cbda6a511966456d": {"collection":"HoneyJar2","standard":"erc721"},
  "1/0x49f3915a52e137e597d6bf11c73e78c68b082297": {"collection":"HoneyJar3","standard":"erc721"},
  "1/0x0b820623485dcfb1c40a70c55755160f6a42186d": {"collection":"HoneyJar4","standard":"erc721"},
  "1/0x39eb35a84752b4bd3459083834af1267d276a54c": {"collection":"HoneyJar5","standard":"erc721"},
  "1/0x98dc31a9648f04e23e4e36b0456d1951531c2a05": {"collection":"HoneyJar6","standard":"erc721"},
  "1/0xcb0477d1af5b8b05795d89d59f4667b59eae9244": {"collection":"Honeycomb","standard":"erc721"},
  "42161/0x1b2751328f41d1a0b91f3710edcd33e996591b72": {"collection":"HoneyJar2","standard":"erc721"},
  "10/0xe1d16cc75c9f39a2e0f5131eb39d4b634b23f301": {"collection":"HoneyJar4","standard":"erc721"},
  "8453/0xbad7b49d985bbfd3a22706c447fb625a28f048b4": {"collection":"HoneyJar5","standard":"erc721"},
  "80094/0xedc5dfd6f37464cc91bbce572b6fe2c97f1bc7b3": {"collection":"HoneyJar1","standard":"erc721"},
  "80094/0x1c6c24cac266c791c4ba789c3ec91f04331725bd": {"collection":"HoneyJar2","standard":"erc721"},
  "80094/0xf1e4a550772fabfc35b28b51eb8d0b6fcd1c4878": {"collection":"HoneyJar3","standard":"erc721"},
  "80094/0xdb602ab4d6bd71c8d11542a9c8c936877a9a4f45": {"collection":"HoneyJar4","standard":"erc721"},
  "80094/0x0263728e7f59f315c17d3c180aeade027a375f17": {"collection":"HoneyJar5","standard":"erc721"},
  "80094/0xb62a9a21d98478f477e134e175fd2003c15cb83a": {"collection":"HoneyJar6","standard":"erc721"},
  "80094/0x886d2176d899796cd1affa07eff07b9b2b80f1be": {"collection":"Honeycomb","standard":"erc721"}
}
```

RPC vars needed (all verified in `packages/core/ports/chain-provider.ts` CHAIN_CONFIGS):
```
RPC_URL_1=https://eth.drpc.org
RPC_URL_10=https://optimism-rpc.publicnode.com
RPC_URL_8453=https://base.drpc.org
RPC_URL_42161=https://arbitrum.drpc.org
RPC_URL_80094=https://berachain.drpc.org
```
(HoneyJar3-on-Zora `7777777/0xe798c4d4…` intentionally OMITTED — RPC unverified.)

## Full grounded map (all chains, for the record — expand from here only as thj needs)

| chainId | address | collection | config.yaml | constants.ts | RPC verified? |
|---|---|---|---|---|---|
| 1 | 0xa20cf9b0874c3e46b344deaeea9c2e0c3e1db37d | HoneyJar1 | :564 | :25 | yes (eth.drpc.org) |
| 1 | 0x3f4dd25ba6fb6441bfd1a869cbda6a511966456d | HoneyJar2 | :575 | :29 | yes |
| 1 | 0x49f3915a52e137e597d6bf11c73e78c68b082297 | HoneyJar3 | :579 | :30 | yes |
| 1 | 0x0b820623485dcfb1c40a70c55755160f6a42186d | HoneyJar4 | :583 | :31 | yes |
| 1 | 0x39eb35a84752b4bd3459083834af1267d276a54c | HoneyJar5 | :587 | :32 | yes |
| 1 | 0x98dc31a9648f04e23e4e36b0456d1951531c2a05 | HoneyJar6 | :565 | :26 | yes |
| 1 | 0xcb0477d1af5b8b05795d89d59f4667b59eae9244 | Honeycomb | :570 | :27 | yes |
| 42161 | 0x1b2751328f41d1a0b91f3710edcd33e996591b72 | HoneyJar2 | :604 | :34 | yes (arbitrum.drpc.org) |
| 7777777 | 0xe798c4d40bc050bc93c7f3b149a0dfe5cfc49fb0 | HoneyJar3 | :612 | :36 | **NO — Zora JSON-RPC unverified** |
| 10 | 0xe1d16cc75c9f39a2e0f5131eb39d4b634b23f301 | HoneyJar4 | :620 | :38 | yes (optimism publicnode) |
| 8453 | 0xbad7b49d985bbfd3a22706c447fb625a28f048b4 | HoneyJar5 | :653 | :40 | yes (base.drpc.org) |
| 80094 | (7 rows above) | HoneyJar1-6 + Honeycomb | :700-710 | :42-48 | yes |

## Rigor flags (carry into deploy)

1. **chainId is load-bearing** — `0x886d2176…` is Honeycomb on 80094 but MiberaSets on Optimism/10
   (`config.yaml:625`). Never strip the `<chainId>/` prefix.
2. **PROXY_CONTRACTS excluded** — Kingdomly bridge proxies (`constants.ts:12-20`) *hold* bridged NFTs but
   are not the ownable token contracts; deliberately absent.
3. **collection string is correctness-critical** — a typo matches zero Transfers → empty audit
   (`bin/http.ts:48-50`). Values above are verbatim from `ADDRESS_TO_COLLECTION`.

## Deploy inputs status

- `COLLECTION_REGISTRY` — grounded (this file), **pending operator greenlight + scope confirm**.
- `RPC_URL_80094` — verified (`berachain.drpc.org`). Additional chains need their RPC only if registered.
- `SHADOW_AUDIT_API_KEY` — generated this session (operator holds).
- `thj` role snapshot + `snapshot_date` — still needed (community/bot export).
- Railway project `shadow-audit-api` — to create (bead `arrakis-ltokd`).

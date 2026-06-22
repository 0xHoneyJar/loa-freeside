# Software Design Document — Shadow Access Audit (dogfood-NFT magnet)

> **Status**: candidate · **Cycle**: connecting-surface · **Date**: 2026-06-21 · traces to `grimoires/loa/prd.md` (v2.1).
> **Scope**: the dogfood-NFT magnet ONLY (PRD §6). Incubated in loa-freeside (a surface, not a new cell).
> **Claim tags**: `[OBSERVED]` live-probed this cycle · `[DESIGN]` proposed.

## 0. Traceability (PRD → SDD)

| PRD | SDD component |
|-----|---------------|
| FR-1 Order schema | §3.1 `Order` (Zod) |
| FR-2 AccessDecisionRecord + sealed eligibility | §3.2 `AccessDecisionRecord` (Zod) + §4 single-contract NFT resolver |
| FR-3 stateless compose-face + date→block | §2 `AuditService` + §4 sonar reconstruction |
| FR-4 mode contract (dogfood-full) | §2 `ModeResolver` |
| FR-5 confront-and-capture instrumentation | §2 `EventStore` (consented, append-only) |
| FR-6 aggregate-public + auth-gated-named | §5 API + §6 `AssociationVerifier` |
| FR-7 resolver (beacons→DAG) | §2 `CapabilityResolver` (minimal: sonar+score) |
| FR-8 abuse/cost controls | §6 rate-limit + `ScoreProxy` + circuit-breaker |
| NFR-1 member-data-stateless | §2 (no member persistence; only the event store) |
| NFR-7/8 auth/privacy/cost | §6 |
| AC-1..6 | §8 |

## 1. Architecture Overview

The magnet is a **stateless read + a minimal append-only event store**, incubated in loa-freeside. One request → one recomputed audit. No member data persisted.

```
  Client (Dashboard route, public)
        │  GET /v1/audit?chain&contract&snapshot_date  (+ optional owner_wallet sig)
        ▼
  ┌──────────────────────────────────────────────────────────┐
  │  AuditService (loa-freeside, packages/services/shadow-audit)│
  │   1. ModeResolver        → dogfood-full | external (refuse) │
  │   2. CapabilityResolver  → sonar + score (the magnet DAG)   │
  │   3. date→block          → snapshot_block (UTC, finality)   │
  │   4. SonarClient         → holders@block (Transfer replay)  │ ──▶ belt-gateway GraphQL [OBSERVED]
  │   5. ScoreProxy          → whale/concentration (server-side)│ ──▶ score-api (static key, proxied)
  │   6. RoleSnapshot        → dogfood Discord roles            │ ──▶ our role export (dogfood only)
  │   7. EligibilityResolver → band per member (stale/missing)  │
  │   8. AccessDecisionRecord[] + aggregate                     │
  │   9. AssociationVerifier → gate named output                │
  │  10. EventStore.append   → run-event (consented)            │
  └──────────────────────────────────────────────────────────┘
        │  aggregate (anonymous) | named records (authed) + CTA
        ▼  + reaction-capture ("does this match what you expected?")
  Conversation CTA → the interview (the falsifier)
```

## 2. Components (all in loa-freeside; `packages/services/shadow-audit/` unless noted)

- **`AuditService`** — orchestrates the flow; pure compute, no member persistence (NFR-1). Returns `{aggregate, records?, cta}`.
- **`ModeResolver`** — `dogfood-full` iff the community is one we operate AND a fresh role snapshot exists; else `external` → **refuse with the conversation hook** (v1 cannot serve external; PRD FR-4/SKP-002). No silent degradation.
- **`CapabilityResolver`** — reads `packages/freeside-registry/registry.yaml` + beacons; for the magnet the DAG is trivial (sonar→score). Exceptions → bead (`br create`).
- **`SonarClient`** (`packages/adapters/sonar/`) — GraphQL against `belt-gateway-production.up.railway.app/v1/graphql` (no-auth, **server-side only**). `[OBSERVED]` `Transfer{blockNumber,collection,from,to,tokenId}` over 8 collections. Reconstructs ownership@block (§4).
- **`ScoreProxy`** (`packages/adapters/score/`) — server-side proxy to score-api `/v1/wallets/:address`; the static key is held server-side, **never shipped to the client** (FR-8). Circuit-breaker + timeout.
- **`RoleSnapshot`** — loads a dogfood community's Discord role export `{source, captured_at, role_ids, export_method, owner, freshness_threshold}` (PRD FR-4a). If older than `freshness_threshold` → UI uncertainty label; the confront-number is NOT presented as fact.
- **`EligibilityResolver`** — v1: single-contract NFT (ERC-721/1155) balance-threshold only (`qualifies = ownsAtLeast(threshold)@snapshot_block`). One sealed rule (resolves the EligibilityRule breach). Out-of-scope gating → refuse (AC-3).
- **`AssociationVerifier`** — gates named/member-level output: anonymous → aggregate only; named → EIP-191 `owner_wallet` sig **bound to the community** (matches contract `owner()`/deployer, or a registered owner). Bare sig insufficient (flatline v2 SKP-001).
- **`EventStore`** (`apps/worker` DB, a single append-only table) — run-events `{run_id, mode, inputs_hash, stale_set_size, time_on_stale_section, reruns, reaction, cta_interaction, ts}` + consented contact. Stated retention window. The ONLY persistence; member holdings/scores/roles are NOT stored (NFR-1).
- **Dashboard route** — public self-serve audit + reaction capture + dual CTA (product + conversation). v1: a thin route on the Freeside Dashboard; the SDD treats the **API** as the deliverable, the UI as a thin consumer.

## 3. Data Models (sealed Zod, `packages/protocol/shadow-audit/`)

### 3.1 `Order`
`{ community: {name, owner_wallet}, source: {chain, contract_address}, gating_rule: {kind: 'nft-balance', threshold: number}, products: ['audit'], mode: 'lead-magnet' }` — **v1 single source** (reconciles FR-1↔FR-3).

### 3.2 `AccessDecisionRecord`
`{ wallet, community, holds_role: boolean, qualifies: boolean, band: 'stale'|'missing'|'ok', evidence: {balance_at_snapshot, last_held_block?, sold_at?}, provenance: {rule_id, snapshot_block, computed_at, sources: ['sonar','score','role-snapshot']} }` — **bands only, no numeric score**; evidence is one-click-verifiable on-chain.

### 3.3 Audit output
`{ aggregate: {holder_turnover, sold_lapsed_count, newly_eligible_count, whale_concentration, stale_access_risk_band}, records?: AccessDecisionRecord[] (authed only), cta: {product, conversation} }`.

## 4. The dogfood-NFT data flow (concrete, `[OBSERVED]`-grounded)

1. **date→block**: `snapshot_date` → block at the chain's UTC-day boundary, at a stated finality depth (e.g. N confirmations). Record `snapshot_block`.
2. **ownership@block** (reconstruction): query sonar `Transfer(where:{collection:{_eq:C}, blockNumber:{_lte:snapshot_block}}, order_by:{blockNumber:asc})` paginated; fold `from→to` per `tokenId` to derive the holder set at `snapshot_block`. `[OBSERVED]` the Transfer log + block-filter support this for the 8 collections.
3. **current ownership**: same fold to HEAD → diff vs snapshot = `sold_lapsed` (exited) + `newly_eligible`.
4. **stale intersection** (dogfood-full): `sold_lapsed ∩ holds_role(RoleSnapshot)` = the **stale set** (the confront number).
5. **whale/concentration**: `ScoreProxy` per top holder (or score-api aggregate).
6. Compose `AccessDecisionRecord[]` + aggregate. Persist nothing but the run-event.

## 5. API Contracts

- `GET /v1/audit` → `{aggregate, cta}` (anonymous) | `{aggregate, records, cta}` (with valid `owner_wallet` sig). Params: `chain, contract, snapshot_date, [owner_wallet, sig]`.
- `POST /v1/audit/reaction` → `{run_id, reaction: 'worse'|'expected'|'surprised'}` → EventStore.
- `POST /v1/audit/contact` → `{run_id, contact, consent: true}` → EventStore (consent required).

## 6. Security Architecture

- **Named-output auth (FR-6, SKP-001 fix)**: `AssociationVerifier` requires an EIP-191 sig from `owner_wallet` AND that wallet binds to the community (contract `owner()`/deployer match, or a registered owner record). Anonymous = aggregate only (no named wallets).
- **Abuse/cost (FR-8)**: per-IP rate-limit + request cap (gateway middleware); `ScoreProxy` keeps the static key server-side; per-request circuit-breaker + timeout so one audit can't exhaust sonar/score.
- **Privacy (NFR-7)**: the EventStore stores run-events + consented contact only; member holdings/roles NOT persisted; stated retention; consent line at contact capture.

## 7. Tech Stack + Placement

TypeScript, loa-freeside monolith. `packages/protocol/shadow-audit/` (Zod schemas), `packages/services/shadow-audit/` (AuditService + resolvers), `packages/adapters/{sonar,score}/` (clients — reuse the chain-adapter circuit-breaker pattern), `apps/gateway/` route. Tests in each (vitest), incl. fixtures for AC-1. No new cell (incubate-then-extract).

## 8. Acceptance Criteria → Components (PRD §6.5)

- **AC-1** correctness → `SonarClient` reconstruction + `EligibilityResolver` (fixture: known collection @ known block).
- **AC-2** date→block determinism → §4.1.
- **AC-3** refusal of out-of-scope gating → `EligibilityResolver`.
- **AC-4** auth (anon=aggregate, named=sig+binding) → `AssociationVerifier`.
- **AC-5** mode determinism + freshness label → `ModeResolver` + `RoleSnapshot`.
- **AC-6** key never client-side + rate-limit under load → `ScoreProxy` + gateway middleware.

## 9. What NOT to Build (carried from PRD §6)

No member-data persistence/new cell · no Discord role writes · no numeric score · no gating beyond single-contract NFT balance (refuse the rest) · no external/arbitrary-contract data (sonar has none; medium-term = on-demand sonar indexing) · no shadow-mode/D4 (the CTA's later conversion target) · no products 2-4.

## 10. Risks → Design Mitigations

- Historical-at-block (PRD R-3): `[OBSERVED]` reconstructable for the 8 collections (§4); AC-1 fixture binds it. External arbitrary contracts unsupported → `ModeResolver` refuses (no false audit).
- Confirm-by-construction (R-1): the API is a build/UX + dogfood instrument; falsification = the interview (out of code scope).
- Wrong confront-number (R-6): sealed single rule + refusal + freshness label.
- DoS/key-leak (R-7): §6 abuse controls + server-side proxy.

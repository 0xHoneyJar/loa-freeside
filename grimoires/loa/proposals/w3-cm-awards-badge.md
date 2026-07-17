# W3 Wedge — CM Awards "OG Verifier" Badge

**Status**: Proposed v0.2 (cluster-level proposal — flatline-amended 2026-05-25 PM)
**Date**: 2026-05-25 PM (v0.2 amendments)
**Author**: ai-derived (operator-directed)
**Prerequisite**: W2 (`score on profile`) shipped — proves cross-cell composition under load
**Compose with**: identity-api Phase 2+3 · activities-api (Sprint-4+) · mint-api (runtime adapter) · cubquests-interface (CM admin surface)
**Coordinator pattern**: `~/bonfire/missions/w3-cm-awards-badge/` via `/coord` skill (formally distributed via construct-freeside PR #6 merge 2026-05-25)

> **v0.2 amendments** (operator decision 2026-05-25 PM per flatline-batch findings):
>
> Flatline-batch surfaced **18 blockers (6 CRITICAL)** in v0.1 — see `loa-freeside/grimoires/freeside-network/flatline-batch-2026-05-25/findings.md` §W3. Verdict: "not operator-GO-ready." Per flatline SKP-020 (HIGH 760), operator chose path: **insert a pre-Phase-A architecture decision gate** that resolves the 8 architectural choices BEFORE any cell implementation begins.
>
> The pre-Phase-A gate is now §Phase 0 below (new). Phases A/B/C/D are unchanged but now strictly blocked by Phase 0 completion. Phase 0 has 8 decision items, each with a recommended default + acceptance criteria + operator-decide marker.
>
> Other v0.2 changes:
> - "Why this wedge" §risk-framing — corrected: "wrong-wallet recovery via re-mint" claim REMOVED (flatline SKP-002 CRIT 880 confirmed false unless contract implements burn/revoke; now a Phase 0 decision item)
> - Updated coordinator path to match the `~/bonfire/missions/` naming convention
> - All v0.1 content preserved below Phase 0; references throughout updated to be Phase 0 → A → B → C → D ordered

> The full multi-cell wedge. CM awards an on-chain "OG Verifier" badge to the first 100 users who complete identity verification. Touches 4 buildings: identity-api (resolve users), activities-api (record event + state), mint-api (issue on-chain), cubquests-interface (CM admin UI + member-facing display). Proves end-to-end cluster composition; lays the production rails for every future cross-cell wedge.

## Why this wedge

W2 (score-on-profile, in flight) proves identity-api + score-api compose into a real consumer (cubquests). But that's READ-side composition — minimal contract surface; no on-chain action. W3 is the **WRITE-side wedge**: CM action → multi-cell coordination → on-chain artifact → user-facing event. Production-shaped; multi-actor; cross-belt-direction. Whatever the cluster CAN'T do in W3 reveals the cluster's real gaps.

The "OG Verifier" framing is intentional: the badge has no economic value (no resale market; commemorative only); the risk surface is narrow (worst case: badge issued to wrong wallet; recoverable via re-mint); the audience self-selects (the first 100 people willing to complete identity verification are the test cohort the cluster needs anyway). **Low-stakes, high-information.**

## The wedge (concrete)

A community manager (Marco-the-CM, or any internal THJ team member during dogfood) opens the Freeside Dashboard. They see a roster of users who completed identity verification (filtered + sorted by verification timestamp). They select a user (or a batch); they click "Issue OG Verifier badge." The badge mints on-chain (Berachain); activities-api records the completion event; cubquests displays the badge on the user's profile page (composes from inventory-api or directly from on-chain reads).

Flow:
```
[CM admin clicks "Issue badge" in Freeside Dashboard]
    │
    ▼
[Dashboard server-action] ── identity-api: resolveByWallet(addr) → confirm user_id exists
    │
    ▼
[mint-api: issueBadge(walletAddress, "og-verifier")]
    │     │
    │     ▼
    │   [On-chain contract.mint(addr, badgeId)] — Berachain tx
    │     │
    │     ▼
    │   [tx confirmed] → MintEvent emitted
    │
    ▼
[activities-api: recordCompletion({wallet, badge_id, mint_tx, ts})]
    │
    ▼
[cubquests user profile renders new badge — read from inventory-api OR direct chain read]
```

## Goals

| ID | Goal | Metric |
|----|------|--------|
| W3-G1 | Prove WRITE-side cross-cell composition works in production | First "OG Verifier" badge issued to a real user; visible across identity-api + activities-api + mint-api + cubquests |
| W3-G2 | Establish activities-api HTTP shim | activities-api ships a POST `/v1/badges/award` route accepting `{wallet, badge_id, issuer_id}`; returns 201 with completion event id |
| W3-G3 | Establish mint-api runtime chain adapter | mint-api ships an on-chain `issueBadge` runtime; Anchor-or-Solidity adapter; Berachain RPC integration |
| W3-G4 | Establish CM admin surface | Freeside Dashboard exposes a per-user "issue badge" CTA + batch-mode roster filter; CM-auth-gated (identity-api JWT or Privy admin claim) |
| W3-G5 | Prove activities-api Postgres adapter under load | First 100 badge completions written via real Postgres backend; in-memory adapter retired for this surface |
| W3-G6 | Prove identity-api as CLUSTER authority | Every badge issued routes through identity-api `resolveByWallet` — first production write that depends on identity as canonical SoR |

## Non-goals (kept out of W3)

- ❌ Generalized badge types — W3 ships ONE badge (`og-verifier`); future cycles extend
- ❌ Self-service badge claim (user-initiated) — W3 is CM-initiated; user-claim is V2
- ❌ Raffle infrastructure on top of badges — separate cycle (could compose later)
- ❌ Migration of cubquests's existing badges into the new infrastructure — cubquests-historical-badges stay where they are
- ❌ Multi-chain badge support — Berachain only in W3
- ❌ Badge metadata richness (lore, dimensions, etc.) — minimal in W3; rich metadata is V2
- ❌ Anonymous CM actions / multi-tenant CM dashboards — single-tenant (THJ internal) in W3
- ❌ Honey-road mibera-dimensions composition — Phase 3 territory

## Phase 0 — Architecture Decision Gate (v0.2 NEW; blocks Phase A)

Per flatline-batch findings 2026-05-25 PM, W3 v0.1 had 6 CRITICAL blockers around auth, key custody, idempotency, contract standard, saga ordering, webhook auth, upgrade path, badge state authority. **None of these can be resolved DURING implementation without rework cost.** Phase 0 is the operator-driven design session that resolves all 8 BEFORE any cell touches code.

Each decision item has:
- The question (from flatline)
- Recommended default (my synthesis + flatline recommendation)
- Acceptance criterion (how we know it's resolved)
- Operator-decide marker (TBD until operator signs off)

### D0-1. Auth model (resolves flatline SKP-004 CRIT 900 + IMP-001 HC)

**Question**: Who can call `POST /v1/issue/og-verifier` on mint-api? How is the caller's "CM" role established? Same question for activities-api's `POST /v1/badges/award`.

**Recommended default**: Identity-api-issued JWT with a `role: cm-admin` claim. CM admin role provisioning is an out-of-band operator op (initial: hard-coded list of internal THJ wallets; future: a role-management surface). Same JWT verified at mint-api + activities-api endpoints. Composes with W2 v0.2 §Auth model decision (Option A: Privy JWT for read; Option B: identity-api JWT for write).

**Acceptance**: ADR-009 D-9 (two-persona) operationally encoded; identity-api JWT verifier port wired into mint-api + activities-api; JWT claim schema published in identity-api `packages/protocol`; integration test verifies "CM JWT mints; non-CM JWT 403".

**Operator decision**: TBD

### D0-2. Badge state authority (resolves flatline SKP-002 HIGH 780)

**Question**: When cubquests asks "what badges does this wallet hold?", which cell answers authoritatively? Options: (a) activities-api (event-source authoritative); (b) mint-api (on-chain confirmed status); (c) inventory-api (chain-derived); (d) direct chain read; (e) cubquests local cache.

**Recommended default**: **activities-api owns badge-state authority for the W3 cycle** (queued / mint_pending / confirmed / failed / revoked states). cubquests reads from activities-api. mint-api owns chain-side truth (for verification + dispute). inventory-api stays out of badge-state for V1 (would couple holdings to events; doctrinally messy).

**Acceptance**: D0-2 decision encoded in W3 PRD §Architecture; state-machine documented (queued → mint_pending → confirmed | failed; confirmed → revoked optional); cubquests integration spec'd to read activities-api only.

**Operator decision**: TBD

### D0-3. Contract standard (resolves flatline SKP-002 CRIT 880 + IMP-004 HC)

**Question**: OGVerifierBadge — ERC-721 (one badge per tokenId; simpler) or ERC-1155 (multi-token, future-extensible to other badges)?

**Recommended default**: **ERC-1155 with burn/revoke admin functions**. Reasoning: W3 ships one badge but the pattern scales to N badges; burn/revoke is REQUIRED (flatline SKP-002 CRIT 880 — wrong-wallet recovery only possible via burn). ERC-1155 + burn is a small contract; significantly future-proofs the issuance infrastructure.

**Acceptance**: Contract spec authored (OGVerifierBadge.sol skeleton with `mint(address, uint256, uint256, bytes)` + `burn(uint256, uint256)` + `revokeBadge(address, uint256)` admin-gated); ERC-1155 compliance verified; deployed-immutable vs upgradeable decision per D0-7 below.

**Operator decision**: TBD

### D0-4. Idempotency contract (resolves flatline SKP-001 CRIT 880)

**Question**: When CM clicks "Issue badge" twice on the same wallet (or batch retries on partial failure), how do we ensure exactly-once mint? Cross-cell: mint-api + activities-api + cubquests must all agree.

**Recommended default**: Deterministic issuance key = `sha256(badge_id + wallet_address)`. Activities-api enforces UNIQUE constraint on (badge_id, wallet) for `confirmed` rows. Mint-api accepts an `idempotency_key` header on `POST /v1/issue/og-verifier` and returns existing tx_hash if already issued. Cubquests CM dashboard disables the button after click + checks activities-api for prior issuance before re-enabling. Webhook handler stores processed event IDs (replay-safe).

**Acceptance**: All 3 cells implement idempotency-key handling; integration test verifies "5 concurrent issue requests → 1 mint, 4 short-circuit"; UI prevents accidental double-click via optimistic disable.

**Operator decision**: TBD

### D0-5. Key custody (resolves flatline SKP-005 CRIT 920 + SKP-003 CRIT 850 + SKP-001 CRIT 850)

**Question**: Where does the mint-api signing key live? Who can rotate it? How is it protected from theft? What's the gas budget ceiling per session?

**Recommended default**: **Multisig contract owner with a relayer pattern** (OpenZeppelin Defender OR Gelato). Contract is owned by a 2-of-3 multisig (THJ team operators + Defender admin). Day-to-day issuance fires through Defender's relayer (it manages a hot wallet with cap + alerts); operators retain emergency pause + ownership transfer via multisig. Gas budget cap: $50/day initial; daily-spend circuit breaker in runtime adapter.

**Acceptance**: Multisig deployed; Defender relayer wired; runtime adapter has daily-spend circuit-breaker; pause + emergency revoke procedure documented; runbook covers compromise scenario.

**Operator decision**: TBD

### D0-6. Saga ordering (resolves flatline SKP-005 HIGH 760)

**Question**: Activities-api records the completion event BEFORE mint-api fires (current PRD), or AFTER mint-api confirms? If activities-api succeeds but mint-api fails permanently, what happens?

**Recommended default**: **Saga pattern with PENDING + CONFIRMED + FAILED states.** Activities-api creates a PENDING record; mint-api fires; on chain confirmation, activities-api transitions to CONFIRMED; on permanent failure (3 retries exhausted), activities-api transitions to FAILED. **cubquests MUST filter on CONFIRMED status only.** Dead-letter queue + alert for FAILED state for operator review. The webhook from D0-7 below is what triggers the CONFIRMED transition.

**Acceptance**: State machine implemented in activities-api (Phase A); cubquests query filters to CONFIRMED; FAILED records surfaced in CM dashboard for operator review.

**Operator decision**: TBD

### D0-7. Webhook auth (resolves flatline SKP-001 CRIT 930 + SKP-014 HIGH 760 + IMP-002 HC)

**Question**: `POST /v1/webhook/chain-confirmation` accepts confirmations from "an unspecified chain indexer." How do we verify the caller is legitimate? How do we prevent replay attacks?

**Recommended default**: **Eliminate the inbound webhook entirely**. Mint-api polls the chain via a trusted RPC node (Alchemy, QuickNode, or self-hosted Berachain node) for tx receipt confirmations. Polling is bounded (every 30s; 12-confirmation depth wait). This removes the entire inbound attack surface. If polling latency becomes painful, layer webhook ON TOP later with HMAC auth + replay protection.

**Acceptance**: Mint-api polls RPC for tx receipts; D0-6 saga state machine triggered by poll-confirmed status; no inbound webhook endpoint exposed in V1.

**Operator decision**: TBD

### D0-8. Upgrade path (resolves flatline SKP-004 CRIT 810)

**Question**: OGVerifierBadge.sol is immutable once deployed on Berachain. If a bug is found post-mainnet, how do we recover?

**Recommended default**: **OpenZeppelin TransparentUpgradeableProxy** pattern. Contract bug-fix = deploy new implementation + multisig-approved upgrade pointer flip. Pros: bugs fixable without migrating data. Cons: proxy adds gas overhead per call (~5%); upgradeable contracts are arguably "less crypto-native" but the practical safety net is worth it for v1.

**Acceptance**: Contract uses TransparentUpgradeableProxy; admin is the same multisig from D0-5; emergency runbook covers "discovered bug → patch → multisig approval → upgrade".

**Operator decision**: TBD

### Phase 0 sequencing

Phase 0 is operator-driven; estimate ~half-day to full-day for an architecture decision session with the THJ team. Outputs:
- 8 decisions written into W3 PRD v0.3 (replacing the TBDs above with operator signoffs)
- Each decision has an owner + acceptance test + integration into Phase A/B/C/D
- If a decision can't be resolved in Phase 0 (e.g., key custody needs vendor decision), Phase 0 stays open + Phase A waits

**Phase 0 EXIT CRITERIA**: all 8 decisions signed off; W3 PRD v0.3 published; re-flatline against v0.3 returns < 5 HIGH blockers (none CRITICAL). Only then does Phase A start.

---

## Architecture (compose path)

### Phase A: activities-api HTTP shim + Postgres adapter

**Currently**: activities-api ships MCP read-only tools (5 endpoints: get-active-activities, get-progress, get-badges, get-raffle-entries, list-kinds). NO HTTP server; NO write endpoints; in-memory adapter is canonical for tests; Postgres+Convex stubs exist but unwired.

**Phase A delivers**:
- HTTP server (Hyper or Bun.serve) exposing:
  - POST `/v1/badges/award` `{wallet, badge_id, issuer_id, mint_tx}` → 201 `{completion_event_id}`
  - GET `/v1/badges/{badge_id}/holders` → paginated list of `{wallet, awarded_at, mint_tx}` (CM dashboard consumer)
  - GET `/v1/wallets/{wallet}/badges` → list of badge_ids held by wallet (cubquests profile consumer)
- Postgres adapter wired (extends existing stub at `packages/adapters/postgres`); migrations land
- Auth: JWT-via-JWKS verifier (validates identity-api-issued JWTs OR Privy JWTs for CM admin role)
- Per existing CLAUDE.md §12.2-12.4 doctrine: dual-write window for in-memory → postgres migration

**Sprint estimate**: 1 short cycle (Sprint-4 or Sprint-5 of acvp-modules-genesis branch).
**Build via**: per-cell coordinator → activities-api cell direct via /coord (or activities-api's existing Sprint discipline).

### Phase B: mint-api runtime chain adapter

**Currently**: mint-api ships PRD + 4 MCP tool specs + 4 Effect-typed ports. Scaffolded; no runtime; no Anchor/Solidity adapter; no Berachain integration.

**Phase B delivers (v0.3 — REWRITTEN per Phase 0 D0-7 polling-not-webhook decision; closes flatline CRIT 910)**:
- Runtime chain adapter using **viem** (Bun-native, TypeScript-first; Foundry for contract dev/test only)
- Contract: **OGVerifierBadge.sol = ERC-1155 with admin burn/revoke + TransparentUpgradeableProxy** (per D0-3 + D0-8 decisions)
- Contract owned by **multisig** (2-of-3 THJ team) with Defender relayer for day-to-day issuance (per D0-5 key custody decision)
- HTTP server exposing:
  - POST `/v1/issue/og-verifier` `{wallet, badge_id, issuer_id, idempotency_key}` → 202 `{request_id}` (async because chain tx). Accepts JWT with `role: cm-internal` claim (per D0-1)
  - GET `/v1/issue/og-verifier/{request_id}` → status `{queued|broadcasting|mempool|mined|confirmed|failed}` + `{mint_tx?}` (richer status enum per D0-6 saga + D0-2 badge-state authority)
  - **NO inbound webhook** — REMOVED per D0-7. mint-api polls Berachain RPC for tx confirmation (see Polling spec below)
- Auth: identity-api-issued JWT with `role: cm-internal` claim (per D0-1)
- Fee model: relayer pattern (Defender) holds bounded balance ($50 cap with alerts); operator multisig retains ownership transfer + emergency revoke (per D0-5)

#### Polling spec (v0.3 NEW — per Phase 0 D0-7 + closes flatline CRIT 850)

Replaces the v0.1/v0.2 webhook. mint-api's runtime:

```
On POST /v1/issue/og-verifier:
  1. Validate JWT + idempotency_key (per D0-4: deterministic key = sha256(badge_id + wallet))
  2. Check activities-api for existing record with same idempotency_key
     - If exists + status in {broadcasting, mempool, mined, confirmed}: return 202 with existing request_id (idempotent short-circuit)
     - If exists + status: failed: allow retry (treated as new issuance)
  3. activities-api: insert PENDING record (UNIQUE constraint on (badge_id, wallet, idempotency_key) catches concurrent attempts — see D0-4 idempotency)
  4. Submit on-chain tx via Defender relayer
  5. Return 202 with request_id

Background poll loop (every 30s, max 30 minutes total):
  For each request_id in PENDING/broadcasting/mempool/mined state:
    - Fetch tx receipt from Berachain RPC
    - If confirmed (>= 12 confirmations): activities-api PATCH to CONFIRMED + record mint_tx
    - If reverted: activities-api PATCH to FAILED + record reason
    - If 30min elapsed + still pending: activities-api PATCH to FAILED + manual operator review
    - If RPC node restart / nonce gap: re-submit tx via Defender (with same idempotency_key on activities-api side; deterministic)
```

**Maximum poll duration: 30 minutes per request_id.** After 30 min, transition to FAILED + alert operator (catches mempool eviction / RPC reset scenarios per flatline CRIT 850).

#### Idempotency spec (v0.3 NEW — extends Phase 0 D0-4; closes flatline CRIT 870)

Activities-api's PENDING table has UNIQUE constraint on `(badge_id, wallet, idempotency_key)` — catches **both** confirmed AND in-flight pending duplicates. This is stricter than v0.2's "UNIQUE on confirmed rows only" framing.

Concurrent issuance flow:
- T0: CM clicks "Issue badge" twice rapidly
- T1: Click 1 → activities-api INSERT PENDING(idempotency_key=K, status=pending) → returns 202
- T2: Click 2 (same key K) → activities-api INSERT collides on UNIQUE → catches; returns 202 with prior request_id
- T3: mint-api polls; T1's request → CONFIRMED → activities-api UPDATE to CONFIRMED
- Result: exactly one badge minted; exactly one CONFIRMED record; cubquests sees one badge

Cubquests UI: button disabled after click (optimistic) + checks activities-api `GET /v1/wallets/{wallet}/badges?badge_id=og-verifier` before re-enabling (eventual-consistency check).

**Sprint estimate**: 1 medium cycle (mint-api is L1 scaffold; this brings it to L4 with first real surface).
**Build via**: dedicated per-cell coordinator OR mint-api's first real sprint cycle.

### Phase C: Freeside Dashboard CM admin surface

**Currently**: score-dashboard's (cm-shell) layout has 7 routes (`/`, `/wallets`, `/trends`, `/trust`, `/badges`, etc.). 50+ score-api endpoints consumed. ZERO write surfaces. NO auth.

**Phase C delivers**:
- Auth gate (Privy admin role OR identity-api JWT — operator decides which)
- New route `/admin/issue-badge` exposing:
  - User roster (consumes identity-api `/v1/users?filter=verified&limit=100`)
  - Per-user "Issue OG Verifier" button → triggers mint-api POST + records activities-api event
  - Batch mode (select 10-50 users; bulk issue with throttle) — **v0.3 error semantics per flatline CRIT 820**: each row in the batch fires INDEPENDENTLY via the idempotency-keyed POST /v1/issue/og-verifier flow. Per-row outcome: ROW_SUCCESS / ROW_DUPLICATE / ROW_REJECTED (validation) / ROW_FAILED (chain error). Batch result returns `{succeeded: [...], duplicated: [...], rejected: [...], failed: [...]}`. UI renders per-row status; failed rows can be retried individually. Mid-batch failure does NOT roll back successful rows (idempotency guarantees retries are safe).
  - Audit log showing recent badge issuances (composes activities-api `/v1/badges/og-verifier/holders` + mint-api status)
- Optimistic UI updates (badge appears "Pending" → "Confirmed" via mint-api polling OR websocket)
- Per ADR-009 D-9 two-persona model: this surface is the INTERNAL operator scope (dogfood); EXTERNAL CM surface (Web3 brand CMs) is V2

**Sprint estimate**: 1 short cycle (additive evolution per W2's pattern).
**Build via**: cubquests-interface (or freeside-dashboard if renamed) per-cell coordinator.

### Phase D: First badge issued + cycle close

**Delivers**:
- 1 real badge issued to a real user (CM picks a real user from the "verified" list)
- Visible across all 4 cells: identity-api `/v1/me`, activities-api `/v1/wallets/{wallet}/badges`, mint-api `/v1/issue/og-verifier/{request_id} = confirmed`, cubquests profile page renders the badge
- Audit envelope captured per cell (per existing Loa audit chain doctrine)
- Distill artifact at `loa-freeside/grimoires/freeside-network/w3-first-badge-issued-2026-XX-XX/` with the full event chain replayed

## Sequencing

```
W2 ships (prerequisite) ──→ identity-api Phase 2 T2.3/T2.4 in flight, cubquests integration coordinated

PHASE A (activities-api HTTP + Postgres)
   A.1 HTTP server scaffold (Hyper or Bun.serve)
   A.2 POST /v1/badges/award route
   A.3 Postgres adapter wired (extends existing stub)
   A.4 Migration scripts + dual-write window
   A.5 GET endpoints for CM dashboard + cubquests profile consumer
   A.6 JWT auth via JWKS
   A.7 Deploy to Railway (or activities-api's deploy target)
   ── operator review gate (auth-adjacent)

PHASE B (mint-api runtime chain adapter)
   B.1 Contract authored + deployed (testnet first)
   B.2 Runtime chain adapter (Bun + viem OR Foundry)
   B.3 POST /v1/issue/og-verifier route
   B.4 Async status polling endpoint
   B.5 Webhook for chain confirmations
   B.6 JWT auth (same model as activities-api)
   B.7 Deploy to mint-api's deploy target
   B.8 Contract → mainnet (after testnet smoke)
   ── operator review gate (on-chain authority)

PHASE C (Freeside Dashboard CM admin surface)
   C.1 Auth gate (Privy admin OR identity-api JWT)
   C.2 /admin/issue-badge route + roster fetch (identity-api)
   C.3 Per-user issue button + mint-api POST integration
   C.4 Activities-api event recording on success
   C.5 Batch mode (10-50 users)
   C.6 Audit log composition
   C.7 Deploy
   ── operator review gate (UI for CM action)

PHASE D (First badge + distill)
   D.1 CM picks a real verified user
   D.2 Issue badge via CM admin surface
   D.3 Verify cross-cell visibility (4 cells)
   D.4 Distill cycle artifact
   ── cycle close gate
```

Each phase is its own coordinator cycle. Beads cross-repo dependencies (per /coord skill):
- Phase B depends on Phase A's `/v1/badges/award` schema (sealed)
- Phase C depends on Phase A + Phase B HTTP surfaces
- Phase D depends on all three

Coordinator structure (post-W2-merge, simstim-ready):
```
~/bonfire/w3-cm-awards-badge-coordinator/
├── bin/                    ← coord-bootstrap.sh, coord-sync.sh (from loa-vps-setup)
├── lib/                    ← shared
├── cockpit.sh              ← god's-eye W3 phase status + dispatch queue
├── .beads/                 ← cross-cell beads graph (4 cells × 4 phases = N beads)
└── grimoires/loa/
    ├── prd.md sdd.md sprint.md    ← W3-specific (links to this proposal)
    └── coordination/task-manifest.yaml   ← cells + per-cell tasks
```

## Dependencies

- **Hard**: W2 ships (composes the SDK pattern; validates identity-api as cluster authority)
- **Hard**: identity-api production stays live (Railway URL + custom domain swap)
- **Hard**: identity-api Phase 4 T4.4 backfill (or at least enough users in spine for verified-roster to be meaningful)
- **Hard**: Berachain mainnet access + sufficient $BERA gas for Phase B contract deploy + ~100 mint txns
- **Soft**: activities-api Sprint-4+ schedule (Phase A is essentially a Sprint-4 PRD for activities-api)
- **Soft**: mint-api first real sprint cycle (Phase B is essentially mint-api's first L4 sprint)
- **Soft**: freeside-dashboard rename from score-dashboard (Phase C lives in whichever name is canonical)

## Risks

| Risk | Probability | Mitigation |
|------|-------------|------------|
| Phase A's activities-api Sprint-4 collides with the cell's own roadmap | MEDIUM | Coordinate via /coord; activities-api cell maintainer agrees the Phase A surface IS the cell's next sprint OR Phase A waits for a natural sprint window |
| Phase B's contract deploy needs operator key signing | HIGH | Multi-sig OR operator-key-in-vault; documented in mint-api's deploy runbook; CM-pays-gas in W3 keeps it simpler |
| identity-api spine empty when CM tries to filter for "verified" users | HIGH (current state) | Phase 4 T4.4 backfill BEFORE Phase C; OR W3 starts with a manual seed (10 internal team wallets) and grows |
| Berachain testnet→mainnet drift breaks Phase B between testnet smoke + production | MEDIUM | Foundry / Hardhat config pinned; testnet uses same compiler version + opt settings as mainnet; deploy-script identical |
| Phase C UI auth model (Privy admin vs identity-api JWT) becomes a fork in the road | MEDIUM | Decide BEFORE Phase C starts; identity-api JWT preferred long-term (cluster authority); Privy admin acceptable as V1 if internal-only |
| Cross-cell event ordering: mint confirms before activities-api records → cubquests sees badge but not event | MEDIUM | Activities-api records BEFORE mint-api fires (status: queued); status update on confirmation; cubquests profile shows pending state cleanly |
| 100-badge test cohort runs out before validation complete | LOW | "First 100" is the marketing frame; actual mechanism issues badges until CM decides to stop; cohort cap is editorial not technical |
| Chain reorg invalidates a "confirmed" badge | LOW | Per-chain confirmation depth wait (e.g., 12 blocks); webhook retries on reorg; badges held on cubquests UI with confidence indicator |

## Success metrics (v0.3 — REVISED per flatline CRIT 880; latency math corrected)

- **Functional**: 100 OG Verifier badges issued; visible across 4 cells
- **Latency** (v0.3 corrected — was wrongly `p95 <30s`): badge-issuance end-to-end **p95 < 90s** (Berachain ~2s blocks × 12 confirmations = ~24s minimum just for chain finality; poll-interval 30s adds median ~15s delay; RPC + activities-api PATCH adds ~5s; total realistic floor ~45s, p95 target ~90s). UI shows "Issuing → Broadcasting → On-chain → Confirmed" status enum per D0-6 saga. **The original v0.2 `<30s` claim was mathematically impossible given D0-7 polling design.**
- **Reliability**: 99%+ of issued badges reach `CONFIRMED` state in activities-api within **5 min** of CM action (5 min = polling worst-case for unusual block times); 100% of `CONFIRMED` records correspond to on-chain mints (verifiable via mint_tx)
- **Production grounding**: zero cross-cell race conditions observed (D0-4 idempotency check verified in load test); audit envelope captures the full event chain per badge
- **CM workflow**: CM can issue + batch-issue without engineering intervention; Freeside Dashboard is self-sufficient operationally
- **Saga state machine integrity** (v0.3 NEW): every badge passes through PENDING → CONFIRMED OR PENDING → FAILED (no orphan PENDING > 30min). Operator alerted on any orphaned PENDING.

## Cluster composition validation (what W3 proves)

Per ADR-009:
- **D-3 wax walls**: 4 cells communicate via sealed contracts (BeaconV3 + Zod schemas) — W3 is the first multi-cell write-path
- **D-5 federation discovery**: identity-api is the cluster authority for "who is this user" — W3 routes EVERY badge issue through it
- **D-6 belt direction**: write flow is `CM action → identity (resolve) → mint (on-chain) → activities (record) → inventory/cubquests (presented)` — one-way arrows; no backflow
- **D-8 dashboard composition**: Freeside Dashboard is the marketplace UI for the federation — W3 is its first production write surface
- **D-9 two-persona**: internal CM (THJ team) dogfoods the badge issuance; external CM (Web3 brand CMs) inherits the pattern in V2
- **D-12 three-frame stack**: gecko audits the cluster pre-W3 (already done 2026-05-25); KRANZ executes per phase (via /coord); Hivemind-Lab labels findings (the audit envelope per cell)

## Open questions for operator

1. **Phase A timing** — does activities-api's Sprint-4+ accommodate Phase A naturally, OR do we want a dedicated coordinator that branches off the cell's main and lands the HTTP shim out-of-sprint?
2. **Phase B contract type** — ERC-1155 (multi-token, future-extensible to other badges) or ERC-721 (simpler, single-badge-per-tokenId)? Mint-api PRD currently leans toward Solidity but Anchor is named alternative.
3. **Auth model for Phase C** — Privy admin role (internal-only V1; simpler) or identity-api JWT (cluster authority; consistent with W2's read-side; more work)?
4. **Spine backfill timing** — does identity-api Phase 4 T4.4 backfill happen BEFORE W3 starts (then W3 has a real verified user list), OR does W3 start with internal-team-seed (10 wallets) + grow as backfill lands?
5. **Custom domain swap timing** — does `identity.0xhoneyjar.xyz` go live before W3? Affects CM dashboard URLs.
6. **CM workflow ergonomics** — is the "issue badge" CTA per-user inline OR a batch screen with row selection? UX detail; affects Phase C scope.

## Sequencing with W2

Per operator framing 2026-05-25 PM:
> "I want to be able to tackle W2 then W3 with two sessions /simstim. Probably linearly if one blocks the other. We should be able to cleanly coordinate across these with freeside coordination (beads)"

**Sequence**:
1. W2 ships (~1 short cycle): identity-api Phase 2 T2.3/T2.4 + cubquests vendoring the SDK + score on profile renders
2. W3 starts (~3-4 cycles): Phase A → Phase B → Phase C → Phase D, sequentially
3. Each phase = its own coordinator cycle in `~/bonfire/w3-{phase}-coordinator/` OR a single `w3-cm-awards-badge-coordinator/` with phased sprints (operator picks)
4. Beads cross-repo dependencies enforce: Phase B blocked by Phase A; Phase C blocked by A+B; Phase D blocked by all
5. **/simstim** mode wraps each coordinator: autonomous loop within the coordinator's beads ready-queue; operator approval gates at each operator-review-gate marker

**Linearity per operator**: each phase has phase-internal sub-tasks that can run in parallel, but PHASES are strictly sequential because each depends on the prior phase's contracts being stable. Sequential phases keep the cross-cell coordination tractable.

## What W3 unlocks (downstream)

- **W4+ wedges**: any compound product that needs CM-initiated write actions (raffle creation, custom badges, member-tier promotions) has its rails laid
- **External CM persona V1**: once internal-CM dogfood validates the workflow, opening to external Web3 brand CMs becomes a marketing decision, not an engineering one
- **Mibera-raffle event story**: the recent community donation event the operator surfaced ("users worked together to donate miberas to a bigger cause") can be RECORDED via this same infrastructure — W4-or-later territory
- **Honey-road badge program**: future mibera-honeyroad world can use the same surfaces with its own badge taxonomy
- **Cluster scaling story**: once 4 cells coordinate cleanly in production, adding a 9th, 10th, Nth cell is mechanical

## Status

**Proposed.** Ready for operator GO. Sequencing requires W2 to ship first. Phase A, B, C, D each become coordinator cycles in `~/bonfire/`; beads cross-repo graph stitches them. Bridgebuilder (BEAUVIOUR) consultation on the doctrine could happen between Phase A and Phase B (after first real WRITE-side composition, before on-chain runtime lands).

## References

- [W2 wedge PRD](w2-score-on-profile.md) — prerequisite
- [ADR-009 · Freeside Hexagonal Federation](../../decisions/009-freeside-hexagonal-federation.md) — composition + harness + three-frame stack doctrine
- [identity-api Phase 1 memory](https://github.com/0xHoneyJar) (`project_identity-api-phase1-complete` + `project_freeside-identity-api`)
- identity-api PRD v3.0 at `loa-freeside/grimoires/loa/prd.md`
- activities-api at `~/Documents/GitHub/freeside-activities` (L2; Sprint-3 closed; submodule-style Loa mount)
- mint-api at `~/Documents/GitHub/freeside-mint` (L1 scaffold; submodule-style Loa mount)
- cubquests-interface at the cubquests repo (L4 production; 10K+ users)
- freeside-storage (likely Phase B chain adapter dep for any artwork metadata)
- Bridgebuilder persona at `loa-freeside/.claude/data/bridgebuilder-persona.md` (BEAUVIOUR — consult during Phase A→B handoff for FAANG-engineering review of the on-chain runtime architecture)
- /coord skill at `construct-freeside/skills/coordinating-cross-repo/SKILL.md` (now distributed via PR #6 merge 2026-05-25)
- Cluster-meta audit at `loa-freeside/grimoires/freeside-network/cluster-harness-audit-2026-05-25/` (baseline)

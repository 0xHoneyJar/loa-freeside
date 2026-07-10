# SDD — Shadow-Audit MVP: The Shadow-Mode Access-Intelligence Wedge

**Version:** 1.0
**Date:** 2026-07-10
**Cycle:** shadow-audit-mvp
**PRD:** `grimoires/loa/prd.md` (v1.0, goals G-1..G-6)
**Supersedes-active:** waggle-s1 SDD (→ `sdd.waggle-s1.md`)

> This SDD resolves the 12 SDD-level findings from the flatline PRD review (IMP-001/003/004/005/007/008/
> 009/010/011/012/013/014). A resolution map is in §12. Grounded citations use `[path:line]`.

---

## 1. Architecture Overview

The MVP is one slice of the D1 (member graph) + D4 (Shadow-Mode coexistence) control-plane (PRD §1, #283).
**This cycle builds the concrete, demonstrable spine + the member graph's first writer; it does NOT build the
D1 reasoning contract (#283/Option-C/Eileen) or rely on the unverified D4 coexistence runtime.**

```
[freeside-characters bot]                    [loa-freeside monolith]                  [Railway]
  role-snapshot exporter  --RoleSnapshot JSON-->  shadow-audit service (35-ln box)  --deploy via IaC-->  shadow-audit-api
        |  (writes FACTS)                            + Sonar/RPC ownership adapter
        v                                            GET /v1/audit  (dogfood-full)
  apps/worker profiles table  <---- Score/eligibility/ownership already write ----     GET /v1/audit (access-risk, no-install teaser)
  (D1 member graph — live substrate)                     |
                                                          v
                                          [freeside-dashboard]  access-audit surface (renders drift, read-only)
```

**Components (this cycle):**
- **Shadow-audit service** — `packages/services/shadow-audit/` (built; ~35-line `runAudit` + injected Sonar/RPC
  ownership adapter). Stateless; persists nothing. The SPINE's data path — **independent of the D4 coexistence
  runtime** (flatline IMP-002).
- **Role-snapshot exporter** — new one-shot CLI in freeside-characters (`apps/bot/`), forks `member-graph.ts`.
- **Member-graph substrate** — the existing `profiles` Postgres table (`apps/worker/src/data/schema.ts:105`).
- **Contract Access-Risk Audit** — the `access-risk-audit` ordering preset (no-install teaser).
- **Deploy** — native Railway IaC (`.railway/railway.ts`).

---

## 2. ADR — Member-Graph Substrate = the live `profiles` table (resolves IMP-001)

**Decision:** the member graph is the existing **`profiles` Postgres table** (`apps/worker/src/data/schema.ts:105`),
NOT the event-sourced `packages/services/shadow-mode` ShadowLedger.

**Evidence (grounded):**
- `profiles` binds `communityId + discordId + telegramId + walletAddress + tier + currentRank`
  (`schema.ts:105-116`) — it IS the "member graph exists as schema" of #283.
- It **already has live writers**: `ScoreRepository`, `LeaderboardRepository`, `EligibilityNatsConsumer`,
  `ownership-reverification` — so the operator's "member graph enriched by Score/Sonar/etc." is already real.
- Unique constraints exist for upsert: `uq_profiles_discord (communityId, discordId)` (`schema.ts:131`),
  `uq_profiles_telegram` (`:132`).
- The ShadowLedger is a separate, un-consumed subsystem (event-sourced, `shadow-ledger.ts:49`) → stays parked
  (PRD non-goal; BOEHM boring-box — use the live substrate, don't wire the ledger).

**Consequence:** the exporter becomes `profiles`' newest writer alongside Score + eligibility. No new
subsystem. `[ASSUMPTION resolved — the PRD flagged this for /architect; decided here.]`

---

## 3. Member-Facts Write Contract (resolves IMP-001, IMP-009, IMP-010)

The exporter writes ONLY identity+eligibility FACTS (PRD FR-4; reasoning deferred to #283).

- **Upsert key:** `(communityId, discordId)` — the existing unique constraint. `INSERT … ON CONFLICT
  (community_id, discord_id) DO UPDATE`. Idempotent by construction (IMP-009).
- **Field mapping (facts only):** `discordId`, `walletAddress` (resolved primary wallet or NULL), `communityId`.
  Roles + eligibility state + last-verified + provenance are stored as a **facts sidecar** (a `member_facts`
  JSON column or adjacent table — SDD-detail; NOT `tier`/`currentRank`, which are Score's reasoning fields —
  the exporter MUST NOT overwrite Score-owned columns; IMP-001 conflict policy).
- **Conflict policy (IMP-010 — identity cardinality):**
  - *multi-wallet:* write the **primary** wallet (identity-api `primary_wallet`); record additional wallets in
    provenance, do not fan out rows.
  - *multi-discord for one wallet:* allowed — `profiles` is keyed by discord, one row per discord id.
  - *stale/conflicting links:* if identity-api returns a wallet already bound to a DIFFERENT verified identity
    in this community → FLAG (`provenance.conflict = true`), do NOT silently absorb (the account-takeover shape
    from the shadow-mode-ledger lesson). Unresolved → `walletAddress = NULL`, flagged (never dropped).
- **Idempotency + recovery (IMP-009):** the exporter is a pure re-runnable upsert; `--dry-run` prints the
  planned upserts + a diff vs current `profiles` without writing; partial failure → the run is transactional
  per-batch, resumable (no half-written snapshot); a post-write reconciliation counts written vs snapshot
  entries and fails loud on drift.

---

## 4. Shadow-Audit Service (the box)

### 4.1 `GET /v1/audit` contract (resolves IMP-003)
- **Request:** `{chain, contract, snapshot_date, community, owner_wallet?, threshold}` (query; existing
  `audit-router.ts:211`). Auth: **community-scoped Bearer** (see §10 tenancy). Anonymous `GET` = the
  access-risk teaser (public, no member data); authed `POST` = member-level records (fail-closed today).
- **Response:** `{ run_id, mode, inputs_hash, as_of_block, counts: {stale_access, sold_lapsed, newly_eligible,
  holder_turnover, whale_concentration}, risk_band, provenance: {sonar_checkpoint, rpc_block, snapshot_captured_at,
  registry_ref} }`. Provenance fields make every number reproducible (IMP-003).
- **Pagination:** aggregate counts are unpaginated; member-level records (authed) are cursor-paginated.

### 4.2 Deterministic signal formulas (resolves IMP-004)
Pinned, windowed, reproducible (`audit-service.ts:135-144` is the source of record):
- `qualifies(w) := balance_at(w, as_of_block) >= threshold`
- `stale_access := { w ∈ role_holders : ¬qualifies(w) }`
- `sold_lapsed := { w : qualifies(w, snapshot_block) ∧ ¬qualifies(w, current_block) }`
- `newly_eligible := { w : qualifies(w, current_block) ∧ w ∉ role_holders }`
- `holder_turnover := |sold_lapsed| / max(1, |qualified_at_snapshot|)`
- `whale_concentration := balance(top_1) / total_supply_held` (windows: snapshot_block, current_block).

### 4.3 k-anonymity ↔ member-level reconciliation (resolves IMP-005)
- Aggregate/teaser output: cohorts with count `< k` (default **k=5**, `AUDIT_K`) render as `<k`, never exact.
- Member-level records (who specifically drifted): authed, community-scoped ONLY; suppressed for cohorts `< k`
  unless the caller owns the community (operator viewing their own members). Cross-community member data is
  never served (§10). This reconciles "member-level confront set" (operator value) with k-anon (privacy).

### 4.4 Freshness + latency bounds (resolves IMP-007)
Numeric, in a `bounds.json` beside the suite: RoleSnapshot **max age 24h** (`freshness_threshold_seconds`);
stale snapshot → served with an uncertainty label, not refused. Audit completion SLO **≤ 8s p95**; RPC calls
capped + timed out (5s); block-at-date lookups memoized per run.

### 4.5 Block-at-date reconstruction (resolves IMP-008 — principal correctness risk, NFR-3)
- **Finality depth:** `CONFIRMATIONS` (default 12) — block-at-date resolves to `block(date) - CONFIRMATIONS`
  to avoid reorg'd tips.
- **Timestamp selection:** the last block whose timestamp `<= snapshot_date` (deterministic; documented).
- **Reorg handling:** balances are reconstructed from Sonar's indexed transfers at the finalized block;
  a reorg below finality cannot affect the snapshot. Current balances use `current_block - CONFIRMATIONS`.
- **Archival:** if Sonar lacks history to the snapshot block → LOUD `insufficient_history` error, never a
  silently-partial audit (the money/ops floor).

---

## 5. Role-Snapshot Exporter (freeside-characters)

Fork `apps/bot/src/cli/member-graph.ts`. Pipeline: `guild.members.fetch()` (privileged `GuildMembers`) →
per member `{discord_user_id, role_ids: [...m.roles.cache].map(r=>r.id)}` → `member-identity-client.resolveMember`
→ wallet (or NULL, flagged) → (a) emit `RoleSnapshotSchema` JSON to `ROLE_SNAPSHOT_PATH`; (b) write facts to
`profiles` (§3). `export_method: "discord-bot-export:snowflakes:v1"`. Idempotent, `--dry-run`, batch-resumable
(§3, IMP-009). Env: `DISCORD_BOT_TOKEN`, thj guild id, identity-api URL + world slug.

---

## 6. Contract Access-Risk Audit (teaser — G-5)

The `access-risk-audit` ordering preset. Inputs `{chain, contract, snapshot/reference date, optional gating
rule}`; outputs the on-chain HALF only (§4.2 formulas, no Discord/role data): turnover · sold-lapsed ·
newly-eligible · whale/concentration · stale-access risk estimate · CTA. Public, no-install, k-anon (§4.3),
targetable at any contract (e.g. Pythenians). Reuses `runAudit`'s ownership adapter with an empty role set.

---

## 7. thj Onboarding State Machine (resolves IMP-012)

`community-onboarding` order (PRD FR-6) is NOT "HTTP 200 = operated." The order fulfills through ingredient
gates (`sonar → score → worlds_manifest → shadow_preview`, `community-onboarding-orchestrator.ts`); the
community is `isOperatedCommunity` **only when the order reaches `fulfilled` with `world_slug` set**. Idempotent
(re-placing the same inputs is a no-op via order dedup). The shadow-audit's `mode-resolver` reads the operated
set; until fulfilled, thj audit → `external-mode` refusal (no fake data). The onboarding is an operator gate,
tracked; the exporter + deploy can proceed in parallel and converge at the spine.

---

## 8. Deploy via Railway IaC + Organization-as-Code (G-1, G-6; resolves IMP-013)

- **Service def:** `.railway/railway.ts` for the `shadow-audit-api` project: `service("shadow-audit-api",
  {source: github("0xHoneyJar/loa-freeside"), ...})` with repo-root build context + Dockerfile at
  `packages/services/shadow-audit/Dockerfile`; env = greenlit `COLLECTION_REGISTRY` (17 entries) + 5 verified
  RPCs + `SHADOW_AUDIT_API_KEY` via `preserve()` (secret stays out of source).
- **Flow:** `railway config plan` → operator reviews the EXACT plan → `railway config apply`. NEVER
  `--yes`/`--confirm-destructive` from the agent without explicit approval (NFR-2, Railway's own agent skill).
- **Agent gate mechanics (IMP-013):** on PR, CI runs `railway config plan --json --detailed-exit-code`
  against a stored baseline; exit-code 2 (drift) fails the check unless the diff is the intended change;
  secrets redacted (`«hidden»`); production apply requires human approval; the baseline is the last-applied
  plan hash committed alongside `.railway/railway.ts`.
- **Org-as-code convention:** two first instances (shadow-audit + ordering-service, both PoC-pulled); the
  convention doc + the agent gate are the reusable deliverable, not all 13 buildings.

---

## 9. Data Models

- `profiles` (existing, `schema.ts:105`) — write target (§2/§3). New: a `member_facts` JSON column (or
  `member_facts` table keyed by `profiles.id`) for roles/eligibility/last-verified/provenance — additive,
  does not touch Score-owned columns.
- `RoleSnapshotSchema` (existing, `shadow-audit/src/role-snapshot.ts:12`) — the exporter's JSON contract.
- No new schema in the audit service (stateless).

---

## 10. Security Architecture (resolves IMP-011, IMP-005, NFR-4/5)

- **Tenancy/isolation (IMP-011):** member-level access is **community-scoped** — the Bearer/API key maps to a
  community; `audit-acl.ts` resolves the operated community owning a contract and **fails closed on
  `unknown-community`**. Cross-community member data is NEVER served. Per-community access is logged
  (`capability-audit` style event: who/what/when).
- **Read-only invariant (NFR-4):** the audit NEVER mutates incumbent roles (D4 coexistence invariant). The
  service has no role-write path.
- **k-anon (IMP-005):** §4.3 — small cohorts suppressed to prevent re-identification.
- **Fail-closed (NFR-5):** service refuses startup without required vars; `SHADOW_AUDIT_API_KEY` mandatory,
  constant-time compare; missing registry/RPC → boot fails (no wrong-audit).
- **Bearer egress:** the activities-client SSRF/scheme allowlist hardening (A-1..A-4, prior cycle) is the
  precedent for any credentialed outbound.

---

## 11. Test Strategy (resolves IMP-014)

Beyond the single known-holder spot-check (SM-1), a representative E2E scenario set:
- **Correctness scenarios:** a hand-verified holder (stale-access positive), a current holder (ok), a
  never-held wallet (newly-eligible negative), a sold-since-snapshot wallet (sold-lapsed) — asserted against
  known ground truth on Berachain Honeycomb.
- **Failure modes:** dead RPC → loud; insufficient Sonar history → `insufficient_history`; empty role set →
  teaser mode; stale snapshot → uncertainty label; unauthed member-level → 401.
- **Read-only invariant:** assert no role-mutation path is reachable.
- **Exporter:** idempotency (re-run = no-op), dry-run diff, unmatched-wallet flagged, conflict-flag on
  cross-identity wallet.
- **Contract suites** (existing `tests/contracts/` harness): activities/shadow-audit/inventory/ordering.

---

## 12. Flatline Findings Resolution Map

| Finding | Resolved in |
|---|---|
| IMP-001 write target / upsert / conflict | §2 ADR + §3 write contract |
| IMP-003 /v1/audit schema/auth/pagination/provenance | §4.1 |
| IMP-004 deterministic signal formulas + windows | §4.2 |
| IMP-005 member-level ↔ k-anon re-identification | §4.3, §10 |
| IMP-007 freshness/latency numeric bounds | §4.4 |
| IMP-008 block-at-date finality/timestamp/reorg | §4.5 |
| IMP-009 exporter idempotency/dry-run/recovery | §3, §5 |
| IMP-010 identity cardinality edge cases | §3 conflict policy |
| IMP-011 tenancy/scope/isolation/access-logging | §10 |
| IMP-012 onboarding state transitions/idempotency | §7 |
| IMP-013 agent-gate baseline/redaction/CI exit | §8 |
| IMP-014 representative E2E scenarios | §11 |

---

## 13. Deferred / Open (not this cycle)

- **D1 holder-quality REASONING + `AccessDecisionRecord` + explanation layer** → #283 / Option-C / Eileen.
- **D4 coexistence runtime verification** → separate read-only test spike (the spine does not depend on it, §1).
- **Member-graph `member_facts` exact shape** (JSON column vs table) → implementation detail; both satisfy §3.
- **Lane C holder-quality signal contract** (Hermes) · **Lane D action layer** ("later").

---

## 14. Flatline SDD Review — Integrations (2026-07-10)

> 3-model review. The reported "17 blockers" were **empty `SKP-*` artifacts** of a single-voice scoring
> dropout (the middle voice scored 0 across all items) — NOT real blockers, no content. The genuine signal is
> **1 high-consensus (IMP-016) + 15 content-bearing disputed** (gpt-5.6-sol + grok both scored 900+),
> integrated below. Verdict quality: honest — degraded consensus, but the surviving voices agreed strongly.

### Load-bearing (refine the contracts above)
- **IMP-009 (960) — RoleSnapshot transport was UNDEFINED (real gap).** The exporter (freeside-characters)
  and the stateless service (Railway) are separate — a file path does not cross repos/hosts. Resolution:
  the exporter `POST`s the RoleSnapshot to the service's authenticated ingestion endpoint
  `POST /v1/role-snapshot` (service-token auth; body = `RoleSnapshotSchema` + `sha256` integrity); the
  service holds the latest snapshot per `(community, captured_at)`, fail-closed if absent/stale.
  `ROLE_SNAPSHOT_PATH` becomes the local-dev/file fallback ONLY.
- **IMP-002/003 — separate teaser vs member contracts.** `GET /v1/access-risk` = PUBLIC teaser (on-chain
  only, k-anon, NO member data; returns meaningful signals or an explicit `insufficient-data`, never
  empty/always-true). `POST /v1/audit` = AUTHENTICATED member-level (community-scoped). Distinct routes,
  auth, and clients — prevents the incompatible-client + security-mistake risk.
- **IMP-006 — profiles field-level ownership.** Exporter OWNS `{walletAddress, member_facts sidecar}`;
  Score OWNS `{tier, currentRank}`; eligibility OWNS its columns. `ON CONFLICT (community_id, discord_id)
  DO UPDATE SET` touches ONLY exporter-owned columns — never Score's (no lost updates).
- **IMP-007 — per-community scoped credentials** (not one shared key). Credential → `community_id`;
  `audit-acl` fails closed on cross-community. MVP: one key per operated community, issued at onboarding.
- **IMP-008 — k-anon owner-bypass authz.** Member-level small-cohort disclosure is allowed ONLY when the
  credential's `community_id == audited community`, is access-logged, and NEVER served cross-community or
  anonymously.
- **IMP-010 — canonical role scope.** The audit's "role-holders" = the community's GATED roles (versioned
  in community config), NOT all Discord roles. The exporter captures all `role_ids` (facts); the audit
  filters to the gated subset.
- **IMP-015 — PII retention/deletion/redaction (privacy floor).** Member facts (discord+wallet+roles) are
  PII. MVP floor: current-state only (no history); community offboard PURGES its `profiles` rows; logs
  redact wallet/discord (hash/truncate); at-rest encryption per the Postgres deployment. Full policy →
  follow-on.
- **IMP-016 (HIGH-CONSENSUS) — expand §11 tests:** add k-anon suppression (`<k` renders `<k`), k-waiver
  authz (owner-only member-level), pagination ACL (cross-community denied), block finality/reorg (snapshot
  at finalized block), `inputs_hash` stability (same inputs → same hash), `risk_band` boundary cases.

### Minor (SDD-detail / sprint acceptance criteria)
IMP-004 `snapshot_date→block` mapping (§4.5 authoritative) · IMP-005 exporter batch is committed whole or
not (no partial snapshot activation) · IMP-011 `inputs_hash`/`run_id` semantics · IMP-012 SLO measurement
protocol · IMP-013 `whale_concentration` guard (`max(1, total_held)`; zero-supply→null) · IMP-014 refuse
member-level older than 2× the freshness bound.

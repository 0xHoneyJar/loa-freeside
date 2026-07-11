# Sprint Plan — Shadow-Audit MVP: The Shadow-Mode Access-Intelligence Wedge

**Version:** 1.0
**Date:** 2026-07-10
**Cycle:** shadow-audit-mvp
**PRD:** `grimoires/loa/prd.md` (G-1..G-6) · **SDD:** `grimoires/loa/sdd.md` (incl. §14 flatline integrations)

> **Spine = G-2** (thj sees real drift next to incumbent). Every sprint serves it. Acceptance criteria
> trace to G-N + SDD §§ + flatline IMP-xxx. Multi-repo: master=loa-freeside, child=freeside-characters
> (coordinator `~/bonfire/shadow-audit-mvp-coordinator`). Merge posture: DRAFT PRs, review→audit per task.

## Sprint Overview

| Sprint | Repo | Theme | Depends on |
|--------|------|-------|-----------|
| **S1** | loa-freeside | Shadow-audit service → SDD contracts (routes, formulas, tenancy, ingestion, tests) | — |
| **S2** | loa-freeside | Deploy via Railway IaC + org-as-code agent-gate + access-risk teaser | S1 |
| **S3** | freeside-characters (child) | Role-snapshot exporter → RoleSnapshot + profiles facts-write | S1 (POST /v1/role-snapshot) |
| **S4** | loa-freeside / ops | thj onboarding + the spine E2E (thj sees drift) + representative E2E tests | S2, S3, G-4 |

Cut-vertex order: harden the service first (S1) — everything reads its contracts. Deploy (S2) + exporter
(S3) parallel after S1. Spine (S4) converges them.

---

## Sprint 1: Shadow-audit service to SDD contracts (loa-freeside)

**Goal:** the built ~35-line box becomes the SDD-contract service: separated public/authed routes,
deterministic formulas, per-community tenancy, the RoleSnapshot ingestion endpoint, k-anon, tests.

> **RE-SCOPE 2026-07-10 (grounded against actual code — the service is ~2966 LOC, FAGAN-reviewed
> across prior cycles, NOT a 35-line box).** VERIFIED-DONE + closed as beads (175 tests green):
> **S1-T1** route separation (`GET /v1/audit` anon k-anon + `POST /v1/audit` authed — method-split,
> `audit-router.ts:211,249`; rename to `/v1/access-risk` NOT done — would break the live dashboard
> consumer), **S1-T2** block-at-date (`ownership-source.ts:40,59,78`), **S1-T3** tenancy + owner-waiver
> (`association-verifier.ts:121,156`). GENUINE DELTA this pass: **S1-T4** (no `POST /v1/role-snapshot`
> HTTP route exists — snapshot arrives only via a `load()` port; this is the S1↔S3 seam), **S1-T5**
> (confirm the 6 test classes), **S1-T6** (role-snapshot contract fixture).

- **S1-T1 — Route separation (SDD §4.1/§6, IMP-002/003):** `GET /v1/access-risk` (public teaser: on-chain
  only, k-anon, meaningful-or-`insufficient-data`, NO member data) vs `POST /v1/audit` (authed member-level).
  AC: distinct routes + auth; teaser never returns empty/always-true; contract tests for both.
- **S1-T2 — Deterministic signals + block-at-date (SDD §4.2/§4.5, IMP-004/008/013):** pin the formulas;
  `snapshot_date→block` at `block(date)-CONFIRMATIONS`; whale guard (`max(1,total_held)`, zero-supply→null).
  AC: same inputs → identical `inputs_hash`+counts; reorg-below-finality cannot change a snapshot; unit tests.
- **S1-T3 — Per-community tenancy + k-anon authz (SDD §4.3/§10, IMP-007/008):** credential→`community_id`;
  `audit-acl` fails closed cross-community; member-level small-cohort disclosure owner-only + access-logged.
  AC: cross-community request → denied+logged; cohort `<k` → `<k`; anonymous member-level → 401.
- **S1-T4 — `POST /v1/role-snapshot` ingestion (SDD §14 IMP-009):** service-token auth; body=`RoleSnapshotSchema`
  + sha256 integrity; holds latest per `(community, captured_at)`; fail-closed if absent/stale.
  AC: valid snapshot accepted+hash-verified; bad token → 401; audit reads the ingested snapshot; stale → refused.
- **S1-T5 — Test suite expansion (SDD §11/§14 IMP-016 HIGH-CONSENSUS):** k-anon suppression, k-waiver authz,
  pagination ACL, block finality/reorg, `inputs_hash` stability, `risk_band` boundaries.
  AC: all six test classes present + green in fixture mode; the 4 correctness scenarios (§11) pass.

## Sprint 2: Deploy via Railway IaC + org-as-code (loa-freeside)

**Goal:** G-1 (deploy the box, agent-first) + G-6 (org-as-code convention/gate) + G-5 (teaser live).

- **S2-T1 — `.railway/railway.ts` for shadow-audit-api (SDD §8, G-1):** `service()` from repo, repo-root build,
  Dockerfile path, env = greenlit `COLLECTION_REGISTRY` + 5 RPCs + `SHADOW_AUDIT_API_KEY` (`preserve()`).
  AC: `railway config plan` shows the intended create; **operator approves the exact plan**; `apply` → live;
  fail-closed verified. NEVER `--yes`/`--confirm-destructive` unapproved.
- **S2-T2 — org-as-code agent gate (SDD §8, IMP-013, G-6):** CI `config plan --json --detailed-exit-code` vs
  a committed baseline hash; drift fails unless intended; secrets redacted; prod apply human-gated.
  AC: unexpected drift fails CI; baseline committed beside `.railway/railway.ts`; ordering-service also pulled.
- **S2-T3 — access-risk teaser live (G-5):** the `access-risk-audit` preset wired to `GET /v1/access-risk`.
  AC: given `{chain, contract, date}` returns turnover/sold-lapsed/newly-eligible/whale/stale-risk + CTA for a
  real thj contract (Honeycomb) with NO Discord access.

## Sprint 3: Role-snapshot exporter (freeside-characters · CHILD)

**Goal:** G-3 — produce the RoleSnapshot AND write member FACTS to `profiles` (D1 first writer).

- **S3-T1 — Exporter CLI (SDD §5, brief):** fork `apps/bot/src/cli/member-graph.ts`; enumerate thj guild
  (`GuildMembers`); resolve discord→wallet (`member-identity-client`); emit `RoleSnapshotSchema` JSON
  (`role_ids` snowflakes; unmatched flagged). AC: `RoleSnapshotSchema.parse` accepts output; unit test
  (envelope + one resolved + one unmatched entry).
- **S3-T2 — POST to service + profiles facts-write (SDD §3/§14, IMP-006/009/010/005):** POST the snapshot to
  `/v1/role-snapshot`; upsert exporter-owned columns ONLY `ON CONFLICT (community_id, discord_id)` (never
  Score's `tier`/`currentRank`); canonical gated-role scope; batch committed whole-or-not.
  AC: profiles rows written for thj; Score columns untouched; conflict-flag on cross-identity wallet;
  re-run = no-op (idempotent); `--dry-run` prints diff without writing.
- **S3-T3 — PII floor (SDD §14 IMP-015):** logs redact wallet/discord; provenance recorded.
  AC: no raw wallet/discord in logs; offboard-purge path documented.

## Sprint 4: Spine + onboarding (loa-freeside / ops)

**Goal:** G-4 onboarding + G-2 the spine (thj sees real drift) + SM validation.

- **S4-T1 — thj onboarding (SDD §7, G-4, IMP-012):** place the `community-onboarding` order; advance
  ingredients to `fulfilled` → thj `isOperatedCommunity`. AC: order fulfilled with `world_slug`; audit
  mode-resolver returns `dogfood-full` for thj (not `external-mode`).
- **S4-T2 — Spine E2E (G-2, SM-1/SM-2):** run the exporter → snapshot ingested → audit computes thj drift →
  dashboard renders it next to incumbent. AC: drift renders live; hand-verified against ≥1 known holder;
  ≥80% resolution (fixed denominator, unmatched flagged).
- **S4-T3 — Representative E2E scenarios (SDD §11, IMP-014):** stale-access positive, ok holder,
  newly-eligible, sold-lapsed against Berachain Honeycomb ground truth; read-only invariant asserted.
  AC: all scenarios pass; no role-mutation path reachable; stale member-level refused (>2× freshness).

---

## Flatline Sprint Review — Refinements (2026-07-10; 0 blockers, 14 disputed integrated)

- **IMP-002 (920) — the service needs DURABLE STATE (was "stateless").** `POST /v1/role-snapshot` must HOLD
  the latest snapshot per community; per-community credentials + access logs also persist. → **S1-T4 amended:**
  snapshot/credentials/logs live in a small durable store (reuse the profiles Postgres). The *audit
  computation* stays pure; only ingestion state is durable. Add a task note distinguishing pure-compute from
  held-state.
- **IMP-003 (960) — exporter dual-write (DB upsert + HTTP POST) cannot share a txn.** → **S3-T2 amended:**
  order = POST snapshot first (idempotent by `sha256`), then profiles upsert (idempotent by key); a
  post-run reconciliation compares snapshot entries vs profiles rows and fails loud on drift. NO shared
  transaction claimed; both sides idempotent + reconciled. (Outbox is overkill for a one-shot CLI.)
- **IMP-008 (870) — pin the cross-repo `/v1/role-snapshot` contract.** → **new S1-T6 / S3-T4:** a shared
  contract fixture (the existing `tests/contracts/` consumer-conformance pattern) for `/v1/role-snapshot`,
  run in both repos' CI — prevents S1→S3 prose-drift.
- **IMP-001 (920) — the spine needs a dashboard integration task.** → **S4-T2 amended:** explicit
  freeside-dashboard task for the "drift next to incumbent" comparison surface (API contract + auth-gated
  states); the access-audit surface exists (renders aggregate) — wire it to the live audit + the incumbent view.
- **IMP-005 (860) — Railway apply ≠ ready.** → **S2-T1 amended:** post-`apply` health check (`/healthz`),
  smoke (`/v1/audit` §5 spot-check), one-step rollback rehearsed before declaring G-1 done.
- **IMP-006 (885) — public teaser needs anti-abuse.** → **S2-T3 amended:** per-IP rate limit + anti-enumeration
  (differencing) guard on `GET /v1/access-risk`, beyond k-anon.
- **IMP-011 (760) — ordering-service in org-as-code is READ-ONLY.** → **S2-T2 clarified:** the pulled
  ordering-service `.railway.ts` is representation/gate only; NEVER `apply` changes to it this cycle.
- **IMP-012 (895) — spine failure behavior.** → **S4-T3 amended:** each spine dependency (RPC, block-at-date,
  profiles, Discord pagination, audit service) has a defined failure mode (loud, never silent-wrong).
- Minor (IMP-004 canonical serialization/payload-limit on POST · IMP-007 k-waiver policy detail · IMP-009
  denominator per PRD SM-2 · IMP-010/013/014 doc hygiene): carried as task acceptance-criteria detail.

## Verification per sprint
Each sprint closes through review→audit (the cycle gates). Acceptance criteria above are the audit checklist.
Non-goals (do NOT implement): D1 holder-quality reasoning/`AccessDecisionRecord` (#283), the event-sourced
shadow-mode ledger, Cloudflare, inventory DNS, Lanes C/D.

# PRD — Shadow-Audit MVP: The Shadow-Mode Access-Intelligence Wedge (+ Agent-First Railway IaC)

**Version:** 1.0
**Date:** 2026-07-10
**Cycle:** shadow-audit-mvp
**Author:** discovering-requirements (operator-driven; exhaustive session context)
**Supersedes-active:** waggle-s1 (archived → `prd.waggle-s1.md`; sprint #412 completed)

> **Sources (this PRD traces to):** `grimoires/loa/context/2026-07-10-shadow-audit-mvp-definition-of-done.md`,
> `2026-07-10-shadow-audit-collection-registry.grounded.md`, `2026-07-10-boehm-sovereignty-discriminator.md`;
> issue `0xHoneyJar/loa-freeside#283` (D1 contract, Eileen-ratified Option C); the Codex Railway-vs-Cloudflare
> research verdict; operator interview (2026-07-10, this session); `project_deployed-but-unconsumed-pattern`.

---

## 1. Problem & Vision

**The wedge (operator thesis, interview 2026-07-10):** *Freeside is the Shadow-Mode intelligence layer for
Web3 communities — it runs BESIDE existing gating tools (Collab.Land / Guild / Matrica), builds the canonical
member graph, detects access/lifecycle drift, and shows operators which members are valuable, risky, lapsed,
or worth acting on.* The first sellable product is not "token gating" — it is an **access-intelligence audit
for communities already using token gating**: enter without ripping out the incumbent, prove value, then
gradually take over lifecycle → member intelligence → monetization.

**Why this, why now (grounded reality, issue #283):** the MVP is a member-intelligence + access-lifecycle
control-plane delivered as two coupled halves — **D4 Shadow-Mode coexistence** (install behind incumbent,
touch no roles, explain divergences) and **D1 member graph / holder-quality**. A read-only verification pass
found a sharp asymmetry: **D4 is materially BUILT** (`packages/adapters/coexistence/`, ~14.5k ln: incumbent
detector, shadow ledger, namespaced role manager "MUST NEVER touch incumbent roles", parallel-mode
orchestrator, migration manager — runtime/wireability unverified `[?]`); **D1 exists only as SCHEMA**
(`apps/worker/src/data/schema.ts` `profiles` table binds communityId+discordId+wallet + tier/rank/scores;
the reasoning that fills it does not exist). **Option C (Hybrid) is RATIFIED by Eileen;** #283 settles the
D1 *contract* (bands, provenance, `AccessDecisionRecord`, explanation seam) — *"a decision, not code."*

**The cycle problem (the cure applied):** the cluster's signature failure is *substrate shipping before a
live consumer* (`project_deployed-but-unconsumed-pattern`, operator-validated). This cycle applies the cure to
the shadow-audit: land **one real community (thj) seeing its real drift next to its incumbent roles, live** —
the first load-bearing consumer of the Shadow-Mode wedge — and give the member graph its **first real writer**.

**Vision framing (BOEHM boring-box discipline, `boehm-sovereignty-discriminator.md`):** boring box over
distributed system; the member graph and organization-as-code are **seeded by** this MVP, never blockers on
its spine. Stay on Railway (Codex research: agent-first requires code-first IaC, not leaving Railway).

---

## 2. Goals & Success Metrics

| ID | Goal | Success metric |
|----|------|----------------|
| **G-1** | Deploy the shadow-audit box **via Railway native IaC** (agent-first, dogfooded) | Service live as its own `shadow-audit-api` project, deployed from `.railway/railway.ts` via `config plan` → operator-approved `apply`; fail-closed verified (refuses startup on missing required vars) |
| **G-2** *(SPINE)* | **thj sees real drift next to its incumbent roles, live** (Shadow Access Audit, dogfood-full) | Dashboard renders thj's stale-access confront set + turnover + newly-eligible from the LIVE deployed audit, computed next to incumbent roles (shadow-read, no forced cutover) |
| **G-3** | **Role-snapshot exporter** (freeside-characters) — produces the `RoleSnapshot` AND writes the member-object **FACTS** (D1 first writer) | Exporter emits a `RoleSnapshotSchema`-valid JSON; writes identity+eligibility facts (discord↔wallet, community, roles, eligibility state, last-verified, provenance) into the existing `profiles` substrate |
| **G-4** | **thj onboarded** as an operated community (`community-onboarding` order) | Order fulfilled on the live ordering-service → thj is `isOperatedCommunity` (the shadow-audit's mode gate) |
| **G-5** | **Contract Access-Risk Audit** — no-install, on-chain-only teaser (`access-risk-audit` preset) | Given `{chain, contract, snapshot/reference date, optional gating rule}` returns holder turnover · sold/lapsed count · newly-eligible count · whale/concentration notes · stale-access risk estimate · CTA "Map this to Discord roles with a no-install Shadow Access Audit" |
| **G-6** | **Organization-as-code** convention + first instances + minimal agent gate | ≥2 buildings represented as `.railway/railway.ts` (shadow-audit + ordering-service, both PoC-pulled); agent gate: `config plan` on PR, fail on unexpected drift, human-approve production + all destructive |

**Success gate (cycle DONE) — operator-selected "drift renders + hand-verified + quantitative coverage":**
- **SM-1:** G-2 spine met — thj's real drift renders from the live audit, sanity-checked against **≥1
  hand-verified known holder** (deploy-runbook §5 spot-check; wrong registry → silently-wrong audit).
- **SM-2 (quantitative, denominator FIXED before the run — flatline IMP-006):** resolution rate =
  `(role-holders resolved to a wallet) / (thj members holding a Freeside-audited role at the snapshot,
  EXCLUDING known bots/webhooks and de-duplicated by discord_id)`. The denominator, bot/duplicate treatment,
  and the measurement query are pinned in the SDD BEFORE the run (not self-calibrated post-hoc). **Target
  ≥80%**; unmatched are FLAGGED, never dropped. Audit completes within the §10.1 latency bound (RoleSnapshot
  max-age + audit SLO numerically bounded in the SDD — flatline IMP-007).
- **SM-3:** G-1 deploy done via IaC with a green `config plan` and fail-closed verified.
- **SM-4:** G-5 teaser returns the specified outputs for a real thj contract (Honeycomb) with no Discord access.

**Timeline:** done-when-done (operator-confirmed). Sequence by dependency + BOEHM boring-box discipline;
no deadline (near-zero-users / pre-PMF stage).

---

## 3. Users & Stakeholders

- **End buyer / operator (external):** a Web3 community manager already running Collab.Land/Guild/Matrica.
  Buyer story (lead with the MECHANISM, per #283): *"You already use Collab.Land. Freeside runs in Shadow
  Mode — it finds role drift, stale access, no-longer-eligible sellers, eligible members missing roles, and
  explains each divergence, without touching your incumbent roles."* Gets the **wow** (two-layer rule: the
  end-user surface is where craft goes).
- **First real consumer (this cycle):** **thj** (The Honey Jar) — operated by us, so we have the role
  snapshot; the deployed-but-unconsumed first load-bearing consumer.
- **Internal consumer:** the operator + agents driving the backend as code (crappiest-version-first;
  agent-first Railway IaC).
- **Adjacent stakeholders (deferred deliverables):** Eileen (ratifies the D1 contract, #283); Hermes
  (drafting the holder-quality contract, Lane C).

---

## 4. Functional Requirements

- **FR-1 (Shadow Access Audit, dogfood-full):** the live `GET /v1/audit` path (`runAudit`, ~35-line box +
  Sonar/RPC ownership adapter) computes, for an operated community with a fresh `RoleSnapshot`, the drift
  between incumbent Discord roles and current on-chain token qualification: `stale_access`, `sold_lapsed`,
  `newly_eligible`, `holder_turnover`, whale concentration — k-anonymized. Reads only; NEVER mutates
  incumbent roles. `[grounded: session Explore agent map + DoD brief]`
- **FR-2 (Contract Access-Risk Audit, no-install teaser — G-5):** the `access-risk-audit` preset computes
  the on-chain HALF of the audit from public data alone (chain + contract + date + optional gating rule) — no
  Discord access required — returning turnover/sold-lapsed/newly-eligible/whale/stale-risk + the CTA. This is
  the top-of-funnel wedge (targetable at any community's contract, e.g. Pythenians, without onboarding).
- **FR-3 (Role-snapshot exporter — G-3):** a one-shot freeside-characters CLI (fork
  `apps/bot/src/cli/member-graph.ts`) that enumerates the thj guild (privileged `GuildMembers` intent),
  resolves discord→wallet via `member-identity-client`, and emits a `RoleSnapshotSchema`-valid JSON
  (`role_ids` as Discord snowflakes; unmatched wallets FLAGGED not dropped). `[brief: freeside-characters
  grimoires/loa/context/2026-07-10-role-export-exporter-brief.md]`
- **FR-4 (member-graph FIRST WRITER — G-3, facts half):** the exporter ALSO writes the member object's
  **identity+eligibility FACTS** (discord↔wallet, community, current roles, eligibility state, last-verified,
  provenance) into the existing `profiles` substrate — D1's first real writer. **The REASONING half**
  (holder-quality bands, reason codes, `AccessDecisionRecord`, explanation layer) is DEFERRED to #283 /
  Option C / Eileen and is NOT implemented here. `[operator decision 2026-07-10: "facts now, reasoning
  deferred"]`
- **FR-5 (deploy via Railway IaC — G-1):** define the shadow-audit service in `.railway/railway.ts`
  (source=loa-freeside monorepo, repo-root build context, `dockerfilePath=packages/services/shadow-audit/Dockerfile`),
  env = the greenlit `COLLECTION_REGISTRY` (17 entries, chains 1/10/8453/42161/80094) + verified RPCs +
  `SHADOW_AUDIT_API_KEY`; `config plan` → operator approves the exact plan → `apply`. `[registry brief]`
- **FR-6 (thj onboarding — G-4):** place a `community-onboarding` order (POST /v1/orders on the live
  ordering-service; inputs chain_id/contract=Honeycomb/contact_email/source="dashboard_onboarding") → thj
  becomes an operated community. Operator action; tracked as a gate.
- **FR-7 (organization-as-code — G-6):** establish the CONVENTION of representing buildings as native Railway
  IaC + a minimal agent gate (plan-on-PR, fail-on-unexpected-drift, human-approve prod/destructive). First
  instances: shadow-audit + ordering-service (both already PoC-pulled). NOT all buildings.

---

## 5. Technical & Non-Functional Requirements

- **NFR-1 (stay on Railway):** deploy on Railway via native IaC. Cloudflare/Alchemy migration is OUT (Codex
  research: agent-first requires code-first IaC, not leaving Railway; the persistent-gateway Discord bot +
  long-running indexers fail the Cloudflare fit test).
- **NFR-2 (Railway IaC v0 safety):** the feature is Experimental v0 (codegen bugs are agent-absorbable — PoC
  patched a `postgresVolume` bug). **NEVER** `railway config apply --yes` / `--confirm-destructive` from an
  agent without explicit operator approval of the exact plan. Pin the CLI/SDK version.
- **NFR-3 (correctness where it costs — money/ops):** the audit's correctness risk is the Sonar/RPC
  block-at-date reconstruction + the `COLLECTION_REGISTRY` mapping (a wrong address → silently-wrong audit).
  Derisk THERE (hand-verified holder spot-check), not in plumbing.
- **NFR-4 (Shadow-Mode invariant):** the audit is READ-ONLY and MUST NEVER mutate incumbent roles (D4
  coexistence invariant, #283). No forced cutover; the community decides.
- **NFR-5 (fail-closed):** the shadow-audit service refuses startup when a required var is absent; missing
  `SHADOW_AUDIT_API_URL` in the dashboard → loud error, never fabricated data.
- **NFR-6 (multi-repo coordination):** master=loa-freeside, child=freeside-characters, coordinator at
  `~/bonfire/shadow-audit-mvp-coordinator` (scaffolded; bootstrap staged, not yet applied).

---

## 6. Scope & Prioritization

**MVP (this cycle):** G-1..G-6 above. **The DONE gate is G-2 (the spine) — SM-1..SM-3.** G-5 (teaser) and
G-6 (org-as-code) are **parallel, independent workstreams, NOT blockers on DONE** (flatline IMP-015): the
cycle is done when thj sees drift + the box is deployed via IaC + the exporter writes facts; G-5/G-6 land
alongside but their absence does not hold the spine. Sequencing bias: land the SPINE (G-2, needs G-1 + G-3 +
G-4) first; G-5 + G-6 parallel; FR-4 member-graph write follows the exporter.

**DEFERRED to a governed lane (explicit — these are ratified/in-flight elsewhere, not this PRD's to settle):**
- **D1 holder-quality REASONING + explanation layer + `AccessDecisionRecord` contract** → issue #283 /
  Option C / Eileen. This cycle writes member FACTS only.
- **Lane C — holder-quality signal contract** (eligibility/lifecycle/retention/risk/contribution/monetization/
  operator signal categories) → Hermes is drafting.
- **Lane D — action layer** (what Freeside DOES with an insight: remove/warn/grant/re-engage/block/alert) →
  "later" (operator: the wedge is the data model, not the actions, first).

**EXPLICITLY OUT (non-goals):**
- Cloudflare/Alchemy migration (parked behind a forcing function).
- Inventory canonical DNS flip + inventory-api §10.4 hardening (bead `arrakis-jfm4e`, producer-side).
- The `packages/services/shadow-mode` event-sourced ShadowLedger service as a NEW build — `[ASSUMPTION:
  the member-graph write target is the existing profiles substrate, NOT the event-sourced ledger; which
  substrate is canonical is a /architect decision]`.
- Broader IaC rollout across all ~13 buildings beyond the convention + 2 first instances.
- AI features, monetization, Telegram, quests (operator anti-pattern: scope collapse).

---

## 7. Risks & Dependencies

| Risk / Dependency | Impact | Mitigation |
|---|---|---|
| Railway IaC is Experimental v0 | codegen/apply bugs | agent-patches v0 bugs (PoC proven); pin version; never unapproved destructive apply (NFR-2) |
| Wrong `COLLECTION_REGISTRY` address | silently-wrong audit (money/ops) | grounded + greenlit registry; hand-verified holder §5 spot-check (SM-1) |
| thj identity-link rate low | few members resolve to wallets | unmatched FLAGGED not dropped; SM-2 threshold calibrated to reality, not assumed |
| D4 coexistence runtime unverified `[?]` (#283) — flatline IMP-002 | if the SPINE depended on D4 runtime, it couldn't be demonstrated | **the spine's audit path is the STANDALONE Sonar/RPC audit box, NOT the D4 coexistence runtime** — so G-2 is demonstrable end-to-end even with D4 unverified. D4 coexistence is the broader install-behind-incumbent *delivery* wedge; its runtime verification is a separate spike, out of this cycle's spine |
| Member-graph substrate ambiguity (profiles vs shadow-mode ledger vs coexistence ledger) | mis-placed writes | resolve in /architect (flagged); write FACTS to profiles per #283 as the assumption |
| Pre-empting the #283 D1 contract | process violation (Eileen-ratified) | strict facts/reasoning split (FR-4); reasoning deferred |
| Cross-repo (loa-freeside ↔ freeside-characters) | coordination drift | shadow-audit-mvp coordinator; child runs its own loa cycle |
| Dependency: ordering-service live (onboarding), identity-api live (discord→wallet), Sonar/RPC (ownership) | all required for the spine | all confirmed live this session (probed) |

---

## 8. Grounding & Source Map

- Deployed-but-unconsumed cure + BOEHM discipline: `project_deployed-but-unconsumed-pattern`,
  `2026-07-10-boehm-sovereignty-discriminator.md`.
- Audit box + registry + deploy: `2026-07-10-shadow-audit-mvp-definition-of-done.md`,
  `2026-07-10-shadow-audit-collection-registry.grounded.md`, bead `arrakis-ltokd`.
- Exporter: `freeside-characters/grimoires/loa/context/2026-07-10-role-export-exporter-brief.md`.
- D1/D4 grounding + Option C ratification: issue `#283`; repo `[OBSERVED]` tags therein.
- Railway IaC direction: `reference_railway-graphql-api-full-automation`,
  `project_agent-first-cloud-control-alchemy-vs-railway`; Codex research verdict.
- Interview (2026-07-10): ledger fork = un-gate (member graph is the product, exporter is first writer);
  success gate = drift+hand-verified+quantitative; timeline = done-when-done; member-graph write = facts now,
  reasoning deferred; MVP lanes + Contract Access-Risk Audit spec provided verbatim.

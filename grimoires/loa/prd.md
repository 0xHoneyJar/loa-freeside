# PRD — Shadow Access Audit (lead-magnet order #1 of the Connecting Surface)

> **Status**: candidate (planning) · **Cycle**: connecting-surface · **Date**: 2026-06-21 · **Rev**: v2 (post-flatline)
> **Mode**: thinnest honest cut, ASAP (BD-blocking). v1 backed up at `prd.md.v1-pre-flatline`.
> **Review**: hardened against `grimoires/loa/a2a/flatline/prd-review.json` — 3-model flatline (claude+codex+gemini headless), full confidence, 91% agreement, 9 blockers + 8 high-consensus all integrated.

> ⚠️ **PREMISE TAG (load-bearing).** *"Stale-access is top-of-mind CM pain"* is **operator conviction, NOT validated user truth** (KEEPER conf ~0.4; zero external user quotes). This product exists to **confirm or cleanly KILL** that hypothesis. **CRITICAL SCOPE TRUTH (flatline SKP-001):** the audit *output* can only falsify the hypothesis on **dogfood** communities (where we hold the Discord role state) — and those are where we already hold the conviction, so the audit alone is "confirm-by-construction." **Therefore the falsification instrument for external CMs is the INTERVIEW (§8), using the on-chain turnover half as the prop — NOT the audit output.** Dogfood runs are a build/UX test + internal incident-surfacing, *not* hypothesis falsification. A clean kill is a win.

> ⚠️ **DELIVERABILITY TRUTH (flatline v2 SKP-004 — vindicates "infra isn't ready").** Even a *confirmed* hypothesis **cannot be delivered to external customers** until the live infra (worlds-api + Discord auth) lands — the stale-role intersection is dogfood-only today. So the magnet's near-term job is **validation + dogfood proof + BD relationship-building**, NOT external product conversion. The magnet de-risks the *build decision*; it does not sell an unbuilt product. Building the live product is a separate, later go/no-go gated on this validation + the deferred infra.

> **Claim tags**: `[OBSERVED]` = read from source/live-probe this cycle · `[TO VERIFY]` = assumed, not yet probed · `[ASSUMPTION]` = belief, unvalidated. Sources in §9.

---

## 0. Load Order (read before implementing)

1. `grimoires/loa/context/2026-06-21-connecting-surface-fulfillment.md` — the order→fulfill orchestrator this is order #1 of.
2. `grimoires/loa/directional-field/community-management-hexagonal.md` — the cells, belt DAG, the **two-disagreeing-EligibilityRule breach** (addressed in FR-2 here), D4 built-not-wired.
3. `grimoires/loa/context/2026-06-21-designing-buildings-hexagonally.md` — the hexagonal discipline.
4. `loa-freeside#283` (Eileen) — Option C Hybrid; D4 built / D1 `AccessDecisionRecord` missing.
5. KEEPER enrichment (§3/§8) — pain hypothesis, instrumentation, interview guide.
6. `grimoires/loa/a2a/flatline/prd-review.json` — the 17 findings this rev resolves.
7. `packages/freeside-registry/registry.yaml` — live cell state.

---

## 1. Problem & Vision

**Problem (operator-stated).** Freeside's APIs were designed **separately**; no surface combines them, and onboarding is **by hand** (CubQuests, requests-api) — unscalable for a tiny team. The business friction is **conversion + proving the problem is real + getting pain-surfacing conversations**, not lead generation. `[OBSERVED: operator, this session]`

**The wedge.** A **Shadow Access Audit**: input a contract + snapshot date → who holds gated roles but no longer qualifies (sold/lapsed = stale), who newly qualifies, holder turnover, whale/concentration — with a CTA toward the no-install live version. **The audit is SELF-CONTAINED** — it needs nothing beyond the access-risk inputs/outputs (sonar→score + our roles for dogfood). **The CTA's "next step" is SHADOW MODE** — the D4 coexistence wedge (`packages/adapters/coexistence/`, *built-not-wired*, deferred): Freeside installs *behind* the incumbent gating bot, touches no roles, and keeps them continuously honest. **The audit shows the problem; shadow mode is the no-install solution it converts to** — a separate, later build, not a component of the magnet. The audit is the **simplest order** of the Connecting Surface (`mode: lead-magnet`), and the first load-bearing consumer of the deployed-but-underconsumed cells.

**Why now.** ASAP — BD-blocking. Thinnest honest cut first.

---

## 2. Goals & Success Metrics

> **Metric philosophy** (KEEPER §4): community universe is **tens, not thousands** — **depth is the metric, count is the guardrail**; consumer-funnel targets are actively misleading. All thresholds `PROVISIONAL — recalibrate after dogfood`.

| ID | Goal | Success metric (small-N) | Source |
|----|------|--------------------------|--------|
| **G-1** | **Confirm or KILL the pain hypothesis** — via the **interview (§8)**, not the audit output (per SKP-001) | **≥3–5 distinct, unprompted, specific remembered incidents** from real external CMs → confirmed. **0 across ≥8 real conversations** (only hypotheticals) → clean, documented KILL. | KEEPER §1; flatline SKP-001 |
| **G-2** | **Convert a magnet RUN → a validation CONVERSATION** (the named friction) | **5–8 real conversations booked**; the share of confront-reactions = *"worse than I thought"* (denom 10–20). | KEEPER §3-4; Phase-0 Q3 |
| **G-3** | **Prove the Connecting-Surface fulfillment pattern end-to-end** (architectural) | One `Order` → resolved → audit rendered on the Dashboard, self-operating (exceptions→beads, zero per-run operator touch). | `connecting-surface-fulfillment.md` |
| **G-4** | **Ship the thinnest honest cut ASAP** | Dogfood audit runnable on our own contracts (sonar→score + our role snapshot), passing the §6.5 acceptance criteria; no member-data persistence, no new cell, no role writes. | Phase-0 Q4 |

**Incident-capture (IMP-005):** G-1's remembered incidents are recorded in `grimoires/loa/research/shadow-audit-incidents.jsonl` (`{date, community, tier, incident_shape:{event,discovery,remediation,residual}, source_quote, confidence}`), owned by whoever runs the interview. The audit run-events (G-2) link to the conversation via `run_id`.

**Vanity/validation firewall** (KEEPER §4 — bind into reporting):

| VANITY (don't report as success) | VALIDATION (track) |
|---|---|
| runs · reports · aggregate time-on-page · CTA clicks · shares · "cool!" | remembered-incident hit rate · *"worse than I thought"* share · time-on-**stale-section** · **conversations booked** + live-version asks · **re-runs vs an upcoming-snapshot contract** · WTP |

---

## 3. Users & Stakeholders

**Primary — the external community manager** of a token-gated community. Pain concentrates by role function (KEEPER §2): **Tier 1 acute** (roles control money/allocation — airdrops, allowlists, raffles, reward eligibility; the stale role *silently misdirects value*; the remembered incident lives here) > **Tier 2 moderate** (governance/status legitimacy) > **Tier 3 low** (vanity — these CMs *fail the hypothesis honestly*; that's data). `[ASSUMPTION ~0.7] THJ/CubQuests/mibera are Tier 1` — *why dogfood-first works*.

**Remembered-incident shape** (the proof artifact, KEEPER §2): (a) a discrete event (snapshot/drop) → (b) a discovery moment (*often a member, not the CM, noticed* — pain is often reputational) → (c) a remediation cost → (d) residual "I don't trust our role list" unease.

**Stakeholders:** us (BD + dogfood) · Eileen (#283) · the Freeside Dashboard surface owner.

---

## 4. Functional Requirements

- **FR-1 — `Order` schema (sealed Zod).** Authored first. `{community{name,owner_wallet}, source{chain,contract_address}, gating_rule, products[], mode}`. **v1 = SINGLE source** (one contract); `sources[]` (multi-contract) is deferred (reconciles the FR-1↔FR-3 mismatch, SKP-004/IMP-003).
- **FR-2 — `AccessDecisionRecord` schema + sealed eligibility (SKP-004 / the EligibilityRule breach).** Per-member verdict `{wallet, community, holds_role?, qualifies?, band: stale|missing|ok, evidence{balance, sold_at, block}, provenance{rule_id, computed_at, snapshot_block}}`. **Bands only — no numeric score.** **v1 eligibility = single-contract ERC-20/721/1155 balance-threshold ONLY** (`qualifies = balance_at(snapshot_block) >= threshold`). **EXCLUDE (do not guess):** LP-position, staked, multi-contract, trait/token-ID gating — the audit must *refuse* (not approximate) a community whose gate it can't compute. Every stale wallet carries one-click-verifiable evidence. The two pre-existing `EligibilityRule` shapes are reconciled to this one sealed rule for v1.
- **FR-3 — Compose-face audit (stateless compute).** `audit(contract, snapshot_date)` → `{holder_turnover, sold_lapsed[], newly_eligible[], whale_concentration, stale_access_risk, cta}`. **Date→block (SKP-005):** resolve `snapshot_date` → block per chain at the **UTC day boundary**, at a stated **finality depth**; record `snapshot_block` in provenance. **Historical-at-block — PROBED 2026-06-21 (`arrakis-n56e`, closed):** `[OBSERVED]` sonar's `Transfer` log carries `{blockNumber, collection, from, to, tokenId}` and block-filtering works → **ownership-at-block IS reconstructable** (replay transfers up to block N) for the collections sonar indexes. **BUT `[OBSERVED]` sonar indexes only 8 hardcoded THJ NFT collections** (HoneyJar1-6, Honeycomb, crayons_factory; chains 80094/1/7777777/10) — **an arbitrary external contract has NO data at all.** Consequences: (1) the **dogfood-NFT audit is fully buildable now** (these 8 + our Discord roles → the complete stale-access intersection, historical-at-block); (2) the **external self-serve magnet on an arbitrary contract is NOT viable on sonar** — even FR-4b's "on-chain turnover half" has no data — it requires a **data-source decision** (§Operator decisions); (3) v1 gating = **NFT (ERC-721/1155)** only — `Transfer` is tokenId-shaped (no value); ERC-20 balance gating needs a different entity, deferred.
- **FR-4 — Mode-selection contract (IMP-003 / SKP-001).** A run resolves to exactly one mode: **`dogfood-full`** iff the community is one we operate AND a *fresh* Discord role snapshot exists (FR-4a); else **`external-half`** (FR-4b). The mode is explicit in the output and in run-events.
  - **FR-4a — dogfood-full:** compute the **full stale intersection** (sold-but-still-roled) using our role snapshot. **Role-snapshot metadata required (SKP-003):** `{source, captured_at, role_ids, export_method, owner, freshness_threshold}`; if the snapshot is older than `freshness_threshold`, the UI labels the stale findings as *uncertain* and refuses the confront-number-as-fact.
  - **FR-4b — external-half:** render the **on-chain turnover half** (exited / newly-eligible since the snapshot, whale/concentration) + *"stale roles"* as the **named pain + conversation hook** (NOT a computed column). External rendering (IMP-008): lead with the turnover stat + the *"the wallets that left may still hold your roles — want to see which?"* hook that routes to the interview.
- **FR-5 — Confront-and-capture instrumentation (KEEPER §3; resolves SKP-001 statelessness).** At stale-set render: (a) capture run-events to a **minimal append-only store** (NFR-1) — `{run_id, mode, inputs, stale_set_size, time_on_stale_section, reruns, cta_interaction, reaction}`; (b) one **non-leading** reaction question *"Does this match what you expected?"* → `Worse than I thought | About what I figured | Surprised`; (c) a **conversation CTA** + contact-capture **gated behind explicit consent** (a one-line consent at capture). The stale set is the conversation-starter.
- **FR-6 — Dashboard route + AUTH MODEL (SKP-002 — the doxxing fix).** Public self-serve audit on the Freeside Dashboard (its own route/landing). **Anonymous users see AGGREGATE ONLY** (counts, %, turnover, risk band — *no named wallets*). **Member-level / named-wallet / per-wallet stale output requires proof-of-association.** An `owner_wallet` EIP-191 signature proves wallet *control* — **not** community *authorization* (flatline v2 SKP-001: an attacker signs with any wallet and claims to represent community X). So the signature MUST additionally bind to the community: the `owner_wallet` matches the contract's `owner()`/deployer, **or** a registered community-owner record, **or** a Discord-admin OAuth. v1: contract-`owner()`/deployer check for external; manual allowlist for dogfood. A bare signature is insufficient. (The operator may instead sign off on a documented public-disclosure decision — see §Operator decisions.)
- **FR-7 — Resolver (provision-face, minimal).** Read beacons → capability map → the magnet's trivial DAG (sonar + score). Exceptions → **beads**. Full provisioning (account/world scaffold) is out of scope.
- **FR-8 — Abuse & cost controls (SKP-006).** Per-IP rate limiting + request caps; a **server-side proxy** so the static score-api key is **never shipped to the client**; per-request circuit-breaker/timeout so one audit can't exhaust the shared cells.

---

## 5. Technical & Non-Functional Requirements

- **NFR-1 — Stateless COMPUTE, minimal append store (resolves SKP-001/IMP-001).** Audits **recompute per request — no member data (holdings/scores/roles) is persisted.** A **minimal append-only event/contact store** exists for instrumentation (FR-5) with a **stated retention window** and a **consent line** at contact capture. The system is *member-data-stateless*, not globally stateless.
- **NFR-2 — Runs on the wired half.** sonar belt-gateway GraphQL (no-auth, **server-side only** per FR-8) + score (static key, **proxied** per FR-8). `[OBSERVED current-state live-probe 2026-06-17; historical-at-block TO VERIFY — arrakis-n56e]`.
- **NFR-3 — Incubated in loa-freeside.** A surface, not a cell; earns cellhood when proven.
- **NFR-4 — Self-operating.** Exceptions → beads; no per-run operator touch.
- **NFR-5 — Read-only re: external state.** No Discord role writes; no incumbent mutation. *(The magnet DOES store its own run-events + consented contact — NFR-1; "touches nothing" applies to Discord/incumbent state, not the user.)*
- **NFR-6 — Prerequisites (beads):** `arrakis-gpin` (identity beacon 404) · `arrakis-n56e` (historical-at-block probe — gates FR-3). **`arrakis-nxzk` (worlds-api registry) is DOWNGRADED (IMP-002): NOT required for the magnet** (v1 gating is caller-supplied single-contract) — it's a prerequisite for the *live* product, not this cut.
- **NFR-7 — Auth & privacy.** Proof-of-association (FR-6) for named output; consent + retention for stored events/contact (FR-5/NFR-1).
- **NFR-8 — Cost/abuse controls** per FR-8.

---

## 6. Scope & Prioritization

**IN (MVP):** FR-1..FR-8 — the two schemas (single-contract balance gating), the stateless-compute audit with verified date→block, the mode-selection contract (dogfood-full + external-half), confront-and-capture with consent, the aggregate-public / auth-gated-named Dashboard route, abuse controls.

**What NOT to Build (explicit):**
- **NO** member-data persistence / new cell (compute stateless; incubate-then-extract).
- **NO** Discord role writes / incumbent mutation.
- **NO** numeric score (bands only).
- **NO** gating types beyond single-contract balance-threshold (refuse LP/staked/multi-contract/trait — don't guess) `[v1]`.
- **NO** named-wallet output to anonymous users (aggregate only).
- **NO** full external Discord-role column (deferred — worlds-api + auth).
- **NO** products 2-4 (shadow-preview / live roles / graduation) before validation.

**Sequencing:** prereq probes (`arrakis-gpin`, `arrakis-n56e`) → schemas (FR-1/2) → dogfood compose-face + acceptance criteria (FR-3/4a, §6.5) → instrumentation + consent (FR-5) → Dashboard route + auth + abuse controls (FR-6/8) → external-half (FR-4b) → first external wave (the interview is the falsifier).

### 6.5 Acceptance Criteria (IMP-004 — testable, so the audit is shippable)

- **AC-1 (correctness):** for a fixture contract with a known holder set at block B, `audit()` returns the exact sold/lapsed and newly-eligible sets vs the role snapshot (0 false members; per-wallet `balance`/`sold_at`/`block` match chain).
- **AC-2 (date→block):** a given `snapshot_date` resolves deterministically to the same `snapshot_block` (UTC boundary, stated finality), reproducible across runs.
- **AC-3 (refusal):** a contract whose gating type is out-of-scope (LP/staked/multi/trait) is **refused with a clear message**, never approximated.
- **AC-4 (auth):** anonymous request returns aggregate-only (no named wallets); named output requires a valid `owner_wallet` signature.
- **AC-5 (mode):** mode resolves deterministically; `external-half` never claims a computed stale-role column; a stale dogfood snapshot triggers the uncertainty label.
- **AC-6 (abuse):** the static score key is never present in any client payload; rate limit + circuit-breaker trip under load test.

---

## 7. Risks & Dependencies

| ID | Risk | Sev | Mitigation |
|----|------|-----|------------|
| **R-1** | **Confirm-by-construction** — the audit can't falsify the premise on external users (killer feature is dogfood-only). | **Critical** | The **interview (§8) is the falsifier**, on-chain half is the prop; dogfood runs = build/UX test only. G-1 rewritten. `[SKP-001]` |
| **R-2** | **Premise unvalidated** (conf ~0.4). | Critical | Instrument for kill-ability; celebrate a clean kill. `[KEEPER §1]` |
| **R-3** | **Historical-at-block unverified** — the core query may be unsupported. | Critical | Prereq probe `arrakis-n56e` before sprint; fallback to current-vs-recorded. `[SKP-005]` |
| **R-4** | **Doxxing / competitive-intel** via public named output. | Critical | Aggregate-public + proof-of-association for named (FR-6). `[SKP-002]` |
| **R-5** | **Stateless↔measurement contradiction + privacy.** | High | Member-data-stateless + minimal consented event store (NFR-1). `[SKP-001/IMP-001]` |
| **R-6** | **Wrong confront-number** from fuzzy eligibility / stale snapshot. | High | Sealed single-contract rule + refusal + snapshot freshness label (FR-2/4a). `[SKP-004/SKP-003]` |
| **R-7** | **DoS / static-key leak** on the public surface. | High | Rate-limit + server-side proxy + circuit-breaker (FR-8). `[SKP-006]` |
| **R-8** | **The forever-detour** (goodwill, not validation). | High | Vanity/validation firewall; confront-and-capture (§2, FR-5). `[KEEPER]` |
| **R-9** | **Already-solved** by an existing bot. | Med | Interview Q3; if widespread, re-scope as feature-comparison. `[KEEPER §5]` |

**Dependencies:** sonar + score (live, current-state) · *historical-at-block* (TO VERIFY) · our Discord role snapshots (dogfood) · the Freeside Dashboard · identity beacon (`arrakis-gpin`).

---

## 8. Validation Interview Guide (KEEPER — Mom-Test-clean; the external FALSIFIER)

Ask about the *past* not the future; the *last time* not the general case; talk before you pitch; use their own number as the prop. **Pilot internally first.**

1. *"Walk me through the last time you ran a snapshot / set up role gating for [community] — start to finish."* (surfaces the incident unprompted)
2. *"The audit showed [N] wallets that sold or lapsed but still hold [role]. What's your reaction to that number?"* — **then stop talking.** (the falsification moment)
3. *"What do you do about that today — if anything?"* (latent / active / solved / tolerated)
4. *"Has this ever actually caused a problem — a redo, a misallocation, anyone notice?"* (H2; listen hardest for *member-noticed*)
5. *"If roles always matched holdings before every snapshot, what would that be worth? What do you spend on it now?"* (WTP via current spend)
6. *"We're building the always-on version — who else needs to be in the room, worth a 30-min look next week?"* (commitment test; a calendar slot is the only real signal)

---

## Operator decisions carried by this rev

- **AUTH MODEL (FR-6) — the one product fork.** Default: **aggregate-public + proof-of-association for named output** (safe; no doxxing). Alternative: full public named output with a documented operator-signed disclosure decision (more viral, real liability). *Confirm the default or flip.*
- **Historical-at-block (FR-3 / `arrakis-n56e`) — RESOLVED 2026-06-21:** reconstructable for sonar's 8 indexed THJ NFT collections → the **dogfood-NFT magnet is buildable now**. *Acknowledged.*
- **EXTERNAL DATA SOURCE — RESOLVED 2026-06-21 (operator):** **near-term, ship the dogfood-NFT magnet now** (no external dependency); **medium-term goal = on-demand sonar indexing** (add a CM's contract → re-index → audit). External stays **concierge / BD** — the dogfood result is the prop — until on-demand indexing lands. (A generic Dune/Alchemy adapter not chosen.)

## 9. Sources & Traceability

- **Design:** `connecting-surface-fulfillment.md`, `community-management-hexagonal.md`, `designing-buildings-hexagonally.md` (this cycle).
- **Product:** `loa-freeside#283` (Option C Hybrid).
- **User research:** KEEPER/FRISCH (this cycle).
- **Adversarial review:** `grimoires/loa/a2a/flatline/prd-review.json` — 3-model, full confidence; 9 blockers + 8 high-consensus integrated (this rev); disputed IMP-012 (full traceability matrix) declined per the models' own note. Integration log: `prd-integration-2026-06-21.md`.
- **Substrate:** `registry.yaml` — sonar/score deployed `[OBSERVED current-state]`; identity beacon 404; worlds-api absent (downgraded from prereq).
- **Interview answers:** Phase-0 Q1-Q4. **Prereq beads:** `arrakis-gpin`, `arrakis-n56e` (worlds-api `arrakis-nxzk` downgraded to live-product prereq).

> **Corrections from v1 (honesty):** v1 tagged historical-at-block `[OBSERVED]` — it was only current-state-verified (now `[TO VERIFY]`). v1 claimed "stateless" while requiring capture (contradiction resolved). v1 shipped named output to a public no-auth route (doxxing — now auth-gated). v1 left eligibility multi-contract/under-specified (now sealed to single-contract v1 + refusal).

> Open unknowns (don't let go silent): the premise (G-1) · has it ever bitten (Q4) · money-vs-reputation pain (Q2/Q4) · already-solved (Q3) · historical-at-block (arrakis-n56e) · all PROVISIONAL thresholds.

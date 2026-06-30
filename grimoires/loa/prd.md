# Product Requirements Document — The Eligibility Seam (order intake gated on a reconciled eligibility noun)

> **Cycle:** `cycle/shadow-audit-runtime-ordering`
> **Source of discovery:** `grimoires/loa/context/kalfu-order-eligibility-seam.md` (kalfu exploration brief) via `/discovering-requirements --from`.
> **Supersedes for this cycle:** the agent-ordered-audit PRD, rotated to `prd.prev-2026-06-29-agent-ordered-audit.md` (preserved; it covers the *composition/ordering* side — this PRD covers the *eligibility-gate* side of the same cycle).
> **Domain (ADR-007):** `shared` — the unified `EligibilityRule` noun is `shared/`; the intake eligibility adapter is `platform/`; sprint plan splits per-task. No `network/` paths.

---

## 1. Problem Statement

The Shadow Access Audit's entire value is *detecting divergence between two systems' eligibility
views* — yet the codebase ships **three structurally-incompatible `EligibilityRule` types**, so it
cannot itself claim *one* notion of eligibility.

> From `proposals/eligibility-rule-reconciliation.md:11-27`: three `export interface EligibilityRule`
> definitions in the main tree (`coexistence/shadow-sync-job.ts:121`, `chain/two-tier-provider.ts:41`,
> `worker/EligibilityRepository.ts:36`) — `chainId` alone is `string | number | branded`, "so the
> three cannot even round-trip a chain id without a lossy cast." This is "the credibility hole at the
> wedge center."

Separately, the order system built this cycle (S1→S4 on this branch — order envelope, intake,
orchestrator, frontend) accepts orders with **no eligibility gate**: intake is OPEN/internal.

> From `grimoires/loa/context/kalfu-order-eligibility-seam.md:23`: intake is currently OPEN — no
> eligibility gating; `core/ports/` has no eligibility *port* wired to intake.

**The two problems are one cut.** The reconciliation proposal's own sequencing makes intake-gating
*downstream* of the reconciliation:

> From `proposals/eligibility-rule-reconciliation.md:25-27`: "Reconcile the noun before wiring a third
> [consumer]… the unified `EligibilityRule` is a prerequisite to the `AccessDecisionRecord`."

Order-intake-gating *is* a new eligibility consumer. So this PRD reconciles the noun first (the
foundation the operator already FORK-sealed) and then wires it into intake as the gate.

### What already exists (grounded this session — corrects the kalfu brief)

| Capability | Status | Anchor |
|---|---|---|
| `AccessDecisionRecordSchema` — `.strict()`, **bands-only** (`stale｜missing｜ok`, no numeric score) | ✅ exists | `packages/protocol/shadow-audit/src/schemas/access-decision-record.ts:42` |
| `IEligibilityChecker` abstraction (`ruleType: token_balance｜nft_ownership｜score_threshold`) | ✅ exists — "no live checker, mounted nowhere" | `packages/adapters/coexistence/index.ts:51`; `arch-brief-shadow-order-counter-convergence.md` |
| `ArrakisEligibilityResult{eligible, tier, score, source}` | ✅ exists | `packages/core/domain/coexistence.ts:169` |
| Ordering spine (envelope, intake, orchestrator, frontend) | ✅ built S1→S4 — **unmerged on this branch** | commits `267c2122`…`16a8cced` |
| Unified `EligibilityRule` sealed noun | ❌ **proposed, FORK-sealed, NOT yet authored** | `proposals/eligibility-rule-reconciliation.md:29-49` |
| Eligibility gate wired to order intake | ❌ none | — |

> **Sources:** `kalfu-order-eligibility-seam.md`, `proposals/eligibility-rule-reconciliation.md`, code grounded 2026-06-29.

---

## 2. Goals & Success Metrics

| ID | Goal | Metric (acceptance) | Source |
|----|------|---------------------|--------|
| **G-1** | Author the FORK-sealed unified `EligibilityRule` (sealed Zod, `packages/protocol/`), retiring the 3 incompatible types via inward adapters | Round-trip test: a canonical sample validates, and each of the 3 legacy shapes round-trips through `toProtocolRule()` → unified schema → back **without loss on `chainId` and `threshold`** | `eligibility-rule-reconciliation.md:71-75` (the proposal's own meter) |
| **G-2** | Order intake gates on an eligibility verdict before accepting an order; ineligible → existing refusal envelope | `order(audit)` from an ineligible requester is **refused end-to-end** (refuse-not-approximate); an eligible requester proceeds to the `placed→routing→producing→fulfilled` saga | `kalfu-order-eligibility-seam.md` (vertical slice); rotated PRD (ordering spine) |
| **G-3** | ACL preserved — ordering consumes the verdict/noun **without importing shadow-audit** | `packages/protocol/ordering/src/__tests__/ordering-protocol.test.ts:99` stays green (no `from '…shadow-audit'` import) | grounded 2026-06-29 |
| **G-4** | Replay-safe + auditable — verdict rides the signed JetStream spine; threshold is **string** (FORK-2); `AccessDecisionRecord` stays `.strict()` bands-only | verdict survives snapshot→replay round-trip; a smuggled numeric `score` is a hard parse failure | FORK-2 (`eligibility-rule-reconciliation.md:57-59`); `access-decision-record.ts:42` |
| **G-5** | The new 4th variant `activity_check` degrades **the same way** `token_balance` does in #384's score-checker — never a silent confident-negative | #384's `makeScoreEligibilityChecker` returns a degrade (e.g. `native_degraded`), **not** `default: return false`, for `activity_check` (test) | `2026-06-28-audit-connections-to-eligibility-reconciliation.md:12-14` |

---

## 3. Users & Stakeholders

- **Primary (near-term, internal):** the operator/team placing orders — intake is OPEN/internal for MVP. The gate's *first real consumer* may be the existing **coexistence checker** (which already needs a live `IEligibilityChecker`), not external orders.
  > From `kalfu-order-eligibility-seam.md` (Mom-test caveat): "the external orderer doesn't exist yet."
- **Secondary (the credibility beneficiary):** anyone trusting a Shadow Access Audit result — the reconciliation lets the audit claim *one* eligibility computation rather than three.
- **Downstream consumers of the unified noun:** the 3 legacy sites (`coexistence/`, `chain/`, `worker/`) that adapt inward; `AccessDecisionRecord` which is prerequisite-blocked on it.

> **Sources:** `kalfu-order-eligibility-seam.md`, `eligibility-rule-reconciliation.md:63-69`.

---

## 4. Functional Requirements

### FR-1 — Unified `EligibilityRule` sealed noun (the foundation)
The system shall define one sealed Zod `EligibilityRule` in `packages/protocol/` with:
- `ruleId` (canonical id, reconciling `(none)｜id｜ruleId`), optional `communityId`, `ruleType` enum
  (**superset of 4**: `token_balance｜nft_ownership｜score_threshold｜activity_check`).
- `chainId` as the **branded `ChainId`** (FORK-1, sealed) — string/number forms are lossy.
- `threshold` as a **discriminated union** on `kind` (`balance{minAmount:string}｜score{minScore:number}｜
  ownership｜activity{minActivity:number}`) — amount is **string** (FORK-2, sealed), JSON-/replay-safe.

> EARS: *The system shall represent every eligibility rule as the sealed `EligibilityRule` noun.*
> Source: `eligibility-rule-reconciliation.md:31-49`.

### FR-2 — Inward adapters (no big-bang migration)
For each of the 3 legacy sites, the system shall provide a one-function `toProtocolRule(local): EligibilityRule`
anti-corruption adapter; nothing downstream binds the local shapes. #384's `satisfies()` shall migrate
to read the discriminated-union threshold (`rule.threshold.kind === 'score' ? …`), pinned by #384's
existing 11 fail-closed tests.

> Source: `eligibility-rule-reconciliation.md:63-69`; `2026-06-28-audit-connections...md:16-18`.

### FR-3 — Eligibility verdict at order intake (the gate)
When an order is placed, the system shall evaluate eligibility (via a live checker behind the existing
`IEligibilityChecker` shape) **before** accepting it. If the requester is eligible, the order proceeds
to the saga. If ineligible, the system shall refuse using the **existing refusal envelope**
(refuse-not-approximate, fail-closed). The verdict shall be emitted on the signed JetStream spine.

> EARS: *When an order is placed, the system shall emit an eligibility verdict before transitioning to `routing`.*
> Source: `kalfu-order-eligibility-seam.md` (vertical slice).

### FR-4 — Degraded-refusal correctness for `activity_check`
If a checker structurally cannot evaluate a `ruleType` (e.g. the score-backed checker facing
`token_balance` or `activity_check`), the system shall **degrade-refuse** (honest "can't judge"),
never bank a confident negative via a `default: return false`.

> Source: `2026-06-28-audit-connections-to-eligibility-reconciliation.md:12-14`.

---

## 5. Technical & Non-Functional Requirements

- **NFR-1 (fail-closed):** every eligibility decision defaults to refusal, never to a fabricated or
  approximated grant. (`refuse-not-approximate`.)
- **NFR-2 (replay-safety):** all rule/verdict fields are JSON-serializable (FORK-2 string threshold);
  `bigint` is forbidden in the sealed noun. Verdicts round-trip snapshot/replay.
- **NFR-3 (no numeric score in access records):** `AccessDecisionRecord` stays `.strict()` bands-only;
  schema-level rejection of any smuggled `score`.
- **NFR-4 (ACL / bounded-context isolation):** `packages/protocol/ordering` never imports any
  shadow-audit module; the gate consumes the eligibility noun/verdict through the shared protocol only.
- **NFR-5 (domain firewall, ADR-007):** the unified noun + verdict schemas land in `shared/` paths;
  the intake adapter (reaches member-graph/score/chain) is `platform/`. No single PR straddles domains.
- **NFR-6 (one `chain/` touch):** if the gate's adapter touches `chain/`, the noun reconciliation and
  the `chain/` error-discipline pass (`arrakis-kskt`/`7bnk`/`zt17`) are sequenced into one `chain/`
  sprint — reconcile the noun (contract) first, then error-discipline (runtime).

> **Sources:** `eligibility-rule-reconciliation.md:52-69`, `2026-06-28-audit-connections...md:20-22`, `kalfu-order-eligibility-seam.md`.

---

## 6. Scope & Prioritization

**MVP (this cycle):** G-1 (reconcile the noun) → G-2 (gate intake for **one** product, `audit`) → G-3/G-4/G-5 invariants.

**Explicit non-goals:**
- **NO** coexistence order-counter convergence (the dormant shadow-mode foundation — `arch-brief-shadow-order-counter-convergence.md`). Deferred (was the rejected "full convergence" scope option).
- **NO** multi-product catalog / DAG resolution beyond the existing 1-entry map.
- **NO** marketplace listing / checkout / tenanting.
- **NO** saga compensation (no >1-building order exists).
- **NO** generalizing the audit payload's sealed strictness.

> **Sources:** discovery decision (2026-06-29: "reconciliation-as-foundation + intake gate"); `kalfu-order-eligibility-seam.md` non-goals; `order-system-mvp-brief.md:92-102`.

---

## 7. Risks & Dependencies

| Risk / Dependency | Impact | Mitigation |
|---|---|---|
| **[DEP] S1–S4 ordering spine is unmerged** on this branch | If it doesn't land, there's no intake to gate (G-2 blocked) | Sprint plan sequences the merge as an explicit prerequisite; PRD does not own the merge (operator declined G-6) but flags it as a hard dependency |
| **[RISK] False shared kernel** — if the 3 legacy `EligibilityRule` semantics secretly diverge, the unified noun welds them wrongly | Silent mis-gating | The proposal's round-trip meter (G-1) + per-site adapters partly hedge; operator-check: *name a case where "who may order" says YES while "who passes the rule" says NO* — if real, keep verdict types distinct |
| **[RISK] Premature gate** — the external orderer doesn't exist yet (Mom-test) | Gate may be unconsumed at the order edge | Lead with the reconciliation (real credibility-hole fix); the gate's first consumer can be the coexistence checker, not external orders |
| **[DEP] #384 `satisfies()` migration** to the discriminated-union threshold | Touches verified-sound score-checker | Pin with #384's 11 existing fail-closed tests (FR-2) |
| **[DEP] `chain/` error-discipline coupling** (`arrakis-kskt` over-broad retry on the eligibility path) | Two touches to one surface | Reconcile noun then error-discipline in one `chain/` sprint (NFR-6) |
| **[RISK] AccessDecisionRecord placement** — currently inside shadow-audit's protocol; ordering's ACL test forbids importing it | G-3 red if consumed directly | The *verdict* the gate consumes rides the shared `EligibilityRule`/verdict noun in `shared/`, not shadow-audit's record |

---

## 8. Forks already resolved (carried, not re-litigated)

- **FORK-1** — `chainId` = branded `ChainId` (EIP-155 integer). Sealed by operator. (`eligibility-rule-reconciliation.md:54-56`)
- **FORK-2** — `threshold` amount = string (decimal), not `bigint`. Sealed by operator. (`:57-59`)
- **`ruleType`** — take the 4-variant superset. (`:60-61`)
- **Discovery (2026-06-29):** scope = reconciliation-as-foundation + intake gate; PRD target = rotate + new.

---

## 9. Traceability

Every requirement above traces to one of:
- `grimoires/loa/context/kalfu-order-eligibility-seam.md` (kalfu exploration brief, council-derived)
- `grimoires/loa/proposals/eligibility-rule-reconciliation.md` (operator-flagged, FORK-sealed)
- `grimoires/loa/context/2026-06-28-audit-connections-to-eligibility-reconciliation.md` (downstream consequences)
- Code grounded 2026-06-29: `access-decision-record.ts:42`, `coexistence.ts:169`, `coexistence/index.ts:51`, `two-tier-provider.ts:41`, `ordering-protocol.test.ts:99`, `core/ports/` listing
- `prd.prev-2026-06-29-agent-ordered-audit.md` (the ordering/composition side of this cycle)
- Discovery decisions (2026-06-29): scope + target forks

> **Next:** `/architect` — SDD for the sealed `EligibilityRule` noun + the 3 inward adapters + the intake gate wiring + the verdict-on-JetStream contract.

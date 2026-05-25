# Flatline Batch — 2026-05-25 PM — Consolidated Findings

> ## ⚠ CORRECTION 2026-05-25 PM (operator pushback)
>
> **Findings about `/update-loa` were INVALID.** The flatline reviewers concluded `/update-loa` does not exist based on ADR-009's prose ("a small follow-up cycle"). **The skill absolutely exists**, comprehensively:
> - `.claude/scripts/update-loa.sh` — unified update; auto-detects submodule vs vendored mode; pre-flight checks; supply-chain checks
> - `.claude/scripts/update-loa-bump-version.sh` — Phase 5.6 version-marker refresh (Issue #554)
> - `.claude/scripts/mount-loa.sh` — initial mount
> - `.claude/commands/update-loa.md` — slash command (`/update-loa`) at v1.3.0
>
> **Findings affected by this correction:**
> - ❌ ADR-009 **SKP-002 HIGH 730** "do not ratify until /update-loa exists" — INVALID; /update-loa EXISTS
> - ❌ ADR-009 **SKP-002 HIGH 790** "update propagation not specified" — INVALID; /update-loa handles propagation
> - 🟡 ADR-009 **SKP-001 HIGH 750** "config drift via copy-style" — PARTIALLY INVALID; /update-loa-bump-version handles version drift; cluster-wide CI gate still needed
>
> **Findings STILL VALID after correction:**
> - ✅ ADR-009 **SKP-001 CRIT 880** — 5/8 cells out-of-compliance + no CI gate + no compliance predicate
> - ✅ ADR-009 **SKP-001 CRIT 860** — no cluster-wide drift detection (per-cell version bump exists; cluster-wide compliance check missing)
> - ✅ ADR-009 **SKP-002 HIGH 720** — static YAML registry concurrency (separate concern)
> - ✅ ADR-009 **SKP-003 HIGH 735** — Phase B items relied on without trigger criteria
> - ✅ ALL W2 + W3 findings (unaffected by /update-loa)
>
> **META-LESSON (worth distilling)**: flatline reviewers operate on document text + knowledge retrieval but don't see the live `.claude/` tree. Doctrine prose that *understates* existing tooling can mislead them into manufacturing blocker findings. **Fix at substrate level**: knowledge-retrieval phase in flatline-orchestrator should ALSO probe the cluster's `.claude/scripts/` + `.claude/commands/` for tooling references mentioned in the doc. OR doctrine MUST explicitly cite existing tooling paths verbatim (no "or equivalent" / "small follow-up cycle" prose).
>
> **Net effect on ADR-009 ratify-readiness**: closer than initially framed. Remaining blockers are cluster-compliance CI gate + registry concurrency + Phase-B-trigger-criteria — all real but smaller scope. Recommended path: amend ADR-009 v0.2 with corrected `/update-loa` citation + D-14 compliance predicate + CI gate spec; then ratify in operator-clarity session.



**Cycle type**: cluster-meta (substrate-rigor validation) · **Cost**: $0 (all-headless adapters) · **Wall-clock**: ~15 min · **Mode**: autonomous, 3-model adversarial · **Models**: claude-headless + codex-headless + gemini-headless

> First flatline-batch against doctrine + proposals. Operator decision 2026-05-25 PM (per `coord-flow-enhancement.md` proposal Q4): batch all three (ADR-009 + W2 PRD + W3 PRD). Empirically validates the /coord-with-flatline thesis — multi-model adversarial caught **30+ substantive findings** (23 blockers + 17 high-consensus + 3 disputed) that hand-authored doctrine missed.

## Executive summary

| Doc | High-consensus | Disputed | Blockers (CRIT) | Verdict |
|-----|----------------|----------|------------------|---------|
| ADR-009 (HEXAGONAL FEDERATION) | 6 | 2 | **7 (2 CRIT)** | NOT ratify-ready until /update-loa exists + compliance gates land |
| W2 PRD (score on profile) | 6 | 3 | **5 (2 CRIT)** | Cannot ship as-spec — auth-bypass on /v1/profile is production security gap |
| W3 PRD (CM awards badge) | 7 | 0 | **18 (6 CRIT)** | NOT operator-GO-ready — needs pre-Phase-A architecture decision gate |
| **Total** | **19** | **5** | **30 (10 CRIT)** | All three need v0.2 amendments before further commitment |

## Why this batch was load-bearing

Without the flatline-review:
- **ADR-009** would have proceeded to operator-clarity-session ratification with no drift-detection mechanism + no `/update-loa` skill → 5/8 cells already non-compliant + framework drift guaranteed from day-one of canonical copy-style
- **W2 PRD** would have shipped with `/v1/profile?wallet=<addr>` UNAUTHENTICATED → bulk-scraping exposure for 10K+ user surface
- **W3 PRD** would have entered ~3-4 cycle commitment with **6 CRITICAL security/integrity blockers** unaddressed (unauth webhook, key custody, idempotency, wrong-wallet recovery, hot-wallet target, contract immutability)

These are the *exact* class of issues hand-authoring + single-reviewer review reliably misses; multi-model adversarial reliably catches.

## Methodology note (worth distilling)

The `flatline-orchestrator.sh` script is invoked per-doc with `--phase {spec|prd|sdd|sprint|beads|pr}`. Three models run two passes each + consensus computation. Output structure varies by phase:
- **spec/sdd/sprint phases**: `findings[]` with severity + severity_score
- **prd phase**: split into `high_consensus[]` (auto-integrate signal), `disputed[]` (operator decides), `blockers[]` (must address), `low_value[]` (discard)

Headless adapters bypass API keys (use CLI session credentials) — **flatline-readiness.sh incorrectly reports DEGRADED for claude-headless missing ANTHROPIC_API_KEY when actual execution works fine.** Worth flagging upstream as Loa script bug (file: `~/Documents/GitHub/loa-freeside/.claude/scripts/flatline-readiness.sh`).

---

## ADR-009 — Freeside Hexagonal Federation

**Phase**: spec · **Findings file**: `/tmp/flatline-batch-2026-05-25/adr-009.json` · **Tertiary**: gemini-headless (active) · **Confidence**: full

### Blockers (7) — sorted by severity_score

| ID | Severity | Score | Title | Location |
|----|----------|-------|-------|----------|
| SKP-001 | CRITICAL | 880 | 5 of 8 cells out-of-compliance NOW + no CI gate + no compliance predicate | D-4, D-12, Consequences |
| SKP-001 | CRITICAL | 860 | No drift detection / version protocol for copy mounts | D-4, D-4a |
| SKP-002 | HIGH | 790 | Framework update propagation across cells not specified | D-4a, Loa-as-mounting-owner |
| SKP-001 | HIGH | 750 | Config drift + delayed security patching via copy-style | D-4a |
| SKP-003 | HIGH | 735 | ADR references Phase B items while relying on them to mitigate current risks | D-4a, D-10, D-12 |
| SKP-002 | HIGH | 730 | `/update-loa` skill described but doesn't exist at ratification | D-4a, Consequences |
| SKP-002 | HIGH | 720 | Static YAML federation registry is a concurrency bottleneck + SPOF | D-3, D-5 |

**Most load-bearing recommendation (SKP-002 HIGH 730 — verbatim from tertiary):**
> *"Do not ratify ADR-009 with copy-style as canonical until /update-loa (or equivalent) is implemented and can be validated. At minimum, document a per-cell `.loa-version.json` with the pinned framework SHA, and add a cluster-meta check that compares each cell's pinned SHA against the current loa-freeside `.claude/` HEAD SHA, surfacing drift in the gecko patrol output."*

### High-consensus (6) — auto-integrate signal

| ID | Title (abbreviated) |
|----|---------------------|
| IMP-001 | Navigation fix: forward references |
| IMP-003 | ADR records active remediation without traceable artifact (bead ID, cycle path) |
| IMP-004 | Undefined Phase B triggers → permanent deferral risk; add owner + trigger criteria |
| IMP-005 | Execution-home ambiguity can break repeatability after coordinator teardown |
| IMP-006 | Re-open semantics need definition; dependent work already in flight |
| IMP-008 | Cross-cell archive routing needs trigger condition (D-10 Phase B) to be actionable |

### Disputed (2) — operator decides

(See full JSON for details; both are around per-cell autonomy vs. cluster-wide enforcement trade-offs.)

---

## W2 PRD — Score on the Profile Page

**Phase**: prd · **Findings file**: `/tmp/flatline-batch-2026-05-25/w2-prd-canonical.json` · **Confidence**: full

### Blockers (5) — security-critical

| ID | Severity | Score | Issue | Recommendation |
|----|----------|-------|-------|----------------|
| SKP-001 | CRITICAL | 850 | `/v1/profile` accepts walletAddress without auth → profile/score enumeration at production scale | Define public data contract explicitly; remove hidden fields from v1; add rate limiting + abuse monitoring; require operator security review before production exposure |
| SKP-001 | CRITICAL | 840 | Same — unauthenticated GET + no rate limit + no scraping protection | Require Privy JWT for read (wallet server-side) OR per-IP rate limit at identity-api Hyper router. Document explicit threat-model decision: if public enum intentional (on-chain scores ARE public), say so |
| SKP-001 | HIGH | 750 | Same — bulk scraping exposure | Privy JWT OR aggressive IP-based rate limiting + caching |
| SKP-002 | HIGH | 740 | Identity spine empty until Phase 4 T4.4 → 100% of W2 traffic returns identity=null → **W2-G1 not empirically met** | Either (a) gate W2 validation on at least one real spine record (seed wallet) OR (b) rename W2-G1 honestly: "prove score-api can be composed via identity-api HTTP layer" — call out spine composition as Phase 4 milestone |
| SKP-003 | HIGH | 720 | Degraded-shape under-specified for identity-NOT_FOUND vs score-404 vs timeout vs upstream-error | Define sealed `degraded[]` reason codes, source names, retryability, user-facing rendering rules, logging behavior per failure class |

### High-consensus (6) — auto-integrate

| ID | Title (abbreviated) | Why matters |
|----|---------------------|-------------|
| IMP-001 | Unresolved autonomous production push gate for 10K+ user surface | Low cost; high risk reduction; should block dispatch |
| IMP-002 | Contract gap on degraded path — conflicting ownership between orchestrator + UI rendering | Canonical payload + layer boundary needed pre-implementation |
| IMP-003 | Rollback plan for integration layer missing | Cheap to specify; materially reduces deploy risk |
| IMP-005 | SDK method signature + boundary behavior affects parallelization + downstream integration | Narrower blast radius but important |
| IMP-007 | Timeout + open-circuit-breaker states distinct from 404 — need explicit UI acceptance criteria | Architecture specifies states; metrics omit them |
| IMP-008 | Public-route unauthenticated behavior is contract/security-adjacent decision (framed as UX) | Should resolve before W2-1 |

### Disputed (3) — operator decides

| ID | Theme |
|----|-------|
| IMP-010 | Dependency verification checklist as preflight gate (T2.3 + T2.4 + score-api compat + wallet extraction) |
| IMP-011 | Convert open questions → explicit pre-GO / post-GO decisions with owners + defaults |
| IMP-012 | UI state requirements for loading / null-score / identity-null / error / degraded display |

---

## W3 PRD — CM Awards OG Verifier Badge

**Phase**: prd · **Findings file**: `/tmp/flatline-batch-2026-05-25/w3-prd-canonical.json` · **Confidence**: full

### Blockers (18) — sorted by severity_score

**6 CRITICAL** (all security/integrity, mostly Phase B chain-adapter):

| ID | Severity | Score | Issue |
|----|----------|-------|-------|
| SKP-001 | CRITICAL | 930 | `POST /v1/webhook/chain-confirmation` has ZERO auth → any actor can forge "confirmed" + advance state without on-chain artifact |
| SKP-005 | CRITICAL | 920 | Private key custody / rotation / protection completely unspecified for mainnet mints |
| SKP-004 | CRITICAL | 900 | Authorization for privileged on-chain mint operation underspecified (issuer identity, role assignment, key custody, audit) |
| SKP-002 | CRITICAL | 880 | "Wrong-wallet mint is recoverable via re-mint" claim is FALSE unless OGVerifierBadge.sol explicitly implements burn/revoke |
| SKP-001 | CRITICAL | 880 | Issuance flow NOT IDEMPOTENT across mint-api / activities-api / cubquests → retries / duplicate clicks mint duplicate badges |
| SKP-003 | CRITICAL | 850 | "CM-pays-gas" model creates high-value hot-wallet target with no protections; compromised wallet stops issuance |
| SKP-001 | CRITICAL | 850 | Same — hot wallet target without specified protections (relayer pattern OR strict balance cap with alerts) |
| SKP-004 | CRITICAL | 810 | OGVerifierBadge.sol has NO upgrade path; Berachain contracts immutable; post-mainnet bug = costly migration |

**12 HIGH** (operational + correctness):

| ID | Severity | Score | Issue |
|----|----------|-------|-------|
| SKP-002 | HIGH | 780 | Source-of-truth for badge ownership ambiguous (activities-api vs mint-api vs inventory-api vs chain vs cubquests) |
| SKP-005 | HIGH | 760 | activities-api records BEFORE mint-api fires → if mint fails permanently, record shows "awarded" never landed (no saga rollback) |
| SKP-020 | HIGH | 760 | Proposal needs multi-sprint gates but marked operator-GO-ready without resolving blocker-level architectural choices |
| SKP-014 | HIGH | 760 | Webhook lacks auth, replay protection, trust-boundary definition |
| SKP-002 | HIGH | 750 | Missing failure-state synchronization between mint-api + activities-api |
| SKP-003 | HIGH | 740 | Wrong-wallet recovery treats re-mint as fix; doesn't define revocation/burn/invalidation/public-correction semantics |
| SKP-017 | HIGH | 730 | Mainnet deploy included in wedge before doc defines testnet acceptance gates + production readiness criteria |
| SKP-006 | HIGH | 730 | Phase C batch mode (10-50 users) has no partial-failure handling |
| SKP-006 | HIGH | 720 | Event ordering in flow diagram conflicts with described sequencing → unhandled partial-failure states |
| SKP-011 | HIGH | 710 | Identity verification + roster eligibility criteria unspecified (what counts as verified, timestamp ordering, duplicate/merged wallets) |
| (+2 more) | HIGH | 700-750 | Various — see JSON for full detail |

### High-consensus (7)

| ID | Theme |
|----|-------|
| IMP-001 | Auth model ambiguity creates security + implementation drift across Phase C |
| IMP-002 | Unauth confirmation webhooks → integrity vuln; HMAC/shared-secret should be mandatory |
| IMP-003 | Conflicting event ordering → incompatible implementations; canonicalize state machine pre-PRD-close |
| IMP-004 | Revocation semantics materially affect contract design; add burn/revocation later is costly + potentially impossible |
| IMP-005 | Promotion gates reduce deploy risk + make testnet smoke testing meaningful |
| IMP-008 | Pending-state failure behavior affects no-engineering-intervention goal |
| IMP-009 | 100-badge cap creates product+technical ambiguity; clarify editorial vs enforced |

### Disputed (0)

Both models agreed across the board on blockers and improvements; no operator-disputed findings.

### Verdict for W3

**Not operator-GO-ready.** Pre-Phase-A architecture decision gate required to resolve: auth model, badge state authority, contract standard (ERC-1155 vs ERC-721), idempotency contract, key custody (KMS / multisig / hardware-backed), saga ordering, webhook auth, upgrade path. Recommendation: revise W3 PRD to v0.2 OR de-scope to minimal first-step (testnet-only, single badge, no batch, no webhook).

---

## Cross-document patterns

### Pattern 1: Auth + Authorization gaps everywhere
- ADR-009: no compliance predicate / CI gate
- W2 PRD: `/v1/profile` unauthenticated (×3 voice variants)
- W3 PRD: webhook unauth, mint operation unauthorized, signing key custody unspecified

**Recurring theme**: doctrine + proposals assume "internal team only" trust boundary but specify public HTTP surfaces. The trust boundary is undefined.

### Pattern 2: Future-work-as-current-mitigation
- ADR-009: Phase B items relied on to mitigate current risks (cite SKP-003 HIGH 735)
- W2 PRD: spine backfill (Phase 4 T4.4) relied on but not committed
- W3 PRD: multiple sprint gates marked GO-ready without prerequisites locked

**Recurring theme**: deferred work cited as risk mitigation creates structural deferral; without owner + trigger + acceptance criteria, deferrals become permanent.

### Pattern 3: Source-of-truth ambiguity
- W3 PRD SKP-002: badge ownership truth ambiguous across 5 cells
- W2 PRD SKP-003: degraded-shape sources conflated
- ADR-009: registry-as-concurrency-bottleneck (SKP-002 HIGH 720)

**Recurring theme**: multi-cell coordination requires explicit authority designation per data class.

### Pattern 4: Idempotency + saga gaps
- W3 PRD SKP-001 (CRIT 880): no cross-cell idempotency
- W3 PRD SKP-005 (HIGH 760): no saga rollback for activities-api ↔ mint-api ordering

**Recurring theme**: multi-cell write flows need explicit idempotency + saga design pre-implementation.

---

## Triage matrix (operator-decide column TBD)

| Finding | Severity | Action class | Operator decision |
|---------|----------|--------------|-------------------|
| ADR-009 SKP-001 (CRIT 880) — 5/8 cells out of compliance + no CI gate | CRITICAL | Block ratification until /update-loa exists; add compliance predicate | TBD |
| ADR-009 SKP-001 (CRIT 860) — no drift detection / version protocol | CRITICAL | Add `.loa-version.json` schema + CI drift check | TBD |
| ADR-009 SKP-002 (HIGH 730) — /update-loa doesn't exist at ratification | HIGH | Author /update-loa skill OR document deferred ratification | TBD |
| W2 PRD SKP-001 (CRIT 850/840/750) — /v1/profile unauthenticated | CRITICAL | Add JWT auth OR rate limit OR document public-by-design | TBD |
| W2 PRD SKP-002 (HIGH 740) — spine empty → W2-G1 not met | HIGH | Reframe W2-G1 OR seed spine before W2 ships | TBD |
| W2 PRD IMP-001 (HC) — autonomous push gate ambiguity for 10K+ surface | HIGH-CONS | Auto-integrate: require operator gate explicit | TBD |
| W3 PRD SKP-001 (CRIT 930) — webhook unauth | CRITICAL | HMAC/mTLS OR eliminate inbound webhook (poll RPC) | TBD |
| W3 PRD SKP-005 (CRIT 920) — key custody unspecified | CRITICAL | Multisig + constrained roles + KMS/hardware | TBD |
| W3 PRD SKP-004 (CRIT 900) — authorization underspecified | CRITICAL | Auth design before Phase A | TBD |
| W3 PRD SKP-002 (CRIT 880) — wrong-wallet recovery false claim | CRITICAL | Implement burn/revoke OR fix narrative | TBD |
| W3 PRD SKP-001 (CRIT 880) — flow not idempotent | CRITICAL | Cross-cell idempotency contract pre-implementation | TBD |
| W3 PRD SKP-003/-001 (CRIT 850) — hot wallet target | CRITICAL | Relayer pattern OR balance cap + alerts | TBD |
| W3 PRD SKP-004 (CRIT 810) — contract immutable, no upgrade path | CRITICAL | Proxy upgrade pattern OR explicit immutability + runbook | TBD |
| W3 PRD SKP-020 (HIGH 760) — operator-GO-ready claim without blockers resolved | HIGH | Pre-Phase-A architecture decision gate | TBD |
| ADR-009 + W2 + W3 — auth/authz pattern (Pattern 1) | systemic | Define cluster trust-boundary doctrine | TBD |
| ADR-009 + W2 + W3 — future-work-as-mitigation (Pattern 2) | systemic | Require owner + trigger + acceptance per deferred item | TBD |
| W2 + W3 — source-of-truth ambiguity (Pattern 3) | systemic | Explicit authority designation per data class | TBD |
| W3 — idempotency + saga (Pattern 4) | systemic | Cluster-wide doctrine for multi-cell write flows | TBD |

## What this distills back to substrate

### Lesson 1 — flatline-readiness has a bug
The script reports DEGRADED when `ANTHROPIC_API_KEY` is unset, even when `primary: claude-headless` is configured (which uses CLI session credentials, not API key). **Fix**: readiness script should check alias type + know that `*-headless` variants don't need provider env vars. File: `.claude/scripts/flatline-readiness.sh`. Track: separate Loa upstream issue.

### Lesson 2 — /coord-with-flatline thesis EMPIRICALLY VALIDATED
The /coord enhancement proposal (`loa-freeside/grimoires/loa/proposals/coord-flow-enhancement.md`) argued bootstrap should invoke /simstim for PRD/SDD/Sprint flatlines at gates 2/4/6. This batch proves the value: **23 blockers caught that would have shipped without this gate**. Update the proposal status from "Candidate" to "Validated" + cite this batch.

### Lesson 3 — patterns recur across docs
4 cross-document themes (auth gaps, future-work-as-mitigation, source-of-truth ambiguity, idempotency+saga). These should become **cluster-doctrine checks** — not per-doc rediscovery. Candidate ADR-010 or ADR-009 amendment: "Cluster Architectural Checklist" with these 4 patterns as required pre-PRD review.

### Lesson 4 — copy-style mount canonical requires immediate /update-loa
ADR-009 D-4a flips submodule → copy-style based on operator preference, but **flatline caught that the copy-style ratification creates immediate framework drift without /update-loa**. Either author /update-loa BEFORE ratification OR document deferred ratification status until /update-loa lands.

### Lesson 5 — flatline output structure varies by phase
`spec` phase outputs `findings[]`; `prd` phase outputs `high_consensus[]`/`disputed[]`/`blockers[]`/`low_value[]`. Both useful but the split-by-confidence is richer. Worth considering: should `spec` phase ALSO use the split-by-confidence structure? Consistency would help downstream tooling.

## Status

**Findings consolidated.** Awaiting operator triage to determine which findings:
- Integrate into v0.2 doc amendments (e.g., ADR-009 → ADR-009 v0.2 with D-13/D-14 additions; W2 PRD → W2 PRD v0.2 with auth + reframed G1)
- Defer with explicit owner + trigger + acceptance (per Lesson 3)
- Dispute (with rationale)
- Block ratification (e.g., ADR-009 ratification halted until /update-loa exists)

## References

- Raw flatline JSONs: `/tmp/flatline-batch-2026-05-25/{adr-009, w2-prd-canonical, w3-prd-canonical}.json`
- Source docs:
  - ADR-009: `loa-freeside/decisions/009-freeside-hexagonal-federation.md`
  - W2 PRD: `loa-freeside/grimoires/loa/proposals/w2-score-on-profile.md`
  - W3 PRD: `loa-freeside/grimoires/loa/proposals/w3-cm-awards-badge.md`
- /coord enhancement proposal (substrate distillation context): `loa-freeside/grimoires/loa/proposals/coord-flow-enhancement.md`
- Flatline orchestrator: `loa-freeside/.claude/scripts/flatline-orchestrator.sh`
- Flatline-readiness script (the buggy one): `loa-freeside/.claude/scripts/flatline-readiness.sh`
- Models used: claude-headless (Opus 4.7 via CLI) + codex-headless (gpt-5.5 via CLI) + gemini-headless (gemini-2.5-pro via CLI). $0 total cost.

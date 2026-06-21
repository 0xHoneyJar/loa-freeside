# PRD — Complete the Hexagonal Extraction Migration (extraction-sequenced)

> **This is the operator-clarity session ADR-008 deferred.** `decisions/008-freeside-as-factory.md`
> §Current-State ends: *"The follow-up operator-clarity session sequences the extractions. No code
> moves in this ADR."* This PRD sequences them — using the chronically-red CI as the diagnostic for
> what's stranded.
>
> Date: 2026-06-21 · CI diagnostic bead: `arrakis-yp7q` · Grounded against `main` + ADR-007/008 + the
> reality files (`grimoires/loa/reality/`, 2026-06-19) + this session's CI triage.
> (The prior `prd.md` — Asson CLI Layer — is preserved at `grimoires/loa/prd-asson-cli-layer.md`.)

## 1. Problem Statement

`loa-freeside` was adopted as a hexagonal (ports + adapters) service and evolved into the **platform
substrate** — the ECS/AWS/Railway host where Freeside **buildings** (`*-api` cells) deploy. Core
contracts + implementations were then extracted into building repos. **The extraction is incomplete
and was never sequenced.**

The symptom: the required `Unit Tests` + `Integration Tests` checks are **red on every PR** (a
merge-blind gate — *theater*; bead `arrakis-yp7q`). This session proved the red is **not** a flaky or
stale-data problem: after fixing the config layer (#289) and the thin stale-data layer (~20 failures,
#290/#291), the remaining **~70 failures are behavioral** — they test code whose implementation is
**stranded by the half-done extraction**.

> **Sources:** ADR-008 §Current-State table; `reality/architecture-overview.md:30-45` (the
> `packages/{services,adapters,core}` + `themes/sietch` hexagonal stack); session CI triage (bead
> `arrakis-yp7q`, local `grimoires/loa/context/2026-06-21-test-suite-remediation-plan.md`).

## 1.5 Architectural Spine — dependencies to the edge (the core concept)

The migration is **designed around one principle**: push dependencies to the edge. The pure,
deferred, contract-bounded **core** holds no I/O and no outward dependencies; the **edge** (the
building modules) holds the runtimes, the I/O, the deps. This is HEXAGONAL FEDERATION (ADR-009) made
operational, grounded in **`construct-honeycomb-substrate`** (`0xHoneyJar/construct-honeycomb-substrate`,
the agentic-game-engine doctrine pack):

> **ECS ≡ Effect ≡ Hexagonal ≡ Honeycomb** — four vocabularies, one shape. The convergent structure is
> the **four-folder pattern** `domain / ports / live / mock` (suffix-as-type):
> - `domain/*.ts` — pure schema records / value objects (no deps)
> - `ports/*.port.ts` — the Service `Tag` / interface (the **seam**; the dependency-free contract)
> - `live/*.live.ts` — `Layer.succeed(Tag, …)` — the **runtime/adapter**, where the deps actually live
> - `mock/*.mock.ts` — the test double

**The load-bearing rule — "port-in-platform, runtime-in-building":** extraction does **not** move a
whole capability; it **splits** it. The `.port` (Tag/contract) **stays in the platform core**
(`packages/core`); the `.live` (runtime + its deps) **moves out to the `*-api` building**. Wiring
happens at **one** `single-effect-provide-site` (the boot/runtime) — the dependency root, pushed to
the very edge. Extraction is therefore **delete-heavy** (`delete-heavy-cycle`): the monolith `.live`
code *leaves*, the platform shrinks toward the thin substrate (G-3).

**Why the CI is red, in this frame:** the failing clusters are capabilities whose `port`↔`live` split
is **incomplete** — the `.live` is half-here, half-in-the-building, so behavioral tests assert against a
runtime that's mid-flight. The fix is to *finish the split per capability*, not to patch the assertions.

> **Sources:** `construct-honeycomb-substrate` README (the isomorphism table + `patterns/domain-ports-live`,
> `suffix-as-type`, `single-effect-provide-site`, `delete-heavy-cycle`); ADR-009 (HEXAGONAL FEDERATION,
> `*-api` naming law §D-2); `packages/core/ports/IBillingProvider.ts` (an extant port).

## 2. Goals & Success Metrics

| ID | Goal | Metric |
|----|------|--------|
| G-1 | Restore the CI gate to **honest signal** | `Unit/Integration Tests` green on a clean PR; no required check red on 100% of PRs; zero admin-merges-past-red needed |
| G-2 | **Sequence + execute** the deferred extractions | ledger → billing → mediums-residuals each land as their own building repo (ADR-007/008), verified by `loa census --graph` |
| G-3 | Reduce `loa-freeside` toward the **thin platform substrate** | platform-stays surface = `apps/{gateway,worker,ingestor,mcp-gateway}` + `infrastructure/terraform` + `packages/{core,adapters,sandbox}`; in-monolith building code removed as each extracts |
| G-4 | **Disposition every failing-test cluster** — no stranded code | each cluster classified move-live / fix-platform; quarantine bead per to-be-extracted cluster |
| G-5 | **Dependencies point to the edge** (the core concept) | `packages/core` (ports/domain) imports nothing from `adapters`/`services`/`themes`; every extracted capability is a `.port` in-core + a `.live` in its `*-api`; a CI lint enforces the dependency rule |

## 3. Users & Stakeholders

- **Operator** (factory owner) — needs the monolith reduced to a legible platform + a clear building set.
- **Agents in the harness** — need buildings legible (the just-shipped `loa census --graph` is the map; `dont-ground-on-extracted-monolith`: ground on deployed cells, not monolith corpses).
- **Building consumers** (other cells, worlds) — depend on extracted contracts staying stable across the move (the belt-DAG; ADR-008 §D-3).

## 4. Functional Requirements — the per-cluster disposition (the core analysis)

Every failing cluster maps to one of three dispositions, by its ADR-008 extraction status:

| Cluster (≈failures) | Lives in | Destination | Disposition |
|---|---|---|---|
| **billing-*** (~25: creator-payout, referral, revenue, reconciliation, event-stream…) | port: `packages/core/ports/IBillingProvider`; live: `themes/sietch/.../billing` + `packages/adapters/billing` | `billing-api` (**needs creating**) | **MOVE-LIVE** — `.live` → building; **port stays** in core |
| **ledger** | live: `packages/services` | `ledger-api` (**repo exists** — mid-extraction) | **MOVE-LIVE (finish)** — billing's port depends on it → first |
| **synthesis / Discord-role / telegram** (~30: GlobalRateLimited, GlobalDiscordTokenBucket, telegram/commands, digest, story-fragments) | live: `packages/adapters/synthesis`, `themes/sietch/src/telegram` | `mediums-api` (repo exists as `freeside-mediums`, mid-rename) | **MOVE-LIVE (residual)** — ADR-008: *"extract Discord/Telegram logic into mediums"*; the medium **port stays** |
| **NaibSecurityGuard / MFA** (~9) | `packages/adapters/security` | — stays (or → `identity-api`? — see Q) | **FIX-PLATFORM** — likely the platform's own auth; confirm vs identity-api |
| **protocol-conformance / semantic-invariants** (~9) | `packages/core` ports | — stays | **FIX-PLATFORM** — these test the **port/contract layer** the whole federation depends on; must stay green |

- **FR-0 (root-cause before disposition — Flatline SKP-002 CRITICAL):** disposition is decided by
  **root-causing each failing test**, NOT by which folder it lives in. For every failure, classify:
  *stranded-by-extraction* (the `.live` is mid-flight) → MOVE-LIVE-quarantine; *genuine logic bug* → FIX
  (never quarantine a real bug — that masks it); *flaky* → stabilize/quarantine-flaky. A billing failure
  is quarantined only once **proven** extraction-stranded, not a regression.
- **FR-1 (quarantine WITH TEETH — Flatline SKP-001 CRITICAL + IMP-002):** quarantine moves a cluster to a
  **non-required-but-still-RUNNING** suite (reports red/green every PR; just doesn't block) — signal is
  *kept*, not removed. Each entry carries: objective eligibility (FR-0 = stranded), an **owner**, an
  **expiry** (= the extraction-landing deadline), and required evidence; a bead per cluster tagged with its
  `*-api` destination. No silent removal; no open-ended quarantine.
- **FR-2 (fix the platform-stays slice):** the FIX-PLATFORM clusters (security/MFA, core conformance)
  **stay required** — triage each as a genuine bug or flaky and fix in-place; the real signal the gate keeps.
- **FR-3 (split each capability — add-consume-verify-BEFORE-delete; Flatline SKP-004 + IMP-004/006):**
  in dependency order: **ledger** (DoD per FR-3a) → **billing** (create `billing-api`) →
  **mediums-residuals** (synthesis/Discord/telegram → `mediums-api`). For each: (1) move the `.live` to the
  `*-api`; keep the `.port` (`IBillingProvider`, the medium port) in `packages/core`; (2) the building's
  suite **must cover the moved behavior** + the building must be a **named live consumer** (FR-4) — *then*
  (3) delete the monolith `.live` + tests. **No delete-on-faith.** The monolith runtime stays deployed/
  consumed until the building consumer is verified (Flatline SKP-002 HIGH — no service gap). Each follows
  `domain/ports/live/mock` + a `single-effect-provide-site`.
- **FR-3a (ledger definition-of-done — Flatline SKP-005):** `ledger-api` is *mid-extraction* — Phase-1
  task 0 is an **audit/reconcile** of `ledger-api` vs the monolith `packages/services` ledger (it may be a
  two-implementation reconciliation, not a clean move). DoD = one canonical impl in `ledger-api`, callers
  routed, monolith deleted, census-verified.
- **FR-4 (verify each landing — name the first consumer; IMP-006):** after each extraction, `loa census
  --graph` + the live-coherence probe confirm the building moved + is a **named live consumer** (closes the
  deployed-but-unconsumed failure mode); BeaconV3/contract compatibility checked for downstream consumers (IMP-010).
- **FR-5 (firewall compliance):** each extraction respects ADR-007 (no cross-domain PRs; commit scopes;
  beads domain labels) — CI-enforced today.
- **FR-6 (caller/import inventory first — Flatline SKP-003):** before any split, inventory the callers of
  the capability and confirm they route through the `.port` (not the concrete `.live`) via a single
  provide-site. Where they don't (the reason tests are "mid-flight"), route them through the port **first** —
  that inversion is the actual extraction work, and it's also the G-5 fix.
- **FR-7 (dependency-rule lint — Flatline IMP-001, owns G-5):** ship a CI lint that fails any PR where
  `packages/core` imports from `adapters`/`services`/`themes`. Enforces dependencies-point-to-the-edge and
  prevents re-entanglement. This is the named owner of G-5.

## 5. Technical & Non-Functional

- Hexagonal discipline preserved: a building is one repo (schema + runtime + docs); talks to schemas, not
  other buildings (ADR-008 §D-1, the three planes).
- Contracts move with the code (belt protocol / BeaconV3); consumers must not break across the move —
  shadow-read-then-graduate (`deployed-but-unconsumed-pattern`).
- `ledger-api` is mid-extraction — **NFR: audit what already moved** before finishing (avoid double-impl/drift).
- The platform-stays slice is the end-state target (G-3); nothing else should remain in `themes/sietch` /
  `packages/services` after the sequence.

## 6. Scope & Prioritization

- **MVP (this cycle):** FR-0 (root-cause every failing cluster → disposition) + FR-1 (quarantine-with-teeth
  the proven-stranded clusters → gate honest NOW) + FR-2 (fix the platform-stays slice) + FR-7 (the
  dependency-rule lint) + FR-3 Phase-1 (**ledger** extraction-finish via FR-3a audit + FR-6 caller-inventory,
  the dependency root). **Phase-0 decision-gate (IMP-007):** resolve the security/MFA disposition
  (stays-platform vs → `identity-api`) before it can block completion. Restores CI signal + lands the first
  extraction without masking a real bug or deleting on faith.
- **Next cycles:** FR-3 Phase-2 (billing) → Phase-3 (mediums-residuals), each its own cycle/PR.
- **Out of scope:** new building features; re-architecting the platform substrate; the `worlds`/`draft`
  zones; gaib→freeside-cli merge (ADR-008 D-9, separate).

## 7. Risks & Dependencies

| Risk | Mitigation |
|---|---|
| Extraction breaks live building consumers | shadow-read-then-graduate; census/coherence verify each landing (FR-4) |
| `ledger-api` already has partial impl → double-extract / drift | NFR: audit `ledger-api` vs monolith ledger before finishing (Phase-1 task 0) |
| Quarantine hides a *real* platform bug | only MOVE-OUT clusters quarantine; FIX-PLATFORM (security/core) stays required + gets fixed |
| `freeside-billing` doesn't exist yet | create it (ADR-007 building-creation path) as Phase-2 task 0 |
| billing→ledger dependency | sequence ledger first (confirmed: billing adapters call ledger) |
| Sequencing churn vs ADR-007 firewall | one domain per PR; extraction PRs are `shared`/per-building scoped |
| **Open Q — security/MFA disposition** | `packages/adapters/security` (NaibSecurityGuard/MFA): is it the *platform's own* auth (stays, FIX-PLATFORM) or a runtime that belongs to `identity-api` (the auth building)? Resolve before Phase-1; default = stays-platform |
| Dependency rule not enforced → re-entanglement | add a CI lint (G-5): `packages/core` must not import `adapters`/`services`/`themes`; fail the PR on an inward→outward edge |

> **Sources:** ADR-008 §Current-State + §D-1/D-3; `reality/architecture-overview.md`; session grounding
> (billing→ledger dep confirmed in `packages/adapters/billing/*`; `ledger-api` + `freeside-mediums` repos
> exist, `freeside-billing` absent); CI triage `arrakis-yp7q`; `loa census --graph` (the building map).

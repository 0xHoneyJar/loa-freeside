# Sprint Plan — Extraction Migration · Sprint 1 (MVP)

> **PRD:** `grimoires/loa/prd.md` (9 FRs) · **SDD:** `grimoires/loa/sdd.md` (Flatline-hardened) ·
> **Goal:** restore CI to honest signal + land the first extraction (ledger), without masking a real bug.
> Verify harness: docker Redis + seeded env (`grimoires/loa/context/2026-06-21-test-suite-remediation-plan.md`).
> Date: 2026-06-21. (Prior `sprint.md` — Asson — preserved at `sprint-prev-asson.md`.)

## Acceptance criteria (sprint-level)
- `Unit/Integration Tests` go **honestly green** on a clean PR (real bugs fixed or filed; only proven-STRANDED
  quarantined) — **no admin-merge-past-red needed**.
- The dependency-rule lint (G-5) is a required check and green on `packages/core`.
- The ledger split lands: `ledger-api` is the parity-proven single impl + a named live consumer; monolith
  ledger `.live` + tests deleted.

## Sprint 1: CI honesty + ledger parity audit (T1–T6, autonomous)

> The non-mutating work: root-cause + manifest, security disposition, dep-lint, quarantine-with-teeth,
> fix the platform slice, and the ledger caller-inventory + **parity PROOF** (read-only; HALTS on mismatch,
> never mutates the write path). Safe to run autonomously.

### T1 · FR-0 + §2.3a — root-cause every failing cluster → executable extraction manifest  `domain:shared`
- Run the ~70 failures 3× (docker Redis + seeded env); classify each **BUG-first** (FR-0 predicate order):
  BUG → FIX-list; FLAKY → stabilize-list; STRANDED → quarantine-list.
- Produce `tools/extraction/extraction-manifest.yaml` (the SoT: per capability `{name, port, live_paths[],
  destination, phase, port_routed, consumer_verified, status}`) + the per-test classification with evidence.
- **AC:** every failing test has a recorded {BUG|FLAKY|STRANDED} + evidence (3-run output); manifest validates;
  no test is STRANDED if it asserts a conservation/auth/balance invariant.
- **Verify:** `node tools/extraction/validate-manifest.mjs` exits 0; classification count = failure count.

### T2 · Phase-0 decision-gate — resolve security/MFA disposition  `domain:shared`  *(blocks completion if open)*
- Decide via **caller-inventory AND a threat-model/compliance review** (Flatline SKP-006 — inventory alone
  can miss security obligations): does it serve the platform's own auth or an identity-runtime concern?
  Record the decision (stays-platform default vs → `identity-api`) + the threat-model note in the manifest.
- **AC:** security/MFA disposition recorded with rationale + threat-model/compliance note; NaibSecurityGuard
  tests routed to FIX-PLATFORM or the identity-api backlog accordingly. Until decided, its tests stay **required**.

### T3 · FR-7 — dependency-rule lint (owns G-5)  `domain:platform`
- (a) eslint `no-restricted-imports` on `packages/core/**` forbidding `adapters|services|themes`; (b)
  `tools/lint/dep-rule.sh` (authoritative CI gate); wire into `pr-validation.yml` as **required**.
- **AC:** lint **fails** on a planted `packages/core` → `adapters` import; **green** on current core (or the
  pre-existing violations are filed + allowlisted with a removal bead); required check active.

### T4 · FR-1 — quarantine-with-teeth + active surfacing  `domain:platform`
- Add the `quarantine` vitest project; required `Unit/Integration` exclude manifest STRANDED files; the
  `quarantine` job runs+reports. `tools/quarantine/gate.sh` (**required** check): fail on past-`expiry`,
  missing owner/evidence, or a **new** assertion signature ≠ recorded `stranded_signature`. PR-comment digest.
- **AC:** required CI is honestly green with only proven-STRANDED excluded; the quarantine job reports + posts
  the digest; the gate fails a fixture entry that is expired / mis-owned / regressed. **Anti-masking proof
  (Flatline SKP-003):** a planted conservation/auth/balance regression inserted into a quarantined test MUST
  be caught by the gate (signature-change detection) — verified with a fixture; the manifest validator
  (schema + behavior, Flatline SKP-001) is specified + tested as part of this task.

### T5 · FR-2 — fix the platform-stays slice (the BUG-classified)  `domain:platform`
- Fix (or file as real bugs) the FIX-PLATFORM failures from T1 (security/MFA real ones, protocol-conformance,
  semantic-invariants). These stay **required**.
- **AC:** each platform-stays failure passes or has a filed bug bead with a repro; none are quarantined.

### T6 · FR-6 + FR-3a — ledger caller-inventory + **full-behavior** parity proof  `domain:shared`
- Caller-inventory the ledger; route direct importers through `ILedger` (`packages/core/ports`). Audit
  `ledger-api` vs monolith `packages/services` ledger via **golden-dataset replay** that proves equivalence
  across **balance-conservation AND idempotency, operation ordering, concurrency, retries, partial-failure,
  and persistence semantics** (Flatline SKP-008 — not balance alone). Name the canonical persistence owner;
  define the **abort/escalation** path.
- **AC:** the full-behavior parity suite passes (or extraction **halts**+escalates on ANY mismatch — never
  proceed on mismatch); callers route through `ILedger`; persistence owner + the parity report documented.

## Sprint 2: Ledger write-path swap — OPERATOR-GATED (financial-critical)

> The actual write-path mutation. **Held for explicit operator go** — not run by the Sprint-1 autonomous
> pass. Single-writer cutover; only after T6's full-behavior parity proof passes.

### T7 · FR-3 — ledger provide-site swap + verify (**no delete this sprint**; Flatline SKP-009/010)  `domain:shared`
- Swap the ledger `Layer.succeed` monolith → `ledger-api` with **single-writer cutover** (Flatline SKP-009 —
  one writer at a time; **no dual-write/split-brain**): the monolith is read-fallback only during the window;
  `ledger-api` is the sole writer post-flip; rollback = atomic provide-site flip back. Verify `ledger-api`
  covers the behavior + is a **named live consumer** with a non-zero consumed edge (`loa census --graph` + probe).
- **AC:** `census --graph` shows `ledger-api` consumed (non-zero edge); single-writer invariant holds (no
  dual-write); rollback rehearsed; CI green. **Monolith ledger `.live` stays deployed (fallback) — its delete
  is a deferred task (T8, next sprint) after sustained verification.**

### T8 · (deferred to Sprint 2) ledger cleanup — delete monolith `.live` + tests after sustained verification
- After `ledger-api` is proven load-bearing over a soak window, delete the monolith ledger `.live` + tests +
  remove their quarantine entries. Split from T7 so migrate/verify/cleanup are not one risky step (SKP-010).

## Dependencies
T1 → (T2, T3, T4, T5) in parallel; T6 depends on T1+T2; T7 depends on T6. T4 depends on T1's manifest.

## Out of scope (next sprints)
billing extraction (create `billing-api`); mediums-residuals (`mediums-api`); the worlds/draft zones.

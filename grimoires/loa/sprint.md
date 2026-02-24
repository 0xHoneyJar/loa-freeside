# Sprint Plan: The Naming — Engineering Excellence & Protocol Identity

**Cycle:** cycle-040
**PRD:** v1.1.0 (GPT-APPROVED)
**SDD:** v1.1.0 (GPT-APPROVED, iteration 4)
**Date:** 2026-02-24
**Sprints:** 3 (global IDs 349–351)

---

## Sprint Overview

This cycle addresses six Bridgebuilder recommendations from cycle-039's kaironic convergence. The work is primarily specification, documentation, and lightweight code (~18 files). Sprints are organized by PRD priority (P0 first) with independent FRs grouped for efficiency.

| Sprint | FRs | Focus | Files |
|--------|-----|-------|-------|
| Sprint 1 | FR-6, FR-1 | Protocol naming + graduation criteria (P0) | ~7 files |
| Sprint 2 | FR-3, FR-4 | Gateway schema + config strategy (P1) | ~8 files |
| Sprint 3 | FR-2, FR-5 | Contract testing + ceremony (P1/P2) | ~7 files |

---

## Sprint 1: Protocol Naming & Graduation Criteria (P0)

**Goal:** Name the protocol and define shadow-to-enforce graduation criteria.

**Rationale:** FR-6 (naming) is pure documentation and must be done first so other artifacts can reference the protocol name. FR-1 (graduation) is the highest-impact engineering deliverable — defining when shadow mode graduates to enforce.

### Task 1.1: Choose Protocol Name and Propagate (FR-6)

**Description:** Present the 3 proposed names (Loa Economic Protocol, Conviction Protocol, Commons Protocol) to the user via `AskUserQuestion`. If user does not respond within the implementation session, default to **Commons Protocol** (best alignment with Ostrom governance heritage in the codebase). Update documentation with the chosen name.

**Decision mechanism:** `AskUserQuestion` tool during `/implement sprint-1`. The chosen name is propagated as a string constant in all downstream artifacts — no separate file needed since it appears in exactly 3 locations.

**Files:**
- `README.md` — Update "What is Freeside?" section (AC-6.2)
- `BUTTERFREEZONE.md` — Update purpose/summary line (AC-6.3)
- `themes/sietch/src/packages/core/protocol/index.ts` — Update module doc comment (AC-6.4)

**Acceptance Criteria:**
- [ ] Protocol name chosen (via user input or fallback default) and documented (AC-6.1)
- [ ] README.md references protocol by name (AC-6.2)
- [ ] BUTTERFREEZONE.md includes protocol name (AC-6.3)
- [ ] Protocol barrel module doc references name (AC-6.4)
- [ ] Name is not a Dune reference (AC-6.5)

### Task 1.2: Create Graduation Type and Evaluator (FR-1)

**Description:** Implement `BoundaryGraduationCriteria` type and `evaluateGraduation()` function using BigInt PPM arithmetic per SDD §3.1.

**Files:**
- `themes/sietch/src/packages/core/protocol/graduation.ts` — New file with type, constants, evaluator function
- `themes/sietch/src/packages/core/protocol/index.ts` — Add re-exports for graduation module

**Acceptance Criteria:**
- [ ] `BoundaryGraduationCriteria` type defined with three thresholds (AC-1.2)
- [ ] `evaluateGraduation()` uses BigInt PPM arithmetic — no Number conversion (SDD §3.1.2)
- [ ] Default thresholds: 0.1% divergence (1000 PPM), 7-day observation, 72h consecutive clean (AC-1.1)
- [ ] Zero-traffic rule: when `shadowTotal === 0n`, divergence criterion is vacuously met (no data to diverge), but observation window and consecutive-clean window criteria still apply (time must elapse regardless of traffic volume)
- [ ] Existing metrics (`shadowTotal`, `wouldRejectTotal`, `divergenceTotal`) are sufficient — no new counters (AC-1.3)
- [ ] Graduation module exported from protocol barrel

### Task 1.3: Create Graduation Unit Tests (FR-1)

**Description:** Write unit tests for `evaluateGraduation()` covering all threshold combinations.

**Files:**
- `themes/sietch/src/packages/core/protocol/__tests__/graduation.test.ts` — New test file

**Acceptance Criteria:**
- [ ] Test: returns `ready: false` when divergence rate exceeds threshold
- [ ] Test: returns `ready: false` when observation window insufficient
- [ ] Test: returns `ready: false` when wouldRejectTotal > 0 within consecutive window
- [ ] Test: returns `ready: true` when all three criteria met
- [ ] Test: BigInt precision preserved (no Number overflow) for large counter values (AC-1.5)
- [ ] Test: when `shadowTotal === 0n`, divergence is vacuously met but `ready` is still `false` if observation window or consecutive-clean window criteria are not met (time gates still apply)

### Task 1.4: Wire Graduation into Metrics Emission and Expose Gauge (FR-1)

**Description:** Integrate `evaluateGraduation()` into the existing metrics emission path where `shadowTotal`/`wouldRejectTotal`/`divergenceTotal` are already incremented. Add `boundary_graduation_ready` Prometheus gauge. Extend `boundary-mode-toggle.test.ts` with graduation assertions.

**Integration point:** Identify the module that currently increments shadow metrics (the `parseBoundaryMicroUsd` metrics emitter) and call `evaluateGraduation()` on the same cadence to update the gauge. Also track `lastWouldRejectTimestamp` as an in-memory `Date.now()` updated when `wouldRejectTotal` increments.

**Files:**
- `themes/sietch/src/packages/core/protocol/graduation.ts` — Add gauge registration helper
- `themes/sietch/src/packages/core/protocol/parse-boundary-micro-usd.ts` — Wire `evaluateGraduation()` call + `lastWouldRejectTimestamp` tracking into existing metrics path
- Existing boundary mode test — Extend with graduation criteria assertions (AC-1.5)

**Acceptance Criteria:**
- [ ] Prometheus gauge `boundary_graduation_ready{context}` emits 0 or 1 (AC-1.4)
- [ ] Gauge updates on the same cadence as existing shadow metrics — not a separate loop
- [ ] `lastWouldRejectTimestamp` tracked in-memory, updated when `wouldRejectTotal` increments
- [ ] Gauge is protected by existing metrics port (internal-only, not tenant-accessible)
- [ ] Integration test: gauge transitions from 0→1 under simulated-ready state
- [ ] Mode-toggle tests reference graduation criteria (AC-1.5)

---

## Sprint 2: Gateway Schema & Config Strategy (P1)

**Goal:** Add schema-level micro-USD validation at the API gateway and formalize the cold-restart config strategy.

**Rationale:** FR-3 and FR-4 are independent of each other but both modify the protocol/config layer. Grouping them keeps the scope tight. FR-3 depends on the naming from Sprint 1 only for comments.

### Task 2.1: Create Mode-Aware Zod Micro-USD Schema (FR-3)

**Description:** Implement `createMicroUsdSchema()` per SDD §3.3. Legacy/shadow mode accepts BigInt-permissive inputs; enforce mode applies canonical validation with `MAX_SAFE_MICRO_USD` bound.

**Files:**
- `themes/sietch/src/packages/core/protocol/micro-usd-schema.ts` — New file
- `themes/sietch/src/packages/core/protocol/index.ts` — Add re-exports

**Acceptance Criteria:**
- [ ] Shared Zod schema with two modes: legacy (BigInt-permissive) and canonical (strict) (AC-3.1)
- [ ] Mode driven by `resolveParseMode()` from `parse-boundary-micro-usd.ts` (AC-3.2)
- [ ] Schema calls `resolveParseMode()`, NOT `process.env` directly (SDD §3.3.2)
- [ ] Canonical mode uses `CANONICAL_MICRO_USD_PATTERN` regex + `MAX_SAFE_MICRO_USD` BigInt bound
- [ ] Schema exported from protocol barrel
- [ ] FR-3/FR-4 coordination: schema mode is fixed at process start via `resolveParseMode()` module-level cache, consistent with cold-restart constraint (SDD §3.4). Add a test asserting `createMicroUsdSchema()` mode matches `resolveParseMode()` under controlled env setup

### Task 2.2: Inventory and Integrate Schema into API Routes (FR-3)

**Description:** First, inventory all micro-USD entry points by grepping for `parseBoundaryMicroUsd` and `parseMicroUsd` call sites to identify every route that accepts micro-USD user input. Then apply `createMicroUsdSchema()` to each identified route per SDD §3.3.3. Include the inventory checklist in the PR description.

**Inventory step:** `grep -r 'parseBoundaryMicroUsd\|parseMicroUsd' themes/sietch/src/ --include='*.ts' -l` to find all call sites. Classify each as user-facing (needs schema) or internal-only (skip with justification).

**Files (expected, subject to inventory):**
- `billing-routes.ts` — `amount_micro` body field
- `transfer.routes.ts` — transfer amounts
- `credit-pack-routes.ts` — credit pack amounts
- `spending-visibility.ts` — spending query parameters

**Acceptance Criteria:**
- [ ] Inventory: all `parseBoundaryMicroUsd`/`parseMicroUsd` call sites identified and classified as user-facing or internal-only
- [ ] All user-facing routes use `createMicroUsdSchema()` in request validation
- [ ] Internal-only call sites explicitly justified as not needing gateway schema (e.g., DB mappers, Redis cache readers)
- [ ] Invalid inputs return 400 with `MicroUsdValidationError` before reaching boundary parser (AC-3.3)
- [ ] In enforce mode, gateway is equal-or-tighter than `parseBoundaryMicroUsd` (AC-3.4)
- [ ] In legacy/shadow mode, gateway does NOT reject currently accepted inputs (AC-3.5, NFR-3)

### Task 2.3: Create Micro-USD Schema Unit Tests (FR-3)

**Description:** Test both schema modes against the SDD §5.2 test matrix.

**Files:**
- `themes/sietch/src/packages/core/protocol/__tests__/micro-usd-schema.test.ts` — New test file

**Acceptance Criteria:**
- [ ] Canonical mode: accepts "100", "0", MAX_SAFE_MICRO_USD; rejects leading zeros, whitespace, plus sign, negative, decimal, empty, non-numeric, MAX+1 (AC-3.6)
- [ ] Legacy mode: accepts "100", "0100", " 100", "+100", "-100"; rejects "100.5", "", "abc" (AC-3.6)
- [ ] Both modes synchronized via `resolveParseMode()` (AC-3.2)

### Task 2.4: Add Config Doc Comment and Fingerprint (FR-4)

**Description:** Document cold-restart constraint in `config.ts` and add startup config fingerprint per SDD §3.4.

**Files:**
- `themes/sietch/src/config.ts` — Add module doc comment + `emitConfigFingerprint()` function

**Acceptance Criteria:**
- [ ] Module doc comment states cold-restart constraint (AC-4.3)
- [ ] Startup log emits config fingerprint hash (AC-4.4)
- [ ] Fingerprint hashes config keys (not values — values may contain secrets)
- [ ] Behavior fingerprint includes `PARSE_MICRO_USD_MODE` and feature flags
- [ ] Runtime-evaluable flags enumerated (currently none) (AC-4.5)

### Task 2.5: Create Config Fingerprint Test (FR-4)

**Description:** Verify fingerprint emission at startup. Test approach: refactor `emitConfigFingerprint()` to accept an injected logger (default: the real logger), then test deterministically by passing a mock logger and asserting the structured log fields.

**Files:**
- `themes/sietch/src/__tests__/config-fingerprint.test.ts` — New test file

**Acceptance Criteria:**
- [ ] `emitConfigFingerprint()` accepts an injected logger parameter for testability
- [ ] Test: fingerprint emitted on config load (mock logger captures structured log with `configFingerprint` and `behaviorFingerprint` fields)
- [ ] Test: fingerprint changes when behavior-affecting env vars change (set `PARSE_MICRO_USD_MODE` to different values, compare hashes)
- [ ] Test: fingerprint does NOT leak secret values (assert no `JWT_SECRET`, `DATABASE_URL`, etc. in log output)

---

## Sprint 3: Contract Testing & Ceremony (P1/P2)

**Goal:** Establish consumer-driven contract testing and execute the inaugural post-merge ceremony.

**Rationale:** FR-2 (contract testing) is the most complex specification work but is P2 — independent of the other deliverables. FR-5 (ceremony) is pure documentation and pairs well since both produce artifacts in new directories.

### Task 3.1: Create Contract Specification (FR-2)

**Description:** Create `spec/contracts/` directory with `contract.json` pinning entrypoints and conformance vector behavioral contract per SDD §3.2.

**Files:**
- `spec/contracts/contract.json` — New: entrypoints + conformance vectors bundle spec
- `spec/contracts/vectors-bundle.sha256` — New: computed hash of `spec/vectors/*.json`

**Acceptance Criteria:**
- [ ] Contract JSON pins exact module entrypoints and function signatures (AC-2.1, AC-2.4)
- [ ] Conformance vector bundle hash computed from `spec/vectors/*.json` (AC-2.2)
- [ ] Counts are informational metadata only, not gating criteria (AC-2.7)
- [ ] Contract placed in `spec/contracts/` directory (AC-2.3)
- [ ] Provider version range >=7.9.2 — sourced from the installed `@0xhoneyjar/loa-hounfour` version in `package.json` (the range is a semver floor, validated by Task 3.4 against the actual installed version)

### Task 3.2: Create Validation Script (FR-2)

**Description:** Implement `validate.mjs` ESM validation script per SDD §3.2.4.

**Files:**
- `spec/contracts/validate.mjs` — New: ESM validation script using dynamic import()

**Acceptance Criteria:**
- [ ] Uses `import()` for ESM compatibility — not `require()` (SDD §3.2.4)
- [ ] Validates entrypoint availability by importing each specifier
- [ ] Optional `--run-vectors` flag for consumer CI (AC-2.5)
- [ ] `--repo-root` argument for vector run context resolution
- [ ] Provider CI: entrypoint checks only; Consumer CI: entrypoints + vectors

### Task 3.3: Create Contract README (FR-2)

**Description:** Document how hounfour's CI would consume the contract.

**Files:**
- `spec/contracts/README.md` — New: hounfour CI consumption instructions

**Acceptance Criteria:**
- [ ] Documents what the contract covers (AC-2.6)
- [ ] Documents how to run validation in hounfour CI
- [ ] Documents how to update contract when imports change
- [ ] Documents what happens when contract breaks

### Task 3.4: Create Contract Verification Test and Wire into CI (FR-2)

**Description:** Test that `contract.json` entrypoints match actual protocol barrel exports. Wire the test into the existing test suite so CI catches barrel drift automatically.

**Files:**
- `spec/contracts/__tests__/contract-spec.test.ts` — New test file
- `package.json` or vitest config — Ensure `spec/contracts/__tests__/` is included in test discovery

**Acceptance Criteria:**
- [ ] Test: all contract entrypoint symbols exist in actual barrel exports
- [ ] Test: contract version is valid semver
- [ ] Test: provider version range floor matches or is below installed `@0xhoneyjar/loa-hounfour` version
- [ ] Test: vectors bundle hash matches computed hash from `spec/vectors/*.json`
- [ ] CI integration: `spec/contracts/__tests__/` included in standard `pnpm test` run — CI fails if an entrypoint is removed/renamed or vectors hash changes without updating the contract
- [ ] Catches barrel drift in CI automatically

### Task 3.5: Create Ceremony Spec and Inaugural Artifact (FR-5)

**Description:** Create ceremony specification and execute inaugural ceremony for cycle-039 merge (PR #94).

**Files:**
- `grimoires/loa/ceremonies/README.md` — New: ceremony spec (trigger, format, participants)
- `grimoires/loa/ceremonies/2026-02-24-cycle-039-protocol-convergence.md` — New: inaugural ceremony artifact

**Acceptance Criteria:**
- [ ] Ceremony spec documented (format, participants, outputs, trigger) (AC-5.1)
- [ ] Inaugural ceremony covers: what was built, why it matters, identity change, remaining questions (AC-5.2, AC-5.5)
- [ ] Ceremony triggered by significant cycle merges, not every PR (AC-5.3)
- [ ] Inaugural instance executed for cycle-039/PR #94 (AC-5.4)
- [ ] Ceremony references protocol name from Sprint 1 (AC-5.5)

---

## Dependencies

```
Sprint 1 (FR-6 naming + FR-1 graduation) → no dependencies
Sprint 2 (FR-3 schema + FR-4 config)     → Sprint 1 (for protocol name in comments)
Sprint 3 (FR-2 contract + FR-5 ceremony)  → Sprint 1 (protocol name for ceremony)
```

Sprint 2 and Sprint 3 are independent of each other (could theoretically run in parallel).

---

## NFR Compliance

| NFR | How Addressed |
|-----|---------------|
| NFR-1 Zero Regression | No existing tests modified; all new files/tests are additive |
| NFR-2 Documentation-First | FR-1, FR-4, FR-5, FR-6 produce verifiable documentation artifacts |
| NFR-3 Backward Compatibility | FR-3 schema uses BigInt-permissive in legacy/shadow mode — identical to current behavior |
| NFR-4 Observability | FR-1 adds Prometheus gauge from existing metrics; FR-4 adds config fingerprint log |

---

## Success Criteria (from PRD §8)

| Criterion | Sprint | Task |
|-----------|--------|------|
| SDD contains graduation criteria with three measurable thresholds | Sprint 1 | 1.2 |
| Contract testing spec exists in `spec/contracts/` | Sprint 3 | 3.1–3.4 |
| API routes validate micro-USD inputs at schema level | Sprint 2 | 2.1–2.3 |
| Config caching strategy documented and enforced | Sprint 2 | 2.4–2.5 |
| Inaugural ceremony executed for PR #94 | Sprint 3 | 3.5 |
| Protocol has a name in README, BUTTERFREEZONE, barrel | Sprint 1 | 1.1 |

**Meta-criterion:** The Bridgebuilder, if re-run, would find zero of its six original recommendations still unaddressed.

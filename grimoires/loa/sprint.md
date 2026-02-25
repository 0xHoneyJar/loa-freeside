# Sprint Plan: The Sietch Opening — E2E Validation & Test Community Launch

**Version:** 1.1.0
**Cycle:** cycle-042
**Date:** 2026-02-25
**PRD:** v1.2.0 (GPT-APPROVED, Flatline integrated)
**SDD:** v1.4.0 (GPT-APPROVED, Flatline integrated)
**Sprints:** 3 (global IDs 355–357)

---

## Sprint Overview

This cycle writes **zero new application logic**. All work is test infrastructure, CI pipelines, documentation, and vitest configuration. Sprints are sequenced so test isolation (Sprint 1) enables E2E validation (Sprint 2), which enables documentation and CI (Sprint 3).

| Sprint | FRs | Focus | Estimated Files | Duration |
|--------|-----|-------|----------------|----------|
| Sprint 1 | FR-2 | Redis test isolation — vitest workspace + reclassification spike | ~25 files | 2–3 days |
| Sprint 2 | FR-1, FR-6, NFR-5 | E2E runner + JWKS validation + economic loop | ~8 files | 2 days |
| Sprint 3 | FR-3, FR-4, FR-5, FR-7 | Documentation + CI pipeline | ~8 files | 1–2 days |

**Total estimated duration:** 5–7 working days (single engineer).

---

## Sprint 1: Redis Test Isolation

**Global Sprint ID:** 355
**Goal:** Fix the 202 ECONNREFUSED failures by splitting unit and integration tests via vitest workspace projects.
**Priority:** P0
**Dependencies:** None (foundational — enables all other sprints)

### Task 1.1: Vitest Workspace Configuration (SDD §3.2)

**Description:** Create `themes/sietch/vitest.workspace.ts` with `unit` and `integration` project definitions. Update `themes/sietch/package.json` with `test:unit`, `test:integration`, and `test:e2e` scripts. Ensure `pnpm test` defaults to `test:unit`.

**Acceptance Criteria:**
- AC-2.1 (partial): `vitest.workspace.ts` exists with `unit` (includes `*.test.ts`, excludes `*.integration.test.ts`), `integration` (includes `*.integration.test.ts`), and `e2e` (includes `*.e2e.test.ts`, root `tests/e2e/`) projects
- AC-2.4: `pnpm test` maps to `pnpm test:unit` — `vitest run --workspace vitest.workspace.ts --project unit`
- AC-2.5 (partial): `package.json` has `test:unit`, `test:integration`, `test:e2e` scripts with explicit `--workspace vitest.workspace.ts` flag
- `pnpm test:integration` includes `REDIS_URL=redis://localhost:6379` in script definition
- `pnpm test:e2e` maps to `../../tests/e2e/run-e2e.sh` (host-side E2E runner from Sprint 2)
- Existing `vitest.config.ts` adjusted for workspace compatibility (no conflicting includes/excludes)
- **Redis for integration (local dev):** `pnpm test:integration` requires Redis running locally — documented in package.json comments or test README. Developers run `docker compose -f tests/e2e/docker-compose.e2e.yml up -d redis-e2e` or have `redis-server` running.
- **Redis for integration (CI):** GitHub Actions integration job uses `services: redis:` with health check (SDD §3.9). `REDIS_URL=redis://localhost:6379` set in workflow `env:`.

**Effort:** Low
**Testing:** `pnpm test:unit` runs without error (may still have Redis failures until Task 1.2); `pnpm test:integration` passes on clean runner with Redis service container
**SDD Reference:** §3.2

### Task 1.2: Redis Test Audit Spike (SDD §3.3, Flatline SKP-010)

**Description:** Timeboxed 2-hour audit to identify all test files that import Redis/ioredis directly. Produce an exact file list with classification decision for each file (mock vs reclassify). If >10 files require production code refactors to mock, escalate for scope decision.

**Acceptance Criteria:**
- File list produced: each entry has {path, classification: "mock" | "reclassify" | "needs-refactor", rationale}
- Total mock count, reclassify count, and needs-refactor count documented
- If needs-refactor > 10: scope escalation note added to NOTES.md
- Spike completes within 2 hours — partial results are acceptable

**Effort:** Low-Medium (timeboxed)
**Testing:** Audit artifact validated by reviewer
**SDD Reference:** §3.3

### Task 1.3: Test Reclassification — Mock Redis (SDD §3.3)

**Description:** For files classified as "mock" in Task 1.2, add `vi.mock` for Redis/ioredis imports so they run without a Redis connection. Keep them as `*.test.ts` (unit tests).

**Acceptance Criteria:**
- AC-2.1 (full): `pnpm test:unit` passes without a running Redis instance — zero ECONNREFUSED
- Each mocked file still tests its original application logic (mock correctness)
- No production code changes — only test files modified

**Effort:** Medium-High (depends on Task 1.2 count)
**Testing:** `pnpm test:unit` green with zero ECONNREFUSED
**SDD Reference:** §3.3
**Dependencies:** Task 1.2 (file list)

### Task 1.4: Test Reclassification — Rename Integration Tests (SDD §3.3)

**Description:** For files classified as "reclassify" in Task 1.2, rename from `*.test.ts` to `*.integration.test.ts`. Update any imports referencing the old filenames.

**Acceptance Criteria:**
- AC-2.2: Tests that require Redis use `.integration.test.ts` suffix
- Renamed files still pass when Redis is available
- No broken imports or references

**Effort:** Low
**Testing:** `pnpm test:integration` with Redis service runs renamed files
**SDD Reference:** §3.3
**Dependencies:** Task 1.2 (file list)

### Task 1.5: Static Import Guard (SDD §3.3)

**Description:** Add a CI pre-step that fails if any `*.test.ts` file imports Redis/ioredis directly. This is a hard gate to prevent reclassification regressions.

**Acceptance Criteria:**
- CI step searches all workspace test directories (not just `themes/sietch/tests/`) for unit test files (`*.test.ts`, excluding `*.integration.test.ts` and `*.e2e.test.ts`)
- Pattern matches both ESM and CJS: `from ['"](?:redis|ioredis)`, `require\(['"](?:redis|ioredis)`, `import\(['"](?:redis|ioredis)`
- Step fails with clear error message listing offending files
- Step passes after reclassification is complete
- AC-2.3 (partial): Unit CI job includes this guard as pre-step
- **Regression proof AC:** Introduce a temporary `require('ioredis')` in a unit test file and confirm the guard fails; remove it and confirm the guard passes
- **Transitive import note (Flatline IMP-006):** This guard catches direct imports only. Transitive Redis usage (a module that internally imports Redis) is caught at runtime by ECONNREFUSED in `pnpm test:unit`. The static guard is a fast-feedback first line, not exhaustive coverage.

**Effort:** Low
**Testing:** Verify guard catches ESM import, CJS require, and dynamic import of Redis in unit test files
**SDD Reference:** §3.3

---

## Sprint 2: E2E Runner + JWKS Validation + Economic Loop

**Global Sprint ID:** 356
**Goal:** Validate the full E2E Docker Compose topology with deterministic runner, JWKS bootstrap, and economic loop tests.
**Priority:** P0
**Dependencies:** Sprint 1 (clean unit test path needed for CI confidence)

### Task 2.1: E2E Runner Script (SDD §3.1)

**Description:** Create `tests/e2e/run-e2e.sh` — the host-side deterministic E2E runner with `wait_for_health` via `docker compose exec -T`, trap-based cleanup with log capture, and parameterized ports.

**Acceptance Criteria:**
- AC-1.1: `./tests/e2e/run-e2e.sh` completes with exit code 0 when all services healthy and tests pass
- AC-1.2: All 4 services health-checked via `docker compose exec -T` (internal ports)
- AC-1.7: `docker compose down -v` runs unconditionally via trap
- AC-1.8: Health wait timeout (60s) and test timeout (120s) explicit
- Log capture to `$E2E_LOG_DIR` before teardown (SDD IMP-003)
- Ports parameterized via `E2E_*_PORT` env vars (SDD IMP-005)
- `set -euo pipefail` and clear exit codes (0=pass, 1=fail, 2=build failure)
- Runner invokes `npx vitest run ../../tests/e2e/ --testTimeout $TEST_TIMEOUT --sequence.shuffle false --reporter=verbose` from `themes/sietch/` directory
- Runner fails if vitest discovers zero E2E test files (prevents false-green)
- This is the same command that `pnpm test:e2e` (from Task 1.1) invokes via the runner script

**Effort:** Medium
**Testing:** Run script locally against compose topology; verify it runs the E2E test files and propagates exit code
**SDD Reference:** §3.1

### Task 2.2: Docker Compose Updates (SDD §3.4)

**Description:** Update `tests/e2e/docker-compose.e2e.yml` to parameterize host ports, add metadata endpoint blocking, and fix any bitrot.

**Acceptance Criteria:**
- Ports use env vars: `${E2E_REDIS_PORT:-6399}:6379`, `${E2E_ARRAKIS_PORT:-3099}:3000`, etc.
- `extra_hosts` blocks `169.254.169.254` and `metadata.google.internal` on arrakis-e2e and loa-finn-e2e
- Existing `depends_on` with `condition: service_healthy` preserved
- All 4 services start and pass health checks

**Effort:** Low
**Testing:** `docker compose -f tests/e2e/docker-compose.e2e.yml up -d` succeeds; health checks pass
**SDD Reference:** §3.4
**Dependencies:** Task 2.1

### Task 2.3: JWKS Health Gate + JWT Validation (SDD §3.5, NFR-5)

**Description:** Enhance `tests/e2e/loa-finn-e2e-stub.ts` with JWKS health gate (return 503 until JWKS file valid), `jti` replay protection, and mandatory claim validation (iss, aud, exp, iat, jti). **Scope note:** Changes to `tests/e2e/*` stubs and harness code are considered test infrastructure, not application logic. The "zero new application logic" constraint applies to production packages (`packages/`, `themes/sietch/src/`) only.

**Acceptance Criteria:**
- AC-1.3: JWKS bootstrap verified — arrakis writes JWKS atomically (already implemented), loa-finn reads and validates with correct `kid` matching
- AC-1.4: S2S JWT exchange verified — arrakis signs billing finalize, loa-finn validates signature
- AC-1.9: Negative test — loa-finn rejects JWTs when JWKS absent or malformed
- NFR-5: Clock skew 30s, TTL 5 min max, jti uniqueness enforced
- loa-finn `/v1/health` returns 503 until JWKS parses as valid JSON

**Effort:** Medium
**Testing:** E2E test suite with JWT assertions
**SDD Reference:** §3.5, NFR-5
**Dependencies:** Task 2.1 (runner needed to validate)

### Task 2.4: Economic Loop E2E Validation (SDD §3.4, FR-6)

**Description:** Run the existing billing E2E tests (`billing-full-loop.e2e.test.ts`, `billing-smoke.e2e.test.ts`, `economic-loop-replay.test.ts`) against the Docker Compose topology. Fix any failures. Validate conservation invariants I-1 through I-5.

**Acceptance Criteria:**
- AC-6.1: `billing-full-loop.e2e.test.ts` passes with zero external network calls
- AC-6.2: Test exercises credit minting → lot creation → debit → conservation checks (I-1..I-5)
- AC-6.3: `economic-loop-replay.test.ts` passes
- AC-6.4: `billing-smoke.e2e.test.ts` passes
- AC-6.5: No test calls NOWPayments, Paddle, or external payment APIs
- AC-1.5: Contract-validator confirms schema conformance

**Effort:** Medium (debugging existing tests against live topology)
**Testing:** Full E2E run via `run-e2e.sh`
**SDD Reference:** §3.4, FR-6
**Dependencies:** Tasks 2.1, 2.2, 2.3

### Task 2.5: Static Egress Assertion (SDD §3.4, Layer 3)

**Description:** Add a post-test step in the runner that inspects container `/proc/net/tcp` for unexpected non-RFC1918 outbound connections.

**Acceptance Criteria:**
- AC-6.6: Post-test assertion verifies no unexpected external connections
- Assertion algorithm: `docker compose exec -T <service> cat /proc/net/tcp6 /proc/net/tcp 2>/dev/null` → parse hex remote addresses → ignore 127.0.0.0/8, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, ::1, fe80::/10, LISTEN state, and Docker bridge subnet (discovered via `docker network inspect`) → flag any ESTABLISHED connection to non-allowlisted remote as violation
- Non-RFC1918 connections logged with decoded IP and cause runner to exit with failure
- Clear error message identifying offending connections and container
- **Determinism proof AC:** On a clean E2E run, assertion produces zero findings. When a `curl https://example.com` is injected into a test, assertion fails and prints the remote IP.

**Effort:** Medium
**Testing:** Verify assertion passes on clean run; inject external curl to confirm detection
**SDD Reference:** §3.4
**Dependencies:** Task 2.1

---

## Sprint 3: Documentation + CI Pipeline ✅

**Global Sprint ID:** 357
**Goal:** Write admin guide, staging checklist, update onboarding docs, and wire CI pipeline.
**Priority:** P0 (FR-3), P1 (FR-4, FR-5, FR-7)
**Dependencies:** Sprint 2 (E2E validated — CI can reference working runner)
**Review:** APPROVED (2026-02-25)

### Task 3.1: Admin Setup Guide (SDD §3.6, FR-3)

**Description:** Write `themes/sietch/docs/ADMIN_SETUP_GUIDE.md` covering Discord setup, env config, DB init, feature flags, verification checklist, and troubleshooting.

**Acceptance Criteria:**
- AC-3.1: Guide exists and covers all required sections
- AC-3.2: References actual env var names from `.env.example`
- AC-3.3: Includes minimal viable config (smallest set of env vars)
- AC-3.4: Documents safe-to-disable feature flags
- AC-3.5: Includes verification checklist (bot responds, health 200)
- NFR-3: Written for community admin persona, not engineers

**Effort:** Medium
**Testing:** `/rtfm` validation (Task 3.5)
**SDD Reference:** §3.6

### Task 3.2: Onboarding Documentation Update (SDD §3.8, FR-4)

**Description:** Replace Collab.Land references with `/verify` command documentation. Update `.env.example` placeholder Discord IDs.

**Acceptance Criteria:**
- AC-4.1: Zero references to "Collab.Land" or "collabland" in user-facing docs
- AC-4.2: Onboarding guide documents `/verify` slash command with EIP-191 flow
- AC-4.3: `.env.example` placeholder Discord IDs replaced with instructions

**Effort:** Low
**Testing:** `grep -ri collab.land themes/sietch/docs/` returns empty
**SDD Reference:** §3.8

### Task 3.3: Staging Deployment Checklist (SDD §3.7, FR-5)

**Description:** Create `themes/sietch/docs/STAGING_CHECKLIST.md` with secrets inventory from Terraform variables and `.env.example`, operational steps, and verification gate.

**Acceptance Criteria:**
- AC-5.1: Checklist exists
- AC-5.2: Enumerates secrets from Terraform + `.env.example` with status
- AC-5.3: Includes rotate token, terraform plan, migrations, health check steps
- AC-5.4: References existing deployment runbooks
- AC-5.5: Verification gate: `terraform plan` succeeds + `/health` returns 200

**Effort:** Low-Medium
**Testing:** Checklist reviewed against actual Terraform variables
**SDD Reference:** §3.7

### Task 3.4: CI Pipeline Wiring (SDD §3.9, FR-7)

**Description:** Update `.github/workflows/ci.yml` with unit + integration split jobs. Update `.github/workflows/e2e-billing.yml` to use `run-e2e.sh` with artifact collection.

**Acceptance Criteria:**
- AC-2.3: Unit job runs `pnpm test:unit` (no Redis); integration job runs `pnpm test:integration` (with Redis service container)
- AC-7.1: E2E workflow updated to use `run-e2e.sh`
- AC-7.2: CI builds Docker images, starts services, runs E2E, reports results
- AC-7.3: E2E job timeout 15 minutes
- AC-7.4: Failure artifacts include compose logs (`actions/upload-artifact@v4`)
- AC-7.5: Runs on PRs targeting main
- Static import guard runs as unit job pre-step (Task 1.5 wired into CI)

**Effort:** Medium
**Testing:** CI workflow dry-run via `act` or push to feature branch
**SDD Reference:** §3.9
**Dependencies:** Sprint 1 (workspace config), Sprint 2 (runner script)

### Task 3.5: RTFM Validation (SDD §3.6, AC-3.6)

**Description:** Run `/rtfm` validation on the admin setup guide to verify a zero-context agent can follow it.

**Acceptance Criteria:**
- AC-3.6: `/rtfm` passes with zero BLOCKING gaps
- If BLOCKING gaps found: fix guide and re-test (max 1 retry)
- RTFM report saved to `grimoires/loa/a2a/rtfm/`

**Effort:** Low
**Testing:** `/rtfm --template install themes/sietch/docs/ADMIN_SETUP_GUIDE.md`
**SDD Reference:** §3.6
**Dependencies:** Task 3.1

---

## Gate Failure Handling

Each sprint has a quality gate. If a gate fails, follow the corresponding action:

| Gate | Trigger | Action |
|------|---------|--------|
| Sprint 1: Unit tests green | `pnpm test:unit` has ECONNREFUSED | Re-audit Task 1.2 file list; reclassify missed files. Do not proceed to Sprint 2. |
| Sprint 1: Integration tests green | `pnpm test:integration` fails with Redis running | Debug individual test failures; file may need mock, not reclassification. |
| Sprint 2: E2E runner exits 0 | `run-e2e.sh` fails on healthy services | Capture compose logs (IMP-003); isolate failing test; fix before proceeding. |
| Sprint 2: Egress assertion clean | Non-RFC1918 connection detected | Identify offending test; add to allowlist if Docker-internal, fix if genuine egress. |
| Sprint 3: RTFM passes | BLOCKING gaps in admin guide | Fix guide and re-test (max 1 retry per Task 3.5). |
| Sprint 3: CI green | Workflow failures | Test with `act` locally; fix YAML syntax or service config before merge. |

**Stop-the-line rule:** If Sprint 1 Task 1.2 (Redis audit spike) finds >10 files needing production refactors, HALT and escalate per the timeboxed spike protocol (SDD §3.3, Flatline SKP-010).

---

## Risk Assessment

| Risk | Severity | Mitigation | Sprint |
|------|----------|------------|--------|
| Redis mocking requires production refactors | High | Timeboxed spike (Task 1.2); escalation if >10 files need refactors | 1 |
| Redis mocking soft-escalation gap (Flatline SKP-002) | Medium | If audit finds 7–10 files needing complex mocks, flag in NOTES.md for capacity review even if below hard threshold | 1 |
| E2E topology bitrot — services fail to start | Medium | Incremental debugging via `run-e2e.sh` with log capture | 2 |
| JWKS health gate timing — loa-finn starts before JWKS ready | Low | Health gate already implemented; `depends_on` + runner health wait | 2 |
| JWKS volume driver semantics (Flatline SKP-006) | Low | Atomic `mv` on named Docker volumes uses overlay2 by default; if CI uses fuse-overlayfs, add explicit storage driver check to preflight | 2 |
| Stub behavior drift (Flatline SKP-001) | Medium | E2E stubs (Task 2.3) document explicit "test-only" boundaries; production JWKS validation is designed from requirements, not reverse-engineered from stubs | 2 |
| Port conflicts on developer machines | Medium | Parameterized ports via env vars (SDD IMP-005) | 2 |
| Docker env differences (Flatline SKP-005) | Medium | Minimum versions: Docker 24+, Compose v2.20+. Document in `run-e2e.sh` header and CI workflow. | 2 |
| Workspace test classification gaps (Flatline SKP-003) | Low | Add catch-all vitest project for unclassified test files (`*.spec.ts` etc.) that logs a warning — prevents silent test omission | 1 |
| RTFM fails — admin guide has gaps | Medium | Budget 1 fix iteration in Task 3.5 | 3 |
| CI workflow changes break existing jobs | Medium | Feature branch testing before merge to main | 3 |

## Success Criteria

Complete when:
1. `pnpm test:unit` passes with zero ECONNREFUSED (Sprint 1)
2. `pnpm test:integration` passes with Redis service (Sprint 1)
3. `./tests/e2e/run-e2e.sh` exits 0 with all 4 services healthy (Sprint 2)
4. Economic loop tests validate I-1..I-5 conservation invariants (Sprint 2)
5. ADMIN_SETUP_GUIDE.md passes RTFM validation (Sprint 3)
6. CI runs unit, integration, and E2E in separate jobs — all green (Sprint 3)
7. Zero references to Collab.Land in user-facing docs (Sprint 3)
8. Staging checklist covers all Terraform secrets (Sprint 3)

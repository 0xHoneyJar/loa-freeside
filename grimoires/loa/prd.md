# PRD: The Sietch Opening — E2E Validation & Test Community Launch

**Version:** 1.2.0
**Cycle:** cycle-042
**Date:** 2026-02-25
**Status:** Draft

> Sources: loa-finn issue #66 (Launch Readiness RFC, Command Deck update 2026-02-24),
> grimoires/loa/context/test-community-readiness.md (readiness assessment),
> grimoires/loa/context/test-community-readiness-plan.md (readiness plan),
> grimoires/loa/context/billing-rfc.md (revenue strategy),
> tests/e2e/docker-compose.e2e.yml (existing E2E infrastructure),
> loa-freeside PR #96 (v7.11.0 protocol adoption, merged 2026-02-24),
> grimoires/loa/reality/ (codebase reality, 2026-02-13)

---

## 1. Problem Statement

Cycle-041 completed full protocol alignment with loa-hounfour v7.11.0 — 65 symbols under consumer-driven contract, ADR-001 import guards passing, hash chain utilities available, Bridgebuilder review flatlined at iteration 3. The protocol foundation is solid.

But **protocol alignment is not product launch**. The test-community-readiness assessment from cycle-007 identified the core gap clearly:

> "The code is ready. The documentation for admins is not."

Specifically, five things stand between "code complete" and "test community using it":

1. **No admin setup documentation.** Community admins cannot configure Discord servers, environment variables, databases, or feature flags. No `ADMIN_SETUP_GUIDE.md` exists. Estimated 2-4 hours of writing, but it is the #1 blocker for any test community deployment.

2. **E2E tests exist but haven't been validated as a suite.** `tests/e2e/docker-compose.e2e.yml` defines the full cross-system topology (arrakis-e2e + loa-finn-e2e + redis-e2e + contract-validator). The loa-finn stub server (`loa-finn-e2e-stub.ts`) implements ES256 JWKS, JWT validation, and contract schema checks. But these have not been run as an integrated suite — the Docker Compose topology needs validation, and the billing full-loop test needs to prove the economic cycle works end-to-end.

3. **202 unit tests fail with Redis ECONNREFUSED.** Integration tests that depend on Redis are not properly isolated from unit tests. This erodes CI confidence — when 202 tests fail on every run, real regressions hide in the noise. The test suite needs Redis dependency isolation so that `pnpm test` gives a clear signal.

4. **Staging secrets are placeholders.** AWS Secrets Manager has expired Discord bot tokens and placeholder values. The staging environment cannot be deployed until real secrets are configured — a human operational step that needs a checklist.

5. **Onboarding documentation references Collab.Land instead of in-house `/verify`.** The wallet verification flow was replaced with EIP-191 in-house verification, but docs still point to Collab.Land. Test community members will be confused.

> Sources: test-community-readiness.md, test-community-readiness-plan.md, NOTES.md blockers

---

## 2. Goals

| ID | Goal | Metric |
|----|------|--------|
| G-1 | Run the full E2E Docker Compose topology with deterministic pass/fail | `tests/e2e/e2e-entrypoint.sh` starts all 4 services, waits for health, runs test suite, reports exit code, tears down (`down -v`) |
| G-2 | Fix Redis test isolation via unit/integration split | `pnpm test:unit` passes without Redis; `pnpm test:integration` runs Redis-dependent tests in CI with service container; both run in CI |
| G-3 | Write admin setup guide that enables a new community to deploy | ADMIN_SETUP_GUIDE.md covers Discord setup, env config, DB init, feature flags; RTFM test passes |
| G-4 | Update onboarding docs to reference in-house verification | Zero references to Collab.Land in user-facing docs; `/verify` command documented |
| G-5 | Create staging deployment checklist derived from Terraform secrets inventory | Checklist enumerates secrets from `infrastructure/terraform/` variables; verified by `terraform plan` success and `/health` 200 |
| G-6 | Validate the economic loop end-to-end using in-repo stubs only | billing-full-loop.e2e.test.ts passes against Redis + loa-finn stub; zero external network calls; all payment provider interactions use in-repo stubs |
| G-7 | CI pipeline runs E2E tests on PR using stub mode | `.github/workflows/e2e-ci.yml` triggers on PR, uses in-repo loa-finn stub (no cross-repo checkout), passes with exit code |

---

## 3. User & Stakeholder Context

### Primary Persona: Community Admin (Test Community)

- Non-technical or semi-technical Discord server administrator
- Needs step-by-step guide to configure the bot for their server
- Needs to understand which feature flags to enable/disable for their community
- Will be the first real users — their experience shapes the product

### Secondary Persona: Platform Engineer (Internal)

- Maintains the codebase across 42 development cycles
- Needs CI confidence: a green test suite means something, a red suite means something
- Needs E2E validation before staging deployment to avoid embarrassing failures
- Needs a staging deployment checklist to hand off ops work

### Tertiary Persona: loa-finn Integration Partner

- The loa-finn E2E stub validates the S2S JWT exchange and contract compatibility
- Needs the Docker Compose topology to work for cross-repo testing
- Benefits from the contract-validator service proving schema conformance

---

## 4. Functional Requirements

### FR-1: E2E Docker Compose Validation

**Validate and fix the existing E2E Docker Compose topology until all services start and health checks pass.**

The infrastructure exists in `tests/e2e/docker-compose.e2e.yml`:
- `redis-e2e` — Redis 7.2 (digest-pinned)
- `arrakis-e2e` — loa-freeside app (sietch theme, e2e target)
- `loa-finn-e2e` — loa-finn stub or real loa-finn (via `LOA_FINN_DIR`)
- `contract-validator` — Ajv schema validator (Sprint 256)

The loa-finn stub (`tests/e2e/loa-finn-e2e-stub.ts`) implements ES256 key generation, JWKS, JWT validation, and contract schema checks.

**E2E Runner Model:** Tests run on the host against containerized services (started with `docker compose up -d`). The `e2e-entrypoint.sh` script orchestrates: start services → wait for health → run vitest E2E suite → report exit code → `docker compose down -v`. This is a deterministic pass/fail — no manual `docker compose up` without teardown.

**Stub vs Real Mode:** The compose file uses `LOA_FINN_DIR` to optionally point at a real loa-finn checkout. **In CI and by default, the in-repo stub (`tests/e2e/loa-finn-e2e-stub.ts`) is used.** The stub implements ES256 JWKS, JWT validation, contract schema checks, and canned responses from test vectors — sufficient for all E2E assertions in this repo. `LOA_FINN_DIR` is a local-dev-only override for cross-repo integration testing.

**JWKS Bootstrap Direction:** arrakis-e2e is the JWT issuer (it signs requests). It generates an ES256 key pair at startup and writes JWKS to `/shared/arrakis-jwks.json` (shared Docker volume). loa-finn-e2e reads this file to validate inbound JWTs. This matches the production flow where arrakis is the issuer and loa-finn is the audience.

**JWKS Security Constraints:** The shared volume contains **public JWKS only** — no private keys are written to shared storage. Keys are ephemeral per E2E run (generated at container startup, discarded on teardown). No key material is committed to the repository. The JWKS file uses atomic write (write to temp file, rename) to prevent partial reads, and loa-finn-e2e waits for the file to exist before accepting requests.

**E2E Failure Semantics:** The `e2e-entrypoint.sh` runner defines explicit failure handling:
- **Health wait timeout:** 60 seconds per service. If any service fails health check within timeout, runner exits with code 1 and logs which service failed.
- **Test timeout:** 120 seconds for the full vitest E2E suite (`--testTimeout 120000`).
- **Teardown guarantee:** `docker compose down -v` runs unconditionally via `trap` — executes on success, failure, timeout, and signal (SIGINT/SIGTERM).
- **Exit code propagation:** The runner exits with the vitest exit code (0=pass, 1=fail). Health timeout exits 1. Compose build failure exits 2.
- **No retry:** Failed tests are not retried within a single run. Flake detection happens across runs via CI history.

**Determinism Requirements:** E2E tests must produce identical results across runs given identical code:
- **Data isolation:** Each E2E run starts with empty Redis (`docker compose down -v` between runs). No persistent state carries between test runs.
- **Readiness gates:** Services must pass health checks with bounded retries (max 60s) before any test executes. No tests start during container startup.
- **Ordering independence:** E2E tests run in a deterministic order (vitest `--sequence.shuffle false`) but must not depend on shared mutable state between test files.
- **Flake budget:** Target is 0 flakes over 10 consecutive CI runs before declaring E2E stable. Any flake triggers investigation before merge.

**Acceptance Criteria:**
- AC-1.1: `./tests/e2e/e2e-entrypoint.sh` completes with exit code 0 (deterministic runner: start → health wait → test → teardown)
- AC-1.2: All 4 service health checks pass before tests begin (redis-cli ping, curl /health on arrakis, curl /v1/health on loa-finn stub, wget /health on contract-validator)
- AC-1.3: JWKS bootstrap verified — arrakis-e2e writes JWKS to shared volume (issuer, public key only, atomic write), loa-finn stub reads and validates inbound JWTs (audience) with correct `kid` matching
- AC-1.4: S2S JWT exchange verified — arrakis signs a billing finalize request, loa-finn stub validates signature and returns a canned response
- AC-1.5: Contract-validator confirms schema conformance for `billing-entry` and `anchor-verification`
- AC-1.6: Compose defaults to stub mode with zero extra inputs — `LOA_FINN_DIR` unset means stub is built from in-repo source
- AC-1.7: `docker compose down -v` runs unconditionally as final step via trap (no orphaned containers or volumes)
- AC-1.8: Health wait timeout (60s) and test timeout (120s) are explicit in runner script
- AC-1.9: Negative test for missing/invalid JWKS — loa-finn stub rejects JWTs when JWKS file is absent or malformed

### FR-2: Redis Test Isolation

**Ensure unit tests do not require a running Redis instance.**

The current test suite has 202 failures, all `ECONNREFUSED 127.0.0.1:6379`. These are integration-level tests mixed into the unit test path. Tests that genuinely need Redis should either:
1. Be tagged/isolated to only run when Redis is available (e.g., in E2E CI), or
2. Use vitest mocks to simulate Redis responses

**Test Taxonomy:**
- **Unit tests** (`pnpm test:unit`): No external dependencies. Redis, Postgres, NATS all mocked or absent. Run by default on every PR.
- **Integration tests** (`pnpm test:integration`): Require Redis service container. File suffix `.integration.test.ts` or vitest workspace project. Run in CI with Redis service.
- **E2E tests** (`pnpm test:e2e`): Require full Docker Compose topology (FR-1). Run in separate CI job.

All three categories run in CI. Unit tests are the default `pnpm test` path. Integration and E2E run in dedicated CI jobs with their respective infrastructure.

**Classification Rules:** Tests are classified by file naming convention and location:
- **Unit:** `*.test.ts` (default suffix) — must not import Redis/ioredis/NATS clients directly; mock all external I/O
- **Integration:** `*.integration.test.ts` — may connect to Redis/Postgres service containers; file suffix is the classifier
- **E2E:** Files in `tests/e2e/` directory — require full Docker Compose topology
- **Mixed-dependency tests:** If an existing `*.test.ts` file imports Redis directly, it must be renamed to `*.integration.test.ts` or refactored to mock Redis. An audit step early in the sprint identifies all such files by scanning for `import.*redis` / `import.*ioredis` patterns.

**Acceptance Criteria:**
- AC-2.1: `pnpm test:unit` in `themes/sietch/` passes without a running Redis instance — zero ECONNREFUSED errors
- AC-2.2: Tests that require Redis use `.integration.test.ts` suffix or are in a dedicated vitest workspace project
- AC-2.3: CI runs unit tests (no external deps) AND integration tests (with Redis service container) in separate jobs — both must pass
- AC-2.4: `pnpm test` (default) maps to `pnpm test:unit` — the safe-by-default path requires no infrastructure
- AC-2.5: vitest config or test README documents the unit/integration/e2e taxonomy and how to run each

### FR-3: Admin Setup Guide

**Write a step-by-step guide for community admins to deploy and configure the bot.**

This is the #1 blocker per the readiness assessment. The guide must cover:
- Discord application creation and bot token
- Discord server setup (roles, channels, permissions)
- Environment variable configuration (the 30+ required vars from `.env.example`)
- Database initialization (migrations, seed data)
- Feature flag configuration (which flags to enable for a minimal deployment)
- Verification: how to confirm the bot is running correctly
- Common troubleshooting (missing env vars, permission errors, rate limits)

**RTFM Validation Protocol:** The admin guide is validated via `/rtfm` test with these parameters:
- **Tester profile:** Zero-context agent with no prior knowledge of the project (simulates a new community admin)
- **Baseline environment:** Fresh machine with Docker, Node.js 20+, and git installed. No pre-existing `.env` or database.
- **Task:** "Follow this guide to deploy the bot to a test Discord server"
- **Pass criteria:** Tester reaches the verification checklist (AC-3.5) without encountering BLOCKING gaps — missing steps, undefined terms, or broken commands
- **Fail criteria:** Any BLOCKING gap that prevents the tester from continuing (e.g., "guide says to run X but doesn't explain where to get Y")

**Acceptance Criteria:**
- AC-3.1: `themes/sietch/docs/ADMIN_SETUP_GUIDE.md` exists and covers all sections above
- AC-3.2: Guide references actual env var names from `.env.example` (not hypothetical)
- AC-3.3: Guide includes a "minimal viable config" — the smallest set of env vars needed to start the bot
- AC-3.4: Guide documents which feature flags are safe to disable for initial testing
- AC-3.5: Guide includes a verification checklist (bot responds to slash commands, health endpoint returns 200)
- AC-3.6: `/rtfm` validation passes with zero BLOCKING gaps (the guide is self-contained and actionable)

### FR-4: Onboarding Documentation Update

**Replace all Collab.Land references with in-house `/verify` command documentation.**

**Acceptance Criteria:**
- AC-4.1: Zero references to "Collab.Land" or "collabland" in user-facing documentation under `themes/sietch/docs/`
- AC-4.2: Onboarding guide (`themes/sietch/docs/community/onboarding.md`) documents the `/verify` slash command with EIP-191 signature flow
- AC-4.3: `.env.example` placeholder Discord IDs (`000000000000000000`) replaced with clearly-labeled examples or instructions

### FR-5: Staging Deployment Checklist

**Create a deployment checklist that covers all operational steps for staging.**

**Secrets Inventory Source:** The authoritative list of secrets is derived from Terraform variable definitions in `infrastructure/terraform/` (specifically `variables.tf` and any `*.auto.tfvars` files) plus the `themes/sietch/.env.example` environment variable list. The checklist cross-references both sources to ensure no secret is missed.

**Acceptance Criteria:**
- AC-5.1: `themes/sietch/docs/STAGING_CHECKLIST.md` exists
- AC-5.2: Checklist enumerates every AWS Secrets Manager secret derived from Terraform variable definitions and `.env.example` — each entry specifies the secret name, which Terraform module uses it, and whether it has a real value or placeholder
- AC-5.3: Checklist includes steps to: rotate expired Discord bot token, verify Terraform state (`terraform plan` shows no unexpected changes), run database migrations, validate health endpoints (`/health` returns 200)
- AC-5.4: Checklist references the existing deployment runbooks in `infrastructure/terraform/`
- AC-5.5: Checklist includes a verification gate: `terraform plan` succeeds and deployed service `/health` endpoint returns 200 — this is the measurable "deployable" criterion

### FR-6: Economic Loop E2E Validation

**Run the billing full-loop test against real services in the Docker Compose topology.**

The economic primitives exist (credit lot service, conservation guard, x402 settlement, NOWPayments handler). The test exists (`tests/e2e/billing-full-loop.e2e.test.ts`). What's needed is validation that the test actually passes against the containerized stack.

**Conservation Invariants (I-1 through I-5):** The economic loop tests validate these invariants from `conservation-guard.ts`:
- **I-1** (Lot Balance): `committed + reserved + available = limit` — every credit lot's balance components must sum to its limit
- **I-2** (Non-Negative): All balance components (`committed`, `reserved`, `available`) must be >= 0
- **I-3** (Debit Ceiling): A single debit cannot exceed `available` balance
- **I-4** (Mint Idempotency): Replaying a mint operation with the same idempotency key produces no state change
- **I-5** (Audit Trail): Every balance mutation produces an audit event with before/after snapshots

These invariants are the acceptance target for economic loop tests — any test asserting "conservation passes" must verify all five.

**External Dependency Policy:** All E2E billing tests run against in-repo infrastructure only. The loa-finn stub provides canned finalize responses. Payment provider interactions (NOWPayments, x402 settlement) use in-repo stubs or are simulated via direct database/Redis operations — **zero external network calls occur during E2E tests.** If any existing test makes external calls, it must be refactored to use stubs before this cycle considers it passing.

**Network Isolation Enforcement:** The E2E Docker Compose network uses an `internal: true` Docker network for service-to-service traffic, preventing accidental egress to the internet. The `e2e-entrypoint.sh` runner verifies no outbound connections were made by checking container network stats or test-time HTTP client wrappers that fail on non-allowed hosts. This is defense-in-depth — tests should not attempt external calls, and the network prevents them if they do.

**Acceptance Criteria:**
- AC-6.1: `billing-full-loop.e2e.test.ts` passes in the Docker Compose environment with zero external network calls
- AC-6.2: Test exercises the internal economic loop: credit minting → lot creation → debit via internal billing service → conservation invariant checks (I-1 through I-5 as defined above)
- AC-6.3: `economic-loop-replay.test.ts` passes (replay test for conservation invariants I-1 through I-5)
- AC-6.4: `billing-smoke.e2e.test.ts` passes as the initial health check for billing services
- AC-6.5: No test in `tests/e2e/` calls NOWPayments, Paddle, or any external payment API — all payment flows use in-repo stubs or direct database operations
- AC-6.6: E2E Docker network uses `internal: true` or equivalent egress blocking to enforce zero external calls

### FR-7: CI E2E Pipeline

**Ensure the E2E Docker Compose tests run in CI on pull requests.**

**Acceptance Criteria:**
- AC-7.1: `.github/workflows/e2e-ci.yml` is updated or created to run the Docker Compose E2E topology
- AC-7.2: CI job builds all Docker images, starts services, runs E2E tests, and reports results
- AC-7.3: CI job has a reasonable timeout (15 minutes max for E2E)
- AC-7.4: CI job artifacts include test results and service logs on failure
- AC-7.5: CI job runs on PRs targeting main branch

---

## 5. Technical & Non-Functional Requirements

### NFR-1: Zero Regression
All changes must pass the existing test suite. No existing conformance vectors, conservation tests, or contract tests may break.

### NFR-2: No New Dependencies
This cycle is infrastructure and documentation. No new npm packages or services should be introduced. The E2E infrastructure already exists — this cycle validates and fixes it.

### NFR-3: Operational Clarity
Documentation must be written for the community admin persona, not for the internal engineer. Use concrete steps, not abstractions. Include copy-pasteable commands where possible.

### NFR-4: CI Must Be Green
By the end of this cycle, `pnpm test` must produce a clear pass/fail signal. The 202 Redis failures must be eliminated from the default test path.

### NFR-5: JWT/JWKS Security
S2S JWT validation in E2E tests must enforce production-grade claim validation:
- **Mandatory claims:** `iss` (arrakis service ID), `aud` (loa-finn service ID), `exp`, `iat`, `jti` (unique token ID)
- **Clock skew tolerance:** Maximum 30 seconds
- **Token TTL:** Maximum 5 minutes for S2S tokens
- **Replay protection:** loa-finn stub validates `jti` uniqueness within token TTL window
- **Key handling:** Private keys exist only in arrakis process memory; shared volume contains public JWKS only; keys are ephemeral per E2E run
- **Secrets scanning:** CI must not contain committed tokens, keys, or credentials; `.gitignore` includes all `.env` variants except `.env.example`

---

## 6. Scope & Prioritization

### In Scope (This Cycle)

| Priority | Requirement | Effort |
|----------|------------|--------|
| P0 | FR-2: Redis test isolation (fix 202 ECONNREFUSED) | Medium |
| P0 | FR-3: Admin Setup Guide | Medium |
| P0 | FR-1: E2E Docker Compose validation | Medium-High |
| P1 | FR-4: Onboarding doc update (Collab.Land → /verify) | Low |
| P1 | FR-5: Staging deployment checklist | Low-Medium |
| P1 | FR-6: Economic loop E2E validation | Medium |
| P2 | FR-7: CI E2E pipeline | Medium |

### Out of Scope

- **New features** — This cycle builds zero new capabilities. It validates and documents what exists.
- **Arrakis protocol adoption** — That's arrakis repo work, tracked in the Command Center.
- **Production deployment** — This cycle prepares staging; production deployment is a separate operational cycle.
- **NativeRuntimeAdapter spike** — loa-finn scope.
- **Admin web dashboard** — The admin dashboard exists but is not the focus; documentation of the existing dashboard is sufficient.
- **Load testing** — `tests/load/` exists but wiring it into CI is a future cycle. E2E validation is the priority.
- **NOWPayments sandbox validation** — Requires human action (creating sandbox account). Document as a staging checklist item.
- **Canary deployment strategy** — Infrastructure improvement for post-launch.

---

## 7. Risks & Dependencies

| Risk | Severity | Mitigation |
|------|----------|------------|
| Docker Compose topology has bitrotted since Cycle-028 | Medium | Start with `docker compose up` and fix incrementally; the compose file has been maintained through 4 cycles |
| Dockerfile.base may be stale | Medium | Rebuild base image; the e2e target in sietch Dockerfile may need dependency updates |
| loa-finn stub may not align with current loa-finn API | Medium | Stub is contract-driven — validate against contract.json entrypoints |
| Redis test isolation may require significant test refactoring | Medium | Prefer vitest `--project unit` over individual test changes; isolate at the config level |
| Admin documentation scope creep | Low | Timebox to "minimum needed for 5-10 person test community" — not a user manual |
| Staging secrets require human action | Medium | Create the checklist; human rotates secrets; separate concern from code cycle |
| `.env.example` has 500+ lines — guide could become overwhelming | Low | Guide includes "minimal viable config" section with just the 15-20 critical vars |

### Dependencies

| Dependency | Owner | Status |
|-----------|-------|--------|
| Docker installed on dev machine | Engineer | Assumed |
| loa-finn repo available for E2E (or stub used) | Team | Stub exists in tests/e2e/ |
| Real Discord bot token for staging | Human ops | Expired — needs rotation |
| AWS Secrets Manager access | Human ops | Available |
| PR #96 merged (v7.11.0 protocol alignment) | Complete | Merged 2026-02-24 |

---

## 8. Success Criteria

This cycle is complete when:

1. **E2E suite passes deterministically**: `e2e-entrypoint.sh` starts services, runs tests, tears down, exits 0
2. **Unit tests are clean**: `pnpm test:unit` passes without Redis — zero ECONNREFUSED; `pnpm test:integration` runs Redis-dependent tests in CI
3. **Admin guide exists**: An RTFM-testable guide that enables community admin deployment
4. **Onboarding is accurate**: No Collab.Land references, `/verify` documented
5. **Staging is documented**: Checklist derived from Terraform secrets inventory; verified by `terraform plan` success and `/health` 200
6. **Economic loop validated**: billing-full-loop.e2e.test.ts passes in containers with zero external network calls
7. **CI runs E2E**: PR pipeline uses in-repo stub mode (no cross-repo checkout), reports pass/fail exit code

The exit state is: **a test community admin can follow the guide to deploy, and the E2E suite proves the system works before they try.**

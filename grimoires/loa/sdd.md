# SDD: The Sietch Opening — E2E Validation & Test Community Launch

**Version:** 1.4.0
**Cycle:** cycle-042
**Date:** 2026-02-25
**PRD:** v1.2.0 (GPT-APPROVED iteration 3, Flatline integrated)
**PRD Checksum:** `sha256:b83339d8274bebdaf8a736bbe8f2d7e83f86364d52b20140ae1971550ab2513a`
**PRD Goals:** G-1..G-7 (§Goals), **FRs:** FR-1..FR-7 (§Functional Requirements), **NFRs:** NFR-1..NFR-5 (§Non-Functional Requirements)

---

## 1. Executive Summary

This SDD designs the infrastructure validation, test isolation, and documentation needed to close the gap between "code complete" and "test community using it." Unlike previous cycles that introduced runtime behavior, this cycle writes **zero new application logic**. All changes are to test infrastructure, CI pipelines, documentation, and vitest configuration.

**Key architectural decisions:**
- E2E runner uses host-side vitest against containerized services (not in-container test execution) — matches existing `e2e-billing.yml` CI pattern
- Test taxonomy uses vitest workspace projects with file-suffix classification (`*.test.ts` = unit, `*.integration.test.ts` = integration) — no vitest plugin or custom reporter needed
- JWKS bootstrap uses atomic file write with health-gate synchronization — no HTTP endpoint needed for E2E (shared volume is simpler and matches existing compose file)
- Network isolation uses layered defense: single Docker network + test-design enforcement + no external credentials in CI — Docker `internal: true` alone does not reliably block egress when ports are published
- Admin guide lives at `themes/sietch/docs/ADMIN_SETUP_GUIDE.md` — co-located with existing docs structure
- CI E2E pipeline extends existing `e2e-billing.yml` pattern rather than creating a new workflow

**Scope:** ~15 files modified/created. No new npm dependencies. No new services. No application code changes except test file renames.

---

## 2. System Architecture

### 2.1 Component Overview

This cycle touches four architectural layers. No new components — all work extends or fixes existing infrastructure.

```
┌──────────────────────────────────────────────────────────────┐
│                    DOCUMENTATION LAYER (NEW)                   │
│  themes/sietch/docs/ADMIN_SETUP_GUIDE.md                      │
│  themes/sietch/docs/STAGING_CHECKLIST.md                      │
│  themes/sietch/docs/community/onboarding.md (MODIFIED)        │
├──────────────────────────────────────────────────────────────┤
│                    CI PIPELINE LAYER (MODIFIED)                 │
│  .github/workflows/e2e-billing.yml (extend)                   │
│  .github/workflows/ci.yml (add unit/integration split)        │
├──────────────────────────────────────────────────────────────┤
│                    TEST INFRASTRUCTURE LAYER (MODIFIED)         │
│  tests/e2e/run-e2e.sh (NEW — host-side runner script)         │
│  themes/sietch/vitest.config.ts (MODIFIED — workspace)        │
│  themes/sietch/vitest.workspace.ts (NEW — project split)      │
│  themes/sietch/package.json (MODIFIED — test scripts)         │
├──────────────────────────────────────────────────────────────┤
│                    DOCKER COMPOSE LAYER (MODIFIED)              │
│  tests/e2e/docker-compose.e2e.yml (fix + network isolation)   │
│  tests/e2e/loa-finn-e2e-stub.ts (JWKS sync + negative tests) │
└──────────────────────────────────────────────────────────────┘
```

### 2.2 Data Flow: E2E Test Execution

```
run-e2e.sh (host-side runner)
  │
  ├─1─► docker compose up -d (build + start)
  │       ├── redis-e2e (port 6379)
  │       ├── arrakis-e2e (port 3099)
  │       │     └── CMD: e2e-entrypoint.sh (starts server, then atomic JWKS export)
  │       │           curl → .tmp → jq validate → mv /shared/arrakis-jwks.json
  │       ├── loa-finn-e2e (port 8099)
  │       │     └── reads /shared/arrakis-jwks.json (health gate waits for file)
  │       └── contract-validator (port 3199)
  │
  ├─2─► health_wait (60s timeout per service, via docker compose exec -T)
  │       ├── redis-e2e: redis-cli ping
  │       ├── arrakis-e2e: curl -sf http://localhost:3000/health
  │       ├── loa-finn-e2e: curl -sf http://localhost:8080/v1/health
  │       └── contract-validator: wget -qO- http://localhost:3100/health
  │
  ├─3─► vitest run tests/e2e/ --testTimeout 120000
  │       ├── billing-smoke.e2e.test.ts
  │       ├── billing-full-loop.e2e.test.ts
  │       └── economic-loop-replay.test.ts (in-memory, no Docker)
  │
  ├─4─► capture exit code
  │
  └─5─► trap: docker compose down -v --remove-orphans (ALWAYS)
          └── exit with vitest code (0=pass, 1=fail, 2=build error)
```

### 2.3 Data Flow: Test Taxonomy

```
pnpm test (default) ──► pnpm test:unit
                          │
                          ├── vitest --project unit
                          │     └── *.test.ts (excludes *.integration.test.ts)
                          │     └── No Redis, no Postgres, no NATS
                          │
pnpm test:integration ──► vitest --project integration
                          │     └── *.integration.test.ts
                          │     └── Requires Redis service container
                          │
pnpm test:e2e ──────────► ./tests/e2e/run-e2e.sh
                                └── Full Docker Compose topology
```

---

## 3. Component Design

### 3.1 E2E Runner Script (`tests/e2e/run-e2e.sh`)

**Purpose:** Deterministic E2E test execution with guaranteed teardown.

**Design:**
```bash
#!/usr/bin/env bash
set -euo pipefail

COMPOSE_FILE="tests/e2e/docker-compose.e2e.yml"
HEALTH_TIMEOUT=60
TEST_TIMEOUT=120000

# Health wait function — uses docker compose exec for portability
# No host-side redis-cli/wget dependency required
wait_for_health() {
  local service="$1"
  local check_cmd="$2"
  local timeout="$3"
  local elapsed=0

  echo "Waiting for $service..."
  while [ $elapsed -lt $timeout ]; do
    if docker compose -f "$COMPOSE_FILE" exec -T "$service" sh -c "$check_cmd" >/dev/null 2>&1; then
      echo "$service healthy (${elapsed}s)"
      return 0
    fi
    sleep 1
    elapsed=$((elapsed + 1))
  done
  echo "ERROR: $service failed health check after ${timeout}s"
  return 1
}

# Trap ensures teardown on any exit — capture logs BEFORE tearing down
cleanup() {
  local log_dir="${E2E_LOG_DIR:-tests/e2e/logs}"
  mkdir -p "$log_dir"
  docker compose -f "$COMPOSE_FILE" logs --no-color > "$log_dir/compose-all.log" 2>&1 || true
  for svc in redis-e2e arrakis-e2e loa-finn-e2e contract-validator; do
    docker compose -f "$COMPOSE_FILE" logs --no-color "$svc" > "$log_dir/${svc}.log" 2>&1 || true
  done
  docker compose -f "$COMPOSE_FILE" down -v --remove-orphans 2>/dev/null || true
}
trap cleanup EXIT

# Phase 1: Build and start
docker compose -f "$COMPOSE_FILE" up -d --build || exit 2

# Phase 2: Health wait via docker compose exec (runs inside containers — uses internal ports)
wait_for_health "redis-e2e" "redis-cli ping" $HEALTH_TIMEOUT
wait_for_health "arrakis-e2e" "curl -sf http://localhost:3000/health" $HEALTH_TIMEOUT
wait_for_health "loa-finn-e2e" "curl -sf http://localhost:8080/v1/health" $HEALTH_TIMEOUT
wait_for_health "contract-validator" "wget -qO- http://localhost:3100/health" $HEALTH_TIMEOUT

# Phase 3: Run tests (host-side vitest, matching existing e2e-billing.yml pattern)
# Ports match docker-compose.e2e.yml env var defaults
ARRAKIS_PORT="${E2E_ARRAKIS_PORT:-3099}"
cd themes/sietch
SKIP_E2E=false \
ARRAKIS_BASE_URL="http://localhost:${ARRAKIS_PORT}" \
  npx vitest run ../../tests/e2e/ \
    --testTimeout $TEST_TIMEOUT \
    --sequence.shuffle false \
    --reporter=verbose

# Exit code propagated via set -e
```

**Key design decisions:**
- `wait_for_health` function defined explicitly — uses `docker compose exec -T` to run health checks inside containers. No host-side `redis-cli` or `wget` dependency. Portable across dev machines and CI runners.
- `trap cleanup EXIT` — unconditional teardown with log capture. Captures per-service compose logs BEFORE `docker compose down` so failures are debuggable. Logs published as CI artifacts on failure.
- `set -euo pipefail` — fail fast on any error. No silent failures.
- Health wait is per-service with explicit timeout — logs which service failed.
- `--sequence.shuffle false` — deterministic test ordering for reproducibility.
- Parameterized host ports — matches compose env vars (`E2E_ARRAKIS_PORT`, etc.) to avoid conflicts.
- Exit codes: 0=tests pass, 1=tests fail or health timeout, 2=compose build failure.
- Host-side vitest execution matches existing `e2e-billing.yml` CI pattern (services publish ports to host).

### 3.2 Vitest Workspace Configuration

**Purpose:** Split unit and integration tests without changing existing test file locations.

**File: `themes/sietch/vitest.workspace.ts`**

```typescript
import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  {
    extends: './vitest.config.ts',
    test: {
      name: 'unit',
      include: ['tests/**/*.test.ts'],
      exclude: [
        'tests/**/*.integration.test.ts',
        'tests/**/*.e2e.test.ts',
        'tests/e2e/**',
      ],
    },
  },
  {
    extends: './vitest.config.ts',
    test: {
      name: 'integration',
      include: ['tests/**/*.integration.test.ts'],
    },
  },
]);
```

**Key design decisions:**
- Workspace projects share the same `vitest.config.ts` base (alias resolution, coverage settings).
- Classification by file suffix — no tags, no environment variables, no custom reporters.
- Unit project explicitly excludes `*.integration.test.ts` — no Redis imports allowed.
- Integration project includes only `*.integration.test.ts` — Redis expected.
- E2E tests live in `tests/e2e/` and run via the runner script, not vitest workspace.

**Package.json script additions:**
```json
{
  "test": "vitest --workspace vitest.workspace.ts --project unit",
  "test:unit": "vitest run --workspace vitest.workspace.ts --project unit",
  "test:integration": "REDIS_URL=redis://localhost:6379 vitest run --workspace vitest.workspace.ts --project integration",
  "test:e2e": "../../tests/e2e/run-e2e.sh",
  "test:run": "vitest run --workspace vitest.workspace.ts --project unit",
  "test:coverage": "vitest run --workspace vitest.workspace.ts --project unit --coverage"
}
```

**Key script decisions:**
- Explicit `--workspace vitest.workspace.ts` in all scripts — prevents vitest from falling back to default config and silently running all tests (which would reintroduce ECONNREFUSED).
- `REDIS_URL=redis://localhost:6379` set in `test:integration` — canonical env var for Redis host. Integration tests must read this env var rather than hardcoding `localhost:6379`. In CI, the GitHub Actions Redis service container maps to the same address.
- `test:e2e` delegates to the runner script — no vitest flags needed (the script handles everything).

### 3.3 Redis Test File Classification

**Purpose:** Identify and reclassify the 202 failing tests.

**Audit procedure:**
1. Scan for Redis imports: `grep -rl "import.*redis\|import.*ioredis\|from.*redis\|from.*ioredis" themes/sietch/tests/`
2. For each file found:
   - If the file tests Redis-specific behavior (cache, pub/sub, rate limiting) → rename to `*.integration.test.ts`
   - If the file tests application logic that happens to use Redis → refactor to mock Redis (use `vi.mock`)
3. Decision criterion: **Does this test's value come from Redis interaction, or from application logic?**
   - Redis interaction value → integration test (rename)
   - Application logic value → unit test (mock Redis)

**Expected distribution (based on 202 ECONNREFUSED errors):**
- ~150 tests: Application logic using Redis as side effect → mock Redis, keep as `*.test.ts`
- ~50 tests: Redis-specific behavior (caching, rate limiting, session) → rename to `*.integration.test.ts`

This is an estimate. The actual split is determined during the audit step.

**Timeboxed Spike (Flatline SKP-010 mitigation):** The first sprint task for Redis reclassification is a 2-hour timeboxed audit spike that:
1. Produces the exact file list with classification decision for each file
2. Identifies any files where mocking requires production code refactors (e.g., tightly coupled Redis clients without dependency injection)
3. If >10 files require production refactors, escalates to user for scope adjustment: either (a) allow scoped app changes to enable DI for those modules, or (b) reclassify those files as integration tests instead of mocking

This ensures scope risk is detected early rather than discovered mid-implementation.

**Static Import Guard (Hard Gate):** After reclassification, a CI step verifies no `*.test.ts` file (unit tests) imports Redis directly:

```bash
# CI step: fail if any unit test file imports redis/ioredis
if grep -rl --include='*.test.ts' -E 'from.*["\x27](redis|ioredis)' themes/sietch/tests/ | grep -v '.integration.test.ts'; then
  echo "ERROR: Unit test files import Redis directly. Rename to *.integration.test.ts or mock Redis."
  exit 1
fi
```

This is a static check — no runtime dependency. It catches reclassification misses before they cause ECONNREFUSED in CI. The check runs in the unit test CI job as a pre-test step.

### 3.4 Network Isolation (Layered Defense)

**Purpose:** Prevent E2E tests from making accidental external network calls.

**Design approach:** Docker Compose `internal: true` alone does not reliably prevent egress when containers also need host-published ports (for host-side vitest). Instead, network isolation uses a **three-layer defense** that does not require new infrastructure:

**Layer 1: Test Design (Primary)**
All E2E tests use in-repo stubs exclusively. No test imports external API clients (NOWPayments, Paddle, Discord API). The loa-finn stub handles all S2S interactions. No external API keys or credentials exist in the E2E environment.

**Layer 2: No External Credentials (CI)**
The CI environment does not provide `NOWPAYMENTS_API_KEY`, `PADDLE_API_KEY`, or any external service credentials. Even if code attempted an external call, authentication would fail.

**Layer 3: Static Egress Assertion (CI)**
A post-test step in CI runs `docker compose exec -T arrakis-e2e sh -c "cat /proc/net/tcp6 2>/dev/null || cat /proc/net/tcp"` and parses remote addresses to verify no unexpected outbound connections were established to non-RFC1918 IPs during the test run. The check also inspects DNS query logs if available (`/var/log/dnsmasq` or container DNS cache). This is an assertion, not a firewall — it catches accidental regressions. If the assertion fails, CI logs the offending connections and fails the job.

**Note:** This layer is a detection control, not a prevention control. Hard egress blocking (iptables DOCKER-USER rules, network policy) is deferred as out-of-scope for this cycle's "no new infrastructure" constraint. The combination of Layers 1+2 prevents authenticated external calls; Layer 3 detects unauthenticated leaks.

**Docker Compose modification:** The existing single-network topology is preserved with published ports for host-side test execution. No `internal: true` dual-network — this avoids the routing complexity that GPT review identified.

```yaml
# docker-compose.e2e.yml — network section unchanged
# Services publish ports to host for vitest runner access
# Ports are parameterized via env vars with defaults to avoid conflicts
services:
  redis-e2e:
    ports: ["${E2E_REDIS_PORT:-6399}:6379"]
  arrakis-e2e:
    ports: ["${E2E_ARRAKIS_PORT:-3099}:3000"]
  loa-finn-e2e:
    ports: ["${E2E_LOAFINN_PORT:-8099}:8080"]
  contract-validator:
    ports: ["${E2E_VALIDATOR_PORT:-3199}:3100"]
```

**Key design decisions:**
- Single default bridge network — simple, reliable host-to-container connectivity.
- No `internal: true` — avoids dual-network routing complexity that breaks published ports.
- Parameterized host ports via env vars with defaults — avoids port conflicts when multiple developers or CI jobs run concurrently. Override via `E2E_ARRAKIS_PORT=3199 pnpm test:e2e`.
- Egress prevention via test design + missing credentials + post-test assertion — defense-in-depth without new infrastructure.
- Cloud metadata endpoint blocked — `extra_hosts: ["metadata.google.internal:127.0.0.1", "169.254.169.254:127.0.0.1"]` added to arrakis-e2e and loa-finn-e2e services. This is a minimal, no-new-infra egress control that prevents SSRF and metadata service access without iptables.
- Redis port published to host — enables both E2E runner and future host-side integration test access.
- Compose `depends_on` with `condition: service_healthy` is used for startup ordering (existing pattern). The `run-e2e.sh` health waits provide a complementary second layer — both are retained as defense-in-depth.

### 3.5 JWKS Bootstrap Protocol

**Purpose:** Reliable JWKS sharing between arrakis (issuer) and loa-finn (audience) via shared volume.

**Existing mechanism — sole writer is `e2e-entrypoint.sh` (arrakis-e2e container CMD):**

The arrakis-e2e Docker image uses `e2e-entrypoint.sh` as its CMD (see `themes/sietch/Dockerfile` line 189). This script:
1. Starts the Node.js server in the background (`node dist/index.js &`)
2. Waits for `/health` to become available
3. Curls `/.well-known/jwks.json` from the local server to a `.tmp` file
4. Validates JSON with `jq`
5. Performs POSIX-atomic `mv` rename to `/shared/arrakis-jwks.json`

loa-finn-e2e mounts the same `jwks-shared` volume read-only and reads the file via `ARRAKIS_JWKS_FILE=/shared/arrakis-jwks.json`.

**This mechanism already exists and is fully atomic.** The Dockerfile installs `jq` for validation (line 184). No arrakis application code changes are needed — the "zero new application logic" scope constraint is satisfied.

**Enhancements for this cycle (all in E2E test infrastructure — no arrakis runtime changes):**

1. **Atomic write — already implemented:** The existing `e2e-entrypoint.sh` (lines 36-54) performs: `curl → .tmp → jq validate → mv`. This is the sole writer of `/shared/arrakis-jwks.json`. No changes needed.
2. **Health gate:** loa-finn stub's `/v1/health` endpoint is modified to return unhealthy (503) until the JWKS file exists and parses as valid JSON. This ensures `run-e2e.sh`'s `wait_for_health` blocks until JWKS is ready. This change is in `loa-finn-e2e-stub.ts` (test infrastructure), not arrakis.
3. **Public key only:** The JWKS file contains only the public key (`kty`, `crv`, `x`, `y`, `kid`). Private key (`d` parameter) never leaves arrakis process memory. This is already the case — verified during implementation.
4. **Negative test:** A dedicated E2E test case verifies loa-finn stub rejects JWTs when JWKS file is absent or contains malformed JSON. This is a new test file, not an arrakis change.

**JWT claim requirements (NFR-5):**

```typescript
// arrakis signs with these claims:
{
  iss: 'arrakis-e2e',          // Issuer identity
  aud: 'loa-finn-e2e',         // Audience
  exp: Math.floor(Date.now()/1000) + 300,  // 5 min max TTL
  iat: Math.floor(Date.now()/1000),
  jti: crypto.randomUUID(),    // Unique token ID
  sub: 'billing-finalize',     // Subject (operation)
}

// loa-finn validates:
// - iss === 'arrakis-e2e'
// - aud === 'loa-finn-e2e'
// - exp > now - 30s (30s clock skew tolerance)
// - jti not seen before within TTL window
// - kid matches JWKS entry
// - signature valid against public key
```

### 3.6 Admin Setup Guide Structure

**Purpose:** Step-by-step deployment guide for community admins.

**File:** `themes/sietch/docs/ADMIN_SETUP_GUIDE.md`

**Structure:**
```markdown
# Admin Setup Guide

## Prerequisites
- Node.js 20+, Docker, git
- Discord account with server admin permissions

## 1. Discord Application Setup
- Create application at discord.com/developers
- Create bot, copy token
- Configure OAuth2 scopes and permissions
- Invite bot to server

## 2. Environment Configuration
### Minimal Viable Config (~15 vars)
- DISCORD_BOT_TOKEN, GUILD_ID, CLIENT_ID
- DATABASE_PATH (SQLite)
- FEATURE_BILLING_ENABLED=false (start without billing)
- [remaining critical vars from .env.example]

### Full Configuration
- Reference to .env.example with descriptions

## 3. Database Initialization
- pnpm run db:migrate
- pnpm run db:seed (if applicable)

## 4. Starting the Bot
- pnpm run dev (development)
- docker compose up (production-like)

## 5. Feature Flags
| Flag | Default | Description | Safe to Disable? |
|------|---------|-------------|-----------------|
| FEATURE_BILLING_ENABLED | false | Credit billing | Yes (start without) |
| X402_ENABLED | false | Payment middleware | Yes |
| IDENTITY_ANCHOR_ENABLED | false | High-value anchoring | Yes |

## 6. Verification Checklist
- [ ] Bot appears online in Discord
- [ ] /help slash command responds
- [ ] /health endpoint returns 200
- [ ] Slash commands registered (may take ~1 hour)

## 7. Troubleshooting
- Missing DISCORD_BOT_TOKEN → "Used disallowed intents"
- Missing GUILD_ID → "Cannot read guild"
- Rate limits → "429 Too Many Requests"
```

**Key design decisions:**
- Minimal viable config section first — get the bot running before configuring everything.
- Feature flags table with "Safe to Disable?" — reduces overwhelm for initial setup.
- Verification checklist is the RTFM pass/fail gate (AC-3.5, AC-3.6).
- References actual env var names from `.env.example` — no hypothetical names.

### 3.7 Staging Deployment Checklist Structure

**Purpose:** Operational checklist for staging deployment.

**File:** `themes/sietch/docs/STAGING_CHECKLIST.md`

**Structure:**
```markdown
# Staging Deployment Checklist

## Secrets Inventory
Derived from infrastructure/terraform/variables.tf + .env.example

| Secret | Terraform Module | .env.example Var | Status |
|--------|-----------------|------------------|--------|
| discord-bot-token | ecs-task-def | DISCORD_BOT_TOKEN | placeholder |
| rds-password | rds-instance | DATABASE_URL | placeholder |
| [... enumerate all] |

## Pre-Deployment
- [ ] All secrets have real values (not placeholder)
- [ ] Discord bot token rotated (current one expired)
- [ ] terraform plan shows no unexpected changes

## Deployment Steps
- [ ] Run database migrations
- [ ] Deploy via terraform apply
- [ ] Verify /health returns 200

## Verification Gate
- [ ] terraform plan succeeds (no drift)
- [ ] Service /health endpoint returns 200
```

### 3.8 Onboarding Documentation Update

**Purpose:** Replace Collab.Land references with in-house `/verify`.

**Files affected:**
- `themes/sietch/docs/community/onboarding.md` — primary onboarding guide
- Any file in `themes/sietch/docs/` referencing "Collab.Land" or "collabland"

**Approach:**
1. `grep -rl "collab.land\|Collab.Land\|collabland" themes/sietch/docs/` to find all references
2. Replace wallet verification flow description with EIP-191 `/verify` command
3. Update `.env.example` placeholder Discord IDs with descriptive comments

### 3.9 CI Pipeline Design

**Purpose:** Run unit, integration, and E2E tests in CI with appropriate infrastructure.

**Approach:** Extend existing `e2e-billing.yml` rather than creating new workflows.

**CI Job Matrix:**

| Job | Trigger | Infrastructure | Script | Timeout |
|-----|---------|---------------|--------|---------|
| `unit` | PR, push to main | None | `pnpm test:unit` | 5 min |
| `integration` | PR, push to main | Redis service container | `pnpm test:integration` | 10 min |
| `e2e` | PR (billing paths), push to main | Docker Compose (full topology) | `./tests/e2e/run-e2e.sh` | 15 min |

**Unit job (new, in existing `ci.yml`):**
```yaml
unit-tests:
  runs-on: ubuntu-latest
  timeout-minutes: 5
  steps:
    - uses: actions/checkout@v4
    - uses: pnpm/action-setup@v4
    - uses: actions/setup-node@v4
      with: { node-version: 22, cache: pnpm }
    - run: pnpm install --frozen-lockfile
    - run: cd themes/sietch && pnpm test:unit
```

**Integration job (new, in existing `ci.yml`):**
```yaml
integration-tests:
  runs-on: ubuntu-latest
  timeout-minutes: 10
  services:
    redis:
      image: redis:7-alpine
      ports: ['6379:6379']
      options: --health-cmd "redis-cli ping" --health-interval 5s
  steps:
    - uses: actions/checkout@v4
    - uses: pnpm/action-setup@v4
    - uses: actions/setup-node@v4
      with: { node-version: 22, cache: pnpm }
    - run: pnpm install --frozen-lockfile
    - run: cd themes/sietch && pnpm test:integration
```

**E2E job (existing `e2e-billing.yml`, modified):**
- Replace manual health-wait loop with `run-e2e.sh`
- Add `--remove-orphans` to teardown
- Add failure artifact collection (container logs):

```yaml
    - name: Run E2E tests
      run: ./tests/e2e/run-e2e.sh
      env:
        E2E_LOG_DIR: tests/e2e/logs

    - name: Upload E2E logs on failure
      if: failure()
      uses: actions/upload-artifact@v4
      with:
        name: e2e-compose-logs
        path: tests/e2e/logs/
        retention-days: 7
```

---

## 4. Security Architecture

### 4.1 JWT/JWKS Security (NFR-5)

| Aspect | Requirement | Implementation |
|--------|-------------|----------------|
| Algorithm | ES256 (P-256) | `jose` library, `generateKeyPair('ES256')` |
| Key lifecycle | Ephemeral per run | Generated at container startup, discarded on `down -v` |
| Key storage | Public JWKS only in shared volume | Private key in arrakis process memory only |
| Mandatory claims | iss, aud, exp, iat, jti | Validated by loa-finn stub |
| Clock skew | 30 seconds | `clockTolerance: '30s'` in jose options |
| Token TTL | 5 minutes max | `exp - iat <= 300` |
| Replay protection | jti uniqueness | In-memory Set in loa-finn stub (cleared per run) |
| Secrets scanning | No committed credentials | `.gitignore` covers `.env`, `.env.*` (not `.env.example`) |

### 4.2 Network Isolation (Three-Layer Defense)

| Layer | Mechanism | What it prevents |
|-------|-----------|-----------------|
| Test design (Primary) | In-repo stubs only, no external API imports | Accidental external API calls at code level |
| No credentials (CI) | External API keys not in E2E environment | Auth failure if external call attempted |
| Metadata endpoint block | `extra_hosts` maps 169.254.169.254 to 127.0.0.1 | Cloud metadata SSRF, credential leakage |
| Static egress assertion | Post-test `/proc/net/tcp` inspection for non-RFC1918 connections | Catches accidental unauthenticated external calls |

Note: Docker `internal: true` network was considered but rejected — it does not reliably block egress when ports are published to host, and adds routing complexity. Hard egress enforcement (iptables DOCKER-USER rules) is deferred as out-of-scope for "no new infrastructure." The four-layer defense achieves pragmatic isolation for this cycle.

---

## 5. File Inventory

### 5.1 New Files

| File | Purpose | FR |
|------|---------|-----|
| `tests/e2e/run-e2e.sh` | Deterministic E2E host-side runner | FR-1 |
| `themes/sietch/vitest.workspace.ts` | Unit/integration project split | FR-2 |
| `themes/sietch/docs/ADMIN_SETUP_GUIDE.md` | Community admin deployment guide | FR-3 |
| `themes/sietch/docs/STAGING_CHECKLIST.md` | Staging deployment checklist | FR-5 |

### 5.2 Modified Files

| File | Change | FR |
|------|--------|-----|
| `tests/e2e/docker-compose.e2e.yml` | Preserve single-network topology, fix any bitrot, verify published ports | FR-1, FR-6 |
| `tests/e2e/loa-finn-e2e-stub.ts` | JWKS health gate, atomic write validation, jti replay check | FR-1, NFR-5 |
| `themes/sietch/vitest.config.ts` | Adjust for workspace compatibility | FR-2 |
| `themes/sietch/package.json` | Add test:unit, test:integration, test:e2e scripts | FR-2 |
| `themes/sietch/docs/community/onboarding.md` | Replace Collab.Land with /verify | FR-4 |
| `.github/workflows/ci.yml` | Add unit + integration CI jobs | FR-7 |
| `.github/workflows/e2e-billing.yml` | Use run-e2e.sh, add artifact collection | FR-7 |
| `themes/sietch/.env.example` | Replace placeholder Discord IDs with instructions | FR-4 |

### 5.3 Renamed Files (Test Reclassification)

Files identified during the Redis audit (Section 3.3) will be renamed from `*.test.ts` to `*.integration.test.ts`. The exact list is determined during implementation — estimated ~20-30 files based on 202 ECONNREFUSED errors and the assumption that most can be mocked rather than reclassified.

---

## 6. Technical Risks & Mitigation

| Risk | Severity | Mitigation |
|------|----------|------------|
| E2E containers could make external calls if misconfigured | Medium | Three-layer defense (3.4): no external credentials in CI, stub-only endpoints, post-test static assertion |
| Vitest workspace changes break existing test runs | Medium | `pnpm test` defaults to `--project unit` — same behavior as before minus Redis tests |
| JWKS file race condition (reader before writer) | Low | Health gate (3.5): loa-finn reports unhealthy until JWKS exists |
| Test reclassification misses some Redis-dependent files | Medium | CI integration job will catch: if a `*.test.ts` still imports Redis, unit job fails with ECONNREFUSED |
| `.env.example` changes confuse existing developers | Low | Add clear comments: `# Replace with your Discord Application ID` |
| E2E timeout too short for CI runners | Medium | 120s test timeout + 60s health wait; CI job timeout 15 min total |

---

## 7. Appendix: Goal → Component Traceability

| Goal | Components | Acceptance Criteria |
|------|-----------|-------------------|
| G-1 | 3.1 (runner), 3.4 (network), 3.5 (JWKS) | AC-1.1 through AC-1.9 |
| G-2 | 3.2 (workspace), 3.3 (classification) | AC-2.1 through AC-2.5 |
| G-3 | 3.6 (admin guide) | AC-3.1 through AC-3.6 |
| G-4 | 3.8 (onboarding update) | AC-4.1 through AC-4.3 |
| G-5 | 3.7 (staging checklist) | AC-5.1 through AC-5.5 |
| G-6 | 3.4 (network isolation), 3.5 (JWKS) | AC-6.1 through AC-6.6 |
| G-7 | 3.9 (CI pipeline) | AC-7.1 through AC-7.5 |

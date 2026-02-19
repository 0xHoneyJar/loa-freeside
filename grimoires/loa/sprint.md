# Sprint Plan: The Neuromancer Codex — Documentation as Product Surface

**Version:** 1.0.0
**Date:** 2026-02-19
**Cycle:** cycle-035
**PRD:** grimoires/loa/prd.md (v1.1.0)
**SDD:** grimoires/loa/sdd.md (v1.0.0)
**Global Sprint IDs:** 304–306
**Duration:** 10 working days across 3 sprints
**Team:** 1 engineer (AI-assisted)

---

## Sprint Overview

| Sprint | Global ID | Phase | Days | Focus | Gate |
|--------|-----------|-------|------|-------|------|
| Sprint 1 | 304 | Phase A | Days 1–2 | Identity | P0 docs review-ready |
| Sprint 2 | 305 | Phase B+C | Days 3–7 | Developer Surface + Infrastructure | Smoke-test passes, terraform plan clean |
| Sprint 3 | 306 | Phase D+E | Days 8–10 | Polish + Validation | All success criteria met |

**Dependency chain:** Sprint 1 → Sprint 2 → Sprint 3 (sequential gates)
**Parallel opportunity:** Within Sprint 2, API docs and IaC docs run in parallel.

**Prerequisites:**
- jq >=1.7 installed (via `brew install jq`, `apt install jq`, or pinned in `.tool-versions` for asdf/mise). CI runner must also satisfy this. Scripts check at startup and fail with exit 13 if not met.
- Node.js >=20 with ts-morph available (for route extraction in Sprint 2)
- `gh` CLI authenticated (for citation pinning in Sprint 3)

**Local dev environment setup (prerequisite for smoke tests):**
- Clone repo, `pnpm install`
- Copy `.env.example` to `.env`, fill required values (DATABASE_URL, REDIS_URL, JWT_SECRET)
- Run `docker-compose up -d` for Postgres + Redis (or use local instances)
- Run `pnpm run dev` — server starts on `localhost:3000`
- Verify: `curl http://localhost:3000/api/agents/health` returns 200
- For JWT: `gaib auth setup-dev && export JWT=$(gaib auth token --dev)`

**CI toolchain pinning (`.tool-versions`):**
```
jq 1.7.1
nodejs 20.11.0
```
CI runners must use these exact versions. `cloc` version pinned in CI config. Hash computations exclude nondeterministic fields (timestamps, absolute paths) — only content-derived fields are hashed.

**Capacity planning:**
- **Estimated total effort:** ~45–55 hours across 10 days
- **AI-assisted velocity multiplier:** ~2–3x for documentation tasks (AI drafts, human validates)
- **Buffer:** 15% buffer built into Sprint 2 (5 days for ~3.5 days of work)
- **Cut-line:** If Sprint 1 gate not met by Day 3, descope BUTTERFREEZONE golden vectors to Sprint 2 and IaC docs to document-only (no diagrams)

**Gate failure rollback:**
- Each sprint works on a feature branch: `docs/cycle-035-sprint-N`
- Gate failure → review failures, fix on same branch, re-attempt gate
- If gate is unachievable, revert branch to last passing commit, descope, and re-attempt
- No partial merges to main — all-or-nothing per sprint

**CI integration for validation scripts:**
- `scripts/rtfm-validate.sh` runs as GitHub Actions required check on PRs touching `docs/` or `*.md`
- `butterfreezone-validate.sh` runs on PRs touching `BUTTERFREEZONE.md` or `butterfreezone-gen.sh`
- `scripts/extract-routes.sh --diff` runs on PRs touching `themes/sietch/src/api/routes/`
- Naming grep check runs on all PRs as advisory (non-blocking for non-doc PRs)

**Weekly verification mechanism (post-launch):**
- Scheduled CI job (weekly) runs `scripts/rtfm-validate.sh` against main branch
- Failures create GitHub issue assigned to DRI from ownership table
- Triage SLA: 3 business days from issue creation
- Results logged to `grimoires/loa/NOTES.md`

---

## Sprint 1: IDENTITY (Global ID: 304)

**Goal:** Establish the new platform identity across the three P0 documents.
**Duration:** Days 1–2
**Gate:** README, BUTTERFREEZONE, and ECOSYSTEM are review-ready with zero naming violations.

### Task 1.1: README.md Rewrite

**ID:** S304-T1
**Priority:** P0
**Effort:** Large (4–6 hours)
**Dependencies:** None (first task)
**FR:** FR-1

**Description:**
Complete rewrite of README.md from "engagement intelligence platform" to "multi-model agent economy infrastructure platform." Ground every capability claim in source file citations using the unified `<!-- cite: ... -->` syntax.

**Acceptance Criteria:**
- [ ] Opens with accurate platform description (not "engagement intelligence")
- [ ] Feature inventory covers: multi-model inference, budget atomicity, token-gated capabilities, payment rails, multi-tenant RLS, Discord/TG/API distribution, IaC
- [ ] Each capability has `<!-- cite: loa-freeside:path -->` citation
- [ ] Architecture diagram reflects actual package/app/infrastructure/themes structure
- [ ] Ecosystem section covers all 5 repos with layer diagram
- [ ] Quick-start paths for developers (→ API-QUICKSTART) and operators (→ INSTALLATION)
- [ ] Technology stack table is current and accurate
- [ ] Documentation index table links to all new docs
- [ ] Zero "Arrakis" references in platform context
- [ ] Badges: version (from package.json), license

**Testing:**
- `grep -ci "arrakis" README.md` returns 0
- All `<!-- cite: ... -->` tags point to existing files
- Version badge matches package.json

### Task 1.2: BUTTERFREEZONE.md Regeneration

**ID:** S304-T2
**Priority:** P0
**Effort:** Large (4–6 hours)
**Dependencies:** S304-T1 (README establishes description alignment)
**FR:** FR-2

**Description:**
Regenerate BUTTERFREEZONE.md with the updated `butterfreezone-gen.sh` script. Implement the jq canonicalization pipeline, error taxonomy, and golden test vectors. The agent context must have real description, not "No description available."

**Acceptance Criteria:**
- [ ] Agent context: `name: loa-freeside`, `type: platform`, real `purpose:` description
- [ ] `key_files:` references actual platform files (core ports, agent gateway, billing, CLI, terraform)
- [ ] Capabilities section organized by domain with `<!-- cite: ... -->` per capability
- [ ] Interfaces section: REST routes, Discord commands, Telegram commands, CLI commands
- [ ] Module map with accurate file counts and LOC
- [ ] `butterfreezone-gen.sh` implements jq canonicalization (`jq -Sc '.'`, not RFC 8785)
- [ ] Error taxonomy implemented: exit codes 10–13, fail-closed on partial scan
- [ ] Minimum section requirement: agent_context, capabilities, interfaces, module_map
- [ ] `butterfreezone-validate.sh` re-computes hashes and compares
- [ ] Golden test vectors committed to `tests/fixtures/butterfreezone-golden/`
- [ ] At least 2 vectors: vector-001-routes and vector-003-full
- [ ] Cross-platform determinism: `LC_ALL=C sort` for file lists, LF normalization
- [ ] jq version check at script startup (>=1.7)
- [ ] `ground-truth-meta` block with per-section SHA-256 hashes

**Testing:**
- `butterfreezone-validate.sh` passes against generated output
- Golden vectors pass against fixture directories
- Agent context `purpose` is not "No description available"

### Task 1.3: docs/ECOSYSTEM.md Creation

**ID:** S304-T3
**Priority:** P0
**Effort:** Medium (3–4 hours)
**Dependencies:** None (parallel with T1)
**FR:** FR-3

**Description:**
Create comprehensive 5-repo ecosystem map replacing the stale 2-repo ECOSYSTEM-MAP.md. Include layer diagram, per-repo summaries, protocol contract flow, Neuromancer naming explanation, Web4 connection, and statistics.

**Acceptance Criteria:**
- [ ] Layer diagram shows all 5 repos with dependency arrows (Layer 1–5)
- [ ] Per-repo summary: purpose, key stats, primary interfaces, relationship to other repos
- [ ] Protocol contract flow section: how loa-hounfour schemas flow through the system
- [ ] Neuromancer naming map with Gibson references for all 5 repos
- [ ] Web4 vision connection (brief, not marketing)
- [ ] Statistics table with measurement method and commit SHA per repo
- [ ] `scripts/ecosystem-stats.sh` created — shallow-clone at pinned ref + cloc + test count
- [ ] Stats caching to `grimoires/loa/cache/ecosystem-stats.json` with 7-day TTL
- [ ] Zero "Arrakis" references

**Testing:**
- `scripts/ecosystem-stats.sh --fresh` runs successfully for loa-freeside (local)
- Layer diagram verified against actual package.json dependencies
- `grep -ci "arrakis" docs/ECOSYSTEM.md` returns 0

### Task 1.4: Naming Migration

**ID:** S304-T4
**Priority:** P0
**Effort:** Small (1–2 hours)
**Dependencies:** S304-T1, S304-T2, S304-T3 (applies to all Phase A docs)
**FR:** FR-8 (partial)

**Description:**
Validate all zero-tolerance files have zero "Arrakis" references. Add historical reference note to CHANGELOG.md and INSTALLATION.md.

**Acceptance Criteria:**
- [ ] Zero-tolerance naming grep passes for all 7 files
- [ ] CHANGELOG.md has historical reference note
- [ ] INSTALLATION.md has historical reference note in header

**Testing:**
- Naming grep validation: zero matches across all zero-tolerance files

---

## Sprint 2: DEVELOPER SURFACE + INFRASTRUCTURE (Global ID: 305)

**Goal:** Create the developer-facing API documentation and infrastructure documentation.
**Duration:** Days 3–7
**Gate:** Smoke-test checklist passes against local instance; `terraform plan` produces no errors.

### Task 2.0: Define Stable Endpoint List

**ID:** S305-T0
**Priority:** P0
**Effort:** Small (1 hour)
**Dependencies:** Sprint 1 complete
**FR:** FR-4 (prerequisite)

**Description:**
Lock the 7 guaranteed-stable endpoints in a single canonical source file (`docs/api/stable-endpoints.json`). This is the source of truth referenced by the quick-start, reference, smoke-test checklist, and stability labeling.

**Acceptance Criteria:**
- [ ] `docs/api/stable-endpoints.json` created with array of `{ method, path, auth, purpose }`
- [ ] Verified each endpoint exists in route source files
- [ ] Smoke-test checklist will be generated from this list
- [ ] Referenced by both API-QUICKSTART and API-REFERENCE

**Testing:**
- Each endpoint in the JSON responds (not 404) against local dev server

### Task 2.1: scripts/extract-routes.sh

**ID:** S305-T1
**Priority:** P1
**Effort:** Large (4–6 hours)
**Dependencies:** S305-T0 (stable list defined)
**FR:** FR-4 (tooling prerequisite)

**Description:**
Build the route extraction tool using ts-morph AST parsing. Define supported patterns, implement unresolvable pattern linter, create initial route snapshot.

**Acceptance Criteria:**
- [ ] Parses supported patterns: direct method calls, router.use sub-mounts, method chaining, path constants, middleware chains
- [ ] Flags unsupported patterns: template literals, dynamic/computed, conditional registration
- [ ] Unresolvable linter: fails if >5% of registrations are unresolvable
- [ ] Emits JSON: `{ method, full_path, auth, source_file, line }` sorted by `{method, full_path}`
- [ ] Route snapshot created at `scripts/route-snapshot.json`
- [ ] `--diff` mode compares against snapshot (new=info, missing=error, changed auth=warning)
- [ ] `--count` mode returns total extracted count

**Testing:**
- Extracts >=80 routes from current codebase
- Snapshot diff against freshly extracted routes shows zero missing

### Task 2.2: docs/API-QUICKSTART.md

**ID:** S305-T2
**Priority:** P1
**Effort:** Large (4–6 hours)
**Dependencies:** S305-T1 (route extraction for completeness verification)
**FR:** FR-4

**Description:**
"First agent call in 5 minutes" tutorial covering the 7 guaranteed-stable endpoints. Include local auth setup, copy-pastable curl examples, smoke-test checklist, and security disclaimers.

**Acceptance Criteria:**
- [ ] Local auth setup: `gaib auth setup-dev` + `gaib auth token --dev` flow
- [ ] Manual JWT alternative documented (openssl-based)
- [ ] 7 stable endpoints fully documented with curl, headers, request/response, errors
- [ ] Stability contract: compatibility, deprecation (2-cycle), versioning, change log, promotion
- [ ] Smoke-test checklist: numbered curl commands, expected status codes
- [ ] Security disclaimers: no private keys, separate JWKS, TTL, aud/iss validation
- [ ] AUTH_BYPASS documented with code-level safeguard requirement
- [ ] Zero "Arrakis" references

**Testing:**
- Smoke-test checklist passes against `npm run dev`
- JWT minting flow produces valid token accepted by local server

### Task 2.3: docs/API-REFERENCE.md

**ID:** S305-T3
**Priority:** P1
**Effort:** Medium (3–4 hours)
**Dependencies:** S305-T1, S305-T2
**FR:** FR-4

**Description:**
Two-tier API reference: Tier 1 stable endpoints with full docs, Tier 2 auto-extracted route index.

**Acceptance Criteria:**
- [ ] Tier 1: 7 stable endpoints with full request/response documentation
- [ ] Tier 2: Auto-extracted route index from `scripts/extract-routes.sh`
- [ ] Each Tier 2 route: method, path, auth, source file, stability label
- [ ] Tier 2 contract documented: may change without notice, no examples
- [ ] API-CHANGELOG.md created (initially empty, with format template)
- [ ] Promotion criteria: stable 2+ cycles, smoke-test coverage, full docs
- [ ] Zero "Arrakis" references

**Testing:**
- Route index count matches `scripts/extract-routes.sh --count`
- All Tier 1 endpoints appear as "Stable" in index

### Task 2.4: Tier 2 Contract Checks

**ID:** S305-T4
**Priority:** P1
**Effort:** Medium (2–3 hours)
**Dependencies:** S305-T1
**FR:** FR-4

**Description:**
Framework-agnostic integration test validating Tier 2 route contracts against a running local dev server via HTTP requests (not framework internals).

**Acceptance Criteria:**
- [ ] Auth requirement validation: for each indexed route, send unauthenticated HEAD/GET — expect 401/403 if auth required, 2xx/3xx if no auth
- [ ] Not-404 validation: all indexed routes respond (not 404)
- [ ] Results compared against route snapshot — divergence logged as warning
- [ ] Script: `scripts/verify-routes.sh` starts dev server, runs checks, reports
- [ ] Optional: runtime introspection via dev-only `/api/debug/routes` endpoint (if available, cross-check against AST; if not available, skip gracefully)

**Testing:**
- `scripts/verify-routes.sh` passes against local dev server
- Zero 404s for indexed routes

### Task 2.5: docs/CLI.md Update

**ID:** S305-T5
**Priority:** P1
**Effort:** Small (2–3 hours)
**Dependencies:** None (parallel)
**FR:** FR-6

**Description:**
Update CLI documentation to match current `gaib` implementation.

**Acceptance Criteria:**
- [ ] All gaib subcommands documented with usage and examples
- [ ] Installation instructions
- [ ] Configuration documentation
- [ ] Validated against `gaib --help` output

**Testing:**
- Every documented command exists in `gaib --help`

### Task 2.6: docs/INFRASTRUCTURE.md + Terraform Plan Harness

**ID:** S305-T6
**Priority:** P1
**Effort:** Large (4–6 hours)
**Dependencies:** None (parallel — Phase C)
**FR:** FR-5

**Description:**
Document the IaC story: deployment topology, Terraform modules, staging guide, monitoring, cost estimation. Also create a runnable Terraform plan harness for gate validation.

**Acceptance Criteria:**
- [ ] Architecture diagram: ECS → RDS → ElastiCache → ALB → Route53 → CloudWatch → KMS
- [ ] Module inventory: each `.tf` file with purpose and key variables
- [ ] Staging deployment guide: prerequisites, step-by-step, verification
- [ ] Monitoring: CloudWatch dashboards, alarms, log aggregation
- [ ] Cost estimation (~$150–200/mo) grounded in resource configs
- [ ] Production hardening checklist
- [ ] Security: KMS required, VPC/security group guidance, no credentials in docs
- [ ] Zero "Arrakis" references
- [ ] **Terraform plan harness:** `scripts/tf-plan.sh` created that:
  - Runs from the correct module directory (`infrastructure/terraform/`)
  - Uses `terraform init -backend=false` (no cloud credentials required)
  - Provides `terraform.tfvars.example` with safe dummy values for all required variables
  - Runs `terraform validate` + `terraform plan` with the example vars
  - Exits 0 if plan succeeds (gate pass), non-zero with error details (gate fail)

**Testing:**
- `scripts/tf-plan.sh` exits 0 locally without AWS credentials
- Every `.tf` file accounted for in module inventory

### Task 2.7: AUTH_BYPASS Code Safeguard

**ID:** S305-T7
**Priority:** P1
**Effort:** Small (1–2 hours)
**Dependencies:** None
**FR:** FR-4 (SKP-005)

**Description:**
Implement code-level AUTH_BYPASS protection: environment gate, startup check, build exclusion.

**Acceptance Criteria:**
- [ ] `AUTH_BYPASS` only honored when `NODE_ENV !== 'production'`
- [ ] Server refuses to start if `AUTH_BYPASS=true` and `NODE_ENV=production`
- [ ] Log warning emitted at startup when bypass enabled
- [ ] Production Docker build sets `NODE_ENV=production`

**Testing:**
- Setting `AUTH_BYPASS=true NODE_ENV=production` causes startup failure
- Setting `AUTH_BYPASS=true NODE_ENV=development` works with warning log

---

## Sprint 3: POLISH + VALIDATION (Global ID: 306)

**Goal:** Complete the documentation suite with cross-links, ownership, citations, and pass all validation gates.
**Duration:** Days 8–10
**Gate:** RTFM validation passes, all success criteria met.

### Task 3.1: docs/DEVELOPER-GUIDE.md

**ID:** S306-T1
**Priority:** P1
**Effort:** Medium (2–3 hours)
**Dependencies:** All Sprint 2 docs complete
**FR:** FR-7, FR-9

**Description:**
Onboarding index page with sequential learning path and ownership table.

**Acceptance Criteria:**
- [ ] Sequential path: README → ECOSYSTEM → API-QUICKSTART → API-REFERENCE → INFRASTRUCTURE → CLI
- [ ] Ownership table: every document has DRI, update trigger, review cadence
- [ ] Versioning headers: each doc has version (v1.0.0)
- [ ] Errata process documented
- [ ] Zero "Arrakis" references

**Testing:**
- Every document link resolves to existing file
- Ownership table covers all 8 documents

### Task 3.2: Cross-Links

**ID:** S306-T2
**Priority:** P1
**Effort:** Small (1–2 hours)
**Dependencies:** S306-T1
**FR:** FR-7

**Description:**
Add "Next Steps" section to every document linking to logical next document.

**Acceptance Criteria:**
- [ ] Every doc ends with "Next Steps"
- [ ] Links follow cross-reference map
- [ ] All links resolve

**Testing:**
- Zero broken links in cross-link check

### Task 3.3: Citation Pinning

**ID:** S306-T3
**Priority:** P0
**Effort:** Medium (3–4 hours)
**Dependencies:** All docs written
**FR:** NFR-1

**Description:**
Create `scripts/pin-citations.sh` and run against all docs.

**Acceptance Criteria:**
- [ ] Scans `<!-- cite: ... -->` tags across all docs
- [ ] Resolves cross-repo references to commit SHA permalinks via `gh api`
- [ ] Validates local references against filesystem
- [ ] Retry/backoff: 3 retries with exponential backoff
- [ ] Rate limiting: respects GitHub API limits
- [ ] Offline mode: `--validate-only`
- [ ] Caching: `grimoires/loa/cache/citation-pins.json`
- [ ] `--check-stale` mode for >30 day old pins
- [ ] Zero branch-relative links in docs

**Testing:**
- `scripts/pin-citations.sh --validate-only` passes
- `grep -P 'github\.com.*/(tree|blob)/(main|develop|master)' docs/*.md` returns 0

### Task 3.4: Implement RTFM Validator

**ID:** S306-T4
**Priority:** P0
**Effort:** Medium (3–4 hours)
**Dependencies:** S306-T2, S306-T3
**FR:** FR-8

**Description:**
Create `scripts/rtfm-validate.sh` that runs all 8 validation checks with deterministic exit codes, then run it against the full documentation set.

**Acceptance Criteria:**
- [ ] `scripts/rtfm-validate.sh` created with 8 named checks:
  1. Citation validity: parse `<!-- cite: ... -->` regex, verify local files exist, cross-repo refs well-formed
  2. Naming compliance: `grep -ci "arrakis"` across zero-tolerance file list (hardcoded in script)
  3. Version consistency: compare package.json version against README badge and BUTTERFREEZONE
  4. Cross-link integrity: extract all Markdown links from docs, verify targets exist
  5. Cross-repo citation stability: `grep -P 'github\.com.*/(tree|blob)/(main|develop|master)' docs/*.md`
  6. Completeness: `grep -ri "TODO\|TBD\|PLACEHOLDER" docs/` returns 0
  7. BUTTERFREEZONE hash: runs `butterfreezone-validate.sh` and checks exit code
  8. Route index completeness: `scripts/extract-routes.sh --diff scripts/route-snapshot.json` exits 0
- [ ] Each check reports PASS/FAIL with details
- [ ] Script exits 0 only if ALL checks pass; non-zero with summary of failures
- [ ] All 8 checks pass against current documentation

**Testing:**
- `scripts/rtfm-validate.sh` exits 0 (all checks pass)
- Deliberately introduce a broken link → verify check #4 catches it (then revert)

### Task 3.5: Final Verification

**ID:** S306-T5
**Priority:** P0
**Effort:** Small (1–2 hours)
**Dependencies:** S306-T4
**FR:** FR-10

**Description:**
Verify all PRD §8 success criteria are met.

**Acceptance Criteria:**
- [ ] README accurately describes platform
- [ ] BUTTERFREEZONE valid and grounded
- [ ] Ecosystem covers all 5 repos
- [ ] Zero naming violations
- [ ] API quick-start enables first call
- [ ] IaC docs enable staging understanding
- [ ] RTFM passes
- [ ] Onboarding path is clear and sequential
- [ ] Ownership table committed
- [ ] Weekly verification process documented

**Testing:**
- All PRD §8 success criteria verified

---

## Task Dependency Graph

```
Sprint 1 (Days 1-2):
  S304-T1 (README) ──────────┐
  S304-T3 (ECOSYSTEM) ───────┤
                              ├──→ S304-T4 (Naming) ──→ GATE: P0 review-ready
  S304-T1 → S304-T2 (BUTTER) ┘

Sprint 2 (Days 3-7):
  S305-T0 (stable-endpoints) ─→ S305-T1 (extract-routes) ─→ S305-T2 (QUICKSTART) ─→ S305-T3 (REFERENCE)
                                                           ─→ S305-T4 (Contract checks)
  S305-T5 (CLI) ──────────────── parallel ──────────────────
  S305-T6 (INFRA + tf-plan) ──── parallel ──────────────────→ GATE: smoke + tf-plan.sh
  S305-T7 (AUTH_BYPASS) ──────── parallel ──────────────────

Sprint 3 (Days 8-10):
  S306-T1 (DEV-GUIDE) ──→ S306-T2 (Cross-links)
  S306-T3 (Citations) ──→ S306-T4 (RTFM validator) ──→ S306-T5 (Final) ──→ GATE: all criteria
```

---

## Risk Mitigation

| Risk | Trigger | Action |
|------|---------|--------|
| Phase A takes >3 days | Day 3 without gate pass | Descope IaC to document-only (no diagrams) |
| Smoke-test failures | >3 endpoints fail | Reduce stable subset to passing endpoints |
| Route extraction <80 | Unresolvable patterns | Add manual entries; update baseline |
| Citation pinning API limits | Rate limited | Use cached pins; defer cross-repo to post-sprint |
| BUTTERFREEZONE hash instability | Cross-platform mismatch | Pin exact jq version in CI |

---

## Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Naming compliance | 0 violations | `grep -ci "arrakis"` across zero-tolerance files |
| Citation grounding | 100% sourced | RTFM citation check |
| Smoke-test pass rate | 7/7 stable endpoints | Smoke-test checklist |
| Route index coverage | >=80 routes | `extract-routes.sh --count` |
| BUTTERFREEZONE validity | All hashes match | `butterfreezone-validate.sh` |
| Doc completeness | 0 placeholders | `grep -ri "TODO\|TBD\|PLACEHOLDER" docs/` |
| Cross-link integrity | 0 broken links | RTFM cross-link check |

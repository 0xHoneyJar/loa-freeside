# Sprint Plan: The Neuromancer Codex — Documentation as Product Surface

**Version:** 1.3.0
**Date:** 2026-02-20
**Cycle:** cycle-035
**PRD:** grimoires/loa/prd.md (v1.1.0)
**SDD:** grimoires/loa/sdd.md (v1.0.0)
**Global Sprint IDs:** 304–313
**Duration:** 17 working days across 10 sprints
**Team:** 1 engineer (AI-assisted)

---

## Sprint Overview

| Sprint | Global ID | Phase | Days | Focus | Gate |
|--------|-----------|-------|------|-------|------|
| Sprint 1 | 304 | Phase A | Days 1–2 | Identity | P0 docs review-ready |
| Sprint 2 | 305 | Phase B+C | Days 3–7 | Developer Surface + Infrastructure | Smoke-test passes, terraform plan clean |
| Sprint 3 | 306 | Phase D+E | Days 8–10 | Polish + Validation | All success criteria met |
| Sprint 4 | 307 | Phase F | Day 11 | Educational Deep Docs | ECONOMICS.md + EVENT-PROTOCOL.md grounded |
| Sprint 5 | 308 | Phase G | Day 12 | Merge Prep | RTFM 8/8 pass, PR ready for review |
| Sprint 6 | 309 | Phase H | Day 13 | Bridge Findings | Bridgebuilder findings addressed, RTFM 8/8 |
| Sprint 7 | 310 | Phase I | Day 14 | Protocol Stability & Governance | NATS stability tiers, doc semver governance |
| Sprint 8 | 311 | Phase J | Days 15–16 | Cross-Repo Education | Multi-repo learning journey, concept glossary |
| Sprint 9 | 312 | Phase K | Day 17 | Protocol Formalization & Discovery | Economic spec deepening, BUTTERFREEZONE discovery |
| Sprint 10 | 313 | Phase L | Day 17 | Final Excellence & Merge | RTFM 8/8, citations, PR update |

**Dependency chain:** Sprint 1 → Sprint 2 → Sprint 3 (sequential gates)
**Parallel opportunity:** Within Sprint 2, API docs and IaC docs run in parallel.
**Phase I–L dependency:** Sprint 7 → Sprint 8 (stability tiers referenced in learning path). Sprint 9 parallel with Sprint 8. Sprint 10 depends on all.

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
Build the route extraction tool. Preferred approach is ts-morph AST parsing; if AST proves impractical, a grep-based pattern matcher on Express `router.METHOD()` calls is an acceptable pragmatic alternative (document the chosen approach in the script header). Define supported patterns, implement unresolvable pattern linter, create initial route snapshot.

**Acceptance Criteria:**
- [ ] Parses supported patterns: direct method calls, router.use sub-mounts, method chaining, path constants, middleware chains (AST), or equivalent grep patterns for `router.get/post/put/delete/patch()` calls
- [ ] Flags unsupported patterns: template literals, dynamic/computed, conditional registration
- [ ] Unresolvable linter: fails if >5% of registrations are unresolvable (AST mode) or logs advisory for grep mode
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
- [ ] Auth requirement validation: for each indexed GET route, send unauthenticated GET — expect 401/403 if auth required, 2xx/3xx if no auth. Non-GET routes (POST/PUT/DELETE) are verified as not-404 only via OPTIONS or HEAD (treat 405 as non-fatal pass)
- [ ] Not-404 validation: all indexed GET routes respond (not 404); non-GET routes verified via safe probe only
- [ ] Per-route probe method override supported in extracted JSON (`probe_method` field, default GET)
- [ ] Non-idempotent routes (POST/PUT/DELETE) are never sent with bodies — probe only for existence
- [ ] Results compared against route snapshot — divergence logged as warning
- [ ] Script: `scripts/verify-routes.sh` starts dev server, runs checks, reports
- [ ] Optional: runtime introspection via dev-only `/api/debug/routes` endpoint (if available, cross-check against extraction; if not available, skip gracefully)

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
  2. Naming compliance: `grep -ci "arrakis"` across zero-tolerance file list (hardcoded in script), **exempting** code-path citations inside `<!-- cite: ... -->` blocks (these reference source filenames which are out-of-scope for doc-level renaming per PRD §3). Implementation: strip `<!-- cite: ... -->` blocks before grep, or use `grep -P` negative lookahead.
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
| Naming compliance | 0 violations in prose | `grep -ci "arrakis"` across zero-tolerance files (exempting `<!-- cite: ... -->` blocks) |
| Citation grounding | 100% sourced | RTFM citation check |
| Smoke-test pass rate | 7/7 stable endpoints | Smoke-test checklist |
| Route index coverage | >=80 routes | `extract-routes.sh --count` |
| BUTTERFREEZONE validity | All hashes match | `butterfreezone-validate.sh` |
| Doc completeness | 0 placeholders | `grep -ri "TODO\|TBD\|PLACEHOLDER" docs/` |
| Cross-link integrity | 0 broken links | RTFM cross-link check |

---

## Sprint 4: EDUCATIONAL DEEP DOCS (Global ID: 307)

**Goal:** Create the economic primitives and event protocol documentation suggested by the Bridgebuilder review. Add cross-repo learning path and route coverage note.
**Duration:** Day 11
**Gate:** ECONOMICS.md and EVENT-PROTOCOL.md pass citation validation; cross-repo learning path added to ECOSYSTEM.md.
**Source:** [Bridgebuilder Review — PR #76](https://github.com/0xHoneyJar/loa-freeside/pull/76#issuecomment-3927347470) findings high-1, high-2, medium-2, medium-3.

### Task 4.1: docs/ECONOMICS.md — Economic Primitives Documentation

**ID:** S307-T1
**Priority:** P0
**Effort:** Large (4–6 hours)
**Dependencies:** Sprint 3 complete
**Source:** Bridgebuilder finding high-1 ("Economic primitives undocumented")

**Description:**
Document the economic model that underpins the platform: budget-atomic accounting, conservation invariant, lot lifecycle, conviction-to-tier mapping, and ensemble cost attribution. Ground every claim in source citations. Include worked examples and failure mode guarantees.

This is the document that transforms "interesting project" into "serious protocol." The economic primitives — BigInt micro-USD precision, two-counter atomic reservation, conservation properties enforced via Lua scripts — are the platform's deepest moat and deserve the most thorough documentation.

**Pre-flight (first step):** Verify all source paths exist and extract exact counts/types from code before writing prose. Confirmed source paths (from codebase analysis):
- `packages/adapters/agent/budget-manager.ts` — BudgetResult/FinalizeResult types, reserve/finalize/reap methods
- `packages/adapters/agent/lua/budget-reserve.lua` — Atomic reservation Lua script
- `packages/adapters/agent/lua/budget-finalize.lua` — Atomic finalization Lua script
- `themes/sietch/src/packages/core/protocol/arrakis-conservation.ts` — Conservation adapter (imports from loa-hounfour). Note: this is a code-level file path; code-level renaming is explicitly out of scope per PRD §3. Citations to code paths may use the original filename.
- `themes/sietch/src/services/TierService.ts` — 9-tier conviction system
- `packages/adapters/agent/pool-mapping.ts` — Pool→tier access mapping
- `packages/adapters/agent/ensemble-accounting.ts` — Per-model cost attribution

**Content Outline:**
1. **Overview** — What makes this an economic protocol, not just billing
2. **Budget Accounting Model** — Two-counter system (committed + reserved), micro-USD precision, monthly reset lifecycle
   - Source: `packages/adapters/agent/budget-manager.ts`, `budget-reserve.lua`, `budget-finalize.lua`
3. **Lot Lifecycle** — reserve → finalize → reap with idempotency guarantees
   - Worked example: complete request flow from reservation to finalization
   - Failure modes: late finalize, expired reservation, Redis errors (fail-closed reserve, fail-open finalize)
4. **Conservation Invariant** — Canonical properties from loa-hounfour as normative set
   - List all 14 canonical properties from loa-hounfour as the normative reference
   - Separately document which subset is enforced in freeside (with citations to freeside enforcement points in `arrakis-conservation.ts`)
   - Treat the freeside adapter list as "implemented coverage," not the canonical list
   - Universe scopes: per-lot, per-account, cross-system, platform-wide
   - Enforcement mechanisms: DB CHECK, DB UNIQUE, Application, Reconciliation-only
   - Note: canonical property count and details extracted from source at write time, not hardcoded in plan
5. **Conviction Scoring → Capability Tiers** — Tier system from BGT holdings
   - Threshold table extracted from `TierService.ts` at write time
   - Rank precedence rules as implemented
   - Tier → pool access mapping from `pool-mapping.ts` protocol conformance tests
6. **Ensemble Cost Attribution** — Per-model breakdown with PLATFORM_BUDGET vs BYOK_NO_BUDGET accounting modes
   - Savings calculation: reserved - actual
7. **Model Pricing** — Default pricing table per pool (from DEFAULT_MODEL_PRICING in budget-manager.ts)
8. **Guarantees** — What the system promises: no precision loss, no double-charge, fail-closed reservation

**Acceptance Criteria:**
- [ ] Pre-flight: all source paths verified to exist; exact counts/types extracted from code
- [ ] Every section has `<!-- cite: loa-freeside:path -->` citation(s) to source code
- [ ] Conservation invariant section uses loa-hounfour as the canonical source (14 properties), then documents which subset is enforced in freeside's `arrakis-conservation.ts` adapter with citations to both
- [ ] Worked example covers complete reserve → finalize → reap flow
- [ ] Failure modes table covers at least: late finalize, expired reservation, Redis failure, budget exceeded
- [ ] Conviction tier table matches `TierService.ts` thresholds exactly (verified by reading source)
- [ ] Pool access matrix matches `pool-mapping.ts` protocol conformance tests (verified by reading source)
- [ ] Zero "Arrakis" references in platform prose (code-path citations inside `<!-- cite: ... -->` blocks are exempt per PRD §3 — code-level renaming is a separate cycle)
- [ ] `scripts/pin-citations.sh --validate-only` passes for this file

**Testing:**
- All citations resolve to existing files
- Naming check passes (after stripping cite blocks)
- Tier thresholds verified against TierService.ts source
- Pool access matrix verified against protocol-conformance.test.ts

### Task 4.2: docs/EVENT-PROTOCOL.md — NATS Event Schema Documentation

**ID:** S307-T2
**Priority:** P0
**Effort:** Medium (3–4 hours)
**Dependencies:** Sprint 3 complete (requires pin-citations.sh for validation gate)
**Source:** Bridgebuilder finding high-2 ("NATS event protocol has no API-level documentation")

**Description:**
Document the NATS event protocol at API level for Layer 5 product consumers. Cover stream configuration, subject namespaces, the GatewayEvent envelope schema, event data payloads, and subscription patterns. Reference Hounfour protocol types as the canonical schema source.

**Pre-flight (first step):** Extract actual stream names/counts from `nats-routing.json` and event types from `gateway-event.ts` before writing prose. Confirmed source paths:
- `packages/shared/nats-schemas/nats-routing.json` — Stream definitions
- `packages/shared/nats-schemas/src/schemas/gateway-event.ts` — GatewayEvent envelope + known event types
- `packages/shared/nats-schemas/src/schemas/event-data.ts` — Per-event payload types
- `packages/shared/nats-schemas/src/routing.ts` — Event type → subject mapping
- `apps/gateway/src/main.rs` — Rust/Axum gateway

**Content Outline:**
1. **Overview** — The event protocol as the machine-facing API surface
2. **Streams** — Document all JetStream streams found in `nats-routing.json` with subject patterns
   - Source: `packages/shared/nats-schemas/nats-routing.json`
3. **GatewayEvent Envelope** — Canonical message format (fields extracted from source at write time)
   - Source: `packages/shared/nats-schemas/src/schemas/gateway-event.ts`
4. **Event Type → Subject Mapping** — Document all mappings found in routing.ts
   - Source: `packages/shared/nats-schemas/src/routing.ts`
5. **Event Data Schemas** — Per-event payload types (document all types found in event-data.ts)
   - Source: `packages/shared/nats-schemas/src/schemas/event-data.ts`
6. **Subscription Patterns** — How to subscribe by guild, event type, wildcard
7. **Gateway Architecture** — Rust/Axum gateway (Discord WSS → NATS), shard pool configuration
   - Source: `apps/gateway/src/main.rs`
8. **Relationship to Hounfour** — Protocol types as canonical schema source

**Acceptance Criteria:**
- [ ] Pre-flight: extract exact stream count and event type list from source; use extracted values as ground truth
- [ ] All streams from `nats-routing.json` documented with subject patterns
- [ ] GatewayEvent envelope schema fully documented with field types
- [ ] All event types from `gateway-event.ts` mapped to subjects
- [ ] Event data schemas for all event types in `event-data.ts`
- [ ] Subscription pattern examples (by guild, by type, wildcard)
- [ ] Citations to NATS schema source files
- [ ] Cross-reference to Hounfour protocol types
- [ ] Zero "Arrakis" references
- [ ] `scripts/pin-citations.sh --validate-only` passes for this file

**Testing:**
- Event type list verified against gateway-event.ts known types (exact match)
- Stream configuration verified against nats-routing.json (exact match)
- Schema field types verified against TypeScript definitions

### Task 4.3: Cross-Repo Learning Path in ECOSYSTEM.md

**ID:** S307-T3
**Priority:** P1
**Effort:** Small (1–2 hours)
**Dependencies:** S307-T1, S307-T2 (references both new docs)
**Source:** Bridgebuilder finding medium-2 ("Cross-repo learning path missing")

**Description:**
Add a "Building on Loa" section to ECOSYSTEM.md that maps the cross-repo journey for developers building Layer 5 products. Connect the freeside-only learning path (DEVELOPER-GUIDE.md) to the ecosystem-wide onboarding journey.

**Content:**
- "Building on Loa" section after the per-repo summaries
- Journey map: Ecosystem overview → Protocol types (hounfour) → Platform APIs (freeside) → Runtime capabilities (finn) → Build your product (dixie as example)
- Role-based paths: API consumer, product builder, protocol contributor
- Cross-link to DEVELOPER-GUIDE.md for freeside-specific onboarding

**Acceptance Criteria:**
- [ ] "Building on Loa" section added to ECOSYSTEM.md
- [ ] 3 role-based paths documented
- [ ] Cross-repo references use repository links (not branch-relative); all compliant with RTFM crossrepo check
- [ ] Run `scripts/pin-citations.sh --validate-only` on updated ECOSYSTEM.md after adding section
- [ ] Links to DEVELOPER-GUIDE.md for freeside-specific deep dive
- [ ] Zero "Arrakis" references

**Testing:**
- All links resolve (cross-link check)
- No branch-relative GitHub links (crossrepo check)

### Task 4.4: Route Extraction Coverage Note

**ID:** S307-T4
**Priority:** P2
**Effort:** Small (30 min)
**Dependencies:** None
**Source:** Bridgebuilder finding medium-3 ("Route extraction coverage boundary undocumented")

**Description:**
Add a coverage boundary note to the API-REFERENCE.md Tier 2 section acknowledging that auto-extracted routes come from static analysis and may not capture dynamically registered or gateway-proxied routes.

Note: Sprint 2 plan specified ts-morph AST parsing, but the actual `extract-routes.sh` implementation uses grep-based pattern matching on Express router method calls (pragmatic divergence documented in implementation notes). The coverage note must describe the **actual** extraction method, not the planned one.

**Acceptance Criteria:**
- [ ] Note added below Tier 2 header explaining extraction method and coverage limitations
- [ ] Accurately describes actual method: grep-based pattern matching on Express `router.METHOD()` calls in `themes/sietch/src/api/routes/*.ts`
- [ ] Acknowledges: middleware chains, dynamic mounting, Rust gateway proxy routes may not appear

**Testing:**
- Note present in rendered markdown

---

## Sprint 5: MERGE PREP (Global ID: 308)

**Goal:** Update all validation tooling for the expanded document set, run final validation, and prepare PR #76 for merge.
**Duration:** Day 12
**Gate:** RTFM 8/8 checks pass (MANAGED_DOCS expanded to include new docs), PR marked ready for review.

### Task 5.1: Update RTFM Validator for New Documents

**ID:** S308-T1
**Priority:** P0
**Effort:** Small (1 hour)
**Dependencies:** Sprint 4 complete
**Source:** New docs must be in validation scope

**Description:**
Add `docs/ECONOMICS.md` and `docs/EVENT-PROTOCOL.md` to the `MANAGED_DOCS` array in `scripts/rtfm-validate.sh`. Update the naming zero-tolerance list. Note: no per-doc version headers are required for new docs; the existing versions check (check #3) validates only `docs/DEVELOPER-GUIDE.md` and `package.json` — no changes needed to that check.

**Acceptance Criteria:**
- [ ] `MANAGED_DOCS` array includes `docs/ECONOMICS.md` and `docs/EVENT-PROTOCOL.md`
- [ ] `zero_tolerance_files` array includes both new docs
- [ ] All 8 RTFM checks still pass after expansion

**Testing:**
- `scripts/rtfm-validate.sh` exits 0 with expanded scope

### Task 5.2: Update BUTTERFREEZONE.md

**ID:** S308-T2
**Priority:** P1
**Effort:** Small (30 min)
**Dependencies:** S308-T1

**Description:**
Update BUTTERFREEZONE.md to reference the new documentation (ECONOMICS.md, EVENT-PROTOCOL.md) in the interfaces or capabilities section.

**Acceptance Criteria:**
- [ ] New docs referenced in appropriate BUTTERFREEZONE section
- [ ] `butterfreezone-validate.sh` still passes (or passes with advisory warnings only)

**Testing:**
- `butterfreezone-validate.sh` exit code 0 or 2

### Task 5.3: Update DEVELOPER-GUIDE.md

**ID:** S308-T3
**Priority:** P1
**Effort:** Small (30 min)
**Dependencies:** S308-T1

**Description:**
Add ECONOMICS.md and EVENT-PROTOCOL.md to the learning path and ownership table in DEVELOPER-GUIDE.md.

**Acceptance Criteria:**
- [ ] Both new docs appear in learning path at appropriate positions
- [ ] Both new docs have DRI, update trigger, and review cadence in ownership table
- [ ] Cross-links resolve

**Testing:**
- All document links resolve

### Task 5.4: Full RTFM Validation + Citation Sweep

**ID:** S308-T4
**Priority:** P0
**Effort:** Small (1 hour)
**Dependencies:** S308-T1, S308-T2, S308-T3

**Description:**
Run full validation suite across all documents. Fix any issues found.

**Acceptance Criteria:**
- [ ] `scripts/rtfm-validate.sh` exits 0 — all 8 checks pass
- [ ] `scripts/pin-citations.sh --validate-only` passes for all new docs
- [ ] Zero naming violations across all zero-tolerance files
- [ ] Zero broken cross-links
- [ ] Zero placeholder markers (TODO/TBD/PLACEHOLDER/FIXME)

**Testing:**
- `scripts/rtfm-validate.sh` exits 0
- `scripts/pin-citations.sh --validate-only` exits 0

### Task 5.5: Update PR #76 for Merge

**ID:** S308-T5
**Priority:** P0
**Effort:** Small (1 hour)
**Dependencies:** S308-T4

**Description:**
Update PR #76 body with the complete sprint breakdown (304–308), mark as ready for review, and verify CI passes.

**Acceptance Criteria:**
- [ ] PR body updated with Sprint 4 and Sprint 5 summary
- [ ] Sprint breakdown table includes all 5 sprints with file counts
- [ ] PR marked as ready for review (not draft)
- [ ] CI docs-validation workflow passes
- [ ] Final commit message follows conventional commit format

**Testing:**
- `gh pr view 76 --json isDraft` returns false
- CI checks pass

---

## Sprint 4–5 Task Dependency Graph

```
Sprint 4 (Day 11):
  S307-T1 (ECONOMICS.md) ──────┐
  S307-T2 (EVENT-PROTOCOL.md) ─┤
                                ├──→ S307-T3 (Cross-repo path) ──→ GATE: citations pass
  S307-T4 (Coverage note) ─────┘

Sprint 5 (Day 12):
  S308-T1 (Update RTFM) ──→ S308-T2 (BUTTERFREEZONE)
                           ──→ S308-T3 (DEV-GUIDE)
                           ──→ S308-T4 (Full validation) ──→ S308-T5 (PR merge prep) ──→ GATE: RTFM 8/8

Sprint 6 (Day 13):
  S309-T1 (Failure modes) ──┐
  S309-T2 (Pricing note) ───┤
  S309-T3 (guild.update) ───┤
  S309-T4 (Coverage note) ──┤
  S309-T5 (BUTTERFREEZONE) ─┴──→ S309-T6 (Validation) ──→ GATE: RTFM 8/8 + citations
```

---

## Sprint 6: BRIDGE FINDINGS (Global ID: 309)

**Goal:** Address 3 MEDIUM + 2 LOW findings from Bridgebuilder review iteration 1 (bridge-20260220-ec9d24).
**Duration:** Day 13
**Gate:** All findings addressed, RTFM 8/8 pass, citations valid.
**Source:** [Bridgebuilder Review — Iteration 1](https://github.com/0xHoneyJar/loa-freeside/pull/76#issuecomment-3930736754) findings medium-1, medium-2, medium-3, low-1, low-2.

### Task 6.1: Add Failure Modes Section to EVENT-PROTOCOL.md

**ID:** S309-T1
**Priority:** P1
**Effort:** Medium (1–2 hours)
**Dependencies:** Sprint 5 complete
**Source:** Bridgebuilder finding medium-1 ("EVENT-PROTOCOL.md lacks failure modes documentation")

**Description:**
Add a "## Failure Modes" section to EVENT-PROTOCOL.md, following the same table format used in ECONOMICS.md (| Failure | Behavior | Rationale |). Cover NATS unreachability, consumer lag, deserialization failure, gateway restart, and message ordering guarantees.

**Pre-flight:** Read `apps/gateway/src/main.rs` for gateway reconnection behavior and `packages/shared/nats-schemas/` for error handling patterns.

**Acceptance Criteria:**
- [ ] "## Failure Modes" section added to EVENT-PROTOCOL.md before "## Related Documentation"
- [ ] At least 5 failure scenarios documented: NATS unreachable (gateway), consumer lag (JetStream redelivery), deserialization failure (Zod parse), gateway restart (shard reconnection), duplicate delivery
- [ ] Table follows | Failure | Behavior | Rationale | format from ECONOMICS.md
- [ ] Citations to source code where behavior is implemented
- [ ] `scripts/pin-citations.sh --validate-only` passes

**Testing:**
- Failure modes table present in rendered markdown
- All citations resolve

### Task 6.2: Add Pricing Mechanism Note to ECONOMICS.md

**ID:** S309-T2
**Priority:** P1
**Effort:** Small (30 min)
**Dependencies:** None
**Source:** Bridgebuilder finding medium-2 ("Model pricing table uses stale model identifiers")

**Description:**
Add a clarifying note below the model pricing table in ECONOMICS.md explaining that the Source column shows default pool pricing tiers, not fixed model bindings. Actual model assignments are configured per-deployment via `BudgetConfigProvider.getModelPricing()`.

**Acceptance Criteria:**
- [ ] Note added below pricing table clarifying pool defaults vs. runtime configuration
- [ ] Explains `BudgetConfigProvider.getModelPricing()` override mechanism
- [ ] Makes clear that pool ID (not model name) is the stable identifier

**Testing:**
- Note present in rendered markdown

### Task 6.3: Add guild.update Data Schema to EVENT-PROTOCOL.md

**ID:** S309-T3
**Priority:** P1
**Effort:** Small (30 min)
**Dependencies:** None
**Source:** Bridgebuilder finding medium-3 ("guild.update event type lacks data schema documentation")

**Description:**
Add a `### guild.update` subsection under the Event Data Schemas section of EVENT-PROTOCOL.md. Check `event-data.ts` for a guild.update data schema; if none exists, document the forward-compatibility pattern.

**Pre-flight:** Read `packages/shared/nats-schemas/src/schemas/event-data.ts` to confirm whether guild.update has a specific data schema or uses the generic `z.unknown()` passthrough.

**Acceptance Criteria:**
- [ ] `### guild.update` subsection added to Event Data Schemas section
- [ ] If data schema exists: document fields with types
- [ ] If no specific schema: document that it uses forward-compatibility (z.unknown())
- [ ] Citation to event-data.ts

**Testing:**
- guild.update documented in Event Data Schemas section

### Task 6.4: Add Conservation Property Coverage Note to ECONOMICS.md

**ID:** S309-T4
**Priority:** P2
**Effort:** Small (30 min)
**Dependencies:** None
**Source:** Bridgebuilder finding low-1 ("Conservation section documents 11 of 14 canonical properties")

**Description:**
Add a note to the conservation invariant section of ECONOMICS.md stating how many of the 14 canonical properties from loa-hounfour are enforced in freeside, and which remain protocol-level only.

**Pre-flight:** Read `themes/sietch/src/packages/core/protocol/arrakis-conservation.ts` to extract exact invariant IDs and cross-reference against loa-hounfour canonical property list.

**Acceptance Criteria:**
- [ ] Note states the coverage ratio (N of 14 properties enforced in freeside)
- [ ] Lists which properties remain protocol-level only (if determinable from source)
- [ ] Does not imply false completeness

**Testing:**
- Coverage note present in conservation section

### Task 6.5: Add BUTTERFREEZONE Cross-Reference to DEVELOPER-GUIDE.md

**ID:** S309-T5
**Priority:** P2
**Effort:** Small (15 min)
**Dependencies:** None
**Source:** Bridgebuilder finding low-2 ("DEVELOPER-GUIDE.md learning path omits BUTTERFREEZONE.md")

**Description:**
Add a brief note after the learning path table in DEVELOPER-GUIDE.md referencing BUTTERFREEZONE.md as the agent-optimized context file.

**Acceptance Criteria:**
- [ ] Note added after learning path table referencing BUTTERFREEZONE.md
- [ ] Explains BUTTERFREEZONE purpose (agent context, token-efficient)
- [ ] Link resolves

**Testing:**
- Cross-reference present in rendered markdown

### Task 6.6: Full Validation Sweep

**ID:** S309-T6
**Priority:** P0
**Effort:** Small (30 min)
**Dependencies:** S309-T1 through S309-T5
**Source:** Gate requirement

**Description:**
Run full validation suite to confirm all changes pass.

**Acceptance Criteria:**
- [ ] `scripts/rtfm-validate.sh` exits 0 — all 8 checks pass
- [ ] `scripts/pin-citations.sh --validate-only` passes
- [ ] Zero naming violations
- [ ] Zero broken cross-links

---

## Sprint 7: PROTOCOL STABILITY & GOVERNANCE (Global ID: 310)

**Goal:** Extend the two-tier stability model to NATS event schemas, establish semver governance for protocol documentation, and formalize the stability promise beyond HTTP.
**Duration:** Day 14
**Gate:** EVENT-PROTOCOL.md has stability tiers for subjects/schemas; ECONOMICS.md and EVENT-PROTOCOL.md have governance policy; RTFM 8/8.
**Source:** [Deep Bridgebuilder Review](https://github.com/0xHoneyJar/loa-freeside/pull/76#issuecomment-3930900304) Gap 1 (Stability stops at HTTP), Gap 3 (Versioning as Governance), and bridge iteration 1 REFRAME finding.

### Task 7.1: NATS Stability Tiers in EVENT-PROTOCOL.md

**ID:** S310-T1
**Priority:** P0
**Effort:** Medium (2–3 hours)
**Dependencies:** Sprint 6 complete
**Source:** Deep Review Gap 1 — "The Stability Promise Stops at HTTP"

**Description:**
Add a "## Stability Tiers" section to EVENT-PROTOCOL.md that applies the same two-tier model from API-REFERENCE.md to NATS subjects and event schemas. When Layer 5 products (loa-dixie) subscribe to NATS events, they need the same stability guarantees as HTTP API consumers. The `GatewayEvent` envelope schema is arguably *more* foundational than any HTTP endpoint.

**Content:**
1. **Tier 1 (Stable):** GatewayEvent envelope schema, core subject patterns (`gateway.events.>`, `gateway.interactions.>`), stream names. Same 2-cycle deprecation policy as HTTP.
2. **Tier 2 (Unstable):** Event data payload shapes beyond the 6 documented types, wildcard subject extensions, consumer group naming conventions.
3. **Promotion criteria:** Stable for 2+ cycles, documented in EVENT-PROTOCOL.md, covered by loa-hounfour JSON fixtures.
4. **Cross-reference:** Link to API-REFERENCE.md stability contract for HTTP tier definitions.

**Pre-flight:** Read `packages/shared/nats-schemas/nats-routing.json` to identify which subjects should be Tier 1 vs Tier 2. Read loa-hounfour fixture list to identify which schemas have cross-language validation.

**Acceptance Criteria:**
- [ ] "## Stability Tiers" section added to EVENT-PROTOCOL.md
- [ ] At minimum 3 subjects/schemas classified as Tier 1 (Stable)
- [ ] Deprecation policy mirrors HTTP: 2-cycle notice, documented in API-CHANGELOG.md
- [ ] Tier 2 subjects explicitly marked as unstable
- [ ] Cross-reference to API-REFERENCE.md stability definitions
- [ ] Citations to nats-routing.json and loa-hounfour fixtures
- [ ] `scripts/pin-citations.sh --validate-only` passes

**Testing:**
- Stability tiers section present in rendered markdown
- All citations resolve

### Task 7.2: Document Versioning Governance

**ID:** S310-T2
**Priority:** P1
**Effort:** Medium (1–2 hours)
**Dependencies:** None (parallel with T1)
**Source:** Deep Review Gap 3 — "Versioning as Governance"

**Description:**
Add a "## Document Versioning" section to DEVELOPER-GUIDE.md that establishes semver governance for protocol documentation. When ECONOMICS.md and EVENT-PROTOCOL.md function as specifications, versioning must follow the same semantics as code — downstream consumers need to say "I built against ECONOMICS.md v1.0.0 and these guarantees apply."

**Content:**
1. **Major version:** Document restructured, sections removed, guarantees narrowed, or invariant definitions changed.
2. **Minor version:** New section added, significant content expansion, new failure modes or stability classifications.
3. **Patch version:** Typo fixes, link updates, clarifications that don't change meaning.
4. **Protocol docs (ECONOMICS.md, EVENT-PROTOCOL.md):** Major version bumps require PR review from core team. Conservation invariant changes are always major.
5. **Operational docs (INFRASTRUCTURE.md, CLI.md):** Standard semver, no special governance.

**Acceptance Criteria:**
- [ ] "## Document Versioning" section in DEVELOPER-GUIDE.md (update existing Versioning section)
- [ ] Governance rules distinguish protocol docs from operational docs
- [ ] Conservation invariant changes explicitly classified as major version
- [ ] Examples of each version bump type
- [ ] Cross-reference from ECONOMICS.md and EVENT-PROTOCOL.md to versioning governance

**Testing:**
- Versioning governance section present in DEVELOPER-GUIDE.md
- Cross-references resolve

### Task 7.3: Stability Contract Cross-Reference in ECONOMICS.md

**ID:** S310-T3
**Priority:** P1
**Effort:** Small (30 min)
**Dependencies:** S310-T2
**Source:** Deep Review Gap 3

**Description:**
Add a brief "## Versioning & Stability" section to ECONOMICS.md referencing the governance policy in DEVELOPER-GUIDE.md. State that the conservation invariant, lot lifecycle, and budget accounting model are Tier 1 (Stable) — changes to these definitions follow the 2-cycle deprecation policy.

**Acceptance Criteria:**
- [ ] "## Versioning & Stability" section added to ECONOMICS.md
- [ ] Conservation invariant, lot lifecycle, budget accounting classified as Tier 1
- [ ] Link to DEVELOPER-GUIDE.md versioning governance
- [ ] Version header reflects current version

**Testing:**
- Section present in rendered markdown
- Links resolve

---

## Sprint 8: CROSS-REPO EDUCATION & PARADIGM ONBOARDING (Global ID: 311)

**Goal:** Transform the Freeside-centric learning path into a true cross-repo educational journey. Help developers understand they are entering a new paradigm — not just a new codebase — with concepts (conservation invariants, multi-model routing, token-gated capabilities, agent economic citizenship) that have no direct precedent in traditional web development.
**Duration:** Days 15–16
**Gate:** ECOSYSTEM.md has comprehensive cross-repo journey; concept glossary exists; RTFM 8/8.
**Source:** [Deep Bridgebuilder Review](https://github.com/0xHoneyJar/loa-freeside/pull/76#issuecomment-3930900304) Gap 2 (Learning Path is Freeside-Centric), user request for "education across the bounds of single repos."

### Task 8.1: Expand "Building on Loa" into Cross-Repo Educational Journey

**ID:** S311-T1
**Priority:** P0
**Effort:** Large (4–6 hours)
**Dependencies:** Sprint 7 complete
**Source:** Deep Review Gap 2, user request for multi-repo multi-step learning

**Description:**
Expand the existing "Building on Loa" section in ECOSYSTEM.md from a brief journey map into a comprehensive multi-repo onboarding guide. The current version assumes readers already understand the protocol layer. The expanded version should take a developer from "I know nothing about Loa" to "I understand the architecture well enough to build a Layer 5 product."

This is not just a reading list — it is a **conceptual progression**. Each step introduces new primitives that build on the previous:

1. **What is Loa?** (ECOSYSTEM.md) — 5-layer stack, dependency direction, naming
2. **What are the rules?** (loa-hounfour) — Protocol contracts, state machines, conservation invariants
3. **How does money work?** (ECONOMICS.md) — Budget atomicity, lot lifecycle, capability tiers
4. **How do events flow?** (EVENT-PROTOCOL.md) — NATS streams, GatewayEvent, subscription patterns
5. **How do I call an agent?** (API-QUICKSTART.md) — First API call in 5 minutes
6. **What can I build?** (API-REFERENCE.md) — Full endpoint reference, stability tiers
7. **How do I deploy?** (INFRASTRUCTURE.md) — Terraform modules, staging guide
8. **How do I run it?** (CLI.md) — gaib CLI for management

**Content additions:**
- "Why This Architecture Exists" preamble — explain the progression from Discord bot → community management → agent economy → economic protocol. People need to understand WHY there are 5 repos, not just THAT there are 5 repos.
- "Conceptual Prerequisites" — what you need to understand before diving in: Redis Lua atomicity, BigInt arithmetic, JetStream at-least-once delivery, token-gating mechanics, hexagonal architecture
- Role-based deep journeys (expanded from current 3-row table):
  - **API Consumer**: QUICKSTART → REFERENCE → ECONOMICS (understand costs) → stability tiers
  - **Product Builder**: ECOSYSTEM → EVENT-PROTOCOL → ECONOMICS → loa-hounfour contracts → REFERENCE
  - **Protocol Contributor**: loa-hounfour → ECONOMICS → EVENT-PROTOCOL → conservation invariant source → temporal properties
  - **Operator**: INFRASTRUCTURE → CLI → monitoring dashboards → cost estimation
  - **New to Agent Economies**: Start with "What is an Agent Economy?" section → ECOSYSTEM → ECONOMICS → EVENT-PROTOCOL

**Acceptance Criteria:**
- [ ] "Building on Loa" section expanded to at minimum 5 role-based paths
- [ ] "Why This Architecture Exists" preamble explains evolution from bot → protocol
- [ ] "Conceptual Prerequisites" section lists key primitives newcomers must understand
- [ ] Each path includes cross-repo links (loa-hounfour, loa-finn where relevant)
- [ ] Cross-repo references use repository links, not branch-relative
- [ ] `scripts/pin-citations.sh --validate-only` passes
- [ ] Section is self-contained — readable without needing to open 8 tabs

**Testing:**
- All cross-repo links resolve
- RTFM crossrepo check passes

### Task 8.2: Concept Glossary — "New Concepts in Agent Economies"

**ID:** S311-T2
**Priority:** P0
**Effort:** Large (3–4 hours)
**Dependencies:** S311-T1 (references glossary entries)
**Source:** User request — "getting used to new concepts"

**Description:**
Create a `docs/GLOSSARY.md` that defines the key concepts of the Loa protocol. This is not a dictionary — it is a conceptual map for developers transitioning from traditional web development to agent economic infrastructure. Each entry should explain: what it is, why it matters, where it comes from (FAANG/industry parallel), and where to learn more.

People entering this ecosystem face a combinatorial explosion of unfamiliar concepts: conservation invariants, lot lifecycle, conviction scoring, pool routing, ensemble strategies, token-gating, BYOK, budget atomicity. Without a glossary, they must reconstruct these concepts from scattered source code. The glossary serves as the "Rosetta Stone" between traditional concepts and Loa concepts.

**Content (minimum entries):**

| Concept | Traditional Equivalent | Loa Primitive | Source Doc |
|---------|----------------------|---------------|------------|
| Conservation Invariant | Double-entry bookkeeping | `available + reserved + consumed = original` | ECONOMICS.md |
| Budget Atomicity | Transaction isolation | Redis Lua two-counter model | ECONOMICS.md |
| Lot Lifecycle | Payment authorization | reserve → finalize → reap | ECONOMICS.md |
| Conviction Scoring | Access control list | Token-weighted tier calculation | ECONOMICS.md |
| Pool Routing | Load balancing | Capability-based model selection | ECONOMICS.md |
| Ensemble Strategy | Redundant systems | Multi-model decision protocols | ECONOMICS.md |
| Capability Tier | Subscription plan | Token-gated pool access | ECONOMICS.md |
| GatewayEvent | HTTP request | NATS message envelope | EVENT-PROTOCOL.md |
| Stability Tier | API versioning | 2-cycle deprecation commitment | API-REFERENCE.md |
| BYOK | Self-hosted | Bring Your Own Key with envelope encryption | BUTTERFREEZONE.md |
| Token-Gating | Authentication | Wallet-verified capability access | ECOSYSTEM.md |
| Forward Compatibility | Backward compatibility | `z.unknown()` + `isKnownEventType()` guard | EVENT-PROTOCOL.md |
| Fail-Closed Reservation | Circuit breaker | Deny on Redis unreachable | ECONOMICS.md |
| Agent Economic Citizenship | Service identity | NFT-bound agent with budget delegation | ECOSYSTEM.md |

**Format for each entry:**
```markdown
### Conservation Invariant

**What:** A mathematical guarantee that no budget can be created or destroyed during the agent inference lifecycle. Expressed as `available + reserved + consumed = original` for every lot.

**Why it matters:** In a multi-agent economy where communities delegate spending authority to autonomous agents, the conservation invariant is what makes that delegation safe. It is the foundational promise that the books will always balance.

**Traditional parallel:** Double-entry bookkeeping (every credit has a corresponding debit). In banking, this is regulatory requirement. In agent economies, it is protocol-level enforcement.

**Industry parallel:** Stripe's idempotency keys prevent double-charges; the conservation invariant prevents double-spending at a more fundamental level — not per-transaction but per-lot across the entire lifecycle.

**Learn more:** [ECONOMICS.md](ECONOMICS.md) § Conservation Invariant
```

**Acceptance Criteria:**
- [ ] `docs/GLOSSARY.md` created with at minimum 12 concept entries
- [ ] Each entry has: What, Why it matters, Traditional parallel, Industry parallel, Learn more
- [ ] Entries link to source documentation
- [ ] Cross-referenced from DEVELOPER-GUIDE.md learning path
- [ ] Cross-referenced from ECOSYSTEM.md "Conceptual Prerequisites"
- [ ] `scripts/pin-citations.sh --validate-only` passes

**Testing:**
- All "Learn more" links resolve
- Glossary covers at least the 14 concepts listed above

### Task 8.3: Add GLOSSARY.md to Validation and Navigation

**ID:** S311-T3
**Priority:** P1
**Effort:** Small (1 hour)
**Dependencies:** S311-T2
**Source:** Integration task

**Description:**
Add GLOSSARY.md to RTFM managed docs, DEVELOPER-GUIDE.md learning path and ownership table, BUTTERFREEZONE interfaces list, and cross-link from all docs that use glossary terms.

**Acceptance Criteria:**
- [ ] GLOSSARY.md added to `MANAGED_DOCS` in `scripts/rtfm-validate.sh`
- [ ] GLOSSARY.md in DEVELOPER-GUIDE.md learning path (position after ECOSYSTEM, before API-QUICKSTART)
- [ ] GLOSSARY.md in DEVELOPER-GUIDE.md ownership table (DRI: Core team, trigger: new concept introduced)
- [ ] "Next Steps" footer added to GLOSSARY.md
- [ ] All docs referencing glossary concepts link to GLOSSARY.md at least once
- [ ] BUTTERFREEZONE.md updated to reference GLOSSARY.md
- [ ] RTFM 8/8 passes with expanded managed docs

**Testing:**
- `scripts/rtfm-validate.sh` passes with GLOSSARY.md in scope
- All cross-links resolve

---

## Sprint 9: PROTOCOL FORMALIZATION & DISCOVERY (Global ID: 312)

**Goal:** Deepen the economic primitives documentation toward protocol-specification quality, establish BUTTERFREEZONE as the foundation for machine-discoverable agent platforms, and add the "why this matters" educational framing that transforms docs from reference material into paradigm introduction.
**Duration:** Day 17 (parallel with Sprint 10)
**Gate:** ECONOMICS.md has formal specification section; BUTTERFREEZONE has discovery protocol fields; RTFM 8/8.
**Source:** [Deep Bridgebuilder Review](https://github.com/0xHoneyJar/loa-freeside/pull/76#issuecomment-3930900304) Gap 4 (Agent Discovery), bridge SPECULATION findings, user request for "awareness of the wider eco."

### Task 9.1: Economic Protocol Formal Specification Section

**ID:** S312-T1
**Priority:** P1
**Effort:** Medium (2–3 hours)
**Dependencies:** Sprint 8 complete (glossary terms referenced)
**Source:** Bridge iteration 1 SPECULATION finding — "Formalize economic primitives as a standalone protocol specification"

**Description:**
Add a "## Formal Specification" section to ECONOMICS.md that presents the conservation invariant, lot lifecycle state machine, and budget accounting model in a format approaching EIP-style specification quality. This is not a full EIP — it is the educational bridge between "internal documentation" and "proposed standard."

The deep review noted: "The gap between 'internal documentation' and 'proposed standard' is smaller than it appears." This task closes that gap for the most critical primitives.

**Content:**
1. **Conservation Properties** — Table of all 14 canonical properties with formal notation:
   - Property ID, Name, Formal expression, Enforcement level (DB/App/Protocol/Reconciliation)
   - Cross-reference to loa-hounfour source
2. **Lot State Machine** — State diagram: `RESERVED → PARTIALLY_CONSUMED → CONSUMED → REAPED`
   - Transition guards and side effects
   - Idempotency guarantees per transition
3. **Budget Accounting Axioms** — The 3 guarantees as formal properties:
   - A1: No precision loss (integer micro-USD, no floating point)
   - A2: No double-charge (idempotent finalization via Redis key)
   - A3: Fail-closed reservation (deny on infrastructure failure)
4. **Implementer Notes** — What a conforming implementation must guarantee to claim Loa compatibility

**Acceptance Criteria:**
- [ ] "## Formal Specification" section added to ECONOMICS.md after the existing content
- [ ] Conservation properties table with all 14 properties (referencing loa-hounfour)
- [ ] Lot state machine documented with transitions and guards
- [ ] 3 budget axioms formally stated
- [ ] Implementer notes section explaining conformance requirements
- [ ] Citations to loa-hounfour constraint JSON files where relevant
- [ ] `scripts/pin-citations.sh --validate-only` passes

**Testing:**
- Formal specification section present in rendered markdown
- Property table has 14 entries matching loa-hounfour canonical list

### Task 9.2: BUTTERFREEZONE Agent Discovery Fields

**ID:** S312-T2
**Priority:** P1
**Effort:** Medium (1–2 hours)
**Dependencies:** None (parallel with T1)
**Source:** Deep Review Gap 4 — "The Agent Discovery Story"

**Description:**
Extend the `AGENT-CONTEXT` header in BUTTERFREEZONE.md with additional fields that lay the foundation for machine-discoverable agent platforms. Currently the header has: name, type, purpose, key_files, interfaces, dependencies, capability_requirements, version, trust_level. Add fields that enable an agent to evaluate whether this platform meets its needs without human intermediation.

**New fields:**
- `stability_contract`: URL to stability tier documentation
- `economic_model`: Brief description of the economic primitives (conservation, lot lifecycle)
- `protocol_version`: loa-hounfour version this platform conforms to
- `discovery_endpoints`: List of machine-readable entry points (health check, capabilities, pricing)
- `ecosystem`: Map of related repos with their roles

**Acceptance Criteria:**
- [ ] AGENT-CONTEXT header extended with at minimum 4 new fields
- [ ] Fields are machine-parseable (YAML within HTML comment)
- [ ] `butterfreezone-validate.sh` updated: new fields are optional — validator treats absence as advisory warning (exit code 2, not failure). RTFM check #7 accepts exit code 0 or 2.
- [ ] Golden test vectors in `tests/fixtures/butterfreezone-golden/` regenerated and committed to reflect new fields and updated per-section hashes
- [ ] Brief prose section explaining the agent discovery vision
- [ ] Cross-reference to GLOSSARY.md for concept definitions

**Testing:**
- `butterfreezone-validate.sh` passes (exit 0 or 2 for advisory)
- Golden vectors match regenerated output
- New fields parseable by a simple YAML parser

### Task 9.3: "Understanding the Agent Economy" Preamble

**ID:** S312-T3
**Priority:** P1
**Effort:** Medium (1–2 hours)
**Dependencies:** S311-T2 (glossary concepts referenced)
**Source:** User request — "building a new paradigm so we need to do the education"

**Description:**
Add an "Understanding the Agent Economy" section to the beginning of ECOSYSTEM.md (after the Stack section, before Repositories). This section explains to newcomers *why* this architecture exists and *what problem it solves* at the paradigm level — not just the technical level.

The current ECOSYSTEM.md jumps straight into layer diagrams and repo descriptions. A developer arriving from traditional web development needs context: Why are there 5 repos? Why is there a separate protocol layer? Why does billing need its own conservation invariant? What is an "agent economy" and how does it differ from a regular SaaS?

**Content:**
1. **What is an Agent Economy?** — Autonomous AI agents that hold identity, spend budget, and provide services within a governed commons. Not chatbots — economic actors.
2. **Why Conservation Invariants?** — When you delegate spending authority to an autonomous agent, you need mathematical proof that the books balance. This is the difference between a billing system and an economic protocol.
3. **Why 5 Repos?** — Separation of concerns at the protocol level. The contracts (loa-hounfour) must evolve independently of the implementation (loa-freeside) and the runtime (loa-finn). This is the Kubernetes insight: contracts independent of both platform and runtime.
4. **Why Multi-Model?** — Different cognitive tasks require different models, just as different compute tasks require different processors. Pool routing is to models what load balancing is to servers — but with cost and capability awareness.
5. **The Web4 Connection** — Brief reference to the broader thesis (blockchain + AI convergence), linking to the existing Web4 section.

**Acceptance Criteria:**
- [ ] "Understanding the Agent Economy" section added to ECOSYSTEM.md
- [ ] At minimum 4 subsections explaining paradigm concepts
- [ ] Links to GLOSSARY.md for formal definitions
- [ ] Links to ECONOMICS.md and EVENT-PROTOCOL.md for technical depth
- [ ] Accessible to someone with web development background but no agent/blockchain experience
- [ ] Zero jargon without definition or glossary link

**Testing:**
- Section present in rendered markdown
- All links resolve
- No undefined technical terms

---

## Sprint 10: FINAL EXCELLENCE & MERGE (Global ID: 313)

**Goal:** Run full validation suite, regenerate BUTTERFREEZONE, update PR body, and prepare for merge.
**Duration:** Day 17 (after Sprint 9)
**Gate:** RTFM 8/8, all citations valid, PR body updated, ready for human review.
**Source:** Merge preparation.

### Task 10.1: Update RTFM Validator Scope

**ID:** S313-T1
**Priority:** P0
**Effort:** Small (30 min)
**Dependencies:** Sprints 7–9 complete
**Source:** New docs must be in validation scope

**Description:**
Verify that `docs/GLOSSARY.md` is already in `MANAGED_DOCS` and `zero_tolerance_files` (added in Sprint 8, Task 8.3). This is a verification-only task — if Sprint 8.3 correctly added GLOSSARY.md, no changes are needed. If Sprint 8.3 was incomplete, add it here. Confirm all 8 checks account for the expanded document set including all Sprint 7–9 additions.

**Acceptance Criteria:**
- [ ] Confirm `MANAGED_DOCS` includes GLOSSARY.md (expected from S311-T3)
- [ ] Confirm `zero_tolerance_files` includes GLOSSARY.md (expected from S311-T3)
- [ ] All 8 RTFM checks pass with full expanded scope (all Sprint 7–9 docs)
- [ ] No redundant MANAGED_DOCS additions — single source of introduction per doc

**Testing:**
- `scripts/rtfm-validate.sh` exits 0

### Task 10.2: Regenerate BUTTERFREEZONE.md

**ID:** S313-T2
**Priority:** P1
**Effort:** Small (30 min)
**Dependencies:** S313-T1
**Source:** New docs and discovery fields need to be reflected

**Description:**
Regenerate BUTTERFREEZONE.md to reflect the expanded documentation set, new GLOSSARY.md, and agent discovery fields from S312-T2. Validate hashes.

**Acceptance Criteria:**
- [ ] BUTTERFREEZONE.md regenerated or manually updated with new fields
- [ ] `butterfreezone-validate.sh` passes
- [ ] AGENT-CONTEXT header reflects current state

**Testing:**
- `butterfreezone-validate.sh` exit 0 or advisory-only warnings

### Task 10.3: Full Citation Sweep + Validation

**ID:** S313-T3
**Priority:** P0
**Effort:** Small (1 hour)
**Dependencies:** S313-T2
**Source:** Gate requirement

**Description:**
Run full validation suite across all documents. Fix any issues found.

**Acceptance Criteria:**
- [ ] `scripts/rtfm-validate.sh` exits 0 — all 8 checks pass
- [ ] `scripts/pin-citations.sh --validate-only` passes for ALL docs
- [ ] Zero naming violations
- [ ] Zero broken cross-links
- [ ] Zero placeholder markers (TODO/TBD/PLACEHOLDER/FIXME)

**Testing:**
- `scripts/rtfm-validate.sh` exits 0
- `scripts/pin-citations.sh --validate-only` exits 0

### Task 10.4: Bridge Findings Closure Checklist

**ID:** S313-T4
**Priority:** P0
**Effort:** Small (30 min)
**Dependencies:** S313-T3
**Source:** GPT review — findings traceability requirement

**Description:**
Create a findings closure artifact that maps every bridge review finding (3 MEDIUM, 2 LOW, 1 REFRAME, 3 SPECULATION from bridge iterations, plus 4 gaps from deep review) to the concrete doc section/commit that addresses it. This prevents regression — since Sprints 7–10 modify the same docs that resolved earlier findings, later edits could regress a previously "closed" finding.

**Acceptance Criteria:**
- [ ] Closure table created in `grimoires/loa/NOTES.md` (or dedicated section) with columns: Finding ID → Description → Sprint/Task → Doc Section → Validation Evidence
- [ ] All 13 findings mapped (3 MEDIUM + 2 LOW + 1 REFRAME + 3 SPECULATION + 4 deep review gaps)
- [ ] Each finding shows current status: CLOSED (with evidence) or DEFERRED (with rationale)
- [ ] No finding marked CLOSED without a verifiable doc section reference

**Testing:**
- All MEDIUM and HIGH findings show CLOSED status
- All closure references point to existing doc sections

### Task 10.5: Update PR #76 for Final Merge

**ID:** S313-T5
**Priority:** P0
**Effort:** Small (1 hour)
**Dependencies:** S313-T4
**Source:** Merge preparation

**Description:**
Update PR #76 body with the complete sprint breakdown (304–313), include the bridge review trail, mark as ready for review.

**Acceptance Criteria:**
- [ ] PR body updated with all 10 sprints and file counts
- [ ] Bridge review trail referenced (3 comments: iteration 1, iteration 2, deep review)
- [ ] Sprint breakdown table includes all sprints with status
- [ ] CI docs-validation workflow passes
- [ ] Final commit follows conventional commit format

**Testing:**
- `gh pr view 76 --json isDraft` returns false
- CI checks pass

---

## Sprint 7–10 Task Dependency Graph

```
Sprint 7 (Day 14):
  S310-T1 (NATS stability tiers) ──┐
  S310-T2 (Doc versioning governance)┤
                                     ├──→ S310-T3 (ECONOMICS stability ref) ──→ GATE: RTFM 8/8
                                     ┘

Sprint 8 (Days 15–16):
  S311-T1 (Cross-repo journey) ──→ S311-T2 (Concept glossary) ──→ S311-T3 (Integration) ──→ GATE: RTFM 8/8

Sprint 9 (Day 17):
  S312-T1 (Formal specification) ──┐
  S312-T2 (Discovery fields) ──────┤
  S312-T3 (Agent economy preamble) ┴──→ GATE: RTFM 8/8

Sprint 10 (Day 17, after Sprint 9):
  S313-T1 (RTFM scope verify) ──→ S313-T2 (BUTTERFREEZONE) ──→ S313-T3 (Full validation) ──→ S313-T4 (Findings closure) ──→ S313-T5 (PR update) ──→ GATE: Merge-ready
```

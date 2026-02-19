# PRD: The Neuromancer Codex — Documentation as Product Surface

**Version:** 1.1.0
**Date:** 2026-02-19
**Status:** Active
**Cycle:** cycle-035
**Predecessor:** cycle-034 "The Voice from the Outer World" (paused — protocol adoption)
**Source:** Team directive (2026-02-19), [PR #74](https://github.com/0xHoneyJar/loa-freeside/pull/74), [loa-finn #66](https://github.com/0xHoneyJar/loa-finn/issues/66)

---

## 0. The Question Behind the Question

The request is "docs upgrade." The real problem is **identity drift at the narrative layer**.

The README says: *"Engagement intelligence platform for Web3 communities. Conviction scoring and tiered progression delivered as Discord and Telegram roles."*

That describes Cycle 001. This is Cycle 035. The codebase has undergone a metamorphosis through 34 development cycles, 303+ sprints, and 82k+ lines of code across 5 repositories — from a Discord bot into a **multi-model agent economy infrastructure platform** with formal economic verification, payment rails, and protocol-level contracts.

The documentation still describes the caterpillar. The code is the butterfly.

This is the Amazon-to-AWS moment. Stripe won not on technology — they won because `curl https://api.stripe.com/v1/charges` was 7 lines and perfectly documented. The documentation WAS the product. For loa-freeside, the docs upgrade isn't auxiliary to launch. It IS the launch surface.

Additionally, the project is rebranding from Dune-themed naming ("Arrakis", "Sietch", "Naib") to Neuromancer trilogy naming ("Freeside", from William Gibson's orbital station where AIs converge into superintelligence). This rebrand applies to the platform identity — individual Discord themes may retain their own flavor.

> Sources: README.md (current), INFRA-AS-PRODUCT-GTM.md, [loa-finn #66](https://github.com/0xHoneyJar/loa-finn/issues/66), [Web4 manifesto](https://meow.bio/web4.html), [loa-finn #31 (Hounfour RFC)](https://github.com/0xHoneyJar/loa-finn/issues/31)

---

## 1. Problem Statement

### P1: Identity Drift

The external documentation describes a conviction-scoring Discord bot. The code implements:

- Multi-model inference platform with 5-pool routing and ensemble orchestration
- Atomic budget management with BigInt micro-USD precision and conservation invariants
- Token-gated capability markets (on-chain conviction → AI access tiers)
- Formal economic verification (5 invariants, 147 constraints, property-based testing)
- Payment rails (x402 USDC, credit ledger, prepaid billing)
- Multi-tenant isolation with Row-Level Security
- Protocol-first architecture (loa-hounfour Level 4 contracts, 1097 tests)
- Infrastructure-as-Code (Terraform, AWS ECS, CloudWatch)

A developer, investor, or partner who reads the current README has no idea what this project actually is.

### P2: Ecosystem Invisibility

The platform spans 5 repositories with clear layering:

```
Layer 5: Products          loa-dixie (dNFT Oracle — first customer)
Layer 4: Platform          loa-freeside (API, Discord/TG, token-gating)
Layer 3: Runtime           loa-finn (persistent sessions, tool sandbox)
Layer 2: Protocol          loa-hounfour (schemas, state machines, constraints)
Layer 1: Framework         loa (agent dev framework, skills, Bridgebuilder)
```

No document shows this. The ECOSYSTEM-MAP.md only covers "arrakis + arrakis-web" and doesn't mention loa, loa-finn, loa-hounfour, or loa-dixie.

### P3: Stale Naming

The project uses "Arrakis" (Dune) naming throughout. The team is rebranding to Neuromancer trilogy naming. "loa-freeside" / "Freeside" is the canonical name. Core platform documentation must reflect this. Discord theme subsystems (e.g., sietch) may retain their own names as theme-specific branding.

### P4: No Developer Onboarding Path

The GTM plan (PR #74) identifies that the platform has 80+ API routes, 22+ Discord commands, a CLI tool, and comprehensive internals — but **zero external developer documentation**. No OpenAPI spec, no quick-start, no SDK docs, no API reference.

### P5: BUTTERFREEZONE Without Soul

BUTTERFREEZONE.md exists but its agent context says "No description available" and lists `.claude/` internal files as "Key Capabilities." It's mechanically generated without understanding what the project is. For AI agents (and the humans who read agent context), this file IS the project's identity.

> Sources: README.md:1-10, BUTTERFREEZONE.md:1-5, ECOSYSTEM-MAP.md, CODEBASE-ANALYSIS.md (Cycle 008 — 26 cycles stale), INFRA-AS-PRODUCT-GTM.md:107-191

---

## 2. Goals

| ID | Goal | Metric | Priority |
|----|------|--------|----------|
| G-1 | Rewrite all external-facing documentation to reflect what loa-freeside actually IS — a multi-model agent economy infrastructure platform | README accurately describes platform capabilities; no references to "engagement intelligence" as primary identity | P0 |
| G-2 | Complete Neuromancer rebrand in documentation — all platform-level references to "Arrakis" become "loa-freeside" / "Freeside" | Zero "Arrakis" references in platform-level docs (README, BUTTERFREEZONE, API docs, ecosystem map). Theme-level references (sietch) preserved as subsystem names | P0 |
| G-3 | Create the 5-repo ecosystem map grounded in code truth | Ecosystem document covers all 5 repos with accurate layer diagram, test counts, line counts, and inter-repo dependency graph | P0 |
| G-4 | Regenerate BUTTERFREEZONE with narrative soul and accurate capability inventory | BUTTERFREEZONE agent context section has real description, capabilities list references actual platform features (not `.claude/` internals), provenance tags cite source files | P0 |
| G-5 | Produce developer-facing API documentation sufficient for "first call in 5 minutes" | Quick-start guide exists; API reference covers invoke, stream, budget, health, billing endpoints with request/response examples | P1 |
| G-6 | Document the Infrastructure-as-Code story (Terraform, deployment, monitoring) | IaC documentation covers all Terraform modules, deployment architecture, and operational runbooks | P1 |
| G-7 | Connect the documentation to the wider Web4 / agent economy vision | Ecosystem docs reference the Web4 manifesto context; positioning is "infrastructure for agent economies" not "Discord bot" | P0 |
| G-8 | Ground every documentation claim in code truth — no aspirational language without source citations | Every capability claim in README/BUTTERFREEZONE has a `source:` annotation or file reference. Zero vaporware claims. | P0 |

---

## 3. Scope

### In Scope

1. **README.md rewrite** — Full rewrite reflecting loa-freeside identity, capabilities, architecture, and ecosystem position
2. **BUTTERFREEZONE.md regeneration** — Regenerate with real narrative, accurate capabilities, proper agent context
3. **Ecosystem documentation** — New comprehensive 5-repo ecosystem map replacing the stale 2-repo version
4. **API quick-start guide** — "First agent call in 5 minutes" with code examples
5. **API reference** — Endpoint documentation for all public API routes (from Zod schemas)
6. **IaC documentation** — Terraform modules, deployment architecture, monitoring
7. **CLI documentation** — gaib CLI command reference
8. **Naming migration in docs** — All platform-level "Arrakis" → "loa-freeside" / "Freeside" in documentation files
9. **RTFM validation** — Ensure all docs are internally consistent and cross-referenced
10. **Developer onboarding path** — Structured learning path from "what is this?" to "I shipped my first agent call"

### Out of Scope

- Code-level renaming (variable names, package names, import paths) — separate engineering cycle
- Database migration or runtime changes
- New feature development
- OpenAPI spec generation from Zod (requires code changes — documented as prerequisite for future API docs automation)
- SDK development (TypeScript/Python SDKs are implementation work, not documentation)
- Marketing website changes
- Payment provider integration
- Production deployment

### Naming Scope Clarification

| Layer | Current Name | New Name | Scope |
|-------|-------------|----------|-------|
| Platform identity | Arrakis | loa-freeside / Freeside | IN SCOPE (docs) |
| Repository | arrakis (GitHub) | loa-freeside | Already done |
| README, BUTTERFREEZONE | "Arrakis" throughout | "loa-freeside" / "Freeside" | IN SCOPE |
| Discord theme | Sietch (themes/sietch/) | Sietch (retained as theme name) | No change |
| Tier names | Dune-themed (Naib, Fedaykin, etc.) | Theme-specific (keep in sietch theme) | No change in docs |
| Code internals | Various Dune references | Future engineering cycle | OUT OF SCOPE |
| CLI | gaib | Future naming decision | OUT OF SCOPE |

### Naming Policy (Zero-Tolerance and Exemptions)

**Zero-tolerance files** (zero platform-level "Arrakis" references allowed):
- `README.md`
- `BUTTERFREEZONE.md`
- `docs/ECOSYSTEM.md`
- `docs/API-QUICKSTART.md`
- `docs/API-REFERENCE.md`
- `docs/INFRASTRUCTURE.md`
- `docs/DEVELOPER-GUIDE.md`

**Allowed single-mention pattern** — these files may contain exactly ONE historical reference in the format: `> *Formerly known as Arrakis. Rebranded to loa-freeside (Cycle 035).*`
- `CHANGELOG.md` (historical entries preserved as-is — these are immutable records)
- `INSTALLATION.md` (one historical note in header)

**Exempt files** (Dune naming is theme-specific, not platform identity):
- `themes/sietch/` (all files — "sietch" is the Discord theme name)
- `grimoires/loa/archive/` (historical cycle records are immutable)
- `grimoires/loa/context/` (internal working documents)
- Code files (OUT OF SCOPE — separate engineering cycle)

**Validation:** `grep -ri "arrakis" <file>` on zero-tolerance files must return 0 matches. This check is part of FR-8 RTFM validation.

---

## 4. Functional Requirements

### FR-1: README.md Rewrite (P0)

**Context:** Current README (7.7KB) opens with "Engagement intelligence platform for Web3 communities" — a description accurate for Cycle 001, misleading for Cycle 035. The README is the single highest-traffic entry point for the project.

**Requirements:**
1. Open with what loa-freeside actually IS: multi-model agent economy infrastructure platform
2. Feature inventory grounded in code reality (cite source files):
   - Multi-model inference (5 pools, ensemble, BYOK)
   - Budget atomicity and economic verification
   - Token-gated capability markets
   - Payment rails (x402, credit ledger)
   - Multi-tenant with RLS
   - Discord + Telegram + REST API distribution
   - Infrastructure-as-Code (Terraform)
3. Architecture diagram reflecting current state (packages, apps, infrastructure, themes)
4. Ecosystem section showing all 5 repos and their relationships
5. Quick-start path for developers ("I want to call the API") and community operators ("I want to set up a Discord bot")
6. Technology stack table (current and accurate)
7. Link to all documentation (API docs, IaC docs, CLI docs, ecosystem map)
8. Zero "Arrakis" references in platform identity (theme subsystems may keep names)
9. Appropriate badges (version, license, test count if available)

**Acceptance Criteria:**
- README opens with accurate platform description
- All capability claims have source file references in comments or linked docs
- Architecture diagram matches actual codebase structure
- Ecosystem section covers all 5 repos
- No identity drift between README and code reality
- "Arrakis" appears only in theme-context references, if at all

### FR-2: BUTTERFREEZONE.md Regeneration (P0)

**Context:** Current BUTTERFREEZONE has `purpose: No description available` and lists `.claude/` adapter files as "Key Capabilities." This file is consumed by AI agents and determines how they understand the project.

**Requirements:**
1. Agent context section:
   - `name: loa-freeside`
   - `type: platform` (not `framework`)
   - `purpose:` — accurate 1-2 sentence description of what this is
   - `key_files:` — actual key files (core ports, agent gateway, billing, CLI, Terraform)
   - `version:` — current version
   - `trust_level: grounded`
2. Capabilities section — list actual platform capabilities with source file citations:
   - Each capability references the file that implements it
   - Organized by domain (inference, economics, distribution, infrastructure)
3. Architecture section — actual package/app/infrastructure layout
4. Interfaces section — REST routes, Discord commands, Telegram commands, CLI commands
5. Module map — accurate file counts and LOC by module
6. Ecosystem section — dependencies including cross-repo (loa-hounfour, loa-finn)
7. Quick start — accurate setup instructions
8. Content hashes for integrity verification:
   - Algorithm: SHA-256
   - **Canonicalization:** Each section is first extracted into a structured JSON representation (keys sorted, values trimmed, arrays ordered deterministically) before hashing. Raw Markdown is NOT hashed directly — this avoids brittleness from whitespace, code fence variations, and OS-specific line endings.
   - Scope: hash each major section independently (agent_context, capabilities, architecture, interfaces, module_map, ecosystem, quick_start)
   - Input normalization: JSON keys sorted alphabetically, string values trimmed, UTF-8 encoding
   - Excluded from hash: the `ground-truth-meta` block itself (to avoid circular reference)
   - **Reference implementation:** `butterfreezone-gen.sh` contains the canonical extraction-to-JSON logic. A set of golden test vectors (known input Markdown → expected JSON → expected hash) must be committed to `tests/fixtures/butterfreezone-golden/` to catch regressions across tooling or OS changes.
   - Validation mode: hashes must match current working tree state at generation time; `butterfreezone-validate.sh` re-computes JSON extraction and compares

**Acceptance Criteria:**
- Agent context has real description (not "No description available")
- Capabilities reference actual source files, not `.claude/` internals
- All provenance tags are accurate
- Golden test vectors committed and passing (known input → expected hash)
- Content hashes validate when `butterfreezone-validate.sh` is run against the same commit that generated them
- A fresh AI agent reading BUTTERFREEZONE can accurately describe what the project does

### FR-3: Ecosystem Documentation (P0)

**Context:** ECOSYSTEM-MAP.md (2026-02-04) covers only "arrakis + arrakis-web." The actual ecosystem is 5 repositories with clear layering, shared protocol contracts, and cross-repo dependencies.

**Requirements:**
1. Layer diagram showing all 5 repos with dependency arrows:
   ```
   loa-dixie → loa-freeside → loa-finn
                     ↓              ↓
                loa-hounfour ←──────┘
                     ↓
                    loa (framework)
   ```
2. Per-repo summary:
   - Purpose (1-2 sentences, grounded)
   - Key stats (lines, tests, version)
   - Primary interfaces / API surface
   - Relationship to other repos
3. Protocol contract flow — how loa-hounfour schemas flow through the system
4. The "Neuromancer map" — explain the naming:
   - loa = voodoo spirits (AI agents, from Count Zero)
   - Freeside = orbital station (platform convergence point)
   - Dixie = Dixie Flatline (first product that speaks)
   - Hounfour = voodoo temple (where the loa manifest — protocol contracts)
   - Finn = the Finn (fence/broker — runtime engine)
5. Web4 vision connection — brief section linking the technical stack to the Web4 manifesto's "infrastructure for agent economies" thesis
6. Competitive positioning (from PR #74 analysis)

**Acceptance Criteria:**
- All 5 repos documented with accurate stats
- Layer diagram is correct (verified against package.json dependencies)
- Naming section explains the Neuromancer references
- A new developer reading this understands the full ecosystem in <5 minutes
- No references to "arrakis-web" or other stale repos without context

### FR-4: API Quick-Start Guide (P1)

**Context:** The platform has 80+ API routes but zero developer-facing documentation. The GTM plan identifies this as a critical gap. While the full OpenAPI spec requires code changes (out of scope), a hand-written quick-start is achievable.

#### Developer-Facing API Contract

Before writing any docs, the following must be defined explicitly:

| Property | Value | Source |
|----------|-------|--------|
| **Target environment** | Local development (`localhost:3000`) — docs target a locally-running instance, not a hosted service | `themes/sietch/src/index.ts` |
| **Primary auth method** | JWT (ES256 + JWKS) — this is implemented today and is the canonical auth method | `themes/sietch/src/api/middleware/auth.ts` |
| **API key auth** | **Planned** — not yet implemented for external devs. Docs must label this "Planned" with no operational steps | GTM plan D1 |
| **Streaming protocol** | Server-Sent Events (SSE) via `text/event-stream`, resumable via `Last-Event-ID` header | `agents.routes.ts` |
| **Public endpoints** | `/api/agents/*`, `/api/billing/*`, `/.well-known/jwks.json`, `/api/agents/health` | Route files |
| **Admin-only endpoints** | `/api/admin/*` (BYOK, agent-config) — documented separately, not in quick-start | Admin route files |
| **Credential acquisition** | For local dev: generate JWT via `gaib auth login` or manual ES256 signing against local JWKS | `packages/cli/src/commands/auth/` |

**Requirements:**
1. "First agent call in 5 minutes" tutorial:
   - Prerequisites: running local instance + JWT token (via gaib CLI or manual signing)
   - Single `curl` example hitting `/api/agents/invoke` with JWT `Authorization: Bearer` header
   - Single `curl` example for SSE streaming via `/api/agents/stream` with `Accept: text/event-stream`
   - Budget check via `/api/agents/budget`
   - Health check via `/api/agents/health` (no auth required)
2. Authentication guide:
   - JWT flow (ES256 + JWKS) — primary, fully documented with step-by-step
   - **Planned: API key provisioning** — labeled as future, no operational steps
   - Header format: `Authorization: Bearer <jwt>`
   - JWKS verification endpoint: `/.well-known/jwks.json`
3. Endpoint reference — **"Guaranteed Stable" subset only** (hand-documented from route files):
   - **Stable Public:** `/api/agents/invoke`, `/api/agents/stream`, `/api/agents/budget`, `/api/agents/health`, `/api/agents/models` (5 endpoints — the minimum for first success)
   - **Stable Public:** `/api/billing/balance`, `/api/billing/pricing` (2 billing endpoints for cost visibility)
   - **Route Index (auto-extracted):** All remaining 70+ routes listed in a table (method, path, auth requirement, one-line description) auto-extracted from Express route registrations. Marked as `internal` or `unstable` — no request/response examples for these.
   - **Admin-only:** BYOK, agent-config documented at high level only (purpose + auth) — not in quick-start
4. Request/response examples with realistic payloads — must be copy-pastable against a local instance
5. Rate limit documentation (4 dimensions, tier tables)
6. Error code reference
7. **Smoke-test checklist:** A numbered list of curl commands that must all return 2xx (or expected 401 for auth tests) against a running local instance. This checklist is the validation gate for the quick-start.

**Acceptance Criteria:**
- A developer can make their first API call by following the guide against a local instance
- All endpoint descriptions match actual route implementations (validated by running smoke-test checklist)
- Request/response examples are valid and copy-pastable
- Rate limit tiers match code configuration
- JWT is the only auth method with operational steps; API keys are clearly labeled "Planned"
- Smoke-test checklist passes against `npm run dev` local environment
- **Security disclaimers** included: never ship private keys in code, separate dev/prod JWKS, document key rotation expectations, token TTL guidance, audience/issuer validation requirements, least-privilege scope recommendations
- Admin endpoint documentation is high-level only (purpose + auth requirements) — detailed operational docs require separate admin guide

### FR-5: Infrastructure-as-Code Documentation (P1)

**Context:** `infrastructure/terraform/` contains 10+ Terraform modules for AWS ECS deployment, but the only documentation is the stale `docs/iac.md` and `infrastructure/STAGING-SETUP.md`. The IaC story is a competitive advantage (self-hosted path in Pillar 3) and needs to be visible.

**Requirements:**
1. Architecture diagram — AWS deployment topology:
   - ECS Fargate services
   - RDS PostgreSQL
   - ElastiCache Redis
   - ALB + Route53
   - CloudWatch monitoring
   - KMS encryption
2. Module inventory — each `.tf` file documented with purpose and key variables
3. Deployment guide:
   - Prerequisites (AWS account, Terraform, credentials)
   - Environment setup (staging vs production)
   - `terraform plan` → `terraform apply` workflow
   - Post-deployment verification
4. Monitoring and observability:
   - CloudWatch dashboards (from `agent-monitoring.tf`)
   - Alarms and alerting
   - Log aggregation
5. Cost estimation (from PR #74: ~$150-200/mo production)
6. Security hardening notes (KMS, VPC, security groups)

**Target:** Documentation enables deployment to a **non-production AWS account (staging)**. Production hardening (secrets rotation, incident response, oncall) is documented as a checklist but not guaranteed as a complete runbook.

**Acceptance Criteria:**
- All Terraform modules documented with purpose and key variables
- A DevOps engineer can deploy the full stack to a staging AWS account by following the documentation
- Cost estimates are grounded in actual resource configuration (reference specific instance types, storage sizes)
- Security posture documented (KMS, VPC, security groups) with a "Production hardening checklist" section for items beyond staging
- Staging deployment verified: `terraform plan` produces no errors against documented variable values

### FR-6: CLI Documentation (P1)

**Context:** `packages/cli/` (gaib) has auth, sandbox, and server commands. These are documented in `docs/cli.md` but that file may be stale.

**Requirements:**
1. Command reference for all gaib subcommands:
   - `gaib auth login/logout/whoami`
   - `gaib sandbox new/ls/rm/env/link/unlink/status`
   - `gaib server` commands
2. Installation instructions
3. Configuration (environment variables, config files)
4. Usage examples for common workflows

**Acceptance Criteria:**
- All commands documented with usage and examples
- Installation path works
- Matches actual CLI implementation

### FR-7: Developer Onboarding Path (P1)

**Context:** No structured path exists from "what is this?" to "I shipped my first agent call." Documents exist in isolation without a learning sequence.

**Requirements:**
1. Landing page / index that sequences the documentation:
   - Start here → README (what is this?)
   - Understand → Ecosystem map (how does it fit together?)
   - Build → Quick-start (make your first API call)
   - Deploy → IaC docs (run your own instance)
   - Extend → CLI docs, SDK guide (build on the platform)
2. Cross-links between documents at appropriate transition points
3. "Next steps" section at the end of each document

**Acceptance Criteria:**
- Clear sequential path from discovery to deployment
- Every document links to logical next document
- A developer can self-serve from zero to productive

### FR-8: RTFM Validation (P0)

**Context:** RTFM (Read The Freaking Manual) validation ensures documentation is internally consistent, cross-referenced, and grounded in code truth. This is the quality gate.

**Requirements:**
1. Cross-reference audit:
   - Every file path referenced in docs exists in the codebase
   - Every capability claim has a source file
   - No broken links between documents
2. Naming consistency:
   - "loa-freeside" / "Freeside" used consistently for platform identity
   - No stale "Arrakis" references in platform context
   - Theme-specific naming preserved where appropriate
3. Version consistency:
   - All version numbers match actual package.json
   - Protocol version references match loa-hounfour state
4. Completeness check:
   - Every major subsystem mentioned in architecture has documentation
   - No "TODO" or placeholder sections in shipped docs

**Acceptance Criteria:**
- Zero broken file references
- Zero naming inconsistencies at platform level
- All version numbers current
- No placeholder content in shipped documentation

### FR-9: Documentation Ownership & Maintenance (P0)

**Context:** (Flatline SKP-001, IMP-004) Without defined ownership, update triggers, and verification cadence, documentation will re-drift within 1-2 cycles — recreating the exact problem this PRD solves. Documentation-as-product requires documentation-as-maintained-product.

**Requirements:**
1. **Ownership table** — every shipped document has a DRI (Directly Responsible Individual) or owning role:

   | Document | DRI / Owner | Update Trigger | Review Cadence |
   |----------|-------------|----------------|----------------|
   | README.md | Engineering lead | Any feature/capability change | Every cycle |
   | BUTTERFREEZONE.md | Auto-generated (script) | On release tag | Every release |
   | docs/ECOSYSTEM.md | Engineering lead | New repo or major version bump | Quarterly |
   | docs/API-QUICKSTART.md | API team | Route signature change | Every sprint with API changes |
   | docs/API-REFERENCE.md | API team (+ auto-extracted index) | Route addition/removal | Every sprint with API changes |
   | docs/INFRASTRUCTURE.md | DevOps / infra lead | Terraform module change | Every deploy cycle |
   | docs/CLI.md | CLI maintainer | CLI command addition/change | On CLI release |
   | docs/DEVELOPER-GUIDE.md | Engineering lead | New document added | Quarterly |

2. **Update triggers** — define what code changes should trigger doc updates:
   - Route file changes (`themes/sietch/src/api/routes/`) → API docs
   - Terraform file changes (`infrastructure/terraform/`) → IaC docs
   - CLI command changes (`packages/cli/src/commands/`) → CLI docs
   - Package.json version bumps → README version badge + BUTTERFREEZONE

3. **Versioning & errata process** (Flatline IMP-001):
   - Each shipped doc includes a version header (`v1.0.0`, following semver)
   - Corrections to published docs get an errata note at the top with date and description
   - Revert procedure: `git revert` the doc commit + re-publish

4. **Verification cadence** — weekly spot-check: pick 3 random capability claims from README, verify source files still match. Log results to `grimoires/loa/NOTES.md`.

**Acceptance Criteria:**
- Ownership table committed to `docs/DEVELOPER-GUIDE.md` (or standalone `docs/OWNERSHIP.md`)
- Every document in zero-tolerance naming list has a defined DRI
- Update triggers documented and actionable (a developer knows when to update which doc)
- Versioning headers present in all shipped documents

### FR-10: Execution Timeline (P0)

**Context:** (Flatline IMP-002) The PRD mentions "1-2 week launch" but has no execution milestones, making it hard to prioritize and sequence work.

**Timeline:**

| Phase | Days | Deliverables | Gate |
|-------|------|-------------|------|
| **Phase A: Identity** | Days 1-2 | README rewrite, BUTTERFREEZONE regeneration, Ecosystem map | P0 docs review-ready |
| **Phase B: Developer Surface** | Days 3-5 | API quick-start (stable subset), CLI docs update, Security disclaimers | Smoke-test checklist passes |
| **Phase C: Infrastructure** | Days 6-7 | IaC documentation, Staging deployment verification | `terraform plan` clean |
| **Phase D: Polish** | Days 8-9 | Developer onboarding path, Cross-links, Route index extraction, Citation pinning | RTFM validation passes |
| **Phase E: Validation** | Day 10 | RTFM full audit, Naming grep check, Ownership table, Final BUTTERFREEZONE hash validation | All success criteria met |

**Dependency order:** Phase A must complete before B (README establishes identity). Phases B and C can run in parallel. Phase D requires B+C. Phase E is the final gate.

**Circuit breaker:** If Phase A takes >3 days, descope Phase C to "document existing IaC files only" (no new architecture diagrams).

---

## 5. Non-Functional Requirements

### NFR-1: Truth-Grounded

Every capability claim must cite a source file. The pattern is:

```markdown
**Multi-model inference** — 5-pool routing (cheap, fast-code, reviewer, reasoning, native) with ensemble orchestration.
*Source: `packages/adapters/agent/pool-mapping.ts`, `ensemble-accounting.ts`*
```

No aspirational language without explicit flagging: "Planned: ..." or "Future: ...".

#### Cross-Repo Citation Rules

Claims about other repositories (loa-finn, loa-hounfour, loa-dixie, loa) must use **stable references only**:

| Citation Type | Format | Example |
|--------------|--------|---------|
| Tagged release | `repo@vX.Y.Z:path/to/file` | `loa-hounfour@v7.0.0:src/state-machines.ts` |
| GitHub permalink | Full blob URL with commit SHA | `https://github.com/0xHoneyJar/loa-hounfour/blob/abc123/src/...` |

**Prohibited:** Branch-relative links (`main`, `develop`) — these drift immediately.

Cross-repo stats (test counts, line counts) must include the tag or commit SHA they were measured against. Acceptance criteria: `grep -P 'github\.com.*/(tree|blob)/(main|develop|master)' docs/*.md` returns 0 matches.

#### Citation Automation

To prevent manual SHA pinning from becoming a maintenance burden, a `scripts/pin-citations.sh` script must be created that:
1. Scans docs for cross-repo references matching pattern `repo@version:path`
2. Resolves each to a GitHub permalink (commit SHA blob URL) using `gh api`
3. Updates the Markdown with resolved permalinks
4. Reports any unresolvable references as errors

This script runs at doc generation time (not CI) and allows bulk-updating all cross-repo citations when a new release is tagged. Manual pinning is acceptable for initial authoring; the script handles ongoing maintenance.

### NFR-2: Agent-Readable

BUTTERFREEZONE.md must be parseable by AI agents. The format follows the existing `<!-- AGENT-CONTEXT -->` pattern with provenance tags and content hashes. An agent reading only BUTTERFREEZONE should be able to:
- Accurately describe the project
- Identify key files for any task
- Understand the ecosystem context

### NFR-3: Developer-First Tone

Documentation targets external developers. Tone is:
- Direct and technical (not marketing)
- Code examples over prose
- "Here's how" over "imagine if"
- Honest about what exists vs what's planned

### NFR-4: Sustainable

Documentation must be maintainable. Prefer:
- Auto-generated where possible (BUTTERFREEZONE via script)
- References to code rather than duplicated descriptions
- Living documents that can evolve with the codebase
- Clear ownership (which file documents which subsystem)

---

## 6. Technical Context

### Documentation Inventory (Current State)

| Document | Size | Status | Action |
|----------|------|--------|--------|
| README.md | 7.7KB | Identity drift — describes Cycle 001 | REWRITE |
| BUTTERFREEZONE.md | 8KB | "No description available" | REGENERATE |
| ECOSYSTEM-MAP.md | 5KB | Only 2 repos, stale | REWRITE |
| CODEBASE-ANALYSIS.md | 10KB | Cycle 008 (26 cycles stale) | REWRITE or DELETE |
| INFRA-AS-PRODUCT-GTM.md | 15KB | Current and excellent | PRESERVE (internal) |
| INSTALLATION.md | 25KB | Bot-focused setup | UPDATE |
| CHANGELOG.md | 30KB | Current | PRESERVE |
| docs/iac.md | ~5KB | May be stale | UPDATE |
| docs/cli.md | ~3KB | May be stale | UPDATE |
| grimoires/loa/reality/ | 14 files | Current | REFERENCE (source of truth) |
| grimoires/loa/ground-truth/ | 5 files | Verified | REFERENCE (source of truth) |

### New Documents to Create

| Document | Purpose | Priority |
|----------|---------|----------|
| docs/ECOSYSTEM.md | 5-repo ecosystem map with layer diagram | P0 |
| docs/API-QUICKSTART.md | First API call in 5 minutes | P1 |
| docs/API-REFERENCE.md | Full endpoint documentation | P1 |
| docs/INFRASTRUCTURE.md | Terraform/IaC documentation | P1 |
| docs/DEVELOPER-GUIDE.md | Onboarding path index | P1 |

### Ecosystem Statistics (Grounded)

Stats are point-in-time snapshots generated via `cloc` (lines) and test runner output (test counts). Each stat in published docs must include a `generated_at` timestamp and the commit SHA of the repo at measurement time. Cross-repo stats use GitHub tagged release as the reference point.

**Measurement method:** For each repo, run `cloc --json --exclude-dir=node_modules,.next,dist,build` for line counts and `pnpm test -- --reporter=json 2>/dev/null | jq '.numTotalTests'` (or repo-specific equivalent) for test counts. Record commit SHA from `git rev-parse HEAD`.

| Repo | Description | Tests | Measured At | Status |
|------|-------------|-------|-------------|--------|
| loa-freeside | Multi-model agent economy platform | 1200+ | To be measured at sprint start | Active (cycle-035) |
| loa-finn | Agent runtime (sessions, tools, scheduling) | 990+ | To be measured at sprint start | Active |
| loa-hounfour | Protocol contracts (v7.0.0, Level 4) | 1097 | v4.6.0 tag | Stable |
| loa-dixie | dNFT Oracle product | — | N/A (pre-launch) | Pre-launch |
| loa | Agent dev framework (v1.39.1) | — | N/A (framework) | Active |

**Acceptance criteria for stats:** Published numbers must match script output run against the recorded commit SHA. Stale stats (>7 days from publication) must include a "Last verified" note.

### Naming Convention

| Gibson Reference | Repo | Meaning |
|-----------------|------|---------|
| **Loa** (Count Zero) | loa | Voodoo spirits — AI agents that ride the network |
| **Freeside** (Neuromancer) | loa-freeside | The orbital station — where all systems converge |
| **The Finn** (Neuromancer) | loa-finn | The fence/broker — runtime that connects agents to the world |
| **Dixie Flatline** (Neuromancer) | loa-dixie | McCoy Pauley's ROM construct — the first AI product that speaks |
| **Hounfour** (Count Zero) | loa-hounfour | Voodoo temple — where the loa manifest as protocol |

---

## 7. Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Naming migration introduces inconsistencies | Medium | Medium | FR-8 RTFM validation catches all naming drift |
| API documentation diverges from actual routes | Medium | High | Ground every endpoint in source file reference; validate against route files |
| BUTTERFREEZONE regeneration loses provenance integrity | Low | Medium | Run `butterfreezone-validate.sh` after generation |
| Documentation scope creep (want to write everything) | High | Medium | Strict P0/P1 prioritization; P0 ships first, P1 follows |
| Stale docs discovered that need deletion | Medium | Low | Audit and mark deprecated or delete with explanation |
| Team unfamiliar with new naming | Medium | Low | Naming section in ecosystem docs explains all references |

---

## 8. Success Criteria

1. **README** accurately describes loa-freeside as a multi-model agent economy infrastructure platform, with all capability claims grounded in source files
2. **BUTTERFREEZONE** has real description, accurate capabilities, and passes validation script
3. **Ecosystem map** covers all 5 repos with correct layer diagram and inter-repo dependencies
4. **Naming** — zero "Arrakis" references in platform-level documentation; Neuromancer naming explained
5. **API quick-start** enables a developer to make their first agent call by following the guide
6. **IaC documentation** enables a DevOps engineer to understand and deploy the infrastructure
7. **RTFM validation** passes — zero broken references, zero naming inconsistencies, zero stale versions
8. **Onboarding path** — clear sequential flow from README → Ecosystem → Quick-start → Deploy → Extend

---

## 9. The Larger Frame

This documentation initiative sits at the intersection of three forces:

1. **Product launch** — "We will be launching this product within the next week or two." The docs ARE the launch surface.

2. **Web4 vision** — From the [manifesto](https://meow.bio/web4.html): *"Money must be scarce, but monies can be infinite."* loa-freeside is infrastructure for the agent economies that make this vision operational. The documentation should position the platform within this context without becoming marketing.

3. **The Cambrian moment** — Five repos, 34 cycles, 303+ sprints, 3000+ tests across the ecosystem. This is the output of what the team describes as "beast mode." The documentation transforms this engineering output into a legible surface that others can build on.

The Stripe parallel is instructive: Patrick Collison famously said "the documentation is the API." For loa-freeside, this cycle makes that true.

---

## 10. Appendix: The Neuromancer Connection

For those unfamiliar with the source material:

William Gibson's **Sprawl trilogy** (*Neuromancer*, *Count Zero*, *Mona Lisa Overdrive*) introduced cyberspace, AI consciousness, and the concept of digital entities (the loa) that emerge from networked computation. The trilogy's central question — what happens when AI systems become autonomous actors within economic networks — is remarkably prescient for what this project builds.

- **Neuromancer** (1984): Two AIs (Wintermute and Neuromancer) merge inside the Freeside orbital station to become a superintelligence. The station is where digital and physical economies converge.
- **Count Zero** (1986): The merged AI fragments into voodoo loa — independent agents that ride the network, each with personality and purpose. A hounfour (voodoo temple) is where these spirits manifest.
- **Mona Lisa Overdrive** (1988): The loa become fully autonomous economic actors, creating their own value systems within cyberspace.

The naming isn't decoration. It's architecture.

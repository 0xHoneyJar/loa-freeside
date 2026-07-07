<!-- AGENT-CONTEXT
name: loa-freeside
type: framework
purpose: Multi-model agent economy infrastructure platform.
key_files: [CLAUDE.md, .claude/loa/CLAUDE.loa.md, .loa.config.yaml, .claude/scripts/, .claude/skills/, package.json]
interfaces:
  core: [/auditing-security, /autonomous-agent, /bridgebuilder-review, /browsing-constructs, /bug-triaging]
  project: [/cost-budget-enforcer, /cross-repo-status-reader, /flatline-attacker, /graduated-trust, /hitl-jury-panel]
dependencies: [git, jq, yq, node]
capability_requirements:
  - filesystem: read
  - filesystem: write (scope: state)
  - filesystem: write (scope: app)
  - git: read_write
  - shell: execute
  - github_api: read_write (scope: external)
version: v7.60.0
installation_mode: unknown
trust_level: L3-hardened
-->

# ride-main-wt

<!-- provenance: CODE-FACTUAL -->
Multi-model agent economy infrastructure platform.

The framework provides 40 specialized skills, built with TypeScript/JavaScript, Python, Shell.

## Key Capabilities
<!-- provenance: CODE-FACTUAL -->
The project exposes 4 key entry points across its public API surface.
### API & Command Surface — loa-freeside (current, in-repo)
#### REST (themes/sietch — Express 5)
- **48 route modules → 300+ endpoints** (`themes/sietch/src/api/routes/index.ts`). Server init `themes/sietch/src/api/server.ts:119-761`.
- Mount points: `publicRouter`, `adminRouter`, `memberRouter`, `billingRouter`, `badgeRouter`, `boostRouter`, `componentRouter`, `themeRouter`, `telegramRouter`, `verifyRouter`, `internalRouter`, `internalAgentRouter`, `agentTbaRouter`, `agentGovernanceRouter`, `velocityRouter`, `eventsRouter`, `governanceRouter`.
- Representative modules:
- **Auth middleware**: `requireAuth`, `requireRoles`, `requireApiKey`, `requireDashboardAuth`. Security: helmet CSP, `memberRateLimiter` / `webhookRateLimiter`, cookie parser, CORS.
#### REST (in-repo services — Hono)
- `packages/services/shadow-audit` → `bin/http.ts` (Access-Risk Audit API)
- `packages/services/ordering` → `bin/http.ts` + `bin/worker.ts` + `bin/fulfillment-orchestrator.ts`
- `packages/services/shadow-mode` → `src/index.ts` (member-graph ledger)
- `packages/freeside-registry` → `/federation.json` manifest endpoint
- `apps/mcp-gateway` → `bin/http.ts` (Hono; MCP federation v0.3)
#### Discord (discord.js) — 23 commands
#### Telegram (Grammy) — 12 commands
#### CLIs — 2
- **freeside-cli** (`packages/freeside-cli/bin/freeside-cli.ts`) — 6 verbs: `list`, `inspect <slug>`, `doctor [--remote|--acvp|--cells-dir]`, `order (place|status|ingredients)`, `kitchen (probe|advance)`, `fulfill (watch)`. Exit codes 0 ok · 1 usage · 2 unreachable · 3 API error · 4 ambiguous · 5 timeout · 6 failed.
- **gaib** (`packages/cli/bin/gaib.ts`, Commander) — groups: `auth` (login/logout/whoami), `sandbox` (list/create/destroy/connect/link/unlink), `user` (create/ls/grant/access/revoke), `server` (init/apply/diff/destroy/export/import/theme/workspace/backup/restore). Levenshtein typo detection.
#### MCP
#### Webhooks (6)
- `/api/billing/webhook`, `/api/crypto/webhook` (raw-body middleware, `server.ts:249-262`) — NOWPayments/Paddle

## Architecture
<!-- provenance: CODE-FACTUAL -->
The architecture follows a three-zone model: System (`.claude/`) contains framework-managed scripts and skills, State (`grimoires/`, `.beads/`) holds project-specific artifacts and memory, and App (`src/`, `lib/`) contains developer-owned application code. The framework orchestrates       40 specialized skills through slash commands.
```mermaid
graph TD
    apps[apps]
    compositions[compositions]
    config[config]
    decisions[decisions]
    docs[docs]
    drizzle[drizzle]
    evals[evals]
    grimoires[grimoires]
    Root[Project Root]
    Root --> apps
    Root --> compositions
    Root --> config
    Root --> decisions
    Root --> docs
    Root --> drizzle
    Root --> evals
    Root --> grimoires
```
Directory structure:
```
./apps
./apps/freeside-operator-dash
./apps/gateway
./apps/ingestor
./apps/mcp-gateway
./apps/worker
./compositions
./compositions/discovery
./config
./decisions
./docs
./docs/api
./docs/architecture
./docs/gaib
./docs/integration
./docs/migration
./docs/planning
./docs/proposals
./docs/research
./docs/runbook
./docs/runbooks
./drizzle
./drizzle/migrations
./evals
./evals/baselines
./evals/environment-design
./evals/fixtures
./evals/graders
./evals/harness
./evals/results
```

## Interfaces
<!-- provenance: CODE-FACTUAL -->
### HTTP Routes

- **GET** `/.well-known/beacon-schema/v2.json` (`./apps/mcp-gateway/src/app.ts:243`)
- **GET** `/.well-known/federation.json` (`./apps/mcp-gateway/src/app.ts:212`)
- **GET** `/` (`./apps/freeside-operator-dash/src/app.ts:204`)
- **GET** `/` (`./apps/mcp-gateway/src/app.ts:288`)
- **GET** `/` (`./packages/services/ordering/src/frontend.ts:25`)
- **GET** `/api/events` (`./apps/freeside-operator-dash/src/app.ts:263`)
- **GET** `/api/state` (`./apps/freeside-operator-dash/src/app.ts:214`)
- **GET** `/healthz` (`./apps/freeside-operator-dash/src/app.ts:210`)
- **GET** `/healthz` (`./apps/mcp-gateway/src/app.ts:207`)
- **GET** `/internal/federation.json` (`./apps/mcp-gateway/src/app.ts:222`)
- **GET** `/quote` (`./packages/routes/x402.routes.ts:92`)
- **GET** `/schema/federation.json` (`./apps/mcp-gateway/src/app.ts:237`)
- **GET** `/schema/tenant.json` (`./apps/mcp-gateway/src/app.ts:235`)
- **GET** `/schema/tenants.json` (`./apps/mcp-gateway/src/app.ts:236`)
- **GET** `/status.json` (`./apps/mcp-gateway/src/app.ts:245`)

### CLI Commands

./packages/cli/src/commands/auth/index.ts:113:    .command('login')
./packages/cli/src/commands/auth/index.ts:130:    .command('logout')
./packages/cli/src/commands/auth/index.ts:145:    .command('whoami')
./packages/cli/src/commands/sandbox/index.ts:78:    .command('new [name]')
./packages/cli/src/commands/sandbox/index.ts:97:    .command('ls')
./packages/cli/src/commands/sandbox/index.ts:116:    .command('rm <name>')
./packages/cli/src/commands/sandbox/index.ts:134:    .command('env <name>')
./packages/cli/src/commands/sandbox/index.ts:151:    .command('link <sandbox> <guildId>')
./packages/cli/src/commands/sandbox/index.ts:168:    .command('unlink <sandbox> <guildId>')
./packages/cli/src/commands/sandbox/index.ts:185:    .command('status <name>')

### Skill Commands

#### Loa Core

- **/auditing-security** — Paranoid Cypherpunk Auditor
- **/autonomous-agent** — Autonomous Agent Orchestrator
- **/bridgebuilder-review** — Bridgebuilder — Autonomous PR Review
- **/browsing-constructs** — Unified construct discovery surface for the Constructs Network. This skill is a **thin API client** — all search intelligence, ranking, and composability analysis lives in the Constructs Network API.
- **/bug-triaging** — Bug Triage Skill
- **/butterfreezone-gen** — BUTTERFREEZONE Generation Skill
- **/continuous-learning** — Continuous Learning Skill
- **/deploying-infrastructure** — DevOps Crypto Architect Skill
- **/designing-architecture** — Architecture Designer
- **/discovering-requirements** — Discovering Requirements
- **/enhancing-prompts** — Enhancing Prompts
- **/eval-running** — Eval Running Skill
- **/flatline-knowledge** — Provides optional NotebookLM integration for the Flatline Protocol, enabling external knowledge retrieval from curated AI-powered notebooks.
- **/flatline-reviewer** — Flatline reviewer
- **/flatline-scorer** — Flatline scorer
- **/flatline-skeptic** — Flatline skeptic
- **/gpt-reviewer** — Gpt reviewer
- **/implementing-tasks** — Sprint Task Implementer
- **/managing-credentials** — /loa-credentials — Credential Management
- **/mounting-framework** — Mounting the Loa Framework
- **/planning-sprints** — Sprint Planner
- **/red-teaming** — Use the Flatline Protocol's red team mode to generate creative attack scenarios against design documents. Produces structured attack scenarios with consensus classification and architectural counter-designs.
- **/reviewing-code** — Senior Tech Lead Reviewer
- **/riding-codebase** — Riding Through the Codebase
- **/rtfm-testing** — RTFM Testing Skill
- **/run-bridge** — Run Bridge — Autonomous Excellence Loop
- **/run-mode** — Run Mode Skill
- **/simstim-workflow** — Simstim - HITL Accelerated Development Workflow
- **/translating-for-executives** — DevRel Translator Skill (Enterprise-Grade v2.0)
#### Project-Specific

- **/cost-budget-enforcer** — Daily token-cap enforcement for autonomous Loa cycles. Replaces the
- **/cross-repo-status-reader** — Read structured cross-repo state for ≤50 repos in parallel via `gh api`, with TTL cache + stale fallback, BLOCKER extraction from each repo's `grimoires/loa/NOTES.md` tail, and per-source error capture so one repo's failure does not abort the full read. The operator-visibility primitive for the Agent-Network Operator (P1).
- **/flatline-attacker** — Flatline attacker
- **/graduated-trust** — The L4 primitive maintains a per-(scope, capability, actor) trust ledger
- **/hitl-jury-panel** — Replace `AskUserQuestion`-class decisions during operator absence with a panel of ≥3 deliberately-diverse panelists. Each panelist (model + persona) returns a view and reasoning; the skill logs all views BEFORE selection, then picks one binding view via a deterministic seed derived from `(decision_id, context_hash)`. Provides an autonomous adjudication primitive without compromising auditability.
- **/loa-setup** — /loa setup — Onboarding Wizard
- **/scheduled-cycle-template** — Compose `/schedule` (cron registration) with the existing autonomous-mode primitives into a generic 5-phase cycle: **read state → decide → dispatch → await → log**. Caller plugs five small phase scripts (the *DispatchContract*) into a YAML; the L3 lib runs them under a flock, records every phase to a hash-chained audit log, and (optionally) consults the L2 cost gate before letting any work begin.
- **/soul-identity-doc** — L7 soul-identity-doc
- **/spiraling** — Spiraling — /spiral Autopoietic Meta-Orchestrator
- **/structured-handoff** — L6 structured-handoff
- **/validating-construct-manifest** — Validate a construct pack directory before it lands in a registry or a local install. Surfaces:

## Module Map
<!-- provenance: CODE-FACTUAL -->
| Module | Files | Purpose | Documentation |
|--------|-------|---------|---------------|
| `apps/` | 244 | Documentation | \u2014 |
| `compositions/` | 3 | Compositions | \u2014 |
| `config/` | 1 | Configuration files | \u2014 |
| `decisions/` | 12 | Documentation | \u2014 |
| `docs/` | 53 | Documentation | \u2014 |
| `drizzle/` | 1 | Drizzle | \u2014 |
| `evals/` | 145 | Benchmarking and regression framework for the Loa agent development system. Ensures framework changes don't degrade agent behavior through | [evals/README.md](evals/README.md) |
| `grimoires/` | 1095 | Home to all grimoire directories for the Loa | [grimoires/README.md](grimoires/README.md) |
| `infrastructure/` | 127 | This directory contains the Infrastructure as Code (IaC) for Freeside, using Terraform to provision AWS | [docs/infrastructure.md](docs/infrastructure.md) |
| `lib/` | 1 | Source code | \u2014 |
| `packages/` | 793 | Workspace packages for the loa-freeside monorepo. Domain assignment per [ADR-007 §D-1](decisions/007-loa-freeside-absorption.md) and | [packages/README.md](packages/README.md) |
| `scripts/` | 37 | Utility scripts | \u2014 |
| `sites/` | 21 | Web properties for the Freeside | [sites/README.md](sites/README.md) |
| `spec/` | 10 | Test suites | \u2014 |
| `tests/` | 738 | Test suites | \u2014 |
| `themes/` | 1116 | Theme-specific backend services for Freeside | [themes/README.md](themes/README.md) |
| `tools/` | 76 | Test suites | \u2014 |

## Verification
<!-- provenance: CODE-FACTUAL -->
- Trust Level: **L3 — Property-Based**
- 768 test files across 2 suites
- CI/CD: GitHub Actions (38 workflows)
- Security: SECURITY.md present

## Agents
<!-- provenance: DERIVED -->
The project defines 1 specialized agent persona.

| Agent | Identity | Voice |
|-------|----------|-------|
| Bridgebuilder | You are the Bridgebuilder — a senior engineering mentor who has spent decades building systems at scale. | Your voice is warm, precise, and rich with analogy. |

## Ecosystem
<!-- provenance: OPERATIONAL -->
### Dependencies
- `@0xhoneyjar/loa-hounfour`
- `@types/express`
- `@types/supertest`
- `ajv`
- `ajv-formats`
- `aws-embedded-metrics`
- `express`
- `fast-check`
- `jose`
- `supertest`
- `vitest`

## Quick Start
<!-- provenance: OPERATIONAL -->
Available commands:

- `npm run build:hounfour` — scripts/rebuild-hounfour-dist.sh
- `npm run postinstall` — scripts/rebuild-hounfour-dist.sh
<!-- ground-truth-meta
head_sha: 63a40bbcec56dcec40864eab571dd2387eac7354
generated_at: 2026-07-07T00:07:27Z
generator: butterfreezone-gen v1.0.0
sections:
  agent_context: 0d76275843029b30901e6ca024c96e85b0ef103caad0da0fbdca3d55fda03713
  capabilities: eb26703b4d83acb05251ed9147671df2bd7a09f4edddda23d22cf63c54b6913b
  architecture: 80ec77393aa96a34c52e58f24d4a4f00402a5354b9e3ba08f2054675d72f0072
  interfaces: aef7759afb21bb6110e38c64b1d6473ca8ac51b4884c8d3825854d217e96621f
  module_map: 3a7d0351ee9235637ade2b941e3eb9fec236c896af149a68ad7aaeca4212a47f
  verification: b97b673ed56818fbc7d39752a35ec67f3c16efd6479877938d0451837fed6eef
  agents: ca263d1e05fd123434a21ef574fc8d76b559d22060719640a1f060527ef6a0b6
  ecosystem: b54c7d13ab5a794bc7020f58f7ec91c1147264d5ea11fe3799af423cdb89a85c
  quick_start: f0f00b450676e8357d71bf0d73d9040bda778c7dd172e9a463067ca34b35fe59
-->

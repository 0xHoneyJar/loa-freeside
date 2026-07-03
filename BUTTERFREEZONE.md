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
version: v7.51.5
installation_mode: unknown
trust_level: L3-hardened
-->

# cycle-consumption-truth

<!-- provenance: CODE-FACTUAL -->
Multi-model agent economy infrastructure platform.

The framework provides 40 specialized skills, built with TypeScript/JavaScript, Python, Shell.

## Key Capabilities
<!-- provenance: CODE-FACTUAL -->

### Straylight governance — quarantined by tools/governance-doctor.sh
### API Surface
#### REST API (themes/sietch/src/api/) — 80+ routes
- File — Domain
- `routes.ts` — Top-level mounting
- `admin.routes.ts` — Admin / governance operations
- `badge.routes.ts` — Badge CRUD + evaluation
- `billing.routes.ts` — Fiat billing
- `crypto-billing.routes.ts` — NowPayments + on-chain billing
- `telegram.routes.ts` — Telegram-specific endpoints
- `server.ts` — HTTP bootstrap
- `middleware.ts` — Auth, CORS, rate limit, request-id
- `errors.ts` — Error→HTTP mapping
##### Selected Routes
### Discovery
### Authn
### Agent gateway (proxy to packages/adapters/agent)

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
| `apps/` | 242 | Documentation | \u2014 |
| `compositions/` | 3 | Compositions | \u2014 |
| `config/` | 1 | Configuration files | \u2014 |
| `decisions/` | 12 | Documentation | \u2014 |
| `docs/` | 53 | Documentation | \u2014 |
| `drizzle/` | 1 | Drizzle | \u2014 |
| `evals/` | 137 | Benchmarking and regression framework for the Loa agent development system. Ensures framework changes don't degrade agent behavior through | [evals/README.md](evals/README.md) |
| `grimoires/` | 1030 | Home to all grimoire directories for the Loa | [grimoires/README.md](grimoires/README.md) |
| `infrastructure/` | 127 | This directory contains the Infrastructure as Code (IaC) for Freeside, using Terraform to provision AWS | [docs/infrastructure.md](docs/infrastructure.md) |
| `lib/` | 1 | Source code | \u2014 |
| `packages/` | 25455 | Workspace packages for the loa-freeside monorepo. Domain assignment per [ADR-007 §D-1](../decisions/007-loa-freeside-absorption.md) and | [packages/README.md](packages/README.md) |
| `scripts/` | 37 | Utility scripts | \u2014 |
| `sites/` | 21 | Web properties for the Freeside | [sites/README.md](sites/README.md) |
| `spec/` | 10 | Test suites | \u2014 |
| `tests/` | 737 | Test suites | \u2014 |
| `themes/` | 1116 | Theme-specific backend services for Freeside | [themes/README.md](themes/README.md) |
| `tools/` | 58 | Test suites | \u2014 |

## Verification
<!-- provenance: CODE-FACTUAL -->
- Trust Level: **L3 — Property-Based**
- 758 test files across 2 suites
- CI/CD: GitHub Actions (36 workflows)
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
head_sha: 7af874e496239f831ba0d2b2d549fc85c59b9571
generated_at: 2026-07-03T04:14:25Z
generator: butterfreezone-gen v1.0.0
sections:
  agent_context: 297035f834f57b204990f2e8156610c8b1fceb882d67ac458b3d6d6d3fcef0ff
  capabilities: bcb60f6d7c8b95aa0202469861bdf6195dcf3a605601899ee0ef7d59f81ad5b2
  architecture: 80ec77393aa96a34c52e58f24d4a4f00402a5354b9e3ba08f2054675d72f0072
  interfaces: aef7759afb21bb6110e38c64b1d6473ca8ac51b4884c8d3825854d217e96621f
  module_map: 5679bbca91484e570ba30a4c23194b4a5e9ba41f503e07dc797c1327a477b2b5
  verification: 235e427a5e4622616e25013e1c6a1d2e519e30631887bdecf49b26540eb92726
  agents: ca263d1e05fd123434a21ef574fc8d76b559d22060719640a1f060527ef6a0b6
  ecosystem: b54c7d13ab5a794bc7020f58f7ec91c1147264d5ea11fe3799af423cdb89a85c
  quick_start: f0f00b450676e8357d71bf0d73d9040bda778c7dd172e9a463067ca34b35fe59
-->

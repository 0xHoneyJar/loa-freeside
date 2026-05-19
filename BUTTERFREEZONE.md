<!-- AGENT-CONTEXT
name: loa-freeside
type: three-part-composable-substrate
purpose: |
  Vercel-shaped deployment platform for freeside-* modules + the
  discovery/composition network that makes them discoverable. The
  platform is the thin substrate; modules are the catalog operators
  ORDER; the network registry/CLI is how operators discover + deploy.
identity_model: vercel_analogy_3_part
parts:
  platform_substrate: apps/{gateway,worker,ingestor}/, themes/sietch/ (substrate-only after planned route extraction), packages/{core,adapters,sandbox}/, infrastructure/terraform/, grimoires/freeside-platform/
  modules_external: freeside-{storage,mint,activities,sonar,inventory} (separate repos)
  modules_in_repo_for_extraction: freeside-{score,mediums,billing,ledger} (currently in themes/sietch/src/{discord,telegram,services}, packages/services, packages/adapters)
  network: apps/mcp-gateway/, packages/{beacon-schema,freeside-registry,freeside-cli}/, grimoires/freeside-network/
honest_current_state: |
  Much of what should be freeside-* modules (score, mediums, billing, ledger)
  still lives inside platform paths. Vercel-style separation is direction,
  not present state. See ADR-008 §D-3.
firewall:
  ci_check: .github/workflows/path-domain-check.yml
  local_hook: tools/check-beacon-domain.sh
  cross_domain_prs: blocked
doctrine:
  absorption: decisions/007-loa-freeside-absorption.md
  layered_identity: decisions/008-freeside-as-layered-station.md
  status_adr_008: Proposed (operator-clarity session needed for specific extraction sequencing)
key_files: [CLAUDE.md, .claude/loa/CLAUDE.loa.md, .loa.config.yaml, decisions/007-loa-freeside-absorption.md, decisions/008-freeside-as-layered-station.md, .claude/scripts/, .claude/skills/, package.json]
interfaces:
  core: [/auditing-security, /autonomous-agent, /bridgebuilder-review, /browsing-constructs, /bug-triaging]
  project: [/cost-budget-enforcer, /cross-repo-status-reader, /flatline-attacker, /graduated-trust, /hitl-jury-panel]
  network: [freeside-cli list, freeside-cli inspect <slug>, freeside-cli doctor]
dependencies: [git, jq, yq, node]
capability_requirements:
  - filesystem: read
  - filesystem: write (scope: state)
  - filesystem: write (scope: app)
  - git: read_write
  - shell: execute
  - github_api: read_write (scope: external)
version: v7.17.0
installation_mode: unknown
trust_level: L3-hardened
-->

# loa-freeside

<!-- provenance: DERIVED; ratified by decisions/007 + decisions/008 -->

**Three-part composable substrate** (Vercel analogy):

- **Platform** — thin substrate (ECS/AWS/gateway/worker/HTTP/DB/queues) that hosts module runtimes
- **Modules** — the catalog operators ORDER (external `freeside-*` repos + in-repo concerns intended for future extraction)
- **Network** — discovery + composition layer (BeaconV3 schema, registry, MCP federation gateway, Vercel-like deployment CLI)

The platform doesn't know what a module *does* — it just hosts the runtime. The network tells operators what modules *exist*. The CLI is how operators deploy.

**Honest current state**: Much of what *should be* freeside-* modules (score, mediums, billing, ledger) still lives inside platform paths. Vercel-style separation is the **direction**, not the present. See [decisions/008-freeside-as-layered-station.md §D-3](decisions/008-freeside-as-layered-station.md) for the current-vs-intended state table. ADR-008 is **Status: Proposed** pending a follow-up operator-clarity session that resolves specific extraction sequencing.

CI enforces the workspace firewall (platform/network organizational split). See [decisions/007-loa-freeside-absorption.md](decisions/007-loa-freeside-absorption.md) for the absorption doctrine and [decisions/008-freeside-as-layered-station.md](decisions/008-freeside-as-layered-station.md) for the layered identity + Subway lens + 3-plane mental model.

<!-- provenance: CODE-FACTUAL -->

The framework provides 40 specialized skills, built with TypeScript/JavaScript, Python, Shell.

## Key Capabilities
<!-- provenance: CODE-FACTUAL -->

# API Surface
## REST API (themes/sietch/src/api/) — 80+ routes
### Selected Routes
# Discovery
# Authn
# Agent gateway (proxy to packages/adapters/agent)
# Admin / Governance (per-guild)
# Sessions

## Architecture
<!-- provenance: CODE-FACTUAL -->
The architecture follows a three-zone model: System (`.claude/`) contains framework-managed scripts and skills, State (`grimoires/`, `.beads/`) holds project-specific artifacts and memory, and App (`src/`, `lib/`) contains developer-owned application code. The framework orchestrates       40 specialized skills through slash commands.
```mermaid
graph TD
    apps[apps]
    config[config]
    decisions[decisions]
    docs[docs]
    drizzle[drizzle]
    evals[evals]
    grimoires[grimoires]
    infrastructure[infrastructure]
    Root[Project Root]
    Root --> apps
    Root --> config
    Root --> decisions
    Root --> docs
    Root --> drizzle
    Root --> evals
    Root --> grimoires
    Root --> infrastructure
```
Directory structure:
```
./apps
./apps/gateway
./apps/ingestor
./apps/mcp-gateway
./apps/worker
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
./evals/fixtures
./evals/graders
./evals/harness
./evals/results
./evals/suites
./evals/tasks
./evals/tests
./grimoires
```

## Interfaces
<!-- provenance: CODE-FACTUAL -->
### HTTP Routes

- **DELETE** `/sandbox/:sandboxId/reset` (`./themes/sietch/src/api/middleware/auth.ts:417`)
- **GET** `/.well-known/beacon-schema/v2.json` (`./apps/mcp-gateway/src/app.ts:242`)
- **GET** `/.well-known/federation.json` (`./apps/mcp-gateway/src/app.ts:211`)
- **GET** `/` (`./apps/mcp-gateway/src/app.ts:287`)
- **GET** `/admin/stats` (`./themes/sietch/src/api/middleware.ts:397`)
- **GET** `/config` (`./themes/sietch/src/api/middleware/dashboardAuth.ts:125`)
- **GET** `/healthz` (`./apps/mcp-gateway/src/app.ts:206`)
- **GET** `/internal/federation.json` (`./apps/mcp-gateway/src/app.ts:221`)
- **GET** `/protected` (`./themes/sietch/src/api/middleware/auth.ts:176`)
- **GET** `/quote` (`./packages/routes/x402.routes.ts:92`)
- **GET** `/schema/federation.json` (`./apps/mcp-gateway/src/app.ts:236`)
- **GET** `/schema/tenant.json` (`./apps/mcp-gateway/src/app.ts:234`)
- **GET** `/schema/tenants.json` (`./apps/mcp-gateway/src/app.ts:235`)
- **GET** `/status.json` (`./apps/mcp-gateway/src/app.ts:244`)
- **PATCH** `/:userId/thresholds` (`./themes/sietch/src/api/middleware/auth.ts:382`)

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
- **/flatline-reviewer** — Uflatline reviewer
- **/flatline-scorer** — Uflatline scorer
- **/flatline-skeptic** — Uflatline skeptic
- **/gpt-reviewer** — Ugpt reviewer
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
- **/flatline-attacker** — Uflatline attacker
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
| `apps/` | 220 | Uapps | \u2014 |
| `config/` | 1 | Configuration files | \u2014 |
| `decisions/` | 8 | Documentation | \u2014 |
| `docs/` | 51 | Documentation | \u2014 |
| `drizzle/` | 1 | Udrizzle | \u2014 |
| `evals/` | 122 | Benchmarking and regression framework for the Loa agent development system. Ensures framework changes don't degrade agent behavior through | [evals/README.md](evals/README.md) |
| `grimoires/` | 973 | Home to all grimoire directories for the Loa | [grimoires/README.md](grimoires/README.md) |
| `infrastructure/` | 260 | This directory contains the Infrastructure as Code (IaC) for Freeside, using Terraform to provision AWS | [docs/infrastructure.md](docs/infrastructure.md) |
| `lib/` | 1 | Source code | \u2014 |
| `packages/` | 62589 | Shared libraries and utilities for the Freeside | [packages/README.md](packages/README.md) |
| `scripts/` | 34 | Utility scripts | \u2014 |
| `sites/` | 21 | Web properties for the Freeside | [sites/README.md](sites/README.md) |
| `skills/` | 0 | Specialized agent skills | \u2014 |
| `spec/` | 10 | Test suites | \u2014 |
| `tests/` | 660 | Test suites | \u2014 |
| `themes/` | 48297 | Theme-specific backend services for Freeside | [themes/README.md](themes/README.md) |
| `tools/` | 25 | Shell scripts and utilities | \u2014 |

## Verification
<!-- provenance: CODE-FACTUAL -->
- Trust Level: **L3 — Property-Based**
- 670 test files across 2 suites
- CI/CD: GitHub Actions (29 workflows)
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

## Quick Start
<!-- provenance: OPERATIONAL -->
Available commands:

- `npm run build:hounfour` — scripts/rebuild-hounfour-dist.sh
- `npm run postinstall` — scripts/rebuild-hounfour-dist.sh
<!-- ground-truth-meta
head_sha: 4c97f8e10cca25237fcdcd8d97e09269873a9bc5
generated_at: 2026-05-19T03:03:44Z
generator: butterfreezone-gen v1.0.0
sections:
  agent_context: 8649138fb11d0ec7c3702194819d09a4aff405c4edefd26d81ffa618641f2820
  capabilities: 08a161a6712c3c6585cba69ccfc18111d790cf0d30601fe8be7808a727375bbd
  architecture: b1d16cab87498ebd1b420262959d426b9dabf7f0b76a77517d562b0150d4d1b3
  interfaces: d22d49c81788319a102fe8d1677b6f3b87bbfedf09abb566131ec909b64abcb8
  module_map: 5eff5becfb4d31f35209e68c012a9cb1e00b3f8af33c1101dadb9f29baf1d1be
  verification: 8615deb131dbbcb91605f1083126016dde23638454f1db4db82afc8df78ed02d
  agents: ca263d1e05fd123434a21ef574fc8d76b559d22060719640a1f060527ef6a0b6
  ecosystem: 41df6a594f66dfdccfc9516499e4826c04118fae1a2850465624443977bfd207
  quick_start: f0f00b450676e8357d71bf0d73d9040bda778c7dd172e9a463067ca34b35fe59
-->

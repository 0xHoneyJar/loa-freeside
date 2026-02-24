<!-- AGENT-CONTEXT
name: arrakis
type: framework
purpose: Commons Protocol — community-governed economic protocol for AI inference. Multi-model agent economy infrastructure platform.
key_files: [CLAUDE.md, .claude/loa/CLAUDE.loa.md, .loa.config.yaml, .claude/scripts/, .claude/skills/, package.json]
interfaces: [/auditing-security, /autonomous-agent, /bridgebuilder-review, /browsing-constructs, /bug-triaging]
dependencies: [git, jq, yq, node]
capability_requirements:
  - filesystem: read
  - filesystem: write (scope: state)
  - filesystem: write (scope: app)
  - git: read_write
  - shell: execute
  - github_api: read_write (scope: external)
version: v1.32.0
trust_level: L2-verified
-->

# loa-freeside

<!-- provenance: DERIVED -->
Commons Protocol — community-governed economic protocol for AI inference. Multi-model agent economy infrastructure platform.

The framework provides 29 specialized skills, built with TypeScript/JavaScript, Python, Shell.

## Key Capabilities
<!-- provenance: DERIVED -->
The project exposes 15 key entry points across its public API surface.

### .claude/adapters

- **_build_provider_config** — Build ProviderConfig from merged hounfour config. (`.claude/adapters/cheval.py:152`)
- **_check_feature_flags** — Check feature flags. (`.claude/adapters/cheval.py:192`)
- **_error_json** — Format error as JSON for stderr (SDD §4.2.2 Error Taxonomy). (`.claude/adapters/cheval.py:77`)
- **_load_persona** — Load persona.md for the given agent with optional system merge (SDD §4.3.2). (`.claude/adapters/cheval.py:96`)
- **cmd_cancel** — Cancel a Deep Research interaction. (`.claude/adapters/cheval.py:511`)
- **cmd_invoke** — Main invocation: resolve agent → call provider → return response. (`.claude/adapters/cheval.py:211`)
- **cmd_poll** — Poll a Deep Research interaction. (`.claude/adapters/cheval.py:467`)
- **cmd_print_config** — Print effective merged config with source annotations. (`.claude/adapters/cheval.py:442`)
- **cmd_validate_bindings** — Validate all agent bindings. (`.claude/adapters/cheval.py:453`)
- **main** — CLI entry point. (`.claude/adapters/cheval.py:547`)

### .claude/adapters/loa_cheval/config

- **LazyValue** — Deferred interpolation token. (`.claude/adapters/loa_cheval/config/interpolation.py:41`)
- **_check_env_allowed** — Check if env var name is in the allowlist. (`.claude/adapters/loa_cheval/config/interpolation.py:122`)
- **_check_file_allowed** — Validate and resolve a file path for secret reading. (`.claude/adapters/loa_cheval/config/interpolation.py:133`)
- **_get_credential_provider** — Get the credential provider chain (lazily initialized, thread-safe). (`.claude/adapters/loa_cheval/config/interpolation.py:192`)
- **_matches_lazy_path** — Check if a dotted config key path matches any lazy path pattern. (`.claude/adapters/loa_cheval/config/interpolation.py:275`)

## Architecture
<!-- provenance: DERIVED -->
The architecture follows a three-zone model: System (`.claude/`) contains framework-managed scripts and skills, State (`grimoires/`, `.beads/`) holds project-specific artifacts and memory, and App (`src/`, `lib/`) contains developer-owned application code. The framework orchestrates 29 specialized skills through slash commands.
```mermaid
graph TD
    apps[apps]
    decisions[decisions]
    docs[docs]
    drizzle[drizzle]
    evals[evals]
    github_fetch[github-fetch]
    grimoires[grimoires]
    infrastructure[infrastructure]
    Root[Project Root]
    Root --> apps
    Root --> decisions
    Root --> docs
    Root --> drizzle
    Root --> evals
    Root --> github_fetch
    Root --> grimoires
    Root --> infrastructure
```
Directory structure:
```
./apps
./apps/gateway
./apps/ingestor
./apps/worker
./decisions
./docs
./docs/api
./docs/architecture
./docs/gaib
./docs/integration
./docs/planning
./docs/proposals
./docs/research
./docs/runbook
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
./github-fetch
./grimoires
./grimoires/loa
./grimoires/pub
./infrastructure
```

## Interfaces
<!-- provenance: DERIVED -->
### HTTP Routes

- **DELETE** `/sandbox/:sandboxId/reset` (`themes/sietch/src/api/middleware/auth.ts:417`)
- **GET** `/admin/stats` (`themes/sietch/src/api/middleware.ts:397`)
- **GET** `/config` (`themes/sietch/src/api/middleware/dashboardAuth.ts:125`)
- **GET** `/protected` (`themes/sietch/src/api/middleware/auth.ts:176`)
- **GET** `/quote` (`packages/routes/x402.routes.ts:92`)
- **PATCH** `/:userId/thresholds` (`themes/sietch/src/api/middleware/auth.ts:382`)
- **POST** `/agents/:agentId/chat` (`packages/routes/x402.routes.ts:140`)
- **POST** `/config` (`themes/sietch/src/api/middleware/dashboardAuth.ts:217`)
- **POST** `/endpoint` (`themes/sietch/src/api/middleware/rate-limit.ts:367`)
- **POST** `/inference` (`themes/sietch/src/api/middleware/developer-key-auth.ts:156`)
- **POST** `/nowpayments` (`packages/routes/webhooks.routes.ts:92`)
- **POST** `/register` (`themes/sietch/src/api/routes/agent-identity.routes.ts:37`)

### CLI Commands

packages/cli/src/commands/auth/index.ts:113:    .command('login')
packages/cli/src/commands/auth/index.ts:130:    .command('logout')
packages/cli/src/commands/auth/index.ts:145:    .command('whoami')
packages/cli/src/commands/sandbox/index.ts:78:    .command('new [name]')
packages/cli/src/commands/sandbox/index.ts:97:    .command('ls')
packages/cli/src/commands/sandbox/index.ts:116:    .command('rm <name>')
packages/cli/src/commands/sandbox/index.ts:134:    .command('env <name>')
packages/cli/src/commands/sandbox/index.ts:151:    .command('link <sandbox> <guildId>')
packages/cli/src/commands/sandbox/index.ts:168:    .command('unlink <sandbox> <guildId>')
packages/cli/src/commands/sandbox/index.ts:185:    .command('status <name>')

### Skill Commands

- **/auditing-security** — Paranoid Cypherpunk Auditor
- **/autonomous-agent** — Autonomous agent
- **/bridgebuilder-review** — Bridgebuilder — Autonomous PR Review
- **/browsing-constructs** — Provide a multi-select UI for browsing and installing packs from the Loa Constructs Registry. Enables composable skill installation per-repo.
- **/bug-triaging** — Bug Triage Skill
- **/butterfreezone-gen** — BUTTERFREEZONE Generation Skill
- **/continuous-learning** — Continuous Learning Skill
- **/deploying-infrastructure** — Deploying infrastructure
- **/designing-architecture** — Architecture Designer
- **/discovering-requirements** — Discovering Requirements
- **/enhancing-prompts** — Enhancing prompts
- **/eval-running** — Eval running
- **/flatline-knowledge** — Provides optional NotebookLM integration for the Flatline Protocol, enabling external knowledge retrieval from curated AI-powered notebooks.
- **/flatline-reviewer** — Flatline reviewer
- **/flatline-scorer** — Flatline scorer
- **/flatline-skeptic** — Flatline skeptic
- **/gpt-reviewer** — Gpt reviewer
- **/implementing-tasks** — Sprint Task Implementer
- **/managing-credentials** — /loa-credentials — Credential Management
- **/mounting-framework** — Create structure (preserve if exists)
- **/planning-sprints** — Sprint Planner
- **/red-teaming** — Use the Flatline Protocol's red team mode to generate creative attack scenarios against design documents. Produces structured attack scenarios with consensus classification and architectural counter-designs.
- **/reviewing-code** — Senior Tech Lead Reviewer
- **/riding-codebase** — Riding Through the Codebase
- **/rtfm-testing** — RTFM Testing Skill
- **/run-bridge** — Run Bridge — Autonomous Excellence Loop
- **/run-mode** — Run mode
- **/simstim-workflow** — Check post-PR state
- **/translating-for-executives** — Translating for executives

## Module Map
<!-- provenance: DERIVED -->
| Module | Files | Purpose | Documentation |
|--------|-------|---------|---------------|
| `apps/` | 34990 | Apps | \u2014 |
| `decisions/` | 6 | Documentation | \u2014 |
| `docs/` | 43 | Documentation | \u2014 |
| `drizzle/` | 1 | Drizzle | \u2014 |
| `evals/` | 122 | Benchmarking and regression framework for the Loa agent development system. Ensures framework changes don't degrade agent behavior through | [evals/README.md](evals/README.md) |
| `github-fetch/` | 11 | Github fetch | \u2014 |
| `grimoires/` | 1583 | Home to all grimoire directories for the Loa | [grimoires/README.md](grimoires/README.md) |
| `infrastructure/` | 193 | This directory contains the Infrastructure as Code (IaC) for Arrakis, using Terraform to provision AWS | [infrastructure/README.md](infrastructure/README.md) |
| `packages/` | 55089 | Shared libraries and utilities for the Arrakis | [packages/README.md](packages/README.md) |
| `scripts/` | 26 | Utility scripts | \u2014 |
| `sites/` | 28151 | Web properties for the Arrakis | [sites/README.md](sites/README.md) |
| `spec/` | 6 | Test suites | \u2014 |
| `tests/` | 97 | Test suites | \u2014 |
| `themes/` | 66066 | Theme-specific backend services for Arrakis | [themes/README.md](themes/README.md) |

## Verification
<!-- provenance: CODE-FACTUAL -->
- Trust Level: **L2 — CI Verified**
- 103 test files across 2 suites
- CI/CD: GitHub Actions (25 workflows)
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
- `jose`
- `supertest`

## Quick Start
<!-- provenance: OPERATIONAL -->

### For Developers (API integration)

```bash
git clone https://github.com/0xHoneyJar/loa-freeside.git
cd loa-freeside
pnpm install

# Set up environment
cp .env.example .env
# Fill: DATABASE_URL, REDIS_URL, JWT_SECRET

# Start backing services
docker-compose up -d  # PostgreSQL + Redis

# Run database migrations
cd themes/sietch && npx drizzle-kit push && cd ../..

# Start development server
pnpm run dev
<!-- ground-truth-meta
head_sha: ab51fc464aa6580568966d99df802f3a9b4107b1
generated_at: 2026-02-24T08:04:34Z
generator: butterfreezone-gen v1.0.0
sections:
  agent_context: 9153dda48b2c1ccafbd76cccde885039f7ba5f00a2b152e44e69ea6a28111685
  capabilities: ab2576b1f2e7e8141f0e93e807d26ed2b7b155e21c96d787507a3ba933bb9795
  architecture: 4986601f929268fa86e95a13b5612852a9e41efb05e98d20d6cc4c82603501ac
  interfaces: 8a27e7dd9f0927654886f67ab89c3f127278c6651246f55052368a4ca60f5dd9
  module_map: 2e1490059891ed129bfb98b396394b9cd0e77455acad02b3380eff86e9d97b9c
  verification: 88a72d1151e45027dfeadb411d3f41b1d71d2ac779bcc921db9e99b7c5d3a2ac
  agents: ca263d1e05fd123434a21ef574fc8d76b559d22060719640a1f060527ef6a0b6
  ecosystem: 29fc390a2a77ec8d5bdbe657182dd47a2a5cd0c0c36c74c763c9e65cfad170e3
  quick_start: aa15ed859d837420815f7e0948f08651a127ddd6db965df8b99600b5ef930172
-->

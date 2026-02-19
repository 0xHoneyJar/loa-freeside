<!-- AGENT-CONTEXT
name: loa-freeside
type: platform
purpose: Multi-model agent economy infrastructure — inference routing, budget atomicity, token-gated capability markets, and payment rails for Web3 communities.
key_files:
  - packages/core/ports/agent-gateway.ts
  - packages/adapters/agent/pool-mapping.ts
  - packages/adapters/agent/budget-manager.ts
  - packages/adapters/agent/ensemble-accounting.ts
  - packages/adapters/agent/byok-manager.ts
  - themes/sietch/src/api/routes/agents.routes.ts
  - themes/sietch/src/api/routes/billing-routes.ts
  - themes/sietch/src/api/routes/verify.routes.ts
  - packages/cli/src/index.ts
  - infrastructure/terraform/main.tf
  - apps/gateway/src/main.rs
  - packages/shared/nats-schemas/src/routing.ts
interfaces: [REST API (80+ endpoints), Discord (22+ slash commands), Telegram (10+ commands), CLI (gaib), NATS event protocol]
dependencies: [node>=22, pnpm, rust (gateway), postgresql, redis, terraform, docker]
capability_requirements:
  - inference: multi-model routing (5 pools)
  - billing: budget-atomic accounting (BigInt micro-USD)
  - auth: token-gated access (9-tier conviction)
  - distribution: discord, telegram, rest, nats
  - infrastructure: aws ecs via terraform (20 modules)
version: 6.0.0
trust_level: grounded
-->

# loa-freeside

<!-- provenance: CODE-FACTUAL -->
Multi-model agent economy infrastructure platform. Token-gated AI capabilities, budget-atomic inference, and cross-chain community management delivered as Discord, Telegram, and REST APIs.

Layer 4 in the 5-layer Loa protocol stack (Framework → Protocol → Runtime → **Platform** → Products).

## Key Capabilities

### Agent Gateway
<!-- provenance: CODE-FACTUAL -->
<!-- cite: loa-freeside:packages/adapters/agent/pool-mapping.ts -->
<!-- cite: loa-freeside:packages/adapters/agent/budget-manager.ts -->
<!-- cite: loa-freeside:packages/adapters/agent/ensemble-accounting.ts -->

- **5-pool model routing** — cheap, fast-code, reviewer, reasoning, native tiers mapped to provider models
- **Budget atomicity** — BigInt micro-USD precision with two-counter Redis Lua scripts; zero precision loss
- **Ensemble strategies** — best_of_n, consensus, fallback with per-model cost attribution
- **4-dimension rate limiting** — community, user, channel, burst
- **SSE streaming** — with reconciliation for dropped connections
- **Token estimation** — calibrated per-model token estimation for budget reservation

### BYOK (Bring Your Own Key)
<!-- provenance: CODE-FACTUAL -->
<!-- cite: loa-freeside:packages/adapters/agent/byok-manager.ts -->
<!-- cite: loa-freeside:packages/adapters/agent/byok-proxy-handler.ts -->

- **Envelope encryption** — AES-256-GCM + KMS wrap
- **LRU cache** with circuit breaker
- **Key isolation** — BYOK egress separated from platform keys
- **Audit trail** — structured capability audit events per invocation

### Token-Gated Access
<!-- provenance: CODE-FACTUAL -->
<!-- cite: loa-freeside:themes/sietch/src/services/ -->
<!-- cite: loa-freeside:packages/core/ports/score-service.ts -->

- **9-tier progression** — BGT holdings and community rank determine tier placement
- **Conviction scoring** — holding duration, accumulation patterns, trading behavior
- **Capability markets** — free, pro, enterprise tiers mapped to model pools
- **Wallet verification** — session-based signature verification with timing-safe comparisons

### Billing & Payments
<!-- provenance: CODE-FACTUAL -->
<!-- cite: loa-freeside:themes/sietch/src/api/routes/billing-routes.ts -->
<!-- cite: loa-freeside:themes/sietch/src/api/routes/credit-pack-routes.ts -->

- **Paddle integration** — checkout, subscriptions, webhooks, customer portal
- **Crypto payments** — NOWPayments integration (feature-flagged)
- **Shadow billing** — parallel billing tracking for migration testing
- **Entitlements caching** — feature access with audit logging

### Distribution Channels
<!-- provenance: CODE-FACTUAL -->
<!-- cite: loa-freeside:themes/sietch/src/discord/ -->
<!-- cite: loa-freeside:themes/sietch/src/telegram/ -->
<!-- cite: loa-freeside:apps/gateway/src/main.rs -->

- **Discord** — 22+ slash commands, Rust/Axum gateway proxy with multi-shard pool (Twilight 0.17)
- **Telegram** — Grammy bot framework with 10+ commands, throttled streaming edits
- **REST API** — 80+ Express 5.x endpoints with Zod validation
- **NATS protocol** — cross-language wire format with Zod schemas and JSON fixtures

### Coexistence & Migration
<!-- provenance: CODE-FACTUAL -->
<!-- cite: loa-freeside:packages/adapters/coexistence/ -->
<!-- cite: loa-freeside:themes/sietch/src/api/routes/coexistence.routes.ts -->

- **4 transition modes** — shadow → parallel → primary → exclusive
- **Shadow ledger** — divergence tracking alongside existing verification bots
- **Incumbent monitoring** — health checks with emergency rollback

### Infrastructure-as-Code
<!-- provenance: CODE-FACTUAL -->
<!-- cite: loa-freeside:infrastructure/terraform/ecs.tf -->
<!-- cite: loa-freeside:infrastructure/terraform/agent-monitoring.tf -->
<!-- cite: loa-freeside:infrastructure/terraform/byok-security.tf -->

- **20 Terraform modules** — ECS, RDS, ElastiCache, ALB, Route53, CloudWatch, KMS
- **Agent monitoring** — CloudWatch dashboards + alarms for gateway metrics
- **BYOK security** — least-privilege IAM roles per service

## Architecture
<!-- provenance: CODE-FACTUAL -->

```
loa-freeside/
├── packages/
│   ├── core/ports/            # 18 port interfaces (IAgentGateway, IChainProvider, etc.)
│   ├── adapters/              # 8 adapter modules
│   │   ├── agent/             # Gateway, BudgetManager, BYOK, ensemble, audit
│   │   ├── chain/             # RPC, Dune Sim API, hybrid provider
│   │   ├── storage/           # Drizzle ORM + PostgreSQL + RLS
│   │   ├── synthesis/         # BullMQ queue for Discord API
│   │   ├── wizard/            # 8-step onboarding orchestrator
│   │   ├── themes/            # ThemeRegistry, SietchTheme
│   │   ├── security/          # Vault, KillSwitch, MFA
│   │   └── coexistence/       # Shadow mode, migration engine
│   ├── cli/                   # gaib CLI (auth, sandbox, server)
│   ├── sandbox/               # Schema provisioning, event routing
│   └── shared/nats-schemas/   # Cross-language wire format (Zod + JSON)
├── themes/sietch/             # Main service (v6.0.0)
│   ├── src/api/routes/        # 42 route files (80+ endpoints)
│   ├── src/discord/commands/  # 22+ slash commands
│   ├── src/telegram/          # Grammy bot (10+ commands)
│   └── src/trigger/           # 7 cron jobs
├── apps/
│   ├── gateway/               # Rust/Axum Discord gateway proxy
│   ├── ingestor/              # Event ingestion service
│   └── worker/                # Background job worker (NATS + RabbitMQ)
├── infrastructure/terraform/  # AWS ECS deployment (20 modules, 81 .tf files)
└── evals/                     # Evaluation framework + test suites
```

**Hexagonal architecture:** Core ports define interfaces, adapters implement them. No adapter imports another adapter directly.

## Interfaces
<!-- provenance: CODE-FACTUAL -->

### REST API Routes
<!-- cite: loa-freeside:themes/sietch/src/api/routes/ -->

| Domain | Route File | Key Endpoints |
|--------|-----------|---------------|
| Agent | `agents.routes.ts` | `POST /api/agents/invoke`, `GET /api/agents/health`, `GET /.well-known/jwks.json` |
| Agent Identity | `agent-identity.routes.ts` | `POST /register`, `GET /:id/identity`, `GET /:id/provenance` |
| Agent Governance | `agent-governance.routes.ts` | Agent governance endpoints |
| Auth | `auth.routes.ts` | Authentication endpoints |
| Billing | `billing-routes.ts` | Paddle checkout, subscriptions, webhooks |
| Credit Packs | `credit-pack-routes.ts` | Credit pack purchase and management |
| Crypto Billing | `crypto-billing.routes.ts` | NOWPayments integration |
| Coexistence | `coexistence.routes.ts` | Shadow mode, migration status |
| Verify | `verify.routes.ts` | Wallet signature verification |
| Users | `users.routes.ts` | User profile and management |
| Threshold | `threshold.routes.ts` | Tier threshold configuration |
| Web3 | `web3.routes.ts` | On-chain data queries |
| Admin | `admin.routes.ts` | Platform administration |
| Dashboard | `dashboard/` | Creator dashboard, drift monitoring, restore |

### Discord Commands
<!-- cite: loa-freeside:themes/sietch/src/discord/commands/ -->

`/agent`, `/alerts`, `/badges`, `/directory`, `/leaderboard`, `/naib`, `/onboard`, `/position`, `/profile`, `/register-waitlist`, `/resume`, `/simulation`, `/stats`, `/threshold`, `/verify`, `/water-share`, admin commands (`/admin-badge`, `/admin-migrate`, `/admin-stats`, `/admin-takeover`, `/admin-water-share`)

### Telegram Commands
<!-- cite: loa-freeside:themes/sietch/src/telegram/commands/ -->

`/start`, `/help`, `/agent`, `/alerts`, `/leaderboard`, `/refresh`, `/score`, `/status`, `/unlink`, `/verify`

### CLI Commands (gaib)
<!-- cite: loa-freeside:packages/cli/src/commands/ -->

| Command Group | Commands |
|--------------|----------|
| `gaib auth` | `login`, `logout`, `whoami` |
| `gaib sandbox` | `new`, `ls`, `rm`, `env`, `link`, `unlink`, `status` |
| `gaib server` | IaC deployment commands |

### NATS Event Protocol
<!-- cite: loa-freeside:packages/shared/nats-schemas/src/routing.ts -->

Event types: `guild.join`, `guild.leave`, `guild.update`, `member.join`, `member.leave`, `member.update`, `interaction.create`

Wire format: Zod schemas with JSON fixtures as neutral source of truth (validated by both TypeScript and Rust).

## Module Map
<!-- provenance: CODE-FACTUAL -->

| Module | TS Files | Purpose |
|--------|----------|---------|
| `packages/core/ports/` | 18 | Port interfaces (hexagonal architecture boundary) |
| `packages/adapters/agent/` | ~30 | Agent gateway, budget, BYOK, ensemble, audit |
| `packages/adapters/chain/` | ~10 | RPC, Dune Sim, hybrid chain provider |
| `packages/adapters/storage/` | ~15 | Drizzle ORM + PostgreSQL + RLS |
| `packages/adapters/coexistence/` | ~8 | Shadow mode, migration engine |
| `packages/adapters/security/` | ~6 | Vault, KillSwitch, MFA |
| `packages/adapters/synthesis/` | ~5 | BullMQ queue for Discord API |
| `packages/adapters/wizard/` | ~5 | 8-step onboarding orchestrator |
| `packages/adapters/themes/` | ~4 | ThemeRegistry, SietchTheme |
| `packages/cli/` | ~15 | gaib CLI (auth, sandbox, server) |
| `packages/shared/nats-schemas/` | ~8 | Cross-language wire format |
| `themes/sietch/src/api/` | 42 routes | Express REST API |
| `themes/sietch/src/discord/` | 22+ cmds | Discord slash commands |
| `themes/sietch/src/telegram/` | 13 | Grammy Telegram bot |
| `apps/gateway/` | Rust | Axum Discord gateway proxy (Twilight 0.17) |
| `infrastructure/terraform/` | 81 .tf | AWS ECS deployment (20 modules) |
| `evals/` | ~120 | Evaluation framework + test suites |

**Totals:** 1,379 TypeScript files, 442 test files, 81 Terraform files.

## Verification
<!-- provenance: CODE-FACTUAL -->

- **Test files:** 442 across packages, themes, and evals
- **Testing framework:** Vitest + fast-check (property-based)
- **CI/CD:** GitHub Actions
- **Infrastructure validation:** `terraform plan` + `terraform validate`
- **Security:** BYOK envelope encryption (AES-256-GCM + KMS), RLS on PostgreSQL

## Ecosystem
<!-- provenance: OPERATIONAL -->

| Layer | Repo | Purpose |
|-------|------|---------|
| 5 Products | [loa-dixie](https://github.com/0xHoneyJar/loa-dixie) | dNFT Oracle — first customer |
| 4 Platform | **loa-freeside** | API, Discord/TG, billing, IaC |
| 3 Runtime | [loa-finn](https://github.com/0xHoneyJar/loa-finn) | Sessions, tool sandbox, memory |
| 2 Protocol | [loa-hounfour](https://github.com/0xHoneyJar/loa-hounfour) | NATS schemas, state machines |
| 1 Framework | [loa](https://github.com/0xHoneyJar/loa) | Agent dev framework, skills |

**Direct dependency:** `@0xhoneyjar/loa-hounfour` (protocol schemas consumed for gateway event validation).

See [docs/ECOSYSTEM.md](docs/ECOSYSTEM.md) for the full ecosystem map.

## Quick Start
<!-- provenance: OPERATIONAL -->

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
# → http://localhost:3000

# Verify
curl http://localhost:3000/api/agents/health
```

See [docs/API-QUICKSTART.md](docs/API-QUICKSTART.md) for the full developer tutorial.
See [INSTALLATION.md](INSTALLATION.md) for operator deployment guide.
<!-- ground-truth-meta
head_sha: 0fe59b54
generated_at: 2026-02-19T12:30:00Z
generator: manual (cycle-035 S304-T2)
sections:
  agent_context: pending-rehash
  capabilities: pending-rehash
  architecture: pending-rehash
  interfaces: pending-rehash
  module_map: pending-rehash
  verification: pending-rehash
  ecosystem: pending-rehash
  quick_start: pending-rehash
-->

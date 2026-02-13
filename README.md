# Arrakis

[![Version](https://img.shields.io/badge/version-7.0.0-blue.svg)](CHANGELOG.md)
[![License](https://img.shields.io/badge/license-AGPL--3.0-green.svg)](LICENSE.md)

Engagement intelligence platform for Web3 communities. Conviction scoring and tiered progression delivered as Discord and Telegram roles.

## What is Arrakis?

Arrakis is a multi-tenant community infrastructure platform built for Web3. It connects to your Discord server and Telegram group, reads on-chain token holdings (BGT on Berachain), and automatically assigns roles based on a 9-tier progression system.

Members earn conviction scores based on holding duration, accumulation patterns, and on-chain activity. Scores drive tier placement, which drives role assignment, which drives channel access. The entire pipeline is automated — communities configure their rules once and Arrakis handles the rest.

For communities running existing verification bots (Collab.Land, Matrica, Guild.xyz), Arrakis offers a Shadow Mode that runs in parallel without disrupting your current setup. Compare role assignments in real-time, tune thresholds, and switch over when ready.

## Features

### Conviction Scoring

Algorithmic scoring based on on-chain behavior:
- **Holding Duration** — Longer holding periods increase score
- **Accumulation Pattern** — Buying during dips shows conviction
- **Trading Behavior** — Diamond hands rewarded, frequent selling penalized
- **On-Chain Activity** — Governance participation, staking, protocol interactions

### 9-Tier Progression System

Dune-themed tiers based on BGT holdings and community rank:

| Tier | Name | BGT Threshold | Rank Range |
|------|------|--------------|------------|
| 1 | Naib | (by rank) | Top 1–7 |
| 2 | Fedaykin | (by rank) | Top 8–69 |
| 3 | Usul | 1,111 BGT | 70–100 |
| 4 | Sayyadina | 888 BGT | 101–150 |
| 5 | Mushtamal | 690 BGT | 151–200 |
| 6 | Sihaya | 420 BGT | 201–300 |
| 7 | Qanat | 222 BGT | 301–500 |
| 8 | Ichwan | 69 BGT | 501–1,000 |
| 9 | Hajra | 6.9 BGT | 1,001+ |

### Badge System

Achievement badges for community milestones:
- **Water Sharer** — Referral chain tracking with recursive lineage
- **Engaged** — Consistent community participation
- **Veteran** — Long-term membership tenure
- **Former Naib** — Previously held top leadership rank
- **Taqwa** — Community recognition badge

### Agent Gateway (Hounfour)

AI-powered community interactions with budget management:
- Per-community monthly budgets with two-counter atomicity
- 5 model tiers: cheap, fast-code, reviewer, reasoning, native
- Rate limiting (community, user, channel, burst dimensions)
- Streaming via SSE with reconciliation for dropped connections

### Shadow Mode

Test alongside existing verification bots:
- Compare role assignments in real-time against Collab.Land/Matrica/Guild.xyz
- Divergence tracking via shadow ledger
- Tune thresholds before going live
- Zero disruption to existing setup

### QA Sandbox

Interactive testing environment for administrators:
- Assume any tier/role combination
- Test permission gates and threshold configurations
- Schema provisioning per sandbox instance
- Visual tier hierarchy

## Architecture

```
arrakis/
├── packages/
│   ├── core/               # Port interfaces + domain types
│   │   ├── ports/          # IChainProvider, IStorageProvider, etc.
│   │   └── domain/         # WizardSession, CommunityManifest
│   ├── adapters/           # 8 adapter modules
│   │   ├── agent/          # AgentGateway, BudgetManager
│   │   ├── chain/          # RPC, Dune Sim, hybrid provider
│   │   ├── storage/        # Drizzle ORM + PostgreSQL + RLS
│   │   ├── synthesis/      # BullMQ queue for Discord API
│   │   ├── wizard/         # 8-step onboarding orchestrator
│   │   ├── themes/         # ThemeRegistry, SietchTheme
│   │   ├── security/       # Vault, KillSwitch, MFA
│   │   └── coexistence/    # Shadow mode, migration
│   ├── cli/                # Gaib CLI (auth, sandbox, server IaC)
│   └── sandbox/            # Schema provisioning, event routing
├── themes/sietch/          # Main Discord/Telegram bot service
│   ├── src/
│   │   ├── api/            # Express REST API (80+ routes)
│   │   ├── discord/        # Slash commands (22+)
│   │   ├── telegram/       # Grammy bot (10 commands)
│   │   └── trigger/        # Scheduled tasks (7 cron jobs)
│   └── drizzle/            # Database migrations
├── apps/
│   ├── gateway/            # Rust/Axum Discord gateway proxy
│   ├── ingestor/           # Event ingestion service
│   └── worker/             # Background job worker
└── infrastructure/
    └── terraform/          # AWS ECS deployment (IaC)
```

## Technology Stack

| Layer | Technology |
|-------|------------|
| Runtime | Node.js 20+, Rust (gateway) |
| Language | TypeScript (strict), Rust |
| Bot Frameworks | discord.js v14, Grammy (Telegram) |
| API | Express, Zod validation (1,736-line config schema) |
| Database | PostgreSQL 15 + Drizzle ORM + Row-Level Security |
| Cache | Redis 7 (ioredis) |
| Queue | BullMQ (synthesis, reaper), Trigger.dev (cron) |
| Blockchain | viem (RPC), Dune Sim API (hybrid mode) |
| Infrastructure | Terraform, AWS ECS, Docker |
| Testing | Vitest |

## Quick Start

```bash
# Clone
git clone https://github.com/0xHoneyJar/arrakis.git
cd arrakis

# Install dependencies
npm install

# Set up environment
cp themes/sietch/.env.example themes/sietch/.env
# Edit .env with your Discord bot token, database URL, etc.

# Run database migrations
cd themes/sietch
npx drizzle-kit push

# Start development server
npm run dev
```

See [INSTALLATION.md](INSTALLATION.md) for detailed setup including Docker, database, Redis, and deployment configuration.

## Configuration

Key environment variables (see INSTALLATION.md for full list):

| Variable | Required | Description |
|----------|----------|-------------|
| DISCORD_BOT_TOKEN | Yes | Discord bot token |
| DISCORD_GUILD_ID | Yes | Discord server ID |
| DATABASE_URL | Yes | PostgreSQL connection URL |
| BERACHAIN_RPC_URLS | Yes | Comma-separated RPC endpoints |
| BGT_ADDRESS | Yes | BGT token contract address |

Feature flags control optional subsystems:

| Flag | Default | Enables |
|------|---------|---------|
| FEATURE_BILLING_ENABLED | false | Paddle billing integration |
| FEATURE_REDIS_ENABLED | false | Redis caching layer |
| FEATURE_TELEGRAM_ENABLED | false | Telegram bot bridge |
| FEATURE_VAULT_ENABLED | false | HashiCorp Vault secrets |
| FEATURE_CRYPTO_PAYMENTS_ENABLED | false | NOWPayments crypto billing |

## Development

```bash
# Build
npm run build

# Run tests
npm test

# Type checking
npm run typecheck

# Start with hot reload
npm run dev
```

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Commit your changes with conventional commit messages
4. Push to the branch and open a Pull Request

## Documentation

| Document | Audience | Description |
|----------|----------|-------------|
| [BUTTERFREEZONE.md](BUTTERFREEZONE.md) | AI agents | Machine-readable project overview with source citations |
| [INSTALLATION.md](INSTALLATION.md) | Developers | Detailed setup and deployment guide |
| [CHANGELOG.md](CHANGELOG.md) | Everyone | Version history and release notes |

## License

[AGPL-3.0](LICENSE.md)

## Links

- [Discord](https://discord.gg/thehoneyjar)
- [The HoneyJar](https://thehoneyjar.xyz)

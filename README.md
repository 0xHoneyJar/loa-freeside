# Arrakis

[![Version](https://img.shields.io/badge/version-6.0.0-blue.svg)](CHANGELOG.md)
[![License](https://img.shields.io/badge/license-AGPL--3.0-green.svg)](LICENSE.md)
[![Docs](https://img.shields.io/badge/docs-arrakis.community-orange.svg)](https://docs.arrakis.community)

**Stop losing your best holders to silence. Start building communities that actually retain.**

Most token-gated communities are ghost towns. Members verify once, then vanish. Arrakis turns passive holders into engaged participants through conviction scoring, tiered progression, and cross-platform engagement—all without writing a single line of code.

**Website**: [arrakis.community](https://arrakis.community) | **Documentation**: [docs.arrakis.community](https://docs.arrakis.community)

---

## The Problem

You've built a community. You've got token gates. But your Discord is still dead.

- **Holders verify and disappear** — No reason to come back
- **Whales and shrimps treated the same** — No recognition for conviction
- **No visibility into who matters** — Can't identify your true believers
- **Bots are dumb** — They check balances, nothing more

## The Solution

Arrakis transforms token-gated access into **conviction-scored communities**.

Instead of binary "has token / doesn't have token" gates, Arrakis creates dynamic, engaging communities where **holding longer matters**, **showing up counts**, and **contribution is recognized**.

---

## Why Arrakis?

### Conviction Scoring

Not all holders are the same. Someone who's held for 6 months through a bear market is different to a whale who bought yesterday.

Arrakis tracks **conviction over time**:
- How long they've held
- Have they ever sold (paper hands detection)
- Their position relative to other holders
- Activity and engagement metrics
- Onchain activities over time

### Tiered Progression

Give your community something to climb. Arrakis includes a 9-tier progression system that rewards long-term holders:

```
Traveler → Acolyte → Fremen → Sayyadina → Sandrider → Reverend Mother → Usul → Fedaykin → Naib
```

Each tier unlocks new channels, permissions, and recognition. Members see their progress and have clear goals.

### Multi-Platform

Your community lives on Discord. And Telegram. And maybe more. Arrakis unifies identity across platforms:

- **Discord bot** with slash commands, role sync, and rich embeds
- **Telegram bot** with inline queries and mobile-first design
- **Unified wallet identity** — Link once, recognized everywhere

### Zero-Downtime Migration

Already using Collab.Land or Guild? Arrakis includes **Shadow Mode** — run alongside your existing bot, compare results, and migrate when ready. No disruption to your community.

---

## Features

| Feature | Description |
|---------|-------------|
| **Conviction Scoring** | Time-weighted holder scoring that rewards loyalty |
| **9-Tier System** | Progression system with automatic role sync |
| **10 Badge Types** | Achievement, tenure, and activity-based recognition |
| **Weekly Digest** | Automated community health reports |
| **Shadow Mode** | Risk-free migration from existing bots |
| **Cross-Platform** | Discord + Telegram with unified identity |
| **Self-Service Setup** | Wizard-based onboarding, no code required |
| **Real-Time Sync** | Automatic eligibility and tier updates |

---

## Quick Start

### For Community Operators

1. **Invite the bot** to your Discord server
2. **Run `/setup`** to launch the onboarding wizard
3. **Configure eligibility** — token address, chain, minimum threshold
4. **Choose a theme** — Basic (free) or Sietch (premium)
5. **Done** — Bot creates channels, roles, and starts syncing

### For Developers

```bash
# Clone the repository
git clone https://github.com/0xHoneyJar/arrakis.git
cd arrakis/themes/sietch

# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env with your credentials

# Run development server
npm run dev

# Run tests
npm run test:run
```

---

## Architecture

Arrakis is built as a **monorepo** with clear separation of concerns:

```
arrakis/
├── sites/              # Web properties
│   ├── docs/           # Documentation (Nextra)
│   └── web/            # Marketing site (Next.js)
├── themes/             # Backend services
│   └── sietch/         # Arrakis theme service
├── packages/           # Shared libraries
│   └── core/           # Common types and utilities
└── infrastructure/     # Terraform configs
```

### Technical Highlights

- **Hexagonal Architecture** — Ports and adapters for clean domain boundaries
- **PostgreSQL + RLS** — Row-level security for tenant isolation
- **Two-Tier Chain Provider** — Score Service for complex queries, viem for binary checks
- **BullMQ Synthesis** — Reliable job processing for role sync
- **Circuit Breakers** — Resilient external service integration
- **W3C Distributed Tracing** — Full observability across services

### Security

6-layer Defense in Depth:

1. **WAF** — Rate limiting, injection protection
2. **Network** — VPC isolation, security groups
3. **Application** — Input validation, sanitization
4. **Data** — Row-level security, encryption at rest
5. **Secrets** — HashiCorp Vault integration
6. **Audit** — HMAC-signed audit trail

---

## Pricing

| Tier | Price | Features |
|------|-------|----------|
| **Basic** | Free | 3-tier system, token gates, basic notifications |
| **Pro** | $49/mo | 9-tier system, badges, weekly digest, priority sync |
| **Enterprise** | Custom | White-label, custom tiers, dedicated support, SLA |

See [arrakis.community/pricing](https://arrakis.community/pricing) for details.

---

## Comparison

| Feature | Arrakis | Collab.Land | Guild.xyz | Matrica |
|---------|---------|-------------|-----------|---------|
| Conviction Scoring | Yes | No | No | No |
| Tiered Progression | 9 tiers | No | Custom | Limited |
| Cross-Platform | Discord + Telegram | Discord only | Discord + Telegram | Discord only |
| Shadow Mode Migration | Yes | N/A | No | No |
| Self-Service Setup | Yes | Yes | Yes | Yes |
| Open Source | Yes (AGPL-3.0) | No | Partial | No |

---

## Documentation

- **[Getting Started](https://docs.arrakis.community/getting-started)** — Setup guide for operators
- **[Features](https://docs.arrakis.community/features)** — Deep dive into capabilities
- **[API Reference](https://docs.arrakis.community/api)** — REST API documentation
- **[FAQ](https://docs.arrakis.community/faq)** — Common questions answered

---

## Contributing

We welcome contributions! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

```bash
# Development setup
cd themes/sietch
npm install
npm run dev

# Run tests
npm run test:run

# Lint and typecheck
npm run lint
npm run typecheck
```

---

## Built With

- **Runtime**: Node.js 20, TypeScript
- **Database**: PostgreSQL with Drizzle ORM
- **Cache**: Redis with ioredis
- **Queue**: BullMQ
- **Discord**: discord.js v14
- **Telegram**: Grammy
- **Blockchain**: viem
- **Testing**: Vitest
- **Infrastructure**: Terraform, AWS ECS

---

## License

AGPL-3.0 — See [LICENSE.md](LICENSE.md) for details.

---

<p align="center">
  <strong>Stop managing holders. Start building believers.</strong>
  <br>
  <a href="https://arrakis.community">arrakis.community</a>
</p>

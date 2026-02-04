# Arrakis

[![Version](https://img.shields.io/badge/version-6.0.0-blue.svg)](CHANGELOG.md)
[![License](https://img.shields.io/badge/license-AGPL--3.0-green.svg)](LICENSE.md)

Engagement intelligence platform for Web3 communities. Conviction scoring and tiered progression delivered as Discord roles.

## Capabilities

### Conviction Scoring
Algorithmic scoring based on on-chain behavior:
- **Holding Duration** — Longer holding periods increase score
- **Accumulation Pattern** — Buying during dips shows conviction
- **Trading Behavior** — Diamond hands rewarded, frequent selling penalized
- **On-Chain Activity** — Governance participation, staking, protocol interactions

### 9-Tier Progression System
Granular member segmentation with Dune-themed tiers:

| Tier | Name | Description |
|------|------|-------------|
| 1 | Sandworm | New community members |
| 2 | Fremen | Established holders |
| 3 | Fedaykin | Active community participants |
| 4 | Naib | Community leaders |
| 5 | Sayyadina | Trusted advisors |
| 6 | Reverend Mother | Core contributors |
| 7 | Mentat | Strategic thinkers |
| 8 | Guild Navigator | Ecosystem connectors |
| 9 | Kwisatz Haderach | Legendary status |

### Badge System
Achievement badges for community milestones:
- OG Holder — Early adopter recognition
- Diamond Hands — Held through volatility
- Accumulator — Bought during dips
- Governance Active — Participated in votes

### Shadow Mode
Test alongside existing Collab.Land setup:
- Compare role assignments in real-time
- Tune thresholds before going live
- Zero disruption to existing setup

### QA Sandbox
Interactive testing for administrators:
- Assume any tier/role combination
- Test permission gates
- Validate threshold configurations
- Visual tier hierarchy

## Architecture

```
arrakis/
├── themes/sietch/          # Discord bot service
│   ├── src/
│   │   ├── api/            # REST API (Express)
│   │   ├── discord/        # Discord.js bot
│   │   ├── packages/       # Core business logic
│   │   │   ├── adapters/   # Theme providers
│   │   │   ├── core/       # Tier evaluation, badges
│   │   │   └── ...
│   │   └── services/       # Redis, database, sandbox
│   └── tests/              # Vitest test suites
├── packages/cli/           # Admin CLI tool
├── sites/
│   ├── docs/               # Documentation (Nextra)
│   └── web/                # Marketing site (Next.js)
└── infrastructure/         # Deployment configs
```

## Technology Stack

| Layer | Technology |
|-------|------------|
| Bot Runtime | Node.js, discord.js |
| API | Express, Zod validation |
| Database | PostgreSQL (Drizzle ORM) |
| Cache | Redis |
| Background Jobs | Trigger.dev |
| Deployment | Fly.io |

## Chain Support

All major EVM chains:
- Ethereum, Polygon, Arbitrum, Optimism
- Base, Avalanche, BNB Chain
- Berachain (native BGT support)

## Token Standards

- **ERC-20** — Fungible tokens with balance-based tiers
- **ERC-721** — NFT ownership verification
- **ERC-1155** — Multi-token support
- **BGT** — Native Berachain governance token

## Development

### Prerequisites

| Tool | Required | Purpose |
|------|----------|---------|
| Docker | Yes | Containerized development |
| Docker Compose | Yes | Service orchestration |
| Node.js 20+ | Optional | Native development (without Docker) |

### Quick Start (Docker - Recommended)

```bash
# Clone
git clone https://github.com/0xHoneyJar/arrakis.git
cd arrakis

# Setup environment
cp .env.development.example .env.development
# Edit .env.development with your Discord credentials

# Start development
make dev
```

That's it! The entire development environment starts with a single command.

- **Edit files** in `themes/sietch/src/` and changes reflect in ~5 seconds
- **Database** (PostgreSQL) and **cache** (Redis) are managed automatically
- **Hot-reload** works out of the box

### Development Commands

```bash
make help         # Show all available commands
make dev          # Start development environment
make dev-build    # Rebuild containers (after package/* changes)
make dev-logs     # Tail logs
make dev-shell    # Open shell in container
make dev-db       # Open Drizzle Studio
make test         # Run tests
make lint         # Run linting
make clean        # Stop and remove containers
```

### Known Limitations

| Limitation | Workaround |
|------------|------------|
| Only `themes/sietch/src` is hot-reloaded | Run `make dev-build` after editing `packages/*` |
| macOS is ~8s vs Linux ~5s for hot-reload | Enable VirtioFS in Docker Desktop settings |
| Discord token required for full features | Get token from Discord Developer Portal |

### Troubleshooting

#### Container won't start

```bash
make dev-logs          # Check logs for errors
make clean && make dev-build && make dev  # Full rebuild
```

#### Hot-reload not working

```bash
# Verify entr is installed in container
docker compose -f docker-compose.dev.yml exec sietch-dev which entr

# If editing packages/*, hot-reload WON'T work (by design)
# Run: make dev-build
```

#### macOS performance issues

1. Open Docker Desktop → Settings → General
2. Enable **VirtioFS** file sharing
3. Restart Docker Desktop
4. Expected performance: ~8s (vs ~5s on Linux)

#### Database connection failed

```bash
# Check PostgreSQL health
docker compose -f docker-compose.dev.yml ps postgres

# Test connection
docker compose -f docker-compose.dev.yml exec sietch-dev \
    sh -c "pg_isready -h postgres -U arrakis"
```

#### Port already in use

```bash
# Stop existing services first
docker compose -f themes/sietch/docker-compose.yml down  # Old compose
make clean  # Then start fresh
make dev
```

### Native Development (Without Docker)

If you prefer native development:

```bash
# Install dependencies
npm install

# Start database services
cd themes/sietch
docker-compose up -d  # PostgreSQL + Redis only

# Run application
npm run dev
```

### Testing

```bash
# Run all tests
make test

# Run with coverage
make test-coverage

# Type checking
make typecheck
```

## Documentation

- [docs.arrakis.community](https://docs.arrakis.community) — Full documentation
- [Getting Started](https://docs.arrakis.community/getting-started) — Installation guide
- [API Reference](https://docs.arrakis.community/api) — REST API docs

## License

[AGPL-3.0](LICENSE.md)

## Links

- [Documentation](https://docs.arrakis.community)
- [Discord](https://discord.gg/thehoneyjar)
- [The HoneyJar](https://thehoneyjar.xyz)

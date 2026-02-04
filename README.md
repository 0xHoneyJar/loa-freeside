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
| Node.js 20+ | Yes | Runtime |
| pnpm | Yes | Package manager |
| PostgreSQL | Yes | Database |
| Redis | Yes | Caching |

### Quick Start

```bash
# Clone and install
git clone https://github.com/0xHoneyJar/arrakis.git
cd arrakis
pnpm install

# Start development
cd themes/sietch
cp .env.example .env
pnpm dev
```

### Testing

```bash
# Run all tests
pnpm test

# Run with coverage
pnpm test:coverage

# Type checking
pnpm typecheck
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

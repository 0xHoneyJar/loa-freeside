# Sietch Service

The backend service for Sietch - a token-gated community for top BGT holders on Berachain.

> For project overview, tier system, badge system, and API documentation, see the [main README](../README.md).

## Quick Start

```bash
# Install dependencies
npm install

# Copy environment template
cp .env.example .env.local

# Edit .env.local with your credentials

# Start development server
npm run dev
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start development server with hot reload |
| `npm run build` | Build TypeScript to JavaScript |
| `npm run start` | Start production server |
| `npm test` | Run tests in watch mode |
| `npm run test:run` | Run tests once |
| `npm run lint` | Run ESLint |
| `npm run typecheck` | Run TypeScript type checking |

## Project Structure

```
sietch-service/
├── src/
│   ├── index.ts              # Application entry point
│   ├── config.ts             # Environment configuration
│   ├── api/                  # REST API (Express)
│   ├── services/             # Business logic
│   ├── discord/              # Discord bot commands
│   ├── telegram/             # Telegram bot commands
│   ├── trigger/              # Scheduled tasks (trigger.dev)
│   ├── db/                   # SQLite schema & queries
│   └── types/                # TypeScript types
├── tests/                    # Unit & integration tests
├── scripts/                  # Utility scripts
└── docs/                     # Operational docs
    └── deployment/           # Deployment guides
```

## Environment Variables

See `.env.example` for all required variables. Key ones:

```bash
BERACHAIN_RPC_URL=        # Berachain RPC endpoint
DISCORD_BOT_TOKEN=        # Discord bot token
DISCORD_GUILD_ID=         # Discord server ID
TELEGRAM_BOT_TOKEN=       # Telegram bot token (v4.1+)
API_KEY=                  # API authentication key
```

## Documentation

| Document | Location | Description |
|----------|----------|-------------|
| Project Overview | [../README.md](../README.md) | Tier system, badges, API |
| PRD | [../grimoires/loa/prd.md](../grimoires/loa/prd.md) | Product requirements |
| SDD | [../grimoires/loa/sdd.md](../grimoires/loa/sdd.md) | System design |
| Sprint Plan | [../grimoires/loa/sprint.md](../grimoires/loa/sprint.md) | Development sprints |
| Deployment | [docs/deployment/](docs/deployment/) | Operational guides |
| Discord Permissions | [docs/discord/PERMISSION_MATRIX.md](docs/discord/PERMISSION_MATRIX.md) | Role permissions |

## License

AGPL-3.0 - See [../LICENSE.md](../LICENSE.md) for details.

# Sietch Service

Token-gated Discord community service for top BGT holders on Berachain.

## Overview

Sietch Service provides eligibility tracking for the top 69 BGT holders who have never redeemed (burned) their BGT. The service:

- Queries Berachain RPC via viem for BGT claim and burn events
- Caches eligibility snapshots in SQLite
- Exposes REST API for Collab.Land integration
- Manages Discord notifications (planned)
- Uses trigger.dev for scheduled 6-hour sync tasks (planned)

## Development

### Prerequisites

- Node.js 20+
- npm

### Setup

```bash
# Install dependencies
npm install

# Copy environment template
cp .env.example .env.local

# Start development server
npm run dev
```

### Scripts

- `npm run dev` - Start development server with hot reload
- `npm run build` - Build TypeScript to JavaScript
- `npm run start` - Start production server
- `npm test` - Run tests in watch mode
- `npm run test:run` - Run tests once
- `npm run lint` - Run ESLint
- `npm run typecheck` - Run TypeScript type checking

## Project Structure

```
sietch-service/
├── src/
│   ├── index.ts          # Application entry point
│   ├── config.ts         # Environment configuration
│   ├── api/              # REST API (Express)
│   ├── services/
│   │   ├── chain.ts      # Berachain RPC queries
│   │   └── eligibility.ts # Eligibility logic
│   ├── db/
│   │   ├── schema.ts     # SQLite schema
│   │   └── queries.ts    # Database operations
│   ├── types/            # TypeScript types
│   └── utils/
│       └── logger.ts     # Structured logging (pino)
├── trigger/              # trigger.dev scheduled tasks
├── tests/                # Unit and integration tests
├── package.json
└── tsconfig.json
```

## Architecture

See `docs/sdd.md` in the parent repository for full architecture documentation.

## License

MIT

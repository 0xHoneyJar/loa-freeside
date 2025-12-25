# Sietch Service

Token-gated Discord community service for top BGT holders on Berachain.

## Overview

Sietch Service (v3.0 "The Great Expansion") is a comprehensive eligibility and community management system for the top 69 BGT holders who have never redeemed their BGT. The service provides:

### Core Features
- **Eligibility Tracking** - Queries Berachain RPC via viem for BGT holdings
- **Tier System** - 9-tier progression from Traveler to Naib based on BGT and rank
- **Discord Integration** - Full bot with slash commands, role management, DM notifications
- **Collab.Land API** - REST endpoints for wallet verification
- **Scheduled Tasks** - trigger.dev jobs for 6-hour eligibility sync

### v3.0 Features
- **Stats & Leaderboard** - Personal stats, community metrics, tier progression leaderboard
- **Weekly Digest** - Automated Monday community digest posts
- **Notification System** - Tier promotion DMs, badge awards, at-risk alerts
- **Story Fragments** - Dune-themed narrative posts for Fedaykin/Naib promotions
- **Water Sharer Badge** - Shareable badge system with lineage tracking
- **Admin Analytics** - Comprehensive dashboard for community admins

## Quick Start

### Prerequisites
- Node.js 20+
- npm
- Discord Bot Token
- Berachain RPC URL

### Setup

```bash
# Install dependencies
npm install

# Copy environment template
cp .env.example .env.local

# Edit .env.local with your credentials

# Start development server
npm run dev
```

### Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start development server with hot reload |
| `npm run build` | Build TypeScript to JavaScript |
| `npm run start` | Start production server |
| `npm test` | Run tests in watch mode |
| `npm run test:run` | Run tests once |
| `npm run lint` | Run ESLint |
| `npm run typecheck` | Run TypeScript type checking |
| `npm run seed:stories` | Seed default story fragments |

## Project Structure

```
sietch-service/
├── src/
│   ├── index.ts              # Application entry point
│   ├── config.ts             # Environment configuration
│   ├── api/
│   │   └── routes.ts         # REST API (Express)
│   ├── services/
│   │   ├── chain.ts          # Berachain RPC queries
│   │   ├── eligibility.ts    # Eligibility logic
│   │   ├── TierService.ts    # Tier calculation & role sync
│   │   ├── StatsService.ts   # Personal/community stats
│   │   ├── DigestService.ts  # Weekly digest generation
│   │   ├── StoryService.ts   # Narrative fragments
│   │   ├── AnalyticsService.ts # Admin metrics
│   │   ├── WaterSharerService.ts # Badge sharing
│   │   ├── notification.ts   # DM notifications
│   │   └── ...
│   ├── discord/
│   │   ├── commands/         # Slash commands
│   │   └── embeds/           # Message embeds
│   ├── trigger/              # Scheduled tasks
│   │   ├── syncEligibility.ts # 6-hour sync
│   │   └── weeklyDigest.ts   # Monday digest
│   ├── db/
│   │   ├── schema.ts         # SQLite schema
│   │   ├── queries.ts        # Database operations
│   │   └── migrations/       # Schema migrations
│   └── types/                # TypeScript types
├── scripts/                  # Utility scripts
├── tests/
│   ├── unit/                 # Unit tests
│   └── integration/          # Integration tests
├── docs/
│   ├── discord/              # Permission matrix
│   └── a2a/                  # Sprint documentation
└── package.json
```

## Discord Commands

### Member Commands
| Command | Description |
|---------|-------------|
| `/onboard` | Start onboarding flow |
| `/profile` | View your member profile |
| `/stats` | View personal stats with tier progress |
| `/directory` | Browse community directory |
| `/leaderboard badges` | Top badge holders |
| `/leaderboard tiers` | Members closest to promotion |
| `/water-share share @user` | Share Water Sharer badge |
| `/water-share status` | Check sharing status |

### Admin Commands
| Command | Description |
|---------|-------------|
| `/admin-stats` | View admin analytics dashboard |
| `/admin-badge award @user badge` | Award badge to member |
| `/admin-water-share lineage` | View badge sharing tree |
| `/admin-water-share revoke @user` | Revoke member's grants |

## API Endpoints

### Public
- `GET /health` - Health check
- `GET /api/v1/eligibility` - Eligibility list (for Collab.Land)
- `GET /api/v1/eligibility/:wallet` - Single wallet check

### Authenticated (requires API key)
- `GET /me/stats` - Personal stats
- `GET /me/tier-progress` - Tier progression
- `GET /stats/tiers` - Tier distribution
- `GET /stats/community` - Community overview
- `GET /admin/analytics` - Admin dashboard metrics

## Environment Variables

See `.env.example` for all required and optional variables:

```bash
# Required
BERACHAIN_RPC_URL=
DISCORD_BOT_TOKEN=
DISCORD_GUILD_ID=
API_KEY=

# Discord Channels
DISCORD_ANNOUNCEMENTS_CHANNEL_ID=
DISCORD_STORY_CHANNEL_ID=

# Discord Roles (for tier system)
DISCORD_NAIB_ROLE_ID=
DISCORD_FEDAYKIN_ROLE_ID=
# ... etc
```

## Tier System

| Tier | Requirement | Role Color |
|------|-------------|------------|
| Naib | Rank 1-7 | Gold |
| Fedaykin | Rank 8-21 | Purple |
| Usul | 1111+ BGT | Blue |
| Reverend Mother | 420+ BGT | Teal |
| Sandrider | 111+ BGT | Orange |
| Sayyadina | 69+ BGT | Pink |
| Fremen | 21+ BGT | Green |
| Acolyte | 1+ BGT | Gray |
| Traveler | 0 BGT | Default |

## Documentation

- **PRD**: `loa-grimoire/prd.md` - Product requirements
- **SDD**: `loa-grimoire/sdd.md` - System design
- **Sprint Plan**: `loa-grimoire/sprint.md` - Development sprints
- **Permission Matrix**: `docs/discord/PERMISSION_MATRIX.md` - Discord permissions

## License

MIT

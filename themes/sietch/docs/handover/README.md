# Sietch Service Handover Documentation

This document provides a comprehensive overview for future maintainers of the Sietch service.

## Table of Contents

1. [System Overview](#system-overview)
2. [Architecture Summary](#architecture-summary)
3. [External Services](#external-services)
4. [Repository Structure](#repository-structure)
5. [Configuration Reference](#configuration-reference)
6. [Operational Procedures](#operational-procedures)
7. [Known Issues & Workarounds](#known-issues--workarounds)
8. [Contact Information](#contact-information)

---

## System Overview

### What is Sietch?

Sietch is a token-gated Discord community for the top 69 BGT (Bera Governance Token) holders on Berachain who have never redeemed their tokens. The system:

1. Queries Berachain RPC for BGT claim and burn events
2. Calculates unredeemed BGT balances per wallet
3. Ranks wallets and determines top 69 eligibility
4. Manages wallet verification via EIP-191 `/verify` slash command
5. Manages Discord notifications for eligibility changes

### Technology Stack

| Component | Technology |
|-----------|------------|
| Runtime | Node.js 20 LTS |
| Language | TypeScript 5.x |
| Database | SQLite (better-sqlite3) |
| API Framework | Express.js |
| Discord | discord.js |
| Blockchain | viem (Berachain RPC) |
| Scheduling | trigger.dev v3 |
| Process Manager | PM2 |
| Reverse Proxy | nginx |
| SSL | Let's Encrypt (certbot) |

### Key URLs

| Service | URL |
|---------|-----|
| API Production | https://sietch-api.honeyjar.xyz |
| trigger.dev Dashboard | https://trigger.dev |
| Discord Developer Portal | https://discord.com/developers |
| Wallet Verification Guide | `docs/deployment/collabland-setup.md` |

---

## Architecture Summary

```
┌─────────────────────────────────────────────────────────────┐
│                        Production VPS                        │
│  ┌─────────────────────────────────────────────────────────┐│
│  │                        nginx                             ││
│  │         (SSL termination, rate limiting)                 ││
│  └─────────────────────────┬───────────────────────────────┘│
│                            │                                 │
│  ┌─────────────────────────▼───────────────────────────────┐│
│  │                   Sietch Service                         ││
│  │  ┌──────────────┐  ┌──────────────┐  ┌───────────────┐  ││
│  │  │   Express    │  │   Discord    │  │   trigger.dev │  ││
│  │  │   REST API   │  │   Bot        │  │   Tasks       │  ││
│  │  └──────────────┘  └──────────────┘  └───────────────┘  ││
│  │                            │                             ││
│  │  ┌─────────────────────────▼────────────────────────────┐││
│  │  │               Core Services                          │││
│  │  │  Chain Service │ Eligibility Service │ DB Queries   │││
│  │  └─────────────────────────┬────────────────────────────┘││
│  │                            │                             ││
│  │  ┌─────────────────────────▼────────────────────────────┐││
│  │  │                  SQLite Database                     │││
│  │  │  /opt/sietch/data/sietch.db                         │││
│  │  └──────────────────────────────────────────────────────┘││
│  └─────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
                            │
       ┌────────────────────┼────────────────────┐
       ▼                    ▼                    ▼
┌─────────────┐      ┌─────────────┐
│ Berachain   │      │  Discord    │
│    RPC      │      │   API       │
└─────────────┘      └─────────────┘
```

### Data Flow

1. **Eligibility Sync** (every 6 hours via trigger.dev):
   - Fetch RewardPaid events from reward vaults
   - Fetch Transfer-to-zero (burn) events
   - Calculate net BGT per wallet
   - Rank wallets, identify top 69
   - Store snapshot in SQLite
   - Compute diff from previous snapshot
   - Send Discord notifications for changes

2. **Wallet Verification** (via `/verify` command):
   - User runs `/verify start` in Discord
   - Bot generates unique EIP-191 signing link
   - User signs message with wallet to prove ownership
   - Bot assigns tier roles based on BGT rank

3. **Discord Integration**:
   - Bot posts leaderboard to #census after each sync
   - Bot posts announcements to #the-door for eligibility changes
   - Bot sends DMs for removals and tier changes

---

## External Services

### 1. Berachain RPC

**Purpose**: Query blockchain for BGT events

**Configured URLs** (in `.env`):
```
BERACHAIN_RPC_URLS=https://rpc.berachain.com,https://bera-rpc.publicnode.com
```

**Fallback**: Service uses fallback transport with automatic retry on primary failure.

### 2. trigger.dev

**Purpose**: Scheduled task execution (eligibility sync every 6 hours)

**Account**: HoneyJar team account
**Project**: sietch-service
**Task**: sync-eligibility

**Configuration**:
- `TRIGGER_PROJECT_ID` - Project identifier
- `TRIGGER_SECRET_KEY` - API key for task execution

**Dashboard**: https://trigger.dev

### 3. Discord

**Purpose**: Community management, notifications, leaderboard

**Application**: Sietch Bot
**Portal**: https://discord.com/developers/applications

**Required Intents**:
- `GUILDS`
- `GUILD_MEMBERS`

**Required Permissions**:
- `SEND_MESSAGES`
- `EMBED_LINKS`
- `MANAGE_MESSAGES`
- `VIEW_CHANNEL`

**Configuration**:
- `DISCORD_BOT_TOKEN` - Bot authentication token
- `DISCORD_GUILD_ID` - Sietch server ID
- `DISCORD_CHANNEL_*` - Channel IDs for #the-door, #census
- `DISCORD_ROLE_*` - Role IDs for Naib, Fedaykin

### 4. Let's Encrypt

**Purpose**: SSL certificates

**Managed by**: certbot with nginx plugin
**Auto-renewal**: Yes (certbot timer)

---

## Repository Structure

```
sietch-service/
├── src/
│   ├── index.ts              # Application entry point
│   ├── config.ts             # Environment configuration
│   ├── types/                # TypeScript type definitions
│   ├── api/
│   │   ├── routes.ts         # Express route handlers
│   │   ├── middleware.ts     # Auth, rate limiting
│   │   └── server.ts         # Express server setup
│   ├── db/
│   │   ├── index.ts          # Database exports
│   │   ├── schema.ts         # Table definitions
│   │   └── queries.ts        # Query functions
│   ├── services/
│   │   ├── chain.ts          # Berachain RPC queries
│   │   ├── eligibility.ts    # Eligibility logic
│   │   └── discord.ts        # Discord bot
│   ├── trigger/
│   │   └── syncEligibility.ts # Scheduled sync task
│   └── utils/
│       └── logger.ts         # Pino logger
├── docs/
│   ├── deployment/           # Deployment configs & scripts
│   ├── operations/           # Admin guides
│   ├── community/            # Member documentation
│   ├── handover/            # This document
│   └── research/            # Technical research
├── ecosystem.config.cjs      # PM2 configuration
├── trigger.config.ts         # trigger.dev configuration
├── package.json
└── tsconfig.json
```

---

## Configuration Reference

### Environment Variables

All configuration is in `/opt/sietch/.env`:

```bash
# Berachain RPC (comma-separated for fallback)
BERACHAIN_RPC_URLS=https://rpc.berachain.com,https://bera-rpc.publicnode.com

# Contract addresses
BGT_ADDRESS=0x...
REWARD_VAULT_ADDRESSES=0x...,0x...

# trigger.dev
TRIGGER_PROJECT_ID=sietch-service
TRIGGER_SECRET_KEY=tr_dev_...

# Discord
DISCORD_BOT_TOKEN=...
DISCORD_GUILD_ID=...
DISCORD_CHANNEL_THE_DOOR=...
DISCORD_CHANNEL_CENSUS=...
DISCORD_ROLE_NAIB=...
DISCORD_ROLE_FEDAYKIN=...

# API
API_PORT=3000
API_HOST=127.0.0.1
ADMIN_API_KEYS=key1:name1,key2:name2

# Database
DATABASE_PATH=/opt/sietch/data/sietch.db

# Logging
LOG_LEVEL=info

# Grace Period
GRACE_PERIOD_HOURS=24
```

### Critical Files & Permissions

| Path | Purpose | Permissions |
|------|---------|-------------|
| `/opt/sietch/.env` | Environment config | 600 (sietch:sietch) |
| `/opt/sietch/data/` | Database directory | 700 (sietch:sietch) |
| `/opt/sietch/backups/` | Backup storage | 700 (sietch:sietch) |
| `/opt/sietch/logs/` | Application logs | 755 (sietch:sietch) |

---

## Operational Procedures

### Regular Operations

| Task | Frequency | How |
|------|-----------|-----|
| Eligibility Sync | Every 6 hours | Automatic (trigger.dev) |
| Database Backup | Daily at 3 AM | Automatic (cron) |
| Log Rotation | At 10MB | Automatic (PM2) |
| SSL Renewal | Every 60 days | Automatic (certbot) |

### Manual Procedures

See `docs/operations/server-admin.md` for:
- Service restart procedures
- Manual eligibility sync
- Admin override management
- Database queries
- Troubleshooting

See `docs/deployment/DEPLOYMENT_RUNBOOK.md` for:
- Deployment procedures
- Rollback procedures
- Initial server setup

---

## Known Issues & Workarounds

### 1. RPC Rate Limits

**Issue**: Public RPC endpoints may rate limit during high-traffic periods.

**Workaround**: Multiple RPC URLs configured with automatic fallback. Consider dedicated RPC provider for production.

### 2. Discord Rate Limits

**Issue**: Discord API rate limits when processing many eligibility changes.

**Workaround**: Service processes changes sequentially with error handling. Large batches may be delayed.

### 3. Historical Event Queries

**Issue**: Querying all historical events from genesis is slow.

**Workaround**: Event cache implemented. First sync is slow, subsequent syncs query only new blocks.

### 4. Grace Period Edge Cases

**Issue**: Service enters grace period after 24 hours of RPC failures, serving stale data.

**Workaround**: Monitor RPC health. Grace period prevents incorrect role revocations during outages.

---

## Contact Information

### Team Contacts

| Role | Contact |
|------|---------|
| Technical Lead | [TBD] |
| DevOps | [TBD] |
| Discord Admin | [TBD] |

### External Support

| Service | Support Channel |
|---------|-----------------|
| trigger.dev | https://trigger.dev/support |
| Wallet Verification | See `docs/deployment/collabland-setup.md` |
| Discord | https://support.discord.com/ |
| Berachain | [Community Discord] |

### Repository

- **GitHub**: https://github.com/0xHoneyJar/arrakis
- **Directory**: `/sietch-service`

---

## Credentials Location

**IMPORTANT**: All production credentials are stored in:
- `/opt/sietch/.env` on the production VPS
- 1Password vault (HoneyJar team) - "Sietch Service Credentials"

Never commit credentials to the repository. The `.env.example` file shows required variables without values.

---

## Future Considerations

1. **Subsquid Integration**: Consider using existing mibera-squid for faster event queries
2. **WebSocket Subscriptions**: Real-time updates instead of 6-hour polling
3. **Multi-server Support**: Currently single Discord server only
4. **Analytics Dashboard**: Historical eligibility trends
5. **Webhook Notifications**: External service notifications on changes

---

*Document created: December 2025*
*Last updated: December 2025*

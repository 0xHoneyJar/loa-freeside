# Sietch

A privacy-first, token-gated Discord community for the top 69 BGT (Berachain Governance Token) holders who have never redeemed any of their BGT holdings.

**Version 3.0 "The Great Expansion"** - Complete community management with 9-tier progression, stats, leaderboards, weekly digests, and rich notifications.

## Overview

Sietch provides a dedicated space for a specific, highly curated subset of the Berachain community—high-conviction participants demonstrated through on-chain actions over time. Eligibility is determined entirely on-chain: only wallets that have claimed BGT from reward vaults and never burned (redeemed) any BGT qualify.

### What's New in v3.0

- **9-Tier Progression** - From Traveler to Naib based on BGT holdings and rank
- **Personal Stats** - Track your tier progress, BGT history, and time in tiers
- **Tier Leaderboard** - See who's closest to their next promotion
- **Weekly Digest** - Automated Monday community updates with 10 metrics
- **Story Fragments** - Dune-themed narrative posts for elite promotions
- **Water Sharer Badge** - Shareable badge system with lineage tracking
- **Notification System** - Tier promotion DMs, badge awards, at-risk alerts
- **Admin Analytics** - Comprehensive dashboard for community health

### Previous Features (v2.0)

- **Pseudonymous Profiles** - Create a unique identity (nym) completely unlinked to your wallet
- **Badge System** - Earn badges for tenure, activity, and achievements
- **Member Directory** - Browse and discover other members with privacy-respecting filters
- **Activity Tracking** - Demurrage-based system that rewards consistent engagement
- **DM Onboarding** - Private wizard to set up your identity before accessing channels

## How It Works

```
┌─────────────────┐     ┌─────────────────────────────────────┐
│   Berachain     │────▶│          Sietch Service             │
│   RPC Nodes     │     │  ┌─────────────┐  ┌─────────────┐   │
└─────────────────┘     │  │  Chain Svc  │  │  Profile    │   │
                        │  │  (viem)     │  │  Service    │   │
                        │  └─────────────┘  └─────────────┘   │
                        │  ┌─────────────┐  ┌─────────────┐   │
                        │  │  Badge Svc  │  │  Activity   │   │
                        │  │  (10 types) │  │  Service    │   │
                        │  └─────────────┘  └─────────────┘   │
                        └──────────┬──────────────────────────┘
                                   │
              ┌────────────────────┼────────────────────┐
              ▼                    ▼                    ▼
       ┌─────────────┐      ┌─────────────┐      ┌─────────────┐
       │ Discord Bot │      │  REST API   │      │ trigger.dev │
       │ (discord.js)│      │ (Collab.Land│      │ (Scheduled) │
       └──────┬──────┘      │  + Public)  │      └─────────────┘
              │             └─────────────┘
              ▼
       ┌─────────────┐
       │   Discord   │
       │   Server    │
       └─────────────┘
```

1. **Berachain RPC** - Direct on-chain queries for BGT balances via viem
2. **Sietch Service** - Manages eligibility, profiles, badges, and activity
3. **Discord Bot** - Handles onboarding, slash commands, and notifications
4. **REST API** - Collab.Land integration for token gating
5. **trigger.dev** - Scheduled tasks (eligibility sync, activity decay, badge checks)

## Eligibility Criteria

To be eligible, a wallet must:

1. Have claimed BGT from Berachain reward vaults
2. Never have burned (transferred to 0x0) any BGT
3. Rank in the top 69 by total BGT held

## Tier System

Sietch uses a 9-tier progression system based on BGT holdings and rank:

| Tier | Requirement | Role Color |
|------|-------------|------------|
| **Naib** | Rank 1-7 | Gold |
| **Fedaykin** | Rank 8-21 | Purple |
| **Usul** | 1111+ BGT | Blue |
| **Reverend Mother** | 420+ BGT | Teal |
| **Sandrider** | 111+ BGT | Orange |
| **Sayyadina** | 69+ BGT | Pink |
| **Fremen** | 21+ BGT | Green |
| **Acolyte** | 1+ BGT | Gray |
| **Traveler** | 0 BGT | Default |

Tier roles update automatically as rankings change. Members who fall out of the top 69 or redeem any BGT lose access immediately.

### Achievement Roles (Badge-Based)

| Role | Criteria |
|------|----------|
| **OG** | Joined within first 30 days |
| **Diamond Hands** | 6+ months tenure |
| **Usul Ascended** | Reached Usul tier (1111+ BGT) |

Achievement roles are earned through badges and cannot be lost.

## Badge System

Members can earn 10 different badges across three categories:

### Tenure Badges
| Badge | Criteria |
|-------|----------|
| First Wave | Joined in first 30 days |
| Veteran | 3+ months membership |
| Diamond Hands | 6+ months membership |

### Achievement Badges
| Badge | Criteria |
|-------|----------|
| Council | Reached Naib tier |
| Survivor | Survived a demotion and returned |
| Streak Master | 30-day activity streak |

### Activity Badges
| Badge | Criteria |
|-------|----------|
| Engaged | Activity score > 100 |
| Contributor | Activity score > 500 |
| Pillar | Activity score > 1000 |

Activity uses a demurrage model—scores decay by 10% every 6 hours, rewarding consistent engagement over one-time bursts.

## Discord Structure

```
SIETCH
├── STILLSUIT (Info)
│   ├── #water-discipline ── Rules, Chatham House reminder
│   ├── #census ──────────── Live top 69 leaderboard
│   └── #the-door ────────── Join/departure log
│
├── NAIB COUNCIL (Top 7 Only)
│   └── #council-rock ────── Private council discussion
│
├── SIETCH-COMMONS (All Members)
│   ├── #general ─────────── Main discussion
│   ├── #spice ───────────── Market insights, alpha
│   └── #water-shares ────── Capital allocation ideas
│
└── WINDTRAP (Operations)
    └── #support ─────────── Verification help
```

## Chatham House Rules

All discussions operate under Chatham House Rules:
- Use information freely
- Never reveal speaker identity or affiliation
- No attribution of statements

## API

### Public Endpoints

```
GET /health
{ "status": "healthy", "version": "3.0.0" }

GET /api/v1/eligibility
[{ "address": "0x...", "bgtHeld": "1234567890", "rank": 42, "role": "fedaykin" }]

GET /api/v1/eligibility/:wallet
{ "eligible": true, "tier": "fedaykin", "rank": 42, "bgtHeld": "1234567890" }
```

### Stats & Analytics (Authenticated)

```
GET /me/stats
{ "tier": "fedaykin", "bgt": 1234.56, "rank": 42, "daysInTier": 30, "tierProgress": 0.75 }

GET /me/tier-progress
{ "currentTier": "fedaykin", "nextTier": "usul", "bgtNeeded": 500, "progress": 0.68 }

GET /stats/tiers
{ "naib": 7, "fedaykin": 14, "usul": 20, "reverend_mother": 15, ... }

GET /stats/community
{ "totalMembers": 69, "totalBadges": 234, "avgTenure": 45, "weeklyActive": 52 }

GET /admin/analytics
{ "memberStats": {...}, "tierDistribution": {...}, "badgeStats": {...}, "activityTrends": {...} }
```

### Admin Endpoints (API Key Required)

```
POST /admin/sync                    # Trigger eligibility sync
POST /admin/badges/check            # Run badge evaluation
GET  /admin/water-share/lineage     # Badge sharing tree
POST /admin/water-share/revoke/:id  # Revoke member's grants
```

## Technical Details

- **Stack**: Node.js 20, TypeScript, Express, Discord.js v14, SQLite, viem
- **Refresh Cadence**: Eligibility sync every 6 hours via trigger.dev
- **Weekly Digest**: Monday 9:00 UTC via trigger.dev cron
- **Activity Decay**: 10% decay every 6 hours (demurrage model)
- **Badge Checks**: Daily evaluation at midnight UTC
- **Grace Period**: 24 hours during RPC outages (no revocations)
- **Wallet Verification**: Collab.Land signature flow
- **Privacy**: Rounded BGT values, ephemeral responses for sensitive data
- **Tests**: Unit + integration test suites covering all services

## Naming Reference

Names from Frank Herbert's *Dune*:

| Term | Meaning | Usage |
|------|---------|-------|
| **Sietch** | Hidden desert community | Server name |
| **Naib** | Leader of a sietch | Top 7 council tier |
| **Fedaykin** | Elite death commandos | Rank 8-21 tier |
| **Usul** | Fremen name for Paul | 1111+ BGT tier |
| **Reverend Mother** | Bene Gesserit adept | 420+ BGT tier |
| **Sandrider** | One who rides sandworms | 111+ BGT tier |
| **Sayyadina** | Fremen priestess | 69+ BGT tier |
| **Fremen** | Desert people | 21+ BGT tier |
| **Stillsuit** | Water-preserving gear | Info category |
| **Spice** | Most valuable substance | Alpha channel |

## Documentation

- **[sietch-service/README.md](sietch-service/README.md)** - Service documentation
- **[loa-grimoire/prd.md](loa-grimoire/prd.md)** - Product Requirements Document
- **[loa-grimoire/sdd.md](loa-grimoire/sdd.md)** - Software Design Document
- **[loa-grimoire/sprint.md](loa-grimoire/sprint.md)** - Sprint Plan (22 sprints complete)
- **[sietch-service/docs/discord/PERMISSION_MATRIX.md](sietch-service/docs/discord/PERMISSION_MATRIX.md)** - Discord permissions

## Built With

This project was built using [Loa](https://github.com/0xHoneyJar/loa), an agent-driven development framework for orchestrating product development lifecycle.

## License

MIT

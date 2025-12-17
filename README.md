# Sietch

A token-gated Discord community for the top 69 BGT (Berachain Governance Token) holders who have never redeemed any of their BGT holdings.

## Overview

Sietch provides a dedicated space for a specific, highly curated, subset of the Berachain community with demonstrated (over time and onchain actions) high-conviction Berachain participants to connect, discuss, and coordinate on ecosystem matters. Eligibility is determined entirely on-chain—only wallets that have claimed BGT from reward vaults and never burned (redeemed) any BGT qualify.

## How It Works

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Dune API      │────▶│  Sietch Service │────▶│   Collab.Land   │
│  (Data Source)  │     │   (Custom API)  │     │  (Discord Bot)  │
└─────────────────┘     └─────────────────┘     └─────────────────┘
                               │
                               ▼
                        ┌─────────────────┐
                        │  Discord Server │
                        │    (Sietch)     │
                        └─────────────────┘
```

1. **Dune Analytics** queries on-chain BGT data every 6 hours
2. **Sietch Service** caches eligibility and exposes a REST API
3. **Collab.Land** verifies wallet signatures and assigns Discord roles
4. **Discord** grants access based on role assignment

## Eligibility Criteria

To be eligible, a wallet must:

1. Have claimed BGT from Berachain reward vaults
2. Never have burned (transferred to 0x0) any BGT
3. Rank in the top 69 by total BGT held

## Roles

| Role | Criteria | Access |
|------|----------|--------|
| **Naib** | Top 7 by BGT held | Council channel + all public channels |
| **Fedaykin** | Top 8-69 by BGT held | All public channels |

Roles update automatically as rankings change. Members who fall out of the top 69 or redeem any BGT lose access immediately.

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

The Sietch Service exposes:

```
GET /eligibility
{
  "updated_at": "2025-12-17T12:00:00Z",
  "grace_period": false,
  "top_69": [
    {"rank": 1, "address": "0x...", "bgt_held": 12345.67},
    ...
  ],
  "top_7": ["0x...", ...]
}

GET /health
{
  "status": "healthy",
  "last_successful_query": "2025-12-17T12:00:00Z",
  "next_query": "2025-12-17T18:00:00Z"
}
```

## Technical Details

- **Refresh Cadence**: Every 6 hours
- **Grace Period**: 24 hours during Dune outages (no revocations)
- **Wallet Verification**: Standard Collab.Land signature flow
- **Hosting**: OVH bare metal VPS

## Naming Reference

Names from Frank Herbert's *Dune*:

| Term | Meaning | Usage |
|------|---------|-------|
| **Sietch** | Hidden desert community | Server name |
| **Naib** | Leader of a sietch | Top 7 council role |
| **Fedaykin** | Elite death commandos | Top 69 member role |
| **Stillsuit** | Water-preserving gear | Info category |
| **Spice** | Most valuable substance | Alpha channel |

## Documentation

- **[docs/prd.md](docs/prd.md)** - Full Product Requirements Document

## Built With

This project was built using [agentic-base](https://github.com/0xHoneyJar/agentic-base), an agent-driven development framework for orchestrating product development lifecycle.

## License

MIT

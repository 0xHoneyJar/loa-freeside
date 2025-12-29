# Arrakis

[![Version](https://img.shields.io/badge/version-5.0.0-blue.svg)](CHANGELOG.md)
[![License](https://img.shields.io/badge/license-AGPL--3.0-green.svg)](LICENSE.md)

A multi-tenant SaaS platform for token-gated onchain communities and beyond. Deploy wallet-based access control, tiered progression systems, and cross-platform bots through a self-service wizard.

**Version 5.0.0 "The Transformation"** - Complete SaaS architecture overhaul with multi-tenancy, chain abstraction, and enterprise-grade infrastructure.

## Overview

Arrakis transforms token-gated community management from bespoke bot development into a self-service platform. Communities can deploy Discord/Telegram bots with configurable eligibility rules, tiered role systems, and real-time wallet scoring—all without writing code.

### What's New in v5.0

#### Multi-Tenant SaaS Architecture (Sprints 34-49)
- **PostgreSQL with Row-Level Security** - Complete tenant isolation at database level
- **Hexagonal Architecture** - Clean separation of domain, service, and infrastructure layers
- **Theme System** - Pluggable theme engine (BasicTheme free, SietchTheme premium)
- **Two-Tier Chain Provider** - Chain-agnostic scoring via Score Service with viem fallback

#### Infrastructure Components
- **Policy-as-Code Pre-Gate** - OPA-based Terraform plan validation with risk scoring
- **Enhanced HITL Approval Gate** - Slack/Discord notifications, MFA for high-risk changes, 24-hour timeout
- **Infracost Integration** - Cost estimation for infrastructure changes
- **Audit Trail with HMAC Signatures** - Tamper-proof audit logging

#### Enterprise Security
- **HashiCorp Vault Transit** - Ed25519 signing without key exposure
- **AWS EKS Deployment** - Kubernetes with proper network isolation
- **Defense in Depth** - 6-layer security model (WAF, VPC, Pod Security, RLS, Vault, Audit)
- **Webhook URL Validation** - Domain allowlist for Slack/Discord webhooks

### Previous Features (v4.x)

All v4.1 features are preserved via the SietchTheme:
- 9-tier Dune-themed progression system
- 10 badge types across tenure, achievement, and activity
- Weekly digest with community metrics
- Telegram bot with inline queries
- Stripe billing integration
- Cross-platform identity (Discord + Telegram)

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        ARRAKIS SAAS PLATFORM v5.0                           │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                         DOMAIN LAYER                                 │   │
│  │  ┌──────────┐  ┌──────────────┐  ┌─────────┐  ┌───────────────┐    │   │
│  │  │  Asset   │  │  Community   │  │  Role   │  │  Eligibility  │    │   │
│  │  └──────────┘  └──────────────┘  └─────────┘  └───────────────┘    │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                    │                                        │
│                                    ▼                                        │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                        SERVICE LAYER                                 │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌─────────────┐  ┌──────────┐ │   │
│  │  │ WizardEngine │  │ SyncService  │  │ ThemeEngine │  │ TierEval │ │   │
│  │  └──────────────┘  └──────────────┘  └─────────────┘  └──────────┘ │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                    │                                        │
│                    ┌───────────────┼───────────────┐                       │
│                    ▼               ▼               ▼                       │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                     INFRASTRUCTURE LAYER                             │   │
│  │                                                                      │   │
│  │  ┌────────────────────────────────────────────────────────────────┐ │   │
│  │  │              TWO-TIER CHAIN PROVIDER                            │ │   │
│  │  │  ┌─────────────────┐    ┌────────────────────────────────────┐ │ │   │
│  │  │  │  Tier 1: Native │    │  Tier 2: Score Service             │ │ │   │
│  │  │  │  (Binary checks)│    │  (Complex queries + Circuit Breaker)│ │ │   │
│  │  │  │  • hasBalance   │    │  • getRankedHolders                │ │ │   │
│  │  │  │  • ownsNFT      │    │  • getAddressRank                  │ │ │   │
│  │  │  │  Direct viem    │    │  • getActivityScore                │ │ │   │
│  │  │  └─────────────────┘    └────────────────────────────────────┘ │ │   │
│  │  └────────────────────────────────────────────────────────────────┘ │   │
│  │                                                                      │   │
│  │  ┌──────────────┐  ┌───────────────┐  ┌──────────────────────────┐ │   │
│  │  │ Discord      │  │ PostgreSQL    │  │ Redis                    │ │   │
│  │  │ Adapter      │  │ + RLS         │  │ (Sessions + TokenBucket) │ │   │
│  │  └──────────────┘  └───────────────┘  └──────────────────────────┘ │   │
│  │                                                                      │   │
│  │  ┌──────────────┐  ┌───────────────┐  ┌──────────────────────────┐ │   │
│  │  │ BullMQ       │  │ Vault Transit │  │ S3 Shadow                │ │   │
│  │  │ Synthesis    │  │ (Signing)     │  │ (Manifest Versions)      │ │   │
│  │  └──────────────┘  └───────────────┘  └──────────────────────────┘ │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Key Components

| Component | Purpose |
|-----------|---------|
| **Two-Tier Chain Provider** | Score Service for complex queries, viem fallback for binary checks |
| **Theme Engine** | Pluggable tier/badge/notification configurations |
| **WizardEngine** | Self-service community onboarding |
| **PolicyAsCodePreGate** | OPA-based Terraform validation |
| **EnhancedHITLApprovalGate** | Human approval workflow with MFA |
| **RiskScorer** | Infrastructure change risk assessment |
| **InfracostClient** | Cost estimation integration |

## Quick Start

### For Community Operators

1. Invite the Arrakis bot to your Discord server
2. Run `/setup` to launch the onboarding wizard
3. Configure your eligibility rules (token, chain, threshold)
4. Select a theme (BasicTheme or SietchTheme)
5. Bot automatically creates channels, roles, and starts syncing

### For Developers

```bash
# Clone and install
git clone https://github.com/0xHoneyJar/arrakis.git
cd arrakis/sietch-service
npm install

# Configure environment
cp .env.example .env
# Edit .env with your credentials

# Run development server
npm run dev

# Run tests
npm run test:run
```

## Configuration

### Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `DATABASE_URL` | PostgreSQL connection string | Yes |
| `REDIS_URL` | Redis connection string | Yes |
| `DISCORD_TOKEN` | Discord bot token | Yes |
| `DISCORD_CLIENT_ID` | Discord application ID | Yes |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token | Optional |
| `STRIPE_SECRET_KEY` | Stripe API key | Optional |
| `SCORE_SERVICE_URL` | Score Service endpoint | Optional |
| `VAULT_ADDR` | HashiCorp Vault address | Production |
| `VAULT_TOKEN` | Vault authentication token | Production |

## Security

Arrakis implements a 6-layer Defense in Depth model:

1. **WAF (CloudFront)** - Rate limiting, SQL injection, XSS protection
2. **Network (VPC)** - Private subnets, security groups, VPC endpoints
3. **Application (EKS)** - Non-root containers, read-only filesystem, RBAC
4. **Data (PostgreSQL)** - Row-Level Security for tenant isolation
5. **Secrets (Vault)** - Transit engine for signing, no key exposure
6. **Audit (CloudWatch)** - Comprehensive logging with HMAC signatures

### Infrastructure Security

- **Terraform Plan Validation** - OPA policies block dangerous changes
- **Risk Scoring** - Automatic assessment of infrastructure changes
- **Human Approval** - MFA-verified approvals for high-risk changes
- **Audit Trail** - HMAC-signed entries prevent tampering

## API Endpoints

### Public

```
GET /health
{ "status": "healthy", "version": "5.0.0" }

GET /api/v1/eligibility
GET /api/v1/eligibility/:wallet
```

### Authenticated

```
GET /me/stats
GET /me/tier-progress
GET /stats/community
GET /admin/analytics
```

## Theme System

### BasicTheme (Free)
- 3-tier progression (Member, Active, VIP)
- Token-gated access
- Basic notifications

### SietchTheme (Premium)
- 9-tier Dune-themed progression
- 10 badge types
- Weekly digest
- Story fragments
- Water Sharer badge system

## Documentation

| Document | Description |
|----------|-------------|
| [sietch-service/README.md](sietch-service/README.md) | Service setup & development |
| [loa-grimoire/prd.md](loa-grimoire/prd.md) | Product Requirements Document |
| [loa-grimoire/sdd.md](loa-grimoire/sdd.md) | Software Design Document |
| [loa-grimoire/sprint.md](loa-grimoire/sprint.md) | Sprint Plan (49 sprints) |
| [loa-grimoire/deployment/](loa-grimoire/deployment/) | Deployment documentation |
| [PROCESS.md](PROCESS.md) | Development workflow |
| [CHANGELOG.md](CHANGELOG.md) | Version history |

## Built With

- **Runtime**: Node.js 20, TypeScript
- **Database**: PostgreSQL with Drizzle ORM
- **Cache**: Redis with ioredis
- **Queue**: BullMQ
- **Discord**: discord.js v14
- **Telegram**: Grammy
- **Blockchain**: viem
- **Testing**: Vitest
- **Framework**: [Loa](https://github.com/0xHoneyJar/loa) agent-driven development

## License

AGPL-3.0 - See [LICENSE.md](LICENSE.md) for details.

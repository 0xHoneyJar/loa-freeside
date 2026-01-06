# Arrakis

[![Version](https://img.shields.io/badge/version-5.1.0-blue.svg)](CHANGELOG.md)
[![License](https://img.shields.io/badge/license-AGPL--3.0-green.svg)](LICENSE.md)
[![Docs](https://img.shields.io/badge/docs-arrakis.community-orange.svg)](https://docs.arrakis.community)

A multi-tenant SaaS platform for token-gated onchain communities and beyond. Deploy wallet-based access control, tiered progression systems, and cross-platform bots through a self-service wizard.

**Version 5.1.0 "The Merchant"** - Paddle billing integration, documentation site, marketing website, and infrastructure resilience improvements.

🌐 **Website**: [arrakis.community](https://arrakis.community)
📚 **Documentation**: [docs.arrakis.community](https://docs.arrakis.community)

## Overview

Arrakis transforms token-gated community management from bespoke bot development into a self-service platform. Communities can deploy Discord/Telegram bots with configurable eligibility rules, tiered role systems, and real-time wallet scoring—all without writing code.

### What's New in v5.1

#### Paddle Billing Integration
- **PaddleBillingAdapter** - Complete migration from Stripe to Paddle
- Subscription management with pause/resume support
- One-time payments for badges and boosts
- Customer portal for self-service billing management
- Webhook processing with signature verification

#### Documentation & Marketing
- **docs.arrakis.community** - Comprehensive developer documentation powered by Nextra 4
- **arrakis.community** - Marketing website with Dune-themed ASCII aesthetic
- Feature documentation, API reference, and getting started guides
- Use case pages and competitor comparisons

#### Infrastructure Resilience
- **CircuitBreaker** - Fault tolerance for external service calls
- **Distributed Tracing** - W3C Trace Context support with TracedDatabase and TracedRedis
- **WebhookQueue** - BullMQ-based reliable webhook processing
- **MFA Integration** - Duo Security support via MfaRouterService

### Previous Releases

#### v5.0 - Multi-Tenant SaaS Architecture
- PostgreSQL with Row-Level Security for tenant isolation
- Hexagonal Architecture with ports and adapters
- Theme System (BasicTheme free, SietchTheme premium)
- Two-Tier Chain Provider for chain-agnostic scoring
- Policy-as-Code Pre-Gate with OPA validation
- Enhanced HITL Approval Gate with MFA support

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
| `API_KEY_PEPPER` | HMAC pepper for API key hashing (generate: `openssl rand -base64 32`) | Production |
| `RATE_LIMIT_SALT` | Salt for rate limit key hashing (generate: `openssl rand -hex 16`) | Production |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token | Optional |
| `PADDLE_API_KEY` | Paddle API key | Optional |
| `PADDLE_WEBHOOK_SECRET` | Paddle webhook secret | Optional |
| `PADDLE_ENVIRONMENT` | `sandbox` or `production` | Optional |
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
{ "status": "healthy", "version": "5.1.0" }

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

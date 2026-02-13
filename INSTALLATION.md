# Arrakis Installation Guide

Complete setup guide for the Arrakis community infrastructure platform.

<!-- Conditional Discovery Checklist
Generated: 2026-02-13 | SHA: 39be5b7

| Component | Detected | Evidence |
|-----------|----------|----------|
| Docker | YES | apps/gateway/Dockerfile, themes/sietch/Dockerfile, Dockerfile.base, Dockerfile.dev |
| Docker Compose | YES | docker-compose.dev.yml |
| Database Migrations | YES | themes/sietch/drizzle/migrations/ (8 SQL files) |
| Redis | YES | themes/sietch/src/services/cache/RedisService.ts (ioredis) |
| Discord Bot | YES | themes/sietch/src/services/discord.ts (discord.js v14) |
| Telegram Bot | YES | themes/sietch/src/telegram/bot.ts (grammy) |
| Deployment Config | YES | infrastructure/terraform/ (AWS ECS IaC) |
| Node.js Version | YES | themes/sietch/package.json engines: >=20.0.0 |
| Package Manager | npm | package-lock.json present |
| Build System | TypeScript (tsc) | themes/sietch/tsconfig.json |
| Test Framework | Vitest | apps/ingestor/vitest.config.ts |
| Env Template | YES | themes/sietch/.env.example, .env.development.example |
-->

## Prerequisites

| Tool | Version | Required | Purpose |
|------|---------|----------|---------|
| Node.js | >= 20.0.0 | Yes | Runtime (from `themes/sietch/package.json` engines) |
| npm | (bundled with Node) | Yes | Package manager (`package-lock.json` present) |
| PostgreSQL | 15+ | Yes | Primary database (Drizzle ORM + RLS) |
| Redis | 7+ | Conditional | Caching, rate limiting, budget counters (enable via `FEATURE_REDIS_ENABLED=true`) |
| Docker | Latest | Optional | Container builds and development environment |
| Docker Compose | v2+ | Optional | Local multi-service development (`docker-compose.dev.yml`) |
| Terraform | 1.0+ | Optional | Infrastructure deployment (`infrastructure/terraform/`) |

## Clone & Install

```bash
git clone https://github.com/0xHoneyJar/arrakis.git
cd arrakis
npm install
```

This installs all workspace packages: `packages/core`, `packages/adapters`, `packages/cli`, `packages/sandbox`, `themes/sietch`, and `apps/*`.

## Environment Setup

Arrakis uses Zod-validated environment variables (1,737-line schema in `themes/sietch/src/config.ts`).

### Quick Setup

```bash
# Copy the template
cp themes/sietch/.env.example themes/sietch/.env

# For root-level development settings
cp .env.development.example .env
```

### Required Variables

These must be set for the bot to start:

```bash
# Discord
DISCORD_BOT_TOKEN=your_bot_token
DISCORD_GUILD_ID=your_server_id
DISCORD_CHANNEL_THE_DOOR=channel_id
DISCORD_CHANNEL_CENSUS=channel_id
DISCORD_ROLE_NAIB=role_id
DISCORD_ROLE_FEDAYKIN=role_id

# Blockchain
BERACHAIN_RPC_URLS=https://rpc1.berachain.com,https://rpc2.berachain.com
BGT_ADDRESS=0x...

# Database
DATABASE_URL=postgresql://user:password@localhost:5432/arrakis

# Trigger.dev (for scheduled tasks)
TRIGGER_PROJECT_ID=your_project_id
TRIGGER_SECRET_KEY=your_secret_key
```

### Feature Flags

Optional subsystems are disabled by default. Enable as needed:

```bash
# Billing (Paddle integration)
FEATURE_BILLING_ENABLED=false
PADDLE_WEBHOOK_SECRET=

# Redis caching
FEATURE_REDIS_ENABLED=false
REDIS_URL=redis://localhost:6379

# Telegram bot
FEATURE_TELEGRAM_ENABLED=false
TELEGRAM_BOT_TOKEN=
TELEGRAM_WEBHOOK_SECRET=

# HashiCorp Vault
FEATURE_VAULT_ENABLED=false
VAULT_ADDR=
VAULT_TOKEN=

# Crypto payments (NOWPayments)
FEATURE_CRYPTO_PAYMENTS_ENABLED=false
NOWPAYMENTS_API_KEY=
NOWPAYMENTS_IPN_SECRET=

# Gateway proxy mode
USE_GATEWAY_PROXY=false
```

### Chain Provider Mode

Controls how blockchain data is queried:

```bash
# Options: rpc (default), dune_sim, hybrid
CHAIN_PROVIDER=rpc

# Required for dune_sim/hybrid modes
DUNE_SIM_API_KEY=your_api_key

# Enable RPC fallback in hybrid mode
CHAIN_PROVIDER_FALLBACK_ENABLED=true
```

**Never commit `.env` files.** The `.env.example` templates contain variable names only.

## Database Setup

Arrakis uses Drizzle ORM with PostgreSQL 15 and Row-Level Security (RLS).

### Create Database

```bash
createdb arrakis
```

### Run Migrations

```bash
cd themes/sietch
npx drizzle-kit push
```

Migration files are in `themes/sietch/drizzle/migrations/` (8 migrations as of v7.0.0):
- `0000_swift_sleeper.sql` — Initial schema (communities, profiles, badges)
- `0001_rls_policies.sql` — Row-Level Security policies
- `0002_rls_additional_tables.sql` — Additional RLS tables
- `0003_wallet_verification_sessions.sql` — Wallet verification
- `0004_rls_nil_uuid_hardening.sql` — RLS security hardening
- `0005_eligibility_tables.sql` — Eligibility tables
- `0006_agent_usage_hounfour.sql` — Hounfour agent usage logging
- `0007_community_byok_keys.sql` — Bring-your-own-key support

### Verify

```bash
npx drizzle-kit studio
```

Opens Drizzle Studio to inspect tables: `communities`, `profiles`, `badges`, `community_agent_config`, `agent_usage_log`.

## Running Services

### Discord Bot (Primary)

The main service — always required:

```bash
cd themes/sietch
npm run dev
```

This starts the Express API server with Discord bot, scheduled tasks, and webhook handlers.

### Telegram Bot (Optional)

Requires `FEATURE_TELEGRAM_ENABLED=true` and Telegram credentials:

```bash
# Telegram runs as part of the main service when enabled
# In development, it uses long polling
# In production, configure webhook URL:
TELEGRAM_WEBHOOK_URL=https://your-domain.com/telegram/webhook
```

### Gateway Proxy (Optional)

Rust-based Discord gateway for distributed event handling:

```bash
cd apps/gateway
cargo build --release
./target/release/gateway
```

Requires: `DISCORD_TOKEN`, `POOL_ID`, `TOTAL_SHARDS`, `NATS_URL`

### Gaib CLI

Admin command-line tool for user management, sandbox, and server IaC:

```bash
# Install globally (optional)
npm link packages/cli

# Or run directly
npx gaib auth login
npx gaib sandbox new
npx gaib server init
```

## Docker Development

A `docker-compose.dev.yml` is available for local multi-service development.

```bash
docker compose -f docker-compose.dev.yml up
```

Individual service Dockerfiles:
- `Dockerfile.base` — Base image for Node.js services
- `Dockerfile.dev` — Development image with hot reload
- `themes/sietch/Dockerfile` — Sietch bot service
- `apps/gateway/Dockerfile` — Rust gateway (multi-stage build)
- `apps/ingestor/Dockerfile` — Event ingestor
- `apps/worker/Dockerfile` — Background worker

### Build Individual Services

```bash
# Sietch bot
docker build -t arrakis-sietch -f themes/sietch/Dockerfile .

# Gateway (Rust)
docker build -t arrakis-gateway -f apps/gateway/Dockerfile apps/gateway/
```

## Deployment

Infrastructure is managed via Terraform targeting AWS ECS.

### Terraform Files

Located in `infrastructure/terraform/`:
- `main.tf` — Provider and backend configuration (S3 state)
- `vpc.tf` — VPC networking
- `rds.tf` — PostgreSQL RDS instance
- `elasticache.tf` — Redis ElastiCache
- `ecs.tf` — ECS services and task definitions
- `nats.tf` — NATS messaging (for gateway)

### Deploy

```bash
cd infrastructure/terraform

# Initialize
terraform init

# Plan changes
terraform plan -var-file=production.tfvars

# Apply
terraform apply -var-file=production.tfvars
```

Or use the Gaib CLI:

```bash
gaib server init
gaib server plan
gaib server apply
```

## Testing

```bash
# Run all tests (Vitest)
npm test

# Run with coverage
npm run test:coverage

# Type checking
npm run typecheck

# Build
npm run build
```

## Troubleshooting

### Bot won't start — "Missing required config"

The Zod validation schema enforces all required variables at startup. Check the error message for the specific missing variable and ensure it's set in your `.env` file. See the Required Variables section above.

### Database connection refused

Ensure PostgreSQL is running and `DATABASE_URL` is correct:

```bash
# Test connection
psql $DATABASE_URL -c "SELECT 1"
```

### Discord commands not appearing

Slash commands are registered on bot `ready` event. If commands don't appear:
1. Verify `DISCORD_GUILD_ID` matches your test server
2. Ensure the bot has `applications.commands` scope
3. Check bot logs for registration errors

### Redis connection errors

Redis is optional (controlled by `FEATURE_REDIS_ENABLED`). If enabled but not available, the bot will fail rate limiting and budget operations. Either:
- Start Redis: `redis-server` or `docker run -p 6379:6379 redis:7`
- Disable: Set `FEATURE_REDIS_ENABLED=false`

### Trigger.dev tasks not running

Scheduled tasks require a Trigger.dev project. Ensure `TRIGGER_PROJECT_ID` and `TRIGGER_SECRET_KEY` are set. Tasks will not run in development without these credentials.

### Drizzle migration errors

If migrations fail:

```bash
# Check migration status
npx drizzle-kit check

# Generate new migration after schema changes
npx drizzle-kit generate

# Force push (development only)
npx drizzle-kit push --force
```

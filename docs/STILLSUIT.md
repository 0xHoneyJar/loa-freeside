# Stillsuit: Rapid Development Workflow

> *"The stillsuit is the desert's most valuable possession. It allows a man to travel the deep desert and survive."* — Frank Herbert, Dune

Stillsuit is Arrakis's development acceleration system, providing hot-reload local development and optimized CI/CD for faster iteration cycles.

## Overview

| Tier | Environment | Target | Actual |
|------|-------------|--------|--------|
| **Tier 1** | Local Development | <5s hot-reload | ~5s (Linux), ~8s (macOS) |
| **Tier 2** | Staging Deployment | <8 minutes | ~7 minutes |
| **Tier 3** | Production | N/A | Manual promotion |

## Quick Start

```bash
# 1. Copy environment template
cp .env.development.example .env.development

# 2. Add your Discord credentials to .env.development
# Get from https://discord.com/developers/applications

# 3. Start development environment
make dev

# 4. Edit themes/sietch/src/*.ts and watch hot-reload!
```

## Tier 1: Local Development

### Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Host Machine                          │
│  ┌─────────────────────────────────────────────────┐    │
│  │     themes/sietch/src (mounted volume)          │    │
│  │              ↓ (file watch)                     │    │
│  └─────────────────────────────────────────────────┘    │
│                                                          │
│  ┌─────────────────────────────────────────────────┐    │
│  │          docker-compose.dev.yml                  │    │
│  │  ┌─────────────────┐  ┌──────────┐  ┌────────┐ │    │
│  │  │   sietch-dev    │  │ postgres │  │ redis  │ │    │
│  │  │  (entr + tsx)   │→ │   :5432  │  │ :6379  │ │    │
│  │  │     :3000       │  └──────────┘  └────────┘ │    │
│  │  └─────────────────┘                            │    │
│  └─────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────┘
```

### Hot-Reload Scope

| Path | Hot-Reloaded | Notes |
|------|--------------|-------|
| `themes/sietch/src/**/*.ts` | ✅ Yes | ~5s restart via entr |
| `themes/sietch/drizzle/**` | ✅ Yes | Schema changes |
| `packages/core/**` | ❌ No | Requires `make dev-build` |
| `packages/adapters/**` | ❌ No | Requires `make dev-build` |

### Makefile Commands

```bash
make help           # Show all commands
make dev            # Start development environment
make dev-build      # Rebuild after package/* changes
make dev-logs       # Tail logs
make dev-shell      # Shell into container
make dev-db         # Open Drizzle Studio
make dev-migrate    # Run database migrations
make test           # Run tests in container
make lint           # Run linting
make clean          # Stop and remove containers
make status         # Show container status
```

### Environment Variables

```bash
# Required for Discord features (get from Discord Developer Portal)
DISCORD_TOKEN=your_bot_token
DISCORD_CLIENT_ID=your_application_id
DISCORD_GUILD_ID=your_test_server_id

# Optional - Chain provider configuration
CHAIN_PROVIDER=rpc              # rpc | dune_sim | hybrid
DUNE_SIM_API_KEY=your_api_key   # Required for dune_sim/hybrid

# Auto-configured by docker-compose (DO NOT SET)
# DATABASE_URL=postgresql://arrakis:arrakis@postgres:5432/arrakis
# REDIS_URL=redis://redis:6379
```

### Performance Notes

| Platform | Hot-Reload Time | Notes |
|----------|-----------------|-------|
| Linux | ~5s | Native file watching |
| macOS | ~8s | VirtioFS with `:cached` flag |
| Windows/WSL2 | ~5s | Use WSL2 filesystem |

**macOS Optimization**: The `docker-compose.dev.yml` uses `:cached` volume mounts which leverage VirtioFS for improved performance.

## Tier 2: Staging Deployment

### CI/CD Pipeline

```
┌───────────────────────────────────────────────────────────────┐
│                    GitHub Actions                              │
│                                                                │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────┐      │
│  │  Build &     │   │   Deploy     │   │   Deploy     │      │
│  │  Push to ECR │ → │   API        │ ∥ │   Worker     │      │
│  │  (~3 min)    │   │   (~2 min)   │   │   (~2 min)   │      │
│  └──────────────┘   └──────────────┘   └──────────────┘      │
│                            ↓                  ↓               │
│                     ┌──────────────────────────────┐         │
│                     │   Services Stable Wait       │         │
│                     │        (~2 min)              │         │
│                     └──────────────────────────────┘         │
│                                                                │
│                     Total: ~7 minutes (target: <8)            │
└───────────────────────────────────────────────────────────────┘
```

### Optimization Techniques

1. **Pre-built Base Image** (`Dockerfile.base`)
   - Contains all npm dependencies (~500MB)
   - Rebuilt weekly or on `package-lock.json` changes
   - Dramatically reduces build time

2. **Parallel Deployments**
   - API and Worker deploy simultaneously
   - Combined "services-stable" wait instead of sequential

3. **Layer Caching**
   - GitHub Actions cache for Docker layers
   - ECR layer caching for repeated builds

### Triggering Deployments

```bash
# Auto-deploy on push to staging branch
git checkout staging
git merge feature/your-branch
git push origin staging

# Manual deployment via GitHub Actions UI
# Navigate to Actions → Deploy to Staging → Run workflow
```

### Base Image Workflow

The base image rebuilds automatically:
- **Weekly**: Sunday 00:00 UTC (security patches)
- **On Change**: When `package-lock.json` files change
- **Manual**: Via GitHub Actions workflow dispatch

```bash
# Force rebuild base image
gh workflow run build-base-image.yml -f force_rebuild=true
```

## Tier 3: Production Deployment

Production deployments are **manual promotions** from staging:

1. Verify staging is stable
2. Create a release tag
3. Trigger production deployment workflow
4. Monitor rollout in AWS ECS

See `docs/runbook/` for detailed production procedures.

## Troubleshooting

### Port Already in Use

```bash
# Error: Port 3000 is in use
make clean                    # Stop dev containers
docker ps                     # Check for other containers
lsof -i :3000                # Find process on port
```

### Package Changes Not Reflected

```bash
# After changing packages/core or packages/adapters
make dev-build               # Rebuild containers with new packages
make dev                     # Restart
```

### Database Connection Issues

```bash
# Check PostgreSQL is running
make logs-postgres

# Reset database
make clean                   # Removes volumes
make dev                     # Fresh start
```

### Hot-Reload Not Working

```bash
# Check entr is detecting files
make dev-shell
find src -name "*.ts" | head

# Check logs for restart messages
make dev-logs
```

### macOS Slow Performance

1. Ensure Docker Desktop uses VirtioFS (Settings → General)
2. Check volume mounts use `:cached` flag (already configured)
3. Increase Docker Desktop resources (Settings → Resources)

### Discord Bot Not Connecting

1. Verify `DISCORD_TOKEN` in `.env.development`
2. Check bot is added to your test server
3. Ensure bot has required permissions
4. Check logs: `make dev-logs | grep -i discord`

## File Reference

| File | Purpose |
|------|---------|
| `Dockerfile.dev` | Development container with entr hot-reload |
| `Dockerfile.base` | Pre-built dependencies image for CI/CD |
| `docker-compose.dev.yml` | Full dev stack (sietch, postgres, redis) |
| `scripts/start-dev.sh` | Hot-reload startup with env validation |
| `Makefile` | Self-documenting developer interface |
| `.env.development.example` | Environment template |
| `.github/workflows/deploy-staging.yml` | Parallel staging deployment |
| `.github/workflows/build-base-image.yml` | Weekly base image builder |

## Design Decisions

### ADR-006: Hot-Reload Scope

**Decision**: Only `themes/sietch/src` is hot-reloaded.

**Rationale**:
- Workspace packages (`packages/*`) are shared across apps
- Rebuilding packages on every change is slow and error-prone
- Explicit `make dev-build` provides clear rebuild boundary

### Why entr over nodemon/tsx watch?

1. **Reliability**: entr is battle-tested Unix tooling
2. **Performance**: Native file watching, minimal overhead
3. **Simplicity**: Works identically in containers and locally
4. **Proven**: Successfully used in loa-beauvoir framework

### Why Parallel CI/CD?

Previous sequential deployment took 15-25 minutes:
```
Build → Deploy API → Wait → Deploy Worker → Wait
```

Optimized parallel deployment: ~7 minutes:
```
Build → Deploy API ∥ Deploy Worker → Combined Wait
```

## Contributing

When modifying Stillsuit infrastructure:

1. Test locally with `make dev`
2. Verify `make dev-build` works after package changes
3. Check CI passes in PR
4. Test staging deployment before production

---

*"Without change, something sleeps inside us, and seldom awakens. The sleeper must awaken."* — Frank Herbert

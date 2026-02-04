# Arrakis Ecosystem Map

> Updated: 2026-02-04
> Architecture: Monorepo + Independent Marketing Site

## Overview

The Arrakis platform uses a **monorepo architecture** for all tightly-coupled components, with the marketing website extracted to its own repository for independent deployment.

---

## Repository Structure

| Repository | Purpose | Status |
|------------|---------|--------|
| [arrakis](https://github.com/0xHoneyJar/arrakis) | Core platform (bot, dashboard, builder, backend) | **Active** |
| [arrakis-web](https://github.com/0xHoneyJar/arrakis-web) | Marketing website (Next.js) | **Active** |

### Archived Repositories

The following repositories were created but never used and have been **archived**:

| Repository | Original Intent | Why Archived |
|------------|----------------|--------------|
| `arrakis-types` | Shared TypeScript types | Types belong with the code that defines them |
| `arrakis-dashboard` | Admin dashboard | Dashboard needs backend types; too tightly coupled |
| `arrakis-builder` | Theme builder | Builder needs backend types; too tightly coupled |

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    ARRAKIS ECOSYSTEM                         │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─────────────────┐                                        │
│  │  arrakis-web    │  ← Independent (Vercel deployment)     │
│  │  (Marketing)    │                                        │
│  │  Next.js 14     │                                        │
│  └─────────────────┘                                        │
│                                                              │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              ARRAKIS MONOREPO                        │   │
│  │                                                      │   │
│  │  ┌────────────────────────────────────────────────┐ │   │
│  │  │              packages/                          │ │   │
│  │  │  ┌──────────┐  ┌──────────────────────────┐   │ │   │
│  │  │  │   core   │  │        adapters          │   │ │   │
│  │  │  │ (types)  │  │ chain | security | themes│   │ │   │
│  │  │  └──────────┘  └──────────────────────────┘   │ │   │
│  │  └────────────────────────────────────────────────┘ │   │
│  │                                                      │   │
│  │  ┌────────────────────────────────────────────────┐ │   │
│  │  │              themes/sietch/                     │ │   │
│  │  │  ┌──────────┐  ┌───────────┐  ┌───────────┐  │ │   │
│  │  │  │ Discord  │  │ Dashboard │  │  Builder  │  │ │   │
│  │  │  │   Bot    │  │   (UI)    │  │   (UI)    │  │ │   │
│  │  │  └──────────┘  └───────────┘  └───────────┘  │ │   │
│  │  └────────────────────────────────────────────────┘ │   │
│  │                                                      │   │
│  │  ┌────────────────────────────────────────────────┐ │   │
│  │  │              apps/                              │ │   │
│  │  │  ┌──────────┐  ┌──────────┐  ┌──────────┐    │ │   │
│  │  │  │ gateway  │  │  worker  │  │ ingestor │    │ │   │
│  │  │  └──────────┘  └──────────┘  └──────────┘    │ │   │
│  │  └────────────────────────────────────────────────┘ │   │
│  │                                                      │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## Monorepo Structure (arrakis)

| Directory | Purpose | Team |
|-----------|---------|------|
| `packages/core` | Domain models, ports, interfaces | Core |
| `packages/adapters` | Chain providers, security, themes | Core |
| `packages/cli` | Command-line interface | Core |
| `themes/sietch` | Discord bot application | Core |
| `themes/sietch/dashboard` | Admin dashboard UI | Frontend |
| `themes/sietch/src/ui/builder` | Theme builder UI | Frontend |
| `apps/gateway` | API gateway microservice | Core |
| `apps/worker` | Background jobs | Core |
| `infrastructure/terraform` | AWS IaC | Infra |
| `docs/` | Documentation | Core |

---

## Why Monorepo?

### Benefits for Arrakis

1. **Atomic changes** - Backend API + Frontend can change in single PR
2. **Shared types** - No npm publishing, no version drift
3. **Single CI/CD** - One pipeline, consistent testing
4. **Easier refactoring** - Move code between packages freely
5. **AI-friendly** - Claude can see full context for cross-cutting changes

### When We Might Split

Consider extracting when:
- Dedicated team (3+) works exclusively on a component
- API is stable and versioned (v1.0+)
- Components deploy on different schedules
- Access control requirements differ

**Current state**: None of these conditions are met.

---

## arrakis-web (Marketing Site)

**Why extracted?**
- No dependencies on backend types
- Can be maintained by non-engineers
- Deploys independently via Vercel
- Different tech stack (pure Next.js, no backend)

**Repository**: https://github.com/0xHoneyJar/arrakis-web

**Tech Stack**:
- Next.js 14
- React 18
- Tailwind CSS
- TypeScript

**Pages**:
- Homepage
- Features
- Pricing
- Use cases (NFT Projects, DeFi, DAOs)
- Competitor comparisons
- Legal (Terms, Privacy, Refund)

---

## CODEOWNERS

The monorepo uses [CODEOWNERS](../.github/CODEOWNERS) for notification routing:

| Path | Team |
|------|------|
| `*` (default) | @0xHoneyJar/core |
| `infrastructure/` | @0xHoneyJar/infra |
| `themes/sietch/dashboard/` | @0xHoneyJar/frontend |
| `themes/sietch/src/ui/builder/` | @0xHoneyJar/frontend |

---

## Development Workflow

### For Backend/Bot Changes

```bash
# Clone monorepo
git clone git@github.com:0xHoneyJar/arrakis.git
cd arrakis

# Start local dev
make dev
```

### For Dashboard/Builder Changes

```bash
# Same monorepo
cd arrakis/themes/sietch/dashboard
npm run dev
```

### For Marketing Site Changes

```bash
# Separate repo
git clone git@github.com:0xHoneyJar/arrakis-web.git
cd arrakis-web
npm install
npm run dev
```

---

## AI Context Tips

When working with Claude/GPT on the monorepo, scope your prompts:

```
"Focus only on themes/sietch/dashboard/ for this task"
"Only modify files in packages/adapters/chain/"
"This change should only affect the Discord bot in themes/sietch/"
```

This gives AI the benefit of seeing the full codebase while focusing on relevant files.

---

## Related Documentation

- [CODEBASE-ANALYSIS.md](CODEBASE-ANALYSIS.md) - Full technical reference
- [STILLSUIT.md](STILLSUIT.md) - Development workflow
- [CODEOWNERS](../.github/CODEOWNERS) - Team ownership

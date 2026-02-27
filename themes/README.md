# Themes

Theme-specific backend services for Freeside communities.

## Concept

A **theme** is a complete backend service implementation that provides:
- Discord bot integration
- API endpoints
- Background jobs
- Platform-specific customizations

Each theme is self-contained with its own:
- `src/` - Application code
- `tests/` - Unit, integration, and e2e tests
- `package.json` - Dependencies
- `Dockerfile` - Deployment configuration

## Current Themes

| Theme | Description | Status |
|-------|-------------|--------|
| `sietch/` | Arrakis/Dune themed service for BGT communities | Production |

## Theme Architecture

```
themes/{name}/
├── src/
│   ├── api/            # REST API routes
│   ├── discord/        # Discord bot commands & events
│   ├── services/       # Business logic
│   ├── packages/       # Internal modules (adapters, core)
│   ├── db/             # Database schemas & migrations
│   └── jobs/           # Background workers
├── tests/
│   ├── unit/           # Unit tests
│   ├── integration/    # Integration tests
│   └── e2e/            # End-to-end tests
├── docs/               # Theme-specific documentation
├── Dockerfile
├── package.json
└── README.md
```

## Adding a New Theme

1. Create directory: `themes/{name}/`
2. Copy structure from an existing theme
3. Customize for your community's needs
4. Shared code should be extracted to `packages/core/`

## Naming Convention

Themes are named after their community identity:
- `sietch` - Dune reference (Arrakis)
- Future themes follow same pattern

# API Surface

> Generated: 2026-05-18 by /ride

## REST API (themes/sietch/src/api/) — 80+ routes

Routers (all under Express 5):

| File | Domain |
|------|--------|
| `routes.ts` | Top-level mounting |
| `admin.routes.ts` | Admin / governance operations |
| `badge.routes.ts` | Badge CRUD + evaluation |
| `billing.routes.ts` | Fiat billing |
| `crypto-billing.routes.ts` | NowPayments + on-chain billing |
| `telegram.routes.ts` | Telegram-specific endpoints |
| `server.ts` | HTTP bootstrap |
| `middleware.ts` | Auth, CORS, rate limit, request-id |
| `errors.ts` | Error→HTTP mapping |

### Selected Routes

```
# Discovery
GET    /.well-known/jwks.json         # ES256 public keys (per ADR-002)

# Authn
GET    /verify                        # Wallet verify start
GET    /callback                      # OAuth callback (Discord)
GET    /me                            # Current user info
GET    /protected                     # Auth-gated probe

# Agent gateway (proxy to packages/adapters/agent)
GET    /api/agents/budget
GET    /api/agents/health
GET    /api/agents/models
POST   /api/agents/invoke
POST   /api/agents/stream

# Admin / Governance (per-guild)
GET    /admin/stats
GET    /:guildId/status
GET    /:guildId/shadow/divergences
POST   /:guildId/mode
POST   /:guildId/rollback
POST   /:guildId/emergency-backup
PATCH  /:userId/thresholds

# Sessions
GET    /sessions
GET    /sessions/:sessionId
POST   /sessions/:sessionId
GET    /sessions/:sessionId/status
DELETE /sessions/:sessionId

# Sandbox access
POST   /:id/sandbox-access
GET    /:id/sandbox-access
DELETE /:id/sandbox-access/:sandboxId
DELETE /sandbox/:sandboxId/reset

# Rewards / history
GET    /rewards
GET    /history

# Config / discovery
GET    /config
GET    /discord
```

Full list: `grimoires/loa/reality/api-routes.txt` (50 unique route declarations extracted).

## Discord Slash Commands (themes/sietch/src/discord/commands/)

20+ commands. Selected:

```
/verify              # Wallet verification flow
/badges              # User badge list
/stats               # User stats
/profile             # User profile
/leaderboard         # Top BGT holders
/directory           # Member directory
/naib                # Naib role info
/threshold           # Threshold management
/water-share         # Water Sharer feature
/register-waitlist   # Waitlist registration
/buy-credits         # Credit purchase
/agent               # Agent gateway interaction
/position            # Position info
/resume              # Resume onboarding

# Admin (gated)
/admin-takeover
/admin-badge
/admin-stats
/admin-water-share
/admin-migrate
```

Full list: `find themes/sietch/src/discord/commands -name "*.ts"`.

## Telegram Commands (themes/sietch/src/telegram/commands/)

Grammy framework. Per-command files under `telegram/commands/`.

## CLI (`gaib` — packages/cli/src/bin/gaib.ts)

40+ subcommands. Entry: `packages/cli/src/bin/gaib.ts`. Service implementations under `packages/cli/src/services/` and `packages/cli/src/commands/`.

External integrations (per package.json):
- AWS SDK (DynamoDB, S3, credentials)
- Discord REST API
- File I/O (js-yaml for configs, chalk + cli-table3 + ora for UX)

## Agent Gateway HTTP/SDK Surface

The gateway is consumed via:
1. `/api/agents/*` routes (above) — HTTP
2. Direct adapter import in services: `import { … } from '@arrakis/adapters/agent'`
3. Lua scripts loaded from `packages/adapters/agent/lua/`

Key exported symbols (per CLAUDE.md):
- `computeEnsembleAccounting(strategy, invocationResults)` — returns `{ model_breakdown, platform_cost_micro, byok_cost_micro, savings_micro }`
- Capability audit event types: `pool_access`, `byok_usage`, `ensemble_invocation`

## Worker Consumers (apps/worker/src/consumers/)

Consumes events from NATS (`main-nats.ts`) or RabbitMQ (`main.ts`) — dual-bus in flight.

## Rust Gateway HTTP/NATS Surface (apps/gateway)

- Twilight Discord gateway shards (in-memory; not directly HTTP-callable)
- Publishes Discord events to NATS subjects (see `src/nats/publisher.rs`)
- Health endpoint via `src/health/mod.rs`
- Metrics endpoint via `src/metrics/mod.rs`

# API Surface

> SHA: 39be5b7 | Generated: 2026-02-13

## REST API (Express)

Entry point: `startServer()` (src: themes/sietch/src/api/server.ts:L556). App factory: `createApp()` (src: themes/sietch/src/api/server.ts:L71).

### Route Mounting (src: themes/sietch/src/api/routes/index.ts:L26)

| Path | Router | Ref |
|------|--------|-----|
| `/` | publicRouter | (src: themes/sietch/src/api/routes/index.ts:L29) |
| `/api` | memberRouter | (src: themes/sietch/src/api/server.ts:L242) |
| `/api/billing` | billingRouter | (src: themes/sietch/src/api/server.ts:L245) |
| `/api/crypto` | cryptoBillingRouter | (src: themes/sietch/src/api/server.ts:L248) |
| `/admin` | adminRouter | (src: themes/sietch/src/api/server.ts:L479) |

### Middleware

| Middleware | Ref |
|-----------|-----|
| Public rate limiter | (src: themes/sietch/src/api/middleware.ts:L103) |
| Admin rate limiter | (src: themes/sietch/src/api/middleware.ts:L139) |
| Auth (API key validation) | (src: themes/sietch/src/api/middleware/auth.ts:L182) |
| Helmet security headers | (src: themes/sietch/src/api/server.ts:L93) |
| CORS | (src: themes/sietch/src/api/server.ts:L165) |

### Webhooks

| Endpoint | Verification | Ref |
|----------|-------------|-----|
| POST /api/billing/webhook | Paddle signature (`paddle-signature`) | (src: themes/sietch/src/api/billing.routes.ts:L438) |
| POST /api/crypto/webhook | HMAC-SHA512 (`x-nowpayments-sig`) | (src: themes/sietch/src/api/crypto-billing.routes.ts:L383) |
| POST /telegram/webhook | Secret token (`x-telegram-bot-api-secret-token`) | (src: themes/sietch/src/api/telegram.routes.ts:L78) |

Raw body middleware for webhooks at (src: themes/sietch/src/api/server.ts:L207).

## Discord Slash Commands

Registry array at (src: themes/sietch/src/discord/commands/index.ts:L30). Handler exports at (src: themes/sietch/src/discord/commands/index.ts:L58).

| Command | Builder | Handler |
|---------|---------|---------|
| `/profile view [nym]` | (src: themes/sietch/src/discord/commands/profile.ts:L14) | (src: themes/sietch/src/discord/commands/profile.ts:L37) |
| `/stats` | (src: themes/sietch/src/discord/commands/stats.ts:L28) | (src: themes/sietch/src/discord/commands/stats.ts:L35) |
| `/score`, `/badges`, `/alerts`, `/position` | Registered in commands/index.ts | (src: themes/sietch/src/discord/commands/index.ts:L30) |
| `/directory`, `/leaderboard`, `/naib`, `/water-share` | Registered in commands/index.ts | (src: themes/sietch/src/discord/commands/index.ts:L30) |
| `/status`, `/onboard`, `/verify`, `/register-waitlist` | Registered in commands/index.ts | (src: themes/sietch/src/discord/commands/index.ts:L30) |

Admin: `/admin-badge`, `/admin-stats`, `/admin-takeover`, `/admin-migrate`, `/simulation` (src: themes/sietch/src/discord/commands/index.ts:L30).
Interactions: Button handlers for alerts, directory, leaderboard, profile modals (src: themes/sietch/src/discord/commands/index.ts:L58).

## Telegram Commands

Registration: `registerAllCommands(bot)` (src: themes/sietch/src/telegram/commands/index.ts:L23). Bot startup: `startTelegramBot()` (src: themes/sietch/src/telegram/bot.ts:L125).

| Command | Ref |
|---------|-----|
| `/start` | (src: themes/sietch/src/telegram/commands/start.ts:L43) |
| `/verify` | (src: themes/sietch/src/telegram/commands/index.ts:L26) |
| `/score` | (src: themes/sietch/src/telegram/commands/score.ts:L47) |
| `/status`, `/leaderboard`, `/help`, `/refresh`, `/unlink`, `/alerts` | (src: themes/sietch/src/telegram/commands/index.ts:L23) |

## Gaib CLI

Registration: `registerCommands(program)` (src: packages/cli/src/commands/index.ts:L24).

| Group | Factory | Ref |
|-------|---------|-----|
| `gaib auth` | `createAuthCommand()` | (src: packages/cli/src/commands/auth/index.ts:L58) |
| `gaib sandbox` | `createSandboxCommand()` | (src: packages/cli/src/commands/index.ts:L34) |
| `gaib server` | `createServerCommand()` | (src: packages/cli/src/commands/server/index.ts:L28) |
| `gaib user` | — | (src: packages/cli/src/commands/index.ts:L27) |

Auth subcommands: `login|logout|whoami` — login at (src: packages/cli/src/commands/auth/login.ts:L63). Server IaC: `init|plan|diff|apply|destroy|teardown` + `workspace|state|locks` (src: packages/cli/src/commands/server/index.ts:L107).

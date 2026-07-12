---
source_type: ai-autogen
use_label: usable
read_state: read
as_of: 2026-07-06
generated_by: /ride reality+ground-truth refresh (supersedes 2026-05-18 CORPSE)
---

# API & Command Surface — loa-freeside (current, in-repo)

> Generated 2026-07-06 by /ride. In-repo surfaces only (external cells expose their own). CODE IS TRUTH.

## REST (themes/sietch — Express 5)
- **48 route modules → 300+ endpoints** (`themes/sietch/src/api/routes/index.ts`). Server init `themes/sietch/src/api/server.ts:119-761`.
- Mount points: `publicRouter`, `adminRouter`, `memberRouter`, `billingRouter`, `badgeRouter`, `boostRouter`, `componentRouter`, `themeRouter`, `telegramRouter`, `verifyRouter`, `internalRouter`, `internalAgentRouter`, `agentTbaRouter`, `agentGovernanceRouter`, `velocityRouter`, `eventsRouter`, `governanceRouter`.
- Representative modules:
  - `agents.routes.ts` (8): `/api/agents/health|invoke|stream|models|budget|usage-reports`, `/.well-known/jwks.json`
  - `auth.routes.ts` (6): `/login|logout|me|refresh|sessions`, `DELETE /sessions/:id`, `/verify`
  - `users.routes.ts` (9): CRUD + disable/enable/reset-password/sandbox-access
  - `simulation.routes.ts` (12): assume/whoami/state/check/thresholds
  - `coexistence.routes.ts` (5): status/mode/rollback/divergences/emergency-backup
  - `billing.routes.ts`: crypto payments (Paddle / NOWPayments)
- **Auth middleware**: `requireAuth`, `requireRoles`, `requireApiKey`, `requireDashboardAuth`. Security: helmet CSP, `memberRateLimiter` / `webhookRateLimiter`, cookie parser, CORS.

## REST (in-repo services — Hono)
- `packages/services/shadow-audit` → `bin/http.ts` (Access-Risk Audit API)
- `packages/services/ordering` → `bin/http.ts` + `bin/worker.ts` + `bin/fulfillment-orchestrator.ts`
- `packages/services/shadow-mode` → `src/index.ts` (member-graph ledger)
- `packages/freeside-registry` → `/federation.json` manifest endpoint
- `apps/mcp-gateway` → `bin/http.ts` (Hono; MCP federation v0.3)

## Discord (discord.js) — 23 commands
`themes/sietch/src/discord/commands/`: admin-migrate, agent, buy-credits, onboard, threshold, verify, water-share, directory, leaderboard, naib, position, profile, register-waitlist, resume, simulation, stats, admin-badge, admin-stats, admin-takeover, admin-water-share, alerts, badges. Pattern `Command = { name, description, handler, options }`; `requireAdminRole` / `requireAuth`.

## Telegram (Grammy) — 12 commands
`themes/sietch/src/telegram/commands/`: agent, buy-credits, verify, status, unlink, help, leaderboard, refresh, score, start, alerts (+ index). Webhook mode `POST /telegram/webhook` (`telegram.routes.ts:78`) with `X-Telegram-Bot-Api-Secret-Token` validation (`:37-60`); polling in dev.

## CLIs — 2
- **freeside-cli** (`packages/freeside-cli/bin/freeside-cli.ts`) — 6 verbs: `list`, `inspect <slug>`, `doctor [--remote|--acvp|--cells-dir]`, `order (place|status|ingredients)`, `kitchen (probe|advance)`, `fulfill (watch)`. Exit codes 0 ok · 1 usage · 2 unreachable · 3 API error · 4 ambiguous · 5 timeout · 6 failed.
- **gaib** (`packages/cli/bin/gaib.ts`, Commander) — groups: `auth` (login/logout/whoami), `sandbox` (list/create/destroy/connect/link/unlink), `user` (create/ls/grant/access/revoke), `server` (init/apply/diff/destroy/export/import/theme/workspace/backup/restore). Levenshtein typo detection.

## MCP
2 tenants exposed via `apps/mcp-gateway` — codex, score. Orientation packets synthesize beacon + probe + registry (`packages/beacon-schema` `buildOrientationPacket`).

## Webhooks (6)
- `/api/billing/webhook`, `/api/crypto/webhook` (raw-body middleware, `server.ts:249-262`) — NOWPayments/Paddle
- `POST /telegram/webhook` (secret-token guarded)
- Discord interactions; x402 payment paths; Stripe (billing).

## Delta vs 2026-05-18 corpse
- **NEW**: freeside-cli (federation verbs), apps/mcp-gateway (federation v0.3), freeside-operator-dash (events tracing), `/federation.json`, ordering/kitchen/fulfill order-system verbs.
- **Corrected**: corpse implied a single monolith REST surface; today the surface is split across sietch (Express) + in-repo Hono services + external cells.

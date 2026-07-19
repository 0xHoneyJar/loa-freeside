# API Surface — Ground Truth

> Refreshed 2026-07-19 by /ride. Source: `reality/api-surface.md`. In-repo surfaces only.

## REST — sietch (Express 5)
- **48 route modules → 300+ endpoints** (`themes/sietch/src/api/routes/index.ts`); server `themes/sietch/src/api/server.ts:119-761`. Unchanged this delta (sietch frozen).
- Routers: public, admin, member, billing, badge, boost, component, theme, telegram, verify, internal, internalAgent, agentTba, agentGovernance, velocity, events, governance.
- Highlights: `/api/agents/{health,invoke,stream,models,budget,usage-reports}` + `/.well-known/jwks.json`; `/login|logout|me|refresh|sessions`; users CRUD; `simulation/*` (12); `coexistence/*` (5); billing (crypto).
- Middleware: `requireAuth`, `requireRoles`, `requireApiKey`, `requireDashboardAuth`; helmet CSP; member/webhook rate limiters.

## REST — in-repo services (Hono; 130 raw route registrations)
- **ordering** `bin/{http,worker,fulfillment-orchestrator}.ts` — **24 registrations**, largest in-repo surface; grew through the CR cycle (list/detail projections CR-206, attention receipts + mark-seen CR-305, capability demand lifecycle CR-208, public authorization CR-007A). Registered cell, runtime_state deployed.
- `shadow-audit` `bin/http.ts` (Access-Risk Audit) — 8 · `shadow-mode` `src/index.ts` — 6 · `mcp-gateway` `bin/http.ts` — 9 · `freeside-operator-dash` — 4 · `freeside-registry` — HTTP `GET federation.json` manifest.

## Discord — 23 (discord.js)
`themes/sietch/src/discord/commands/`: verify, onboard, agent, buy-credits, threshold, water-share, directory, leaderboard, naib, position, profile, register-waitlist, resume, simulation, stats, alerts, badges, admin-migrate, admin-badge, admin-stats, admin-takeover, admin-water-share.

## Telegram — 12 (Grammy)
agent, buy-credits, verify, status, unlink, help, leaderboard, refresh, score, start, alerts. Webhook `POST /telegram/webhook` (`X-Telegram-Bot-Api-Secret-Token` guard); polling in dev.

## CLIs — 2
- **freeside-cli** — `list`, `inspect <slug>`, `doctor [--remote|--acvp]`, `order (place|status|ingredients)`, `kitchen (probe|advance)`, `fulfill (watch)`. Exit codes 0–6.
- **gaib** — `auth` (login/logout/whoami), `sandbox` (list/create/destroy/connect/link/unlink), `user` (create/ls/grant/access/revoke), `server` (init/apply/diff/destroy/export/import/theme/workspace/backup/restore).

## MCP — 2 tenants
codex, score (via `apps/mcp-gateway`; orientation packets from `packages/beacon-schema`).

## Webhooks — 6
`/api/billing/webhook`, `/api/crypto/webhook` (raw-body, NOWPayments/Paddle), `/telegram/webhook`, Discord interactions, x402, Stripe.

## Package bins — 6
`freeside-cli`, `gaib`, `dune-meter`, `events-lint`, `build-beacon-json`, **`check-gate-manifest`** (NEW — collection-report-gates CR-019).

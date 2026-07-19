---
source_type: ai-autogen
use_label: usable
read_state: read
as_of: 2026-07-19
generated_by: /ride reality refresh (delta 9b0f4a12 → b5df718a)
git_sha: b5df718a
---

# Entry Points & Runtime Behaviors — loa-freeside (current)

> Generated 2026-07-19 by /ride (refreshing 2026-07-06 capture). CODE IS TRUTH.

## Entry points
| Component | Entry file | Runtime | How it starts |
|---|---|---|---|
| sietch (incumbent) | `themes/sietch/src/index.ts` | Node/TS (Express 5) | HTTP + Discord + Telegram service (`sietch-service` v6.0.0) |
| worker | `apps/worker/src/main-nats.ts` | Node/TS | 4 NATS consumers (command, event, eligibility, usage) + agent-gateway thread routing + ownership re-verification; fallback on agent-init failure |
| gateway | `apps/gateway/src/main.rs` | Rust (Twilight + tokio) | Discord shard pool → NATS publish; health/metrics endpoints |
| ingestor | `apps/ingestor/src/index.ts` | Node/TS | Discord Gateway → RabbitMQ (zero business logic, SDD §3.2.1) |
| mcp-gateway | `apps/mcp-gateway/bin/http.ts` | Node/TS (Hono) | MCP federation HTTP on `PORT`; unhandled-rejection safety net |
| shadow-audit svc | `packages/services/shadow-audit/bin/http.ts` | Node/TS (Hono) | Access-Risk Audit API |
| ordering svc | `packages/services/ordering/bin/{http,worker,fulfillment-orchestrator}.ts` | Node/TS | Order intake + orchestrator |
| gaib CLI | `packages/cli/bin/gaib.ts` | Node/TS (Commander) | IaC orchestration |
| freeside-cli | `packages/freeside-cli/bin/freeside-cli.ts` | Node/TS | Federation verbs |
| check-gate-manifest | `packages/collection-report-gates/bin/` (bin `check-gate-manifest`) | Node/TS | **NEW (CR-019)** deterministic release-gate manifest validator |

## Config & env
- Canonical Zod schema `themes/sietch/src/config.ts` (~1850 lines). Cold-restart strategy: config validated at module load; drift → process refuses to boot.
- Env vars: 100+ unique (Zod-validated). Key classes: provider keys (`DUNE_SIM_API_KEY`, AI provider keys, `MIDI/HUB/API/ADMIN_API_KEY` for score), secrets (`JWT_SECRET`, `IDENTITY_API_JWT_SECRET` — MUST byte-equal identity's), infra (`DATABASE_URL`, `REDIS_URL`, NATS/RabbitMQ URLs), `CHAIN_PROVIDER` (rpc|dune_sim|hybrid).

## Scheduled / cron
- **9 Trigger.dev** scheduled tasks.
- BullMQ / queue jobs; registry `expectations[]` cadence ledger (probe kinds http | graphql-lag | event-max-age).
- **40 GitHub Actions** workflows (`.github/workflows/`): ci, cluster-compliance, security-audit, deploy-staging/production, e2e-billing, post-merge, secret-scanning, container-security, …

## Event handlers
- NATS JetStream consumers (worker: command/event/eligibility/usage); ACVP-enveloped events verified before routing (`@0xhoneyjar/events` — JCS + Ed25519).
- RabbitMQ (ingestor path, legacy/coexistence).
- Discord event handlers (sietch + worker); webhook handlers (billing/crypto/telegram).

## Feature flags
9 feature flags defined in `themes/sietch/src/config.ts` (Zod). Read at boot; gate coexistence/shadow modes and product features.

# Behaviors — Ground Truth

> Refreshed 2026-07-19 by /ride. Source: `reality/entry-points.md`, `reality/architecture-overview.md`.

## Scheduled / cron
- **9 Trigger.dev** scheduled tasks; BullMQ / queue jobs.
- Registry `expectations[]` cadence ledger (probe kinds: http | graphql-lag [sonar chain-lag] | event-max-age).
- **40 GitHub Actions** workflows: ci, cluster-compliance, security-audit, deploy-staging/production, e2e-billing, post-merge, secret-scanning, container-security.

## Event handlers
- **NATS JetStream** (worker `main-nats.ts`): 4 consumers — command, event, eligibility, usage — + agent-gateway routing + ownership re-verification; fallback on agent-init failure.
- **RabbitMQ** (ingestor path, coexistence/legacy).
- Cross-cell events verified before routing (`@0xhoneyjar/events`: JCS + Ed25519). Trust-envelope stream sequencing: sequence_gap does NOT skip or poison event_id (fix 0791a090).
- **ordering** runs durable state + idempotency + outbox via `bin/worker.ts` + `bin/fulfillment-orchestrator.ts`.
- Discord + Telegram + webhook handlers (sietch).

## Feature flags
9 flags in `themes/sietch/src/config.ts` (Zod), read at boot — gate coexistence/shadow modes + product features. Cold-restart: bad config → refuse to boot.

## Multi-tenancy / RLS
Every PostgreSQL tenant table scoped by `community_id`; RLS `= app.current_community_id()`; tenant-context guard migration `0008`. Coexistence mode runs shadow/parallel/full verification tiers with divergence tracking (`coexistence.routes.ts`: status/mode/rollback/divergences/emergency-backup).

## Cluster auth (cross-cell) — 3 real + 1 ghost
- **activities-api** ← HS256 Bearer minted by identity-api, verified offline (HMAC with `IDENTITY_API_JWT_SECRET` which MUST byte-equal identity's `JWT_SECRET`). Drift → silent cluster-wide `bad_signature` 401s (**no CI canary — gap**).
- **score-api** ← static API key (no expiry; leak is permanent).
- **sonar-api** ← none.
- **ghost**: identity ES256 `/v1/auth/service-jwt` unused; JWKS 404s.

## Deployment state (registry read 2026-07-19; live probe 2026-06-19)
Registry declares 7 deployed: sonar, score, storage, identity, inventory, activities, **ordering** (in-repo cell, newly registered). Scaffolded: mint, ledger. Not-built: mediums, events. Last live probe (06-19): inventory 401 auth-gated, mint routeless 404, ledger not deployed; **all beacon subdomains 404** (DNS not pointed + routes unshipped). Re-probe: `freeside-cli doctor --remote`.

## Budget / agent
Redis Lua atomic budget reservation (ADR-001); ensemble routing via `POOL_PROVIDER_HINTS`; BYOK egress isolation; per-model accounting; capability audit events.

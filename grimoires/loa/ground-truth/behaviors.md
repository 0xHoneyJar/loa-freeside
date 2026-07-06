# Behaviors — Ground Truth

> Refreshed 2026-07-06 by /ride. Source: `reality/entry-points.md`, `reality/architecture-overview.md`.

## Scheduled / cron
- **9 Trigger.dev** scheduled tasks.
- Registry `expectations[]` cadence ledger (probe kinds: http | graphql-lag [sonar chain-lag] | event-max-age).
- **39 GitHub Actions** workflows: ci, cluster-compliance, security-audit, deploy-staging/production, e2e-billing, post-merge, secret-scanning, container-security.

## Event handlers
- **NATS JetStream** (worker `main-nats.ts`): 4 consumers — command, event, eligibility, usage — + agent-gateway routing + ownership re-verification.
- **RabbitMQ** (ingestor path, coexistence/legacy).
- Cross-cell events verified before routing (`@0xhoneyjar/events`: JCS + Ed25519).
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

## Deployment state (probe 2026-06-19)
Deployed: sonar (+belt-gateway), score, storage, identity, inventory (401 auth-gated), activities. Scaffolded: mint (routeless 404), ledger (not deployed). Not-built runtime: mediums (npm lib), events (in-repo lib). **All beacon subdomains 404** (DNS not pointed + routes unshipped).

## Budget / agent
Redis Lua atomic budget reservation (ADR-001); ensemble routing via `POOL_PROVIDER_HINTS`; BYOK egress isolation; per-model accounting; capability audit events.

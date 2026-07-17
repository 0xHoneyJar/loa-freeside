---
source_type: ai-autogen
use_label: usable
read_state: read
as_of: 2026-07-06
generated_by: /ride reality+ground-truth refresh (supersedes 2026-05-18 CORPSE)
---

# Architecture Overview — loa-freeside (current)

> Generated 2026-07-06 by /ride. Evolution since the 2026-05-18 corpse: the platform split into a
> **hexagonal federation** — most product logic extracted into external `*-api` cells governed by an
> in-repo L1 registry; `themes/sietch` remains as the incumbent monolith.

## Two mental models

### WHO × WHAT (product frame, `context/freeside-mental-model.md`)
- **WHO** is a stack: `PERSON` (authenticates — identity-api / SIWE / wallet-group) → `ACCOUNT` (per-world spine, graduates to ERC-6551 TBA) → `INVENTORY` (badges/roles/items bind to the account).
- **WHAT** is a layered building stack (raw → composed):
  - L0 RAW — **sonar** (on-chain truth: holders/transfers/distribution)
  - L1 DERIVED — **score** (member value: scores/tiers/rave-families)
  - L2 GRAPH — **shadow-mode** (member-graph spine, #316 — `packages/services/shadow-mode`)
  - L3 PRODUCT — **shadow-audit** (Access-Risk Audit — `packages/services/shadow-audit`)
- World = a deployed instance (e.g. "Mibera"); CM = a person wearing the admin hat.

### Hexagonal federation (system frame, ADR-007/009)
```
                 freeside-cli doctor / mcp-gateway (discovery + orientation)
                                    │  reads
              ┌─────────────────────▼──────────────────────┐
              │  L1 REGISTRY  packages/freeside-registry/    │
              │  registry.yaml  → BeaconV3 identities        │
              └──────────┬───────────────────┬──────────────┘
        external cells   │                   │   in-repo services
   ┌─────────────────────▼──┐        ┌───────▼───────────────────────┐
   │ sonar/score/storage/    │        │ services/shadow-mode (L2)      │
   │ identity/activities/    │        │ services/shadow-audit (L3)     │
   │ inventory/mint/mediums  │        │ services/ordering (order system)│
   │ (github.com/0xHoneyJar) │        └───────┬───────────────────────┘
   └─────────────────────────┘                │ uses
                                     ┌─────────▼──────────┐
   incumbent monolith               │ packages/adapters  │ (chain/storage/agent/…)
   ┌──────────────────────┐         └─────────┬──────────┘
   │ themes/sietch v6.0.0  │                   ▼
   │ (Discord + web + REST)│         ┌────────────────────┐
   └──────────┬───────────┘         │ packages/core ports │ (DDD hexagonal)
              │                      └────────────────────┘
   apps/gateway(Rust)→NATS→apps/worker ; apps/ingestor→RabbitMQ ; apps/mcp-gateway(Hono)
```

## Governance & discovery layer (NEW since corpse)
- **BeaconV3** (`packages/beacon-schema/src/beacon-v3.ts`) — identity-first building beacons: `slug`, `publisher`, `is` (one_liner + scope 2–7), `is_not` (≥2, "Does NOT…"), `cycle_state`, `composes_with` (`Tag@semver+hash`), `acvp_invariants`, `sealed_schemas` (path + sha256-of-JCS).
- **freeside-cli doctor** (`packages/freeside-cli/src/verbs/doctor.ts`) — audits every cell: beacon resolve (fixture-first; `--remote` live probe with host-integrity guard), V3 validation, cycle freshness (180d), composes_with sibling/tag-hash check, sealed-schema sha256 recompute, ACVP bindings.
- **ADR-012 health contract** — per-cell `service` block (health_path/expected_status/auth_class/marker/probed_at) + `expectations[]` cadence ledger (http | graphql-lag | event-max-age).
- **governance-doctor.sh** — stale-artifact immune system (quarantined the old reality as CORPSE).
- **@0xhoneyjar/events** — ACVP-enveloped cross-cell events (RFC 8785 JCS + Ed25519 + Hounfour 3-segment topics on NATS JetStream); consumers verify before routing.

## Cluster auth model (tribal — `registry.yaml` header, verified)
NO single cluster token. **3 real mechanisms + 1 ghost**:
- **activities-api** ← HS256 Bearer minted by identity-api, verified OFFLINE (HMAC with `IDENTITY_API_JWT_SECRET` which MUST byte-equal identity's `JWT_SECRET`). Secret drift → silent cluster-wide `bad_signature` 401s.
- **score-api** ← STATIC API key (no expiry — a leak is permanent).
- **sonar-api** ← none.
- **ghost**: identity `/v1/auth/service-jwt` ES256 svc-JWT — `/.well-known/jwks.json` 404s; unused.

## Deployment posture (live-probe 2026-06-19)
7 deployed (sonar+belt-gateway, score, storage, identity, inventory[401 auth-gated], activities), 2 scaffolded (mint 404 routeless, ledger not deployed), 2 not-built runtime (mediums npm-lib, events in-repo lib). **All `*.0xhoneyjar.xyz` beacon subdomains still 404** (DNS not pointed + routes unshipped) — the federation-discovery gap.

## Tech stack
TypeScript 5.3–5.7 (strict, ESM) + Rust 2021 · Node ≥22 · Express 5 (sietch) / Hono (services+mcp) / Twilight (gateway) · Drizzle ORM + PostgreSQL + RLS · SQLite (sietch v1) · Redis 7 (Lua atomic) · NATS JetStream (primary) + RabbitMQ (ingestor) + Trigger.dev (cron) · discord.js + Grammy · viem · Effect Schema + Zod + Ajv · Terraform/AWS ECS · Vitest + fast-check.

## Authn posture
ES256 JWT internally (ADR-002, JWKS at `/.well-known/jwks.json`); s2s via `s2s-jwt-validator.ts`; end-user via Discord OAuth + wallet signature. Cluster cells use the 3+1 model above.

## What this is NOT
- Not a single-tenant Discord bot (multi-community, RLS per `community_id`).
- Not one canonical name — **namespace migrated `@arrakis/*` → `@freeside/*`** (0 `@arrakis` refs remain); platform `@freeside/*`, network `@0xhoneyjar/*`, incumbent `sietch-service`.
- Not a pure monolith anymore — it is the registry + incumbent monolith + in-repo services, federating external cells.

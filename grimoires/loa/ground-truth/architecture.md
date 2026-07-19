# Architecture — Ground Truth

> Refreshed 2026-07-19 by /ride. Source: `reality/architecture-overview.md`, `reality/structure.md`.

## Federation (ADR-007 absorption, ADR-009 hexagonal, ADR-012 health contract)
- **L1 registry** `packages/freeside-registry/registry.yaml` is source-of-truth for 11 cells; served over HTTP as the `federation.json` manifest endpoint. Schema/validation `packages/freeside-registry/src/registry.ts` (Effect).
- **8 canonical `*-api` cells** are EXTERNAL repos (`github.com/0xHoneyJar/{sonar,storage,mint,activities,inventory,score,identity,mediums}`). **`ordering` is the first IN-REPO cell registered** (`packages/services/ordering`, runtime_state: deployed).
- **Discovery/orientation**: `freeside-cli doctor` (`packages/freeside-cli/src/verbs/doctor.ts`) + `apps/mcp-gateway`; BeaconV3 identities validated against sealed-schema sha256 + ACVP invariants.
- **Immune system**: `governance-doctor.sh` quarantines stale artifacts; ADR-012 cadence ledger (`expectations[]`).

## Hexagonal layering (in-repo)
`packages/core` **ports** (`IChainProvider`, `IStorageProvider`, `IAgentGateway`) ← `packages/adapters` **implementations** (sonar/score/chain/storage/themes/wizard/synthesis/security/coexistence/agent) ← `packages/services` (shadow-mode, shadow-audit, ordering) + `themes/sietch` monolith + `apps/*` runtimes.

## Protocol-contract layer (4 → 10 packages this delta)
`packages/protocol/` holds ALL versioned wire contracts: shadow-mode, ordering, eligibility, shadow-audit (v0.1.0) + six NEW v1.0.0 (collection-report cycle): **collection** (cross-VM identity + canonical digest + finality bound), **collection-resolution** (durable confirmation sessions), **dependency-ledger** (CR-012A reverse-dependency inbox/closure/quarantine), **public-authorization** (CR-007A subject-resource-action grants + leases), **signing-key-custody** (CR-013 KMS/HSM custody), **trust-envelope** (CR-009 Ed25519-signed envelopes + stream sequencing). `@freeside/collection-report-gates` (CR-019) makes release-gate evaluation executable (bin `check-gate-manifest`).

## WHO × WHAT product frame
- **WHO** (identity stack): PERSON (auth: identity-api/SIWE) → ACCOUNT (per-world spine → ERC-6551 TBA) → INVENTORY (badges/roles/items).
- **WHAT** (building stack): L0 **sonar** (on-chain raw) → L1 **score** (member value/tiers) → L2 **shadow-mode** (member-graph spine, #316) → L3 **shadow-audit** (Access-Risk Audit product).
- World = deployed instance; CM = person in the admin hat.

## Runtimes & messaging
- `apps/gateway` (Rust, Twilight+tokio) — Discord shards → NATS.
- `apps/worker` (`main-nats.ts`) — 4 NATS consumers (command/event/eligibility/usage) + agent gateway.
- `apps/ingestor` — Discord → RabbitMQ (no business logic).
- `apps/mcp-gateway` (Hono) — MCP federation v0.3.
- `themes/sietch` (Express 5) — incumbent Discord + web + REST; **frozen this delta (2 files / 287 commits)**.
- In-repo services on Hono (shadow-audit, ordering + worker + fulfillment-orchestrator, shadow-mode).
- Cross-cell events: `@0xhoneyjar/events` (RFC 8785 JCS + Ed25519, Hounfour 3-segment topics, NATS JetStream; verify-before-route).

## Auth
ES256 JWT internal (ADR-002, JWKS `/.well-known/jwks.json`); end-user Discord OAuth + wallet signature. Cluster cells: 3 real + 1 ghost (HS256 activities, static-key score, none sonar; ES256 svc-JWT ghost). See behaviors.md.

## Persistence & infra
PostgreSQL + Drizzle + RLS (per `community_id`); SQLite (sietch v1 eligibility); Redis 7 (Lua atomic budget); Terraform/AWS (ECS/RDS/ElastiCache/ALB/EFS/S3/DynamoDB/CloudWatch); Prometheus/Grafana/CloudWatch + Pino.

## Not this
Not a single-tenant bot (multi-community, RLS). Not a pure monolith (federation). Not `@arrakis` (migrated to `@freeside`/`@0xhoneyjar`).

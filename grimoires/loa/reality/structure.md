---
source_type: ai-autogen
use_label: usable
read_state: read
as_of: 2026-07-06
generated_by: /ride reality+ground-truth refresh (supersedes 2026-05-18 CORPSE)
---

# Structure — loa-freeside (current)

> Generated 2026-07-06 by /ride. CODE IS TRUTH. A **dual-concern hexagonal federation** monorepo
> (ADR-007): a vertical platform (`@freeside/*`) + an ecosystem network (`@0xhoneyjar/*`), with a
> workspace firewall (CODEOWNERS + CI scope checks) keeping the two in distinct cycles/beads/grimoires.

## Root

- **Package manager**: `pnpm@9.15.4`; **engines**: node `>=22`. Root `package.json` is private (no name/version).
- **No** root `tsconfig`, `turbo.json`, or `pnpm-workspace.yaml` — workspaces are declared in root `package.json`.
- Framework: `loa-hounfour` git-pinned (postinstall `build:hounfour`).
- TypeScript 5.3–5.7 across the workspace; Vitest 3.2.4 root + per-package configs.

## Workspace (30 package.json; 18 `@freeside/*` + 3 `@0xhoneyjar/*` + sietch + protocols)

### packages/ — platform + network libraries
| Dir | npm name | Purpose |
|---|---|---|
| core | `@freeside/core` | DDD hexagonal **ports** — `IChainProvider`, `IStorageProvider`, `IAgentGateway` (`packages/core/ports/`) |
| adapters | `@freeside/adapters` | 10 submodules: sonar, score, chain, storage, themes, wizard, synthesis, security, coexistence, agent |
| cli | `@freeside/cli` | `gaib` IaC orchestrator (login/sandbox/server) — bin `dist/bin/gaib.js` |
| sandbox | `@freeside/sandbox` | Discord Server Sandboxes (drizzle+pg provisioning, NATS/Redis) |
| freeside-cli | `@freeside/freeside-cli` | Ecosystem CLI `loa freeside <verb>` — list/inspect/doctor/order/kitchen/fulfill |
| freeside-registry | `@freeside/freeside-registry` | Beacon aggregator + federation manifest server; L1 truth `registry.yaml`; `/federation.json`; Effect schema |
| beacon-schema | `@freeside/beacon-schema` v0.2.0 | Sealed Effect Schema for Beacon V2/V3; bin `build-beacon-json` |
| shared/nats-schemas | `@freeside/nats-schemas` | Shared Zod wire format (Rust gateway ↔ TS workers) |
| events | `@0xhoneyjar/events` | ACVP-enveloped cross-cell event substrate (RFC 8785 JCS + Ed25519 + Hounfour topics, NATS JetStream) |
| dune-meter | `@freeside/dune-meter` | Cost-aware Dune Sim adapter/meter |
| eligibility-protocol | `@freeside/eligibility-protocol` | Eligibility verdict schemas (Zod) |
| protocol/shadow-mode | `@freeside/shadow-mode-protocol` | Shadow-ledger schemas (collection/identity/jcs/topics/events/divergence) |
| protocol/ordering | `@freeside/ordering-protocol` | Order-system contracts |
| services/shadow-audit | `@freeside/shadow-audit-service` | Shadow Access **Audit** (hono; ports) — the L3 product |
| services/shadow-mode | `@freeside/shadow-mode-service` | Shadow-ledger service (the L2 member-graph spine, #316) |
| services/ordering | `@freeside/ordering-service` | Order intake/orchestrator (durable state, idempotency, outbox); bins http/worker/fulfillment-orchestrator |
| shadow-audit-protocol | `@freeside/shadow-audit-protocol` | Audit contracts |
| routes, asson, gaib-cli | (see dir) | route library, asson, gaib-cli helpers |

### apps/ — runtimes
| Dir | npm name | Runtime | Entry |
|---|---|---|---|
| gateway | (Rust `arrakis-gateway`) | Rust (Twilight + tokio) | `apps/gateway/src/main.rs` — Discord shard pool → NATS |
| worker | `@freeside/worker` | Node/TS | `apps/worker/src/main-nats.ts` — 4 NATS consumers + agent gateway |
| ingestor | `@freeside/ingestor` | Node/TS | `apps/ingestor/src/index.ts` — Discord Gateway → RabbitMQ (zero business logic) |
| mcp-gateway | `@0xhoneyjar/freeside-mcp-gateway` | Node/TS (Hono) | `apps/mcp-gateway/bin/http.ts` — MCP federation v0.3 |
| freeside-operator-dash | `@0xhoneyjar/freeside-operator-dash` | Node/TS | operator dashboard (events tracing) |

### themes/
- `themes/sietch` — **`sietch-service` v6.0.0**, the remaining monolith (Discord service + web dashboard). Entry `themes/sietch/src/index.ts`. Dual persistence: legacy SQLite (`src/db/`) + PostgreSQL (Drizzle).
- `themes/packages/*` — theme services.

## Federation (external cells — registry.yaml, NOT in this repo)
8 canonical `*-api` cells extracted to external `github.com/0xHoneyJar/*` repos: sonar, storage, mint, activities, inventory, score, identity, mediums (`freeside-mediums`). Plus ledger-api (external, not deployed). `events-api` + `mint-api` have in-repo components (git_url → loa-freeside). See `../decisions/009-freeside-hexagonal-federation.md`, `packages/freeside-registry/registry.yaml`.

## Other top-level
- `decisions/` (repo root) — federation ADRs (007 absorption, 009 hexagonal, 012 health contract). `grimoires/loa/decisions/` — billing ADRs 008–015.
- `infrastructure/` — Terraform (AWS ECS/RDS/ElastiCache/ALB/EFS/S3/DynamoDB/CloudWatch).
- `.github/workflows/` — 39 workflows (ci, cluster-compliance, security-audit, deploy-*, e2e-billing, post-merge, secret-scanning, container-security).
- `tools/`, `scripts/`, `evals/`, `sites/`, `tests/`.

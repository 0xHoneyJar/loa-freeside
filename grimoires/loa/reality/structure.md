---
source_type: ai-autogen
use_label: usable
read_state: read
as_of: 2026-07-19
generated_by: /ride reality refresh (delta 9b0f4a12 → b5df718a, 287 commits)
git_sha: b5df718a
---

# Structure — loa-freeside (current)

> Generated 2026-07-19 by /ride. CODE IS TRUTH. A **dual-concern hexagonal federation** monorepo
> (ADR-007): a vertical platform (`@freeside/*`) + an ecosystem network (`@0xhoneyjar/*`), with a
> workspace firewall (CODEOWNERS + CI scope checks) keeping the two in distinct cycles/beads/grimoires.

## Root

- **Package manager**: `pnpm@9.15.4`; **engines**: node `>=22`. Root `package.json` is private (no name/version).
- **No** root `tsconfig`, `turbo.json`, or `pnpm-workspace.yaml` — workspaces are declared in root `package.json`.
- Framework: `loa-hounfour` git-pinned (postinstall `build:hounfour`). Loa framework 1.196.0 (synced 2026-07-19).
- TypeScript 5.3–5.7 across the workspace; Vitest 3.2.4 root + per-package configs.

## Workspace (30 package.json: 25 `@freeside/*` + 3 `@0xhoneyjar/*` + sietch-service + sietch dashboard; + 1 Rust crate)

### packages/ — platform + network libraries
| Dir | npm name | Purpose |
|---|---|---|
| core | `@freeside/core` | DDD hexagonal **ports** — `IChainProvider`, `IStorageProvider`, `IAgentGateway` (`packages/core/ports/`) |
| adapters | `@freeside/adapters` | 10 submodules: sonar, score, chain, storage, themes, wizard, synthesis, security, coexistence, agent |
| cli | `@freeside/cli` | `gaib` IaC orchestrator (login/sandbox/server) — bin `dist/bin/gaib.js` |
| sandbox | `@freeside/sandbox` | Discord Server Sandboxes (drizzle+pg provisioning, NATS/Redis) |
| freeside-cli | `@freeside/freeside-cli` | Ecosystem CLI `loa freeside <verb>` — list/inspect/doctor/order/kitchen/fulfill |
| freeside-registry | `@freeside/freeside-registry` | Beacon aggregator + federation manifest server; L1 truth `registry.yaml`; serves HTTP `GET /federation.json`; Effect schema |
| beacon-schema | `@freeside/beacon-schema` v0.2.0 | Sealed Effect Schema for Beacon V2/V3; bin `build-beacon-json` |
| shared/nats-schemas | `@freeside/nats-schemas` | Shared Zod wire format (Rust gateway ↔ TS workers) |
| events | `@0xhoneyjar/events` | ACVP-enveloped cross-cell event substrate (RFC 8785 JCS + Ed25519 + Hounfour topics, NATS JetStream); bin `events-lint` |
| dune-meter | `@freeside/dune-meter` | Cost-aware Dune Sim adapter/meter; bin `dune-meter` |
| collection-report-gates | `@freeside/collection-report-gates` v0.1.0 | **NEW (CR-019)** machine-readable release-gate manifest + deterministic validator; bin `check-gate-manifest` |
| routes, asson, gaib-cli | (no package.json — source dirs) | route library, asson, gaib-cli helpers |

### packages/protocol/ — versioned wire-contract packages (4 → **10** since 2026-07-06)
| Dir | npm name | Purpose |
|---|---|---|
| shadow-mode | `@freeside/shadow-mode-protocol` v0.1.0 | Shadow-ledger schemas (collection/identity/jcs/topics/events/divergence) |
| ordering | `@freeside/ordering-protocol` v0.1.0 | Generic Order envelope + lifecycle events + Preset schemas (product-agnostic) |
| eligibility | `@freeside/eligibility-protocol` v0.1.0 | Sealed EligibilityRule noun + EligibilityVerdict |
| shadow-audit | `@freeside/shadow-audit-protocol` v0.1.0 | Sealed Zod schemas + deterministic inputs_hash (Shadow Access Audit) |
| collection | `@freeside/collection-protocol` v1.0.0 | **NEW** cross-VM collection identity, capability-version, canonical digest, finality-bound wire contract |
| collection-resolution | `@freeside/collection-resolution-protocol` v1.0.0 | **NEW** durable collection-resolution + stale-selection contracts (Ordering-owned confirmation sessions) |
| dependency-ledger | `@freeside/dependency-ledger-protocol` v1.0.0 | **NEW (CR-012A)** Ordering reverse-dependency ledger, inbox closure, quarantine, reconciliation |
| public-authorization | `@freeside/public-authorization-protocol` v1.0.0 | **NEW (CR-007A)** subject-resource-action authorization, grant projection watermarks, short-lived leases |
| signing-key-custody | `@freeside/signing-key-custody-protocol` v1.0.0 | **NEW (CR-013)** KMS/HSM signing-key custody; pinned registry distribution; fixture vs production class separation |
| trust-envelope | `@freeside/trust-envelope-protocol` v1.0.0 | **NEW (CR-009)** signed trust-envelope wire contract, Ed25519 verification, stream sequencing |

### packages/services/ — in-repo service runtimes
| Dir | npm name | Purpose |
|---|---|---|
| shadow-audit | `@freeside/shadow-audit-service` | Shadow Access **Audit** (hono; ports) — the L3 product |
| shadow-mode | `@freeside/shadow-mode-service` | Shadow-ledger service (the L2 member-graph spine, #316) |
| ordering | `@freeside/ordering-service` | Order intake/orchestrator (durable state, idempotency, outbox); bins http/worker/fulfillment-orchestrator. **Registered in registry.yaml as `ordering`, runtime_state: deployed.** Heavy CR-cycle growth: shared preparation persistence (CR-201A), atomic admission capacity reservation (CR-201C), Ordering→Sonar prep adapter (CR-204A), list/detail projections (CR-206), capability demand lifecycle (CR-208), attention receipts (CR-305), public authorization (CR-007A) |
| (root `.ts` files) | — | **billing/economics logic loose at `packages/services/*.ts`** (credit-lot, governance-*, velocity-*, x402-settlement, nowpayments-handler, conservation-guard, …) — extraction target per ADR-008 (`freeside-billing`), see claims-to-verify D-2 |

### apps/ — runtimes
| Dir | npm name | Runtime | Entry |
|---|---|---|---|
| gateway | (Rust `arrakis-gateway`) | Rust (Twilight + tokio) | `apps/gateway/src/main.rs` — Discord shard pool → NATS |
| worker | `@freeside/worker` | Node/TS | `apps/worker/src/main-nats.ts` — 4 NATS consumers + agent gateway |
| ingestor | `@freeside/ingestor` | Node/TS | `apps/ingestor/src/index.ts` — Discord Gateway → RabbitMQ (zero business logic) |
| mcp-gateway | `@0xhoneyjar/freeside-mcp-gateway` | Node/TS (Hono) | `apps/mcp-gateway/bin/http.ts` — MCP federation v0.3 |
| freeside-operator-dash | `@0xhoneyjar/freeside-operator-dash` | Node/TS | operator dashboard (events tracing) |

### themes/
- `themes/sietch` — **`sietch-service` v6.0.0**, the remaining monolith (Discord service + web dashboard). Entry `themes/sietch/src/index.ts`. Dual persistence: legacy SQLite (`src/db/`) + PostgreSQL (Drizzle). **Only 2 files changed in the 287-commit delta — effectively frozen while extraction work happens around it.**
- `themes/packages/*` — theme services.

### tools/ — repo tooling (NEW growth this delta)
`system-component.mjs` (+tests), `markdown-text.mjs`, `flow-moment` tests, `stage-tier-benchmark.sh`, domain-classify + beacon-domain check libs.

## Federation (external cells — registry.yaml, NOT in this repo)
11 cells registered in `packages/freeside-registry/registry.yaml`: **7 deployed** (sonar-api, score-api, storage-api, identity-api, inventory-api, activities-api, **ordering** ← in-repo cell, newly registered), **2 scaffolded** (ledger-api, mint-api), **2 not-built** (events-api, mediums-api). 8 canonical `*-api` cells live as external `github.com/0xHoneyJar/*` repos. See `../decisions/009-freeside-hexagonal-federation.md`.

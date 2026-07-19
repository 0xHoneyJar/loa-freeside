---
source_type: ai-autogen
use_label: usable
read_state: read
as_of: 2026-07-19
generated_by: /ride reality refresh (delta 9b0f4a12 → b5df718a, 287 commits)
git_sha: b5df718a
supersedes:
  previous_generated_at: 2026-07-06
  previous_status: valid but stale (13 days, 287 commits behind)
note: >-
  Refreshed to current federation truth. For LIVE cell runtime state, still probe
  packages/freeside-registry/registry.yaml + `freeside-cli doctor --remote`.
---

# loa-freeside Reality Index

> Generated 2026-07-19 by /ride | Branch: coord/collection-report-coordinator-f09.30 | HEAD b5df718a
> Token-optimized routing hub. A **dual-concern hexagonal federation** (ADR-007/009).

## Stats (current)

- **Workspace packages**: 30 package.json — **25 `@freeside/*`** (platform) + **3 `@0xhoneyjar/*`** (network) + `sietch-service` (+dashboard); + 1 Rust crate (`arrakis-gateway`)
- **Protocol packages**: **10** under `packages/protocol/` (was 4 on 2026-07-06) — NEW: collection, collection-resolution, dependency-ledger (CR-012A), public-authorization (CR-007A), signing-key-custody (CR-013), trust-envelope (CR-009), all v1.0.0
- **NEW package**: `@freeside/collection-report-gates` (CR-019 gate-manifest validator, bin `check-gate-manifest`)
- **Apps**: 5 — gateway (Rust `arrakis-gateway`), worker, ingestor, mcp-gateway, freeside-operator-dash
- **Incumbent monolith**: `themes/sietch` `sietch-service` v6.0.0 — **frozen this delta (2 files changed / 287 commits)**
- **Federation cells**: 11 registered (`packages/freeside-registry/registry.yaml`); **7 deployed / 2 scaffolded / 2 not-built**; `ordering` (in-repo) newly registered as deployed
- **REST**: 48 route modules → 300+ endpoints (sietch Express 5) + 130 raw route registrations across Hono services (ordering 24, shadow-audit 8, shadow-mode 6, mcp-gateway 9, operator-dash 4)
- **Discord**: 23 commands · **Telegram**: 12 (Grammy) · **CLIs**: 2 (freeside-cli 6 verbs, gaib 4 groups) · **MCP**: 2 tenants
- **DB**: PostgreSQL Drizzle RLS (`packages/adapters/storage/schema.ts` 9 tables + `themes/sietch/src/db/pg-schema.ts` 10 pgTable) + 8 legacy SQLite; migrations: 68 TS + 19 SQL (unchanged this delta)
- **Env vars**: 334 unique `process.env.*` refs (Zod-validated core in `themes/sietch/src/config.ts` ~1850 lines) · **Feature flags**: 9
- **Scheduled**: 9 Trigger.dev tasks · **CI**: **40** GitHub Actions workflows
- **Tests**: **620** test/spec files (Vitest 3.2.4 + fast-check; excludes .claude/grimoires) · **Debt**: 85 markers (43 TODO, 28 `@ts-nocheck`)
- **ADRs**: root `decisions/` (federation 007/009/012) + `grimoires/loa/decisions/` (billing 008–015)
- **Semver**: 369 tags, latest `v7.77.0`; CODEOWNERS at `.github/CODEOWNERS`

## Spokes

| Surface | File | Status |
|---|---|---|
| Structure & workspace | [structure.md](structure.md) | Refreshed 2026-07-19 |
| Architecture overview | [architecture-overview.md](architecture-overview.md) | Refreshed 2026-07-19 |
| API & command surface | [api-surface.md](api-surface.md) | Refreshed 2026-07-19 |
| Entry points & runtime | [entry-points.md](entry-points.md) | Refreshed 2026-07-19 |
| Types & contracts | [types.md](types.md) | Refreshed 2026-07-19 |
| Hygiene report | [hygiene-report.md](hygiene-report.md) | Refreshed 2026-07-19 |
| Hub-thinning verdicts | [hub-thinning-verdicts.md](hub-thinning-verdicts.md) | 2026-07-17 scoped ride (preserved) |
| Raw extractions | api-routes.txt · data-models.txt · env-vars.txt · tech-debt.txt · test-files.txt | Regenerated 2026-07-19 |
| Legacy spokes (Feb–May) | api.md · services.md · database.md · commands.md · environment.md · triggers.md · interfaces.md | Preserved, NOT regenerated — trust types.md/api-surface.md over these |

## Delta highlights (2026-07-06 → 2026-07-19)

1. **Collection-report cycle (CR-xxx)** dominates: 6 new v1.0.0 protocol packages + collection-report-gates + major ordering-service growth.
2. **Ordering is now a registry cell** (`runtime_state: deployed`) — first in-repo service registered alongside external `*-api` cells.
3. **Protocol consolidation**: all wire contracts now under `packages/protocol/` (eligibility + shadow-audit protocols moved in).
4. Loa framework 1.180.0 → 1.196.0; `.claude/aleph/` bundle-ingestion subsystem active (System Zone).
5. sietch, DB schemas, Discord/Telegram surfaces: unchanged.

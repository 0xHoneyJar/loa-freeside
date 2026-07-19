---
source_type: ai-autogen
use_label: usable
read_state: read
as_of: 2026-07-19
generated_by: /ride reality refresh (delta 9b0f4a12 → b5df718a)
git_sha: b5df718a
---

# Types, Data Models & Contracts — loa-freeside (current)

> Generated 2026-07-19 by /ride (refreshing 2026-07-06 capture). CODE IS TRUTH. Dual-persistence: legacy SQLite (sietch v1) + PostgreSQL (Drizzle, current).

## PostgreSQL — Drizzle (multi-tenant, RLS)
`packages/adapters/storage/schema.ts:50-476` — **9 tables**, all tenant-scoped via FK to `communities.id`; RLS enforces `community_id = app.current_community_id()`:
- `communities`, `profiles`, `badges`, `creditLots`, `lotEntries`, `usageEvents`, `webhookEvents`, `cryptoPayments`, `reconciliationCursor`, `s2sJwksPublicKeys`
- Inferred TS types per table (`DrizzleProfile`, `DrizzleNewProfile`, …). Relations: `profiles→badges` (self-ref `awarded_by` for Water-Sharer lineage); `creditLots→lotEntries` (1:many).
- Migrations: `themes/sietch/drizzle/migrations/` — **19 SQL** (`0000_swift_sleeper.sql` → `0018_admin_audit_log.sql`). Notables: `0001_rls_policies.sql`, `0008_tenant_context_guard.sql`, `0009_credit_lots_lot_entries.sql`, `0011_usage_events_pg.sql`, `0017_economic_policies.sql`.

## SQLite — legacy v1 (eligibility)
`themes/sietch/src/db/schema.ts:1-300` — **8 tables**: `eligibility_snapshots`, `current_eligibility`, `admin_overrides`, `audit_log`, `health_status`, `wallet_mappings`, `cached_claim_events`, `cached_burn_events`. CHECK `role IN ('naib','fedaykin','none')`. No RLS.
- Migrations: `themes/sietch/src/db/migrations/` — **68 TS** (`001_initial.ts` → `068_micro_usd_parse_failures.ts`). Notables: `006_tier_system.ts` (9-tier), `007_water_sharer.ts`, `009_billing.ts`, `030_credit_ledger.ts`. Cold-restart config strategy (cycle-040 FR-4).

## Domain ports (DDD hexagonal — `packages/core/ports/`)
- `agent-gateway.ts` — `AccessLevel: 'free'|'pro'|'enterprise'`, `tier: 1..9`, `ModelAlias`, JWT config
- `chain-provider.ts` — `Tier1Methods` (direct RPC), `Tier2Methods` (Score Service gRPC), `ChainConfig`, `ActionHistoryConfig`
- `feature-gate.ts` — `VerificationTier: 'incumbent_only'|'arrakis_basic'|'arrakis_full'`, `Feature` discriminated union, `FeatureAccessResult`, `FeatureAccessDeniedError`
- `storage-provider.ts` — `SubscriptionTier`, `Profile` (tier/rank/wallet/badges), `Community` (`settings` jsonb), `PaginatedResult`
- `theme-provider.ts` — `TierConfig` (minRank/maxRank/roleColor/permissions), `BadgeConfig` (evaluators: tenure|tier_reached|activity|manual), `NamingConfig`
- `shadow-sync.ts` — `CommunityVerificationStatus`, `TierUpgradeRequirements`

## Tier systems
- **9-tier membership** progression (hajra → naib) — `themes/sietch/src/db/migrations/006_tier_system.ts`.
- **3-tier verification**: shadow / parallel / full ≡ `incumbent_only` / `arrakis_basic` / `arrakis_full` (`feature-gate.ts`).

## Federation / protocol contracts (Effect + Zod)
- **registry schema** `packages/freeside-registry/src/registry.ts` — `ModuleEntry` (git_url, beacon_url NullOr, deployment_url, visibility public|unlisted|internal, runtime_state), `ServiceBlock` (ADR-012: deployment_url, health_path, expected_status, auth_class none|static-key, expected_body_marker, probed_at, probe_source), `Expectations[]` (discriminated by probe_kind: http|graphql-lag|event-max-age). Filters: service.deployment_url must equal entry deployment_url; target-less http expectation requires a service block.
- **BeaconV3** `packages/beacon-schema/src/beacon-v3.ts` — identity schema (slug, publisher, is/is_not, cycle_state, composes_with, acvp_invariants, sealed_schemas sha256-of-JCS).
- **shadow-mode protocol** `packages/protocol/shadow-mode/src/schemas/` — eligibility verdict (status/source/tier/score), subject/collection-entity (JCS canonical), divergence (`match|freeside_higher|incumbent_higher|mismatch`).
- **NEW v1.0.0 protocol packages (collection-report cycle, 2026-07-06 → 07-19)** under `packages/protocol/`:
  - `collection/` — cross-VM collection identity, capability-version, canonical digest, finality-bound wire contract
  - `collection-resolution/` — durable collection-resolution + stale-selection contracts (Ordering-owned confirmation sessions)
  - `dependency-ledger/` — CR-012A reverse-dependency ledger, inbox closure, quarantine, reconciliation
  - `public-authorization/` — CR-007A subject-resource-action authorization, grant projection watermarks, short-lived leases
  - `signing-key-custody/` — CR-013 KMS/HSM signing-key custody; pinned registry distribution; fixture vs production class separation
  - `trust-envelope/` — CR-009 Ed25519-signed trust-envelope wire contract + stream sequencing (sequence_gap does NOT skip or poison event_id — fix 0791a090)
- **collection-report-gates** `packages/collection-report-gates/` — CR-019 machine-readable release-gate manifest + deterministic validator (`manifest/`, `test-vectors/`).
- **events** `@0xhoneyjar/events` — envelope/jcs/signer/topics; schemas: nft-mint-detected, nft-activity, registry.
- **nats-schemas** `@freeside/nats-schemas` — event-data, gateway-event, interaction-payload, usage-finalized (Rust↔TS wire).

## Config
Canonical env/config Zod schema: `themes/sietch/src/config.ts` (**~1850 lines**) — all env validation, feature flags, secrets; cold-restart strategy (validates at module load).

# Contracts — Ground Truth

> Refreshed 2026-07-06 by /ride. Source: `reality/data-models.md`.

## PostgreSQL (Drizzle, multi-tenant RLS)
`packages/adapters/storage/schema.ts:50-476` — **9 tables**: communities, profiles, badges, creditLots, lotEntries, usageEvents, webhookEvents, cryptoPayments, reconciliationCursor, s2sJwksPublicKeys. All FK → `communities.id`; RLS `community_id = app.current_community_id()`. Relations: profiles→badges (self-ref `awarded_by`); creditLots→lotEntries (1:many). Migrations `themes/sietch/drizzle/migrations/` — 19 SQL (latest `0018_admin_audit_log.sql`; `0001_rls_policies`, `0008_tenant_context_guard`).

## SQLite (legacy v1)
`themes/sietch/src/db/schema.ts:1-300` — **8 tables**: eligibility_snapshots, current_eligibility, admin_overrides, audit_log, health_status, wallet_mappings, cached_claim_events, cached_burn_events. CHECK `role IN ('naib','fedaykin','none')`. Migrations `src/db/migrations/` — 68 TS (latest `068_micro_usd_parse_failures.ts`).

## Domain ports (`packages/core/ports/`)
- `agent-gateway.ts`: `AccessLevel free|pro|enterprise`, `tier 1..9`, `ModelAlias`.
- `chain-provider.ts`: `Tier1Methods` (RPC), `Tier2Methods` (Score gRPC), `ChainConfig`.
- `feature-gate.ts`: `VerificationTier incumbent_only|arrakis_basic|arrakis_full`, `Feature` union.
- `storage-provider.ts`: `Profile` (tier/rank/wallet/badges), `Community` (`settings` jsonb).
- `theme-provider.ts`: `TierConfig`, `BadgeConfig` (tenure|tier_reached|activity|manual), `NamingConfig`.
- `shadow-sync.ts`: `CommunityVerificationStatus`, `TierUpgradeRequirements`.

## Tier systems
9-tier membership (hajra→naib, `006_tier_system.ts`); 3-tier verification (shadow/parallel/full ≡ incumbent_only/arrakis_basic/arrakis_full).

## Federation & event schemas (Effect + Zod)
- **registry** `packages/freeside-registry/src/registry.ts`: `ModuleEntry` (git_url, beacon_url, deployment_url, visibility, runtime_state), `ServiceBlock` (health_path/expected_status/auth_class/marker/probed_at, ADR-012), `Expectations[]` (http|graphql-lag|event-max-age).
- **BeaconV3** `packages/beacon-schema/src/beacon-v3.ts`: slug, publisher, is/is_not, cycle_state, composes_with (`Tag@semver+hash`), acvp_invariants, sealed_schemas (sha256-of-JCS).
- **shadow-mode** `packages/protocol/shadow-mode/src/schemas/`: eligibility verdict (status/source/tier/score), divergence (match|freeside_higher|incumbent_higher|mismatch).
- **events** `@0xhoneyjar/events`: envelope/jcs/signer/topics; nft-mint-detected, nft-activity, registry.
- **nats-schemas** `@freeside/nats-schemas`: event-data, gateway-event, interaction-payload, usage-finalized.

## Config
`themes/sietch/src/config.ts` (~1850 lines Zod) — env + 9 feature flags + secrets; cold-restart (validate at load).

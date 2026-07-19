# Contracts — Ground Truth

> Refreshed 2026-07-19 by /ride. Source: `reality/types.md`.

## PostgreSQL (Drizzle, multi-tenant RLS)
`packages/adapters/storage/schema.ts:50-476` — **9 tables**: communities, profiles, badges, creditLots, lotEntries, usageEvents, webhookEvents, cryptoPayments, reconciliationCursor, s2sJwksPublicKeys. All FK → `communities.id`; RLS `community_id = app.current_community_id()`. Relations: profiles→badges (self-ref `awarded_by`); creditLots→lotEntries (1:many). Also `themes/sietch/src/db/pg-schema.ts` — 10 pgTable. Migrations `themes/sietch/drizzle/migrations/` — 19 SQL (latest `0018_admin_audit_log.sql`; `0001_rls_policies`, `0008_tenant_context_guard`).

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

## Protocol packages (`packages/protocol/` — 10; Effect + Zod)
- v0.1.0: **shadow-mode** (eligibility verdict, divergence `match|freeside_higher|incumbent_higher|mismatch`), **ordering** (Order envelope + lifecycle + Presets), **eligibility** (sealed EligibilityRule/Verdict), **shadow-audit** (sealed schemas + deterministic inputs_hash).
- NEW v1.0.0 (collection-report cycle): **collection** (cross-VM identity, capability-version, canonical digest, finality bound), **collection-resolution** (durable confirmation sessions), **dependency-ledger** (CR-012A inbox/closure/quarantine/reconciliation), **public-authorization** (CR-007A grants, projection watermarks, leases), **signing-key-custody** (CR-013 KMS/HSM, fixture/production class separation), **trust-envelope** (CR-009 Ed25519 envelopes + stream sequencing; sequence_gap does NOT skip/poison event_id).
- **collection-report-gates** `packages/collection-report-gates/` — CR-019 release-gate manifest + deterministic validator.

## Federation & event schemas
- **registry** `packages/freeside-registry/src/registry.ts`: `ModuleEntry` (git_url, beacon_url, deployment_url, visibility, runtime_state), `ServiceBlock` (health_path/expected_status/auth_class/marker/probed_at, ADR-012), `Expectations[]` (http|graphql-lag|event-max-age).
- **BeaconV3** `packages/beacon-schema/src/beacon-v3.ts`: slug, publisher, is/is_not, cycle_state, composes_with (`Tag@semver+hash`), acvp_invariants, sealed_schemas (sha256-of-JCS).
- **events** `@0xhoneyjar/events`: envelope/jcs/signer/topics; nft-mint-detected, nft-activity, registry.
- **nats-schemas** `@freeside/nats-schemas`: event-data, gateway-event, interaction-payload, usage-finalized.

## Config
`themes/sietch/src/config.ts` (~1850 lines Zod) — env + 9 feature flags + secrets; cold-restart (validate at load).

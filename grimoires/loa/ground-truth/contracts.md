# Types & Contracts

> SHA: 39be5b7 | Generated: 2026-02-13

## Database Schema (Drizzle ORM + PostgreSQL 15)

Schema: (src: packages/adapters/storage/schema.ts) | Agent schema: (src: packages/adapters/storage/agent-schema.ts) | Migrations: 8 files in `themes/sietch/drizzle/migrations/` | Config: (src: themes/sietch/drizzle.config.ts:L14)

### communities (src: packages/adapters/storage/schema.ts:L47)

| Column | Type | Notes | Ref |
|--------|------|-------|-----|
| id | UUID PK | default random | (src: packages/adapters/storage/schema.ts:L50) |
| name | text | | (src: packages/adapters/storage/schema.ts:L51) |
| themeId | text | default 'basic' | (src: packages/adapters/storage/schema.ts:L52) |
| subscriptionTier | text | free/pro/enterprise | (src: packages/adapters/storage/schema.ts:L53) |
| discordGuildId | text | unique | (src: packages/adapters/storage/schema.ts:L54) |
| telegramChatId | text | unique | (src: packages/adapters/storage/schema.ts:L55) |
| isActive | boolean | default true | (src: packages/adapters/storage/schema.ts:L56) |
| settings | JSONB | CommunitySettings | (src: packages/adapters/storage/schema.ts:L57) |

### profiles (src: packages/adapters/storage/schema.ts:L77)

| Column | Type | Notes | Ref |
|--------|------|-------|-----|
| id | UUID PK | | (src: packages/adapters/storage/schema.ts:L80) |
| communityId | UUID FK | RLS scoped | (src: packages/adapters/storage/schema.ts:L81) |
| discordId/telegramId/walletAddress | text | | (src: packages/adapters/storage/schema.ts:L84) |
| tier | text | | (src: packages/adapters/storage/schema.ts:L87) |
| currentRank | integer | | (src: packages/adapters/storage/schema.ts:L88) |
| activityScore | integer | default 0 | (src: packages/adapters/storage/schema.ts:L89) |
| convictionScore | integer | default 0 | (src: packages/adapters/storage/schema.ts:L90) |
| metadata | JSONB | ProfileMetadata | (src: packages/adapters/storage/schema.ts:L94) |

Indexes: community, wallet, tier, rank (src: packages/adapters/storage/schema.ts:L99). Unique: discord+community, telegram+community (src: packages/adapters/storage/schema.ts:L103).

### badges (src: packages/adapters/storage/schema.ts:L118)

| Column | Type | Notes | Ref |
|--------|------|-------|-----|
| id | UUID PK | | (src: packages/adapters/storage/schema.ts:L121) |
| communityId | UUID FK | RLS scoped | (src: packages/adapters/storage/schema.ts:L122) |
| profileId | UUID FK→profiles | | (src: packages/adapters/storage/schema.ts:L125) |
| badgeType | text | | (src: packages/adapters/storage/schema.ts:L128) |
| awardedBy | UUID FK→profiles | self-ref for lineage | (src: packages/adapters/storage/schema.ts:L131) |
| revokedAt | timestamp | nullable | (src: packages/adapters/storage/schema.ts:L132) |
| metadata | JSONB | BadgeMetadata | (src: packages/adapters/storage/schema.ts:L133) |

Unique: one badge type per profile per community (src: packages/adapters/storage/schema.ts:L140).

### community_agent_config (src: packages/adapters/storage/agent-schema.ts:L36)

| Column | Type | Notes | Ref |
|--------|------|-------|-----|
| communityId | UUID PK/FK | | (src: packages/adapters/storage/agent-schema.ts:L39) |
| aiEnabled | boolean | default false | (src: packages/adapters/storage/agent-schema.ts:L42) |
| monthlyBudgetCents | integer | default 100 | (src: packages/adapters/storage/agent-schema.ts:L43) |
| tierOverrides | JSONB | nullable | (src: packages/adapters/storage/agent-schema.ts:L44) |

### agent_usage_log (src: packages/adapters/storage/agent-schema.ts:L62)

| Column | Type | Notes | Ref |
|--------|------|-------|-----|
| id | UUID PK | | (src: packages/adapters/storage/agent-schema.ts:L65) |
| communityId | UUID FK | | (src: packages/adapters/storage/agent-schema.ts:L66) |
| modelAlias | text | cheap/fast-code/reviewer/reasoning/native | (src: packages/adapters/storage/agent-schema.ts:L70) |
| costCents | bigint | | (src: packages/adapters/storage/agent-schema.ts:L73) |
| idempotencyKey | text | unique per (community, user, key) | (src: packages/adapters/storage/agent-schema.ts:L75) |
| Hounfour fields | text | reportId, poolId, costMicroUsd, originalJti | (src: packages/adapters/storage/agent-schema.ts:L79) |

## Core Type Interfaces

Community: id, name, themeId, subscriptionTier (`free|pro|enterprise`), discordGuildId, telegramChatId, isActive, settings (src: packages/core/ports/storage-provider.ts:L25)
Profile: id, communityId, discordId, telegramId, walletAddress, tier, currentRank, activityScore, convictionScore, metadata (src: packages/core/ports/storage-provider.ts:L57)
Badge: id, communityId, profileId, badgeType, awardedAt, awardedBy, revokedAt, metadata (src: packages/core/ports/storage-provider.ts:L109)
ModelAlias: `cheap | fast-code | reviewer | reasoning | native` (src: packages/core/ports/agent-gateway.ts:L24)
AccessLevel: `free | pro | enterprise` (src: packages/core/ports/agent-gateway.ts:L16)
EligibilityResult: eligible, source, confidence (0-1) (src: packages/core/ports/chain-provider.ts:L109)

## 9-Tier System (BGT-Based)

Thresholds defined at (src: themes/sietch/src/packages/adapters/themes/SietchTheme.ts:L47). Full tier array at (src: themes/sietch/src/packages/adapters/themes/SietchTheme.ts:L89).

| Tier | Name | BGT | Rank | Ref |
|------|------|-----|------|-----|
| 1 | Naib | (by rank) | 1–7 | (src: themes/sietch/src/packages/adapters/themes/SietchTheme.ts:L61) |
| 2 | Fedaykin | (by rank) | 8–69 | (src: themes/sietch/src/packages/adapters/themes/SietchTheme.ts:L61) |
| 3 | Usul | 1111 | 70–100 | (src: themes/sietch/src/packages/adapters/themes/SietchTheme.ts:L89) |
| 4 | Sayyadina | 888 | 101–150 | (src: themes/sietch/src/packages/adapters/themes/SietchTheme.ts:L89) |
| 5 | Mushtamal | 690 | 151–200 | (src: themes/sietch/src/packages/adapters/themes/SietchTheme.ts:L89) |
| 6 | Sihaya | 420 | 201–300 | (src: themes/sietch/src/packages/adapters/themes/SietchTheme.ts:L89) |
| 7 | Qanat | 222 | 301–500 | (src: themes/sietch/src/packages/adapters/themes/SietchTheme.ts:L89) |
| 8 | Ichwan | 69 | 501–1000 | (src: themes/sietch/src/packages/adapters/themes/SietchTheme.ts:L89) |
| 9 | Hajra | 6.9 | 1001+ | (src: themes/sietch/src/packages/adapters/themes/SietchTheme.ts:L89) |

Tier→access mapping: tiers 1–3→free(cheap), 4–6→pro(cheap,fast-code,reviewer), 7–9→enterprise(all) (src: packages/adapters/agent/tier-access-mapper.ts:L48)

## Zod Config Validation

Main schema at (src: themes/sietch/src/config.ts:L120). Interface at (src: themes/sietch/src/config.ts:L682). Startup validation at (src: themes/sietch/src/config.ts:L893). Exported config at (src: themes/sietch/src/config.ts:L1123).
Feature flags: billingEnabled, gatekeeperEnabled, redisEnabled, telegramEnabled, vaultEnabled, gatewayProxyEnabled, cryptoPaymentsEnabled (src: themes/sietch/src/config.ts:L217).

## RLS (Row-Level Security)

All tenant tables scoped by `app.current_tenant` (src: packages/adapters/storage/tenant-context.ts:L120). Clear via `clear_tenant_context()` (src: packages/adapters/storage/tenant-context.ts:L146). Scoped execution via `withTenant<T>()` (src: packages/adapters/storage/tenant-context.ts:L198).
Policies at (src: themes/sietch/drizzle/migrations/0001_rls_policies.sql). Hardened at (src: themes/sietch/drizzle/migrations/0004_rls_nil_uuid_hardening.sql).

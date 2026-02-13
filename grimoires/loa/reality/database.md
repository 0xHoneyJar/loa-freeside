# Database Schema

> Generated: 2026-02-13 | Git SHA: 39be5b7

## ORM: Drizzle + PostgreSQL 15

Schema: `packages/adapters/storage/schema.ts`
Agent schema: `packages/adapters/storage/agent-schema.ts`
Migrations: `themes/sietch/drizzle/`
Config: `themes/sietch/drizzle.config.ts`

## Tables

### communities
| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| name | text | |
| themeId | text | |
| subscriptionTier | text | free/pro/enterprise |
| discordGuildId | text | unique |
| telegramChatId | text | |
| isActive | boolean | |
| settings | JSONB | |
| createdAt/updatedAt | timestamp | |

### profiles
| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| communityId | UUID FK→communities | RLS scoped |
| discordId | text | unique per community |
| telegramId | text | unique per community |
| walletAddress | text | |
| tier | integer | 0-8 (9-tier system) |
| currentRank | integer | |
| activityScore | numeric | |
| convictionScore | numeric | |
| joinedAt/lastSeenAt | timestamp | |
| metadata | JSONB | |

### badges
| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| communityId | UUID FK | RLS scoped |
| profileId | UUID FK→profiles | |
| badgeType | text | |
| awardedAt | timestamp | |
| awardedBy | UUID FK→profiles | Self-ref for lineage |
| revokedAt | timestamp | nullable |
| metadata | JSONB | |

### community_agent_config
| Column | Type | Notes |
|--------|------|-------|
| communityId | UUID PK/FK | |
| aiEnabled | boolean | |
| monthlyBudgetCents | integer | |
| tierOverrides | JSONB | |
| pricingOverrides | JSONB | |

### agent_usage_log
| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| communityId | UUID FK | |
| userWallet | text | |
| modelAlias | text | cheap/fast-code/reviewer/reasoning/native |
| promptTokens/completionTokens | integer | |
| costCents | bigint | |
| idempotencyKey | text | unique per (community, user, key) |
| traceId | text | |

## Key Features

- **Row-Level Security (RLS):** All tenant tables scoped by `app.current_tenant`
- **Badge lineage:** Self-referencing FK for Water Sharer referral chains (recursive CTE)
- **Transaction support:** Full ACID with automatic rollback
- **Multi-tenancy:** TenantContext wraps all operations

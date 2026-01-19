# Sprint S-19: Enhanced RLS & Drizzle Adapter

**Sprint:** S-19
**Phase:** 7 (PostgreSQL Multi-Tenant)
**Date:** 2026-01-16
**Engineer:** Claude Code

---

## Implementation Summary

Sprint S-19 implements the PostgreSQL multi-tenant storage layer with Row-Level Security (RLS) per SDD §6.3. This provides:

1. **IStorageProvider Interface** - Port interface for multi-tenant storage operations
2. **TenantContext** - Manages PostgreSQL tenant context for RLS policies
3. **DrizzleStorageAdapter** - Type-safe adapter implementing IStorageProvider
4. **RLS Tests** - Penetration and regression tests for tenant isolation

---

## Files Created

### Core Ports
| File | Lines | Purpose |
|------|-------|---------|
| `packages/core/ports/storage-provider.ts` | ~420 | IStorageProvider interface, types, validation |

### Storage Adapters
| File | Lines | Purpose |
|------|-------|---------|
| `packages/adapters/storage/tenant-context.ts` | ~310 | TenantContext class for RLS management |
| `packages/adapters/storage/drizzle-storage-adapter.ts` | ~600 | DrizzleStorageAdapter implementation |
| `packages/adapters/storage/schema.ts` | ~190 | Drizzle schema definitions |
| `packages/adapters/storage/index.ts` | ~50 | Module exports |

### Tests
| File | Lines | Tests | Purpose |
|------|-------|-------|---------|
| `storage/__tests__/tenant-context.test.ts` | ~210 | 25 | TenantContext unit tests |
| `storage/__tests__/drizzle-storage-adapter.test.ts` | ~310 | 42 | Adapter unit tests |
| `storage/__tests__/rls-penetration.test.ts` | ~420 | 22 | RLS security tests |

### Infrastructure
| File | Lines | Purpose |
|------|-------|---------|
| `infrastructure/migrations/002_get_tenant_context.sql` | ~30 | get_tenant_context() function |

---

## Key Implementations

### 1. IStorageProvider Interface

```typescript
export interface IStorageProvider {
  readonly tenantId: string;

  // Community Operations (bypass RLS for initial resolution)
  getCommunity(id: string): Promise<Community | null>;
  getCommunityByDiscordGuild(guildId: string): Promise<Community | null>;
  getCommunityByTelegramChat(chatId: string): Promise<Community | null>;
  createCommunity(data: NewCommunity): Promise<Community>;
  updateCommunity(id: string, data: Partial<NewCommunity>): Promise<Community | null>;
  deactivateCommunity(id: string): Promise<boolean>;

  // Profile Operations (RLS-scoped)
  getProfile(id: string): Promise<Profile | null>;
  getProfileByDiscordId(discordId: string): Promise<Profile | null>;
  getProfileByTelegramId(telegramId: string): Promise<Profile | null>;
  getProfileByWallet(walletAddress: string): Promise<Profile | null>;
  getProfiles(options?: QueryOptions): Promise<PaginatedResult<Profile>>;
  getProfilesByTier(tier: string, options?: QueryOptions): Promise<PaginatedResult<Profile>>;
  createProfile(data: NewProfile): Promise<Profile>;
  updateProfile(id: string, data: Partial<NewProfile>): Promise<Profile | null>;
  deleteProfile(id: string): Promise<boolean>;
  touchProfile(id: string): Promise<void>;

  // Badge Operations (RLS-scoped)
  getBadge(id: string): Promise<Badge | null>;
  getBadgesForProfile(profileId: string): Promise<Badge[]>;
  getBadgesByType(badgeType: string, options?: QueryOptions): Promise<PaginatedResult<Badge>>;
  hasBadge(profileId: string, badgeType: string): Promise<boolean>;
  awardBadge(data: NewBadge): Promise<Badge>;
  revokeBadge(badgeId: string): Promise<boolean>;
  getBadgeLineage(badgeId: string, maxDepth?: number): Promise<BadgeLineageNode[]>;
  getBadgesAwardedBy(profileId: string): Promise<Badge[]>;

  // Transaction Support
  transaction<T>(fn: (tx: IStorageProvider) => Promise<T>): Promise<T>;

  // Lifecycle
  close(): Promise<void>;
}
```

### 2. TenantContext Usage

```typescript
const tenantContext = new TenantContext(db);

// Option 1: Scoped execution (recommended)
await tenantContext.withTenant(communityId, async () => {
  const profiles = await db.select().from(profiles);
});

// Option 2: Manual management
await tenantContext.setTenant(communityId);
const profiles = await db.select().from(profiles);
await tenantContext.clearTenant();
```

### 3. RLS Security Guarantees

Per SDD §6.3.2:
- Cross-tenant queries return empty results (not errors)
- Tenant context not set = no rows visible
- INSERT/UPDATE with wrong community_id = permission denied
- Community lookup bypasses RLS for initial tenant resolution

### 4. Badge Lineage Query

Recursive CTE for Water Sharer badge lineage:

```sql
WITH RECURSIVE lineage AS (
  SELECT b.id, b.profile_id, 0 as depth
  FROM badges b
  WHERE b.id = $badgeId

  UNION ALL

  SELECT parent_b.id, parent_b.profile_id, lineage.depth + 1
  FROM lineage
  JOIN badges child_b ON child_b.id = lineage.badge_id
  JOIN badges parent_b ON parent_b.profile_id = child_b.awarded_by
    AND parent_b.badge_type = child_b.badge_type
  WHERE lineage.depth < $maxDepth
)
SELECT * FROM lineage ORDER BY depth ASC
```

---

## Test Results

```
packages/adapters: 400 tests passing
  - tenant-context.test.ts: 25 tests
  - drizzle-storage-adapter.test.ts: 42 tests
  - rls-penetration.test.ts: 22 tests
  - badge-evaluators.test.ts: 41 tests
  - basic-theme.test.ts: 63 tests
  - sietch-theme.test.ts: 58 tests
  - theme-registry.test.ts: 38 tests
  - (chain tests: 111 tests)

packages/core: 71 tests passing

Total: 471 tests passing
```

---

## Dependencies Added

```json
{
  "drizzle-orm": "^0.33.0",
  "postgres": "^3.4.0"
}
```

---

## RLS Test Coverage

### Penetration Tests (S-19.6)
- [x] Cross-tenant access returns empty results
- [x] No tenant context = no rows visible
- [x] INSERT/UPDATE with wrong community_id enforced
- [x] Tenant context isolation per connection
- [x] Community lookup bypasses RLS

### Regression Tests (S-19.7)
- [x] Profile isolation by tenant
- [x] Badge isolation by tenant
- [x] Transaction isolation
- [x] Error handling (no tenant leakage)
- [x] Pagination isolation

---

## Architecture Notes

### Hexagonal Architecture
```
packages/
├── core/
│   └── ports/
│       └── storage-provider.ts    # IStorageProvider interface
└── adapters/
    └── storage/
        ├── tenant-context.ts      # RLS context management
        ├── drizzle-storage-adapter.ts  # Implementation
        └── schema.ts              # Drizzle table definitions
```

### Migration Compatibility

The Drizzle schema aligns with existing migrations:
- `001_scaling_schema.sql` - Base RLS infrastructure
- `002_get_tenant_context.sql` - New context retrieval function (S-19)

### Type Safety

All operations use Drizzle's type inference:
```typescript
export type DrizzleCommunity = typeof communities.$inferSelect;
export type DrizzleNewCommunity = typeof communities.$inferInsert;
```

---

## Sprint Checklist

- [x] S-19.1: Port Communities schema to packages
- [x] S-19.2: Add get_tenant_context SQL function
- [x] S-19.3: Verify RLS Bypass Role exists (arrakis_service)
- [x] S-19.4: Port IStorageProvider interface
- [x] S-19.5: Port TenantContext to packages
- [x] S-19.6: Create RLS Penetration Tests
- [x] S-19.7: Create RLS Regression Tests
- [x] All tests passing (471 total)

---

## Next Steps

Sprint S-19 completes Phase 7 (PostgreSQL Multi-Tenant) foundation. Ready for:
- Integration testing with real PostgreSQL database
- Connection pooling configuration
- Production deployment validation

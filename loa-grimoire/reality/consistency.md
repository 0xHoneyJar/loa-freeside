# Consistency Analysis

> Generated: 2025-12-24
> Source: Code Reality Extraction (Phase 5)

## Naming Conventions

### Service Export Patterns

| Pattern | Services Using | Consistency |
|---------|----------------|-------------|
| Class + singleton export | profile, eligibility, avatar, activity, directory, threshold, discord, onboarding, leaderboard, notification, naib, chain, TierService | CONSISTENT |
| Function exports | badge, roleManager, memberMigration | CONSISTENT (utility modules) |

**Pattern**:
```typescript
// Class-based services
export const serviceNameService = new ServiceNameClass();

// Utility modules
export function utilityFunction(...): ReturnType { }
```

### File Naming

| Pattern | Files | Consistency |
|---------|-------|-------------|
| camelCase.ts | Most services | CONSISTENT |
| PascalCase.ts | TierService.ts | INCONSISTENT |

**Recommendation**: Rename `TierService.ts` to `tier.ts` for consistency

### Type Naming

| Pattern | Example | Usage |
|---------|---------|-------|
| PascalCase interfaces | `MemberProfile`, `Badge` | CONSISTENT |
| PascalCase types | `Tier`, `AlertFrequency` | CONSISTENT |
| SCREAMING_SNAKE constants | `TIER_THRESHOLDS`, `BADGE_IDS` | CONSISTENT |

### API Naming

| Pattern | Example | Consistency |
|---------|---------|-------------|
| snake_case JSON responses | `member_id`, `pfp_url` | CONSISTENT |
| camelCase internal | `memberId`, `pfpUrl` | CONSISTENT |

### Command Naming

| Pattern | Examples | Consistency |
|---------|----------|-------------|
| kebab-case | `/admin-badge`, `/register-waitlist` | CONSISTENT |
| simple | `/profile`, `/stats`, `/naib` | CONSISTENT |

## Architecture Patterns

### Service Structure

All services follow consistent patterns:
1. Private class with business logic
2. Exported singleton instance
3. Database queries via `db/queries.ts`
4. Logging via Pino logger

### Error Handling

| Pattern | Usage | Consistency |
|---------|-------|-------------|
| Custom error classes | ValidationError, NotFoundError | API routes only |
| throw new Error() | Service-level errors | CONSISTENT |
| logger.error() + graceful handling | Non-fatal errors | CONSISTENT |

### Database Access

| Pattern | Usage | Consistency |
|---------|-------|-------------|
| Prepared statements | All queries | CONSISTENT |
| Transaction wrapper | Complex updates | CONSISTENT |
| Type casting | BigInt <-> string | CONSISTENT |

## Identified Inconsistencies

### 1. File Naming
- `TierService.ts` uses PascalCase
- All other services use camelCase
- **Impact**: LOW (cosmetic)

### 2. Export in Barrel Files
- TierService not exported in `services/index.ts`
- badgeCheckTask and activityDecayTask not exported in `trigger/index.ts`
- **Impact**: MEDIUM (discoverability)

### 3. Type Assertions
- Some `as any` casts in routes and migrations
- **Impact**: LOW (isolated, non-critical paths)

## Pattern Compliance Summary

| Category | Score | Notes |
|----------|-------|-------|
| Naming Conventions | 95% | One file naming exception |
| Service Architecture | 100% | Consistent singleton pattern |
| Error Handling | 100% | Consistent patterns |
| Database Access | 100% | Consistent prepared statements |
| API Response Format | 100% | Consistent snake_case |
| Type Safety | 90% | 5 `any` casts |
| Export Patterns | 85% | Missing barrel exports |

**Overall Consistency Score**: 95%

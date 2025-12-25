# Code Hygiene Audit

> Generated: 2025-12-24
> Source: Code Reality Extraction (Phase 2b)

## Tech Debt Markers

### TODO/FIXME/HACK/XXX
| File | Line | Marker | Note |
|------|------|--------|------|
| `admin-badge.ts` | 176 | TODO | "Send DM notification to the member (S8-T9)" |

**Total**: 1 TODO marker (excellent hygiene)

### Type Safety Issues
| File | Line | Issue |
|------|------|-------|
| `migrations/006_tier_system.ts` | 281 | `db: any` parameter |
| `migrations/006_tier_system.ts` | 290 | `db: any` parameter |
| `TierService.ts` | 380 | `'tier_change' as any` cast |
| `api/routes.ts` | 618 | `stats.byType as Record<any, number>` cast |
| `api/routes.ts` | 1070 | `alert_type as any` cast |

**Total**: 5 type safety bypasses (localized to routes/migrations)

### Console Logging (should use Pino)
| File | Lines | Usage |
|------|-------|-------|
| `migrations/003_migrate_v1_members.ts` | 82, 86, 139, 145, 155, 166 | Migration logging |
| `migrations/004_performance_indexes.ts` | 17, 49, 61 | Migration logging |
| `migrations/006_tier_system.ts` | 283, 292 | Migration logging |

**Note**: All console.log usage is in migration scripts (acceptable during migrations)

### Lint/Format Suppressions
- **eslint-disable**: 0
- **prettier-ignore**: 0
- **noqa**: 0

**Total**: 0 lint suppressions (excellent)

## Test Coverage

### Test Files Found (13 total)

**Unit Tests** (3):
- `tests/unit/config.test.ts`
- `tests/unit/eligibility.test.ts`
- `tests/unit/tierService.test.ts`

**Integration Tests** (10):
- `tests/integration/privacy.test.ts`
- `tests/integration/onboarding.test.ts`
- `tests/integration/activity.test.ts`
- `tests/integration/badges.test.ts`
- `tests/integration/directory.test.ts`
- `tests/integration/roleManager.test.ts`
- `tests/integration/api.test.ts`
- `tests/integration/naib.test.ts`
- `tests/integration/threshold.test.ts`
- `tests/integration/notification.test.ts`

### Test Framework
- **Runner**: Vitest 2.1.5
- **Scripts**: `npm test` (watch), `npm run test:run` (CI)

## Error Handling

| File | Count | Pattern |
|------|-------|---------|
| `db/queries.ts` | 1 | throw new Error |
| `config.ts` | 1 | throw new Error |
| `services/notification.ts` | 4 | throw new Error |
| `services/discord.ts` | 1 | throw new Error |
| `discord/embeds/alerts.ts` | 1 | throw new Error |

**Total**: 8 explicit throws (reasonable error handling)

## Code Quality Tools

| Tool | Version | Config |
|------|---------|--------|
| ESLint | 8.57.1 | @typescript-eslint |
| Prettier | 3.3.3 | eslint-config-prettier |
| TypeScript | 5.6.3 | Strict mode |

## Scripts Available

```json
{
  "lint": "eslint src --ext .ts",
  "lint:fix": "eslint src --ext .ts --fix",
  "format": "prettier --write \"src/**/*.ts\"",
  "typecheck": "tsc --noEmit"
}
```

## Hygiene Summary

| Category | Status | Notes |
|----------|--------|-------|
| Tech Debt Markers | GREEN | Only 1 TODO |
| Type Safety | YELLOW | 5 `any` casts (localized) |
| Console Usage | GREEN | Only in migrations |
| Lint Suppressions | GREEN | None |
| Test Coverage | GREEN | 13 test files |
| Error Handling | GREEN | Proper throw patterns |
| Code Quality Tools | GREEN | ESLint + Prettier configured |

**Overall Assessment**: Good code hygiene. The `any` casts are isolated and could be improved but are not critical.

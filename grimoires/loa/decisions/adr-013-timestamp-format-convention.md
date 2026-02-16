# ADR-013: Timestamp Format Convention

**Status:** Accepted
**Date:** 2026-02-16
**Decision Makers:** Engineering Team

## Context

The codebase had inconsistent timestamp formats causing BB-67-001 (High severity):
- SQLite `datetime('now')` produces `YYYY-MM-DD HH:MM:SS` (space-separated, no timezone)
- JavaScript `new Date().toISOString()` produces `YYYY-MM-DDTHH:MM:SS.sssZ` (ISO 8601)

These formats have different string sort order due to `T` vs space and `.sssZ` suffix, which breaks `ORDER BY created_at` and `WHERE created_at < ?` comparisons.

## Decision

**DO NOT USE ISO 8601 for SQLite columns.**

| Context | Format | Example | Module |
|---------|--------|---------|--------|
| SQLite columns | `YYYY-MM-DD HH:MM:SS` | `2026-02-16 03:30:00` | `sqliteTimestamp()` |
| SQLite future timestamps | `YYYY-MM-DD HH:MM:SS` | via `sqliteFutureTimestamp(hours)` | `sqliteFutureTimestamp()` |
| External API responses | ISO 8601 | `2026-02-16T03:30:00.000Z` | `isoTimestamp()` |
| Webhook payloads | ISO 8601 | `2026-02-16T03:30:00.000Z` | `isoTimestamp()` |

Canonical module: `packages/adapters/billing/protocol/timestamps.ts`

## Rationale

1. **String ordering**: SQLite sorts TEXT columns lexicographically. `YYYY-MM-DD HH:MM:SS` sorts correctly. ISO 8601 with variable millisecond precision does not sort consistently
2. **SQLite functions**: `datetime('now')`, `datetime(?, '+48 hours')` all produce space-separated format. Mixing formats breaks comparisons
3. **Simplicity**: One format internally, convert only at API boundaries

## Implementation

```typescript
// protocol/timestamps.ts
export function sqliteTimestamp(): string;           // "2026-02-16 03:30:00"
export function sqliteFutureTimestamp(hours: number): string;  // Computed via Date math
export function isoTimestamp(): string;              // "2026-02-16T03:30:00.000Z"
```

All services migrated in Sprint 14 (Task 14.2):
- CreditLedgerAdapter, ReferralService, CampaignAdapter
- PaymentServiceAdapter, RevenueRulesAdapter, FraudRulesService
- SettlementService, BonusProcessor, DLQ processor
- Daily reconciliation job

## Consequences

- All new SQLite columns MUST use `sqliteTimestamp()` from `protocol/timestamps.ts`
- Direct `new Date().toISOString()` calls for SQLite columns are a code smell
- API response serialization converts to ISO 8601 at the boundary
- 11 regression tests in `timestamp-format.test.ts` prevent format drift

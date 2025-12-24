# Scheduled Tasks Reality

> Generated: 2025-12-24
> Source: Code Reality Extraction (Phase 2)

## Trigger.dev Tasks (4 exported, 5 files)

| Task ID | File | Schedule | Description | Sprint |
|---------|------|----------|-------------|--------|
| sync-eligibility | `syncEligibility.ts` | `0 */6 * * *` | Every 6 hours at minute 0 | v1.0+ |
| weekly-reset | `weeklyReset.ts` | `0 0 * * 1` | Every Monday 00:00 UTC | v2.1 (S13) |
| badge-check | `badgeCheck.ts` | `0 0 * * *` | Daily at midnight UTC | v2.0 |
| activity-decay | `activityDecay.ts` | `30 */6 * * *` | Every 6 hours at minute 30 | v2.0 |

## Exported Tasks (from index.ts)

```typescript
export { syncEligibilityTask } from './syncEligibility.js';
export { weeklyResetTask } from './weeklyReset.js';
// Note: badgeCheckTask and activityDecayTask exist but NOT exported in index.ts
```

## Tasks NOT Exported

| Task | File Exists | Exported |
|------|-------------|----------|
| badgeCheckTask | YES | NO |
| activityDecayTask | YES | NO |

## Task Details

### syncEligibilityTask
- Fetches BGT eligibility from Berachain RPC
- Computes diff from previous snapshot
- Saves new snapshot to database
- Evaluates Naib seats (v2.1)
- Saves threshold snapshot (v2.1)
- Checks waitlist eligibility (v2.1)
- Processes notifications (v2.1)
- Updates health status

### weeklyResetTask
- Resets weekly notification counters for all members
- Allows fresh alert quota for the week

### badgeCheckTask
- Awards automatic tenure badges (OG, Veteran, Elder)
- Awards activity badges (Consistent, Dedicated, Devoted)

### activityDecayTask
- Applies 10% demurrage decay to activity balances
- Cleans up rate limit cache

## Tasks NOT Found (PRD v3.0 Claims)

| Claimed Task | PRD Reference | Status |
|--------------|---------------|--------|
| weeklyDigest | PRD 7.5 | NOT IMPLEMENTED |

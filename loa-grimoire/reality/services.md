# Service Layer Reality

> Generated: 2025-12-24
> Source: Code Reality Extraction (Phase 2)

## Verified Services (19 total)

| Service | File | Status | Sprint |
|---------|------|--------|--------|
| chainService | `chain.ts` | Exists | v1.0 |
| eligibilityService | `eligibility.ts` | Exists | v1.0 |
| discordService | `discord.ts` | Exists | v1.0 |
| profileService | `profile.ts` | Exists | v2.0 |
| avatarService | `avatar.ts` | Exists | v2.0 |
| onboardingService | `onboarding.ts` | Exists | v2.0 |
| activity (functions) | `activity.ts` | Exists | v2.0 |
| badge (functions) | `badge.ts` | Exists | v2.0 |
| directoryService | `directory.ts` | Exists | v2.0 |
| leaderboardService | `leaderboard.ts` | Exists | v2.0 |
| roleManager (functions) | `roleManager.ts` | Exists | v2.0 |
| memberMigration (functions) | `memberMigration.ts` | Exists | v2.0 |
| naibService | `naib.ts` | Exists | v2.1 |
| thresholdService | `threshold.ts` | Exists | v2.1 |
| notificationService | `notification.ts` | Exists | v2.1 |
| tierService | `TierService.ts` | Exists | v3.0 |

## Services NOT Found (v3.0 Planned)

| Service | PRD/SDD Reference | Status |
|---------|-------------------|--------|
| SponsorService | SDD 4.2 | NOT IMPLEMENTED |
| DigestService | SDD 4.3 | NOT IMPLEMENTED |
| StoryService | SDD 4.4 | NOT IMPLEMENTED |
| StatsService | SDD 4.5 | NOT IMPLEMENTED |
| AnalyticsService | SDD 4.6 | NOT IMPLEMENTED |

## Service Exports (from index.ts)

```typescript
// v1.0 Core
export { chainService } from './chain.js';
export { eligibilityService } from './eligibility.js';
export { discordService } from './discord.js';

// v2.0 Social Layer
export { profileService } from './profile.js';
export { avatarService } from './avatar.js';
export { onboardingService } from './onboarding.js';
export { directoryService } from './directory.js';
export { leaderboardService } from './leaderboard.js';

// v2.1 Naib & Threshold
export { naibService } from './naib.js';
export { thresholdService } from './threshold.js';
export { notificationService } from './notification.js';

// v3.0 (TierService exists but not exported in index.ts)
```

## TierService Implementation Verified

**File**: `sietch-service/src/services/TierService.ts`

**Key Features**:
- 9 tiers: hajra, ichwan, qanat, sihaya, mushtamal, sayyadina, usul, fedaykin, naib
- BGT thresholds: 6.9, 69, 222, 420, 690, 888, 1111 (using viem parseUnits)
- Rank precedence: Top 7 = naib, Top 8-69 = fedaykin
- `calculateTier(bgt, rank)` method
- `isPromotion(oldTier, newTier)` method
- `getTierProgress(currentTier, currentBgt, currentRank)` method
- `updateMemberTier()` persistence method
- `getTierDistribution()` analytics method

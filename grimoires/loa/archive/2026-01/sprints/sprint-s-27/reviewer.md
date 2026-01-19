# Sprint S-27: Glimpse Mode & Migration Readiness

## Implementation Report

**Sprint**: S-27
**Status**: Complete
**Date**: 2026-01-17

## Summary

Implemented Glimpse Mode functionality that shows social features exist without full access, driving migration interest. Also implemented migration readiness checks with configurable requirements.

## Tasks Completed

### S-27.1: Leaderboard Glimpse (visible board, hidden others' scores)
- Implemented `getLeaderboard()` in GlimpseManager
- Shows viewer's position and score
- Hides competitor details (displayName, score, tier) in glimpse mode
- Sets `isGlimpsed: true` for hidden entries

### S-27.2: Profile Directory Glimpse (blurred profile cards)
- Implemented `getProfileDirectory()` in GlimpseManager
- Blurs non-viewer profiles (displayName, avatarUrl, tierName, convictionScore)
- Badge count remains visible
- Sets `isBlurred: true` for hidden profiles

### S-27.3: Badge Showcase Glimpse (locked badge icons)
- Implemented `getBadgeShowcase()` in GlimpseManager
- Shows all badges with metadata (name, description, rarity, totalHolders)
- Locks unearned badges in glimpse mode
- Viewer's earned badges never locked
- Sets `isLocked: true` for locked badges

### S-27.4: Preview Profile ("Your Preview Profile" view)
- Implemented `getPreviewProfile()` in GlimpseManager
- Always returns full profile for viewing user
- Works regardless of community tier
- Includes tier info, conviction score, badges, wallet addresses, NFT/token holdings

### S-27.5: Unlock Messaging (migration CTA)
- Implemented `getUnlockMessage()` and `setCustomUnlockMessage()`
- Four message types: migration_cta, admin_action_required, readiness_check, custom
- Context-aware messages based on readiness status and admin role
- Default message: "Full profiles unlock when your community migrates"

### S-27.6: Readiness Checks (14 days shadow, 95% accuracy)
- Implemented `checkReadiness()` with configurable requirements
- Default requirements:
  - `minShadowDays`: 14
  - `minAccuracy`: 0.95 (95%)
  - `maxDivergenceRate`: 0.05 (5%)
- Returns blockers, warnings, and estimated days until ready
- Recommended migration strategies: instant (>98%), gradual (95-98%), parallel_forever (<95%)

### S-27.7: Glimpse Mode Tests
- 64 comprehensive tests covering all functionality
- Tests for glimpse mode lifecycle, leaderboard, profile directory, badge showcase
- Tests for preview profile, unlock messaging, migration readiness
- All tests passing

## Files Changed

### New Files
- `packages/core/domain/glimpse-mode.ts` - Domain types (412 lines)
- `packages/core/ports/glimpse-mode.ts` - Port interfaces (246 lines)
- `packages/adapters/coexistence/glimpse-manager.ts` - Implementation (905 lines)
- `packages/adapters/coexistence/glimpse-manager.test.ts` - Tests (64 tests)

### Modified Files
- `packages/core/domain/index.ts` - Added glimpse-mode export
- `packages/core/ports/index.ts` - Added glimpse-mode export
- `packages/adapters/coexistence/index.ts` - Added GlimpseManager export

## Architecture

### Domain Types
```typescript
// Visibility levels
type GlimpseVisibility = 'hidden' | 'blurred' | 'locked' | 'preview' | 'full';

// Core interfaces
interface GlimpseModeConfig { ... }
interface GlimpseLeaderboard { ... }
interface GlimpseProfileDirectory { ... }
interface GlimpseBadgeShowcase { ... }
interface PreviewProfile { ... }
interface MigrationReadinessResult { ... }
```

### Port Interfaces
```typescript
interface IGlimpseManager {
  isGlimpseModeActive(communityId: string): Promise<boolean>;
  getStatus(communityId: string): Promise<GlimpseModeStatus | null>;
  getLeaderboard(context, options?): Promise<GlimpseLeaderboard>;
  getProfileDirectory(context, options?): Promise<GlimpseProfileDirectory>;
  getBadgeShowcase(context, options?): Promise<GlimpseBadgeShowcase>;
  getPreviewProfile(context): Promise<PreviewProfile | null>;
  getUnlockMessage(communityId, feature, isAdmin): Promise<UnlockMessage>;
}

interface IMigrationReadinessChecker {
  checkReadiness(communityId: string): Promise<MigrationReadinessResult>;
  getRequirements(communityId: string): Promise<MigrationReadinessRequirements>;
  getShadowDays(communityId: string): Promise<number>;
  getShadowAccuracy(communityId: string): Promise<number>;
  estimateDaysUntilReady(communityId: string): Promise<number | null>;
  getRecommendedStrategy(communityId: string): Promise<'instant' | 'gradual' | 'parallel_forever' | null>;
}
```

### Dependency Interfaces
The GlimpseManager requires these data source interfaces:
- `ILeaderboardDataSource` - Provides leaderboard entries and user positions
- `IProfileDataSource` - Provides profile cards and full profile data
- `IBadgeDataSource` - Provides badge metadata and user's earned badges
- `ICommunityVerificationSource` - Provides tier and shadow mode info
- `IShadowStats` - Provides shadow accuracy statistics
- `IGlimpseConfigStore` - Persists glimpse config and requirements

## Test Coverage

```
Test Files  8 passed (8)
     Tests  286 passed (286)
```

New glimpse-manager.test.ts: 64 tests covering:
- Glimpse mode lifecycle (3 tests)
- Status retrieval (4 tests)
- Config management (4 tests)
- Leaderboard glimpse (8 tests)
- Profile directory glimpse (5 tests)
- Badge showcase glimpse (6 tests)
- Preview profile (4 tests)
- Unlock messaging (5 tests)
- Migration readiness (10 tests)
- Requirements management (4 tests)
- Shadow days/accuracy (4 tests)
- Days estimation (3 tests)
- Strategy recommendation (4 tests)

## Integration Points

### Feature Gate Integration
- GlimpseManager checks `isGlimpseModeActive()` via verification tier
- Returns `true` for `incumbent_only` and `arrakis_basic`
- Returns `false` for `arrakis_full` (no glimpse mode)

### Shadow Mode Integration
- Uses `IShadowStats` for accuracy checks
- Uses shadow mode start date for days calculation
- Integrates with existing parallel mode architecture

## Security Considerations

1. **Viewer Privacy**: Viewer always sees their own full data
2. **No Data Leakage**: Competitor details completely hidden (null values)
3. **Admin-Only Messages**: Readiness blockers only shown to admins
4. **Configurable Requirements**: Admins can adjust thresholds

## Notes for Reviewer

1. The implementation follows hexagonal architecture with clean port/adapter separation
2. All domain constants are exported for reuse
3. Factory functions provided for easy instantiation
4. Comprehensive metrics tracking for observability
5. Backward compatible - existing functionality not affected

## Next Steps

After review approval:
1. Security audit (Phase 5.5)
2. Integration with Discord commands
3. UI components for glimpse views

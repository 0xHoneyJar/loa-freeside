# Three-Way Drift Analysis

> Generated: 2025-12-24
> Source: Code Reality Extraction (Phase 4)

## Analysis Framework

Comparing three sources of truth:
1. **CODE**: What actually exists in the codebase
2. **DOCS**: PRD v3.0 / SDD v3.0 claims
3. **CONTEXT**: User-provided information and tribal knowledge

## Critical Drift Findings

### 1. Services Claimed vs Implemented

| Service | PRD/SDD Claim | Code Reality | Drift |
|---------|---------------|--------------|-------|
| TierService | SDD 4.1 | EXISTS | ALIGNED |
| SponsorService | SDD 4.2 | NOT FOUND | CODE BEHIND |
| DigestService | SDD 4.3 | NOT FOUND | CODE BEHIND |
| StoryService | SDD 4.4 | NOT FOUND | CODE BEHIND |
| StatsService | SDD 4.5 | NOT FOUND | CODE BEHIND |
| AnalyticsService | SDD 4.6 | NOT FOUND | CODE BEHIND |

**Severity**: HIGH - 5 services documented but not implemented

### 2. Discord Commands Claimed vs Implemented

| Command | PRD Claim | Code Reality | Drift |
|---------|-----------|--------------|-------|
| /profile | PRD 6.3 | EXISTS | ALIGNED |
| /stats | PRD 6.1 | EXISTS | ALIGNED |
| /invite | PRD 6.1 | NOT FOUND | CODE BEHIND |
| /leaderboard | PRD 6.1 | EXISTS | ALIGNED |
| /naib | PRD 6.2 | EXISTS | ALIGNED |
| /threshold | PRD 6.2 | EXISTS | ALIGNED |
| /position | PRD 6.2 | EXISTS | ALIGNED |
| /alerts | PRD 6.2 | EXISTS | ALIGNED |
| /directory | PRD 6.3 | EXISTS | ALIGNED |
| /badges | PRD 6.3 | EXISTS | ALIGNED |
| /admin-badge | PRD 6.4 | EXISTS | ALIGNED |

**Severity**: MEDIUM - 1 command documented but not implemented

### 3. Scheduled Tasks Claimed vs Implemented

| Task | PRD Claim | Code Reality | Drift |
|------|-----------|--------------|-------|
| syncEligibility | PRD 7.5 | EXISTS (0 */6 * * *) | ALIGNED |
| weeklyReset | PRD 7.5 | EXISTS (0 0 * * 1) | ALIGNED |
| weeklyDigest | PRD 7.5 | NOT FOUND | CODE BEHIND |
| badgeCheck | SDD | EXISTS (0 0 * * *) | ALIGNED |
| activityDecay | SDD | EXISTS (30 */6 * * *) | ALIGNED |

**Severity**: MEDIUM - 1 scheduled task documented but not implemented

### 4. Database Tables Claimed vs Implemented

| Table | PRD/SDD Claim | Code Reality | Drift |
|-------|---------------|--------------|-------|
| tier_history | PRD 4.1.2 | EXISTS (migration 006) | ALIGNED |
| sponsor_invites | PRD 4.2.3 | EXISTS (migration 006) | ALIGNED |
| story_fragments | PRD 7.1 | EXISTS (migration 006) | ALIGNED |
| weekly_digests | PRD 7.1 | EXISTS (migration 006) | ALIGNED |
| naib_seats | PRD 7.1 | EXISTS (migration 005) | ALIGNED |
| notification_preferences | PRD 7.1 | EXISTS (migration 005) | ALIGNED |
| alert_history | PRD 7.1 | EXISTS (migration 005) | ALIGNED |

**Severity**: LOW - All claimed tables exist

### 5. Tier System Implementation

| Aspect | PRD Claim | Code Reality | Drift |
|--------|-----------|--------------|-------|
| 9 Tiers | PRD 2.1 | 9 tiers in TIER_THRESHOLDS | ALIGNED |
| Thresholds | PRD 2.1 | 6.9, 69, 222, 420, 690, 888, 1111 | ALIGNED |
| Naib (Top 7) | PRD 2.1 | Rank-based in calculateTier | ALIGNED |
| Fedaykin (Top 8-69) | PRD 2.1 | Rank-based in calculateTier | ALIGNED |

**Severity**: NONE - Tier system fully aligned

### 6. Trigger Task Export Status

| Task | File Exists | Exported in index.ts | Drift |
|------|-------------|---------------------|-------|
| syncEligibilityTask | YES | YES | ALIGNED |
| weeklyResetTask | YES | YES | ALIGNED |
| badgeCheckTask | YES | NO | CODE INCONSISTENT |
| activityDecayTask | YES | NO | CODE INCONSISTENT |

**Severity**: LOW - Tasks exist but not exported (may be intentional)

### 7. TierService Export Status

| Service | File Exists | Exported in services/index.ts | Drift |
|---------|-------------|------------------------------|-------|
| TierService | YES | NO | CODE INCONSISTENT |

**Severity**: LOW - Service exists but not exported in barrel file

## Drift Summary by Severity

### HIGH (Action Required)
1. **5 services not implemented**: SponsorService, DigestService, StoryService, StatsService, AnalyticsService
   - These are v3.0 planned features documented but not yet coded
   - PRD/SDD describes future state, not current reality

### MEDIUM (Track)
2. **/invite command not implemented**: Documented in PRD 6.1 but no code
3. **weeklyDigest task not implemented**: Documented in PRD 7.5 but no code

### LOW (Housekeeping)
4. **badgeCheckTask and activityDecayTask not exported** from trigger/index.ts
5. **TierService not exported** from services/index.ts

### NONE (Aligned)
- All database tables exist
- Tier system fully implemented
- Core commands implemented
- Core scheduled tasks implemented

## Root Cause Analysis

The drift pattern suggests PRD/SDD v3.0 represents a **planned roadmap** rather than **current implementation**:

- Sprint 15 is documented as implementing TierService (DONE)
- Subsequent sprints (16+) would implement SponsorService, DigestService, etc.
- Documentation is ahead of implementation

## Recommendations

1. **Update PRD/SDD** to distinguish between:
   - Implemented features (v2.1 + Sprint 15)
   - Planned features (Sprint 16+)

2. **Create sprint backlog** for:
   - SponsorService implementation
   - DigestService implementation
   - StoryService implementation
   - StatsService implementation
   - AnalyticsService implementation
   - /invite command
   - weeklyDigest task

3. **Fix export inconsistencies**:
   - Add TierService to services/index.ts
   - Add badgeCheckTask and activityDecayTask to trigger/index.ts (if needed)

# Sprint 9: Directory & Leaderboard - Implementation Report

**Sprint**: Sprint 9
**Status**: Implementation Complete
**Engineer**: Claude (sprint-task-implementer)
**Date**: 2025-12-18

## Summary

Sprint 9 implements the Directory & Leaderboard features for the Sietch Social Layer v2.0, including:
- Member directory browsing with filters and pagination
- Engagement leaderboard (ranked by badge count)
- Discord slash commands (`/directory`, `/leaderboard`)
- REST API endpoints for profiles, directory, badges, and admin operations

## Tasks Completed

### S9-T1: Directory Service Implementation
**File**: `sietch-service/src/services/directory.ts` (145 lines)

Created `DirectoryService` class with:
- `getDirectory(filters)` - Paginated member list with tier, badge, tenure filters
- `searchByNym(query, limit)` - Nym search for autocomplete
- `getStats()` - Directory statistics (total, naib, fedaykin counts)
- `getAvailableBadges()` - Get filterable badges
- `validateFilters(filters)` - Input validation

**Key Decisions**:
- Max page size capped at 50 to prevent abuse
- Default page size of 20 for reasonable UX
- Delegates to existing `getMemberDirectory` DB query

### S9-T2: Leaderboard Service Implementation
**File**: `sietch-service/src/services/leaderboard.ts` (150 lines)

Created `LeaderboardService` class with:
- `getLeaderboard(limit)` - Top N members by badge count, tie-breaker by tenure
- `getMemberRank(memberId)` - Get specific member's rank
- `isInTopTen(memberId)` - Quick check for role upgrades

**Key Decisions**:
- Badge count ranking with tenure as secondary sort
- Max limit of 100 entries
- Uses raw SQL for efficiency (single query with subquery)

### S9-T3: Directory Slash Command
**File**: `sietch-service/src/discord/commands/directory.ts` (280 lines)

Implemented `/directory` command with:
- Interactive ephemeral UI with pagination buttons
- Tier filter dropdown (All/Naib/Fedaykin)
- Sort dropdown (Name/Tenure/Badge Count)
- In-memory session state with 5-minute timeout
- Onboarding gate (must complete onboarding first)

**Interaction IDs**:
- `directory_prev`, `directory_next`, `directory_refresh` (buttons)
- `directory_tier`, `directory_sort` (select menus)

### S9-T4: Leaderboard Slash Command
**File**: `sietch-service/src/discord/commands/leaderboard.ts` (90 lines)

Implemented `/leaderboard` command with:
- Public response (visible to channel)
- Top 20 members by badge count
- Shows user's own rank if outside top 20
- Onboarding gate

### S9-T5: Directory Embeds
**File**: `sietch-service/src/discord/embeds/directory.ts` (200 lines)

Created embed builders:
- `buildDirectoryEmbed(result)` - Paginated member list
- `buildMemberPreviewEmbed(member)` - Member card
- `buildLeaderboardEmbed(entries)` - Leaderboard display
- `buildLeaderboardEntryEmbed(entry, total)` - Detailed member view
- `buildFilterOptionsEmbed(badges)` - Filter help

**Design**:
- Consistent emoji scheme (tier, tenure, rank medals)
- Color coding (teal for directory, gold/amber for leaderboard)

### S9-T6: REST API - Profile Endpoints
**File**: `sietch-service/src/api/routes.ts` (additions)

Added to `memberRouter`:
- `GET /api/profile` - Own profile (requires `X-Member-Nym` header)
- `GET /api/members/:nym` - Public profile by nym

**Security**:
- Returns only public profile data (no wallet correlation)
- Uses existing `profileService.getPublicProfile()`

### S9-T7: REST API - Directory & Badges Endpoints
**File**: `sietch-service/src/api/routes.ts` (additions)

Added to `memberRouter`:
- `GET /api/directory` - Paginated directory with filters
  - Query params: `page`, `page_size`, `tier`, `badge_id`, `tenure_category`, `sort_by`, `sort_dir`
  - Zod validation
- `GET /api/badges` - All badge definitions
- `GET /api/leaderboard` - Top N leaderboard entries
  - Query param: `limit` (1-100, default 20)

### S9-T8: REST API - Admin Badge Endpoints
**File**: `sietch-service/src/api/routes.ts` (additions)

Added to `adminRouter`:
- `POST /admin/badges/award` - Award badge to member
  - Body: `member_id`, `badge_id`, `awarded_by`, `reason?`
  - Audit logged
- `DELETE /admin/badges/:memberId/:badgeId` - Revoke badge
  - Audit logged

**Security**:
- Requires API key authentication
- UUID validation for member IDs
- Audit logging for all operations

### S9-T9: API Rate Limiting Extension
**File**: `sietch-service/src/api/middleware.ts` (additions)

Added `memberRateLimiter`:
- 60 requests per minute per IP
- Applied to all `/api/*` routes

## Files Modified

| File | Action | Lines |
|------|--------|-------|
| `src/services/directory.ts` | Created | 145 |
| `src/services/leaderboard.ts` | Created | 150 |
| `src/services/index.ts` | Modified | +3 |
| `src/discord/commands/directory.ts` | Created | 280 |
| `src/discord/commands/leaderboard.ts` | Created | 90 |
| `src/discord/commands/index.ts` | Modified | +15 |
| `src/discord/embeds/directory.ts` | Created | 200 |
| `src/discord/embeds/index.ts` | Modified | +7 |
| `src/services/discord.ts` | Modified | +50 |
| `src/api/routes.ts` | Modified | +280 |
| `src/api/middleware.ts` | Modified | +20 |
| `src/api/index.ts` | Modified | +2 |
| `src/api/server.ts` | Modified | +5 |
| `src/types/index.ts` | Modified | +2 |

**Total new code**: ~1,250 lines

## Verification

### TypeScript Compilation
```bash
npm run typecheck  # Passes
```

### API Endpoints Summary

**Public (member-facing)**:
- `GET /api/profile` - Own profile
- `GET /api/members/:nym` - Public profile
- `GET /api/directory` - Member directory
- `GET /api/badges` - Badge definitions
- `GET /api/leaderboard` - Engagement leaderboard

**Admin (API key required)**:
- `POST /admin/badges/award` - Award badge
- `DELETE /admin/badges/:memberId/:badgeId` - Revoke badge

### Discord Commands

| Command | Type | Privacy |
|---------|------|---------|
| `/directory` | Interactive | Ephemeral |
| `/leaderboard` | Static | Public |

## Security Considerations

1. **Privacy Protection**: All public APIs return only public profile data (no wallet addresses, no Discord IDs)
2. **Rate Limiting**: 60 req/min for member APIs, 30 req/min for admin APIs
3. **Input Validation**: Zod schemas validate all request bodies and query params
4. **UUID Validation**: Member IDs validated with regex
5. **Audit Logging**: New event types `admin_badge_award` and `admin_badge_revoke` for badge operations
6. **SQL Injection Prevention**: Parameterized queries via better-sqlite3
7. **CORS**: Added `X-Member-Nym` to allowed headers

## Test Suggestions

1. `/directory` command:
   - Verify pagination (prev/next buttons)
   - Test tier filter changes
   - Test sort order changes
   - Verify session timeout (5 minutes)

2. `/leaderboard` command:
   - Verify public visibility
   - Test "Your Position" field for non-top-20 users

3. REST API:
   - Test `/api/directory` with various filter combinations
   - Test `/api/leaderboard` limit parameter bounds
   - Test admin badge endpoints require API key
   - Verify rate limiting kicks in at 60 req/min

## Dependencies

No new dependencies added. Uses existing:
- discord.js (slash commands, embeds, buttons, select menus)
- express (REST API)
- zod (validation)
- better-sqlite3 (database)

## Notes for Review

1. The `/directory` command uses in-memory session state with automatic cleanup. This is intentional to avoid database overhead for ephemeral UI state.

2. Leaderboard ranking uses badge count as primary sort, with `created_at` (tenure) as tie-breaker. This matches the SDD specification.

3. Admin badge endpoints were added to the existing `adminRouter` to leverage existing API key authentication.

4. The `X-Member-Nym` header approach for profile API is temporary - future sprints may add JWT auth.

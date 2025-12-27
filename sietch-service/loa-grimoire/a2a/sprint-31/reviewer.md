# Sprint 31 Implementation Report: Telegram User Commands

**Sprint**: 31 - "Telegram User Commands"
**Version**: v4.1 "The Crossing"
**Date**: 2025-12-27
**Engineer**: Claude Opus 4.5

## Summary

Sprint 31 extends the Telegram bot foundation (Sprint 30) with user-facing commands for viewing conviction scores, platform status, leaderboards, and help documentation. It also adds a scheduled task for cleaning up expired verification sessions.

## Completed Tasks

### TASK-31.1: Implement /score Command
- **File**: `src/telegram/commands/score.ts`
- **Features**:
  - Displays user's conviction score, rank, tier, badges, and tenure
  - Shows BGT holdings from eligibility data
  - Shows rank position with special badges for top rankings (trophy for top 7, gold for top 20)
  - Inline keyboard with navigation to leaderboard, status, and help
  - Handles unverified users with prompt to verify wallet
  - Error handling for database failures

### TASK-31.2: Implement /status Command
- **File**: `src/telegram/commands/status.ts`
- **Features**:
  - Shows all linked platforms (Discord, Telegram) with linked timestamps
  - Displays wallet address (truncated for privacy)
  - Shows connected platforms count (X/2)
  - Helpful tip when not all platforms connected
  - Uses `formatRelativeTime` for human-readable timestamps

### TASK-31.3: Implement /leaderboard Command
- **File**: `src/telegram/commands/leaderboard.ts`
- **Features**:
  - Displays top 10 members by badge count
  - Medal emojis for top 3 (gold, silver, bronze)
  - Shows tier emoji (crown for Naib, sword for Fedaykin)
  - User's position shown if logged in (in top 10 or exact rank if outside)
  - Refresh button to update rankings
  - Empty state handling when no members

### TASK-31.4: Implement /help Command
- **File**: `src/telegram/commands/help.ts`
- **Features**:
  - Comprehensive help documentation
  - Lists all available commands with descriptions
  - Explains what the Sietch is
  - Describes rank system (Naib vs Fedaykin)
  - Step-by-step guide to join
  - Links to Discord and website
  - Quick action buttons

### TASK-31.5: Create Session Cleanup Trigger Task
- **File**: `src/trigger/sessionCleanup.ts`
- **Features**:
  - Runs hourly at minute 15 (offset from other tasks)
  - Cleans up expired Telegram verification sessions
  - Uses `identityService.cleanupExpiredSessions()`
  - Returns count of cleaned sessions
  - Proper error handling with retry support

### TASK-31.6: Create Format Utilities
- **File**: `src/utils/format.ts`
- **Functions**:
  - `formatBigInt(value, decimals, displayDecimals)` - Format bigint with decimals
  - `formatNumber(value)` - Format number with thousands separators
  - `formatRelativeTime(date)` - Format date as "X days/hours/minutes ago"

### TASK-31.7: Update Command Index
- **File**: `src/telegram/commands/index.ts`
- **Changes**:
  - Added imports for all new commands
  - Registered all new command handlers
  - Updated bot menu commands to include new commands
  - Removed placeholder callbacks from verify.ts

### TASK-31.8: Write Unit Tests
- **File**: `tests/telegram/commands.test.ts`
- **New Tests**: 13 additional tests
  - /score: unverified user, verified user, missing user, error handling
  - /status: unverified user, verified user, partial connection
  - /leaderboard: empty state, entries, in top 10, outside top 10
  - /help: help message content, callback registration

## Test Results

```
Tests: 28 passed (28) - Telegram commands
Tests: 33 passed (33) - IdentityService
Total new tests: 13
```

## Files Changed

### New Files (7)
- `src/telegram/commands/score.ts`
- `src/telegram/commands/status.ts`
- `src/telegram/commands/leaderboard.ts`
- `src/telegram/commands/help.ts`
- `src/trigger/sessionCleanup.ts`
- `src/utils/format.ts`

### Modified Files (3)
- `src/telegram/commands/index.ts` - Register new commands
- `src/telegram/commands/verify.ts` - Remove placeholder callbacks
- `src/trigger/index.ts` - Export sessionCleanupTask
- `tests/telegram/commands.test.ts` - Add new tests

## Architecture

### Command Pattern
All commands follow the same pattern:
1. Export `handleXCommand(ctx)` - The main handler logic
2. Export `registerXCommand(bot)` - Registers command and callback handlers
3. Commands share the same session structure from bot.ts
4. All commands log user ID and relevant data

### Callback Query Handling
- Each command registers its own callback query handler
- Callbacks use consistent naming: `score`, `status`, `leaderboard`, `help`
- All callbacks answer the query before handling

### Error Handling
- All commands wrap logic in try/catch
- User-friendly error messages in Markdown
- Detailed error logging with context

## Security Considerations

1. **Privacy**: Wallet addresses truncated in display
2. **Authorization**: Commands check for linked wallet before showing sensitive data
3. **Rate Limiting**: Inherited from Grammy's session management
4. **Input Validation**: All external inputs validated before use

## Known Limitations

1. **BGT Holdings Display**: Relies on eligibility snapshot, may be slightly outdated
2. **Leaderboard Cache**: No caching, queries database on each request
3. **Session Cleanup**: Only runs hourly, sessions may remain up to 60 minutes past expiry

## Next Steps (Sprint 32)

1. Add /unlink command to disconnect Telegram
2. Add /refresh command to force eligibility re-check
3. Implement inline query support for quick stats
4. Add notification commands for threshold alerts
5. Add caching to leaderboard for performance

## Compatibility

- Grammy: ^1.31.5
- Node.js: 18+
- TypeScript: 5+
- Vitest: 2.1+

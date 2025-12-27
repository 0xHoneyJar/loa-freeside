# Sprint 33: Alert Settings & Inline Queries - Implementation Report

**Sprint ID:** sprint-33
**Status:** IMPLEMENTATION COMPLETE
**Date:** 2025-12-27

## Objectives

Implement remaining Telegram bot features from Sprint 31/32 roadmap:
1. **TASK-33.1**: Implement `/alerts` command for notification preferences
2. **TASK-33.2**: Implement inline query support (`@SietchBot score`)
3. **TASK-33.3**: Update webhook `allowed_updates` to include `inline_query`
4. **TASK-33.4**: Write unit tests for new features

## Implementation Summary

### TASK-33.1: /alerts Command

**File:** `src/telegram/commands/alerts.ts` (391 lines)

Implements notification preference management for Telegram users:
- View current notification settings with status indicators
- Toggle position updates on/off
- Toggle at-risk warnings on/off
- Toggle naib alerts (visible only for Naib members)
- Change alert frequency (1x/2x/3x per week or daily)
- One-click "Disable All" button

**Features:**
- Integration with `notificationService` for preference persistence
- Integration with `naibService` to conditionally show Naib-specific options
- Interactive inline keyboard with toggle buttons
- Real-time message refresh after each preference change
- Frequency buttons with visual indicator for current selection

**Callback Handlers:**
- `alerts` - Show alerts menu
- `alerts_toggle_position_<memberId>` - Toggle position updates
- `alerts_toggle_atrisk_<memberId>` - Toggle at-risk warnings
- `alerts_toggle_naib_<memberId>` - Toggle naib alerts
- `alerts_freq_<frequency>_<memberId>` - Change frequency
- `alerts_disable_all_<memberId>` - Disable all alerts

### TASK-33.2: Inline Query Support

**File:** `src/telegram/inline.ts` (262 lines)

Enables users to query Sietch stats in any chat via `@SietchBot <query>`:

| Query | Description |
|-------|-------------|
| (empty) | Quick stats overview (all options) |
| `score` | Conviction score with tier, rank, BGT, badges |
| `rank` | Current rank with position description |
| `leaderboard` | Top 5 members by badge count |
| `top` | Alias for leaderboard |
| `help` | Usage instructions |

**Features:**
- Uses `InlineQueryResultBuilder` from Grammy for type-safe result construction
- Personalized results (`is_personal: true`) for authenticated queries
- 30-second cache TTL for performance
- Graceful fallback to help on errors or unknown queries
- Rich result cards with thumbnails and descriptions

### TASK-33.3: Webhook Configuration

**File:** `src/telegram/bot.ts` (modified)

Updated `allowed_updates` in webhook configuration:
```typescript
allowed_updates: ['message', 'callback_query', 'inline_query']
```

This enables Telegram to send inline query updates to the bot.

### TASK-33.4: Additional Modifications

**File:** `src/telegram/commands/index.ts`
- Registered `/alerts` command handler
- Registered inline query handler
- Added `alerts` to bot command menu

**File:** `src/telegram/commands/help.ts`
- Updated help message with inline query documentation

## Test Coverage

**File:** `tests/telegram/commands.test.ts`

Added 14 new test cases for Sprint 33:

### /alerts Command Tests (7 tests)
1. Shows not linked message for unverified users
2. Shows alert preferences for verified users
3. Shows naib alerts option for naib members
4. Handles missing user gracefully
5. Handles errors gracefully
6. Registers alerts command and callbacks
7. Has frequency buttons in keyboard

### Inline Query Tests (7 tests)
1. Registers inline query handler
2. Returns not verified result for unverified users
3. Returns score result for verified users on empty query
4. Returns leaderboard result on "leaderboard" query
5. Returns help result on "help" query
6. Returns help for unknown queries
7. Handles errors gracefully
8. Caches results with short TTL

**Results:** 56 tests passing

## Files Changed

| File | Action | Lines |
|------|--------|-------|
| `src/telegram/commands/alerts.ts` | Created | 391 |
| `src/telegram/inline.ts` | Created | 262 |
| `src/telegram/bot.ts` | Modified | +1 |
| `src/telegram/commands/index.ts` | Modified | +5 |
| `src/telegram/commands/help.ts` | Modified | +5 |
| `tests/telegram/commands.test.ts` | Modified | +420 |

**Total:** ~1,084 lines added/modified

## Dependencies

No new dependencies added. Uses existing:
- `grammy` - Telegram Bot Framework
- `notificationService` - Notification preferences
- `naibService` - Naib status checks
- `identityService` - User verification

## Verification

```bash
# TypeScript compilation
npm run build    # ✓ Passes

# Unit tests
npm run test:run -- tests/telegram/commands.test.ts
# 56 tests passing
```

## Next Steps (Future Sprints)

1. Telegram webhook endpoint deployment
2. Inline mode toggle in BotFather settings
3. End-to-end testing with real Telegram bot
4. Consider adding:
   - More inline query types (badges, history)
   - Alert preview before save
   - Notification delivery confirmation

## Security Considerations

- Member IDs in callback data prevent cross-user preference changes
- User identity verified via `identityService.getMemberByPlatformId()`
- No sensitive data exposed in inline query results
- Error messages sanitized (no stack traces)

---

**Ready for Review**

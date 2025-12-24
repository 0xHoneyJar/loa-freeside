# Discord Commands Reality

> Generated: 2025-12-24
> Source: Code Reality Extraction (Phase 2)

## Registered Commands (11 total)

| Command | File | Handler | Sprint |
|---------|------|---------|--------|
| /profile | `profile.ts` | handleProfileCommand | v2.0 |
| /badges | `badges.ts` | handleBadgesCommand + autocomplete | v2.0 |
| /stats | `stats.ts` | handleStatsCommand | v2.0 |
| /admin-badge | `admin-badge.ts` | handleAdminBadgeCommand + autocomplete | v2.0 |
| /directory | `directory.ts` | handleDirectoryCommand + button/select | v2.0 (S9) |
| /leaderboard | `leaderboard.ts` | handleLeaderboardCommand | v2.0 (S9) |
| /naib | `naib.ts` | handleNaibCommand | v2.1 (S11) |
| /threshold | `threshold.ts` | handleThresholdCommand | v2.1 (S12) |
| /register-waitlist | `register-waitlist.ts` | handleRegisterWaitlistCommand | v2.1 (S12) |
| /alerts | `alerts.ts` | handleAlertsCommand | v2.1 (S13) |
| /position | `position.ts` | handlePositionCommand | v2.1 (S13) |

## Commands NOT Found (PRD v3.0 Claims)

| Claimed Command | PRD Reference | Status |
|-----------------|---------------|--------|
| /invite | PRD 6.1 | NOT IMPLEMENTED |

## Command Registration

```typescript
// From discord/commands/index.ts
export const commands: RESTPostAPIChatInputApplicationCommandsJSONBody[] = [
  profileCommand,
  badgesCommand.toJSON(),
  statsCommand.toJSON(),
  adminBadgeCommand.toJSON(),
  directoryCommand.toJSON(),
  leaderboardCommand.toJSON(),
  naibCommand.toJSON(),
  thresholdCommand.toJSON(),
  registerWaitlistCommand.toJSON(),
  alertsCommand.toJSON(),
  positionCommand.toJSON(),
];
```

## Interactions

| Type | File | Handler |
|------|------|---------|
| Button | `directory.ts` | handleDirectoryButton |
| Select Menu | `directory.ts` | handleDirectorySelect |
| Autocomplete | `badges.ts` | handleBadgesAutocomplete |
| Autocomplete | `admin-badge.ts` | handleAdminBadgeAutocomplete |

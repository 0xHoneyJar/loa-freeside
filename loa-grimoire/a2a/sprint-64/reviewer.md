# Sprint 64 Implementation Report: Incumbent Health Monitoring

## Summary

Implemented comprehensive health monitoring system for incumbent token-gating bots (Collab.Land, Matrica, Guild.xyz) to detect degradation/outages and enable emergency backup activation.

## Files Created

### Core Components

1. **`sietch-service/src/packages/adapters/coexistence/IncumbentHealthMonitor.ts`** (~570 lines)
   - Main health monitoring class
   - Health check thresholds:
     - `BOT_ONLINE_ALERT_MS`: 1 hour (bot offline)
     - `ROLE_UPDATE_ALERT_MS`: 48 hours (stale role updates)
     - `ROLE_UPDATE_CRITICAL_MS`: 72 hours (very stale)
     - `CHANNEL_ACTIVITY_ALERT_MS`: 168 hours / 7 days (inactive verification channel)
     - `ALERT_THROTTLE_MS`: 4 hours (cooldown between alerts)
   - Key methods:
     - `checkHealth()` - Full health assessment for a community
     - `checkBotOnline()` - Bot presence verification via Discord API
     - `checkRoleUpdateFreshness()` - Role update timestamp tracking
     - `checkChannelActivity()` - Verification channel message activity
     - `activateEmergencyBackup()` - Shadow → Parallel mode transition
     - `checkAllCommunities()` - Batch health check for all monitored communities

2. **`sietch-service/src/packages/jobs/coexistence/IncumbentHealthJob.ts`** (~425 lines)
   - Scheduled job running hourly
   - Prevents concurrent runs
   - Processes all communities in monitoring-eligible modes (shadow, parallel, primary)
   - Returns detailed job result with counts (healthy, degraded, offline, alerts)
   - Includes `createHealthCheckTask()` for trigger.dev integration

3. **`sietch-service/src/discord/embeds/health-alert.ts`** (~340 lines)
   - Discord embed builders for health alerts
   - `createHealthAlertEmbed()` - Alert with action buttons
   - `createBackupConfirmationEmbed()` - Confirmation dialog
   - `createBackupSuccessEmbed()` - Success notification
   - `createBackupFailureEmbed()` - Error notification
   - `createHealthSummaryEmbed()` - Overview dashboard
   - `createHealthReportEmbed()` - Detailed single community report
   - Action buttons: "Activate Arrakis Backup", "View Details", "Dismiss"

### Test Files

4. **`sietch-service/tests/unit/packages/adapters/coexistence/IncumbentHealthMonitor.test.ts`** (~600 lines)
   - 21 tests covering:
     - Threshold constants verification
     - Health check scenarios (healthy, degraded, offline)
     - Bot online detection (online, offline, not found)
     - Role update freshness (fresh, stale 48h, critical 72h)
     - Channel activity tracking
     - Alert throttling (4 hour cooldown)
     - Emergency backup activation (success, mode validation, callback)
     - Dry run mode

5. **`sietch-service/tests/unit/packages/jobs/coexistence/IncumbentHealthJob.test.ts`** (~550 lines)
   - 20 tests covering:
     - Job lifecycle (start, stop, schedule)
     - Concurrent run prevention
     - Multi-community processing
     - Status counting
     - Alert tracking
     - Configuration options
     - trigger.dev task creator

## Files Modified

1. **`sietch-service/src/packages/adapters/storage/schema.ts`**
   - Added `incumbent_health_checks` table for historical health check records
   - Fields: communityId, overallStatus, botOnlinePassed, roleUpdatePassed, channelActivityPassed, alertSent, alertThrottled, alertSeverity, checkedAt

2. **`sietch-service/src/packages/core/ports/ICoexistenceStorage.ts`**
   - Added `updateIncumbentHealth()` method to interface
   - Added `UpdateHealthInput` type

3. **`sietch-service/src/packages/adapters/coexistence/index.ts`**
   - Exported IncumbentHealthMonitor and related types/constants

4. **`sietch-service/src/packages/jobs/coexistence/index.ts`**
   - Exported IncumbentHealthJob and related types

## Architecture Decisions

### Health Check Strategy
- **Three-tier health status**: healthy, degraded, offline
- **Multiple check types**: Bot presence, role updates, channel activity
- **Graceful degradation**: Any single check failing = degraded, bot offline = offline

### Alert Throttling
- In-memory Map for throttle tracking (no persistence needed)
- 4-hour cooldown prevents alert fatigue
- Severity-based: warning vs critical alerts

### Emergency Backup
- Only available from shadow mode
- Transitions to parallel mode (not full takeover)
- Requires explicit admin confirmation via Discord button
- Can be rolled back

## Test Results

```
Tests: 41 passed (41)
- IncumbentHealthMonitor: 21 tests
- IncumbentHealthJob: 20 tests
```

## Integration Points

1. **Discord Client** - Used for guild/member/channel fetching
2. **CoexistenceStorage** - Database operations for incumbent configs and migration states
3. **trigger.dev** - Optional integration for scheduled tasks via `createHealthCheckTask()`

## Security Considerations

1. **No credential exposure** - Uses existing Discord client authentication
2. **Rate limiting** - Hourly checks prevent API abuse
3. **Authorization** - Admin-only buttons for backup activation
4. **Audit trail** - Health checks stored in database

## Dependencies Added

None - uses existing dependencies (discord.js, drizzle-orm)

## Migration Required

Run database migration to create `incumbent_health_checks` table:
```bash
npm run db:generate
npm run db:migrate
```

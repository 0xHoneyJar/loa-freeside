# Sprint Plan: Sietch v2.1

**Version**: 2.1
**Date**: December 19, 2025
**PRD Reference**: `docs/prd-v2.1.md`
**SDD Reference**: `docs/sdd-v2.1.md`
**Codename**: Naib Dynamics & Threshold

---

## Sprint Overview

### Project Summary

Sietch v2.1 introduces the **Naib Dynamics & Threshold System** - a dynamic governance layer and waitlist visibility feature that rewards early adopters, creates competitive tension around eligibility boundaries, and provides transparency into who may be joining (or leaving) the community.

### Completed Work (v1.0 - v2.0)

The v1.0 MVP and v2.0 Social Layer are complete with:
- Chain service fetching BGT data from Berachain RPC
- SQLite database with eligibility snapshots and social layer tables
- REST API for Collab.Land integration
- Discord bot with profiles, badges, activity tracking, directory, leaderboard
- DM-based onboarding wizard with mandatory gating
- trigger.dev scheduled tasks (eligibility sync, activity decay, badge checks)
- Production deployment infrastructure

### v2.1 Scope: Naib Dynamics & Threshold

- **Dynamic Naib System** - First 7 eligible members get Naib seats, with BGT-based competition
- **Former Naib Recognition** - Historical recognition for members who held Naib seats
- **Naib Archives** - Private channel for current and Former Naib members
- **Cave Entrance (Public Waitlist)** - Public lobby for aspiring members (positions 70-100)
- **Taqwa Role** - Discord role for registered waitlist members ("those holding back")
- **Position Alert System** - Personalized notifications about ranking changes
- **At-Risk Warnings** - Private alerts for members in bottom 10%
- **Threshold Display** - Live statistics showing entry requirements

### Team Configuration

| Role | Responsibility |
|------|----------------|
| **AI-Assisted Developer** | Full-stack implementation with Claude Code |

### Sprint Configuration

- **Sprint Duration**: 2.5 days
- **Total Sprints**: 4 sprints (Sprint 11-14)
- **Review Cadence**: End of each sprint

---

## v2.1 Sprint Summary

| Sprint | Focus | Key Deliverables | Duration |
|--------|-------|------------------|----------|
| **Sprint 11** | Naib Foundation | Schema, NaibService, seat management, /naib command | 2.5 days |
| **Sprint 12** | Cave Entrance | ThresholdService, waitlist registration, Taqwa role, /threshold command | 2.5 days |
| **Sprint 13** | Notification System | NotificationService, alerts, preferences, /position & /alerts commands | 2.5 days |
| **Sprint 14** | Integration & Polish | Enhanced sync task, testing, Discord setup, deployment | 2.5 days |

---

## Sprint 11: Naib Foundation

**Goal**: Establish Naib seat management system with dynamic competition mechanics

**Duration**: 2.5 days

### Tasks

#### S11-T1: Database Schema Extension (Naib)

**Description**: Create database migration for Naib seat tracking and related tables.

**Acceptance Criteria**:
- [ ] Create `naib_seats` table with seat assignment history
- [ ] Create indexes for current Naib lookup (`idx_naib_current`)
- [ ] Create unique constraint for active seat per member
- [ ] Create unique constraint for one member per seat number (active)
- [ ] Add `is_former_naib` column to `member_profiles` table
- [ ] Create index for Former Naib lookup
- [ ] Migration is reversible

**Files to Create/Modify**:
- `sietch-service/src/db/migrations/005_naib_threshold.ts`
- `sietch-service/src/db/schema.ts` (extend)

**Dependencies**: None
**Estimated Effort**: Medium
**Testing**: Migration up/down tests

---

#### S11-T2: TypeScript Type Definitions (Naib)

**Description**: Define TypeScript interfaces for Naib domain objects.

**Acceptance Criteria**:
- [ ] `NaibSeat` interface with all seat record fields
- [ ] `NaibMember` interface (seat + profile + currentBgt)
- [ ] `BumpResult` interface for seat changes
- [ ] `NaibChange` type for seat evaluation results
- [ ] Export all interfaces from `types/index.ts`

**Files to Modify**:
- `sietch-service/src/types/index.ts`

**Dependencies**: S11-T1
**Estimated Effort**: Low
**Testing**: TypeScript compilation

---

#### S11-T3: Database Query Layer (Naib)

**Description**: Add database query functions for Naib seat management.

**Acceptance Criteria**:
- [ ] `insertNaibSeat()` - create new seat record
- [ ] `updateNaibSeat()` - update seat (for unseating)
- [ ] `getCurrentNaibSeats()` - get all active seats
- [ ] `getNaibSeatsByMember()` - get seat history for member
- [ ] `countActiveNaibSeats()` - count filled seats
- [ ] `getLowestBgtNaibSeat()` - get seat with lowest BGT holder
- [ ] `updateMemberFormerNaibStatus()` - mark member as Former Naib
- [ ] All queries use prepared statements

**Files to Modify**:
- `sietch-service/src/db/queries.ts`

**Dependencies**: S11-T1, S11-T2
**Estimated Effort**: Medium
**Testing**: Unit tests for each query

---

#### S11-T4: Naib Service Implementation

**Description**: Implement NaibService with seat management and bump logic.

**Acceptance Criteria**:
- [ ] `getCurrentNaib()` - returns current 7 Naib members with profiles
- [ ] `getFormerNaib()` - returns all Former Naib members with history
- [ ] `getMemberNaibHistory()` - returns seat history for specific member
- [ ] `isCurrentNaib()` - check if member currently holds seat
- [ ] `isFormerNaib()` - check if member was Naib but isn't currently
- [ ] `hasEverBeenNaib()` - check if member has any Naib history
- [ ] `getLowestNaibMember()` - get member with lowest BGT among Naib
- [ ] `getAvailableSeatCount()` - count empty seats (0-7)
- [ ] `seatMember()` - assign member to available seat
- [ ] `bumpMember()` - remove member from seat, mark as Former Naib
- [ ] `unseatMember()` - remove for non-bump reasons (left_server, ineligible)
- [ ] `evaluateNewMember()` - determine if new member gets seat or bumps someone
- [ ] `evaluateSeats()` - full seat evaluation during sync (handles BGT changes)
- [ ] Tie-breaker logic: tenure wins when BGT is equal

**Files to Create**:
- `sietch-service/src/services/naib.ts`

**Dependencies**: S11-T3
**Estimated Effort**: High
**Testing**: Unit tests for all bump scenarios, tenure tie-breakers

---

#### S11-T5: Role Manager Extension (Naib)

**Description**: Extend role manager to handle Naib and Former Naib Discord roles.

**Acceptance Criteria**:
- [ ] `assignNaibRole()` - assign @Naib, remove @Fedaykin
- [ ] `assignFormerNaibRole()` - assign @Former Naib + @Fedaykin, remove @Naib
- [ ] `removeNaibRole()` - remove @Naib, add @Fedaykin (non-bump demotion)
- [ ] Configuration for `DISCORD_ROLE_FORMER_NAIB` environment variable
- [ ] Graceful handling if roles don't exist yet

**Files to Modify**:
- `sietch-service/src/services/roleManager.ts`
- `sietch-service/src/config.ts`

**Dependencies**: S11-T4
**Estimated Effort**: Medium
**Testing**: Role assignment tests

---

#### S11-T6: Naib Slash Command

**Description**: Implement `/naib` command to view current and Former Naib.

**Acceptance Criteria**:
- [ ] `/naib` - shows current Naib members (numbered 1-7)
- [ ] Shows "Founding" indicator for inaugural Naib members
- [ ] Shows Former Naib section with member nyms
- [ ] Shows tenure information (when they joined)
- [ ] Public visibility (not ephemeral)
- [ ] Gold color for embed (#FFD700)

**Files to Create**:
- `sietch-service/src/discord/commands/naib.ts`
- `sietch-service/src/discord/embeds/naib.ts`

**Dependencies**: S11-T4
**Estimated Effort**: Medium
**Testing**: Command execution tests

---

#### S11-T7: Onboarding Integration (Naib Evaluation)

**Description**: Integrate Naib seat evaluation into onboarding completion flow.

**Acceptance Criteria**:
- [ ] After onboarding completion, evaluate if member should be Naib
- [ ] If seats < 7, auto-seat new member
- [ ] If seats = 7, compare BGT to lowest Naib and potentially bump
- [ ] Assign appropriate role (@Naib or @Fedaykin)
- [ ] If bump occurs, update roles for both members
- [ ] Log seat assignments and bumps

**Files to Modify**:
- `sietch-service/src/services/onboarding.ts`

**Dependencies**: S11-T4, S11-T5
**Estimated Effort**: Medium
**Testing**: Integration tests for onboarding + Naib flow

---

#### S11-T8: Naib REST API Endpoints

**Description**: Implement REST API endpoints for Naib data.

**Acceptance Criteria**:
- [ ] `GET /api/naib` - current Naib + Former Naib list (public)
- [ ] `GET /api/naib/history` - Naib seat change history (public)
- [ ] `GET /api/naib/member/:memberId` - Naib history for specific member (public)
- [ ] Response schemas match SDD specification
- [ ] Rate limiting applied (50 req/min)

**Files to Create**:
- `sietch-service/src/api/handlers/naib.ts`

**Files to Modify**:
- `sietch-service/src/api/routes.ts`

**Dependencies**: S11-T4
**Estimated Effort**: Low
**Testing**: API integration tests

---

### Sprint 11 Success Criteria

- [ ] Database migration creates Naib tables successfully
- [ ] NaibService correctly manages seat assignments and bumps
- [ ] Tenure tie-breaker works for equal BGT scenarios
- [ ] `/naib` command displays current and Former Naib
- [ ] New members evaluated for Naib seat during onboarding
- [ ] @Naib and @Former Naib roles assigned correctly
- [ ] All unit tests pass

---

## Sprint 12: Cave Entrance ✅ COMPLETE

**Goal**: Implement public waitlist lobby with threshold visibility and registration

**Duration**: 2.5 days
**Status**: COMPLETE (2025-12-20)

### Tasks

#### S12-T1: Database Schema Extension (Threshold) ✅

**Description**: Create database tables for waitlist and threshold tracking.

**Acceptance Criteria**:
- [x] Create `waitlist_registrations` table
- [x] Create `threshold_snapshots` table for historical tracking
- [x] Create indexes for wallet and Discord user lookups
- [x] Unique constraints on wallet_address and discord_user_id
- [x] Migration is reversible

**Files to Modify**:
- `sietch-service/src/db/migrations/005_naib_threshold.ts`

**Dependencies**: S11-T1
**Estimated Effort**: Medium
**Testing**: Migration tests

---

#### S12-T2: TypeScript Type Definitions (Threshold) ✅

**Description**: Define TypeScript interfaces for threshold and waitlist.

**Acceptance Criteria**:
- [x] `PositionDistance` interface (position, wallet, BGT, distances)
- [x] `ThresholdSnapshot` interface (entry threshold, waitlist data)
- [x] `WaitlistRegistration` interface
- [x] `ThresholdData` type for API responses
- [x] Export all interfaces from `types/index.ts`

**Files to Modify**:
- `sietch-service/src/types/index.ts`

**Dependencies**: S12-T1
**Estimated Effort**: Low
**Testing**: TypeScript compilation

---

#### S12-T3: Database Query Layer (Threshold) ✅

**Description**: Add database queries for threshold and waitlist management.

**Acceptance Criteria**:
- [x] `insertWaitlistRegistration()` - register for alerts
- [x] `getWaitlistRegistrationByDiscord()` - lookup by Discord ID
- [x] `getWaitlistRegistrationByWallet()` - lookup by wallet
- [x] `updateWaitlistNotified()` - mark as notified
- [x] `deleteWaitlistRegistration()` - unregister
- [x] `getActiveWaitlistRegistrations()` - all non-notified registrations
- [x] `insertThresholdSnapshot()` - save snapshot
- [x] `getLatestThresholdSnapshot()` - get most recent
- [x] `getThresholdSnapshots()` - historical data with limit

**Files to Modify**:
- `sietch-service/src/db/queries.ts`

**Dependencies**: S12-T1, S12-T2
**Estimated Effort**: Medium
**Testing**: Unit tests for queries

---

#### S12-T4: Threshold Service Implementation ✅

**Description**: Implement ThresholdService for waitlist and distance calculations.

**Acceptance Criteria**:
- [x] `getEntryThreshold()` - returns BGT of position 69
- [x] `getWaitlistPositions()` - returns positions 70-100 with distances
- [x] `getMemberDistances()` - returns distance to above/below for member
- [x] `calculateDistances()` - compute all distances from eligibility list
- [x] `saveSnapshot()` - save threshold data to database
- [x] `getLatestSnapshot()` - retrieve most recent snapshot
- [x] `registerWaitlist()` - register wallet for alerts (validates position 70-100)
- [x] `unregisterWaitlist()` - remove registration
- [x] `getRegistration()` - lookup by Discord ID
- [x] `getRegistrationByWallet()` - lookup by wallet
- [x] `checkWaitlistEligibility()` - find newly eligible waitlist members
- [x] `markNotified()` - mark registration as notified
- [x] Efficient distance calculation algorithm

**Files to Create**:
- `sietch-service/src/services/threshold.ts`

**Dependencies**: S12-T3
**Estimated Effort**: High
**Testing**: Unit tests for distance calculations, registration validation

---

#### S12-T5: Taqwa Role Management ✅

**Description**: Create and manage the @Taqwa role for waitlist members.

**Acceptance Criteria**:
- [x] Configuration for `DISCORD_ROLE_TAQWA` environment variable
- [x] `assignTaqwaRole()` - assign role when registering for waitlist
- [x] `removeTaqwaRole()` - remove when unregistering or becoming eligible
- [x] Role grants access to Cave Entrance channels only
- [x] Graceful handling if role doesn't exist

**Files to Modify**:
- `sietch-service/src/services/roleManager.ts`
- `sietch-service/src/config.ts`

**Dependencies**: S12-T4
**Estimated Effort**: Low
**Testing**: Role assignment tests

---

#### S12-T6: Threshold Slash Command ✅

**Description**: Implement `/threshold` command to view entry requirements.

**Acceptance Criteria**:
- [x] `/threshold` - shows current entry threshold BGT amount
- [x] Shows top 5 waitlist positions with distances to entry
- [x] Shows last updated timestamp
- [x] Public visibility (not ephemeral)
- [x] Desert brown color for embed (#8B4513)

**Files to Create**:
- `sietch-service/src/discord/commands/threshold.ts`
- `sietch-service/src/discord/embeds/threshold.ts`

**Dependencies**: S12-T4
**Estimated Effort**: Medium
**Testing**: Command execution tests

---

#### S12-T7: Register Waitlist Slash Command ✅

**Description**: Implement `/register-waitlist` command for eligibility alerts.

**Acceptance Criteria**:
- [x] `/register-waitlist <wallet>` - registers wallet for alerts
- [x] Validates wallet address format (0x...)
- [x] Validates wallet is in positions 70-100
- [x] Rejects if wallet already associated with member
- [x] Rejects if Discord user already registered
- [x] Shows current position and distance to entry on success
- [x] Assigns @Taqwa role on successful registration
- [x] Ephemeral response (private to user)

**Files to Create**:
- `sietch-service/src/discord/commands/register-waitlist.ts`

**Dependencies**: S12-T4, S12-T5
**Estimated Effort**: Medium
**Testing**: Command validation tests

---

#### S12-T8: Threshold REST API Endpoints ✅

**Description**: Implement REST API endpoints for threshold and waitlist.

**Acceptance Criteria**:
- [x] `GET /api/threshold` - current threshold + waitlist positions (public)
- [x] `GET /api/threshold/history` - historical threshold data (public)
- [x] `POST /api/waitlist/register` - register for alerts (Discord OAuth) - *via Discord command*
- [x] `DELETE /api/waitlist/register` - unregister (Discord OAuth) - *via Discord command*
- [x] `GET /api/waitlist/status/:wallet` - check registration status (public)
- [x] Response schemas match SDD specification
- [x] Rate limiting: 5 req/hour for registration

**Files to Create**:
- `sietch-service/src/api/handlers/threshold.ts`
- `sietch-service/src/api/handlers/waitlist.ts`

**Files to Modify**:
- `sietch-service/src/api/routes.ts`

**Dependencies**: S12-T4
**Estimated Effort**: Medium
**Testing**: API integration tests

---

#### S12-T9: Discord Channel Configuration (Cave Entrance) ✅

**Description**: Configure Discord channels for Cave Entrance visibility.

**Acceptance Criteria**:
- [x] Document channel structure for Cave Entrance category
- [x] `#the-threshold` - read-only for @everyone, live stats
- [x] `#waiting-pool` - discussion for aspiring members
- [x] `#register-interest` - bot command channel
- [x] Configuration for channel IDs in environment
- [x] Permission matrix documented

**Files to Modify**:
- `sietch-service/src/config.ts`
- `.env.example`

**Dependencies**: None
**Estimated Effort**: Low
**Testing**: Permission verification

---

### Sprint 12 Success Criteria ✅

- [x] ThresholdService calculates accurate distances
- [x] Waitlist registration validates position 70-100
- [x] `/threshold` shows live entry requirements
- [x] `/register-waitlist` works for valid wallets
- [x] @Taqwa role assigned to registered waitlist members
- [x] Cave Entrance channel permissions configured
- [x] All unit tests pass

---

## Sprint 13: Notification System

**Goal**: Implement position alerts, at-risk warnings, and notification preferences

**Duration**: 2.5 days

### Tasks

#### S13-T1: Database Schema Extension (Notifications)

**Description**: Create database tables for notification preferences and history.

**Acceptance Criteria**:
- [ ] Create `notification_preferences` table with all preference fields
- [ ] Create `alert_history` table for audit trail
- [ ] Create indexes for member lookups and alert type queries
- [ ] Default values: position_updates ON, 3_per_week frequency
- [ ] Migration is reversible

**Files to Modify**:
- `sietch-service/src/db/migrations/005_naib_threshold.ts`

**Dependencies**: S12-T1
**Estimated Effort**: Medium
**Testing**: Migration tests

---

#### S13-T2: TypeScript Type Definitions (Notifications)

**Description**: Define TypeScript interfaces for notification system.

**Acceptance Criteria**:
- [ ] `AlertType` union type (position_update, at_risk_warning, naib_threat, etc.)
- [ ] `NotificationPreferences` interface
- [ ] `AlertRecord` interface for history
- [ ] `AlertFrequency` type ('1_per_week' | '2_per_week' | '3_per_week' | 'daily')
- [ ] Export all interfaces from `types/index.ts`

**Files to Modify**:
- `sietch-service/src/types/index.ts`

**Dependencies**: S13-T1
**Estimated Effort**: Low
**Testing**: TypeScript compilation

---

#### S13-T3: Database Query Layer (Notifications)

**Description**: Add database queries for notification management.

**Acceptance Criteria**:
- [ ] `getNotificationPreferences()` - get member preferences
- [ ] `upsertNotificationPreferences()` - create or update preferences
- [ ] `insertAlertRecord()` - log alert sent
- [ ] `getAlertHistory()` - get alerts for member
- [ ] `countAlertsThisWeek()` - for rate limiting
- [ ] `resetWeeklyAlertCounters()` - batch reset for new week
- [ ] `getMembersForPositionAlerts()` - get eligible members

**Files to Modify**:
- `sietch-service/src/db/queries.ts`

**Dependencies**: S13-T1, S13-T2
**Estimated Effort**: Medium
**Testing**: Unit tests for queries

---

#### S13-T4: Notification Service Implementation

**Description**: Implement NotificationService with all alert types and rate limiting.

**Acceptance Criteria**:
- [ ] `getPreferences()` - get or create default preferences
- [ ] `updatePreferences()` - update member preferences
- [ ] `canSendAlert()` - check rate limits and preferences
- [ ] `sendPositionUpdate()` - send position distance DM
- [ ] `sendAtRiskWarning()` - send bottom 10% warning DM
- [ ] `sendNaibThreat()` - send seat-at-risk alert to Naib
- [ ] `sendBumpNotification()` - notify bumped member
- [ ] `sendNaibSeated()` - congratulate new Naib member
- [ ] `sendWaitlistEligible()` - notify waitlist member of eligibility
- [ ] `processPositionAlerts()` - batch send position updates
- [ ] `recordAlertSent()` - log to history and update counter
- [ ] `resetWeeklyCounters()` - reset all member counters
- [ ] Alert templates match SDD message formats

**Files to Create**:
- `sietch-service/src/services/notification.ts`

**Dependencies**: S13-T3
**Estimated Effort**: High
**Testing**: Unit tests for rate limiting, alert sending

---

#### S13-T5: Alert Message Templates

**Description**: Create Discord embed builders for all alert types.

**Acceptance Criteria**:
- [ ] Position update embed with distances
- [ ] At-risk warning embed with threat info
- [ ] Naib threat embed with lowest BGT
- [ ] Bump notification embed (demotion to Former Naib)
- [ ] Naib seated embed (congratulations)
- [ ] Waitlist eligible embed with onboarding button
- [ ] Consistent styling and branding
- [ ] Action buttons (Manage Alerts, Disable, etc.)

**Files to Create**:
- `sietch-service/src/discord/embeds/alerts.ts`

**Dependencies**: S13-T4
**Estimated Effort**: Medium
**Testing**: Visual verification

---

#### S13-T6: Position Slash Command

**Description**: Implement `/position` command for own position info.

**Acceptance Criteria**:
- [ ] `/position` - shows own position relative to above/below
- [ ] Shows distance to move up (BGT needed)
- [ ] Shows distance from position below (how close they are)
- [ ] Indicates if member is Naib or Fedaykin
- [ ] Ephemeral response (private to user)
- [ ] Footer with link to /alerts

**Files to Create**:
- `sietch-service/src/discord/commands/position.ts`

**Dependencies**: S12-T4, S13-T4
**Estimated Effort**: Medium
**Testing**: Command execution tests

---

#### S13-T7: Alerts Slash Command

**Description**: Implement `/alerts` command for notification preferences.

**Acceptance Criteria**:
- [ ] `/alerts` - shows current notification settings
- [ ] Toggle buttons for Position Updates, At-Risk Warnings
- [ ] Toggle for Naib Alerts (only shown to Naib members)
- [ ] Select menu for frequency (1/week, 2/week, 3/week, daily)
- [ ] Persists changes to database
- [ ] Ephemeral response (private to user)

**Files to Create**:
- `sietch-service/src/discord/commands/alerts.ts`
- `sietch-service/src/discord/interactions/alerts.ts`

**Dependencies**: S13-T4
**Estimated Effort**: High
**Testing**: Interaction flow tests

---

#### S13-T8: Notification REST API Endpoints

**Description**: Implement REST API endpoints for notification management.

**Acceptance Criteria**:
- [ ] `GET /api/notifications/preferences` - get own preferences (auth)
- [ ] `PUT /api/notifications/preferences` - update preferences (auth)
- [ ] `GET /api/notifications/history` - get own alert history (auth)
- [ ] `GET /api/position` - get own position distances (auth)
- [ ] Response schemas match SDD specification
- [ ] Rate limiting: 10 req/min for preferences

**Files to Create**:
- `sietch-service/src/api/handlers/notifications.ts`
- `sietch-service/src/api/handlers/position.ts`

**Files to Modify**:
- `sietch-service/src/api/routes.ts`

**Dependencies**: S13-T4
**Estimated Effort**: Medium
**Testing**: API integration tests

---

#### S13-T9: Admin Alert Endpoints

**Description**: Implement admin endpoints for alert management.

**Acceptance Criteria**:
- [ ] `GET /admin/alerts/stats` - alert delivery statistics (admin key)
- [ ] `PUT /admin/config/at-risk-threshold` - configure threshold (admin key)
- [ ] `POST /admin/alerts/test/:memberId` - send test alert (admin key)
- [ ] Statistics include: total sent, by type, delivery rate, opt-out rate

**Files to Create**:
- `sietch-service/src/api/handlers/admin-alerts.ts`

**Files to Modify**:
- `sietch-service/src/api/routes.ts`

**Dependencies**: S13-T4
**Estimated Effort**: Low
**Testing**: Admin API tests

---

### Sprint 13 Success Criteria

- [ ] NotificationService sends all alert types correctly
- [ ] Rate limiting respects frequency preferences
- [ ] `/position` shows accurate distance information
- [ ] `/alerts` allows preference configuration
- [ ] Alert history tracked in database
- [ ] Admin can view statistics and send test alerts
- [ ] All unit tests pass

---

## Sprint 14: Integration & Polish ✅ COMPLETE

**Goal**: Integrate all systems, enhance sync task, comprehensive testing, deployment

**Duration**: 2.5 days
**Status**: COMPLETE (2025-12-20)

### Tasks

#### S14-T1: Enhanced Eligibility Sync Task

**Description**: Extend 6-hour sync task to include Naib and threshold processing.

**Acceptance Criteria**:
- [x] Evaluate Naib seats during sync (handle BGT changes)
- [x] Process bumps and role updates
- [x] Calculate and save threshold snapshot
- [x] Check waitlist for newly eligible members
- [x] Send waitlist eligibility notifications
- [x] Process position alerts (respecting rate limits)
- [x] Send at-risk warnings to bottom 10%
- [x] Comprehensive logging of all changes
- [x] Error handling with retries

**Files to Modify**:
- `sietch-service/src/trigger/syncEligibility.ts`

**Dependencies**: S11-T4, S12-T4, S13-T4
**Estimated Effort**: High
**Testing**: Integration tests for full sync flow

---

#### S14-T2: Weekly Counter Reset Task ✅

**Description**: Create scheduled task to reset weekly alert counters.

**Acceptance Criteria**:
- [x] Runs every Monday at 00:00 UTC
- [x] Resets `alerts_sent_this_week` for all members
- [x] Updates `week_start_timestamp`
- [x] Logs count of members reset
- [x] Error handling

**Files to Create**:
- `sietch-service/src/trigger/weeklyReset.ts`

**Dependencies**: S13-T4
**Estimated Effort**: Low
**Testing**: Task execution test

---

#### S14-T3: Discord Channel Setup & Permissions

**Description**: Configure all Discord channels with proper role permissions.

**Acceptance Criteria**:
- [ ] Cave Entrance category created with channels
- [ ] `#the-threshold` - @everyone view, no send (read-only)
- [ ] `#waiting-pool` - @everyone view and send
- [ ] `#register-interest` - @everyone view, slash commands only
- [ ] Naib Chamber - @Naib only view and send
- [ ] Naib Archives - @Naib + @Former Naib view and send
- [ ] All existing channels require @Fedaykin or higher
- [ ] @Taqwa role has Cave Entrance access only
- [ ] Permission matrix documented

**Dependencies**: S11-T5, S12-T5
**Estimated Effort**: Medium
**Testing**: Permission verification
**Note**: Manual Discord configuration required at deployment

---

#### S14-T4: Configuration Extension ✅

**Description**: Extend config with all v2.1 environment variables.

**Acceptance Criteria**:
- [x] Naib configuration (seat count, tiebreaker)
- [x] Alert configuration (at-risk threshold, default frequency)
- [x] Waitlist configuration (range start/end)
- [x] Discord channel IDs for Cave Entrance and Naib areas
- [x] Discord role IDs (@Former Naib, @Taqwa)
- [x] Update `.env.example` with all new variables
- [x] Configuration validation on startup

**Files to Modify**:
- `sietch-service/src/config.ts`
- `.env.example`

**Dependencies**: All previous sprints
**Estimated Effort**: Low
**Testing**: Config loading tests
**Note**: Already configured in Sprint 12-13

---

#### S14-T5: Command Registration Update ✅

**Description**: Register all new slash commands with Discord.

**Acceptance Criteria**:
- [x] `/naib` command registered
- [x] `/threshold` command registered
- [x] `/position` command registered
- [x] `/alerts` command registered
- [x] `/register-waitlist` command registered
- [x] Commands available in Discord
- [x] Command descriptions and options correct

**Files to Modify**:
- `sietch-service/src/discord/commands/index.ts`

**Dependencies**: All command implementations
**Estimated Effort**: Low
**Testing**: Command availability verification

---

#### S14-T6: Comprehensive Unit Tests ✅

**Description**: Write unit tests for all new services.

**Acceptance Criteria**:
- [x] NaibService tests (seat management, bump logic, tie-breakers)
- [x] ThresholdService tests (distance calculation, registration)
- [x] NotificationService tests (rate limiting, preference checks)
- [x] Database query tests
- [x] Edge case coverage (empty seats, all seats full, ties)
- [x] Test coverage > 80%

**Files to Create**:
- `sietch-service/tests/integration/naib.test.ts`
- `sietch-service/tests/integration/threshold.test.ts`
- `sietch-service/tests/integration/notification.test.ts`

**Dependencies**: All service implementations
**Estimated Effort**: High
**Testing**: Test runner

---

#### S14-T7: Integration Tests ✅

**Description**: Write integration tests for complete flows.

**Acceptance Criteria**:
- [x] New member onboarding with Naib seat assignment
- [x] Bump scenario (high BGT member joins)
- [x] Bump during sync (BGT changes)
- [x] Former Naib re-entry scenario
- [x] Waitlist registration and eligibility notification
- [x] Position alert batch processing
- [x] At-risk warning delivery
- [x] Privacy leak detection (no wallet in responses)

**Files to Create**:
- `sietch-service/tests/integration/naib-flow.test.ts`
- `sietch-service/tests/integration/threshold-flow.test.ts`
- `sietch-service/tests/integration/notification-flow.test.ts`

**Dependencies**: S14-T1
**Estimated Effort**: High
**Testing**: Test runner

---

#### S14-T8: Documentation Update

**Description**: Update deployment documentation for v2.1.

**Acceptance Criteria**:
- [ ] Update PRE_DEPLOYMENT_CHECKLIST.md with new env vars
- [ ] Update DEPLOYMENT_RUNBOOK.md with v2.1 steps
- [ ] Document Discord role and channel setup
- [ ] Document Naib seat mechanics
- [ ] Document notification system configuration
- [ ] Create rollback procedure for v2.1 migration
- [ ] Update backup script for new tables

**Files to Modify**:
- `sietch-service/docs/deployment/PRE_DEPLOYMENT_CHECKLIST.md`
- `sietch-service/docs/deployment/DEPLOYMENT_RUNBOOK.md`

**Dependencies**: All previous sprints
**Estimated Effort**: Medium
**Testing**: Documentation review

---

#### S14-T9: Final Integration & Smoke Testing

**Description**: End-to-end testing on staging environment.

**Acceptance Criteria**:
- [ ] Deploy to staging environment
- [ ] Test Naib seat assignment during onboarding
- [ ] Test bump scenario with role changes
- [ ] Test waitlist registration and alerts
- [ ] Test position and alerts commands
- [ ] Test notification preferences
- [ ] Verify threshold display accuracy
- [ ] Verify privacy (no wallet leaks)
- [ ] Performance under load
- [ ] All Discord channels and permissions working

**Dependencies**: All previous tasks
**Estimated Effort**: High
**Testing**: Staging verification

---

### Sprint 14 Success Criteria

- [x] Enhanced sync task processes Naib, threshold, and notifications
- [x] Weekly reset task functioning
- [ ] All Discord channels and permissions configured (manual at deployment)
- [x] All slash commands registered and working
- [x] Unit test coverage > 80%
- [x] All integration tests pass
- [ ] Documentation updated (S14-T8, S14-T9 at deployment)
- [x] Ready for production deployment

---

## Risk Assessment

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Naib gaming (coordinated BGT movements) | Medium | Medium | Tenure tie-breaker, no advance warning of exact thresholds |
| Alert fatigue causing opt-outs | High | Medium | Configurable frequency, clear opt-out, non-spammy defaults |
| Privacy leak (correlating at-risk members) | Low | Critical | All at-risk info is private DM only, never public |
| Waitlist spam (fake registrations) | Medium | Low | Rate limiting, must be in positions 70-100, @Taqwa role |
| Complex bump scenarios during sync | Medium | Medium | Comprehensive testing, transaction-safe database operations |
| Discord API rate limits during batch alerts | Medium | Medium | Queue alerts, spread over time, respect rate limits |

---

## Dependencies

### External Dependencies
- Discord server with proper permissions
- Existing v2.0 Sietch service (profiles, badges, activity)
- trigger.dev project (existing)
- Berachain RPC access (existing)

### Sprint Dependencies
- Sprint 12 depends on Sprint 11 (database migration shared)
- Sprint 13 depends on Sprint 12 (threshold service for distances)
- Sprint 14 depends on Sprints 11-13 (integration)

---

## Success Metrics

| Metric | Target | Measurement Point |
|--------|--------|------------------|
| Naib seat assignment accuracy | 100% | End of Sprint 11 |
| Threshold distance accuracy | 100% | End of Sprint 12 |
| Alert delivery rate | >95% | End of Sprint 13 |
| Opt-in retention (30 days) | >70% | Post-launch |
| Unit test coverage | >80% | End of Sprint 14 |
| Zero privacy leaks | 0 | Continuous |
| All slash commands functional | 100% | End of Sprint 14 |

---

## Discord Role Hierarchy (v2.1)

| Role | Color | Permissions | Granted By |
|------|-------|-------------|------------|
| `@Naib` | Gold (#FFD700) | Naib Chamber, Naib Archives, all member channels | NaibService (BGT-based) |
| `@Former Naib` | Silver (#C0C0C0) | Naib Archives, all member channels (implies @Fedaykin) | NaibService (after bump) |
| `@Fedaykin` | Blue (#4169E1) | All member channels | Collab.Land (top 69) |
| `@Taqwa` | Sand (#C2B280) | Cave Entrance channels only | Waitlist registration |
| `@Engaged` | Green | #deep-desert | BadgeService (5+ badges) |
| `@Veteran` | Purple | #stillsuit-lounge | BadgeService (90+ days) |

---

## Channel Structure (v2.1)

```
SIETCH SERVER
│
├── 🚪 CAVE ENTRANCE (Public - @everyone + @Taqwa)
│   ├── #the-threshold ───── Live waitlist stats (read-only)
│   ├── #waiting-pool ────── Aspiring member discussion
│   └── #register-interest ─ Waitlist registration commands
│
├── 📜 STILLSUIT (Members - @Fedaykin+)
│   ├── #water-discipline ── Welcome, rules
│   ├── #census ──────────── Live leaderboard
│   └── #the-door ────────── Member joins/departures
│
├── 🏛️ NAIB CHAMBER (@Naib only)
│   └── #naib-council ────── Current Naib private discussion
│
├── 🏛️ NAIB ARCHIVES (@Naib + @Former Naib)
│   └── #naib-archives ───── All who have served
│
├── 💬 SIETCH-COMMONS (@Fedaykin+)
│   ├── #general
│   ├── #spice
│   ├── #water-shares
│   └── #introductions
│
├── 🏜️ DEEP DESERT (@Engaged+)
│   └── #deep-desert
│
├── 🧘 STILLSUIT LOUNGE (@Veteran+)
│   └── #stillsuit-lounge
│
└── 🛠️ WINDTRAP (@Fedaykin+)
    ├── #support
    └── #bot-commands
```

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2025-12-17 | Initial MVP sprint plan (Sprints 1-5) |
| 2.0 | 2025-12-18 | Social Layer sprint plan (Sprints 6-10) |
| 2.1 | 2025-12-19 | Naib Dynamics & Threshold sprint plan (Sprints 11-14) |

---

## Completed Sprints

### v1.0 (MVP)
- Sprint 1: Foundation & Chain Service ✅
- Sprint 2: REST API & Scheduled Task ✅
- Sprint 3: Discord Bot & Server Setup ✅
- Sprint 4: Collab.Land Integration & Deployment ✅
- Sprint 5: Notifications & Documentation ✅

### v2.0 (Social Layer)
- Sprint 6: Foundation & Database ✅
- Sprint 7: Onboarding & Core Identity ✅
- Sprint 8: Activity & Badges ✅
- Sprint 9: Directory & Leaderboard ✅
- Sprint 10: Integration & Polish ✅

---

*Document generated by Sprint Planner*

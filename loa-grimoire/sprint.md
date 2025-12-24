# Sprint Plan: Sietch v3.0 "The Great Expansion"

**Version**: 3.0
**Date**: December 20, 2025
**PRD Reference**: `docs/prd.md`
**SDD Reference**: `docs/sdd.md`
**Codename**: The Great Expansion

---

## Sprint Overview

### Project Summary

Sietch v3.0 "The Great Expansion" transforms Sietch from an exclusive 69-member community into a **layered sanctuary** supporting 500+ members across 9 tiers. The system maintains the privacy-first, never-redeemed purity requirement while dramatically expanding participation.

### Completed Work (v1.0 - v2.1)

The v1.0 MVP, v2.0 Social Layer, and v2.1 Naib Dynamics are complete with:
- Chain service fetching BGT data from Berachain RPC
- SQLite database with eligibility snapshots and social layer tables
- REST API for Collab.Land integration
- Discord bot with profiles, badges, activity tracking, directory, leaderboard
- DM-based onboarding wizard with mandatory gating
- trigger.dev scheduled tasks (eligibility sync, activity decay, badge checks)
- Naib seat management with bump mechanics
- Cave Entrance waitlist with @Taqwa role
- Position alerts and notification preferences
- Production deployment infrastructure

### v3.0 Scope: The Great Expansion

- **9-Tier System** - Hajra (6.9 BGT) through Naib (Top 7) with progressive access
- **Automatic Tier Assignment** - BGT balance and rank-based calculation
- **Sponsor Invites** - Water Sharer badge enables sponsoring one member
- **Tier Notifications** - DM alerts on tier promotion
- **Weekly Digest** - Community pulse posted to #announcements every Monday
- **Story Fragments** - Cryptic Dune-themed narratives for elite joins
- **Analytics Dashboard** - Admin visibility into community health
- **Enhanced Stats** - Personal /stats command and tier leaderboard

### Team Configuration

| Role | Responsibility |
|------|----------------|
| **AI-Assisted Developer** | Full-stack implementation with Claude Code |

### Sprint Configuration

- **Sprint Duration**: 2.5 days
- **Total Sprints**: 8 sprints (Sprint 15-22)
- **Review Cadence**: End of each sprint

---

## v3.0 Sprint Summary

| Sprint | Focus | Key Deliverables | Duration |
|--------|-------|------------------|----------|
| **Sprint 15** | Tier Foundation | Schema migration, TierService, type definitions | 2.5 days |
| **Sprint 16** | Tier Integration | Role management, sync integration, initial assignment | 2.5 days |
| **Sprint 17** | Sponsor System | Water Sharer badge, SponsorService, /invite command | 2.5 days |
| **Sprint 18** | Notifications | Tier promotions, badge awards, Usul Ascended badge | 2.5 days |
| **Sprint 19** | Stats & Leaderboard | StatsService, /stats command, /leaderboard tiers | 2.5 days |
| **Sprint 20** | Weekly Digest | DigestService, scheduled task, API stats endpoints | 2.5 days |
| **Sprint 21** | Stories & Analytics | StoryService, fragments, admin analytics, profile updates | 2.5 days |
| **Sprint 22** | Testing & Release | Integration tests, permissions, docs, security audit, deploy | 2.5 days |

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
| 3.0 | 2025-12-20 | The Great Expansion sprint plan (Sprints 15-22) |

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

### v2.1 (Naib Dynamics & Threshold)
- Sprint 11: Naib Foundation ✅
- Sprint 12: Cave Entrance ✅
- Sprint 13: Notification System ✅
- Sprint 14: Integration & Polish ✅

---

# v3.0 Sprint Details

---

## Sprint 15: Tier Foundation

**Goal**: Database schema and TierService implementation

**Duration**: 2.5 days

### Tasks

#### S15-T1: Database Migration
**Description**: Create migration 006_tier_system.sql with all new tables and columns

**Acceptance Criteria**:
- [ ] `tier` column added to `member_profiles` (default: 'hajra')
- [ ] `tier_updated_at` column added to `member_profiles`
- [ ] `tier_history` table created with proper indexes
- [ ] `sponsor_invites` table created with proper indexes
- [ ] `story_fragments` table created
- [ ] `weekly_digests` table created
- [ ] Migration runs without errors on existing data
- [ ] Rollback script documented

**Files to Create/Modify**:
- `sietch-service/src/db/migrations/006_tier_system.sql`

**Estimated Effort**: 0.5 days
**Dependencies**: None
**Testing**: Run migration on test database; verify schema

---

#### S15-T2: Type Definitions
**Description**: Add TypeScript types for tier system

**Acceptance Criteria**:
- [ ] `Tier` union type defined with all 9 tiers
- [ ] `TierHistoryEntry` interface defined
- [ ] `SponsorInvite` interface defined
- [ ] `StoryFragment` interface defined
- [ ] `WeeklyDigest` interface defined
- [ ] `TierProgress` interface defined
- [ ] `PersonalStats` interface defined
- [ ] `AdminAnalytics` interface defined
- [ ] All types exported from `src/types/index.ts`

**Files to Modify**:
- `sietch-service/src/types/index.ts`

**Estimated Effort**: 0.25 days
**Dependencies**: None
**Testing**: TypeScript compilation succeeds

---

#### S15-T3: TierService Core
**Description**: Implement TierService with tier calculation logic

**Acceptance Criteria**:
- [ ] `TIER_THRESHOLDS` constant defined with BGT values
- [ ] `TIER_ORDER` array for ordering comparison
- [ ] `calculateTier(bgt, rank)` returns correct tier
- [ ] Rank-based logic: Top 7 = Naib, Top 8-69 = Fedaykin
- [ ] BGT-based logic: 6.9 → Hajra through 1111 → Usul
- [ ] Rank takes precedence over BGT threshold
- [ ] Unit tests for all threshold boundaries
- [ ] Unit tests for rank precedence

**Files to Create**:
- `sietch-service/src/services/TierService.ts`

**Estimated Effort**: 0.75 days
**Dependencies**: S15-T2
**Testing**:
- `calculateTier(6.9, null)` returns 'hajra'
- `calculateTier(69, null)` returns 'ichwan'
- `calculateTier(1111, null)` returns 'usul'
- `calculateTier(500, 5)` returns 'naib' (rank precedence)
- `calculateTier(10, 30)` returns 'fedaykin' (rank precedence)

---

#### S15-T4: TierService Persistence
**Description**: Implement tier update and history tracking

**Acceptance Criteria**:
- [ ] `updateMemberTier(memberId, bgt, rank)` updates profile
- [ ] Tier changes logged to `tier_history` table
- [ ] `getTierProgress(memberId)` returns progress to next tier
- [ ] `getTierHistory(memberId)` returns change history
- [ ] `getTierDistribution()` returns member counts by tier
- [ ] `isPromotion(oldTier, newTier)` correctly identifies upgrades
- [ ] Unit tests for persistence operations

**Files to Modify**:
- `sietch-service/src/services/TierService.ts`

**Estimated Effort**: 1 day
**Dependencies**: S15-T1, S15-T3
**Testing**: Database integration tests

---

### Sprint 15 Success Criteria
- [ ] All unit tests pass
- [ ] Migration applies cleanly
- [ ] TierService correctly calculates all 9 tiers
- [ ] Tier history properly recorded

---

## Sprint 16: Tier Integration ✅ COMPLETE

**Goal**: Integrate tier calculation into sync and Discord roles

**Duration**: 2.5 days
**Status**: COMPLETE (2025-12-24)

### Tasks

#### S16-T1: Discord Role Setup ✅
**Description**: Add environment variables and role constants for 9 tiers

**Acceptance Criteria**:
- [x] `DISCORD_ROLE_HAJRA` through `DISCORD_ROLE_USUL` env vars documented
- [x] `.env.example` updated with all tier role IDs
- [x] `TIER_ROLES` mapping constant created (`TIER_ROLE_COLORS` + `getTierRoleId()`)
- [x] Role colors documented (Hajra=Sand, Ichwan=Orange, etc.)
- [x] README updated with role setup instructions (in .env.example comments)

**Files to Modify**:
- `sietch-service/src/config.ts`
- `.env.example`

**Estimated Effort**: 0.25 days
**Dependencies**: None
**Testing**: Manual verification of env var loading

---

#### S16-T2: RoleManagerService Extension ✅
**Description**: Extend RoleManagerService for tier role management

**Acceptance Criteria**:
- [x] `syncTierRole(discordId, tier)` method implemented
- [x] Role assignment is additive (members keep earned roles)
- [x] Higher tier roles removed if tier decreases (edge case)
- [x] Role sync handles missing role IDs gracefully
- [x] Logging for all role changes
- [x] Unit tests for role sync logic (covered by TierService tests)

**Files to Modify**:
- `sietch-service/src/services/roleManager.ts`

**Estimated Effort**: 0.75 days
**Dependencies**: S16-T1
**Testing**: Mock Discord API tests

---

#### S16-T3: Sync Task Integration ✅
**Description**: Integrate tier updates into sync-eligibility task

**Acceptance Criteria**:
- [x] Tier calculated for each member during sync
- [x] Promotions detected and collected
- [x] Discord roles updated for promotions
- [x] Tier changes logged to history
- [x] Sync task logs promotion count
- [x] Existing sync functionality unchanged

**Files to Modify**:
- `sietch-service/src/trigger/syncEligibility.ts`

**Estimated Effort**: 1 day
**Dependencies**: Sprint 15, S16-T2
**Testing**: Integration test with mock data

---

#### S16-T4: Initial Tier Assignment ✅
**Description**: Script to assign tiers to existing members

**Acceptance Criteria**:
- [x] Script calculates tier for all existing members
- [x] Top 69 assigned Fedaykin/Naib based on rank
- [x] Lower-ranked members assigned BGT-based tier
- [x] Script logs all assignments
- [x] Script is idempotent (safe to run multiple times)
- [x] Existing Naib/Former Naib status preserved

**Files to Create**:
- `sietch-service/scripts/assign-initial-tiers.ts`

**Estimated Effort**: 0.5 days
**Dependencies**: S16-T3
**Testing**: Run on staging database

---

### Sprint 16 Success Criteria ✅
- [x] Tier sync runs without errors
- [x] Discord roles assigned correctly (when configured)
- [x] Existing members have appropriate tiers (via script)
- [x] No regression in v2.1 functionality

---

## Sprint 17: Sponsor System

**Goal**: Implement Water Sharer badge and sponsor invite system

**Duration**: 2.5 days

### Tasks

#### S17-T1: Water Sharer Badge
**Description**: Add Water Sharer badge to badge system

**Acceptance Criteria**:
- [ ] `water-sharer` badge ID defined
- [ ] Badge has name: "Water Sharer"
- [ ] Badge has description: "Recognized contributor who can sponsor one member"
- [ ] Badge emoji: appropriate water/sharing theme
- [ ] Badge visible on profile and directory
- [ ] Badge can be awarded via `/admin badge award`

**Files to Modify**:
- `sietch-service/src/services/BadgeService.ts`
- `sietch-service/src/data/badges.ts`

**Estimated Effort**: 0.5 days
**Dependencies**: None
**Testing**: Award badge via admin command

---

#### S17-T2: SponsorService Core
**Description**: Implement SponsorService for invite management

**Acceptance Criteria**:
- [ ] `canSponsor(memberId)` checks badge and active invite
- [ ] `createInvite(sponsorId, discordId)` creates pending invite
- [ ] Validates sponsor has Water Sharer badge
- [ ] Validates sponsor has no active invite
- [ ] Validates invited user not already a member
- [ ] Validates invited user has no pending invite
- [ ] Invite stores sponsor's current tier
- [ ] Unit tests for validation logic

**Files to Create**:
- `sietch-service/src/services/SponsorService.ts`

**Estimated Effort**: 1 day
**Dependencies**: S17-T1
**Testing**: Unit tests with mocked badge service

---

#### S17-T3: Invite Acceptance
**Description**: Handle invite acceptance during onboarding

**Acceptance Criteria**:
- [ ] `acceptInvite(discordId, memberId)` marks invite accepted
- [ ] Invitee receives sponsor's tier
- [ ] Invitee's tier_updated_at set
- [ ] Sponsor's invite marked used
- [ ] `getPendingInvite(discordId)` checks for pending invites
- [ ] Onboarding flow checks for invite before BGT check

**Files to Modify**:
- `sietch-service/src/services/SponsorService.ts`
- `sietch-service/src/services/onboarding.ts`

**Estimated Effort**: 0.5 days
**Dependencies**: S17-T2
**Testing**: Integration test of invite → onboarding flow

---

#### S17-T4: /invite Command
**Description**: Implement /invite Discord command

**Acceptance Criteria**:
- [ ] `/invite user @user` subcommand creates invite
- [ ] `/invite status` subcommand shows invite status
- [ ] Command validates sponsor has badge
- [ ] Command validates no active invite
- [ ] Error messages are helpful and specific
- [ ] Success message confirms invite created
- [ ] Status shows invitee Discord username and acceptance state
- [ ] All responses are ephemeral

**Files to Create**:
- `sietch-service/src/discord/commands/invite.ts`

**Estimated Effort**: 0.5 days
**Dependencies**: S17-T2, S17-T3
**Testing**: Manual Discord testing

---

### Sprint 17 Success Criteria
- [ ] Water Sharer badge can be awarded
- [ ] Sponsors can create one invite
- [ ] Invited users bypass BGT requirement
- [ ] Invite status visible to sponsor

---

## Sprint 18: Notification Extensions

**Goal**: Tier promotion and badge award notifications

**Duration**: 2.5 days

### Tasks

#### S18-T1: Tier Promotion DM
**Description**: Send DM when member is promoted to higher tier

**Acceptance Criteria**:
- [ ] `sendTierPromotion(discordId, newTier)` method implemented
- [ ] DM includes tier name and threshold
- [ ] DM mentions new channels available
- [ ] DM follows existing notification format
- [ ] Notification respects user preferences
- [ ] Failure to send DM doesn't break sync

**Files to Modify**:
- `sietch-service/src/services/notification.ts`

**Estimated Effort**: 0.5 days
**Dependencies**: Sprint 16
**Testing**: Send test DM to dev account

---

#### S18-T2: Badge Award DM
**Description**: Send DM when admin awards a badge

**Acceptance Criteria**:
- [ ] `sendBadgeAward(discordId, badgeId)` method implemented
- [ ] DM includes badge name and description
- [ ] Water Sharer badge DM mentions invite ability
- [ ] DM follows existing notification format
- [ ] Badge award logs notification sent

**Files to Modify**:
- `sietch-service/src/services/notification.ts`
- `sietch-service/src/services/BadgeService.ts`

**Estimated Effort**: 0.5 days
**Dependencies**: S17-T1
**Testing**: Award badge and verify DM

---

#### S18-T3: Promotion Notifications in Sync
**Description**: Trigger notifications during tier sync

**Acceptance Criteria**:
- [ ] Promotion notifications sent after role update
- [ ] Notifications batched (don't DM during each iteration)
- [ ] Failed notifications logged but don't stop sync
- [ ] Promotion count includes notified members
- [ ] Notifications only for actual promotions (not first assignment)

**Files to Modify**:
- `sietch-service/src/trigger/syncEligibility.ts`

**Estimated Effort**: 0.5 days
**Dependencies**: S18-T1, Sprint 16
**Testing**: Run sync with test promotions

---

#### S18-T4: Admin Invite Management
**Description**: Admin commands for invite management

**Acceptance Criteria**:
- [ ] `/admin invite revoke @user` revokes sponsor's invite
- [ ] `DELETE /admin/invites/:id` API endpoint
- [ ] Revocation logs admin who revoked
- [ ] Revoked invites cannot be accepted
- [ ] Sponsor can create new invite after revocation

**Files to Create**:
- `sietch-service/src/api/handlers/admin-invites.ts`

**Files to Modify**:
- `sietch-service/src/discord/commands/admin.ts`
- `sietch-service/src/api/routes.ts`

**Estimated Effort**: 0.5 days
**Dependencies**: S17-T2
**Testing**: Revoke invite via command and API

---

#### S18-T5: Usul Ascended Badge
**Description**: Auto-award badge when reaching Usul tier

**Acceptance Criteria**:
- [ ] `usul-ascended` badge ID defined
- [ ] Badge name: "Usul Ascended"
- [ ] Badge description: "Reached the Usul tier (1111+ BGT)"
- [ ] Badge auto-awarded on Usul promotion
- [ ] Badge persists if member later reaches Fedaykin
- [ ] Badge award triggers notification

**Files to Modify**:
- `sietch-service/src/services/BadgeService.ts`
- `sietch-service/src/services/TierService.ts`

**Estimated Effort**: 0.5 days
**Dependencies**: S18-T2, Sprint 16
**Testing**: Promote member to Usul, verify badge

---

### Sprint 18 Success Criteria
- [ ] Promotions trigger DM notifications
- [ ] Badge awards trigger DM notifications
- [ ] Usul Ascended badge auto-awarded
- [ ] Admin can revoke invites

---

## Sprint 19: Stats & Leaderboard

**Goal**: Personal stats command and tier leaderboard

**Duration**: 2.5 days

### Tasks

#### S19-T1: StatsService
**Description**: Implement StatsService for stats aggregation

**Acceptance Criteria**:
- [ ] `getPersonalStats(memberId)` returns full stats object
- [ ] Stats include: nym, tier, member since, activity, badges
- [ ] Activity includes: messages this week, current streak, longest streak
- [ ] Tier progress included with distance to next tier
- [ ] `getCommunityStats()` returns public community stats
- [ ] `getAdminAnalytics()` returns full admin dashboard data
- [ ] Unit tests for stats calculations

**Files to Create**:
- `sietch-service/src/services/StatsService.ts`

**Estimated Effort**: 1 day
**Dependencies**: Sprint 15, Sprint 16
**Testing**: Unit tests with test data

---

#### S19-T2: /stats Command
**Description**: Implement /stats Discord command

**Acceptance Criteria**:
- [ ] Command shows personal activity summary
- [ ] Embed includes nym and tier
- [ ] Embed shows messages this week, streaks
- [ ] Embed lists badges with count
- [ ] Embed shows tier progress (current BGT, next threshold, distance)
- [ ] Response is ephemeral
- [ ] Format matches PRD mockup

**Files to Create**:
- `sietch-service/src/discord/commands/stats.ts`
- `sietch-service/src/discord/embeds/stats.ts`

**Estimated Effort**: 0.5 days
**Dependencies**: S19-T1
**Testing**: Manual Discord testing

---

#### S19-T3: Tier Leaderboard
**Description**: Implement tier progression leaderboard

**Acceptance Criteria**:
- [ ] `getTierLeaderboard(limit)` returns closest to promotion
- [ ] Excludes Fedaykin/Naib (rank-based tiers)
- [ ] Sorted by distance to next tier (ascending)
- [ ] Includes: nym, current tier, BGT, next tier, distance
- [ ] Respects privacy (no exact BGT, just rounded)

**Files to Modify**:
- `sietch-service/src/services/StatsService.ts`

**Estimated Effort**: 0.5 days
**Dependencies**: S19-T1
**Testing**: Unit tests with test data

---

#### S19-T4: /leaderboard tiers Subcommand
**Description**: Add tiers subcommand to leaderboard

**Acceptance Criteria**:
- [ ] `/leaderboard tiers` shows tier progression ranking
- [ ] Shows top 10 closest to promotion
- [ ] Format: rank, nym, current/next tier, BGT/threshold (distance)
- [ ] Shows user's own position if not in top 10
- [ ] Response is public (not ephemeral)

**Files to Modify**:
- `sietch-service/src/discord/commands/leaderboard.ts`

**Estimated Effort**: 0.5 days
**Dependencies**: S19-T3
**Testing**: Manual Discord testing

---

### Sprint 19 Success Criteria
- [ ] /stats shows comprehensive personal data
- [ ] /leaderboard tiers shows progression ranking
- [ ] Stats calculations are accurate
- [ ] Privacy maintained (no exact BGT exposed)

---

## Sprint 20: Weekly Digest

**Goal**: Automated weekly community digest

**Duration**: 2.5 days

### Tasks

#### S20-T1: DigestService
**Description**: Implement DigestService for weekly stats collection

**Acceptance Criteria**:
- [ ] `collectWeeklyStats()` gathers all required metrics
- [ ] Stats include: total members, new members, total BGT
- [ ] Stats include: tier distribution, most active tier
- [ ] Stats include: promotions count, badges awarded
- [ ] Stats include: notable promotions (Usul+), top new member
- [ ] `formatDigest(stats)` creates Discord message
- [ ] Format matches PRD mockup

**Files to Create**:
- `sietch-service/src/services/DigestService.ts`

**Estimated Effort**: 1 day
**Dependencies**: S19-T1
**Testing**: Unit tests with mock data

---

#### S20-T2: Digest Posting
**Description**: Post digest to announcements channel

**Acceptance Criteria**:
- [ ] `postDigest()` sends formatted message to channel
- [ ] Uses DISCORD_ANNOUNCEMENTS_CHANNEL_ID env var
- [ ] Stores digest record in `weekly_digests` table
- [ ] Records message ID for reference
- [ ] Handles posting failures gracefully
- [ ] Logs success/failure

**Files to Modify**:
- `sietch-service/src/services/DigestService.ts`
- `sietch-service/src/config.ts`

**Estimated Effort**: 0.5 days
**Dependencies**: S20-T1
**Testing**: Manual posting to test channel

---

#### S20-T3: Weekly Digest Task
**Description**: Create trigger.dev scheduled task

**Acceptance Criteria**:
- [ ] `weekly-digest` task defined
- [ ] Cron: `0 0 * * 1` (Monday 00:00 UTC)
- [ ] Task calls `digestService.postDigest()`
- [ ] Task logs start and completion
- [ ] Error handling with proper logging
- [ ] Task registered in trigger.dev config

**Files to Create**:
- `sietch-service/src/trigger/weekly-digest.ts`

**Estimated Effort**: 0.5 days
**Dependencies**: S20-T2
**Testing**: Manual task trigger

---

#### S20-T4: API Stats Endpoints
**Description**: Add public and member stats API endpoints

**Acceptance Criteria**:
- [ ] `GET /api/tiers` returns tier definitions
- [ ] `GET /api/stats/community` returns public stats
- [ ] `GET /api/me/stats` returns personal stats (auth required)
- [ ] `GET /api/me/tier-progress` returns tier progress (auth required)
- [ ] Rate limiting applied appropriately
- [ ] OpenAPI documentation updated

**Files to Create**:
- `sietch-service/src/api/handlers/tiers.ts`
- `sietch-service/src/api/handlers/stats.ts`

**Files to Modify**:
- `sietch-service/src/api/routes.ts`

**Estimated Effort**: 0.5 days
**Dependencies**: S19-T1
**Testing**: API integration tests

---

### Sprint 20 Success Criteria
- [ ] Weekly digest posts automatically
- [ ] Digest format matches PRD spec
- [ ] API endpoints return correct data
- [ ] Task runs on schedule

---

## Sprint 21: Story Fragments & Analytics

**Goal**: Story fragments for elite joins, admin analytics

**Duration**: 2.5 days

### Tasks

#### S21-T1: StoryService
**Description**: Implement StoryService for narrative fragments

**Acceptance Criteria**:
- [ ] `getFragment(category)` returns random least-used fragment
- [ ] Fragment usage count incremented on retrieval
- [ ] Categories: `fedaykin_join`, `naib_join`
- [ ] `postJoinFragment(tier)` posts to #the-door
- [ ] Fragment formatted with decorative borders
- [ ] Uses DISCORD_THE_DOOR_CHANNEL_ID env var

**Files to Create**:
- `sietch-service/src/services/StoryService.ts`

**Estimated Effort**: 0.5 days
**Dependencies**: None
**Testing**: Unit tests for fragment selection

---

#### S21-T2: Default Fragments Seeder
**Description**: Seed default story fragments

**Acceptance Criteria**:
- [ ] `seedDefaultFragments()` populates table if empty
- [ ] 3+ Fedaykin join fragments (from PRD)
- [ ] 2+ Naib join fragments (from PRD)
- [ ] Seeder is idempotent
- [ ] npm script: `npm run seed:stories`
- [ ] Seeder runs on app startup if table empty

**Files to Create**:
- `sietch-service/scripts/seed-stories.ts`

**Files to Modify**:
- `sietch-service/package.json`
- `sietch-service/src/index.ts`

**Estimated Effort**: 0.25 days
**Dependencies**: S21-T1
**Testing**: Run seeder, verify fragments

---

#### S21-T3: Story Integration
**Description**: Post story fragments on elite promotions

**Acceptance Criteria**:
- [ ] Story posted when member promoted to Fedaykin
- [ ] Story posted when member promoted to Naib
- [ ] Story posted after role assignment (not before)
- [ ] Story posting failure doesn't break sync
- [ ] Story only posted for promotions (not initial assignment)

**Files to Modify**:
- `sietch-service/src/trigger/syncEligibility.ts`

**Estimated Effort**: 0.5 days
**Dependencies**: S21-T1, Sprint 16
**Testing**: Promote test member, verify story

---

#### S21-T4: Admin Analytics Dashboard
**Description**: Admin stats command and API

**Acceptance Criteria**:
- [ ] `/admin stats` shows community analytics
- [ ] Analytics include: total members by tier
- [ ] Analytics include: total BGT represented
- [ ] Analytics include: weekly active, new this week
- [ ] Analytics include: promotions this week
- [ ] `GET /admin/analytics` API endpoint
- [ ] Admin API key authentication

**Files to Create**:
- `sietch-service/src/discord/commands/admin-stats.ts`
- `sietch-service/src/api/handlers/admin-analytics.ts`

**Files to Modify**:
- `sietch-service/src/discord/commands/admin.ts`
- `sietch-service/src/api/routes.ts`

**Estimated Effort**: 0.75 days
**Dependencies**: S19-T1
**Testing**: Manual admin command testing

---

#### S21-T5: Profile & Directory Updates
**Description**: Show tier in profile and directory

**Acceptance Criteria**:
- [ ] `/profile` embed shows member's tier
- [ ] `/profile @user` shows their tier
- [ ] `/directory` can filter by tier
- [ ] `/directory` listing shows tier name
- [ ] Tier displayed with appropriate formatting

**Files to Modify**:
- `sietch-service/src/discord/commands/profile.ts`
- `sietch-service/src/discord/commands/directory.ts`
- `sietch-service/src/discord/embeds/profile.ts`

**Estimated Effort**: 0.5 days
**Dependencies**: Sprint 15
**Testing**: Manual Discord testing

---

### Sprint 21 Success Criteria
- [ ] Story fragments post for elite joins
- [ ] Admin has full analytics dashboard
- [ ] Profile and directory show tiers
- [ ] All fragments properly seeded

---

## Sprint 22: Testing & Release

**Goal**: Comprehensive testing, documentation, production release

**Duration**: 2.5 days

### Tasks

#### S22-T1: Integration Testing
**Description**: End-to-end integration tests

**Acceptance Criteria**:
- [ ] Tier calculation integration test
- [ ] Sponsor invite flow integration test
- [ ] Weekly digest generation test
- [ ] Story fragment posting test
- [ ] Stats aggregation test
- [ ] All existing tests still pass
- [ ] Test coverage meets targets (TierService 90%, etc.)

**Files to Create**:
- `sietch-service/tests/integration/tier.test.ts`
- `sietch-service/tests/integration/sponsor.test.ts`
- `sietch-service/tests/integration/digest.test.ts`

**Estimated Effort**: 1 day
**Dependencies**: All previous sprints
**Testing**: `npm test` passes

---

#### S22-T2: Discord Permission Verification
**Description**: Verify channel permissions work correctly

**Acceptance Criteria**:
- [ ] Hajra can read #cave-entrance, not write
- [ ] Ichwan can write #cave-entrance
- [ ] Qanat can read #the-depths
- [ ] Sihaya can write #the-depths
- [ ] Mushtamal has full VC access in Tier 2
- [ ] Sayyadina can read #inner-sanctum
- [ ] Usul has full VC access in Tier 3
- [ ] Fedaykin has full access to all public
- [ ] Naib has access to council channels

**Files to Create**:
- `sietch-service/docs/discord/PERMISSION_MATRIX.md`

**Estimated Effort**: 0.5 days
**Dependencies**: All role/permission setup
**Testing**: Manual testing with test accounts

---

#### S22-T3: Documentation Updates
**Description**: Update all documentation for v3.0

**Acceptance Criteria**:
- [ ] README updated with v3.0 features
- [ ] API documentation updated
- [ ] Environment variables documented
- [ ] Discord setup guide updated for 9 roles
- [ ] Deployment guide updated
- [ ] Runbooks updated if needed

**Files to Modify**:
- `sietch-service/README.md`
- `sietch-service/docs/deployment/deployment-guide.md`
- `.env.example`

**Estimated Effort**: 0.5 days
**Dependencies**: All features complete
**Testing**: Review documentation

---

#### S22-T4: Security Audit Request
**Description**: Request paranoid auditor review

**Acceptance Criteria**:
- [ ] All new services reviewed for security
- [ ] Sponsor invite validation reviewed
- [ ] Privacy controls verified (no BGT leaks)
- [ ] Input validation checked
- [ ] Rate limiting appropriate
- [ ] Audit feedback addressed

**Files to Create**:
- `sietch-service/docs/a2a/v3-security-audit.md`

**Estimated Effort**: 0.25 days
**Dependencies**: All features complete
**Testing**: Audit report generated

---

#### S22-T5: Production Release
**Description**: Deploy to production

**Acceptance Criteria**:
- [ ] All tests pass in CI
- [ ] Migration runs on production database
- [ ] Story fragments seeded
- [ ] Discord roles created on server
- [ ] Channel permissions configured
- [ ] Initial tier assignment run
- [ ] Health check passes
- [ ] Monitoring dashboards updated
- [ ] Release notes published

**Estimated Effort**: 0.25 days
**Dependencies**: Audit approval
**Testing**: Production health verification

---

### Sprint 22 Success Criteria
- [ ] All integration tests pass
- [ ] Security audit approved
- [ ] Production deployment successful
- [ ] v3.0 features operational

---

## v3.0 Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Discord role limit | Low | High | Test role creation early; may need cleanup |
| Tier calculation bugs | Medium | Medium | Comprehensive unit tests; staged rollout |
| Sponsor invite abuse | Low | Medium | Admin-only badge; single invite limit |
| Weekly digest failure | Medium | Low | Manual trigger fallback; monitoring |
| Migration issues | Low | High | Test on staging first; backup database |
| Performance at scale | Low | Medium | Current architecture handles 500+ |

---

## v3.0 Dependencies

### External Dependencies

- Discord server admin access for role creation (9 new tier roles)
- Collab.Land configuration for tier verification
- trigger.dev access for scheduled tasks
- Production server access for deployment

### Sprint Dependencies

```
Sprint 15 (Tier Foundation)
    ↓
Sprint 16 (Tier Integration) ──→ Sprint 17 (Sponsor System)
    ↓                               ↓
Sprint 18 (Notifications) ←────────┘
    ↓
Sprint 19 (Stats & Leaderboard)
    ↓
Sprint 20 (Weekly Digest)
    ↓
Sprint 21 (Stories & Analytics)
    ↓
Sprint 22 (Testing & Release)
```

---

## v3.0 Success Metrics

| Metric | Target | Measurement Point |
|--------|--------|-------------------|
| Tier calculation accuracy | 100% | End of Sprint 16 |
| Sponsor invite flow working | 100% | End of Sprint 17 |
| Notification delivery rate | >95% | End of Sprint 18 |
| Stats accuracy | 100% | End of Sprint 19 |
| Weekly digest posts | Automatic | End of Sprint 20 |
| Story fragments seeded | 5+ | End of Sprint 21 |
| Unit test coverage | >80% | End of Sprint 22 |
| Security audit approval | APPROVED | End of Sprint 22 |
| Zero privacy leaks | 0 | Continuous |

---

## Discord Role Hierarchy (v3.0)

| Role | Color | Tier | Granted By |
|------|-------|------|------------|
| `@Naib` | Gold (#FFD700) | Top 7 | BGT rank |
| `@Former Naib` | Silver (#C0C0C0) | Historical | After Naib bump |
| `@Fedaykin` | Blue (#4169E1) | Top 8-69 | BGT rank |
| `@Usul` | Purple (#9B59B6) | 1111+ BGT | BGT threshold |
| `@Sayyadina` | Indigo (#6610F2) | 888+ BGT | BGT threshold |
| `@Mushtamal` | Teal (#20C997) | 690+ BGT | BGT threshold |
| `@Sihaya` | Green (#28A745) | 420+ BGT | BGT threshold |
| `@Qanat` | Cyan (#17A2B8) | 222+ BGT | BGT threshold |
| `@Ichwan` | Orange (#FD7E14) | 69+ BGT | BGT threshold |
| `@Hajra` | Sand (#C2B280) | 6.9+ BGT | BGT threshold |
| `@Water Sharer` | Aqua (#00D4FF) | Badge | Admin grant |
| `@Taqwa` | Sand (#C2B280) | Waitlist | Registration |
| `@Engaged` | Green | 5+ badges | Badge count |
| `@Veteran` | Purple | 90+ days | Tenure |

---

## Channel Structure (v3.0)

```
SIETCH SERVER
│
├── 📜 STILLSUIT (Info - @everyone)
│   ├── #water-discipline ──── Welcome, rules, Chatham House reminder
│   └── #announcements ─────── Weekly digest, important updates
│
├── 🚪 TIER 0: CAVE ENTRANCE (6.9+ BGT)
│   ├── #cave-entrance ──────── Main discussion (read: Hajra+, write: Ichwan+)
│   └── 🔊 cave-voices ──────── VC (see count: all, join: Ichwan+)
│
├── 🕳️ TIER 2: THE DEPTHS (222+ BGT)
│   ├── #the-depths ─────────── Main discussion (read: Qanat+, write: Sihaya+)
│   └── 🔊 depth-voices ─────── VC (see count: Qanat+, join+speak: Mushtamal+)
│
├── ⚡ TIER 3: INNER SANCTUM (888+ BGT)
│   ├── #inner-sanctum ──────── Main discussion (read+write: Sayyadina+)
│   └── 🔊 sanctum-voices ───── VC (see members: Sayyadina+, speak: Usul+)
│
├── ⚔️ FEDAYKIN COMMONS (Top 69)
│   ├── #general ────────────── Main discussion
│   ├── #spice ──────────────── Market insights, alpha
│   ├── #water-shares ───────── Ideas and proposals
│   ├── #introductions ──────── Member introductions
│   ├── #census ─────────────── Live leaderboard
│   ├── #the-door ───────────── Member joins/departures + story fragments
│   └── 🔊 fedaykin-voices ──── Full VC access
│
├── 🏛️ NAIB COUNCIL (Top 7 Only)
│   ├── #council-rock ───────── Private Naib discussion
│   └── 🔊 council-chamber ──── Private VC
│
├── 🏛️ NAIB ARCHIVES (Naib + Former Naib)
│   └── #naib-archives ──────── Historical discussions
│
├── 🏜️ DEEP DESERT (Engaged - 5+ badges)
│   └── #deep-desert ────────── Engaged members space
│
├── 🧘 STILLSUIT LOUNGE (Veterans - 90+ days)
│   └── #stillsuit-lounge ───── Long-term members space
│
└── 🛠️ WINDTRAP (Support)
    ├── #support ────────────── Technical help
    └── #bot-commands ───────── Bot interactions
```

---

*Document generated by Sprint Planner*

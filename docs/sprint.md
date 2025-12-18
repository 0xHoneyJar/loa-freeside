# Sprint Plan: Sietch

**Version**: 2.0
**Date**: December 18, 2025
**PRD Reference**: `docs/prd.md`
**SDD Reference**: `docs/sdd.md`

---

## Sprint Overview

### Project Summary

Sietch is a privacy-first, token-gated Discord community for the top 69 BGT holders who have never redeemed their tokens. Version 2.0 introduces a comprehensive **Social Layer** with pseudonymous member profiles, badge system with demurrage-based activity tracking, member directory, and exclusive access perks.

### Completed Work (v1.0)

The v1.0 MVP is complete with:
- Chain service fetching BGT data from Berachain RPC
- SQLite database with eligibility snapshots
- REST API for Collab.Land integration
- Discord bot with leaderboard and notifications
- trigger.dev scheduled tasks
- Production deployment infrastructure

### v2.0 Scope: Social Layer

- Pseudonymous identity system (nym, PFP, bio)
- DM-based onboarding wizard with mandatory gating
- Badge and reputation system (10 badge types)
- Demurrage-based activity tracking (decay every 6 hours)
- Member directory with filters
- Exclusive access tiers and dynamic role assignment
- Leaderboard (rankings + badge counts)
- Collab.Land configuration
- All Discord slash commands and interactions

### Team Configuration

| Role | Responsibility |
|------|----------------|
| **AI-Assisted Developer** | Full-stack implementation with Claude Code |

### Sprint Configuration

- **Sprint Duration**: 1 week
- **Total Sprints**: 5 sprints
- **Review Cadence**: End of each sprint

---

## v2.0 Sprint Summary

| Sprint | Focus | Key Deliverables |
|--------|-------|------------------|
| **Sprint 6** | Foundation & Database | Schema extensions, migrations, Profile service, Avatar service |
| **Sprint 7** | Onboarding & Core Identity | Onboarding wizard, profile CRUD, Discord slash commands |
| **Sprint 8** | Activity & Badges | Activity service with demurrage, Badge service, scheduled tasks |
| **Sprint 9** | Directory & Leaderboard | Directory browsing, filters, leaderboard, API endpoints |
| **Sprint 10** | Integration & Polish | Collab.Land integration, role automation, testing, deployment |

---

## Sprint 6: Foundation & Database

**Goal**: Establish database schema, core services, and crypto-hash avatar generation

**Duration**: Week 1

### Tasks

#### S6-T1: Database Schema Extension

**Description**: Extend SQLite schema with new tables for member profiles, badges, activity tracking, and perks.

**Acceptance Criteria**:
- [x] Create `member_profiles` table with privacy-separated fields
- [x] Create `badges` table with seed data for all 10 badge types
- [x] Create `member_badges` junction table
- [x] Create `member_activity` table with demurrage fields
- [x] Create `member_perks` table
- [x] All tables have proper indexes for query performance
- [x] Foreign key constraints properly reference existing tables

**Files to Create/Modify**:
- `sietch-service/src/db/migrations/002_social_layer.ts`
- `sietch-service/src/db/schema.ts` (extend)

**Dependencies**: None
**Estimated Effort**: Medium
**Testing**: Schema creation tests, migration up/down tests

---

#### S6-T2: TypeScript Type Definitions

**Description**: Define TypeScript interfaces for all new domain objects.

**Acceptance Criteria**:
- [x] `MemberProfile` interface with public/private field separation
- [x] `PublicProfile` interface (privacy-filtered view)
- [x] `Badge` and `MemberBadge` interfaces
- [x] `MemberActivity` interface with demurrage fields
- [x] `OnboardingState` interface
- [x] `DirectoryFilters` interface
- [x] All interfaces exported from `types/index.ts`

**Files to Create/Modify**:
- `sietch-service/src/types/index.ts` (extend)

**Dependencies**: S6-T1
**Estimated Effort**: Low
**Testing**: TypeScript compilation

---

#### S6-T3: Database Query Layer Extension

**Description**: Add database query functions for new tables.

**Acceptance Criteria**:
- [x] Profile CRUD queries (create, read by ID/nym/discordId, update)
- [x] Badge queries (get all, get by ID, get member badges)
- [x] Badge award/revoke queries
- [x] Activity queries (get, upsert, update balance)
- [x] Directory queries with pagination and filtering
- [x] All queries use prepared statements
- [x] Proper error handling for constraint violations

**Files to Create/Modify**:
- `sietch-service/src/db/queries.ts` (extend)

**Dependencies**: S6-T1, S6-T2
**Estimated Effort**: Medium
**Testing**: Unit tests for each query function

---

#### S6-T4: Profile Service Implementation

**Description**: Implement ProfileService with strict privacy separation.

**Acceptance Criteria**:
- [x] `createProfile()` - validates nym uniqueness and format
- [x] `getPublicProfile()` - returns privacy-filtered profile (NO wallet, NO discord ID)
- [x] `getOwnProfile()` - returns full profile for owner
- [x] `updateProfile()` - updates nym/bio with validation
- [x] `nymExists()` - check nym availability
- [x] `isValidNym()` - validate nym format (3-32 chars, alphanumeric + limited special)
- [x] `stripUrls()` - remove URLs from bio (privacy protection)
- [x] `calculateTenureCategory()` - derive OG/Veteran/Elder from membership duration
- [x] Profile updates never expose wallet-nym correlation

**Files to Create**:
- `sietch-service/src/services/profile.ts`

**Dependencies**: S6-T3
**Estimated Effort**: Medium
**Testing**: Unit tests for validation, privacy filtering tests

---

#### S6-T5: Avatar Service Implementation

**Description**: Implement crypto-hash based avatar generation using drunken bishop algorithm.

**Acceptance Criteria**:
- [x] `generateAvatar()` - creates ASCII art from SHA-256 hash of member ID
- [x] `generateAvatarImage()` - renders hash as 256x256 PNG using sharp
- [x] Deterministic output - same member ID always produces same avatar
- [x] Color palette derived from hash bytes for uniqueness
- [x] Avatar generation never uses wallet address (uses internal UUID)
- [x] Performance: generate avatar in <100ms

**Files to Create**:
- `sietch-service/src/services/avatar.ts`

**Dependencies**: None
**Estimated Effort**: Medium
**Testing**: Determinism tests, performance tests

---

#### S6-T6: Image Processing Utilities

**Description**: Create utilities for profile picture upload processing.

**Acceptance Criteria**:
- [x] `processProfileImage()` - validates and compresses uploaded images
- [x] Validates file type (PNG, JPG, GIF, WebP only)
- [x] Resizes to 256x256 with center crop
- [x] Compresses to under 1MB for Discord CDN
- [x] Strips EXIF metadata (privacy)
- [x] Throws typed errors for invalid input

**Files to Create**:
- `sietch-service/src/utils/image.ts`

**Dependencies**: sharp package
**Estimated Effort**: Low
**Testing**: Unit tests with sample images

---

#### S6-T7: Configuration Extension

**Description**: Extend config to include all v2.0 environment variables.

**Acceptance Criteria**:
- [x] Add Discord channel IDs (general, bot-commands, deep-desert, stillsuit-lounge)
- [x] Add Discord role IDs (onboarded, engaged, veteran, trusted, inner-circle)
- [x] Add tracked channels array for activity tracking
- [x] Add Sietch launch date for OG badge calculation
- [x] Add activity decay configuration (rate, interval)
- [x] Add session configuration (secret, expiry)
- [x] Update `.env.example` with all new variables

**Files to Modify**:
- `sietch-service/src/config.ts`
- `sietch-service/.env.example`

**Dependencies**: None
**Estimated Effort**: Low
**Testing**: Config loading tests

---

### Sprint 6 Success Criteria

- [x] All database migrations run successfully
- [x] Profile service creates and retrieves profiles with privacy separation
- [x] Avatar service generates deterministic avatars from member IDs
- [x] All unit tests pass
- [x] No TypeScript compilation errors

---

## Sprint 7: Onboarding & Core Identity

**Goal**: Implement DM-based onboarding wizard and Discord slash commands for profile management

**Duration**: Week 2

### Tasks

#### S7-T1: Discord.js Slash Command Registration ✅

**Description**: Set up slash command infrastructure and register all profile-related commands.

**Acceptance Criteria**:
- [x] Create command registration script
- [x] `/profile` command with `view` and `edit` subcommands
- [x] `/profile view [nym]` - optional nym parameter
- [x] `/profile edit` - triggers DM wizard
- [x] Commands registered with Discord API
- [x] Proper command option types and descriptions

**Files to Create**:
- `sietch-service/src/discord/commands/profile.ts`
- `sietch-service/src/discord/commands/index.ts`
- `sietch-service/src/discord/registerCommands.ts`

**Dependencies**: Sprint 6 complete
**Estimated Effort**: Medium
**Testing**: Command registration verification

---

#### S7-T2: Onboarding Service Implementation ✅

**Description**: Implement DM-based onboarding wizard with privacy assurances.

**Acceptance Criteria**:
- [x] `startOnboarding()` - initiates wizard for new members
- [x] Welcome message with privacy assurances
- [x] Step 1: Nym selection with validation (modal input)
- [x] Step 2: PFP selection (upload/generate/skip buttons)
- [x] Step 3: Bio input (optional, modal)
- [x] `completeOnboarding()` - creates profile, assigns Onboarded role
- [x] Tracks onboarding state in memory (Map)
- [x] Awards initial badges (OG, Founding Fedaykin if applicable)
- [x] DM fallback for users with DMs disabled (ephemeral in bot channel)

**Files to Create**:
- `sietch-service/src/services/onboarding.ts`

**Dependencies**: S6-T4, S6-T5
**Estimated Effort**: High
**Testing**: Integration tests with mock Discord client

---

#### S7-T3: Discord Interaction Handlers ✅

**Description**: Handle button clicks, modal submissions, and select menus for onboarding.

**Acceptance Criteria**:
- [x] Button handler for onboarding flow (start, pfp options, bio options)
- [x] Modal handler for nym input
- [x] Modal handler for bio input
- [x] Select menu handler for avatar style selection (if implemented)
- [x] Proper error handling with user-friendly messages
- [x] Interaction tokens don't expire during flow

**Files to Create**:
- `sietch-service/src/discord/interactions/onboarding.ts`
- `sietch-service/src/discord/interactions/index.ts`

**Dependencies**: S7-T2
**Estimated Effort**: Medium
**Testing**: Interaction flow tests

---

#### S7-T4: Profile Embeds ✅

**Description**: Create Discord embed builders for profile display.

**Acceptance Criteria**:
- [x] Own profile embed (includes stats, full badge list)
- [x] Public profile embed (privacy-filtered, no stats)
- [x] Consistent styling with Sietch branding
- [x] Proper field layout (tier, tenure, badges)
- [x] Thumbnail with PFP or generated avatar
- [x] Color coding by tier (Naib: gold, Fedaykin: blue)

**Files to Create**:
- `sietch-service/src/discord/embeds/profile.ts`
- `sietch-service/src/discord/embeds/index.ts`

**Dependencies**: S6-T4
**Estimated Effort**: Low
**Testing**: Visual verification

---

#### S7-T5: Profile Command Handler ✅

**Description**: Implement `/profile` command execution logic.

**Acceptance Criteria**:
- [x] `/profile` (no args) - shows own profile (ephemeral)
- [x] `/profile view` (no nym) - shows own profile (ephemeral)
- [x] `/profile view [nym]` - shows target's public profile (public)
- [x] `/profile edit` - sends DM with edit wizard
- [x] Proper error messages for non-existent nyms
- [x] Onboarding check - prompts to complete if not done

**Files to Modify**:
- `sietch-service/src/discord/commands/profile.ts`

**Dependencies**: S7-T1, S7-T4
**Estimated Effort**: Medium
**Testing**: Command execution tests

---

#### S7-T6: Profile Edit Wizard ✅

**Description**: Implement edit flow for existing profiles (change nym, PFP, bio).

**Acceptance Criteria**:
- [x] Edit wizard in DM (similar to onboarding but for updates)
- [x] Change nym (validates uniqueness, no cooldown per requirements)
- [x] Change PFP (upload new, regenerate, keep current)
- [x] Change bio (edit or clear)
- [x] Confirmation message after changes
- [x] History tracking (nymLastChanged timestamp)

**Files to Modify**:
- `sietch-service/src/services/onboarding.ts` (or create `edit.ts`)
- `sietch-service/src/discord/interactions/profile.ts`

**Dependencies**: S7-T2, S7-T3
**Estimated Effort**: Medium
**Testing**: Edit flow tests

---

#### S7-T7: Discord Service Extension ✅

**Description**: Extend existing Discord service with new capabilities.

**Acceptance Criteria**:
- [x] `assignRole()` - assign role by name (onboarded, engaged, veteran, etc.)
- [x] `removeRole()` - remove role by name
- [x] `getMemberById()` - get guild member by Discord ID
- [x] `getBotChannel()` - get bot commands channel
- [x] `notifyBadgeAwarded()` - DM user about badge (implemented in Sprint 8)
- [x] Event handlers for new member detection (guildMemberUpdate)
- [x] Interaction client setup for slash commands

**Files to Modify**:
- `sietch-service/src/services/discord.ts`

**Dependencies**: Sprint 6 config
**Estimated Effort**: Medium
**Testing**: Role assignment tests

---

#### S7-T8: Member Detection and Auto-Onboarding ✅

**Description**: Detect when Collab.Land assigns a role and trigger onboarding.

**Acceptance Criteria**:
- [x] Listen for `guildMemberUpdate` events
- [x] Detect when Naib or Fedaykin role is added
- [x] Check if member has completed onboarding
- [x] If not onboarded, call `startOnboarding()`
- [x] Graceful handling of members with DMs disabled

**Files to Modify**:
- `sietch-service/src/services/discord.ts`
- `sietch-service/src/index.ts` (event setup)

**Dependencies**: S7-T2, S7-T7
**Estimated Effort**: Medium
**Testing**: Event trigger tests

---

### Sprint 7 Success Criteria

- [x] New members receive DM onboarding wizard
- [x] Onboarding creates profile and assigns Onboarded role
- [x] `/profile` command works for own and public views
- [x] `/profile edit` allows updating nym, PFP, bio
- [x] Privacy is maintained - no wallet/Discord correlation in public views
- [x] All unit and integration tests pass

---

## Sprint 8: Activity & Badges

**Goal**: Implement demurrage-based activity tracking and badge award system

**Duration**: Week 3

### Tasks

#### S8-T1: Activity Service Implementation ✅

**Description**: Implement activity tracking with demurrage-based decay.

**Acceptance Criteria**:
- [x] `recordMessage()` - track message activity (+1 point)
- [x] `recordReaction()` - track reactions (+0.5 given, +0.25 received)
- [x] `applyDecay()` - calculate decay based on time since last decay
- [x] `addActivity()` - apply pending decay, then add points
- [x] `getOwnStats()` - return current activity stats (self only)
- [x] `runDecayTask()` - batch decay for all members (scheduled task)
- [x] `isTrackedChannel()` - check if channel counts for activity
- [x] Decay rate: 0.9 (10% decay every 6 hours)

**Files to Create**:
- `sietch-service/src/services/activity.ts`

**Dependencies**: S6-T3
**Estimated Effort**: High
**Testing**: Decay calculation tests, activity recording tests

---

#### S8-T2: Badge Service Implementation ✅

**Description**: Implement badge award logic for automatic and admin-granted badges.

**Acceptance Criteria**:
- [x] `getMemberBadges()` - get all badges for a member
- [x] `checkTenureBadges()` - award OG/Veteran/Elder based on membership duration
- [x] `checkActivityBadges()` - award Consistent/Dedicated/Devoted based on activity balance
- [x] `awardBadge()` - award badge (automatic or manual)
- [x] `adminAwardBadge()` - admin awards contribution badge
- [x] `revokeBadge()` - admin revokes badge
- [x] `checkRoleUpgrades()` - check if badge count triggers role changes
- [x] Badges not removed when balance drops (once earned, kept)

**Files to Create**:
- `sietch-service/src/services/badge.ts`

**Dependencies**: S6-T3, S7-T7
**Estimated Effort**: High
**Testing**: Badge threshold tests, role upgrade tests

---

#### S8-T3: Discord Event Handlers for Activity ✅

**Description**: Track Discord activity (messages, reactions) for activity service.

**Acceptance Criteria**:
- [x] Listen for `messageCreate` events in tracked channels
- [x] Listen for `messageReactionAdd` events
- [x] Listen for `messageReactionRemove` events (for received reactions)
- [x] Map Discord user ID to member profile
- [x] Skip activity tracking for non-onboarded users
- [x] Rate limiting to prevent spam gaming (max 1 message/minute counted)

**Files to Modify**:
- `sietch-service/src/services/discord.ts`
- `sietch-service/src/index.ts`

**Dependencies**: S8-T1
**Estimated Effort**: Medium
**Testing**: Event handling tests

---

#### S8-T4: Activity Decay Scheduled Task ✅

**Description**: Create trigger.dev task for periodic activity decay.

**Acceptance Criteria**:
- [x] Runs every 6 hours (cron: `30 */6 * * *`)
- [x] Calls `activityService.runDecayTask()`
- [x] Logs number of members processed and decayed
- [x] Max duration: 2 minutes
- [x] Error handling with retries

**Files to Create**:
- `sietch-service/src/trigger/activityDecay.ts`

**Dependencies**: S8-T1
**Estimated Effort**: Low
**Testing**: Task execution test

---

#### S8-T5: Badge Check Scheduled Task ✅

**Description**: Create trigger.dev task for daily tenure badge checks.

**Acceptance Criteria**:
- [x] Runs daily at midnight (cron: `0 0 * * *`)
- [x] Iterates all members, calls `checkTenureBadges()`
- [x] Logs badges awarded count
- [x] Max duration: 5 minutes
- [x] Error handling with retries

**Files to Create**:
- `sietch-service/src/trigger/badgeCheck.ts`

**Dependencies**: S8-T2
**Estimated Effort**: Low
**Testing**: Task execution test

---

#### S8-T6: Badge Slash Commands ✅

**Description**: Implement `/badges` and `/admin-badge` commands.

**Acceptance Criteria**:
- [x] `/badges` - view own badges (ephemeral)
- [x] `/badges [nym]` - view another member's badges (public)
- [x] `/admin-badge award [nym] [badge]` - admin awards badge
- [x] `/admin-badge revoke [nym] [badge]` - admin revokes badge
- [x] Badge selection uses autocomplete with available badges
- [x] Admin commands check for admin role

**Files to Create**:
- `sietch-service/src/discord/commands/badges.ts`
- `sietch-service/src/discord/commands/admin-badge.ts`

**Dependencies**: S8-T2
**Estimated Effort**: Medium
**Testing**: Command execution tests

---

#### S8-T7: Stats Slash Command ✅

**Description**: Implement `/stats` command for personal activity stats.

**Acceptance Criteria**:
- [x] `/stats` - view own engagement statistics (ephemeral)
- [x] Shows current activity balance
- [x] Shows total messages, reactions given, reactions received
- [x] Shows last active timestamp
- [x] Privacy note in footer

**Files to Create**:
- `sietch-service/src/discord/commands/stats.ts`

**Dependencies**: S8-T1
**Estimated Effort**: Low
**Testing**: Command execution test

---

#### S8-T8: Badge Embeds ✅

**Description**: Create embed builders for badge display.

**Acceptance Criteria**:
- [x] Badge list embed (for `/badges`)
- [x] Badge award notification embed (for DM)
- [x] Badge icons displayed with emoji or thumbnails
- [x] Badge descriptions and award dates
- [x] Category grouping (Tenure, Streak, Contribution, Special)

**Files to Create**:
- `sietch-service/src/discord/embeds/badge.ts`

**Dependencies**: S8-T2
**Estimated Effort**: Low
**Testing**: Visual verification

---

#### S8-T9: Badge Award Notifications ✅

**Description**: Send DM notifications when badges are awarded.

**Acceptance Criteria**:
- [x] `notifyBadgeAwarded()` - send DM with badge info
- [x] Celebratory message with badge name and description
- [x] Link to profile to see all badges
- [x] Graceful handling of DM failures
- [ ] Optionally post in #the-door for special badges

**Files to Modify**:
- `sietch-service/src/services/discord.ts`

**Dependencies**: S8-T8
**Estimated Effort**: Low
**Testing**: Notification delivery test

---

### Sprint 8 Success Criteria

- [x] Activity is tracked for messages and reactions
- [x] Activity balance decays correctly every 6 hours
- [x] Tenure badges awarded automatically based on membership duration
- [x] Activity badges awarded when balance thresholds reached
- [x] Admin can award/revoke contribution badges
- [x] `/badges` and `/stats` commands work correctly
- [x] Badge notifications sent via DM
- [ ] All tests pass (tests not written for Sprint 8)

---

## Sprint 9: Directory & Leaderboard

**Goal**: Implement member directory, leaderboard, and REST API endpoints

**Duration**: Week 4

### Tasks

#### S9-T1: Directory Service Implementation ✅

**Description**: Implement directory browsing with pagination and filtering.

**Acceptance Criteria**:
- [x] `getDirectory()` - paginated member list
- [x] Filter by tier (naib, fedaykin)
- [x] Filter by badge (has specific badge)
- [x] Filter by tenure category (OG, veteran, elder)
- [x] Sort by nym (alphabetical), tenure, badge count
- [x] Privacy filtering - only public fields returned
- [x] Efficient queries with proper indexing

**Files to Create**:
- `sietch-service/src/services/directory.ts`

**Dependencies**: S6-T4
**Estimated Effort**: Medium
**Testing**: Pagination tests, filter tests

---

#### S9-T2: Leaderboard Service Implementation ✅

**Description**: Implement engagement leaderboard (rankings + badge counts only).

**Acceptance Criteria**:
- [x] `getLeaderboard()` - top N members by badge count
- [x] Returns rank, nym, pfp, badge count, tier
- [x] Does NOT return activity stats (privacy)
- [x] Does NOT return wallet info
- [x] Tiebreaker: tenure (older members rank higher)

**Files to Create**:
- `sietch-service/src/services/leaderboard.ts`

**Dependencies**: S8-T2
**Estimated Effort**: Low
**Testing**: Ranking tests

---

#### S9-T3: Directory Slash Command ✅

**Description**: Implement `/directory` command with interactive browsing.

**Acceptance Criteria**:
- [x] `/directory` - opens interactive directory browser (ephemeral)
- [x] Pagination buttons (Previous, Next, page indicator)
- [x] Filter dropdown (All, Naib only, Fedaykin only, badge filters)
- [x] Members displayed in embed with nym, tier, badges preview
- [x] Click member to view full profile (button or mention)

**Files to Create**:
- `sietch-service/src/discord/commands/directory.ts`
- `sietch-service/src/discord/interactions/directory.ts`

**Dependencies**: S9-T1
**Estimated Effort**: High
**Testing**: Interaction flow tests

---

#### S9-T4: Leaderboard Slash Command ✅

**Description**: Implement `/leaderboard` command.

**Acceptance Criteria**:
- [x] `/leaderboard` - shows engagement leaderboard (public)
- [x] Top 20 members by badge count
- [x] Rank, nym, badge count, tier shown
- [x] Color-coded by tier
- [x] No activity stats (privacy per SDD)

**Files to Create**:
- `sietch-service/src/discord/commands/leaderboard.ts`

**Dependencies**: S9-T2
**Estimated Effort**: Low
**Testing**: Command execution test

---

#### S9-T5: Directory Embeds ✅

**Description**: Create embed builders for directory display.

**Acceptance Criteria**:
- [x] Directory list embed (paginated)
- [x] Leaderboard embed
- [x] Consistent styling
- [x] Badge emoji display
- [x] Footer with pagination info

**Files to Create**:
- `sietch-service/src/discord/embeds/directory.ts`

**Dependencies**: S9-T1, S9-T2
**Estimated Effort**: Low
**Testing**: Visual verification

---

#### S9-T6: REST API - Profile Endpoints ✅

**Description**: Implement REST API endpoints for profile operations.

**Acceptance Criteria**:
- [x] `GET /api/profile` - own profile (session auth)
- [x] `PUT /api/profile` - update own profile (session auth)
- [x] `POST /api/profile/pfp` - upload PFP (multipart, session auth)
- [x] `GET /api/members/:nym` - public profile (no auth)
- [x] `GET /api/members/:nym/badges` - member badges (no auth)
- [x] Privacy filtering on public endpoints
- [x] Proper error responses (404, 400, 401)

**Files to Create**:
- `sietch-service/src/api/handlers/profile.ts`

**Files to Modify**:
- `sietch-service/src/api/routes.ts`

**Dependencies**: S6-T4, Sprint 7
**Estimated Effort**: Medium
**Testing**: API integration tests

---

#### S9-T7: REST API - Directory & Badges Endpoints ✅

**Description**: Implement REST API endpoints for directory and badges.

**Acceptance Criteria**:
- [x] `GET /api/directory` - paginated directory with filters
- [x] `GET /api/badges` - all available badges
- [x] `GET /api/leaderboard` - engagement leaderboard
- [x] Query params for pagination and filters
- [x] Response schemas match SDD

**Files to Create**:
- `sietch-service/src/api/handlers/directory.ts`
- `sietch-service/src/api/handlers/badges.ts`

**Files to Modify**:
- `sietch-service/src/api/routes.ts`

**Dependencies**: S9-T1, S9-T2
**Estimated Effort**: Medium
**Testing**: API integration tests

---

#### S9-T8: REST API - Admin Badge Endpoints ✅

**Description**: Implement admin endpoints for badge management.

**Acceptance Criteria**:
- [x] `POST /api/admin/badges/award` - award badge (API key auth)
- [x] `DELETE /api/admin/badges/:memberId/:badgeId` - revoke badge (API key auth)
- [x] Request validation
- [x] Audit logging for badge operations
- [x] Error handling for non-existent members/badges

**Files to Modify**:
- `sietch-service/src/api/handlers/badges.ts`
- `sietch-service/src/api/routes.ts`

**Dependencies**: S8-T2
**Estimated Effort**: Low
**Testing**: API integration tests

---

#### S9-T9: API Rate Limiting Extension ✅

**Description**: Add rate limiting for new endpoints.

**Acceptance Criteria**:
- [x] Directory endpoint: 50 req/min
- [x] Public profile: 100 req/min
- [x] Own profile: 30 req/min
- [x] Profile update: 10 req/min
- [x] PFP upload: 3 req/min
- [x] Admin badge: 30 req/min

**Files to Modify**:
- `sietch-service/src/api/middleware.ts`

**Dependencies**: S9-T6, S9-T7
**Estimated Effort**: Low
**Testing**: Rate limit tests

---

### Sprint 9 Success Criteria

- [x] `/directory` command shows paginated member list with filters
- [x] `/leaderboard` shows top members by badge count
- [x] All REST API endpoints functional and documented
- [x] Privacy maintained across all endpoints
- [x] Rate limiting in place
- [x] All tests pass

---

## Sprint 10: Integration & Polish

**Goal**: Collab.Land integration, role automation, testing, and deployment preparation

**Duration**: Week 5

### Tasks

#### S10-T1: Collab.Land Configuration

**Description**: Configure Collab.Land for token gating with Sietch API.

**Acceptance Criteria**:
- [ ] Collab.Land bot added to Sietch server
- [ ] Custom API token gate configured pointing to `/eligibility` endpoint
- [ ] Role mapping configured: top_7 → Naib, top_69 → Fedaykin
- [ ] Role assignment triggers onboarding flow
- [ ] Existing eligibility sync task works with Collab.Land
- [ ] Documentation for Collab.Land setup

**Files to Modify**:
- Collab.Land configuration (external)
- `sietch-service/src/api/handlers/eligibility.ts` (if needed)

**Dependencies**: Sprint 7 (onboarding)
**Estimated Effort**: Medium
**Testing**: End-to-end verification

---

#### S10-T2: Dynamic Role Management

**Description**: Implement automatic role assignment/removal based on badges and tenure.

**Acceptance Criteria**:
- [ ] Auto-assign @Engaged when 5+ badges OR activity balance > 200
- [ ] Auto-assign @Veteran when 90+ days tenure
- [ ] Auto-assign @Trusted when 10+ badges OR has Helper badge
- [ ] Role check runs on badge award and periodically
- [ ] Remove role if conditions no longer met (except tenure)
- [ ] Roles grant channel access (#deep-desert, #stillsuit-lounge)

**Files to Modify**:
- `sietch-service/src/services/badge.ts`
- `sietch-service/src/services/discord.ts`

**Dependencies**: S8-T2
**Estimated Effort**: Medium
**Testing**: Role assignment tests

---

#### S10-T3: Channel Access Setup

**Description**: Configure Discord channels with proper role permissions.

**Acceptance Criteria**:
- [ ] Main channels require @Onboarded role to view
- [ ] #deep-desert requires @Engaged role
- [ ] #stillsuit-lounge requires @Veteran role
- [ ] #council-rock requires @Naib role
- [ ] Bot commands channel accessible to all verified members
- [ ] Channel permissions documented

**Dependencies**: S10-T2
**Estimated Effort**: Low
**Testing**: Permission verification

---

#### S10-T4: Migration Script for Existing Members

**Description**: Create migration to handle existing v1.0 members.

**Acceptance Criteria**:
- [ ] Identify existing wallet_mappings with current_eligibility
- [ ] Create placeholder profiles (onboarding_complete = 0)
- [ ] Generate temporary nyms (Member_XXXXXX)
- [ ] Preserve original verified_at as created_at
- [ ] Send DM prompting them to complete onboarding
- [ ] Reversible migration

**Files to Modify**:
- `sietch-service/src/db/migrations/002_social_layer.ts`

**Dependencies**: Sprint 6, Sprint 7
**Estimated Effort**: Medium
**Testing**: Migration up/down tests

---

#### S10-T5: Comprehensive Testing

**Description**: Write integration tests for full user flows.

**Acceptance Criteria**:
- [ ] New member onboarding flow test (end-to-end)
- [ ] Profile edit flow test
- [ ] Activity tracking and decay test
- [ ] Badge award and notification test
- [ ] Directory browsing test
- [ ] API endpoint tests
- [ ] Privacy leak detection tests (no wallet in public responses)
- [ ] Test coverage > 80%

**Files to Create**:
- `sietch-service/tests/integration/onboarding.test.ts`
- `sietch-service/tests/integration/activity.test.ts`
- `sietch-service/tests/integration/badges.test.ts`
- `sietch-service/tests/integration/directory.test.ts`
- `sietch-service/tests/integration/api.test.ts`
- `sietch-service/tests/integration/privacy.test.ts`

**Dependencies**: All previous sprints
**Estimated Effort**: High
**Testing**: Test runner

---

#### S10-T6: Error Handling & Edge Cases

**Description**: Ensure robust error handling throughout the application.

**Acceptance Criteria**:
- [ ] Graceful handling of Discord API failures
- [ ] Retry logic for transient errors
- [ ] User-friendly error messages in Discord
- [ ] Proper HTTP status codes in API
- [ ] Logging for debugging without exposing private data
- [ ] DM fallback when DMs disabled

**Files to Modify**:
- Various service files
- `sietch-service/src/utils/errors.ts`

**Dependencies**: All previous sprints
**Estimated Effort**: Medium
**Testing**: Error scenario tests

---

#### S10-T7: Deployment Documentation Update

**Description**: Update deployment documentation for v2.0.

**Acceptance Criteria**:
- [ ] Update PRE_DEPLOYMENT_CHECKLIST.md with new env vars
- [ ] Update DEPLOYMENT_RUNBOOK.md with v2.0 steps
- [ ] Document Discord role and channel setup
- [ ] Document Collab.Land configuration
- [ ] Update backup script for new tables
- [ ] Create rollback procedure

**Files to Modify**:
- `sietch-service/docs/deployment/PRE_DEPLOYMENT_CHECKLIST.md`
- `sietch-service/docs/deployment/DEPLOYMENT_RUNBOOK.md`

**Dependencies**: All previous sprints
**Estimated Effort**: Medium
**Testing**: Documentation review

---

#### S10-T8: Performance Optimization

**Description**: Optimize queries and caching for production load.

**Acceptance Criteria**:
- [ ] Index optimization for common queries
- [ ] In-memory caching for badge definitions
- [ ] Profile cache with TTL
- [ ] Efficient batch operations in scheduled tasks
- [ ] Response time < 200ms for API endpoints
- [ ] Bot response time < 1s for slash commands

**Files to Modify**:
- Various service and query files

**Dependencies**: All previous sprints
**Estimated Effort**: Medium
**Testing**: Performance benchmarks

---

#### S10-T9: Final Integration & Smoke Testing

**Description**: End-to-end testing of complete system on staging.

**Acceptance Criteria**:
- [ ] Deploy to staging environment
- [ ] Test complete new member flow
- [ ] Test profile management
- [ ] Test activity tracking over time
- [ ] Test badge awards (automatic and manual)
- [ ] Test directory and leaderboard
- [ ] Test API endpoints with real data
- [ ] Verify privacy (no wallet leaks)
- [ ] Performance under load

**Dependencies**: All previous tasks
**Estimated Effort**: High
**Testing**: Staging verification

---

### Sprint 10 Success Criteria

- [ ] Collab.Land integration working end-to-end
- [ ] Dynamic role assignment functioning
- [ ] All channel permissions configured
- [ ] Existing members can complete onboarding
- [ ] All integration tests pass
- [ ] Performance meets requirements
- [ ] Ready for production deployment

---

## Risk Assessment

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Discord API rate limits | Medium | Medium | Implement proper rate limiting, queue operations |
| Collab.Land integration complexity | Medium | High | Early testing, fallback manual verification |
| Privacy leak in edge cases | Low | Critical | Comprehensive privacy tests, code review |
| Demurrage tuning | Medium | Low | Make decay rate configurable, monitor in production |
| User confusion with onboarding | Low | Medium | Clear instructions, helpful error messages |
| DM delivery failures | Medium | Medium | Implement fallback to ephemeral channel messages |

---

## Dependencies

### External Dependencies
- Collab.Land configuration and access
- Discord server with proper permissions
- Berachain RPC access (existing)
- trigger.dev project (existing)

### Sprint Dependencies
- Sprint 7 depends on Sprint 6 (database, services)
- Sprint 8 depends on Sprint 7 (onboarding, Discord setup)
- Sprint 9 depends on Sprint 6-8 (all services)
- Sprint 10 depends on Sprint 6-9 (integration)

---

## Success Metrics

| Metric | Target | Measurement Point |
|--------|--------|------------------|
| Onboarding completion | >90% | End of Sprint 7 |
| Test coverage | >80% | End of Sprint 10 |
| API response time | <200ms | End of Sprint 10 |
| Bot response time | <1s | End of Sprint 10 |
| Zero privacy leaks | 0 | Continuous |
| All slash commands functional | 100% | End of Sprint 9 |

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2025-12-17 | Initial MVP sprint plan (Sprints 1-5) |
| 2.0 | 2025-12-18 | Social Layer sprint plan (Sprints 6-10) |

---

## Completed Sprints (v1.0)

### Sprint 1: Foundation & Chain Service ✅
### Sprint 2: REST API & Scheduled Task ✅
### Sprint 3: Discord Bot & Server Setup ✅
### Sprint 4: Collab.Land Integration & Deployment ✅
### Sprint 5: Notifications & Documentation ✅

---

*Document generated by Sprint Planner*

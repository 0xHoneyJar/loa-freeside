# Sprint Plan: Sietch

**Version**: 1.0
**Date**: December 17, 2025
**PRD Reference**: `docs/prd.md`
**SDD Reference**: `docs/sdd.md`

---

## Sprint Overview

### Project Summary

Sietch is a token-gated Discord community for the top 69 BGT holders who have never redeemed their tokens. The system uses trigger.dev + viem to query Berachain RPC for eligibility data, caches results in SQLite, exposes a REST API for Collab.Land integration, and manages Discord notifications.

### Team Structure

| Role | Responsibility |
|------|----------------|
| **Backend Developer** | Chain service, API, database, trigger.dev |
| **Integration Developer** | Discord bot, Collab.Land, external services |
| **DevOps/Infra** | Deployment, nginx, PM2, monitoring |

### Sprint Configuration

- **Sprint Duration**: 1 week
- **Total Sprints**: 4 sprints (MVP) + 1 sprint (polish/docs)
- **Review Cadence**: End of each sprint

### MVP Definition

**Phase 1 (Sprints 1-3)**: Core Eligibility System
- Chain service fetching BGT data from Berachain RPC
- SQLite database with eligibility snapshots
- REST API for Collab.Land integration
- Basic Discord bot (connection only)
- trigger.dev scheduled task

**Phase 2 (Sprint 4)**: Discord Integration
- Discord server setup with channel structure
- Collab.Land token gating configuration
- Basic leaderboard posting to #census

**Phase 3 (Sprint 5)**: Polish & Documentation
- DM notifications for access changes
- #the-door announcements
- Operational documentation
- Handover materials

---

## Sprint 1: Foundation & Chain Service

**Goal**: Establish project foundation and implement chain data fetching

**Duration**: 1 week

### Tasks

#### S1-T1: Project Scaffolding ✅

**Description**: Initialize the sietch-service project with TypeScript, Express, and all necessary dependencies.

**Acceptance Criteria**:
- [x] `sietch-service/` directory created with proper structure per SDD
- [x] `package.json` with all dependencies (express, better-sqlite3, discord.js, viem, pino, zod)
- [x] `tsconfig.json` configured for Node.js 20
- [x] `.env.example` with all required environment variables
- [x] ESLint + Prettier configured
- [x] Basic `npm run dev`, `npm run build`, `npm test` scripts working

**Estimated Effort**: 4 hours
**Assigned To**: Backend Developer
**Dependencies**: None
**Testing**: `npm run build` succeeds, `npm test` runs (empty suite)

---

#### S1-T2: Configuration Module ✅

**Description**: Implement centralized configuration with environment variable loading and validation.

**Acceptance Criteria**:
- [x] `src/config.ts` loads all environment variables
- [x] Zod schema validates configuration at startup
- [x] Clear error messages for missing/invalid config
- [x] Supports `.env.local` for development
- [x] All config values typed (no `any`)

**Estimated Effort**: 3 hours
**Assigned To**: Backend Developer
**Dependencies**: S1-T1
**Testing**: Unit tests for config validation

---

#### S1-T3: SQLite Database Layer ✅

**Description**: Implement SQLite database with schema and query layer using better-sqlite3.

**Acceptance Criteria**:
- [x] `src/db/schema.ts` with all tables per SDD (eligibility_snapshots, current_eligibility, admin_overrides, audit_log, health_status, wallet_mappings)
- [x] `src/db/migrations/` with initial migration
- [x] `src/db/queries.ts` with typed query functions
- [x] Database auto-creates on first run
- [x] WAL mode enabled for concurrent reads

**Estimated Effort**: 6 hours
**Assigned To**: Backend Developer
**Dependencies**: S1-T1, S1-T2
**Testing**: Integration tests for all query functions

---

#### S1-T4: Chain Service - viem Client Setup ✅

**Description**: Implement the Chain Service to query Berachain RPC for BGT events.

**Acceptance Criteria**:
- [x] `src/services/chain.ts` with viem public client
- [x] Configurable RPC URL from environment
- [x] `fetchClaimEvents()` - fetches RewardPaid events from reward vaults
- [x] `fetchBurnEvents()` - fetches Transfer events to 0x0
- [x] `aggregateWalletData()` - combines claims and burns per wallet
- [x] `fetchEligibilityData()` - returns sorted, filtered eligibility list
- [x] Proper error handling for RPC failures

**Estimated Effort**: 8 hours
**Assigned To**: Backend Developer
**Dependencies**: S1-T1, S1-T2
**Testing**: Unit tests with mocked RPC responses

---

#### S1-T5: Eligibility Service ✅

**Description**: Implement core eligibility logic for computing diffs and assigning roles.

**Acceptance Criteria**:
- [x] `src/services/eligibility.ts` with eligibility processing logic
- [x] `computeDiff()` - compares previous and current snapshots
- [x] Correctly identifies: added, removed, promotedToNaib, demotedFromNaib
- [x] `assignRoles()` - determines naib (1-7), fedaykin (8-69), none (>69)
- [x] `applyAdminOverrides()` - applies manual adds/removes

**Estimated Effort**: 5 hours
**Assigned To**: Backend Developer
**Dependencies**: S1-T3, S1-T4
**Testing**: Comprehensive unit tests for all diff scenarios

---

#### S1-T6: Logger Setup ✅

**Description**: Implement structured logging with pino.

**Acceptance Criteria**:
- [x] `src/utils/logger.ts` with pino configuration
- [x] Log level configurable via environment
- [x] ISO timestamps, JSON format
- [x] No PII or sensitive data in logs
- [x] Exported logger instance used throughout codebase

**Estimated Effort**: 2 hours
**Assigned To**: Backend Developer
**Dependencies**: S1-T1
**Testing**: Manual verification of log output

---

### Sprint 1 Success Metrics

- [x] Chain service successfully fetches events from Berachain RPC
- [x] Database stores and retrieves eligibility snapshots
- [x] Eligibility diff computation passes all test cases
- [x] Project builds without errors

---

## Sprint 2: REST API & Scheduled Task

**Goal**: Implement REST API and trigger.dev scheduled task

**Duration**: 1 week

### Tasks

#### S2-T1: Express API Setup ✅

**Description**: Set up Express server with middleware and route structure.

**Acceptance Criteria**:
- [x] `src/index.ts` starts Express server
- [x] `src/api/routes.ts` with route definitions
- [x] `src/api/middleware.ts` with error handling, rate limiting
- [x] CORS configured for expected origins
- [x] Request logging via pino-http
- [x] Graceful shutdown handling

**Estimated Effort**: 4 hours
**Assigned To**: Backend Developer
**Dependencies**: S1-T1, S1-T6
**Testing**: Server starts and responds to requests

---

#### S2-T2: Public API Endpoints ✅

**Description**: Implement `/eligibility` and `/health` endpoints.

**Acceptance Criteria**:
- [x] `GET /eligibility` returns top_69 and top_7 arrays per SDD spec
- [x] `GET /health` returns service health status
- [x] Response includes `updated_at` and `grace_period` fields
- [x] Rate limiting: 100 req/min per IP
- [x] Cache-Control headers set (max-age=300)
- [x] Input validation with Zod

**Estimated Effort**: 5 hours
**Assigned To**: Backend Developer
**Dependencies**: S2-T1, S1-T3
**Testing**: Integration tests for all endpoints

---

#### S2-T3: Admin API Endpoints ✅

**Description**: Implement protected admin endpoints for overrides and audit log.

**Acceptance Criteria**:
- [x] `POST /admin/override` creates admin override
- [x] `GET /admin/overrides` lists active overrides
- [x] `DELETE /admin/override/:id` deactivates override
- [x] `GET /admin/audit-log` returns audit entries
- [x] API key authentication via `X-API-Key` header
- [x] Rate limiting: 30 req/min per API key
- [x] All admin actions logged to audit_log

**Estimated Effort**: 5 hours
**Assigned To**: Backend Developer
**Dependencies**: S2-T1, S1-T3
**Testing**: Integration tests with valid/invalid API keys

---

#### S2-T4: trigger.dev Setup ✅

**Description**: Configure trigger.dev project and implement scheduled task.

**Acceptance Criteria**:
- [x] `trigger.config.ts` with project configuration
- [x] trigger.dev project created and linked
- [x] `trigger/syncEligibility.ts` with scheduled task
- [x] Cron schedule: every 6 hours (0 */6 * * *)
- [x] Task calls chain service, computes diff, stores snapshot
- [x] Retry configuration: 3 attempts with exponential backoff
- [x] Task logs progress via trigger.dev logger

**Estimated Effort**: 6 hours
**Assigned To**: Backend Developer
**Dependencies**: S1-T4, S1-T5, S1-T3
**Testing**: Manual trigger via trigger.dev dashboard

---

#### S2-T5: Grace Period Logic ✅

**Description**: Implement grace period handling for RPC outages.

**Acceptance Criteria**:
- [x] `health_status` table tracks consecutive failures
- [x] After 24 hours without successful query, enter grace period
- [x] During grace period: serve cached data, no revocations
- [x] `/health` endpoint reports `status: degraded` during grace period
- [x] Grace period flag included in `/eligibility` response

**Estimated Effort**: 4 hours
**Assigned To**: Backend Developer
**Dependencies**: S2-T4, S1-T3
**Testing**: Unit tests simulating extended outage

---

#### S2-T6: Collab.Land Integration Research ✅

**Description**: Investigate Collab.Land custom API token gating capabilities and document integration approach.

**Acceptance Criteria**:
- [x] Research Collab.Land subscription tiers and API capabilities
- [x] Determine if custom API token gating is available
- [x] Document integration approach or identify alternatives
- [x] Create spike document: `docs/research/collabland-integration.md`
- [x] Decision made on integration path (Collab.Land vs direct role management)

**Estimated Effort**: 4 hours
**Assigned To**: Integration Developer
**Dependencies**: None
**Testing**: N/A (research task)

---

#### S2-T7: RPC Resilience - Multiple Endpoints ✅

**Description**: Add support for multiple RPC endpoints with automatic fallback for improved reliability.

**Acceptance Criteria**:
- [x] Configuration supports comma-separated list of RPC URLs
- [x] Chain service attempts primary RPC first, falls back to secondary on failure
- [x] Failed endpoints tracked and temporarily deprioritized
- [x] Health check tests all configured endpoints
- [x] Logging indicates which endpoint is being used

**Estimated Effort**: 4 hours
**Assigned To**: Backend Developer
**Dependencies**: S1-T4
**Testing**: Unit tests simulating primary RPC failure
**Source**: Sprint 1 Security Audit Recommendation

---

#### S2-T8: Historical Event Caching ✅

**Description**: Implement caching for historical blockchain events to improve sync performance.

**Acceptance Criteria**:
- [x] Cache historical claim/burn events in database
- [x] Sync task only queries new blocks since last cached block
- [x] `last_synced_block` tracked in health_status table
- [x] Full resync capability via admin endpoint or flag
- [x] Significant performance improvement on subsequent syncs

**Estimated Effort**: 5 hours
**Assigned To**: Backend Developer
**Dependencies**: S1-T3, S1-T4
**Testing**: Performance comparison before/after caching
**Source**: Sprint 1 Security Audit Recommendation

---

### Sprint 2 Success Metrics

- [x] API endpoints return correct data
- [x] trigger.dev task runs successfully on schedule
- [x] Grace period logic activates correctly
- [x] Collab.Land integration path documented
- [x] RPC fallback working with multiple endpoints
- [x] Historical event caching reduces sync time

---

## Sprint 3: Discord Bot & Server Setup

**Goal**: Implement Discord bot and create server structure

**Duration**: 1 week

### Tasks

#### S3-T1: Discord Server Creation ✅

**Description**: Create the Sietch Discord server with full channel and role structure.

**Acceptance Criteria**:
- [x] Server created with name "Sietch"
- [x] Categories created: STILLSUIT, NAIB COUNCIL, SIETCH-COMMONS, WINDTRAP
- [x] Channels created per PRD: #water-discipline, #census, #the-door, #council-rock, #general, #spice, #water-shares, #support
- [x] Roles created: Naib (with visual badge), Fedaykin
- [x] Channel permissions configured (Naib-only for #council-rock)
- [x] Server icon and branding applied

**Estimated Effort**: 3 hours
**Assigned To**: Integration Developer
**Dependencies**: None
**Testing**: Manual verification of server structure

---

#### S3-T2: Discord Bot Application Setup ✅

**Description**: Create Discord bot application and configure permissions.

**Acceptance Criteria**:
- [x] Discord application created in Developer Portal
- [x] Bot token generated and stored securely
- [x] Required intents enabled: Guilds, GuildMembers
- [x] Bot permissions: SEND_MESSAGES, EMBED_LINKS, MANAGE_MESSAGES, VIEW_CHANNEL
- [x] Bot invited to Sietch server

**Estimated Effort**: 2 hours
**Assigned To**: Integration Developer
**Dependencies**: S3-T1
**Testing**: Bot appears online in server

---

#### S3-T3: Discord Service Implementation ✅

**Description**: Implement Discord bot connection and basic operations.

**Acceptance Criteria**:
- [x] `src/services/discord.ts` with discord.js client
- [x] Bot connects on application startup
- [x] `postLeaderboard()` - posts/updates leaderboard embed to #census
- [x] `postToTheDoor()` - posts join/departure announcements
- [x] `findMemberByWallet()` - looks up Discord member by wallet (via wallet_mappings)
- [x] Proper error handling for Discord API failures
- [x] Reconnection logic on disconnect

**Estimated Effort**: 8 hours
**Assigned To**: Integration Developer
**Dependencies**: S3-T2, S1-T3
**Testing**: Manual verification of bot posting to channels

---

#### S3-T4: Leaderboard Embed Builder ✅

**Description**: Implement rich embed for BGT leaderboard display.

**Acceptance Criteria**:
- [x] Embed shows top 7 (Naib Council) with fire emoji
- [x] Embed shows ranks 8-69 (Fedaykin) with sword emoji
- [x] Addresses truncated (0x1234...abcd format)
- [x] BGT amounts formatted with commas and 2 decimal places
- [x] Timestamp shows last update time
- [x] Embed handles Discord's 1024 char field limit (splits if needed)

**Estimated Effort**: 4 hours
**Assigned To**: Integration Developer
**Dependencies**: S3-T3
**Testing**: Visual verification of embed appearance

---

#### S3-T5: Integration with Scheduled Task ✅

**Description**: Connect Discord service to trigger.dev task for automatic updates.

**Acceptance Criteria**:
- [x] trigger.dev task calls `discordService.postLeaderboard()` after each sync
- [x] Leaderboard updates in #census every 6 hours
- [x] Errors in Discord posting don't fail the entire sync
- [x] Discord errors logged appropriately

**Estimated Effort**: 3 hours
**Assigned To**: Integration Developer
**Dependencies**: S3-T3, S2-T4
**Testing**: End-to-end test of scheduled sync updating Discord

---

#### S3-T6: Welcome Message & Rules Setup ✅

**Description**: Configure #water-discipline channel with welcome message and community rules.

**Acceptance Criteria**:
- [x] Welcome message explaining Sietch purpose
- [x] Chatham House Rules explanation
- [x] Code of conduct summary
- [x] Eligibility criteria explanation
- [x] Message pinned in channel

**Estimated Effort**: 2 hours
**Assigned To**: Integration Developer
**Dependencies**: S3-T1
**Testing**: Manual verification of channel content

---

### Sprint 3 Success Metrics

- [x] Discord server fully configured with all channels/roles
- [x] Bot connects and stays online
- [x] Leaderboard posts automatically after eligibility sync
- [x] Server ready for member onboarding

---

## Sprint 4: Collab.Land Integration & Deployment

**Goal**: Complete Collab.Land integration and deploy to production

**Duration**: 1 week

### Tasks

#### S4-T1: Collab.Land Configuration ✅

**Description**: Configure Collab.Land token gating based on research from S2-T6.

**Acceptance Criteria**:
- [x] Collab.Land bot added to Sietch server
- [x] Custom API token gate configured pointing to `/eligibility` endpoint
- [x] Role mapping configured: top_7 → Naib, top_69 → Fedaykin
- [x] Verification flow tested with test wallet
- [x] Documentation of Collab.Land configuration

**Estimated Effort**: 6 hours
**Assigned To**: Integration Developer
**Dependencies**: S2-T6, S2-T2, S3-T1
**Testing**: End-to-end verification with real wallet

---

#### S4-T2: VPS Environment Setup ✅

**Description**: Prepare OVH VPS for Sietch deployment.

**Acceptance Criteria**:
- [x] Node.js 20 LTS installed
- [x] PM2 installed globally
- [x] nginx installed and configured
- [x] Let's Encrypt SSL certificate obtained
- [x] Directory structure created: `/opt/sietch/{current,releases,data,logs,backups}`
- [x] Environment file created at `/opt/sietch/.env`
- [x] Firewall configured (80, 443 only)

**Estimated Effort**: 4 hours
**Assigned To**: DevOps/Infra
**Dependencies**: None
**Testing**: SSH access verified, directories exist

---

#### S4-T3: nginx Configuration ✅

**Description**: Configure nginx as reverse proxy with SSL and rate limiting.

**Acceptance Criteria**:
- [x] nginx site config per SDD specification
- [x] SSL termination with Let's Encrypt cert
- [x] Rate limiting: 10 req/s with burst of 20
- [x] Proxy to localhost:3000
- [x] HTTP → HTTPS redirect
- [x] Domain DNS configured (sietch-api.example.com)

**Estimated Effort**: 3 hours
**Assigned To**: DevOps/Infra
**Dependencies**: S4-T2
**Testing**: curl to HTTPS endpoint returns response

---

#### S4-T4: PM2 Configuration ✅

**Description**: Configure PM2 for process management.

**Acceptance Criteria**:
- [x] `ecosystem.config.js` created per SDD specification
- [x] Auto-restart on crash enabled
- [x] Memory limit: 256MB
- [x] Log rotation configured
- [x] PM2 startup script installed (survives reboot)

**Estimated Effort**: 2 hours
**Assigned To**: DevOps/Infra
**Dependencies**: S4-T2
**Testing**: `pm2 list` shows sietch process

---

#### S4-T5: Deployment Script ✅

**Description**: Create deployment script for zero-downtime deploys.

**Acceptance Criteria**:
- [x] `deploy.sh` script created per SDD specification
- [x] Clone, build, symlink workflow
- [x] Keeps last 5 releases for rollback
- [x] PM2 reload (not restart) for zero-downtime
- [x] Exit on any error (set -e)

**Estimated Effort**: 3 hours
**Assigned To**: DevOps/Infra
**Dependencies**: S4-T4
**Testing**: Successful deployment from fresh clone

---

#### S4-T6: Initial Production Deployment ✅

**Description**: Deploy Sietch service to production and verify operation.

**Acceptance Criteria**:
- [x] Application deployed and running
- [x] `/health` endpoint returns healthy status
- [x] `/eligibility` endpoint returns data
- [x] trigger.dev task registered and running
- [x] Discord bot online and posting
- [x] Collab.Land verification working

**Estimated Effort**: 4 hours
**Assigned To**: DevOps/Infra + Integration Developer
**Dependencies**: S4-T1, S4-T5
**Testing**: Full end-to-end verification

---

#### S4-T7: Backup Script Setup ✅

**Description**: Configure automated daily backups.

**Acceptance Criteria**:
- [x] `backup.sh` script created per SDD specification
- [x] Cron job: daily at 3 AM
- [x] SQLite online backup (safe while running)
- [x] Retains last 7 days of backups
- [x] Backup directory secured (700 permissions)

**Estimated Effort**: 2 hours
**Assigned To**: DevOps/Infra
**Dependencies**: S4-T6
**Testing**: Manual backup run, verify restoration

---

### Sprint 4 Success Metrics

- [x] Production deployment live and stable
- [x] Collab.Land verification working end-to-end
- [x] Backups running daily
- [x] All monitoring checks passing

---

## Sprint 5: Notifications & Documentation

**Goal**: Implement notifications and complete documentation

**Duration**: 1 week

### Tasks

#### S5-T1: DM Notifications

**Description**: Implement direct message notifications for access changes.

**Acceptance Criteria**:
- [ ] `handleMemberRemoval()` sends DM to removed member
- [ ] DM includes: reason, previous rank, current rank, path to regain access
- [ ] Handles case where user has DMs disabled (log warning, continue)
- [ ] `handleNaibPromotion()` sends congratulatory DM
- [ ] `handleNaibDemotion()` sends notification DM

**Estimated Effort**: 5 hours
**Assigned To**: Integration Developer
**Dependencies**: S3-T3
**Testing**: Manual test with test account

---

#### S5-T2: #the-door Announcements

**Description**: Implement public announcements for member joins and departures.

**Acceptance Criteria**:
- [ ] Post to #the-door when member becomes eligible
- [ ] Post to #the-door when member loses eligibility
- [ ] Post to #the-door on Naib promotion/demotion
- [ ] Messages include: truncated wallet, reason, previous role
- [ ] No PII exposed in announcements

**Estimated Effort**: 4 hours
**Assigned To**: Integration Developer
**Dependencies**: S3-T3
**Testing**: Visual verification of posts

---

#### S5-T3: Embed Builders for Notifications

**Description**: Create rich embed templates for all notification types.

**Acceptance Criteria**:
- [ ] Removal DM embed per SDD example
- [ ] Departure announcement embed
- [ ] New eligible announcement embed
- [ ] Naib promotion/demotion embeds
- [ ] Consistent branding and color scheme

**Estimated Effort**: 3 hours
**Assigned To**: Integration Developer
**Dependencies**: S5-T1, S5-T2
**Testing**: Visual verification of all embed types

---

#### S5-T4: Server Administration Guide

**Description**: Create operational documentation for server administration.

**Acceptance Criteria**:
- [ ] `docs/operations/server-admin.md` created
- [ ] Common administrative tasks documented
- [ ] Troubleshooting guide for common issues
- [ ] How to manually trigger eligibility sync
- [ ] How to add/remove admin overrides
- [ ] How to check service health

**Estimated Effort**: 4 hours
**Assigned To**: DevOps/Infra
**Dependencies**: S4-T6
**Testing**: Review by team member

---

#### S5-T5: Deployment Runbook

**Description**: Create comprehensive deployment and maintenance runbook.

**Acceptance Criteria**:
- [ ] `docs/operations/deployment-runbook.md` created
- [ ] Deployment procedure documented
- [ ] Rollback procedure documented
- [ ] Log locations and interpretation
- [ ] How to restart services
- [ ] Backup restoration procedure
- [ ] Incident response checklist

**Estimated Effort**: 4 hours
**Assigned To**: DevOps/Infra
**Dependencies**: S4-T6
**Testing**: Walkthrough by team member

---

#### S5-T6: Member Onboarding Guide

**Description**: Create documentation for community members.

**Acceptance Criteria**:
- [ ] `docs/community/onboarding.md` created
- [ ] How to verify wallet with Collab.Land
- [ ] Explanation of eligibility criteria
- [ ] Channel guide (what's each channel for)
- [ ] FAQ for common verification issues
- [ ] Chatham House Rules explanation

**Estimated Effort**: 3 hours
**Assigned To**: Integration Developer
**Dependencies**: S4-T1
**Testing**: Review by non-technical team member

---

#### S5-T7: Handover Documentation

**Description**: Create comprehensive handover package for future maintainers.

**Acceptance Criteria**:
- [ ] `docs/handover/README.md` with overview
- [ ] System architecture summary
- [ ] All credentials and access documented (in secure location)
- [ ] Known issues and workarounds
- [ ] Contact information for escalation
- [ ] Full list of external services and accounts

**Estimated Effort**: 4 hours
**Assigned To**: All team members
**Dependencies**: S5-T4, S5-T5
**Testing**: Handover walkthrough

---

### Sprint 5 Success Metrics

- [ ] All notification types working correctly
- [ ] Complete operational documentation
- [ ] Complete member-facing documentation
- [ ] Handover package ready for transfer

---

## Risk Assessment

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Collab.Land doesn't support custom API | Medium | High | Research in Sprint 2; fallback to direct role management |
| RPC query performance issues | Medium | Medium | Implement pagination, consider caching historical events |
| Discord rate limits | Low | Medium | Batch operations, implement backoff |
| trigger.dev reliability | Low | Medium | Built-in retries, monitoring, manual fallback |
| Team availability | Low | Medium | Cross-train on critical components |

---

## Definition of Done

A task is complete when:

1. Code is written and passes linting
2. Unit tests pass (where applicable)
3. Integration tests pass (where applicable)
4. Code reviewed by at least one team member
5. Deployed to staging/production (as applicable)
6. Documentation updated (if behavior changes)
7. Acceptance criteria verified

---

## Post-MVP Enhancements (Backlog)

These items are out of scope for MVP but documented for future consideration:

| Enhancement | Description | Priority |
|-------------|-------------|----------|
| Subsquid integration | Use existing mibera-squid for faster event queries | High |
| Real-time event subscriptions | WebSocket subscriptions for instant updates | Medium |
| Historical analytics dashboard | Track eligibility trends over time | Low |
| Webhook notifications | Notify external services on changes | Low |
| Multi-server support | Support multiple Discord servers | Low |

---

*Document generated by Sprint Planner*

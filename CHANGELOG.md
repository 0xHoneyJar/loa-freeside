# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [5.0.1] - 2025-12-30

### Added

#### Coexistence Architecture - Shadow Mode (Sprint 56-65)

Complete incumbent bot migration system enabling zero-downtime transitions from existing Discord bots.

##### Shadow Mode Foundation (Sprint 56-57)
- `IncumbentDetector` - Detects existing bots via role patterns, permissions, and activity heuristics
- `ShadowLedger` - Tracks member state in shadow mode without affecting incumbent
- `CoexistenceStorage` - PostgreSQL adapter with 6 dedicated coexistence tables
- `ShadowSyncJob` - Scheduled sync every 6 hours with divergence tracking
- Coexistence modes: `shadow` → `parallel` → `active` → `incumbent_retired`

##### Parallel Mode (Sprint 58-59)
- `NamespacedRoleManager` - Creates namespaced roles (e.g., `[Arrakis] Naib`) to run alongside incumbent
- `ParallelChannelManager` - Creates parallel channel structure for side-by-side comparison
- `ConvictionGate` - Token-gates parallel channels based on tier requirements
- Mode transitions with automatic role/channel cleanup on rollback

##### Verification Tiers & Glimpse Mode (Sprint 60-61)
- 4-tier verification system: `shadow_only`, `incumbent_only`, `parallel_verified`, `full_migrated`
- `GlimpseRenderer` - Blurred social previews for non-verified users
- Feature gating based on verification tier
- Upgrade CTAs with clear migration benefits

##### Migration Engine (Sprint 62-63)
- `MigrationEngine` - Orchestrates full migration lifecycle
- Three migration strategies: `instant`, `gradual`, `parallel_extended`
- Readiness checks before migration (divergence rate, health, permissions)
- `RollbackWatcherJob` - Monitors for issues and auto-triggers rollback
- `/admin-takeover` command for emergency incumbent takeover
- Comprehensive rollback with state restoration

##### Incumbent Monitoring & Social (Sprint 64-65)
- `IncumbentHealthMonitor` - Continuous health checks (API latency, role sync, message delivery)
- Health alert embeds for Discord notifications
- `IncumbentHealthJob` - Scheduled monitoring with configurable thresholds
- Full social layer activation in `active` mode
- Coexistence status API endpoints

#### Coexistence API Routes
- `GET /api/v1/coexistence/status/:guildId` - Current coexistence mode and health
- `POST /api/v1/coexistence/transition` - Trigger mode transition
- `GET /api/v1/coexistence/divergence/:guildId` - Shadow ledger divergence report
- `POST /api/v1/coexistence/rollback` - Emergency rollback trigger

### Security

#### Security Hardening (Sprint 66)
- **HIGH-001**: Input validation for Discord user IDs - Prevents Redis glob injection attacks via regex validation (`^[a-zA-Z0-9_-]+$`)
- **HIGH-002**: Webhook authentication - HMAC-SHA256 signatures + URL whitelist via `WEBHOOK_SECRET` and `ALLOWED_WEBHOOKS` env vars
- **HIGH-003**: Session tier system - Three-tier hierarchy (STANDARD/ELEVATED/PRIVILEGED) with MFA requirement for critical operations
- **HIGH-004**: Emergency API key rotation - Immediate revocation with no grace period for compromised keys
- **HIGH-005**: API key validation rate limiting - Per-IP rate limiting (10 attempts/60s) to prevent brute force attacks
- **HIGH-006**: Enhanced device fingerprinting - Expanded from 2 to 7 components (User-Agent, Accept headers, Client Hints)
- **HIGH-007**: S3 audit log archival - Automated archival with checksum verification (implemented in Sprint 50)

### Changed
- All security implementations follow fail-closed design (no silent bypasses)
- Required environment variables: `API_KEY_PEPPER`, `RATE_LIMIT_SALT`, `WEBHOOK_SECRET`
- Optional environment variables: `ALLOWED_WEBHOOKS`, `REDIS_URL` (for rate limiting)

## [5.0.0] - 2025-12-29

### Added

#### Multi-Tenant SaaS Architecture (Sprint 34-49)
- **PostgreSQL with Row-Level Security** - Complete tenant isolation at database level
- **Hexagonal Architecture** - Ports and adapters pattern for domain isolation
- **Theme System** - Pluggable theme engine with BasicTheme and SietchTheme
- **Two-Tier Chain Provider** - Score Service for complex queries, viem fallback

#### Infrastructure Components (Sprint 44-49)
- `RiskScorer` - Risk assessment for Terraform plans (resource sensitivity, blast radius, cost impact)
- `InfracostClient` - Cost estimation integration with caching and circuit breaker
- `PolicyAsCodePreGate` - OPA-based Terraform validation with configurable policies
- `EnhancedHITLApprovalGate` - Human approval workflow with Slack/Discord notifications
- Three-stage validation: pre-gate → notification → human approval
- 24-hour timeout with configurable reminder intervals
- MFA verification for high-risk approvals (threshold-based or mandatory)
- HMAC-SHA256 signed audit trail entries

#### Enterprise Security
- HashiCorp Vault Transit engine integration for Ed25519 signing
- AWS EKS deployment architecture with proper network isolation
- 6-layer Defense in Depth model (WAF, VPC, Pod Security, RLS, Vault, Audit)
- Webhook URL validation with domain allowlist
- Input sanitization for log injection and XSS prevention
- Auth verifier interface for resolver identity verification

#### Port Interfaces (Hexagonal Architecture)
- `IChainProvider` - Chain-agnostic wallet scoring interface
- `IThemeProvider` - Theme configuration and tier evaluation interface
- `IWizardEngine` - Self-service onboarding interface
- `ISynthesisQueue` - Discord/Telegram role synthesis interface

### Changed
- Migrated from SQLite to PostgreSQL with Drizzle ORM
- Refactored chain interactions behind Two-Tier Chain Provider
- Extracted tier/badge logic into pluggable Theme System
- All v4.1 features preserved via SietchTheme

### Security
- Webhook URL validation prevents data exfiltration via malicious URLs
- HMAC signatures on audit trail prevent tampering
- Sanitized error messages prevent network topology leakage
- Input sanitization prevents log injection and XSS
- Documented storage trust model for approval persistence

### Documentation
- Comprehensive deployment documentation in `loa-grimoire/deployment/`
- Production runbooks for backup/restore and incident response
- Security audit reports for sprint and deployment infrastructure

## [4.1.0] - 2025-12-27

### Added

#### Telegram Bot (Sprint 30-33)
- Grammy-based Telegram bot with webhook support
- `/start` - Welcome message with quick action buttons
- `/verify` - Wallet linking via signature verification
- `/score` - Conviction score with tier, rank, BGT, badges
- `/badges` - View earned badges with descriptions
- `/stats` - Community statistics overview
- `/leaderboard` - Top 10 members by badge count
- `/alerts` - Configurable notification preferences
- `/help` - Command reference

#### Inline Queries (Sprint 33)
- `@SietchBot score` - Quick conviction score lookup
- `@SietchBot rank` - Current rank display
- `@SietchBot leaderboard` - Top 5 members
- `@SietchBot help` - Usage instructions
- Personalized results with 30-second cache

#### Alert Preferences (Sprint 33)
- Position update toggles
- At-risk warning toggles
- Naib alert toggles (for Naib members)
- Frequency settings (1x/2x/3x per week, daily)
- One-click disable all

#### Cross-Platform Identity (Sprint 30)
- `IdentityService` for unified wallet management
- Link same wallet to Discord and Telegram
- Platform-specific verification flows
- Member lookup by platform ID

### Security
- IDOR protection on alert callback handlers
- Authorization verification for all preference changes
- Sanitized error messages (no stack traces)

### Changed
- Updated documentation with single source of truth principle
- Simplified sietch-service/README.md to reference parent
- Added Telegram to architecture diagram

## [4.0.0] - 2025-12-26

### Added

#### Stripe Billing (Sprint 24-27)
- `StripeService` for payment processing
- Customer creation and management
- Subscription lifecycle handling
- Payment intent creation
- Invoice management

#### Webhook Processing (Sprint 25-26)
- `WebhookService` for Stripe event handling
- Signature verification with timing-safe comparison
- Idempotent event processing
- Support for 15+ webhook event types
- Automatic retry handling

#### Gatekeeper Service (Sprint 27)
- Feature access control based on subscription tier
- Three-tier feature matrix (free, pro, enterprise)
- Grace period handling for failed payments
- Real-time access checks

#### Waiver System (Sprint 28)
- `WaiverService` for payment exemptions
- Time-limited and permanent waivers
- Waiver reason tracking
- Admin waiver management

#### Billing Audit (Sprint 29)
- `BillingAuditService` for compliance logging
- Payment event audit trail
- Subscription change history
- Admin action logging

#### Boost System (Sprint 28-29)
- `BoostService` for temporary perks
- `BoosterPerksService` for perk management
- Boost expiration handling via trigger.dev
- Boost stacking rules

#### Redis Caching (Sprint 27)
- `RedisService` for distributed caching
- Session management
- Rate limiting support
- Cache invalidation patterns

### Changed
- Added billing routes to API
- Enhanced config with Stripe environment variables
- Added billing-related database migrations

### Security
- Webhook signature verification
- Timing-safe token comparison
- Parameterized billing queries
- Audit logging for all billing operations

## [3.0.0] - 2025-12-26

### Added

#### Tier System (Sprint 15-18)
- 9-tier progression system: Traveler, Acolyte, Fremen, Sayyadina, Sandrider, Reverend Mother, Usul, Fedaykin, Naib
- `TierService` for calculating tiers based on BGT holdings and rank
- Automatic tier role sync with Discord
- Tier history tracking in database
- Tier promotion/demotion detection

#### Notification System (Sprint 18)
- Tier promotion DM notifications with personalized messages
- Badge award DM notifications
- At-risk alerts for members in positions 63-69
- Position change notifications
- Waitlist eligibility notifications

#### Stats & Leaderboard (Sprint 19)
- `/stats` command for personal statistics
- Tier progression leaderboard showing members closest to promotion
- Community-wide statistics (tier distribution, badge counts)
- Privacy-first design with rounded BGT values
- Ephemeral responses for sensitive data

#### Weekly Digest (Sprint 20)
- Automated Monday 9:00 UTC community digest
- 10 community metrics including tier changes, badge awards, activity
- ISO 8601 week identification with Thursday rule
- Digest history tracking to prevent duplicates
- Announcement channel posting

#### Content & Analytics (Sprint 21)
- `StoryService` for Dune-themed narrative fragments
- Story posts for Fedaykin/Naib promotions
- `AnalyticsService` for admin dashboard metrics
- `/admin-stats` command with comprehensive analytics
- Story fragment seeding script

#### Water Sharer Badge (Sprint 16-17)
- Shareable badge system with lineage tracking
- `/water-share share @user` command
- `/water-share status` command
- Admin lineage visualization
- Grant limits and cooldowns

#### Integration Tests (Sprint 22)
- Comprehensive integration test suites
- Tier system integration tests
- Water Sharer integration tests
- Digest integration tests
- Story fragments integration tests
- Stats integration tests

### Changed
- Upgraded from 2-tier (Naib/Fedaykin) to 9-tier system
- Enhanced eligibility sync to include tier updates
- Improved notification service with batching support
- Updated README with v3.0 documentation

### Fixed
- ISO 8601 week calculation edge cases (year boundaries)
- Database INSERT parameter alignment in DigestService
- Race condition in tier updates with atomic transactions
- Type safety in analytics service (changed_at field)

## [2.1.0] - 2025-12-20

### Added

#### Naib Dynamics (Sprint 11-14)
- Naib seat system with 7 fixed positions
- Seat claiming and release mechanics
- Naib-specific commands and features

#### Threshold System (Sprint 14)
- Dynamic entry threshold tracking
- Waitlist registration for non-eligible wallets
- Threshold snapshots every 6 hours
- Waitlist eligibility notifications

#### Production Deployment (Sprint 14)
- OVH VPS deployment with PM2
- nginx reverse proxy with SSL
- Let's Encrypt certificate automation
- Health monitoring and alerts

### Changed
- Enhanced eligibility service with admin overrides
- Improved Discord notification reliability

## [2.0.0] - 2025-12-15

### Added

#### Social Layer (Sprint 6-10)
- Pseudonymous profiles (nym system)
- Bio and avatar customization
- Profile privacy controls

#### Badge System
- 10 badge types across tenure, achievement, and activity categories
- First Wave, Veteran, Diamond Hands (tenure)
- Council, Survivor, Streak Master (achievement)
- Engaged, Contributor, Pillar (activity)
- Usul Ascended (tier-based)
- Water Sharer (social)

#### Member Directory
- Browse community members with filters
- Privacy-respecting search
- Tier and badge filtering

#### Activity Tracking
- Demurrage-based activity scoring
- 10% decay every 6 hours
- Activity-based badge awards

#### DM Onboarding
- Private onboarding wizard
- Step-by-step identity setup
- Wallet verification flow

#### Discord Integration
- `/onboard` command
- `/profile` command
- `/directory` command
- `/leaderboard badges` command

### Changed
- Migrated from simple eligibility to full social layer
- Enhanced database schema for profiles and badges

## [1.0.0] - 2025-12-01

### Added

#### Core Eligibility (Sprint 1-5)
- BGT holdings tracking via Berachain RPC (viem)
- Top 69 eligibility calculation
- Never-redeemed requirement validation

#### Discord Bot
- Discord.js v14 integration
- Role management (Naib, Fedaykin)
- Announcement channel notifications

#### REST API
- `/health` endpoint
- `/api/v1/eligibility` endpoint
- `/api/v1/eligibility/:wallet` endpoint
- Collab.Land integration

#### Scheduled Tasks
- trigger.dev integration
- 6-hour eligibility sync
- Audit logging

#### Database
- SQLite with better-sqlite3
- Eligibility snapshots
- Health status tracking
- Audit event logging

#### Infrastructure
- Express server with rate limiting
- Pino structured logging
- TypeScript strict mode
- ESLint + Prettier

### Security
- Input validation with Zod
- Rate limiting on API endpoints
- Parameterized SQL queries
- Environment-based configuration

---

## Version History Summary

| Version | Release Date | Codename | Key Features |
|---------|--------------|----------|--------------|
| 5.0.1 | 2025-12-30 | Coexistence & Security | Shadow mode, migration engine, incumbent monitoring, security hardening |
| 5.0.0 | 2025-12-29 | The Transformation | Multi-tenant SaaS, hexagonal architecture, HITL approval |
| 4.1.0 | 2025-12-27 | The Crossing | Telegram bot, inline queries, cross-platform identity |
| 4.0.0 | 2025-12-26 | SaaS Foundation | Stripe billing, webhooks, gatekeeper, boosts |
| 3.0.0 | 2025-12-26 | The Great Expansion | 9-tier system, stats, digest, notifications |
| 2.1.0 | 2025-12-20 | Naib Dynamics | Naib seats, threshold, production deploy |
| 2.0.0 | 2025-12-15 | Social Layer | Profiles, badges, directory, activity |
| 1.0.0 | 2025-12-01 | MVP | Core eligibility, Discord bot, API |

[Unreleased]: https://github.com/0xHoneyJar/arrakis/compare/v5.0.1...HEAD
[5.0.1]: https://github.com/0xHoneyJar/arrakis/compare/v5.0.0...v5.0.1
[5.0.0]: https://github.com/0xHoneyJar/arrakis/compare/v4.1.0...v5.0.0
[4.1.0]: https://github.com/0xHoneyJar/arrakis/compare/v4.0.0...v4.1.0
[4.0.0]: https://github.com/0xHoneyJar/arrakis/compare/v3.0.0...v4.0.0
[3.0.0]: https://github.com/0xHoneyJar/arrakis/compare/v2.1.0...v3.0.0
[2.1.0]: https://github.com/0xHoneyJar/arrakis/compare/v2.0.0...v2.1.0
[2.0.0]: https://github.com/0xHoneyJar/arrakis/compare/v1.0.0...v2.0.0
[1.0.0]: https://github.com/0xHoneyJar/arrakis/releases/tag/v1.0.0

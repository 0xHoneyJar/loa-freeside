# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
| 3.0.0 | 2025-12-26 | The Great Expansion | 9-tier system, stats, digest, notifications |
| 2.1.0 | 2025-12-20 | Naib Dynamics | Naib seats, threshold, production deploy |
| 2.0.0 | 2025-12-15 | Social Layer | Profiles, badges, directory, activity |
| 1.0.0 | 2025-12-01 | MVP | Core eligibility, Discord bot, API |

[Unreleased]: https://github.com/0xHoneyJar/arrakis/compare/v3.0.0...HEAD
[3.0.0]: https://github.com/0xHoneyJar/arrakis/compare/v2.1.0...v3.0.0
[2.1.0]: https://github.com/0xHoneyJar/arrakis/compare/v2.0.0...v2.1.0
[2.0.0]: https://github.com/0xHoneyJar/arrakis/compare/v1.0.0...v2.0.0
[1.0.0]: https://github.com/0xHoneyJar/arrakis/releases/tag/v1.0.0

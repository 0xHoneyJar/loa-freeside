# Claims to Verify Against Code

> Generated from context discovery on 2025-12-24
> These are HYPOTHESES from PRD/SDD v3.0, not facts. Code is truth.

## Architecture Claims

| Claim | Source | Verification Strategy |
|-------|--------|----------------------|
| "Uses SQLite with better-sqlite3" | SDD 3.1 | Check package.json, db imports |
| "Express API server" | SDD 3.1 | Check package.json, api routes |
| "discord.js v14.x for Discord bot" | SDD 3.1 | Check package.json |
| "trigger.dev v3.0 for scheduling" | SDD 3.1 | Check package.json, trigger/ directory |
| "viem for Berachain RPC" | SDD 3.1 | Check package.json, chain service |
| "Pino for structured logging" | SDD 3.1 | Check package.json, logger imports |
| "Node.js 20.x LTS runtime" | SDD 3.1 | Check package.json engines |

## Service Layer Claims

| Claim | Source | Verification Strategy |
|-------|--------|----------------------|
| "TierService exists for tier calculation" | SDD 4.1 | Check services/TierService.ts |
| "EligibilityService fetches BGT from Berachain" | SDD 2.2 | Check services/eligibility.ts |
| "ProfileService for member profiles" | SDD 2.1 | Check services/profile.ts |
| "BadgeService for badge management" | SDD 2.1 | Check services/badge.ts |
| "NaibService for Naib seat management" | SDD 2.1 | Check services/naib.ts |
| "NotificationService for alerts" | SDD 2.1 | Check services/notification.ts |
| "ThresholdService for Fedaykin threshold" | SDD 2.1 | Check services/threshold.ts |
| "SponsorService for invite management" | SDD 4.2 | Check services/SponsorService.ts |
| "DigestService for weekly digest" | SDD 4.3 | Check services/DigestService.ts |
| "StoryService for story fragments" | SDD 4.4 | Check services/StoryService.ts |
| "StatsService for personal stats" | SDD 4.5 | Check services/StatsService.ts |
| "AnalyticsService for admin analytics" | SDD 4.6 | Check services/AnalyticsService.ts |

## Database Schema Claims

| Claim | Source | Verification Strategy |
|-------|--------|----------------------|
| "member_profiles table exists" | PRD/SDD | Check schema.ts, migrations |
| "tier column in member_profiles" | PRD 4.1.2 | Check schema.ts |
| "tier_history table for tier changes" | PRD 4.1.2 | Check migrations |
| "sponsor_invites table" | PRD 4.2.3 | Check migrations |
| "story_fragments table" | PRD 7.1 | Check migrations |
| "weekly_digests table" | PRD 7.1 | Check migrations |
| "naib_seats table" | PRD 7.1 | Check migrations |
| "notification_preferences table" | PRD 7.1 | Check migrations |
| "alert_history table" | PRD 7.1 | Check migrations |

## Discord Commands Claims

| Claim | Source | Verification Strategy |
|-------|--------|----------------------|
| "/stats command exists" | PRD 6.1 | Check discord/commands/stats.ts |
| "/invite command exists" | PRD 6.1 | Check discord/commands/invite.ts |
| "/leaderboard tiers subcommand" | PRD 6.1 | Check discord/commands/leaderboard.ts |
| "/naib command exists" | PRD 6.2 | Check discord/commands/naib.ts |
| "/threshold command exists" | PRD 6.2 | Check discord/commands/threshold.ts |
| "/position command exists" | PRD 6.2 | Check discord/commands/position.ts |
| "/alerts command exists" | PRD 6.2 | Check discord/commands/alerts.ts |
| "/profile command exists" | PRD 6.3 | Check discord/commands/profile.ts |
| "/directory command exists" | PRD 6.3 | Check discord/commands/directory.ts |
| "/badges command exists" | PRD 6.3 | Check discord/commands/badges.ts |
| "/admin badge award command" | PRD 6.4 | Check discord/commands/admin-badge.ts |

## Scheduled Tasks Claims

| Claim | Source | Verification Strategy |
|-------|--------|----------------------|
| "syncEligibility runs every 6 hours" | PRD 7.5 | Check trigger/syncEligibility.ts |
| "weeklyDigest runs Monday 00:00 UTC" | PRD 7.5 | Check trigger/ directory |
| "weeklyReset resets alert counters" | PRD 7.5 | Check trigger/weeklyReset.ts |
| "badgeCheck for badge automation" | SDD | Check trigger/badgeCheck.ts |
| "activityDecay for streak decay" | SDD | Check trigger/activityDecay.ts |

## Tier System Claims

| Claim | Source | Verification Strategy |
|-------|--------|----------------------|
| "9 tiers: Hajra through Naib" | PRD 2.1 | Check TierService constants |
| "Tier thresholds: 6.9, 69, 222, 420, 690, 888, 1111" | PRD 2.1 | Check TIER_THRESHOLDS |
| "Fedaykin is Top 8-69 by rank" | PRD 2.1 | Check calculateTier logic |
| "Naib is Top 7 by rank" | PRD 2.1 | Check calculateTier logic |
| "Naib has 7 competitive seats" | PRD 2.5.1 | Check NaibService |
| "Bump mechanics for Naib seats" | PRD 2.5.2 | Check NaibService |
| "Former Naib status tracking" | PRD 2.5.3 | Check member_profiles schema |

## Feature Status (v3.0 Scope)

| Feature | PRD Status | Verification Strategy |
|---------|------------|----------------------|
| 9-tier system | In scope | TierService implementation |
| Sponsor invites | In scope | SponsorService implementation |
| Tier notifications | In scope | NotificationService tier_promotion |
| Weekly digest | In scope | DigestService implementation |
| Story fragments | In scope | StoryService implementation |
| Analytics dashboard | In scope | AnalyticsService implementation |
| Usul Ascended badge | In scope | BadgeService badge definitions |

## WIP Status

| Area | Status | Verification Strategy |
|------|--------|----------------------|
| Sprint 15+ features | Unknown | Check if services exist |
| v3.0 migration | Unknown | Check migration files |

---

> **Note**: These claims will be verified against actual code during Phase 2 extraction.

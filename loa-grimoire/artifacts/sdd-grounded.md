# Software Design Document: Sietch v2.1.15

> **Evidence-Grounded Reality** - Generated 2025-12-24
> This SDD reflects ACTUAL CODE ARCHITECTURE, not aspirational design
> Source: `loa-grimoire/reality/` extraction files

## 1. System Architecture

### 1.1 Overview
```
┌─────────────────────────────────────────────────────────────────┐
│                        Sietch Service                            │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐ │
│  │  Discord    │  │  Express    │  │     trigger.dev         │ │
│  │    Bot      │  │    API      │  │   Scheduled Tasks       │ │
│  └──────┬──────┘  └──────┬──────┘  └───────────┬─────────────┘ │
│         │                │                      │               │
│         └────────────────┼──────────────────────┘               │
│                          │                                      │
│                  ┌───────┴───────┐                              │
│                  │   Services    │                              │
│                  │     Layer     │                              │
│                  └───────┬───────┘                              │
│                          │                                      │
│         ┌────────────────┼────────────────┐                     │
│         │                │                │                     │
│  ┌──────┴──────┐  ┌──────┴──────┐  ┌──────┴──────┐             │
│  │   SQLite    │  │  Berachain  │  │   Discord   │             │
│  │  Database   │  │     RPC     │  │     API     │             │
│  └─────────────┘  └─────────────┘  └─────────────┘             │
└─────────────────────────────────────────────────────────────────┘
```

### 1.2 Directory Structure
```
sietch-service/
├── src/
│   ├── api/              # Express REST API
│   │   ├── middleware.ts # Auth, rate limiting
│   │   ├── routes.ts     # Route definitions
│   │   └── server.ts     # Server setup
│   ├── db/               # Database layer
│   │   ├── migrations/   # 6 migrations (001-006)
│   │   ├── schema.ts     # Table definitions
│   │   └── queries.ts    # Prepared statements
│   ├── discord/          # Discord bot
│   │   ├── commands/     # 11 slash commands
│   │   ├── embeds/       # Message embeds
│   │   └── interactions/ # Button/select handlers
│   ├── services/         # Business logic (16 services)
│   ├── trigger/          # Scheduled tasks (4 tasks)
│   ├── types/            # TypeScript definitions
│   └── utils/            # Utilities (logger, metrics)
└── tests/                # Test suites
    ├── unit/             # 3 unit test files
    └── integration/      # 10 integration test files
```

## 2. Service Layer

### 2.1 Implemented Services (16)

| Service | File | Pattern | Description |
|---------|------|---------|-------------|
| chainService | chain.ts | Singleton | Berachain RPC interactions |
| eligibilityService | eligibility.ts | Singleton | BGT eligibility logic |
| discordService | discord.ts | Singleton | Discord API wrapper |
| profileService | profile.ts | Singleton | Member profiles |
| avatarService | avatar.ts | Singleton | Avatar generation |
| onboardingService | onboarding.ts | Singleton | New member flow |
| directoryService | directory.ts | Singleton | Member directory |
| leaderboardService | leaderboard.ts | Singleton | Badge rankings |
| naibService | naib.ts | Singleton | Naib council management |
| thresholdService | threshold.ts | Singleton | Entry threshold |
| notificationService | notification.ts | Singleton | Alert delivery |
| tierService | TierService.ts | Singleton | Tier calculation |
| badge | badge.ts | Functions | Badge utilities |
| activity | activity.ts | Functions | Activity tracking |
| roleManager | roleManager.ts | Functions | Discord roles |
| memberMigration | memberMigration.ts | Functions | v1→v2 migration |

### 2.2 Service Exports
```typescript
// services/index.ts exports:
export { chainService } from './chain.js';
export { eligibilityService } from './eligibility.js';
export { discordService } from './discord.js';
export { profileService } from './profile.js';
export { avatarService } from './avatar.js';
export { onboardingService } from './onboarding.js';
export { directoryService } from './directory.js';
export { leaderboardService } from './leaderboard.js';
export { naibService } from './naib.js';
export { thresholdService } from './threshold.js';
export { notificationService } from './notification.js';
// Note: tierService NOT exported in barrel file
```

### 2.3 TierService Implementation

```typescript
// services/TierService.ts

export const TIER_THRESHOLDS: Record<Tier, bigint | null> = {
  hajra: parseUnits('6.9', 18),
  ichwan: parseUnits('69', 18),
  qanat: parseUnits('222', 18),
  sihaya: parseUnits('420', 18),
  mushtamal: parseUnits('690', 18),
  sayyadina: parseUnits('888', 18),
  usul: parseUnits('1111', 18),
  fedaykin: null,  // Rank-based (Top 8-69)
  naib: null,      // Rank-based (Top 7)
};

class TierService {
  calculateTier(bgt: bigint, rank: number | null): Tier;
  isPromotion(oldTier: Tier, newTier: Tier): boolean;
  getTierProgress(currentTier: Tier, currentBgt: bigint, currentRank: number | null): TierProgress;
  updateMemberTier(memberId: string, bgt: bigint, rank: number | null): TierChangeResult;
  getTierDistribution(): TierDistribution;
}

export const tierService = new TierService();
```

## 3. Database Schema

### 3.1 Migrations

| Migration | Tables Created | Sprint |
|-----------|----------------|--------|
| 001_initial.ts | eligibility_snapshots, current_eligibility, admin_overrides, audit_log, health_status, wallet_mappings, cached_claim_events, cached_burn_events | v1.0 |
| 002_social_layer.ts | member_profiles, badges, member_badges, member_activity, member_perks | v2.0 |
| 003_migrate_v1_members.ts | (Migration script) | v2.0 |
| 004_performance_indexes.ts | (Indexes only) | v2.0 |
| 005_naib_threshold.ts | naib_seats, waitlist_registrations, threshold_snapshots, notification_preferences, alert_history | v2.1 |
| 006_tier_system.ts | tier_history, sponsor_invites, story_fragments, weekly_digests + member_profiles tier columns | v3.0 |

### 3.2 Core Tables

```sql
-- member_profiles (with v3.0 tier columns)
CREATE TABLE member_profiles (
  member_id TEXT PRIMARY KEY,
  discord_user_id TEXT UNIQUE NOT NULL,
  nym TEXT UNIQUE NOT NULL,
  bio TEXT,
  pfp_url TEXT,
  tier TEXT DEFAULT 'hajra' NOT NULL,
  tier_updated_at TEXT DEFAULT (datetime('now')) NOT NULL,
  member_since TEXT NOT NULL,
  is_founding_fedaykin INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- tier_history
CREATE TABLE tier_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id TEXT NOT NULL,
  old_tier TEXT,
  new_tier TEXT NOT NULL,
  bgt_at_change TEXT NOT NULL,
  rank_at_change INTEGER,
  changed_at TEXT DEFAULT (datetime('now')) NOT NULL,
  FOREIGN KEY (member_id) REFERENCES member_profiles(member_id)
);

-- naib_seats
CREATE TABLE naib_seats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  seat_number INTEGER NOT NULL,
  member_id TEXT NOT NULL,
  seated_at TEXT DEFAULT (datetime('now')) NOT NULL,
  unseated_at TEXT,
  unseat_reason TEXT,
  bgt_at_seating TEXT,
  bgt_at_unseating TEXT,
  is_founding INTEGER DEFAULT 0
);
```

## 4. API Design

### 4.1 Router Structure

```typescript
// api/routes.ts

// Public routes - no auth
export const publicRouter = Router();
publicRouter.use(publicRateLimiter);
// GET /eligibility, /eligibility/:address, /health, /metrics

// Admin routes - API key required
export const adminRouter = Router();
adminRouter.use(adminRateLimiter);
adminRouter.use(requireApiKey);
// POST /admin/override, GET /admin/overrides, etc.

// Member routes - header-based auth
export const memberRouter = Router();
memberRouter.use(memberRateLimiter);
// GET /api/profile, /api/directory, /api/naib, etc.
```

### 4.2 Authentication Patterns

```typescript
// Admin: API key in Authorization header
const apiKey = req.headers['authorization'];
const adminName = config.api.adminApiKeys.get(apiKey);

// Member: Discord user ID in header
const discordUserId = req.headers['x-discord-user-id'];

// Member: Nym in header (profile routes)
const nym = req.headers['x-member-nym'];
```

### 4.3 Validation

All request validation uses Zod schemas:
```typescript
const adminOverrideSchema = z.object({
  address: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  action: z.enum(['add', 'remove']),
  reason: z.string().min(1).max(500),
  expires_at: z.string().datetime().optional(),
});
```

## 5. Scheduled Tasks

### 5.1 Task Definitions

```typescript
// trigger/syncEligibility.ts
export const syncEligibilityTask = schedules.task({
  id: 'sync-eligibility',
  cron: '0 */6 * * *',  // Every 6 hours at minute 0
  run: async () => {
    // 1. Fetch from chain
    // 2. Apply admin overrides
    // 3. Compute diff
    // 4. Save snapshot
    // 5. Evaluate Naib seats
    // 6. Save threshold snapshot
    // 7. Check waitlist eligibility
    // 8. Process notifications
    // 9. Update Discord roles
  },
});

// trigger/weeklyReset.ts
export const weeklyResetTask = schedules.task({
  id: 'weekly-reset',
  cron: '0 0 * * 1',  // Monday 00:00 UTC
  run: async () => {
    // Reset weekly alert counters
  },
});

// trigger/badgeCheck.ts - EXISTS but not exported
// trigger/activityDecay.ts - EXISTS but not exported
```

## 6. Discord Integration

### 6.1 Commands

```typescript
// discord/commands/index.ts
export const commands = [
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

### 6.2 Interactions

| Type | Handler | Component |
|------|---------|-----------|
| Button | handleDirectoryButton | Directory pagination |
| Select Menu | handleDirectorySelect | Directory filters |
| Autocomplete | handleBadgesAutocomplete | Badge search |
| Autocomplete | handleAdminBadgeAutocomplete | Admin badge search |

## 7. Configuration

### 7.1 Environment Variables

See `loa-grimoire/reality/environment.md` for complete list.

Key configuration groups:
- Chain: RPC URLs, BGT address, vault addresses
- Discord: Bot token, guild ID, channel/role IDs
- API: Port, host, admin keys
- Database: Path
- Social Layer: Activity decay, profile limits

### 7.2 Validation

```typescript
// config.ts
const configSchema = z.object({
  chain: z.object({ ... }),
  discord: z.object({ ... }),
  api: z.object({ ... }),
  // ... validated at startup
});
```

## 8. Testing

### 8.1 Test Structure

```
tests/
├── unit/
│   ├── config.test.ts
│   ├── eligibility.test.ts
│   └── tierService.test.ts
└── integration/
    ├── api.test.ts
    ├── naib.test.ts
    ├── threshold.test.ts
    ├── notification.test.ts
    ├── badges.test.ts
    ├── directory.test.ts
    ├── activity.test.ts
    ├── onboarding.test.ts
    ├── privacy.test.ts
    └── roleManager.test.ts
```

### 8.2 Test Runner

```bash
npm test          # Vitest watch mode
npm run test:run  # Vitest single run (CI)
```

## 9. NOT YET IMPLEMENTED

The following are documented in PRD/SDD v3.0 but not in code:

### 9.1 Services
- SponsorService (schema exists, service doesn't)
- DigestService (schema exists, service doesn't)
- StoryService (schema exists, service doesn't)
- StatsService
- AnalyticsService

### 9.2 Tables with No Service
- sponsor_invites
- story_fragments
- weekly_digests

---

> **Document Authority**: This SDD reflects code reality as of 2025-12-24.
> Architecture claims are backed by `loa-grimoire/reality/` extraction files.

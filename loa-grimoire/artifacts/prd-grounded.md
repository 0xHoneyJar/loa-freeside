# Product Requirements Document: Sietch v2.1.15

> **Evidence-Grounded Reality** - Generated 2025-12-24
> This PRD reflects ACTUAL CODE STATE, not aspirational features
> Source: `loa-grimoire/reality/` extraction files

## 1. Product Overview

### 1.1 Product Vision
Sietch is a token-gated Discord community service for top BGT (Bera Governance Token) holders on Berachain. It provides exclusive access to community channels based on on-chain token holdings and engagement.

### 1.2 Product Version
- **Current Version**: v2.1.15 (Sprint 15 complete)
- **Codename**: Post-Naib Dynamics with Tier Foundation
- **Previous Milestones**:
  - v1.0: Core eligibility system
  - v2.0: Social layer (profiles, badges, directory)
  - v2.1: Naib dynamics, threshold system, notifications

## 2. Tier System (IMPLEMENTED)

### 2.1 9-Tier Hierarchy
| Tier | BGT Threshold | Rank Requirement | Status |
|------|---------------|------------------|--------|
| Hajra | < 6.9 BGT | - | IMPLEMENTED |
| Ichwan | 6.9 BGT | - | IMPLEMENTED |
| Qanat | 69 BGT | - | IMPLEMENTED |
| Sihaya | 222 BGT | - | IMPLEMENTED |
| Mushtamal | 420 BGT | - | IMPLEMENTED |
| Sayyadina | 690 BGT | - | IMPLEMENTED |
| Usul | 888 BGT | - | IMPLEMENTED |
| Fedaykin | 1,111+ BGT | Top 8-69 | IMPLEMENTED |
| Naib | 1,111+ BGT | Top 7 | IMPLEMENTED |

### 2.2 TierService Features
- `calculateTier(bgt, rank)`: Determines tier from BGT + rank
- `isPromotion(oldTier, newTier)`: Checks tier progression
- `getTierProgress(tier, bgt, rank)`: Progress to next tier
- `updateMemberTier()`: Persists tier changes to database
- `getTierDistribution()`: Analytics on tier spread

### 2.3 Database Schema
```sql
-- member_profiles extension (migration 006)
ALTER TABLE member_profiles ADD COLUMN tier TEXT DEFAULT 'hajra' NOT NULL;
ALTER TABLE member_profiles ADD COLUMN tier_updated_at TEXT;

-- tier_history table (migration 006)
CREATE TABLE tier_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id TEXT NOT NULL,
  old_tier TEXT,
  new_tier TEXT NOT NULL,
  bgt_at_change TEXT NOT NULL,
  rank_at_change INTEGER,
  changed_at TEXT DEFAULT (datetime('now')) NOT NULL
);
```

## 3. Core Features (IMPLEMENTED)

### 3.1 Eligibility System
- Top 69 BGT holders eligible for Fedaykin access
- Top 7 BGT holders eligible for Naib council
- 6-hour sync cycle via trigger.dev
- Admin override capability
- Grace period handling (24 hours default)

### 3.2 Social Layer
- **Profiles**: Nym, bio (160 chars), PFP, tier, tenure
- **Badges**: Tenure (OG, Veteran, Elder), Activity, Admin-awarded
- **Directory**: Filterable member browser with pagination
- **Leaderboard**: Badge count ranking

### 3.3 Naib Council (v2.1)
- 7 competitive seats
- Bump mechanics for seat changes
- Former Naib honor roll
- Seat history tracking

### 3.4 Threshold System (v2.1)
- Entry threshold tracking (position 69 BGT amount)
- Waitlist for positions 70-100
- Registration via `/register-waitlist`
- Snapshot history

### 3.5 Notification System (v2.1)
- Position update alerts
- At-risk warnings (positions 63-69)
- Frequency controls (1-3 per week, daily)
- Weekly counter reset

## 4. Discord Commands (IMPLEMENTED)

| Command | Description | Sprint |
|---------|-------------|--------|
| `/profile` | View/edit own profile | v2.0 |
| `/badges` | View badges with autocomplete | v2.0 |
| `/stats` | View engagement statistics | v2.0 |
| `/directory` | Browse member directory | v2.0 |
| `/leaderboard` | View engagement rankings | v2.0 |
| `/naib` | View Naib council status | v2.1 |
| `/threshold` | View entry threshold | v2.1 |
| `/register-waitlist` | Join waitlist (70-100) | v2.1 |
| `/alerts` | Manage notification preferences | v2.1 |
| `/position` | Check own position | v2.1 |
| `/admin-badge` | Admin badge management | v2.0 |

**Total**: 11 commands implemented

## 5. REST API (IMPLEMENTED)

### 5.1 Public Endpoints
- `GET /eligibility` - Top 69 wallets
- `GET /eligibility/:address` - Check specific address
- `GET /health` - Service health
- `GET /metrics` - Prometheus metrics

### 5.2 Member Endpoints
- `GET /api/profile` - Own profile
- `GET /api/members/:nym` - Public profile
- `GET /api/directory` - Member directory
- `GET /api/badges` - Badge definitions
- `GET /api/leaderboard` - Engagement rankings
- `GET /api/naib` - Naib council
- `GET /api/threshold` - Entry threshold
- `GET /api/notifications/preferences` - Alert prefs
- `GET /api/position` - Own position

### 5.3 Admin Endpoints
- `POST /admin/override` - Create override
- `GET /admin/overrides` - List overrides
- `GET /admin/audit-log` - Audit log
- `POST /admin/badges/award` - Award badge
- `GET /admin/alerts/stats` - Alert statistics

**Total**: 20+ API endpoints implemented

## 6. Scheduled Tasks (IMPLEMENTED)

| Task | Schedule | Description |
|------|----------|-------------|
| `sync-eligibility` | Every 6 hours | Fetch BGT data from chain |
| `weekly-reset` | Monday 00:00 UTC | Reset alert counters |
| `badge-check` | Daily 00:00 UTC | Award tenure/activity badges |
| `activity-decay` | Every 6 hours | Apply demurrage to activity |

## 7. NOT YET IMPLEMENTED (Future Sprints)

The following features are documented in PRD/SDD v3.0 but NOT in code:

### 7.1 Services
- SponsorService - Invite management
- DigestService - Weekly digest generation
- StoryService - Story fragment management
- StatsService - Personal statistics
- AnalyticsService - Admin analytics

### 7.2 Commands
- `/invite` - Sponsor invite management

### 7.3 Tasks
- `weekly-digest` - Generate/post weekly digest

### 7.4 Tables (Schema exists, services don't)
- `sponsor_invites` - Table exists, service doesn't
- `story_fragments` - Table exists, service doesn't
- `weekly_digests` - Table exists, service doesn't

## 8. Technical Stack

| Component | Technology | Version |
|-----------|------------|---------|
| Runtime | Node.js | 20.x LTS |
| Language | TypeScript | 5.6.x |
| Database | SQLite | better-sqlite3 11.6.0 |
| Discord | discord.js | 14.16.x |
| API | Express | 4.21.x |
| Scheduler | trigger.dev | 3.0.x |
| Chain | viem | 2.21.x |
| Logging | Pino | 9.5.x |
| Validation | Zod | 3.23.x |
| Testing | Vitest | 2.1.x |

## 9. Metrics

| Metric | Count |
|--------|-------|
| Services | 16 implemented |
| Discord Commands | 11 implemented |
| API Endpoints | 20+ implemented |
| Scheduled Tasks | 4 implemented |
| Database Tables | 15+ |
| Test Files | 13 |

---

> **Document Authority**: This PRD reflects code reality as of 2025-12-24.
> Claims are backed by `loa-grimoire/reality/` extraction files.

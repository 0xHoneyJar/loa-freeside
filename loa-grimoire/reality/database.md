# Database Schema Reality

> Generated: 2025-12-24
> Source: Code Reality Extraction (Phase 2)

## Migrations (6 total)

| # | File | Tables Created | Sprint |
|---|------|----------------|--------|
| 001 | `001_initial.ts` | eligibility_snapshots, current_eligibility, admin_overrides, audit_log, health_status, wallet_mappings, cached_claim_events, cached_burn_events | v1.0 |
| 002 | `002_social_layer.ts` | member_profiles, badges, member_badges, member_activity, member_perks | v2.0 |
| 003 | `003_migrate_v1_members.ts` | (Migration script) | v2.0 |
| 004 | `004_performance_indexes.ts` | (Indexes only) | v2.0 |
| 005 | `005_naib_threshold.ts` | naib_seats, waitlist_registrations, threshold_snapshots, notification_preferences, alert_history | v2.1 |
| 006 | `006_tier_system.ts` | tier_history, sponsor_invites, story_fragments, weekly_digests + member_profiles (tier columns) | v3.0 |

## v3.0 Schema Additions (Migration 006)

### member_profiles Extension
```sql
ALTER TABLE member_profiles ADD COLUMN tier TEXT DEFAULT 'hajra' NOT NULL
  CHECK (tier IN ('hajra', 'ichwan', 'qanat', 'sihaya', 'mushtamal',
                  'sayyadina', 'usul', 'fedaykin', 'naib'));
ALTER TABLE member_profiles ADD COLUMN tier_updated_at TEXT DEFAULT (datetime('now')) NOT NULL;
```

### tier_history Table
```sql
CREATE TABLE IF NOT EXISTS tier_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id TEXT NOT NULL,
  old_tier TEXT,
  new_tier TEXT NOT NULL,
  bgt_at_change TEXT NOT NULL,
  rank_at_change INTEGER,
  changed_at TEXT DEFAULT (datetime('now')) NOT NULL,
  FOREIGN KEY (member_id) REFERENCES member_profiles(member_id)
);
```

### sponsor_invites Table
```sql
CREATE TABLE IF NOT EXISTS sponsor_invites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sponsor_member_id TEXT NOT NULL,
  invitee_discord_user_id TEXT NOT NULL,
  sponsor_tier_at_invite TEXT NOT NULL,
  status TEXT DEFAULT 'pending' NOT NULL,
  created_at TEXT DEFAULT (datetime('now')) NOT NULL,
  accepted_at TEXT,
  invitee_member_id TEXT,
  revoked_by TEXT,
  revoke_reason TEXT,
  revoked_at TEXT
);
```

### story_fragments Table
```sql
CREATE TABLE IF NOT EXISTS story_fragments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL CHECK (category IN ('fedaykin_join', 'naib_join')),
  fragment_text TEXT NOT NULL,
  usage_count INTEGER DEFAULT 0 NOT NULL,
  created_at TEXT DEFAULT (datetime('now')) NOT NULL,
  last_used_at TEXT
);
```

### weekly_digests Table
```sql
CREATE TABLE IF NOT EXISTS weekly_digests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  week_identifier TEXT NOT NULL UNIQUE,
  total_members INTEGER NOT NULL,
  new_members INTEGER NOT NULL,
  total_bgt TEXT NOT NULL,
  tier_distribution TEXT NOT NULL,
  most_active_tier TEXT,
  promotions_count INTEGER NOT NULL,
  notable_promotions TEXT,
  badges_awarded INTEGER NOT NULL,
  top_new_member_nym TEXT,
  message_id TEXT,
  channel_id TEXT,
  generated_at TEXT DEFAULT (datetime('now')) NOT NULL,
  posted_at TEXT
);
```

## Technology

- **Database**: SQLite with better-sqlite3 v11.6.0
- **WAL Mode**: Enabled for concurrent reads
- **Foreign Keys**: Enabled

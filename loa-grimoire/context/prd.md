# Product Requirements Document: Sietch

**Version**: 3.0
**Date**: December 20, 2025
**Status**: Draft
**Codename**: The Great Expansion

---

## 1. Executive Summary

### 1.1 Product Overview

**Sietch** is a privacy-first, token-gated Discord community for BGT (Berachain Governance Token) holders who have never redeemed (burned) any of their BGT holdings.

Version 3.0 introduces **The Great Expansion** - a multi-tiered membership system that opens the community beyond the top 69 to ALL qualified BGT holders with a minimum of 6.9 BGT. This creates a layered sanctuary with 9 distinct tiers, progressive access controls, and community growth mechanics including sponsor invites.

### 1.2 Problem Statement

Sietch v2.0/v2.1 successfully established:
1. Token-gated community for top 69 BGT holders
2. Privacy-preserving pseudonymous identity system
3. Social layer with profiles, badges, and engagement tracking
4. Naib governance layer with dynamic seat competition
5. Waitlist system for positions 70-100

**However**, the current system has limitations:
1. **Exclusivity ceiling** - Only 69 members can participate; vast majority of BGT holders excluded
2. **Limited growth** - Community can't grow beyond fixed cap despite demand
3. **Binary access** - You're either in (top 69) or out; no graduated access
4. **Missed engagement** - Holders with significant BGT (e.g., 500 BGT) have no pathway

### 1.3 Vision

Sietch v3.0 transforms from an exclusive club into a **layered sanctuary**:

- **9 tiers** based on BGT holdings (6.9 minimum to Top 7)
- **Progressive permissions** - Higher tiers unlock more access and capabilities
- **Sponsor system** - Recognized contributors can invite one person to share their tier
- **Automated celebrations** - Tier promotions and badge awards trigger notifications
- **Weekly pulse** - Digest recapping community activity
- **Story immersion** - Cryptic Dune-themed narratives when elite members join

**Core Principle**: Maintain the "never redeemed" purity requirement while dramatically expanding who can participate.

### 1.4 Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Total membership | 500+ active | Members across all tiers |
| Tier distribution | Healthy curve | No tier > 40% of total |
| Engagement depth | Correlated | Higher tiers show higher engagement |
| DAU BGT representation | 1M+ BGT | Total BGT held by daily active users |
| Profile completion | >80% | Members with nym, PFP, and bio |
| Retention | >85% at 30 days | Monthly member retention |
| Sponsor utilization | >50% | Sponsors who use their invite |

---

## 2. Tier System

### 2.1 Complete Tier Structure

| BGT Threshold | Tier Name | Area | Permissions |
|---------------|-----------|------|-------------|
| **6.9+** | Hajra | Tier 0 (Cave Entrance) | Read-only; see VC member count only |
| **69+** | Ichwan | Tier 0 (Cave Entrance) | Read/write in Tier 0; see VC member count only |
| **222+** | Qanat | Tier 2 | Read Tier 2, write Tier 0+; see VC member count |
| **420+** | Sihaya | Tier 2 | Write Tier 2+0; see VC member count |
| **690+** | Mushtamal | Tier 2 | Write Tier 2+0; full VC access in Tier 2 |
| **888+** | Sayyadina | Tier 3 | Write Tier 3+2+0; see VC members (no speak) |
| **1111+** | Usul | Tier 3 | Write Tier 3+2+0; full VC access in Tier 3 |
| **Top 8-69** | Fedaykin | All Public | Full access all public channels + VCs |
| **Top 7** | Naib | Council + All | Full access + private Naib council zone |

### 2.2 Tier Naming (Dune Lore)

All tier names draw from Frank Herbert's Dune universe:

- **Hajra** - "Journey of seeking" - on the path to belonging
- **Ichwan** - "Brotherhood" (from Ichwan Bedwine) - first acceptance into community
- **Qanat** - Underground water channels - access to hidden depths
- **Sihaya** - "Desert spring" (Chani's secret name) - precious, life-giving
- **Mushtamal** - Inner garden of the sietch - trusted inner space
- **Sayyadina** - Fremen priestess rank - spiritual guide, near-leader
- **Usul** - "Base of the pillar" (Paul's sietch name) - innermost identity
- **Fedaykin** - Elite warriors, death commandos of the Fremen
- **Naib** - Tribal leader of the sietch

### 2.3 Eligibility Requirements

**All tiers require**:
1. BGT balance >= tier threshold
2. **Zero BGT redemptions** - Never burned any BGT from wallet
3. Wallet verification via Collab.Land
4. Completed onboarding (nym, PFP, optional bio)

**Note**: BGT can only increase (redemption = disqualification). Members can only maintain or rise in tier - never fall due to BGT decrease.

### 2.4 Tier Progression

```
Hajra (6.9) → Ichwan (69) → Qanat (222) → Sihaya (420) → Mushtamal (690)
                                                              ↓
                                    Sayyadina (888) → Usul (1111)
                                                              ↓
                                         Fedaykin (Top 8-69) → Naib (Top 7)
```

**Tier upgrades are automatic**: When a member's BGT crosses a threshold during sync, they're upgraded.

### 2.5 Dynamic Naib System (Retained from v2.1)

The Naib tier operates differently from threshold-based tiers - it uses **rank-based competition**.

#### 2.5.1 Naib Seat Formation

The Naib consists of 7 seats, initially filled by the first 7 eligible members to complete onboarding.

**Initial Formation**: Based on onboarding completion timestamp (first come, first served).

#### 2.5.2 Naib Seat Competition

Once all 7 Naib seats are filled, seats become competitive based on BGT holdings:

**Bump Mechanics**:
1. New eligible member completes onboarding with BGT > lowest Naib member's BGT
2. Lowest Naib member (by BGT) is bumped
3. **Tie-breaker**: If BGT amounts are equal, the member with longer tenure keeps their seat
4. Bumped member receives "Former Naib" status and becomes Fedaykin
5. New member takes the Naib seat

**Re-entry**: Former Naib members CAN regain a seat if their BGT increases above the current lowest Naib member.

#### 2.5.3 Naib Roles & Permissions

| Role | Criteria | Discord Role | Permissions |
|------|----------|--------------|-------------|
| **Naib** | Current top 7 by BGT rank | `@Naib` | Access to Naib Council + Naib Archives |
| **Former Naib** | Previously held Naib seat | `@Former Naib` | Access to Naib Archives only |

#### 2.5.4 Naib Archives

A private area visible only to Naib and Former Naib members for historical discussions and recognition of service.

### 2.6 Fedaykin Competition (Retained from v2.1)

Fedaykin (Top 8-69) positions are also rank-based and competitive:

- Members can be bumped out of Fedaykin if pushed below position 69
- At-risk members (bottom ~10% of Fedaykin) receive warnings
- Same tenure tie-breaker applies for equal BGT

---

## 3. Discord Channel Structure

### 3.1 Proposed Minimal Structure

Philosophy: Higher tiers see all channels below. Minimize channels to prevent overwhelm.

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
│   └── 🔊 council-chamber ──── Private VC (hidden from all others)
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

### 3.2 Permission Matrix

| Channel | Hajra | Ichwan | Qanat | Sihaya | Mushtamal | Sayyadina | Usul | Fedaykin | Naib |
|---------|-------|--------|-------|--------|-----------|-----------|------|----------|------|
| #cave-entrance | Read | R/W | R/W | R/W | R/W | R/W | R/W | R/W | R/W |
| cave-voices | Count | Join | Join | Join | Join | Join | Join | Full | Full |
| #the-depths | - | - | Read | R/W | R/W | R/W | R/W | R/W | R/W |
| depth-voices | - | - | Count | Count | Full | Full | Full | Full | Full |
| #inner-sanctum | - | - | - | - | - | R/W | R/W | R/W | R/W |
| sanctum-voices | - | - | - | - | - | See | Full | Full | Full |
| Fedaykin channels | - | - | - | - | - | - | - | Full | Full |
| #council-rock | - | - | - | - | - | - | - | - | Full |

---

## 4. Functional Requirements

### 4.1 Tier Management Service

#### 4.1.1 Tier Assignment

- Automatic tier calculation based on BGT balance
- Tier stored in member profile
- Role assignment via Discord API
- Upgrade notifications via DM

#### 4.1.2 Tier Data Model Extension

```sql
-- Add tier to member_profiles
ALTER TABLE member_profiles ADD COLUMN tier TEXT DEFAULT 'hajra';
ALTER TABLE member_profiles ADD COLUMN tier_updated_at INTEGER;

-- Tier history for analytics
CREATE TABLE tier_history (
    id TEXT PRIMARY KEY,
    member_id TEXT NOT NULL,
    from_tier TEXT,
    to_tier TEXT NOT NULL,
    bgt_at_change INTEGER NOT NULL,
    changed_at INTEGER NOT NULL,
    FOREIGN KEY (member_id) REFERENCES member_profiles(id)
);
```

### 4.2 Sponsor/Invite System

#### 4.2.1 Sponsor Badge

**"Water Sharer"** badge - Dune-themed recognition for contributors:
- Granted by admin via `/admin badge award`
- Indicates member can sponsor one person
- Visible on profile and directory

#### 4.2.2 Invite Mechanics

- **Command**: `/invite @discorduser`
- **Effect**: Invited person receives sponsor's tier
- **Duration**: Permanent (as long as sponsor has the badge)
- **Limit**: One active invite per sponsor
- **Requirements**:
  - Sponsor must have Water Sharer badge
  - Invited user must not already be a member
  - Invited user doesn't need BGT (bypass)

#### 4.2.3 Invite Data Model

```sql
CREATE TABLE sponsor_invites (
    id TEXT PRIMARY KEY,
    sponsor_member_id TEXT NOT NULL,
    invited_discord_id TEXT NOT NULL,
    invited_member_id TEXT,  -- Set when they complete onboarding
    tier_granted TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    accepted_at INTEGER,
    revoked_at INTEGER,
    FOREIGN KEY (sponsor_member_id) REFERENCES member_profiles(id)
);
```

### 4.3 Notification System Extensions

#### 4.3.1 Tier Promotion Notifications

DM sent when member crosses tier threshold:

```
🎉 Tier Promotion!

Congratulations, {nym}! You've ascended to **{new_tier}**.

Your BGT holdings have crossed the {threshold} BGT threshold.
New channels are now available to you.

[View Your Profile]
```

#### 4.3.2 Badge Award Notifications

DM sent when admin awards badge:

```
🏅 New Badge Earned!

{nym}, you've been recognized!

**{badge_name}**
{badge_description}

{special_note if Water Sharer: "You can now invite one person to share your tier using /invite"}

[View Your Badges]
```

#### 4.3.3 Position Alert System (Retained from v2.1)

**Alert Types for Rank-Based Tiers (Fedaykin/Naib)**:

| Alert Type | Recipients | Trigger | Content |
|------------|------------|---------|---------|
| **Position Update** | Opted-in Fedaykin/Naib | Every 6h sync | Relative position vs above/below |
| **At-Risk Warning** | Bottom ~10% of Fedaykin | When position threatened | Private warning with BGT distances |
| **Naib Threat** | Naib members | When higher-BGT member joins | Warning that seat may be at risk |
| **Bump Notification** | Bumped member | When actually bumped | Notification of status change |

**At-Risk Warning** (sent to bottom ~10% of Fedaykin):
```
⚠️ Position Alert

You are currently in the bottom 10% of Fedaykin members.

Your standing:
• Position #70 (first outside): 52 BGT behind you
• Position #71: 231 BGT behind you

If a wallet with more BGT than yours becomes eligible,
you may lose your Fedaykin status.

This is a private alert - your position is never shown publicly.
━━━━━━━━━━━━━━━━━━━━━━━
[Understood] [Turn Off At-Risk Alerts]
```

**Notification Preferences** (`/alerts` command):
- Position Updates: ON/OFF, frequency (1/week, 2/week, 3/week, daily)
- At-Risk Warnings: ON/OFF
- Naib Alerts: ON/OFF (only shown to Naib members)

#### 4.3.4 Weekly Digest

Posted to #announcements every Monday:

```
📜 Weekly Pulse of the Sietch

**Week of {date_range}**

📊 Community Stats:
• Total Members: {count} (+{new_this_week})
• BGT Represented: {total_bgt} BGT
• Most Active Tier: {tier_name}

🎖️ New Members:
• {count} joined this week
• Notable: {top_bgt_new_member} entered as {tier}

⬆️ Tier Promotions:
• {count} members rose to higher tiers
• {nym} reached Usul!

🏅 Badges Awarded:
• {count} badges given this week

The spice flows...
```

### 4.4 Story Fragment System

#### 4.4.1 Top 69 Join Announcements

When a new Fedaykin or Naib joins, post a cryptic story fragment to #the-door:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
The winds shifted across the Great Bled.
A new figure emerged from the dancing sands,
their stillsuit bearing the marks of deep desert travel.

The watermasters took note.
Another has proven their worth in the spice trade.

A new Fedaykin walks among us.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

Story fragments are:
- Pre-written collection (10-20 variations)
- Randomly selected
- Never reveal nym or tier specifics
- Posted immediately after onboarding completes

### 4.5 Analytics Dashboard (Admin)

#### 4.5.1 Stats Command

`/admin stats` - Shows:
- Total members by tier
- Tier distribution chart
- Total BGT represented
- Weekly active users
- New members this week
- Tier promotions this week
- Badge awards this week

#### 4.5.2 API Endpoint

`GET /admin/analytics` returns:
```json
{
  "total_members": 450,
  "by_tier": {
    "hajra": 150,
    "ichwan": 120,
    "qanat": 80,
    "sihaya": 50,
    "mushtamal": 25,
    "sayyadina": 12,
    "usul": 6,
    "fedaykin": 6,
    "naib": 1
  },
  "total_bgt": 1250000,
  "weekly_active": 320,
  "new_this_week": 45,
  "promotions_this_week": 12
}
```

### 4.6 Member Stats Command

`/stats` - Personal activity summary (ephemeral):

```
📊 Your Sietch Stats

**{nym}** | {tier}

📈 Activity:
• Messages this week: {count}
• Current streak: {days} days
• Longest streak: {days} days

🎖️ Badges: {count}
• {badge_list}

⬆️ Tier Progress:
• Current: {tier} ({bgt} BGT)
• Next tier: {next_tier} at {threshold} BGT
• Distance: {distance} BGT to go

🕐 Member since: {date}
```

### 4.7 Tier Leaderboard

`/leaderboard tiers` - Shows progression toward next tier:

```
📊 Tier Progression Leaderboard

Closest to Promotion:

1. {nym} - 418/420 BGT → Sihaya (2 BGT away)
2. {nym} - 880/888 BGT → Sayyadina (8 BGT away)
3. {nym} - 1100/1111 BGT → Usul (11 BGT away)
...

Your position: #{rank} ({bgt}/{next_threshold} BGT)
```

---

## 5. Badge System Updates

### 5.1 Existing Badges (Retained)

| Category | Badge | Criteria |
|----------|-------|----------|
| Tenure | OG | Member in first 30 days |
| Tenure | Veteran | 90+ days as member |
| Tenure | Elder | 180+ days as member |
| Streak | Consistent | 7 day activity streak |
| Streak | Dedicated | 30 day activity streak |
| Streak | Devoted | 90 day activity streak |
| Contribution | Helper | Admin-granted for helping others |
| Contribution | Thought Leader | Admin-granted for quality contributions |
| Special | Founding Fedaykin | Original top 69 at launch |
| Special | Promoted | Rose to Fedaykin from lower tier |

### 5.2 New Badges (v3.0)

| Badge | Criteria | Unlocks |
|-------|----------|---------|
| **Water Sharer** | Admin-granted for contributions | Sponsor invite ability |
| **Usul Ascended** | Reached Usul tier (1111+ BGT) | Prestige recognition |

### 5.3 Badge Display

- All badges visible on profile
- Top 3 badges shown in directory preview
- Water Sharer badge shows invite status (used/available)

---

## 6. Slash Commands

### 6.1 New Commands

| Command | Description | Visibility |
|---------|-------------|------------|
| `/stats` | Personal activity summary | Ephemeral |
| `/leaderboard tiers` | Tier progression leaderboard | Public |
| `/invite @user` | Sponsor invite (requires badge) | Ephemeral |
| `/invite status` | Check your invite status | Ephemeral |

### 6.2 Retained Commands (from v2.1)

| Command | Description | Visibility |
|---------|-------------|------------|
| `/naib` | View current Naib members and Former Naib | Public |
| `/threshold` | View current Fedaykin entry threshold | Public |
| `/position` | View your position relative to above/below (no rank #) | Ephemeral |
| `/alerts` | Configure notification preferences | Ephemeral |

### 6.3 Updated Commands

| Command | Changes |
|---------|---------|
| `/profile` | Shows tier in addition to other info |
| `/directory` | Filter by tier, shows tier in listing |
| `/leaderboard` | Add "tiers" sub-command |

### 6.4 Admin Commands

| Command | Description |
|---------|-------------|
| `/admin stats` | Community analytics dashboard |
| `/admin badge award @user water-sharer` | Grant sponsor badge |
| `/admin invite revoke @user` | Revoke sponsor's invite |

---

## 7. Technical Requirements

### 7.1 Database Schema Extensions

```sql
-- Tier tracking
ALTER TABLE member_profiles ADD COLUMN tier TEXT DEFAULT 'hajra';
ALTER TABLE member_profiles ADD COLUMN tier_updated_at INTEGER;

-- Tier history
CREATE TABLE tier_history (
    id TEXT PRIMARY KEY,
    member_id TEXT NOT NULL,
    from_tier TEXT,
    to_tier TEXT NOT NULL,
    bgt_at_change INTEGER NOT NULL,
    changed_at INTEGER NOT NULL,
    FOREIGN KEY (member_id) REFERENCES member_profiles(id)
);

CREATE INDEX idx_tier_history_member ON tier_history(member_id);
CREATE INDEX idx_tier_history_date ON tier_history(changed_at);

-- Sponsor invites
CREATE TABLE sponsor_invites (
    id TEXT PRIMARY KEY,
    sponsor_member_id TEXT NOT NULL,
    invited_discord_id TEXT NOT NULL,
    invited_member_id TEXT,
    tier_granted TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    accepted_at INTEGER,
    revoked_at INTEGER,
    FOREIGN KEY (sponsor_member_id) REFERENCES member_profiles(id)
);

CREATE INDEX idx_invites_sponsor ON sponsor_invites(sponsor_member_id);
CREATE INDEX idx_invites_discord ON sponsor_invites(invited_discord_id);

-- Story fragments
CREATE TABLE story_fragments (
    id TEXT PRIMARY KEY,
    category TEXT NOT NULL,  -- 'fedaykin_join', 'naib_join', etc.
    content TEXT NOT NULL,
    used_count INTEGER DEFAULT 0
);

-- Weekly digest tracking
CREATE TABLE weekly_digests (
    id TEXT PRIMARY KEY,
    week_start DATE NOT NULL UNIQUE,
    stats_json TEXT NOT NULL,
    posted_at INTEGER,
    message_id TEXT
);

-- Naib seat tracking (retained from v2.1)
CREATE TABLE naib_seats (
    id TEXT PRIMARY KEY,
    member_id TEXT NOT NULL,
    seat_number INTEGER NOT NULL CHECK (seat_number BETWEEN 1 AND 7),
    seated_at INTEGER NOT NULL,
    unseated_at INTEGER,
    unseated_by TEXT,
    unseated_reason TEXT CHECK (unseated_reason IN ('bumped', 'left_server', 'ineligible', NULL)),
    FOREIGN KEY (member_id) REFERENCES member_profiles(id),
    FOREIGN KEY (unseated_by) REFERENCES member_profiles(id)
);

CREATE INDEX idx_naib_current ON naib_seats(member_id) WHERE unseated_at IS NULL;
CREATE INDEX idx_naib_history ON naib_seats(member_id, seated_at);

-- Notification preferences (retained from v2.1)
CREATE TABLE notification_preferences (
    member_id TEXT PRIMARY KEY,
    position_updates_enabled INTEGER DEFAULT 1,
    position_update_frequency TEXT DEFAULT '3_per_week',
    at_risk_warnings_enabled INTEGER DEFAULT 1,
    naib_alerts_enabled INTEGER DEFAULT 1,
    last_position_alert_at INTEGER,
    alerts_sent_this_week INTEGER DEFAULT 0,
    week_start_timestamp INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (member_id) REFERENCES member_profiles(id)
);

-- Alert history for audit and rate limiting (retained from v2.1)
CREATE TABLE alert_history (
    id TEXT PRIMARY KEY,
    member_id TEXT,
    discord_user_id TEXT,
    alert_type TEXT NOT NULL CHECK (alert_type IN (
        'position_update',
        'at_risk_warning',
        'naib_threat',
        'bump_notification',
        'tier_promotion',
        'badge_award'
    )),
    content_summary TEXT,
    sent_at INTEGER NOT NULL,
    FOREIGN KEY (member_id) REFERENCES member_profiles(id)
);

CREATE INDEX idx_alert_history_member ON alert_history(member_id, sent_at);
CREATE INDEX idx_alert_history_type ON alert_history(alert_type, sent_at);
```

### 7.2 New Services

| Service | Responsibility |
|---------|----------------|
| `TierService` | Tier calculation, assignment, history |
| `SponsorService` | Invite management, validation |
| `DigestService` | Weekly stats collection, posting |
| `StoryService` | Fragment selection, posting |

### 7.3 Retained Services (from v2.1)

| Service | Responsibility |
|---------|----------------|
| `NaibService` | Naib seat management, bumping logic, history |
| `NotificationService` | Position alerts, at-risk warnings, Naib threats, rate limiting |
| `ThresholdService` | Fedaykin threshold calculation, distance metrics |

### 7.4 API Endpoints

```
# Public
GET  /api/tiers                    → Tier definitions and thresholds
GET  /api/stats/community          → Public community stats
GET  /api/naib                     → Current Naib + Former Naib list
GET  /api/threshold                → Current Fedaykin entry threshold

# Member (authenticated)
GET  /api/me/stats                 → Personal activity stats
GET  /api/me/tier-progress         → Distance to next tier
GET  /api/me/position              → Position relative to above/below
POST /api/invite                   → Create sponsor invite
GET  /api/invite/status            → Check invite status
GET  /api/notifications/preferences   → Get notification settings
PUT  /api/notifications/preferences   → Update notification settings

# Admin
GET  /admin/analytics              → Full analytics dashboard
POST /admin/badges/water-sharer    → Grant sponsor badge
DELETE /admin/invites/:id          → Revoke invite
GET  /admin/alerts/stats           → Alert delivery statistics
```

### 7.5 Scheduled Tasks

| Task | Schedule | Function |
|------|----------|----------|
| `syncEligibility` | Every 6 hours | Sync BGT, update tiers, evaluate Naib seats, send promotions |
| `processPositionAlerts` | Daily | Send position alerts respecting frequency limits |
| `weeklyDigest` | Monday 00:00 UTC | Generate and post weekly digest |
| `weeklyReset` | Monday 00:00 UTC | Reset weekly alert counters |

### 7.6 Non-Functional Requirements

| Requirement | Specification |
|-------------|---------------|
| Availability | 99.5% uptime |
| Latency | API < 200ms, bot < 1s |
| Scale | Support 500+ members |
| Database | SQLite (sufficient for scale) |
| Privacy | Zero wallet exposure in public APIs |

---

## 8. User & Stakeholder Context

### 8.1 User Personas (Expanded)

| Persona | BGT Range | Tier | Needs |
|---------|-----------|------|-------|
| **The Curious** | 6.9-69 | Hajra | Wants to observe, learn the culture |
| **The Engaged** | 69-420 | Ichwan-Sihaya | Wants to participate, build reputation |
| **The Committed** | 420-1111 | Sihaya-Usul | Deep engagement, seeking recognition |
| **The Elite** | 1111+ / Top 69 | Usul-Naib | Leadership, influence, exclusivity |
| **The Sponsor** | Any + badge | Any | Wants to bring trusted friends |

### 8.2 Privacy Threat Model (Unchanged)

All tiers receive same privacy protections:
- Wallet addresses never exposed publicly
- Exact BGT balances never shown
- Exact rank positions private
- Only tier name visible (not BGT amount)

---

## 9. Scope

### 9.1 In Scope (v3.0)

**New Features:**
- [x] 9-tier membership system
- [x] BGT-based automatic tier assignment
- [x] Tier-specific channel permissions
- [x] Sponsor/invite system (Water Sharer badge)
- [x] Tier promotion notifications
- [x] Badge award notifications
- [x] `/stats` personal summary command
- [x] `/leaderboard tiers` command
- [x] `/invite` command
- [x] Weekly digest automation
- [x] Story fragment system for elite joins
- [x] Admin analytics dashboard
- [x] Usul Ascended badge
- [x] Full onboarding for all tiers

**Retained from v2.1:**
- [x] Dynamic Naib system (7 seats, BGT competition, tenure tie-breaker)
- [x] Former Naib status and recognition
- [x] Naib Archives for Naib + Former Naib
- [x] Position alert system (relative standings for Fedaykin/Naib)
- [x] At-risk warnings (bottom ~10% of Fedaykin)
- [x] Naib threat alerts
- [x] Notification preferences (opt-in, configurable frequency)
- [x] `/naib`, `/threshold`, `/position`, `/alerts` commands

### 9.2 Out of Scope (Future)

- Web dashboard / public stats page
- Mobile app
- NFT badge representations
- On-chain verification (non Collab.Land)
- Cross-server identity portability
- Token rewards or airdrops

### 9.3 Migration from v2.1

- Existing top 69 members auto-assigned Fedaykin/Naib tier
- Former Naib retain their status
- All existing badges preserved
- New lower-tier members go through full onboarding
- Waitlist registrations converted to tier-based membership

---

## 10. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| **Collab.Land tier limits** | Medium | High | Test multi-role configuration; fallback to custom verification |
| **Discord API complexity** | Medium | Medium | Careful permission planning; phased rollout |
| **User confusion (7 tiers)** | High | Medium | Clear documentation; onboarding explanation; minimal channels |
| **Sponsor abuse** | Low | Medium | Admin-granted only; one invite limit; revocation capability |
| **Low engagement lower tiers** | Medium | Low | Quality content in upper tiers visible; tier progression incentive |
| **Privacy leak in tiers** | Low | Critical | Same protections all tiers; audit tier displays |

---

## 11. Dependencies

### 11.1 External Dependencies

| Service | Purpose | Notes |
|---------|---------|-------|
| Discord | Platform | API for roles, channels, permissions |
| Collab.Land | Verification | Multi-tier token gate configuration |
| Berachain RPC | BGT data | Existing infrastructure |
| trigger.dev | Scheduling | Existing infrastructure |

### 11.2 Internal Dependencies

- v2.1 complete (Naib, notifications, etc.)
- Production deployment infrastructure ready

---

## 12. Timeline

**Estimated Duration**: 3-4 weeks

### Phase 1: Core Tier System (Week 1-2)
- Database schema extensions
- TierService implementation
- Role management for 9 tiers
- Channel permission configuration
- Tier assignment during sync

### Phase 2: Sponsor & Notifications (Week 2-3)
- SponsorService implementation
- Water Sharer badge
- Tier promotion notifications
- Badge award notifications
- `/invite` command

### Phase 3: Engagement Features (Week 3-4)
- `/stats` command
- `/leaderboard tiers` command
- Weekly digest automation
- Story fragment system
- Admin analytics dashboard

### Phase 4: Testing & Polish (Week 4)
- Integration testing
- Permission verification
- Documentation
- Staging deployment
- Production release

---

## 13. Discord Role Hierarchy (v3.0)

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
| `@Engaged` | Green | 5+ badges | Badge count |
| `@Veteran` | Purple | 90+ days | Tenure |

---

## 14. Appendix

### 14.1 Story Fragment Examples

**Fedaykin Join:**
```
The desert wind carried whispers of a new arrival.
One who had held their water, never trading the sacred spice.
The sietch grows stronger.
```

```
Footsteps in the sand revealed a traveler from distant dunes.
They bore no marks of the water sellers.
A new Fedaykin has earned their place.
```

**Naib Join:**
```
The council chamber stirred.
A presence of great weight approached -
one whose reserves of melange could shift the balance.
A new voice joins the Naib.
```

### 14.2 Tier Threshold Rationale

| Threshold | Significance |
|-----------|--------------|
| 6.9 | Meme number, low barrier to entry |
| 69 | Meme number, original eligibility threshold |
| 222 | Angel number, first significant step |
| 420 | Meme culture, middle ground |
| 690 | 10x of entry threshold |
| 888 | Lucky number, near-elite |
| 1111 | Angel number, penultimate tier |

### 14.3 Weekly Digest Data Collection

```typescript
interface WeeklyStats {
  week_start: Date;
  total_members: number;
  new_members: number;
  total_bgt: number;
  tier_distribution: Record<string, number>;
  most_active_tier: string;
  promotions: number;
  badges_awarded: number;
  top_new_member?: { nym: string; tier: string };
  notable_promotions: Array<{ nym: string; new_tier: string }>;
}
```

---

## 15. Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2025-12-17 | Initial MVP - token gating, eligibility |
| 2.0 | 2025-12-18 | Social Layer - profiles, badges, directory |
| 2.1 | 2025-12-19 | Naib Dynamics & Threshold system |
| 3.0 | 2025-12-20 | The Great Expansion - 9-tier system, sponsors |

---

*Document generated by PRD Architect*

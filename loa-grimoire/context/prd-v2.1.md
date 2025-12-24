# Product Requirements Document: Sietch v2.1

> **DEPRECATED**: This document has been superseded by PRD v3.0 (`loa-grimoire/context/prd.md`)
> and the evidence-grounded PRD (`loa-grimoire/artifacts/prd-grounded.md`).
> Retained for historical reference only. Last updated: December 19, 2025.

**Version**: 2.1
**Date**: December 19, 2025
**Status**: DEPRECATED (Superseded by v3.0)
**Codename**: Naib Dynamics & Threshold

---

## 1. Executive Summary

### 1.1 Product Overview

**Sietch v2.1** introduces the **Naib Dynamics & Threshold System** - a dynamic governance layer and waitlist visibility feature that rewards early adopters, creates competitive tension around eligibility boundaries, and provides transparency into who may be joining (or leaving) the community soon.

This release builds on the v2.0 Social Layer foundation with three major feature areas:

1. **Dynamic Naib System** - The first 7 eligible members receive Naib status, with dynamic seat competition based on BGT holdings
2. **Cave Entrance (Public Waitlist)** - A lobby for aspiring members (positions 70-100) to observe and prepare
3. **Position Alert System** - Personalized notifications about ranking changes and competitive threats

### 1.2 Problem Statement

The current Sietch system lacks:

1. **Early adopter recognition** - No special status for being among the first to join
2. **Competitive visibility** - Members don't know how secure their position is
3. **Waitlist engagement** - Aspiring members (positions 70-100) have no way to engage or prepare
4. **Proactive notifications** - Members only learn they've been bumped after it happens

### 1.3 Vision

Sietch becomes a dynamic community where:

- **Early members are celebrated** with Naib status that can be defended or lost
- **All members understand their position** relative to those above and below them
- **Aspiring members can engage** before becoming eligible, building anticipation
- **Transitions are graceful** with advance warning and transparent thresholds

**Design Philosophy**: Create competitive tension without compromising privacy. Members know their relative position but never know WHO specifically threatens them within the server.

### 1.4 Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Naib engagement | 100% Naib members active weekly | Naib Archives activity |
| Position alert opt-in retention | >70% keep alerts enabled | Members with alerts enabled after 30 days |
| Waitlist conversion | >50% of eligible waitlist members join | Registered waitlist → member conversion |
| At-risk retention | >60% of warned members improve position | Members who received at-risk alerts and moved up |
| Feature satisfaction | NPS >60 for new features | Post-launch survey |

---

## 2. User & Stakeholder Context

### 2.1 Target Users

| User Type | Description | Primary Needs |
|-----------|-------------|---------------|
| **Naib Member** | First 7 eligible members | Recognition, exclusive access, defense notifications |
| **Former Naib** | Bumped from Naib, now Fedaykin | Continued recognition, path back to Naib |
| **Core Member** | Positions 8-60 | Position awareness, upward mobility notifications |
| **At-Risk Member** | Positions 61-69 (bottom ~10%) | Early warning of threats, actionable insights |
| **Aspiring Member** | Positions 70-100 | Visibility into threshold, notification when eligible |

### 2.2 User Stories

#### Naib Members
- As a Naib member, I want to know when someone with more BGT joins so I can prepare for potential seat loss
- As a Naib member, I want access to an exclusive area with other current and Former Naib members
- As a Former Naib member, I want recognition that I once held a seat

#### Core Members
- As a member, I want to know how far I am from moving up a position
- As a member, I want to know how close the person below me is to taking my spot
- As a member, I want to configure how often I receive position alerts

#### At-Risk Members
- As an at-risk member, I want private advance warning when my position is threatened
- As an at-risk member, I want to know specifically how much BGT I need to secure my position
- As an at-risk member, I want to opt out of warnings if I find them stressful

#### Aspiring Members
- As an aspiring member, I want to see how close I am to the top 69
- As an aspiring member, I want to register for alerts when I become eligible
- As an aspiring member, I want to observe the community before joining

### 2.3 Privacy Threat Model Extension

**New Privacy Constraints**:

| Data Point | Public | Members | Naib | Admins | Never |
|------------|--------|---------|------|--------|-------|
| Naib member list (by nym) | ✓ | | | | |
| Former Naib status | ✓ | | | | |
| "Position 70 is X BGT away" | ✓ | | | | |
| Waitlist positions 70-100 (wallets) | ✓ | | | | |
| Your relative position (N away from up/down) | | Self only | | | |
| Who specifically threatens your position | | | | | ✓ |
| Which members are at-risk | | | | ✓ | |
| Exact member BGT holdings | | | | | ✓ |

**Critical Privacy Rule**: We can show public chain data (waitlist wallet BGT amounts) but NEVER correlate which wallets belong to which nyms publicly.

---

## 3. Functional Requirements

### 3.1 Dynamic Naib System

#### 3.1.1 Naib Formation

The Naib consists of 7 seats, initially filled by the first 7 eligible members to complete onboarding.

**Initial Formation**:
```
[Server Launch]
       │
       ▼
[First eligible member completes onboarding]
       │
       ▼
[Awarded Naib Seat #1]
       │
       ▼
[... repeat until 7 seats filled ...]
       │
       ▼
[Naib fully formed]
[8th+ members become Fedaykin]
```

**Seat Assignment Order**: Based on onboarding completion timestamp (first come, first served).

#### 3.1.2 Naib Seat Competition

Once all 7 Naib seats are filled, seats become competitive based on BGT holdings:

**Bump Mechanics**:
1. New eligible member completes onboarding with BGT > lowest Naib member's BGT
2. Lowest Naib member (by BGT) is bumped
3. **Tie-breaker**: If BGT amounts are equal, the member with longer tenure keeps their seat
4. Bumped member receives "Former Naib" status and becomes Fedaykin
5. New member takes the Naib seat

**Re-entry**:
- Former Naib members CAN regain a seat if their BGT increases above the current lowest Naib member
- Same bump mechanics apply

**Example Scenario**:
```
Current Naib (by BGT):
1. Alice:   10,000 BGT (joined Day 1)
2. Bob:      8,000 BGT (joined Day 2)
3. Carol:    7,500 BGT (joined Day 3)
4. Dave:     7,000 BGT (joined Day 4)
5. Eve:      6,500 BGT (joined Day 5)
6. Frank:    6,000 BGT (joined Day 6)
7. Grace:    5,500 BGT (joined Day 7) ← Lowest

New member Hank joins with 6,200 BGT:
→ Hank's BGT (6,200) > Grace's BGT (5,500)
→ Grace is bumped → Former Naib + Fedaykin
→ New ranking: Hank takes #6 (6,200), Frank drops to #7 (6,000)
```

#### 3.1.3 Naib Roles & Permissions

| Role | Criteria | Discord Role | Permissions |
|------|----------|--------------|-------------|
| **Naib** | Current top 7 by first-join, defended by BGT | `@Naib` | Access to Naib Chamber + Naib Archives |
| **Former Naib** | Previously held Naib seat (implies Fedaykin) | `@Former Naib` | Access to Naib Archives only |
| **Fedaykin** | Positions 8-69 | `@Fedaykin` | Standard member access |

#### 3.1.4 Naib Archives

A private area visible only to Naib and Former Naib members:

```
🏛️ NAIB ARCHIVES (Naib + Former Naib Only)
└── #naib-archives ── Private discussion for all who have served
```

**Purpose**:
- Exclusive space for those who have held Naib seats
- Recognition of historical contribution
- Strategic discussions among the most committed members

#### 3.1.5 Naib Data Model

```sql
-- Track Naib seat history
CREATE TABLE naib_seats (
    id TEXT PRIMARY KEY,
    member_id TEXT NOT NULL,
    seat_number INTEGER NOT NULL CHECK (seat_number BETWEEN 1 AND 7),
    seated_at INTEGER NOT NULL,        -- When they took the seat
    unseated_at INTEGER,               -- When they lost it (null if current)
    unseated_by TEXT,                  -- member_id of who bumped them (null if still seated)
    unseated_reason TEXT,              -- 'bumped', 'left_server', 'ineligible'
    FOREIGN KEY (member_id) REFERENCES member_profiles(id),
    FOREIGN KEY (unseated_by) REFERENCES member_profiles(id)
);

-- Index for fast lookups
CREATE INDEX idx_naib_current ON naib_seats(unseated_at) WHERE unseated_at IS NULL;
CREATE INDEX idx_naib_member ON naib_seats(member_id);
```

### 3.2 Cave Entrance (Public Waitlist Lobby)

#### 3.2.1 Concept

A public-facing area of the Discord server where anyone can join, but only the "Cave Entrance" is visible. The rest of the server (the actual Sietch) remains hidden until they become eligible.

**Server Visibility by Status**:

| User Status | Can See | Cannot See |
|-------------|---------|------------|
| Non-member (anyone) | Cave Entrance only | All other channels |
| Waitlist registered | Cave Entrance only | All other channels |
| Eligible member | Everything | N/A |

#### 3.2.2 Cave Entrance Channels

```
🚪 CAVE ENTRANCE (Public)
├── #the-threshold ───── Live stats: how far positions 70-100 are from entry
├── #waiting-pool ────── Discussion for aspiring members
└── #register-interest ─ Bot command channel to register for alerts
```

#### 3.2.3 Threshold Display

The `#the-threshold` channel shows live statistics (updated every 6 hours with eligibility sync):

```
═══════════════════════════════════════════
        🏜️ THE THRESHOLD 🏜️
        Updated: 2025-12-19 06:00 UTC
═══════════════════════════════════════════

Current entry requirement: 5,432 BGT
(Position #69 holds this amount)

📊 NEXT IN LINE:
┌─────────────────────────────────────────┐
│ Position │ BGT Held │ Distance to Entry │
├─────────────────────────────────────────┤
│    70    │  5,380   │     52 BGT away   │
│    71    │  5,201   │    231 BGT away   │
│    72    │  5,150   │    282 BGT away   │
│    73    │  4,998   │    434 BGT away   │
│    74    │  4,872   │    560 BGT away   │
│   ...    │   ...    │        ...        │
│   100    │  3,241   │  2,191 BGT away   │
└─────────────────────────────────────────┘

Want to be notified when you're eligible?
Use /register-waitlist in #register-interest
═══════════════════════════════════════════
```

**Privacy Note**: This displays wallet addresses from public chain data (positions 70-100 are NOT current members, so no nym correlation risk).

#### 3.2.4 Waitlist Registration

Aspiring members can register their wallet to receive a DM when they become eligible:

**Command**: `/register-waitlist <wallet_address>`

**Flow**:
```
[User runs /register-waitlist 0x...]
           │
           ▼
[Bot verifies wallet is in positions 70-100]
           │
           ├── If not in range: "Your wallet is not in positions 70-100"
           │
           ▼
[Bot stores registration]
           │
           ▼
[Bot confirms]: "Registered! You'll receive a DM when you become eligible.
                Current position: 73 (434 BGT away from entry)"
```

**Data Model**:
```sql
CREATE TABLE waitlist_registrations (
    id TEXT PRIMARY KEY,
    discord_user_id TEXT NOT NULL,
    wallet_address TEXT NOT NULL,
    registered_at INTEGER NOT NULL,
    notified_at INTEGER,               -- When we sent eligibility notification
    UNIQUE(wallet_address)
);
```

### 3.3 Position Alert System

#### 3.3.1 Alert Types

| Alert Type | Recipients | Trigger | Content |
|------------|------------|---------|---------|
| **Position Update** | All opted-in members | Eligibility sync (6h) | Your relative position vs above/below |
| **At-Risk Warning** | Bottom N% members | When position threatened | Private warning with BGT distances |
| **Naib Threat** | Naib members | When higher-BGT member joins | Warning that seat may be at risk |
| **Bump Notification** | Bumped member | When actually bumped | Notification of status change |
| **Waitlist Alert** | Registered waitlist | When they become eligible | "You're now eligible!" |

#### 3.3.2 Position Update Alert

Sent to all members with alerts enabled (default: ON):

```
📊 Position Update

Your current standing:
• You are 127 BGT away from the position above you
• The position below you is 89 BGT away from yours

Stay vigilant, Fedaykin.
━━━━━━━━━━━━━━━━━━━━━━━
[Manage Alerts] [Disable]
```

**Frequency**: Configurable per-member, default max 3 per week

#### 3.3.3 At-Risk Warning

Sent to members in the bottom configurable percentage (default: 10% = ~7 members):

```
⚠️ Position Alert

You are currently in the bottom 10% of Sietch members.

Your standing:
• Position below you (currently #70): 52 BGT away
• Position below that (#71): 231 BGT away

If a wallet with more BGT than yours becomes eligible,
you may lose your spot in the Sietch.

This is a private alert - your position is never shown publicly.
━━━━━━━━━━━━━━━━━━━━━━━
[Understood] [Turn Off At-Risk Alerts]
```

#### 3.3.4 Naib Threat Alert

Sent to Naib members when their seat is at risk:

```
🏛️ Naib Alert

A new member has joined with BGT holdings that may affect Naib seating.

Your current Naib position may be at risk if you have the
lowest BGT holdings among Naib members.

Current lowest Naib BGT: 5,500
━━━━━━━━━━━━━━━━━━━━━━━
[View Naib Status] [Dismiss]
```

#### 3.3.5 Alert Configuration

Members can configure their notification preferences:

**Command**: `/alerts`

```
🔔 Notification Preferences

Position Updates:     [ON]  ────── Toggle
  Frequency:          [3/week ▼]   1/week, 2/week, 3/week, Daily

At-Risk Warnings:     [ON]  ────── Toggle

Naib Alerts:          [ON]  ────── Toggle
  (Only shown to Naib members)

[Save Preferences]
```

**Data Model**:
```sql
CREATE TABLE notification_preferences (
    member_id TEXT PRIMARY KEY,
    position_updates_enabled INTEGER DEFAULT 1,
    position_update_frequency TEXT DEFAULT '3_per_week', -- '1_per_week', '2_per_week', '3_per_week', 'daily'
    at_risk_warnings_enabled INTEGER DEFAULT 1,
    naib_alerts_enabled INTEGER DEFAULT 1,
    last_position_alert_at INTEGER,
    position_alerts_this_week INTEGER DEFAULT 0,
    week_start INTEGER,  -- For weekly reset
    FOREIGN KEY (member_id) REFERENCES member_profiles(id)
);
```

### 3.4 Discord Commands

#### 3.4.1 New Slash Commands

| Command | Description | Visibility |
|---------|-------------|------------|
| `/naib` | View current Naib members and Former Naib | Public |
| `/threshold` | View current entry threshold and waitlist stats | Public |
| `/position` | View your position relative to above/below (no rank #) | Private |
| `/alerts` | Configure notification preferences | Private |
| `/register-waitlist <wallet>` | Register for eligibility notifications | Public (Cave Entrance) |

#### 3.4.2 Command Details

**`/naib`**:
```
🏛️ THE NAIB

Current Naib Members:
1. Stilgar ─────── 🟢 Founding
2. Chani ──────── 🟢 Founding
3. Leto ─────────  Joined Day 12
4. Jessica ──────  Joined Day 15
5. Duncan ───────  Joined Day 18
6. Gurney ───────  Joined Day 23
7. Thufir ───────  Joined Day 31

📜 Former Naib:
• Paul (served Days 8-25)
• Irulan (served Days 14-45)

[View Naib Archives Info]
```

**`/position`** (private response):
```
📊 Your Position

You are currently a Fedaykin.

↑ 127 BGT to move up one position
↓ The position below is 89 BGT away

Your position is secure for now.
━━━━━━━━━━━━━━━━━━━━━━━
Last updated: 2 hours ago
[Configure Alerts]
```

**`/threshold`**:
```
🚪 The Threshold

Current entry requirement: 5,432 BGT

Next in line:
• Position 70: 52 BGT away
• Position 71: 231 BGT away
• Position 72: 282 BGT away

The Sietch has 69 members.
━━━━━━━━━━━━━━━━━━━━━━━
Updated every 6 hours
```

---

## 4. Technical Requirements

### 4.1 System Architecture Extensions

```
┌─────────────────────────────────────────────────────────────────┐
│                        SIETCH SERVICE                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐ │
│  │    Naib     │  │  Threshold  │  │    Notification         │ │
│  │   Service   │  │   Service   │  │      Service            │ │
│  │             │  │             │  │                         │ │
│  │ • Seat mgmt │  │ • Waitlist  │  │ • Position alerts       │ │
│  │ • Bumping   │  │ • Distance  │  │ • At-risk warnings      │ │
│  │ • History   │  │   calc      │  │ • Naib threats          │ │
│  │             │  │ • Registry  │  │ • Frequency limiting    │ │
│  └─────────────┘  └─────────────┘  └─────────────────────────┘ │
│         │                │                     │                │
│         └────────────────┼─────────────────────┘                │
│                          │                                      │
│                          ▼                                      │
│                 ┌─────────────────┐                            │
│                 │  Eligibility    │                            │
│                 │    Service      │                            │
│                 │  (existing)     │                            │
│                 └─────────────────┘                            │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 4.2 Database Schema Extensions

```sql
-- Naib seat tracking
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

-- Waitlist registrations for eligibility alerts
CREATE TABLE waitlist_registrations (
    id TEXT PRIMARY KEY,
    discord_user_id TEXT NOT NULL UNIQUE,
    wallet_address TEXT NOT NULL UNIQUE,
    position_at_registration INTEGER,
    bgt_at_registration TEXT,  -- Stored as string for precision
    registered_at INTEGER NOT NULL,
    notified_at INTEGER,
    unregistered_at INTEGER
);

-- Notification preferences
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

-- Alert history for audit and rate limiting
CREATE TABLE alert_history (
    id TEXT PRIMARY KEY,
    member_id TEXT,
    discord_user_id TEXT,  -- For waitlist alerts (no member_id yet)
    alert_type TEXT NOT NULL CHECK (alert_type IN (
        'position_update',
        'at_risk_warning',
        'naib_threat',
        'bump_notification',
        'waitlist_eligible'
    )),
    content_summary TEXT,
    sent_at INTEGER NOT NULL,
    FOREIGN KEY (member_id) REFERENCES member_profiles(id)
);

-- Threshold snapshots (for historical tracking)
CREATE TABLE threshold_snapshots (
    id TEXT PRIMARY KEY,
    snapshot_at INTEGER NOT NULL,
    position_69_bgt TEXT NOT NULL,  -- Entry threshold
    position_70_bgt TEXT,
    position_70_distance TEXT,      -- How far position 70 is from entry
    waitlist_data TEXT              -- JSON of positions 70-100
);

-- Indexes
CREATE INDEX idx_naib_current ON naib_seats(member_id) WHERE unseated_at IS NULL;
CREATE INDEX idx_naib_history ON naib_seats(member_id, seated_at);
CREATE INDEX idx_waitlist_wallet ON waitlist_registrations(wallet_address);
CREATE INDEX idx_alert_history_member ON alert_history(member_id, sent_at);
CREATE INDEX idx_alert_history_type ON alert_history(alert_type, sent_at);
CREATE INDEX idx_threshold_time ON threshold_snapshots(snapshot_at);
```

### 4.3 API Endpoints

```
# Naib endpoints
GET  /api/naib                   → Current Naib + Former Naib list
GET  /api/naib/history           → Naib seat change history

# Threshold endpoints
GET  /api/threshold              → Current entry threshold + positions 70-100
GET  /api/threshold/history      → Historical threshold data

# Position endpoints (authenticated, own data only)
GET  /api/position               → Own position relative to above/below

# Notification endpoints (authenticated)
GET  /api/notifications/preferences → Get notification settings
PUT  /api/notifications/preferences → Update notification settings

# Waitlist endpoints
POST /api/waitlist/register      → Register wallet for eligibility alerts
DELETE /api/waitlist/register    → Unregister from waitlist alerts
GET  /api/waitlist/status/:wallet → Check registration status

# Admin endpoints
GET  /admin/alerts/stats         → Alert delivery statistics
PUT  /admin/config/at-risk-threshold → Configure at-risk percentage
POST /admin/alerts/test/:member_id → Send test alert to member
```

### 4.4 Service Specifications

#### 4.4.1 Naib Service

```typescript
interface NaibService {
  // Query
  getCurrentNaib(): Promise<NaibMember[]>;
  getFormerNaib(): Promise<FormerNaibMember[]>;
  getNaibHistory(memberId: string): Promise<NaibSeatHistory[]>;

  // Mutations (called by eligibility sync)
  evaluateNaibSeats(eligibilityList: EligibilityEntry[]): Promise<NaibChange[]>;
  seatMember(memberId: string, seatNumber: number): Promise<void>;
  bumpMember(memberId: string, bumpedById: string): Promise<void>;

  // Helpers
  getLowestNaibMember(): Promise<NaibMember | null>;
  isNaibMember(memberId: string): Promise<boolean>;
  isFormerNaibMember(memberId: string): Promise<boolean>;
}
```

#### 4.4.2 Threshold Service

```typescript
interface ThresholdService {
  // Query
  getCurrentThreshold(): Promise<ThresholdData>;
  getWaitlistPositions(start: number, end: number): Promise<WaitlistPosition[]>;
  getPositionDistance(walletAddress: string): Promise<DistanceData | null>;

  // Waitlist registration
  registerWaitlist(discordUserId: string, walletAddress: string): Promise<RegistrationResult>;
  unregisterWaitlist(discordUserId: string): Promise<void>;
  getRegistration(discordUserId: string): Promise<WaitlistRegistration | null>;

  // Called by eligibility sync
  checkWaitlistEligibility(): Promise<NewlyEligibleWallet[]>;
  saveThresholdSnapshot(data: ThresholdData): Promise<void>;
}
```

#### 4.4.3 Notification Service

```typescript
interface NotificationService {
  // Preferences
  getPreferences(memberId: string): Promise<NotificationPreferences>;
  updatePreferences(memberId: string, prefs: Partial<NotificationPreferences>): Promise<void>;

  // Alert sending
  sendPositionUpdate(memberId: string): Promise<boolean>;
  sendAtRiskWarning(memberId: string, threatData: ThreatData): Promise<boolean>;
  sendNaibThreat(memberId: string): Promise<boolean>;
  sendBumpNotification(memberId: string, newStatus: 'fedaykin' | 'former_naib'): Promise<boolean>;
  sendWaitlistEligible(discordUserId: string, walletAddress: string): Promise<boolean>;

  // Batch operations (called by scheduled task)
  processPositionAlerts(): Promise<AlertBatchResult>;
  processAtRiskAlerts(): Promise<AlertBatchResult>;

  // Rate limiting
  canSendAlert(memberId: string, alertType: AlertType): Promise<boolean>;
  recordAlertSent(memberId: string, alertType: AlertType): Promise<void>;
}
```

### 4.5 Scheduled Tasks

#### 4.5.1 Enhanced Eligibility Sync (Every 6 Hours)

Extend the existing eligibility sync to include:

1. **Naib evaluation**: Check if any new members should bump Naib seats
2. **Threshold calculation**: Calculate distances for positions 70-100
3. **Waitlist check**: Notify any registered waitlist members who became eligible
4. **Snapshot storage**: Save threshold data for historical tracking

#### 4.5.2 Position Alert Task (Daily)

New scheduled task for sending position alerts:

1. Get all members with position updates enabled
2. Check rate limits (alerts sent this week vs frequency setting)
3. Calculate position distances for each eligible member
4. Send alerts respecting frequency limits
5. Send at-risk warnings to bottom N% members

### 4.6 Discord Role Management

#### 4.6.1 New Roles

| Role | Color | Hoisted | Permissions |
|------|-------|---------|-------------|
| `@Naib` | Gold (#FFD700) | Yes | View Naib Chamber, Naib Archives |
| `@Former Naib` | Silver (#C0C0C0) | Yes | View Naib Archives |

**Note**: `@Naib` already exists (top 7 by BGT). This update makes it dynamic with the seat competition system. `@Former Naib` is new and implies Fedaykin status.

#### 4.6.2 Channel Permissions

```
#naib-archives (Naib Archives):
  @everyone: ❌ View
  @Naib: ✅ View, Send Messages
  @Former Naib: ✅ View, Send Messages

#naib-chamber (Naib Only):
  @everyone: ❌ View
  @Naib: ✅ View, Send Messages
  @Former Naib: ❌ View

#the-threshold (Cave Entrance):
  @everyone: ✅ View, ❌ Send Messages (read-only)

#waiting-pool (Cave Entrance):
  @everyone: ✅ View, ✅ Send Messages

#register-interest (Cave Entrance):
  @everyone: ✅ View, ✅ Use Slash Commands
```

### 4.7 Configuration

```typescript
interface NaibConfig {
  naibSeatCount: number;              // Default: 7
  atRiskPercentage: number;           // Default: 10 (bottom 10%)
  defaultAlertFrequency: string;      // Default: '3_per_week'
  waitlistDisplayRange: [number, number]; // Default: [70, 100]
  naibBumpTiebreaker: 'tenure' | 'random'; // Default: 'tenure'
}
```

Admin-configurable via environment or database.

---

## 5. Scope

### 5.1 In Scope (v2.1)

- [x] Dynamic Naib system (7 seats, dynamic competition)
- [x] Former Naib status and recognition
- [x] Naib Archives for Naib + Former Naib
- [x] Cave Entrance public lobby
- [x] Threshold display (positions 70-100 distances)
- [x] Waitlist registration for eligibility alerts
- [x] Position alert system (relative standings)
- [x] At-risk warnings (configurable threshold)
- [x] Naib threat alerts
- [x] Notification preferences (opt-in by default, configurable)
- [x] `/naib`, `/threshold`, `/position`, `/alerts` commands
- [x] Role management for Naib/Former Naib

### 5.2 Out of Scope (Future)

- Naib voting or governance powers
- Waitlist "queue jumping" via staking
- Historical position charts/graphs
- Mobile app notifications
- Email alerts
- Naib term limits
- Public Naib election process

### 5.3 Dependencies on v2.0

This release depends on:
- Member profiles and nym system
- Eligibility service and sync task
- Discord role management
- DM-based communication system
- Existing database schema

---

## 6. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Naib gaming (coordinated BGT movements) | Medium | Medium | Tenure tie-breaker, no advance warning of exact thresholds |
| Alert fatigue causing opt-outs | High | Medium | Configurable frequency, clear opt-out, non-spammy defaults |
| Privacy leak (correlating at-risk members) | Low | Critical | All at-risk info is private DM only, never public |
| Waitlist spam (fake registrations) | Medium | Low | Rate limiting, must be in positions 70-100 |
| Former Naib accumulation (too many) | Low | Low | Historical recognition, no special powers beyond Naib Archives |
| Cave Entrance becoming toxic | Medium | Medium | Moderation tools, read-only threshold channel |

---

## 7. Server Structure Update

```
SIETCH (Updated)
│
├── 🚪 CAVE ENTRANCE (Public - Anyone Can See)
│   ├── #the-threshold ───── Live waitlist stats (read-only)
│   ├── #waiting-pool ────── Aspiring member discussion
│   └── #register-interest ─ Waitlist registration commands
│
├── 📜 STILLSUIT (Info Category)
│   ├── #water-discipline ── Welcome, rules
│   ├── #census ──────────── Live leaderboard
│   └── #the-door ────────── Member joins/departures
│
├── 🏛️ NAIB CHAMBER (Naib Only)
│   └── #naib-council ────── Current Naib private discussion
│
├── 🏛️ NAIB ARCHIVES (Naib + Former Naib)
│   └── #naib-archives ───── All who have served
│
├── 💬 SIETCH-COMMONS (All Members)
│   ├── #general
│   ├── #spice
│   ├── #water-shares
│   └── #introductions
│
├── 🏜️ DEEP DESERT (Engaged Members)
│   └── #deep-desert
│
├── 🧘 STILLSUIT LOUNGE (Veterans)
│   └── #stillsuit-lounge
│
└── 🛠️ WINDTRAP (Operations)
    ├── #support
    └── #bot-commands
```

---

## 8. Implementation Phases

### Phase 1: Naib Foundation (Sprint 11)
- Naib seat database schema
- Naib service (seat management, bumping logic)
- Naib role management
- `/naib` command
- Naib Archives setup

### Phase 2: Cave Entrance (Sprint 12)
- Public channel setup with permissions
- Threshold service
- Waitlist registration
- `/threshold` command
- `/register-waitlist` command

### Phase 3: Notification System (Sprint 13)
- Notification preferences schema
- Notification service
- Position alerts
- At-risk warnings
- Naib threat alerts
- `/position` and `/alerts` commands

### Phase 4: Integration & Polish (Sprint 14)
- Integration with eligibility sync
- Scheduled alert task
- Rate limiting and frequency controls
- Testing and QA
- Documentation

---

## 9. Appendix

### 9.1 Alert Message Templates

**Position Update (Standard)**:
```
📊 Position Update

Your current standing:
• You are {distance_up} BGT away from the position above you
• The position below you is {distance_down} BGT away from yours

{status_message}
━━━━━━━━━━━━━━━━━━━━━━━
[Manage Alerts] [Disable]
```

**At-Risk Warning**:
```
⚠️ Position Alert

You are currently in the bottom {threshold}% of Sietch members.

Your standing:
• Position #70 (first outside): {distance_70} BGT behind you
• Position #71: {distance_71} BGT behind you

If a wallet with more BGT than yours becomes eligible,
you may lose your spot in the Sietch.

This is a private alert - your position is never shown publicly.
━━━━━━━━━━━━━━━━━━━━━━━
[Understood] [Turn Off At-Risk Alerts]
```

**Naib Threat**:
```
🏛️ Naib Alert

A new member has joined with significant BGT holdings.

As a Naib member, your seat is determined by BGT holdings
among the first 7 members (with tenure as tie-breaker).

Current lowest Naib BGT: {lowest_bgt}

If your holdings are lowest, your seat may be at risk.
━━━━━━━━━━━━━━━━━━━━━━━
[View Naib Status] [Dismiss]
```

**Bump Notification (Naib → Former Naib)**:
```
🏛️ Naib Status Change

Your Naib seat has been claimed by a member with higher BGT holdings.

You have been granted Former Naib status and retain access
to the Naib Archives as recognition of your service.

Thank you for your contribution to the Naib.
━━━━━━━━━━━━━━━━━━━━━━━
[View Naib Archives] [View Naib]
```

**Waitlist Eligible**:
```
🎉 You're Eligible!

Great news! Your wallet is now in the top 69 BGT holders
who have never redeemed.

You can now access the Sietch. Complete your onboarding
to set up your anonymous identity and join the community.

[Begin Onboarding]
```

### 9.2 Frequency Limit Logic

```typescript
function canSendPositionAlert(prefs: NotificationPreferences): boolean {
  const now = Date.now();
  const weekStart = getWeekStart(now);

  // Reset counter if new week
  if (prefs.week_start_timestamp < weekStart) {
    prefs.alerts_sent_this_week = 0;
    prefs.week_start_timestamp = weekStart;
  }

  const maxAlerts = {
    '1_per_week': 1,
    '2_per_week': 2,
    '3_per_week': 3,
    'daily': 7
  }[prefs.position_update_frequency];

  return prefs.alerts_sent_this_week < maxAlerts;
}
```

### 9.3 Privacy Decision Matrix (Extended)

| Data Point | Public | Cave | Members | Naib | Admin | Never |
|------------|--------|------|---------|------|-------|-------|
| Naib member list (by nym) | ✓ | ✓ | | | | |
| Former Naib list (by nym) | ✓ | ✓ | | | | |
| Entry threshold (BGT) | ✓ | ✓ | | | | |
| Positions 70-100 (wallets + BGT) | ✓ | ✓ | | | | |
| Your distance to next position | | | Self | | | |
| Your distance from position below | | | Self | | | |
| Who is at-risk (member list) | | | | | ✓ | |
| Which nym = which wallet | | | | | | ✓ |
| Exact member BGT holdings | | | | | | ✓ |

---

## 10. Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2025-12-17 | Initial MVP - token gating, eligibility |
| 2.0 | 2025-12-18 | Social Layer - profiles, badges, directory |
| 2.1 | 2025-12-19 | Naib Dynamics & Threshold - dynamic Naib, waitlist, alerts |

---

*Document generated by PRD Architect*

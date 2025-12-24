# Software Design Document: Sietch v2.1

> **DEPRECATED**: This document has been superseded by SDD v3.0 (`loa-grimoire/context/sdd.md`)
> and the evidence-grounded SDD (`loa-grimoire/artifacts/sdd-grounded.md`).
> Retained for historical reference only. Last updated: December 19, 2025.

**Version**: 2.1
**Date**: December 19, 2025
**Status**: DEPRECATED (Superseded by v3.0)
**Codename**: Naib Dynamics & Threshold

---

## 1. Executive Summary

### 1.1 Document Purpose

This Software Design Document (SDD) details the technical architecture and implementation plan for Sietch v2.1, which introduces the **Naib Dynamics & Threshold System**. This release builds on the v2.0 Social Layer foundation with three major feature areas:

1. **Dynamic Naib System** - First 7 eligible members get Naib role, with seat competition based on BGT holdings
2. **Cave Entrance (Public Waitlist)** - A public lobby for aspiring members (positions 70-100)
3. **Position Alert System** - Personalized notifications about ranking changes

### 1.2 Scope

This document covers:
- System architecture extensions for v2.1 features
- New service designs (NaibService, ThresholdService, NotificationService)
- Database schema extensions
- API endpoint specifications
- Discord bot command additions
- Security and privacy considerations
- Implementation approach

### 1.3 Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Naib seat evaluation timing | During onboarding AND 6h sync | Real-time for new members + catch BGT changes |
| Cave Entrance implementation | Same server, role-based visibility | Simplest, uses Discord's native permissions |
| Position distance calculation | Pre-calculated during sync | Fast alert sending, historical tracking |
| Waitlist registration | Discord-only, must join server | Simpler UX, bot has Discord ID |
| Terminology | Naib/Former Naib (not Council) | Consistent with existing Dune-inspired naming |

### 1.4 Terminology Update

| PRD Term | Implementation Term | Description |
|----------|---------------------|-------------|
| Council | Naib | Top 7 eligible members (existing role) |
| Former Council | Former Naib | Previously held Naib seat, now Fedaykin |
| Inaugural Council | Inaugural Naib | First 7 members to complete onboarding |
| Council Chamber | Naib Chamber | Private area for Naib only |
| Side Chamber | Naib Archives | Private area for Naib + Former Naib |

---

## 2. System Architecture

### 2.1 High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              SIETCH SERVICE v2.1                            │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                        NEW SERVICES (v2.1)                          │   │
│  │                                                                     │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────────┐ │   │
│  │  │    Naib     │  │  Threshold  │  │       Notification          │ │   │
│  │  │   Service   │  │   Service   │  │         Service             │ │   │
│  │  │             │  │             │  │                             │ │   │
│  │  │ • Seat mgmt │  │ • Waitlist  │  │ • Position alerts           │ │   │
│  │  │ • Bumping   │  │ • Distances │  │ • At-risk warnings          │ │   │
│  │  │ • History   │  │ • Registry  │  │ • Naib threat alerts        │ │   │
│  │  │ • Former    │  │ • Snapshots │  │ • Frequency limiting        │ │   │
│  │  │   Naib mgmt │  │             │  │ • Preferences               │ │   │
│  │  └──────┬──────┘  └──────┬──────┘  └──────────────┬──────────────┘ │   │
│  │         │                │                        │                │   │
│  └─────────┼────────────────┼────────────────────────┼────────────────┘   │
│            │                │                        │                     │
│            └────────────────┼────────────────────────┘                     │
│                             │                                              │
│                             ▼                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                     EXISTING SERVICES (v2.0)                        │   │
│  │                                                                     │   │
│  │  ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌───────────┐           │   │
│  │  │Eligibility│ │  Profile  │ │  Badge    │ │ Activity  │           │   │
│  │  │  Service  │ │  Service  │ │  Service  │ │  Service  │           │   │
│  │  └───────────┘ └───────────┘ └───────────┘ └───────────┘           │   │
│  │                                                                     │   │
│  │  ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌───────────┐           │   │
│  │  │  Chain    │ │ Directory │ │Leaderboard│ │   Role    │           │   │
│  │  │  Service  │ │  Service  │ │  Service  │ │  Manager  │           │   │
│  │  └───────────┘ └───────────┘ └───────────┘ └───────────┘           │   │
│  │                                                                     │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                         DATA LAYER                                  │   │
│  │                                                                     │   │
│  │  SQLite (WAL Mode)                                                  │   │
│  │  ├── Existing Tables (eligibility, profiles, badges, activity)     │   │
│  │  └── New Tables (naib_seats, waitlist, notifications, preferences) │   │
│  │                                                                     │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 2.2 Service Integration Flow

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                         ELIGIBILITY SYNC FLOW (Enhanced)                     │
└──────────────────────────────────────────────────────────────────────────────┘

[trigger.dev: Every 6 Hours]
         │
         ▼
┌─────────────────────┐
│   Chain Service     │ ── Query Berachain RPC for BGT balances
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│Eligibility Service  │ ── Compute top 69 + positions 70-100
└─────────┬───────────┘
          │
          ├──────────────────────────────────────────────┐
          │                                              │
          ▼                                              ▼
┌─────────────────────┐                    ┌─────────────────────────┐
│   Naib Service      │                    │   Threshold Service     │
│                     │                    │                         │
│ • Evaluate seats    │                    │ • Calculate distances   │
│ • Process bumps     │                    │ • Check waitlist        │
│ • Update Former     │                    │ • Save snapshot         │
│   Naib status       │                    │                         │
└─────────┬───────────┘                    └───────────┬─────────────┘
          │                                            │
          │                                            │
          └──────────────────┬─────────────────────────┘
                             │
                             ▼
                  ┌─────────────────────┐
                  │Notification Service │
                  │                     │
                  │ • Queue alerts      │
                  │ • Send DMs          │
                  │ • Respect limits    │
                  └─────────────────────┘
```

### 2.3 Onboarding Flow (Enhanced)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                      ONBOARDING FLOW (With Naib Evaluation)                  │
└──────────────────────────────────────────────────────────────────────────────┘

[New Member Joins Discord]
         │
         ▼
[Sees only Cave Entrance channels]
         │
         ▼
[Completes Collab.Land wallet verification]
         │
         ▼
┌─────────────────────┐
│Eligibility Check    │
│ • Is wallet in      │
│   top 69?           │
└─────────┬───────────┘
          │
     ┌────┴────┐
     │         │
    YES        NO
     │         │
     ▼         ▼
[Start DM    [Offer waitlist
Onboarding]  registration]
     │
     ▼
[Complete: Nym, Avatar, Bio]
     │
     ▼
┌─────────────────────┐
│   Naib Service      │
│                     │
│ • Count current     │
│   Naib seats        │
│ • If < 7: Award     │
│   Naib role         │
│ • If = 7: Compare   │
│   BGT, maybe bump   │
└─────────┬───────────┘
          │
          ├── Award @Naib OR @Fedaykin role
          ├── Grant channel access
          └── Send welcome message
```

---

## 3. Component Design

### 3.1 Naib Service

The Naib Service manages the dynamic Naib seat system, including seat assignment, bumping logic, and Former Naib tracking.

#### 3.1.1 Service Interface

```typescript
// src/services/naib.ts

import type { MemberProfile } from '../types/index.js';

/**
 * Naib seat record
 */
export interface NaibSeat {
  id: string;
  memberId: string;
  seatNumber: number;           // 1-7
  seatedAt: Date;
  unseatedAt: Date | null;
  unseatedBy: string | null;    // member_id of who bumped them
  unseatedReason: 'bumped' | 'left_server' | 'ineligible' | null;
  bgtAtSeating: string;         // BGT held when seated (for history)
}

/**
 * Naib member with profile info
 */
export interface NaibMember {
  seat: NaibSeat;
  profile: MemberProfile;
  currentBgt: bigint;
}

/**
 * Bump event result
 */
export interface BumpResult {
  occurred: boolean;
  bumpedMember?: NaibMember;
  newNaibMember?: NaibMember;
  reason?: string;
}

/**
 * Naib Service class
 */
class NaibService {
  /**
   * Get current Naib members (seated, ordered by seat number)
   */
  getCurrentNaib(): NaibMember[];

  /**
   * Get all Former Naib members
   */
  getFormerNaib(): Array<{
    memberId: string;
    profile: MemberProfile;
    seatHistory: NaibSeat[];
    totalTimeSeated: number;  // milliseconds
  }>;

  /**
   * Get Naib seat history for a member
   */
  getMemberNaibHistory(memberId: string): NaibSeat[];

  /**
   * Check if member is currently Naib
   */
  isCurrentNaib(memberId: string): boolean;

  /**
   * Check if member is Former Naib (was Naib but not currently)
   */
  isFormerNaib(memberId: string): boolean;

  /**
   * Check if member has ever been Naib
   */
  hasEverBeenNaib(memberId: string): boolean;

  /**
   * Get the lowest BGT holder among current Naib
   * Used to determine bump threshold
   */
  getLowestNaibMember(): NaibMember | null;

  /**
   * Get available seat count (0-7)
   */
  getAvailableSeatCount(): number;

  /**
   * Seat a member as Naib
   * Called during onboarding if seats available or after bump
   */
  seatMember(memberId: string, bgtHeld: bigint): NaibSeat;

  /**
   * Bump a Naib member (remove from seat, mark as Former Naib)
   */
  bumpMember(
    bumpedMemberId: string,
    bumpedByMemberId: string,
    reason: 'bumped'
  ): void;

  /**
   * Unseat a member for non-bump reasons
   */
  unseatMember(
    memberId: string,
    reason: 'left_server' | 'ineligible'
  ): void;

  /**
   * Evaluate all Naib seats against current eligibility
   * Called during eligibility sync
   * Returns list of changes made
   */
  evaluateSeats(
    eligibilityList: Array<{ memberId: string; bgtHeld: bigint }>
  ): Array<{
    type: 'seated' | 'bumped' | 'unseated';
    memberId: string;
    details: Record<string, unknown>;
  }>;

  /**
   * Evaluate if a new member should be seated or bump someone
   * Called during onboarding completion
   */
  evaluateNewMember(
    memberId: string,
    bgtHeld: bigint,
    joinedAt: Date
  ): BumpResult;
}

export const naibService = new NaibService();
```

#### 3.1.2 Bump Logic Algorithm

```typescript
/**
 * Naib Seat Evaluation Algorithm
 *
 * Rules:
 * 1. First 7 eligible members get Naib seats (inaugural Naib)
 * 2. Once 7 seats filled, new members with higher BGT can bump lowest
 * 3. Tie-breaker: Longer tenure keeps seat
 * 4. Bumped members become Former Naib + Fedaykin
 * 5. Former Naib can re-claim seat if BGT increases enough
 */

function evaluateNewMember(
  memberId: string,
  newMemberBgt: bigint,
  newMemberJoinedAt: Date
): BumpResult {
  const availableSeats = this.getAvailableSeatCount();

  // Case 1: Seats available, auto-seat
  if (availableSeats > 0) {
    const seat = this.seatMember(memberId, newMemberBgt);
    return {
      occurred: false,
      newNaibMember: { seat, profile: getProfile(memberId), currentBgt: newMemberBgt }
    };
  }

  // Case 2: All seats filled, check for bump
  const lowestNaib = this.getLowestNaibMember();
  if (!lowestNaib) {
    return { occurred: false, reason: 'No Naib members found' };
  }

  // Compare BGT holdings
  if (newMemberBgt > lowestNaib.currentBgt) {
    // New member has more BGT - bump occurs
    this.bumpMember(lowestNaib.seat.memberId, memberId, 'bumped');
    const newSeat = this.seatMember(memberId, newMemberBgt);

    return {
      occurred: true,
      bumpedMember: lowestNaib,
      newNaibMember: { seat: newSeat, profile: getProfile(memberId), currentBgt: newMemberBgt }
    };
  }

  if (newMemberBgt === lowestNaib.currentBgt) {
    // Tie-breaker: tenure wins
    const lowestNaibJoinedAt = lowestNaib.profile.createdAt;

    if (newMemberJoinedAt < lowestNaibJoinedAt) {
      // New member has longer tenure (joined earlier) - bump occurs
      this.bumpMember(lowestNaib.seat.memberId, memberId, 'bumped');
      const newSeat = this.seatMember(memberId, newMemberBgt);

      return {
        occurred: true,
        bumpedMember: lowestNaib,
        newNaibMember: { seat: newSeat, profile: getProfile(memberId), currentBgt: newMemberBgt }
      };
    }
  }

  // New member doesn't qualify for Naib
  return {
    occurred: false,
    reason: 'BGT holdings insufficient to claim Naib seat'
  };
}
```

#### 3.1.3 Seat Evaluation During Sync

```typescript
/**
 * Full seat evaluation during 6-hour sync
 * Handles: BGT changes, re-entries, multiple bumps
 */
function evaluateSeats(
  eligibilityList: Array<{ memberId: string; bgtHeld: bigint }>
): ChangeList {
  const changes: ChangeList = [];

  // Get current Naib members with their BGT
  const currentNaib = this.getCurrentNaib();

  // Build map of eligible members by memberId
  const eligibleMap = new Map(
    eligibilityList.map(e => [e.memberId, e.bgtHeld])
  );

  // Step 1: Remove Naib members who are no longer eligible
  for (const naib of currentNaib) {
    if (!eligibleMap.has(naib.seat.memberId)) {
      this.unseatMember(naib.seat.memberId, 'ineligible');
      changes.push({
        type: 'unseated',
        memberId: naib.seat.memberId,
        details: { reason: 'ineligible' }
      });
    }
  }

  // Step 2: Update BGT values for remaining Naib
  const remainingNaib = this.getCurrentNaib();

  // Step 3: Get all eligible members sorted by BGT (desc), then tenure (asc)
  const sortedEligible = eligibilityList
    .filter(e => getMemberProfile(e.memberId)?.onboardingComplete)
    .sort((a, b) => {
      if (b.bgtHeld > a.bgtHeld) return 1;
      if (b.bgtHeld < a.bgtHeld) return -1;
      // Tie-breaker: earlier join date wins
      const aJoined = getMemberProfile(a.memberId)!.createdAt;
      const bJoined = getMemberProfile(b.memberId)!.createdAt;
      return aJoined.getTime() - bJoined.getTime();
    });

  // Step 4: Top 7 should be Naib
  const shouldBeNaib = sortedEligible.slice(0, 7);
  const currentNaibIds = new Set(remainingNaib.map(n => n.seat.memberId));

  // Step 5: Process changes
  for (const candidate of shouldBeNaib) {
    if (!currentNaibIds.has(candidate.memberId)) {
      // This member should be Naib but isn't
      const availableSeats = this.getAvailableSeatCount();

      if (availableSeats > 0) {
        // Empty seat available
        this.seatMember(candidate.memberId, candidate.bgtHeld);
        changes.push({
          type: 'seated',
          memberId: candidate.memberId,
          details: { bgtHeld: candidate.bgtHeld.toString() }
        });
      } else {
        // Need to bump someone
        const lowestNaib = this.getLowestNaibMember()!;
        this.bumpMember(lowestNaib.seat.memberId, candidate.memberId, 'bumped');
        this.seatMember(candidate.memberId, candidate.bgtHeld);
        changes.push({
          type: 'bumped',
          memberId: lowestNaib.seat.memberId,
          details: {
            bumpedBy: candidate.memberId,
            bumpedBgt: lowestNaib.currentBgt.toString(),
            newNaibBgt: candidate.bgtHeld.toString()
          }
        });
      }
    }
  }

  return changes;
}
```

### 3.2 Threshold Service

The Threshold Service manages waitlist visibility, distance calculations, and aspiring member registration.

#### 3.2.1 Service Interface

```typescript
// src/services/threshold.ts

/**
 * Position distance data
 */
export interface PositionDistance {
  position: number;           // 1-100+
  walletAddress: string;
  bgtHeld: bigint;
  distanceToEntry: bigint;    // BGT needed to reach position 69
  distanceToAbove: bigint;    // BGT needed to reach position above
  distanceFromBelow: bigint;  // How far position below is
}

/**
 * Threshold snapshot data
 */
export interface ThresholdSnapshot {
  id: string;
  snapshotAt: Date;
  entryThreshold: bigint;     // BGT held by position 69
  waitlistPositions: PositionDistance[];  // Positions 70-100
  memberDistances: Map<string, {  // memberId -> distances
    distanceToAbove: bigint;
    distanceFromBelow: bigint;
  }>;
}

/**
 * Waitlist registration
 */
export interface WaitlistRegistration {
  id: string;
  discordUserId: string;
  walletAddress: string;
  positionAtRegistration: number;
  bgtAtRegistration: bigint;
  registeredAt: Date;
  notifiedAt: Date | null;
}

/**
 * Threshold Service class
 */
class ThresholdService {
  /**
   * Get current entry threshold (BGT of position 69)
   */
  getEntryThreshold(): bigint;

  /**
   * Get waitlist positions (70-100) with distances
   */
  getWaitlistPositions(): PositionDistance[];

  /**
   * Get distance data for a specific member
   */
  getMemberDistances(memberId: string): {
    distanceToAbove: bigint;
    distanceFromBelow: bigint;
    position: number;
  } | null;

  /**
   * Calculate and save threshold snapshot
   * Called during eligibility sync
   */
  saveSnapshot(
    eligibilityList: Array<{ address: string; bgtHeld: bigint; rank?: number }>
  ): ThresholdSnapshot;

  /**
   * Get latest snapshot
   */
  getLatestSnapshot(): ThresholdSnapshot | null;

  /**
   * Register a wallet for waitlist alerts
   */
  registerWaitlist(
    discordUserId: string,
    walletAddress: string
  ): WaitlistRegistration | { error: string };

  /**
   * Unregister from waitlist alerts
   */
  unregisterWaitlist(discordUserId: string): boolean;

  /**
   * Get registration for a Discord user
   */
  getRegistration(discordUserId: string): WaitlistRegistration | null;

  /**
   * Get registration by wallet address
   */
  getRegistrationByWallet(walletAddress: string): WaitlistRegistration | null;

  /**
   * Check waitlist for newly eligible members
   * Returns registrations that should be notified
   */
  checkWaitlistEligibility(
    eligibilityList: Array<{ address: string; bgtHeld: bigint; rank?: number }>
  ): WaitlistRegistration[];

  /**
   * Mark registration as notified
   */
  markNotified(registrationId: string): void;
}

export const thresholdService = new ThresholdService();
```

#### 3.2.2 Distance Calculation

```typescript
/**
 * Calculate distances for threshold snapshot
 */
function calculateDistances(
  eligibilityList: Array<{ address: string; bgtHeld: bigint; rank?: number }>
): ThresholdSnapshot {
  // Sort by BGT descending
  const sorted = [...eligibilityList].sort((a, b) => {
    if (b.bgtHeld > a.bgtHeld) return 1;
    if (b.bgtHeld < a.bgtHeld) return -1;
    return 0;
  });

  // Position 69 is the entry threshold
  const position69 = sorted[68];  // 0-indexed
  const entryThreshold = position69?.bgtHeld ?? 0n;

  // Calculate waitlist (positions 70-100)
  const waitlistPositions: PositionDistance[] = [];
  for (let i = 69; i < Math.min(sorted.length, 99); i++) {
    const current = sorted[i];
    const above = sorted[i - 1];
    const below = sorted[i + 1];

    waitlistPositions.push({
      position: i + 1,  // 1-indexed
      walletAddress: current.address,
      bgtHeld: current.bgtHeld,
      distanceToEntry: entryThreshold - current.bgtHeld,
      distanceToAbove: above ? above.bgtHeld - current.bgtHeld : 0n,
      distanceFromBelow: below ? current.bgtHeld - below.bgtHeld : 0n,
    });
  }

  // Calculate member distances (for positions 1-69)
  const memberDistances = new Map<string, { distanceToAbove: bigint; distanceFromBelow: bigint }>();

  for (let i = 0; i < 69 && i < sorted.length; i++) {
    const current = sorted[i];
    const above = sorted[i - 1];
    const below = sorted[i + 1];

    // Get member_id from wallet mapping
    const memberId = getMemberIdByWallet(current.address);
    if (memberId) {
      memberDistances.set(memberId, {
        distanceToAbove: above ? above.bgtHeld - current.bgtHeld : 0n,
        distanceFromBelow: below ? current.bgtHeld - below.bgtHeld : 0n,
      });
    }
  }

  return {
    id: generateId(),
    snapshotAt: new Date(),
    entryThreshold,
    waitlistPositions,
    memberDistances,
  };
}
```

### 3.3 Notification Service

The Notification Service manages all alerts, preferences, and rate limiting.

#### 3.3.1 Service Interface

```typescript
// src/services/notification.ts

/**
 * Alert types
 */
export type AlertType =
  | 'position_update'      // Regular position update
  | 'at_risk_warning'      // Bottom N% warning
  | 'naib_threat'          // Naib seat may be at risk
  | 'bump_notification'    // You were bumped
  | 'naib_seated'          // You became Naib
  | 'waitlist_eligible';   // Waitlist member became eligible

/**
 * Notification preferences
 */
export interface NotificationPreferences {
  memberId: string;
  positionUpdatesEnabled: boolean;
  positionUpdateFrequency: '1_per_week' | '2_per_week' | '3_per_week' | 'daily';
  atRiskWarningsEnabled: boolean;
  naibAlertsEnabled: boolean;
  alertsSentThisWeek: number;
  weekStartTimestamp: Date;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Alert record
 */
export interface AlertRecord {
  id: string;
  memberId: string | null;      // null for waitlist alerts
  discordUserId: string;
  alertType: AlertType;
  contentSummary: string;
  sentAt: Date;
  delivered: boolean;
  deliveryError: string | null;
}

/**
 * Notification Service class
 */
class NotificationService {
  /**
   * Get notification preferences for a member
   */
  getPreferences(memberId: string): NotificationPreferences;

  /**
   * Update notification preferences
   */
  updatePreferences(
    memberId: string,
    updates: Partial<NotificationPreferences>
  ): NotificationPreferences;

  /**
   * Create default preferences for new member
   */
  createDefaultPreferences(memberId: string): NotificationPreferences;

  /**
   * Check if we can send an alert (rate limiting)
   */
  canSendAlert(memberId: string, alertType: AlertType): boolean;

  /**
   * Send position update alert
   */
  sendPositionUpdate(
    memberId: string,
    distanceToAbove: bigint,
    distanceFromBelow: bigint
  ): Promise<boolean>;

  /**
   * Send at-risk warning
   */
  sendAtRiskWarning(
    memberId: string,
    currentPosition: number,
    distances: Array<{ position: number; distance: bigint }>
  ): Promise<boolean>;

  /**
   * Send Naib threat alert
   */
  sendNaibThreat(memberId: string, lowestNaibBgt: bigint): Promise<boolean>;

  /**
   * Send bump notification
   */
  sendBumpNotification(
    memberId: string,
    newStatus: 'fedaykin' | 'former_naib',
    bumpedByBgt: bigint
  ): Promise<boolean>;

  /**
   * Send Naib seated notification
   */
  sendNaibSeated(memberId: string, seatNumber: number): Promise<boolean>;

  /**
   * Send waitlist eligible notification
   */
  sendWaitlistEligible(
    discordUserId: string,
    walletAddress: string
  ): Promise<boolean>;

  /**
   * Process all position alerts (batch operation)
   * Called by scheduled task
   */
  processPositionAlerts(
    snapshot: ThresholdSnapshot,
    atRiskThreshold: number  // e.g., 10 for bottom 10%
  ): Promise<{
    sent: number;
    skipped: number;
    failed: number;
  }>;

  /**
   * Get alert history for a member
   */
  getAlertHistory(memberId: string, limit?: number): AlertRecord[];

  /**
   * Reset weekly alert counter (called by scheduled task)
   */
  resetWeeklyCounters(): void;
}

export const notificationService = new NotificationService();
```

#### 3.3.2 Rate Limiting Logic

```typescript
/**
 * Rate limiting for position alerts
 */
function canSendAlert(memberId: string, alertType: AlertType): boolean {
  const prefs = this.getPreferences(memberId);

  // Check if alert type is enabled
  switch (alertType) {
    case 'position_update':
      if (!prefs.positionUpdatesEnabled) return false;
      break;
    case 'at_risk_warning':
      if (!prefs.atRiskWarningsEnabled) return false;
      break;
    case 'naib_threat':
    case 'naib_seated':
    case 'bump_notification':
      if (!prefs.naibAlertsEnabled) return false;
      break;
    case 'waitlist_eligible':
      return true;  // Always send eligibility notifications
  }

  // Check weekly limit for position updates
  if (alertType === 'position_update') {
    const now = new Date();
    const weekStart = getWeekStart(now);

    // Reset counter if new week
    if (prefs.weekStartTimestamp < weekStart) {
      this.resetMemberWeeklyCounter(memberId);
      prefs.alertsSentThisWeek = 0;
    }

    const maxAlerts = {
      '1_per_week': 1,
      '2_per_week': 2,
      '3_per_week': 3,
      'daily': 7,
    }[prefs.positionUpdateFrequency];

    if (prefs.alertsSentThisWeek >= maxAlerts) {
      return false;
    }
  }

  return true;
}
```

#### 3.3.3 Alert Message Templates

```typescript
/**
 * Alert message builders
 */
const alertTemplates = {
  positionUpdate: (distanceUp: bigint, distanceDown: bigint) => ({
    title: 'Position Update',
    description: `Your current standing:
• You are **${formatBgt(distanceUp)} BGT** away from the position above you
• The position below you is **${formatBgt(distanceDown)} BGT** away from yours

Stay vigilant, Fedaykin.`,
    footer: 'Use /alerts to manage your notification preferences',
  }),

  atRiskWarning: (position: number, threshold: number, distances: Array<{ position: number; distance: bigint }>) => ({
    title: 'Position Alert',
    description: `You are currently in the bottom ${threshold}% of Sietch members.

Your standing:
${distances.map(d => `• Position #${d.position}: **${formatBgt(d.distance)} BGT** behind you`).join('\n')}

If a wallet with more BGT than yours becomes eligible, you may lose your spot in the Sietch.

*This is a private alert - your position is never shown publicly.*`,
    footer: 'Use /alerts to disable at-risk warnings',
  }),

  naibThreat: (lowestBgt: bigint) => ({
    title: 'Naib Alert',
    description: `A new member has joined with significant BGT holdings.

As a Naib, your seat is determined by BGT holdings among the top 7 members (with tenure as tie-breaker).

Current lowest Naib BGT: **${formatBgt(lowestBgt)}**

If your holdings are lowest, your seat may be at risk.`,
    footer: 'Use /alerts to manage Naib notifications',
  }),

  bumpNotification: (newStatus: string, bumpedByBgt: bigint) => ({
    title: 'Naib Status Change',
    description: `Your Naib seat has been claimed by a member with **${formatBgt(bumpedByBgt)} BGT**.

You have been granted **Former Naib** status and retain access to the Naib Archives as recognition of your service.

Thank you for your contribution to the Naib.`,
    footer: 'Your Fedaykin status has been restored',
  }),

  naibSeated: (seatNumber: number) => ({
    title: 'Welcome to the Naib',
    description: `Congratulations! You have been seated as **Naib #${seatNumber}**.

You now have access to:
• The Naib Chamber (current Naib only)
• The Naib Archives (Naib + Former Naib)

Your seat is defended by your BGT holdings. Maintain your position to keep your seat.`,
    footer: 'May your water be plentiful',
  }),

  waitlistEligible: () => ({
    title: "You're Eligible!",
    description: `Great news! Your wallet is now in the top 69 BGT holders who have never redeemed.

You can now access the Sietch. Complete your onboarding to set up your anonymous identity and join the community.`,
    footer: 'Click the button below to begin',
    button: { label: 'Begin Onboarding', customId: 'begin_onboarding' },
  }),
};
```

---

## 4. Data Architecture

### 4.1 Database Schema Extensions

```sql
-- =============================================================================
-- SIETCH v2.1 SCHEMA EXTENSIONS
-- Migration: 005_naib_threshold.ts
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Naib Seats Table
-- Tracks current and historical Naib seat assignments
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS naib_seats (
    id TEXT PRIMARY KEY,
    member_id TEXT NOT NULL,
    seat_number INTEGER NOT NULL CHECK (seat_number BETWEEN 1 AND 7),
    seated_at INTEGER NOT NULL,              -- Unix timestamp
    unseated_at INTEGER,                     -- Unix timestamp, NULL if current
    unseated_by TEXT,                        -- member_id of who bumped them
    unseated_reason TEXT CHECK (unseated_reason IN ('bumped', 'left_server', 'ineligible')),
    bgt_at_seating TEXT NOT NULL,            -- BGT held when seated (string for precision)
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    FOREIGN KEY (member_id) REFERENCES member_profiles(id) ON DELETE CASCADE,
    FOREIGN KEY (unseated_by) REFERENCES member_profiles(id) ON DELETE SET NULL
);

-- Index for fast current Naib lookup
CREATE INDEX IF NOT EXISTS idx_naib_current
    ON naib_seats(member_id) WHERE unseated_at IS NULL;

-- Index for member history
CREATE INDEX IF NOT EXISTS idx_naib_member_history
    ON naib_seats(member_id, seated_at);

-- Unique constraint: only one active seat per member
CREATE UNIQUE INDEX IF NOT EXISTS idx_naib_active_member
    ON naib_seats(member_id) WHERE unseated_at IS NULL;

-- Unique constraint: only one member per seat number (active)
CREATE UNIQUE INDEX IF NOT EXISTS idx_naib_active_seat
    ON naib_seats(seat_number) WHERE unseated_at IS NULL;

-- -----------------------------------------------------------------------------
-- Waitlist Registrations Table
-- Tracks aspiring members who want eligibility notifications
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS waitlist_registrations (
    id TEXT PRIMARY KEY,
    discord_user_id TEXT NOT NULL UNIQUE,
    wallet_address TEXT NOT NULL UNIQUE,
    position_at_registration INTEGER,
    bgt_at_registration TEXT,                -- String for precision
    registered_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    notified_at INTEGER,                     -- When eligibility notification sent
    unregistered_at INTEGER                  -- Soft delete
);

-- Index for wallet lookup
CREATE INDEX IF NOT EXISTS idx_waitlist_wallet
    ON waitlist_registrations(wallet_address) WHERE unregistered_at IS NULL;

-- Index for Discord user lookup
CREATE INDEX IF NOT EXISTS idx_waitlist_discord
    ON waitlist_registrations(discord_user_id) WHERE unregistered_at IS NULL;

-- -----------------------------------------------------------------------------
-- Notification Preferences Table
-- Member notification settings
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notification_preferences (
    member_id TEXT PRIMARY KEY,
    position_updates_enabled INTEGER NOT NULL DEFAULT 1,
    position_update_frequency TEXT NOT NULL DEFAULT '3_per_week'
        CHECK (position_update_frequency IN ('1_per_week', '2_per_week', '3_per_week', 'daily')),
    at_risk_warnings_enabled INTEGER NOT NULL DEFAULT 1,
    naib_alerts_enabled INTEGER NOT NULL DEFAULT 1,
    alerts_sent_this_week INTEGER NOT NULL DEFAULT 0,
    week_start_timestamp INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    FOREIGN KEY (member_id) REFERENCES member_profiles(id) ON DELETE CASCADE
);

-- -----------------------------------------------------------------------------
-- Alert History Table
-- Record of all alerts sent
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS alert_history (
    id TEXT PRIMARY KEY,
    member_id TEXT,                          -- NULL for waitlist alerts
    discord_user_id TEXT NOT NULL,
    alert_type TEXT NOT NULL CHECK (alert_type IN (
        'position_update',
        'at_risk_warning',
        'naib_threat',
        'bump_notification',
        'naib_seated',
        'waitlist_eligible'
    )),
    content_summary TEXT,
    sent_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    delivered INTEGER NOT NULL DEFAULT 1,
    delivery_error TEXT,
    FOREIGN KEY (member_id) REFERENCES member_profiles(id) ON DELETE SET NULL
);

-- Index for member alert history
CREATE INDEX IF NOT EXISTS idx_alert_member
    ON alert_history(member_id, sent_at DESC);

-- Index for alert type stats
CREATE INDEX IF NOT EXISTS idx_alert_type
    ON alert_history(alert_type, sent_at DESC);

-- -----------------------------------------------------------------------------
-- Threshold Snapshots Table
-- Historical threshold and distance data
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS threshold_snapshots (
    id TEXT PRIMARY KEY,
    snapshot_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    entry_threshold TEXT NOT NULL,           -- BGT of position 69
    waitlist_data TEXT NOT NULL,             -- JSON: positions 70-100 with distances
    member_distances TEXT NOT NULL           -- JSON: member_id -> distances
);

-- Index for time-based queries
CREATE INDEX IF NOT EXISTS idx_threshold_time
    ON threshold_snapshots(snapshot_at DESC);

-- -----------------------------------------------------------------------------
-- Update member_profiles to track Former Naib status
-- -----------------------------------------------------------------------------
ALTER TABLE member_profiles ADD COLUMN is_former_naib INTEGER NOT NULL DEFAULT 0;

-- Index for Former Naib lookup
CREATE INDEX IF NOT EXISTS idx_former_naib
    ON member_profiles(is_former_naib) WHERE is_former_naib = 1;
```

### 4.2 Data Model Relationships

```
┌─────────────────────┐
│   member_profiles   │
├─────────────────────┤
│ member_id (PK)      │───┬──────────────────────────────────────┐
│ discord_user_id     │   │                                      │
│ nym                 │   │                                      │
│ tier                │   │                                      │
│ is_former_naib      │   │                                      │
│ ...                 │   │                                      │
└─────────────────────┘   │                                      │
                          │                                      │
           ┌──────────────┼──────────────────┐                   │
           │              │                  │                   │
           ▼              ▼                  ▼                   ▼
┌─────────────────┐ ┌───────────────┐ ┌─────────────┐ ┌─────────────────┐
│   naib_seats    │ │ notification_ │ │alert_history│ │ threshold_      │
│                 │ │  preferences  │ │             │ │  snapshots      │
├─────────────────┤ ├───────────────┤ ├─────────────┤ ├─────────────────┤
│ id (PK)         │ │ member_id(PK) │ │ id (PK)     │ │ id (PK)         │
│ member_id (FK)  │ │ position_...  │ │ member_id   │ │ snapshot_at     │
│ seat_number     │ │ at_risk_...   │ │ alert_type  │ │ entry_threshold │
│ seated_at       │ │ naib_alerts   │ │ sent_at     │ │ waitlist_data   │
│ unseated_at     │ │ alerts_sent   │ │ delivered   │ │ member_distances│
│ unseated_by(FK) │ │ week_start    │ │             │ │                 │
│ unseated_reason │ │               │ │             │ │                 │
│ bgt_at_seating  │ │               │ │             │ │                 │
└─────────────────┘ └───────────────┘ └─────────────┘ └─────────────────┘

┌─────────────────────┐
│waitlist_registrations│
├─────────────────────┤
│ id (PK)             │
│ discord_user_id     │  (not FK - user not yet member)
│ wallet_address      │
│ position_at_reg     │
│ registered_at       │
│ notified_at         │
└─────────────────────┘
```

---

## 5. API Design

### 5.1 New API Endpoints

#### 5.1.1 Naib Endpoints

```typescript
// GET /api/naib
// Get current Naib members and Former Naib
// Response: { current: NaibMember[], former: FormerNaibMember[] }

// GET /api/naib/history
// Get Naib seat change history
// Query: ?limit=20&since=timestamp
// Response: { changes: NaibChange[] }

// GET /api/naib/member/:memberId
// Get Naib history for specific member
// Response: { isNaib: boolean, isFormerNaib: boolean, history: NaibSeat[] }
```

#### 5.1.2 Threshold Endpoints

```typescript
// GET /api/threshold
// Get current entry threshold and waitlist
// Response: {
//   entryThreshold: string,
//   waitlist: Array<{
//     position: number,
//     bgtHeld: string,
//     distanceToEntry: string
//   }>,
//   updatedAt: string
// }

// GET /api/threshold/history
// Get threshold history
// Query: ?limit=10
// Response: { snapshots: ThresholdSnapshot[] }
```

#### 5.1.3 Position Endpoints (Authenticated)

```typescript
// GET /api/position
// Get own position relative to above/below
// Auth: Member only (via session/token)
// Response: {
//   distanceToAbove: string,
//   distanceFromBelow: string,
//   isAtRisk: boolean,
//   updatedAt: string
// }
```

#### 5.1.4 Notification Endpoints (Authenticated)

```typescript
// GET /api/notifications/preferences
// Get notification settings
// Auth: Member only
// Response: NotificationPreferences

// PUT /api/notifications/preferences
// Update notification settings
// Auth: Member only
// Body: Partial<NotificationPreferences>
// Response: NotificationPreferences

// GET /api/notifications/history
// Get alert history
// Auth: Member only
// Query: ?limit=20
// Response: { alerts: AlertRecord[] }
```

#### 5.1.5 Waitlist Endpoints

```typescript
// POST /api/waitlist/register
// Register for eligibility alerts
// Body: { walletAddress: string }
// Auth: Discord OAuth or bot command context
// Response: { success: true, registration: WaitlistRegistration }
//        or { success: false, error: string }

// DELETE /api/waitlist/register
// Unregister from alerts
// Auth: Discord OAuth or bot command context
// Response: { success: true }

// GET /api/waitlist/status/:walletAddress
// Check registration status (public)
// Response: { registered: boolean, position?: number, distance?: string }
```

#### 5.1.6 Admin Endpoints

```typescript
// GET /admin/naib/stats
// Get Naib seat statistics
// Auth: Admin API key
// Response: {
//   currentNaibCount: number,
//   formerNaibCount: number,
//   totalBumps: number,
//   averageSeatDuration: number
// }

// PUT /admin/config/at-risk-threshold
// Configure at-risk percentage
// Auth: Admin API key
// Body: { threshold: number }  // e.g., 10 for 10%
// Response: { success: true, threshold: number }

// POST /admin/alerts/test/:memberId
// Send test alert to member
// Auth: Admin API key
// Body: { alertType: AlertType }
// Response: { success: true, delivered: boolean }

// GET /admin/alerts/stats
// Get alert delivery statistics
// Auth: Admin API key
// Response: {
//   totalSent: number,
//   byType: Record<AlertType, number>,
//   deliveryRate: number,
//   optOutRate: number
// }
```

### 5.2 API Route Registration

```typescript
// src/api/routes.ts (additions)

import { naibRoutes } from './handlers/naib.js';
import { thresholdRoutes } from './handlers/threshold.js';
import { positionRoutes } from './handlers/position.js';
import { notificationRoutes } from './handlers/notifications.js';
import { waitlistRoutes } from './handlers/waitlist.js';

// Public routes
app.use('/api/naib', naibRoutes);
app.use('/api/threshold', thresholdRoutes);
app.use('/api/waitlist', waitlistRoutes);

// Authenticated member routes
app.use('/api/position', authenticateMember, positionRoutes);
app.use('/api/notifications', authenticateMember, notificationRoutes);

// Admin routes
app.use('/admin/naib', authenticateAdmin, adminNaibRoutes);
app.use('/admin/alerts', authenticateAdmin, adminAlertRoutes);
```

---

## 6. Discord Integration

### 6.1 New Slash Commands

#### 6.1.1 `/naib` Command

```typescript
// src/discord/commands/naib.ts

import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { naibService } from '../../services/naib.js';

export const naibCommand = {
  data: new SlashCommandBuilder()
    .setName('naib')
    .setDescription('View current Naib members and Former Naib'),

  async execute(interaction: ChatInputCommandInteraction) {
    const currentNaib = naibService.getCurrentNaib();
    const formerNaib = naibService.getFormerNaib();

    const embed = new EmbedBuilder()
      .setTitle('🏛️ THE NAIB')
      .setColor(0xFFD700)  // Gold
      .addFields(
        {
          name: 'Current Naib',
          value: currentNaib.length > 0
            ? currentNaib.map((n, i) =>
                `${i + 1}. **${n.profile.nym}** ${isInauguralNaib(n) ? '🟢 Founding' : ''}`
              ).join('\n')
            : 'No Naib members yet',
        },
        {
          name: '📜 Former Naib',
          value: formerNaib.length > 0
            ? formerNaib.map(f => `• ${f.profile.nym}`).join('\n')
            : 'None',
        }
      )
      .setFooter({ text: 'Naib seats are defended by BGT holdings' });

    await interaction.reply({ embeds: [embed] });
  },
};
```

#### 6.1.2 `/threshold` Command

```typescript
// src/discord/commands/threshold.ts

export const thresholdCommand = {
  data: new SlashCommandBuilder()
    .setName('threshold')
    .setDescription('View current entry threshold and waitlist positions'),

  async execute(interaction: ChatInputCommandInteraction) {
    const snapshot = thresholdService.getLatestSnapshot();

    if (!snapshot) {
      await interaction.reply({
        content: 'Threshold data not yet available.',
        ephemeral: true
      });
      return;
    }

    const waitlistDisplay = snapshot.waitlistPositions
      .slice(0, 5)  // Show top 5 waitlist positions
      .map(p => `• Position ${p.position}: **${formatBgt(p.distanceToEntry)} BGT** away`)
      .join('\n');

    const embed = new EmbedBuilder()
      .setTitle('🚪 The Threshold')
      .setColor(0x8B4513)  // Saddle brown (desert)
      .addFields(
        {
          name: 'Entry Requirement',
          value: `**${formatBgt(snapshot.entryThreshold)} BGT**\n(Position #69 holds this amount)`,
        },
        {
          name: 'Next in Line',
          value: waitlistDisplay || 'No waitlist data',
        }
      )
      .setFooter({ text: `Updated ${formatTimeAgo(snapshot.snapshotAt)}` });

    await interaction.reply({ embeds: [embed] });
  },
};
```

#### 6.1.3 `/position` Command

```typescript
// src/discord/commands/position.ts

export const positionCommand = {
  data: new SlashCommandBuilder()
    .setName('position')
    .setDescription('View your position relative to others (private)'),

  async execute(interaction: ChatInputCommandInteraction) {
    const member = await getMemberByDiscordId(interaction.user.id);

    if (!member) {
      await interaction.reply({
        content: 'You must complete onboarding first.',
        ephemeral: true
      });
      return;
    }

    const distances = thresholdService.getMemberDistances(member.memberId);

    if (!distances) {
      await interaction.reply({
        content: 'Position data not available yet.',
        ephemeral: true
      });
      return;
    }

    const isNaib = naibService.isCurrentNaib(member.memberId);
    const statusLine = isNaib
      ? 'You are a Naib member.'
      : 'You are a Fedaykin.';

    const embed = new EmbedBuilder()
      .setTitle('📊 Your Position')
      .setColor(isNaib ? 0xFFD700 : 0x4169E1)
      .setDescription(statusLine)
      .addFields(
        {
          name: 'Distance to Position Above',
          value: `↑ **${formatBgt(distances.distanceToAbove)} BGT** to move up`,
          inline: true,
        },
        {
          name: 'Distance from Position Below',
          value: `↓ Position below is **${formatBgt(distances.distanceFromBelow)} BGT** away`,
          inline: true,
        }
      )
      .setFooter({ text: 'Use /alerts to configure position notifications' });

    // Always ephemeral - private to the user
    await interaction.reply({ embeds: [embed], ephemeral: true });
  },
};
```

#### 6.1.4 `/alerts` Command

```typescript
// src/discord/commands/alerts.ts

export const alertsCommand = {
  data: new SlashCommandBuilder()
    .setName('alerts')
    .setDescription('Configure your notification preferences'),

  async execute(interaction: ChatInputCommandInteraction) {
    const member = await getMemberByDiscordId(interaction.user.id);

    if (!member) {
      await interaction.reply({
        content: 'You must complete onboarding first.',
        ephemeral: true
      });
      return;
    }

    const prefs = notificationService.getPreferences(member.memberId);
    const isNaib = naibService.isCurrentNaib(member.memberId);

    const embed = new EmbedBuilder()
      .setTitle('🔔 Notification Preferences')
      .setColor(0x5865F2)
      .addFields(
        {
          name: 'Position Updates',
          value: prefs.positionUpdatesEnabled
            ? `✅ Enabled (${formatFrequency(prefs.positionUpdateFrequency)})`
            : '❌ Disabled',
          inline: true,
        },
        {
          name: 'At-Risk Warnings',
          value: prefs.atRiskWarningsEnabled ? '✅ Enabled' : '❌ Disabled',
          inline: true,
        }
      );

    if (isNaib) {
      embed.addFields({
        name: 'Naib Alerts',
        value: prefs.naibAlertsEnabled ? '✅ Enabled' : '❌ Disabled',
        inline: true,
      });
    }

    // Add buttons for toggling
    const row = new ActionRowBuilder<ButtonBuilder>()
      .addComponents(
        new ButtonBuilder()
          .setCustomId('toggle_position_updates')
          .setLabel(prefs.positionUpdatesEnabled ? 'Disable Position' : 'Enable Position')
          .setStyle(prefs.positionUpdatesEnabled ? ButtonStyle.Secondary : ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId('toggle_at_risk')
          .setLabel(prefs.atRiskWarningsEnabled ? 'Disable At-Risk' : 'Enable At-Risk')
          .setStyle(prefs.atRiskWarningsEnabled ? ButtonStyle.Secondary : ButtonStyle.Primary),
      );

    // Add frequency selector
    const frequencyRow = new ActionRowBuilder<StringSelectMenuBuilder>()
      .addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('alert_frequency')
          .setPlaceholder('Position update frequency')
          .addOptions(
            { label: '1 per week', value: '1_per_week', default: prefs.positionUpdateFrequency === '1_per_week' },
            { label: '2 per week', value: '2_per_week', default: prefs.positionUpdateFrequency === '2_per_week' },
            { label: '3 per week', value: '3_per_week', default: prefs.positionUpdateFrequency === '3_per_week' },
            { label: 'Daily', value: 'daily', default: prefs.positionUpdateFrequency === 'daily' },
          ),
      );

    await interaction.reply({
      embeds: [embed],
      components: [row, frequencyRow],
      ephemeral: true
    });
  },
};
```

#### 6.1.5 `/register-waitlist` Command

```typescript
// src/discord/commands/register-waitlist.ts

export const registerWaitlistCommand = {
  data: new SlashCommandBuilder()
    .setName('register-waitlist')
    .setDescription('Register for eligibility notifications')
    .addStringOption(option =>
      option
        .setName('wallet')
        .setDescription('Your wallet address (0x...)')
        .setRequired(true)
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    const walletAddress = interaction.options.getString('wallet', true);

    // Validate wallet format
    if (!/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
      await interaction.reply({
        content: 'Invalid wallet address format. Please provide a valid Ethereum address (0x...).',
        ephemeral: true,
      });
      return;
    }

    // Check if already a member
    const existingMember = await getMemberByWallet(walletAddress);
    if (existingMember) {
      await interaction.reply({
        content: 'This wallet is already associated with a Sietch member.',
        ephemeral: true,
      });
      return;
    }

    // Register
    const result = thresholdService.registerWaitlist(
      interaction.user.id,
      walletAddress
    );

    if ('error' in result) {
      await interaction.reply({
        content: result.error,
        ephemeral: true,
      });
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle('✅ Registered for Waitlist Alerts')
      .setColor(0x00FF00)
      .setDescription(`You'll receive a DM when your wallet becomes eligible.`)
      .addFields(
        {
          name: 'Current Position',
          value: `#${result.positionAtRegistration}`,
          inline: true,
        },
        {
          name: 'Distance to Entry',
          value: formatBgt(thresholdService.getEntryThreshold() - result.bgtAtRegistration) + ' BGT',
          inline: true,
        }
      );

    await interaction.reply({ embeds: [embed], ephemeral: true });
  },
};
```

### 6.2 Discord Role Updates

#### 6.2.1 New Roles

| Role | ID Config Key | Color | Hoisted | Purpose |
|------|---------------|-------|---------|---------|
| `@Former Naib` | `DISCORD_ROLE_FORMER_NAIB` | Silver (#C0C0C0) | Yes | Former Naib members |

#### 6.2.2 Role Manager Updates

```typescript
// src/services/roleManager.ts (additions)

/**
 * Assign Naib role and remove Fedaykin
 */
async function assignNaibRole(discordUserId: string): Promise<void> {
  const guild = await getGuild();
  const member = await guild.members.fetch(discordUserId);

  await member.roles.add(config.discord.roles.naib);
  await member.roles.remove(config.discord.roles.fedaykin);

  logger.info({ discordUserId }, 'Assigned Naib role');
}

/**
 * Assign Former Naib role (keeps Fedaykin)
 */
async function assignFormerNaibRole(discordUserId: string): Promise<void> {
  const guild = await getGuild();
  const member = await guild.members.fetch(discordUserId);

  await member.roles.add(config.discord.roles.formerNaib);
  await member.roles.add(config.discord.roles.fedaykin);
  await member.roles.remove(config.discord.roles.naib);

  logger.info({ discordUserId }, 'Assigned Former Naib role');
}

/**
 * Remove Naib role (demotion to Fedaykin without Former Naib)
 */
async function removeNaibRole(discordUserId: string): Promise<void> {
  const guild = await getGuild();
  const member = await guild.members.fetch(discordUserId);

  await member.roles.remove(config.discord.roles.naib);
  await member.roles.add(config.discord.roles.fedaykin);

  logger.info({ discordUserId }, 'Removed Naib role');
}
```

### 6.3 Discord Channel Structure

```
SIETCH SERVER (Updated)
│
├── 🚪 CAVE ENTRANCE (Visible to @everyone)
│   ├── #the-threshold ───── Live waitlist stats (read-only for @everyone)
│   ├── #waiting-pool ────── Discussion for aspiring members
│   └── #register-interest ─ Waitlist registration commands
│
├── 📜 STILLSUIT (Visible to @Fedaykin, @Naib, @Former Naib)
│   ├── #water-discipline ── Welcome, rules
│   ├── #census ──────────── Live leaderboard
│   └── #the-door ────────── Member joins/departures
│
├── 🏛️ NAIB CHAMBER (Visible to @Naib only)
│   └── #naib-council ────── Current Naib private discussion
│
├── 🏛️ NAIB ARCHIVES (Visible to @Naib + @Former Naib)
│   └── #council-archives ── All who have served
│
├── 💬 SIETCH-COMMONS (Visible to @Fedaykin, @Naib, @Former Naib)
│   ├── #general
│   ├── #spice
│   ├── #water-shares
│   └── #introductions
│
├── 🏜️ DEEP DESERT (Visible to @Engaged role)
│   └── #deep-desert
│
├── 🧘 STILLSUIT LOUNGE (Visible to @Veteran role)
│   └── #stillsuit-lounge
│
└── 🛠️ WINDTRAP (Visible to @Fedaykin, @Naib, @Former Naib)
    ├── #support
    └── #bot-commands
```

### 6.4 Channel Permissions Matrix

| Channel | @everyone | @Fedaykin | @Naib | @Former Naib |
|---------|-----------|-----------|-------|--------------|
| #the-threshold | View | View | View | View |
| #waiting-pool | View, Send | View, Send | View, Send | View, Send |
| #register-interest | View, Slash | View | View | View |
| #water-discipline | ❌ | View | View | View |
| #census | ❌ | View | View | View |
| #the-door | ❌ | View | View | View |
| #naib-council | ❌ | ❌ | View, Send | ❌ |
| #council-archives | ❌ | ❌ | View, Send | View, Send |
| #general | ❌ | View, Send | View, Send | View, Send |
| (other member channels) | ❌ | View, Send | View, Send | View, Send |

---

## 7. Scheduled Tasks

### 7.1 Enhanced Eligibility Sync

```typescript
// src/trigger/syncEligibility.ts (updated)

import { task } from '@trigger.dev/sdk/v3';
import { chainService } from '../services/chain.js';
import { eligibilityService } from '../services/eligibility.js';
import { naibService } from '../services/naib.js';
import { thresholdService } from '../services/threshold.js';
import { notificationService } from '../services/notification.js';

export const syncEligibility = task({
  id: 'sync-eligibility',
  run: async () => {
    logger.info('Starting eligibility sync with Naib evaluation');

    // Step 1: Fetch current chain data
    const chainData = await chainService.fetchEligibilityData();

    // Step 2: Compute eligibility list
    const eligibilityList = eligibilityService.computeEligibility(chainData);

    // Step 3: Save eligibility snapshot
    await saveEligibilitySnapshot(eligibilityList);

    // Step 4: Evaluate Naib seats
    const naibChanges = naibService.evaluateSeats(
      eligibilityList.map(e => ({
        memberId: getMemberIdByWallet(e.address),
        bgtHeld: e.bgtHeld,
      })).filter(e => e.memberId !== null)
    );

    // Step 5: Process Naib changes (role updates, notifications)
    for (const change of naibChanges) {
      if (change.type === 'bumped') {
        await roleManager.assignFormerNaibRole(change.memberId);
        await notificationService.sendBumpNotification(
          change.memberId,
          'former_naib',
          BigInt(change.details.newNaibBgt)
        );
      } else if (change.type === 'seated') {
        await roleManager.assignNaibRole(change.memberId);
        await notificationService.sendNaibSeated(change.memberId, change.details.seatNumber);
      }
    }

    // Step 6: Calculate and save threshold snapshot
    const thresholdSnapshot = thresholdService.saveSnapshot(eligibilityList);

    // Step 7: Check waitlist for newly eligible
    const newlyEligible = thresholdService.checkWaitlistEligibility(eligibilityList);
    for (const registration of newlyEligible) {
      await notificationService.sendWaitlistEligible(
        registration.discordUserId,
        registration.walletAddress
      );
      thresholdService.markNotified(registration.id);
    }

    // Step 8: Process position alerts
    const alertResults = await notificationService.processPositionAlerts(
      thresholdSnapshot,
      config.alerts.atRiskThreshold
    );

    logger.info({
      naibChanges: naibChanges.length,
      newlyEligible: newlyEligible.length,
      alertsSent: alertResults.sent,
    }, 'Eligibility sync completed');

    return { success: true };
  },
});
```

### 7.2 Weekly Counter Reset

```typescript
// src/trigger/weeklyReset.ts

export const weeklyReset = task({
  id: 'weekly-counter-reset',
  // Runs every Monday at 00:00 UTC
  run: async () => {
    notificationService.resetWeeklyCounters();
    logger.info('Reset weekly alert counters');
    return { success: true };
  },
});
```

---

## 8. Configuration

### 8.1 New Configuration Options

```typescript
// src/config.ts (additions)

const configSchema = z.object({
  // ... existing config ...

  // Naib & Threshold Configuration (v2.1)
  naib: z.object({
    // Number of Naib seats
    seatCount: z.coerce.number().int().min(1).max(20).default(7),
    // Bump tie-breaker
    tiebreaker: z.enum(['tenure', 'random']).default('tenure'),
  }),

  alerts: z.object({
    // At-risk threshold percentage
    atRiskThreshold: z.coerce.number().int().min(1).max(50).default(10),
    // Default alert frequency
    defaultFrequency: z.enum(['1_per_week', '2_per_week', '3_per_week', 'daily']).default('3_per_week'),
    // Waitlist range to display
    waitlistRangeStart: z.coerce.number().int().default(70),
    waitlistRangeEnd: z.coerce.number().int().default(100),
  }),

  discord: z.object({
    // ... existing discord config ...
    roles: z.object({
      // ... existing roles ...
      formerNaib: z.string().optional(),
    }),
    channels: z.object({
      // ... existing channels ...
      // Cave Entrance channels
      theThreshold: z.string().optional(),
      waitingPool: z.string().optional(),
      registerInterest: z.string().optional(),
      // Naib channels
      naibChamber: z.string().optional(),
      naibArchives: z.string().optional(),
    }),
  }),
});
```

### 8.2 Environment Variables

```bash
# Naib Configuration
NAIB_SEAT_COUNT=7
NAIB_TIEBREAKER=tenure

# Alert Configuration
AT_RISK_THRESHOLD=10
DEFAULT_ALERT_FREQUENCY=3_per_week
WAITLIST_RANGE_START=70
WAITLIST_RANGE_END=100

# Discord Roles (v2.1)
DISCORD_ROLE_FORMER_NAIB=

# Discord Channels (v2.1)
DISCORD_CHANNEL_THE_THRESHOLD=
DISCORD_CHANNEL_WAITING_POOL=
DISCORD_CHANNEL_REGISTER_INTEREST=
DISCORD_CHANNEL_NAIB_CHAMBER=
DISCORD_CHANNEL_NAIB_ARCHIVES=
```

---

## 9. Security Considerations

### 9.1 Privacy Protection

| Data Point | Protection | Implementation |
|------------|------------|----------------|
| Member position in bottom 10% | Never public | At-risk alerts via DM only |
| Who got bumped | Private | Bump notifications via DM only |
| Exact member BGT holdings | Never exposed | Only show relative distances |
| Wallet → Nym correlation | Never exposed | Internal UUID for all queries |
| Waitlist wallet addresses | Public (chain data) | Positions 70-100 are not members |

### 9.2 Rate Limiting

| Endpoint | Limit | Window |
|----------|-------|--------|
| `/api/waitlist/register` | 5 | 1 hour |
| `/api/notifications/preferences` | 10 | 1 minute |
| `/threshold` command | 10 | 1 minute |
| Position alerts | Configurable | Weekly |

### 9.3 Input Validation

```typescript
// Wallet address validation
const walletSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/);

// Alert frequency validation
const frequencySchema = z.enum(['1_per_week', '2_per_week', '3_per_week', 'daily']);

// Threshold validation
const thresholdSchema = z.number().int().min(1).max(50);
```

---

## 10. Testing Strategy

### 10.1 Unit Tests

```typescript
// tests/services/naib.test.ts

describe('NaibService', () => {
  describe('evaluateNewMember', () => {
    it('should seat member when seats available', () => { /* ... */ });
    it('should bump lowest BGT member when seats full', () => { /* ... */ });
    it('should use tenure as tiebreaker for equal BGT', () => { /* ... */ });
    it('should not bump when new member has lower BGT', () => { /* ... */ });
  });

  describe('evaluateSeats', () => {
    it('should unseat ineligible members', () => { /* ... */ });
    it('should handle multiple bumps in single evaluation', () => { /* ... */ });
    it('should allow former Naib to re-enter', () => { /* ... */ });
  });
});

// tests/services/threshold.test.ts

describe('ThresholdService', () => {
  describe('calculateDistances', () => {
    it('should calculate correct entry threshold', () => { /* ... */ });
    it('should calculate waitlist distances', () => { /* ... */ });
    it('should calculate member distances', () => { /* ... */ });
  });

  describe('registerWaitlist', () => {
    it('should register valid waitlist position', () => { /* ... */ });
    it('should reject position outside 70-100', () => { /* ... */ });
    it('should reject already registered wallet', () => { /* ... */ });
  });
});

// tests/services/notification.test.ts

describe('NotificationService', () => {
  describe('canSendAlert', () => {
    it('should respect weekly limits', () => { /* ... */ });
    it('should reset counter on new week', () => { /* ... */ });
    it('should respect disabled preferences', () => { /* ... */ });
  });

  describe('processPositionAlerts', () => {
    it('should send alerts respecting rate limits', () => { /* ... */ });
    it('should identify at-risk members correctly', () => { /* ... */ });
  });
});
```

### 10.2 Integration Tests

```typescript
// tests/integration/naib-flow.test.ts

describe('Naib Flow Integration', () => {
  it('should complete full onboarding with Naib seat assignment', async () => {
    // 1. Create eligible member
    // 2. Complete onboarding
    // 3. Verify Naib seat assigned
    // 4. Verify role granted
  });

  it('should handle bump during onboarding', async () => {
    // 1. Fill all 7 seats
    // 2. New member with higher BGT completes onboarding
    // 3. Verify bump occurred
    // 4. Verify roles updated
    // 5. Verify notifications sent
  });

  it('should handle bump during sync', async () => {
    // 1. Existing member BGT increases
    // 2. Run eligibility sync
    // 3. Verify seat changes
    // 4. Verify notifications
  });
});
```

---

## 11. Implementation Phases

### Phase 1: Naib Foundation (Sprint 11)

**Estimated effort**: 1 week

- [ ] Database migration 005_naib_threshold.ts
- [ ] NaibService implementation
- [ ] Naib seat queries
- [ ] `/naib` command
- [ ] Role manager updates for Naib/Former Naib
- [ ] Integration with onboarding flow
- [ ] Unit tests for NaibService

### Phase 2: Cave Entrance (Sprint 12)

**Estimated effort**: 1 week

- [ ] ThresholdService implementation
- [ ] Distance calculation logic
- [ ] Waitlist registration
- [ ] `/threshold` command
- [ ] `/register-waitlist` command
- [ ] Discord channel setup (Cave Entrance)
- [ ] API endpoints for threshold/waitlist
- [ ] Unit tests for ThresholdService

### Phase 3: Notification System (Sprint 13)

**Estimated effort**: 1 week

- [ ] NotificationService implementation
- [ ] Alert message templates
- [ ] Rate limiting logic
- [ ] `/position` command
- [ ] `/alerts` command
- [ ] Preference management UI
- [ ] API endpoints for notifications
- [ ] Unit tests for NotificationService

### Phase 4: Integration & Polish (Sprint 14)

**Estimated effort**: 1 week

- [ ] Enhanced eligibility sync task
- [ ] Weekly counter reset task
- [ ] Integration testing
- [ ] Discord channel permissions setup
- [ ] Admin endpoints
- [ ] Documentation updates
- [ ] Production deployment

---

## 12. Appendix

### A. File Structure

```
sietch-service/src/
├── services/
│   ├── naib.ts            # NEW: Naib seat management
│   ├── threshold.ts       # NEW: Waitlist and distances
│   ├── notification.ts    # NEW: Alert system
│   └── ... (existing)
├── discord/
│   ├── commands/
│   │   ├── naib.ts        # NEW
│   │   ├── threshold.ts   # NEW
│   │   ├── position.ts    # NEW
│   │   ├── alerts.ts      # NEW
│   │   ├── register-waitlist.ts  # NEW
│   │   └── ... (existing)
│   └── embeds/
│       ├── naib.ts        # NEW
│       ├── threshold.ts   # NEW
│       └── ... (existing)
├── api/
│   ├── handlers/
│   │   ├── naib.ts        # NEW
│   │   ├── threshold.ts   # NEW
│   │   ├── position.ts    # NEW
│   │   ├── notifications.ts  # NEW
│   │   ├── waitlist.ts    # NEW
│   │   └── ... (existing)
│   └── ... (existing)
├── db/
│   ├── migrations/
│   │   └── 005_naib_threshold.ts  # NEW
│   └── ... (existing)
├── trigger/
│   ├── syncEligibility.ts # MODIFIED
│   ├── weeklyReset.ts     # NEW
│   └── ... (existing)
└── types/
    └── index.ts           # MODIFIED (new types)
```

### B. Type Definitions

```typescript
// src/types/index.ts (additions)

// Naib types
export interface NaibSeat { /* ... */ }
export interface NaibMember { /* ... */ }
export interface BumpResult { /* ... */ }

// Threshold types
export interface PositionDistance { /* ... */ }
export interface ThresholdSnapshot { /* ... */ }
export interface WaitlistRegistration { /* ... */ }

// Notification types
export type AlertType = /* ... */;
export interface NotificationPreferences { /* ... */ }
export interface AlertRecord { /* ... */ }
```

### C. Migration Rollback

```sql
-- Rollback migration 005_naib_threshold.ts

DROP TABLE IF EXISTS naib_seats;
DROP TABLE IF EXISTS waitlist_registrations;
DROP TABLE IF EXISTS notification_preferences;
DROP TABLE IF EXISTS alert_history;
DROP TABLE IF EXISTS threshold_snapshots;

-- Remove column from member_profiles
-- Note: SQLite doesn't support DROP COLUMN easily
-- Requires table recreation or using newer SQLite version
```

---

## 13. Version History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 2.1.0 | 2025-12-19 | Architecture Designer | Initial SDD for Naib Dynamics & Threshold |

---

*Document generated by Architecture Designer Agent*

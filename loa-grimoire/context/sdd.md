# Software Design Document: Sietch

**Version**: 3.0
**Date**: December 20, 2025
**Status**: Draft
**PRD Reference**: `docs/prd.md`
**Codename**: The Great Expansion

---

## 1. Executive Summary

### 1.1 Document Purpose

This Software Design Document (SDD) provides the technical architecture and implementation blueprint for Sietch v3.0 "The Great Expansion". It extends the existing v2.1 architecture to support a 9-tier membership system, sponsor invites, enhanced notifications, and community engagement features.

### 1.2 System Overview

Sietch v3.0 transforms from an exclusive 69-member community into a layered sanctuary supporting 500+ members across 9 tiers. The system maintains the privacy-first, never-redeemed purity requirement while dramatically expanding participation.

**Key Capabilities**:
1. **9-Tier Membership** - Hajra (6.9 BGT) through Naib (Top 7)
2. **Automatic Tier Assignment** - BGT balance and rank-based calculation
3. **Dynamic Naib System** - 7 competitive seats with BGT-based bumping (retained from v2.1)
4. **Position Alert System** - At-risk warnings, Naib threats, relative standings (retained from v2.1)
5. **Sponsor Invites** - Water Sharer badge enables sponsorship
6. **Tier Notifications** - DM alerts on promotion
7. **Weekly Digest** - Community pulse posted to announcements
8. **Story Fragments** - Cryptic narratives for elite joins
9. **Analytics Dashboard** - Admin visibility into community health

### 1.3 Key Architectural Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Database | SQLite (existing) | Sufficient for 500+ members; WAL mode handles concurrent reads |
| Tier Storage | Column in member_profiles | Single source of truth; atomic updates with BGT sync |
| Role Management | Additive roles | Members accumulate tier roles; simplifies permission inheritance |
| Invite System | Badge-gated | Water Sharer badge enables sponsorship; admin-controlled |
| Story Fragments | Database-stored | Editable without code deployment; usage tracking |
| Weekly Digest | trigger.dev task | Existing scheduler infrastructure; reliable delivery |

### 1.4 Architecture Principles

1. **Extend, Don't Replace**: Build on existing patterns; no breaking changes
2. **Privacy First**: Tier visible, BGT amount never exposed
3. **Graceful Degradation**: Tier features fail safely; core eligibility unaffected
4. **Audit Everything**: All tier changes and sponsor actions logged
5. **Single Source of Truth**: Tier calculated during sync, not on-demand

---

## 2. System Architecture

### 2.1 High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              SIETCH v3.0                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐                   │
│  │   Discord    │    │   Express    │    │  trigger.dev │                   │
│  │     Bot      │    │     API      │    │   Scheduler  │                   │
│  └──────┬───────┘    └──────┬───────┘    └──────┬───────┘                   │
│         │                   │                   │                            │
│         └───────────────────┴───────────────────┘                            │
│                             │                                                │
│  ┌──────────────────────────┴──────────────────────────┐                    │
│  │                   SERVICE LAYER                      │                    │
│  │  ┌────────────┐  ┌────────────┐  ┌────────────┐     │                    │
│  │  │   Tier     │  │  Sponsor   │  │   Digest   │     │  NEW SERVICES      │
│  │  │  Service   │  │  Service   │  │  Service   │     │                    │
│  │  └────────────┘  └────────────┘  └────────────┘     │                    │
│  │  ┌────────────┐  ┌────────────┐  ┌────────────┐     │                    │
│  │  │   Story    │  │ Analytics  │  │   Stats    │     │                    │
│  │  │  Service   │  │  Service   │  │  Service   │     │                    │
│  │  └────────────┘  └────────────┘  └────────────┘     │                    │
│  │                                                      │                    │
│  │  ┌────────────┐  ┌────────────┐  ┌────────────┐     │                    │
│  │  │ Eligibility│  │  Profile   │  │   Badge    │     │  EXISTING          │
│  │  │  Service   │  │  Service   │  │  Service   │     │  SERVICES          │
│  │  └────────────┘  └────────────┘  └────────────┘     │                    │
│  │  ┌────────────┐  ┌────────────┐  ┌────────────┐     │                    │
│  │  │   Naib     │  │ Threshold  │  │Notification│     │  RETAINED v2.1     │
│  │  │  Service   │  │  Service   │  │  Service   │     │                    │
│  │  └────────────┘  └────────────┘  └────────────┘     │                    │
│  └─────────────────────────┬────────────────────────────┘                    │
│                            │                                                 │
│  ┌─────────────────────────┴────────────────────────────┐                   │
│  │                    DATA LAYER                         │                   │
│  │  ┌────────────────────────────────────────────────┐  │                   │
│  │  │              SQLite Database                    │  │                   │
│  │  │  • member_profiles (+ tier, tier_updated_at)   │  │                   │
│  │  │  • tier_history (NEW)                          │  │                   │
│  │  │  • sponsor_invites (NEW)                       │  │                   │
│  │  │  • story_fragments (NEW)                       │  │                   │
│  │  │  • weekly_digests (NEW)                        │  │                   │
│  │  │  • naib_seats (RETAINED v2.1)                  │  │                   │
│  │  │  • notification_preferences (RETAINED v2.1)   │  │                   │
│  │  │  • alert_history (RETAINED v2.1)              │  │                   │
│  │  │  • [existing tables unchanged]                 │  │                   │
│  │  └────────────────────────────────────────────────┘  │                   │
│  └───────────────────────────────────────────────────────┘                   │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
            ┌───────────────────────┼───────────────────────┐
            │                       │                       │
    ┌───────┴───────┐       ┌───────┴───────┐       ┌───────┴───────┐
    │   Berachain   │       │    Discord    │       │  Collab.Land  │
    │     RPC       │       │     API       │       │  (Unchanged)  │
    └───────────────┘       └───────────────┘       └───────────────┘
```

### 2.2 Component Interaction Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    TIER SYNC FLOW (Every 6 Hours)                        │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  1. trigger.dev fires sync-eligibility task                             │
│                     │                                                    │
│                     ▼                                                    │
│  2. EligibilityService fetches BGT from Berachain                       │
│                     │                                                    │
│                     ▼                                                    │
│  3. TierService.calculateTier(bgt, rank) for each member                │
│                     │                                                    │
│     ┌───────────────┼───────────────┐                                   │
│     │               │               │                                   │
│     ▼               ▼               ▼                                   │
│  Hajra-Usul     Fedaykin       Naib                                     │
│  (BGT only)     (Top 8-69)     (Top 7)                                  │
│                     │                                                    │
│                     ▼                                                    │
│  4. Compare previous tier → detect promotions                           │
│                     │                                                    │
│     ┌───────────────┼───────────────┐                                   │
│     │               │               │                                   │
│     ▼               ▼               ▼                                   │
│  Update DB      Log History    Queue Notification                       │
│                     │                                                    │
│                     ▼                                                    │
│  5. RoleManagerService.syncTierRoles(memberId, newTier)                 │
│                     │                                                    │
│                     ▼                                                    │
│  6. If Fedaykin/Naib promotion → StoryService.postFragment()            │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### 2.3 Request Flow Patterns

**Discord Command Flow**:
```
User → /stats → CommandRouter → StatsCommand
                                    │
                                    ▼
                              StatsService.getPersonalStats(memberId)
                                    │
                    ┌───────────────┼───────────────┐
                    │               │               │
                    ▼               ▼               ▼
              ProfileService   ActivityService  TierService
              (tier, badges)   (streaks, msgs)  (progress)
                    │               │               │
                    └───────────────┼───────────────┘
                                    │
                                    ▼
                              Build Embed → Reply
```

**API Request Flow**:
```
Client → GET /api/me/tier-progress
              │
              ▼
         Auth Middleware (Discord OAuth header)
              │
              ▼
         Rate Limiter (60 req/min member tier)
              │
              ▼
         TierController.getTierProgress()
              │
              ▼
         TierService.calculateProgress(memberId)
              │
              ▼
         JSON Response: { current, next, distance, percentage }
```

---

## 3. Technology Stack

### 3.1 Core Technologies (Unchanged)

| Layer | Technology | Version | Purpose |
|-------|------------|---------|---------|
| Runtime | Node.js | 20.x LTS | Server runtime |
| Language | TypeScript | 5.6.x | Type safety |
| Database | SQLite | 3.x (better-sqlite3) | Data persistence |
| API | Express | 4.21.x | REST endpoints |
| Bot | discord.js | 14.16.x | Discord integration |
| Scheduler | trigger.dev | 3.0.x | Cron jobs |
| Blockchain | viem | 2.21.x | Berachain RPC |
| Logging | Pino | 9.5.x | Structured logs |

### 3.2 New Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| None required | - | v3.0 uses existing dependencies |

### 3.3 Project Structure (Extended)

```
sietch-service/
├── src/
│   ├── services/
│   │   ├── TierService.ts          # NEW: Tier calculation & management
│   │   ├── SponsorService.ts       # NEW: Invite management
│   │   ├── DigestService.ts        # NEW: Weekly digest generation
│   │   ├── StoryService.ts         # NEW: Story fragment posting
│   │   ├── StatsService.ts         # NEW: Personal & community stats
│   │   ├── AnalyticsService.ts     # NEW: Admin analytics
│   │   ├── EligibilityService.ts   # Extended: tier integration
│   │   ├── ProfileService.ts       # Extended: tier display
│   │   ├── BadgeService.ts         # Extended: Usul Ascended badge
│   │   ├── NotificationService.ts  # Extended: tier promotions
│   │   └── RoleManagerService.ts   # Extended: 9 tier roles
│   ├── discord/
│   │   └── commands/
│   │       ├── stats.ts            # NEW: /stats command
│   │       ├── invite.ts           # NEW: /invite command
│   │       └── leaderboard.ts      # Extended: tiers subcommand
│   ├── api/
│   │   └── routes/
│   │       ├── tier.ts             # NEW: Tier endpoints
│   │       ├── sponsor.ts          # NEW: Sponsor endpoints
│   │       └── stats.ts            # NEW: Stats endpoints
│   ├── trigger/
│   │   ├── sync-eligibility.ts     # Extended: tier sync
│   │   └── weekly-digest.ts        # NEW: Digest posting
│   └── db/
│       └── migrations/
│           └── 006_tier_system.sql # NEW: Tier tables
```

---

## 4. Component Design

### 4.1 TierService

**File**: `src/services/TierService.ts`

**Responsibility**: Calculate, assign, and track member tiers based on BGT holdings and rank.

```typescript
// src/services/TierService.ts

import { db } from '../db';
import { logger } from '../utils/logger';
import type { Tier, TierHistoryEntry, TierProgress } from '../types';

export const TIER_THRESHOLDS = {
  hajra: 6.9,
  ichwan: 69,
  qanat: 222,
  sihaya: 420,
  mushtamal: 690,
  sayyadina: 888,
  usul: 1111,
  fedaykin: null,  // Top 8-69 (rank-based)
  naib: null,      // Top 7 (rank-based)
} as const;

export const TIER_ORDER: Tier[] = [
  'hajra', 'ichwan', 'qanat', 'sihaya',
  'mushtamal', 'sayyadina', 'usul',
  'fedaykin', 'naib'
];

export class TierService {
  /**
   * Calculate tier from BGT amount and rank position
   * Rank takes precedence for Fedaykin/Naib
   */
  calculateTier(bgt: number, rank: number | null): Tier {
    // Rank-based tiers (top 69)
    if (rank !== null) {
      if (rank <= 7) return 'naib';
      if (rank <= 69) return 'fedaykin';
    }

    // BGT-based tiers (threshold)
    if (bgt >= 1111) return 'usul';
    if (bgt >= 888) return 'sayyadina';
    if (bgt >= 690) return 'mushtamal';
    if (bgt >= 420) return 'sihaya';
    if (bgt >= 222) return 'qanat';
    if (bgt >= 69) return 'ichwan';
    if (bgt >= 6.9) return 'hajra';

    // Below minimum - should not happen for verified members
    return 'hajra';
  }

  /**
   * Update member's tier and record history if changed
   * Returns true if tier changed (promotion)
   */
  async updateMemberTier(
    memberId: string,
    bgt: number,
    rank: number | null
  ): Promise<{ changed: boolean; oldTier: Tier | null; newTier: Tier }> {
    const newTier = this.calculateTier(bgt, rank);

    const current = db.prepare(`
      SELECT tier FROM member_profiles WHERE id = ?
    `).get(memberId) as { tier: Tier } | undefined;

    const oldTier = current?.tier ?? null;
    const changed = oldTier !== newTier;

    if (changed) {
      const now = Date.now();

      // Update profile
      db.prepare(`
        UPDATE member_profiles
        SET tier = ?, tier_updated_at = ?
        WHERE id = ?
      `).run(newTier, now, memberId);

      // Record history
      db.prepare(`
        INSERT INTO tier_history (id, member_id, from_tier, to_tier, bgt_at_change, changed_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        crypto.randomUUID(),
        memberId,
        oldTier,
        newTier,
        Math.floor(bgt),
        now
      );

      logger.info({ memberId, oldTier, newTier, bgt }, 'Tier changed');
    }

    return { changed, oldTier, newTier };
  }

  /**
   * Calculate progress toward next tier
   */
  getTierProgress(memberId: string): TierProgress | null {
    const member = db.prepare(`
      SELECT mp.tier, ce.bgt
      FROM member_profiles mp
      JOIN wallet_mappings wm ON wm.discord_id = mp.discord_id
      JOIN current_eligibility ce ON ce.address = wm.wallet_address
      WHERE mp.id = ?
    `).get(memberId) as { tier: Tier; bgt: number } | undefined;

    if (!member) return null;

    const currentIndex = TIER_ORDER.indexOf(member.tier);
    const nextTier = TIER_ORDER[currentIndex + 1];

    // Fedaykin/Naib - rank-based, no BGT progress
    if (member.tier === 'fedaykin' || member.tier === 'naib' || !nextTier) {
      return {
        currentTier: member.tier,
        currentBgt: member.bgt,
        nextTier: null,
        nextThreshold: null,
        distance: null,
        percentage: 100,
      };
    }

    // BGT-based tiers
    const nextThreshold = TIER_THRESHOLDS[nextTier as keyof typeof TIER_THRESHOLDS];

    if (nextThreshold === null) {
      // Next tier is rank-based (Fedaykin)
      return {
        currentTier: member.tier,
        currentBgt: member.bgt,
        nextTier: 'fedaykin',
        nextThreshold: null,
        distance: null,
        percentage: null,
        note: 'Fedaykin requires Top 69 rank',
      };
    }

    const currentThreshold = TIER_THRESHOLDS[member.tier] || 0;
    const range = nextThreshold - currentThreshold;
    const progress = member.bgt - currentThreshold;
    const percentage = Math.min(100, Math.floor((progress / range) * 100));

    return {
      currentTier: member.tier,
      currentBgt: member.bgt,
      nextTier,
      nextThreshold,
      distance: Math.max(0, nextThreshold - member.bgt),
      percentage,
    };
  }

  /**
   * Get tier history for a member
   */
  getTierHistory(memberId: string, limit = 10): TierHistoryEntry[] {
    return db.prepare(`
      SELECT from_tier, to_tier, bgt_at_change, changed_at
      FROM tier_history
      WHERE member_id = ?
      ORDER BY changed_at DESC
      LIMIT ?
    `).all(memberId, limit) as TierHistoryEntry[];
  }

  /**
   * Get tier distribution for analytics
   */
  getTierDistribution(): Record<Tier, number> {
    const rows = db.prepare(`
      SELECT tier, COUNT(*) as count
      FROM member_profiles
      WHERE tier IS NOT NULL
      GROUP BY tier
    `).all() as { tier: Tier; count: number }[];

    const distribution: Record<Tier, number> = {
      hajra: 0, ichwan: 0, qanat: 0, sihaya: 0,
      mushtamal: 0, sayyadina: 0, usul: 0,
      fedaykin: 0, naib: 0,
    };

    for (const row of rows) {
      distribution[row.tier] = row.count;
    }

    return distribution;
  }

  /**
   * Check if tier is promotion (higher than previous)
   */
  isPromotion(oldTier: Tier | null, newTier: Tier): boolean {
    if (!oldTier) return true; // First tier assignment
    return TIER_ORDER.indexOf(newTier) > TIER_ORDER.indexOf(oldTier);
  }
}

export const tierService = new TierService();
```

### 4.2 SponsorService

**File**: `src/services/SponsorService.ts`

**Responsibility**: Manage sponsor invites for Water Sharer badge holders.

```typescript
// src/services/SponsorService.ts

import { db } from '../db';
import { logger } from '../utils/logger';
import { badgeService } from './BadgeService';
import type { SponsorInvite, Tier } from '../types';

export class SponsorService {
  private readonly WATER_SHARER_BADGE = 'water-sharer';

  /**
   * Check if member can sponsor (has badge + no active invite)
   */
  canSponsor(memberId: string): { allowed: boolean; reason?: string } {
    // Check badge
    const hasBadge = badgeService.hasBadge(memberId, this.WATER_SHARER_BADGE);
    if (!hasBadge) {
      return { allowed: false, reason: 'Water Sharer badge required' };
    }

    // Check for active invite
    const activeInvite = db.prepare(`
      SELECT id FROM sponsor_invites
      WHERE sponsor_member_id = ?
        AND revoked_at IS NULL
    `).get(memberId);

    if (activeInvite) {
      return { allowed: false, reason: 'You already have an active invite' };
    }

    return { allowed: true };
  }

  /**
   * Create sponsor invite for a Discord user
   */
  async createInvite(
    sponsorMemberId: string,
    invitedDiscordId: string
  ): Promise<{ success: boolean; invite?: SponsorInvite; error?: string }> {
    // Validate sponsor
    const canSponsor = this.canSponsor(sponsorMemberId);
    if (!canSponsor.allowed) {
      return { success: false, error: canSponsor.reason };
    }

    // Check invited user isn't already a member
    const existingMember = db.prepare(`
      SELECT id FROM member_profiles WHERE discord_id = ?
    `).get(invitedDiscordId);

    if (existingMember) {
      return { success: false, error: 'User is already a member' };
    }

    // Check invited user doesn't have pending invite
    const pendingInvite = db.prepare(`
      SELECT id FROM sponsor_invites
      WHERE invited_discord_id = ?
        AND revoked_at IS NULL
        AND accepted_at IS NULL
    `).get(invitedDiscordId);

    if (pendingInvite) {
      return { success: false, error: 'User already has a pending invite' };
    }

    // Get sponsor's tier to grant to invitee
    const sponsor = db.prepare(`
      SELECT tier FROM member_profiles WHERE id = ?
    `).get(sponsorMemberId) as { tier: Tier };

    const invite: SponsorInvite = {
      id: crypto.randomUUID(),
      sponsor_member_id: sponsorMemberId,
      invited_discord_id: invitedDiscordId,
      invited_member_id: null,
      tier_granted: sponsor.tier,
      created_at: Date.now(),
      accepted_at: null,
      revoked_at: null,
    };

    db.prepare(`
      INSERT INTO sponsor_invites
      (id, sponsor_member_id, invited_discord_id, tier_granted, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      invite.id,
      invite.sponsor_member_id,
      invite.invited_discord_id,
      invite.tier_granted,
      invite.created_at
    );

    logger.info({ sponsorMemberId, invitedDiscordId, tier: sponsor.tier }, 'Sponsor invite created');

    return { success: true, invite };
  }

  /**
   * Accept invite (called during onboarding)
   */
  async acceptInvite(
    invitedDiscordId: string,
    newMemberId: string
  ): Promise<{ success: boolean; tier?: Tier; error?: string }> {
    const invite = db.prepare(`
      SELECT * FROM sponsor_invites
      WHERE invited_discord_id = ?
        AND revoked_at IS NULL
        AND accepted_at IS NULL
    `).get(invitedDiscordId) as SponsorInvite | undefined;

    if (!invite) {
      return { success: false, error: 'No pending invite found' };
    }

    const now = Date.now();

    db.prepare(`
      UPDATE sponsor_invites
      SET accepted_at = ?, invited_member_id = ?
      WHERE id = ?
    `).run(now, newMemberId, invite.id);

    // Set invitee's tier to sponsor's tier
    db.prepare(`
      UPDATE member_profiles
      SET tier = ?, tier_updated_at = ?
      WHERE id = ?
    `).run(invite.tier_granted, now, newMemberId);

    logger.info({ inviteId: invite.id, newMemberId, tier: invite.tier_granted }, 'Sponsor invite accepted');

    return { success: true, tier: invite.tier_granted };
  }

  /**
   * Revoke invite (admin action)
   */
  revokeInvite(inviteId: string, revokedBy: string): boolean {
    const result = db.prepare(`
      UPDATE sponsor_invites
      SET revoked_at = ?
      WHERE id = ? AND revoked_at IS NULL
    `).run(Date.now(), inviteId);

    if (result.changes > 0) {
      logger.info({ inviteId, revokedBy }, 'Sponsor invite revoked');
      return true;
    }
    return false;
  }

  /**
   * Get invite status for a sponsor
   */
  getInviteStatus(sponsorMemberId: string): {
    hasActiveInvite: boolean;
    invite?: SponsorInvite;
    invitee?: { discord_id: string; nym?: string; accepted: boolean };
  } {
    const invite = db.prepare(`
      SELECT si.*, mp.nym
      FROM sponsor_invites si
      LEFT JOIN member_profiles mp ON mp.id = si.invited_member_id
      WHERE si.sponsor_member_id = ?
        AND si.revoked_at IS NULL
      ORDER BY si.created_at DESC
      LIMIT 1
    `).get(sponsorMemberId) as (SponsorInvite & { nym?: string }) | undefined;

    if (!invite) {
      return { hasActiveInvite: false };
    }

    return {
      hasActiveInvite: true,
      invite,
      invitee: {
        discord_id: invite.invited_discord_id,
        nym: invite.nym,
        accepted: invite.accepted_at !== null,
      },
    };
  }

  /**
   * Check if Discord user has pending invite
   */
  getPendingInvite(discordId: string): SponsorInvite | null {
    return db.prepare(`
      SELECT * FROM sponsor_invites
      WHERE invited_discord_id = ?
        AND revoked_at IS NULL
        AND accepted_at IS NULL
    `).get(discordId) as SponsorInvite | null;
  }
}

export const sponsorService = new SponsorService();
```

### 4.3 DigestService

**File**: `src/services/DigestService.ts`

**Responsibility**: Generate and post weekly community digest to #announcements.

```typescript
// src/services/DigestService.ts

import { db } from '../db';
import { logger } from '../utils/logger';
import { discordService } from './DiscordService';
import { tierService } from './TierService';
import type { WeeklyStats, WeeklyDigest } from '../types';

export class DigestService {
  /**
   * Collect stats for the past week
   */
  collectWeeklyStats(): WeeklyStats {
    const now = Date.now();
    const weekAgo = now - 7 * 24 * 60 * 60 * 1000;

    // Total members
    const totalMembers = db.prepare(`
      SELECT COUNT(*) as count FROM member_profiles
    `).get() as { count: number };

    // New members this week
    const newMembers = db.prepare(`
      SELECT COUNT(*) as count FROM member_profiles
      WHERE created_at >= ?
    `).get(weekAgo) as { count: number };

    // Total BGT (from current_eligibility)
    const totalBgt = db.prepare(`
      SELECT SUM(bgt) as total FROM current_eligibility
      WHERE address IN (
        SELECT wallet_address FROM wallet_mappings
        WHERE discord_id IN (SELECT discord_id FROM member_profiles)
      )
    `).get() as { total: number };

    // Tier distribution
    const tierDistribution = tierService.getTierDistribution();

    // Most active tier (by message count)
    const mostActiveTier = db.prepare(`
      SELECT mp.tier, SUM(ma.weekly_messages) as messages
      FROM member_profiles mp
      JOIN member_activity ma ON ma.member_id = mp.id
      GROUP BY mp.tier
      ORDER BY messages DESC
      LIMIT 1
    `).get() as { tier: string; messages: number } | undefined;

    // Tier promotions this week
    const promotions = db.prepare(`
      SELECT COUNT(*) as count FROM tier_history
      WHERE changed_at >= ?
    `).get(weekAgo) as { count: number };

    // Notable promotions (to Usul or higher)
    const notablePromotions = db.prepare(`
      SELECT mp.nym, th.to_tier
      FROM tier_history th
      JOIN member_profiles mp ON mp.id = th.member_id
      WHERE th.changed_at >= ?
        AND th.to_tier IN ('usul', 'fedaykin', 'naib')
      ORDER BY th.changed_at DESC
      LIMIT 3
    `).all(weekAgo) as { nym: string; to_tier: string }[];

    // Badges awarded this week
    const badgesAwarded = db.prepare(`
      SELECT COUNT(*) as count FROM member_badges
      WHERE awarded_at >= ?
    `).get(weekAgo) as { count: number };

    // Top new member (highest BGT)
    const topNewMember = db.prepare(`
      SELECT mp.nym, mp.tier
      FROM member_profiles mp
      JOIN wallet_mappings wm ON wm.discord_id = mp.discord_id
      JOIN current_eligibility ce ON ce.address = wm.wallet_address
      WHERE mp.created_at >= ?
      ORDER BY ce.bgt DESC
      LIMIT 1
    `).get(weekAgo) as { nym: string; tier: string } | undefined;

    return {
      week_start: new Date(weekAgo),
      total_members: totalMembers.count,
      new_members: newMembers.count,
      total_bgt: Math.floor(totalBgt.total || 0),
      tier_distribution: tierDistribution,
      most_active_tier: mostActiveTier?.tier || 'unknown',
      promotions: promotions.count,
      badges_awarded: badgesAwarded.count,
      top_new_member: topNewMember,
      notable_promotions: notablePromotions.map(p => ({
        nym: p.nym,
        new_tier: p.to_tier,
      })),
    };
  }

  /**
   * Format stats into Discord message
   */
  formatDigest(stats: WeeklyStats): string {
    const weekEnd = new Date();
    const dateRange = `${stats.week_start.toLocaleDateString()} - ${weekEnd.toLocaleDateString()}`;

    let message = `📜 **Weekly Pulse of the Sietch**\n\n`;
    message += `**Week of ${dateRange}**\n\n`;

    // Community Stats
    message += `📊 **Community Stats:**\n`;
    message += `• Total Members: ${stats.total_members} (+${stats.new_members})\n`;
    message += `• BGT Represented: ${stats.total_bgt.toLocaleString()} BGT\n`;
    message += `• Most Active Tier: ${this.formatTierName(stats.most_active_tier)}\n\n`;

    // New Members
    message += `🎖️ **New Members:**\n`;
    message += `• ${stats.new_members} joined this week\n`;
    if (stats.top_new_member) {
      message += `• Notable: ${stats.top_new_member.nym} entered as ${this.formatTierName(stats.top_new_member.tier)}\n`;
    }
    message += `\n`;

    // Tier Promotions
    message += `⬆️ **Tier Promotions:**\n`;
    message += `• ${stats.promotions} members rose to higher tiers\n`;
    for (const promo of stats.notable_promotions) {
      message += `• ${promo.nym} reached ${this.formatTierName(promo.new_tier)}!\n`;
    }
    message += `\n`;

    // Badges
    message += `🏅 **Badges Awarded:**\n`;
    message += `• ${stats.badges_awarded} badges given this week\n\n`;

    message += `*The spice flows...*`;

    return message;
  }

  /**
   * Format tier name for display
   */
  private formatTierName(tier: string): string {
    const names: Record<string, string> = {
      hajra: 'Hajra',
      ichwan: 'Ichwan',
      qanat: 'Qanat',
      sihaya: 'Sihaya',
      mushtamal: 'Mushtamal',
      sayyadina: 'Sayyadina',
      usul: 'Usul',
      fedaykin: 'Fedaykin',
      naib: 'Naib',
    };
    return names[tier] || tier;
  }

  /**
   * Post digest to announcements channel
   */
  async postDigest(): Promise<boolean> {
    try {
      const stats = this.collectWeeklyStats();
      const message = this.formatDigest(stats);

      // Post to announcements
      const channelId = process.env.DISCORD_ANNOUNCEMENTS_CHANNEL_ID;
      if (!channelId) {
        logger.error('DISCORD_ANNOUNCEMENTS_CHANNEL_ID not configured');
        return false;
      }

      const sentMessage = await discordService.sendMessage(channelId, message);

      // Store digest record
      const digest: WeeklyDigest = {
        id: crypto.randomUUID(),
        week_start: stats.week_start.toISOString().split('T')[0],
        stats_json: JSON.stringify(stats),
        posted_at: Date.now(),
        message_id: sentMessage?.id || null,
      };

      db.prepare(`
        INSERT INTO weekly_digests (id, week_start, stats_json, posted_at, message_id)
        VALUES (?, ?, ?, ?, ?)
      `).run(digest.id, digest.week_start, digest.stats_json, digest.posted_at, digest.message_id);

      logger.info({ digestId: digest.id }, 'Weekly digest posted');
      return true;
    } catch (error) {
      logger.error({ error }, 'Failed to post weekly digest');
      return false;
    }
  }
}

export const digestService = new DigestService();
```

### 4.4 StoryService

**File**: `src/services/StoryService.ts`

**Responsibility**: Manage and post story fragments for elite member joins.

```typescript
// src/services/StoryService.ts

import { db } from '../db';
import { logger } from '../utils/logger';
import { discordService } from './DiscordService';
import type { StoryFragment, Tier } from '../types';

export class StoryService {
  private readonly CATEGORIES = {
    fedaykin_join: 'fedaykin_join',
    naib_join: 'naib_join',
  } as const;

  /**
   * Get random fragment for category, preferring least-used
   */
  getFragment(category: keyof typeof this.CATEGORIES): StoryFragment | null {
    // Get least-used fragments for this category
    const fragment = db.prepare(`
      SELECT * FROM story_fragments
      WHERE category = ?
      ORDER BY used_count ASC, RANDOM()
      LIMIT 1
    `).get(category) as StoryFragment | null;

    if (fragment) {
      // Increment usage
      db.prepare(`
        UPDATE story_fragments SET used_count = used_count + 1 WHERE id = ?
      `).run(fragment.id);
    }

    return fragment;
  }

  /**
   * Post story fragment for new elite member
   */
  async postJoinFragment(tier: Tier): Promise<boolean> {
    // Only for Fedaykin and Naib
    if (tier !== 'fedaykin' && tier !== 'naib') {
      return false;
    }

    const category = tier === 'naib' ? 'naib_join' : 'fedaykin_join';
    const fragment = this.getFragment(category);

    if (!fragment) {
      logger.warn({ category }, 'No story fragments available');
      return false;
    }

    const channelId = process.env.DISCORD_THE_DOOR_CHANNEL_ID;
    if (!channelId) {
      logger.error('DISCORD_THE_DOOR_CHANNEL_ID not configured');
      return false;
    }

    // Format with decorative borders
    const message = `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n${fragment.content}\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;

    try {
      await discordService.sendMessage(channelId, message);
      logger.info({ category, fragmentId: fragment.id }, 'Story fragment posted');
      return true;
    } catch (error) {
      logger.error({ error, category }, 'Failed to post story fragment');
      return false;
    }
  }

  /**
   * Seed default fragments
   */
  seedDefaultFragments(): void {
    const fedaykinFragments = [
      `The desert wind carried whispers of a new arrival.\nOne who had held their water, never trading the sacred spice.\nThe sietch grows stronger.`,
      `Footsteps in the sand revealed a traveler from distant dunes.\nThey bore no marks of the water sellers.\nA new Fedaykin has earned their place.`,
      `The winds shifted across the Great Bled.\nA new figure emerged from the dancing sands,\ntheir stillsuit bearing the marks of deep desert travel.\n\nThe watermasters took note.\nAnother has proven their worth in the spice trade.\n\nA new Fedaykin walks among us.`,
    ];

    const naibFragments = [
      `The council chamber stirred.\nA presence of great weight approached -\none whose reserves of melange could shift the balance.\nA new voice joins the Naib.`,
      `The seven seats trembled as the sands revealed\na walker of extraordinary means.\nThe council must make room.\nA new Naib has arrived.`,
    ];

    // Insert if table is empty
    const count = db.prepare(`SELECT COUNT(*) as c FROM story_fragments`).get() as { c: number };
    if (count.c > 0) return;

    for (const content of fedaykinFragments) {
      db.prepare(`
        INSERT INTO story_fragments (id, category, content, used_count)
        VALUES (?, ?, ?, 0)
      `).run(crypto.randomUUID(), 'fedaykin_join', content);
    }
    for (const content of naibFragments) {
      db.prepare(`
        INSERT INTO story_fragments (id, category, content, used_count)
        VALUES (?, ?, ?, 0)
      `).run(crypto.randomUUID(), 'naib_join', content);
    }

    logger.info('Default story fragments seeded');
  }
}

export const storyService = new StoryService();
```

### 4.5 StatsService

**File**: `src/services/StatsService.ts`

**Responsibility**: Provide personal stats and analytics for members.

```typescript
// src/services/StatsService.ts

import { db } from '../db';
import { tierService } from './TierService';
import { badgeService } from './BadgeService';
import type { PersonalStats, CommunityStats, AdminAnalytics } from '../types';

export class StatsService {
  /**
   * Get personal stats for /stats command
   */
  getPersonalStats(memberId: string): PersonalStats | null {
    const member = db.prepare(`
      SELECT mp.*, ma.current_streak, ma.longest_streak, ma.weekly_messages
      FROM member_profiles mp
      LEFT JOIN member_activity ma ON ma.member_id = mp.id
      WHERE mp.id = ?
    `).get(memberId) as {
      id: string;
      nym: string;
      tier: string;
      created_at: number;
      current_streak: number;
      longest_streak: number;
      weekly_messages: number;
    } | undefined;

    if (!member) return null;

    // Get badges
    const badges = badgeService.getMemberBadges(memberId);

    // Get tier progress
    const tierProgress = tierService.getTierProgress(memberId);

    return {
      nym: member.nym,
      tier: member.tier,
      memberSince: new Date(member.created_at),
      activity: {
        messagesThisWeek: member.weekly_messages || 0,
        currentStreak: member.current_streak || 0,
        longestStreak: member.longest_streak || 0,
      },
      badges: badges.map(b => b.badge_id),
      badgeCount: badges.length,
      tierProgress: tierProgress ? {
        current: tierProgress.currentTier,
        currentBgt: tierProgress.currentBgt,
        next: tierProgress.nextTier,
        threshold: tierProgress.nextThreshold,
        distance: tierProgress.distance,
        percentage: tierProgress.percentage,
      } : null,
    };
  }

  /**
   * Get public community stats
   */
  getCommunityStats(): CommunityStats {
    const totalMembers = db.prepare(`
      SELECT COUNT(*) as count FROM member_profiles
    `).get() as { count: number };

    const totalBgt = db.prepare(`
      SELECT SUM(bgt) as total FROM current_eligibility
      WHERE address IN (
        SELECT wallet_address FROM wallet_mappings
        WHERE discord_id IN (SELECT discord_id FROM member_profiles)
      )
    `).get() as { total: number };

    const tierDistribution = tierService.getTierDistribution();

    return {
      totalMembers: totalMembers.count,
      totalBgt: Math.floor(totalBgt.total || 0),
      tierDistribution,
    };
  }

  /**
   * Get admin analytics dashboard
   */
  getAdminAnalytics(): AdminAnalytics {
    const now = Date.now();
    const weekAgo = now - 7 * 24 * 60 * 60 * 1000;

    const totalMembers = db.prepare(`
      SELECT COUNT(*) as count FROM member_profiles
    `).get() as { count: number };

    const tierDistribution = tierService.getTierDistribution();

    const totalBgt = db.prepare(`
      SELECT SUM(bgt) as total FROM current_eligibility
      WHERE address IN (
        SELECT wallet_address FROM wallet_mappings
        WHERE discord_id IN (SELECT discord_id FROM member_profiles)
      )
    `).get() as { total: number };

    const weeklyActive = db.prepare(`
      SELECT COUNT(*) as count FROM member_activity
      WHERE last_active >= ?
    `).get(weekAgo) as { count: number };

    const newThisWeek = db.prepare(`
      SELECT COUNT(*) as count FROM member_profiles
      WHERE created_at >= ?
    `).get(weekAgo) as { count: number };

    const promotionsThisWeek = db.prepare(`
      SELECT COUNT(*) as count FROM tier_history
      WHERE changed_at >= ?
    `).get(weekAgo) as { count: number };

    return {
      total_members: totalMembers.count,
      by_tier: tierDistribution,
      total_bgt: Math.floor(totalBgt.total || 0),
      weekly_active: weeklyActive.count,
      new_this_week: newThisWeek.count,
      promotions_this_week: promotionsThisWeek.count,
    };
  }

  /**
   * Get tier leaderboard (closest to promotion)
   */
  getTierLeaderboard(limit = 10): Array<{
    nym: string;
    tier: string;
    currentBgt: number;
    nextTier: string;
    nextThreshold: number;
    distance: number;
  }> {
    // Get members with BGT-based tiers (not Fedaykin/Naib)
    const members = db.prepare(`
      SELECT mp.id, mp.nym, mp.tier, ce.bgt
      FROM member_profiles mp
      JOIN wallet_mappings wm ON wm.discord_id = mp.discord_id
      JOIN current_eligibility ce ON ce.address = wm.wallet_address
      WHERE mp.tier NOT IN ('fedaykin', 'naib')
      ORDER BY ce.bgt DESC
    `).all() as { id: string; nym: string; tier: string; bgt: number }[];

    const leaderboard = [];

    for (const member of members) {
      const progress = tierService.getTierProgress(member.id);
      if (progress?.nextTier && progress.nextThreshold && progress.distance !== null) {
        leaderboard.push({
          nym: member.nym,
          tier: member.tier,
          currentBgt: Math.floor(member.bgt),
          nextTier: progress.nextTier,
          nextThreshold: progress.nextThreshold,
          distance: progress.distance,
        });
      }
    }

    // Sort by distance (ascending - closest first)
    leaderboard.sort((a, b) => a.distance - b.distance);

    return leaderboard.slice(0, limit);
  }
}

export const statsService = new StatsService();
```

### 4.6 NaibService (Retained from v2.1)

**File**: `src/services/NaibService.ts`

**Responsibility**: Manage Naib seat assignment, bumping logic, and seat history.

```typescript
// src/services/NaibService.ts

import { db } from '../db';
import { logger } from '../utils/logger';
import type { NaibSeat, NaibMember } from '../types';

export class NaibService {
  private readonly NAIB_SEAT_COUNT = 7;

  /**
   * Get current Naib members
   */
  getCurrentNaib(): NaibMember[] {
    return db.prepare(`
      SELECT ns.*, mp.nym, mp.discord_id, ce.bgt
      FROM naib_seats ns
      JOIN member_profiles mp ON mp.id = ns.member_id
      JOIN wallet_mappings wm ON wm.discord_id = mp.discord_id
      JOIN current_eligibility ce ON ce.address = wm.wallet_address
      WHERE ns.unseated_at IS NULL
      ORDER BY ce.bgt DESC
    `).all() as NaibMember[];
  }

  /**
   * Get Former Naib members
   */
  getFormerNaib(): NaibMember[] {
    return db.prepare(`
      SELECT DISTINCT mp.id, mp.nym, mp.discord_id
      FROM naib_seats ns
      JOIN member_profiles mp ON mp.id = ns.member_id
      WHERE ns.unseated_at IS NOT NULL
        AND mp.id NOT IN (
          SELECT member_id FROM naib_seats WHERE unseated_at IS NULL
        )
    `).all() as NaibMember[];
  }

  /**
   * Get lowest Naib member by BGT (for bump evaluation)
   */
  getLowestNaibMember(): NaibMember | null {
    return db.prepare(`
      SELECT ns.*, mp.nym, mp.discord_id, ce.bgt, mp.created_at as tenure_start
      FROM naib_seats ns
      JOIN member_profiles mp ON mp.id = ns.member_id
      JOIN wallet_mappings wm ON wm.discord_id = mp.discord_id
      JOIN current_eligibility ce ON ce.address = wm.wallet_address
      WHERE ns.unseated_at IS NULL
      ORDER BY ce.bgt ASC, mp.created_at DESC
      LIMIT 1
    `).get() as NaibMember | null;
  }

  /**
   * Seat a member in the Naib
   */
  seatMember(memberId: string, seatNumber: number): void {
    const id = crypto.randomUUID();
    const now = Date.now();

    db.prepare(`
      INSERT INTO naib_seats (id, member_id, seat_number, seated_at)
      VALUES (?, ?, ?, ?)
    `).run(id, memberId, seatNumber, now);

    logger.info({ memberId, seatNumber }, 'Member seated in Naib');
  }

  /**
   * Bump lowest Naib member when higher BGT member arrives
   */
  bumpMember(bumpedMemberId: string, bumpedByMemberId: string): void {
    const now = Date.now();

    // Unseat the bumped member
    db.prepare(`
      UPDATE naib_seats
      SET unseated_at = ?, unseated_by = ?, unseated_reason = 'bumped'
      WHERE member_id = ? AND unseated_at IS NULL
    `).run(now, bumpedByMemberId, bumpedMemberId);

    // Get the freed seat number
    const freedSeat = db.prepare(`
      SELECT seat_number FROM naib_seats
      WHERE member_id = ? AND unseated_at = ?
    `).get(bumpedMemberId, now) as { seat_number: number };

    // Seat the new member
    this.seatMember(bumpedByMemberId, freedSeat.seat_number);

    // Mark bumped member as Former Naib
    db.prepare(`
      UPDATE member_profiles SET is_former_naib = 1 WHERE id = ?
    `).run(bumpedMemberId);

    logger.info({ bumpedMemberId, bumpedByMemberId }, 'Naib member bumped');
  }

  /**
   * Evaluate and process Naib seat changes during sync
   */
  evaluateNaibSeats(eligibilityList: Array<{ memberId: string; bgt: number; rank: number }>): {
    seated: string[];
    bumped: Array<{ member: string; by: string }>;
  } {
    const result = { seated: [] as string[], bumped: [] as Array<{ member: string; by: string }> };
    const currentNaib = this.getCurrentNaib();

    // If Naib not full, seat top members
    if (currentNaib.length < this.NAIB_SEAT_COUNT) {
      const topMembers = eligibilityList
        .filter(e => e.rank <= this.NAIB_SEAT_COUNT)
        .filter(e => !currentNaib.some(n => n.member_id === e.memberId));

      for (const member of topMembers) {
        const nextSeat = currentNaib.length + result.seated.length + 1;
        if (nextSeat <= this.NAIB_SEAT_COUNT) {
          this.seatMember(member.memberId, nextSeat);
          result.seated.push(member.memberId);
        }
      }
    }

    // Check for bumping (new member with higher BGT than lowest Naib)
    const lowest = this.getLowestNaibMember();
    if (lowest) {
      const challengers = eligibilityList
        .filter(e => e.bgt > lowest.bgt)
        .filter(e => !currentNaib.some(n => n.member_id === e.memberId))
        .sort((a, b) => b.bgt - a.bgt);

      if (challengers.length > 0) {
        this.bumpMember(lowest.member_id, challengers[0].memberId);
        result.bumped.push({ member: lowest.member_id, by: challengers[0].memberId });
      }
    }

    return result;
  }

  /**
   * Check if member is current Naib
   */
  isNaibMember(memberId: string): boolean {
    const result = db.prepare(`
      SELECT 1 FROM naib_seats WHERE member_id = ? AND unseated_at IS NULL
    `).get(memberId);
    return !!result;
  }

  /**
   * Check if member is Former Naib
   */
  isFormerNaib(memberId: string): boolean {
    const result = db.prepare(`
      SELECT is_former_naib FROM member_profiles WHERE id = ?
    `).get(memberId) as { is_former_naib: number } | undefined;
    return result?.is_former_naib === 1;
  }
}

export const naibService = new NaibService();
```

### 4.7 NotificationService Extensions (Retained from v2.1)

**File**: `src/services/NotificationService.ts`

**Responsibility**: Send position alerts, at-risk warnings, Naib threats, and manage notification preferences.

```typescript
// src/services/NotificationService.ts (extensions for v2.1 features)

import { db } from '../db';
import { logger } from '../utils/logger';
import { discordService } from './DiscordService';
import type { NotificationPreferences, AlertType } from '../types';

export class NotificationService {
  /**
   * Get member notification preferences
   */
  getPreferences(memberId: string): NotificationPreferences {
    const prefs = db.prepare(`
      SELECT * FROM notification_preferences WHERE member_id = ?
    `).get(memberId) as NotificationPreferences | undefined;

    // Return defaults if no preferences set
    return prefs || {
      member_id: memberId,
      position_updates_enabled: 1,
      position_update_frequency: '3_per_week',
      at_risk_warnings_enabled: 1,
      naib_alerts_enabled: 1,
      last_position_alert_at: null,
      alerts_sent_this_week: 0,
      week_start_timestamp: null,
      created_at: Date.now(),
      updated_at: Date.now(),
    };
  }

  /**
   * Update notification preferences
   */
  updatePreferences(memberId: string, updates: Partial<NotificationPreferences>): void {
    const now = Date.now();
    const existing = this.getPreferences(memberId);

    if (existing.created_at === now) {
      // New record - insert
      db.prepare(`
        INSERT INTO notification_preferences
        (member_id, position_updates_enabled, position_update_frequency,
         at_risk_warnings_enabled, naib_alerts_enabled, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        memberId,
        updates.position_updates_enabled ?? 1,
        updates.position_update_frequency ?? '3_per_week',
        updates.at_risk_warnings_enabled ?? 1,
        updates.naib_alerts_enabled ?? 1,
        now, now
      );
    } else {
      // Update existing
      const fields = [];
      const values = [];

      if (updates.position_updates_enabled !== undefined) {
        fields.push('position_updates_enabled = ?');
        values.push(updates.position_updates_enabled);
      }
      if (updates.position_update_frequency !== undefined) {
        fields.push('position_update_frequency = ?');
        values.push(updates.position_update_frequency);
      }
      if (updates.at_risk_warnings_enabled !== undefined) {
        fields.push('at_risk_warnings_enabled = ?');
        values.push(updates.at_risk_warnings_enabled);
      }
      if (updates.naib_alerts_enabled !== undefined) {
        fields.push('naib_alerts_enabled = ?');
        values.push(updates.naib_alerts_enabled);
      }

      fields.push('updated_at = ?');
      values.push(now);
      values.push(memberId);

      db.prepare(`
        UPDATE notification_preferences
        SET ${fields.join(', ')}
        WHERE member_id = ?
      `).run(...values);
    }
  }

  /**
   * Send at-risk warning to member
   */
  async sendAtRiskWarning(
    discordId: string,
    distanceTo70: number,
    distanceTo71: number
  ): Promise<boolean> {
    const message = `⚠️ **Position Alert**

You are currently in the bottom 10% of Fedaykin members.

Your standing:
• Position #70 (first outside): ${distanceTo70} BGT behind you
• Position #71: ${distanceTo71} BGT behind you

If a wallet with more BGT than yours becomes eligible,
you may lose your Fedaykin status.

This is a private alert - your position is never shown publicly.
━━━━━━━━━━━━━━━━━━━━━━━
[Understood] [Turn Off At-Risk Alerts]`;

    try {
      await discordService.sendDM(discordId, message);
      this.recordAlert(null, discordId, 'at_risk_warning', 'At-risk warning sent');
      return true;
    } catch (error) {
      logger.error({ error, discordId }, 'Failed to send at-risk warning');
      return false;
    }
  }

  /**
   * Send Naib threat alert
   */
  async sendNaibThreat(discordId: string, lowestNaibBgt: number): Promise<boolean> {
    const message = `🏛️ **Naib Alert**

A new member has joined with significant BGT holdings.

As a Naib member, your seat is determined by BGT holdings
among the first 7 members (with tenure as tie-breaker).

Current lowest Naib BGT: ${lowestNaibBgt.toLocaleString()}

If your holdings are lowest, your seat may be at risk.
━━━━━━━━━━━━━━━━━━━━━━━
[View Naib Status] [Dismiss]`;

    try {
      await discordService.sendDM(discordId, message);
      this.recordAlert(null, discordId, 'naib_threat', 'Naib threat alert sent');
      return true;
    } catch (error) {
      logger.error({ error, discordId }, 'Failed to send Naib threat');
      return false;
    }
  }

  /**
   * Send position update alert
   */
  async sendPositionUpdate(
    discordId: string,
    distanceUp: number,
    distanceDown: number
  ): Promise<boolean> {
    const statusMessage = distanceDown > 500
      ? 'Your position is secure for now.'
      : distanceDown < 100
        ? '⚠️ Watch your position closely.'
        : 'Stay vigilant, Fedaykin.';

    const message = `📊 **Position Update**

Your current standing:
• You are ${distanceUp} BGT away from the position above you
• The position below you is ${distanceDown} BGT away from yours

${statusMessage}
━━━━━━━━━━━━━━━━━━━━━━━
[Manage Alerts] [Disable]`;

    try {
      await discordService.sendDM(discordId, message);
      this.recordAlert(null, discordId, 'position_update', 'Position update sent');
      return true;
    } catch (error) {
      logger.error({ error, discordId }, 'Failed to send position update');
      return false;
    }
  }

  /**
   * Check if member can receive alert (rate limiting)
   */
  canSendAlert(memberId: string, alertType: AlertType): boolean {
    const prefs = this.getPreferences(memberId);
    const now = Date.now();
    const weekStart = this.getWeekStart(now);

    // Reset weekly counter if new week
    if (!prefs.week_start_timestamp || prefs.week_start_timestamp < weekStart) {
      db.prepare(`
        UPDATE notification_preferences
        SET alerts_sent_this_week = 0, week_start_timestamp = ?
        WHERE member_id = ?
      `).run(weekStart, memberId);
      prefs.alerts_sent_this_week = 0;
    }

    // Check specific alert type enabled
    if (alertType === 'position_update' && !prefs.position_updates_enabled) return false;
    if (alertType === 'at_risk_warning' && !prefs.at_risk_warnings_enabled) return false;
    if (alertType === 'naib_threat' && !prefs.naib_alerts_enabled) return false;

    // Check frequency limit for position updates
    if (alertType === 'position_update') {
      const maxAlerts: Record<string, number> = {
        '1_per_week': 1,
        '2_per_week': 2,
        '3_per_week': 3,
        'daily': 7,
      };
      const limit = maxAlerts[prefs.position_update_frequency] || 3;
      return prefs.alerts_sent_this_week < limit;
    }

    return true;
  }

  /**
   * Record alert in history
   */
  private recordAlert(
    memberId: string | null,
    discordId: string,
    alertType: AlertType,
    summary: string
  ): void {
    db.prepare(`
      INSERT INTO alert_history (id, member_id, discord_user_id, alert_type, content_summary, sent_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(crypto.randomUUID(), memberId, discordId, alertType, summary, Date.now());
  }

  /**
   * Get start of current week (Monday 00:00 UTC)
   */
  private getWeekStart(timestamp: number): number {
    const date = new Date(timestamp);
    const day = date.getUTCDay();
    const diff = date.getUTCDate() - day + (day === 0 ? -6 : 1);
    date.setUTCDate(diff);
    date.setUTCHours(0, 0, 0, 0);
    return date.getTime();
  }
}

export const notificationService = new NotificationService();
```

### 4.8 ThresholdService (Retained from v2.1)

**File**: `src/services/ThresholdService.ts`

**Responsibility**: Calculate Fedaykin entry threshold and position distances.

```typescript
// src/services/ThresholdService.ts

import { db } from '../db';
import type { ThresholdData } from '../types';

export class ThresholdService {
  /**
   * Get current Fedaykin entry threshold (position 69's BGT)
   */
  getCurrentThreshold(): ThresholdData {
    // Get position 69's BGT (the threshold)
    const position69 = db.prepare(`
      SELECT ce.bgt
      FROM current_eligibility ce
      WHERE ce.rank = 69
    `).get() as { bgt: number } | undefined;

    // Get positions 70-100 (next in line)
    const waitlist = db.prepare(`
      SELECT ce.rank, ce.bgt, ce.address
      FROM current_eligibility ce
      WHERE ce.rank BETWEEN 70 AND 100
      ORDER BY ce.rank ASC
    `).all() as { rank: number; bgt: number; address: string }[];

    const threshold = position69?.bgt || 0;

    return {
      threshold,
      position_69_bgt: threshold,
      waitlist: waitlist.map(w => ({
        rank: w.rank,
        bgt: w.bgt,
        distance: threshold - w.bgt,
      })),
    };
  }

  /**
   * Get member's position relative to above/below
   */
  getPositionDistances(memberId: string): {
    distanceUp: number;
    distanceDown: number;
    position: number;
  } | null {
    const member = db.prepare(`
      SELECT ce.rank, ce.bgt
      FROM member_profiles mp
      JOIN wallet_mappings wm ON wm.discord_id = mp.discord_id
      JOIN current_eligibility ce ON ce.address = wm.wallet_address
      WHERE mp.id = ?
    `).get(memberId) as { rank: number; bgt: number } | undefined;

    if (!member || !member.rank) return null;

    // Get position above
    const above = db.prepare(`
      SELECT bgt FROM current_eligibility WHERE rank = ?
    `).get(member.rank - 1) as { bgt: number } | undefined;

    // Get position below
    const below = db.prepare(`
      SELECT bgt FROM current_eligibility WHERE rank = ?
    `).get(member.rank + 1) as { bgt: number } | undefined;

    return {
      position: member.rank,
      distanceUp: above ? above.bgt - member.bgt : 0,
      distanceDown: below ? member.bgt - below.bgt : 0,
    };
  }

  /**
   * Get at-risk members (bottom ~10% of Fedaykin)
   */
  getAtRiskMembers(percentage: number = 10): string[] {
    const fedaykinCount = db.prepare(`
      SELECT COUNT(*) as count FROM member_profiles WHERE tier = 'fedaykin'
    `).get() as { count: number };

    const atRiskCount = Math.ceil(fedaykinCount.count * (percentage / 100));

    // Get bottom N Fedaykin by rank (highest rank numbers = lowest position)
    const atRisk = db.prepare(`
      SELECT mp.id
      FROM member_profiles mp
      JOIN wallet_mappings wm ON wm.discord_id = mp.discord_id
      JOIN current_eligibility ce ON ce.address = wm.wallet_address
      WHERE mp.tier = 'fedaykin'
      ORDER BY ce.rank DESC
      LIMIT ?
    `).all(atRiskCount) as { id: string }[];

    return atRisk.map(m => m.id);
  }
}

export const thresholdService = new ThresholdService();
```

---

## 5. Data Architecture

### 5.1 Database Schema Extensions

**Migration File**: `src/db/migrations/006_tier_system.sql`

```sql
-- Migration: 006_tier_system
-- Description: Add tier system, sponsor invites, story fragments, weekly digests

-- Add tier columns to member_profiles
ALTER TABLE member_profiles ADD COLUMN tier TEXT DEFAULT 'hajra';
ALTER TABLE member_profiles ADD COLUMN tier_updated_at INTEGER;

-- Create index for tier queries
CREATE INDEX IF NOT EXISTS idx_member_profiles_tier ON member_profiles(tier);

-- Tier history for analytics
CREATE TABLE IF NOT EXISTS tier_history (
    id TEXT PRIMARY KEY,
    member_id TEXT NOT NULL,
    from_tier TEXT,
    to_tier TEXT NOT NULL,
    bgt_at_change INTEGER NOT NULL,
    changed_at INTEGER NOT NULL,
    FOREIGN KEY (member_id) REFERENCES member_profiles(id)
);

CREATE INDEX IF NOT EXISTS idx_tier_history_member ON tier_history(member_id);
CREATE INDEX IF NOT EXISTS idx_tier_history_date ON tier_history(changed_at);

-- Sponsor invites
CREATE TABLE IF NOT EXISTS sponsor_invites (
    id TEXT PRIMARY KEY,
    sponsor_member_id TEXT NOT NULL,
    invited_discord_id TEXT NOT NULL,
    invited_member_id TEXT,
    tier_granted TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    accepted_at INTEGER,
    revoked_at INTEGER,
    FOREIGN KEY (sponsor_member_id) REFERENCES member_profiles(id),
    FOREIGN KEY (invited_member_id) REFERENCES member_profiles(id)
);

CREATE INDEX IF NOT EXISTS idx_invites_sponsor ON sponsor_invites(sponsor_member_id);
CREATE INDEX IF NOT EXISTS idx_invites_discord ON sponsor_invites(invited_discord_id);
CREATE INDEX IF NOT EXISTS idx_invites_active ON sponsor_invites(sponsor_member_id)
    WHERE revoked_at IS NULL;

-- Story fragments
CREATE TABLE IF NOT EXISTS story_fragments (
    id TEXT PRIMARY KEY,
    category TEXT NOT NULL,
    content TEXT NOT NULL,
    used_count INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_story_category ON story_fragments(category);

-- Weekly digests
CREATE TABLE IF NOT EXISTS weekly_digests (
    id TEXT PRIMARY KEY,
    week_start DATE NOT NULL UNIQUE,
    stats_json TEXT NOT NULL,
    posted_at INTEGER,
    message_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_digest_date ON weekly_digests(week_start);

-- ============================================
-- RETAINED FROM v2.1: Naib & Alert System
-- ============================================

-- Naib seats (Top 7 competitive positions)
CREATE TABLE IF NOT EXISTS naib_seats (
    seat_number INTEGER PRIMARY KEY CHECK (seat_number BETWEEN 1 AND 7),
    member_id TEXT NOT NULL UNIQUE,
    seated_at INTEGER NOT NULL,
    bumped_from_seat INTEGER,
    bumped_by_member_id TEXT,
    FOREIGN KEY (member_id) REFERENCES member_profiles(id),
    FOREIGN KEY (bumped_by_member_id) REFERENCES member_profiles(id)
);

CREATE INDEX IF NOT EXISTS idx_naib_seats_member ON naib_seats(member_id);
CREATE INDEX IF NOT EXISTS idx_naib_seats_seated ON naib_seats(seated_at);

-- Notification preferences
CREATE TABLE IF NOT EXISTS notification_preferences (
    member_id TEXT PRIMARY KEY,
    position_alerts_enabled INTEGER DEFAULT 1,
    at_risk_alerts_enabled INTEGER DEFAULT 1,
    naib_threat_alerts_enabled INTEGER DEFAULT 1,
    frequency TEXT DEFAULT 'daily' CHECK (frequency IN ('1_per_week', '2_per_week', '3_per_week', 'daily')),
    quiet_hours_start INTEGER,
    quiet_hours_end INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (member_id) REFERENCES member_profiles(id)
);

-- Alert history for rate limiting
CREATE TABLE IF NOT EXISTS alert_history (
    id TEXT PRIMARY KEY,
    member_id TEXT NOT NULL,
    alert_type TEXT NOT NULL CHECK (alert_type IN ('position_update', 'at_risk', 'naib_threat', 'naib_bump')),
    sent_at INTEGER NOT NULL,
    context_json TEXT,
    FOREIGN KEY (member_id) REFERENCES member_profiles(id)
);

CREATE INDEX IF NOT EXISTS idx_alert_history_member ON alert_history(member_id);
CREATE INDEX IF NOT EXISTS idx_alert_history_type ON alert_history(member_id, alert_type);
CREATE INDEX IF NOT EXISTS idx_alert_history_sent ON alert_history(sent_at);
```

### 5.2 Entity Relationship Diagram

```
┌─────────────────────┐       ┌─────────────────────┐
│   member_profiles   │       │   tier_history      │
├─────────────────────┤       ├─────────────────────┤
│ id (PK)             │──┐    │ id (PK)             │
│ discord_id          │  │    │ member_id (FK)      │───┐
│ nym                 │  │    │ from_tier           │   │
│ bio                 │  │    │ to_tier             │   │
│ pfp_seed            │  │    │ bgt_at_change       │   │
│ tier (NEW)          │  │    │ changed_at          │   │
│ tier_updated_at(NEW)│  │    └─────────────────────┘   │
│ is_former_naib      │  │                              │
│ created_at          │  └──────────────────────────────┘
│ updated_at          │
└─────────────────────┘
         │
         │ 1:N
         ▼
┌─────────────────────┐
│   sponsor_invites   │
├─────────────────────┤
│ id (PK)             │
│ sponsor_member_id(FK)│──────┐
│ invited_discord_id  │      │
│ invited_member_id(FK)│     │
│ tier_granted        │      │
│ created_at          │      │
│ accepted_at         │      │
│ revoked_at          │      │
└─────────────────────┘      │
                             │
         ┌───────────────────┘
         │
         ▼
┌─────────────────────┐       ┌─────────────────────┐
│   story_fragments   │       │   weekly_digests    │
├─────────────────────┤       ├─────────────────────┤
│ id (PK)             │       │ id (PK)             │
│ category            │       │ week_start (UNIQUE) │
│ content             │       │ stats_json          │
│ used_count          │       │ posted_at           │
└─────────────────────┘       │ message_id          │
                              └─────────────────────┘

RETAINED FROM v2.1:

┌─────────────────────┐       ┌─────────────────────────┐
│   naib_seats        │       │ notification_preferences │
├─────────────────────┤       ├─────────────────────────┤
│ seat_number (PK)    │       │ member_id (PK, FK)      │
│ member_id (FK)      │───┐   │ position_alerts_enabled │
│ seated_at           │   │   │ at_risk_alerts_enabled  │
│ bumped_from_seat    │   │   │ naib_threat_alerts_en.  │
│ bumped_by_member_id │   │   │ frequency               │
└─────────────────────┘   │   │ quiet_hours_start       │
                          │   │ quiet_hours_end         │
                          │   │ created_at              │
                          │   │ updated_at              │
                          │   └─────────────────────────┘
                          │
                          │   ┌─────────────────────┐
                          │   │   alert_history     │
                          │   ├─────────────────────┤
                          └──▶│ id (PK)             │
                              │ member_id (FK)      │
                              │ alert_type          │
                              │ sent_at             │
                              │ context_json        │
                              └─────────────────────┘
```

### 5.3 Data Model Types

```typescript
// src/types/index.ts (extensions)

export type Tier =
  | 'hajra'
  | 'ichwan'
  | 'qanat'
  | 'sihaya'
  | 'mushtamal'
  | 'sayyadina'
  | 'usul'
  | 'fedaykin'
  | 'naib';

export interface TierHistoryEntry {
  id: string;
  member_id: string;
  from_tier: Tier | null;
  to_tier: Tier;
  bgt_at_change: number;
  changed_at: number;
}

export interface SponsorInvite {
  id: string;
  sponsor_member_id: string;
  invited_discord_id: string;
  invited_member_id: string | null;
  tier_granted: Tier;
  created_at: number;
  accepted_at: number | null;
  revoked_at: number | null;
}

export interface StoryFragment {
  id: string;
  category: string;
  content: string;
  used_count: number;
}

export interface WeeklyDigest {
  id: string;
  week_start: string;
  stats_json: string;
  posted_at: number | null;
  message_id: string | null;
}

export interface TierProgress {
  currentTier: Tier;
  currentBgt: number;
  nextTier: Tier | null;
  nextThreshold: number | null;
  distance: number | null;
  percentage: number | null;
  note?: string;
}

export interface PersonalStats {
  nym: string;
  tier: string;
  memberSince: Date;
  activity: {
    messagesThisWeek: number;
    currentStreak: number;
    longestStreak: number;
  };
  badges: string[];
  badgeCount: number;
  tierProgress: {
    current: Tier;
    currentBgt: number;
    next: Tier | null;
    threshold: number | null;
    distance: number | null;
    percentage: number | null;
  } | null;
}

export interface AdminAnalytics {
  total_members: number;
  by_tier: Record<Tier, number>;
  total_bgt: number;
  weekly_active: number;
  new_this_week: number;
  promotions_this_week: number;
}

// ============================================
// RETAINED FROM v2.1: Naib & Alert Types
// ============================================

export interface NaibMember {
  memberId: string;
  discordId: string;
  nym: string;
  seatNumber: number;
  bgt: number;
  seatedAt: number;
  tenure: number;  // Days in seat
}

export interface NaibSeat {
  seat_number: number;
  member_id: string;
  seated_at: number;
  bumped_from_seat: number | null;
  bumped_by_member_id: string | null;
}

export type AlertType = 'position_update' | 'at_risk' | 'naib_threat' | 'naib_bump';

export type AlertFrequency = '1_per_week' | '2_per_week' | '3_per_week' | 'daily';

export interface NotificationPreferences {
  member_id: string;
  position_alerts_enabled: boolean;
  at_risk_alerts_enabled: boolean;
  naib_threat_alerts_enabled: boolean;
  frequency: AlertFrequency;
  quiet_hours_start: number | null;
  quiet_hours_end: number | null;
  created_at: number;
  updated_at: number;
}

export interface AlertHistoryEntry {
  id: string;
  member_id: string;
  alert_type: AlertType;
  sent_at: number;
  context_json: string | null;
}

export interface ThresholdData {
  rank70Bgt: number;      // BGT of rank 70 (exit threshold)
  rank71Bgt: number;      // BGT of rank 71 (just below)
  lowestNaibBgt: number;  // BGT of rank 7 (Naib floor)
  timestamp: number;
}

export interface PositionDistances {
  position: number;
  distanceUp: number;     // BGT needed to move up 1
  distanceDown: number;   // BGT buffer before dropping 1
}
```

---

## 6. API Design

### 6.1 New API Endpoints

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/tiers` | None | Tier definitions |
| GET | `/api/stats/community` | None | Public stats |
| GET | `/api/leaderboard/tiers` | None | Tier progression |
| GET | `/api/me/stats` | Member | Personal stats |
| GET | `/api/me/tier-progress` | Member | Next tier distance |
| GET | `/api/me/tier-history` | Member | Tier change history |
| POST | `/api/invite` | Member | Create sponsor invite |
| GET | `/api/invite/status` | Member | Invite status |
| GET | `/api/invite/can-sponsor` | Member | Check badge |
| GET | `/admin/analytics` | Admin | Full analytics |
| DELETE | `/admin/invites/:id` | Admin | Revoke invite |

### 6.2 Retained API Endpoints (from v2.1)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/naib` | None | Current Naib roster |
| GET | `/api/naib/former` | None | Former Naib list |
| GET | `/api/threshold` | None | Current BGT thresholds |
| GET | `/api/position/:memberId` | Member | Position distances |
| GET | `/api/alerts/preferences` | Member | Alert preferences |
| PUT | `/api/alerts/preferences` | Member | Update preferences |
| GET | `/api/alerts/history` | Member | Alert history |
| POST | `/admin/naib/recalculate` | Admin | Force Naib recalc |

### 6.3 Rate Limiting

```typescript
const rateLimits = {
  // Public endpoints
  tiers: rateLimit({ windowMs: 60000, max: 100 }),
  communityStats: rateLimit({ windowMs: 60000, max: 50 }),
  tierLeaderboard: rateLimit({ windowMs: 60000, max: 30 }),

  // Member endpoints
  personalStats: rateLimit({ windowMs: 60000, max: 30 }),
  tierProgress: rateLimit({ windowMs: 60000, max: 30 }),
  sponsorInvite: rateLimit({ windowMs: 60000, max: 5 }),

  // Admin endpoints
  analytics: rateLimit({ windowMs: 60000, max: 30 }),
};
```

---

## 7. Discord Integration

### 7.1 New Slash Commands

| Command | Subcommand | Description | Visibility |
|---------|------------|-------------|------------|
| `/stats` | - | Personal activity summary | Ephemeral |
| `/invite` | `user @user` | Create sponsor invite | Ephemeral |
| `/invite` | `status` | Check invite status | Ephemeral |
| `/leaderboard` | `tiers` | Tier progression ranking | Public |
| `/admin` | `stats` | Community analytics | Ephemeral |

### 7.2 Retained Slash Commands (from v2.1)

| Command | Subcommand | Description | Visibility |
|---------|------------|-------------|------------|
| `/naib` | - | Current Naib roster | Public |
| `/naib` | `history` | Former Naib members | Public |
| `/threshold` | - | BGT entry thresholds | Public |
| `/position` | - | Your position & distances | Ephemeral |
| `/alerts` | `settings` | View alert preferences | Ephemeral |
| `/alerts` | `configure` | Update preferences | Ephemeral |
| `/alerts` | `history` | Recent alert history | Ephemeral |

### 7.3 Discord Role Hierarchy (v3.0)

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

### 7.4 Role Management Extensions

```typescript
// Add tier role constants
const TIER_ROLES: Record<Tier, string> = {
  hajra: process.env.DISCORD_ROLE_HAJRA!,
  ichwan: process.env.DISCORD_ROLE_ICHWAN!,
  qanat: process.env.DISCORD_ROLE_QANAT!,
  sihaya: process.env.DISCORD_ROLE_SIHAYA!,
  mushtamal: process.env.DISCORD_ROLE_MUSHTAMAL!,
  sayyadina: process.env.DISCORD_ROLE_SAYYADINA!,
  usul: process.env.DISCORD_ROLE_USUL!,
  fedaykin: process.env.DISCORD_ROLE_FEDAYKIN!,
  naib: process.env.DISCORD_ROLE_NAIB!,
};

/**
 * Sync tier role for member
 * Additive: member keeps all tier roles they've earned
 */
async syncTierRole(discordId: string, tier: Tier): Promise<void> {
  const guild = await this.getGuild();
  const member = await guild.members.fetch(discordId);

  const roleId = TIER_ROLES[tier];
  if (!roleId) {
    logger.warn({ tier }, 'No role ID configured for tier');
    return;
  }

  // Add new tier role
  if (!member.roles.cache.has(roleId)) {
    await member.roles.add(roleId);
    logger.info({ discordId, tier, roleId }, 'Added tier role');
  }

  // Remove higher tier roles if demoted (shouldn't happen but safety check)
  const tierIndex = TIER_ORDER.indexOf(tier);
  for (let i = tierIndex + 1; i < TIER_ORDER.length; i++) {
    const higherTier = TIER_ORDER[i];
    const higherRoleId = TIER_ROLES[higherTier];
    if (higherRoleId && member.roles.cache.has(higherRoleId)) {
      await member.roles.remove(higherRoleId);
      logger.info({ discordId, tier: higherTier }, 'Removed higher tier role');
    }
  }
}
```

---

## 8. Scheduled Tasks

### 8.1 Modified Sync Task

```typescript
// Add to existing sync-eligibility task

import { tierService } from '../services/TierService';
import { notificationService } from '../services/NotificationService';
import { storyService } from '../services/StoryService';

// After eligibility sync, update tiers
async function processTierUpdates(eligibilityData: EligibilityRecord[]) {
  const promotions: Array<{
    memberId: string;
    discordId: string;
    oldTier: Tier;
    newTier: Tier;
  }> = [];

  for (const record of eligibilityData) {
    const member = getMemberByWallet(record.address);
    if (!member) continue;

    const result = await tierService.updateMemberTier(
      member.id,
      record.bgt,
      record.rank
    );

    if (result.changed && tierService.isPromotion(result.oldTier, result.newTier)) {
      promotions.push({
        memberId: member.id,
        discordId: member.discord_id,
        oldTier: result.oldTier!,
        newTier: result.newTier,
      });

      // Update Discord role
      await roleManagerService.syncTierRole(member.discord_id, result.newTier);
    }
  }

  // Send promotion notifications
  for (const promo of promotions) {
    await notificationService.sendTierPromotion(
      promo.discordId,
      promo.newTier
    );

    // Post story fragment for elite promotions
    if (promo.newTier === 'fedaykin' || promo.newTier === 'naib') {
      await storyService.postJoinFragment(promo.newTier);
    }
  }

  logger.info({ promotions: promotions.length }, 'Tier sync complete');
}
```

### 8.2 Weekly Digest Task

```typescript
// src/trigger/weekly-digest.ts

import { schedules } from '@trigger.dev/sdk/v3';
import { digestService } from '../services/DigestService';
import { logger } from '../utils/logger';

export const weeklyDigestTask = schedules.task({
  id: 'weekly-digest',
  cron: '0 0 * * 1', // Monday 00:00 UTC
  run: async () => {
    logger.info('Starting weekly digest');

    try {
      const success = await digestService.postDigest();

      if (success) {
        logger.info('Weekly digest posted successfully');
        return { status: 'success' };
      } else {
        logger.error('Failed to post weekly digest');
        return { status: 'failed' };
      }
    } catch (error) {
      logger.error({ error }, 'Weekly digest task error');
      throw error;
    }
  },
});
```

### 8.3 Task Summary

| Task | Schedule | Function |
|------|----------|----------|
| `sync-eligibility` | Every 6 hours | BGT sync + tier updates + promotions |
| `weekly-digest` | Monday 00:00 UTC | Generate and post digest |
| `weekly-reset` | Monday 00:00 UTC | Reset weekly counters |
| `badge-check` | Every 2 hours | Auto-award badges |
| `activity-decay` | Hourly | Apply demurrage |

---

## 9. Security Architecture

### 9.1 Authorization Rules

| Action | Required |
|--------|----------|
| Create sponsor invite | Water Sharer badge |
| View own tier progress | Verified member |
| View tier leaderboard | None (public) |
| Revoke invite | Admin API key |
| View admin analytics | Admin API key |

### 9.2 Privacy Controls

**Tier Privacy**:
- Tier name is visible (not sensitive)
- Exact BGT amount never exposed
- Tier leaderboard shows rounded BGT (nearest integer)
- Rank position only shown for top 69

**Sponsor Privacy**:
- Invited Discord ID stored (needed for lookup)
- Sponsor relationship visible to both parties
- Not exposed in public APIs

### 9.3 Input Validation

```typescript
const createInviteSchema = z.object({
  discordId: z.string().regex(/^\d{17,19}$/),
});

const tierSchema = z.enum([
  'hajra', 'ichwan', 'qanat', 'sihaya',
  'mushtamal', 'sayyadina', 'usul',
  'fedaykin', 'naib'
]);
```

---

## 10. Deployment Architecture

### 10.1 Environment Variables (New)

```bash
# Discord Tier Roles (add to existing .env)
DISCORD_ROLE_HAJRA=
DISCORD_ROLE_ICHWAN=
DISCORD_ROLE_QANAT=
DISCORD_ROLE_SIHAYA=
DISCORD_ROLE_MUSHTAMAL=
DISCORD_ROLE_SAYYADINA=
DISCORD_ROLE_USUL=
# Note: FEDAYKIN and NAIB roles already exist

# Discord Channels (add)
DISCORD_ANNOUNCEMENTS_CHANNEL_ID=
DISCORD_THE_DOOR_CHANNEL_ID=
```

### 10.2 Migration Procedure

1. **Pre-deployment**:
   - Create Discord roles for new tiers
   - Configure Collab.Land for new tier thresholds
   - Set up Discord channel permissions

2. **Database Migration**:
   ```bash
   npm run migrate
   ```

3. **Seed Story Fragments**:
   ```bash
   npm run seed:stories
   ```

4. **Deploy Application**:
   - Push to main branch (triggers GitHub Actions)
   - Verify health check passes
   - Monitor logs for tier sync

5. **Post-deployment**:
   - Run initial tier assignment: `npm run task:sync`
   - Verify role assignments in Discord
   - Test sponsor invite flow

### 10.3 Rollback Plan

1. Revert to previous deployment
2. Tier columns remain (no data loss)
3. New tables ignored by old code
4. Discord roles can be manually cleaned

---

## 11. Testing Strategy

### 11.1 Unit Tests

```typescript
describe('TierService', () => {
  describe('calculateTier', () => {
    it('returns hajra for 6.9 BGT', () => {
      expect(tierService.calculateTier(6.9, null)).toBe('hajra');
    });

    it('returns ichwan for 69 BGT', () => {
      expect(tierService.calculateTier(69, null)).toBe('ichwan');
    });

    it('returns fedaykin for rank 50', () => {
      expect(tierService.calculateTier(1000, 50)).toBe('fedaykin');
    });

    it('returns naib for rank 5', () => {
      expect(tierService.calculateTier(500, 5)).toBe('naib');
    });

    it('rank takes precedence over BGT', () => {
      expect(tierService.calculateTier(10, 30)).toBe('fedaykin');
    });
  });

  describe('isPromotion', () => {
    it('returns true for tier increase', () => {
      expect(tierService.isPromotion('hajra', 'ichwan')).toBe(true);
    });

    it('returns false for same tier', () => {
      expect(tierService.isPromotion('ichwan', 'ichwan')).toBe(false);
    });
  });
});
```

### 11.2 Test Coverage Targets

| Component | Target |
|-----------|--------|
| TierService | 90% |
| SponsorService | 90% |
| DigestService | 80% |
| StatsService | 80% |
| API Routes | 85% |
| Discord Commands | 75% |

---

## 12. Technical Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| **Tier calculation drift** | Low | High | Single source of truth in sync task |
| **Role assignment race** | Medium | Medium | Queue role updates; idempotent ops |
| **Sponsor abuse** | Low | Medium | Admin-only badge; one invite limit |
| **Story fragment exhaustion** | Low | Low | Usage counting; admin can add more |
| **Digest posting failure** | Medium | Low | Retry logic; manual trigger available |
| **Migration data loss** | Low | Critical | Additive schema changes only |

---

## 13. Future Considerations

### 13.1 Potential v3.1 Features

- **Tier-specific badges**: Auto-award badges for reaching certain tiers
- **Sponsor leaderboard**: Track who has sponsored the most members
- **Digest customization**: Allow members to opt-in to DM digests
- **Story fragment voting**: Let Naib vote on favorite fragments

### 13.2 Scalability Path

| Scale | Recommendation |
|-------|----------------|
| 500 members | Current architecture sufficient |
| 1000 members | Add read replicas for analytics |
| 5000+ members | Migrate to PostgreSQL; add Redis cache |

---

## 14. Appendix

### 14.1 Tier Threshold Constants

```typescript
export const TIER_THRESHOLDS = {
  hajra: 6.9,
  ichwan: 69,
  qanat: 222,
  sihaya: 420,
  mushtamal: 690,
  sayyadina: 888,
  usul: 1111,
  fedaykin: null,  // Top 8-69
  naib: null,      // Top 7
} as const;
```

### 14.2 Discord Role Colors

| Role | Hex | Preview |
|------|-----|---------|
| Hajra | #C2B280 | Sand |
| Ichwan | #FD7E14 | Orange |
| Qanat | #17A2B8 | Cyan |
| Sihaya | #28A745 | Green |
| Mushtamal | #20C997 | Teal |
| Sayyadina | #6610F2 | Indigo |
| Usul | #9B59B6 | Purple |
| Fedaykin | #4169E1 | Blue |
| Naib | #FFD700 | Gold |

### 14.3 Weekly Digest Schedule

- **Collection**: Sunday 23:59 UTC (end of week)
- **Posting**: Monday 00:00 UTC (start of week)
- **Channel**: #announcements
- **Format**: Plain text with emoji headers

---

## 15. Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2025-12-17 | Initial MVP - eligibility, API, Discord notifications |
| 2.0 | 2025-12-18 | Social Layer - profiles, badges, directory, activity tracking |
| 2.1 | 2025-12-19 | Naib Dynamics & Threshold system |
| 3.0 | 2025-12-20 | The Great Expansion - 9-tier system, sponsors, digest |

---

*Document generated by Architecture Designer Agent*

# Software Design Document: Sietch v4.1

**Version**: 4.1
**Date**: December 27, 2025
**Status**: DRAFT
**Codename**: The Crossing

---

## Document Traceability

| Section | Source | Reference |
|---------|--------|-----------|
| Requirements | loa-grimoire/prd.md | PRD v4.1 |
| Existing Architecture | sdd-v4.0-completed.md | v4.0 SDD |
| Reference Architecture | ARCHITECTURE_SPEC_v2.9.0.md | Enterprise spec |
| grammy Patterns | grammy.dev documentation | Bot framework |

---

## 1. Executive Summary

### 1.1 Document Purpose

This Software Design Document (SDD) details the technical architecture for Sietch v4.1 "The Crossing". This release adds Telegram bot support with cross-platform identity bridging while preserving the stable v4.0 architecture.

### 1.2 Scope

This document covers:
- Telegram bot integration using grammy
- Cross-platform identity service design
- Database schema extensions for Telegram
- API endpoint specifications for Telegram
- Verification flow with Collab.Land
- Integration with existing v4.0 services

### 1.3 Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Bot Framework | grammy | Lightweight, TypeScript-native, active maintenance |
| Process Model | Same process | Simpler deployment, shared state, lower resource usage |
| Verification Flow | Deep link to web | Reuses existing Collab.Land flow, proven pattern |
| Identity Model | Wallet-centric | Platform IDs link to wallet, not to each other |
| Webhook Mode | Production only | Polling in dev for local testing |
| Cache Strategy | Shared Redis | Platform-agnostic cache keys, existing infrastructure |

### 1.4 Architecture Principles

1. **Preserve v4.0 Stability**: All v4.0 features continue working unchanged
2. **Platform Agnostic Services**: Services operate on member_id, not platform IDs
3. **Shared Infrastructure**: Single database, single Redis, single deployment
4. **Graceful Degradation**: Telegram failures don't affect Discord
5. **Minimal New Dependencies**: Only grammy added to dependencies

---

## 2. System Architecture

### 2.1 High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           SIETCH SERVICE v4.1                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌───────────────────────────────────────────────────────────────────────┐ │
│  │                     PLATFORM LAYER (v4.1 NEW)                         │ │
│  │                                                                       │ │
│  │  ┌─────────────────────────┐     ┌─────────────────────────┐         │ │
│  │  │      Discord Bot        │     │     Telegram Bot        │         │ │
│  │  │      (Discord.js)       │     │       (grammy)          │         │ │
│  │  │                         │     │                         │         │ │
│  │  │  • /check command       │     │  • /start command       │         │ │
│  │  │  • /register command    │     │  • /verify command      │         │ │
│  │  │  • Role management      │     │  • /score command       │         │ │
│  │  │  • Notifications        │     │  • /leaderboard cmd     │         │ │
│  │  │                         │     │  • /tier command        │         │ │
│  │  │                         │     │  • /status command      │         │ │
│  │  └────────────┬────────────┘     └────────────┬────────────┘         │ │
│  │               │                               │                       │ │
│  │               └───────────────┬───────────────┘                       │ │
│  │                               │                                       │ │
│  │                               ▼                                       │ │
│  │               ┌───────────────────────────────┐                       │ │
│  │               │     Identity Service (NEW)    │                       │ │
│  │               │                               │                       │ │
│  │               │  • Platform → Member lookup   │                       │ │
│  │               │  • Cross-platform linking     │                       │ │
│  │               │  • Verification sessions      │                       │ │
│  │               └───────────────┬───────────────┘                       │ │
│  │                               │                                       │ │
│  └───────────────────────────────┼───────────────────────────────────────┘ │
│                                  │                                         │
│  ┌───────────────────────────────┼───────────────────────────────────────┐ │
│  │                    PRESERVED SERVICES (v4.0)                          │ │
│  │                               │                                       │ │
│  │  ┌───────────────┐ ┌─────────┴─────────┐ ┌───────────────┐           │ │
│  │  │  Gatekeeper   │ │    Stats          │ │    Boost      │           │ │
│  │  │   Service     │ │    Service        │ │   Service     │           │ │
│  │  │               │ │                   │ │               │           │ │
│  │  │ • Tier lookup │ │ • Score query     │ │ • Level calc  │           │ │
│  │  │ • Feature     │ │ • Leaderboard     │ │ • Perks       │           │ │
│  │  │   gating      │ │ • Rankings        │ │               │           │ │
│  │  └───────────────┘ └───────────────────┘ └───────────────┘           │ │
│  │                                                                       │ │
│  │  ┌───────────────┐ ┌───────────────────┐ ┌───────────────┐           │ │
│  │  │    Stripe     │ │      Badge        │ │    Waiver     │           │ │
│  │  │   Service     │ │     Service       │ │   Service     │           │ │
│  │  └───────────────┘ └───────────────────┘ └───────────────┘           │ │
│  │                                                                       │ │
│  └───────────────────────────────────────────────────────────────────────┘ │
│                                                                             │
│  ┌───────────────────────────────────────────────────────────────────────┐ │
│  │                           DATA LAYER                                   │ │
│  │                                                                       │ │
│  │  ┌─────────────────────────────┐   ┌─────────────────────────────┐   │ │
│  │  │          SQLite             │   │       Upstash Redis         │   │ │
│  │  │                             │   │                             │   │ │
│  │  │ • member_profiles           │   │ • entitlement:{member_id}   │   │ │
│  │  │   + telegram_user_id (NEW)  │   │ • score:{member_id}         │   │ │
│  │  │ • telegram_verification_    │   │ • leaderboard:global        │   │ │
│  │  │   sessions (NEW)            │   │ • webhook:{event_id}        │   │ │
│  │  │ • All v4.0 tables           │   │                             │   │ │
│  │  └─────────────────────────────┘   └─────────────────────────────┘   │ │
│  │                                                                       │ │
│  └───────────────────────────────────────────────────────────────────────┘ │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 2.2 External Integrations

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          EXTERNAL SERVICES                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐   │
│  │  Telegram   │  │   Discord   │  │  Collab.Land │  │    Existing     │   │
│  │   Bot API   │  │     API     │  │  AccountKit  │  │   (Stripe,etc)  │   │
│  │             │  │             │  │              │  │                 │   │
│  │ • getMe     │  │ • Bot API   │  │ • Verify URL │  │ • Unchanged     │   │
│  │ • setWebhook│  │ • Roles     │  │ • Webhook    │  │                 │   │
│  │ • sendMsg   │  │ • Messages  │  │ • Sessions   │  │                 │   │
│  │ • Updates   │  │             │  │              │  │                 │   │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └────────┬────────┘   │
│         │                │                │                   │            │
│         └────────────────┴────────┬───────┴───────────────────┘            │
│                                   │                                        │
│                                   ▼                                        │
│                         ┌─────────────────────┐                            │
│                         │   Sietch Service    │                            │
│                         │       v4.1          │                            │
│                         └─────────────────────┘                            │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 2.3 Process Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           PM2 PROCESS: sietch                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                      Node.js Process (Single)                        │   │
│  │                                                                       │   │
│  │  ┌───────────────┐  ┌───────────────┐  ┌───────────────────────────┐ │   │
│  │  │  HTTP Server  │  │  Discord.js   │  │      grammy Bot           │ │   │
│  │  │    (Hono)     │  │     Client    │  │                           │ │   │
│  │  │               │  │               │  │  • Webhook handler        │ │   │
│  │  │ :3000         │  │  Gateway      │  │  • Command handlers       │ │   │
│  │  │               │  │  connection   │  │  • Error boundary         │ │   │
│  │  └───────────────┘  └───────────────┘  └───────────────────────────┘ │   │
│  │                                                                       │   │
│  │  Shared: Database connection, Redis client, Services                  │   │
│  │                                                                       │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  Memory Budget: ~512MB (Discord ~256MB + Telegram ~64MB + API ~192MB)      │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Component Design

### 3.1 Telegram Bot Component

#### 3.1.1 Bot Initialization

**File**: `src/telegram/bot.ts`

```typescript
import { Bot, webhookCallback, session } from 'grammy';
import { config } from '../config.js';

// Type definitions
interface SessionData {
  verificationAttempts: number;
  lastCommandAt: number;
}

// Bot instance
export const telegramBot = new Bot<Context>(config.TELEGRAM_BOT_TOKEN);

// Middleware stack
telegramBot.use(session({ initial: () => ({ verificationAttempts: 0, lastCommandAt: 0 }) }));
telegramBot.use(rateLimitMiddleware());
telegramBot.use(errorBoundary());

// Command registration
telegramBot.command('start', startHandler);
telegramBot.command('verify', verifyHandler);
telegramBot.command('score', scoreHandler);
telegramBot.command('leaderboard', leaderboardHandler);
telegramBot.command('tier', tierHandler);
telegramBot.command('status', statusHandler);
telegramBot.command('help', helpHandler);

// Webhook handler export
export const telegramWebhook = webhookCallback(telegramBot, 'hono');

// Start function (called from main entry)
export async function startTelegramBot(): Promise<void> {
  if (config.NODE_ENV === 'development') {
    // Polling mode for local development
    await telegramBot.start();
  } else {
    // Webhook mode set during server startup
    await telegramBot.api.setWebhook(config.TELEGRAM_WEBHOOK_URL);
  }
}
```

#### 3.1.2 Command Handlers

**Directory Structure**:
```
src/telegram/
├── bot.ts                    # Bot initialization
├── commands/
│   ├── index.ts              # Command exports
│   ├── start.ts              # Welcome message
│   ├── verify.ts             # Wallet verification
│   ├── score.ts              # Score display
│   ├── leaderboard.ts        # Rankings
│   ├── tier.ts               # Subscription tier
│   ├── status.ts             # Platform linking
│   └── help.ts               # Command reference
├── middleware/
│   ├── rateLimit.ts          # Rate limiting
│   ├── errorBoundary.ts      # Error handling
│   └── auth.ts               # Verification check
└── utils/
    ├── formatters.ts         # Message formatting
    └── keyboards.ts          # Inline keyboards
```

#### 3.1.3 Verify Command Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       VERIFICATION FLOW                                      │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  User                 Telegram Bot         Identity Service    Collab.Land  │
│   │                       │                      │                  │       │
│   │  /verify              │                      │                  │       │
│   │──────────────────────>│                      │                  │       │
│   │                       │                      │                  │       │
│   │                       │  createSession()     │                  │       │
│   │                       │─────────────────────>│                  │       │
│   │                       │                      │                  │       │
│   │                       │                      │  generateURL()   │       │
│   │                       │                      │─────────────────>│       │
│   │                       │                      │                  │       │
│   │                       │                      │<─────────────────│       │
│   │                       │                      │  verifyURL       │       │
│   │                       │<─────────────────────│                  │       │
│   │                       │  { sessionId, url }  │                  │       │
│   │                       │                      │                  │       │
│   │  Inline Button: 🔗    │                      │                  │       │
│   │  "Verify Wallet"      │                      │                  │       │
│   │<──────────────────────│                      │                  │       │
│   │                       │                      │                  │       │
│   │  [User clicks, verifies in browser]          │                  │       │
│   │                       │                      │                  │       │
│   │                       │                      │  webhook:        │       │
│   │                       │                      │  verification_   │       │
│   │                       │                      │  complete        │       │
│   │                       │                      │<─────────────────│       │
│   │                       │                      │                  │       │
│   │                       │  linkTelegram()      │                  │       │
│   │                       │<─────────────────────│                  │       │
│   │                       │                      │                  │       │
│   │  ✅ Wallet linked!    │                      │                  │       │
│   │  0x1234...5678        │                      │                  │       │
│   │<──────────────────────│                      │                  │       │
│   │                       │                      │                  │       │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 3.2 Identity Service Component

**File**: `src/services/IdentityService.ts`

```typescript
/**
 * IdentityService - Cross-platform identity management
 *
 * Handles wallet-centric identity model where:
 * - Wallet address is the canonical identifier
 * - Platform IDs (Discord, Telegram) link TO the wallet
 * - All services use member_id (derived from wallet)
 */

export interface PlatformLink {
  platform: 'discord' | 'telegram';
  platformUserId: string;
  linkedAt: Date;
}

export interface MemberIdentity {
  memberId: string;
  walletAddress: string;
  platforms: PlatformLink[];
}

export class IdentityService {
  constructor(
    private db: Database,
    private redis: RedisService
  ) {}

  /**
   * Look up member by any platform ID
   */
  async getMemberByPlatformId(
    platform: 'discord' | 'telegram',
    platformUserId: string
  ): Promise<MemberIdentity | null> {
    const cacheKey = `identity:${platform}:${platformUserId}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) return JSON.parse(cached);

    const column = platform === 'discord' ? 'discord_user_id' : 'telegram_user_id';
    const member = await this.db.get(
      `SELECT member_id, wallet_address, discord_user_id, telegram_user_id,
              discord_linked_at, telegram_linked_at
       FROM member_profiles
       WHERE ${column} = ?`,
      [platformUserId]
    );

    if (!member) return null;

    const identity = this.mapToIdentity(member);
    await this.redis.setex(cacheKey, 300, JSON.stringify(identity));
    return identity;
  }

  /**
   * Link Telegram account to existing member
   */
  async linkTelegram(
    memberId: string,
    telegramUserId: string
  ): Promise<void> {
    // Check for existing link
    const existing = await this.db.get(
      'SELECT member_id FROM member_profiles WHERE telegram_user_id = ?',
      [telegramUserId]
    );

    if (existing && existing.member_id !== memberId) {
      throw new Error('Telegram account already linked to another wallet');
    }

    await this.db.run(
      `UPDATE member_profiles
       SET telegram_user_id = ?, telegram_linked_at = ?
       WHERE member_id = ?`,
      [telegramUserId, Date.now(), memberId]
    );

    // Invalidate cache
    await this.redis.del(`identity:telegram:${telegramUserId}`);
  }

  /**
   * Create verification session for Telegram
   */
  async createVerificationSession(
    telegramUserId: string
  ): Promise<{ sessionId: string; verifyUrl: string }> {
    const sessionId = generateId();
    const expiresAt = Date.now() + 15 * 60 * 1000; // 15 minutes

    await this.db.run(
      `INSERT INTO telegram_verification_sessions
       (id, telegram_user_id, status, created_at, expires_at)
       VALUES (?, ?, 'pending', ?, ?)`,
      [sessionId, telegramUserId, Date.now(), expiresAt]
    );

    // Generate Collab.Land verify URL with session reference
    const verifyUrl = `${config.COLLABLAND_VERIFY_URL}?session=${sessionId}&platform=telegram`;

    return { sessionId, verifyUrl };
  }

  /**
   * Complete verification (called from webhook)
   */
  async completeVerification(
    sessionId: string,
    walletAddress: string
  ): Promise<{ telegramUserId: string; memberId: string }> {
    const session = await this.db.get(
      `SELECT telegram_user_id, status, expires_at
       FROM telegram_verification_sessions
       WHERE id = ?`,
      [sessionId]
    );

    if (!session) throw new Error('Session not found');
    if (session.status !== 'pending') throw new Error('Session already processed');
    if (session.expires_at < Date.now()) throw new Error('Session expired');

    // Find or create member
    let member = await this.db.get(
      'SELECT member_id FROM member_profiles WHERE wallet_address = ?',
      [walletAddress.toLowerCase()]
    );

    if (!member) {
      // Create new member profile
      const memberId = generateId();
      await this.db.run(
        `INSERT INTO member_profiles (member_id, wallet_address, created_at)
         VALUES (?, ?, ?)`,
        [memberId, walletAddress.toLowerCase(), Date.now()]
      );
      member = { member_id: memberId };
    }

    // Link Telegram
    await this.linkTelegram(member.member_id, session.telegram_user_id);

    // Mark session complete
    await this.db.run(
      `UPDATE telegram_verification_sessions
       SET status = 'completed', completed_at = ?
       WHERE id = ?`,
      [Date.now(), sessionId]
    );

    return {
      telegramUserId: session.telegram_user_id,
      memberId: member.member_id
    };
  }

  /**
   * Get platform status for a member
   */
  async getPlatformStatus(memberId: string): Promise<{
    wallet: string;
    discord: { linked: boolean; at?: Date };
    telegram: { linked: boolean; at?: Date };
  }> {
    const member = await this.db.get(
      `SELECT wallet_address, discord_user_id, telegram_user_id,
              discord_linked_at, telegram_linked_at
       FROM member_profiles WHERE member_id = ?`,
      [memberId]
    );

    if (!member) throw new Error('Member not found');

    return {
      wallet: member.wallet_address,
      discord: {
        linked: !!member.discord_user_id,
        at: member.discord_linked_at ? new Date(member.discord_linked_at) : undefined
      },
      telegram: {
        linked: !!member.telegram_user_id,
        at: member.telegram_linked_at ? new Date(member.telegram_linked_at) : undefined
      }
    };
  }
}
```

### 3.3 API Routes Extension

**File**: `src/api/telegram.routes.ts`

```typescript
import { Hono } from 'hono';
import { telegramWebhook } from '../telegram/bot.js';
import { validateTelegramWebhook } from './middleware.js';

export const telegramRoutes = new Hono();

/**
 * POST /telegram/webhook
 * Telegram Bot API webhook endpoint
 */
telegramRoutes.post('/webhook', validateTelegramWebhook, telegramWebhook);

/**
 * GET /telegram/health
 * Health check for Telegram bot
 */
telegramRoutes.get('/health', async (c) => {
  try {
    const me = await telegramBot.api.getMe();
    return c.json({
      status: 'healthy',
      bot: {
        id: me.id,
        username: me.username,
        canReadMessages: me.can_read_all_group_messages
      }
    });
  } catch (error) {
    return c.json({ status: 'unhealthy', error: error.message }, 503);
  }
});

/**
 * POST /telegram/verify/callback
 * Collab.Land verification webhook
 */
telegramRoutes.post('/verify/callback', async (c) => {
  const { sessionId, walletAddress, signature } = await c.req.json();

  // Verify signature with Collab.Land
  const isValid = await verifyCollabLandSignature(sessionId, walletAddress, signature);
  if (!isValid) {
    return c.json({ error: 'Invalid signature' }, 400);
  }

  const result = await identityService.completeVerification(sessionId, walletAddress);

  // Send success message to Telegram user
  await telegramBot.api.sendMessage(
    result.telegramUserId,
    `✅ Wallet linked successfully!\n\n` +
    `Wallet: \`${truncateAddress(walletAddress)}\`\n\n` +
    `Use /score to see your conviction score.`,
    { parse_mode: 'Markdown' }
  );

  return c.json({ success: true });
});
```

---

## 4. Data Architecture

### 4.1 Database Schema Extensions

**Migration**: `src/db/migrations/012_telegram_identity.ts`

```typescript
import { Database } from 'better-sqlite3';

export const up = (db: Database): void => {
  // Add Telegram columns to member_profiles
  db.exec(`
    ALTER TABLE member_profiles
    ADD COLUMN telegram_user_id TEXT UNIQUE;
  `);

  db.exec(`
    ALTER TABLE member_profiles
    ADD COLUMN telegram_linked_at INTEGER;
  `);

  // Index for Telegram lookups
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_member_telegram
    ON member_profiles(telegram_user_id);
  `);

  // Verification sessions table
  db.exec(`
    CREATE TABLE IF NOT EXISTS telegram_verification_sessions (
      id TEXT PRIMARY KEY,
      telegram_user_id TEXT NOT NULL,
      collabland_session_id TEXT,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'completed', 'expired', 'failed')),
      wallet_address TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      expires_at INTEGER NOT NULL,
      completed_at INTEGER,
      error_message TEXT
    );
  `);

  // Index for session cleanup and lookups
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_telegram_session_status
    ON telegram_verification_sessions(status, expires_at);
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_telegram_session_user
    ON telegram_verification_sessions(telegram_user_id, status);
  `);
};

export const down = (db: Database): void => {
  db.exec('DROP TABLE IF EXISTS telegram_verification_sessions');
  db.exec('DROP INDEX IF EXISTS idx_member_telegram');
  // Note: SQLite doesn't support DROP COLUMN, would need table rebuild
};
```

### 4.2 Complete Schema (Post-Migration)

```sql
-- member_profiles (updated)
CREATE TABLE member_profiles (
  member_id TEXT PRIMARY KEY,
  wallet_address TEXT UNIQUE NOT NULL,

  -- Discord identity (existing)
  discord_user_id TEXT UNIQUE,
  discord_linked_at INTEGER,

  -- Telegram identity (NEW v4.1)
  telegram_user_id TEXT UNIQUE,
  telegram_linked_at INTEGER,

  -- Profile data
  nym TEXT,
  conviction_score REAL DEFAULT 0,
  tier TEXT DEFAULT 'Wanderer',
  tier_rank INTEGER DEFAULT 0,

  -- Timestamps
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Indexes
CREATE INDEX idx_member_discord ON member_profiles(discord_user_id);
CREATE INDEX idx_member_telegram ON member_profiles(telegram_user_id);
CREATE INDEX idx_member_wallet ON member_profiles(wallet_address);
CREATE INDEX idx_member_tier ON member_profiles(tier_rank DESC);

-- telegram_verification_sessions (NEW v4.1)
CREATE TABLE telegram_verification_sessions (
  id TEXT PRIMARY KEY,
  telegram_user_id TEXT NOT NULL,
  collabland_session_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  wallet_address TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  expires_at INTEGER NOT NULL,
  completed_at INTEGER,
  error_message TEXT
);
```

### 4.3 Cache Strategy

| Cache Key | Value | TTL | Purpose |
|-----------|-------|-----|---------|
| `identity:telegram:{userId}` | MemberIdentity JSON | 5 min | Fast platform lookup |
| `identity:discord:{userId}` | MemberIdentity JSON | 5 min | Fast platform lookup |
| `score:{memberId}` | ConvictionScore JSON | 5 min | Score display (unchanged) |
| `leaderboard:global` | Top 100 members | 5 min | Leaderboard (unchanged) |
| `entitlement:{communityId}` | Entitlements JSON | 5 min | Tier/features (unchanged) |

---

## 5. API Design

### 5.1 New Endpoints

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| POST | `/telegram/webhook` | Telegram Bot API updates | Telegram signature |
| GET | `/telegram/health` | Bot health check | None |
| POST | `/telegram/verify/callback` | Collab.Land verification callback | Collab.Land signature |
| GET | `/api/member/{id}/platforms` | Get linked platforms | API key |

### 5.2 Platform Status Endpoint

**GET /api/member/{id}/platforms**

Response:
```json
{
  "memberId": "member_abc123",
  "wallet": "0x1234...5678",
  "platforms": {
    "discord": {
      "linked": true,
      "userId": "123456789",
      "linkedAt": "2024-01-15T10:30:00Z"
    },
    "telegram": {
      "linked": true,
      "userId": "987654321",
      "linkedAt": "2025-12-27T14:00:00Z"
    }
  }
}
```

### 5.3 Telegram Webhook Validation

```typescript
import crypto from 'crypto';

export function validateTelegramWebhook(c: Context, next: Next) {
  const secretToken = c.req.header('X-Telegram-Bot-Api-Secret-Token');

  if (secretToken !== config.TELEGRAM_WEBHOOK_SECRET) {
    return c.json({ error: 'Invalid webhook secret' }, 403);
  }

  return next();
}
```

---

## 6. Security Architecture

### 6.1 Bot Token Security

| Concern | Mitigation |
|---------|------------|
| Token exposure | Environment variable only, never in code |
| Token in logs | Token masked in all logging |
| CI/CD leakage | TruffleHog pattern for Telegram tokens |
| Webhook forgery | Secret token validation header |

**TruffleHog Pattern Addition**:
```yaml
# .trufflehog.yml
detectors:
  - telegram_bot_token:
      keywords: ["bot"]
      regex: '\d{10}:[A-Za-z0-9_-]{35}'
```

### 6.2 Verification Security

```
┌─────────────────────────────────────────────────────────────────┐
│                 VERIFICATION SECURITY                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. Session Creation                                             │
│     • Random session ID (UUIDv4)                                 │
│     • 15-minute expiry                                           │
│     • One session per Telegram user at a time                    │
│                                                                  │
│  2. Collab.Land Verification                                     │
│     • User signs message with wallet                             │
│     • Collab.Land validates signature                            │
│     • Webhook includes Collab.Land signature                     │
│                                                                  │
│  3. Callback Validation                                          │
│     • Verify Collab.Land webhook signature                       │
│     • Check session exists and is pending                        │
│     • Check session not expired                                  │
│     • Mark session complete atomically                           │
│                                                                  │
│  4. Rate Limiting                                                │
│     • Max 3 verification attempts per user per hour              │
│     • Exponential backoff on failures                            │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 6.3 Privacy Considerations

| Data | Storage | Display |
|------|---------|---------|
| Telegram user ID | Database | Never shown publicly |
| Telegram username | Not stored | N/A |
| Wallet address | Database | Truncated (0x1234...5678) |
| Message content | Not stored | N/A |
| User commands | Logged (no PII) | N/A |

### 6.4 GDPR Compliance

**Data Subject Rights**:

| Right | Implementation |
|-------|----------------|
| Access (Art. 15) | `/status` shows all linked data |
| Rectification (Art. 16) | Re-verification updates link |
| Erasure (Art. 17) | Delete removes telegram_user_id |
| Portability (Art. 20) | Export includes Telegram link status |

---

## 7. Performance Architecture

### 7.1 Response Time Targets

| Operation | Target | Implementation |
|-----------|--------|----------------|
| /start | <200ms | Static message |
| /verify | <500ms | Session creation + URL generation |
| /score | <100ms (cached) | Redis lookup |
| /score | <500ms (uncached) | DB + cache write |
| /leaderboard | <200ms | Redis cached list |
| /tier | <100ms | GatekeeperService (cached) |

### 7.2 Resource Budgets

| Resource | Budget | Rationale |
|----------|--------|-----------|
| Memory (grammy) | ~64MB | Lightweight bot, no message storage |
| CPU (idle) | <2% | Webhook mode, no polling |
| CPU (peak) | <15% | Command processing burst |
| Network | ~1MB/day | Text commands only, no media |
| Database | +10MB | Sessions table, identity columns |

### 7.3 Caching Strategy

```typescript
// Platform-agnostic cache keys
const cacheKeys = {
  // Identity lookups
  identity: (platform: string, userId: string) =>
    `identity:${platform}:${userId}`,

  // Score (unchanged from v4.0)
  score: (memberId: string) =>
    `score:${memberId}`,

  // Leaderboard (unchanged from v4.0)
  leaderboard: (page: number) =>
    `leaderboard:page:${page}`,
};

// Cache invalidation on identity change
async function invalidateIdentityCache(memberId: string, platforms: string[]) {
  const keys = platforms.map(p =>
    cacheKeys.identity(p, getMemberPlatformId(memberId, p))
  );
  await redis.del(...keys);
}
```

---

## 8. Integration Points

### 8.1 grammy Integration

**Dependencies**:
```json
{
  "grammy": "^1.21.0",
  "@grammyjs/runner": "^2.0.0"
}
```

**Webhook Setup**:
```typescript
// In server.ts
import { telegramRoutes } from './api/telegram.routes.js';
import { startTelegramBot } from './telegram/bot.js';

// Mount routes
app.route('/telegram', telegramRoutes);

// Start bot
await startTelegramBot();
```

### 8.2 Collab.Land Integration

**Existing Integration** (reused):
- Verification URL generation
- Webhook handling for verification_complete
- Signature validation

**New Parameters**:
```typescript
// Add platform parameter to verification URL
const verifyUrl = new URL(config.COLLABLAND_VERIFY_URL);
verifyUrl.searchParams.set('session', sessionId);
verifyUrl.searchParams.set('platform', 'telegram');
verifyUrl.searchParams.set('callback', config.TELEGRAM_VERIFY_CALLBACK_URL);
```

### 8.3 Existing Service Integration

| Service | Integration Point | Changes |
|---------|-------------------|---------|
| StatsService | getMemberStats() | None (uses member_id) |
| GatekeeperService | getEntitlements() | None (uses community_id) |
| BoostService | getBoostStatus() | None (uses community_id) |
| BadgeService | getBadge() | None (uses member_id) |

**Key Insight**: All existing services are already platform-agnostic because they use `member_id` as the identifier, not platform-specific IDs.

---

## 9. Deployment Architecture

### 9.1 Infrastructure (Unchanged)

```
┌─────────────────────────────────────────────────────────────────┐
│                     OVH VPS (Unchanged)                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │                       nginx                                  │ │
│  │                                                              │ │
│  │  location /telegram/webhook → :3000 (NEW)                    │ │
│  │  location /api → :3000                                       │ │
│  │  location /discord → :3000                                   │ │
│  │                                                              │ │
│  └────────────────────────────────────────────────────────────┘ │
│                              │                                   │
│                              ▼                                   │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │                      PM2: sietch                             │ │
│  │                                                              │ │
│  │  Node.js process (unified Discord + Telegram + API)          │ │
│  │                                                              │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌────────────────┐  ┌────────────────┐                        │
│  │    SQLite      │  │     Data       │                        │
│  │   sietch.db    │  │   /var/data    │                        │
│  └────────────────┘  └────────────────┘                        │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 9.2 nginx Configuration Addition

```nginx
# Add to existing nginx config
location /telegram/webhook {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;

    # Telegram sends updates quickly, don't buffer
    proxy_buffering off;
}
```

### 9.3 Environment Variables

```bash
# .env additions for v4.1

# Telegram Bot
TELEGRAM_BOT_TOKEN=<from @BotFather>
TELEGRAM_WEBHOOK_SECRET=<random 32-char string>
TELEGRAM_WEBHOOK_URL=https://api.sietch.xyz/telegram/webhook
TELEGRAM_VERIFY_CALLBACK_URL=https://api.sietch.xyz/telegram/verify/callback

# Collab.Land (existing, may need update)
COLLABLAND_VERIFY_URL=https://verify.collab.land/...
```

### 9.4 Deployment Checklist

```markdown
## v4.1 Deployment Checklist

### Pre-deployment
- [ ] Create Telegram bot via @BotFather
- [ ] Generate TELEGRAM_WEBHOOK_SECRET
- [ ] Update .env with Telegram variables
- [ ] Run migration: 012_telegram_identity.ts
- [ ] Test locally with polling mode

### Deployment
- [ ] Update nginx config with /telegram routes
- [ ] Reload nginx: `sudo nginx -t && sudo nginx -s reload`
- [ ] Deploy updated sietch service
- [ ] Verify PM2 process restart: `pm2 status`

### Post-deployment
- [ ] Verify webhook registered: Check /telegram/health
- [ ] Test /start command in Telegram
- [ ] Test /verify flow end-to-end
- [ ] Monitor logs for errors: `pm2 logs sietch`
```

---

## 10. Testing Architecture

### 10.1 Test Structure

```
tests/
├── telegram/
│   ├── bot.test.ts           # Bot initialization tests
│   ├── commands/
│   │   ├── start.test.ts
│   │   ├── verify.test.ts
│   │   ├── score.test.ts
│   │   ├── leaderboard.test.ts
│   │   └── tier.test.ts
│   ├── middleware/
│   │   └── rateLimit.test.ts
│   └── integration/
│       └── verification.test.ts
├── services/
│   └── IdentityService.test.ts
└── e2e/
    └── telegram.e2e.test.ts
```

### 10.2 Test Categories

| Category | Count | Focus |
|----------|-------|-------|
| Unit (commands) | ~25 | Individual command handlers |
| Unit (IdentityService) | ~15 | Identity operations |
| Integration | ~10 | Verification flow, service interaction |
| E2E | ~5 | Full command flows with mocked Telegram API |

### 10.3 grammy Test Utilities

```typescript
import { Bot, Context } from 'grammy';
import { createMockContext, createMockUpdate } from './testUtils.js';

describe('score command', () => {
  let bot: Bot;
  let mockIdentityService: jest.Mocked<IdentityService>;
  let mockStatsService: jest.Mocked<StatsService>;

  beforeEach(() => {
    mockIdentityService = createMockIdentityService();
    mockStatsService = createMockStatsService();
    bot = createTestBot({ identityService: mockIdentityService, statsService: mockStatsService });
  });

  it('returns score for verified user', async () => {
    mockIdentityService.getMemberByPlatformId.mockResolvedValue({
      memberId: 'member_123',
      walletAddress: '0x1234567890abcdef',
      platforms: [{ platform: 'telegram', platformUserId: '12345', linkedAt: new Date() }]
    });

    mockStatsService.getMemberStats.mockResolvedValue({
      convictionScore: 85.5,
      tier: 'Fremen Warrior',
      tierProgress: 0.7
    });

    const ctx = createMockContext({
      message: { text: '/score', from: { id: 12345 } }
    });

    await scoreHandler(ctx);

    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining('85.5'),
      expect.any(Object)
    );
  });

  it('prompts verification for unverified user', async () => {
    mockIdentityService.getMemberByPlatformId.mockResolvedValue(null);

    const ctx = createMockContext({
      message: { text: '/score', from: { id: 99999 } }
    });

    await scoreHandler(ctx);

    expect(ctx.reply).toHaveBeenCalledWith(
      expect.stringContaining('verify'),
      expect.any(Object)
    );
  });
});
```

---

## 11. Technical Risks & Mitigation

### 11.1 Risk Matrix

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Collab.Land Telegram support | Medium | High | Verify before Sprint 30, fallback to manual linking |
| VPS memory exhaustion | Low | High | Memory monitoring, graceful shutdown on OOM |
| Webhook delivery failures | Low | Medium | Telegram retries, health monitoring |
| Rate limit violations | Low | Low | Built-in grammy throttling |
| Cross-platform cache inconsistency | Low | Medium | Platform-agnostic cache keys |

### 11.2 Fallback Strategies

**Collab.Land Fallback**:
If Collab.Land doesn't support Telegram platform parameter:
1. Generate session without platform hint
2. Store platform in local session
3. On callback, use session to identify platform
4. Manual flow: user copies code to bot

**Memory Fallback**:
```typescript
// Monitor memory and warn
setInterval(() => {
  const used = process.memoryUsage();
  if (used.heapUsed > 400 * 1024 * 1024) { // 400MB warning
    logger.warn('High memory usage', { heapUsed: used.heapUsed });
  }
}, 60000);
```

---

## 12. Future Considerations

### 12.1 v4.2 Preparation

| Feature | v4.1 Foundation |
|---------|-----------------|
| Telegram Mini App | Identity schema ready, API endpoints available |
| Telegram notifications | Telegram user ID stored, notification service can extend |
| Group management | Bot permissions can be extended |
| Inline queries | grammy supports, just add handlers |

### 12.2 Technical Debt

| Item | Priority | Notes |
|------|----------|-------|
| Session cleanup cron | Medium | Add trigger.dev task to clean expired sessions |
| Platform abstraction | Low | Consider PlatformAdapter interface for future platforms |
| Metrics collection | Low | Add Telegram-specific metrics (commands/hour, etc.) |

---

## 13. Implementation Summary

### 13.1 New Files

| Path | LOC (Est.) | Purpose |
|------|------------|---------|
| `src/telegram/bot.ts` | ~100 | Bot initialization |
| `src/telegram/commands/*.ts` | ~400 | Command handlers (7 files) |
| `src/telegram/middleware/*.ts` | ~100 | Rate limiting, error handling |
| `src/telegram/utils/*.ts` | ~80 | Formatters, keyboards |
| `src/services/IdentityService.ts` | ~200 | Cross-platform identity |
| `src/api/telegram.routes.ts` | ~80 | API routes |
| `src/db/migrations/012_telegram_identity.ts` | ~50 | Schema migration |
| `tests/telegram/**/*.ts` | ~500 | Test suite |

**Total New Code**: ~1,500 LOC

### 13.2 Modified Files

| Path | Changes |
|------|---------|
| `src/api/server.ts` | Mount telegram routes |
| `src/index.ts` | Initialize Telegram bot |
| `src/config.ts` | Add Telegram env vars |
| `package.json` | Add grammy dependency |
| `ecosystem.config.cjs` | No changes (same process) |
| `.env.example` | Add Telegram variables |

### 13.3 Sprint Mapping

| Sprint | Components | Tests |
|--------|------------|-------|
| Sprint 30 | Bot init, /start, /verify, migration, IdentityService | ~15 |
| Sprint 31 | /score, /leaderboard, /tier, /status, /help | ~20 |
| Sprint 32 | Webhook mode, rate limiting, error handling | ~10 |
| Sprint 33 | E2E tests, docs, polish, admin broadcast | ~10 |

---

## Document Metadata

| Field | Value |
|-------|-------|
| Version | 4.1 |
| Generated | December 27, 2025 |
| Author | Loa Framework |
| Classification | Internal |
| Status | DRAFT |
| PRD Reference | loa-grimoire/prd.md v4.1 |
| Next Step | `/sprint-plan` to create sprint breakdown |

---

*SDD v4.1 "The Crossing" generated by Loa architecture workflow*
*Based on: PRD v4.1, sdd-v4.0-completed.md, ARCHITECTURE_SPEC_v2.9.0.md*

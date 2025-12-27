# Product Requirements Document: Sietch v4.1

**Version**: 4.1
**Date**: December 27, 2025
**Status**: DRAFT
**Codename**: The Crossing

---

## Document Traceability

| Section | Primary Source | Secondary Sources |
|---------|---------------|-------------------|
| Problem Statement | v4.0 PRD Out of Scope | ARCHITECTURE_SPEC_v2.9.0.md |
| Vision | Phase 1 Discovery Interview | Existing v4.0 Implementation |
| Telegram Architecture | ARCHITECTURE_SPEC_v2.9.0.md:61-90 | grammy library docs |
| Identity Bridging | ARCHITECTURE_SPEC_v2.9.0.md:30-35 | Collab.Land AccountKit |
| Feature Scope | Phase 3 Discovery Interview | v4.0 feature set |

---

## 1. Executive Summary

### 1.1 Product Overview

**Sietch v4.1 "The Crossing"** extends the Sietch platform to Telegram, enabling cross-platform community management through wallet-based identity bridging. This release adds a Telegram bot with core features while preserving the stable VPS + SQLite infrastructure.

### 1.2 Problem Statement

**Current State (v4.0):**
- Discord-only community management
- Single-platform identity (Discord ID)
- Users must be in Discord to participate
- No Telegram presence despite 700M+ MAU market

**Target State (v4.1):**
- Cross-platform community (Discord + Telegram)
- Unified wallet-based identity
- Same conviction score visible on both platforms
- Same subscription benefits across platforms

**Why Now:**
- v4.0 billing infrastructure is stable and production-ready
- Telegram market represents significant growth opportunity
- Collab.Land AccountKit enables wallet-based identity bridging
- Community demand for Telegram support

### 1.3 Vision

Sietch becomes a **cross-platform community management system**:

- **For community operators**: Single dashboard, dual platform reach
- **For members**: Seamless identity across Discord and Telegram
- **For enterprises**: Platform-agnostic community infrastructure

### 1.4 Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Cross-platform users | 20% of active users linked | Database query: users with both platforms |
| Telegram bot uptime | 99.9% | Health check monitoring |
| Identity bridging success | >95% verification success rate | Collab.Land webhook logs |
| Feature parity accuracy | 100% score consistency | Cross-platform score comparison |
| Command response time | <500ms | Bot telemetry |

### 1.5 Preserved v4.0 Capabilities

**CRITICAL**: All v4.0 features MUST continue working:

| Feature | Sprint | Status |
|---------|--------|--------|
| Stripe SaaS Billing | 23-24 | Preserve |
| Gatekeeper Service | 25 | Preserve |
| Fee Waivers | 26 | Preserve |
| Score Badges | 27 | Preserve |
| Community Boosts | 28 | Preserve |
| CI/CD Quality Gates | 29 | Preserve |

---

## 2. User Personas

### 2.1 Primary Persona: Cross-Platform Community Member

**Profile:**
- Active in both Discord and Telegram communities
- Holds BGT tokens in connected wallet
- Wants consistent identity and score visibility
- May prefer Telegram for notifications

**Pain Points:**
- Currently excluded from Sietch if not on Discord
- Cannot see conviction score on Telegram
- Manual cross-posting between platforms

**Goals:**
- Single wallet = single identity across platforms
- See score and leaderboard on preferred platform
- Receive notifications on preferred platform

### 2.2 Secondary Persona: Telegram-First User

**Profile:**
- Primarily uses Telegram
- Has wallet but limited Discord usage
- Interested in BGT community participation

**Pain Points:**
- Must join Discord to participate in Sietch
- Unfamiliar with Discord interface
- Prefers Telegram for crypto communities

**Goals:**
- Full community participation via Telegram
- Easy wallet verification
- Access to conviction scoring without Discord

### 2.3 Operator Persona: Community Admin

**Profile:**
- Manages BGT community
- Currently Discord-only
- Wants to expand reach

**Pain Points:**
- Missing Telegram audience
- Manual cross-posting announcements
- No unified member view

**Goals:**
- Single member database across platforms
- Unified analytics
- Platform-agnostic feature access

---

## 3. Functional Requirements

### 3.1 Telegram Bot Core (P0)

#### FR-4.1.1: Bot Registration & Setup

**Description**: Telegram bot registered and connected to Sietch backend.

**Acceptance Criteria**:
- [ ] Bot registered with @BotFather
- [ ] Bot token securely stored in environment
- [ ] grammy library integrated
- [ ] Bot responds to /start command
- [ ] Health check endpoint includes bot status

**Technical Notes**:
- Use grammy library (per ARCHITECTURE_SPEC)
- Bot username: @SietchBot (or similar)
- Webhook mode for VPS deployment

#### FR-4.1.2: Wallet Verification Command

**Description**: `/verify` command initiates wallet linking via Collab.Land.

**Acceptance Criteria**:
- [ ] `/verify` generates unique session ID
- [ ] Returns Collab.Land AccountKit verification URL
- [ ] Session tracked in database with 15-minute expiry
- [ ] Webhook handler processes verification_complete event
- [ ] Links Telegram user ID to unified identity
- [ ] Success message sent to user
- [ ] Handles already-verified users gracefully

**Technical Notes**:
- Reuse existing Collab.Land integration
- Session schema: `{ id, telegram_user_id, created_at, expires_at, status }`
- Idempotent: re-verification updates existing link

#### FR-4.1.3: Score Display Command

**Description**: `/score` displays user's conviction score and tier.

**Acceptance Criteria**:
- [ ] `/score` returns current conviction score
- [ ] Displays current tier (e.g., "Fremen Warrior")
- [ ] Shows tier progress percentage
- [ ] Shows wallet address (truncated)
- [ ] Returns "Please verify first" if not linked
- [ ] Cached response (5-minute TTL) for performance

**Technical Notes**:
- Query StatsService.getMemberStats()
- Format consistent with Discord /check command
- Include tier emoji mapping

#### FR-4.1.4: Leaderboard Command

**Description**: `/leaderboard` shows top community members by score.

**Acceptance Criteria**:
- [ ] `/leaderboard` returns top 10 by conviction score
- [ ] Shows rank, pseudonym (nym), and score
- [ ] Highlights user's own position if in list
- [ ] Supports optional page argument (`/leaderboard 2`)
- [ ] Cached response (5-minute TTL)

**Technical Notes**:
- Query StatsService.getLeaderboard()
- Privacy: show nym, not wallet or platform ID
- Pagination: 10 per page

#### FR-4.1.5: Tier Check Command

**Description**: `/tier` shows user's subscription tier and features.

**Acceptance Criteria**:
- [ ] `/tier` returns current effective tier
- [ ] Shows tier source (subscription, boost, waiver)
- [ ] Lists available features for tier
- [ ] Shows upgrade path if applicable
- [ ] Returns "starter" for unverified users

**Technical Notes**:
- Query GatekeeperService.getEntitlements()
- Format matches Discord tier display

### 3.2 Identity Bridging (P0)

#### FR-4.1.6: Unified Identity Schema

**Description**: Database schema supports cross-platform identity.

**Acceptance Criteria**:
- [ ] `member_profiles` table extended with `telegram_user_id` column
- [ ] Unique constraint on `telegram_user_id`
- [ ] Migration preserves existing Discord-only records
- [ ] Query by wallet OR Discord ID OR Telegram ID
- [ ] Index on `telegram_user_id` for fast lookups

**Technical Notes**:
- Schema change via migration: `012_telegram_identity.ts`
- Nullable `telegram_user_id` (not all users will link)
- Consider composite index: `(wallet_address, telegram_user_id)`

#### FR-4.1.7: Cross-Platform Score Consistency

**Description**: Conviction score is identical across platforms.

**Acceptance Criteria**:
- [ ] Score calculated once per member (not per platform)
- [ ] Discord /check and Telegram /score return same value
- [ ] Score updates reflected on both platforms within cache TTL
- [ ] No platform-specific score modifiers

**Technical Notes**:
- Existing ConvictionEngine is platform-agnostic
- Cache key: `score:{member_id}` (not platform-specific)

#### FR-4.1.8: Platform Linking Status

**Description**: Users can see which platforms are linked.

**Acceptance Criteria**:
- [ ] `/status` command shows linked platforms
- [ ] Lists: wallet (truncated), Discord (yes/no), Telegram (yes/no)
- [ ] Shows link date for each platform
- [ ] Works on both Discord and Telegram

**Technical Notes**:
- New endpoint: `GET /api/member/{id}/platforms`
- Response: `{ wallet: "0x...", discord: { linked: true, at: "..." }, telegram: { linked: true, at: "..." } }`

### 3.3 Bot Infrastructure (P1)

#### FR-4.1.9: Webhook Mode Deployment

**Description**: Telegram bot runs in webhook mode on VPS.

**Acceptance Criteria**:
- [ ] nginx configured for Telegram webhook endpoint
- [ ] Webhook URL: `https://api.sietch.xyz/telegram/webhook`
- [ ] SSL certificate valid (Let's Encrypt)
- [ ] Bot automatically sets webhook on startup
- [ ] Fallback to polling in development mode

**Technical Notes**:
- grammy supports both webhook and polling modes
- Webhook preferred for VPS (lower resource usage)
- Health check: `GET /telegram/health`

#### FR-4.1.10: Rate Limiting

**Description**: Bot respects Telegram rate limits.

**Acceptance Criteria**:
- [ ] Max 30 messages/second per chat
- [ ] Bulk message queue with rate limiting
- [ ] Graceful handling of 429 errors
- [ ] Retry with exponential backoff

**Technical Notes**:
- grammy has built-in rate limiting middleware
- Configure: `bot.api.config.use(throttle())`

#### FR-4.1.11: Error Handling

**Description**: Bot handles errors gracefully.

**Acceptance Criteria**:
- [ ] Invalid commands return help message
- [ ] API errors return user-friendly message
- [ ] Verification failures provide clear next steps
- [ ] All errors logged with context
- [ ] No sensitive data in error messages

**Technical Notes**:
- Use grammy's error boundary
- Error format: "Something went wrong. Please try again or contact support."

### 3.4 Admin Commands (P2)

#### FR-4.1.12: Admin Broadcast

**Description**: Admins can broadcast messages to Telegram users.

**Acceptance Criteria**:
- [ ] `/broadcast <message>` sends to all verified users
- [ ] Requires admin API key
- [ ] Rate-limited delivery (avoid spam flags)
- [ ] Delivery report: sent/failed counts
- [ ] Opt-out mechanism for users

**Technical Notes**:
- Defer to v4.2 if timeline constrained
- Consider trigger.dev for async delivery

---

## 4. Non-Functional Requirements

### 4.1 Infrastructure (VPS-First)

#### NFR-4.1.1: No Infrastructure Changes

**Acceptance Criteria**:
- [ ] Bot runs on existing VPS
- [ ] SQLite database unchanged
- [ ] Redis cache shared with Discord bot
- [ ] PM2 manages both Discord and Telegram processes
- [ ] Single deployment artifact

**Technical Notes**:
- Telegram bot can be same Node.js process or separate
- Recommend: separate PM2 process for isolation
- Shared database, shared Redis

#### NFR-4.1.2: Resource Constraints

**Acceptance Criteria**:
- [ ] Additional memory: <256MB
- [ ] Additional CPU: <10% average
- [ ] No additional infrastructure costs
- [ ] Database size increase: <10MB

### 4.2 Performance

#### NFR-4.1.3: Response Times

| Operation | Target | Measurement |
|-----------|--------|-------------|
| Command response | <500ms | Bot telemetry |
| Verification initiation | <1s | End-to-end timing |
| Score lookup (cached) | <100ms | Cache hit |
| Leaderboard (cached) | <200ms | Cache hit |

#### NFR-4.1.4: Availability

**Acceptance Criteria**:
- [ ] Telegram bot uptime: 99.9%
- [ ] Independent of Discord bot status
- [ ] Graceful degradation if API unreachable
- [ ] Health check endpoint for monitoring

### 4.3 Security

#### NFR-4.1.5: Bot Token Security

**Acceptance Criteria**:
- [ ] Bot token in environment variable only
- [ ] Token never logged or exposed
- [ ] CI/CD secret scanning includes Telegram patterns
- [ ] Webhook endpoint validates Telegram signatures

#### NFR-4.1.6: User Privacy

**Acceptance Criteria**:
- [ ] No Telegram user data stored beyond ID
- [ ] No message content logged
- [ ] Wallet addresses truncated in public displays
- [ ] GDPR: deletion removes Telegram link

---

## 5. Scope & Prioritization

### 5.1 In Scope (v4.1)

| Priority | Feature | Effort |
|----------|---------|--------|
| P0 | Telegram bot core (5 commands) | Medium |
| P0 | Wallet verification via Collab.Land | Medium |
| P0 | Unified identity schema | Low |
| P1 | Webhook deployment | Low |
| P1 | Rate limiting & error handling | Low |
| P2 | Admin broadcast | Low |

### 5.2 Out of Scope (v4.1)

| Feature | Reason | Target Version |
|---------|--------|----------------|
| Telegram Mini App | Scope reduction | v4.2 |
| Telegram notifications | Requires opt-in system | v4.2 |
| Telegram payments (Stars) | Complexity | v4.3 |
| Group/channel management | Enterprise feature | v4.2 |
| Inline bot queries | Advanced feature | v4.2 |
| GCP Cloud Run | Infrastructure change | v4.2+ |
| PostgreSQL migration | Database change | v4.2+ |

### 5.3 Migration Path

```
v4.0 (Complete)                   v4.1 (This Release)
┌─────────────────────┐          ┌─────────────────────┐
│ Discord only        │          │ Discord + Telegram  │
│ Discord identity    │    ──►   │ Wallet identity     │
│ VPS + SQLite        │          │ VPS + SQLite        │
│ Stripe billing      │          │ Stripe billing      │
└─────────────────────┘          └─────────────────────┘
                                          │
                                          ▼
                                 v4.2 (Next Release)
                                 ┌─────────────────────┐
                                 │ Telegram Mini App   │
                                 │ Telegram notifs     │
                                 │ Group management    │
                                 │ Enhanced analytics  │
                                 └─────────────────────┘
```

---

## 6. Risks & Dependencies

### 6.1 External Dependencies

| Dependency | Risk Level | Mitigation |
|------------|------------|------------|
| Telegram Bot API | Low | Well-documented, reliable |
| grammy library | Low | Active maintenance, good docs |
| Collab.Land AccountKit | Medium | Existing integration, proven |
| Telegram rate limits | Low | Built-in rate limiting |

### 6.2 Technical Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| AccountKit Telegram support | Medium | High | Verify capability before sprint |
| VPS resource constraints | Low | Medium | Monitor during development |
| Cache key collisions | Low | Medium | Platform-agnostic cache keys |
| User confusion (dual platform) | Medium | Low | Clear onboarding messages |

### 6.3 Business Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Low Telegram adoption | Medium | Medium | Clear value prop, easy onboarding |
| Support burden increase | Medium | Low | Comprehensive help commands |
| Feature parity confusion | Low | Low | Consistent command naming |

---

## 7. Implementation Recommendations

### 7.1 Sprint Structure

**Estimated Duration**: 4-6 weeks (4 sprints)

| Sprint | Focus | Deliverables |
|--------|-------|--------------|
| Sprint 30 | Foundation | Bot setup, /start, /verify, DB migration |
| Sprint 31 | Core Commands | /score, /leaderboard, /tier, /status |
| Sprint 32 | Infrastructure | Webhook mode, rate limiting, error handling |
| Sprint 33 | Polish & Testing | E2E tests, documentation, admin commands |

### 7.2 Technical Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         API GATEWAY (Hono)                       │
├─────────────────────────────────────────────────────────────────┤
│  /discord/*  │  /telegram/*  │  /api/*  │  /webhook/*           │
└──────┬───────┴───────┬───────┴─────┬────┴─────────┬─────────────┘
       │               │             │              │
       ▼               ▼             ▼              ▼
┌──────────────┐ ┌──────────────┐ ┌──────────┐ ┌──────────────┐
│  Discord.js  │ │    grammy    │ │  REST    │ │   Stripe     │
│     Bot      │ │     Bot      │ │   API    │ │  Webhooks    │
└──────┬───────┘ └──────┬───────┘ └────┬─────┘ └──────┬───────┘
       │               │              │               │
       └───────────────┴──────────────┴───────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      SERVICE LAYER                               │
├─────────────────────────────────────────────────────────────────┤
│  StatsService  │  GatekeeperService  │  IdentityService (NEW)   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                       DATA LAYER                                 │
├─────────────────────────────────────────────────────────────────┤
│           SQLite (better-sqlite3)  │  Redis (ioredis)           │
└─────────────────────────────────────────────────────────────────┘
```

### 7.3 New Files (Estimated)

| Path | Description |
|------|-------------|
| `src/telegram/bot.ts` | grammy bot initialization |
| `src/telegram/commands/verify.ts` | Wallet verification command |
| `src/telegram/commands/score.ts` | Score display command |
| `src/telegram/commands/leaderboard.ts` | Leaderboard command |
| `src/telegram/commands/tier.ts` | Tier check command |
| `src/telegram/commands/status.ts` | Platform linking status |
| `src/telegram/middleware/rateLimit.ts` | Rate limiting middleware |
| `src/services/IdentityService.ts` | Cross-platform identity management |
| `src/db/migrations/012_telegram_identity.ts` | Schema migration |
| `tests/telegram/*.test.ts` | Telegram bot tests |

---

## 8. Appendices

### Appendix A: Command Reference

| Command | Description | Auth Required |
|---------|-------------|---------------|
| `/start` | Welcome message, getting started | No |
| `/verify` | Link wallet via Collab.Land | No |
| `/score` | Display conviction score | Yes (verified) |
| `/leaderboard [page]` | Community rankings | No |
| `/tier` | Subscription tier and features | Yes (verified) |
| `/status` | Linked platform status | Yes (verified) |
| `/help` | Command help | No |

### Appendix B: Database Schema Changes

```sql
-- Migration 012_telegram_identity.ts

-- Add Telegram user ID to member_profiles
ALTER TABLE member_profiles ADD COLUMN telegram_user_id TEXT UNIQUE;

-- Index for Telegram lookups
CREATE INDEX idx_member_telegram ON member_profiles(telegram_user_id);

-- Verification sessions table
CREATE TABLE telegram_verification_sessions (
  id TEXT PRIMARY KEY,
  telegram_user_id TEXT NOT NULL,
  collabland_session_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  expires_at INTEGER NOT NULL
);

CREATE INDEX idx_telegram_session_status ON telegram_verification_sessions(status, expires_at);
```

### Appendix C: Environment Variables

```bash
# Telegram Bot (NEW)
TELEGRAM_BOT_TOKEN=<from @BotFather>
TELEGRAM_WEBHOOK_SECRET=<random string for validation>
TELEGRAM_WEBHOOK_URL=https://api.sietch.xyz/telegram/webhook

# Existing (unchanged)
DISCORD_BOT_TOKEN=...
STRIPE_SECRET_KEY=...
REDIS_URL=...
```

---

## Document Metadata

| Field | Value |
|-------|-------|
| Version | 4.1 |
| Generated | December 27, 2025 |
| Author | Loa Framework |
| Classification | Internal |
| Status | DRAFT |
| Next Step | `/architect` to create SDD |

---

*PRD v4.1 "The Crossing" generated by Loa planning workflow*
*Based on: v4.0 completion, discovery interview, ARCHITECTURE_SPEC_v2.9.0.md*

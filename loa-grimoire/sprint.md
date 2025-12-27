# Sprint Plan: Sietch v4.1 "The Crossing"

**Version**: 1.0
**Date**: December 27, 2025
**Status**: READY FOR IMPLEMENTATION
**Team**: Loa Framework + Jani

---

## Sprint Overview

| Parameter | Value |
|-----------|-------|
| Sprint Duration | 4-6 weeks |
| Total Sprints | 4 sprints (30-33) |
| Team Structure | Loa agentic framework guiding implementation |
| Target | Telegram bot with cross-platform identity |
| Current Sprint | Sprint 30 (Ready) |

### Success Criteria

- Telegram bot operational with 5 core commands
- Wallet verification via Collab.Land working
- Cross-platform identity linking functional
- Zero regression in v4.0 functionality
- All tests passing
- Production deployment verified

---

## Sprint Breakdown

### Sprint 30: Foundation ⏳ READY

**Goal**: Establish Telegram bot infrastructure and wallet verification

**Dependencies**: None (foundation sprint)

**Key Deliverables**:
- grammy bot initialization with webhook support
- `/start` command with welcome message
- `/verify` command initiating Collab.Land flow
- Database migration 012_telegram_identity.ts
- IdentityService with core methods
- Telegram API routes mounted

**Tasks**:

| ID | Task | Priority | Estimate | Acceptance Criteria |
|----|------|----------|----------|---------------------|
| TASK-30.1 | Add grammy dependency | P0 | 0.5h | `npm install grammy @grammyjs/runner` successful |
| TASK-30.2 | Create config additions | P0 | 0.5h | TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET, TELEGRAM_WEBHOOK_URL in config.ts |
| TASK-30.3 | Create bot.ts initialization | P0 | 2h | Bot instance created, middleware stack configured, webhook/polling modes |
| TASK-30.4 | Implement /start command | P0 | 1h | Welcome message displayed, help text included |
| TASK-30.5 | Create migration 012_telegram_identity.ts | P0 | 1h | telegram_user_id column, telegram_verification_sessions table, indexes created |
| TASK-30.6 | Implement IdentityService | P0 | 4h | getMemberByPlatformId, linkTelegram, createVerificationSession, completeVerification methods |
| TASK-30.7 | Implement /verify command | P0 | 3h | Session created, Collab.Land URL returned with inline button |
| TASK-30.8 | Create telegram.routes.ts | P0 | 2h | /telegram/webhook, /telegram/health, /telegram/verify/callback endpoints |
| TASK-30.9 | Integrate bot into server.ts | P0 | 1h | Routes mounted, bot started on server init |
| TASK-30.10 | Write unit tests for IdentityService | P0 | 3h | 15+ test cases covering all methods |
| TASK-30.11 | Write unit tests for /start and /verify | P1 | 2h | Command handlers tested with mocked context |

**Files to Create**:
- `src/telegram/bot.ts`
- `src/telegram/commands/start.ts`
- `src/telegram/commands/verify.ts`
- `src/telegram/commands/index.ts`
- `src/services/IdentityService.ts`
- `src/api/telegram.routes.ts`
- `src/db/migrations/012_telegram_identity.ts`
- `tests/services/IdentityService.test.ts`
- `tests/telegram/commands/start.test.ts`
- `tests/telegram/commands/verify.test.ts`

**Files to Modify**:
- `src/config.ts` - Add Telegram env vars
- `src/api/server.ts` - Mount telegram routes
- `src/index.ts` - Initialize Telegram bot
- `package.json` - Add grammy dependency
- `.env.example` - Add Telegram variables

**Estimated LOC**: ~600

**Risk Mitigation**:
- Verify Collab.Land supports Telegram platform parameter before implementation
- Test locally with polling mode before webhook deployment

---

### Sprint 31: Core Commands ⏳ PENDING

**Goal**: Implement all user-facing commands for score, leaderboard, and tier display

**Dependencies**: Sprint 30 complete (IdentityService, bot infrastructure)

**Key Deliverables**:
- `/score` command with tier display
- `/leaderboard` command with pagination
- `/tier` command showing entitlements
- `/status` command showing linked platforms
- `/help` command with command reference
- Response caching for performance

**Tasks**:

| ID | Task | Priority | Estimate | Acceptance Criteria |
|----|------|----------|----------|---------------------|
| TASK-31.1 | Create auth middleware | P0 | 1h | Checks verified status, returns prompt if not verified |
| TASK-31.2 | Create formatters.ts | P0 | 1h | Score formatting, address truncation, tier emoji mapping |
| TASK-31.3 | Implement /score command | P0 | 2h | Shows conviction score, tier, progress, truncated wallet |
| TASK-31.4 | Implement /leaderboard command | P0 | 3h | Top 10 display, pagination, user position highlight |
| TASK-31.5 | Implement /tier command | P0 | 2h | Effective tier, tier source, feature list, upgrade path |
| TASK-31.6 | Implement /status command | P0 | 2h | Wallet, Discord link status, Telegram link status, dates |
| TASK-31.7 | Implement /help command | P1 | 1h | Command reference with descriptions |
| TASK-31.8 | Add platforms API endpoint | P1 | 1h | GET /api/member/{id}/platforms returns linked platforms |
| TASK-31.9 | Implement response caching | P1 | 2h | 5-minute TTL for score and leaderboard responses |
| TASK-31.10 | Write unit tests for commands | P0 | 4h | ~20 test cases for all commands |
| TASK-31.11 | Integration test: score consistency | P1 | 2h | Verify Discord /check and Telegram /score return same value |

**Files to Create**:
- `src/telegram/commands/score.ts`
- `src/telegram/commands/leaderboard.ts`
- `src/telegram/commands/tier.ts`
- `src/telegram/commands/status.ts`
- `src/telegram/commands/help.ts`
- `src/telegram/middleware/auth.ts`
- `src/telegram/utils/formatters.ts`
- `tests/telegram/commands/score.test.ts`
- `tests/telegram/commands/leaderboard.test.ts`
- `tests/telegram/commands/tier.test.ts`
- `tests/telegram/commands/status.test.ts`
- `tests/telegram/integration/scoreConsistency.test.ts`

**Estimated LOC**: ~500

---

### Sprint 32: Infrastructure ⏳ PENDING

**Goal**: Production-ready infrastructure with error handling and rate limiting

**Dependencies**: Sprint 31 complete (all commands working)

**Key Deliverables**:
- Webhook mode deployment configuration
- Rate limiting middleware
- Error boundary with user-friendly messages
- nginx configuration for Telegram webhook
- Health check endpoint
- Logging and monitoring

**Tasks**:

| ID | Task | Priority | Estimate | Acceptance Criteria |
|----|------|----------|----------|---------------------|
| TASK-32.1 | Implement rate limiting middleware | P0 | 2h | Max 30 msg/sec, exponential backoff on 429 |
| TASK-32.2 | Implement error boundary | P0 | 2h | User-friendly errors, no sensitive data exposed |
| TASK-32.3 | Create webhook validation middleware | P0 | 1h | Validates X-Telegram-Bot-Api-Secret-Token header |
| TASK-32.4 | Configure webhook auto-registration | P0 | 1h | Bot sets webhook on startup in production mode |
| TASK-32.5 | Add nginx configuration | P0 | 1h | /telegram/webhook proxied to :3000, no buffering |
| TASK-32.6 | Implement structured logging | P1 | 2h | Command usage, errors, verification events logged |
| TASK-32.7 | Add Telegram to health check | P1 | 1h | /health includes bot status and webhook info |
| TASK-32.8 | Create session cleanup task | P1 | 2h | trigger.dev task to clean expired verification sessions |
| TASK-32.9 | Add TruffleHog pattern for Telegram token | P1 | 0.5h | CI detects Telegram bot tokens |
| TASK-32.10 | Write middleware tests | P0 | 3h | Rate limiting and error handling tests |

**Files to Create**:
- `src/telegram/middleware/rateLimit.ts`
- `src/telegram/middleware/errorBoundary.ts`
- `src/telegram/middleware/webhookValidation.ts`
- `src/trigger/telegramSessionCleanup.ts`
- `tests/telegram/middleware/rateLimit.test.ts`
- `tests/telegram/middleware/errorBoundary.test.ts`

**Files to Modify**:
- `src/telegram/bot.ts` - Add middleware stack
- `ecosystem.config.cjs` - Verify config (should work as-is)
- `.github/workflows/ci.yml` - Add Telegram token pattern

**Configuration to Create**:
- nginx config snippet for /telegram/webhook

**Estimated LOC**: ~300

---

### Sprint 33: Polish & Testing ⏳ PENDING

**Goal**: E2E testing, documentation, and production deployment verification

**Dependencies**: Sprint 32 complete (production infrastructure ready)

**Key Deliverables**:
- Comprehensive E2E test suite
- Updated deployment guide
- Admin broadcast command (P2)
- v4.0 regression tests passing
- Production deployment checklist

**Tasks**:

| ID | Task | Priority | Estimate | Acceptance Criteria |
|----|------|----------|----------|---------------------|
| TASK-33.1 | Write Telegram E2E tests | P0 | 4h | Full /verify → /score flow tested |
| TASK-33.2 | Run v4.0 regression tests | P0 | 1h | All existing tests passing |
| TASK-33.3 | Update deployment guide | P0 | 2h | Telegram bot setup, migration steps, verification |
| TASK-33.4 | Create .env.example updates | P0 | 0.5h | All Telegram variables documented |
| TASK-33.5 | Implement admin broadcast (P2) | P2 | 4h | /broadcast sends to all verified users with rate limiting |
| TASK-33.6 | Create keyboards.ts for inline buttons | P1 | 1h | Verify button, help button, tier upgrade button |
| TASK-33.7 | Add bot description to @BotFather | P1 | 0.5h | Description, commands list, profile picture |
| TASK-33.8 | Production deployment dry-run | P0 | 2h | Deploy to staging, verify all flows |
| TASK-33.9 | Update CI/CD for Telegram | P1 | 1h | Telegram tests included in CI pipeline |
| TASK-33.10 | Create v4.1 release notes | P1 | 1h | Feature summary, migration notes, known issues |

**Files to Create**:
- `tests/e2e/telegram.e2e.test.ts`
- `src/telegram/commands/broadcast.ts` (P2)
- `src/telegram/utils/keyboards.ts`
- `docs/deployment/telegram-setup.md`

**Files to Modify**:
- `loa-grimoire/deployment/deployment-guide.md` - Add v4.1 section
- `.env.example` - Add Telegram variables
- `.github/workflows/ci.yml` - Add Telegram tests

**Estimated LOC**: ~400

---

## Risk Mitigation

| Risk | Mitigation | Sprint |
|------|------------|--------|
| Collab.Land Telegram support | Verify capability in Sprint 30, fallback to manual linking | 30 |
| VPS memory constraints | Monitor during dev, ~64MB grammy budget | 32 |
| Webhook delivery failures | grammy handles retries, health monitoring | 32 |
| Cache key collisions | Platform-agnostic cache keys already designed | 31 |
| Rate limit violations | Built-in grammy throttling | 32 |

---

## Dependencies Graph

```
Sprint 30 (Foundation)
    │
    ├── grammy bot init
    ├── /start, /verify commands
    ├── IdentityService
    └── DB migration
         │
         ▼
Sprint 31 (Core Commands)
    │
    ├── /score, /leaderboard
    ├── /tier, /status, /help
    └── Response caching
         │
         ▼
Sprint 32 (Infrastructure)
    │
    ├── Rate limiting
    ├── Error handling
    ├── Webhook deployment
    └── Monitoring
         │
         ▼
Sprint 33 (Polish & Testing)
    │
    ├── E2E tests
    ├── Documentation
    └── Production deployment
         │
         ▼
v4.1 COMPLETE
```

---

## MVP Definition

**Minimum Viable Product (Sprint 30-31)**:
- Bot responds to commands
- Wallet verification working
- Score and leaderboard display
- Tier information available

**Full v4.1 (Sprint 30-33)**:
- All MVP features
- Production-ready infrastructure
- Error handling and rate limiting
- Full test coverage
- Admin tools

---

## Resource Estimates

| Sprint | LOC (Est.) | Tests (Est.) | Files (New) |
|--------|------------|--------------|-------------|
| Sprint 30 | ~600 | ~25 | 10 |
| Sprint 31 | ~500 | ~25 | 12 |
| Sprint 32 | ~300 | ~15 | 6 |
| Sprint 33 | ~400 | ~10 | 4 |
| **Total** | **~1,800** | **~75** | **32** |

---

## Post-Sprint Activities

**After v4.1**:
1. Monitor Telegram bot performance metrics
2. Track cross-platform user adoption (target: 20%)
3. Gather user feedback on verification flow
4. Plan v4.2 features:
   - Telegram Mini App
   - Telegram notifications (opt-in)
   - Group/channel management
   - Inline bot queries

**v4.1 Release Criteria**:
- [ ] All 4 sprints (30-33) COMPLETED and APPROVED
- [ ] Zero critical security issues
- [ ] Cross-platform verification tested end-to-end
- [ ] v4.0 regression tests all passing
- [ ] Deployment guide updated

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2025-12-27 | Initial sprint plan for v4.1 "The Crossing" |

---

*Sprint Plan v1.0 generated by Loa planning workflow*
*Based on: PRD v4.1, SDD v4.1, v4.0 completion status*

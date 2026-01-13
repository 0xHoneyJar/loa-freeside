# Sprint Plan: Native Wallet Verification

**Version**: 1.0.0
**Date**: January 14, 2026
**PRD**: grimoires/loa/prd-wallet-verification.md
**SDD**: grimoires/loa/sdd-wallet-verification.md
**Total Sprints**: 4 (Sprints 77-80)

---

## Overview

This sprint plan implements native wallet verification for Arrakis, enabling communities to verify wallet ownership without Collab.Land dependency. The feature provides a $50/month cost advantage vs Collab.Land ($49 Arrakis Pro vs $99 Collab.Land).

### Sprint Summary

| Sprint | Focus | Key Deliverables |
|--------|-------|------------------|
| 77 | Core Verification Package | `NonceManager`, `SignatureVerifier`, `MessageBuilder`, types |
| 78 | Database & Session Management | Migration, `SessionManager`, `VerificationService` |
| 79 | API Routes & Discord Integration | `/verify` endpoints, `/verify` command, role sync |
| 80 | Security, Polish & Testing | Rate limiting, audit trail, error handling, tests |

### Dependencies

```
Sprint 77: Core Package (no dependencies)
  └── Sprint 78: Database & Sessions (depends on 77)
       └── Sprint 79: API & Discord (depends on 78)
            └── Sprint 80: Security & Polish (depends on 79)
```

---

## Sprint 77: Core Verification Package

**Goal**: Build foundational cryptographic verification components

### Tasks

#### TASK-77.1: Create verification package structure

**Description**: Set up the packages/verification directory with proper exports

**Files**:
- `themes/sietch/src/packages/verification/index.ts`
- `themes/sietch/src/packages/verification/types.ts`

**Acceptance Criteria**:
- [ ] Package exports all public types and classes
- [ ] Types include `Nonce`, `VerificationSession`, `VerificationResult`
- [ ] No external dependencies beyond viem

**Effort**: Small

---

#### TASK-77.2: Implement NonceManager

**Description**: Cryptographically secure nonce generation with validation

**Files**:
- `themes/sietch/src/packages/verification/NonceManager.ts`
- `themes/sietch/tests/unit/packages/verification/NonceManager.test.ts`

**Acceptance Criteria**:
- [ ] Generates UUIDv4 nonces using crypto.randomUUID()
- [ ] Tracks creation and expiry timestamps
- [ ] `isValid()` checks expiry and used status
- [ ] Configurable TTL (default 15 minutes)
- [ ] Unit tests for generation, validation, expiry

**Effort**: Small

---

#### TASK-77.3: Implement SignatureVerifier

**Description**: EIP-191 signature verification using viem

**Files**:
- `themes/sietch/src/packages/verification/SignatureVerifier.ts`
- `themes/sietch/tests/unit/packages/verification/SignatureVerifier.test.ts`

**Acceptance Criteria**:
- [ ] Uses viem's `recoverMessageAddress()` for ECDSA recovery
- [ ] Returns `VerificationResult` with valid flag and recovered address
- [ ] Handles malformed signatures gracefully
- [ ] Case-insensitive address comparison
- [ ] Unit tests with valid/invalid/malformed signatures

**Effort**: Medium

---

#### TASK-77.4: Implement MessageBuilder

**Description**: Standardized signing message construction

**Files**:
- `themes/sietch/src/packages/verification/MessageBuilder.ts`
- `themes/sietch/tests/unit/packages/verification/MessageBuilder.test.ts`

**Acceptance Criteria**:
- [ ] Builds EIP-191 compliant message with community name, wallet, Discord user, nonce, timestamp
- [ ] Includes clear "does NOT authorize transactions" disclaimer
- [ ] Supports custom message templates via `buildCustom()`
- [ ] Unit tests for message format

**Effort**: Small

---

### Sprint 77 Testing

```bash
npm run test:run -- tests/unit/packages/verification/
```

**Exit Criteria**:
- All unit tests pass
- Package exports work correctly
- No TypeScript errors

---

## Sprint 78: Database & Session Management

**Goal**: Persistent session storage with PostgreSQL and session lifecycle management

### Tasks

#### TASK-78.1: Create database migration

**Description**: Add wallet_verification_sessions table with RLS

**Files**:
- `themes/sietch/src/packages/adapters/storage/migrations/0018_wallet_verification_sessions.sql`
- `themes/sietch/drizzle/0018_wallet_verification_sessions.sql`

**Acceptance Criteria**:
- [ ] Creates `wallet_verification_sessions` table with all columns from SDD
- [ ] Includes indexes on community_id, discord_user_id, status, expires_at
- [ ] RLS policy for tenant isolation
- [ ] CHECK constraint on status values
- [ ] Migration runs successfully

**Effort**: Medium

---

#### TASK-78.2: Add Drizzle schema

**Description**: TypeScript schema definition for wallet_verification_sessions

**Files**:
- `themes/sietch/src/packages/adapters/storage/schema.ts` (modify)

**Acceptance Criteria**:
- [ ] `walletVerificationSessions` table definition with all columns
- [ ] Proper foreign key to communities table
- [ ] Type exports: `WalletVerificationSession`, `NewWalletVerificationSession`
- [ ] Indexes defined in schema

**Effort**: Small

---

#### TASK-78.3: Implement SessionManager

**Description**: CRUD operations for verification sessions

**Files**:
- `themes/sietch/src/packages/verification/SessionManager.ts`
- `themes/sietch/tests/unit/packages/verification/SessionManager.test.ts`

**Acceptance Criteria**:
- [ ] `create()` - Insert new session with nonce
- [ ] `getById()` - Fetch session by ID with community scope
- [ ] `getByNonce()` - Fetch by nonce
- [ ] `getPendingForUser()` - Get active pending session
- [ ] `markCompleted()` - Update status and wallet address
- [ ] `incrementAttempts()` - Track verification attempts
- [ ] `markFailed()` - Update status with reason
- [ ] `expireOldSessions()` - Bulk expire past-due sessions
- [ ] All operations scoped by community_id
- [ ] Unit tests with mocked storage

**Effort**: Large

---

#### TASK-78.4: Implement WalletVerificationService

**Description**: Orchestration service for complete verification flow

**Files**:
- `themes/sietch/src/packages/verification/VerificationService.ts`
- `themes/sietch/tests/unit/packages/verification/VerificationService.test.ts`

**Acceptance Criteria**:
- [ ] `createSession()` - Create or return existing pending session
- [ ] `verifySignature()` - Full verification flow:
  - Get session
  - Check status, expiry, attempts
  - Build message
  - Verify signature
  - Link wallet via IdentityService
  - Mark session complete
  - Log audit event
- [ ] `getSession()` - Retrieve session for API
- [ ] `cleanupExpiredSessions()` - Batch cleanup
- [ ] Integration with existing services (IdentityService, eligibility, audit)
- [ ] Unit tests with mocked dependencies

**Effort**: Large

---

### Sprint 78 Testing

```bash
npm run db:generate
npm run db:migrate
npm run test:run -- tests/unit/packages/verification/SessionManager.test.ts
npm run test:run -- tests/unit/packages/verification/VerificationService.test.ts
```

**Exit Criteria**:
- Migration applies cleanly
- SessionManager CRUD operations work
- VerificationService orchestrates flow correctly

---

## Sprint 79: API Routes & Discord Integration

**Goal**: HTTP endpoints and Discord /verify command

### Tasks

#### TASK-79.1: Create verification API routes

**Description**: REST endpoints for verification flow

**Files**:
- `themes/sietch/src/api/routes/verify.routes.ts`
- `themes/sietch/src/api/server.ts` (modify to mount routes)
- `themes/sietch/tests/unit/api/routes/verify.routes.test.ts`

**Acceptance Criteria**:
- [ ] `GET /verify/:sessionId` - Return session data (JSON) or serve HTML page
- [ ] `POST /verify/:sessionId` - Submit signature, validate with Zod schema
- [ ] `GET /verify/:sessionId/status` - Poll verification status
- [ ] Proper error responses (404, 400, 429)
- [ ] Input validation with Zod schemas
- [ ] Routes mounted at `/verify`
- [ ] Unit tests for each endpoint

**Effort**: Medium

---

#### TASK-79.2: Implement /verify Discord command

**Description**: Slash command to start verification flow

**Files**:
- `themes/sietch/src/discord/commands/verify.ts`
- `themes/sietch/src/discord/commands/index.ts` (modify to register)
- `themes/sietch/tests/unit/discord/commands/verify.test.ts`

**Acceptance Criteria**:
- [ ] `/verify` command with optional action parameter (start/status/reset)
- [ ] Start action: Create session, send embed with verify button
- [ ] Status action: Show linked wallet and tier
- [ ] Reset action: Placeholder for future implementation
- [ ] Ephemeral responses for privacy
- [ ] DM backup with verification link
- [ ] Error handling for DMs disabled
- [ ] Checks community verification method setting
- [ ] Unit tests for command handler

**Effort**: Large

---

#### TASK-79.3: Create verification web page

**Description**: Static HTML page for wallet connection and signing

**Files**:
- `themes/sietch/src/static/verify.html`
- `themes/sietch/src/static/verify.css` (optional)
- `themes/sietch/src/static/verify.js`

**Acceptance Criteria**:
- [ ] Clean, branded UI matching Arrakis design
- [ ] Connect wallet button (supports injected providers)
- [ ] Sign message button (disabled until connected)
- [ ] Status display (pending, success, error)
- [ ] Clear "not a transaction" messaging
- [ ] Session expiry countdown
- [ ] Mobile-responsive design
- [ ] Error messages for common issues

**Effort**: Medium

---

#### TASK-79.4: Integrate role sync after verification

**Description**: Trigger role assignment after successful verification

**Files**:
- `themes/sietch/src/packages/verification/VerificationService.ts` (modify)
- `themes/sietch/src/services/role-sync.ts` (verify integration)

**Acceptance Criteria**:
- [ ] Queue role sync job after successful verification
- [ ] Send Discord DM with verification result
- [ ] Include eligibility status and assigned role in DM
- [ ] Handle DM failures gracefully

**Effort**: Small

---

### Sprint 79 Testing

```bash
npm run test:run -- tests/unit/api/routes/verify.routes.test.ts
npm run test:run -- tests/unit/discord/commands/verify.test.ts
```

**Exit Criteria**:
- API endpoints respond correctly
- Discord command creates sessions
- Verification page loads and functions
- Role sync triggers on completion

---

## Sprint 80: Security, Polish & Testing

**Goal**: Harden security, add audit trail, comprehensive testing

### Tasks

#### TASK-80.1: Add rate limiting

**Description**: Protect verification endpoints from abuse

**Files**:
- `themes/sietch/src/api/routes/verify.routes.ts` (modify)
- `themes/sietch/src/middleware/rate-limit.ts` (if new file needed)
- `themes/sietch/tests/unit/api/routes/verify.rate-limit.test.ts`

**Acceptance Criteria**:
- [ ] 30 requests/minute/IP for GET endpoints
- [ ] 10 requests/hour/IP for POST signature submission
- [ ] 5 sessions/hour/user for session creation
- [ ] Custom rate limit messages
- [ ] Redis-backed for multi-instance
- [ ] Unit tests verify limits enforced

**Effort**: Medium

---

#### TASK-80.2: Implement audit trail

**Description**: Log all verification events for security and debugging

**Files**:
- `themes/sietch/src/packages/verification/VerificationService.ts` (modify)
- `themes/sietch/src/packages/security/AuditLogPersistence.ts` (verify integration)

**Acceptance Criteria**:
- [ ] Log session_created event
- [ ] Log signature_submitted event (success/failure)
- [ ] Log verification_completed event
- [ ] Log verification_expired event
- [ ] Log verification_reset event
- [ ] Include session ID, user ID, IP, user agent in logs
- [ ] HMAC-signed audit entries

**Effort**: Small

---

#### TASK-80.3: Add comprehensive error handling

**Description**: User-friendly error messages and proper error types

**Files**:
- `themes/sietch/src/packages/verification/errors.ts`
- `themes/sietch/src/api/routes/verify.routes.ts` (modify)
- `themes/sietch/src/discord/commands/verify.ts` (modify)

**Acceptance Criteria**:
- [ ] `VerificationError` class with error codes
- [ ] User-facing message mapping for all error codes
- [ ] Proper HTTP status codes (400, 404, 429, 500)
- [ ] Discord error embeds with helpful guidance
- [ ] Recoverable vs non-recoverable error distinction

**Effort**: Small

---

#### TASK-80.4: Integration tests

**Description**: End-to-end verification flow tests

**Files**:
- `themes/sietch/tests/integration/verification-flow.test.ts`

**Acceptance Criteria**:
- [ ] Test complete happy path: create session → sign → verify → role sync
- [ ] Test expired session handling
- [ ] Test invalid signature handling
- [ ] Test max attempts enforcement
- [ ] Test rate limiting behavior
- [ ] Test with test wallet (viem's privateKeyToAccount)

**Effort**: Large

---

#### TASK-80.5: Security tests

**Description**: Verify security controls work correctly

**Files**:
- `themes/sietch/tests/unit/packages/verification/security.test.ts`

**Acceptance Criteria**:
- [ ] Test nonce uniqueness enforcement
- [ ] Test nonce expiry enforcement
- [ ] Test session replay prevention
- [ ] Test cross-tenant access prevention
- [ ] Test signature address matching
- [ ] Test attempt limit enforcement

**Effort**: Medium

---

#### TASK-80.6: Session cleanup job

**Description**: Cron job to expire stale sessions

**Files**:
- `themes/sietch/src/packages/jobs/verification/SessionCleanupJob.ts`
- `themes/sietch/tests/unit/packages/jobs/verification/SessionCleanupJob.test.ts`

**Acceptance Criteria**:
- [ ] Runs every 5 minutes
- [ ] Marks expired pending sessions as 'expired'
- [ ] Logs cleanup statistics
- [ ] Unit tests verify cleanup logic

**Effort**: Small

---

### Sprint 80 Testing

```bash
npm run test:run -- tests/unit/packages/verification/
npm run test:run -- tests/integration/verification-flow.test.ts
```

**Exit Criteria**:
- All security tests pass
- Integration tests demonstrate full flow
- Rate limiting active
- Audit trail captures all events

---

## Success Criteria

### Feature Complete Checklist

- [ ] Users can run `/verify` in Discord
- [ ] Users receive DM with verification link
- [ ] Verification page loads and allows wallet connection
- [ ] Users can sign message with any EVM wallet
- [ ] Signature verification recovers correct address
- [ ] Wallet is linked to Discord account via IdentityService
- [ ] Eligibility is checked and role assigned
- [ ] User receives confirmation DM with result
- [ ] Sessions expire after 15 minutes
- [ ] Max 3 attempts per session enforced
- [ ] Rate limits protect against abuse
- [ ] Audit trail captures all events

### Performance Targets

| Metric | Target |
|--------|--------|
| Session creation | <100ms |
| Signature verification | <50ms |
| Full verification flow | <3s |

### Security Checklist

- [ ] Nonces are cryptographically random
- [ ] Nonces are single-use
- [ ] Sessions are time-limited
- [ ] RLS prevents cross-tenant access
- [ ] Rate limiting prevents abuse
- [ ] Audit trail is HMAC-signed

---

## Risk Mitigation

| Risk | Mitigation | Sprint |
|------|------------|--------|
| Mobile wallet compatibility | Test with MetaMask Mobile, Rainbow, Coinbase early | 79 |
| Signature format variations | Use viem's robust parsing | 77 |
| Rate limit tuning | Start conservative, monitor metrics | 80 |
| Session cleanup race conditions | Use database-level expiry function | 80 |

---

## Post-Launch

### Phase 2 Enhancements (Future)

1. **WalletConnect Integration**: Add WalletConnect modal for broader wallet support
2. **Mobile Deep Links**: Direct links to mobile wallet apps
3. **Re-verification Flow**: Allow users to change linked wallet
4. **Admin Override**: `/admin-link @user wallet` command
5. **Verification Statistics**: Dashboard showing verification rates

### Monitoring

- Track verification completion rate (target: >80%)
- Track average time to verify (target: <60s)
- Track failed verification rate (target: <5%)
- Alert on unusual patterns (replay attempts, rate limit hits)

---

*Sprint plan generated by Technical PM Agent*
*Version 1.0.0 - January 14, 2026*

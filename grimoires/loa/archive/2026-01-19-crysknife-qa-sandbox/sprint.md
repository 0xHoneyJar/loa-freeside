# Sprint Plan: Crysknife Security Remediation

**Version:** 2.0
**Date:** 2026-01-19
**Codename:** Crysknife Security Hardening
**Cycle:** cycle-003
**Global Sprint Range:** 111-113
**PRD:** grimoires/loa/prd.md
**SDD:** grimoires/loa/sdd.md
**Audit Reference:** grimoires/loa/a2a/audits/2026-01-19/SECURITY-AUDIT-REPORT.md

---

## Executive Summary

This sprint plan addresses security vulnerabilities identified in the Crysknife QA Sandbox Testing System audit (2026-01-19). The audit verdict was **CHANGES_REQUIRED** with:

- 2 CRITICAL vulnerabilities (must fix before production)
- 4 HIGH vulnerabilities (fix before production)
- 3 MEDIUM vulnerabilities (fix in next sprint)

**Target:** Achieve "APPROVED - LET'S FUCKING GO" on re-audit.

---

## Sprint Overview

| Sprint | Global ID | Focus | Deliverable |
|--------|-----------|-------|-------------|
| S-SEC-1 | 111 | Critical Fixes | Redis key sanitization, Authentication middleware |
| S-SEC-2 | 112 | High Priority Fixes | Discord RBAC, Rate limiting, Optimistic locking |
| S-SEC-3 | 113 | Hardening & Tests | Error sanitization, Security test coverage |

**Total Tasks:** 17 tasks across 3 sprints

---

## Sprint 111: Critical Security Fixes

**Goal:** Address CRITICAL-001 and CRITICAL-002 - mandatory blockers for production.

**Dependencies:** Sprints 106-110 (Crysknife implementation complete)

**Remediation Files:**
- `grimoires/loa/a2a/audits/2026-01-19/remediation/critical-001.md`
- `grimoires/loa/a2a/audits/2026-01-19/remediation/critical-002.md`

### Tasks

#### T111.1: Implement Redis Key Sanitization Function

**Description:** Add `sanitizeRedisKeySegment()` function to prevent Redis key injection attacks via wildcard, delimiter, or pattern bypass.

**File:** `themes/sietch/src/services/sandbox/simulation-service.ts`

**Acceptance Criteria:**
- [ ] `sanitizeRedisKeySegment(segment)` rejects `*`, `:`, and other unsafe characters
- [ ] Only allows alphanumeric, hyphens, underscores (`/^[a-zA-Z0-9_-]+$/`)
- [ ] Enforces max length of 64 characters
- [ ] Throws descriptive error with sanitized message (no user input in error)
- [ ] Exported for use in tests

**Priority:** P0 (CRITICAL)

---

#### T111.2: Apply Sanitization to buildContextKey()

**Description:** Update `buildContextKey()` to sanitize both `sandboxId` and `userId` parameters.

**File:** `themes/sietch/src/services/sandbox/simulation-service.ts`

**Acceptance Criteria:**
- [ ] `buildContextKey(sandboxId, userId)` calls `sanitizeRedisKeySegment()` on both params
- [ ] Throws before constructing key if validation fails
- [ ] Existing functionality preserved for valid inputs
- [ ] All callers handle potential validation errors

**Priority:** P0 (CRITICAL)

---

#### T111.3: Apply Sanitization to SIMULATION_KEY_PATTERN()

**Description:** Update pattern function to sanitize `sandboxId` before constructing pattern.

**File:** `themes/sietch/src/services/sandbox/simulation-service.ts`

**Acceptance Criteria:**
- [ ] `SIMULATION_KEY_PATTERN(sandboxId)` sanitizes input
- [ ] Pattern cannot be manipulated to match unintended keys
- [ ] Throws for invalid sandboxId

**Priority:** P0 (CRITICAL)

---

#### T111.4: Unit Tests for Redis Key Sanitization

**Description:** Comprehensive tests for key sanitization covering all attack vectors.

**File:** `themes/sietch/tests/services/sandbox/simulation-service.test.ts`

**Acceptance Criteria:**
- [ ] Test rejects wildcard in sandboxId (`*`)
- [ ] Test rejects colon in sandboxId (`:`)
- [ ] Test rejects colon in userId
- [ ] Test rejects oversized segments (>64 chars)
- [ ] Test accepts valid Discord IDs (numeric strings)
- [ ] Test accepts valid sandbox IDs (alphanumeric with hyphens)
- [ ] Test round-trip: valid inputs produce expected keys

**Priority:** P0 (CRITICAL)

---

#### T111.5: Create Authentication Middleware

**Description:** Implement authentication middleware for REST API endpoints.

**File:** `themes/sietch/src/api/middleware/auth.ts` (new file)

**Acceptance Criteria:**
- [ ] `requireAuth` middleware extracts and validates JWT from Authorization header
- [ ] Rejects requests without `Bearer` token (401)
- [ ] Rejects requests with invalid/expired token (401)
- [ ] Attaches `caller` object to request with userId, roles, sandboxAccess
- [ ] Generic error messages (no token details in response)

**Priority:** P0 (CRITICAL)

---

#### T111.6: Create Authorization Middleware

**Description:** Implement authorization middleware for sandbox and user access control.

**File:** `themes/sietch/src/api/middleware/auth.ts`

**Acceptance Criteria:**
- [ ] `requireSandboxAccess` checks caller has access to requested sandboxId
- [ ] Admin/qa_admin roles bypass sandbox access check
- [ ] `requireSelfOrAdmin` ensures users can only access their own contexts
- [ ] Admin roles can access any user's context
- [ ] Returns 403 for unauthorized access with generic message

**Priority:** P0 (CRITICAL)

---

#### T111.7: Apply Auth Middleware to Simulation Router

**Description:** Wire authentication and authorization middleware into simulation routes.

**File:** `themes/sietch/src/api/routes/simulation.routes.ts`

**Acceptance Criteria:**
- [ ] All routes require authentication
- [ ] All routes require sandbox access verification
- [ ] User-specific routes (/:userId/*) require self-or-admin check
- [ ] Middleware order: auth -> sandboxAccess -> selfOrAdmin -> handler
- [ ] Existing functionality preserved for authenticated requests

**Priority:** P0 (CRITICAL)

---

#### T111.8: Unit Tests for Authentication/Authorization

**Description:** Tests for auth middleware covering all security scenarios.

**File:** `themes/sietch/tests/unit/api/middleware/auth.test.ts` (new file)

**Acceptance Criteria:**
- [ ] Test rejects requests without auth header (401)
- [ ] Test rejects invalid JWT (401)
- [ ] Test rejects expired JWT (401)
- [ ] Test rejects access to other sandboxes (403)
- [ ] Test rejects access to other user contexts (403)
- [ ] Test allows admin to access any user
- [ ] Test allows self-access to own context
- [ ] Error messages don't leak sensitive info

**Priority:** P0 (CRITICAL)

---

## Sprint 112: High Priority Fixes

**Goal:** Address HIGH-001 through HIGH-003 - required before production deployment.

**Dependencies:** Sprint 111 (Critical fixes complete)

**Remediation Files:**
- `grimoires/loa/a2a/audits/2026-01-19/remediation/high-001.md`
- `grimoires/loa/a2a/audits/2026-01-19/remediation/high-002.md`
- `grimoires/loa/a2a/audits/2026-01-19/remediation/high-003.md`

### Tasks

#### T112.1: Implement Discord Role-Based Access Control

**Description:** Add role checking to simulation Discord commands.

**File:** `themes/sietch/src/discord/commands/simulation.ts`

**Acceptance Criteria:**
- [ ] `hasQAPermission(interaction)` checks for QA Tester/Admin roles
- [ ] Self-context operations allowed without QA role
- [ ] Non-self operations require QA Tester or Admin role
- [ ] Threshold modifications require QA Admin role
- [ ] Ephemeral error messages for permission denials
- [ ] Role names configurable (not hardcoded)

**Priority:** P0 (HIGH)

---

#### T112.2: Implement REST API Rate Limiting

**Description:** Add per-user rate limiting to simulation REST endpoints.

**File:** `themes/sietch/src/api/routes/simulation.routes.ts`

**Acceptance Criteria:**
- [ ] General endpoints: 60 requests/minute
- [ ] Write operations: 20 requests/minute
- [ ] Expensive operations (check): 10 requests/minute
- [ ] Rate limit keyed by userId (authenticated) or IP (fallback)
- [ ] Returns 429 with `Retry-After` header when exceeded
- [ ] Include `X-RateLimit-*` headers in responses

**Priority:** P0 (HIGH)

---

#### T112.3: Implement Discord Command Cooldowns

**Description:** Add per-user cooldowns to simulation Discord commands.

**File:** `themes/sietch/src/discord/commands/simulation.ts`

**Acceptance Criteria:**
- [ ] Cooldown tracking per user per subcommand
- [ ] Cooldowns: assume=5s, state=3s, whoami=2s, check=5s, thresholds=10s
- [ ] Ephemeral message showing remaining cooldown time
- [ ] Cooldowns don't persist across restarts (memory-based OK)

**Priority:** P1 (HIGH)

---

#### T112.4: Make Optimistic Locking Mandatory

**Description:** Change `expectedVersion` from optional to required for state updates.

**File:** `themes/sietch/src/services/sandbox/simulation-service.ts`

**Acceptance Criteria:**
- [ ] `updateState()` requires `expectedVersion` parameter
- [ ] Throws VERSION_CONFLICT if version doesn't match
- [ ] Version incremented on every successful update
- [ ] 409 response includes current version for retry

**Priority:** P0 (HIGH)

---

#### T112.5: Update API to Require Version

**Description:** Update REST API and Discord commands to pass version for state updates.

**Files:**
- `themes/sietch/src/api/routes/simulation.routes.ts`
- `themes/sietch/src/discord/commands/simulation.ts`

**Acceptance Criteria:**
- [ ] REST PATCH /state requires `version` in body
- [ ] Returns 400 if version not provided
- [ ] Discord commands fetch current version before update
- [ ] Handle VERSION_CONFLICT gracefully with retry hint

**Priority:** P0 (HIGH)

---

#### T112.6: Unit Tests for Rate Limiting and RBAC

**Description:** Tests for rate limiting and Discord RBAC.

**File:** `themes/sietch/tests/services/sandbox/security.test.ts` (new file)

**Acceptance Criteria:**
- [ ] Test rate limiter allows requests under limit
- [ ] Test rate limiter rejects requests over limit
- [ ] Test rate limiter includes retry-after
- [ ] Test Discord RBAC allows self-operations
- [ ] Test Discord RBAC rejects non-self without role
- [ ] Test Discord RBAC allows admin operations
- [ ] Test cooldown enforcement

**Priority:** P1 (HIGH)

---

## Sprint 113: Hardening & Test Coverage

**Goal:** Address HIGH-004 and improve security test coverage to >80%.

**Dependencies:** Sprint 112 (High priority fixes complete)

**Remediation Files:**
- `grimoires/loa/a2a/audits/2026-01-19/remediation/high-004.md`

### Tasks

#### T113.1: Create Error Sanitization Utility

**Description:** Create utility for sanitizing error responses in production.

**File:** `themes/sietch/src/api/utils/error-sanitizer.ts` (new file)

**Acceptance Criteria:**
- [ ] `sanitizeError(error)` maps internal codes to safe messages
- [ ] Generates unique error reference ID for log correlation
- [ ] Returns sanitized body and log details separately
- [ ] Development mode allows detailed errors
- [ ] No internal details (Redis errors, stack traces) in production responses

**Priority:** P0 (HIGH)

---

#### T113.2: Apply Error Sanitization to Routes

**Description:** Update simulation router error handler to use sanitization.

**File:** `themes/sietch/src/api/routes/simulation.routes.ts`

**Acceptance Criteria:**
- [ ] Error handler uses `sanitizeError()` in production
- [ ] Error reference IDs logged with full details
- [ ] 500 errors include errorRef for support
- [ ] Validation errors don't expose patterns or values
- [ ] Consistent error format across all endpoints

**Priority:** P0 (HIGH)

---

#### T113.3: Security-Focused Integration Tests

**Description:** Comprehensive security tests covering all attack vectors.

**File:** `themes/sietch/tests/integration/security/simulation-security.test.ts` (new file)

**Acceptance Criteria:**
- [ ] Test Redis key injection attempts blocked
- [ ] Test authentication bypass attempts fail
- [ ] Test authorization bypass attempts fail
- [ ] Test rate limiting under load
- [ ] Test error sanitization doesn't leak info
- [ ] Test version conflict handling
- [ ] Document attack vectors tested

**Priority:** P1 (HIGH)

---

## Task Summary by Sprint

| Sprint | ID | Tasks | P0 | P1 | Focus |
|--------|-----|-------|----|----|-------|
| S-SEC-1 | 111 | 8 | 8 | 0 | Critical vulnerabilities |
| S-SEC-2 | 112 | 6 | 4 | 2 | High-priority vulnerabilities |
| S-SEC-3 | 113 | 3 | 2 | 1 | Hardening and coverage |
| **Total** | | **17** | **14** | **3** | |

---

## Security Test Coverage Target

| Category | Current | Target |
|----------|---------|--------|
| Authentication | 0% | >90% |
| Authorization | 0% | >90% |
| Rate Limiting | 0% | >80% |
| Input Validation | 40% | >90% |
| Error Handling | 0% | >80% |
| **Overall Security** | ~25% | >80% |

---

## Acceptance Criteria for Re-Audit

The following must be true before requesting re-audit:

1. **CRITICAL-001 Fixed**: Redis key sanitization implemented and tested
2. **CRITICAL-002 Fixed**: Authentication middleware on all routes
3. **HIGH-001 Fixed**: Discord RBAC implemented
4. **HIGH-002 Fixed**: Rate limiting on REST and Discord
5. **HIGH-003 Fixed**: Optimistic locking mandatory
6. **HIGH-004 Fixed**: Error messages sanitized
7. **Test Coverage**: Security test coverage >80%
8. **All Tests Pass**: 0 failures in security test suite

---

## Sprint Execution Order

```
Sprint 111 (Critical Fixes)
    ↓
    ├── T111.1-4: Redis Key Sanitization
    └── T111.5-8: Authentication/Authorization
    ↓
Sprint 112 (High Priority Fixes)
    ↓
    ├── T112.1,3: Discord RBAC + Cooldowns
    ├── T112.2: REST Rate Limiting
    └── T112.4-5: Optimistic Locking
    ↓
Sprint 113 (Hardening)
    ↓
    ├── T113.1-2: Error Sanitization
    └── T113.3: Security Integration Tests
    ↓
Re-Audit Request
```

---

## Risk Register

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| Auth breaks existing functionality | High | Medium | Feature flag for gradual rollout |
| Rate limiting too aggressive | Medium | Low | Start with generous limits, tighten based on metrics |
| Version requirement breaks clients | Medium | Medium | Document migration, provide version in all GET responses |
| Error sanitization hides useful debug info | Low | Medium | Development mode preserves details |

---

## Definition of Done

Each task is complete when:

1. **Code Complete** - Implementation matches acceptance criteria
2. **Tests Pass** - All relevant tests pass (unit + integration + security)
3. **Type Safe** - No TypeScript errors
4. **Security Review** - Code reviewed with security focus
5. **No Regressions** - All 177 existing tests still pass

---

## Task ID Reference

| ID | Sprint | Task | Priority | Remediation |
|----|--------|------|----------|-------------|
| T111.1 | 111 | Sanitization function | P0 | CRITICAL-001 |
| T111.2 | 111 | Apply to buildContextKey | P0 | CRITICAL-001 |
| T111.3 | 111 | Apply to KEY_PATTERN | P0 | CRITICAL-001 |
| T111.4 | 111 | Sanitization tests | P0 | CRITICAL-001 |
| T111.5 | 111 | Auth middleware | P0 | CRITICAL-002 |
| T111.6 | 111 | Authz middleware | P0 | CRITICAL-002 |
| T111.7 | 111 | Apply to router | P0 | CRITICAL-002 |
| T111.8 | 111 | Auth/authz tests | P0 | CRITICAL-002 |
| T112.1 | 112 | Discord RBAC | P0 | HIGH-001 |
| T112.2 | 112 | REST rate limiting | P0 | HIGH-002 |
| T112.3 | 112 | Discord cooldowns | P1 | HIGH-002 |
| T112.4 | 112 | Mandatory version | P0 | HIGH-003 |
| T112.5 | 112 | API version updates | P0 | HIGH-003 |
| T112.6 | 112 | Rate/RBAC tests | P1 | HIGH-001,002 |
| T113.1 | 113 | Error sanitizer | P0 | HIGH-004 |
| T113.2 | 113 | Apply to routes | P0 | HIGH-004 |
| T113.3 | 113 | Security integration tests | P1 | All |

---

## Related Documents

- **Audit Report:** `grimoires/loa/a2a/audits/2026-01-19/SECURITY-AUDIT-REPORT.md`
- **Remediation Files:** `grimoires/loa/a2a/audits/2026-01-19/remediation/*.md`
- **PRD:** `grimoires/loa/prd.md`
- **SDD:** `grimoires/loa/sdd.md`
- **Ledger:** `grimoires/loa/ledger.json`

---

**Document Status:** APPROVED
**Next Step:** `/implement sprint-111`

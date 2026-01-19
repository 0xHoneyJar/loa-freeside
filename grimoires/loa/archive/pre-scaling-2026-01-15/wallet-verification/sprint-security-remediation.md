# Sprint Plan: Security Audit Remediation

**Source**: SECURITY-AUDIT-REPORT.md (January 14, 2026)
**Risk Level**: MEDIUM → Target: LOW
**Total Findings**: 20 (1 Critical, 5 High, 8 Medium, 6 Low)

---

## Sprint Overview

| Sprint | Focus | Findings Addressed |
|--------|-------|-------------------|
| Sprint 80 | Critical + High Priority | CRIT-1, HIGH-1, HIGH-4, HIGH-5 |
| Sprint 81 | High + Medium Priority | HIGH-2, MED-1, MED-5, MED-7 |
| Sprint 82 | Medium Priority | MED-2, MED-4, MED-8, LOW-5 |
| Sprint 83 | Low Priority + Hardening | LOW-1, LOW-3, remaining items |

**Team**: 1 AI Engineer (Claude)
**Sprint Duration**: ~4 hours per sprint
**Goal**: Production-ready security posture

---

## Sprint 80: Critical Security Fixes

**Goal**: Address all CRITICAL and HIGH priority issues blocking production

### TASK-80.1: Make Paddle Webhook Secret Required (CRIT-1)

**Priority**: CRITICAL
**File**: `sietch-service/src/config.ts`

**Description**:
The Paddle webhook secret is marked as optional in the configuration schema, creating a potential authentication bypass risk in billing operations.

**Implementation**:
1. Change webhook secret from optional to required with min length
2. Add compile-time assertion in WebhookService constructor
3. Update startup validation to fail fast

**Acceptance Criteria**:
- [ ] `webhookSecret: z.string().min(1)` in paddle schema
- [ ] WebhookService throws if billing enabled without secret
- [ ] Tests verify required field validation
- [ ] .env.example documents requirement

**Effort**: Small (1-2 hours)

---

### TASK-80.2: Implement Webhook Replay Attack Prevention (HIGH-1)

**Priority**: HIGH
**File**: `sietch-service/src/services/billing/WebhookService.ts`

**Description**:
Maximum event age check (5 minutes) is defined but not enforced in webhook processing flow.

**Implementation**:
1. Add event age validation after signature verification
2. Return `skipped` status for stale events
3. Log warning with event age for monitoring
4. Add unit tests for replay prevention

**Acceptance Criteria**:
- [ ] Events older than 5 minutes are rejected
- [ ] Rejection logged with event ID and age
- [ ] Response indicates `status: 'skipped'` with reason
- [ ] Unit tests cover edge cases (4:59, 5:00, 5:01)

**Effort**: Small (1-2 hours)

---

### TASK-80.3: Harden RLS Policies with Nil UUID Constraint (HIGH-4)

**Priority**: HIGH
**Files**: Database migrations

**Description**:
RLS policies use COALESCE with fallback to nil UUID, which could expose cross-tenant data if tenant context is not set.

**Implementation**:
1. Add CHECK constraint preventing nil UUID as community_id
2. Create migration to alter existing tables
3. Update RLS policies to fail-closed (no COALESCE fallback)
4. Add integration tests for RLS bypass attempts

**Acceptance Criteria**:
- [ ] CHECK constraint on communities table: `id != '00000000-0000-0000-0000-000000000000'::UUID`
- [ ] RLS policies fail if tenant context not set (no fallback)
- [ ] Migration applies cleanly to existing data
- [ ] Integration test confirms nil UUID rejected

**Effort**: Medium (2-3 hours)

---

### TASK-80.4: Add Vault Secret Validation (HIGH-5)

**Priority**: HIGH
**File**: `sietch-service/src/config.ts`

**Description**:
Vault configuration allows empty strings which pass validation but cause runtime failures.

**Implementation**:
1. Add `.min(1)` to all Vault string fields
2. Use `.nullish()` instead of `.optional()` where appropriate
3. Add startup validation for Vault when enabled
4. Update .env.example with validation notes

**Acceptance Criteria**:
- [ ] Empty strings rejected for vault.addr, vault.token, vault.namespace
- [ ] Startup fails with clear message if Vault enabled with invalid config
- [ ] Tests verify empty string rejection

**Effort**: Small (1 hour)

---

## Sprint 81: Configuration Hardening

**Goal**: Eliminate configuration-related vulnerabilities

### TASK-81.1: Refactor Direct Env Var Access (HIGH-2)

**Priority**: HIGH
**Files**: Multiple files using `process.env.*` directly

**Description**:
Several files access environment variables directly instead of using validated config.ts.

**Implementation**:
1. Add missing fields to config.ts schema
2. Update verify.ts to use `config.verification.baseUrl`
3. Update DuoMfaVerifier to use `config.mfa.duo.*`
4. Search codebase for remaining `process.env` usage
5. Add eslint rule to warn on direct env access

**Acceptance Criteria**:
- [ ] `verification.baseUrl` added to config schema
- [ ] `mfa.duo.*` fields added to config schema
- [ ] All production code uses config.* instead of process.env
- [ ] Only test files may use process.env directly
- [ ] ESLint rule warns on process.env in src/

**Effort**: Medium (2-3 hours)

---

### TASK-81.2: Enforce API Key Pepper Change (MED-1)

**Priority**: MEDIUM
**File**: `sietch-service/src/config.ts`

**Description**:
API_KEY_PEPPER has a default "CHANGE_ME_IN_PRODUCTION" that is not validated.

**Implementation**:
1. Add refine() validation rejecting default value
2. Require minimum 32 characters
3. Fail fast in production if default value used

**Acceptance Criteria**:
- [ ] Schema rejects `CHANGE_ME_IN_PRODUCTION` value
- [ ] Minimum 32 character length enforced
- [ ] Startup fails with clear message in production mode
- [ ] Test mode allows shorter peppers

**Effort**: Small (1 hour)

---

### TASK-81.3: Make Telegram Webhook Secret Required (MED-5)

**Priority**: MEDIUM
**File**: `sietch-service/src/config.ts`

**Description**:
Similar to CRIT-1, Telegram webhook secret is optional.

**Implementation**:
1. Add `.min(1)` to webhookSecret when webhookUrl is set
2. Add startup validation for Telegram webhook mode
3. Update .env.example documentation

**Acceptance Criteria**:
- [ ] Webhook secret required when webhook URL configured
- [ ] Startup fails with clear message if missing
- [ ] Tests verify conditional validation

**Effort**: Small (1 hour)

---

### TASK-81.4: Add CORS Configuration (MED-7)

**Priority**: MEDIUM
**File**: `sietch-service/src/api/server.ts`

**Description**:
CORS middleware not explicitly configured.

**Implementation**:
1. Install `cors` package
2. Configure CORS middleware with allowed origins from env
3. Set credentials, methods, allowed headers
4. Add ALLOWED_ORIGINS to config schema

**Acceptance Criteria**:
- [ ] CORS middleware installed and configured
- [ ] Origins configurable via ALLOWED_ORIGINS env var
- [ ] Credentials enabled for authenticated requests
- [ ] Tests verify CORS headers

**Effort**: Small (1-2 hours)

---

## Sprint 82: Logging & Rate Limiting

**Goal**: Improve observability and DoS protection

### TASK-82.1: Add Token Scrubbing to Logger (MED-2)

**Priority**: MEDIUM
**File**: `sietch-service/src/infrastructure/logging/`

**Description**:
Discord and Telegram tokens could be logged if error objects contain config.

**Implementation**:
1. Add pino serializer for error objects
2. Scrub config.discord.botToken, config.telegram.botToken
3. Scrub any field matching `*token*`, `*secret*`, `*password*`
4. Add test for serializer scrubbing

**Acceptance Criteria**:
- [ ] Error serializer removes sensitive fields
- [ ] Connection strings redacted
- [ ] Tests verify scrubbing patterns
- [ ] No tokens visible in test log output

**Effort**: Small (1-2 hours)

---

### TASK-82.2: Implement Distributed Rate Limiting (MED-4)

**Priority**: MEDIUM
**File**: `sietch-service/src/api/middleware.ts`

**Description**:
Current rate limiting is in-memory, not suitable for multi-instance deployment.

**Implementation**:
1. Install `rate-limit-redis` package
2. Configure RedisStore for rate limiters
3. Reduce public limit from 100 to 50 req/min
4. Add fallback to memory store if Redis unavailable
5. Add metrics for rate limit hits

**Acceptance Criteria**:
- [ ] Rate limiters use Redis store when available
- [ ] Graceful fallback to memory store
- [ ] Public limit reduced to 50 req/min
- [ ] Tests verify distributed limiting

**Effort**: Medium (2-3 hours)

---

### TASK-82.3: Add Connection String Redaction (MED-8)

**Priority**: MEDIUM
**File**: `sietch-service/src/infrastructure/logging/`

**Description**:
Database connection strings may be logged with credentials.

**Implementation**:
1. Add redactConnectionString helper function
2. Apply to DATABASE_URL logging
3. Apply to any postgres:// or mysql:// URLs

**Acceptance Criteria**:
- [ ] Connection strings show `***:***` for credentials
- [ ] Applied to all database URL logging
- [ ] Tests verify redaction pattern

**Effort**: Small (1 hour)

---

### TASK-82.4: Add Security Headers (LOW-5)

**Priority**: LOW
**File**: `sietch-service/src/api/server.ts`

**Description**:
Security headers not explicitly set.

**Implementation**:
1. Install helmet package (if not already)
2. Configure helmet middleware
3. Enable all recommended security headers

**Acceptance Criteria**:
- [ ] X-Content-Type-Options: nosniff
- [ ] X-Frame-Options: DENY
- [ ] Strict-Transport-Security enabled
- [ ] Tests verify headers present

**Effort**: Small (30 minutes)

---

## Sprint 83: Cleanup & Hardening

**Goal**: Address remaining low-priority items and documentation

### TASK-83.1: Legacy API Key Sunset Plan (LOW-1)

**Priority**: LOW
**Files**: Config, documentation

**Description**:
Legacy plaintext API keys still supported for backward compatibility.

**Implementation**:
1. Add deprecation date to legacy key validation logging
2. Document 90-day sunset timeline
3. Add metric for legacy key usage
4. Create migration guide for customers

**Acceptance Criteria**:
- [ ] Warning logs include sunset date
- [ ] Migration guide documented
- [ ] Metric tracks legacy key usage count
- [ ] Notification plan for affected users

**Effort**: Small (1-2 hours)

---

### TASK-83.2: Add MFA Verification Metrics (LOW-3)

**Priority**: LOW
**File**: `sietch-service/src/packages/security/NaibSecurityGuard.ts`

**Description**:
MFA failures logged but not aggregated for monitoring.

**Implementation**:
1. Add metrics increment for MFA success/failure
2. Include userId and operation tags
3. Enable alerting threshold for repeated failures

**Acceptance Criteria**:
- [ ] `mfa.verification.success` metric incremented
- [ ] `mfa.verification.failure` metric with user/operation tags
- [ ] Alert threshold documented (e.g., 5 failures in 10 min)

**Effort**: Small (1 hour)

---

### TASK-83.3: Example Value Validation (LOW-2)

**Priority**: LOW
**File**: `sietch-service/src/config.ts`

**Description**:
Developers may forget to change placeholder secrets.

**Implementation**:
1. Add refine() validation rejecting example patterns
2. Check for `your_*_here`, `CHANGE_ME`, `example`
3. Only enforce in production mode

**Acceptance Criteria**:
- [ ] Startup rejects `your_*_here` pattern values
- [ ] Startup rejects `CHANGE_ME` values
- [ ] Only enforced when NODE_ENV=production
- [ ] Tests verify rejection patterns

**Effort**: Small (1 hour)

---

### TASK-83.4: Security Documentation Update

**Priority**: LOW
**Files**: Documentation

**Description**:
Update security documentation with new controls.

**Implementation**:
1. Update SECURITY.md with new controls
2. Document incident response procedure
3. Create secrets rotation runbook
4. Update deployment checklist

**Acceptance Criteria**:
- [ ] SECURITY.md updated with all new controls
- [ ] Incident response procedure documented
- [ ] Secrets rotation runbook created
- [ ] Deployment checklist reflects all audit items

**Effort**: Medium (2 hours)

---

## Risk Assessment

### Mitigated by Sprint 80
- CRITICAL billing authentication bypass risk
- HIGH webhook replay attacks
- HIGH cross-tenant data leakage potential
- HIGH Vault configuration failures

### Mitigated by Sprint 81
- HIGH configuration injection via env vars
- MEDIUM default credential usage
- MEDIUM Telegram webhook forgery
- MEDIUM browser-based CSRF attacks

### Mitigated by Sprint 82
- MEDIUM credential exposure in logs
- MEDIUM DoS via rate limit evasion
- LOW missing security headers

### Mitigated by Sprint 83
- LOW legacy credential exposure
- LOW monitoring blind spots
- LOW documentation gaps

---

## Success Metrics

After completing all sprints:

| Metric | Before | After |
|--------|--------|-------|
| Critical Findings | 1 | 0 |
| High Findings | 5 | 0 |
| Medium Findings | 8 | 0 |
| Low Findings | 6 | 0 |
| OWASP Score | 7/10 | 10/10 |
| Overall Risk | MEDIUM | LOW |

---

## Next Steps

1. **Start Sprint 80**: `/implement sprint-80`
2. **After Each Sprint**: `/review-sprint sprint-N`
3. **After Sprint 80**: `/audit-sprint sprint-80` (critical fixes)
4. **After Sprint 83**: Full `/audit` for final verification

---

**Plan Created**: January 14, 2026
**Estimated Total Effort**: 16-24 hours across 4 sprints
**Target Completion**: Production-ready security posture

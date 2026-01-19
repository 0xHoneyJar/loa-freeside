# Security Audit Report: Arrakis Worker Application

**Audit Date:** January 15, 2026
**Auditor:** Paranoid Cypherpunk Security Auditor
**Scope:** Arrakis Worker Application (Discord Bot - Gateway Proxy Pattern)
**Codebase Version:** feature/gateway-proxy-pattern branch (commit 04b3176)

## Executive Summary

### Overall Risk Level: **MEDIUM**

The Arrakis worker application demonstrates good security fundamentals with proper secrets management patterns and secure architecture decisions. However, several **HIGH** and **MEDIUM** priority vulnerabilities require immediate attention, particularly around dependency management, authorization controls, and input validation.

**Key Findings:**
- ✅ **GOOD**: No hardcoded secrets found in codebase
- ✅ **GOOD**: Proper environment variable handling with validation
- ✅ **GOOD**: SQL injection protection via parameterized queries
- ⚠️ **HIGH**: Vulnerable dependencies (undici, esbuild) with known CVEs
- ⚠️ **HIGH**: Missing authorization checks on admin commands
- ⚠️ **MEDIUM**: Insufficient input validation on user-provided data
- ⚠️ **MEDIUM**: Potential for sensitive data exposure in logs
- ⚠️ **MEDIUM**: Database credentials hardcoded in ScyllaDB configuration

---

## Findings by Severity

### CRITICAL (0 findings)
None identified.

### HIGH (2 findings)

#### H-1: Vulnerable Dependencies with Known CVEs

**Location:** `/apps/worker/package.json`
**Risk:** Exploitable vulnerabilities in production dependencies

**Description:**
The npm audit revealed moderate severity vulnerabilities:

1. **undici <6.23.0** (used by @discordjs/rest)
   - CVE: GHSA-g9mf-h72j-4rw9
   - Issue: Unbounded decompression chain in HTTP responses leading to resource exhaustion
   - Attack Vector: Malicious Discord API responses could cause DoS

2. **esbuild <=0.24.2** (used by vitest/vite)
   - CVE: GHSA-67mh-4wv8-2f99
   - Issue: Development server can be exploited to read responses from any website
   - Note: This is primarily a dev dependency concern but should still be addressed

**Exploitation Scenario:**
An attacker controlling Discord API responses (via MITM or compromised Discord infrastructure) could send crafted compressed payloads causing the worker to consume excessive memory/CPU, leading to service disruption.

**Remediation:**
```bash
# Update @discordjs/rest to version that includes undici >=6.23.0
npm update @discordjs/rest

# For esbuild (dev-only), update vitest
npm update vitest --save-dev
```

**Priority:** HIGH - Fix before production deployment

---

#### H-2: Missing Authorization Verification on Admin Commands

**Location:** `/apps/worker/src/handlers/commands/admin-badge.ts:10`, `/apps/worker/src/handlers/commands/admin-stats.ts:10`

**Risk:** Unauthorized users could execute privileged operations

**Description:**
The admin command handlers rely entirely on Discord's permission checks without server-side verification. While the comment states "requires administrator permissions (checked by Discord)", there is no validation in the worker code that the interaction actually came from an administrator.

```typescript
// admin-badge.ts line 10
// Admin only - requires administrator permissions (checked by Discord).
// BUT: No actual verification in handler code!

export function createAdminBadgeHandler(discord: DiscordRestService) {
  return async function handleAdminBadge(
    payload: DiscordEventPayload,
    logger: Logger
  ): Promise<ConsumeResult> {
    // Missing: if (!payload.member?.permissions.includes('ADMINISTRATOR')) { ... }
```

**Attack Scenario:**
1. Attacker compromises the NATS message queue or gateway
2. Crafts a malicious `commands.admin-badge` message with arbitrary userId
3. Awards themselves badges, views admin stats, or performs other privileged operations

**Remediation:**
Add authorization verification in admin handlers:

```typescript
// Verify administrator permission
if (!payload.member?.permissions || !(payload.member.permissions & 0x8)) {
  await discord.editOriginal(interactionToken, {
    embeds: [createErrorEmbed('Insufficient permissions. Administrator role required.')],
  });
  return 'ack';
}
```

**Priority:** HIGH - Implement before production deployment

---

### MEDIUM (5 findings)

#### M-1: Database Credentials in Configuration Object

**Location:** `/apps/worker/src/infrastructure/scylla/scylla-client.ts:45-47`

**Risk:** Database credentials stored in memory as plain text

**Description:**
ScyllaDB credentials are passed through constructor and stored in PlainTextAuthProvider:

```typescript
authProvider: new auth.PlainTextAuthProvider(
  mergedConfig.username,
  mergedConfig.password,
),
```

While environment variables are properly used, credentials exist in memory without encryption. If memory is dumped (via debugging, crash dumps, or memory disclosure vulnerabilities), credentials could be exposed.

**Remediation:**
1. Use AWS Secrets Manager or similar for credential rotation
2. Implement credential encryption at rest
3. Clear credentials from memory after connection establishment (if supported by driver)

**Priority:** MEDIUM - Implement credential rotation infrastructure

---

#### M-2: Insufficient Input Validation on User-Provided Strings

**Location:** Multiple handlers, e.g., `/apps/worker/src/handlers/commands/badges.ts`, `/apps/worker/src/handlers/commands/profile.ts`

**Risk:** Potential for injection attacks or application logic bypass

**Description:**
User-provided strings (nym, badge names, etc.) are used without thorough validation:

```typescript
// profile.ts line 114
const targetNym = nymOption?.value;
// Used directly in database query without length/format validation

// badges.ts - autocomplete
const query = focusedOption.value.toLowerCase();
const filtered = badges.filter(
  b => b.name.toLowerCase().includes(query) || b.badgeId.toLowerCase().includes(query)
);
```

While SQL injection is prevented by Drizzle ORM parameterization, issues remain:
- No maximum length enforcement (could cause DoS via large inputs)
- No character whitelist (special characters could cause rendering issues)
- No normalization (unicode homograph attacks possible)

**Exploitation Scenarios:**
1. **DoS**: Submit 10MB string as nym, causing memory exhaustion
2. **Display spoofing**: Use Unicode lookalikes to impersonate users (e.g., "Admin" vs "Αdmin")
3. **Logic bypass**: Use SQL wildcards (`%`, `_`) in ILIKE queries to enumerate data

**Remediation:**
Implement input validation layer:

```typescript
function validateNym(nym: string): { valid: boolean; error?: string } {
  // Length check
  if (nym.length > 32) {
    return { valid: false, error: 'Nym must be 32 characters or less' };
  }

  // Character whitelist (alphanumeric + basic punctuation)
  if (!/^[a-zA-Z0-9_\-\s]+$/.test(nym)) {
    return { valid: false, error: 'Nym contains invalid characters' };
  }

  // Unicode normalization to prevent homograph attacks
  if (nym !== nym.normalize('NFC')) {
    return { valid: false, error: 'Nym contains invalid unicode' };
  }

  return { valid: true };
}
```

**Priority:** MEDIUM - Implement validation layer

---

#### M-3: Sensitive Data Logging Risks

**Location:** Multiple files with `logger.info()` and `logger.debug()` calls

**Risk:** Sensitive data exposure through logs

**Description:**
Throughout the codebase, logger calls include potentially sensitive data:

```typescript
// main-nats.ts:57
logger.info({ env: config.nodeEnv }, 'Configuration loaded');
// What if config accidentally includes secrets?

// handlers/commands/admin-badge.ts:199
logger.info({ profileId: profile.id, badgeId, reason }, 'Admin awarded badge');
// Logs badge award reason (could contain PII)

// consumers/CommandNatsConsumer.ts:97-105
this.log.info({
  eventId: event_id,
  guildId: guild_id,
  userId: user_id,  // PII
  command: command_name,
}, 'Processing command');
```

**Concerns:**
1. Discord user IDs (PII under GDPR/CCPA) logged extensively
2. Guild IDs could reveal private server membership
3. No log sanitization for sensitive fields
4. Debug logs could expose tokens if logging level misconfigured

**Remediation:**
1. Implement log sanitization middleware:
```typescript
// Create pino serializer to redact sensitive fields
const logger = pino({
  level: env.LOG_LEVEL,
  serializers: {
    userId: (userId) => userId ? `user_${hash(userId).slice(0, 8)}` : null,
    guildId: (guildId) => guildId ? `guild_${hash(guildId).slice(0, 8)}` : null,
  },
});
```

2. Add explicit redaction for tokens:
```typescript
// Never log interactionToken or any field containing "token", "secret", "key"
```

3. Review all `logger.debug()` calls - these are dangerous in production

**Priority:** MEDIUM - Implement log sanitization

---

#### M-4: Missing Rate Limiting on Command Execution

**Location:** `/apps/worker/src/consumers/CommandNatsConsumer.ts`

**Risk:** Resource exhaustion via command spam

**Description:**
While cooldowns exist (`StateManager.setCooldown`), there's no per-guild or per-user rate limiting enforced at the consumer level. An attacker could:

1. Rapidly invoke multiple different commands (each has separate cooldown)
2. Exhaust database connection pools
3. Cause Redis overload
4. Trigger Discord API rate limits affecting all users

**Attack Scenario:**
Attacker creates bot accounts in target guild and simultaneously executes:
- `/stats` (no cooldown visible in code)
- `/profile view`
- `/leaderboard conviction`
- `/threshold`
- `/position`

Result: 5 DB queries per user per second = 500 queries/sec with 100 users.

**Remediation:**
Implement global rate limiter in CommandNatsConsumer:

```typescript
async processMessage(payload: InteractionPayload, _msg: JsMsg): Promise<ProcessResult> {
  const { user_id, guild_id } = payload;

  // Check guild-wide rate limit (100 commands/sec)
  const guildCount = await this.rateLimiter.check(`guild:${guild_id}`, 1000, 100);
  if (guildCount > 100) {
    // Send rate limit error to user
    return { success: false, retryable: false };
  }

  // Check per-user rate limit (5 commands/sec)
  const userCount = await this.rateLimiter.check(`user:${user_id}`, 1000, 5);
  if (userCount > 5) {
    return { success: false, retryable: false };
  }

  // ... continue processing
}
```

**Priority:** MEDIUM - Implement before scaling to 10k+ guilds

---

#### M-5: Incomplete Error Handling Could Leak Information

**Location:** Multiple handler files

**Risk:** Information disclosure through error messages

**Description:**
Error handling in handlers sometimes exposes internal details:

```typescript
// config.ts:118
throw new Error(`Configuration validation failed:\n${errors.join('\n')}`);
// Exposes environment variable names and validation details

// data/database.ts - various functions
// Error objects passed to logger could contain stack traces, query details
```

Generic error messages shown to users are good, but errors logged could still be accessed by attackers with log access.

**Remediation:**
1. Sanitize error objects before logging:
```typescript
logger.error({
  error: { message: error.message, code: error.code },
  // Don't log: stack, query, connection details
}, 'Database error');
```

2. Add error categorization:
```typescript
enum ErrorCategory {
  CLIENT_ERROR = 'client',
  SERVER_ERROR = 'server',
  EXTERNAL_ERROR = 'external',
}

function categorizeError(error: Error): ErrorCategory {
  // Return appropriate category
}
```

**Priority:** MEDIUM - Implement error sanitization

---

### LOW (3 findings)

#### L-1: Unbounded Array Allocations

**Location:** `/apps/worker/src/data/database.ts:317` (getProfilesByRank)

**Risk:** Memory exhaustion via large result sets

**Description:**
```typescript
export async function getProfilesByRank(
  communityId: string,
  limit: number = 100
): Promise<schema.Profile[]> {
  // No maximum limit enforcement
  // Caller could pass limit=999999999
```

**Remediation:**
```typescript
export async function getProfilesByRank(
  communityId: string,
  limit: number = 100
): Promise<schema.Profile[]> {
  const safeLimit = Math.min(Math.max(1, limit), 1000); // Cap at 1000
  return db
    .select()
    .from(schema.profiles)
    .where(eq(schema.profiles.communityId, communityId))
    .orderBy(desc(schema.profiles.convictionScore))
    .limit(safeLimit); // Use capped limit
}
```

**Priority:** LOW - Add limits to all pagination functions

---

#### L-2: Missing Dockerfile Security Hardening

**Location:** `/apps/worker/Dockerfile:53`

**Risk:** Container escape potential

**Description:**
Dockerfile is well-structured with non-root user, but missing:
- Read-only root filesystem
- Capability dropping
- Security options

**Remediation:**
Update deployment manifests (not Dockerfile) to include:
```yaml
securityContext:
  runAsNonRoot: true
  runAsUser: 1001
  allowPrivilegeEscalation: false
  capabilities:
    drop:
      - ALL
  readOnlyRootFilesystem: true
```

**Priority:** LOW - Add to Kubernetes manifests

---

#### L-3: NATS Connection Without TLS Verification

**Location:** `/apps/worker/src/services/NatsClient.ts:177`

**Risk:** MITM attacks on NATS communication

**Description:**
NATS connection doesn't enforce TLS:
```typescript
this.connection = await connect({
  servers: this.config.servers,
  // Missing: tls: { rejectUnauthorized: true }
  name: this.config.name || `arrakis-worker-${podName}`,
  reconnect: true,
});
```

If NATS_URL uses `nats://` instead of `tls://`, connections are unencrypted.

**Remediation:**
1. Enforce TLS in production:
```typescript
const isTLS = this.config.servers.some(s => s.startsWith('tls://'));
if (process.env.NODE_ENV === 'production' && !isTLS) {
  throw new Error('NATS TLS required in production');
}
```

2. Use `tls://` URLs in production environment configuration

**Priority:** LOW - Enforce for production deployment

---

## Security Checklist

### Secrets Management ✅
- [x] No hardcoded credentials in source code
- [x] Environment variables used for secrets
- [x] `.env*` files in `.gitignore`
- [x] Configuration validation with Zod
- [ ] ⚠️ Credential rotation mechanism not implemented
- [ ] ⚠️ Secrets manager integration missing (AWS Secrets Manager recommended)

### Authentication & Authorization ⚠️
- [x] Discord bot token properly managed
- [x] Interaction tokens used correctly (no bot token in responses)
- [ ] ❌ **Admin command authorization not verified server-side** (H-2)
- [x] Database credentials in environment variables
- [ ] ⚠️ PlainTextAuthProvider for ScyllaDB (M-1)

### Input Validation ⚠️
- [x] SQL injection protected via Drizzle ORM parameterized queries
- [ ] ⚠️ **Insufficient validation on user strings** (M-2)
- [ ] ⚠️ **No maximum length enforcement** (M-2)
- [ ] ⚠️ **Unicode normalization missing** (M-2)
- [x] Command routing via registry pattern (no eval/exec)

### Data Privacy & Logging ⚠️
- [ ] ⚠️ **User IDs logged extensively** (M-3)
- [ ] ⚠️ **No log sanitization** (M-3)
- [x] Ephemeral messages used for sensitive data (admin commands)
- [x] No PII in database queries (parameterized)
- [ ] Missing data retention policy documentation

### Infrastructure Security ⚠️
- [ ] ⚠️ **NATS TLS not enforced** (L-3)
- [x] Database connection pooling configured
- [x] Redis authentication via URL
- [ ] ⚠️ **Rate limiting incomplete** (M-4)
- [x] Health checks implemented
- [x] Graceful shutdown handlers

### Dependency Security ❌
- [ ] ❌ **Vulnerable undici version** (H-1)
- [ ] ❌ **Vulnerable esbuild version** (H-1)
- [ ] Regular dependency audits not automated
- [ ] Dependabot not configured

### Container Security ⚠️
- [x] Non-root user in Dockerfile
- [x] Multi-stage build
- [x] Minimal base image (alpine)
- [ ] ⚠️ Read-only filesystem not enforced (L-2)
- [ ] ⚠️ Capabilities not dropped (L-2)

---

## Recommendations Priority Matrix

| Priority | Finding | Impact | Effort | Timeline |
|----------|---------|--------|--------|----------|
| 1 | H-1: Vulnerable Dependencies | HIGH | LOW | Immediate |
| 2 | H-2: Admin Authorization | HIGH | MEDIUM | Before production |
| 3 | M-4: Rate Limiting | MEDIUM | MEDIUM | Before scaling |
| 4 | M-2: Input Validation | MEDIUM | MEDIUM | Next sprint |
| 5 | M-3: Log Sanitization | MEDIUM | LOW | Next sprint |
| 6 | M-1: Credential Management | MEDIUM | HIGH | Next quarter |
| 7 | M-5: Error Handling | MEDIUM | LOW | Next sprint |
| 8 | L-1: Array Bounds | LOW | LOW | Backlog |
| 9 | L-2: Container Hardening | LOW | LOW | Backlog |
| 10 | L-3: NATS TLS | LOW | LOW | Before production |

---

## Positive Security Practices Observed

1. **Excellent Configuration Management**
   - Zod validation for all environment variables
   - Clear separation of concerns (config.ts)
   - Type-safe configuration access

2. **Strong SQL Injection Protection**
   - Drizzle ORM with parameterized queries throughout
   - No string concatenation in queries
   - Type-safe database access

3. **Good Docker Practices**
   - Multi-stage builds to minimize attack surface
   - Non-root user execution
   - Health checks implemented

4. **Proper Error Handling Architecture**
   - Try-catch blocks in all async operations
   - Graceful degradation
   - User-friendly error messages

5. **Code Organization**
   - Clear separation between handlers, services, and data layers
   - Type-safe with TypeScript
   - Consistent logging patterns

---

## Remediation Roadmap

### Phase 1: Critical & High (Week 1-2)
1. Update dependencies (npm update)
2. Implement admin authorization checks
3. Add npm audit to CI/CD pipeline

### Phase 2: Medium Priority (Week 3-4)
4. Implement input validation layer
5. Add log sanitization middleware
6. Deploy rate limiting at consumer level

### Phase 3: Infrastructure (Month 2)
7. Configure AWS Secrets Manager
8. Implement credential rotation
9. Add Kubernetes security contexts

### Phase 4: Hardening (Month 3)
10. Comprehensive error handling review
11. Add automated security scanning
12. Penetration testing engagement

---

## Testing Recommendations

### Security Testing Checklist
1. **Dependency Scanning**
   - Automate `npm audit` in CI/CD
   - Configure Snyk or similar tool
   - Set up GitHub Dependabot alerts

2. **Static Analysis**
   - Run Semgrep with security ruleset
   - Enable ESLint security plugins
   - Add pre-commit hooks

3. **Dynamic Testing**
   - Fuzz test command handlers
   - Attempt SQL injection on all inputs
   - Test rate limiting thresholds
   - Verify authorization on admin endpoints

4. **Infrastructure Testing**
   - Scan container images with Trivy
   - Verify network policies in K8s
   - Test secret rotation procedures

---

## Conclusion

The Arrakis worker application demonstrates **good foundational security practices** with proper secrets management and SQL injection protection. However, the identified **HIGH** priority issues around dependency vulnerabilities and authorization checks must be addressed before production deployment.

The **MEDIUM** risk findings around input validation, logging, and rate limiting should be addressed before scaling to handle 10,000+ guilds as specified in the architecture.

**Recommended Actions:**
1. ✅ **APPROVE for staging** with HIGH priority fixes in progress
2. ⚠️ **BLOCK production deployment** until H-1 and H-2 are resolved
3. 📋 **Track MEDIUM findings** in sprint backlog for Q1 2026

**Overall Assessment:** The security posture is **adequate for continued development** but requires **targeted improvements before production readiness**.

---

**Report Status:** COMPLETE
**Next Review:** After HIGH priority fixes implemented
**Contact:** security@0xhoneyjar.xyz

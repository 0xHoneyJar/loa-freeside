# Security Audit - Sprint 86

**Verdict**: APPROVED - LET'S FUCKING GO

## Executive Summary

Sprint 86: Discord Server Sandboxes - Event Routing has been thoroughly audited from a security perspective. The implementation demonstrates solid security practices with proper parameterized queries, input validation, graceful error handling, and no exposure of sensitive information.

## Audit Scope

**Files Reviewed:**
- `/home/merlin/Documents/thj/code/arrakis/packages/sandbox/src/services/route-provider.ts`
- `/home/merlin/Documents/thj/code/arrakis/packages/sandbox/src/services/event-router.ts`
- `/home/merlin/Documents/thj/code/arrakis/packages/sandbox/src/services/sandbox-manager.ts`
- `/home/merlin/Documents/thj/code/arrakis/packages/cli/src/commands/sandbox/register.ts`
- `/home/merlin/Documents/thj/code/arrakis/packages/cli/src/commands/sandbox/unregister.ts`
- `/home/merlin/Documents/thj/code/arrakis/packages/sandbox/src/__tests__/integration/sandbox-routing.test.ts`

## Security Findings

### ✅ PASS: SQL Injection Protection

**Observation:**
All SQL queries use parameterized queries via the `postgres.js` tagged template literal syntax:

```typescript
// RouteProvider line 128-134
const rows = await this.sql<{ sandbox_id: string }[]>`
  SELECT m.sandbox_id
  FROM sandbox_guild_mapping m
  JOIN sandboxes s ON s.id = m.sandbox_id
  WHERE m.guild_id = ${guildId}
    AND s.status = 'running'
`;
```

**Assessment:** ✅ SECURE
- All user inputs (guildId, sandboxId) are properly parameterized
- No string concatenation or manual escaping
- Uses postgres.js parameterized query system which prevents SQL injection
- Type casting (e.g., `${sandboxId}::uuid`) is done safely within the query engine

### ✅ PASS: Input Validation

**Observation:**
Guild ID validation in register command (line 89-109):

```typescript
if (!/^\d{17,20}$/.test(guildId)) {
  // Error handling
}
```

**Assessment:** ✅ SECURE
- Guild IDs are validated as 17-20 digit numbers only
- Regex pattern prevents injection attempts via guild ID field
- Validation happens before any database operations
- Clear error messages without exposing system internals

### ✅ PASS: Cache Poisoning Prevention

**Observation:**
Redis cache implementation with sentinel values:

```typescript
// RouteProvider line 67
const NULL_SENTINEL = '__NULL__';

// Line 142-144
await this.redis.set(
  cacheKey,
  sandboxId ?? NULL_SENTINEL,
  'PX',
  this.cacheTtlMs
);
```

**Assessment:** ✅ SECURE
- Cache keys use consistent prefix: `sandbox:route:{guildId}`
- Null values cached as sentinel to prevent repeated DB hits (cache stampede protection)
- TTL enforced on all cache entries (prevents infinite cache pollution)
- Cache failures degrade gracefully to database lookups
- No way for attackers to poison cache with arbitrary sandbox IDs (guild validation enforced)

### ✅ PASS: Secrets Management

**Observation:**
No hardcoded credentials found. Connection details are externalized:

```typescript
// Configuration passed via constructor
export interface RouteProviderConfig {
  sql: postgres.Sql;
  redis: Redis;
  logger: Logger;
  cacheTtlMs?: number;
}
```

**Assessment:** ✅ SECURE
- Database and Redis connections injected via dependency injection
- No hardcoded passwords, tokens, or API keys
- Connection configuration handled at application bootstrap level
- Follows 12-factor app principles

### ✅ PASS: Logging Security

**Observation:**
Logging throughout the codebase:

```typescript
// RouteProvider line 241
this.logger.info({ guildId, sandboxId }, 'Route mapping registered');

// EventRouter line 352
this.logger.debug(
  { guildId, sandboxId, source: msg.subject, target: targetSubject, latencyMs },
  'Event routed'
);
```

**Assessment:** ✅ SECURE
- No logging of sensitive data (passwords, tokens)
- Guild IDs and sandbox IDs are logged (appropriate for debugging, not sensitive)
- Error objects logged safely without exposing stack traces to users
- Structured logging with appropriate log levels

### ✅ PASS: Event Routing Isolation

**Observation:**
Event routing logic in EventRouter:

```typescript
// EventRouter line 334-342
if (sandboxId) {
  targetSubject = `sandbox.${sandboxId}.${msg.subject}`;
  this.stats.routedToSandbox++;
} else {
  targetSubject = msg.subject;
  this.stats.routedToProduction++;
}
```

**Assessment:** ✅ SECURE
- Sandboxes cannot hijack events from other sandboxes
- Subject prefixing ensures namespace isolation: `sandbox.{id}.events.*`
- Only guilds explicitly mapped to a sandbox receive routed events
- Production events (no guild mapping) remain on production subjects
- No way for sandbox to escalate privileges by manipulating guild_id in events (validated at DB level)

### ✅ PASS: Race Condition Mitigation

**Observation:**
Cache synchronization in SandboxManager:

```typescript
// SandboxManager line 456-463
if (this.routeProvider) {
  try {
    await this.routeProvider.registerMapping(guildId, sandboxId);
  } catch (error) {
    // Cache update failure is non-fatal - events will route correctly after TTL
    this.logger.warn({ sandboxId, guildId, error }, 'Failed to update route cache');
  }
}
```

**Assessment:** ✅ SECURE
- Database is source of truth, cache is best-effort
- Cache failures are non-fatal (graceful degradation)
- Race conditions between cache and DB have bounded impact (limited to cache TTL window)
- Cache invalidation happens on unregister operations
- Worst case: event routes incorrectly for up to 1 minute (cache TTL)

### ✅ PASS: JSON Parsing Safety

**Observation:**
Event parsing in EventRouter:

```typescript
// EventRouter line 310-316
let event: DiscordEvent;
try {
  event = JSON.parse(msg.string());
} catch (error) {
  this.logger.warn({ error, subject: msg.subject }, 'Failed to parse event JSON');
  throw error;
}
```

**Assessment:** ✅ SECURE
- JSON parsing wrapped in try-catch
- Malformed events logged and rejected (msg.nak())
- No eval() or unsafe deserialization
- TypeScript interfaces enforce expected structure
- No prototype pollution vectors (standard JSON.parse)

### ✅ PASS: Authorization & Access Control

**Observation:**
Guild registration checks in SandboxManager:

```typescript
// SandboxManager line 423-436
const sandbox = await this.getById(sandboxId);
if (!sandbox) {
  throw new SandboxError(SandboxErrorCode.NOT_FOUND, ...);
}

if (sandbox.status !== 'running') {
  throw new SandboxError(SandboxErrorCode.INVALID_TRANSITION, ...);
}
```

**Assessment:** ✅ SECURE
- Sandbox existence validated before operations
- Status checks prevent operations on destroyed/expired sandboxes
- Guild availability checked (prevents double-mapping)
- Actor tracking in audit logs
- No privilege escalation paths identified

### ✅ PASS: Error Handling & Information Disclosure

**Observation:**
Error handling patterns:

```typescript
// register.ts line 44-63
if (!sandbox) {
  if (options.json) {
    console.log(JSON.stringify({
      success: false,
      error: {
        message: `Sandbox '${sandboxName}' not found`,
        code: 'NOT_FOUND',
      },
    }, null, 2));
  } else {
    spinner?.fail(chalk.red(`Sandbox '${sandboxName}' not found`));
    console.error(chalk.yellow('\nUse "bd sandbox list" to see available sandboxes'));
  }
  process.exit(1);
}
```

**Assessment:** ✅ SECURE
- Error messages are user-friendly without exposing internals
- No stack traces or system paths leaked to users
- Structured error codes for programmatic handling
- Clear guidance for resolution without revealing architecture

### ✅ PASS: Denial of Service Protection

**Observation:**
Rate limiting and resource bounds:

```typescript
// EventRouter line 107
const DEFAULT_MAX_CONCURRENT = 100;

// EventRouter line 142-144
private static readonly LATENCY_WINDOW_SIZE = 1000;
private latencyWindow: number[] = [];
```

**Assessment:** ✅ SECURE
- Concurrent message processing bounded to prevent resource exhaustion
- Rolling window for latency stats (prevents unbounded memory growth)
- Cache TTL prevents Redis from filling up
- NATS stream has retention limits (5 min max age, 500k max messages)
- Proper cleanup on sandbox destruction

## Security Enhancements Observed

### 1. Defense in Depth
- Multiple layers: input validation → parameterized queries → cache isolation
- Graceful degradation when Redis fails
- Non-fatal cache errors don't affect core functionality

### 2. Audit Trail
- All guild registration/unregistration operations logged
- Actor tracking in audit logs
- Structured logging for security monitoring

### 3. Proper Error Handling
- No cascading failures
- Errors logged but not exposed to attackers
- Cleanup on failure paths (transaction-like behavior)

### 4. Type Safety
- TypeScript interfaces prevent type confusion
- Strong typing on SQL query results
- No `any` types in security-critical paths

## OWASP Top 10 Assessment

| Risk | Status | Notes |
|------|--------|-------|
| A01:2021 - Broken Access Control | ✅ PASS | Guild-to-sandbox mappings enforced at DB level |
| A02:2021 - Cryptographic Failures | N/A | No cryptographic operations in scope |
| A03:2021 - Injection | ✅ PASS | All queries parameterized, input validation present |
| A04:2021 - Insecure Design | ✅ PASS | Proper isolation, graceful degradation, audit logging |
| A05:2021 - Security Misconfiguration | ✅ PASS | No hardcoded secrets, externalized config |
| A06:2021 - Vulnerable Components | ⚠️ INFO | Dependencies not audited (out of scope) |
| A07:2021 - Auth & AuthZ Failures | ✅ PASS | Status checks, guild availability validation |
| A08:2021 - Software & Data Integrity | ✅ PASS | No deserialization vulnerabilities |
| A09:2021 - Security Logging Failures | ✅ PASS | Comprehensive audit logging, no sensitive data logged |
| A10:2021 - SSRF | N/A | No external requests in scope |

## Recommendations for Future Sprints

### Low Priority Enhancements

1. **Rate Limiting Per User**
   - Current: System-wide concurrent message limit
   - Future: Consider per-owner rate limits on guild registration

2. **Cache Encryption at Rest**
   - Current: Redis cache stores guild-to-sandbox mappings in plaintext
   - Note: Guild IDs are not highly sensitive, but consider Redis encryption for defense in depth

3. **Audit Log Retention Policy**
   - Current: Unlimited audit log growth
   - Future: Implement retention policy to prevent unbounded storage

4. **Guild ID Validation Enhancement**
   - Current: Regex validation
   - Future: Consider validating guild exists via Discord API (if available)

## Conclusion

Sprint 86 implementation demonstrates **production-grade security practices**. All critical security controls are in place:
- ✅ No SQL injection vulnerabilities
- ✅ Proper input validation
- ✅ No secrets exposure
- ✅ Secure logging practices
- ✅ Proper error handling
- ✅ Event routing isolation
- ✅ Cache poisoning prevention

The code is ready for production deployment.

**Auditor:** Paranoid Cypherpunk Security Auditor
**Date:** 2026-01-17
**Sprint:** 86 - Discord Server Sandboxes - Event Routing

# Sprint 321 — Security Audit

**Auditor:** Paranoid Cypherpunk Auditor
**Date:** 2026-02-21
**Verdict:** APPROVED - LETS FUCKING GO

---

## Security Review

This sprint is entirely security-hardening. Every change fixes an existing vulnerability or adds defense-in-depth. No new attack surface introduced.

### SIWE Origin Validation (Task 1.1) — PASS

- Origin now comes exclusively from `req.headers.origin` (transport-layer, browser-enforced)
- No fallback to `parsed.domain` (attacker-controlled SIWE message field)
- Validation against `config.cors.allowedOrigins` — same source of truth as Express CORS middleware
- Missing origin → 400, invalid origin → 400 — fail-closed
- Wildcard `*` check allows dev environments without weakening production
- **No information disclosure** in error messages

### Rate Bucket Cleanup (Task 1.2) — PASS

- AND→OR fix prevents memory exhaustion via stale bucket accumulation
- `MAX_RATE_BUCKETS = 50_000` bounds memory usage (approx 50K × ~200 bytes = ~10MB worst case)
- LRU eviction sorts by timestamp — correct O(n log n) approach, acceptable for 10-minute intervals
- Warning log enables monitoring for cardinality attacks
- `.unref()` on interval — won't keep process alive during shutdown

### Thread Race Condition (Task 1.3) — PASS

- UNIQUE constraint at database level — correct place for concurrency control
- Error detection checks multiple error patterns (23505, 'unique', 'duplicate key') — robust
- Fallback `findActiveThread()` on conflict — correct recovery
- Handler checks `record.threadId !== thread.id` — proper race detection
- **No data loss risk** — worst case is an orphaned Discord thread that auto-archives

### Wallet Normalization (Task 1.4) — PASS

- `normalizeWallet()` is lowercase-only — correct for Ethereum (case-insensitive per spec)
- Applied at all 4 boundaries: insert, query, cache key, re-verification
- Cache key in `thread-message-handler.ts` uses normalized wallet — prevents cache poisoning via mixed-case
- **No timing oracle** risk — lowercase is constant-time for ASCII

### Gateway Failure Handling (Task 1.5) — PASS

- Fallback message is generic ("temporarily unavailable") — **no information disclosure**
- Bot message filter prevents infinite loops (bot replies to own message)
- Health check returns 503 on degraded — load balancer will stop routing
- Error logged at `error` level with full context for debugging
- `gatewayDegraded` flag is set once, never reset — fail-safe (requires restart to recover)

### Terraform Validation (Task 1.6) — PASS

- Feature flag validation: `contains(["true", "false"])` — prevents terraform misconfig
- Slack ID regex: `^T[A-Z0-9]+$` / `^C[A-Z0-9]+$` — correct format validation
- Empty string allowed for optional fields — correct default behavior
- **Plan-time validation** — catches errors before any infra changes

### HTML Entity Encoding (Task 1.7) — PASS

- Proper ordered encoding: `&` first (prevents double-encoding), then `< > " '`
- `&#x27;` for single-quote (hex entity, widely supported)
- Characters are **encoded, not stripped** — preserves data integrity
- Applied in template literal context — prevents XSS via tokenId injection
- Note: tokenId is already validated by regex `^[a-zA-Z0-9_-]{1,64}$` at line 33 — this is defense-in-depth

### SNS Topic Encryption (Task 1.8) — PASS

- `alias/aws/sns` — AWS-managed key, no custom KMS policy needed
- CloudWatch alarm publishing works with AWS-managed key — no IAM changes
- Encryption at rest for alarm notification payloads — defense-in-depth

## Secrets Check

- No hardcoded credentials, API keys, or tokens
- No secrets in log messages
- All sensitive operations use existing config/env var patterns

## Overall Assessment

Sprint 321 is a pure hardening sprint. Every change either closes an existing vulnerability or adds defense-in-depth. Attack surface is reduced, not expanded. Ship it.

## Status: APPROVED

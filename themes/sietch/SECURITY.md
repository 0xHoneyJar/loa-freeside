# Security Documentation

Last Updated: January 14, 2026 (Sprint 83)

## Table of Contents

1. [Security Controls](#security-controls)
2. [Secrets Management](#secrets-management)
3. [API Key Security](#api-key-security)
4. [MFA (Multi-Factor Authentication)](#mfa-multi-factor-authentication)
5. [Rate Limiting](#rate-limiting)
6. [Incident Response](#incident-response)
7. [Secrets Rotation Runbook](#secrets-rotation-runbook)
8. [Deployment Checklist](#deployment-checklist)

---

## Security Controls

### Authentication & Authorization

| Control | Status | Sprint | Description |
|---------|--------|--------|-------------|
| Bcrypt API Keys | Active | 73 | API keys hashed with bcrypt (12 rounds) |
| Legacy Key Sunset | April 14, 2026 | 83 | Plaintext keys deprecated, 90-day sunset |
| MFA for Destructive Ops | Active | 47 | TOTP/backup codes required for delete operations |
| Row-Level Security | Active | 70 | PostgreSQL RLS for tenant isolation |
| Rate Limiting | Active | 82 | Distributed rate limiting with Redis |

### Data Protection

| Control | Status | Sprint | Description |
|---------|--------|--------|-------------|
| PII Log Scrubbing | Active | 75, 82 | Wallet addresses, IPs, bot tokens redacted |
| Connection String Redaction | Active | 82 | Database passwords never logged |
| Audit Log Persistence | Active | 50 | Signed audit logs with 90-day retention |
| Webhook Signature Validation | Active | 73, 80 | HMAC-SHA256 for Paddle webhooks |

### Network Security

| Control | Status | Sprint | Description |
|---------|--------|--------|-------------|
| Security Headers | Active | 73 | Helmet.js with CSP, HSTS, X-Frame-Options |
| CORS Configuration | Active | 81 | Configurable allowed origins |
| TLS Required | Active | - | HTTPS enforced via HSTS |

---

## Secrets Management

### Environment Variables

All secrets are configured via environment variables. In production, consider migrating to HashiCorp Vault (`FEATURE_VAULT_ENABLED=true`).

**Required Secrets:**

| Variable | Description | Min Length |
|----------|-------------|------------|
| `API_KEY_PEPPER` | HMAC key for API key hashing | 32 chars |
| `DISCORD_BOT_TOKEN` | Discord bot authentication | - |
| `PADDLE_WEBHOOK_SECRET` | Webhook signature verification | - |
| `DATABASE_URL` | PostgreSQL connection string | - |

**Optional but Recommended:**

| Variable | Description |
|----------|-------------|
| `RATE_LIMIT_SALT` | Salt for IP hashing in rate limit logs |
| `WEBHOOK_SECRET` | KillSwitch protocol authentication |
| `DUO_SECRET_KEY` | Duo MFA integration |

### Example Value Rejection (Sprint 83)

Production deployments reject placeholder values:
- `your_*_here` (e.g., `your_token_here`)
- `changeme`, `change_me`
- `example`, `placeholder`
- `xxx`, `test_secret`

---

## API Key Security

### Bcrypt-Hashed Keys (Recommended)

Generate secure API keys:

```bash
npx tsx scripts/generate-api-key.ts admin-name
```

Output includes:
- Plaintext key (store securely, shown once)
- Bcrypt hash (add to `ADMIN_API_KEYS`)
- Key hint (for logging/debugging)

### Legacy Plaintext Keys (Deprecated)

**Sunset Date: April 14, 2026**

Legacy keys are supported for backward compatibility but:
- Log deprecation warnings with each use
- Usage count tracked via `sietch_legacy_api_key_usage_total` metric
- Will be disabled after sunset date

### Migration Guide

1. Generate new bcrypt-hashed key:
   ```bash
   npx tsx scripts/generate-api-key.ts admin-name
   ```

2. Update `ADMIN_API_KEYS` environment variable:
   ```bash
   # Old (plaintext - deprecated)
   ADMIN_API_KEYS=secretkey123:admin

   # New (bcrypt hash)
   ADMIN_API_KEYS=$2b$12$...:admin
   ```

3. Update client applications with new key
4. Remove legacy key after verification

---

## MFA (Multi-Factor Authentication)

### Protected Operations

Operations requiring MFA verification:
- `DELETE_CHANNEL` - Delete Discord channel
- `DELETE_ROLE` - Delete Discord role
- `DELETE_COMMUNITY` - Remove community
- `KILL_SWITCH` - Emergency shutdown
- `VAULT_KEY_ROTATION` - Rotate encryption keys
- `PURGE_DATA` - Data deletion
- `ADMIN_OVERRIDE` - Override community settings

### Verification Methods

1. **TOTP** (Recommended) - Time-based one-time passwords via authenticator app
2. **Backup Codes** - One-time recovery codes

### MFA Metrics (Sprint 83)

Monitor MFA health via metrics:
- `sietch_mfa_verification_success_total` - Successful verifications
- `sietch_mfa_verification_failure_total` - Failed verifications

**Alert Threshold:** 5 failures per user within 10 minutes triggers alert.

---

## Rate Limiting

### Default Limits

| Endpoint Type | Requests | Window |
|---------------|----------|--------|
| Public | 50 | 1 minute |
| Admin | 30 | 1 minute |
| Member | 60 | 1 minute |
| Webhook | 1000 | 1 minute |

### Distributed Rate Limiting (Sprint 82)

When `FEATURE_REDIS_ENABLED=true`, rate limits are shared across instances via Redis. Falls back to per-instance memory store if Redis unavailable.

---

## Incident Response

### Kill Switch Activation

For security incidents requiring immediate action:

```bash
# Via API (requires MFA)
curl -X POST https://api.example.com/admin/killswitch \
  -H "X-API-Key: ak_..." \
  -H "X-TOTP-Code: 123456" \
  -d '{"scope": "COMMUNITY", "reason": "SECURITY_BREACH", "communityId": "..."}'
```

### Escalation Path

1. **Immediate**: Activate kill switch for affected scope
2. **Within 15 minutes**: Notify Naib Council via Discord
3. **Within 1 hour**: Post incident summary to #naib-council
4. **Within 24 hours**: Complete incident report

### Contact

Security issues: security@arrakis.community

---

## Secrets Rotation Runbook

### API Key Pepper Rotation

1. Generate new pepper (32+ chars):
   ```bash
   openssl rand -base64 32
   ```

2. Update `API_KEY_PEPPER` in production secrets
3. **Note**: All API keys must be regenerated after pepper change
4. Rolling deployment: Update one instance at a time

### Database Credentials Rotation

1. Create new PostgreSQL user with RLS policies
2. Update `DATABASE_URL` in production secrets
3. Verify connectivity before removing old user
4. Remove old user after 24-hour observation

### Discord Bot Token Rotation

1. Generate new token in Discord Developer Portal
2. Update `DISCORD_BOT_TOKEN` in production secrets
3. Restart service (token not cached)
4. Verify bot connectivity

---

## Deployment Checklist

### Pre-Deployment

- [ ] All secrets are real values (not placeholders)
- [ ] `API_KEY_PEPPER` is 32+ characters
- [ ] `DATABASE_URL` points to production PostgreSQL
- [ ] `PADDLE_WEBHOOK_SECRET` is set (if billing enabled)
- [ ] `CORS_ALLOWED_ORIGINS` is configured (not `*`)
- [ ] `NODE_ENV=production` is set

### Security Verification

- [ ] Run `npm audit` - no high/critical vulnerabilities
- [ ] Run TypeScript compilation - no errors
- [ ] Run test suite - all tests pass
- [ ] Verify RLS policies are applied to all tables
- [ ] Verify API key validation works (bcrypt)
- [ ] Verify rate limiting is active

### Post-Deployment

- [ ] Verify health endpoint responds
- [ ] Verify security headers present (check via browser DevTools)
- [ ] Monitor logs for security warnings
- [ ] Verify MFA works for protected operations

---

## Audit History

| Sprint | Date | Changes |
|--------|------|---------|
| 83 | 2026-01-14 | Legacy key sunset plan, MFA metrics, example value validation |
| 82 | 2026-01-14 | Distributed rate limiting, bot token scrubbing, connection string redaction |
| 81 | 2026-01-13 | Configuration hardening, CORS, API key pepper validation |
| 80 | 2026-01-12 | Webhook secret requirement, replay attack prevention |
| 75 | 2026-01-10 | PII scrubbing, SOC 2 compliance |
| 73 | 2026-01-08 | Bcrypt API keys, rate limiting |
| 70 | 2026-01-05 | PostgreSQL RLS migration |
| 50 | 2025-12-20 | Audit log persistence, RLS validation |
| 47 | 2025-12-15 | Kill switch, MFA |

---

*This document is maintained as part of SOC 2 Type II compliance requirements.*

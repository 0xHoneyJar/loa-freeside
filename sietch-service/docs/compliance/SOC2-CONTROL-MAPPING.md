# SOC 2 Control Mapping

**Sprint 75: MED-4 - Compliance Documentation**
**Last Updated**: January 2026
**Status**: Implementation Complete

This document maps Sietch Service security controls to SOC 2 Type II trust service criteria, providing auditor-ready documentation for compliance reviews.

---

## Overview

Sietch Service implements security controls across five SOC 2 trust service categories:

| Category | Status | Key Controls |
|----------|--------|--------------|
| Security (CC) | ✅ Implemented | RLS, Input Validation, Rate Limiting |
| Availability (A) | ✅ Implemented | Redis Failover, Health Monitoring |
| Processing Integrity (PI) | ✅ Implemented | HMAC Signatures, Audit Logging |
| Confidentiality (C) | ✅ Implemented | PII Scrubbing, Secret Management |
| Privacy (P) | ✅ Implemented | Data Minimization, Retention Policies |

---

## Security (Common Criteria)

### CC1: Control Environment

| Control | Implementation | Evidence Location |
|---------|---------------|-------------------|
| CC1.1 COSO Principle 1 | Organization demonstrates commitment to integrity | `SECURITY-AUDIT-REPORT.md` |
| CC1.2 COSO Principle 2 | Board oversight of security | Security review process in sprints |
| CC1.3 COSO Principle 3 | Management establishes structures | `loa-grimoire/sdd.md` architecture |
| CC1.4 COSO Principle 4 | Commitment to competence | Code review in `a2a/sprint-N/` |
| CC1.5 COSO Principle 5 | Accountability for controls | Audit trail in `audit_logs` table |

### CC2: Communication and Information

| Control | Implementation | Evidence Location |
|---------|---------------|-------------------|
| CC2.1 Internal communication | Structured logging with trace IDs | `src/packages/infrastructure/logging/` |
| CC2.2 External communication | API documentation | `docs/api/` |
| CC2.3 Security policies | Security audit documentation | `SECURITY-AUDIT-REPORT.md` |

### CC3: Risk Assessment

| Control | Implementation | Evidence Location |
|---------|---------------|-------------------|
| CC3.1 Risk objectives | Security audit findings categorized | Sprint audit feedback files |
| CC3.2 Risk identification | OWASP Top 10 analysis | `SECURITY-AUDIT-REPORT.md` |
| CC3.3 Fraud consideration | Input validation, rate limiting | `src/packages/core/validation/` |
| CC3.4 Change analysis | Sprint-based development with reviews | `loa-grimoire/sprint.md` |

### CC4: Monitoring Activities

| Control | Implementation | Evidence Location |
|---------|---------------|-------------------|
| CC4.1 Ongoing monitoring | Health checks, metrics | `src/packages/adapters/coexistence/IncumbentHealthMonitor.ts` |
| CC4.2 Deficiency evaluation | Security audit workflow | `/audit-sprint` command |

### CC5: Control Activities

| Control | Implementation | Evidence Location |
|---------|---------------|-------------------|
| CC5.1 Control selection | Defense-in-depth strategy | SDD architecture patterns |
| CC5.2 Technology controls | RLS, HMAC, encryption | Multiple implementations |
| CC5.3 Policy deployment | Configuration management | `.env.example`, config files |

### CC6: Logical and Physical Access Controls

| Control | Implementation | Evidence Location |
|---------|---------------|-------------------|
| CC6.1 Access management | API key authentication | `src/packages/security/ApiKeyManager.ts` |
| CC6.2 Access provisioning | Role-based access via API keys | `api_keys` table with scopes |
| CC6.3 Access removal | Key revocation support | `ApiKeyManager.revokeKey()` |
| CC6.6 Encryption | TLS for transit, column encryption | PostgreSQL + TLS config |
| CC6.7 Input/output controls | Input validation framework | `src/packages/core/validation/` |
| CC6.8 Boundary protection | Rate limiting, IP blocking | `src/api/middleware.ts` |

**Implementation Details:**

```typescript
// API Key Authentication (CC6.1)
// Location: src/packages/security/ApiKeyManager.ts
- HMAC-SHA256 key derivation
- Scoped permissions per key
- Audit logging of key operations

// Row-Level Security (CC6.1)
// Location: src/db/migrations/013_rls_policies.ts
- Tenant isolation via guild_id
- Policy enforcement at database level
- No application bypass possible
```

### CC7: System Operations

| Control | Implementation | Evidence Location |
|---------|---------------|-------------------|
| CC7.1 Change detection | Drift detection scripts | `.claude/scripts/detect-drift.sh` |
| CC7.2 Infrastructure monitoring | Health endpoints | `/health`, `/ready` endpoints |
| CC7.3 Environmental controls | Docker containerization | `Dockerfile` |
| CC7.4 Data backup | Redis persistence, PostgreSQL backups | `docs/deployment/runbooks/backups.md` |
| CC7.5 Recovery procedures | Rollback mechanisms | `MigrationEngine.ts` |

### CC8: Change Management

| Control | Implementation | Evidence Location |
|---------|---------------|-------------------|
| CC8.1 Infrastructure changes | Sprint-based deployment | `/deploy-production` workflow |
| CC8.2 Software changes | Code review + security audit | `a2a/sprint-N/` feedback loops |
| CC8.3 Emergency changes | Rollback watcher | `RollbackWatcherJob.ts` |

### CC9: Risk Mitigation

| Control | Implementation | Evidence Location |
|---------|---------------|-------------------|
| CC9.1 Risk identification | Security audits per sprint | Audit feedback files |
| CC9.2 Vendor management | Dependabot monitoring | `.github/dependabot.yml` |

---

## Availability (A)

| Control | Implementation | Evidence Location |
|---------|---------------|-------------------|
| A1.1 Capacity management | Rate limiting | `src/api/middleware.ts` |
| A1.2 Environmental protection | Docker + VPS isolation | `docs/deployment/` |
| A1.3 Recovery procedures | Health monitoring, auto-recovery | `IncumbentHealthMonitor.ts` |

**Implementation Details:**

```typescript
// Rate Limiting (A1.1)
// Location: src/api/middleware.ts
- Sliding window algorithm
- Per-IP and per-API-key limits
- Configurable thresholds

// Health Monitoring (A1.3)
// Location: src/packages/adapters/coexistence/IncumbentHealthMonitor.ts
- Periodic health checks
- Automatic alerting on degradation
- Discord webhook notifications
```

---

## Processing Integrity (PI)

| Control | Implementation | Evidence Location |
|---------|---------------|-------------------|
| PI1.1 Input validation | Schema validation | `src/packages/core/validation/SchemaRegistry.ts` |
| PI1.2 Processing accuracy | Type-safe operations | TypeScript strict mode |
| PI1.3 Output completeness | Structured responses | API response schemas |
| PI1.4 Error handling | Centralized error handling | `src/api/middleware.ts` |
| PI1.5 Data integrity | HMAC signatures on audit logs | `AuditLogPersistence.ts` |

**Implementation Details:**

```typescript
// HMAC Audit Log Signatures (PI1.5)
// Location: src/packages/security/AuditLogPersistence.ts
interface AuditLogEntry {
  id: string;
  timestamp: Date;
  action: string;
  actor_id: string;
  resource_type: string;
  resource_id: string;
  details: JsonValue;
  signature: string;  // HMAC-SHA256
}

// Signature generation ensures tamper detection
const signature = crypto
  .createHmac('sha256', AUDIT_SECRET)
  .update(JSON.stringify(entry))
  .digest('hex');
```

---

## Confidentiality (C)

| Control | Implementation | Evidence Location |
|---------|---------------|-------------------|
| C1.1 Confidential information identification | PII pattern detection | `pii-scrubber.ts` |
| C1.2 Confidential information disposal | Log retention policies | Logger configuration |

**Implementation Details:**

```typescript
// PII Log Scrubbing (C1.1)
// Location: src/packages/infrastructure/logging/pii-scrubber.ts
Redacted PII Types:
- Ethereum wallet addresses → 0x[WALLET_REDACTED]
- Discord IDs → [DISCORD_ID]
- Email addresses → [EMAIL_REDACTED]
- IP addresses → [IP_REDACTED]
- API keys/tokens → [API_KEY_REDACTED]
- JWT tokens → [JWT_REDACTED]

// Logger Integration
// Location: src/utils/logger.ts
- Automatic PII scrubbing via Pino hooks
- Configurable via DISABLE_PII_SCRUBBING env var
- Development mode warnings for detected PII
```

---

## Privacy (P)

| Control | Implementation | Evidence Location |
|---------|---------------|-------------------|
| P1.1 Notice of data practices | Privacy policy reference | Terms of service |
| P2.1 Choice and consent | Opt-in guild configuration | Guild settings |
| P3.1 Collection limitation | Minimal data collection | Schema design |
| P4.1 Use limitation | Purpose-bound data access | RLS policies |
| P5.1 Access rights | User data export capability | API endpoints |
| P6.1 Disclosure limitation | No third-party sharing | Architecture design |
| P7.1 Data quality | Validation at ingestion | Schema validation |
| P8.1 Management oversight | Audit logging | `audit_logs` table |

---

## Evidence Artifacts

### Required for SOC 2 Audit

| Artifact | Location | Description |
|----------|----------|-------------|
| Security Audit Report | `SECURITY-AUDIT-REPORT.md` | Comprehensive security assessment |
| Architecture Documentation | `loa-grimoire/sdd.md` | System design and security controls |
| Sprint Audit Trail | `loa-grimoire/a2a/sprint-N/` | Per-sprint security reviews |
| API Key Management | `src/packages/security/ApiKeyManager.ts` | Access control implementation |
| Audit Log Implementation | `src/packages/security/AuditLogPersistence.ts` | Immutable audit trail |
| PII Scrubber | `src/packages/infrastructure/logging/pii-scrubber.ts` | Data protection |
| Input Validation | `src/packages/core/validation/` | Processing integrity |
| RLS Policies | `src/db/migrations/013_rls_policies.ts` | Tenant isolation |
| Dependabot Config | `.github/dependabot.yml` | Vulnerability management |
| Health Monitoring | `src/packages/adapters/coexistence/IncumbentHealthMonitor.ts` | Availability |

### Automated Evidence Collection

```bash
# Generate compliance evidence bundle
./scripts/generate-compliance-evidence.sh

# Outputs:
# - audit_log_sample.json    # Recent audit entries
# - rls_policy_dump.sql      # Active RLS policies
# - api_key_audit.json       # Key management events
# - test_coverage.json       # Security test results
```

---

## Control Testing Schedule

| Control Area | Test Frequency | Last Tested | Next Test |
|-------------|----------------|-------------|-----------|
| Access Controls (CC6) | Quarterly | Sprint 74 | Q2 2026 |
| Audit Logging (PI1.5) | Monthly | Sprint 75 | Feb 2026 |
| PII Scrubbing (C1.1) | Monthly | Sprint 75 | Feb 2026 |
| Input Validation (PI1.1) | Per Release | Sprint 74 | Next release |
| Rate Limiting (A1.1) | Quarterly | Sprint 73 | Q2 2026 |

---

## Remediation Tracking

### Completed (Sprint 50-75)

| Finding | Severity | Sprint | Status |
|---------|----------|--------|--------|
| Missing RLS policies | CRITICAL | 50-64 | ✅ Remediated |
| No secrets management | CRITICAL | 73 | ✅ Remediated |
| SQL injection risk | CRITICAL | 73 | ✅ Remediated |
| Missing HMAC on API keys | HIGH | 50 | ✅ Remediated |
| No input validation | HIGH | 74 | ✅ Remediated |
| Missing security headers | MEDIUM | 74 | ✅ Remediated |
| No dependency scanning | MEDIUM | 75 | ✅ Remediated |
| PII in logs | MEDIUM | 75 | ✅ Remediated |
| No persistent audit logs | MEDIUM | 50 | ✅ Remediated |

### Open Items

| Finding | Severity | Target Sprint | Status |
|---------|----------|---------------|--------|
| None | - | - | All critical/high/medium remediated |

---

## Auditor Notes

1. **Row-Level Security**: PostgreSQL RLS policies enforce tenant isolation at the database level. See `013_rls_policies.ts` for complete policy definitions.

2. **Audit Trail Integrity**: All audit log entries are HMAC-signed using SHA-256. The signature covers all entry fields, preventing tampering.

3. **PII Protection**: Log scrubbing is enabled by default and cannot be bypassed without explicit configuration. All common PII patterns are redacted before persistence.

4. **Access Control**: API keys use HMAC derivation with a server-side pepper, preventing key enumeration and providing secure storage.

5. **Vulnerability Management**: Dependabot monitors all npm dependencies weekly and creates automated PRs for security updates.

---

## Version History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | Jan 2026 | Sprint 75 | Initial SOC 2 control mapping |

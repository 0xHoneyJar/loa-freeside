# Security Remediation Sprint Plan

**Source**: `grimoires/loa/SECURITY-AUDIT-REPORT-2026-01-18-full-codebase.md`
**Created**: 2026-01-18
**Overall Risk Level**: MEDIUM-HIGH
**OWASP Compliance**: 4/10 PASS

---

## Sprint Overview

This sprint plan addresses the findings from the January 18, 2026 security audit. Work is prioritized by severity and organized into 4 sprints matching the remediation roadmap.

| Sprint | Priority | Focus | Findings Addressed |
|--------|----------|-------|-------------------|
| Sprint 94 | CRITICAL | Immediate Remediation | C-1, C-2, H-3 |
| Sprint 95 | CRITICAL | KMS Activation | A-94.1, A-94.2, A-94.3 |
| Sprint 96 | HIGH | Authentication & Audit | H-1, H-2, H-4, H-5, H-6 |
| Sprint 97 | MEDIUM | Hardening & Observability | M-1 through M-8 |
| Sprint 98 | LOW | Polish & Compliance | L-1 through L-5 |

---

## Sprint 94: Critical Security Remediation

**Goal**: Address CRITICAL findings that block production deployment
**Priority**: P0 - Immediate (0-7 days)

### S-94.1: Implement Least-Privilege IAM per Service

**Finding**: C-1 - Overly Permissive IAM Access to Discord Bot Token
**CVSS**: 9.1 (Critical)

**Description**: Split the blanket ECS execution role into service-specific roles with least-privilege access.

**Acceptance Criteria**:
- [ ] Create separate IAM roles for each ECS service (gateway, worker, ingestor)
- [ ] Gateway role: Only access to `app_config` secret (Discord token)
- [ ] Worker role: Only access to `db_credentials`, `redis_credentials`
- [ ] Ingestor role: Only access to `rabbitmq_credentials`
- [ ] Add AWS Secrets Manager resource-based policies restricting access by service
- [ ] Add CloudWatch alarms for unauthorized secret access attempts
- [ ] Terraform plan shows no secret cross-access

**Files to Modify**:
- `infrastructure/terraform/ecs.tf` (lines 77-98)
- `infrastructure/terraform/gateway.tf`
- `infrastructure/terraform/worker.tf`
- `infrastructure/terraform/ingestor.tf`

---

### S-94.2: Enable KMS Encryption on Terraform State

**Finding**: C-2 - Terraform State Contains Plaintext Secrets
**CVSS**: 9.8 (Critical)

**Description**: Encrypt Terraform state with customer-managed KMS key and implement state file protection.

**Acceptance Criteria**:
- [ ] Create KMS key for Terraform state encryption
- [ ] Update S3 backend to use KMS encryption
- [ ] Enable MFA delete on tfstate bucket
- [ ] Enable versioning on tfstate bucket
- [ ] Add bucket policy restricting access to Terraform automation role
- [ ] Document emergency state recovery procedure
- [ ] State file encrypted at rest verified

**Files to Modify**:
- `infrastructure/terraform/main.tf` (backend configuration)
- `infrastructure/terraform/kms.tf` (new file)

---

### S-94.3: Implement Guild ID Validation

**Finding**: H-3 - Missing Input Validation on Guild IDs
**CVSS**: 7.3 (High)

**Description**: Add strict validation for Discord snowflake IDs to prevent SSRF and injection attacks.

**Acceptance Criteria**:
- [ ] Create `validateGuildId()` function with regex `/^\d{17,19}$/`
- [ ] Apply validation in `getGuildId()` utility
- [ ] Sanitize error messages to prevent information leakage
- [ ] Add unit tests for valid/invalid guild IDs
- [ ] Add integration test for guild ID validation
- [ ] Update CLI error messages to use error codes

**Files to Modify**:
- `packages/cli/src/commands/server/utils.ts` (lines 47-49)
- `packages/cli/src/commands/server/__tests__/cli-compliance.test.ts`

---

### S-94.4: Rotate All Secrets

**Finding**: C-2, H-4 - Plaintext secrets and no rotation
**Priority**: URGENT - Manual task

**Description**: Immediate rotation of all secrets that may have been exposed.

**Acceptance Criteria**:
- [ ] Rotate Discord bot token (regenerate in Discord Developer Portal)
- [ ] Rotate database master password
- [ ] Rotate Redis password
- [ ] Rotate RabbitMQ credentials
- [ ] Update all secrets in AWS Secrets Manager
- [ ] Verify all services reconnect successfully
- [ ] Document rotation procedure in `SECURITY.md`

**Note**: This is a manual operational task, not code.

---

## Sprint 96: Authentication & Audit Logging

**Goal**: Implement CLI authentication, audit logging, and secret rotation
**Priority**: P1 - High (7-30 days)

### S-96.1: Implement CLI Authentication with OAuth Device Flow

**Finding**: H-1 - CLI Commands Lack Authentication Mechanism
**CVSS**: 8.1 (High)

**Description**: Add OAuth 2.0 device flow authentication to CLI commands with session management.

**Acceptance Criteria**:
- [ ] Implement OAuth device flow authentication (`gaib auth login`)
- [ ] Store credentials in system keychain (macOS Keychain, Windows Credential Manager, Linux Secret Service)
- [ ] Implement session management with 15-minute TTL
- [ ] Add `gaib auth logout` and `gaib auth status` commands
- [ ] Require authentication for all `gaib server` commands
- [ ] Add `--skip-auth` flag for CI/CD pipelines (with warning)
- [ ] Document authentication flow in `docs/iac.md`

**Files to Create**:
- `packages/cli/src/commands/auth/index.ts`
- `packages/cli/src/commands/auth/login.ts`
- `packages/cli/src/commands/auth/logout.ts`
- `packages/cli/src/commands/auth/status.ts`
- `packages/cli/src/lib/keychain.ts`
- `packages/cli/src/lib/session.ts`

**Files to Modify**:
- `packages/cli/src/commands/server/utils.ts`
- `packages/cli/src/commands/index.ts`
- `docs/iac.md`

---

### S-96.2: Implement RBAC for CLI Commands

**Finding**: H-1 - No authorization mechanisms
**CVSS**: 8.1 (High)

**Description**: Add role-based access control with viewer, operator, and admin roles.

**Acceptance Criteria**:
- [ ] Define roles: `viewer` (read-only), `operator` (plan/diff), `admin` (apply/destroy)
- [ ] Implement role check middleware for CLI commands
- [ ] `gaib server export` - requires `viewer` or higher
- [ ] `gaib server plan`, `gaib server diff` - requires `operator` or higher
- [ ] `gaib server apply` (future) - requires `admin`
- [ ] Add `--role` flag for testing/CI
- [ ] Store role in session token claims

**Files to Create**:
- `packages/cli/src/lib/rbac.ts`
- `packages/cli/src/lib/rbac.test.ts`

**Files to Modify**:
- `packages/cli/src/commands/server/*.ts`

---

### S-96.3: Implement Audit Logging for CLI Operations

**Finding**: H-1 - No audit trail
**CVSS**: 8.1 (High)

**Description**: Log all CLI operations to CloudWatch with user attribution and operation details.

**Acceptance Criteria**:
- [ ] Create audit log format with: timestamp, user, operation, guild_id, result, duration
- [ ] Send audit logs to CloudWatch Logs group `/arrakis/cli/audit`
- [ ] Include correlation ID for tracing
- [ ] Log both successful and failed operations
- [ ] Implement local audit log fallback (when offline)
- [ ] Add `gaib audit list` command to view recent operations
- [ ] CloudWatch alarms for failed operations (>5 in 5 minutes)

**Files to Create**:
- `packages/cli/src/lib/audit.ts`
- `packages/cli/src/commands/audit/index.ts`
- `packages/cli/src/commands/audit/list.ts`

**Files to Modify**:
- `packages/cli/src/commands/server/*.ts`
- `infrastructure/terraform/cloudwatch.tf`

---

### S-96.4: Fix YAML Prototype Pollution Vulnerability

**Finding**: H-2 - YAML Configuration Vulnerable to Prototype Pollution
**CVSS**: 7.5 (High)

**Description**: Ensure YAML parsing uses safe loading with JSON schema.

**Acceptance Criteria**:
- [ ] Verify `yaml.load()` uses `JSON_SCHEMA` option
- [ ] Add explicit `{ schema: yaml.JSON_SCHEMA, json: true }` to all yaml.load calls
- [ ] Freeze parsed configuration objects with `Object.freeze()`
- [ ] Add test case for prototype pollution attempt
- [ ] Sanitize keys against `__proto__`, `constructor`, `prototype`

**Files to Modify**:
- `packages/cli/src/commands/server/iac/ConfigParser.ts`
- `packages/cli/src/commands/server/iac/__tests__/ConfigParser.test.ts`

---

### S-96.5: Implement Automated Secret Rotation

**Finding**: H-4 - Insufficient Secrets Rotation Policy
**CVSS**: 7.1 (High)

**Description**: Implement AWS Secrets Manager automatic rotation with Lambda functions.

**Acceptance Criteria**:
- [ ] Create rotation Lambda for database credentials
- [ ] Create rotation Lambda for Redis credentials
- [ ] Configure 30-day rotation schedule
- [ ] Implement rotation testing in staging
- [ ] Add CloudWatch alarms for rotation failures
- [ ] Document emergency rotation procedure (<1 hour)
- [ ] Test rotation doesn't cause service disruption

**Files to Create**:
- `infrastructure/terraform/secrets-rotation.tf`
- `infrastructure/lambda/rotate-db-credentials/index.ts`
- `infrastructure/lambda/rotate-redis-credentials/index.ts`

---

### S-96.6: Implement CLI Rate Limiting

**Finding**: H-6 - Missing Rate Limiting on CLI Commands
**CVSS**: 6.8 (Medium-High)

**Description**: Add per-user rate limiting to prevent command spam and resource exhaustion.

**Acceptance Criteria**:
- [ ] Implement rate limiter with 10 operations/minute per user
- [ ] Add cooldown period (30s) for destructive operations
- [ ] Persist rate limit state in local storage
- [ ] Return clear error message when rate limited
- [ ] Add `--no-rate-limit` flag for CI (requires admin role)
- [ ] Log rate limit violations to audit log

**Files to Create**:
- `packages/cli/src/lib/cli-rate-limiter.ts`

**Files to Modify**:
- `packages/cli/src/commands/server/utils.ts`

---

### S-96.7: Harden Docker Build Stages

**Finding**: H-5 - Docker Images Run as Root (Partially Mitigated)
**CVSS**: 7.0 (High)

**Description**: Use non-root users in all Docker stages and add security contexts.

**Acceptance Criteria**:
- [ ] Add non-root user to build stages in all Dockerfiles
- [ ] Add `readonlyRootFilesystem: true` to ECS task definitions
- [ ] Drop all Linux capabilities (`drop: ["ALL"]`)
- [ ] Verify worker Dockerfile uses non-root user
- [ ] Add security context to Kubernetes deployments (if applicable)

**Files to Modify**:
- `apps/ingestor/Dockerfile`
- `apps/gateway/Dockerfile`
- `packages/worker/Dockerfile`
- `infrastructure/terraform/ecs.tf`

---

## Sprint 97: Security Hardening & Observability

**Goal**: Address MEDIUM findings for defense in depth
**Priority**: P2 - Medium (30-90 days)

### S-97.1: Enhance Terraform State Management

**Finding**: M-1 - Terraform State Locking Insufficient
**CVSS**: 5.9 (Medium)

**Acceptance Criteria**:
- [ ] Enable point-in-time recovery on DynamoDB lock table
- [ ] Add condition expressions to prevent race conditions
- [ ] Implement state locking timeout alerts (>5 minutes)
- [ ] Document state management procedures

---

### S-97.2: Implement Centralized Secret Redaction

**Finding**: M-3 - Discord API Token Not Masked in Logs
**CVSS**: 5.3 (Medium)

**Acceptance Criteria**:
- [ ] Audit ALL log statements for token leakage
- [ ] Implement logging middleware with automatic PII scrubbing
- [ ] Add regex patterns for Discord tokens, API keys, passwords
- [ ] Test redaction in structured logging output

---

### S-97.3: Add YAML Configuration Integrity Checks

**Finding**: M-4 - No Integrity Checks on YAML Configuration Files
**CVSS**: 5.5 (Medium)

**Acceptance Criteria**:
- [ ] Generate SHA-256 checksum for config files
- [ ] Store checksums in `.gaib-checksums` file
- [ ] Verify integrity before parsing
- [ ] Add `--skip-integrity` flag for development
- [ ] Warn on integrity mismatch

---

### S-97.4: Extend ECS Exec Audit Logging

**Finding**: M-5 - ECS Tasks Can Execute Commands Without Audit
**CVSS**: 5.8 (Medium)

**Acceptance Criteria**:
- [ ] Extend CloudWatch log retention to 365 days
- [ ] Implement session recording for exec sessions
- [ ] Add approval workflow for exec access via AWS SSM
- [ ] Alert on exec session usage

---

### S-97.5: Add Container Vulnerability Scanning

**Finding**: M-6 - Missing Dependency Vulnerability Scanning in CI
**CVSS**: 5.6 (Medium)

**Acceptance Criteria**:
- [ ] Add Trivy container scanning to CI pipeline
- [ ] Scan Docker base images (Alpine) for CVEs
- [ ] Block builds with CRITICAL vulnerabilities
- [ ] Generate SBOM (Software Bill of Materials)

---

### S-97.6: Implement Distributed Tracing

**Finding**: M-7 - No Distributed Tracing for CLI Operations
**CVSS**: 4.9 (Medium)

**Acceptance Criteria**:
- [ ] Add OpenTelemetry SDK to CLI
- [ ] Send traces to AWS X-Ray
- [ ] Add correlation IDs to all operations
- [ ] Enable trace context propagation to Discord API calls

---

### S-97.7: Enhance Network Segmentation

**Finding**: M-8 - Insufficient Network Segmentation
**CVSS**: 5.2 (Medium)

**Acceptance Criteria**:
- [ ] Create separate security groups per service
- [ ] Implement micro-segmentation (database, cache, compute)
- [ ] Add VPC flow logs for network visibility
- [ ] Document network topology

---

### S-97.8: Add Security Headers

**Finding**: M-2 - Missing Content Security Policy
**CVSS**: 5.4 (Medium)

**Acceptance Criteria**:
- [ ] Add CSP headers to any HTML output
- [ ] Sanitize all CLI output that could be HTML
- [ ] Use template library with auto-escaping

---

## Sprint 98: Polish & Compliance Documentation

**Goal**: Address LOW findings and improve compliance posture
**Priority**: P3 - Low (90+ days)

### S-98.1: Sanitize Production Error Messages

**Finding**: L-1 - Error Messages Expose Internal Structure
**CVSS**: 3.7 (Low)

**Acceptance Criteria**:
- [ ] Implement generic error messages for production
- [ ] Use error codes instead of descriptive messages
- [ ] Log detailed errors server-side only

---

### S-98.2: Add API Security Headers

**Finding**: L-2 - No Security Headers in API Responses
**CVSS**: 3.3 (Low)

**Acceptance Criteria**:
- [ ] Add `X-Content-Type-Options: nosniff`
- [ ] Add `X-Frame-Options: DENY`
- [ ] Add `Strict-Transport-Security: max-age=31536000`

---

### S-98.3: Implement Backup Verification

**Finding**: L-4 - No Automated Backup Verification
**CVSS**: 3.8 (Low)

**Acceptance Criteria**:
- [ ] Implement monthly backup restore tests
- [ ] Verify backup integrity with checksums
- [ ] Document disaster recovery procedures

---

### S-98.4: Create Incident Response Documentation

**Finding**: L-5 - Missing Documentation for Security Incident Response
**CVSS**: 2.9 (Low)

**Acceptance Criteria**:
- [ ] Create `INCIDENT-RESPONSE.md` with runbooks
- [ ] Document secrets rotation procedures
- [ ] Implement automated playbooks with AWS SSM
- [ ] Conduct tabletop exercise

---

### S-98.5: Implement SRI for CDN Assets

**Finding**: L-3 - Missing Subresource Integrity
**CVSS**: 3.1 (Low)

**Acceptance Criteria**:
- [ ] Generate SRI hashes for CDN resources
- [ ] Add `integrity` attributes to script tags
- [ ] Automate SRI hash generation in build

---

## Risk Summary

| Sprint | Critical | High | Medium | Low | Effort |
|--------|----------|------|--------|-----|--------|
| 94 | 2 | 1 | 0 | 0 | ~3 days |
| 95 | 2 | 1 | 0 | 1 | ~8 hours |
| 96 | 0 | 5 | 1 | 0 | ~7-10 days |
| 97 | 0 | 0 | 8 | 0 | ~5-7 days |
| 98 | 0 | 0 | 0 | 5 | ~3-5 days |

---

## Success Metrics

### Post-Remediation Targets

| Metric | Current | Target | Sprint |
|--------|---------|--------|--------|
| OWASP Compliance | 4/10 | 9/10 | 96 |
| Secret Rotation | Never | 30 days | 96 |
| Audit Coverage | 0% | 100% | 96 |
| MTTD | Unknown | <15 min | 97 |
| MTTR | Unknown | <1 hour | 98 |

---

## Dependencies

```
S-94.1 (IAM) ─┐
S-94.2 (KMS) ─┼─→ S-95.x (KMS Activation) ─→ S-96.5 (Secret Rotation)
S-94.4 (Rotate) ┘

S-96.1 (Auth) ─┬─→ S-96.2 (RBAC)
               └─→ S-96.3 (Audit)

S-96.4 (YAML) ─→ S-97.3 (Integrity)

S-97.6 (Tracing) ─→ Better debugging
```

---

## Next Steps

1. **Start with Sprint 94** - Critical findings must be addressed first
2. **Parallel work**: S-94.1 through S-94.3 can be done in parallel
3. **S-94.4 (Secret Rotation)** - Manual task, coordinate with ops team
4. **After Sprint 94**: Move to Sprint 95 for KMS activation, then Sprint 96 for authentication/audit

```
/implement sprint-94
```

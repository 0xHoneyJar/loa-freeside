# Sprint S-5 Security Audit

**Sprint**: S-5 (NATS JetStream Deployment)
**Auditor**: Paranoid Cypherpunk Security Auditor
**Date**: 2026-01-15

## Verdict

APPROVED - LETS FUCKING GO

## Executive Summary

Sprint S-5 implements NATS JetStream infrastructure and TypeScript consumers with proper security controls. The implementation follows defense-in-depth principles with no critical or high-severity findings.

## Security Assessment

### Infrastructure Security (nats.tf)

| Control | Status | Evidence |
|---------|--------|----------|
| Network Isolation | PASS | Private subnets only, `assign_public_ip = false` (line 175) |
| Security Groups | PASS | Specific port allowlists, no 0.0.0.0/0 ingress |
| EFS Encryption | PASS | `encrypted = true` (line 113) |
| EFS Transit Encryption | PASS | `transit_encryption = "ENABLED"` (line 92) |
| IAM Least Privilege | PASS | Task role scoped to specific EFS ARN with condition |
| Secrets in AWS SM | PASS | NATS URL stored in Secrets Manager, not env vars |
| Logging | PASS | CloudWatch logs with 30-day retention |

**Security Group Analysis:**

```hcl
# Port 4222: NATS client - restricted to ECS tasks and Gateway SGs
# Port 6222: NATS cluster - self-referencing only (line 238-244)
# Port 8222: NATS monitor - VPC CIDR only (lines 247-253)
```

No overly permissive ingress rules found.

### IAM Policy Review

```hcl
# nats_task_efs policy (lines 368-391)
Statement = [{
  Effect = "Allow"
  Action = [
    "elasticfilesystem:ClientMount",
    "elasticfilesystem:ClientWrite",
    "elasticfilesystem:ClientRootAccess"
  ]
  Resource = aws_efs_file_system.nats.arn
  Condition = {
    StringEquals = {
      "elasticfilesystem:AccessPointArn" = aws_efs_access_point.nats.arn
    }
  }
}]
```

IAM policy is appropriately scoped with condition constraint.

### Application Security (TypeScript)

| Check | Status | Evidence |
|-------|--------|----------|
| No hardcoded secrets | PASS | All secrets via env vars |
| Input validation | PASS | Zod schema validation in config.ts |
| JSON parse safety | PASS | Parse wrapped in try/catch in consumers |
| Error info disclosure | PASS | Generic error messages to Discord users |
| Log sanitization | PASS | Structured logging, no raw payload dumps |

**JSON Parsing (BaseNatsConsumer.ts:209-211):**

```typescript
private parseMessage(msg: JsMsg): T {
  const data = this.codec.decode(msg.data);
  return JSON.parse(data) as T;
}
```

JSON.parse is wrapped in the outer try/catch (line 160), preventing crash on malformed messages.

**Error Disclosure (CommandNatsConsumer.ts:133-137):**

```typescript
await this.discordRest.sendFollowup(token, {
  content: 'An error occurred while processing your request.',
  flags: 64, // Ephemeral
});
```

Generic error message to users - no stack traces or internal details exposed.

### OWASP Top 10 Review

| Category | Status | Notes |
|----------|--------|-------|
| A01:2021 Broken Access Control | N/A | NATS is internal, no user-facing auth |
| A02:2021 Cryptographic Failures | PASS | EFS encrypted at rest and in transit |
| A03:2021 Injection | PASS | No dynamic queries, typed interfaces |
| A04:2021 Insecure Design | PASS | Defense-in-depth with SGs + IAM |
| A05:2021 Security Misconfiguration | PASS | No default credentials, proper IAM |
| A06:2021 Vulnerable Components | PASS | Using official nats:2.10-alpine image |
| A07:2021 Auth Failures | N/A | NATS uses network-level auth (VPC) |
| A08:2021 Data Integrity | PASS | JetStream provides message durability |
| A09:2021 Security Logging | PASS | CloudWatch + Prometheus metrics |
| A10:2021 SSRF | N/A | No user-controlled URLs in NATS path |

### Secrets Management

| Secret | Storage | Status |
|--------|---------|--------|
| NATS_URL | AWS Secrets Manager | PASS |
| Discord tokens | Interaction tokens (short-lived) | PASS |
| Database URL | Env var (existing) | ACCEPTABLE |

NATS credentials are properly stored in AWS Secrets Manager (lines 438-476 in nats.tf).

### Message Flow Security

```
Discord Gateway (TLS)
    ↓
Twilight Gateway (VPC, private subnet)
    ↓ (publish to NATS, internal network)
NATS JetStream (VPC, private subnet, SG-restricted)
    ↓ (consume, internal network)
TypeScript Workers (VPC, private subnet)
    ↓ (REST API, TLS)
Discord API
```

All inter-service communication stays within VPC private subnets.

## Security Findings

### No Critical/High Findings

### Medium Findings: None

### Low/Informational

| ID | Finding | Severity | Status |
|----|---------|----------|--------|
| S5-INFO-01 | NATS cluster has no authentication | INFO | ACCEPTABLE - Network isolation via SGs |
| S5-INFO-02 | Unlimited reconnect attempts | INFO | ACCEPTABLE - Prevents transient failures |

**S5-INFO-01**: NATS runs without username/password authentication. This is acceptable because:
- NATS is in private subnets with no public IP
- Security groups restrict access to specific ECS task SGs
- Adding NATS auth would require credential distribution complexity

**S5-INFO-02**: `maxReconnectAttempts: -1` means unlimited retries. This is appropriate for production resilience.

## Positive Security Observations

1. **Transit Encryption**: EFS mount uses `transit_encryption = "ENABLED"`
2. **At-Rest Encryption**: EFS file system has `encrypted = true`
3. **IAM Conditions**: EFS access restricted to specific access point ARN
4. **Ephemeral Error Messages**: User-facing errors are generic (flags: 64)
5. **Structured Logging**: pino logger with proper context, no raw dumps
6. **Graceful Shutdown**: `connection.drain()` prevents message loss

## Recommendations (Non-Blocking)

1. **Consider NATS auth for multi-tenant**: If adding tenant isolation later, consider NATS accounts/users
2. **Stream encryption**: JetStream supports at-rest encryption - evaluate for ELIGIBILITY stream (contains token data)

## Conclusion

Sprint S-5 passes security audit. The implementation demonstrates security-conscious design with:
- Proper network isolation (VPC, private subnets, SGs)
- Encryption at rest and in transit (EFS)
- Least-privilege IAM policies
- No hardcoded secrets
- Generic user-facing error messages
- Structured, sanitized logging

The NATS JetStream deployment is production-ready from a security perspective.

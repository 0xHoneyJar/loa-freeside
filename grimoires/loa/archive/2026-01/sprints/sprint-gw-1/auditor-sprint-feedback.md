# Sprint GW-1 Security Audit

**Auditor**: Paranoid Cypherpunk Security Auditor
**Date**: 2026-01-15
**Sprint**: Gateway Proxy Pattern - Sprint 1/6

---

## Verdict: APPROVED - LET'S FUCKING GO

The infrastructure implementation demonstrates solid security practices with no critical, high, or medium vulnerabilities identified.

---

## Audit Scope

| Component | Files Reviewed |
|-----------|----------------|
| RabbitMQ Infrastructure | `infrastructure/terraform/rabbitmq.tf` |
| Ingestor Resources | `infrastructure/terraform/ecs.tf` (lines 395-584) |
| Queue Topology | `infrastructure/rabbitmq/definitions.json` |
| Setup Script | `infrastructure/rabbitmq/setup-topology.sh` |
| CI/CD Pipeline | `.github/workflows/deploy-ingestor.yml` |
| Variables/Outputs | `infrastructure/terraform/variables.tf`, `outputs.tf` |

---

## Security Findings

### 1. Secrets Management ✅ PASS

**Finding**: No hardcoded credentials detected.

| Secret | Storage | Access Pattern |
|--------|---------|----------------|
| RabbitMQ password | AWS Secrets Manager | `random_password` → Secrets Manager |
| Discord bot token | AWS Secrets Manager | ECS task `secrets` block |
| AWS credentials | GitHub Secrets | `${{ secrets.AWS_* }}` |

**Evidence** (`rabbitmq.tf:46-49`):
```hcl
resource "random_password" "rabbitmq_password" {
  length  = 32
  special = false # RabbitMQ password restrictions
}
```

Password flows directly to Secrets Manager, never exposed in state outputs.

---

### 2. Network Security ✅ PASS

**Finding**: Minimal attack surface with proper network isolation.

#### RabbitMQ Security Group
- **Ingress**: Port 15671 (management) from VPC CIDR only
- **Ingress**: Port 5671 (AMQPS) from specific security groups only
- **Public Access**: `publicly_accessible = false`

#### Ingestor Security Group
- **Ingress**: NONE (zero ingress rules - excellent)
- **Egress**: Port 5671 to RabbitMQ SG only
- **Egress**: Port 443 to 0.0.0.0/0 (Discord Gateway, CloudWatch)

**Evidence** (`ecs.tf:431-459`):
```hcl
resource "aws_security_group" "ingestor" {
  # No ingress block - intentionally no incoming connections

  egress {
    from_port       = 5671
    security_groups = [aws_security_group.rabbitmq.id]  # SG reference, not CIDR
  }
}
```

**Note**: HTTPS egress to 0.0.0.0/0 is necessary for Discord Gateway WebSocket connections. This is acceptable.

---

### 3. IAM Policies ✅ PASS

**Finding**: Least privilege principle properly implemented.

**ECS Execution Role RabbitMQ Policy** (`rabbitmq.tf:135-153`):
```hcl
Action = ["secretsmanager:GetSecretValue"]
Resource = [aws_secretsmanager_secret.rabbitmq_credentials.arn]  # Specific ARN only
```

- Only `GetSecretValue` permission (not `Describe*` or `List*`)
- Scoped to single secret ARN (not wildcard)
- No cross-account access

---

### 4. CI/CD Pipeline Security ✅ PASS

**Finding**: Secrets properly protected, no injection vectors.

**Secrets Handling**:
- AWS credentials via `${{ secrets.AWS_ACCESS_KEY_ID }}` - never echoed
- No `echo` or `cat` of sensitive values
- Build logs sanitized

**Injection Prevention** (`deploy-ingestor.yml:180-185`):
```yaml
NEW_TASK_DEF=$(echo "$TASK_DEF" | jq --arg IMAGE "${{ env.ECR_REGISTRY }}/${{ env.ECR_REPOSITORY }}:${{ env.SHORT_SHA }}" \
  '.containerDefinitions[0].image = $IMAGE')
```
- Uses `jq --arg` for safe variable interpolation
- No shell expansion of untrusted input

---

### 5. RabbitMQ Configuration ✅ PASS

**Finding**: Secure transport and authentication enforced.

| Control | Status | Evidence |
|---------|--------|----------|
| TLS/AMQPS | ✅ | Port 5671 (not 5672) |
| Public Access | ✅ Blocked | `publicly_accessible = false` |
| Password Strength | ✅ | 32 chars, `random_password` |
| Subnet Placement | ✅ | Private subnets only |

**Evidence** (`rabbitmq.tf:21-22`):
```hcl
subnet_ids      = var.environment == "production" ? module.vpc.private_subnets : [module.vpc.private_subnets[0]]
security_groups = [aws_security_group.rabbitmq.id]
```

---

### 6. Setup Script Security ✅ PASS

**Finding**: No command injection vulnerabilities.

**Shell Safety** (`setup-topology.sh:1-2`):
```bash
#!/bin/bash
set -euo pipefail
```

**Input Handling**:
- Credentials from environment variables or script arguments
- No `eval` or dynamic command construction
- API calls use curl with proper quoting
- JSON payloads are static (not user-derived)

---

## Low-Priority Observations (Informational)

### L-1: Ingestor Task Definition Uses `:latest` Tag

**Location**: `ecs.tf:508`
**Risk**: LOW
**Status**: ACCEPTABLE

The CI/CD pipeline updates this to short SHA on each deploy. Initial `:latest` is fine for bootstrapping.

### L-2: DLQ TTL Set to 7 Days

**Location**: `definitions.json` (policy)
**Risk**: LOW
**Status**: ACCEPTABLE

7-day retention provides adequate window for debugging failed messages. Consider CloudWatch alarm for DLQ depth (Sprint GW-5 scope).

### L-3: Management Console Accessible from VPC

**Location**: `rabbitmq.tf:58-64`
**Risk**: LOW
**Status**: ACCEPTABLE

Port 15671 limited to VPC CIDR. For production hardening, consider restricting to bastion host or VPN SG only.

---

## Compliance Checklist

| Control | Status |
|---------|--------|
| No hardcoded secrets | ✅ |
| Secrets in approved store (Secrets Manager) | ✅ |
| Encryption in transit (TLS) | ✅ |
| Network isolation (private subnets) | ✅ |
| Least privilege IAM | ✅ |
| No public endpoints | ✅ |
| CI/CD secrets protected | ✅ |
| No command injection vectors | ✅ |

---

## Recommendation

**APPROVED FOR DEPLOYMENT**

The Sprint GW-1 infrastructure implementation follows security best practices:
1. Zero-trust network model (no ingress on Ingestor)
2. Secrets properly managed via AWS Secrets Manager
3. TLS enforced for all RabbitMQ connections
4. IAM policies scoped to minimum required permissions
5. CI/CD pipeline protects credentials

Proceed to Sprint GW-2 (Ingestor Service implementation).

---

**Auditor Signature**: 🔐 Paranoid Cypherpunk Security Auditor
**Audit Complete**: 2026-01-15

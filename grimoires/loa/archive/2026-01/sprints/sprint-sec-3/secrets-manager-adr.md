# ADR: AWS Secrets Manager Integration

**Status:** PROPOSED
**Sprint:** SEC-3 (Rate Limiting & Credential Management)
**Date:** 2026-01-16
**Author:** Implementing Tasks Agent
**Security Finding:** M-1 (Hardcoded Credentials in Environment)

---

## Context

The security audit identified that credentials are currently stored as environment variables in Kubernetes secrets (M-1). While this is better than hardcoding in source, it has limitations:

1. **No automatic rotation**: Manual process required for credential updates
2. **No audit trail**: Kubernetes doesn't log secret access
3. **No versioning**: Cannot easily rollback to previous credentials
4. **Static secrets**: No dynamic secret generation
5. **Limited access control**: Kubernetes RBAC is coarse-grained

## Decision

We propose integrating AWS Secrets Manager for all application secrets, using the External Secrets Operator to synchronize secrets to Kubernetes.

### Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     AWS Secrets Manager                          │
│  ┌──────────────────┐  ┌──────────────────┐  ┌───────────────┐  │
│  │ arrakis/discord  │  │ arrakis/postgres │  │ arrakis/redis │  │
│  │ - bot_token      │  │ - url            │  │ - url         │  │
│  │ - app_id         │  │ - password       │  │ - password    │  │
│  └────────┬─────────┘  └────────┬─────────┘  └───────┬───────┘  │
│           │                     │                     │          │
└───────────┼─────────────────────┼─────────────────────┼──────────┘
            │                     │                     │
            ▼                     ▼                     ▼
┌───────────────────────────────────────────────────────────────────┐
│                  External Secrets Operator                         │
│     Polls every 1h, syncs on secret version change                │
└───────────────────────────────────────────────────────────────────┘
            │                     │                     │
            ▼                     ▼                     ▼
┌───────────────────────────────────────────────────────────────────┐
│                     Kubernetes Secrets                             │
│  ┌──────────────────┐  ┌──────────────────┐  ┌───────────────┐   │
│  │ arrakis-discord  │  │ arrakis-postgres │  │ arrakis-redis │   │
│  └──────────────────┘  └──────────────────┘  └───────────────┘   │
└───────────────────────────────────────────────────────────────────┘
            │                     │                     │
            ▼                     ▼                     ▼
┌───────────────────────────────────────────────────────────────────┐
│                     Application Pods                               │
│                (Environment variables injected)                    │
└───────────────────────────────────────────────────────────────────┘
```

## Proposed Implementation

### Phase 1: Infrastructure Setup

**1. Install External Secrets Operator**

```bash
helm repo add external-secrets https://charts.external-secrets.io
helm install external-secrets external-secrets/external-secrets \
  --namespace external-secrets \
  --create-namespace
```

**2. Create IAM Role for Service Account (IRSA)**

```hcl
# terraform/modules/secrets/main.tf

resource "aws_iam_role" "external_secrets" {
  name = "arrakis-external-secrets"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRoleWithWebIdentity"
      Effect = "Allow"
      Principal = {
        Federated = aws_iam_openid_connect_provider.eks.arn
      }
      Condition = {
        StringEquals = {
          "${replace(aws_iam_openid_connect_provider.eks.url, "https://", "")}:sub" = "system:serviceaccount:external-secrets:external-secrets"
        }
      }
    }]
  })
}

resource "aws_iam_role_policy" "external_secrets" {
  name = "secrets-access"
  role = aws_iam_role.external_secrets.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "secretsmanager:GetSecretValue",
        "secretsmanager:DescribeSecret"
      ]
      Resource = "arn:aws:secretsmanager:${var.region}:${var.account_id}:secret:arrakis/*"
    }]
  })
}
```

**3. Create SecretStore**

```yaml
# k8s/external-secrets/secret-store.yaml
apiVersion: external-secrets.io/v1beta1
kind: ClusterSecretStore
metadata:
  name: aws-secrets-manager
spec:
  provider:
    aws:
      service: SecretsManager
      region: us-east-1
      auth:
        jwt:
          serviceAccountRef:
            name: external-secrets
            namespace: external-secrets
```

### Phase 2: Secrets Migration

**1. Create secrets in AWS Secrets Manager**

```bash
# Discord credentials
aws secretsmanager create-secret \
  --name arrakis/discord \
  --secret-string '{"bot_token":"...","application_id":"..."}'

# PostgreSQL credentials
aws secretsmanager create-secret \
  --name arrakis/postgres \
  --secret-string '{"url":"postgres://...","username":"arrakis","password":"..."}'

# Redis credentials
aws secretsmanager create-secret \
  --name arrakis/redis \
  --secret-string '{"url":"redis://..."}'

# NATS credentials
aws secretsmanager create-secret \
  --name arrakis/nats \
  --secret-string '{"url":"nats://..."}'

# ScyllaDB credentials
aws secretsmanager create-secret \
  --name arrakis/scylladb \
  --secret-string '{"bundle":"base64-encoded-bundle"}'
```

**2. Create ExternalSecret resources**

```yaml
# k8s/external-secrets/arrakis-secrets.yaml
apiVersion: external-secrets.io/v1beta1
kind: ExternalSecret
metadata:
  name: arrakis-secrets
  namespace: arrakis
spec:
  refreshInterval: 1h
  secretStoreRef:
    kind: ClusterSecretStore
    name: aws-secrets-manager

  target:
    name: arrakis-secrets
    creationPolicy: Owner

  data:
    - secretKey: DISCORD_BOT_TOKEN
      remoteRef:
        key: arrakis/discord
        property: bot_token

    - secretKey: DISCORD_APPLICATION_ID
      remoteRef:
        key: arrakis/discord
        property: application_id

    - secretKey: DATABASE_URL
      remoteRef:
        key: arrakis/postgres
        property: url

    - secretKey: REDIS_URL
      remoteRef:
        key: arrakis/redis
        property: url

    - secretKey: NATS_URL
      remoteRef:
        key: arrakis/nats
        property: url
```

### Phase 3: Automatic Rotation

**1. PostgreSQL rotation (via RDS integration)**

```hcl
# terraform/modules/secrets/rotation.tf

resource "aws_secretsmanager_secret_rotation" "postgres" {
  secret_id           = aws_secretsmanager_secret.postgres.id
  rotation_lambda_arn = aws_lambda_function.rotate_postgres.arn

  rotation_rules {
    automatically_after_days = 90
  }
}
```

**2. Rotation Lambda for PostgreSQL**

AWS provides a built-in rotation Lambda for RDS:
- `SecretsManagerRDSPostgreSQLRotationSingleUser`
- `SecretsManagerRDSPostgreSQLRotationMultiUser`

**3. Manual rotation triggers**

For secrets that can't be auto-rotated (Discord token):

```bash
# Update secret version (after manual rotation)
aws secretsmanager put-secret-value \
  --secret-id arrakis/discord \
  --secret-string '{"bot_token":"NEW_TOKEN","application_id":"..."}'
```

External Secrets Operator will sync within `refreshInterval` (1h default, can be triggered immediately).

### Phase 4: Application Changes

**No application code changes required!**

The application continues to read from environment variables. The change is only in how secrets are provisioned to Kubernetes.

For dynamic refresh without restart (future enhancement):

```typescript
// Optional: Watch for secret changes
import { watch } from 'fs';

watch('/var/run/secrets/arrakis', (eventType, filename) => {
  if (eventType === 'change') {
    logger.info({ filename }, 'Secret file changed, reloading');
    reloadConfig();
  }
});
```

## Alternatives Considered

### 1. HashiCorp Vault

**Pros:**
- More features (dynamic secrets, encryption as a service)
- Multi-cloud support
- Fine-grained policies

**Cons:**
- Additional infrastructure to manage
- Higher operational complexity
- Overkill for our use case (static secrets)

**Decision:** Rejected - AWS Secrets Manager sufficient for our needs

### 2. Kubernetes Secrets with SealedSecrets

**Pros:**
- GitOps-friendly (encrypted secrets in repo)
- No external dependency

**Cons:**
- No automatic rotation
- No audit trail
- Still static secrets

**Decision:** Rejected - Doesn't solve rotation problem

### 3. SOPS (Secrets OPerationS)

**Pros:**
- GitOps-friendly
- Multi-cloud KMS support

**Cons:**
- No automatic rotation
- Requires additional tooling in CI/CD

**Decision:** Rejected - Same limitations as SealedSecrets

## Cost Analysis

### AWS Secrets Manager Pricing

| Component | Cost |
|-----------|------|
| Secret storage | $0.40/secret/month |
| API calls | $0.05 per 10,000 calls |

**Estimated monthly cost:**
- 6 secrets x $0.40 = $2.40
- API calls (ESO polling): ~$0.50
- **Total: ~$3/month**

### External Secrets Operator

- Open source, no cost
- Runs as deployment in cluster (~100MB RAM)

## Security Considerations

### Access Control

1. **Least privilege IAM**: ESO role can only read arrakis/* secrets
2. **No cross-account access**: Secrets stay in production account
3. **Kubernetes RBAC**: Only ESO can access the synced secrets

### Audit Trail

AWS Secrets Manager logs all access to CloudTrail:
- Who accessed which secret
- When the access occurred
- What version was accessed

### Secret Versioning

AWS Secrets Manager maintains version history:
- Rollback to previous version if needed
- Track when secrets changed

## Implementation Timeline

| Phase | Tasks | Effort |
|-------|-------|--------|
| Phase 1 | ESO installation, IAM setup, SecretStore | 1 day |
| Phase 2 | Migrate secrets to AWS SM, create ExternalSecrets | 1 day |
| Phase 3 | Set up rotation Lambda for PostgreSQL | 2 days |
| Phase 4 | Testing and documentation | 1 day |
| **Total** | | **5 days** |

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| ESO outage = no secret sync | RefreshInterval cache (1h), alerts on sync failure |
| AWS SM outage | Kubernetes secrets remain until ESO syncs again |
| IAM misconfiguration | Terraform-managed, peer-reviewed |
| Secret sync lag | Reduce refreshInterval for critical secrets (10m) |

## Success Metrics

- [ ] All secrets migrated to AWS Secrets Manager
- [ ] ESO syncing successfully (check ExternalSecret status)
- [ ] No hardcoded credentials in Kubernetes manifests
- [ ] Automatic rotation working for PostgreSQL
- [ ] CloudTrail logging secret access
- [ ] Runbook updated with new rotation procedures

## Decision

**Recommended approach:** AWS Secrets Manager + External Secrets Operator

This provides:
- Automatic rotation for database credentials
- Audit trail via CloudTrail
- Centralized secret management
- No application code changes
- Low cost (~$3/month)
- Industry standard practice

## References

- [AWS Secrets Manager Documentation](https://docs.aws.amazon.com/secretsmanager/)
- [External Secrets Operator](https://external-secrets.io/)
- [AWS Secrets Manager Rotation](https://docs.aws.amazon.com/secretsmanager/latest/userguide/rotating-secrets.html)

---

**Document History:**
- 2026-01-16: Initial proposal (Sprint SEC-3)

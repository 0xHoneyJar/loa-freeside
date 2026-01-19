# Sprint GW-1 Implementation Report: Infrastructure Setup

**Sprint**: Gateway Proxy Pattern - Sprint 1/6
**Date**: 2026-01-15
**Status**: IMPLEMENTATION COMPLETE

## Summary

Sprint GW-1 establishes the foundational infrastructure for the Gateway Proxy Pattern, which decouples the Discord Gateway (Ingestor) from business logic (Workers) using Amazon MQ (RabbitMQ) as the message broker.

## Tasks Completed

### TASK-1.1: Deploy Amazon MQ (RabbitMQ)
**File**: `infrastructure/terraform/rabbitmq.tf`

Created managed RabbitMQ broker with:
- **Resource**: `aws_mq_broker.rabbitmq`
- **Engine**: RabbitMQ 3.12
- **Instance Type**: Configurable via `var.rabbitmq_instance_type` (default: mq.t3.micro)
- **Deployment Mode**: CLUSTER_MULTI_AZ in production, SINGLE_INSTANCE in staging
- **Network**: Private subnets only, not publicly accessible
- **Maintenance Window**: Sundays 03:00 UTC
- **Logging**: General logs enabled to CloudWatch
- **Auto Minor Version Upgrades**: Enabled

**Password Management**:
- `random_password.rabbitmq_password` - 32 character password (no special chars for RabbitMQ compatibility)

### TASK-1.2: Configure Queue Topology
**Files**: `infrastructure/rabbitmq/definitions.json`, `infrastructure/rabbitmq/setup-topology.sh`

**Exchanges**:
| Exchange | Type | Purpose |
|----------|------|---------|
| `arrakis.events` | topic | Main event routing |
| `arrakis.dlx` | direct | Dead-letter routing |

**Queues**:
| Queue | Type | Configuration |
|-------|------|---------------|
| `arrakis.interactions` | priority | x-max-priority: 10, DLQ enabled |
| `arrakis.events.guild` | classic | DLQ enabled |
| `arrakis.dlq` | classic | TTL: 7 days (604800000ms) |

**Bindings**:
| Source | Destination | Routing Key |
|--------|-------------|-------------|
| arrakis.events | arrakis.interactions | `interaction.#` |
| arrakis.events | arrakis.events.guild | `member.#` |
| arrakis.events | arrakis.events.guild | `guild.#` |
| arrakis.dlx | arrakis.dlq | `dead` |

**Setup Script**: `setup-topology.sh` is idempotent and uses RabbitMQ HTTP API to create topology.

### TASK-1.3: Create Ingestor ECR Repository
**File**: `infrastructure/terraform/ecs.tf`

- **Resource**: `aws_ecr_repository.ingestor`
- **Name**: `${local.name_prefix}-ingestor`
- **Image Scanning**: Enabled on push
- **Encryption**: AES256
- **Lifecycle Policy**: Keep last 10 images, expire untagged after 7 days

### TASK-1.4: Create Ingestor Security Group
**File**: `infrastructure/terraform/ecs.tf`

- **Resource**: `aws_security_group.ingestor`
- **Ingress**: None (Ingestor has no incoming connections)
- **Egress**:
  - Port 5671 (AMQPS) to RabbitMQ security group
  - Port 443 (HTTPS) to 0.0.0.0/0 for Discord Gateway and CloudWatch

**RabbitMQ Security Group** (`infrastructure/terraform/rabbitmq.tf`):
- Port 15671 (Management Console) from VPC CIDR
- Port 5671 (AMQPS) from ECS tasks and Ingestor via separate rules

**Circular Dependency Resolution**:
Changed from inline ingress rules to `aws_security_group_rule` resources to avoid cycle between Ingestor and RabbitMQ security groups:
- `aws_security_group_rule.rabbitmq_from_ecs`
- `aws_security_group_rule.rabbitmq_from_ingestor`

### TASK-1.5: Add RabbitMQ Credentials to Secrets Manager
**File**: `infrastructure/terraform/rabbitmq.tf`

- **Resource**: `aws_secretsmanager_secret.rabbitmq_credentials`
- **Secret Name**: `${local.name_prefix}/rabbitmq`
- **Recovery Window**: 7 days
- **Contents**:
  - `host`: AMQPS endpoint
  - `username`: "arrakis"
  - `password`: Generated password
  - `url`: Full AMQPS connection URL
  - `management_url`: Management console URL

**IAM Policy**: `aws_iam_role_policy.ecs_execution_rabbitmq_secrets` grants ECS execution role access to read the secret.

### TASK-1.6: Update GitHub Actions for Ingestor
**File**: `.github/workflows/deploy-ingestor.yml`

Complete CI/CD pipeline with 3 jobs:

1. **Build Job**:
   - Checks out code
   - Determines environment (staging/production based on branch)
   - Logs into ECR
   - Builds Docker image with BuildKit caching
   - Pushes with SHA and environment tags

2. **Deploy Job**:
   - Gets current task definition
   - Updates image to new SHA tag
   - Registers new task definition revision
   - Updates ECS service with new task definition
   - Waits for service stability

3. **Health Check Job**:
   - Waits 30 seconds for startup
   - Checks ECS task health status
   - Reports HEALTHY, UNKNOWN, or failure

**Triggers**:
- Push to staging/main when `apps/ingestor/**` changes
- Manual workflow dispatch with environment selection

## Infrastructure Additions

### New Variables (`infrastructure/terraform/variables.tf`)
```hcl
variable "rabbitmq_instance_type" { default = "mq.t3.micro" }
variable "ingestor_cpu" { default = 256 }
variable "ingestor_memory" { default = 512 }
variable "ingestor_desired_count" { default = 1 }
```

### New Outputs (`infrastructure/terraform/outputs.tf`)
```hcl
output "rabbitmq_broker_id"
output "rabbitmq_endpoint" (sensitive)
output "rabbitmq_management_url"
output "rabbitmq_credentials_secret_arn"
output "ingestor_ecr_repository_url"
```

### ECS Resources Added
- `aws_cloudwatch_log_group.ingestor`
- `aws_ecr_repository.ingestor`
- `aws_ecr_lifecycle_policy.ingestor`
- `aws_security_group.ingestor`
- `aws_ecs_task_definition.ingestor`
- `aws_ecs_service.ingestor` (desired_count = 0 until code ready)

## Validation

```bash
$ terraform validate
Success! The configuration is valid.
```

## Files Changed

| File | Action | Lines |
|------|--------|-------|
| `infrastructure/terraform/rabbitmq.tf` | Created | 154 |
| `infrastructure/terraform/variables.tf` | Modified | +26 |
| `infrastructure/terraform/outputs.tf` | Modified | +24 |
| `infrastructure/terraform/ecs.tf` | Modified | +150 |
| `infrastructure/rabbitmq/definitions.json` | Created | 73 |
| `infrastructure/rabbitmq/setup-topology.sh` | Created | 175 |
| `.github/workflows/deploy-ingestor.yml` | Created | 292 |

## Architecture Diagram

```
                    ┌─────────────────────────────────────────────────┐
                    │              Amazon MQ (RabbitMQ)               │
                    │                                                 │
                    │  ┌─────────────────────────────────────────┐   │
                    │  │         Exchange: arrakis.events        │   │
                    │  │              (topic)                    │   │
                    │  └──────┬──────────────┬──────────────────┘   │
                    │         │              │                       │
                    │    interaction.#   member.#/guild.#           │
                    │         │              │                       │
                    │         ▼              ▼                       │
                    │  ┌────────────┐ ┌─────────────────┐           │
                    │  │interactions│ │ events.guild    │           │
                    │  │ (priority) │ │    (normal)     │           │
                    │  └────────────┘ └─────────────────┘           │
                    │         │              │                       │
                    │         └──────┬───────┘                       │
                    │                │ (on failure)                  │
                    │                ▼                               │
                    │  ┌─────────────────────────────────────────┐   │
                    │  │         Exchange: arrakis.dlx           │   │
                    │  └──────────────────┬──────────────────────┘   │
                    │                     │                          │
                    │                     ▼                          │
                    │  ┌─────────────────────────────────────────┐   │
                    │  │         Queue: arrakis.dlq              │   │
                    │  │           (TTL: 7 days)                 │   │
                    │  └─────────────────────────────────────────┘   │
                    └─────────────────────────────────────────────────┘
```

## Next Sprint Preview

**Sprint GW-2: Ingestor Service** will implement:
- TASK-2.1: Create apps/ingestor/ package structure
- TASK-2.2: Implement Discord Gateway connection with discord.js
- TASK-2.3: RabbitMQ publisher with connection pooling
- TASK-2.4: Event serialization and routing
- TASK-2.5: Health check endpoint
- TASK-2.6: Dockerfile and local testing

## Deployment Notes

1. **Terraform Apply**: Run `terraform apply` to create RabbitMQ broker (~15 min)
2. **Queue Topology**: After broker creation, run `setup-topology.sh` with credentials from Secrets Manager
3. **Ingestor Service**: Currently scaled to 0 - will be enabled in Sprint GW-2

## Risk Assessment

| Risk | Mitigation |
|------|------------|
| RabbitMQ creation time (~15 min) | Plan deployment windows accordingly |
| Message loss during broker restart | DLQ captures failed messages for 7 days |
| Security group complexity | Separate rules avoid circular dependencies |

---

**Implementation by**: Claude (implementing-tasks agent)
**Ready for Review**: Yes

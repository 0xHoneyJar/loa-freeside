# Infrastructure Documentation

<!-- cite: loa-freeside:infrastructure/terraform/ -->

AWS ECS deployment infrastructure for the Freeside platform. 20 Terraform modules managing compute, database, cache, messaging, monitoring, and security.

## Deployment Topology

```
Route 53 (DNS)
    │
    ▼
Application Load Balancer (HTTPS:443)
    │
    ▼
┌─────────────────────────────────────────────┐
│  ECS Cluster (Fargate/Fargate Spot)         │
│                                             │
│  ┌─────────────┐  ┌──────────────────────┐  │
│  │ API Service  │  │ Gateway (Rust/Axum)  │  │
│  │ (2-10 tasks) │  │ Discord WSS → NATS   │  │
│  │ Port 3000    │  │ 25 shards/pod        │  │
│  └──────┬───────┘  └──────────┬───────────┘  │
│         │                     │              │
│  ┌──────▼───────┐  ┌─────────▼────────────┐  │
│  │ Ingestor     │  │ GP-Worker (1-10)     │  │
│  │ (1 per shard)│  │ Queue-scaled         │  │
│  └──────────────┘  └─────────────────────┘  │
│                                             │
│  ┌──────────────────┐  ┌────────────────┐   │
│  │ NATS JetStream   │  │ PgBouncer      │   │
│  │ (3 nodes)        │  │ Port 6432      │   │
│  │ Ports 4222/6222  │  │ Pool size: 25  │   │
│  └──────────────────┘  └───────┬────────┘   │
└─────────────────────────────────┼────────────┘
                                  │
    ┌─────────────────────────────┼────────────┐
    │  Data Layer                 │            │
    │                             ▼            │
    │  ┌──────────────┐  ┌───────────────┐    │
    │  │ RDS PG 15    │  │ Redis 7.0     │    │
    │  │ Port 5432    │  │ Port 6379     │    │
    │  │ RLS + SSL    │  │ TLS + AES256  │    │
    │  └──────────────┘  └───────────────┘    │
    │                                          │
    │  ┌──────────────────────────────────┐    │
    │  │ Amazon MQ RabbitMQ 3.13         │    │
    │  │ Port 5671 (AMQPS)              │    │
    │  └──────────────────────────────────┘    │
    └──────────────────────────────────────────┘
```

## Module Inventory

<!-- cite: loa-freeside:infrastructure/terraform/main.tf -->
<!-- cite: loa-freeside:infrastructure/terraform/variables.tf -->

| File | Lines | Purpose |
|------|-------|---------|
| `main.tf` | 63 | Provider configuration, locals, S3 backend |
| `variables.tf` | 241 | All input variables |
| `outputs.tf` | 85 | Exported values (VPC ID, cluster name, endpoints) |
| `vpc.tf` | 78 | VPC, subnets, NAT gateway, VPC endpoints |
| `alb.tf` | 112 | Application Load Balancer, HTTPS listeners, ACM cert |
| `ecs.tf` | 1,225 | ECS cluster, task definitions, services (API, Worker, Ingestor, GP-Worker) |
| `rds.tf` | 107 | PostgreSQL 15, parameter group, security group |
| `elasticache.tf` | 73 | Redis 7.0, encryption at-rest + transit |
| `nats.tf` | 468 | NATS JetStream cluster (3 nodes), ECS service |
| `gateway.tf` | 434 | Rust Twilight gateway, ECR repo, lifecycle policies |
| `rabbitmq.tf` | 158 | Amazon MQ RabbitMQ 3.13 |
| `pgbouncer.tf` | 248 | PgBouncer connection pooler (max 1000 clients) |
| `agent-monitoring.tf` | 666 | Agent gateway CloudWatch dashboard + 8 alarms |
| `monitoring.tf` | 1,072 | Main CloudWatch dashboard, alarms, SNS |
| `autoscaling.tf` | 627 | Target tracking (CPU 70%), step scaling (queue depth) |
| `route53.tf` | 81 | Public hosted zone, ACM validation records |
| `kms.tf` | 135 | KMS keys for Secrets Manager, rotation enabled |
| `byok-security.tf` | 349 | BYOK subnet, Network Firewall domain allowlist |
| `tracing.tf` | 422 | Grafana Tempo (OTLP gRPC/HTTP) |
| `gaib-backups.tf` | 480 | S3 backup bucket, DynamoDB metadata, EventBridge |

<!-- cite: loa-freeside:infrastructure/terraform/ecs.tf -->
<!-- cite: loa-freeside:infrastructure/terraform/rds.tf -->
<!-- cite: loa-freeside:infrastructure/terraform/agent-monitoring.tf -->
<!-- cite: loa-freeside:infrastructure/terraform/byok-security.tf -->

## ECS Services

| Service | CPU | Memory | Desired | Auto-Scale | Port |
|---------|-----|--------|---------|------------|------|
| API | 512 | 1024 MB | 2 | 2-10 (CPU 70%) | 3000 |
| Ingestor | 256 | 512 MB | 1 | Static | — |
| GP-Worker | 256 | 512 MB | 1 | 1-10 (queue depth) | — |
| NATS JetStream | 512 | 1024 MB | 3 | Static (quorum) | 4222 |
| Gateway (Rust) | 512 | 1024 MB | 1 | Static (per 25 shards) | — |
| PgBouncer | — | — | 1 | Static | 6432 |

## Database Configuration

**PostgreSQL 15 (RDS)**
- Instance: `db.t3.small` (configurable via `db_instance_class`)
- Storage: 20 GB (configurable)
- SSL forced, RLS support
- Logging: DDL statements, queries > 1000ms
- Backups: 7-day retention

**Redis 7.0 (ElastiCache)**
- Node type: `cache.t3.micro` (configurable)
- Encryption: AES256 at-rest + TLS in-transit
- Auth: Token-based (32-char random)
- Snapshots: 7-day retention, 02:00-03:00 UTC

## Monitoring

<!-- cite: loa-freeside:infrastructure/terraform/monitoring.tf -->
<!-- cite: loa-freeside:infrastructure/terraform/agent-monitoring.tf -->

### CloudWatch Dashboards

1. **Main Dashboard** — Cluster health (ECS CPU/memory, RDS, Redis, ALB latency)
2. **Agent Gateway Dashboard** — Request latency (p99), throughput, error rates, circuit breaker, budget utilization
3. **Auto-Scaling Dashboard** — Scale events, queue depth, target tracking

### CloudWatch Alarms (15+)

| Alarm | Threshold | Period |
|-------|-----------|--------|
| API CPU High | > 80% | 2 eval periods |
| API Memory High | > 80% | 2 eval periods |
| RDS CPU High | > 80% | — |
| Agent Error Rate | > 5% | 5 minutes |
| Agent Latency (p99) | > 5s | — |
| Circuit Breaker Open | > 2 min | — |
| Budget Threshold | > 80% | — |
| Token Estimate Drift | > 100% | — |

Alarms notify via SNS topic (configurable via `sns_alarm_topic_arn`).

## Security

### Network Isolation

```
ALB Security Group:       443, 80 from 0.0.0.0/0
ECS Tasks Security Group: 5432 (RDS), 6379 (Redis), 4222 (NATS), 5671 (RabbitMQ)
RDS Security Group:       5432 from ECS tasks + PgBouncer only
Redis Security Group:     6379 from ECS tasks only
```

### BYOK Network Defense

When `byok_enabled = true`:
- Dedicated BYOK subnets (10.0.200.0/24, 10.0.201.0/24)
- AWS Network Firewall with domain allowlist
- Stateful domain inspection rules for SSRF protection

### Secrets Management

All secrets stored in AWS Secrets Manager with KMS encryption:
- RDS credentials
- Redis auth token
- RabbitMQ password
- Vault token

## Cost Estimation

Approximate monthly cost for a production deployment:

| Resource | Estimated Cost |
|----------|---------------|
| ECS Fargate (API 2x, workers) | ~$60-80 |
| RDS db.t3.small | ~$25 |
| ElastiCache cache.t3.micro | ~$12 |
| Amazon MQ mq.t3.micro | ~$25 |
| ALB + data transfer | ~$20-30 |
| Route 53 + CloudWatch | ~$10-15 |
| **Total** | **~$150-200/mo** |

Costs scale with auto-scaling. FARGATE_SPOT reduces compute costs ~60%.

## Staging Deployment Guide

### Prerequisites

1. AWS account with appropriate IAM permissions
2. Terraform >= 1.6.0 installed
3. S3 bucket for Terraform state (created manually or via bootstrap)
4. KMS key for state encryption (created manually)
5. Domain registered with nameservers pointed to Route 53

### Step-by-Step

```bash
cd infrastructure/terraform

# 1. Initialize Terraform
terraform init

# 2. Create staging variables file
cp terraform.tfvars.example terraform.staging.tfvars
# Edit with staging values: smaller instances, single AZ, etc.

# 3. Preview changes
terraform plan -var-file=terraform.staging.tfvars

# 4. Apply
terraform apply -var-file=terraform.staging.tfvars

# 5. Verify
terraform output  # Shows ALB DNS, RDS endpoint, etc.
```

### Key Variables

```hcl
environment          = "staging"
aws_region           = "us-east-1"
vpc_cidr             = "10.0.0.0/16"
root_domain          = "example.com"
db_instance_class    = "db.t3.small"
redis_node_type      = "cache.t3.micro"
api_desired_count    = 1
agent_enabled        = "false"
byok_enabled         = false
```

## Production Hardening Checklist

- [ ] Multi-AZ RDS instance (upgrade from `db.t3.small`)
- [ ] Redis cluster mode (upgrade from single node)
- [ ] RabbitMQ `CLUSTER_MULTI_AZ` deployment mode
- [ ] BYOK Network Firewall enabled (`byok_enabled = true`)
- [ ] SNS alarm topic configured for PagerDuty/Slack integration
- [ ] VPC Flow Logs enabled and reviewed
- [ ] Secrets rotation enabled for all KMS keys
- [ ] CloudWatch log retention set appropriately (30 days default)
- [ ] Auto-scaling policies tuned for expected load
- [ ] Container image scanning enabled on all ECR repos
- [ ] No credentials in Terraform state (use dynamic secrets)

## Docker Development

<!-- cite: loa-freeside:docker-compose.dev.yml -->

Local development uses `docker-compose.dev.yml`:

```bash
docker-compose -f docker-compose.dev.yml up -d
# Starts: PostgreSQL 15, Redis, sietch-dev (hot-reload)
```

| Service | Port | Purpose |
|---------|------|---------|
| postgres | 5432 | PostgreSQL 15-alpine |
| redis | 6379 | Redis latest |
| sietch-dev | 3000 | Node.js dev server (hot-reload) |

## Next Steps

- [CLI.md](CLI.md) — gaib CLI reference for deployment commands
- [API-REFERENCE.md](API-REFERENCE.md) — Full API endpoint reference
- [DEVELOPER-GUIDE.md](DEVELOPER-GUIDE.md) — Learning path and document ownership

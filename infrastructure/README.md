# Infrastructure

This directory contains the Infrastructure as Code (IaC) for Freeside, using Terraform to provision AWS resources.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              AWS Region: us-east-1                           │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                        VPC: 10.0.0.0/16                                 │ │
│  │                                                                         │ │
│  │  ┌──────────────────────────┐  ┌──────────────────────────┐            │ │
│  │  │   Public Subnet (AZ-a)   │  │   Public Subnet (AZ-b)   │            │ │
│  │  │   10.0.101.0/24          │  │   10.0.102.0/24          │            │ │
│  │  │   ┌────────────────────┐ │  │                          │            │ │
│  │  │   │        ALB         │ │  │                          │            │ │
│  │  │   └────────────────────┘ │  │                          │            │ │
│  │  └──────────────────────────┘  └──────────────────────────┘            │ │
│  │                          │                                              │ │
│  │  ┌──────────────────────────┐  ┌──────────────────────────┐            │ │
│  │  │   Private Subnet (AZ-a)  │  │   Private Subnet (AZ-b)  │            │ │
│  │  │   10.0.1.0/24            │  │   10.0.2.0/24            │            │ │
│  │  │   ┌────────────────────┐ │  │   ┌────────────────────┐ │            │ │
│  │  │   │   ECS API Task     │ │  │   │   ECS API Task     │ │            │ │
│  │  │   │   ECS Worker Task  │ │  │   │   ECS Worker Task  │ │            │ │
│  │  │   └────────────────────┘ │  │   └────────────────────┘ │            │ │
│  │  │                          │  │                          │            │ │
│  │  │   ┌────────────────────┐ │  │   ┌────────────────────┐ │            │ │
│  │  │   │   RDS PostgreSQL   │ │  │   │    ElastiCache     │ │            │ │
│  │  │   │      (Primary)     │ │  │   │       Redis        │ │            │ │
│  │  │   └────────────────────┘ │  │   └────────────────────┘ │            │ │
│  │  └──────────────────────────┘  └──────────────────────────┘            │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│  ┌────────────────────┐  ┌────────────────────┐  ┌────────────────────┐     │
│  │        ECR         │  │  Secrets Manager   │  │   CloudWatch Logs  │     │
│  │   arrakis-api      │  │   app-config       │  │   /ecs/arrakis/*   │     │
│  └────────────────────┘  │   db-credentials   │  └────────────────────┘     │
│                          │   vault-token      │                              │
│                          └────────────────────┘                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Resources

### Compute (ECS Fargate)

| Resource | Description | Configuration |
|----------|-------------|---------------|
| ECS Cluster | Container orchestration | Fargate + FARGATE_SPOT |
| API Service | REST API + Discord bot | 512 CPU, 1024 MB, 2 tasks |
| Worker Service | Background jobs | 256 CPU, 512 MB, 1 task |
| ECR Repository | Container images | Scan-on-push, 10 image retention |

### Database

| Resource | Description | Configuration |
|----------|-------------|---------------|
| RDS PostgreSQL | Primary database | db.t3.small, 20GB, PostgreSQL 15.10 |
| ElastiCache Redis | Caching & rate limiting | cache.t3.micro |

### Networking

| Resource | Description | Configuration |
|----------|-------------|---------------|
| VPC | Network isolation | 10.0.0.0/16 |
| Private Subnets | Workload isolation | 10.0.1.0/24, 10.0.2.0/24 |
| Public Subnets | Internet-facing | 10.0.101.0/24, 10.0.102.0/24 |
| NAT Gateway | Outbound internet | Single NAT (cost-optimized) |
| VPC Endpoints | AWS service access | ECR, S3, CloudWatch Logs |
| ALB | Load balancer | HTTPS only, ACM certificate |

### Security

| Resource | Description |
|----------|-------------|
| Secrets Manager | Credentials storage (app-config, db, vault) |
| Security Groups | Network access control |
| IAM Roles | Task execution and task roles |
| ACM Certificate | TLS/SSL for ALB |

### Monitoring

| Resource | Description |
|----------|-------------|
| CloudWatch Logs | Container and VPC flow logs |
| CloudWatch Alarms | CPU, memory, error rate alerts |
| Container Insights | ECS metrics |
| SNS Topic | Alert notifications |

## Prerequisites

- AWS CLI v2 configured
- Terraform >= 1.5.0
- Access to AWS account 891376933289

## State Management

Terraform state is stored in S3 with DynamoDB locking:

```hcl
backend "s3" {
  bucket         = "arrakis-tfstate-891376933289"
  key            = "production/terraform.tfstate"
  region         = "us-east-1"
  encrypt        = true
  dynamodb_table = "arrakis-terraform-locks"
}
```

## Usage

### Initial Setup (already done)

```bash
cd infrastructure/terraform

# Initialize Terraform
terraform init

# Plan changes
terraform plan -out=tfplan

# Apply changes
terraform apply tfplan
```

### Making Changes

1. Modify the relevant `.tf` files
2. Run `terraform plan` to preview changes
3. Review the plan carefully
4. Apply with `terraform apply`

### Important Files

| File | Purpose |
|------|---------|
| `main.tf` | Provider config, backend |
| `variables.tf` | Input variables |
| `vpc.tf` | VPC and networking |
| `ecs.tf` | ECS cluster, services, tasks |
| `rds.tf` | PostgreSQL database |
| `elasticache.tf` | Redis cache |
| `alb.tf` | Load balancer |
| `monitoring.tf` | CloudWatch alarms, dashboards |
| `outputs.tf` | Terraform outputs |

## Environments

### Production

Current infrastructure is production-only. Resources are prefixed with `arrakis-production-*`.

### Staging (Planned)

To create a staging environment:

1. Create `environments/staging/` directory
2. Use Terraform workspaces or separate state
3. Deploy with reduced resources (t3.micro, etc.)

## Cost Optimization

Current monthly estimate: ~$150-200/month

| Resource | Monthly Cost |
|----------|-------------|
| ECS Fargate (2 API + 1 Worker) | ~$50 |
| RDS db.t3.small | ~$30 |
| ElastiCache cache.t3.micro | ~$15 |
| NAT Gateway | ~$35 |
| ALB | ~$20 |
| Data transfer, storage | ~$20 |

### Cost Reduction Options

- Use FARGATE_SPOT for non-critical tasks
- Reserved Instances for RDS (1-year: ~30% savings)
- Remove NAT Gateway if VPC endpoints sufficient
- Reduce log retention period

## Security Considerations

### Secrets Management

All sensitive values stored in AWS Secrets Manager:
- `arrakis-production/app-config` - Application secrets
- `arrakis-production/db-credentials` - Database URL
- `arrakis-production/redis-credentials` - Redis URL
- `arrakis-production/vault-token` - HashiCorp Vault token

### Network Security

- All workloads in private subnets
- ALB is only public-facing resource
- VPC endpoints reduce NAT traffic
- Security groups restrict inter-service communication

### Database Security

- RDS not publicly accessible
- SSL/TLS enforced
- Encryption at rest enabled
- 7-day backup retention
- Deletion protection enabled

## Troubleshooting

### Common Issues

**ECS tasks failing to start:**
```bash
# Check task definition
aws ecs describe-task-definition --task-definition arrakis-production-api

# Check service events
aws ecs describe-services \
  --cluster arrakis-production-cluster \
  --services arrakis-production-api \
  --query 'services[0].events[:10]'

# Check logs
aws logs tail /ecs/arrakis-production/api --since 1h
```

**Database connection issues:**
```bash
# Verify security group allows traffic
aws ec2 describe-security-groups --group-ids sg-xxx

# Check RDS status
aws rds describe-db-instances --db-instance-identifier arrakis-production-postgres
```

**Secrets not available:**
```bash
# List secrets
aws secretsmanager list-secrets --filter Key=name,Values=arrakis-production

# Get secret value (careful!)
aws secretsmanager get-secret-value --secret-id arrakis-production/app-config
```

## Related Documentation

- [DEVELOPMENT.md](../DEVELOPMENT.md) - Development workflow
- [themes/sietch/SECURITY.md](../themes/sietch/SECURITY.md) - Security controls
- [grimoires/loa/deployment/](../grimoires/loa/deployment/) - Deployment guides (local)

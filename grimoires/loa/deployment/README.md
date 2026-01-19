# Arrakis Deployment Documentation

This directory contains infrastructure and deployment documentation for the Arrakis sietch-service.

## Current Status

**Environment**: AWS ECS Fargate (us-east-1)
**Status**: Infrastructure Ready - Awaiting Secrets Configuration
**Last Update**: 2026-01-12

## Key Documents

| Document | Description |
|----------|-------------|
| [DEPLOYMENT-REPORT.md](./DEPLOYMENT-REPORT.md) | Current deployment status and action items |
| [deployment-guide.md](./deployment-guide.md) | Step-by-step deployment procedures |
| [infrastructure.md](./infrastructure.md) | Infrastructure architecture documentation |
| [runbooks/](./runbooks/) | Operational runbooks for incidents, backups, monitoring |

## Quick Start

### Pending Actions (After Initial Deployment)

1. **Populate Secrets** (Operations Team)
   ```bash
   aws secretsmanager put-secret-value \
     --secret-id "arrakis-production/app-config" \
     --secret-string '{ "BGT_ADDRESS": "0x...", "DISCORD_BOT_TOKEN": "...", ... }'
   ```

2. **Configure DNS** (DNS Administrator)
   - Add CNAME: `api.arrakis.community` → `arrakis-production-alb-427042206.us-east-1.elb.amazonaws.com`
   - Add ACM validation CNAME (see DEPLOYMENT-REPORT.md)

3. **Force ECS Redeployment**
   ```bash
   aws ecs update-service --cluster arrakis-production-cluster --service arrakis-production-api --force-new-deployment
   aws ecs update-service --cluster arrakis-production-cluster --service arrakis-production-worker --force-new-deployment
   ```

## Infrastructure Resources

| Resource | Value |
|----------|-------|
| AWS Account | 891376933289 |
| Region | us-east-1 |
| VPC | vpc-08ccffcf89b8ec20d |
| ECS Cluster | arrakis-production-cluster |
| ECR Repository | 891376933289.dkr.ecr.us-east-1.amazonaws.com/arrakis-production-api |
| ALB DNS | arrakis-production-alb-427042206.us-east-1.elb.amazonaws.com |

## Terraform

Infrastructure is managed via Terraform in `/infrastructure/terraform/`:

```bash
cd infrastructure/terraform
terraform init
terraform plan
terraform apply
```

## CI/CD

GitHub Actions workflow (`.github/workflows/deploy.yml`) automatically:
1. Runs tests and security scans
2. Builds and pushes Docker image to ECR
3. Triggers ECS service update

## Security Note

`SERVER-REALITY-AUDIT.md` and similar sensitive files are excluded from version control.

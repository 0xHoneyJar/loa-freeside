# Railway → AWS Migration Runbook

Issue: https://github.com/0xHoneyJar/loa-freeside/issues/159

## Overview

Migrate 3 Railway Postgres databases to existing AWS RDS and deploy score-api as an ECS world.

## Prerequisites

- AWS CLI configured with admin access
- `psql` client installed
- Access to Railway dashboard (connection strings)
- Terraform changes applied (world-score-api.tf)

## Phase 1: Create Databases on RDS

Connect to RDS via ECS Exec (bastion) or local tunnel:

```bash
# Get RDS endpoint from Terraform
cd infrastructure/terraform
RDS_HOST=$(terraform output -raw rds_endpoint)

# Connect via ECS Exec on any running task
aws ecs execute-command \
  --cluster arrakis-production-cluster \
  --task <TASK_ID> \
  --container <CONTAINER> \
  --interactive \
  --command "psql postgresql://arrakis_admin:<password>@${RDS_HOST}:5432/arrakis"

# Create databases
CREATE DATABASE score_api;
CREATE DATABASE mibera;
CREATE DATABASE cubquests;

# Verify
\l
```

## Phase 2: Dump from Railway + Restore to RDS

### 2a. score-api (62 tables + 11 materialized views)

```bash
# Dump from Railway
pg_dump "postgresql://<user>:<pass>@interchange.proxy.rlwy.net:56528/railway" \
  --no-owner --no-privileges --format=custom \
  -f /tmp/score_api_dump.sql

# Restore to RDS
pg_restore -d "postgresql://arrakis_admin:<pass>@${RDS_HOST}:5432/score_api?sslmode=require" \
  --no-owner --no-privileges \
  /tmp/score_api_dump.sql

# Verify row counts
psql "postgresql://arrakis_admin:<pass>@${RDS_HOST}:5432/score_api?sslmode=require" \
  -c "SELECT schemaname, relname, n_live_tup FROM pg_stat_user_tables ORDER BY n_live_tup DESC;"
```

### 2b. mibera + midi (shared — 89 tables)

```bash
pg_dump "postgresql://<user>:<pass>@interchange.proxy.rlwy.net:30555/railway" \
  --no-owner --no-privileges --format=custom \
  -f /tmp/mibera_dump.sql

pg_restore -d "postgresql://arrakis_admin:<pass>@${RDS_HOST}:5432/mibera?sslmode=require" \
  --no-owner --no-privileges \
  /tmp/mibera_dump.sql
```

### 2c. cubquests (46 tables + 2 views)

```bash
pg_dump "postgresql://<user>:<pass>@turntable.proxy.rlwy.net:26609/railway" \
  --no-owner --no-privileges --format=custom \
  -f /tmp/cubquests_dump.sql

pg_restore -d "postgresql://arrakis_admin:<pass>@${RDS_HOST}:5432/cubquests?sslmode=require" \
  --no-owner --no-privileges \
  /tmp/cubquests_dump.sql
```

## Phase 3: Apply Terraform (score-api ECS world)

```bash
cd infrastructure/terraform
terraform plan -target=module.world_score_api -target=aws_secretsmanager_secret.score_api_db_url
terraform apply -target=module.world_score_api -target=aws_secretsmanager_secret.score_api_db_url
```

This creates:
- ECR repository for score-api
- ECS service + task definition
- Secrets Manager secret with DATABASE_URL
- ALB listener rule for `score-api.0xhoneyjar.xyz`
- Security group rules for RDS access
- GitHub OIDC CI deploy role

## Phase 4: Deploy score-api Container

### 4a. Add deploy workflow to score-api repo

Copy the template from `ci-templates/world-deploy.yml` and set:

```yaml
env:
  AWS_REGION: us-east-1
  ECR_REPOSITORY: arrakis-production-world-score-api
  ECS_CLUSTER: arrakis-production-cluster
  ECS_SERVICE: arrakis-production-world-score-api
```

### 4b. Set GitHub secret

```bash
# Get the CI role ARN from Terraform output
CI_ROLE=$(terraform output -raw score_api_ci_role_arn)

# Set in score-api repo
gh secret set AWS_DEPLOY_ROLE_ARN --repo 0xHoneyJar/score-api --body "$CI_ROLE"
```

### 4c. Build and push initial image

```bash
# Get ECR URL
ECR_URL=$(terraform output -raw score_api_ecr_url)

# Login to ECR
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin $ECR_URL

# Build and push from score-api repo
cd /path/to/score-api
docker build -t $ECR_URL:latest .
docker push $ECR_URL:latest

# Force new deployment
aws ecs update-service \
  --cluster arrakis-production-cluster \
  --service arrakis-production-world-score-api \
  --force-new-deployment
```

## Phase 5: Update Vercel Frontends

Update `DATABASE_URL` environment variable in Vercel for each app:

| App | Vercel Project | New DATABASE_URL |
|-----|---------------|-----------------|
| mibera-interface | mibera-interface | `postgresql://arrakis_admin:<pass>@<RDS_HOST>:5432/mibera?sslmode=no-verify` |
| midi-interface | midi-interface | `postgresql://arrakis_admin:<pass>@<RDS_HOST>:5432/mibera?sslmode=no-verify` |
| cubquests-interface | cubquests-interface | `postgresql://arrakis_admin:<pass>@<RDS_HOST>:5432/cubquests?sslmode=no-verify` |

**Note**: Vercel uses `?sslmode=no-verify` (not `require`) because Vercel's Node.js doesn't have the RDS CA bundle. The ECS services use `?sslmode=require` since they're in the same VPC.

**Important**: mibera-interface and midi-interface share the same `mibera` database.

## Phase 6: Verify

1. **score-api**: `curl https://score-api.0xhoneyjar.xyz/health`
2. **mibera-interface**: Check site loads, data displays correctly
3. **midi-interface**: Check site loads, data displays correctly
4. **cubquests-interface**: Check site loads, data displays correctly

## Phase 7: Safety Window (1 week)

- Keep Railway databases running as read-only fallback
- Monitor CloudWatch logs for connection errors
- Check RDS Performance Insights for query patterns

## Phase 8: Cancel Railway

After 1 week with no issues:

1. Railway dashboard → score-api project → Delete
2. Railway dashboard → mibera Postgres → Delete
3. Railway dashboard → cubquests Postgres → Delete

## Rollback

If issues occur:
1. **Vercel apps**: Revert `DATABASE_URL` to Railway connection strings
2. **score-api**: Set `desired_count = 0` in Terraform, redeploy on Railway
3. **Data**: Railway databases are untouched during migration (dump is read-only)

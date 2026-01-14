# Terraform Environments

This directory contains environment-specific configurations for Terraform.

## Structure

```
environments/
├── staging/
│   ├── backend.tfvars      # State backend config
│   └── terraform.tfvars    # Environment variables
└── production/
    ├── backend.tfvars      # State backend config
    └── terraform.tfvars    # Environment variables
```

## Usage

### Initial Setup (New Environment)

```bash
cd infrastructure/terraform

# Initialize with environment-specific backend
terraform init -backend-config=environments/staging/backend.tfvars -reconfigure

# Plan with environment-specific variables
terraform plan -var-file=environments/staging/terraform.tfvars -out=tfplan

# Apply
terraform apply tfplan
```

### Switching Environments

```bash
# Switch to staging
terraform init -backend-config=environments/staging/backend.tfvars -reconfigure

# Switch to production
terraform init -backend-config=environments/production/backend.tfvars -reconfigure
```

## Environment Comparison

| Resource | Staging | Production |
|----------|---------|------------|
| VPC CIDR | 10.1.0.0/16 | 10.0.0.0/16 |
| API Tasks | 1 | 2 |
| API CPU | 256 | 512 |
| API Memory | 512 MB | 1024 MB |
| RDS Instance | db.t3.micro | db.t3.small |
| RDS Storage | 10 GB | 20 GB |
| Redis | cache.t3.micro | cache.t3.micro |
| Domain | staging.api.arrakis.community | api.arrakis.community |

## Cost Estimates

| Environment | Monthly Cost |
|-------------|-------------|
| Staging | ~$80-100 |
| Production | ~$150-200 |

## Secrets

Each environment uses separate secrets in AWS Secrets Manager:

| Secret | Staging | Production |
|--------|---------|------------|
| App Config | `arrakis-staging/app-config` | `arrakis-production/app-config` |
| DB Credentials | `arrakis-staging/db-credentials` | `arrakis-production/db-credentials` |
| Redis Credentials | `arrakis-staging/redis-credentials` | `arrakis-production/redis-credentials` |
| Vault Token | `arrakis-staging/vault-token` | `arrakis-production/vault-token` |

## Creating Staging Infrastructure

### Prerequisites

1. AWS CLI configured with appropriate permissions
2. ACM certificate for `staging.api.arrakis.community`
3. DNS records configured

### Steps

```bash
# 1. Initialize staging backend
cd infrastructure/terraform
terraform init -backend-config=environments/staging/backend.tfvars -reconfigure

# 2. Plan staging infrastructure
terraform plan -var-file=environments/staging/terraform.tfvars -out=staging.tfplan

# 3. Review the plan carefully
terraform show staging.tfplan

# 4. Apply (this will create all staging resources)
terraform apply staging.tfplan

# 5. Note the outputs
terraform output
```

### Post-Deployment

1. Create secrets in AWS Secrets Manager:
   ```bash
   aws secretsmanager create-secret \
     --name arrakis-staging/app-config \
     --secret-string '{"DISCORD_BOT_TOKEN":"...","DISCORD_GUILD_ID":"..."}'
   ```

2. Update GitHub Actions secrets if using separate AWS credentials for staging

3. Verify health endpoint:
   ```bash
   curl https://staging.api.arrakis.community/health
   ```

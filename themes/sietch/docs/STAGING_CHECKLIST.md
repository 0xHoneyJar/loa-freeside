# Sietch Staging Deployment Checklist

**Last verified**: 2026-02-25
**Source**: `infrastructure/terraform/variables.tf`, `themes/sietch/.env.example`

Use this checklist before deploying to staging or production. Every item must be confirmed before proceeding.

---

## 1. Secrets Inventory

### From `.env.example` (Application Secrets)

| Secret | Env Var | Status | Notes |
|--------|---------|--------|-------|
| Discord bot token | `DISCORD_BOT_TOKEN` | [ ] Set | Developer Portal > Bot > Token |
| Discord guild ID | `DISCORD_GUILD_ID` | [ ] Set | Right-click server > Copy ID |
| Discord channel IDs | `DISCORD_CHANNEL_THE_DOOR`, `DISCORD_CHANNEL_CENSUS` | [ ] Set | Right-click channels > Copy ID |
| Discord role IDs | `DISCORD_ROLE_NAIB`, `DISCORD_ROLE_FEDAYKIN` | [ ] Set | Server Settings > Roles > Copy ID |
| trigger.dev secret | `TRIGGER_SECRET_KEY` | [ ] Set | trigger.dev Dashboard > API Keys |
| Admin API keys | `ADMIN_API_KEYS` | [ ] Set | Use bcrypt hashes in production |
| API key pepper | `API_KEY_PEPPER` | [ ] Set | `openssl rand -hex 32` |
| Database URL | `DATABASE_URL` | [ ] Set | PostgreSQL connection string |
| Paddle API key | `PADDLE_API_KEY` | [ ] Set (if billing) | Paddle Dashboard > API keys |
| Paddle webhook secret | `PADDLE_WEBHOOK_SECRET` | [ ] Set (if billing) | Paddle Dashboard > Notifications |
| Redis URL | `REDIS_URL` | [ ] Set (if caching) | Upstash or ElastiCache endpoint |
| Vault token | `VAULT_TOKEN` | [ ] Set (if Vault) | AppRole auth in production |
| Dune Sim API key | `DUNE_SIM_API_KEY` | [ ] Set (if hybrid) | sim.dune.com > API keys |

### From Terraform (`variables.tf`) — Infrastructure Secrets

| Secret | Source | Status | Notes |
|--------|--------|--------|-------|
| Vault token | AWS Secrets Manager `arrakis-{env}/vault-token` | [ ] Created | Manual: `aws secretsmanager create-secret` |
| Vault address | `vault_addr` variable | [ ] Set | `https://vault.honeyjar.xyz` for production |
| Slack workspace ID | `slack_workspace_id` variable | [ ] Set (if alerting) | Format: `T01ABCDEF` |
| Slack channel ID | `slack_channel_id` variable | [ ] Set (if alerting) | Format: `C01ABCDEF` |
| SIWE session key ID | `siwe_session_secret_kid` variable | [ ] Set | Default: `v1` |
| SNS alarm topic ARN | `sns_alarm_topic_arn` variable | [ ] Set (if alerts) | CloudWatch alarm notifications |

### Secret Rotation Status

| Secret | Last Rotated | Rotation Policy |
|--------|-------------|-----------------|
| `DISCORD_BOT_TOKEN` | [ ] __________ | On compromise only |
| `TRIGGER_SECRET_KEY` | [ ] __________ | Quarterly |
| `ADMIN_API_KEYS` | [ ] __________ | Quarterly |
| `API_KEY_PEPPER` | [ ] __________ | Annually |
| `PADDLE_WEBHOOK_SECRET` | [ ] __________ | On compromise only |
| `VAULT_TOKEN` | [ ] __________ | Monthly (AppRole auto-rotates) |

---

## 2. Pre-Deployment Steps

### 2.1 Rotate Secrets (If Due)

```bash
# Generate new admin API key
openssl rand -hex 16

# Generate new API key pepper (if rotating)
openssl rand -hex 32

# Regenerate Discord bot token (if compromised)
# Discord Developer Portal > Bot > Reset Token
```

### 2.2 Terraform Plan

```bash
cd infrastructure/terraform

# Initialize (first time or after provider updates)
terraform init

# Plan — review ALL changes before applying
terraform plan -out=staging.tfplan

# Verify:
# - No unexpected resource deletions
# - Security group changes are intentional
# - RDS/ElastiCache sizing is correct
```

**Terraform plan MUST succeed before proceeding.**

### 2.3 Database Migrations

```bash
# Back up database FIRST
pg_dump -Fc $DATABASE_URL > backup-$(date +%Y%m%d).dump

# Run migrations
cd themes/sietch
pnpm db:migrate

# Verify migration state
pnpm db:status
```

### 2.4 Feature Flags Review

| Flag | Default | Staging Value | Notes |
|------|---------|---------------|-------|
| `FEATURE_BILLING_ENABLED` | false | [ ] __________ | Requires Paddle configured |
| `FEATURE_GATEKEEPER_ENABLED` | false | [ ] __________ | Requires billing enabled |
| `FEATURE_REDIS_ENABLED` | false | [ ] __________ | Requires Redis URL set |
| `FEATURE_TELEGRAM_ENABLED` | false | [ ] __________ | Requires Telegram token |
| `FEATURE_VAULT_ENABLED` | false | [ ] __________ | Requires Vault configured |

---

## 3. Deployment Steps

### 3.1 Apply Infrastructure

```bash
# Apply the reviewed plan
terraform apply staging.tfplan

# Verify infrastructure
terraform output
```

### 3.2 Deploy Application

```bash
# SSH to server
ssh user@sietch-api.honeyjar.xyz

# Deploy (see DEPLOYMENT_RUNBOOK.md for full procedure)
sudo -u sietch -i
/opt/sietch/deploy.sh main
```

### 3.3 Post-Deploy Verification

```bash
# Health check — MUST return 200
curl -f https://sietch-api.honeyjar.xyz/health
# Expected: {"status":"healthy","version":"..."}

# Verify Discord bot online
# Check Discord server — bot should show green dot

# Test wallet verification
# In Discord: /verify start
# Complete the EIP-191 signing flow

# Verify eligibility sync
# Check trigger.dev dashboard for sync-eligibility task
```

---

## 4. Verification Gate

**All items must pass before staging is considered ready:**

- [ ] `terraform plan` succeeds with no unexpected changes
- [ ] Database migrations applied successfully
- [ ] `/health` returns HTTP 200 with `{"status":"healthy"}`
- [ ] Discord bot is online (green dot in server)
- [ ] `/verify start` command responds with verification link
- [ ] `trigger.dev` sync-eligibility task is registered
- [ ] No secrets committed to git (`git diff --cached` clean)
- [ ] `.env` file permissions are 600 (owner-only read/write)
- [ ] All ADMIN_API_KEYS use bcrypt hashes (not plaintext)
- [ ] SSL certificate is valid (`curl -vI https://...` shows valid cert)

---

## 5. Rollback Plan

If any verification fails:

```bash
# 1. Rollback application (see DEPLOYMENT_RUNBOOK.md)
cd /opt/sietch
ln -sfn /opt/sietch/releases/PREVIOUS_RELEASE current
pm2 reload sietch --update-env

# 2. Rollback database (if migration caused issues)
pg_restore -Fc -d $DATABASE_URL backup-YYYYMMDD.dump

# 3. Rollback infrastructure (if terraform changes caused issues)
cd infrastructure/terraform
terraform plan   # Review what will change
terraform apply  # Only if reverting to known-good state
```

---

## References

- [Deployment Runbook](./deployment/DEPLOYMENT_RUNBOOK.md) — Full deployment procedures
- [Pre-Deployment Checklist](./deployment/PRE_DEPLOYMENT_CHECKLIST.md) — Credential collection
- [Admin Setup Guide](./ADMIN_SETUP_GUIDE.md) — Discord and bot configuration
- [Wallet Verification Guide](./deployment/collabland-setup.md) — EIP-191 `/verify` setup
- [Infrastructure Overview](./deployment/infrastructure.md) — Architecture diagram

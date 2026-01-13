# Sietch Service Deployment Runbook

This runbook provides step-by-step instructions for deploying and operating the Sietch service in production.

## Table of Contents

1. [Initial Deployment](#initial-deployment)
2. [Upgrading to v2.0 (Social Layer)](#upgrading-to-v20-social-layer)
3. [Subsequent Deployments](#subsequent-deployments)
4. [Rollback Procedure](#rollback-procedure)
5. [Common Operations](#common-operations)
6. [Troubleshooting](#troubleshooting)
7. [Monitoring](#monitoring)

---

## Initial Deployment

### Prerequisites

- OVH VPS with Ubuntu 22.04 LTS
- SSH access with sudo privileges
- Domain DNS configured (sietch-api.honeyjar.xyz)
- GitHub repository access (SSH key)
- Discord bot token and server IDs
- Collab.Land Premium subscription
- trigger.dev project credentials

### Step 1: VPS Setup

SSH into the VPS and run the setup script:

```bash
# Download and run setup script
curl -o setup-vps.sh https://raw.githubusercontent.com/0xHoneyJar/arrakis/main/sietch-service/docs/deployment/scripts/setup-vps.sh
chmod +x setup-vps.sh
sudo bash setup-vps.sh
```

This script:
- Updates system packages
- Installs Node.js 20 LTS
- Installs PM2 globally
- Creates sietch user and directory structure
- Configures firewall (UFW)
- Sets up fail2ban
- Creates environment file template

### Step 2: Configure Environment

Edit the environment file with actual values:

```bash
sudo nano /opt/sietch/.env
```

Required values:
- `BERACHAIN_RPC_URLS` - RPC endpoints (comma-separated)
- `BGT_ADDRESS` - BGT token contract address
- `REWARD_VAULT_ADDRESSES` - Reward vault addresses
- `TRIGGER_PROJECT_ID` - trigger.dev project ID
- `TRIGGER_SECRET_KEY` - trigger.dev secret key
- `DISCORD_BOT_TOKEN` - Discord bot token
- `DISCORD_GUILD_ID` - Sietch Discord server ID
- `DISCORD_CHANNEL_*` - Channel IDs
- `DISCORD_ROLE_*` - Role IDs
- `ADMIN_API_KEYS` - Admin API keys

### Step 3: Configure nginx

```bash
# Copy nginx config
sudo cp /opt/sietch/current/sietch-service/docs/deployment/configs/nginx-sietch.conf \
        /etc/nginx/sites-available/sietch

# Enable site
sudo ln -s /etc/nginx/sites-available/sietch /etc/nginx/sites-enabled/

# Test config
sudo nginx -t

# Reload nginx
sudo systemctl reload nginx
```

### Step 4: Obtain SSL Certificate

```bash
sudo certbot --nginx -d sietch-api.honeyjar.xyz
```

Follow the prompts to:
- Enter email for renewal notifications
- Agree to terms of service
- Choose redirect HTTP to HTTPS

### Step 5: Initial Deploy

```bash
# Switch to sietch user
sudo -u sietch -i

# Clone and deploy
cd /opt/sietch
curl -o deploy.sh https://raw.githubusercontent.com/0xHoneyJar/arrakis/main/sietch-service/docs/deployment/scripts/deploy.sh
chmod +x deploy.sh
./deploy.sh main
```

### Step 6: Verify Deployment

```bash
# Check PM2 status
pm2 list

# Check API health
curl https://sietch-api.honeyjar.xyz/health

# Check logs
tail -f /opt/sietch/logs/out.log
```

### Step 7: Configure Collab.Land

Follow `docs/deployment/collabland-setup.md` to:
1. Add Collab.Land bot to Discord server
2. Create custom API token gates
3. Test verification flow

### Step 8: Setup Backups

```bash
# Copy backup script
cp /opt/sietch/current/sietch-service/docs/deployment/scripts/backup.sh /opt/sietch/scripts/
chmod +x /opt/sietch/scripts/backup.sh

# Setup cron job (as sietch user)
crontab -e
# Add: 0 3 * * * /opt/sietch/scripts/backup.sh
```

---

## Upgrading to v2.0 (Social Layer)

If upgrading an existing v1.0 deployment to v2.0:

### Step 1: Update Environment Variables

Add the new v2.0 variables to `/opt/sietch/.env`:

```bash
# v2.0 Optional Dynamic Roles (leave empty to disable)
DISCORD_ROLE_ONBOARDED=your_role_id
DISCORD_ROLE_ENGAGED=your_role_id
DISCORD_ROLE_VETERAN=your_role_id
DISCORD_ROLE_TRUSTED=your_role_id

# Sietch Lounge Channel (for fallback DMs)
DISCORD_CHANNEL_SIETCH_LOUNGE=your_channel_id
```

### Step 2: Create Discord Roles

In your Discord server:
1. Create new roles: "Onboarded", "Engaged", "Veteran", "Trusted"
2. Position them above @everyone but below Naib/Fedaykin
3. Copy role IDs to .env file

### Step 3: Deploy v2.0

```bash
# Standard deployment
./deploy.sh main
```

The deployment will:
1. Run database migrations automatically (creates new tables)
2. Migration 003 creates placeholder profiles for existing verified members
3. Existing v1.0 members will be prompted to complete onboarding via DM

### Step 4: Verify Migration

```bash
sqlite3 /opt/sietch/data/sietch.db "SELECT COUNT(*) FROM member_profiles WHERE onboarding_complete = 0;"
```

This shows how many v1.0 members need to complete onboarding.

### Step 5: Configure Collab.Land for v2.0

Follow `collabland-setup.md` to update token gates for the new role structure.

---

## Subsequent Deployments

For regular deployments after initial setup:

```bash
# SSH to server
ssh user@sietch-api.honeyjar.xyz

# Switch to sietch user
sudo -u sietch -i

# Deploy latest main branch
/opt/sietch/deploy.sh main

# Or deploy specific branch
/opt/sietch/deploy.sh feature/my-branch
```

The deploy script automatically:
1. Clones the specified branch
2. Installs dependencies
3. Builds the application
4. Updates the symlink atomically
5. Reloads PM2 (zero-downtime)
6. Runs health check
7. Rolls back if health check fails
8. Cleans up old releases

---

## Rollback Procedure

### Automatic Rollback

The deploy script automatically rolls back if the health check fails. No manual intervention needed.

### Manual Rollback

If you need to manually rollback:

```bash
# List available releases
ls -lt /opt/sietch/releases

# Rollback to specific release
cd /opt/sietch
ln -sfn /opt/sietch/releases/YYYYMMDDHHMMSS current

# Reload PM2
pm2 reload sietch --update-env
```

---

## Common Operations

### Check Service Status

```bash
# PM2 status
pm2 list
pm2 describe sietch

# API health
curl http://127.0.0.1:3000/health

# nginx status
systemctl status nginx
```

### View Logs

```bash
# Application logs
tail -f /opt/sietch/logs/out.log

# Error logs
tail -f /opt/sietch/logs/error.log

# PM2 logs
pm2 logs sietch

# nginx access logs
tail -f /var/log/nginx/sietch-access.log

# nginx error logs
tail -f /var/log/nginx/sietch-error.log
```

### Restart Service

```bash
# Graceful reload (zero-downtime)
pm2 reload sietch

# Hard restart
pm2 restart sietch

# Restart nginx
sudo systemctl restart nginx
```

### Update Environment Variables

```bash
# Edit environment file
sudo nano /opt/sietch/.env

# Reload service with new env
pm2 reload sietch --update-env
```

### Trigger Manual Eligibility Sync

trigger.dev dashboard:
1. Go to https://trigger.dev
2. Navigate to sietch-service project
3. Find sync-eligibility task
4. Click "Run now"

### Database Operations

```bash
# Open SQLite shell
sqlite3 /opt/sietch/data/sietch.db

# Query current eligibility
SELECT * FROM current_eligibility ORDER BY rank LIMIT 10;

# Check health status
SELECT * FROM health_status;

# View recent audit log
SELECT * FROM audit_log ORDER BY created_at DESC LIMIT 20;

# v2.0 Social Layer Queries
# --------------------------

# View member profiles (onboarded)
SELECT member_id, nym, tier, onboarding_complete
FROM member_profiles
WHERE onboarding_complete = 1
ORDER BY created_at DESC LIMIT 20;

# View pending migrations (v1.0 members needing onboarding)
SELECT member_id, nym, discord_user_id
FROM member_profiles
WHERE onboarding_complete = 0;

# View member badges
SELECT mp.nym, b.badge_id, b.awarded_at
FROM member_badges b
JOIN member_profiles mp ON b.member_id = mp.member_id
ORDER BY b.awarded_at DESC LIMIT 20;

# View activity balances
SELECT mp.nym, a.activity_balance, a.last_decay_at
FROM member_activity a
JOIN member_profiles mp ON a.member_id = mp.member_id
ORDER BY a.activity_balance DESC LIMIT 10;

# Exit SQLite
.quit
```

### Run Database Migrations

```bash
# Migrations run automatically on startup
# To verify migrations:
sqlite3 /opt/sietch/data/sietch.db "SELECT * FROM _migrations ORDER BY version;"
```

### Admin API Operations

```bash
# List overrides
curl -H "X-API-Key: your_api_key" https://sietch-api.honeyjar.xyz/admin/overrides

# Create override
curl -X POST -H "X-API-Key: your_api_key" \
  -H "Content-Type: application/json" \
  -d '{"address":"0x123...","action":"add","reason":"Manual addition"}' \
  https://sietch-api.honeyjar.xyz/admin/override

# View audit log
curl -H "X-API-Key: your_api_key" https://sietch-api.honeyjar.xyz/admin/audit-log?limit=50
```

---

## Troubleshooting

### Service Not Starting

```bash
# Check PM2 logs
pm2 logs sietch --lines 100

# Check if port is in use
netstat -tlnp | grep 3000

# Check environment file
cat /opt/sietch/.env | grep -v "^#" | grep -v "^$"

# Verify build
ls -la /opt/sietch/current/sietch-service/dist/
```

### API Returning 502

1. Check if Node.js process is running:
   ```bash
   pm2 list
   ```

2. Check if process crashed:
   ```bash
   pm2 logs sietch --err --lines 50
   ```

3. Check nginx upstream:
   ```bash
   curl http://127.0.0.1:3000/health
   ```

### Discord Bot Offline

1. Check Discord token is valid
2. Check bot intents are enabled in Discord Developer Portal
3. Review application logs for connection errors:
   ```bash
   grep -i "discord" /opt/sietch/logs/out.log
   ```

### trigger.dev Task Failing

1. Check trigger.dev dashboard for error details
2. Review application logs:
   ```bash
   grep -i "eligibility sync" /opt/sietch/logs/out.log
   ```
3. Verify RPC endpoints are accessible:
   ```bash
   curl -X POST -H "Content-Type: application/json" \
     -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' \
     https://rpc.berachain.com
   ```

### High Memory Usage

```bash
# Check memory
free -h
pm2 describe sietch | grep memory

# Restart to clear memory
pm2 restart sietch
```

### Database Locked

```bash
# Check for processes using database
fuser /opt/sietch/data/sietch.db

# Restart service
pm2 restart sietch
```

---

## Monitoring

### Health Checks

Set up external monitoring (UptimeRobot, Pingdom, etc.) to check:
- `https://sietch-api.honeyjar.xyz/health` - API health
- Expected response: `{"status":"healthy",...}`

### Key Metrics to Monitor

1. **API Response Time** - Should be < 100ms
2. **Memory Usage** - Should stay under 256MB
3. **RPC Query Success Rate** - Check trigger.dev dashboard
4. **Discord Bot Status** - Bot should stay online
5. **Certificate Expiry** - Let's Encrypt auto-renews

### Alerting Thresholds

| Metric | Warning | Critical |
|--------|---------|----------|
| API Response Time | > 500ms | > 2s |
| Memory Usage | > 200MB | > 256MB |
| Consecutive RPC Failures | 2 | 4 |
| API 5xx Errors | > 1/min | > 5/min |
| Grace Period | Entered | > 12 hours |

### Log Rotation

PM2 log rotation is configured automatically. Logs are:
- Rotated at 10MB
- Kept for 7 days
- Compressed after rotation

---

## Contact Information

- **Repository**: https://github.com/0xHoneyJar/arrakis
- **trigger.dev Dashboard**: https://trigger.dev
- **Collab.Land Support**: https://collabland.freshdesk.com/
- **Discord Developer Portal**: https://discord.com/developers/applications

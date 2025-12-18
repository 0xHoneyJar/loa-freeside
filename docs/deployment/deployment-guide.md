# Deployment Guide

**Sietch Service v2.0 Production Deployment**

This guide walks through deploying Sietch from scratch on an OVH VPS.

## Prerequisites

Before starting, ensure you have:

- [ ] OVH VPS with Ubuntu 22.04 LTS
- [ ] SSH key access to the VPS
- [ ] Domain DNS configured (A record → VPS IP)
- [ ] Discord application created with bot token
- [ ] trigger.dev account and project
- [ ] Collab.Land Premium subscription
- [ ] BGT token contract addresses

## Step 1: Initial VPS Setup

SSH into your VPS and run the setup script:

```bash
# Download setup script
curl -o setup-vps.sh \
  https://raw.githubusercontent.com/0xHoneyJar/arrakis/main/sietch-service/docs/deployment/scripts/setup-vps.sh

# Make executable and run
chmod +x setup-vps.sh
sudo bash setup-vps.sh
```

This script automatically:
- Updates system packages
- Installs Node.js 20 LTS, PM2, nginx
- Creates `sietch` user and directory structure
- Configures UFW firewall
- Sets up fail2ban
- Hardens SSH configuration
- Enables automatic security updates

## Step 2: Configure Environment Variables

Edit the environment file with your credentials:

```bash
sudo nano /opt/sietch/.env
```

**Required Variables:**

```bash
# Berachain RPC (comma-separated for fallback)
BERACHAIN_RPC_URLS=https://rpc.berachain.com,https://bera-rpc.publicnode.com

# Contract addresses
BGT_ADDRESS=0x_YOUR_BGT_TOKEN_ADDRESS
REWARD_VAULT_ADDRESSES=0x_VAULT1,0x_VAULT2

# trigger.dev
TRIGGER_PROJECT_ID=sietch-service
TRIGGER_SECRET_KEY=tr_YOUR_SECRET_KEY

# Discord Core
DISCORD_BOT_TOKEN=YOUR_BOT_TOKEN
DISCORD_GUILD_ID=YOUR_GUILD_ID
DISCORD_CHANNEL_THE_DOOR=YOUR_CHANNEL_ID
DISCORD_CHANNEL_CENSUS=YOUR_CHANNEL_ID
DISCORD_ROLE_NAIB=YOUR_ROLE_ID
DISCORD_ROLE_FEDAYKIN=YOUR_ROLE_ID

# Discord v2.0 Dynamic Roles (optional)
DISCORD_CHANNEL_SIETCH_LOUNGE=YOUR_CHANNEL_ID
DISCORD_ROLE_ONBOARDED=YOUR_ROLE_ID
DISCORD_ROLE_ENGAGED=YOUR_ROLE_ID
DISCORD_ROLE_VETERAN=YOUR_ROLE_ID
DISCORD_ROLE_TRUSTED=YOUR_ROLE_ID

# API
API_PORT=3000
API_HOST=127.0.0.1
ADMIN_API_KEYS=your_api_key_1:admin1,your_api_key_2:admin2

# Database
DATABASE_PATH=/opt/sietch/data/sietch.db

# Logging
LOG_LEVEL=info

# Grace Period
GRACE_PERIOD_HOURS=24
```

See `PRE_DEPLOYMENT_CHECKLIST.md` for detailed credential setup.

## Step 3: Configure nginx

```bash
# Copy nginx configuration
sudo cp /opt/sietch/current/sietch-service/docs/deployment/configs/nginx-sietch.conf \
        /etc/nginx/sites-available/sietch

# Enable the site
sudo ln -s /etc/nginx/sites-available/sietch /etc/nginx/sites-enabled/

# Remove default site
sudo rm /etc/nginx/sites-enabled/default

# Test configuration
sudo nginx -t

# Reload nginx
sudo systemctl reload nginx
```

## Step 4: Obtain SSL Certificate

```bash
sudo certbot --nginx -d sietch-api.honeyjar.xyz
```

Follow the prompts to:
1. Enter email for renewal notifications
2. Agree to terms of service
3. Choose to redirect HTTP to HTTPS (recommended)

Verify auto-renewal:
```bash
sudo certbot renew --dry-run
```

## Step 5: Deploy Application

```bash
# Switch to sietch user
sudo -u sietch -i

# Download deploy script
cd /opt/sietch
curl -o deploy.sh \
  https://raw.githubusercontent.com/0xHoneyJar/arrakis/main/sietch-service/docs/deployment/scripts/deploy.sh
chmod +x deploy.sh

# Deploy main branch
./deploy.sh main
```

The deploy script:
1. Clones the repository
2. Installs dependencies
3. Builds the application
4. Updates the symlink atomically
5. Reloads PM2 (zero-downtime)
6. Runs health check
7. Auto-rollback if health check fails

## Step 6: Verify Deployment

```bash
# Check PM2 status
pm2 list

# Check API health
curl https://sietch-api.honeyjar.xyz/health

# View logs
tail -f /opt/sietch/logs/out.log
```

Expected health response:
```json
{
  "status": "healthy",
  "timestamp": "2025-12-18T12:00:00.000Z"
}
```

## Step 7: Configure Backups

```bash
# Copy backup script
cp /opt/sietch/current/sietch-service/docs/deployment/scripts/backup.sh \
   /opt/sietch/scripts/

# Make executable
chmod +x /opt/sietch/scripts/backup.sh

# Setup daily backup cron (as sietch user)
crontab -e
```

Add the following line:
```
0 3 * * * /opt/sietch/scripts/backup.sh
```

## Step 8: Configure Collab.Land

Follow `collabland-setup.md` to:
1. Add Collab.Land bot to your Discord server
2. Create custom API token gates
3. Configure role assignments

## Step 9: Register trigger.dev Tasks

```bash
# From sietch-service directory
cd /opt/sietch/current/sietch-service
npx trigger.dev@latest dev
```

This registers the scheduled tasks:
- `sync-eligibility` - Every 6 hours
- `activity-decay` - Every 6 hours
- `badge-check` - Daily at midnight

## Verification Checklist

After deployment, verify:

- [ ] `https://sietch-api.honeyjar.xyz/health` returns 200
- [ ] PM2 shows `sietch` process online
- [ ] Discord bot is online in server
- [ ] `/profile` slash command works
- [ ] Collab.Land verification works
- [ ] trigger.dev tasks show in dashboard
- [ ] SSL certificate is valid
- [ ] Logs are being written

## Subsequent Deployments

For updates after initial setup:

```bash
# SSH to server
ssh user@sietch-api.honeyjar.xyz

# Switch to sietch user
sudo -u sietch -i

# Deploy latest main branch
./deploy.sh main

# Or deploy specific branch
./deploy.sh feature/my-branch
```

## Troubleshooting

### Service not starting

```bash
# Check PM2 logs
pm2 logs sietch --lines 100

# Check environment
cat /opt/sietch/.env | grep -v "^#" | grep -v "^$"

# Verify build
ls -la /opt/sietch/current/sietch-service/dist/
```

### API returning 502

```bash
# Check if Node.js is running
pm2 list

# Check if port is correct
curl http://127.0.0.1:3000/health
```

### Discord bot offline

1. Check `DISCORD_BOT_TOKEN` in `.env`
2. Verify bot intents enabled in Discord Developer Portal
3. Check logs: `grep -i "discord" /opt/sietch/logs/out.log`

See `runbooks/troubleshooting.md` for more scenarios.

# Deployment Guide

This guide covers deploying Sietch Service to a production VPS.

## Prerequisites

- Ubuntu 22.04+ VPS (OVH, DigitalOcean, Hetzner, etc.)
- Domain name pointing to your VPS IP
- SSH access with sudo privileges
- GitHub repository access
- Discord Bot token and application ID
- trigger.dev account and project

## Initial Server Setup

### 1. Run the Setup Script

SSH into your server and run:

```bash
# Download and run setup script
curl -sSL https://raw.githubusercontent.com/YOUR_REPO/main/sietch-service/deploy/scripts/setup-server.sh | sudo bash
```

This installs:
- Node.js 20 LTS
- PM2 process manager
- Caddy web server
- Prometheus + Grafana monitoring
- Security tools (fail2ban, ufw)

### 2. Clone the Repository

```bash
# Switch to sietch user
sudo su - sietch

# Clone the repository
git clone https://github.com/YOUR_REPO.git /opt/sietch-service
cd /opt/sietch-service
```

### 3. Configure Environment

```bash
# Copy example env file
cp .env.example .env

# Edit with your configuration
nano .env
```

**Required environment variables:**

```bash
# Berachain RPC
BERACHAIN_RPC_URLS=https://rpc.berachain.com
BGT_ADDRESS=0x...
REWARD_VAULT_ADDRESSES=0x...,0x...

# trigger.dev
TRIGGER_PROJECT_ID=your-project-id
TRIGGER_SECRET_KEY=tr_xxx

# Discord
DISCORD_BOT_TOKEN=your-bot-token
DISCORD_GUILD_ID=your-server-id
DISCORD_CHANNEL_THE_DOOR=channel-id
DISCORD_CHANNEL_CENSUS=channel-id
DISCORD_ROLE_NAIB=role-id
DISCORD_ROLE_FEDAYKIN=role-id

# API
API_PORT=3000
ADMIN_API_KEYS=your-key:admin-name

# Database
DATABASE_PATH=/opt/sietch-service/data/sietch.db
```

### 4. Install Dependencies and Build

```bash
npm ci --production
npm run build
```

### 5. Configure Caddy

```bash
# Copy Caddyfile
sudo cp deploy/configs/Caddyfile /etc/caddy/Caddyfile

# Edit with your domain
sudo nano /etc/caddy/Caddyfile
# Replace {$DOMAIN} with your actual domain

# Reload Caddy
sudo systemctl reload caddy
```

### 6. Start the Application

```bash
# Start with PM2
pm2 start deploy/configs/ecosystem.config.cjs --env production

# Save PM2 configuration
pm2 save

# Verify it's running
pm2 status
curl http://localhost:3000/health
```

### 7. Deploy trigger.dev Tasks

```bash
npm run trigger:deploy
```

## GitHub Actions Setup

### Required Secrets

Configure these in your GitHub repository settings (Settings → Secrets → Actions):

| Secret | Description |
|--------|-------------|
| `SSH_PRIVATE_KEY` | SSH private key for deployment user |
| `SERVER_HOST` | VPS IP address or hostname |
| `SERVER_USER` | SSH username (e.g., `sietch`) |
| `DOMAIN` | Your domain name |
| `TRIGGER_SECRET_KEY` | trigger.dev secret key |

### Generating SSH Key

```bash
# On your local machine
ssh-keygen -t ed25519 -C "github-actions-deploy" -f ~/.ssh/sietch-deploy

# Copy public key to server
ssh-copy-id -i ~/.ssh/sietch-deploy.pub sietch@your-server

# Add private key to GitHub Secrets as SSH_PRIVATE_KEY
cat ~/.ssh/sietch-deploy
```

### Triggering Deployment

Deployments are triggered automatically when:
- Push to `main` branch
- Manual workflow dispatch from GitHub Actions

## Database Migration

On first deployment or after schema changes:

```bash
# The application runs migrations automatically on startup
pm2 restart sietch-service

# Check logs for migration status
pm2 logs sietch-service
```

## Discord Bot Setup

### 1. Create Discord Application

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Create New Application → Name it "Sietch"
3. Go to Bot → Add Bot
4. Enable:
   - Presence Intent
   - Server Members Intent
   - Message Content Intent
5. Copy the bot token

### 2. Invite Bot to Server

Generate invite URL with these permissions:
- Send Messages
- Embed Links
- Manage Roles
- Use Slash Commands

```
https://discord.com/api/oauth2/authorize?client_id=YOUR_CLIENT_ID&permissions=268438528&scope=bot%20applications.commands
```

### 3. Create Required Roles

Create these roles in your Discord server (in order from highest to lowest):
1. `@Naib` - Gold (#FFD700)
2. `@Former Naib` - Silver (#C0C0C0)
3. `@Fedaykin` - Blue (#4169E1)
4. `@Taqwa` - Sand (#C2B280)
5. `@Onboarded` - Default
6. `@Engaged` - Green
7. `@Veteran` - Purple

### 4. Create Required Channels

```
🚪 CAVE ENTRANCE (Public)
├── #the-threshold (read-only)
├── #waiting-pool
└── #register-interest

📜 STILLSUIT (Members)
├── #water-discipline
├── #census
└── #the-door

🏛️ NAIB CHAMBER (@Naib only)
└── #naib-council

🏛️ NAIB ARCHIVES (@Naib + @Former Naib)
└── #naib-archives
```

## Verification Checklist

After deployment, verify:

- [ ] Health endpoint: `curl https://yourdomain.com/health`
- [ ] API responds: `curl https://yourdomain.com/eligibility`
- [ ] Discord bot is online in server
- [ ] Slash commands work (`/naib`, `/threshold`)
- [ ] Grafana accessible: `https://grafana.yourdomain.com`
- [ ] Prometheus scraping: Check Grafana data sources
- [ ] Backups running: Check `/opt/sietch-backups/`

## Troubleshooting

### Application Won't Start

```bash
# Check PM2 logs
pm2 logs sietch-service

# Check if port is in use
lsof -i :3000

# Validate config
node -e "require('./dist/config.js')"
```

### SSL Certificate Issues

```bash
# Check Caddy logs
sudo journalctl -u caddy -f

# Force certificate renewal
sudo caddy reload --config /etc/caddy/Caddyfile
```

### Discord Bot Not Responding

```bash
# Check bot token is valid
# Check guild ID matches
# Verify bot has correct permissions
# Check PM2 logs for errors
pm2 logs sietch-service --lines 100
```

### Database Issues

```bash
# Check database file permissions
ls -la /opt/sietch-service/data/

# Verify database integrity
sqlite3 /opt/sietch-service/data/sietch.db "PRAGMA integrity_check;"

# If corrupted, restore from backup
/opt/sietch-service/deploy/scripts/backup-db.sh restore
```

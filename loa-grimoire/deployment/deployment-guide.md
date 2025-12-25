# Deployment Guide

## Prerequisites

- Ubuntu 22.04 LTS server
- SSH access with sudo privileges
- Domain name pointed to server IP
- Discord bot token and guild ID
- Berachain RPC URL

## Quick Deploy

```bash
# Clone and setup
git clone https://github.com/0xHoneyJar/arrakis.git
cd arrakis/sietch-service
npm install
cp .env.example .env.local
# Edit .env.local with your credentials

# Build and start
npm run build
pm2 start ecosystem.config.cjs
pm2 save
```

## Full Deployment Steps

### 1. Server Setup

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Install build tools
sudo apt install -y build-essential git nginx certbot python3-certbot-nginx

# Install PM2
sudo npm install -g pm2
```

### 2. Application Setup

```bash
# Create app user
sudo useradd -m -s /bin/bash sietch
sudo usermod -aG sudo sietch

# Clone repository
sudo -u sietch git clone https://github.com/0xHoneyJar/arrakis.git /home/sietch/arrakis
cd /home/sietch/arrakis/sietch-service

# Install dependencies
sudo -u sietch npm install

# Create data directory
sudo mkdir -p /data
sudo chown sietch:sietch /data
```

### 3. Environment Configuration

```bash
# Copy template
cp .env.example .env.local

# Edit with production values
nano .env.local
```

Required environment variables:

```bash
# Server
NODE_ENV=production
PORT=3000
API_KEY=<generate-secure-key>

# Berachain
BERACHAIN_RPC_URL=https://rpc.berachain.com

# Discord
DISCORD_BOT_TOKEN=<your-bot-token>
DISCORD_GUILD_ID=<your-guild-id>
DISCORD_ANNOUNCEMENTS_CHANNEL_ID=<channel-id>
DISCORD_STORY_CHANNEL_ID=<channel-id>

# Discord Roles (tier system)
DISCORD_NAIB_ROLE_ID=<role-id>
DISCORD_FEDAYKIN_ROLE_ID=<role-id>
DISCORD_USUL_ROLE_ID=<role-id>
DISCORD_REVEREND_MOTHER_ROLE_ID=<role-id>
DISCORD_SANDRIDER_ROLE_ID=<role-id>
DISCORD_SAYYADINA_ROLE_ID=<role-id>
DISCORD_FREMEN_ROLE_ID=<role-id>
DISCORD_ACOLYTE_ROLE_ID=<role-id>
DISCORD_TRAVELER_ROLE_ID=<role-id>

# trigger.dev
TRIGGER_SECRET_KEY=<your-trigger-key>
```

### 4. Build Application

```bash
cd /home/sietch/arrakis/sietch-service
sudo -u sietch npm run build
```

### 5. PM2 Configuration

Create `/home/sietch/arrakis/sietch-service/ecosystem.config.cjs`:

```javascript
module.exports = {
  apps: [{
    name: 'sietch-service',
    script: 'dist/index.js',
    cwd: '/home/sietch/arrakis/sietch-service',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'production',
    },
    error_file: '/var/log/sietch/error.log',
    out_file: '/var/log/sietch/out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
  }]
};
```

Start the application:

```bash
# Create log directory
sudo mkdir -p /var/log/sietch
sudo chown sietch:sietch /var/log/sietch

# Start with PM2
cd /home/sietch/arrakis/sietch-service
sudo -u sietch pm2 start ecosystem.config.cjs
sudo -u sietch pm2 save

# Enable startup
sudo -u sietch pm2 startup systemd -u sietch --hp /home/sietch
```

### 6. nginx Configuration

Create `/etc/nginx/sites-available/sietch`:

```nginx
server {
    listen 80;
    server_name sietch.yourdomain.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name sietch.yourdomain.com;

    # SSL (managed by certbot)
    ssl_certificate /etc/letsencrypt/live/sietch.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/sietch.yourdomain.com/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;

    # Rate limiting
    limit_req_zone $binary_remote_addr zone=api:10m rate=10r/s;

    location / {
        limit_req zone=api burst=20 nodelay;
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    # Health check (no rate limit)
    location /health {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
    }
}
```

Enable and test:

```bash
sudo ln -s /etc/nginx/sites-available/sietch /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

### 7. SSL Certificate

```bash
sudo certbot --nginx -d sietch.yourdomain.com
```

### 8. Firewall Setup

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

### 9. Seed Initial Data

```bash
cd /home/sietch/arrakis/sietch-service
sudo -u sietch npm run seed:stories
```

### 10. Verify Deployment

```bash
# Check service health
curl https://sietch.yourdomain.com/health

# Check PM2 status
sudo -u sietch pm2 status

# Check logs
sudo -u sietch pm2 logs sietch-service --lines 50
```

## Updating

### Standard Update

```bash
cd /home/sietch/arrakis
sudo -u sietch git pull origin main
cd sietch-service
sudo -u sietch npm install
sudo -u sietch npm run build
sudo -u sietch pm2 restart sietch-service
```

### Database Migration Update

```bash
# Backup first
sudo -u sietch cp /data/sietch.db /backups/sietch.db.$(date +%Y%m%d_%H%M%S)

# Update
cd /home/sietch/arrakis
sudo -u sietch git pull origin main
cd sietch-service
sudo -u sietch npm install
sudo -u sietch npm run build

# Migrations run automatically on startup
sudo -u sietch pm2 restart sietch-service
```

## Rollback

```bash
# Stop service
sudo -u sietch pm2 stop sietch-service

# Restore database if needed
sudo -u sietch cp /backups/sietch.db.<timestamp> /data/sietch.db

# Checkout previous version
cd /home/sietch/arrakis
sudo -u sietch git checkout v3.0.0  # or specific commit

# Rebuild and restart
cd sietch-service
sudo -u sietch npm install
sudo -u sietch npm run build
sudo -u sietch pm2 restart sietch-service
```

## Troubleshooting

### Service Won't Start

```bash
# Check logs
sudo -u sietch pm2 logs sietch-service --lines 100

# Check environment
sudo -u sietch cat /home/sietch/arrakis/sietch-service/.env.local

# Test manually
cd /home/sietch/arrakis/sietch-service
sudo -u sietch node dist/index.js
```

### Discord Bot Not Connecting

```bash
# Verify token
curl -H "Authorization: Bot YOUR_TOKEN" https://discord.com/api/v10/users/@me

# Check bot permissions in Discord Developer Portal
# Ensure all required intents are enabled
```

### Database Issues

```bash
# Check database file
ls -la /data/sietch.db

# Verify permissions
sudo chown sietch:sietch /data/sietch.db
sudo chmod 600 /data/sietch.db

# Test database
sqlite3 /data/sietch.db "SELECT COUNT(*) FROM members;"
```

### nginx Errors

```bash
# Check configuration
sudo nginx -t

# Check logs
sudo tail -f /var/log/nginx/error.log

# Check SSL certificate
sudo certbot certificates
```

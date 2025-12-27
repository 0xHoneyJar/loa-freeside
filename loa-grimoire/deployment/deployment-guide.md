# Deployment Guide

**Version**: 4.0 "The Unification"
**Last Updated**: December 2025

## Prerequisites

- Ubuntu 22.04 LTS server
- SSH access with sudo privileges
- Domain name pointed to server IP
- Discord bot token and guild ID
- Berachain RPC URL

### v4.0 Additional Prerequisites

- **Stripe Account** (for billing features)
  - Stripe Secret Key (sk_live_xxx or sk_test_xxx)
  - Stripe Webhook Signing Secret (whsec_xxx)
  - Stripe Price IDs for each subscription tier
- **Upstash Redis** (for entitlement caching)
  - Redis URL (redis://xxx.upstash.io:6379)
  - Redis Password
- **trigger.dev Account** (for scheduled tasks)
  - Trigger.dev Secret Key

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

# ============================================
# v4.0 Billing & Gatekeeper Configuration
# ============================================

# Stripe (Required for billing features)
STRIPE_SECRET_KEY=<sk_live_xxx or sk_test_xxx>
STRIPE_WEBHOOK_SECRET=<whsec_xxx>
STRIPE_PRICE_BASIC=<price_xxx>
STRIPE_PRICE_PREMIUM=<price_xxx>
STRIPE_PRICE_EXCLUSIVE=<price_xxx>
STRIPE_PRICE_ELITE=<price_xxx>
STRIPE_PRICE_ENTERPRISE=<price_xxx>

# Upstash Redis (Required for entitlement caching)
REDIS_URL=<redis://xxx.upstash.io:6379>
REDIS_PASSWORD=<your-redis-password>
REDIS_MAX_RETRIES=3
REDIS_CONNECT_TIMEOUT=5000
REDIS_ENTITLEMENT_TTL=300

# Feature Flags
BILLING_ENABLED=true
GATEKEEPER_ENABLED=true

# Boost Configuration (Optional - defaults provided)
BOOST_PRICE_PER_MONTH_CENTS=299
BOOST_LEVEL1_THRESHOLD=2
BOOST_LEVEL2_THRESHOLD=7
BOOST_LEVEL3_THRESHOLD=15

# Badge Pricing (Optional - defaults provided)
BADGE_PRICE_CENTS=499
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

First, add rate limiting zone to `/etc/nginx/nginx.conf` inside the `http` block:

```nginx
http {
    # ... existing config ...

    # Rate limiting zone (must be in http context)
    limit_req_zone $binary_remote_addr zone=api:10m rate=10r/s;

    # ... rest of config ...
}
```

Then create `/etc/nginx/sites-available/sietch`:

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

### 8a. SSH Hardening

Secure SSH access with key-only authentication:

```bash
# Ensure you have SSH key access before proceeding!
# Test: ssh -i ~/.ssh/your_key sietch@server

# Disable password authentication
sudo sed -i 's/#PasswordAuthentication yes/PasswordAuthentication no/' /etc/ssh/sshd_config
sudo sed -i 's/PasswordAuthentication yes/PasswordAuthentication no/' /etc/ssh/sshd_config

# Disable root login
sudo sed -i 's/#PermitRootLogin yes/PermitRootLogin no/' /etc/ssh/sshd_config
sudo sed -i 's/PermitRootLogin yes/PermitRootLogin no/' /etc/ssh/sshd_config
sudo sed -i 's/PermitRootLogin prohibit-password/PermitRootLogin no/' /etc/ssh/sshd_config

# Restart SSH service
sudo systemctl restart sshd
```

**Warning**: Ensure you have working SSH key access before disabling password authentication, or you may lock yourself out!

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

---

## v4.0 Specific Setup

### Stripe Setup

1. **Create Stripe Account**
   - Sign up at https://dashboard.stripe.com
   - Complete business verification for production

2. **Create Products & Prices**

   In Stripe Dashboard → Products:

   | Product | Monthly Price | Price ID Format |
   |---------|--------------|-----------------|
   | Basic | $15.00 | price_basic_xxx |
   | Premium | $35.00 | price_premium_xxx |
   | Exclusive | $149.00 | price_exclusive_xxx |
   | Elite | $449.00 | price_elite_xxx |
   | Enterprise | Custom | Contact sales |

3. **Configure Webhook Endpoint**

   In Stripe Dashboard → Developers → Webhooks:

   - Click "Add endpoint"
   - URL: `https://sietch.yourdomain.com/api/billing/webhook`
   - Events to listen for:
     - `checkout.session.completed`
     - `customer.subscription.updated`
     - `customer.subscription.deleted`
     - `invoice.paid`
     - `invoice.payment_failed`
   - Copy the Signing Secret to `STRIPE_WEBHOOK_SECRET`

4. **Test with Stripe CLI**

   ```bash
   # Install Stripe CLI
   curl -s https://packages.stripe.dev/api/security/keypair/stripe-cli-gpg/public | gpg --dearmor | sudo tee /usr/share/keyrings/stripe.gpg
   echo "deb [signed-by=/usr/share/keyrings/stripe.gpg] https://packages.stripe.dev/stripe-cli-debian-local stable main" | sudo tee -a /etc/apt/sources.list.d/stripe.list
   sudo apt update && sudo apt install stripe

   # Login and forward webhooks
   stripe login
   stripe listen --forward-to https://sietch.yourdomain.com/api/billing/webhook

   # Test events
   stripe trigger checkout.session.completed
   stripe trigger invoice.payment_failed
   ```

### Upstash Redis Setup

1. **Create Upstash Account**
   - Sign up at https://console.upstash.com
   - Create a new Redis database

2. **Configure Database**
   - Region: Choose closest to your server
   - Eviction: No eviction (default)
   - TLS: Enabled

3. **Get Connection Details**
   - Copy REST URL or Redis URL
   - Copy password
   - Add to environment variables

4. **Test Connection**

   ```bash
   # Test Redis connection
   redis-cli -u "$REDIS_URL" ping
   # Should return: PONG
   ```

### V3 to V4 Migration

For existing v3.0 deployments, run the migration script:

```bash
# Create backup first
sudo -u sietch cp /data/sietch.db /backups/sietch.db.pre-v4

# Preview migration (dry run)
cd /home/sietch/arrakis/sietch-service
sudo -u sietch npx tsx scripts/migrate-v3-to-v4.ts --dry-run

# Run migration
sudo -u sietch npx tsx scripts/migrate-v3-to-v4.ts --backup

# Verify migration
sqlite3 /data/sietch.db "SELECT COUNT(*) FROM communities;"
sqlite3 /data/sietch.db "SELECT COUNT(*) FROM fee_waivers WHERE tier = 'enterprise';"
```

The migration script:
- Creates a 'default' community for existing data
- Assigns all members to the default community
- Grants an enterprise waiver (free tier) for the internal community
- Preserves all v3.0 data

### Verify v4.0 Features

```bash
# Check billing endpoints
curl https://sietch.yourdomain.com/api/billing/health

# Check entitlements
curl -H "X-API-Key: YOUR_API_KEY" \
  https://sietch.yourdomain.com/api/entitlements

# Check feature access
curl -H "X-API-Key: YOUR_API_KEY" \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"feature": "stats_leaderboard"}' \
  https://sietch.yourdomain.com/api/feature-check

# Check admin endpoints
curl -H "X-API-Key: YOUR_API_KEY" \
  https://sietch.yourdomain.com/admin/status
```

### Scheduled Tasks (trigger.dev)

1. **Deploy trigger.dev tasks**

   ```bash
   cd /home/sietch/arrakis/sietch-service
   sudo -u sietch npm run trigger:deploy
   ```

2. **Verify tasks registered**

   Check trigger.dev dashboard for:
   - `sync-eligibility` - Hourly BGT sync
   - `weekly-reset` - Weekly stats reset
   - `boost-expiry` - Daily boost expiration check

### Rollback from v4.0

If issues occur after v4.0 deployment:

```bash
# Stop service
sudo -u sietch pm2 stop sietch-service

# Restore pre-v4 database
sudo -u sietch cp /backups/sietch.db.pre-v4 /data/sietch.db

# Checkout v3.0
cd /home/sietch/arrakis
sudo -u sietch git checkout v3.0.0

# Rebuild and restart
cd sietch-service
sudo -u sietch npm install
sudo -u sietch npm run build
sudo -u sietch pm2 restart sietch-service
```

---

## Production Checklist

### Pre-Deployment

- [ ] Backup existing database
- [ ] Stripe products/prices created
- [ ] Stripe webhook configured
- [ ] Upstash Redis provisioned
- [ ] All environment variables set
- [ ] SSL certificate valid

### Deployment

- [ ] Run migration script (if upgrading from v3)
- [ ] Deploy application
- [ ] Verify health endpoint
- [ ] Test webhook with Stripe CLI
- [ ] Verify feature gating works

### Post-Deployment

- [ ] Monitor webhook delivery in Stripe dashboard
- [ ] Check Redis cache hit rates
- [ ] Verify scheduled tasks running
- [ ] Review audit logs
- [ ] Test subscription flow end-to-end

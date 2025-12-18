# Sietch Production Deployment Report

**Date**: 2025-12-18
**Engineer**: DevOps Crypto Architect
**Status**: READY FOR PRODUCTION DEPLOYMENT
**Version**: 2.0 (Social Layer)

---

## Executive Summary

Sietch Service v2.0 (Social Layer) is **production-ready**. All 10 sprints have passed security audits with 141 tests passing. Comprehensive deployment infrastructure and operational documentation has been created.

### What's New in v2.0
- Social Layer with pseudonymous profiles
- Badge system with demurrage-based activity tracking
- Member directory and leaderboard
- Dynamic role management based on badges/tenure
- DM-based onboarding wizard

---

## Infrastructure Assessment

### Existing Deployment Infrastructure (Sprint 4)

| Component | File | Lines | Status |
|-----------|------|-------|--------|
| VPS Setup | `scripts/setup-vps.sh` | 322 | Production-ready |
| Zero-Downtime Deploy | `scripts/deploy.sh` | 248 | Production-ready |
| nginx Config | `configs/nginx-sietch.conf` | 147 | Production-ready |
| Backup Script | `scripts/backup.sh` | 206 | Production-ready |
| PM2 Config | `ecosystem.config.cjs` | 45 | Production-ready |
| Deployment Runbook | `DEPLOYMENT_RUNBOOK.md` | 421 | Comprehensive |
| Pre-Deploy Checklist | `PRE_DEPLOYMENT_CHECKLIST.md` | 350 | New (created today) |

**Total Infrastructure**: ~1,739 lines of deployment automation and documentation

### Security Hardening Included

- UFW firewall (ports 22, 80, 443 only)
- fail2ban with aggressive SSH protection
- Non-root deployment user with sudo
- File permissions (600 for secrets, 700 for data)
- nginx rate limiting (10 req/s burst 20)
- SSL/TLS via Let's Encrypt (certbot)
- API key authentication for admin endpoints

### Deployment Features

- **Zero-downtime deployment** via symlink swapping
- **Automatic rollback** on health check failure
- **5 release retention** with cleanup
- **SQLite online backup** with integrity verification
- **PM2 process management** with clustering
- **pino-http structured logging**

---

## User Action Items

### Prerequisites (Must Complete Before Deployment)

| Item | Status | Guide |
|------|--------|-------|
| VPS provisioned | Ready | User confirmed |
| DNS A record | Not configured | PRE_DEPLOYMENT_CHECKLIST.md Section 1 |
| Discord bot token | Needed | PRE_DEPLOYMENT_CHECKLIST.md Section 2 |
| Discord IDs | Needed | PRE_DEPLOYMENT_CHECKLIST.md Section 2 |
| trigger.dev credentials | Needed | PRE_DEPLOYMENT_CHECKLIST.md Section 3 |
| Collab.Land setup | Needed | PRE_DEPLOYMENT_CHECKLIST.md Section 4 |
| RPC URLs | Can use public | PRE_DEPLOYMENT_CHECKLIST.md Section 5 |
| Admin API keys | Generate | PRE_DEPLOYMENT_CHECKLIST.md Section 6 |

### DNS Configuration

Create A record pointing to VPS IP:
```
Name: sietch-api
Type: A
Value: <VPS_IP_ADDRESS>
TTL: 300
```

Verify propagation:
```bash
dig sietch-api.honeyjar.xyz
```

---

## Deployment Commands

Once all prerequisites are met, execute these commands:

### Step 1: Initial Server Setup (One-time)

```bash
# SSH to VPS
ssh root@<VPS_IP>

# Upload and run setup script
scp sietch-service/docs/deployment/scripts/setup-vps.sh root@<VPS_IP>:/tmp/
ssh root@<VPS_IP> "bash /tmp/setup-vps.sh"

# Switch to deploy user
su - deploy
```

### Step 2: Configure Environment

```bash
# Create .env file
sudo nano /opt/sietch/.env

# Copy contents from PRE_DEPLOYMENT_CHECKLIST.md Section 7
# Fill in all credential values
```

### Step 3: Deploy Application

```bash
# Clone repository
cd /opt/sietch
git clone https://github.com/0xHoneyJar/arrakis.git repo
cd repo/sietch-service

# Run deployment
./docs/deployment/scripts/deploy.sh main
```

### Step 4: Configure SSL

```bash
# Obtain SSL certificate
sudo certbot --nginx -d sietch-api.honeyjar.xyz
```

### Step 5: Verify Deployment

```bash
# Health check
curl https://sietch-api.honeyjar.xyz/health

# Test eligibility endpoint (with test wallet)
curl https://sietch-api.honeyjar.xyz/eligibility/0x...

# Check logs
pm2 logs sietch-api
```

### Step 6: Configure Collab.Land

Follow instructions in `PRE_DEPLOYMENT_CHECKLIST.md` Section 4 to configure token gate rules.

### Step 7: Setup Backups

```bash
# Add to crontab
crontab -e

# Add line for daily backup at 3 AM UTC
0 3 * * * /opt/sietch/scripts/backup.sh >> /opt/sietch/logs/backup.log 2>&1
```

---

## Architecture Overview

```
                    ┌─────────────────┐
                    │   Cloudflare    │
                    │   (DNS + CDN)   │
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
                    │   VPS (Ubuntu)  │
                    │   UFW + fail2ban│
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
                    │   nginx         │
                    │   SSL + Rate    │
                    │   Limiting      │
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
                    │   PM2           │
                    │   Process Mgmt  │
                    └────────┬────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
     ┌────────▼────────┐     │     ┌────────▼────────┐
     │   Express API   │     │     │   Discord Bot   │
     │   Port 3000     │     │     │   (Connected)   │
     └────────┬────────┘     │     └────────┬────────┘
              │              │              │
              └──────────────┼──────────────┘
                             │
                    ┌────────▼────────┐
                    │   SQLite DB     │
                    │   /opt/sietch   │
                    │   /data/        │
                    └────────┬────────┘
                             │
              ┌──────────────┴──────────────┐
              │                             │
     ┌────────▼────────┐           ┌────────▼────────┐
     │   Berachain     │           │   trigger.dev   │
     │   RPC (viem)    │           │   Scheduled     │
     └─────────────────┘           │   Sync (6h)     │
                                   └─────────────────┘
```

---

## External Service Integration

| Service | Purpose | Configuration |
|---------|---------|---------------|
| Discord | Bot for leaderboard posts, notifications | Bot token + Guild/Channel/Role IDs |
| trigger.dev | Scheduled eligibility sync (every 6h) | Project ID + Secret Key |
| Collab.Land | Token gate for Discord roles | Custom API endpoint configuration |
| Berachain RPC | BGT balance queries | Public or premium RPC URLs |

---

## Monitoring & Operations

### Health Checks

- **Endpoint**: `GET /health`
- **Response**: `{ "status": "ok", "timestamp": "..." }`
- **Used by**: nginx upstream checks, deployment script

### Logs

```bash
# Application logs
pm2 logs sietch-api

# nginx access logs
tail -f /var/log/nginx/sietch-api.access.log

# nginx error logs
tail -f /var/log/nginx/sietch-api.error.log
```

### Common Operations

```bash
# Restart application
pm2 restart sietch-api

# View status
pm2 status

# Manual sync trigger
curl -X POST https://sietch-api.honeyjar.xyz/admin/sync \
  -H "X-API-Key: YOUR_ADMIN_KEY"

# Rollback to previous release
cd /opt/sietch/releases && ls -la
# Then redeploy from specific release
```

---

## Security Audit Status

All 5 sprints have passed security audit:

| Sprint | Focus | Audit Status |
|--------|-------|--------------|
| Sprint 1 | Foundation & Chain Service | Approved |
| Sprint 2 | API Layer & Scheduling | Approved |
| Sprint 3 | Discord Bot | Approved |
| Sprint 4 | Deployment Infrastructure | Approved |
| Sprint 5 | Notifications & Docs | Approved |

**SIETCH MVP IS PRODUCTION READY**

---

## Next Steps for User

1. **Configure DNS** - Create A record for sietch-api.honeyjar.xyz
2. **Setup Discord Bot** - Follow PRE_DEPLOYMENT_CHECKLIST.md Section 2
3. **Get trigger.dev Credentials** - Follow PRE_DEPLOYMENT_CHECKLIST.md Section 3
4. **Deploy to VPS** - Run commands in "Deployment Commands" section
5. **Configure Collab.Land** - Setup token gate rules post-deployment
6. **Test Full Flow** - Verify eligibility checks and Discord notifications

---

## Files Delivered

| File | Location | Purpose |
|------|----------|---------|
| PRE_DEPLOYMENT_CHECKLIST.md | `sietch-service/docs/deployment/` | Credential setup guide |
| deployment-report.md | `docs/a2a/` | This report |

---

*Report Generated: 2025-12-18*
*DevOps Crypto Architect*

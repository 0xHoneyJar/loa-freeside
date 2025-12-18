# Infrastructure Architecture

**Sietch Service v2.0 Production Infrastructure**

## Overview

Sietch is deployed on a single OVH VPS running Ubuntu 22.04 LTS. This architecture is optimized for the current scale (<100 members) with room for growth.

## Architecture Diagram

```
                                    Internet
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                          OVH VPS (Ubuntu 22.04)                              │
│                          sietch-api.honeyjar.xyz                             │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                        UFW Firewall                                     │ │
│  │   Allowed: SSH (22), HTTP (80), HTTPS (443)                            │ │
│  │   Default: deny incoming, allow outgoing                                │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                    │                                         │
│                                    ▼                                         │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                      nginx Reverse Proxy                                │ │
│  │   - TLS termination (Let's Encrypt)                                    │ │
│  │   - Rate limiting: 10 req/s per IP                                     │ │
│  │   - Security headers                                                    │ │
│  │   - Proxy to localhost:3000                                            │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                    │                                         │
│                                    ▼                                         │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                       PM2 Process Manager                               │ │
│  │   - Process: sietch                                                     │ │
│  │   - Auto-restart on crash                                               │ │
│  │   - Max memory: 256MB                                                   │ │
│  │   - Log rotation: 10MB, 7 days                                         │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                    │                                         │
│                                    ▼                                         │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                    Sietch Service (Node.js 20)                          │ │
│  │                                                                          │ │
│  │  ┌──────────────────┬────────────────────┬───────────────────────────┐ │ │
│  │  │    REST API      │   Discord Bot      │    trigger.dev Tasks      │ │ │
│  │  │   Express :3000  │   discord.js v14   │    Scheduled Jobs         │ │ │
│  │  │                  │                    │                           │ │ │
│  │  │ - /health        │ - Slash commands   │ - syncEligibility (6h)   │ │ │
│  │  │ - /eligibility   │ - Onboarding DMs   │ - activityDecay (6h)     │ │ │
│  │  │ - /api/profile   │ - Activity track   │ - badgeCheck (daily)     │ │ │
│  │  │ - /api/directory │ - Role management  │                           │ │ │
│  │  │ - /api/badges    │                    │                           │ │ │
│  │  │ - /admin/*       │                    │                           │ │ │
│  │  └──────────────────┴────────────────────┴───────────────────────────┘ │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                    │                                         │
│                                    ▼                                         │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                      SQLite Database                                    │ │
│  │   /opt/sietch/data/sietch.db                                           │ │
│  │   - WAL mode for concurrent reads                                       │ │
│  │   - Daily backups: 3:00 AM                                             │ │
│  │   - Retention: 7 days                                                   │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│  Security Layer:                                                             │
│  ┌─────────────────────┬─────────────────────┬────────────────────────────┐ │
│  │     fail2ban        │  SSH Hardening      │   Auto Security Updates    │ │
│  │  - SSH protection   │  - Key-only auth    │   - unattended-upgrades   │ │
│  │  - nginx protection │  - No root login    │   - Reboot at 3 AM        │ │
│  │  - Rate limit bans  │  - Protocol 2       │                            │ │
│  └─────────────────────┴─────────────────────┴────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────┘

External Dependencies:
┌──────────────────────┐  ┌──────────────────────┐  ┌────────────────────────┐
│    Berachain RPC     │  │     Discord API      │  │      trigger.dev       │
│  rpc.berachain.com   │  │   gateway.discord.gg │  │    cloud.trigger.dev   │
│                      │  │                      │  │                        │
│  - BGT token data    │  │  - Bot connection    │  │  - Scheduled tasks     │
│  - Holder balances   │  │  - Slash commands    │  │  - Task execution      │
│  - Vault positions   │  │  - DM delivery       │  │  - Retry handling      │
└──────────────────────┘  └──────────────────────┘  └────────────────────────┘
            │                        │
            └────────────┬───────────┘
                         │
                         ▼
            ┌──────────────────────────────────────┐
            │           Collab.Land                │
            │   - Token gating verification        │
            │   - Calls /eligibility endpoint      │
            │   - Assigns Naib/Fedaykin roles      │
            └──────────────────────────────────────┘
```

## Directory Structure

```
/opt/sietch/
├── current/              # Symlink to active release
├── releases/             # Release directories (timestamped)
│   └── YYYYMMDDHHMMSS/   # Each deployment
├── data/                 # Persistent data
│   └── sietch.db         # SQLite database
├── logs/                 # Application logs
│   ├── out.log           # stdout
│   └── error.log         # stderr
├── backups/              # Database backups
│   └── sietch_YYYYMMDD_HHMMSS.db
├── scripts/              # Utility scripts
│   ├── status.sh         # Check service status
│   ├── restart.sh        # Restart service
│   ├── logs.sh           # View logs
│   └── backup.sh         # Manual backup
├── .env                  # Environment configuration
└── deploy.sh             # Deployment script
```

## Component Details

### nginx Configuration

- **Location**: `/etc/nginx/sites-available/sietch`
- **SSL**: Let's Encrypt with auto-renewal
- **Rate Limiting**: 10 req/s per IP (burst 20)
- **Upstream**: localhost:3000 with keepalive

### PM2 Configuration

- **Config**: `ecosystem.config.cjs`
- **Process Name**: `sietch`
- **Memory Limit**: 256MB (auto-restart)
- **Logs**: `/opt/sietch/logs/`

### Database

- **Engine**: SQLite with better-sqlite3
- **Path**: `/opt/sietch/data/sietch.db`
- **Backup**: Daily at 3:00 AM, 7-day retention
- **Tables**:
  - `eligibility_snapshots` - BGT holder snapshots
  - `current_eligibility` - Current holder status
  - `wallet_mappings` - Discord-wallet links
  - `member_profiles` - v2.0 Social Layer profiles
  - `badges` - Badge definitions
  - `member_badges` - Earned badges
  - `member_activity` - Activity tracking

## Network Configuration

| Service | Port | Access |
|---------|------|--------|
| SSH | 22 | External (key-only) |
| HTTP | 80 | External (redirects to HTTPS) |
| HTTPS | 443 | External (nginx) |
| Node.js | 3000 | Internal only (localhost) |

## Resource Requirements

| Resource | Minimum | Recommended |
|----------|---------|-------------|
| CPU | 1 vCPU | 2 vCPU |
| RAM | 1 GB | 2 GB |
| Storage | 10 GB | 20 GB |
| Bandwidth | 100 Mbps | Unlimited |

## Scaling Considerations

For future growth beyond 500 members:

1. **Horizontal Scaling**: Add load balancer + multiple instances
2. **Database**: Migrate SQLite to PostgreSQL
3. **Caching**: Add Redis for session/profile caching
4. **CDN**: Cloudflare for static assets and DDoS protection

## Security Checklist

- [x] UFW firewall enabled (ports 22, 80, 443 only)
- [x] fail2ban protecting SSH and nginx
- [x] SSH key-only authentication
- [x] SSH root login disabled
- [x] Automatic security updates
- [x] TLS 1.2+ with strong ciphers
- [x] Security headers (X-Frame-Options, etc.)
- [x] Rate limiting on all endpoints
- [x] Admin endpoints require API key
- [x] Secrets in environment variables (not code)
- [x] Database file permissions restricted

## Monitoring

### Health Endpoint

```bash
curl https://sietch-api.honeyjar.xyz/health
```

Expected response:
```json
{
  "status": "healthy",
  "timestamp": "2025-12-18T12:00:00.000Z",
  "version": "2.0.0",
  "components": {
    "database": "ok",
    "discord": "connected"
  }
}
```

### Key Metrics

| Metric | Normal | Warning | Critical |
|--------|--------|---------|----------|
| API Response Time | <100ms | >500ms | >2s |
| Memory Usage | <200MB | >200MB | >256MB |
| CPU Usage | <50% | >70% | >90% |
| Disk Usage | <50% | >70% | >90% |

### Recommended Monitoring Tools

- **UptimeRobot**: Free HTTP monitoring
- **PM2 Metrics**: `pm2 monit` for real-time stats
- **Logwatch**: Daily log summaries via email

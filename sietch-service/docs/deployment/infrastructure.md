# Infrastructure Overview

## Architecture Diagram

```
                    ┌─────────────────────────────────────────┐
                    │             GitHub Actions               │
                    │  ┌─────────┐ ┌─────────┐ ┌─────────────┐ │
                    │  │  Test   │→│  Build  │→│   Deploy    │ │
                    │  └─────────┘ └─────────┘ └─────────────┘ │
                    └─────────────────────────────────────────┘
                                         │
                                         ▼ SSH Deploy
                    ┌─────────────────────────────────────────┐
                    │              OVH VPS                     │
                    │  ┌─────────────────────────────────────┐ │
                    │  │  Caddy (Reverse Proxy + Auto SSL)   │ │
                    │  │  - Let's Encrypt certificates       │ │
                    │  │  - HTTP/2, compression              │ │
                    │  └────────────────┬────────────────────┘ │
                    │                   │                      │
                    │  ┌────────────────▼────────────────────┐ │
                    │  │  PM2 (Process Manager)              │ │
                    │  │  - Auto-restart on crash            │ │
                    │  │  - Log rotation                     │ │
                    │  │  - Zero-downtime reload             │ │
                    │  └────────────────┬────────────────────┘ │
                    │                   │                      │
                    │  ┌────────────────▼────────────────────┐ │
                    │  │  Sietch Service (Node.js 20)        │ │
                    │  │  - Express API (port 3000)          │ │
                    │  │  - Discord.js bot                   │ │
                    │  │  - SQLite database                  │ │
                    │  └─────────────────────────────────────┘ │
                    │                                          │
                    │  ┌─────────────────────────────────────┐ │
                    │  │  Monitoring Stack                   │ │
                    │  │  - Node Exporter (port 9100)        │ │
                    │  │  - Prometheus (port 9090)           │ │
                    │  │  - Grafana (port 3001)              │ │
                    │  └─────────────────────────────────────┘ │
                    └─────────────────────────────────────────┘
                                         │
                                         ▼
                    ┌─────────────────────────────────────────┐
                    │           External Services             │
                    │  ┌──────────┐ ┌──────────┐ ┌──────────┐ │
                    │  │ Discord  │ │ Berachain│ │trigger.dev│ │
                    │  │   API    │ │   RPC    │ │  Cloud   │ │
                    │  └──────────┘ └──────────┘ └──────────┘ │
                    └─────────────────────────────────────────┘
```

## Components

### 1. Web Server: Caddy

**Purpose**: Reverse proxy with automatic HTTPS

**Features**:
- Automatic Let's Encrypt certificate provisioning and renewal
- HTTP/2 and HTTP/3 support
- Automatic HTTP to HTTPS redirection
- Gzip/Brotli compression
- Security headers

**Configuration**: `/etc/caddy/Caddyfile`

### 2. Process Manager: PM2

**Purpose**: Node.js process management

**Features**:
- Automatic restart on crash
- Zero-downtime reloads (`pm2 reload`)
- Log rotation and aggregation
- Memory limit enforcement
- Startup script integration (systemd)

**Configuration**: `deploy/configs/ecosystem.config.cjs`

### 3. Application: Sietch Service

**Components**:
- **Express API** (port 3000): REST API for Collab.Land integration
- **Discord Bot**: discord.js bot for slash commands and DM onboarding
- **SQLite Database**: Persistent storage in `/opt/sietch-service/data/`
- **Scheduled Tasks**: trigger.dev cloud for cron jobs

### 4. Monitoring Stack

| Component | Port | Purpose |
|-----------|------|---------|
| Node Exporter | 9100 | System metrics (CPU, memory, disk) |
| Prometheus | 9090 | Metrics collection and storage |
| Grafana | 3001 | Dashboards and visualization |

### 5. External Dependencies

| Service | Purpose | Rate Limits |
|---------|---------|-------------|
| Discord API | Bot interactions | Standard rate limits |
| Berachain RPC | Chain queries | Provider-specific |
| trigger.dev | Scheduled tasks | Based on plan |
| Collab.Land | Token-gating | N/A (webhook) |

## Directory Structure

```
/opt/sietch-service/
├── data/                 # SQLite database
│   └── sietch.db
├── dist/                 # Compiled JavaScript
├── deploy/               # Deployment scripts and configs
│   ├── scripts/
│   └── configs/
├── node_modules/         # Dependencies
├── package.json
├── package-lock.json
└── .env                  # Environment configuration

/var/log/sietch-service/
├── out.log              # Application stdout
└── error.log            # Application stderr

/opt/sietch-backups/     # Git-based database backups
└── backups/
    ├── 2025/
    │   └── 12/
    │       └── sietch_2025-12-20_*.db.gz
    └── latest.db.gz -> ...
```

## Network Configuration

### Firewall Rules (UFW)

| Port | Protocol | Source | Purpose |
|------|----------|--------|---------|
| 22 | TCP | Any | SSH |
| 80 | TCP | Any | HTTP (redirects to HTTPS) |
| 443 | TCP | Any | HTTPS |

Internal ports (localhost only):
- 3000: Sietch API
- 3001: Grafana
- 9090: Prometheus
- 9100: Node Exporter

### DNS Configuration

| Record | Type | Value |
|--------|------|-------|
| `api.yourdomain.com` | A | `<VPS_IP>` |
| `grafana.yourdomain.com` | A | `<VPS_IP>` |

## Security Measures

1. **Firewall**: UFW with default deny incoming
2. **Fail2ban**: Brute-force protection for SSH and Caddy
3. **HTTPS Only**: Automatic TLS with Let's Encrypt
4. **Security Headers**: XSS protection, HSTS (after initial deployment)
5. **Rate Limiting**: Express rate limiters on API endpoints
6. **Secrets**: Environment variables, never in code

## Backup Strategy

### Database Backups

- **Method**: Git-based snapshots
- **Frequency**: Every 6 hours (cron)
- **Retention**: 30 days
- **Location**: Private Git repository

### Backup Script

```bash
/opt/sietch-service/deploy/scripts/backup-db.sh
```

### Restore Procedure

```bash
# 1. Stop the service
pm2 stop sietch-service

# 2. Restore from backup
cd /opt/sietch-backups
gunzip -c backups/latest.db.gz > /opt/sietch-service/data/sietch.db

# 3. Start the service
pm2 start sietch-service
```

## Resource Requirements

### Minimum (< 100 users)
- CPU: 1 vCPU
- RAM: 1 GB
- Storage: 20 GB SSD

### Recommended (100-1000 users)
- CPU: 2 vCPU
- RAM: 2 GB
- Storage: 40 GB SSD

### Scaling Considerations

- SQLite is single-writer; for high write loads, consider PostgreSQL
- trigger.dev handles scheduled task scaling
- Discord rate limits are the primary bottleneck for notifications

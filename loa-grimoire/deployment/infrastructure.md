# Infrastructure Architecture

## Overview

Sietch v3.0 runs on a single VPS deployment optimized for reliability and cost-effectiveness. The architecture prioritizes simplicity while maintaining security and observability.

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                         Internet                                 │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Cloudflare (DNS + DDoS)                       │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                      OVH VPS (Ubuntu 22.04)                      │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │                    nginx (Reverse Proxy)                    │ │
│  │                    Let's Encrypt SSL                        │ │
│  │                    Port 443 (HTTPS)                         │ │
│  └──────────────────────────┬─────────────────────────────────┘ │
│                             │                                    │
│  ┌──────────────────────────▼─────────────────────────────────┐ │
│  │              PM2 Process Manager                            │ │
│  │  ┌─────────────────────────────────────────────────────┐   │ │
│  │  │           sietch-service (Node.js 20)                │   │ │
│  │  │  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐    │   │ │
│  │  │  │  Express    │ │  Discord.js │ │  trigger.dev│    │   │ │
│  │  │  │  API        │ │  Bot        │ │  Worker     │    │   │ │
│  │  │  │  :3000      │ │             │ │             │    │   │ │
│  │  │  └─────────────┘ └─────────────┘ └─────────────┘    │   │ │
│  │  │                        │                             │   │ │
│  │  │  ┌─────────────────────▼───────────────────────┐    │   │ │
│  │  │  │              SQLite Database                 │    │   │ │
│  │  │  │              /data/sietch.db                 │    │   │ │
│  │  │  └─────────────────────────────────────────────┘    │   │ │
│  │  └─────────────────────────────────────────────────────┘   │ │
│  └────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                    External Services                             │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐                │
│  │  Berachain  │ │   Discord   │ │ trigger.dev │                │
│  │  RPC        │ │   API       │ │   Cloud     │                │
│  └─────────────┘ └─────────────┘ └─────────────┘                │
└─────────────────────────────────────────────────────────────────┘
```

## Components

### Compute

| Component | Specification | Purpose |
|-----------|---------------|---------|
| VPS | OVH VPS Starter (2 vCPU, 4GB RAM, 80GB SSD) | Application hosting |
| OS | Ubuntu 22.04 LTS | Server operating system |
| Runtime | Node.js 20 LTS | Application runtime |
| Process Manager | PM2 | Process management, auto-restart |

### Networking

| Component | Configuration | Purpose |
|-----------|---------------|---------|
| DNS | Cloudflare | DNS management, DDoS protection |
| Reverse Proxy | nginx 1.24 | SSL termination, rate limiting |
| SSL | Let's Encrypt (certbot) | HTTPS certificates |
| Firewall | UFW | Port filtering (22, 80, 443 only) |

### Data Storage

| Component | Location | Purpose |
|-----------|----------|---------|
| SQLite | `/data/sietch.db` | Primary database |
| Backups | `/backups/` | Daily database backups |
| Logs | `/var/log/sietch/` | Application logs |

### External Dependencies

| Service | Purpose | Fallback |
|---------|---------|----------|
| Berachain RPC | BGT balance queries | 24-hour grace period |
| Discord API | Bot communication | Reconnect with backoff |
| trigger.dev Cloud | Scheduled job execution | Manual trigger via API |
| Collab.Land | Wallet verification | Direct wallet check |

## Security Layers

### Network Security

1. **Cloudflare Proxy**
   - DDoS protection
   - Bot filtering
   - SSL/TLS termination option

2. **UFW Firewall**
   ```
   22/tcp (SSH) - rate limited
   80/tcp (HTTP) - redirect to HTTPS
   443/tcp (HTTPS) - main traffic
   ```

3. **nginx Rate Limiting**
   - 10 req/s per IP for API
   - 30 req/s per IP for health checks

### Application Security

1. **Environment Variables**
   - Secrets stored in `.env.local`
   - Never committed to git
   - PM2 ecosystem file references

2. **API Authentication**
   - API key required for admin endpoints
   - Rate limiting on all endpoints
   - Input validation with Zod

3. **Database Security**
   - Parameterized queries only
   - No raw SQL concatenation
   - File permissions: 600

## Monitoring

### Health Checks

| Endpoint | Interval | Alert Threshold |
|----------|----------|-----------------|
| `/health` | 60s | 3 failures |
| Discord Bot | 300s | Connection lost |
| trigger.dev | 6h | Task timeout |

### Logging

| Log Type | Location | Retention |
|----------|----------|-----------|
| Application | `/var/log/sietch/app.log` | 30 days |
| Access | `/var/log/nginx/access.log` | 14 days |
| Error | `/var/log/nginx/error.log` | 30 days |
| PM2 | `~/.pm2/logs/` | 7 days |

### Alerting

| Event | Channel | Priority |
|-------|---------|----------|
| Service down | Discord webhook | Critical |
| High error rate | Discord webhook | High |
| Disk > 80% | Email | Medium |
| SSL expiry < 14d | Email | Medium |

## Scaling Considerations

### Current Limits

| Resource | Limit | Current Usage |
|----------|-------|---------------|
| Members | 69 (by design) | 69 max |
| API requests | ~1000/hour | ~100/hour |
| Database size | 1GB | ~10MB |
| Memory | 4GB | ~500MB |

### Horizontal Scaling (if needed)

Not required for current use case. If needed:
1. Migrate SQLite to PostgreSQL
2. Add Redis for session/cache
3. Deploy behind load balancer
4. Separate Discord bot to dedicated instance

## Disaster Recovery

### Backup Schedule

| Type | Frequency | Retention | Location |
|------|-----------|-----------|----------|
| Database | Daily 3:00 UTC | 30 days | `/backups/` |
| Config | On change | Permanent | Git |
| Full VM | Weekly | 4 weeks | OVH Snapshots |

### Recovery Time Objectives

| Scenario | RTO | RPO |
|----------|-----|-----|
| Service crash | 2 min (PM2 auto-restart) | 0 |
| VM failure | 30 min (snapshot restore) | 24h |
| Database corruption | 15 min (backup restore) | 24h |
| Complete disaster | 2h (full rebuild) | 24h |

## Cost Analysis

### Monthly Costs

| Service | Cost | Notes |
|---------|------|-------|
| OVH VPS | ~$10 | Starter tier |
| Cloudflare | Free | Free tier sufficient |
| trigger.dev | Free | Hobby tier sufficient |
| Domain | ~$1 | Amortized annually |
| **Total** | **~$11/month** | |

### Cost Optimization

- SQLite eliminates database hosting cost
- Free Cloudflare tier provides DDoS protection
- trigger.dev free tier covers scheduling needs
- PM2 provides enterprise-grade process management free

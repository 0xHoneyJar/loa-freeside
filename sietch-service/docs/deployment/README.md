# Sietch Service Deployment

Production deployment infrastructure for Sietch Service on OVH VPS.

## Quick Start

1. **First-time setup**: Run `deploy/scripts/setup-server.sh` on your VPS
2. **Configure**: Copy `.env.example` to `.env` and fill in secrets
3. **Deploy**: Push to `main` branch (or use GitHub Actions workflow dispatch)

## Documentation

| Document | Description |
|----------|-------------|
| [Infrastructure](./infrastructure.md) | Architecture overview, component details |
| [Deployment Guide](./deployment-guide.md) | Step-by-step deployment instructions |
| [Monitoring](./monitoring.md) | Dashboards, metrics, alerting |
| [Security](./security.md) | Security measures, secret rotation |

## Runbooks

| Runbook | When to Use |
|---------|-------------|
| [Deployment](./runbooks/deployment.md) | Standard deploys, rollbacks |
| [Incidents](./runbooks/incidents.md) | Troubleshooting common issues |
| [Backups](./runbooks/backups.md) | Backup verification, restore procedures |

## Key URLs

| Service | URL |
|---------|-----|
| API | `https://yourdomain.com/` |
| Health | `https://yourdomain.com/health` |
| Metrics | `https://yourdomain.com/metrics` |
| Grafana | `https://grafana.yourdomain.com/` |

## GitHub Secrets Required

| Secret | Description |
|--------|-------------|
| `SSH_PRIVATE_KEY` | SSH key for deployment user |
| `SERVER_HOST` | VPS IP or hostname |
| `SERVER_USER` | SSH username (default: `sietch`) |
| `DOMAIN` | Primary domain name |
| `TRIGGER_SECRET_KEY` | trigger.dev API key |

## Architecture Summary

```
Internet → Caddy (SSL) → PM2 → Sietch Service
                              ├── Express API (:3000)
                              ├── Discord Bot
                              └── SQLite DB

Monitoring: Prometheus → Grafana
Backups: Git-based (6h intervals, 30d retention)
```

## Emergency Commands

```bash
# Stop service
pm2 stop sietch-service

# Start service
pm2 start sietch-service

# View logs
pm2 logs sietch-service

# Quick health check
curl http://localhost:3000/health
```

## Support

- **Incidents**: See [Incidents Runbook](./runbooks/incidents.md)
- **Security**: See [Security Guide](./security.md)
- **Infrastructure**: Check OVH status page

# Production Deployment Handover

**Date**: December 20, 2025
**Service**: Sietch Service v2.1
**Target Environment**: OVH VPS (Ubuntu 22.04+)

---

## Completed Items

### Infrastructure

- [x] Server setup script (`deploy/scripts/setup-server.sh`)
  - Node.js 20 LTS
  - PM2 process manager with startup script
  - Caddy reverse proxy with auto SSL
  - Prometheus + Grafana monitoring stack
  - Node Exporter for system metrics
  - Fail2ban + UFW firewall

### CI/CD Pipeline

- [x] GitHub Actions CI workflow (`.github/workflows/ci.yml`)
  - Linting, type checking, tests on every PR
  - Build artifact generation

- [x] GitHub Actions Deploy workflow (`.github/workflows/deploy.yml`)
  - Automated deployment on push to `main`
  - Health check verification
  - Automatic rollback on failure
  - trigger.dev task deployment

### Configuration

- [x] PM2 ecosystem config (`deploy/configs/ecosystem.config.cjs`)
- [x] Caddy configuration (`deploy/configs/Caddyfile`)
- [x] Prometheus configuration (in setup script)
- [x] Grafana dashboard (`deploy/monitoring/grafana-dashboard.json`)

### Scripts

- [x] Server setup script (`deploy/scripts/setup-server.sh`)
- [x] Database backup script (`deploy/scripts/backup-db.sh`)

### Monitoring

- [x] Prometheus metrics endpoint (`/metrics`)
- [x] Custom application metrics
- [x] Grafana dashboard with:
  - System metrics (CPU, memory, disk)
  - API request rate and latency
  - Member count, Naib seats, waitlist registrations
  - Alert counters

### Documentation

- [x] Infrastructure overview (`docs/deployment/infrastructure.md`)
- [x] Deployment guide (`docs/deployment/deployment-guide.md`)
- [x] Monitoring guide (`docs/deployment/monitoring.md`)
- [x] Security guide (`docs/deployment/security.md`)
- [x] Deployment runbook (`docs/deployment/runbooks/deployment.md`)
- [x] Incident runbook (`docs/deployment/runbooks/incidents.md`)
- [x] Backup runbook (`docs/deployment/runbooks/backups.md`)

---

## Critical Information

### URLs (after deployment)

| Service | URL |
|---------|-----|
| API | `https://yourdomain.com/` |
| Health Check | `https://yourdomain.com/health` |
| Metrics | `https://yourdomain.com/metrics` |
| Grafana | `https://grafana.yourdomain.com/` |

### File Locations (on server)

| Path | Purpose |
|------|---------|
| `/opt/sietch-service/` | Application directory |
| `/opt/sietch-service/data/sietch.db` | SQLite database |
| `/opt/sietch-service/.env` | Configuration (secrets) |
| `/var/log/sietch-service/` | Application logs |
| `/opt/sietch-backups/` | Database backup repository |
| `/etc/caddy/Caddyfile` | Caddy configuration |

### Credentials Location

| Secret | Storage |
|--------|---------|
| SSH Deploy Key | GitHub Secrets: `SSH_PRIVATE_KEY` |
| trigger.dev Key | GitHub Secrets: `TRIGGER_SECRET_KEY` |
| Discord Bot Token | Server `.env` file |
| Admin API Keys | Server `.env` file |
| Grafana Password | Changed on first login |

---

## Next Steps (User Action Required)

### 1. Provision OVH VPS

- Ubuntu 22.04 LTS
- Minimum: 2 vCPU, 2GB RAM, 40GB SSD
- Public IPv4 address
- Root or sudo access

### 2. Configure DNS

Point these records to your VPS IP:
- `api.yourdomain.com` → A record
- `grafana.yourdomain.com` → A record (optional)

### 3. Set Up GitHub Secrets

Add these secrets to your repository:
- `SSH_PRIVATE_KEY` - Ed25519 private key for deployment
- `SERVER_HOST` - VPS IP address
- `SERVER_USER` - `sietch` (created by setup script)
- `DOMAIN` - Your domain (e.g., `api.yourdomain.com`)
- `TRIGGER_SECRET_KEY` - From trigger.dev dashboard

### 4. Run Initial Deployment

```bash
# SSH to server
ssh root@your-vps-ip

# Run setup script
curl -sSL https://raw.githubusercontent.com/your-repo/main/sietch-service/deploy/scripts/setup-server.sh | sudo bash

# Switch to sietch user
sudo su - sietch

# Clone repository
git clone https://github.com/your-repo.git /opt/sietch-service

# Configure environment
cp /opt/sietch-service/.env.example /opt/sietch-service/.env
nano /opt/sietch-service/.env  # Fill in all values

# Build and start
cd /opt/sietch-service
npm ci --production
npm run build
pm2 start deploy/configs/ecosystem.config.cjs --env production
pm2 save
```

### 5. Configure Caddy

```bash
# Copy and customize Caddyfile
sudo cp /opt/sietch-service/deploy/configs/Caddyfile /etc/caddy/Caddyfile
sudo nano /etc/caddy/Caddyfile  # Replace {$DOMAIN}
sudo systemctl reload caddy
```

### 6. Set Up Backup Repository

```bash
# Create private GitHub repo for backups
# Clone it to server
git clone git@github.com:your-org/sietch-backups.git /opt/sietch-backups

# Add cron job
crontab -e
# Add: 0 */6 * * * /opt/sietch-service/deploy/scripts/backup-db.sh
```

### 7. Verify Deployment

- [ ] `https://yourdomain.com/health` returns healthy
- [ ] Discord bot is online
- [ ] Slash commands work (`/naib`, `/threshold`)
- [ ] Grafana dashboard loads
- [ ] Backup runs successfully

---

## Ongoing Operations

### Daily

- Monitor Grafana for anomalies
- Check PM2 status: `pm2 status`

### Weekly

- Review audit logs
- Check backup repository
- Review Fail2ban logs

### Monthly

- Test backup restoration
- Update dependencies: `npm update && npm audit`
- Review and rotate secrets if needed

### Quarterly

- Full disaster recovery drill
- Security review
- Cost optimization review

---

## Support Resources

| Topic | Resource |
|-------|----------|
| Documentation | `docs/deployment/` directory |
| Discord.js | https://discord.js.org |
| trigger.dev | https://trigger.dev/docs |
| Caddy | https://caddyserver.com/docs |
| PM2 | https://pm2.keymetrics.io/docs |
| Prometheus | https://prometheus.io/docs |

---

## Contact

For deployment issues:
1. Check runbooks in `docs/deployment/runbooks/`
2. Review logs: `pm2 logs sietch-service`
3. Escalate to platform team if infrastructure issue

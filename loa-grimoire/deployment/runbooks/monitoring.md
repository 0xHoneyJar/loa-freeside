# Monitoring Runbook

## Health Endpoints

### Application Health

```bash
# Basic health check
curl https://sietch.yourdomain.com/health

# Expected response:
{
  "status": "healthy",
  "version": "3.0.0",
  "lastSync": "2025-12-26T12:00:00.000Z",
  "eligibleCount": 69,
  "discordConnected": true
}
```

### Monitoring Checks

| Check | Endpoint/Command | Frequency | Alert |
|-------|------------------|-----------|-------|
| HTTP Health | `GET /health` | 60s | 3 failures |
| Discord Bot | PM2 status | 300s | Status != online |
| Database | `PRAGMA quick_check` | 6h | Any error |
| Disk Space | `df -h` | 1h | > 80% |
| Memory | PM2 monit | 60s | > 90% |
| SSL Cert | `certbot certificates` | Daily | < 14 days |

## PM2 Monitoring

### Check Status

```bash
# Quick status
pm2 status

# Detailed monitoring
pm2 monit

# Process info
pm2 info sietch-service
```

### Key Metrics

```bash
# Memory and CPU
pm2 show sietch-service | grep -E "(memory|cpu)"

# Restart count (should be low)
pm2 show sietch-service | grep restarts

# Uptime
pm2 show sietch-service | grep uptime
```

### Log Monitoring

```bash
# Real-time logs
pm2 logs sietch-service

# Recent errors
pm2 logs sietch-service --err --lines 100

# Search logs
pm2 logs sietch-service --lines 1000 | grep -i error
```

## Database Monitoring

### Size Check

```bash
# Database file size
ls -lh /data/sietch.db

# Table sizes
sqlite3 /data/sietch.db "SELECT name, SUM(pgsize) as size FROM dbstat GROUP BY name ORDER BY size DESC;"
```

### Record Counts

```bash
sqlite3 /data/sietch.db << 'EOF'
SELECT 'members' as table_name, COUNT(*) as count FROM members
UNION ALL
SELECT 'eligibility_snapshots', COUNT(*) FROM eligibility_snapshots
UNION ALL
SELECT 'badges', COUNT(*) FROM badges
UNION ALL
SELECT 'tier_history', COUNT(*) FROM tier_history
UNION ALL
SELECT 'audit_events', COUNT(*) FROM audit_events;
EOF
```

### Health Status

```bash
# Last sync status
sqlite3 /data/sietch.db "SELECT * FROM health_status ORDER BY updated_at DESC LIMIT 1;"

# Recent audit events
sqlite3 /data/sietch.db "SELECT * FROM audit_events ORDER BY created_at DESC LIMIT 10;"
```

## Nginx Monitoring

### Status Check

```bash
# Service status
sudo systemctl status nginx

# Connection stats
sudo nginx -T | head -20

# Current connections
sudo ss -tlnp | grep nginx
```

### Access Logs

```bash
# Recent requests
sudo tail -f /var/log/nginx/access.log

# Error patterns
sudo grep -i error /var/log/nginx/error.log | tail -50

# Request rates (last hour)
sudo awk -v d=$(date -d '1 hour ago' '+%d/%b/%Y:%H') '$4 ~ d {count++} END {print count}' /var/log/nginx/access.log
```

## System Monitoring

### Resource Usage

```bash
# Overall system
htop

# Memory
free -h

# Disk
df -h

# IO
iostat -x 1 5
```

### Network

```bash
# Active connections
ss -tuln

# Network traffic
iftop -i eth0
```

## trigger.dev Monitoring

### Dashboard

Visit: https://cloud.trigger.dev/

Check:
- Task execution history
- Success/failure rates
- Execution duration
- Error messages

### Task Health

| Task | Schedule | Expected Duration | Alert |
|------|----------|-------------------|-------|
| sync-eligibility | Every 6h | < 2 min | > 5 min or failure |
| weekly-digest | Monday 9:00 UTC | < 1 min | Failure |

## Alerting Setup

### Discord Webhook

Create webhook in your admin channel and configure alerts:

```bash
# Alert script: /home/sietch/scripts/alert.sh
#!/bin/bash
WEBHOOK_URL="https://discord.com/api/webhooks/YOUR_WEBHOOK"
MESSAGE="$1"

curl -H "Content-Type: application/json" \
  -d "{\"content\": \"🚨 **Sietch Alert**: $MESSAGE\"}" \
  "$WEBHOOK_URL"
```

### Example Alerts

```bash
# Service down
./alert.sh "Service is not responding to health checks"

# High memory
./alert.sh "Memory usage above 90%"

# Sync failure
./alert.sh "Eligibility sync task failed - check trigger.dev dashboard"
```

## Daily Checks

```bash
#!/bin/bash
# /home/sietch/scripts/daily-check.sh

echo "=== Sietch Daily Health Check ==="
echo "Date: $(date)"
echo ""

echo "=== Service Status ==="
pm2 status

echo ""
echo "=== Health Endpoint ==="
curl -s https://sietch.yourdomain.com/health | jq .

echo ""
echo "=== Database Stats ==="
sqlite3 /data/sietch.db "SELECT 'members', COUNT(*) FROM members UNION SELECT 'snapshots', COUNT(*) FROM eligibility_snapshots;"

echo ""
echo "=== Disk Usage ==="
df -h / /data /backups

echo ""
echo "=== Recent Errors ==="
pm2 logs sietch-service --err --lines 10 --nostream

echo ""
echo "=== SSL Certificate ==="
sudo certbot certificates 2>/dev/null | grep -E "(Domains|Expiry)"

echo ""
echo "=== Backup Status ==="
ls -la /backups/ | tail -3
```

## Weekly Checks

1. **Review trigger.dev dashboard** for task health
2. **Check backup integrity** (see backup-restore.md)
3. **Review error logs** for patterns
4. **Check disk growth** trends
5. **Verify SSL renewal** is working
6. **Test a restore** to verify backups

## Troubleshooting Metrics

### Slow Response Times

```bash
# Check PM2 metrics
pm2 monit

# Check nginx logs for slow requests
sudo awk '$NF > 1.0' /var/log/nginx/access.log | tail -20

# Check database query times
# Enable in config if needed
```

### High Memory Usage

```bash
# Check PM2 memory
pm2 show sietch-service | grep memory

# Check system memory
free -m

# Restart if needed
pm2 restart sietch-service
```

### High Error Rate

```bash
# Count recent errors
pm2 logs sietch-service --err --lines 1000 --nostream | wc -l

# Group by error type
pm2 logs sietch-service --err --lines 1000 --nostream | grep -oP 'Error: \K[^:]+' | sort | uniq -c | sort -rn
```

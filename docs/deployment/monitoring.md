# Monitoring Guide

## Health Check Endpoint

The primary monitoring endpoint:

```bash
curl https://sietch-api.honeyjar.xyz/health
```

**Expected response:**
```json
{
  "status": "healthy",
  "timestamp": "2025-12-18T12:00:00.000Z",
  "version": "2.0.0"
}
```

---

## External Monitoring Setup

### UptimeRobot (Recommended)

Free tier includes 50 monitors with 5-minute intervals.

1. Create account at https://uptimerobot.com
2. Add HTTP monitor:
   - **URL**: `https://sietch-api.honeyjar.xyz/health`
   - **Interval**: 5 minutes
   - **Alert contacts**: Your email/Slack

### Alternative: Uptime Kuma (Self-Hosted)

If you prefer self-hosted monitoring.

---

## PM2 Monitoring

### Real-Time Dashboard

```bash
pm2 monit
```

Shows:
- CPU usage
- Memory usage
- Logs (stdout/stderr)
- Process uptime

### Quick Status Check

```bash
pm2 list

# Expected output:
┌─────┬──────────┬─────────────┬─────────┬─────────┬──────────┬────────┬──────┬───────────┬──────────┬──────────┬──────────┬──────────┐
│ id  │ name     │ namespace   │ version │ mode    │ pid      │ uptime │ ↺    │ status    │ cpu      │ mem      │ user     │ watching │
├─────┼──────────┼─────────────┼─────────┼─────────┼──────────┼────────┼──────┼───────────┼──────────┼──────────┼──────────┼──────────┤
│ 0   │ sietch   │ default     │ 2.0.0   │ fork    │ 1234     │ 5D     │ 0    │ online    │ 0.1%     │ 128MB    │ sietch   │ disabled │
└─────┴──────────┴─────────────┴─────────┴─────────┴──────────┴────────┴──────┴───────────┴──────────┴──────────┴──────────┴──────────┘
```

**Key Indicators:**
- `status`: Should be `online`
- `↺` (restarts): Should be 0 or low
- `mem`: Should be < 256MB

### PM2 Logs

```bash
# Tail all logs
pm2 logs sietch

# Last 100 lines
pm2 logs sietch --lines 100

# Error logs only
pm2 logs sietch --err
```

---

## Key Metrics

### Application Metrics

| Metric | Healthy | Warning | Critical |
|--------|---------|---------|----------|
| API Response Time | < 100ms | > 500ms | > 2000ms |
| Memory Usage | < 200MB | > 200MB | > 256MB |
| Restart Count | 0 | 1-3 | > 3 |
| Uptime | > 24h | < 24h | < 1h |

### System Metrics

| Metric | Healthy | Warning | Critical |
|--------|---------|---------|----------|
| CPU Usage | < 50% | > 70% | > 90% |
| Disk Usage | < 70% | > 80% | > 90% |
| Memory (System) | < 70% | > 80% | > 90% |

### Check System Metrics

```bash
# CPU and Memory
top -bn1 | head -10

# Disk usage
df -h

# Memory details
free -h
```

---

## Log Monitoring

### Application Logs

```bash
# Real-time monitoring
tail -f /opt/sietch/logs/out.log

# Search for errors
grep -i "error\|exception\|fail" /opt/sietch/logs/out.log | tail -50

# Search for specific patterns
grep "eligibility" /opt/sietch/logs/out.log | tail -20
```

### nginx Logs

```bash
# Access logs
tail -f /var/log/nginx/sietch-access.log

# Error logs
tail -f /var/log/nginx/sietch-error.log

# 4xx/5xx errors
grep " [45][0-9][0-9] " /var/log/nginx/sietch-access.log | tail -20
```

### System Logs

```bash
# fail2ban activity
sudo tail -f /var/log/fail2ban.log

# SSH attempts
sudo tail -f /var/log/auth.log | grep sshd

# System messages
sudo tail -f /var/log/syslog
```

---

## Alerting

### Manual Alert Setup

Create `/opt/sietch/scripts/check-health.sh`:

```bash
#!/bin/bash

HEALTH_URL="http://127.0.0.1:3000/health"
ALERT_EMAIL="admin@example.com"

response=$(curl -s -o /dev/null -w "%{http_code}" $HEALTH_URL)

if [ "$response" != "200" ]; then
    echo "Sietch health check failed with HTTP $response" | \
        mail -s "ALERT: Sietch Down" $ALERT_EMAIL
fi
```

Add to cron (check every 5 minutes):
```
*/5 * * * * /opt/sietch/scripts/check-health.sh
```

### Discord Webhook Alerts

For team notifications via Discord:

```bash
#!/bin/bash

HEALTH_URL="http://127.0.0.1:3000/health"
WEBHOOK_URL="https://discord.com/api/webhooks/YOUR_WEBHOOK"

response=$(curl -s -o /dev/null -w "%{http_code}" $HEALTH_URL)

if [ "$response" != "200" ]; then
    curl -H "Content-Type: application/json" -X POST -d '{
        "content": "🚨 **ALERT**: Sietch API health check failed (HTTP '$response')"
    }' $WEBHOOK_URL
fi
```

---

## trigger.dev Dashboard

Monitor scheduled tasks at https://trigger.dev:

1. Log in to trigger.dev
2. Select `sietch-service` project
3. View task run history:
   - `sync-eligibility` - Every 6 hours
   - `activity-decay` - Every 6 hours
   - `badge-check` - Daily

**Check for:**
- Failed runs (red status)
- Retry attempts
- Execution duration anomalies

---

## Dashboard Commands

Quick status script at `/opt/sietch/scripts/status.sh`:

```bash
#!/bin/bash
echo "=== Sietch Service Status ==="
echo ""
echo "PM2 Status:"
pm2 list
echo ""
echo "Disk Usage:"
df -h /opt/sietch
echo ""
echo "Memory Usage:"
free -h
echo ""
echo "API Health Check:"
curl -s http://127.0.0.1:3000/health | jq . || echo "API not responding"
echo ""
echo "Recent Logs (last 20 lines):"
tail -20 /opt/sietch/logs/out.log
```

Run with:
```bash
/opt/sietch/scripts/status.sh
```

# Monitoring Guide

## Monitoring Stack

| Component | Port | URL |
|-----------|------|-----|
| Prometheus | 9090 | `http://localhost:9090` (internal) |
| Grafana | 3001 | `https://grafana.yourdomain.com` |
| Node Exporter | 9100 | `http://localhost:9100/metrics` (internal) |
| Sietch Metrics | 3000 | `http://localhost:3000/metrics` |

## Accessing Dashboards

### Grafana

1. Navigate to `https://grafana.yourdomain.com`
2. Default credentials: `admin` / `admin` (change on first login)
3. Import dashboard: `deploy/monitoring/grafana-dashboard.json`

### Prometheus

Internal only. Access via SSH tunnel if needed:

```bash
ssh -L 9090:localhost:9090 sietch@your-server
# Then open http://localhost:9090 locally
```

## Key Metrics

### System Metrics (Node Exporter)

| Metric | Description | Alert Threshold |
|--------|-------------|-----------------|
| `node_cpu_seconds_total` | CPU usage | > 80% sustained |
| `node_memory_MemAvailable_bytes` | Available memory | < 10% free |
| `node_filesystem_avail_bytes` | Disk space | < 20% free |
| `node_load1` | 1-min load average | > 2x CPU cores |

### Application Metrics (Sietch)

| Metric | Description | Alert Threshold |
|--------|-------------|-----------------|
| `sietch_http_requests_total` | Total HTTP requests | N/A (informational) |
| `sietch_http_request_duration_ms` | Request latency | p95 > 500ms |
| `sietch_members_total` | Eligible members count | Unexpected changes |
| `sietch_naib_seats_filled` | Filled Naib seats | < 7 when full expected |
| `sietch_waitlist_registrations` | Waitlist count | N/A (informational) |
| `sietch_alerts_sent_total` | Total alerts sent | N/A (informational) |
| `sietch_grace_period_active` | Grace period status | = 1 (alert) |
| `sietch_last_successful_query_timestamp` | Last RPC query | > 7 hours ago |
| `nodejs_heap_size_used_bytes` | Memory usage | > 400MB |
| `nodejs_process_uptime_seconds` | Uptime | Unexpected restarts |

## Dashboard Panels

### Overview Row

1. **CPU Usage** - Gauge showing current CPU utilization
2. **Memory Usage** - Gauge showing RAM utilization
3. **Disk Usage** - Gauge showing storage utilization
4. **Server Uptime** - Time since last reboot

### Sietch Service Row

1. **API Request Rate** - Requests per second by endpoint
2. **API Response Latency** - p50 and p95 latency
3. **Total Members** - Current eligible member count
4. **Naib Seats Filled** - 0-7 seats currently occupied
5. **Waitlist Registrations** - Active waitlist count

## Alert Rules

### Critical Alerts (P1)

```yaml
# Service down
- alert: SietchServiceDown
  expr: up{job="sietch"} == 0
  for: 2m
  labels:
    severity: critical
  annotations:
    summary: "Sietch service is down"

# Grace period active
- alert: GracePeriodActive
  expr: sietch_grace_period_active == 1
  for: 5m
  labels:
    severity: critical
  annotations:
    summary: "Sietch is in grace period (RPC issues)"
```

### Warning Alerts (P2)

```yaml
# High memory usage
- alert: HighMemoryUsage
  expr: (1 - node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes) > 0.85
  for: 10m
  labels:
    severity: warning
  annotations:
    summary: "Memory usage above 85%"

# High disk usage
- alert: HighDiskUsage
  expr: (1 - node_filesystem_avail_bytes{mountpoint="/"} / node_filesystem_size_bytes{mountpoint="/"}) > 0.8
  for: 5m
  labels:
    severity: warning
  annotations:
    summary: "Disk usage above 80%"

# High latency
- alert: HighAPILatency
  expr: histogram_quantile(0.95, rate(sietch_http_request_duration_seconds_bucket[5m])) > 0.5
  for: 10m
  labels:
    severity: warning
  annotations:
    summary: "API p95 latency above 500ms"
```

## Log Analysis

### View Application Logs

```bash
# Live logs
pm2 logs sietch-service

# Last 100 lines
pm2 logs sietch-service --lines 100

# Error logs only
pm2 logs sietch-service --err

# JSON formatted logs
cat /var/log/sietch-service/out.log | jq .
```

### Common Log Patterns

```bash
# Discord errors
pm2 logs sietch-service | grep -i discord

# RPC errors
pm2 logs sietch-service | grep -i rpc

# Database errors
pm2 logs sietch-service | grep -i sqlite

# Rate limit warnings
pm2 logs sietch-service | grep -i "rate"
```

## Health Checks

### HTTP Health Check

```bash
# From server
curl http://localhost:3000/health

# Expected response:
# {"status":"healthy","last_successful_query":"2025-12-20T...","next_query":"...","grace_period":false}
```

### Prometheus Scrape Test

```bash
curl http://localhost:3000/metrics
```

### PM2 Status

```bash
pm2 status
pm2 show sietch-service
```

## Troubleshooting Monitoring

### Prometheus Not Scraping

```bash
# Check Prometheus status
sudo systemctl status prometheus

# Check config
cat /etc/prometheus/prometheus.yml

# Reload config
sudo systemctl reload prometheus
```

### Grafana Not Loading

```bash
# Check Grafana status
sudo systemctl status grafana-server

# Check logs
sudo journalctl -u grafana-server -f

# Restart if needed
sudo systemctl restart grafana-server
```

### Missing Metrics

```bash
# Verify metrics endpoint
curl http://localhost:3000/metrics

# Check if service is running
pm2 status

# Verify Prometheus targets
curl http://localhost:9090/api/v1/targets
```

## Metric Retention

| Component | Retention |
|-----------|-----------|
| Prometheus | 30 days (configurable) |
| PM2 logs | 14 days (logrotate) |
| Grafana annotations | Permanent |

To adjust Prometheus retention:

```bash
# Edit /etc/systemd/system/prometheus.service
# Change: --storage.tsdb.retention.time=30d
sudo systemctl daemon-reload
sudo systemctl restart prometheus
```

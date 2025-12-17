# Sietch Server Administration Guide

This guide covers common administrative tasks for operating the Sietch service.

## Table of Contents

1. [Service Management](#service-management)
2. [Eligibility Sync Operations](#eligibility-sync-operations)
3. [Admin Overrides](#admin-overrides)
4. [Database Operations](#database-operations)
5. [Monitoring & Health Checks](#monitoring--health-checks)
6. [Discord Bot Management](#discord-bot-management)
7. [Troubleshooting](#troubleshooting)

---

## Service Management

### Check Service Status

```bash
# PM2 status
pm2 list

# Detailed process info
pm2 describe sietch

# Check memory and CPU
pm2 monit
```

### View Logs

```bash
# Real-time logs
pm2 logs sietch

# Last 100 lines
tail -100 /opt/sietch/logs/out.log

# Error logs only
tail -100 /opt/sietch/logs/error.log

# Search logs for specific pattern
grep "eligibility_update" /opt/sietch/logs/out.log
```

### Restart Service

```bash
# Graceful reload (zero-downtime)
pm2 reload sietch

# Hard restart
pm2 restart sietch

# Stop service
pm2 stop sietch

# Start service
pm2 start sietch
```

### Update Environment Variables

```bash
# Edit environment file
sudo nano /opt/sietch/.env

# Reload with new environment
pm2 reload sietch --update-env
```

---

## Eligibility Sync Operations

### Manual Eligibility Sync

The eligibility sync runs automatically every 6 hours via trigger.dev. To trigger manually:

1. Go to [trigger.dev dashboard](https://trigger.dev)
2. Navigate to the sietch-service project
3. Find the `sync-eligibility` task
4. Click "Run now"

Alternatively, use the trigger.dev CLI:

```bash
# If trigger.dev CLI is configured
npx trigger.dev@latest dev --project-ref sietch-service
# Then trigger via the local dashboard
```

### Check Last Sync Status

```bash
# Query database for latest snapshot
sqlite3 /opt/sietch/data/sietch.db "SELECT * FROM eligibility_snapshots ORDER BY id DESC LIMIT 1;"

# Check health status
sqlite3 /opt/sietch/data/sietch.db "SELECT * FROM health_status;"
```

### View Eligibility Changes

```bash
# Recent audit log entries
sqlite3 /opt/sietch/data/sietch.db "SELECT * FROM audit_log ORDER BY created_at DESC LIMIT 20;"

# Filter by event type
sqlite3 /opt/sietch/data/sietch.db "SELECT * FROM audit_log WHERE event_type = 'eligibility_update' ORDER BY created_at DESC LIMIT 5;"
```

---

## Admin Overrides

Admin overrides allow manual inclusion or exclusion of wallets from eligibility.

### List Active Overrides

```bash
curl -H "X-API-Key: YOUR_ADMIN_KEY" https://sietch-api.honeyjar.xyz/admin/overrides
```

Or via database:

```bash
sqlite3 /opt/sietch/data/sietch.db "SELECT * FROM admin_overrides WHERE active = 1;"
```

### Add Override (Include Wallet)

```bash
curl -X POST \
  -H "X-API-Key: YOUR_ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{"address":"0x1234...","action":"add","reason":"Manual inclusion - special case"}' \
  https://sietch-api.honeyjar.xyz/admin/override
```

### Add Override (Exclude Wallet)

```bash
curl -X POST \
  -H "X-API-Key: YOUR_ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{"address":"0x1234...","action":"remove","reason":"Ban - ToS violation"}' \
  https://sietch-api.honeyjar.xyz/admin/override
```

### Remove Override

```bash
# Get override ID from list, then delete
curl -X DELETE \
  -H "X-API-Key: YOUR_ADMIN_KEY" \
  https://sietch-api.honeyjar.xyz/admin/override/OVERRIDE_ID
```

### View Audit Log

```bash
curl -H "X-API-Key: YOUR_ADMIN_KEY" "https://sietch-api.honeyjar.xyz/admin/audit-log?limit=50"
```

---

## Database Operations

### Connect to Database

```bash
sqlite3 /opt/sietch/data/sietch.db
```

### Common Queries

```sql
-- Current eligibility (top 69)
SELECT * FROM current_eligibility ORDER BY rank LIMIT 69;

-- Naib Council (top 7)
SELECT * FROM current_eligibility WHERE rank <= 7 ORDER BY rank;

-- Fedaykin (8-69)
SELECT * FROM current_eligibility WHERE rank > 7 AND rank <= 69 ORDER BY rank;

-- Check specific wallet
SELECT * FROM current_eligibility WHERE address = '0x1234...';

-- Wallet to Discord mapping
SELECT * FROM wallet_mappings WHERE wallet_address = '0x1234...';

-- Recent snapshots
SELECT id, created_at FROM eligibility_snapshots ORDER BY id DESC LIMIT 10;

-- Health status
SELECT * FROM health_status;
```

### Database Maintenance

```bash
# Vacuum (reclaim space)
sqlite3 /opt/sietch/data/sietch.db "VACUUM;"

# Check integrity
sqlite3 /opt/sietch/data/sietch.db "PRAGMA integrity_check;"

# Check WAL status
sqlite3 /opt/sietch/data/sietch.db "PRAGMA wal_checkpoint(TRUNCATE);"
```

### Backup Database

```bash
# Manual backup
/opt/sietch/scripts/backup.sh

# List backups
ls -lh /opt/sietch/backups/
```

---

## Monitoring & Health Checks

### API Health Check

```bash
# Basic health
curl https://sietch-api.honeyjar.xyz/health

# Expected response:
# {"status":"healthy","lastSync":"2025-12-18T12:00:00Z","gracePeriod":false}
```

### Check RPC Health

```bash
# Query health status from database
sqlite3 /opt/sietch/data/sietch.db "SELECT * FROM health_status;"

# Test RPC directly
curl -X POST -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' \
  https://rpc.berachain.com
```

### Grace Period Status

The service enters "grace period" after 24 hours without successful RPC query:

```bash
# Check via API
curl https://sietch-api.honeyjar.xyz/health | jq .gracePeriod

# Check via database
sqlite3 /opt/sietch/data/sietch.db "SELECT * FROM health_status;"
```

During grace period:
- Service serves cached data
- No role revocations occur
- `/health` returns `status: "degraded"`

### Key Metrics to Monitor

| Metric | Warning | Critical |
|--------|---------|----------|
| API Response Time | > 500ms | > 2s |
| Memory Usage | > 200MB | > 256MB |
| Consecutive RPC Failures | 2 | 4 |
| API 5xx Errors | > 1/min | > 5/min |
| Grace Period | Entered | > 12 hours |

---

## Discord Bot Management

### Check Bot Status

```bash
# View Discord-related logs
grep "discord" /opt/sietch/logs/out.log | tail -20

# Check if bot is connected
grep "Discord bot connected" /opt/sietch/logs/out.log | tail -1
```

### Force Leaderboard Update

The leaderboard updates automatically after each eligibility sync. To force an update:

1. Trigger a manual eligibility sync (see above)
2. The Discord service will post to #census automatically

### Bot Permissions Required

- `SEND_MESSAGES` - Post to channels
- `EMBED_LINKS` - Rich embeds
- `MANAGE_MESSAGES` - Edit leaderboard
- `VIEW_CHANNEL` - Read channels

### Common Discord Issues

**Bot offline:**
```bash
# Check logs for connection errors
grep -i "discord" /opt/sietch/logs/error.log | tail -10

# Verify token is valid
# (Token should be in /opt/sietch/.env as DISCORD_BOT_TOKEN)
```

**Can't post to channel:**
1. Verify channel ID in `.env` matches actual Discord channel
2. Check bot has permissions in that channel
3. Check bot is member of the server

---

## Troubleshooting

### Service Won't Start

```bash
# Check PM2 logs
pm2 logs sietch --lines 50

# Check if port is in use
netstat -tlnp | grep 3000

# Verify environment file exists
cat /opt/sietch/.env | grep -v "^#" | grep -v "^$"

# Verify build output
ls -la /opt/sietch/current/sietch-service/dist/
```

### API Returns 502

1. Check Node.js process: `pm2 list`
2. Check crash logs: `pm2 logs sietch --err`
3. Test local endpoint: `curl http://127.0.0.1:3000/health`

### RPC Queries Failing

```bash
# Check health status
sqlite3 /opt/sietch/data/sietch.db "SELECT * FROM health_status;"

# Test RPC endpoints directly
curl -X POST -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' \
  https://rpc.berachain.com

# Check configured RPC URLs
grep "BERACHAIN_RPC" /opt/sietch/.env
```

### High Memory Usage

```bash
# Check memory
pm2 describe sietch | grep memory

# Force restart to clear memory
pm2 restart sietch

# Check for memory limits
grep "max_memory" /opt/sietch/current/sietch-service/ecosystem.config.cjs
```

### Database Locked

```bash
# Check processes using database
fuser /opt/sietch/data/sietch.db

# Restart service
pm2 restart sietch

# If persists, check WAL file
ls -la /opt/sietch/data/sietch.db*
```

---

## Emergency Procedures

### Emergency Rollback

```bash
# List available releases
ls -lt /opt/sietch/releases

# Rollback to previous release
cd /opt/sietch
ln -sfn /opt/sietch/releases/YYYYMMDDHHMMSS current
pm2 reload sietch --update-env
```

### Emergency Stop

```bash
# Stop all Sietch services
pm2 stop sietch

# Verify stopped
pm2 list
```

### Database Recovery

```bash
# List backups
ls -lh /opt/sietch/backups/

# Extract backup
cd /opt/sietch/backups
tar -xzf sietch_backup_YYYYMMDD_HHMMSS.tar.gz

# Stop service
pm2 stop sietch

# Replace database
cp sietch_backup_YYYYMMDD_HHMMSS/sietch.db /opt/sietch/data/sietch.db

# Start service
pm2 start sietch
```

---

*Last updated: December 2025*

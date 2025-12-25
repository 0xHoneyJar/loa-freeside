# Backup and Restore Runbook

## Backup Strategy

### Automated Backups

Daily backups run at 3:00 UTC via cron:

```bash
# /etc/cron.d/sietch-backup
0 3 * * * sietch /home/sietch/scripts/backup.sh
```

### Backup Script

Create `/home/sietch/scripts/backup.sh`:

```bash
#!/bin/bash
set -e

BACKUP_DIR="/backups"
DB_PATH="/data/sietch.db"
RETENTION_DAYS=30
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

# Create backup
cp "$DB_PATH" "$BACKUP_DIR/sietch.db.$TIMESTAMP"

# Compress
gzip "$BACKUP_DIR/sietch.db.$TIMESTAMP"

# Clean old backups
find "$BACKUP_DIR" -name "sietch.db.*.gz" -mtime +$RETENTION_DAYS -delete

# Log
echo "$(date): Backup completed - sietch.db.$TIMESTAMP.gz" >> /var/log/sietch/backup.log
```

### Backup Locations

| Type | Location | Retention |
|------|----------|-----------|
| Database | `/backups/sietch.db.*.gz` | 30 days |
| Config | Git repository | Permanent |
| Logs | `/var/log/sietch/` | 30 days |
| VM Snapshot | OVH control panel | 4 weeks |

## Manual Backup

### Quick Backup

```bash
# Stop service for consistency
pm2 stop sietch-service

# Create backup
cp /data/sietch.db /backups/sietch.db.manual.$(date +%Y%m%d_%H%M%S)

# Restart service
pm2 start sietch-service
```

### Full System Backup

```bash
# Create tarball of all critical data
sudo tar -czvf /backups/sietch-full-$(date +%Y%m%d).tar.gz \
  /data/sietch.db \
  /home/sietch/arrakis/sietch-service/.env.local \
  /etc/nginx/sites-available/sietch \
  /etc/letsencrypt/live/sietch.yourdomain.com/
```

## Restore Procedures

### Database Restore

```bash
# 1. Stop service
pm2 stop sietch-service

# 2. Backup current (potentially corrupted) database
mv /data/sietch.db /data/sietch.db.old.$(date +%s)

# 3. List available backups
ls -la /backups/sietch.db.*.gz

# 4. Decompress and restore
gunzip -c /backups/sietch.db.20251226_030000.gz > /data/sietch.db

# 5. Set permissions
chown sietch:sietch /data/sietch.db
chmod 600 /data/sietch.db

# 6. Verify integrity
sqlite3 /data/sietch.db "PRAGMA integrity_check;"

# 7. Start service
pm2 start sietch-service

# 8. Trigger fresh sync to update data
curl -X POST https://sietch.yourdomain.com/admin/sync \
  -H "X-API-Key: YOUR_API_KEY"
```

### Point-in-Time Recovery

SQLite doesn't support point-in-time recovery. Use the most recent backup before the issue occurred.

```bash
# List backups sorted by date
ls -lt /backups/sietch.db.*.gz

# Restore specific backup
gunzip -c /backups/sietch.db.YYYYMMDD_HHMMSS.gz > /data/sietch.db
```

### Full System Restore (New Server)

```bash
# 1. Install dependencies (see deployment-guide.md)

# 2. Clone repository
git clone https://github.com/0xHoneyJar/arrakis.git
cd arrakis/sietch-service

# 3. Install packages
npm install

# 4. Restore configuration
# Copy .env.local from backup or recreate

# 5. Restore database
mkdir -p /data
tar -xzf /backups/sietch-full-YYYYMMDD.tar.gz -C /
# Or restore just database:
gunzip -c /backups/sietch.db.YYYYMMDD_HHMMSS.gz > /data/sietch.db

# 6. Build and start
npm run build
pm2 start ecosystem.config.cjs

# 7. Configure nginx and SSL (see deployment-guide.md)
```

## Verification

### After Any Restore

```bash
# 1. Check service health
curl https://sietch.yourdomain.com/health

# 2. Check database counts
sqlite3 /data/sietch.db "SELECT COUNT(*) FROM members;"
sqlite3 /data/sietch.db "SELECT COUNT(*) FROM eligibility_snapshots;"

# 3. Check recent data
sqlite3 /data/sietch.db "SELECT * FROM eligibility_snapshots ORDER BY created_at DESC LIMIT 1;"

# 4. Verify Discord bot
# Check bot is online in Discord

# 5. Test a command
# Run /profile or /stats in Discord
```

### Backup Verification (Weekly)

```bash
# Test restore to temporary location
mkdir -p /tmp/backup-test
gunzip -c /backups/sietch.db.$(date +%Y%m%d)*.gz > /tmp/backup-test/sietch.db

# Verify integrity
sqlite3 /tmp/backup-test/sietch.db "PRAGMA integrity_check;"

# Verify data
sqlite3 /tmp/backup-test/sietch.db "SELECT COUNT(*) FROM members;"

# Cleanup
rm -rf /tmp/backup-test
```

## Disaster Recovery

### Scenario: Complete Server Loss

1. **Provision new server** (OVH VPS Starter, Ubuntu 22.04)
2. **Restore from VM snapshot** or **Full System Restore** above
3. **Update DNS** if IP changed
4. **Verify all services**

### Scenario: Database Corruption

1. **Stop service** immediately
2. **Restore from backup** (most recent before corruption)
3. **Trigger sync** to get current blockchain data
4. **Notify users** of potential data loss window

### Scenario: Accidental Data Deletion

1. **Stop service** to prevent further changes
2. **Identify deletion time** from logs
3. **Restore backup** from before deletion
4. **Trigger sync** to re-fetch current eligibility

## Monitoring Backups

### Check Backup Status

```bash
# Check latest backup
ls -la /backups/ | tail -5

# Check backup log
tail -20 /var/log/sietch/backup.log

# Check disk space
df -h /backups
```

### Alert on Backup Failure

Add to monitoring system:
- Alert if no new backup in 48 hours
- Alert if backup size is 0 or unusually small
- Alert if backup directory > 80% full

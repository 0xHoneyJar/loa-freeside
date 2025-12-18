# Runbook: Backups

## Backup Strategy

| What | Frequency | Retention | Location |
|------|-----------|-----------|----------|
| SQLite Database | Daily 3:00 AM | 7 days | `/opt/sietch/backups/` |
| Configuration | With code | N/A | Git repository |
| Environment | Manual | N/A | 1Password |

---

## Automatic Backups

Database backups run daily at 3:00 AM via cron.

### Verify Backup Cron

```bash
# As sietch user
crontab -l

# Should show:
# 0 3 * * * /opt/sietch/scripts/backup.sh
```

### Check Recent Backups

```bash
ls -lt /opt/sietch/backups/

# Example output:
# -rw-r--r-- 1 sietch sietch 524288 Dec 18 03:00 sietch_20251218_030000.db
# -rw-r--r-- 1 sietch sietch 524288 Dec 17 03:00 sietch_20251217_030000.db
```

### Verify Backup Integrity

```bash
# Check backup is valid SQLite
sqlite3 /opt/sietch/backups/sietch_20251218_030000.db "PRAGMA integrity_check;"

# Should output: ok
```

---

## Manual Backup

### Before Risky Operations

```bash
# Create manual backup with descriptive name
cp /opt/sietch/data/sietch.db \
   /opt/sietch/backups/sietch_before_migration_$(date +%Y%m%d_%H%M%S).db
```

### Full Backup (Including Logs)

```bash
# Create archive of all data
tar -czvf /opt/sietch/backups/full_backup_$(date +%Y%m%d).tar.gz \
  /opt/sietch/data/ \
  /opt/sietch/logs/ \
  /opt/sietch/.env
```

---

## Restore from Backup

### Stop Service First

```bash
pm2 stop sietch
```

### Restore Database

```bash
# List available backups
ls -lt /opt/sietch/backups/

# Restore specific backup
cp /opt/sietch/backups/sietch_20251217_030000.db /opt/sietch/data/sietch.db

# Verify restored database
sqlite3 /opt/sietch/data/sietch.db "SELECT COUNT(*) FROM current_eligibility;"
```

### Restart Service

```bash
pm2 start sietch

# Verify
curl https://sietch-api.honeyjar.xyz/health
```

---

## Off-Site Backup (Recommended)

For disaster recovery, sync backups to off-site storage.

### Using rsync to Remote Server

```bash
# Add to crontab (after backup completes)
30 3 * * * rsync -avz /opt/sietch/backups/ backup-server:/backups/sietch/
```

### Using AWS S3

```bash
# Install AWS CLI
apt-get install awscli

# Configure credentials
aws configure

# Sync backups to S3
aws s3 sync /opt/sietch/backups/ s3://your-bucket/sietch-backups/
```

### Using rclone (Google Drive, etc.)

```bash
# Install rclone
curl https://rclone.org/install.sh | sudo bash

# Configure remote
rclone config

# Sync backups
rclone sync /opt/sietch/backups/ gdrive:sietch-backups/
```

---

## Backup Monitoring

### Alert on Backup Failure

Add to backup script:

```bash
# At end of backup.sh
if [ ! -f "/opt/sietch/backups/sietch_$(date +%Y%m%d)_*.db" ]; then
  echo "Backup failed!" | mail -s "Sietch Backup Alert" admin@example.com
fi
```

### Check Backup Size Trend

```bash
# Check for unusual size changes
ls -lh /opt/sietch/backups/ | awk '{print $5, $9}'
```

A significantly smaller backup might indicate data loss.

---

## Recovery Time Estimates

| Scenario | RTO | Steps |
|----------|-----|-------|
| Restore from local backup | 5 min | Copy file, restart PM2 |
| Restore from S3 | 15 min | Download, copy, restart |
| Full rebuild | 1 hour | VPS setup, restore, verify |

---

## Backup Checklist

Monthly verification:

- [ ] Check cron job is running (`crontab -l`)
- [ ] Verify backups exist for last 7 days
- [ ] Test restore on non-production database
- [ ] Verify off-site backups (if configured)
- [ ] Check backup disk space (`df -h /opt/sietch/backups/`)

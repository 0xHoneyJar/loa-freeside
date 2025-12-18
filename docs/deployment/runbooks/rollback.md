# Runbook: Rollback

## Automatic Rollback

The deploy script automatically rolls back if the health check fails after deployment. No manual intervention required.

## Manual Rollback

### When to Use
- Deployment passed health check but has runtime issues
- Need to revert to known-good state
- Testing previous versions

### Procedure

```bash
# 1. SSH to server
ssh user@sietch-api.honeyjar.xyz

# 2. Switch to sietch user
sudo -u sietch -i

# 3. List available releases
ls -lt /opt/sietch/releases

# Output example:
# drwxr-xr-x 3 sietch sietch 4096 Dec 18 12:00 20251218120000
# drwxr-xr-x 3 sietch sietch 4096 Dec 17 15:30 20251217153000  <- Previous
# drwxr-xr-x 3 sietch sietch 4096 Dec 16 10:00 20251216100000

# 4. Update symlink to previous release
cd /opt/sietch
ln -sfn /opt/sietch/releases/20251217153000 current

# 5. Reload PM2 with new environment
pm2 reload sietch --update-env

# 6. Verify rollback
curl https://sietch-api.honeyjar.xyz/health
pm2 list
```

### Verification

```bash
# Check current symlink
ls -la /opt/sietch/current

# Should point to the release you rolled back to:
# current -> /opt/sietch/releases/20251217153000

# Check logs for errors
tail -50 /opt/sietch/logs/out.log

# Verify API responses
curl https://sietch-api.honeyjar.xyz/health
```

---

## Database Rollback

If database migrations need to be reverted:

### List Migration Status

```bash
sqlite3 /opt/sietch/data/sietch.db "SELECT * FROM _migrations ORDER BY version;"
```

### Rollback Last Migration

```bash
# Connect to SQLite
sqlite3 /opt/sietch/data/sietch.db

# Check current migrations
SELECT * FROM _migrations ORDER BY version;

# Run the down() migration manually if needed
# (Migration scripts are in sietch-service/src/db/migrations/)
```

**CAUTION**: Database rollbacks may cause data loss. Always backup first:

```bash
cp /opt/sietch/data/sietch.db /opt/sietch/backups/sietch_before_rollback.db
```

---

## Emergency Full Restore

If both code and database need restoration:

```bash
# 1. Stop the service
pm2 stop sietch

# 2. Restore database from backup
cp /opt/sietch/backups/sietch_YYYYMMDD_HHMMSS.db /opt/sietch/data/sietch.db

# 3. Rollback code
ln -sfn /opt/sietch/releases/KNOWN_GOOD_RELEASE current

# 4. Restart service
pm2 start sietch

# 5. Verify
curl https://sietch-api.honeyjar.xyz/health
```

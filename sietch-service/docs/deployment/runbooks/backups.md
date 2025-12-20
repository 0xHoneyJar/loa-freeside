# Backup & Recovery Runbook

## Backup Overview

| Component | Method | Frequency | Retention |
|-----------|--------|-----------|-----------|
| SQLite Database | Git-based snapshots | Every 6 hours | 30 days |
| Configuration | .env in Git Secrets | On change | Permanent |
| Application | Git repository | On commit | Permanent |

## Database Backup

### Automatic Backups (Cron)

Backups run every 6 hours via cron:

```bash
# View cron job
crontab -l | grep backup

# Expected output:
# 0 */6 * * * /opt/sietch-service/deploy/scripts/backup-db.sh
```

### Manual Backup

```bash
# Run backup manually
/opt/sietch-service/deploy/scripts/backup-db.sh

# Output includes:
# - Backup file path
# - Size
# - Total backup count
```

### Verify Backups

```bash
# List recent backups
ls -la /opt/sietch-backups/backups/

# Check latest backup
ls -la /opt/sietch-backups/backups/latest.db.gz

# Verify backup integrity
cd /opt/sietch-backups
gunzip -c backups/latest.db.gz > /tmp/test-restore.db
sqlite3 /tmp/test-restore.db "PRAGMA integrity_check;"
rm /tmp/test-restore.db
```

## Recovery Procedures

### Restore from Latest Backup

```bash
# 1. Stop the service
pm2 stop sietch-service

# 2. Backup current database (just in case)
cp /opt/sietch-service/data/sietch.db /opt/sietch-service/data/sietch.db.pre-restore

# 3. Restore from latest backup
cd /opt/sietch-backups
gunzip -c backups/latest.db.gz > /opt/sietch-service/data/sietch.db

# 4. Set permissions
chown sietch:sietch /opt/sietch-service/data/sietch.db

# 5. Start the service
pm2 start sietch-service

# 6. Verify
curl http://localhost:3000/health
```

### Restore from Specific Backup

```bash
# 1. List available backups
ls -la /opt/sietch-backups/backups/2025/12/

# 2. Stop service
pm2 stop sietch-service

# 3. Restore specific backup
gunzip -c /opt/sietch-backups/backups/2025/12/sietch_2025-12-20_06-00-00.db.gz > /opt/sietch-service/data/sietch.db

# 4. Start service
pm2 start sietch-service
```

### Restore from Remote (if local backups lost)

```bash
# 1. Clone backup repository
cd /opt
git clone git@github.com:your-org/sietch-backups.git sietch-backups-new

# 2. Restore
pm2 stop sietch-service
gunzip -c sietch-backups-new/backups/latest.db.gz > /opt/sietch-service/data/sietch.db
pm2 start sietch-service
```

## Disaster Recovery

### Complete Server Loss

1. **Provision new VPS** (Ubuntu 22.04+)

2. **Run setup script**:
   ```bash
   curl -sSL https://raw.githubusercontent.com/your-repo/main/sietch-service/deploy/scripts/setup-server.sh | sudo bash
   ```

3. **Clone application**:
   ```bash
   sudo su - sietch
   git clone https://github.com/your-repo.git /opt/sietch-service
   ```

4. **Restore configuration**:
   - Copy `.env` from secure backup (1Password, GitHub Secrets, etc.)

5. **Restore database**:
   ```bash
   git clone git@github.com:your-org/sietch-backups.git /opt/sietch-backups
   gunzip -c /opt/sietch-backups/backups/latest.db.gz > /opt/sietch-service/data/sietch.db
   ```

6. **Build and start**:
   ```bash
   cd /opt/sietch-service
   npm ci --production
   npm run build
   pm2 start deploy/configs/ecosystem.config.cjs --env production
   pm2 save
   ```

7. **Update DNS** to point to new server IP

8. **Configure Caddy** with domain

### Data Loss Estimation

| Recovery Point | Data Loss |
|---------------|-----------|
| Latest backup | Up to 6 hours |
| Previous backup | 6-12 hours |
| Oldest backup | Up to 30 days |

## Backup Repository Maintenance

### Check Repository Health

```bash
cd /opt/sietch-backups
git status
git log --oneline -5
du -sh .
```

### Manual Push (if automated push failed)

```bash
cd /opt/sietch-backups
git push origin main
```

### Clean Old Backups

The backup script automatically removes backups older than 30 days. To manually clean:

```bash
cd /opt/sietch-backups
find backups -name "*.db.gz" -mtime +30 -delete
git add -A
git commit -m "Clean old backups"
git push origin main
```

## Testing Backups

### Monthly Backup Test

Perform this test monthly:

```bash
# 1. Create test environment
mkdir /tmp/backup-test
cd /tmp/backup-test

# 2. Restore latest backup
gunzip -c /opt/sietch-backups/backups/latest.db.gz > test.db

# 3. Verify integrity
sqlite3 test.db "PRAGMA integrity_check;"

# 4. Verify data
sqlite3 test.db "SELECT COUNT(*) FROM eligibility_snapshots;"
sqlite3 test.db "SELECT COUNT(*) FROM member_profiles;"
sqlite3 test.db "SELECT COUNT(*) FROM naib_seats WHERE unseated_at IS NULL;"

# 5. Clean up
rm -rf /tmp/backup-test

# 6. Document test results
echo "Backup test passed: $(date)" >> /opt/sietch-service/logs/backup-tests.log
```

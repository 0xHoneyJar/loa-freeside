# Deployment Runbook

## Standard Deployment

### Automatic (GitHub Actions)

1. Push to `main` branch triggers deployment
2. Monitor progress in GitHub Actions tab
3. Verify deployment:
   ```bash
   curl https://yourdomain.com/health
   ```

### Manual Deployment

```bash
# SSH to server
ssh sietch@your-server

# Navigate to app directory
cd /opt/sietch-service

# Pull latest changes
git pull origin main

# Install dependencies
npm ci --production

# Build
npm run build

# Reload without downtime
pm2 reload sietch-service --update-env

# Verify
curl http://localhost:3000/health
pm2 logs sietch-service --lines 20
```

## Rollback Procedure

### Quick Rollback (PM2)

```bash
# Rollback to previous deployment
cd /opt/sietch-service

# Find backup
ls -la dist.backup.*

# Stop current
pm2 stop sietch-service

# Restore backup
rm -rf dist
mv dist.backup.YYYYMMDDHHMMSS dist

# Restart
pm2 start sietch-service

# Verify
pm2 logs sietch-service
```

### Git Rollback

```bash
# Find previous working commit
git log --oneline -10

# Reset to previous commit
git reset --hard <commit-hash>

# Rebuild and restart
npm ci --production
npm run build
pm2 reload sietch-service
```

## Emergency Procedures

### Stop Service

```bash
pm2 stop sietch-service
```

### Start Service

```bash
pm2 start sietch-service
```

### Complete Restart

```bash
pm2 delete sietch-service
pm2 start deploy/configs/ecosystem.config.cjs --env production
pm2 save
```

### Check Status

```bash
# PM2 status
pm2 status

# Service health
curl http://localhost:3000/health

# Recent logs
pm2 logs sietch-service --lines 100

# Memory/CPU usage
pm2 monit
```

## Database Operations

### Pre-Deployment Backup

```bash
# Run backup before any deployment
/opt/sietch-service/deploy/scripts/backup-db.sh
```

### Verify Migration

```bash
# Check migration logs
pm2 logs sietch-service | grep -i migration
```

## Verification Checklist

After every deployment:

- [ ] `pm2 status` shows `online`
- [ ] `/health` returns `status: healthy`
- [ ] No errors in last 20 log lines
- [ ] Discord bot responds to `/naib`
- [ ] Memory usage < 500MB

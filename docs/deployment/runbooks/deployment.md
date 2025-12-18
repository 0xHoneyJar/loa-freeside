# Runbook: Deployment

## Standard Deployment

### When to Use
- Deploying new features to production
- Applying bug fixes
- Routine updates

### Procedure

```bash
# 1. SSH to server
ssh user@sietch-api.honeyjar.xyz

# 2. Switch to sietch user
sudo -u sietch -i

# 3. Deploy
./deploy.sh main
```

### Expected Output

```
[INFO] Starting deployment...
[INFO] Repository: git@github.com:0xHoneyJar/arrakis.git
[INFO] Branch: main
[STEP] Running pre-deployment checks...
[INFO] Pre-deployment checks passed
[STEP] Cloning repository...
[INFO] Repository cloned
[STEP] Installing dependencies...
[INFO] Dependencies installed
[STEP] Building application...
[INFO] Build completed successfully
[STEP] Updating symlink...
[INFO] Symlink updated
[STEP] Reloading application...
[INFO] Application reloaded (zero-downtime)
[STEP] Running health check...
[INFO] Health check passed (HTTP 200)
[STEP] Cleaning up old releases...
[INFO] Cleanup complete

==============================================
  DEPLOYMENT SUCCESSFUL
==============================================
```

### Verification

```bash
# Check PM2 status
pm2 list

# Check API health
curl https://sietch-api.honeyjar.xyz/health

# Check recent logs
tail -20 /opt/sietch/logs/out.log
```

### If Deployment Fails

The deploy script automatically rolls back if the health check fails.

Manual rollback:
```bash
# List available releases
ls -lt /opt/sietch/releases

# Rollback to previous release
cd /opt/sietch
ln -sfn /opt/sietch/releases/PREVIOUS_TIMESTAMP current
pm2 reload sietch --update-env
```

---

## Deploy Specific Branch

```bash
./deploy.sh feature/my-branch
```

Use for:
- Testing features in production
- Hotfixes from non-main branches

---

## Emergency Hotfix Deployment

### Procedure

1. **Create hotfix branch locally**
   ```bash
   git checkout main
   git pull
   git checkout -b hotfix/critical-fix
   # Make changes
   git commit -m "fix: critical issue"
   git push -u origin hotfix/critical-fix
   ```

2. **Deploy hotfix**
   ```bash
   ssh user@sietch-api.honeyjar.xyz
   sudo -u sietch -i
   ./deploy.sh hotfix/critical-fix
   ```

3. **Verify fix**
   ```bash
   curl https://sietch-api.honeyjar.xyz/health
   tail -f /opt/sietch/logs/out.log
   ```

4. **Merge to main** (after verification)
   ```bash
   git checkout main
   git merge hotfix/critical-fix
   git push
   git branch -d hotfix/critical-fix
   ```

5. **Redeploy from main**
   ```bash
   ./deploy.sh main
   ```

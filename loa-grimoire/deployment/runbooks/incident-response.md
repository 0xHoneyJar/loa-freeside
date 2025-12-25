# Incident Response Runbook

## Severity Levels

| Level | Description | Response Time | Examples |
|-------|-------------|---------------|----------|
| P1 | Service completely down | 15 min | API unresponsive, bot offline |
| P2 | Major feature broken | 1 hour | Eligibility sync failing, roles not updating |
| P3 | Minor issue | 4 hours | Single command failing, cosmetic issues |
| P4 | Low priority | 24 hours | Documentation issues, minor bugs |

## P1: Service Down

### Symptoms
- `/health` endpoint returns error or timeout
- Discord bot offline
- Users reporting access issues

### Diagnosis

```bash
# 1. Check PM2 status
pm2 status

# 2. Check service logs
pm2 logs sietch-service --lines 100

# 3. Check system resources
htop
df -h

# 4. Check nginx
sudo systemctl status nginx
sudo tail -f /var/log/nginx/error.log

# 5. Check network
curl -I http://localhost:3000/health
```

### Resolution

**If PM2 shows "errored" or "stopped":**
```bash
pm2 restart sietch-service
pm2 logs sietch-service --lines 50
```

**If out of memory:**
```bash
pm2 restart sietch-service
# Consider increasing server resources
```

**If nginx down:**
```bash
sudo systemctl restart nginx
```

**If database locked:**
```bash
pm2 stop sietch-service
# Wait 10 seconds
pm2 start sietch-service
```

**If complete failure:**
```bash
# Full restart sequence
pm2 stop sietch-service
sudo systemctl restart nginx
pm2 start sietch-service
pm2 logs sietch-service
```

## P2: Eligibility Sync Failing

### Symptoms
- Rankings not updating
- Health check shows stale data
- trigger.dev dashboard shows failed tasks

### Diagnosis

```bash
# Check trigger.dev task history
# Visit: https://cloud.trigger.dev/

# Check RPC connectivity
curl -X POST <RPC_URL> \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'

# Check database state
sqlite3 /data/sietch.db "SELECT * FROM health_status;"
sqlite3 /data/sietch.db "SELECT COUNT(*) FROM eligibility_snapshots;"
```

### Resolution

**If RPC unreachable:**
1. Check Berachain RPC status
2. Switch to backup RPC if available
3. Grace period (24h) prevents role revocations

**If trigger.dev failing:**
```bash
# Manual sync trigger
curl -X POST https://sietch.yourdomain.com/admin/sync \
  -H "X-API-Key: YOUR_API_KEY"
```

**If database issue:**
```bash
# Check database integrity
sqlite3 /data/sietch.db "PRAGMA integrity_check;"

# If corrupted, restore from backup
pm2 stop sietch-service
cp /backups/sietch.db.YYYYMMDD /data/sietch.db
pm2 start sietch-service
```

## P2: Discord Bot Disconnected

### Symptoms
- Commands not responding
- Bot showing offline in Discord
- Logs showing reconnection attempts

### Diagnosis

```bash
# Check logs for Discord errors
pm2 logs sietch-service --lines 100 | grep -i discord

# Verify bot token
curl -H "Authorization: Bot $DISCORD_BOT_TOKEN" \
  https://discord.com/api/v10/users/@me
```

### Resolution

**If token invalid:**
1. Regenerate token in Discord Developer Portal
2. Update `.env.local`
3. Restart service: `pm2 restart sietch-service`

**If rate limited:**
- Wait for rate limit to clear (usually 1-5 minutes)
- Check for command spam in logs

**If Discord API down:**
- Check https://discordstatus.com/
- Wait for resolution

## P2: Roles Not Syncing

### Symptoms
- Members not getting tier roles
- Role changes not reflected
- Logs showing permission errors

### Diagnosis

```bash
# Check recent tier changes
sqlite3 /data/sietch.db "SELECT * FROM tier_history ORDER BY changed_at DESC LIMIT 10;"

# Check bot permissions in Discord
# Bot needs: Manage Roles, higher role position than tier roles
```

### Resolution

**If permission issue:**
1. Go to Discord server settings
2. Ensure bot role is above all tier roles
3. Verify "Manage Roles" permission

**If role IDs changed:**
1. Update role IDs in `.env.local`
2. Restart: `pm2 restart sietch-service`

## P3: Single Command Failing

### Diagnosis

```bash
# Search logs for command
pm2 logs sietch-service --lines 500 | grep -i "<command-name>"
```

### Resolution

Usually a bug - check error details and create issue for fix.

## Database Corruption Recovery

### Symptoms
- Service crashes on startup
- SQL errors in logs
- Integrity check fails

### Recovery Steps

```bash
# 1. Stop service
pm2 stop sietch-service

# 2. Backup corrupted database
cp /data/sietch.db /data/sietch.db.corrupted.$(date +%s)

# 3. Find latest good backup
ls -la /backups/

# 4. Restore backup
cp /backups/sietch.db.YYYYMMDD_HHMMSS /data/sietch.db

# 5. Verify integrity
sqlite3 /data/sietch.db "PRAGMA integrity_check;"

# 6. Start service
pm2 start sietch-service

# 7. Trigger fresh sync
curl -X POST https://sietch.yourdomain.com/admin/sync \
  -H "X-API-Key: YOUR_API_KEY"
```

## SSL Certificate Issues

### Symptoms
- Browser shows certificate error
- HTTPS connections failing

### Resolution

```bash
# Check certificate status
sudo certbot certificates

# Renew if expired
sudo certbot renew

# Force renewal
sudo certbot renew --force-renewal

# Restart nginx
sudo systemctl restart nginx
```

## Post-Incident

1. **Document**: Record what happened, when, and how it was resolved
2. **Notify**: Inform affected users via Discord announcement
3. **Review**: Identify root cause and preventive measures
4. **Update**: Add any new procedures to this runbook

# Runbook: Incident Response

## Incident Severity Levels

| Level | Description | Response Time | Example |
|-------|-------------|---------------|---------|
| **P1** | Service down, all users affected | < 15 min | API returns 5xx, bot offline |
| **P2** | Major feature broken | < 1 hour | Eligibility check failing |
| **P3** | Minor issue | < 4 hours | Slow response times |
| **P4** | Low priority | Next business day | Cosmetic issues |

---

## P1: Service Completely Down

### Symptoms
- Health endpoint returns 5xx
- Discord bot offline
- API requests timing out

### Immediate Actions

```bash
# 1. SSH to server
ssh user@sietch-api.honeyjar.xyz

# 2. Check PM2 status
pm2 list

# If sietch is stopped/erroring:
pm2 restart sietch
pm2 logs sietch --lines 50

# 3. Check nginx
sudo systemctl status nginx
sudo nginx -t
sudo systemctl restart nginx

# 4. Check disk space
df -h

# 5. Check memory
free -h

# 6. Check for crashes
tail -100 /opt/sietch/logs/error.log
```

### If Service Won't Start

```bash
# Check for port conflicts
netstat -tlnp | grep 3000

# Check environment file
cat /opt/sietch/.env | grep -v "^#" | grep -v "^$"

# Try starting manually to see errors
cd /opt/sietch/current/sietch-service
node dist/index.js
```

### Escalation
- If unresolved after 15 minutes, consider rollback
- Post in team channel with status update

---

## P2: Eligibility Check Failing

### Symptoms
- Collab.Land verification fails for all users
- `/eligibility` endpoint returns errors
- RPC errors in logs

### Diagnosis

```bash
# Check RPC connectivity
curl -X POST -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' \
  https://rpc.berachain.com

# Check application logs for RPC errors
grep -i "rpc\|berachain" /opt/sietch/logs/out.log | tail -50

# Check eligibility endpoint directly
curl https://sietch-api.honeyjar.xyz/eligibility/0xYOUR_TEST_WALLET
```

### Resolution

**If RPC is down:**
1. Check Berachain status page
2. Switch to backup RPC in `.env`:
   ```bash
   BERACHAIN_RPC_URLS=https://bera-rpc.publicnode.com,https://rpc.berachain.com
   ```
3. Reload service: `pm2 reload sietch --update-env`

**If database is corrupt:**
1. Restore from backup
2. Check `runbooks/backups.md`

---

## P2: Discord Bot Offline

### Symptoms
- Bot appears offline in Discord
- Slash commands not responding
- "Application did not respond" errors

### Diagnosis

```bash
# Check logs for Discord errors
grep -i "discord\|gateway\|connection" /opt/sietch/logs/out.log | tail -50

# Check if bot token is valid (should not 401)
curl -H "Authorization: Bot YOUR_BOT_TOKEN" \
  https://discord.com/api/v10/users/@me
```

### Resolution

**Invalid token:**
1. Generate new token in Discord Developer Portal
2. Update `.env`: `DISCORD_BOT_TOKEN=new_token`
3. Reload: `pm2 reload sietch --update-env`

**Rate limited:**
1. Wait for rate limit to expire (check logs for retry-after)
2. Review code for potential rate limit causes

**Intents missing:**
1. Go to Discord Developer Portal
2. Enable required intents under Bot settings
3. Restart: `pm2 restart sietch`

---

## P3: High Memory Usage

### Symptoms
- PM2 shows high memory (approaching 256MB)
- Frequent restarts due to memory limit
- Slow response times

### Diagnosis

```bash
# Check memory usage
pm2 describe sietch | grep memory

# Check system memory
free -h

# Check for memory leaks in logs
grep -i "memory\|heap" /opt/sietch/logs/out.log
```

### Resolution

```bash
# Restart to clear memory
pm2 restart sietch

# If persists, may need code investigation
# Consider increasing memory limit temporarily:
# Edit ecosystem.config.cjs: max_memory_restart: '512M'
```

---

## P3: Slow Response Times

### Symptoms
- API responses > 500ms
- Health checks timing out occasionally

### Diagnosis

```bash
# Check database size
ls -lh /opt/sietch/data/sietch.db

# Check system load
top -bn1 | head -20

# Check nginx status
sudo tail -20 /var/log/nginx/sietch-error.log
```

### Resolution

```bash
# Vacuum database
sqlite3 /opt/sietch/data/sietch.db "VACUUM;"

# Restart service
pm2 restart sietch

# If nginx is bottleneck, check rate limiting
# Review /etc/nginx/sites-available/sietch
```

---

## Post-Incident

After any P1 or P2 incident:

1. **Status Update**: Post resolution in team channel
2. **Root Cause**: Document what caused the issue
3. **Timeline**: Record detection, response, resolution times
4. **Follow-up**: Create tickets for preventive measures

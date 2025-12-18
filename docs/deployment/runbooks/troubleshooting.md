# Runbook: Troubleshooting

## Quick Diagnostics

Run this first for any issue:

```bash
/opt/sietch/scripts/status.sh
```

---

## Common Issues

### Service Not Starting

**Symptoms**: PM2 shows `stopped` or `errored`

**Check 1: PM2 Logs**
```bash
pm2 logs sietch --lines 100
```

**Check 2: Build Output**
```bash
ls -la /opt/sietch/current/sietch-service/dist/
# Should contain index.js
```

**Check 3: Environment File**
```bash
cat /opt/sietch/.env | grep -v "^#" | grep -v "^$"
# Verify all required vars are set
```

**Check 4: Port Conflict**
```bash
netstat -tlnp | grep 3000
# Port should be free or used by node
```

**Fix**: Restart with fresh env
```bash
pm2 delete sietch
cd /opt/sietch/current/sietch-service
pm2 start ecosystem.config.cjs
pm2 save
```

---

### API Returning 502

**Symptoms**: nginx returns 502 Bad Gateway

**Check 1: Is Node.js running?**
```bash
pm2 list
# sietch should be 'online'
```

**Check 2: Is port correct?**
```bash
curl http://127.0.0.1:3000/health
# Should return JSON
```

**Check 3: nginx upstream config**
```bash
grep "upstream" /etc/nginx/sites-available/sietch
# Should show 127.0.0.1:3000
```

**Fix 1**: Restart Node.js
```bash
pm2 restart sietch
```

**Fix 2**: Restart nginx
```bash
sudo systemctl restart nginx
```

---

### Discord Bot Offline

**Symptoms**: Bot shows offline in Discord, slash commands fail

**Check 1: Logs for Discord errors**
```bash
grep -i "discord\|gateway" /opt/sietch/logs/out.log | tail -30
```

**Check 2: Token validity**
```bash
# Get token from env
TOKEN=$(grep DISCORD_BOT_TOKEN /opt/sietch/.env | cut -d'=' -f2)

# Test API (should not 401)
curl -H "Authorization: Bot $TOKEN" \
  https://discord.com/api/v10/users/@me
```

**Check 3: Bot intents**
1. Go to Discord Developer Portal
2. Application → Bot
3. Verify "Server Members Intent" is enabled

**Fix 1**: Restart service
```bash
pm2 restart sietch
```

**Fix 2**: Reset token
1. Discord Developer Portal → Reset Token
2. Update `/opt/sietch/.env`
3. `pm2 reload sietch --update-env`

---

### Eligibility Check Failing

**Symptoms**: Collab.Land verification fails, `/eligibility` returns errors

**Check 1: RPC connectivity**
```bash
curl -X POST -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' \
  https://rpc.berachain.com
```

**Check 2: Application logs**
```bash
grep -i "eligibility\|rpc\|error" /opt/sietch/logs/out.log | tail -30
```

**Check 3: Test endpoint directly**
```bash
curl https://sietch-api.honeyjar.xyz/eligibility/0xTEST_WALLET
```

**Fix**: Switch RPC provider
```bash
# Edit .env to change RPC order
nano /opt/sietch/.env
# BERACHAIN_RPC_URLS=https://bera-rpc.publicnode.com,https://rpc.berachain.com

pm2 reload sietch --update-env
```

---

### High Memory Usage

**Symptoms**: PM2 shows >200MB, frequent restarts

**Check 1: Memory details**
```bash
pm2 describe sietch | grep memory
free -h
```

**Check 2: Memory over time**
```bash
pm2 monit
# Watch memory trend
```

**Fix 1**: Restart to clear
```bash
pm2 restart sietch
```

**Fix 2**: Vacuum database (if large)
```bash
sqlite3 /opt/sietch/data/sietch.db "VACUUM;"
```

**Fix 3**: Increase limit (temporary)
Edit `ecosystem.config.cjs`:
```javascript
max_memory_restart: '512M'
```

---

### Database Locked

**Symptoms**: SQLite errors in logs, queries failing

**Check 1: Processes using database**
```bash
fuser /opt/sietch/data/sietch.db
```

**Check 2: WAL files**
```bash
ls -la /opt/sietch/data/
# Check for .db-wal and .db-shm files
```

**Fix 1**: Restart service
```bash
pm2 restart sietch
```

**Fix 2**: Checkpoint WAL
```bash
sqlite3 /opt/sietch/data/sietch.db "PRAGMA wal_checkpoint(TRUNCATE);"
```

---

### Slow Response Times

**Symptoms**: API responses >500ms

**Check 1: Database size**
```bash
ls -lh /opt/sietch/data/sietch.db
```

**Check 2: System load**
```bash
top -bn1 | head -20
```

**Check 3: nginx logs**
```bash
tail -50 /var/log/nginx/sietch-access.log | awk '{print $NF}'
# Shows response times
```

**Fix 1**: Vacuum and analyze
```bash
sqlite3 /opt/sietch/data/sietch.db "VACUUM; ANALYZE;"
```

**Fix 2**: Restart service
```bash
pm2 restart sietch
```

---

### SSL Certificate Issues

**Symptoms**: Browser SSL warnings, certificate expired

**Check 1: Certificate status**
```bash
sudo certbot certificates
```

**Check 2: Certificate details**
```bash
echo | openssl s_client -servername sietch-api.honeyjar.xyz \
  -connect sietch-api.honeyjar.xyz:443 2>/dev/null | \
  openssl x509 -noout -dates
```

**Fix**: Renew certificate
```bash
sudo certbot renew
sudo systemctl reload nginx
```

---

### trigger.dev Tasks Failing

**Symptoms**: Tasks not running, errors in trigger.dev dashboard

**Check 1: View dashboard**
1. Go to https://trigger.dev
2. Select sietch-service project
3. Check task run history

**Check 2: Verify credentials**
```bash
grep TRIGGER /opt/sietch/.env
```

**Fix**: Re-register tasks
```bash
cd /opt/sietch/current/sietch-service
npx trigger.dev@latest dev
```

---

## Log Locations

| Log | Location |
|-----|----------|
| Application stdout | `/opt/sietch/logs/out.log` |
| Application stderr | `/opt/sietch/logs/error.log` |
| nginx access | `/var/log/nginx/sietch-access.log` |
| nginx error | `/var/log/nginx/sietch-error.log` |
| SSH attempts | `/var/log/auth.log` |
| fail2ban | `/var/log/fail2ban.log` |
| System | `/var/log/syslog` |

---

## Useful Commands

```bash
# Quick health check
curl -s https://sietch-api.honeyjar.xyz/health | jq .

# PM2 detailed info
pm2 describe sietch

# nginx config test
sudo nginx -t

# Database query
sqlite3 /opt/sietch/data/sietch.db "SELECT COUNT(*) FROM current_eligibility;"

# Disk usage
df -h /opt/sietch

# Memory usage
free -h

# Recent errors
grep -i "error" /opt/sietch/logs/out.log | tail -20
```

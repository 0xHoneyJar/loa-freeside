# Incident Response Runbook

## Severity Levels

| Level | Description | Response Time | Examples |
|-------|-------------|---------------|----------|
| P1 | Service completely down | < 15 min | App won't start, DB corruption |
| P2 | Major feature broken | < 1 hour | Discord bot offline, API errors |
| P3 | Minor issue | < 4 hours | Slow responses, cosmetic bugs |
| P4 | Enhancement | Next release | Feature requests |

## Common Incidents

### P1: Application Won't Start

**Symptoms**: PM2 shows `errored` or constant restarts

**Diagnosis**:
```bash
# Check logs
pm2 logs sietch-service --lines 200

# Common causes:
# - Invalid config (check .env)
# - Missing dependencies
# - Database locked/corrupted
```

**Resolution**:
```bash
# 1. Check config
cat .env | grep -v "^#"

# 2. Reinstall deps
rm -rf node_modules
npm ci --production

# 3. Check database
sqlite3 data/sietch.db "PRAGMA integrity_check;"

# 4. Restart
pm2 restart sietch-service
```

### P1: Database Corruption

**Symptoms**: SQLite errors, "database is locked"

**Diagnosis**:
```bash
sqlite3 data/sietch.db "PRAGMA integrity_check;"
```

**Resolution**:
```bash
# 1. Stop service
pm2 stop sietch-service

# 2. Restore from backup
cd /opt/sietch-backups
gunzip -c backups/latest.db.gz > /opt/sietch-service/data/sietch.db

# 3. Start service
pm2 start sietch-service

# 4. Verify
curl http://localhost:3000/health
```

### P2: Discord Bot Offline

**Symptoms**: Bot shows offline, commands don't work

**Diagnosis**:
```bash
# Check logs for Discord errors
pm2 logs sietch-service | grep -i discord

# Common causes:
# - Invalid bot token
# - Rate limited
# - Missing intents
```

**Resolution**:
```bash
# 1. Verify token is valid (check Discord Developer Portal)

# 2. Check rate limit status
pm2 logs sietch-service | grep "rate"

# 3. Restart bot
pm2 restart sietch-service

# 4. If token changed, update .env and restart
```

### P2: API Returning 500 Errors

**Symptoms**: Health check fails, API errors

**Diagnosis**:
```bash
# Check specific endpoint
curl -v http://localhost:3000/eligibility

# Check error logs
pm2 logs sietch-service --err
```

**Resolution**:
```bash
# 1. Check if Berachain RPC is responding
curl -X POST <RPC_URL> -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","method":"eth_blockNumber","id":1}'

# 2. If RPC issue, service enters grace period
# Wait for RPC recovery or switch to backup RPC

# 3. If code issue, rollback
git reset --hard HEAD~1
npm run build
pm2 reload sietch-service
```

### P2: High Memory Usage

**Symptoms**: PM2 shows high memory, restarts due to memory limit

**Diagnosis**:
```bash
pm2 monit
# or
pm2 show sietch-service
```

**Resolution**:
```bash
# 1. Restart to clear memory
pm2 restart sietch-service

# 2. If recurring, check for memory leaks
# Look for growing heap in /metrics

# 3. Increase memory limit if needed
# Edit ecosystem.config.cjs: max_memory_restart: '1G'
```

### P3: Slow API Responses

**Symptoms**: p95 latency > 500ms in Grafana

**Diagnosis**:
```bash
# Check metrics
curl http://localhost:3000/metrics | grep duration

# Check database size
ls -lh data/sietch.db
```

**Resolution**:
```bash
# 1. Check if database needs optimization
sqlite3 data/sietch.db "ANALYZE;"
sqlite3 data/sietch.db "VACUUM;"

# 2. Check for slow queries in logs

# 3. Restart service to clear caches
pm2 restart sietch-service
```

## Escalation Path

1. **On-call engineer**: Initial response, follow runbooks
2. **Senior engineer**: Complex issues, architecture decisions
3. **Platform team**: Infrastructure issues (VPS, network)
4. **External**: Discord API issues, Berachain RPC issues

## Post-Incident

After resolving any P1 or P2 incident:

1. **Document**: What happened, timeline, root cause
2. **Action Items**: Preventive measures
3. **Communicate**: Update stakeholders
4. **Monitor**: Watch for recurrence

## Contact Information

| Role | Contact |
|------|---------|
| On-call | Check rotation schedule |
| OVH Support | support.ovh.com |
| Discord Support | dis.gd/support |
| trigger.dev | support@trigger.dev |

# Disaster Recovery Plan

## Recovery Objectives

| Metric | Target | Description |
|--------|--------|-------------|
| **RTO** | 1 hour | Recovery Time Objective - time to restore service |
| **RPO** | 24 hours | Recovery Point Objective - max data loss (daily backups) |

---

## Disaster Scenarios

### Scenario 1: Application Crash

**Symptoms**: API returning 5xx, bot offline
**RTO**: 5 minutes
**RPO**: 0 (no data loss)

**Recovery:**
```bash
# PM2 auto-restarts. If not:
pm2 restart sietch

# If code is broken, rollback:
ls -lt /opt/sietch/releases
ln -sfn /opt/sietch/releases/PREVIOUS current
pm2 reload sietch --update-env
```

---

### Scenario 2: Database Corruption

**Symptoms**: SQLite errors in logs, data inconsistency
**RTO**: 15 minutes
**RPO**: Up to 24 hours

**Recovery:**
```bash
# Stop service
pm2 stop sietch

# List backups
ls -lt /opt/sietch/backups/

# Restore latest backup
cp /opt/sietch/backups/sietch_YYYYMMDD_HHMMSS.db /opt/sietch/data/sietch.db

# Verify integrity
sqlite3 /opt/sietch/data/sietch.db "PRAGMA integrity_check;"

# Start service
pm2 start sietch

# Verify
curl https://sietch-api.honeyjar.xyz/health
```

---

### Scenario 3: VPS Failure / Unrecoverable

**Symptoms**: Server unreachable, hardware failure
**RTO**: 1 hour (new VPS)
**RPO**: Up to 24 hours

**Recovery:**

1. **Provision New VPS**
   - Order new OVH VPS (Ubuntu 22.04)
   - Update DNS A record to new IP
   - Wait for DNS propagation (5-15 min)

2. **Run Setup Script**
   ```bash
   curl -o setup-vps.sh \
     https://raw.githubusercontent.com/0xHoneyJar/arrakis/main/sietch-service/docs/deployment/scripts/setup-vps.sh
   sudo bash setup-vps.sh
   ```

3. **Restore Configuration**
   - Copy `.env` from 1Password backup to `/opt/sietch/.env`
   - Or recreate from `PRE_DEPLOYMENT_CHECKLIST.md`

4. **Restore Database**
   - Retrieve latest backup from off-site storage
   - Copy to `/opt/sietch/data/sietch.db`

5. **Deploy Application**
   ```bash
   sudo -u sietch -i
   ./deploy.sh main
   ```

6. **Configure nginx and SSL**
   ```bash
   sudo cp /opt/sietch/current/sietch-service/docs/deployment/configs/nginx-sietch.conf \
           /etc/nginx/sites-available/sietch
   sudo ln -s /etc/nginx/sites-available/sietch /etc/nginx/sites-enabled/
   sudo certbot --nginx -d sietch-api.honeyjar.xyz
   ```

7. **Verify**
   ```bash
   curl https://sietch-api.honeyjar.xyz/health
   ```

---

### Scenario 4: DNS/Domain Issues

**Symptoms**: Domain unreachable, SSL errors
**RTO**: Variable (depends on TTL)
**RPO**: 0

**Recovery:**
1. Check DNS provider status
2. Verify A record points to correct IP
3. If domain expired, renew immediately
4. If SSL issue: `sudo certbot renew --force-renewal`

---

### Scenario 5: Compromised Server

**Symptoms**: Suspicious activity, unauthorized access
**RTO**: 2 hours
**RPO**: Verify data integrity

**Recovery:**

1. **Isolate**
   ```bash
   # Block all except your IP
   sudo ufw default deny incoming
   sudo ufw allow from YOUR_IP to any port 22
   ```

2. **Investigate**
   - Review `/var/log/auth.log`
   - Check for unauthorized users/keys
   - Review nginx access logs

3. **If Confirmed Breach**
   - Provision new VPS (follow Scenario 3)
   - Rotate ALL secrets:
     - Discord bot token
     - trigger.dev key
     - Admin API keys
   - Restore database from pre-compromise backup

4. **Post-Incident**
   - Document timeline
   - Update security measures
   - Notify affected parties if PII exposed

---

## Backup Verification

### Monthly DR Drill

Test full recovery process:

1. **Create Test Environment**
   - Spin up temporary VPS
   - Run setup script

2. **Restore from Backup**
   ```bash
   # Copy backup to test server
   scp /opt/sietch/backups/sietch_latest.db test-server:/opt/sietch/data/

   # Deploy application
   ./deploy.sh main
   ```

3. **Verify Functionality**
   - Health endpoint
   - Eligibility check
   - Discord bot connection

4. **Document Results**
   - Time to recover
   - Any issues encountered
   - Update procedures if needed

5. **Cleanup**
   - Destroy test VPS

---

## Emergency Contacts

| Role | Contact | Method |
|------|---------|--------|
| Primary Ops | TBD | Discord/Phone |
| OVH Support | support.ovhcloud.com | Web ticket |
| Cloudflare | cloudflare.com/support | Dashboard |
| Discord Support | dis.gd/contact | Web form |

---

## Checklist Summary

### Before Disaster

- [ ] Daily database backups running (cron)
- [ ] Off-site backup sync configured (recommended)
- [ ] `.env` backed up in 1Password
- [ ] This DR plan accessible offline
- [ ] Team knows escalation path

### During Disaster

1. Assess severity and scenario
2. Follow recovery steps above
3. Communicate status to team
4. Document actions and timeline

### After Disaster

- [ ] Root cause analysis
- [ ] Update procedures
- [ ] Test backup restoration
- [ ] Schedule DR drill

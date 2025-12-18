# Security Guide

## Security Architecture

Sietch implements defense-in-depth with multiple security layers:

```
Internet
    │
    ▼
┌───────────────────────────────────────┐
│ Layer 1: Network Security             │
│  - UFW Firewall (ports 22, 80, 443)   │
│  - fail2ban (brute force protection)  │
└───────────────────────────────────────┘
    │
    ▼
┌───────────────────────────────────────┐
│ Layer 2: Transport Security           │
│  - TLS 1.2+ (Let's Encrypt)           │
│  - Strong cipher suites               │
│  - HTTP → HTTPS redirect              │
└───────────────────────────────────────┘
    │
    ▼
┌───────────────────────────────────────┐
│ Layer 3: Application Security         │
│  - Rate limiting (nginx + app level)  │
│  - Input validation (Zod schemas)     │
│  - Parameterized SQL queries          │
│  - API key authentication (admin)     │
└───────────────────────────────────────┘
    │
    ▼
┌───────────────────────────────────────┐
│ Layer 4: Data Security                │
│  - No PII in public APIs              │
│  - Secrets in env vars only           │
│  - Database file permissions (600)    │
└───────────────────────────────────────┘
```

---

## Access Control

### SSH Access

- **Authentication**: SSH key only (password disabled)
- **Root login**: Disabled
- **Protocol**: SSH Protocol 2 only
- **Timeout**: 5 minutes idle

**Managing SSH Keys:**

```bash
# Add new key
sudo -u sietch -i
nano ~/.ssh/authorized_keys
# Add new public key

# Remove key
# Delete the line from authorized_keys
```

### API Access

| Endpoint Pattern | Authentication | Rate Limit |
|------------------|----------------|------------|
| `/health` | None | 50 burst |
| `/eligibility/*` | None | 10/s |
| `/api/directory` | None | 50/min |
| `/api/profile` | Session | 30/min |
| `/admin/*` | API Key | 30/min |

### Admin API Keys

```bash
# View configured keys
grep ADMIN_API_KEYS /opt/sietch/.env

# Format: key1:name1,key2:name2
```

**Rotate API keys:**

```bash
# Generate new key
openssl rand -hex 16

# Update .env
sudo nano /opt/sietch/.env

# Reload
pm2 reload sietch --update-env
```

---

## Secrets Management

### Current Storage

All secrets are stored in `/opt/sietch/.env`:

| Secret | Environment Variable |
|--------|---------------------|
| Discord Bot Token | `DISCORD_BOT_TOKEN` |
| trigger.dev Key | `TRIGGER_SECRET_KEY` |
| Admin API Keys | `ADMIN_API_KEYS` |

### Security Measures

- `.env` file permissions: `600` (owner read/write only)
- `.env` file owner: `sietch` user
- Not committed to git (in `.gitignore`)
- Backup in 1Password (recommended)

### Rotating Secrets

**Discord Bot Token:**
1. Go to Discord Developer Portal
2. Bot → Reset Token
3. Update `/opt/sietch/.env`
4. `pm2 reload sietch --update-env`

**trigger.dev Secret Key:**
1. Go to trigger.dev dashboard
2. Project Settings → API Keys
3. Create new key, delete old
4. Update `/opt/sietch/.env`
5. `pm2 reload sietch --update-env`

---

## Firewall Configuration

### Current Rules

```bash
sudo ufw status verbose

# Expected output:
Status: active
Logging: on (low)
Default: deny (incoming), allow (outgoing), disabled (routed)

To                         Action      From
--                         ------      ----
22/tcp                     ALLOW IN    Anywhere
80/tcp                     ALLOW IN    Anywhere
443/tcp                    ALLOW IN    Anywhere
```

### Adding Rules

```bash
# Allow specific IP
sudo ufw allow from 1.2.3.4 to any port 22

# Remove rule
sudo ufw delete allow from 1.2.3.4 to any port 22
```

---

## fail2ban Configuration

### Current Jails

```bash
sudo fail2ban-client status

# Check specific jail
sudo fail2ban-client status sshd
```

### Banned IPs

```bash
# List banned IPs
sudo fail2ban-client status sshd | grep "Banned IP"

# Unban IP
sudo fail2ban-client set sshd unbanip 1.2.3.4
```

### Configuration

```bash
# View jail configuration
cat /etc/fail2ban/jail.local
```

---

## SSL/TLS

### Certificate Status

```bash
# Check certificate expiry
sudo certbot certificates

# Manual renewal
sudo certbot renew

# Test renewal
sudo certbot renew --dry-run
```

### Auto-Renewal

Certbot sets up auto-renewal via systemd timer:

```bash
# Check timer
sudo systemctl status certbot.timer
```

---

## Security Updates

### Automatic Updates

Enabled via `unattended-upgrades`:

```bash
# Check status
sudo systemctl status unattended-upgrades

# View recent updates
cat /var/log/unattended-upgrades/unattended-upgrades.log
```

### Manual Updates

```bash
sudo apt update
sudo apt upgrade
```

---

## Audit Logging

### Application Audit Log

```bash
sqlite3 /opt/sietch/data/sietch.db "SELECT * FROM audit_log ORDER BY created_at DESC LIMIT 20;"
```

Logged events:
- Admin override operations
- Badge awards/revokes
- Role assignments

### System Audit

```bash
# SSH login attempts
sudo grep "sshd" /var/log/auth.log | tail -50

# fail2ban actions
sudo tail -50 /var/log/fail2ban.log

# nginx access (potential attacks)
grep " [45][0-9][0-9] " /var/log/nginx/sietch-access.log | tail -20
```

---

## Security Checklist

### Daily (Automated)

- [x] Security updates (unattended-upgrades)
- [x] SSL certificate check (certbot timer)
- [x] fail2ban running
- [x] Database backup

### Weekly (Manual)

- [ ] Review fail2ban bans: `sudo fail2ban-client status sshd`
- [ ] Check disk usage: `df -h`
- [ ] Review error logs: `tail -100 /opt/sietch/logs/error.log`

### Monthly

- [ ] Review access logs for anomalies
- [ ] Verify backup restoration works
- [ ] Check for new security advisories
- [ ] Review and rotate API keys if needed

### Quarterly

- [ ] Full security audit
- [ ] Update dependencies: `npm audit`
- [ ] Review firewall rules
- [ ] Review user access

---

## Incident Response

If security incident suspected:

1. **Isolate**: Consider blocking suspect IPs via UFW
2. **Investigate**: Check logs (`/var/log/auth.log`, fail2ban, nginx)
3. **Rotate**: Change all secrets if compromise suspected
4. **Document**: Record timeline and actions
5. **Report**: Notify team and stakeholders

See `runbooks/incidents.md` for detailed procedures.

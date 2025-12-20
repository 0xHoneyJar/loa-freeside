# Security Guide

## Security Overview

Sietch Service implements defense-in-depth security measures across multiple layers.

## Network Security

### Firewall (UFW)

```bash
# Current rules
sudo ufw status verbose

# Expected configuration:
# - Default: deny incoming, allow outgoing
# - Allow: SSH (22), HTTP (80), HTTPS (443)
```

### Fail2ban

Protects against brute-force attacks:

```bash
# Check status
sudo fail2ban-client status

# Check SSH jail
sudo fail2ban-client status sshd

# Unban an IP (if needed)
sudo fail2ban-client set sshd unbanip <IP>
```

### Internal Services

Only exposed locally:
- Prometheus (9090): `127.0.0.1` only
- Grafana (3001): Via Caddy reverse proxy with auth
- Sietch API (3000): Via Caddy reverse proxy

## TLS/SSL

### Certificate Management

Caddy automatically manages Let's Encrypt certificates:

```bash
# Check certificate status
sudo caddy list-certificates

# Force renewal (if needed)
sudo caddy reload --config /etc/caddy/Caddyfile
```

### Security Headers

Configured in Caddyfile:
- `X-Frame-Options: SAMEORIGIN`
- `X-Content-Type-Options: nosniff`
- `X-XSS-Protection: 1; mode=block`
- HSTS (enable after initial deployment)

## Secrets Management

### Environment Variables

Secrets are stored in `/opt/sietch-service/.env`:

```bash
# Check file permissions (should be 600)
ls -la /opt/sietch-service/.env

# Expected: -rw------- 1 sietch sietch
```

### GitHub Secrets

For CI/CD, secrets are stored in GitHub repository secrets:
- `SSH_PRIVATE_KEY`
- `TRIGGER_SECRET_KEY`
- `SERVER_HOST`
- `SERVER_USER`

### Secret Rotation

#### Discord Bot Token

1. Generate new token in Discord Developer Portal
2. Update `.env` on server
3. Restart service: `pm2 restart sietch-service`

#### Admin API Keys

1. Generate new key: `openssl rand -hex 32`
2. Update `ADMIN_API_KEYS` in `.env`
3. Restart service
4. Update clients using the old key

#### SSH Keys

1. Generate new key: `ssh-keygen -t ed25519`
2. Add public key to server: `ssh-copy-id`
3. Update GitHub Secret `SSH_PRIVATE_KEY`
4. Remove old key from `~/.ssh/authorized_keys`

## Application Security

### Input Validation

All API inputs are validated using Zod schemas:

```typescript
// Example: Wallet address validation
const addressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/);
```

### Rate Limiting

Configured per endpoint type:

| Endpoint | Limit |
|----------|-------|
| Public API | 100 req/15min/IP |
| Member API | 50 req/15min/IP |
| Admin API | 20 req/15min/key |
| Waitlist Registration | 5 req/hour/IP |

### SQL Injection Prevention

All database queries use parameterized statements:

```typescript
// Correct (used throughout)
db.prepare('SELECT * FROM users WHERE id = ?').get(userId);

// Never used (would be vulnerable)
db.exec(`SELECT * FROM users WHERE id = '${userId}'`);
```

### Privacy Protection

- Wallet addresses truncated in logs: `truncateAddress()`
- Discord IDs never exposed in public responses
- Ephemeral responses for sensitive commands
- Public types (`PublicProfile`, `PublicNaibMember`) filter sensitive data

## Access Control

### SSH Access

- Key-based authentication only
- No root login
- Fail2ban for brute-force protection

### API Authentication

- Public endpoints: Rate limited, no auth
- Member endpoints: Discord OAuth (via headers)
- Admin endpoints: API key required

### Discord Permissions

Bot requires minimal permissions:
- Send Messages
- Embed Links
- Manage Roles (for @Naib, @Fedaykin, etc.)
- Use Slash Commands

## Audit Logging

All significant actions are logged:

```typescript
logAuditEvent('admin_override', {
  action: 'deactivate',
  overrideId: id,
  deactivatedBy: req.adminName,
});
```

View audit logs:

```bash
# Via API
curl -H "X-Admin-Key: your-key" https://yourdomain.com/admin/audit-log

# Via database
sqlite3 /opt/sietch-service/data/sietch.db "SELECT * FROM audit_log ORDER BY created_at DESC LIMIT 20;"
```

## Security Checklist

### Deployment

- [ ] `.env` file permissions are 600
- [ ] SSH key authentication only
- [ ] UFW firewall enabled
- [ ] Fail2ban running
- [ ] HTTPS with valid certificate
- [ ] Security headers configured

### Ongoing

- [ ] Review audit logs weekly
- [ ] Check fail2ban logs for attacks
- [ ] Monitor for unusual API patterns
- [ ] Keep dependencies updated
- [ ] Rotate secrets quarterly

## Incident Response

### Suspected Breach

1. **Isolate**: Block suspicious IPs
   ```bash
   sudo ufw deny from <IP>
   ```

2. **Investigate**: Check logs
   ```bash
   pm2 logs sietch-service --lines 500
   sudo tail -f /var/log/auth.log
   ```

3. **Rotate**: Change all secrets if compromised

4. **Report**: Document incident and notify stakeholders

### Vulnerability Discovered

1. **Assess**: Determine severity and scope
2. **Fix**: Develop and test patch
3. **Deploy**: Emergency deployment if critical
4. **Communicate**: Notify affected users if needed

## Dependencies

Keep dependencies updated:

```bash
# Check for vulnerabilities
npm audit

# Update dependencies
npm update

# Fix vulnerabilities
npm audit fix
```

## Security Contacts

| Issue | Contact |
|-------|---------|
| Vulnerability report | security@yourdomain.com |
| Discord abuse | dis.gd/report |
| OVH abuse | abuse@ovh.net |

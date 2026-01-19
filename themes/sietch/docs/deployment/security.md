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

### HashiCorp Vault (Recommended for Production)

For production deployments with strict security requirements, use HashiCorp Vault for centralized secret management:

#### Setup

1. **Install Vault** (or use managed Vault service like HCP Vault):
   ```bash
   # On the server
   curl -fsSL https://apt.releases.hashicorp.com/gpg | sudo apt-key add -
   sudo apt-add-repository "deb [arch=amd64] https://apt.releases.hashicorp.com $(lsb_release -cs) main"
   sudo apt-get update && sudo apt-get install vault
   ```

2. **Configure environment variables**:
   ```bash
   # Required when FEATURE_VAULT_ENABLED=true
   FEATURE_VAULT_ENABLED=true
   VAULT_ADDR=https://vault.yourdomain.com:8200
   VAULT_TOKEN=hvs.your-token-here
   ```

3. **Store secrets in Vault**:
   ```bash
   # Store Discord bot token
   vault kv put secret/sietch/discord bot_token="your-token"

   # Store API key pepper
   vault kv put secret/sietch/security api_key_pepper="$(openssl rand -hex 32)"

   # Store database credentials
   vault kv put secret/sietch/database url="postgres://user:pass@host/db"
   ```

#### Benefits

- **Centralized secret management**: All secrets in one place
- **Audit logging**: Track who accessed what secrets when
- **Secret rotation**: Automatic or scheduled rotation
- **Dynamic secrets**: Generate database credentials on-demand
- **Encryption as a service**: Transit engine for data encryption

#### Emergency Key Rotation (Sprint 138)

For compromised API keys, use zero-grace-period rotation to immediately invalidate the old key:

**API Key Pepper Compromise:**
```bash
# 1. Generate new pepper immediately (do NOT wait)
NEW_PEPPER=$(openssl rand -hex 32)
echo "New pepper: $NEW_PEPPER"

# 2. Update Vault (skip grace period)
vault kv put secret/sietch/security api_key_pepper="$NEW_PEPPER"

# 3. Restart service to apply new pepper
pm2 restart sietch-service

# 4. All existing API keys are now invalid!
# Users must re-authenticate and get new keys
```

**Dashboard API Key Compromise:**
```bash
# 1. Identify compromised key in database
# 2. Revoke immediately (zero grace period)
psql -c "UPDATE dashboard_api_keys SET revoked_at = NOW(), revoked_reason = 'EMERGENCY_ROTATION' WHERE key_hash = 'compromised-hash';"

# 3. Notify affected user to regenerate key
# 4. Review audit logs for unauthorized access
```

**Discord Bot Token Compromise:**
```bash
# 1. Regenerate token in Discord Developer Portal immediately
# 2. Update environment variable
export DISCORD_BOT_TOKEN="new-token-here"

# 3. If using Vault:
vault kv put secret/sietch/discord bot_token="new-token-here"

# 4. Restart service
pm2 restart sietch-service

# 5. Review Discord audit logs for unauthorized actions
```

**Important:** During emergency rotation:
- **Zero grace period**: Old credentials are invalid immediately
- **User impact**: All sessions using old credentials will fail
- **Audit**: Document the incident and review access logs
- **Communication**: Notify affected users of required re-authentication

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

## Dashboard Session Security

### Redis Session Store (Required for Production)

The dashboard uses Redis for session storage in production. This is required for:

1. **Session persistence**: Sessions survive application restarts
2. **Horizontal scaling**: Multiple instances share session state
3. **Security**: Sessions can be invalidated centrally

#### Configuration

```bash
# Required environment variables
FEATURE_REDIS_ENABLED=true
REDIS_URL=redis://localhost:6379  # Or your Redis cluster URL

# Optional tuning
REDIS_MAX_RETRIES=3
REDIS_CONNECT_TIMEOUT=5000
```

#### Validation at Startup

Sprint 137 added startup validation that:
- **Fails** if `FEATURE_REDIS_ENABLED=true` but `REDIS_URL` is missing
- **Warns** if Redis is disabled in production (in-memory fallback is insecure)

#### Redis Security Checklist

- [ ] Use TLS for Redis connections in production (`rediss://`)
- [ ] Set Redis password (`redis://default:password@host:6379`)
- [ ] Restrict network access (firewall rules)
- [ ] Enable Redis persistence (AOF or RDB)
- [ ] Monitor Redis memory usage

#### Session Configuration

Sessions are configured in `auth.routes.ts`:
- **TTL**: 24 hours default
- **Refresh**: Extended on activity
- **HTTP-only cookies**: Prevents XSS access
- **Secure flag**: Requires HTTPS in production
- **SameSite**: Lax (CSRF protection)

### API Key Security

API keys use HMAC-based authentication with a pepper:

```bash
# Generate a secure pepper (minimum 32 characters)
API_KEY_PEPPER=$(openssl rand -hex 32)
```

The application will fail to start if:
- `API_KEY_PEPPER` is set to `CHANGE_ME_IN_PRODUCTION` in production
- `API_KEY_PEPPER` is less than 32 characters in production

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

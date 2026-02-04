# Sietch Admin Setup Guide

**Last verified**: 2026-02-04
**Source**: `themes/sietch/src/config.ts`, `themes/sietch/src/discord/commands/verify.ts`

This guide walks you through setting up a Sietch Discord server from scratch. Follow these steps in order.

---

## Prerequisites

| Requirement | Version | Notes |
|-------------|---------|-------|
| Node.js | 18.17+ | Tested: 18.17, 20.x, 22.x |
| PostgreSQL | 15+ | Tested: 15.x, 16.x |
| Discord account | - | With access to Developer Portal |
| Git | 2.x+ | For cloning repository |

---

## Quick Start (5 minutes)

If you're familiar with Discord bots and just need the essentials:

```bash
# 1. Clone and install
git clone https://github.com/0xHoneyJar/arrakis.git
cd arrakis/themes/sietch
pnpm install

# 2. Copy environment template
cp .env.example .env.local

# 3. Edit .env.local with your values (see Environment Configuration below)

# 4. Run database migrations
pnpm db:migrate

# 5. Start the bot
pnpm dev
```

---

## Full Setup

### 1. Discord Application Setup

#### 1.1 Create Application

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Click "New Application"
3. Name it (e.g., "Sietch Bot")
4. Accept the Terms of Service

#### 1.2 Get Bot Token

1. Go to "Bot" in the left sidebar
2. Click "Reset Token" (or "Add Bot" if new)
3. Copy the token immediately (you won't see it again)
4. Save it as `DISCORD_BOT_TOKEN` in your `.env.local`

**Security Warning**:
- Never commit your bot token
- Never share your bot token
- Regenerate immediately if exposed

#### 1.3 Configure Bot Settings

In the Bot settings page:

| Setting | Value | Why |
|---------|-------|-----|
| Public Bot | OFF | Only you should add this bot |
| Requires OAuth2 Code Grant | OFF | Not needed |
| Presence Intent | ON | Optional, for status |
| Server Members Intent | ON | Required for member events |
| Message Content Intent | ON | Required for commands |

#### 1.4 Set Bot Permissions

In "OAuth2" > "URL Generator":

1. Select scopes: `bot`, `applications.commands`
2. Select bot permissions:

| Permission | Required | Why |
|------------|----------|-----|
| Manage Roles | ✅ Yes | Assign tier roles |
| Send Messages | ✅ Yes | Bot responses |
| Embed Links | ✅ Yes | Rich embeds |
| Read Message History | ✅ Yes | Context |
| Use Slash Commands | ✅ Yes | /verify command |
| Manage Channels | Optional | Create channels |
| Kick Members | Optional | Moderation |

**Least Privilege**: Only enable permissions you need.

3. Copy the generated URL
4. Open in browser to invite bot to your server

#### 1.5 Get Discord IDs

Enable Developer Mode:
1. Discord Settings > Advanced > Developer Mode: ON

Get IDs by right-clicking:
- **Server ID**: Right-click server name > Copy Server ID
- **Channel ID**: Right-click channel > Copy Channel ID
- **Role ID**: Server Settings > Roles > Right-click role > Copy Role ID

Discord IDs are 18-19 digit numbers (Snowflake format):
```
Example: 1234567890123456789
```

---

### 2. Environment Configuration

Copy the template and edit:

```bash
cp .env.example .env.local
```

#### 2.1 Required Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `DISCORD_BOT_TOKEN` | Bot token from Developer Portal | `MTIz...` |
| `DISCORD_GUILD_ID` | Your server's ID | `1234567890123456789` |
| `DATABASE_URL` | PostgreSQL connection | `postgresql://user:pass@localhost:5432/sietch` |
| `BERACHAIN_RPC_URLS` | Berachain RPC endpoints | `https://rpc.berachain.com` |
| `BGT_ADDRESS` | BGT token contract | `0x656b95E550C07a9ffe548bd4085c72418Ceb1dba` |
| `TRIGGER_PROJECT_ID` | trigger.dev project | `sietch-service` |
| `TRIGGER_SECRET_KEY` | trigger.dev secret | `tr_dev_xxx` |
| `ADMIN_API_KEYS` | Admin API keys | `dev_key:developer` |
| `API_KEY_PEPPER` | API key salt | (generate with `openssl rand -hex 32`) |

#### 2.2 Channel IDs (Required)

| Variable | Purpose |
|----------|---------|
| `DISCORD_CHANNEL_THE_DOOR` | Join/leave announcements |
| `DISCORD_CHANNEL_CENSUS` | Leaderboard display |

#### 2.3 Role IDs (Required)

| Variable | Role | Purpose |
|----------|------|---------|
| `DISCORD_ROLE_NAIB` | @Naib | Top 7 holders |
| `DISCORD_ROLE_FEDAYKIN` | @Fedaykin | Top 8-69 holders |

#### 2.4 Optional Variables

See `.env.example` for full list with descriptions. Key optional ones:

| Variable | Default | Purpose |
|----------|---------|---------|
| `FEATURE_BILLING_ENABLED` | false | Enable Paddle billing |
| `FEATURE_REDIS_ENABLED` | false | Enable Redis caching |
| `LOG_LEVEL` | info | Logging verbosity |
| `GRACE_PERIOD_HOURS` | 24 | Hours before role revocation |

---

### 3. Database Setup

#### 3.1 Create Database

```bash
# Using psql
createdb sietch

# Or with PostgreSQL CLI
psql -c "CREATE DATABASE sietch;"
```

#### 3.2 Run Migrations

```bash
cd themes/sietch
pnpm db:migrate
```

Expected output:
```
Running migrations...
✓ 001_initial
✓ 002_social_layer
...
✓ 019_dashboard_config
Migrations complete.
```

#### 3.3 Verify Database State

```bash
pnpm db:status
```

Should show all migrations applied.

#### 3.4 Rollback Procedures

If migration fails:

```bash
# Check current state
pnpm db:status

# Rollback last migration
pnpm db:rollback

# Check logs for errors
cat logs/migration.log
```

**Before migrating production**:
1. Back up database: `pg_dump sietch > backup.sql`
2. Test migration in staging first
3. Have rollback plan ready

#### 3.5 Integrity Verification

After migration, verify:

```bash
# Check tables exist
psql sietch -c "\dt"

# Should see: members, communities, eligibility_snapshots, etc.
```

---

### 4. Running the Bot

#### 4.1 Development Mode

```bash
cd themes/sietch
pnpm dev
```

Expected output:
```
[INFO] Loading configuration...
[INFO] Connecting to database...
[INFO] Registering commands...
[INFO] Bot online as Sietch#1234
[INFO] API server listening on port 3000
```

#### 4.2 Health Check

Verify the bot is running:

```bash
curl http://localhost:3000/health
```

Expected response:
```json
{"status":"healthy","version":"3.0.0"}
```

#### 4.3 Production Deployment

For production, see: `docs/deployment/DEPLOYMENT_RUNBOOK.md`

Key differences:
- Use `pnpm start` instead of `pnpm dev`
- Set `NODE_ENV=production`
- Use proper secrets management (Vault or AWS Secrets Manager)
- Run behind a reverse proxy (nginx)

---

### 5. First Verification Test

#### 5.1 Test /verify Command

1. In Discord, use the slash command:
   ```
   /verify start
   ```

2. Bot should respond with a verification link

3. Click the link (expires in 15 minutes)

4. Connect your wallet and sign the message

5. Return to Discord - role should be assigned

#### 5.2 Verify Tier Assignment

After verification:
- Check if user has appropriate tier role
- Check #census for leaderboard update
- Check #the-door for join announcement

---

## Troubleshooting

### Error Code Reference

| Code | Error | Cause | Solution |
|------|-------|-------|----------|
| `ECONNREFUSED` | Database connection failed | PostgreSQL not running | `sudo systemctl start postgresql` |
| `DISCORD_TOKEN_INVALID` | Bot token rejected | Wrong or expired token | Regenerate in Developer Portal |
| `MISSING_PERMISSIONS` | Cannot manage roles | Bot lacks permissions | Re-invite with correct permissions |
| `ROLE_HIERARCHY` | Cannot assign role | Bot role too low | Move bot role above managed roles in Server Settings > Roles |
| `GUILD_NOT_FOUND` | Server not accessible | Wrong guild ID or bot not invited | Verify ID, re-invite bot |
| `MIGRATION_FAILED` | Database migration error | Schema conflict | Check migration logs, rollback if needed |
| `SESSION_EXPIRED` | Verify link timeout | >15 min elapsed | User runs `/verify start` again |
| `SIGNATURE_INVALID` | Wallet signature rejected | User signed wrong message | Retry with fresh session |
| `REDIS_CONNECTION` | Cache unavailable | Redis not configured | Set `REDIS_URL` or set `FEATURE_REDIS_ENABLED=false` |
| `RATE_LIMITED` | Discord API throttled | Too many requests | Wait 60 seconds, implement backoff |

### Common Issues

#### Bot Not Responding to Commands

1. Check bot is online in Discord (should show green dot)
2. Check logs: `tail -f logs/sietch.log`
3. Verify `DISCORD_GUILD_ID` is correct
4. Re-register commands: `pnpm commands:register`

#### "Permission Denied" on Role Assignment

1. Go to Server Settings > Roles
2. Drag bot role ABOVE all managed tier roles
3. Verify bot has "Manage Roles" permission

#### Verification Link Expired

- Links expire after 15 minutes (configurable via `VERIFY_SESSION_EXPIRY_MINUTES`)
- User should run `/verify start` again
- Check server time is correct (NTP sync)

#### Database Connection Failures

1. Verify PostgreSQL is running: `pg_isready`
2. Check connection string format
3. Verify user has permissions: `psql -U arrakis -d sietch -c "SELECT 1"`

---

## Security Checklist

Before going live:

- [ ] Bot token is in `.env.local` (gitignored), not committed
- [ ] `ADMIN_API_KEYS` uses bcrypt hashes (not plaintext)
- [ ] `API_KEY_PEPPER` is unique and secret
- [ ] Bot permissions are minimal (no ADMINISTRATOR)
- [ ] Bot role is below admin roles in hierarchy
- [ ] `LOG_LEVEL` is `info` or higher (not `debug` in production)
- [ ] Database uses SSL in production (`?sslmode=require`)
- [ ] Webhook secrets are configured for Paddle (if billing enabled)

**Security Warnings**:

⚠️ NEVER commit `.env.local` or any file containing real tokens

⚠️ NEVER use plaintext API keys in production (use bcrypt hashes)

⚠️ NEVER give bot ADMINISTRATOR permission (use specific perms)

---

## Reference

- [Tier System Documentation](./TIER_SYSTEM.md)
- [Feature Flags Guide](./FEATURE_FLAGS.md)
- [Deployment Runbook](./deployment/DEPLOYMENT_RUNBOOK.md)
- [Discord Developer Portal](https://discord.com/developers/applications)

---

## Support

- **Discord**: Join our support server
- **Email**: support@thj.com
- **Issues**: https://github.com/0xHoneyJar/arrakis/issues

# Sietch Pre-Deployment Checklist

This checklist guides you through obtaining all required credentials and configuring external services before deploying Sietch to production.

## Table of Contents

1. [DNS Configuration](#1-dns-configuration)
2. [Discord Bot Setup](#2-discord-bot-setup)
3. [trigger.dev Setup](#3-triggerdev-setup)
4. [Collab.Land Setup](#4-collabland-setup)
5. [Berachain RPC Configuration](#5-berachain-rpc-configuration)
6. [Admin API Keys](#6-admin-api-keys)
7. [Final Checklist](#7-final-checklist)

---

## 1. DNS Configuration

### Configure DNS A Record

1. Go to your DNS provider (Cloudflare, Route53, etc.)
2. Create an A record:
   - **Name**: `sietch-api` (or whatever subdomain you chose)
   - **Type**: A
   - **Value**: Your VPS IP address
   - **TTL**: 300 (5 minutes)

3. Verify DNS propagation:
   ```bash
   # Check DNS resolution
   dig sietch-api.honeyjar.xyz

   # Or use online tool
   # https://dnschecker.org/#A/sietch-api.honeyjar.xyz
   ```

4. Wait for propagation (usually 5-15 minutes, can take up to 24 hours)

**Required value for .env**:
```
# No env var needed - domain is in nginx config
```

---

## 2. Discord Bot Setup

### Step 2.1: Create Discord Application

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Click "New Application"
3. Name: `Sietch Bot`
4. Accept Terms of Service
5. Click "Create"

### Step 2.2: Configure Bot

1. In left sidebar, click "Bot"
2. Click "Add Bot" → "Yes, do it!"
3. Under "Privileged Gateway Intents", enable:
   - ✅ **SERVER MEMBERS INTENT** (required for member lookup)
4. Click "Save Changes"

### Step 2.3: Get Bot Token

1. In Bot section, click "Reset Token"
2. Confirm and copy the token
3. **IMPORTANT**: Store this securely - you can only see it once!

**Required value for .env**:
```
DISCORD_BOT_TOKEN=your_bot_token_here
```

### Step 2.4: Invite Bot to Server

1. In left sidebar, click "OAuth2" → "URL Generator"
2. Select scopes:
   - ✅ `bot`
3. Select bot permissions:
   - ✅ Send Messages
   - ✅ Embed Links
   - ✅ Manage Messages
   - ✅ Read Message History
   - ✅ View Channels
4. Copy the generated URL
5. Open URL in browser and select your Sietch Discord server
6. Authorize the bot

### Step 2.5: Get Discord IDs

Enable Developer Mode in Discord:
1. Discord Settings → App Settings → Advanced
2. Enable "Developer Mode"

Get IDs by right-clicking and selecting "Copy ID":

| Item | How to Get | Example |
|------|------------|---------|
| Guild ID | Right-click server name | `1234567890123456789` |
| #the-door channel | Right-click channel | `1234567890123456789` |
| #census channel | Right-click channel | `1234567890123456789` |
| Naib role | Server Settings → Roles → Right-click | `1234567890123456789` |
| Fedaykin role | Server Settings → Roles → Right-click | `1234567890123456789` |

**Required values for .env**:
```
DISCORD_GUILD_ID=your_guild_id
DISCORD_CHANNEL_THE_DOOR=your_the_door_channel_id
DISCORD_CHANNEL_CENSUS=your_census_channel_id
DISCORD_ROLE_NAIB=your_naib_role_id
DISCORD_ROLE_FEDAYKIN=your_fedaykin_role_id
```

---

## 3. trigger.dev Setup

### Step 3.1: Create Account

1. Go to [trigger.dev](https://trigger.dev)
2. Sign up with GitHub (recommended)
3. Create a new organization (or use existing)

### Step 3.2: Create Project

1. Click "Create Project"
2. Name: `sietch-service`
3. Select your organization
4. Click "Create"

### Step 3.3: Get Credentials

1. Go to Project Settings → API Keys
2. Copy the **Project ID** (shown in URL or settings)
3. Create a new **Secret Key**:
   - Click "Create API Key"
   - Name: `production`
   - Copy the key (starts with `tr_`)

**Required values for .env**:
```
TRIGGER_PROJECT_ID=sietch-service
TRIGGER_SECRET_KEY=tr_xxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

### Step 3.4: Configure trigger.dev (After Deployment)

After first deployment, register the scheduled task:
```bash
# From sietch-service directory
npx trigger.dev@latest dev
```

The `sync-eligibility` task runs every 6 hours automatically.

---

## 4. Collab.Land Setup

### Step 4.1: Invite Collab.Land Bot

1. Go to [Collab.Land](https://collab.land)
2. Click "Get Started" → "Invite to Discord"
3. Select your Sietch Discord server
4. Authorize the bot

### Step 4.2: Access Command Center

1. In your Discord server, type `/collabland-config`
2. Click the link to open Command Center
3. Log in with Discord

### Step 4.3: Configure Token Gate (Custom API)

**Note**: Custom API token gates require Collab.Land Premium subscription.

1. Navigate to "Token Gating Rules"
2. Click "Create Rule" → "Custom API"
3. Configure the rule:

**For Fedaykin (top 8-69)**:
- **Name**: Sietch Fedaykin
- **API Endpoint**: `https://sietch-api.honeyjar.xyz/eligibility/{wallet}`
- **Method**: GET
- **Success Condition**: `$.isEligible == true && $.currentTier == "fedaykin"`
- **Role to Grant**: Fedaykin

**For Naib (top 7)**:
- **Name**: Sietch Naib
- **API Endpoint**: `https://sietch-api.honeyjar.xyz/eligibility/{wallet}`
- **Method**: GET
- **Success Condition**: `$.isEligible == true && $.currentTier == "naib"`
- **Role to Grant**: Naib

4. Save and test with a known eligible wallet

**No env vars needed** - Collab.Land calls your API.

---

## 5. Berachain RPC Configuration

### Public RPC Endpoints

For initial deployment, use public endpoints:
```
BERACHAIN_RPC_URLS=https://rpc.berachain.com,https://bera-rpc.publicnode.com
```

### Production Recommendations

For production reliability, consider:

| Provider | URL | Free Tier | Notes |
|----------|-----|-----------|-------|
| Berachain Official | `https://rpc.berachain.com` | Yes | Rate limited |
| PublicNode | `https://bera-rpc.publicnode.com` | Yes | Community |
| Alchemy | Sign up at alchemy.com | 300M CU/month | Recommended |
| QuickNode | Sign up at quicknode.com | Limited | Enterprise |

**Required value for .env**:
```
BERACHAIN_RPC_URLS=https://rpc.berachain.com,https://bera-rpc.publicnode.com
```

### Contract Addresses

Get the official BGT token and reward vault addresses from Berachain documentation:
- **BGT Token**: The governance token contract address
- **Reward Vaults**: Addresses of vaults that emit BGT rewards

```
BGT_ADDRESS=0x... (get from Berachain docs)
REWARD_VAULT_ADDRESSES=0x...,0x...,0x... (comma-separated)
```

---

## 6. Admin API Keys

Generate secure API keys for admin access:

```bash
# Generate random 32-character keys
openssl rand -hex 16
openssl rand -hex 16
```

**Required value for .env**:
```
ADMIN_API_KEYS=key1_here:admin1,key2_here:admin2
```

Format: `key:name,key:name`

Store these keys in your password manager (1Password).

---

## 7. Final Checklist

### Credentials Collected

- [ ] Discord Bot Token (`DISCORD_BOT_TOKEN`)
- [ ] Discord Guild ID (`DISCORD_GUILD_ID`)
- [ ] Discord Channel IDs (`DISCORD_CHANNEL_THE_DOOR`, `DISCORD_CHANNEL_CENSUS`)
- [ ] Discord Role IDs (`DISCORD_ROLE_NAIB`, `DISCORD_ROLE_FEDAYKIN`)
- [ ] trigger.dev Project ID (`TRIGGER_PROJECT_ID`)
- [ ] trigger.dev Secret Key (`TRIGGER_SECRET_KEY`)
- [ ] Berachain RPC URLs (`BERACHAIN_RPC_URLS`)
- [ ] BGT Token Address (`BGT_ADDRESS`)
- [ ] Reward Vault Addresses (`REWARD_VAULT_ADDRESSES`)
- [ ] Admin API Keys (`ADMIN_API_KEYS`)

### External Services

- [ ] DNS A record created and propagated
- [ ] Discord bot invited to server
- [ ] Discord bot has required permissions
- [ ] Collab.Land bot invited to server
- [ ] Collab.Land Premium subscription active
- [ ] trigger.dev account created

### Secure Storage

- [ ] All credentials saved to 1Password
- [ ] Bot token NOT committed to git
- [ ] .env file NOT committed to git

---

## Complete .env Template

Copy this to `/opt/sietch/.env` on your VPS and fill in values:

```bash
# =============================================================================
# Sietch Service Environment Configuration
# =============================================================================

# Berachain RPC (comma-separated for fallback)
BERACHAIN_RPC_URLS=https://rpc.berachain.com,https://bera-rpc.publicnode.com

# Contract addresses
BGT_ADDRESS=0x_YOUR_BGT_ADDRESS
REWARD_VAULT_ADDRESSES=0x_VAULT1,0x_VAULT2

# trigger.dev
TRIGGER_PROJECT_ID=sietch-service
TRIGGER_SECRET_KEY=tr_YOUR_SECRET_KEY

# Discord
DISCORD_BOT_TOKEN=YOUR_BOT_TOKEN
DISCORD_GUILD_ID=YOUR_GUILD_ID
DISCORD_CHANNEL_THE_DOOR=YOUR_CHANNEL_ID
DISCORD_CHANNEL_CENSUS=YOUR_CHANNEL_ID
DISCORD_ROLE_NAIB=YOUR_ROLE_ID
DISCORD_ROLE_FEDAYKIN=YOUR_ROLE_ID

# API
API_PORT=3000
API_HOST=127.0.0.1
ADMIN_API_KEYS=YOUR_KEY1:admin1,YOUR_KEY2:admin2

# Database
DATABASE_PATH=/opt/sietch/data/sietch.db

# Logging
LOG_LEVEL=info

# Grace Period
GRACE_PERIOD_HOURS=24
```

---

## Ready to Deploy?

Once all items are checked off:

1. SSH to your VPS
2. Run the setup script: `sudo bash setup-vps.sh`
3. Edit `.env` with your credentials
4. Run the deploy script: `./deploy.sh main`
5. Configure Collab.Land token gates
6. Test the full flow!

See `DEPLOYMENT_RUNBOOK.md` for detailed deployment steps.

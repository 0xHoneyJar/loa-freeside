# Feature Flags Guide

**Last verified**: 2026-02-04
**Source**: `themes/sietch/.env.example`, `themes/sietch/src/config.ts`

This document explains the feature flags available in Sietch and when to enable them.

---

## Overview

Feature flags allow you to enable or disable optional functionality. All flags default to `false` (disabled) for safety.

Set flags in your `.env.local` file:

```bash
FEATURE_BILLING_ENABLED=true
FEATURE_REDIS_ENABLED=false
```

---

## Available Flags

| Flag | Default | Description |
|------|---------|-------------|
| `FEATURE_BILLING_ENABLED` | `false` | Enable Paddle billing integration |
| `FEATURE_GATEKEEPER_ENABLED` | `false` | Enable subscription-based feature gating |
| `FEATURE_REDIS_ENABLED` | `false` | Enable Redis caching layer |
| `FEATURE_TELEGRAM_ENABLED` | `false` | Enable Telegram bot integration |
| `FEATURE_VAULT_ENABLED` | `false` | Enable HashiCorp Vault secrets management |

---

## Flag Details

### FEATURE_BILLING_ENABLED

**Purpose**: Enables Paddle payment processing for subscriptions and one-time purchases.

**When to enable**:
- You want to monetize your community
- You've configured Paddle API keys and webhooks
- You're ready to accept payments

**Dependencies**:
- `PADDLE_API_KEY` must be set
- `PADDLE_WEBHOOK_SECRET` must be set
- `PADDLE_CLIENT_TOKEN` must be set
- `PADDLE_PRICE_IDS` must be configured

**Configuration required**:
```bash
FEATURE_BILLING_ENABLED=true
PADDLE_API_KEY=pdl_xxx
PADDLE_WEBHOOK_SECRET=pdl_ntfset_xxx
PADDLE_CLIENT_TOKEN=live_xxx
PADDLE_ENVIRONMENT=sandbox  # or "production"
PADDLE_PRICE_IDS=basic:pri_xxx,premium:pri_yyy
```

**Security implications**:
- Webhook endpoint exposed at `/api/billing/webhook`
- Must validate Paddle signatures (handled automatically)
- Use sandbox environment for testing

---

### FEATURE_GATEKEEPER_ENABLED

**Purpose**: Enforces subscription-based feature access. Members need active subscriptions to access premium features.

**When to enable**:
- Billing is already enabled and working
- You want to restrict features based on subscription tier
- You've defined which features require which subscription levels

**Dependencies**:
- `FEATURE_BILLING_ENABLED` must be `true`
- Subscription tiers must be configured in database

**How it works**:
1. User attempts to use a gated feature
2. Gatekeeper checks user's subscription status
3. If subscribed at required tier: access granted
4. If not subscribed: prompted to upgrade

**Gated features** (23+ features):
- Premium badge claims
- Extended analytics
- Priority support
- Custom integrations
- And more (see `src/services/gatekeeper/features.ts`)

---

### FEATURE_REDIS_ENABLED

**Purpose**: Enables Redis caching for improved performance and webhook deduplication.

**When to enable**:
- You have Redis available (local or cloud like Upstash)
- You want faster response times
- You're processing high webhook volume
- You want distributed session storage

**Dependencies**:
- `REDIS_URL` must be set

**Configuration required**:
```bash
FEATURE_REDIS_ENABLED=true
REDIS_URL=rediss://default:xxx@xxx.upstash.io:6379
REDIS_MAX_RETRIES=3
REDIS_CONNECT_TIMEOUT=5000
REDIS_ENTITLEMENT_TTL=300
```

**What gets cached**:
- Entitlement checks (5 min TTL)
- Webhook deduplication (prevents double-processing)
- Session data (optional)
- Rate limiting counters

**Without Redis**:
- System still works (graceful degradation)
- In-memory caching used instead
- Webhook deduplication limited to single instance

---

### FEATURE_TELEGRAM_ENABLED

**Purpose**: Enables Telegram bot integration for cross-platform community access.

**When to enable**:
- You want to offer Telegram as an alternative to Discord
- You've created a Telegram bot via @BotFather
- You've configured webhook URL (production) or polling (development)

**Dependencies**:
- `TELEGRAM_BOT_TOKEN` must be set
- `TELEGRAM_WEBHOOK_SECRET` must be set (production)

**Configuration required**:
```bash
FEATURE_TELEGRAM_ENABLED=true
TELEGRAM_BOT_TOKEN=1234567890:ABCdef...
TELEGRAM_WEBHOOK_SECRET=your_random_secret
# Production only:
TELEGRAM_WEBHOOK_URL=https://api.example.com/telegram/webhook
```

**Telegram commands available**:
- `/verify` - Start wallet verification
- `/position` - Check rank and tier
- `/score` - View activity score
- `/refresh` - Force eligibility refresh

---

### FEATURE_VAULT_ENABLED

**Purpose**: Enables HashiCorp Vault for production-grade secrets management.

**When to enable**:
- You're deploying to production
- You need HSM-backed signing (Transit engine)
- You want centralized secrets management
- Compliance requires secrets rotation

**Dependencies**:
- `VAULT_ADDR` must be set
- `VAULT_TOKEN` must be set (or use AppRole auth)
- Vault server must be accessible

**Configuration required**:
```bash
FEATURE_VAULT_ENABLED=true
VAULT_ADDR=https://vault.example.com
VAULT_TOKEN=hvs.xxx
VAULT_SIGNING_KEY_NAME=arrakis-signing
VAULT_REQUEST_TIMEOUT=5000
VAULT_SECRET_CACHE_TTL=3600
```

**What Vault manages**:
- API key encryption/decryption
- Signature generation (Transit)
- Dynamic secret retrieval
- Secret caching with TTL

**Without Vault**:
- Secrets read from environment variables
- Signing done with local keys
- Less secure but functional for development

---

## Dependency Matrix

| Flag | Requires |
|------|----------|
| `FEATURE_BILLING_ENABLED` | Paddle configuration |
| `FEATURE_GATEKEEPER_ENABLED` | `FEATURE_BILLING_ENABLED` |
| `FEATURE_REDIS_ENABLED` | `REDIS_URL` |
| `FEATURE_TELEGRAM_ENABLED` | Telegram bot token |
| `FEATURE_VAULT_ENABLED` | Vault server access |

---

## Recommended Configurations

### Development (Local)

```bash
FEATURE_BILLING_ENABLED=false
FEATURE_GATEKEEPER_ENABLED=false
FEATURE_REDIS_ENABLED=false
FEATURE_TELEGRAM_ENABLED=false
FEATURE_VAULT_ENABLED=false
```

### Staging

```bash
FEATURE_BILLING_ENABLED=true   # Test with Paddle sandbox
FEATURE_GATEKEEPER_ENABLED=true
FEATURE_REDIS_ENABLED=true     # If Redis available
FEATURE_TELEGRAM_ENABLED=false  # Unless testing Telegram
FEATURE_VAULT_ENABLED=false     # Unless Vault available
```

### Production

```bash
FEATURE_BILLING_ENABLED=true
FEATURE_GATEKEEPER_ENABLED=true
FEATURE_REDIS_ENABLED=true
FEATURE_TELEGRAM_ENABLED=true   # If offering Telegram
FEATURE_VAULT_ENABLED=true      # Strongly recommended
```

---

## Checking Flag Status

### Via API

```bash
curl http://localhost:3000/health
```

Response includes enabled features:
```json
{
  "status": "healthy",
  "features": {
    "billing": false,
    "gatekeeper": false,
    "redis": false,
    "telegram": false,
    "vault": false
  }
}
```

### Via Code

```typescript
import { config } from './config.js';

if (config.features.billing) {
  // Billing-specific logic
}
```

---

## Troubleshooting

### Flag enabled but feature not working

1. Check all dependencies are configured
2. Verify environment variables are loaded (restart required)
3. Check logs for configuration errors
4. Ensure dependent services are running (Redis, Vault, etc.)

### "Feature not available" error

1. The feature requires a flag that's disabled
2. Enable the appropriate flag in `.env.local`
3. Restart the application

### Performance issues without Redis

Redis provides significant performance benefits. Without it:
- Expect higher latency on repeated requests
- Webhook deduplication limited to single instance
- Consider enabling if experiencing slowness

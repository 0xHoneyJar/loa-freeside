# Environment Configuration

> Generated: 2026-02-13 | Git SHA: 39be5b7

Validation: `themes/sietch/src/config.ts` (1,737 lines, Zod schema)

## Required Variables

| Variable | Service | Description |
|----------|---------|-------------|
| DISCORD_BOT_TOKEN | Sietch | Discord bot token |
| DISCORD_GUILD_ID | Sietch | Discord server ID |
| DISCORD_CHANNEL_THE_DOOR | Sietch | Main member channel |
| DISCORD_CHANNEL_CENSUS | Sietch | Census/stats channel |
| DISCORD_ROLE_NAIB | Sietch | Naib rank role ID |
| DISCORD_ROLE_FEDAYKIN | Sietch | Fedaykin rank role ID |
| BERACHAIN_RPC_URLS | Sietch | Comma-separated RPC URLs |
| BGT_ADDRESS | Sietch | BGT token contract address |
| TRIGGER_PROJECT_ID | Sietch | Trigger.dev project ID |
| TRIGGER_SECRET_KEY | Sietch | Trigger.dev secret |
| DATABASE_URL | Sietch (prod) | PostgreSQL connection URL |
| DISCORD_TOKEN | Gateway | Gateway bot token |

## Required (Conditional)

| Variable | Condition | Description |
|----------|-----------|-------------|
| API_KEY_PEPPER | Production | HMAC pepper (min 32 chars) |
| PADDLE_WEBHOOK_SECRET | Billing enabled | Webhook signature verification |
| NOWPAYMENTS_API_KEY | Crypto enabled | NOWPayments API key |
| NOWPAYMENTS_IPN_SECRET | Crypto enabled | Webhook HMAC secret |
| VAULT_ADDR | Vault enabled | Vault server address |
| VAULT_TOKEN | Vault enabled | Vault auth token |
| VERIFY_BASE_URL | Verification enabled | Wallet verification URL |

## Feature Flags

| Variable | Default | Description |
|----------|---------|-------------|
| FEATURE_BILLING_ENABLED | false | Paddle billing |
| FEATURE_GATEKEEPER_ENABLED | false | Subscription feature access |
| FEATURE_REDIS_ENABLED | false | Redis caching |
| FEATURE_TELEGRAM_ENABLED | false | Telegram bot |
| FEATURE_VAULT_ENABLED | false | Vault secrets management |
| FEATURE_CRYPTO_PAYMENTS_ENABLED | false | NOWPayments |
| USE_GATEWAY_PROXY | false | Gateway proxy pattern |

## Chain Provider

| Variable | Default | Description |
|----------|---------|-------------|
| CHAIN_PROVIDER | rpc | Mode: rpc, dune_sim, hybrid |
| DUNE_SIM_API_KEY | — | Dune Sim API key |
| CHAIN_PROVIDER_FALLBACK_ENABLED | true | RPC fallback in hybrid |
| CHAIN_PROVIDER_RPC_ONLY_CHAINS | — | Comma-separated chain IDs |

## Optional (Grouped)

**Discord Channels:** DISCORD_CHANNEL_{SIETCH_LOUNGE, NAIB_COUNCIL, INTRODUCTIONS, CAVE_ENTRANCE, OASIS, ANNOUNCEMENTS, DEEP_DESERT, STILLSUIT_LOUNGE}

**Discord Tier Roles:** DISCORD_ROLE_{HAJRA, ICHWAN, QANAT, SIHAYA, MUSHTAMAL, SAYYADINA, USUL} (Tiers 0-6)

**Discord Badge Roles:** DISCORD_ROLE_{WATER_SHARER, ENGAGED, VETERAN, FORMER_NAIB, TAQWA}

**Telegram:** TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET, TELEGRAM_WEBHOOK_URL

**Redis:** REDIS_URL, REDIS_MAX_RETRIES, REDIS_CONNECT_TIMEOUT, REDIS_ENTITLEMENT_TTL

**Logging:** LOG_LEVEL (default: info)

**Gateway:** POOL_ID, TOTAL_SHARDS, NATS_URL, HTTP_PORT

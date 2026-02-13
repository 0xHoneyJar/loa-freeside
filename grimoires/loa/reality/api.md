# API Surface

> Generated: 2026-02-13 | Git SHA: 39be5b7

## HTTP Services

### 1. Sietch API (Express, themes/sietch/src/api/)

**Public:**
- `GET /eligibility` — Top 69 eligible wallets with BGT holdings
- `GET /eligibility/:address` — Check eligibility for specific address
- `GET /health` — Health check
- `GET /metrics` — Prometheus metrics

**Member Profiles:**
- `GET /profile/:memberId` — View member profile
- `GET /members` — List members
- `GET /position/:memberId` — Leaderboard position
- `GET /positions` — All positions

**Verification:**
- `POST /verify/start` — Initiate wallet verification
- `POST /verify/complete` — Complete EIP-191 signature verification
- `GET /verify/status/:discordUserId` — Verification status
- `GET /verify/eligibility/:address` — Post-verification eligibility

**Authentication:**
- `POST /api/auth/login` — Username/password auth
- `POST /api/auth/logout` — Logout
- `GET /api/auth/whoami` — Current user
- `POST /api/auth/refresh` — Token refresh

**Billing (Paddle):**
- `POST /checkout` — Create checkout session
- `POST /portal` — Customer portal
- `GET /subscription` — Subscription status
- `GET /entitlements` — Feature entitlements (cached)
- `POST /webhook` — Paddle webhook (signature verified)

**Crypto Billing (NOWPayments):**
- `POST /api/billing/crypto/webhook` — NOWPayments IPN webhook

**Badges:**
- `GET /badge/entitlement/:memberId` — Badge access check
- `POST /badge/purchase` — Badge purchase via Paddle
- `GET /badge/display/:platform/:memberId` — Badge display string

**Notifications:**
- `POST /notifications/subscribe` — Subscribe
- `GET /notifications` — List notifications
- `PUT /notifications/:notificationId` — Update
- `DELETE /notifications/:notificationId` — Delete

**Admin:**
- `GET /admin/users` — List users
- `POST /admin/users` — Create user
- `POST /admin/api-keys/rotate` — Rotate API keys
- `POST /admin/eligibility/sync` — Force sync
- `GET /admin/stats` — System statistics
- `GET /admin/audit-logs` — Audit trail

**Telegram:**
- `POST /telegram/webhook` — Telegram bot webhook
- `POST /telegram/verify/callback` — Collab.Land callback

**Internal (Hounfour/Agent):**
- `POST /internal/agent/usage/report` — Agent usage ingestion
- `GET /internal/agent/.well-known/jwks.json` — JWKS endpoint
- `POST /internal/eligibility/sync` — Trigger.dev sync proxy

### 2. Gateway (Rust/Axum, apps/gateway/)

- `GET /health` — Health check
- `GET /ready` — Readiness (requires shard ready)
- `GET /metrics` — Prometheus metrics

### 3. Ingestor (Node.js, apps/ingestor/)

- Discord event ingestion → RabbitMQ

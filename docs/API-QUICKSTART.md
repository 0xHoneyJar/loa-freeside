# API Quick Start — First Agent Call in 5 Minutes

<!-- cite: loa-freeside:themes/sietch/src/api/routes/agents.routes.ts -->
<!-- cite: loa-freeside:docs/api/stable-endpoints.json -->

This guide walks you through making your first agent invocation against a local Freeside instance.

## Prerequisites

- Node.js >= 22
- pnpm installed
- Docker (for PostgreSQL + Redis)
- `jq` for JSON formatting (optional)

## 1. Start the Platform

```bash
git clone https://github.com/0xHoneyJar/loa-freeside.git
cd loa-freeside
pnpm install

# Set up environment
cp .env.example .env
# Fill required values: DATABASE_URL, REDIS_URL, JWT_SECRET, DISCORD_BOT_TOKEN, DISCORD_GUILD_ID

# Start backing services
docker-compose up -d  # PostgreSQL + Redis

# Run database migrations
cd themes/sietch && npx drizzle-kit push && cd ../..

# Start the server
pnpm run dev
```

Verify the server is running:
```bash
curl -s http://localhost:3000/api/agents/health | jq .
# Expected: {"status":"ok", ...}
```

## 2. Get a JWT Token

### Option A: gaib CLI (Recommended)

```bash
# Set up dev authentication
gaib auth setup-dev

# Get a token
export JWT=$(gaib auth token --dev)
echo $JWT
```

### Option B: Manual JWT (openssl)

```bash
# Generate a dev signing key matching your JWT_SECRET
# This creates a token valid for 1 hour
JWT_SECRET="your-jwt-secret-from-env"
HEADER=$(echo -n '{"alg":"HS256","typ":"JWT"}' | base64 -w0 | tr '+/' '-_' | tr -d '=')
PAYLOAD=$(echo -n "{\"sub\":\"dev-user\",\"aud\":\"freeside\",\"iss\":\"freeside-dev\",\"exp\":$(( $(date +%s) + 3600 ))}" | base64 -w0 | tr '+/' '-_' | tr -d '=')
SIGNATURE=$(echo -n "${HEADER}.${PAYLOAD}" | openssl dgst -sha256 -hmac "$JWT_SECRET" -binary | base64 -w0 | tr '+/' '-_' | tr -d '=')
export JWT="${HEADER}.${PAYLOAD}.${SIGNATURE}"
```

## 3. The 7 Stable Endpoints

These endpoints are guaranteed stable with a 2-cycle deprecation policy. See [API-REFERENCE.md](API-REFERENCE.md) for the full reference.

### Health Check (no auth)

```bash
curl -s http://localhost:3000/api/agents/health | jq .
```

### JWKS (no auth)

```bash
curl -s http://localhost:3000/.well-known/jwks.json | jq .
```

### List Available Models

```bash
curl -s http://localhost:3000/api/agents/models \
  -H "Authorization: Bearer $JWT" | jq .
```

### Check Budget

```bash
curl -s http://localhost:3000/api/agents/budget \
  -H "Authorization: Bearer $JWT" | jq .
```

### Invoke Agent

```bash
curl -s http://localhost:3000/api/agents/invoke \
  -X POST \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Hello, what can you help me with?",
    "pool": "cheap"
  }' | jq .
```

### Stream Agent Response (SSE)

```bash
curl -N http://localhost:3000/api/agents/stream \
  -X POST \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Explain budget atomicity in one paragraph.",
    "pool": "cheap"
  }'
```

### Wallet Verification (no auth)

```bash
# Start verification session
curl -s http://localhost:3000/api/verify/SESSION_ID \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{
    "signature": "0x...",
    "message": "Sign this message to verify ownership"
  }' | jq .
```

## 4. Smoke-Test Checklist

Run these commands in order to verify your local deployment:

```bash
# 1. Health check (expect 200)
curl -sf http://localhost:3000/api/agents/health > /dev/null && echo "PASS: health" || echo "FAIL: health"

# 2. JWKS endpoint (expect 200)
curl -sf http://localhost:3000/.well-known/jwks.json > /dev/null && echo "PASS: jwks" || echo "FAIL: jwks"

# 3. Models list (expect 200 with JWT)
curl -sf http://localhost:3000/api/agents/models -H "Authorization: Bearer $JWT" > /dev/null && echo "PASS: models" || echo "FAIL: models"

# 4. Budget check (expect 200 with JWT)
curl -sf http://localhost:3000/api/agents/budget -H "Authorization: Bearer $JWT" > /dev/null && echo "PASS: budget" || echo "FAIL: budget"

# 5. Invoke (expect 200 with JWT, AGENT_ENABLED=true required)
curl -sf http://localhost:3000/api/agents/invoke \
  -X POST -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d '{"prompt":"test","pool":"cheap"}' > /dev/null && echo "PASS: invoke" || echo "FAIL: invoke"

# 6. Unauthenticated access (expect 401)
STATUS=$(curl -so /dev/null -w '%{http_code}' http://localhost:3000/api/agents/models)
[[ "$STATUS" == "401" ]] && echo "PASS: auth-required ($STATUS)" || echo "FAIL: auth-required ($STATUS)"
```

## Security Notes

- Never share your JWT token or JWT_SECRET
- Use separate JWKS keys for dev and production
- Set appropriate token TTL (1 hour for dev, shorter for production)
- Validate `aud` and `iss` claims in production
- `AUTH_BYPASS` is only available in development/test environments (server refuses to start with it in production)

## Stability Contract

The 7 endpoints listed above are **Tier 1 Stable**:
- **Compatibility:** Breaking changes follow a 2-cycle deprecation policy
- **Versioning:** Changes documented in [API-CHANGELOG.md](API-CHANGELOG.md)
- **Promotion:** Unstable endpoints can be promoted after 2+ stable cycles with full documentation

All other endpoints are **Tier 2 Unstable** and may change without notice. See [API-REFERENCE.md](API-REFERENCE.md) for the full route index.

## Next Steps

- [API-REFERENCE.md](API-REFERENCE.md) — Full API reference with Tier 1 and Tier 2 routes
- [CLI.md](CLI.md) — gaib CLI reference for sandbox and server management
- [INFRASTRUCTURE.md](INFRASTRUCTURE.md) — Deployment topology and Terraform modules

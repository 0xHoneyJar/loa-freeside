# API Reference

<!-- cite: loa-freeside:docs/api/stable-endpoints.json -->
<!-- cite: loa-freeside:scripts/route-snapshot.json -->
<!-- cite: loa-freeside:themes/sietch/src/api/routes/agents.routes.ts -->
<!-- cite: loa-freeside:themes/sietch/src/api/routes/verify.routes.ts -->
<!-- cite: loa-freeside:packages/adapters/agent/config.ts#L298-L312 -->
<!-- cite: loa-freeside:packages/core/ports/agent-gateway.ts#L23-L24 -->

This document covers every HTTP endpoint exposed by loa-freeside.
Endpoints are divided into two stability tiers:

| Tier | Guarantee | Breaking-change policy |
|------|-----------|------------------------|
| **Tier 1 — Stable** | Backwards-compatible | 2-cycle deprecation notice |
| **Tier 2 — Unstable** | Best-effort | May change without notice |

For a quick-start walkthrough, see [API-QUICKSTART.md](API-QUICKSTART.md).

---

## Tier 1 — Stable Endpoints

These 7 endpoints are guaranteed stable. Breaking changes follow a 2-cycle deprecation policy documented in [API-CHANGELOG.md](API-CHANGELOG.md).

### 1. Health Check

<!-- cite: loa-freeside:themes/sietch/src/api/routes/agents.routes.ts#L193 -->

| Property | Value |
|----------|-------|
| Method | `GET` |
| Path | `/api/agents/health` |
| Auth | None |
| Rate Limit | Default IP-based |

**Response 200:**

```json
{
  "status": "ok",
  "finn": { "reachable": true, "latencyMs": 42 },
  "redis": { "reachable": true }
}
```

**Response 503:**

```json
{ "error": "HEALTH_CHECK_FAILED" }
```

Requires `AGENT_ENABLED=true`. Returns 503 if the agent gateway is disabled via kill-switch.

---

### 2. JWKS

<!-- cite: loa-freeside:themes/sietch/src/api/routes/agents.routes.ts#L142 -->

| Property | Value |
|----------|-------|
| Method | `GET` |
| Path | `/.well-known/jwks.json` |
| Auth | None |

**Response 200:**

```json
{
  "keys": [
    {
      "kty": "RSA",
      "n": "...",
      "e": "AQAB",
      "alg": "RS256",
      "use": "sig",
      "kid": "freeside-jwks-1"
    }
  ]
}
```

Returns the JSON Web Key Set used by loa-finn and external consumers to verify JWTs issued by Freeside. Private key fields (`d`, `p`, `q`, `dp`, `dq`, `qi`) are stripped from the response.

---

### 3. Invoke Agent

<!-- cite: loa-freeside:themes/sietch/src/api/routes/agents.routes.ts#L211 -->
<!-- cite: loa-freeside:packages/adapters/agent/config.ts#L298-L312 -->

| Property | Value |
|----------|-------|
| Method | `POST` |
| Path | `/api/agents/invoke` |
| Auth | Bearer JWT |
| Content-Type | `application/json` |
| Body Limit | 1 MB |

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `agent` | string | Yes | Agent identifier (1–256 chars) |
| `messages` | array | Yes | Conversation messages (1–50) |
| `messages[].role` | enum | Yes | `"user"`, `"assistant"`, or `"system"` |
| `messages[].content` | string | Yes | Message content (1–100,000 chars) |
| `modelAlias` | string | No | Model routing alias (see below) |
| `tools` | string[] | No | Tool identifiers (max 20) |
| `metadata` | object | No | Arbitrary key-value metadata |
| `idempotencyKey` | string | No | Client idempotency key (ASCII, max 256 chars) |
| `ensemble` | object | No | Multi-model orchestration (see Ensemble) |

**Model Aliases:**

| Alias | Description |
|-------|-------------|
| `cheap` | Lowest-cost model for simple tasks |
| `fast-code` | Optimized for code generation |
| `reviewer` | Tuned for code review and analysis |
| `reasoning` | Strongest reasoning capability |
| `native` | Native model (provider default) |

**Ensemble Object (optional):**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `strategy` | enum | Yes | `"best_of_n"`, `"consensus"`, or `"fallback"` |
| `models` | string[] | No | Model aliases to include (max 5) |

**Response Headers:**

| Header | Description |
|--------|-------------|
| `X-Idempotency-Key` | Echoed or server-generated idempotency key |

**Response 200:**

```json
{
  "response": "Hello! I can help with...",
  "model": "cheap",
  "usage": {
    "promptTokens": 150,
    "completionTokens": 42,
    "totalTokens": 192
  }
}
```

**Error Responses:**

| Status | Error Code | Description |
|--------|-----------|-------------|
| 400 | `INVALID_REQUEST` | Request body validation failed |
| 401 | `UNAUTHORIZED` | Missing or invalid JWT |
| 402 | `BUDGET_EXHAUSTED` | Community budget depleted |
| 429 | `RATE_LIMITED` | Too many requests |
| 503 | `PROVIDER_UNAVAILABLE` | Upstream model provider unreachable |

---

### 4. Stream Agent (SSE)

<!-- cite: loa-freeside:themes/sietch/src/api/routes/agents.routes.ts#L243 -->

| Property | Value |
|----------|-------|
| Method | `POST` |
| Path | `/api/agents/stream` |
| Auth | Bearer JWT |
| Content-Type | `application/json` |
| Response | `text/event-stream` |

Accepts the same request body as `/api/agents/invoke`. Returns a Server-Sent Events stream.

**SSE Events:**

```
id: 1
event: token
data: {"text":"Hello"}

id: 2
event: token
data: {"text":" world"}

id: 3
event: done
data: {"usage":{"promptTokens":150,"completionTokens":42}}
```

**SSE Features:**

- **Keepalive**: `: keepalive\n\n` comment every 15 seconds
- **Resume**: Send `Last-Event-ID` header to resume from a specific event
- **Abort**: Client disconnect terminates the stream server-side
- **Cross-server detection**: Composite event IDs detect server switches (defers to STREAM_RESUME_LOST FSM)

**Response Headers:**

| Header | Description |
|--------|-------------|
| `X-Idempotency-Key` | Echoed or server-generated idempotency key |
| `Cache-Control` | `no-cache` |
| `Connection` | `keep-alive` |

---

### 5. List Models

<!-- cite: loa-freeside:themes/sietch/src/api/routes/agents.routes.ts#L336 -->

| Property | Value |
|----------|-------|
| Method | `GET` |
| Path | `/api/agents/models` |
| Auth | Bearer JWT |

**Response 200:**

```json
{
  "models": ["cheap", "fast-code", "reviewer", "reasoning", "native"]
}
```

Returns the model aliases available for the authenticated user's access tier. Different tiers may see different subsets.

---

### 6. Check Budget

<!-- cite: loa-freeside:themes/sietch/src/api/routes/agents.routes.ts#L346 -->

| Property | Value |
|----------|-------|
| Method | `GET` |
| Path | `/api/agents/budget` |
| Auth | Bearer JWT (admin role required) |

**Response 200:**

```json
{
  "communityId": "guild-123",
  "remaining": 50000,
  "limit": 100000,
  "resetAt": "2026-03-01T00:00:00Z"
}
```

**Response 403:**

```json
{ "error": "FORBIDDEN", "message": "Admin access required" }
```

Requires `admin` or `qa_admin` role. Returns budget counters from Redis for the authenticated user's community.

---

### 7. Wallet Verification

<!-- cite: loa-freeside:themes/sietch/src/api/routes/verify.routes.ts#L417 -->

| Property | Value |
|----------|-------|
| Method | `POST` |
| Path | `/api/verify/:sessionId` |
| Auth | None |
| Rate Limit | Per-IP + per-session |

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `sessionId` | string | Verification session identifier |

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `signature` | string | Yes | Wallet signature |
| `walletAddress` | string | Yes | Wallet address |

**Response 200 (success):**

```json
{
  "success": true,
  "walletAddress": "0x...",
  "sessionStatus": "verified"
}
```

**Response 400 (failure):**

```json
{
  "success": false,
  "error": "Verification failed. Please check your wallet and try again.",
  "sessionStatus": "pending"
}
```

**Security:**

- CSRF protection via origin validation
- Constant-time responses (prevents timing attacks)
- IP addresses hashed for privacy-compliant logging
- Generic error messages externally (detailed logging internally)
- Session rate limiting prevents brute-force attempts

---

## Tier 2 — Unstable Route Index

These routes are auto-extracted from source code by `scripts/extract-routes.sh`.
They may change without notice. Do not build external integrations against Tier 2 routes.

<!-- cite: loa-freeside:scripts/extract-routes.sh -->

> **Coverage note:** Route extraction uses grep-based pattern matching on Express `router.METHOD()` calls in `themes/sietch/src/api/routes/*.ts`. This static analysis has known coverage boundaries:
> - **Captured**: Direct `router.get()`, `router.post()`, etc. calls with string literal paths
> - **Not captured**: Middleware-mounted routes, dynamically computed paths, routes registered at runtime via conditional logic, and Rust gateway proxy routes (`apps/gateway/`)
>
> If you register routes outside the standard pattern, they will not appear in this index. The Tier 1 section above is manually curated and always authoritative.

**Promotion criteria**: A Tier 2 route can be promoted to Tier 1 after:
1. Stable for 2+ development cycles without breaking changes
2. Covered by smoke-test checklist
3. Full request/response documentation added to this file

### Agent Identity

<!-- cite: loa-freeside:themes/sietch/src/api/routes/agent-identity.routes.ts -->

| Method | Path | Auth | Source |
|--------|------|------|--------|
| POST | `/register` | No | agent-identity.routes.ts:37 |
| GET | `/:id/provenance` | No | agent-identity.routes.ts:82 |
| GET | `/:id/identity` | No | agent-identity.routes.ts:99 |

### Agent Gateway (internal)

<!-- cite: loa-freeside:themes/sietch/src/api/routes/agents.routes.ts#L399 -->

| Method | Path | Auth | Source |
|--------|------|------|--------|
| POST | `/usage-reports` | No* | agents.routes.ts:399 |

\* Uses S2S (server-to-server) JWT authentication, not user JWT.

### Authentication

<!-- cite: loa-freeside:themes/sietch/src/api/routes/auth.routes.ts -->

| Method | Path | Auth | Source |
|--------|------|------|--------|
| POST | `/login` | Yes | auth.routes.ts:101 |
| POST | `/logout` | No | auth.routes.ts:160 |
| GET | `/me` | No | auth.routes.ts:190 |
| POST | `/refresh` | No | auth.routes.ts:236 |
| GET | `/sessions` | No | auth.routes.ts:276 |
| DELETE | `/sessions/:sessionId` | No | auth.routes.ts:329 |
| GET | `/verify` | Yes | auth.routes.ts:475 |

### Coexistence (Migration)

<!-- cite: loa-freeside:themes/sietch/src/api/routes/coexistence.routes.ts -->

| Method | Path | Auth | Source |
|--------|------|------|--------|
| GET | `/:guildId/status` | Yes | coexistence.routes.ts:126 |
| POST | `/:guildId/mode` | Yes | coexistence.routes.ts:219 |
| POST | `/:guildId/rollback` | Yes | coexistence.routes.ts:315 |
| GET | `/:guildId/shadow/divergences` | Yes | coexistence.routes.ts:384 |
| POST | `/:guildId/emergency-backup` | Yes | coexistence.routes.ts:455 |

### Dashboard Auth

<!-- cite: loa-freeside:themes/sietch/src/api/routes/dashboard/auth.routes.ts -->

| Method | Path | Auth | Source |
|--------|------|------|--------|
| GET | `/discord` | No | dashboard/auth.routes.ts:456 |
| GET | `/callback` | No | dashboard/auth.routes.ts:507 |
| POST | `/login` | No | dashboard/auth.routes.ts:636 |
| POST | `/logout` | No | dashboard/auth.routes.ts:734 |
| GET | `/me` | No | dashboard/auth.routes.ts:792 |
| POST | `/refresh` | No | dashboard/auth.routes.ts:860 |
| POST | `/change-password` | No | dashboard/auth.routes.ts:951 |

### Reconciliation Admin

<!-- cite: loa-freeside:themes/sietch/src/api/routes/reconciliation-admin.routes.ts -->

| Method | Path | Auth | Source |
|--------|------|------|--------|
| POST | `/run` | No | reconciliation-admin.routes.ts:34 |
| GET | `/history` | No | reconciliation-admin.routes.ts:47 |

### Score Rewards

<!-- cite: loa-freeside:themes/sietch/src/api/routes/score-rewards.routes.ts -->

| Method | Path | Auth | Source |
|--------|------|------|--------|
| GET | `/rewards` | No | score-rewards.routes.ts:38 |

### User Management

<!-- cite: loa-freeside:themes/sietch/src/api/routes/users.routes.ts -->

| Method | Path | Auth | Source |
|--------|------|------|--------|
| GET | `/` | Yes | users.routes.ts:127 |
| POST | `/` | Yes | users.routes.ts:169 |
| GET | `/:id` | Yes | users.routes.ts:217 |
| PATCH | `/:id` | Yes | users.routes.ts:256 |
| POST | `/:id/disable` | Yes | users.routes.ts:312 |
| POST | `/:id/enable` | Yes | users.routes.ts:357 |
| DELETE | `/:id` | Yes | users.routes.ts:402 |
| POST | `/:id/reset-password` | Yes | users.routes.ts:447 |
| POST | `/:id/sandbox-access` | Yes | users.routes.ts:493 |
| DELETE | `/:id/sandbox-access/:sandboxId` | Yes | users.routes.ts:548 |
| GET | `/:id/sandbox-access` | Yes | users.routes.ts:603 |

### Wallet Verification (additional)

<!-- cite: loa-freeside:themes/sietch/src/api/routes/verify.routes.ts -->

| Method | Path | Auth | Source |
|--------|------|------|--------|
| GET | `/api/verify/:sessionId` | No | verify.routes.ts:322 |
| GET | `/api/verify/:sessionId/status` | No | verify.routes.ts:529 |

---

## Route Statistics

| Metric | Value |
|--------|-------|
| **Tier 1 endpoints** | 7 |
| **Tier 2 endpoints** | 39 |
| **Total** | 46 |
| **Authenticated** | 22 |
| **Public** | 24 |

Route count extracted via `scripts/extract-routes.sh --count`. Run `scripts/extract-routes.sh --diff` to detect route drift against the snapshot.

---

## Authentication

All authenticated endpoints expect a JWT in the `Authorization` header:

```
Authorization: Bearer <jwt>
```

JWTs are verified against the JWKS keys served at `/.well-known/jwks.json`. Required claims:

| Claim | Description |
|-------|-------------|
| `sub` | User or agent identifier |
| `aud` | Must be `"freeside"` |
| `iss` | Must be `"freeside-dev"` (dev) or configured issuer (production) |
| `exp` | Expiry timestamp |

See [API-QUICKSTART.md](API-QUICKSTART.md) for token generation examples.

---

## Changelog

See [API-CHANGELOG.md](API-CHANGELOG.md) for a record of all Tier 1 endpoint changes.

## Next Steps

- [INFRASTRUCTURE.md](INFRASTRUCTURE.md) — Deployment topology and monitoring
- [CLI.md](CLI.md) — gaib CLI for sandbox and server management
- [DEVELOPER-GUIDE.md](DEVELOPER-GUIDE.md) — Full learning path and document ownership

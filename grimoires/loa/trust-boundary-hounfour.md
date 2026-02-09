# Trust Boundary Document — Hounfour Phase 4 (Spice Gate)

**Version**: 1.1.0
**Date**: February 9, 2026
**PRD**: v1.2.0 | **SDD**: v1.4.0
**Scope**: Arrakis ↔ loa-finn distribution layer

---

## 1. Trust Boundary Diagram

```
┌──────────────┐         ┌──────────────────────┐         ┌──────────────┐         ┌──────────────┐
│              │  OAuth2  │                      │  JWT    │              │  API    │              │
│  User        │────────→│  Arrakis             │────────→│  loa-finn    │────────→│  Provider    │
│  (Discord/   │  Auth   │  (Gateway)           │  ES256  │  (Hounfour)  │  Keys   │  (OpenAI/    │
│   Telegram)  │         │                      │         │              │         │   Anthropic) │
│              │←────────│                      │←────────│              │←────────│              │
│              │  SSE/   │                      │  SSE/   │              │  SSE/   │              │
│              │  JSON   │                      │  JSON   │              │  JSON   │              │
└──────────────┘         └──────────────────────┘         └──────────────┘         └──────────────┘
       ▲                         ▲                               ▲
       │                         │                               │
  BOUNDARY 1              BOUNDARY 2                      BOUNDARY 3
  User → Arrakis         Arrakis → loa-finn              loa-finn → Provider
  (this document)        (this document)                 (loa-finn responsibility)
```

---

## 2. Trust Boundary 1: User → Arrakis

### 2.1 Assertions

| Assertion | Mechanism | Failure Mode |
|-----------|-----------|-------------|
| User is authenticated | Discord OAuth2 / Telegram auth via existing Arrakis session | 401 Unauthorized |
| User's wallet is verified | Signature proof (existing conviction scoring) | 401 Unauthorized |
| User's tier is computed server-side | On-chain conviction scoring service, cached 60s | Deny access (fail-closed to lowest tier) |
| Rate limits enforced | Multi-dimensional Redis Lua (community/user/channel/burst) + pre-auth IP limiter | 429 Too Many Requests |
| Budget checked and reserved | Atomic Redis Lua reservation (committed + reserved ≤ limit) | 402 Budget Exhausted |
| Model alias validated | `TierAccessMapper.validateModelRequest()` before forwarding | 403 Model Unavailable |
| Request context built server-side | `buildAgentRequestContext()` — tier, tenantId, userId from session, NOT from client | N/A (client cannot influence) |

### 2.2 Attack Vectors

| Attack Vector | Threat | Mitigation | Status |
|---------------|--------|------------|--------|
| **Tier spoofing** | Client sends fake tier in headers/body to escalate access | Tier resolved server-side from conviction scoring; integration test verifies client input is ignored | Mitigated (S4-T6) |
| **Rate limit bypass** | Distributed IPs flood requests | Pre-auth IP rate limiter (100/min per IP, in-memory, **best-effort per-replica only** — not global across replicas) + Redis multi-dimensional sliding window (global, authoritative). **Note**: in-memory pre-auth is first-line volumetric defense only; Redis-based limits apply before any expensive work (session lookup, budget reservation, SSE setup). For production hardening, consider edge-level rate limiting via CloudFront/WAF/ALB | Mitigated (S2-T1, S2-T3) |
| **Budget bypass** | Concurrent requests exceed budget before reservation | Atomic Lua check-and-reserve in single EVALSHA; $0.50/community/month tolerance | Mitigated (S3-T1) |
| **Unauthenticated access** | Direct API calls without session | `requireAgentAuth()` middleware on all agent endpoints; global kill switch | Mitigated (S4-T6) |
| **Cross-community access** | User accesses another community's agent budget | `tenantId` derived from community session (server-side); all Redis keys scoped to communityId | Mitigated (S4-T6) |
| **Budget probing** | User queries budget endpoint for other communities | Admin-only authorization check on `/api/agents/budget` | Mitigated (S4-T3) |
| **Idempotency key collision** | Attacker reuses another user's idempotency key | idempotencyKey scoped to `communityId:userId:key` in reservation hash; no cross-user conflict | Mitigated (§8.2) |

---

## 3. Trust Boundary 2: Arrakis → loa-finn

### 3.1 Assertions

| Assertion | Mechanism | Failure Mode |
|-----------|-----------|-------------|
| JWT signed by Arrakis | ES256 (ECDSA P-256), verified via JWKS | 401 JWT verification failed |
| JWT contains tier + access_level | Claims in signed token; loa-finn recomputes auth | 403 if recomputed set is stricter |
| jti is unique (replay protection) | loa-finn: `SETNX agent:jti:{env}:{iss}:{tenant_id}:{jti}` with TTL | 409 Conflict (duplicate jti) |
| idempotency_key enables safe retries | New JWT (new jti) but same idempotency_key on retry | Cached response returned |
| Token is short-lived | 120s expiry; ±30s clock skew tolerance | 401 Token expired |

### 3.2 JWT Claims Specification

```json
{
  "iss": "arrakis",
  "sub": "<user_wallet_address>",
  "aud": "loa-finn",
  "exp": "<iat + 120>",
  "iat": "<unix_timestamp>",
  "jti": "<uuid_v4>",

  "tenant_id": "<community_id>",
  "nft_id": "<nft_token_id | null>",
  "tier": 5,
  "tier_name": "Sayyadina",
  "access_level": "pro",
  "allowed_model_aliases": ["cheap", "fast-code", "reviewer"],
  "platform": "discord",
  "channel_id": "<source_channel>",
  "idempotency_key": "<caller_generated>",
  "req_hash": "<base64url(SHA-256(canonical_request_body))>"
}
```

| Claim | Type | Validation Rule (loa-finn) |
|-------|------|---------------------------|
| Header `alg` | string | MUST equal `"ES256"` — reject `none`, HMAC, and all other algorithms (algorithm pinning) |
| Header `kid` | string | MUST be present and non-empty; used for JWKS key lookup |
| Header `typ` | string | SHOULD equal `"JWT"` (recommended but not strictly required) |
| `iss` | string | MUST equal `"arrakis"` |
| `sub` | string | MUST be non-empty (wallet address) |
| `aud` | string | MUST equal `"loa-finn"` |
| `exp` | number | MUST be > `now - 30s` (±30s clock skew) |
| `iat` | number | MUST be within `[now - 30s, now + 30s]` |
| `jti` | string (UUIDv4) | MUST be validated as UUIDv4 format (36 chars, hex+dashes) before use in Redis key; MUST pass `SETNX` dedup; reject if duplicate |
| `tenant_id` | string | MUST be non-empty; used for multi-tenant isolation |
| `nft_id` | string \| null | Optional; logged for analytics |
| `tier` | number (1-9) | MUST be in range [1, 9]; used for recomputation |
| `tier_name` | string | Informational only; NOT used for authorization |
| `access_level` | `"free"` \| `"pro"` \| `"enterprise"` | Used for model access recomputation (FR-2.6) |
| `allowed_model_aliases` | string[] | Optimization hint ONLY; loa-finn recomputes from `access_level` |
| `platform` | `"discord"` \| `"telegram"` | Informational; logged for analytics |
| `channel_id` | string | Informational; logged for analytics |
| `idempotency_key` | string | Used for response caching and deduplication |
| `req_hash` | string (base64url) | `base64url(SHA-256(canonical_request_body))` — binds JWT to specific request payload. loa-finn MUST verify hash matches received payload before processing/caching. Prevents payload swapping within token validity window |

### 3.3 Attack Vectors

| Attack Vector | Threat | Mitigation | Status |
|---------------|--------|------------|--------|
| **JWT forgery** | Attacker crafts JWT with elevated claims | ES256 cryptographic signature; loa-finn verifies via JWKS | Mitigated |
| **JWT replay** | Stolen JWT reused within validity window | jti deduplication: `SETNX agent:jti:{env}:{iss}:{tenant_id}:{jti}` with TTL = `exp - now + 30s` | Mitigated (§7.2.1) |
| **Confused deputy** | Compromised Arrakis mints JWT with broader `allowed_model_aliases` | loa-finn MUST recompute from `access_level` claim, NOT trust `allowed_model_aliases` (FR-2.6). Logs `POLICY_DRIFT` if they diverge | Mitigated (§6.3.2) |
| **Key compromise** | Signing key leaked | Monthly rotation, 48h overlap, AWS Secrets Manager with KMS encryption, alarm on anomalous signing patterns | Mitigated (§7.1) |
| **Clock skew exploitation** | Attacker uses time drift to extend token validity | ±30s tolerance on `iat`; 120s max token life; jti dedup prevents reuse regardless of clock | Mitigated |
| **JWKS poisoning** | Attacker intercepts JWKS endpoint to inject rogue key | Hard-pinned JWKS URI in loa-finn config (internal service discovery name, not public internet); JWKS JWK entries MUST have `kty=EC`, `crv=P-256`, `use=sig` — reject all others; prefer mTLS between Arrakis↔loa-finn for all calls including JWKS fetch | Mitigated |
| **Thundering herd on JWKS** | Flood of unknown `kid` triggers JWKS fetch storm | loa-finn: singleflight/mutex; max 1 fetch per 30s; negative cache unknown `kid` for 30s | Mitigated (§7.2.2) |
| **Persona injection** | Custom persona content contains prompt injection | loa-finn responsibility: injection detection before system prompt. Cross-repo requirement documented here | loa-finn owned |

---

## 4. Key Rotation Timeline

```
Day 0:  Generate new EC P-256 key pair
        Store as arrakis/jwt-signing-next in Secrets Manager
        Add new public key to JWKS endpoint (both kid values active)

Day 0+: Rolling deploy: new Arrakis replicas sign with new key
        Old replicas drain (max 120s for in-flight tokens)
        Promote: arrakis/jwt-signing-next → arrakis/jwt-signing
        Demote: old key → arrakis/jwt-previous

Day 2:  Remove old key from JWKS endpoint
        Delete arrakis/jwt-previous from Secrets Manager

Timeline safety:
  Token max lifetime:     120s
  Clock skew allowance:   ±30s
  Effective token window:  150s
  Overlap window:          48h = 172,800s
  Safety ratio:            172,800 / 150 = 1,152x margin
```

**Rotation frequency**: Monthly (NF-SEC-2)
**Rotation automation**: Scheduled task (S5-T7)

---

## 5. loa-finn Contract Requirements (§6.3)

### 5.1 Required Endpoints

| Endpoint | Method | Auth | Purpose |
|----------|--------|------|---------|
| `/v1/agents/invoke` | POST | Bearer JWT | Synchronous agent invocation |
| `/v1/agents/stream` | POST | Bearer JWT | SSE streaming invocation |
| `/v1/usage/{idempotencyKey}` | GET | Bearer JWT (service-level) | Usage lookup for reconciliation |
| `/v1/health` | GET | None | Health check with `contract_version` |

### 5.2 Required Behaviors

| Behavior | Contract | Failure Mode |
|----------|----------|-------------|
| JWT verification via JWKS | Cache by `kid` for 1h, background refresh, negative-cache 30s, singleflight | 401 on unknown key after fresh fetch |
| JWT replay protection | `SETNX agent:jti:{env}:{iss}:{tenant_id}:{jti}` with TTL = `exp - now + 30s` | 409 Conflict on duplicate |
| Tier→model recomputation | Recompute `allowed_model_aliases` from `access_level`, NOT trust JWT claim | `POLICY_DRIFT` alert if divergent |
| Idempotency | Same `idempotencyKey` + same payload + same `req_hash` = same response | No double execution or billing |
| Idempotency scoped to tenant | loa-finn idempotency cache key MUST be `idem:{tenant_id}:{sub}:{idempotency_key}:{req_hash}` | Prevents cross-tenant cache poisoning |
| Usage event in SSE | Exactly one `event: usage` frame before `event: done` | Reconciliation worker compensates |

### 5.3 Deployment Gate

Arrakis deployment MUST verify before rollout:
1. `GET /v1/health` returns `{ contract_version: N }` where `N >= 1`
2. Integration test suite passes in staging (tier parity, usage endpoint, streaming lifecycle)
3. If incompatible: agent endpoints return 503 with `UPSTREAM_INCOMPATIBLE`

---

## 6. BYOK Liability Model (Phase 5 — Deferred)

**Status**: Not implemented in Phase 4. Documented here for future threat surface.

When users bring their own API keys (BYOK):
- Arrakis stores keys encrypted in user-scoped vault (never in community config)
- Keys are injected into loa-finn request context, never logged
- If a BYOK key is leaked via loa-finn logs, liability sits with loa-finn operator
- Rate limiting still applies (prevent abuse of BYOK keys via Arrakis platform)
- Budget tracking still applies (track cost even when user pays directly)

**Threat**: BYOK key exfiltration via prompt injection → loa-finn must sanitize all tool outputs.

---

## 7. Persona Injection Prevention (Cross-Repo)

**Owner**: loa-finn
**Documented here**: Cross-repo requirement for Arrakis threat model completeness

Custom persona content (community-configured system prompts) MUST pass injection detection before becoming part of the model context:
- Pattern matching for known injection techniques (ignore previous instructions, etc.)
- Input length limits (max 2000 chars for persona content)
- Sandboxed execution: persona content is a system message, not concatenated with user input
- loa-finn logs `INJECTION_DETECTED` alert if persona fails validation

---

## 8. Redis as Security-Critical Infrastructure

Redis is a hard dependency for three security-critical paths:

| Path | Redis Usage | Failure Mode |
|------|-------------|-------------|
| Rate limiting | Sliding window ZSET per dimension | Fail-closed: 503 (no bypass possible) |
| Budget enforcement | Atomic Lua reservation/finalization | Fail-closed: 503 (no budget bypass) |
| jti deduplication | `SETNX` per request (loa-finn side) | Fail-closed: 401 (no replay possible) |

**Redis SLOs** (NF-REL-4):
- Availability: 99.9% (ElastiCache SLA)
- Latency: p99 < 10ms
- Failover: Multi-AZ, automatic, max 30s
- During failover: agent endpoints return 503; pre-auth IP limiter still protects against volumetric abuse

---

## Document Approval

| Reviewer | Status | Date |
|----------|--------|------|
| Claude (Author) | Draft | 2026-02-09 |
| GPT Review | Pending | — |
| Security Audit | Pending | — |

# Software Design Document: Hounfour Phase 4 — Spice Gate

**Version**: 1.4.0
**Date**: February 9, 2026
**Status**: Draft
**Cycle**: cycle-010
**PRD Reference**: `grimoires/loa/prd-hounfour-phase4.md` v1.2.0

---

## 1. Executive Summary

This SDD defines the software architecture for **Spice Gate** — the Arrakis distribution layer that gates AI agent access through token-gated communities. It translates PRD v1.2.0 into concrete component designs, data models, API contracts, and Redis Lua scripts.

**Architecture approach**: Extend Arrakis's existing hexagonal architecture by adding a new `agent` domain with its own port (`IAgentGateway`), adapters (JWT service, loa-finn client, rate limiter, budget manager), and bot handlers. All new code follows established patterns from the chain provider system.

**Key design decisions**:
1. `IAgentGateway` port in `packages/core/ports/` — mirrors `IChainProvider` pattern
2. Factory pattern for adapter creation — mirrors `createChainProvider()`
3. Redis Lua scripts for atomic budget operations — no separate microservice
4. Express middleware chain for agent API — extends existing `routes.ts`
5. SSE proxy via `undici` — replaces axios for streaming support

---

## 2. System Architecture

### 2.1 High-Level Component Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                         ARRAKIS MONOREPO                        │
│                                                                 │
│  ┌──────────────────────────┐    ┌───────────────────────────┐  │
│  │     themes/sietch/       │    │    packages/core/ports/   │  │
│  │                          │    │                           │  │
│  │  Discord Bot ──┐         │    │  IAgentGateway (new)      │  │
│  │  Telegram Bot ─┤         │    │  IChainProvider (exists)  │  │
│  │  Express API ──┤         │    │  IStorageProvider (exists) │  │
│  │                ▼         │    └───────────┬───────────────┘  │
│  │  Agent Route Handler     │                │                  │
│  │         │                │                │ implements       │
│  └─────────┼────────────────┘    ┌───────────▼───────────────┐  │
│            │                     │  packages/adapters/agent/  │  │
│            │ uses                │                            │  │
│            └────────────────────→│  JwtService                │  │
│                                  │  TierAccessMapper          │  │
│                                  │  AgentRateLimiter          │  │
│                                  │  BudgetManager             │  │
│                                  │  LoaFinnClient             │  │
│                                  │  AgentGateway (facade)     │  │
│                                  └────────────┬──────────────┘  │
│                                               │                 │
└───────────────────────────────────────────────┼─────────────────┘
                                                │ HTTPS + JWT
                                                ▼
                                    ┌───────────────────────┐
                                    │      loa-finn         │
                                    │  /v1/agents/invoke    │
                                    │  /v1/agents/stream    │
                                    │  /v1/health           │
                                    └───────────────────────┘
```

### 2.2 Request Flow (Detailed)

```
Discord/Telegram Message
    │
    ▼
┌──────────────────────────────────────────────────────────┐
│  1. Pre-Auth IP Rate Limiter (FR-3.9)                    │
│     In-memory token bucket: 100/min per IP               │
│     → 429 if exceeded (before any auth processing)       │
└──────────────────────────┬───────────────────────────────┘
                           │
    ▼
┌──────────────────────────────────────────────────────────┐
│  2. Auth Middleware (existing)                            │
│     Verify Discord/Telegram identity → wallet → tier     │
│     Tier cached in Redis (TTL 5min)                      │
└──────────────────────────┬───────────────────────────────┘
                           │
    ▼
┌──────────────────────────────────────────────────────────┐
│  3. Agent Rate Limiter (FR-3)                            │
│     Redis multi-dimensional check:                       │
│     - Community limit (sliding window)                   │
│     - User limit (sliding window)                        │
│     - Channel limit (sliding window)                     │
│     - Burst limit (token bucket)                         │
│     → 429 + Retry-After if any exceeded                  │
└──────────────────────────┬───────────────────────────────┘
                           │
    ▼
┌──────────────────────────────────────────────────────────┐
│  4. Tier→Access Mapper (FR-2)                            │
│     tier (1-9) → access_level → allowed_model_aliases    │
│     Validate requested model against allowed set         │
│     → 403 if model not in tier's alias set               │
└──────────────────────────┬───────────────────────────────┘
                           │
    ▼
┌──────────────────────────────────────────────────────────┐
│  5. Budget Manager (FR-7.8)                              │
│     Atomic Lua: check + reserve budget in Redis          │
│     → 402 if budget exceeded                             │
│     → BUDGET_WARNING flag if >80%                        │
└──────────────────────────┬───────────────────────────────┘
                           │
    ▼
┌──────────────────────────────────────────────────────────┐
│  6. JWT Service (FR-1)                                   │
│     Sign JWT with ES256: tenant_id, nft_id, tier,        │
│     access_level, allowed_model_aliases, jti, exp        │
└──────────────────────────┬───────────────────────────────┘
                           │
    ▼
┌──────────────────────────────────────────────────────────┐
│  7. loa-finn Client (FR-4)                               │
│     POST /v1/agents/invoke or /v1/agents/stream          │
│     Authorization: Bearer <jwt>                          │
│     Circuit breaker → 503 if open                        │
│     Retry 502/503/504 (new jti, same idempotency_key)    │
└──────────────────────────┬───────────────────────────────┘
                           │
    ▼
┌──────────────────────────────────────────────────────────┐
│  8. Response Handler                                     │
│     Sync: parse response, finalize budget                │
│     Stream: proxy SSE events, finalize on usage event    │
│     → Bot handler formats for Discord/Telegram           │
└──────────────────────────────────────────────────────────┘
```

---

## 3. Technology Stack

| Layer | Technology | Version | Justification |
|-------|-----------|---------|---------------|
| Runtime | Node.js | 20 LTS | Matches existing Arrakis |
| Language | TypeScript | 5.3+ | Matches existing |
| HTTP Server | Express | 4.21 | Existing middleware chain |
| HTTP Client | undici | 6.x | Native fetch + SSE streaming support; replaces axios for agent calls |
| JWT | jose | 5.x | ES256 support, JWKS, lightweight (no native bindings) |
| Redis Client | ioredis | 5.9 | Existing; supports Lua scripting |
| Circuit Breaker | opossum | 9.0 | Existing pattern from chain provider |
| Rate Limiting | Custom Lua + express-rate-limit | — | Lua for multi-dimensional; express-rate-limit for IP pre-auth |
| Schema Validation | zod | 3.23 | Existing pattern for config validation |
| Logging | pino | 9.5 | Existing structured logging with PII scrubbing |
| Testing | vitest | 1.x | Existing test framework |
| Infrastructure | Terraform | 1.x | Existing IaC |

### 3.1 New Dependencies

| Package | Purpose | Why This One |
|---------|---------|-------------|
| `jose` | JWT ES256 sign/verify, JWKS | Pure JS, no native bindings, supports all JWT/JWK/JWKS specs. `jsonwebtoken` lacks ES256 JWKS support. |
| `undici` | HTTP client with SSE streaming | Built into Node.js 20; native `fetch()` + `pipeline()` for streaming. Replaces axios for agent calls only. |
| `uuid` | UUID v4 for jti generation | Already a transitive dependency |

**Not adding**: No new Redis infrastructure, no new databases, no new job queue (use existing BullMQ for reconciliation).

---

## 4. Component Design

### 4.1 Port Interface: IAgentGateway

**File**: `packages/core/ports/agent-gateway.ts`

```typescript
import type { Logger } from 'pino'

// ─── Types ────────────────────────────────────────────────────

export type AccessLevel = 'free' | 'pro' | 'enterprise'

export type ModelAlias = 'cheap' | 'fast-code' | 'reviewer' | 'reasoning' | 'native'

export interface AgentRequestContext {
  tenantId: string          // community_id
  userId: string            // wallet address
  nftId: string | null      // NFT token ID or null
  tier: number              // 1-9
  accessLevel: AccessLevel
  allowedModelAliases: ModelAlias[]
  platform: 'discord' | 'telegram'
  channelId: string
  idempotencyKey: string    // caller-generated, scoped to user intent
  traceId: string           // UUIDv4, generated once per invocation for correlation
}

export interface AgentInvokeRequest {
  context: AgentRequestContext
  agent: string             // agent identifier
  messages: AgentMessage[]
  modelAlias?: ModelAlias   // optional; loa-finn uses default if omitted
  tools?: string[]          // tool names to enable
  metadata?: Record<string, unknown>
}

export interface AgentMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

export interface AgentInvokeResponse {
  content: string
  thinking?: string
  toolCalls?: ToolCall[]
  usage: UsageInfo
  metadata?: Record<string, unknown>
}

export interface ToolCall {
  id: string
  name: string
  arguments: string
}

export interface UsageInfo {
  promptTokens: number
  completionTokens: number
  costUsd: number
}

/** Discriminated union for SSE stream events. Validated with zod at the SSE parse boundary. */
export type AgentStreamEvent =
  | { type: 'content'; data: { text: string }; id?: string }
  | { type: 'thinking'; data: { text: string }; id?: string }
  | { type: 'tool_call'; data: { name: string; args: Record<string, unknown> }; id?: string }
  | { type: 'usage'; data: UsageInfo; id?: string }
  | { type: 'done'; data: null; id?: string }
  | { type: 'error'; data: { code: string; message: string }; id?: string }

export interface BudgetStatus {
  communityId: string
  monthlyLimitCents: number
  currentSpendCents: number
  remainingCents: number
  percentUsed: number
  warningThresholdReached: boolean
}

export interface HealthStatus {
  loaFinn: { healthy: boolean; latencyMs: number }
  redis: { healthy: boolean; latencyMs: number }
}

// ─── Port Interface ───────────────────────────────────────────

export interface IAgentGateway {
  /**
   * Synchronous agent invocation.
   * Full request lifecycle: rate limit → budget reserve → JWT → forward → finalize.
   */
  invoke(request: AgentInvokeRequest): Promise<AgentInvokeResponse>

  /**
   * Streaming agent invocation.
   * Returns an async iterable of SSE events.
   * Budget finalized on 'usage' event.
   */
  stream(request: AgentInvokeRequest): AsyncIterable<AgentStreamEvent>

  /**
   * List available model aliases for the given access level.
   * Resolved locally from tier→access mapping config.
   */
  getAvailableModels(accessLevel: AccessLevel): ModelAlias[]

  /**
   * Get community budget status from Redis counters.
   */
  getBudgetStatus(communityId: string): Promise<BudgetStatus>

  /**
   * Health check for loa-finn and Redis.
   */
  getHealth(): Promise<HealthStatus>
}
```

#### 4.1.1 Multi-Turn Conversation Scope

**Decision**: Phase 4 is **stateless per-request**. Each invocation sends a single `messages` array. Arrakis does NOT persist conversation history, context windows, or thread state.

**Rationale**: Conversation state management (thread IDs, context window truncation, message retention policies, privacy/TTL) is a distinct feature with significant storage, privacy, and cost estimation implications. It is explicitly deferred to Phase 5.

**Implications for Phase 4**:
- `messages` array in `AgentInvokeRequest` is the complete context per request
- Bot handlers MAY include prior messages from the Discord/Telegram channel as context (optional, handled at bot layer)
- Budget estimation uses `messages.length` as a heuristic for input size — no stored history
- No new database tables for conversation threads
- loa-finn receives the full `messages` array each time (no session/thread_id)

### 4.2 JWT Service

**File**: `packages/adapters/agent/jwt-service.ts`

**Responsibilities**:
- Load ES256 private key from AWS Secrets Manager on startup
- Sign JWTs with all required claims (FR-1)
- Serve JWKS endpoint with public key(s) (FR-1.9)
- Handle key rotation (FR-1.5)

```typescript
import { SignJWT, importPKCS8, exportJWK } from 'jose'
import { v4 as uuidv4 } from 'uuid'

export interface JwtServiceConfig {
  /** AWS Secrets Manager secret ID for the signing key */
  secretId: string
  /** Key ID (kid) for JWKS */
  keyId: string
  /** Token expiry in seconds (default: 120) */
  expirySec: number
  /** Previous key for rotation overlap (null if not rotating) */
  previousKey?: {
    keyId: string
    privateKey: KeyLike
    publicJwk: JWK         // Required for JWKS endpoint to serve both keys
    expiresAt: Date         // Must be >= rotation time + max token exp + 30s clock skew
  }
}

export class JwtService {
  private privateKey: KeyLike
  private publicJwk: JWK
  private config: JwtServiceConfig

  async initialize(): Promise<void> {
    // Load private key from Secrets Manager
    // Export public key as JWK for JWKS endpoint
  }

  async sign(context: AgentRequestContext, rawBody: string): Promise<string> {
    const now = Math.floor(Date.now() / 1000)
    // req_hash: base64url(SHA-256(rawBody)) — binds JWT to the exact HTTP body
    // forwarded to loa-finn. Both sides hash the same wire bytes, no canonicalization.
    const reqHash = base64url(sha256(rawBody))
    return new SignJWT({
      tenant_id: context.tenantId,
      nft_id: context.nftId,
      tier: context.tier,
      tier_name: TIER_NAMES[context.tier],
      access_level: context.accessLevel,
      allowed_model_aliases: context.allowedModelAliases,
      platform: context.platform,
      channel_id: context.channelId,
      idempotency_key: context.idempotencyKey,
      req_hash: reqHash,
    })
      .setProtectedHeader({ alg: 'ES256', kid: this.config.keyId })
      .setIssuer('arrakis')
      .setSubject(context.userId)
      .setAudience('loa-finn')
      .setIssuedAt(now)
      .setExpirationTime(now + this.config.expirySec)
      .setJti(uuidv4())
      .sign(this.privateKey)
  }

  /** Returns JWKS JSON for /.well-known/jwks.json */
  getJwks(): { keys: JWK[] } {
    const keys = [{ ...this.publicJwk, kid: this.config.keyId, use: 'sig', alg: 'ES256' }]
    if (this.config.previousKey && this.config.previousKey.expiresAt > new Date()) {
      keys.push({ ...this.config.previousKey.publicJwk, kid: this.config.previousKey.keyId, use: 'sig', alg: 'ES256' })
    }
    return { keys }
  }
}
```

**Performance target**: < 2ms per sign operation (ES256 is fast; no network call per sign).

### 4.3 Tier→Access Mapper

**File**: `packages/adapters/agent/tier-access-mapper.ts`

**Responsibilities**:
- Map tier (1-9) → access_level (free/pro/enterprise) using configurable mapping
- Map access_level → allowed_model_aliases
- Support per-community overrides from PostgreSQL (FR-2.2)
- Cache overrides in Redis (TTL 5min)

```typescript
export interface TierMappingConfig {
  /** Default tier→access mapping (used when no community override) */
  defaults: Record<number, { accessLevel: AccessLevel; aliases: ModelAlias[] }>
}

// Default mapping from PRD
const DEFAULT_TIER_MAP: TierMappingConfig = {
  defaults: {
    1: { accessLevel: 'free', aliases: ['cheap'] },
    2: { accessLevel: 'free', aliases: ['cheap'] },
    3: { accessLevel: 'free', aliases: ['cheap'] },
    4: { accessLevel: 'pro', aliases: ['cheap', 'fast-code', 'reviewer'] },
    5: { accessLevel: 'pro', aliases: ['cheap', 'fast-code', 'reviewer'] },
    6: { accessLevel: 'pro', aliases: ['cheap', 'fast-code', 'reviewer'] },
    7: { accessLevel: 'enterprise', aliases: ['cheap', 'fast-code', 'reviewer', 'reasoning', 'native'] },
    8: { accessLevel: 'enterprise', aliases: ['cheap', 'fast-code', 'reviewer', 'reasoning', 'native'] },
    9: { accessLevel: 'enterprise', aliases: ['cheap', 'fast-code', 'reviewer', 'reasoning', 'native'] },
  }
}

export class TierAccessMapper {
  constructor(
    private readonly config: TierMappingConfig,
    private readonly redis: Redis,
    private readonly db: DrizzleClient,
    private readonly logger: Logger
  ) {}

  async resolve(communityId: string, tier: number): Promise<{
    accessLevel: AccessLevel
    allowedModelAliases: ModelAlias[]
  }> {
    // 1. Check Redis cache for community override
    // 2. If miss, check PostgreSQL for community override
    // 3. If no override, use default config
    // 4. Cache result in Redis (TTL 5min)
  }

  validateModelRequest(requestedAlias: ModelAlias, allowed: ModelAlias[]): boolean {
    return allowed.includes(requestedAlias)
  }
}
```

### 4.4 Agent Rate Limiter

**File**: `packages/adapters/agent/agent-rate-limiter.ts`

**Responsibilities**:
- Multi-dimensional rate limiting via Redis Lua scripts (FR-3)
- Sliding window for community/user/channel limits
- Token bucket for burst control
- Fail closed on Redis failure (FR-3.7)

```typescript
export interface RateLimitResult {
  allowed: boolean
  dimension: 'community' | 'user' | 'channel' | 'burst' | null  // which limit hit
  remaining: number
  resetAt: number       // Unix timestamp
  retryAfter: number    // seconds
}

export class AgentRateLimiter {
  private readonly redis: Redis
  private readonly luaScript: string  // loaded once at startup

  constructor(redis: Redis, logger: Logger) {
    this.redis = redis
    this.luaScript = RATE_LIMIT_LUA_SCRIPT
  }

  async check(params: {
    communityId: string
    userId: string
    channelId: string
    accessLevel: AccessLevel
  }): Promise<RateLimitResult> {
    const limits = TIER_LIMITS[params.accessLevel]

    const windowMs = 60_000 // 1 minute window
    const nowMs = Date.now()
    const requestId = crypto.randomUUID()

    // Single Lua script checks all 4 dimensions atomically
    // Key prefix: agent:rl:* (matches §5.1 Redis Key Schema)
    const result = await this.redis.eval(
      this.luaScript,
      4, // number of keys
      `agent:rl:community:${params.communityId}:${windowMs}`,
      `agent:rl:user:${params.userId}:${windowMs}`,
      `agent:rl:channel:${params.channelId}:${windowMs}`,
      `agent:rl:burst:${params.userId}`,
      // ARGV: limits for each dimension
      limits.community, limits.user, limits.channel,
      limits.burstCapacity, limits.burstRefillRatePerMs,
      nowMs, requestId, windowMs
    )

    return parseRateLimitResult(result)
  }
}
```

**Lua Script**: A single script that checks all 4 dimensions and returns the most restrictive result. This ensures atomicity and reduces Redis round-trips from 4 to 1.

#### 4.4.1 Redis Failure Degradation Strategy

Redis is in the hot path for rate limiting, budget, and tier cache. Each component has explicit failure behavior to prevent a Redis blip from becoming a full outage:

| Component | Default Mode | Redis Failure Behavior | Rationale |
|-----------|-------------|----------------------|-----------|
| AgentRateLimiter | Fail-closed | Return 503 (FR-3.7) | Prevents unmetered abuse if rate limits are unavailable |
| BudgetManager.reserve() | Fail-closed | Return 503 | Prevents unmetered spend if budget checks unavailable |
| BudgetManager.finalize() | Fail-open (async) | Enqueue to BullMQ dead-letter; reconciliation retries | Finalization failure should not block user response |
| TierAccessMapper cache | Fail-open (stale) | Use last-known tier from in-memory LRU (5min TTL) | Missing tier should not block if recently resolved |
| Health cache | Fail-open | Return last-known health status | Health check failure should not cascade |

**Circuit breaker on Redis operations**: Each component wraps Redis calls with opossum circuit breaker (separate from the loa-finn circuit breaker):
- `errorThresholdPercentage`: 50%
- `timeout`: 500ms (Redis ops should be < 10ms)
- `resetTimeout`: 5000ms

**Global kill switch**: Environment variable `AGENT_ENABLED=false` disables all agent endpoints without deploy. Bot commands return a user-friendly "AI agent temporarily unavailable" message.

### 4.5 Budget Manager

**File**: `packages/adapters/agent/budget-manager.ts`

**Responsibilities**:
- Atomic budget reservation via Lua script (FR-7.8)
- Finalization with actual cost correction (FR-7.10)
- Reservation expiry cleanup (FR-7.9)
- Reconciliation job via BullMQ (FR-7.7)
- Budget status queries (FR-5.4)

```typescript
export interface BudgetReservation {
  reservationId: string
  communityId: string
  estimatedCostCents: number
  createdAt: number
}

export type BudgetCheckResult =
  | { status: 'RESERVED'; reservationId: string; warningThreshold: boolean }
  | { status: 'BUDGET_EXCEEDED'; currentSpendCents: number; limitCents: number }

export class BudgetManager {
  private readonly reserveLuaScript: string
  private readonly finalizeLuaScript: string

  async reserve(params: {
    communityId: string
    userId: string
    modelAlias: ModelAlias
    hasTools: boolean
    idempotencyKey: string
  }): Promise<BudgetCheckResult> {
    const estimatedCents = this.estimateCost(params.modelAlias, params.hasTools)
    const month = this.getCurrentMonth()  // "2026-02"
    const nowMs = Date.now()

    // Atomic Lua: check effective spend → reserve → store reservation hash
    // 5 KEYS matching §8.2 Lua script — all use agent: prefix
    const result = await this.redis.eval(
      this.reserveLuaScript,
      5,
      `agent:budget:committed:${params.communityId}:${month}`,                              // KEYS[1]
      `agent:budget:reserved:${params.communityId}:${month}`,                               // KEYS[2]
      `agent:budget:limit:${params.communityId}`,                                           // KEYS[3]
      `agent:budget:reservation:${params.communityId}:${params.userId}:${params.idempotencyKey}`, // KEYS[4]
      `agent:budget:expiry:${params.communityId}:${month}`,                                 // KEYS[5]
      // ARGV[1-7]
      estimatedCents,                    // ARGV[1] estimated cost
      300,                               // ARGV[2] reservation TTL (5 min)
      params.communityId,                // ARGV[3]
      params.userId,                     // ARGV[4]
      params.idempotencyKey,             // ARGV[5]
      params.modelAlias,                 // ARGV[6]
      nowMs,                             // ARGV[7]
    )

    return parseBudgetResult(result)
  }

  async finalize(params: {
    idempotencyKey: string
    communityId: string
    userId: string
    actualCostCents: number
  }): Promise<void> {
    const month = this.getCurrentMonth()

    // Atomic Lua: read reservation → move reserved→committed → delete reservation
    // 5 KEYS matching §8.3 Lua script (idempotent via finalized marker)
    await this.redis.eval(
      this.finalizeLuaScript,
      5,
      `agent:budget:committed:${params.communityId}:${month}`,                              // KEYS[1]
      `agent:budget:reserved:${params.communityId}:${month}`,                               // KEYS[2]
      `agent:budget:reservation:${params.communityId}:${params.userId}:${params.idempotencyKey}`, // KEYS[3]
      `agent:budget:expiry:${params.communityId}:${month}`,                                 // KEYS[4]
      `agent:budget:finalized:${params.communityId}:${params.userId}:${params.idempotencyKey}`,   // KEYS[5]
      // ARGV
      params.actualCostCents,            // ARGV[1]
      `${params.userId}:${params.idempotencyKey}`,  // ARGV[2] ZSET member
    )
  }

  private estimateCost(alias: ModelAlias, hasTools: boolean): number {
    const baseCents = PRICING_TABLE[alias]  // e.g., cheap=1, reasoning=15
    const multiplier = hasTools ? 2 : 1     // tool-call amplification (FR-7.12)
    return baseCents * multiplier
  }
}
```

### 4.6 loa-finn Client

**File**: `packages/adapters/agent/loa-finn-client.ts`

**Responsibilities**:
- HTTP client to loa-finn `/v1/agents/*` endpoints (FR-4)
- SSE streaming via `undici` (FR-4.2)
- Circuit breaker via opossum (FR-4.3)
- Retry with exponential backoff (FR-4.5)
- Health check probe (FR-4.6)

```typescript
import CircuitBreaker from 'opossum'

export interface LoaFinnClientConfig {
  baseUrl: string               // LOA_FINN_BASE_URL env var
  timeoutMs: number             // default: 120_000
  maxRetries: number            // default: 3
  circuitBreaker: {
    timeout: number             // 120_000ms
    errorThresholdPercentage: number  // 50
    resetTimeout: number        // 30_000ms
  }
}

export class LoaFinnClient {
  private readonly breaker: CircuitBreaker
  private readonly config: LoaFinnClientConfig

  async invoke(jwt: string, request: AgentInvokeRequest): Promise<AgentInvokeResponse> {
    return this.breaker.fire(async () => {
      return this.executeWithRetry(async (attempt) => {
        const jwtToken = attempt === 0 ? jwt : await this.mintNewJwt(request.context)

        const response = await fetch(`${this.config.baseUrl}/v1/agents/invoke`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${jwtToken}`,
            'X-Idempotency-Key': request.context.idempotencyKey,
            'X-Trace-ID': uuidv4(),
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            agent: request.agent,
            messages: request.messages,
            model_alias: request.modelAlias,
            tools: request.tools,
            metadata: request.metadata,
          }),
          signal: AbortSignal.timeout(this.config.timeoutMs),
        })

        if (!response.ok) {
          throw new LoaFinnError(response.status, await response.text())
        }

        return response.json() as AgentInvokeResponse
      })
    })
  }

  async *stream(jwt: string, request: AgentInvokeRequest): AsyncIterable<AgentStreamEvent> {
    // Uses undici for HTTP/1.1 streaming (SSE)
    const { body } = await undiciRequest(`${this.config.baseUrl}/v1/agents/stream`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${jwt}`,
        'X-Idempotency-Key': request.context.idempotencyKey,
        'X-Trace-ID': request.context.traceId,
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream',
      },
      body: JSON.stringify({
        agent: request.agent,
        messages: request.messages,
        model_alias: request.modelAlias,
        tools: request.tools,
        metadata: request.metadata,
      }),
      signal: AbortSignal.timeout(this.config.timeoutMs),
    })

    // Parse SSE frames: "event: <type>\ndata: <json>\nid: <id>\n\n"
    // Uses a line-based parser; no auto-retry on disconnect (FR-4.7)
    // Caller (AgentGateway.stream) handles retry/reconciliation decisions
    let buffer = ''
    let currentEvent: Partial<{ event: string; data: string; id: string }> = {}

    for await (const chunk of body) {
      buffer += chunk.toString()
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''  // keep incomplete line

      for (const line of lines) {
        if (line.startsWith('event:')) {
          currentEvent.event = line.slice(6).trim()
        } else if (line.startsWith('data:')) {
          currentEvent.data = line.slice(5).trim()
        } else if (line.startsWith('id:')) {
          currentEvent.id = line.slice(3).trim()
        } else if (line === '') {
          // Empty line = end of event frame
          if (currentEvent.event && currentEvent.data) {
            const parsed = AgentStreamEventSchema.parse({
              type: currentEvent.event,
              data: JSON.parse(currentEvent.data),
              id: currentEvent.id,
            })
            yield parsed
          }
          currentEvent = {}
        }
      }
    }
  }

  /** Query loa-finn for usage by idempotencyKey (for stream reconciliation, §4.7.1) */
  async getUsage(idempotencyKey: string): Promise<UsageInfo | null> {
    try {
      const response = await fetch(
        `${this.config.baseUrl}/v1/usage/${encodeURIComponent(idempotencyKey)}`,
        {
          headers: { 'Authorization': `Bearer ${await this.mintServiceJwt()}` },
          signal: AbortSignal.timeout(10_000),
        }
      )
      if (response.status === 404) return null  // loa-finn never processed it
      if (!response.ok) throw new LoaFinnError(response.status, await response.text())
      return response.json() as Promise<UsageInfo>
    } catch (error) {
      if (error instanceof LoaFinnError) throw error
      return null  // Network error — let reconciliation retry
    }
  }

  async healthCheck(): Promise<{ healthy: boolean; latencyMs: number }> {
    const start = performance.now()
    try {
      const resp = await fetch(`${this.config.baseUrl}/v1/health`, {
        signal: AbortSignal.timeout(5000),
      })
      return { healthy: resp.ok, latencyMs: Math.round(performance.now() - start) }
    } catch {
      return { healthy: false, latencyMs: Math.round(performance.now() - start) }
    }
  }

  private async executeWithRetry<T>(fn: (attempt: number) => Promise<T>): Promise<T> {
    // Exponential backoff: 1s, 2s, 4s
    // Only retry on 502, 503, 504
    // New JWT minted per retry (new jti, same idempotency_key)
  }
}
```

### 4.7 Agent Gateway Facade

**File**: `packages/adapters/agent/agent-gateway.ts`

Orchestrates the full request lifecycle (§4.5.2 state machine):

```typescript
export class AgentGateway implements IAgentGateway {
  constructor(
    private readonly jwtService: JwtService,
    private readonly tierMapper: TierAccessMapper,
    private readonly rateLimiter: AgentRateLimiter,
    private readonly budgetManager: BudgetManager,
    private readonly loaFinnClient: LoaFinnClient,
    private readonly logger: Logger
  ) {}

  async invoke(request: AgentInvokeRequest): Promise<AgentInvokeResponse> {
    // STATE: RECEIVED
    // 1. Validate model alias against allowed set
    if (request.modelAlias && !this.tierMapper.validateModelRequest(request.modelAlias, request.context.allowedModelAliases)) {
      throw new ForbiddenError('Model not available for your tier')
    }

    // 2. Rate limit check
    const rlResult = await this.rateLimiter.check({
      communityId: request.context.tenantId,
      userId: request.context.userId,
      channelId: request.context.channelId,
      accessLevel: request.context.accessLevel,
    })
    if (!rlResult.allowed) {
      throw new RateLimitError(rlResult)
    }

    // STATE: RESERVED
    // 3. Budget reservation
    const budgetResult = await this.budgetManager.reserve({
      communityId: request.context.tenantId,
      userId: request.context.userId,
      modelAlias: request.modelAlias ?? 'cheap',
      hasTools: (request.tools?.length ?? 0) > 0,
      idempotencyKey: request.context.idempotencyKey,
    })
    if (budgetResult.status === 'BUDGET_EXCEEDED') {
      throw new BudgetExhaustedError(budgetResult)
    }

    // 4. Sign JWT
    const jwt = await this.jwtService.sign(request.context)

    // STATE: EXECUTING
    try {
      const response = await this.loaFinnClient.invoke(jwt, request)

      // STATE: FINALIZED
      await this.budgetManager.finalize({
        idempotencyKey: request.context.idempotencyKey,
        communityId: request.context.tenantId,
        userId: request.context.userId,
        actualCostCents: Math.round(response.usage.costUsd * 100),
      })

      if (budgetResult.warningThreshold) {
        this.emitBudgetWarning(request.context.tenantId)
      }

      return response
    } catch (error) {
      // On failure, reservation expires via TTL (FR-7.9)
      // Do not manually release — let TTL handle it to avoid race conditions
      throw error
    }
  }

  async *stream(request: AgentInvokeRequest): AsyncIterable<AgentStreamEvent> {
    // Steps 1-4 identical to invoke()
    // 1. Validate model alias
    if (request.modelAlias && !this.tierMapper.validateModelRequest(request.modelAlias, request.context.allowedModelAliases)) {
      throw new ForbiddenError('Model not available for your tier')
    }
    // 2. Rate limit check
    const rlResult = await this.rateLimiter.check({
      communityId: request.context.tenantId,
      userId: request.context.userId,
      channelId: request.context.channelId,
      accessLevel: request.context.accessLevel,
    })
    if (!rlResult.allowed) throw new RateLimitError(rlResult)
    // 3. Budget reservation
    const budgetResult = await this.budgetManager.reserve({
      communityId: request.context.tenantId,
      userId: request.context.userId,
      modelAlias: request.modelAlias ?? 'cheap',
      hasTools: (request.tools?.length ?? 0) > 0,
      idempotencyKey: request.context.idempotencyKey,
    })
    if (budgetResult.status === 'BUDGET_EXCEEDED') throw new BudgetExhaustedError(budgetResult)
    // 4. Sign JWT
    const jwt = await this.jwtService.sign(request.context)

    // Proxy SSE events from loa-finn
    let finalized = false
    try {
      for await (const event of this.loaFinnClient.stream(jwt, request)) {
        if (event.type === 'usage') {
          // Finalize budget with actual cost from loa-finn
          await this.budgetManager.finalize({
            idempotencyKey: request.context.idempotencyKey,
            communityId: request.context.tenantId,
            userId: request.context.userId,
            actualCostCents: Math.round(event.data.costUsd * 100),
          })
          finalized = true
        }
        yield event
      }
    } finally {
      if (!finalized) {
        // Stream dropped before 'usage' event — schedule reconciliation
        // Do NOT release reservation here (reaper handles TTL expiry)
        // Instead, enqueue a reconciliation job to query loa-finn for actual cost
        await this.scheduleStreamReconciliation({
          idempotencyKey: request.context.idempotencyKey,
          communityId: request.context.tenantId,
          userId: request.context.userId,
          traceId: request.context.traceId,
          reservedAt: Date.now(),
        })
      }
    }
  }

  /**
   * Schedule a reconciliation job for a dropped stream.
   * BullMQ delayed job queries loa-finn's usage endpoint after a grace period.
   */
  private async scheduleStreamReconciliation(params: StreamReconciliation): Promise<void> {
    await this.reconciliationQueue.add('stream-reconcile', params, {
      delay: 30_000,    // Wait 30s for loa-finn to settle
      attempts: 3,      // Retry up to 3 times
      backoff: { type: 'exponential', delay: 10_000 },
    })
  }
}
```

#### 4.7.1 Stream Reconciliation Worker

**File**: `packages/adapters/agent/stream-reconciliation-worker.ts`

Handles dropped stream finalization via BullMQ. Queries loa-finn for actual cost and finalizes the budget.

```typescript
export class StreamReconciliationWorker {
  constructor(
    private readonly budgetManager: BudgetManager,
    private readonly loaFinnClient: LoaFinnClient,
    private readonly logger: Logger
  ) {}

  async process(job: Job<StreamReconciliation>): Promise<void> {
    const { idempotencyKey, communityId, userId, traceId } = job.data

    // Query loa-finn for actual usage (requires loa-finn GET /v1/usage/{idempotencyKey})
    const usage = await this.loaFinnClient.getUsage(idempotencyKey)

    if (usage) {
      // loa-finn processed the request — finalize with actual cost
      await this.budgetManager.finalize({
        idempotencyKey,
        communityId,
        actualCostCents: Math.round(usage.costUsd * 100),
      })
      this.logger.info({ idempotencyKey, traceId, costCents: usage.costUsd * 100 },
        'stream-reconciliation: finalized with actual cost')
    } else {
      // loa-finn has no record — request was never processed
      // Reservation will be cleaned up by reaper (§8.4) on TTL expiry
      this.logger.info({ idempotencyKey, traceId },
        'stream-reconciliation: no usage found, deferring to reaper')
    }
  }
}
```

**loa-finn contract**: loa-finn MUST expose `GET /v1/usage/{idempotencyKey}` returning `{ costUsd, model, tokens, completedAt }` or 404 if not found. This endpoint is called only for reconciliation (low QPS). Response is cached by loa-finn for 24h after completion.

### 4.8 Agent Gateway Factory

**File**: `packages/adapters/agent/factory.ts`

Mirrors the `createChainProvider()` pattern:

```typescript
export interface AgentGatewayResult {
  gateway: IAgentGateway
  health: () => Promise<HealthStatus>
  jwks: () => { keys: JWK[] }
}

export async function createAgentGateway(
  redis: Redis,
  db: DrizzleClient,
  logger: Logger,
  options?: Partial<AgentGatewayConfig>
): Promise<AgentGatewayResult> {
  const config = loadAgentGatewayConfig(options)

  const jwtService = new JwtService(config.jwt)
  await jwtService.initialize()

  const tierMapper = new TierAccessMapper(config.tierMapping, redis, db, logger)
  const rateLimiter = new AgentRateLimiter(redis, logger)
  const budgetManager = new BudgetManager(redis, config.budget, logger)
  const loaFinnClient = new LoaFinnClient(config.loaFinn, jwtService, logger)

  const gateway = new AgentGateway(
    jwtService, tierMapper, rateLimiter, budgetManager, loaFinnClient, logger
  )

  return {
    gateway,
    health: () => gateway.getHealth(),
    jwks: () => jwtService.getJwks(),
  }
}
```

---

## 5. Data Architecture

### 5.1 Redis Key Schema

All agent-related keys use the `agent:` prefix to separate from existing Arrakis keys.

| Key Pattern | Type | TTL | Purpose |
|------------|------|-----|---------|
| `agent:rl:community:{id}:{windowMs}` | Sorted Set | window+10s | Community rate limit (sliding window, ms scores) |
| `agent:rl:user:{wallet}:{windowMs}` | Sorted Set | window+10s | User rate limit (sliding window, ms scores) |
| `agent:rl:channel:{id}:{windowMs}` | Sorted Set | window+10s | Channel rate limit (sliding window, ms scores) |
| `agent:rl:burst:{wallet}` | Hash | 120s | Token bucket state (tokens, last_refill_ms) |
| `agent:budget:committed:{community_id}:{month}` | String (int) | 35 days | Committed spend counter (cents) — finalized actual costs |
| `agent:budget:reserved:{community_id}:{month}` | String (int) | 35 days | Reserved spend counter (cents) — pending estimated costs |
| `agent:budget:limit:{community_id}` | String (int) | — | Community budget limit (cents) |
| `agent:budget:reservation:{community_id}:{user_id}:{idempotency_key}` | Hash | 300s | Active reservation (tenant-scoped) |
| `agent:budget:expiry:{community_id}:{month}` | Sorted Set | 360s | Reservation expiry tracker (for reaper job) |
| `agent:budget:finalized:{community_id}:{user_id}:{idempotency_key}` | String (int) | 24h | Finalization idempotency marker (prevents double-commit) |
| `agent:budget:warned:{community_id}:{month}` | String | 35 days | 80% warning sent flag |
| `agent:jti:{jti}` | String | token_exp+30s | JWT replay protection (loa-finn side) |
| `agent:tier:{community_id}:{wallet}` | Hash | 300s | Cached tier resolution |
| `agent:tier:override:{community_id}` | Hash | 300s | Per-community tier mapping overrides |
| `agent:health:loafinn` | Hash | 30s | Cached health probe result |

**Capacity estimate**: At peak 1000 req/min across all communities:
- Rate limit keys: ~4 keys per request × 120s window = ~8000 keys
- Budget keys: ~2 per community = ~200 keys (for 100 communities)
- Reservation keys: ~1000 active (5min TTL × 1000/min ÷ 5) = ~1000 keys
- Total: ~10,000 keys, well within single-node capacity

### 5.2 PostgreSQL Schema Additions

**New table**: `community_agent_config`

```sql
CREATE TABLE community_agent_config (
  community_id UUID PRIMARY KEY REFERENCES communities(id),
  ai_enabled BOOLEAN NOT NULL DEFAULT false,
  monthly_budget_cents INTEGER NOT NULL DEFAULT 100,  -- $1.00 default
  tier_overrides JSONB DEFAULT NULL,                  -- per-community tier→access mapping
  pricing_overrides JSONB DEFAULT NULL,               -- per-community pricing
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RLS policy: community admins can read/write their own config
ALTER TABLE community_agent_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY community_agent_config_admin ON community_agent_config
  USING (community_id = current_setting('app.community_id')::UUID);
```

**New table**: `agent_usage_log` (audit trail, not enforcement)

```sql
CREATE TABLE agent_usage_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id UUID NOT NULL REFERENCES communities(id),
  user_wallet TEXT NOT NULL,
  model_alias TEXT NOT NULL,
  prompt_tokens INTEGER NOT NULL,
  completion_tokens INTEGER NOT NULL,
  cost_cents INTEGER NOT NULL,
  estimated_cost_cents INTEGER NOT NULL,      -- original estimate for drift analysis
  idempotency_key TEXT NOT NULL,
  trace_id TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'finalize',     -- 'finalize' | 'reconciliation' | 'late_finalize'
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_agent_usage_idempotency
  ON agent_usage_log (community_id, user_wallet, idempotency_key);

CREATE INDEX idx_agent_usage_community_month
  ON agent_usage_log (community_id, created_at);
```

**Write path**: Inserts happen in two places (both async, non-blocking to the user response):

| Writer | When | Source Value |
|--------|------|-------------|
| `BudgetManager.finalize()` | After successful finalization Lua returns `FINALIZED` or `LATE_FINALIZE` | `'finalize'` or `'late_finalize'` |
| `StreamReconciliationWorker.process()` | After reconciliation queries loa-finn and finalizes | `'reconciliation'` |

Inserts use `ON CONFLICT (community_id, user_wallet, idempotency_key) DO NOTHING` — the unique index ensures idempotency even if both the normal finalize and reconciliation fire for the same request. Inserts are enqueued via BullMQ (not inline) to avoid blocking the response path.

### 5.3 Drizzle Schema

**File**: `packages/adapters/storage/schema/agent.ts`

```typescript
import { pgTable, uuid, boolean, integer, jsonb, text, timestamp } from 'drizzle-orm/pg-core'

export const communityAgentConfig = pgTable('community_agent_config', {
  communityId: uuid('community_id').primaryKey(),
  aiEnabled: boolean('ai_enabled').notNull().default(false),
  monthlyBudgetCents: integer('monthly_budget_cents').notNull().default(100),
  tierOverrides: jsonb('tier_overrides'),
  pricingOverrides: jsonb('pricing_overrides'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const agentUsageLog = pgTable('agent_usage_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  communityId: uuid('community_id').notNull(),
  userWallet: text('user_wallet').notNull(),
  modelAlias: text('model_alias').notNull(),
  promptTokens: integer('prompt_tokens').notNull(),
  completionTokens: integer('completion_tokens').notNull(),
  costCents: integer('cost_cents').notNull(),
  idempotencyKey: text('idempotency_key').notNull(),
  traceId: text('trace_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})
```

---

## 6. API Design

### 6.1 Agent API Routes

**File**: `themes/sietch/src/api/routes/agents.ts`

Mounted at `/api/agents` in the existing Express router chain.

#### POST /api/agents/invoke

```typescript
// Request
{
  "agent": "default",
  "messages": [{ "role": "user", "content": "What is the current BGT price?" }],
  "model_alias": "cheap",   // optional
  "tools": ["web_search"]   // optional
}

// Response (200)
{
  "content": "The current BGT price is...",
  "thinking": null,
  "tool_calls": null,
  "usage": {
    "prompt_tokens": 150,
    "completion_tokens": 200,
    "cost_usd": 0.001
  }
}

// Headers
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 58
X-RateLimit-Reset: 1707451260
X-Trace-ID: <uuid>
```

#### POST /api/agents/stream

Same request body. Response is SSE:

```
HTTP/1.1 200 OK
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 58

event: content
data: {"delta": "The current "}
id: evt-001

event: content
data: {"delta": "BGT price is..."}
id: evt-002

event: usage
data: {"prompt_tokens": 150, "completion_tokens": 200, "cost_usd": 0.001}
id: evt-003

event: done
data: {"finish_reason": "stop"}
id: evt-004
```

#### GET /api/agents/models

```json
// Response (200)
{
  "access_level": "pro",
  "available_models": [
    { "alias": "cheap", "description": "Fast, low-cost responses" },
    { "alias": "fast-code", "description": "Optimized for code generation" },
    { "alias": "reviewer", "description": "Code review and analysis" }
  ]
}
```

#### GET /api/agents/budget

```json
// Response (200)
{
  "community_id": "abc-123",
  "monthly_limit_cents": 1000,
  "current_spend_cents": 450,
  "remaining_cents": 550,
  "percent_used": 45,
  "warning_threshold_reached": false,
  "resets_at": "2026-03-01T00:00:00Z"
}
```

#### GET /api/agents/health

```json
// Response (200)
{
  "loa_finn": { "healthy": true, "latency_ms": 45 },
  "redis": { "healthy": true, "latency_ms": 2 }
}
```

#### GET /.well-known/jwks.json

```json
// Response (200)
// Cache-Control: max-age=3600, must-revalidate
{
  "keys": [
    {
      "kty": "EC",
      "crv": "P-256",
      "x": "...",
      "y": "...",
      "kid": "arrakis-2026-02",
      "use": "sig",
      "alg": "ES256"
    }
  ]
}
```

### 6.2 Error Responses

All agent API errors follow a consistent format:

```json
{
  "error": {
    "code": "RATE_LIMITED",
    "message": "Too many requests",
    "details": {
      "dimension": "user",
      "retry_after": 12
    }
  }
}
```

Error codes: `RATE_LIMITED`, `BUDGET_EXCEEDED`, `MODEL_FORBIDDEN`, `SERVICE_UNAVAILABLE`, `INVALID_REQUEST`, `INTERNAL_ERROR`.

### 6.3 Middleware Chain (Agent Routes)

```typescript
// themes/sietch/src/api/routes/agents.ts

import { Router } from 'express'

export function createAgentRouter(gateway: IAgentGateway, jwks: () => JWKSResponse) {
  const router = Router()

  // Pre-auth IP rate limiter is applied globally in server.ts (FR-3.9)

  // Auth required for all agent routes
  router.use(requireAuth)

  // Resolve tier from conviction scoring (cached)
  router.use(resolveTier)

  // Agent routes
  router.post('/invoke', handleInvoke(gateway))
  router.post('/stream', handleStream(gateway))
  router.get('/models', handleModels(gateway))
  router.get('/budget', handleBudget(gateway))
  router.get('/health', handleHealth(gateway))

  return router
}

// JWKS endpoint is public (no auth) — mounted separately
export function createJwksRoute(jwks: () => JWKSResponse) {
  const router = Router()
  router.get('/.well-known/jwks.json', (req, res) => {
    res.set('Cache-Control', 'max-age=3600, must-revalidate')
    res.json(jwks())
  })
  return router
}
```

### 6.3 loa-finn Interface Contract (SKP-001)

Arrakis depends on loa-finn implementing these behaviors. This is a versioned contract — Arrakis v1 requires loa-finn contract v1.

#### 6.3.1 Required Endpoints

**`POST /v1/agents/invoke`** — Synchronous invocation (existing, Phases 0-3).

**`POST /v1/agents/stream`** — SSE streaming invocation (existing, Phases 0-3).

**`GET /v1/usage/{idempotencyKey}`** — Usage lookup for stream reconciliation (NEW).

| Field | Type | Description |
|-------|------|-------------|
| Response 200 | `UsageInfo` | `{ promptTokens, completionTokens, costUsd, model?, completedAt? }` |
| Response 404 | — | loa-finn never processed this idempotencyKey |
| Response 202 | — | Request still in progress (not yet completed) |
| Auth | Bearer JWT | Service-level JWT (iss=arrakis, aud=loa-finn, no user context) |
| Rate limit | 100 req/min | Low QPS — only called by reconciliation worker |
| Cache | loa-finn caches for 24h after completion | Immutable once completed |

#### 6.3.2 Required Behaviors

| Behavior | Contract | Section Reference |
|----------|----------|-------------------|
| JWT verification via JWKS | Cache by `kid` for 1h, background refresh, negative-cache unknown `kid` for 30s, singleflight coalescing | §7.2.2 |
| JWT replay protection | `SETNX agent:jti:{jti}` with TTL = `exp - now + 30s`, reject if SETNX returns 0 | §7.2.1 |
| Tier→model recomputation | loa-finn MUST recompute `allowed_model_aliases` from `access_level` claim, not trust `allowed_model_aliases` blindly | §7.2 (FR-2.6) |
| Idempotency | Same `idempotencyKey` + same payload = same response (no double execution) | §4.5 |
| Usage event in SSE | Stream MUST emit exactly one `event: usage` frame with `UsageInfo` before `event: done` | §4.1, §4.7 |

#### 6.3.3 Deployment Gate

Arrakis deployment MUST verify loa-finn contract compatibility before rollout:
- Health check: `GET /v1/health` returns `{ version, contract_version }` where `contract_version >= 1`
- Integration test suite runs in staging: tier parity, usage endpoint, streaming lifecycle
- If contract version is missing or incompatible, Arrakis agent endpoints return 503 with `UPSTREAM_INCOMPATIBLE`

---

## 7. Security Architecture

### 7.1 JWT Signing Key Management

```
┌───────────────────────┐     startup      ┌─────────────────────┐
│  AWS Secrets Manager  │ ──────────────→  │  JwtService (memory) │
│                       │                  │                      │
│  arrakis/jwt-signing  │                  │  privateKey: KeyLike │
│  {                    │                  │  publicJwk: JWK      │
│    kid, privateKey,   │                  └──────────────────────┘
│    publicKey          │                           │
│  }                    │                           │ sign()
│                       │                           ▼
│  arrakis/jwt-previous │                  ┌──────────────────────┐
│  (rotation overlap)   │                  │  JWT Token (120s)    │
└───────────────────────┘                  │  kid: arrakis-2026-02│
                                           └──────────────────────┘
```

**Key rotation runbook** (automated via scheduled task):
1. Generate new EC P-256 key pair
2. Store in Secrets Manager as `arrakis/jwt-signing-next`
3. Update JWKS endpoint to include both keys
4. Rolling deploy: new replicas use new key
5. After all replicas updated: promote new key, demote old to `arrakis/jwt-previous`
6. After 48h: remove old key from JWKS

### 7.2 Trust Boundary

```
┌─────────────────────────────────────────────────────────────────┐
│  TRUST BOUNDARY 1: User → Arrakis                              │
│                                                                 │
│  Assertions:                                                    │
│  - User is authenticated (Discord OAuth2 / Telegram auth)       │
│  - User's wallet is verified (signature proof)                  │
│  - User's tier is computed from on-chain conviction scoring     │
│  - Rate limits are enforced per user/channel/community          │
│  - Budget is checked and reserved                               │
│                                                                 │
│  Threats mitigated:                                             │
│  - Unauthenticated access → existing auth middleware            │
│  - Tier spoofing → server-side tier resolution from chain       │
│  - Rate limit bypass → multi-dimensional Redis + IP pre-auth    │
│  - Budget bypass → atomic Lua scripts with reservation TTL      │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│  TRUST BOUNDARY 2: Arrakis → loa-finn                          │
│                                                                 │
│  Assertions:                                                    │
│  - JWT is signed by Arrakis (ES256, verified via JWKS)          │
│  - JWT contains tier + access_level (loa-finn recomputes auth)  │
│  - jti is unique (replay protection via Redis SETNX)            │
│  - idempotency_key enables safe retries                         │
│                                                                 │
│  Threats mitigated:                                             │
│  - JWT forgery → ES256 cryptographic verification               │
│  - JWT replay → jti deduplication with TTL                      │
│  - Confused deputy → loa-finn recomputes from tier (FR-2.6)     │
│  - Key compromise → monthly rotation, 48h overlap, JWKS         │
│  - Clock skew → ±30s tolerance on iat validation                │
└─────────────────────────────────────────────────────────────────┘
```

#### 7.2.1 JWT Replay Protection Contract

Arrakis and loa-finn share responsibility for replay protection:

| Responsibility | Owner | Implementation |
|---------------|-------|----------------|
| Include unique `jti` per request | Arrakis | `JwtService.sign()` generates UUIDv4 jti |
| Include unique `idempotency_key` in claims | Arrakis | Caller-generated or UUIDv4 fallback |
| Enforce jti deduplication | **loa-finn** | `SETNX agent:jti:{jti} 1 EX {exp - now + 30}` |
| Reject expired tokens | **loa-finn** | Verify `exp` claim with ±30s clock skew |

**loa-finn jti Redis key**: `agent:jti:{jti}` with TTL = `token_exp - now + 30s` (covers max clock skew). This ensures a stolen JWT cannot be replayed even within its 120s validity window. loa-finn MUST reject requests where SETNX returns 0 (duplicate jti).

#### 7.2.2 JWKS Caching & Key Rotation Contract

Arrakis publishes JWKS at `/.well-known/jwks.json`. loa-finn MUST follow this caching policy:

**Arrakis (publisher)**:
- JWKS endpoint returns `Cache-Control: public, max-age=3600` and `ETag` header
- During rotation, both current and previous public keys are included (48h overlap)
- Previous key `expiresAt` = rotation time + 48h (>> max token exp of 120s + 30s skew)
- Response includes `kid` for each key so loa-finn can match JWT header

**loa-finn (consumer)** — required caching behavior:
| Scenario | Action |
|----------|--------|
| Cache hit by `kid` | Use cached key, no fetch |
| Unknown `kid` | Fetch JWKS once, cache result for 1h by `kid` |
| Unknown `kid` after fresh fetch | Reject with 401 (negative cache for 30s to prevent abuse) |
| Background refresh | Every 1h, refresh JWKS regardless (handles rotation proactively) |
| Fetch failure | Use cached keys, retry in 60s (fail-open for cached keys only) |

**Thundering herd prevention**: loa-finn MUST coalesce concurrent JWKS fetch requests into a single HTTP call (e.g., via a mutex/singleflight pattern). At most 1 JWKS fetch per 30s regardless of concurrent unknown-kid requests.

**Key rotation timeline**:
```
Day 0: Generate new key pair, add to JWKS (both keys served)
Day 0+: New tokens signed with new kid
Day 2 (48h): Remove old key from JWKS
Safety margin: 48h >> 120s token exp + 30s skew = 150s
```

### 7.3 Request Logging & PII

Agent request logging uses existing pino PII scrubber. Additional redaction for agent-specific fields:

```typescript
const AGENT_REDACT_PATHS = [
  '*.messages[*].content',     // Redact user message content
  '*.response.content',        // Redact AI response content
  '*.jwt',                     // Redact full JWT tokens
]
```

Logged metadata (not redacted): trace_id, tenant_id, user_wallet (hashed), tier, model_alias, latency_ms, cost_cents, rate_limit_remaining.

---

## 8. Redis Lua Scripts

### 8.1 Multi-Dimensional Rate Limit Script

**Key prefix**: All rate limit keys use `agent:rl:*` consistently (matching §5.1 schema).

```lua
-- KEYS[1] = agent:rl:community:{id}:{windowSec}
-- KEYS[2] = agent:rl:user:{wallet}:{windowSec}
-- KEYS[3] = agent:rl:channel:{id}:{windowSec}
-- KEYS[4] = agent:rl:burst:{wallet}
-- ARGV[1-3] = limits (community, user, channel)
-- ARGV[4-5] = burst capacity, burst refill rate (tokens/ms)
-- ARGV[6] = current timestamp (milliseconds)
-- ARGV[7] = request ID (unique per request, e.g. UUIDv4)
-- ARGV[8] = window size (milliseconds, e.g. 60000)

local nowMs = tonumber(ARGV[6])
local requestId = ARGV[7]
local windowMs = tonumber(ARGV[8])

-- Helper: sliding window check (millisecond precision)
-- Returns: allowed, count, limit, retryAfterMs, resetAtMs
local function slidingWindowCheck(key, limit)
  local lim = tonumber(limit)
  -- Remove entries outside window
  redis.call('ZREMRANGEBYSCORE', key, 0, nowMs - windowMs)
  local count = redis.call('ZCARD', key)
  if count >= lim then
    -- Compute retryAfter: when the oldest entry expires from the window
    local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
    local retryAfterMs = 0
    local resetAtMs = nowMs + windowMs
    if oldest and #oldest >= 2 then
      local oldestMs = tonumber(oldest[2])
      retryAfterMs = (oldestMs + windowMs) - nowMs
      resetAtMs = oldestMs + windowMs
      if retryAfterMs < 0 then retryAfterMs = 0 end
    end
    return false, count, lim, retryAfterMs, resetAtMs
  end
  -- Use millisecond timestamp + requestId for unique member
  redis.call('ZADD', key, nowMs, nowMs .. ':' .. requestId)
  redis.call('PEXPIRE', key, windowMs + 10000)  -- buffer 10s
  local remaining = lim - (count + 1)
  local resetAtMs = nowMs + windowMs
  return true, remaining, lim, 0, resetAtMs
end

-- Helper: token bucket check (millisecond precision)
-- Returns: allowed, remaining, retryAfterMs
local function tokenBucketCheck(key, capacity, refillRatePerMs)
  local cap = tonumber(capacity)
  local refillRate = tonumber(refillRatePerMs)
  local data = redis.call('HMGET', key, 'tokens', 'last_refill_ms')
  local tokens = tonumber(data[1]) or cap
  local lastRefillMs = tonumber(data[2]) or nowMs
  -- Refill tokens based on elapsed milliseconds
  local elapsedMs = nowMs - lastRefillMs
  tokens = math.min(cap, tokens + elapsedMs * refillRate)
  if tokens < 1 then
    -- Time until 1 token is available
    local deficit = 1 - tokens
    local retryAfterMs = math.ceil(deficit / refillRate)
    return false, 0, retryAfterMs
  end
  tokens = tokens - 1
  redis.call('HMSET', key, 'tokens', tokens, 'last_refill_ms', nowMs)
  redis.call('PEXPIRE', key, 120000)
  return true, math.floor(tokens), 0
end

-- Check all dimensions (most restrictive wins)
local ok, remaining, limit, retryAfterMs, resetAtMs

ok, remaining, limit, retryAfterMs, resetAtMs = slidingWindowCheck(KEYS[1], ARGV[1])
if not ok then return {'community', tostring(remaining), tostring(limit), tostring(retryAfterMs), tostring(resetAtMs)} end

ok, remaining, limit, retryAfterMs, resetAtMs = slidingWindowCheck(KEYS[2], ARGV[2])
if not ok then return {'user', tostring(remaining), tostring(limit), tostring(retryAfterMs), tostring(resetAtMs)} end

ok, remaining, limit, retryAfterMs, resetAtMs = slidingWindowCheck(KEYS[3], ARGV[3])
if not ok then return {'channel', tostring(remaining), tostring(limit), tostring(retryAfterMs), tostring(resetAtMs)} end

local burstOk, burstRemaining, burstRetryMs
burstOk, burstRemaining, burstRetryMs = tokenBucketCheck(KEYS[4], ARGV[4], ARGV[5])
if not burstOk then return {'burst', '0', ARGV[4], tostring(burstRetryMs), '0'} end

-- All passed: return remaining for the most restrictive sliding window dimension
return {'ok', tostring(remaining), tostring(limit), '0', tostring(resetAtMs)}
```

### 8.2 Budget Reservation Script (Two-Counter Model)

**Design**: Two separate counters — `committed` (finalized actual spend) and `reserved` (pending estimated spend). Effective spend = committed + reserved. This prevents failed requests from permanently inflating the spend counter.

```lua
-- KEYS[1] = committed counter:  agent:budget:committed:{communityId}:{month}
-- KEYS[2] = reserved counter:   agent:budget:reserved:{communityId}:{month}
-- KEYS[3] = budget limit:       agent:budget:limit:{communityId}
-- KEYS[4] = reservation hash:   agent:budget:reservation:{communityId}:{userId}:{idempotencyKey}
-- KEYS[5] = expiry sorted set:  agent:budget:expiry:{communityId}:{month}
-- ARGV[1] = estimated cost (cents, integer)
-- ARGV[2] = reservation TTL (seconds)
-- ARGV[3] = community_id
-- ARGV[4] = user_id (wallet)
-- ARGV[5] = idempotency_key
-- ARGV[6] = model_alias
-- ARGV[7] = now_epoch_ms (millisecond timestamp)

local committed = tonumber(redis.call('GET', KEYS[1]) or '0')
local reserved = tonumber(redis.call('GET', KEYS[2]) or '0')
local budgetLimit = tonumber(redis.call('GET', KEYS[3]) or '0')
local estimatedCost = tonumber(ARGV[1])
local ttlSec = tonumber(ARGV[2])
local nowMs = tonumber(ARGV[7])

-- Effective spend = committed + reserved
local effectiveSpend = committed + reserved

-- Check if budget would be exceeded
if budgetLimit > 0 and (effectiveSpend + estimatedCost) > budgetLimit then
  return {'BUDGET_EXCEEDED', tostring(committed), tostring(reserved), tostring(budgetLimit)}
end

-- Check if reservation already exists (idempotent)
local existing = redis.call('EXISTS', KEYS[4])
if existing == 1 then
  return {'ALREADY_RESERVED', tostring(committed), tostring(reserved)}
end

-- Increment reserved counter
redis.call('INCRBY', KEYS[2], estimatedCost)

-- Store reservation with explicit fields
redis.call('HMSET', KEYS[4],
  'estimated_cost', estimatedCost,
  'community_id', ARGV[3],
  'user_id', ARGV[4],
  'idempotency_key', ARGV[5],
  'model_alias', ARGV[6],
  'created_at_ms', nowMs
)
redis.call('EXPIRE', KEYS[4], ttlSec)

-- Add to expiry sorted set (for reaper job)
-- Member = userId:idempotencyKey so reaper can reconstruct full reservation key
local expiresAtMs = nowMs + (ttlSec * 1000)
local zsetMember = ARGV[4] .. ':' .. ARGV[5]  -- userId:idempotencyKey
redis.call('ZADD', KEYS[5], expiresAtMs, zsetMember)
redis.call('EXPIRE', KEYS[5], ttlSec + 60)  -- buffer

-- Check 80% warning threshold
local newEffective = effectiveSpend + estimatedCost
local warning = (budgetLimit > 0 and newEffective >= (budgetLimit * 0.8))

return {'RESERVED', tostring(newEffective), tostring(warning)}
```

### 8.3 Budget Finalization Script (Two-Counter Model, Idempotent)

**Idempotency guarantee**: A finalized marker key prevents double-commit. Retries, duplicate usage events, and reconciliation worker replays are safe — only the first finalize commits cost.

```lua
-- KEYS[1] = committed counter:  agent:budget:committed:{communityId}:{month}
-- KEYS[2] = reserved counter:   agent:budget:reserved:{communityId}:{month}
-- KEYS[3] = reservation hash:   agent:budget:reservation:{communityId}:{userId}:{idempotencyKey}
-- KEYS[4] = expiry sorted set:  agent:budget:expiry:{communityId}:{month}
-- KEYS[5] = finalized marker:   agent:budget:finalized:{communityId}:{userId}:{idempotencyKey}
-- ARGV[1] = actual cost (cents, integer, must be >= 0)
-- ARGV[2] = expiry ZSET member (userId:idempotencyKey — matches reserve script)

local actualCost = tonumber(ARGV[1])
if actualCost < 0 then actualCost = 0 end

-- Idempotency check: if already finalized, return the stored cost (no-op)
local alreadyFinalized = redis.call('GET', KEYS[5])
if alreadyFinalized then
  return {'ALREADY_FINALIZED', alreadyFinalized}
end

-- Get reservation details via HGET (not HGETALL — avoids field ordering issues)
local estimatedCost = tonumber(redis.call('HGET', KEYS[3], 'estimated_cost'))
if not estimatedCost then
  -- Reservation expired (reaped) but not yet finalized
  -- Commit actual cost directly; set finalized marker to prevent double-commit
  redis.call('INCRBY', KEYS[1], actualCost)
  redis.call('SET', KEYS[5], tostring(actualCost), 'EX', 86400)  -- 24h TTL
  return {'LATE_FINALIZE', tostring(actualCost)}
end

-- Move from reserved to committed:
-- 1. Decrement reserved by estimated
redis.call('DECRBY', KEYS[2], estimatedCost)
-- 2. Increment committed by actual
redis.call('INCRBY', KEYS[1], actualCost)
-- 3. Delete reservation hash
redis.call('DEL', KEYS[3])
-- 4. Remove from expiry set
redis.call('ZREM', KEYS[4], ARGV[2])
-- 5. Set finalized marker (prevents duplicate finalization)
redis.call('SET', KEYS[5], tostring(actualCost), 'EX', 86400)  -- 24h TTL

-- Ensure reserved counter doesn't go negative (safety clamp)
local reservedNow = tonumber(redis.call('GET', KEYS[2]) or '0')
if reservedNow < 0 then
  redis.call('SET', KEYS[2], '0')
end

return {'FINALIZED', tostring(actualCost - estimatedCost)}
```

### 8.4 Budget Reservation Reaper Script

Runs every 60 seconds via BullMQ repeatable job. Cleans up expired reservations and decrements reserved counter.

```lua
-- KEYS[1] = expiry sorted set:  agent:budget:expiry:{communityId}:{month}
-- KEYS[2] = reserved counter:   agent:budget:reserved:{communityId}:{month}
-- ARGV[1] = now_epoch_ms
-- ARGV[2] = reservation key prefix: agent:budget:reservation:{communityId}:
--
-- ZSET members are stored as "userId:idempotencyKey" by the reserve script (§8.2).
-- Full reservation hash key = prefix + member = agent:budget:reservation:{communityId}:{userId}:{idempotencyKey}

local nowMs = tonumber(ARGV[1])
local prefix = ARGV[2]

-- Get all expired reservations (members = userId:idempotencyKey)
local expired = redis.call('ZRANGEBYSCORE', KEYS[1], 0, nowMs)
local totalReclaimed = 0

for _, member in ipairs(expired) do
  -- Reconstruct full reservation key: prefix already ends with communityId:
  -- member = userId:idempotencyKey → full key = prefix..member
  local reservationKey = prefix .. member
  local cost = tonumber(redis.call('HGET', reservationKey, 'estimated_cost'))
  if cost then
    totalReclaimed = totalReclaimed + cost
    redis.call('DEL', reservationKey)
  end
  redis.call('ZREM', KEYS[1], member)
end

-- Decrement reserved counter by total reclaimed
if totalReclaimed > 0 then
  redis.call('DECRBY', KEYS[2], totalReclaimed)
  -- Clamp to zero
  local reservedNow = tonumber(redis.call('GET', KEYS[2]) or '0')
  if reservedNow < 0 then
    redis.call('SET', KEYS[2], '0')
  end
end

return {'REAPED', tostring(#expired), tostring(totalReclaimed)}
```

---

## 9. Bot Integration Design

### 9.1 Discord Agent Command

**File**: `themes/sietch/src/discord/commands/agent.ts`

```typescript
export const agentCommand = new SlashCommandBuilder()
  .setName('agent')
  .setDescription('Talk to the AI agent')
  .addStringOption(option =>
    option.setName('message')
      .setDescription('Your message to the agent')
      .setRequired(true)
  )
  .addStringOption(option =>
    option.setName('model')
      .setDescription('Model to use (depends on your tier)')
      .setRequired(false)
      .addChoices(
        { name: 'Default', value: 'cheap' },
        { name: 'Fast Code', value: 'fast-code' },
        { name: 'Reviewer', value: 'reviewer' },
        { name: 'Reasoning', value: 'reasoning' },
      )
  )
  .toJSON()

export async function handleAgentCommand(
  interaction: ChatInputCommandInteraction,
  gateway: IAgentGateway
): Promise<void> {
  await interaction.deferReply()

  const message = interaction.options.getString('message', true)
  const modelAlias = interaction.options.getString('model') as ModelAlias | null

  try {
    // Build context from Discord interaction
    const context = await buildAgentContext(interaction)

    // Stream response with message edits (~500ms interval)
    let accumulated = ''
    for await (const event of gateway.stream({
      context,
      agent: 'default',
      messages: [{ role: 'user', content: message }],
      modelAlias: modelAlias ?? undefined,
    })) {
      if (event.type === 'content') {
        accumulated += (event.data as { delta: string }).delta
        // Throttled edit: update message every 500ms
        await throttledEdit(interaction, accumulated)
      } else if (event.type === 'error') {
        const errorMsg = mapErrorToUserMessage(event.data)
        await interaction.editReply(errorMsg)
        return
      }
    }

    // Final edit with complete response
    await interaction.editReply(accumulated || 'No response received.')
  } catch (error) {
    const userMessage = mapErrorToUserMessage(error)
    await interaction.editReply(userMessage)
  }
}
```

### 9.2 Telegram Agent Handler

**File**: `themes/sietch/src/telegram/commands/agent.ts`

```typescript
export function registerAgentCommand(bot: Bot<BotContext>, gateway: IAgentGateway) {
  bot.command('agent', async (ctx) => {
    const message = ctx.message?.text?.replace('/agent ', '') || ''
    if (!message) {
      await ctx.reply('Usage: /agent <your message>')
      return
    }

    const context = await buildTelegramAgentContext(ctx)

    // Send initial "thinking" message
    const sentMsg = await ctx.reply('Thinking...')

    try {
      let accumulated = ''
      for await (const event of gateway.stream({
        context,
        agent: 'default',
        messages: [{ role: 'user', content: message }],
      })) {
        if (event.type === 'content') {
          accumulated += (event.data as { delta: string }).delta
          // Throttled edit every 500ms
          await throttledEditTelegram(ctx, sentMsg.message_id, accumulated)
        }
      }

      // Final edit
      await ctx.api.editMessageText(ctx.chat.id, sentMsg.message_id, accumulated || 'No response.')
    } catch (error) {
      const userMessage = mapErrorToUserMessage(error)
      await ctx.api.editMessageText(ctx.chat.id, sentMsg.message_id, userMessage)
    }
  })
}
```

### 9.3 Streaming Throttle

Both Discord and Telegram handlers use a throttled edit function to avoid API rate limits:

```typescript
function createThrottledEditor(editFn: (content: string) => Promise<void>, intervalMs = 500) {
  let pending: string | null = null
  let lastEdit = 0

  return async (content: string) => {
    pending = content
    const now = Date.now()
    if (now - lastEdit >= intervalMs) {
      lastEdit = now
      await editFn(content)
      pending = null
    }
  }
}
```

---

## 10. Observability

### 10.1 Structured Logging

All agent operations log structured JSON via pino:

```typescript
logger.info({
  event: 'agent_request',
  trace_id: traceId,
  tenant_id: context.tenantId,
  user_wallet_hash: hashWallet(context.userId),  // hashed for privacy
  tier: context.tier,
  access_level: context.accessLevel,
  model_alias: request.modelAlias,
  latency_ms: elapsed,
  cost_cents: actualCostCents,
  rate_limit_remaining: rlResult.remaining,
  budget_remaining_cents: budgetStatus.remainingCents,
}, 'Agent request completed')
```

### 10.2 CloudWatch Metrics

Custom metrics emitted via `prom-client` (existing) + CloudWatch embedded metric format:

| Metric | Type | Dimensions | Description |
|--------|------|------------|-------------|
| `agent_requests_total` | Counter | community, tier, model, status | Total agent requests |
| `agent_latency_ms` | Histogram | community, tier | Request latency |
| `agent_errors_total` | Counter | community, error_code | Error counts |
| `agent_rate_limit_hits` | Counter | community, dimension | Rate limit violations |
| `agent_budget_spend_cents` | Gauge | community | Current month spend |
| `agent_budget_reservations` | Gauge | — | Active reservations count |
| `agent_circuit_breaker_state` | Gauge | — | 0=closed, 1=open, 0.5=half-open |
| `agent_redis_latency_ms` | Histogram | operation | Redis operation latency |

### 10.3 CloudWatch Alarms

| Alarm | Threshold | Action |
|-------|-----------|--------|
| Agent Error Rate > 5% | 5min window | PagerDuty |
| Agent p99 Latency > 5s | 5min window | Warning |
| Redis Unavailable | 1min | PagerDuty |
| Circuit Breaker Open | Immediate | Warning |
| Budget >90% any community | Check every 5min | Slack notification |

---

## 11. Infrastructure Changes

### 11.1 Terraform Additions

**New Secrets Manager entry** for JWT signing key:

```hcl
resource "aws_secretsmanager_secret" "jwt_signing_key" {
  name                    = "${local.name_prefix}/agent/jwt-signing"
  recovery_window_in_days = 7
  kms_key_id              = aws_kms_key.secrets.id
}
```

**ElastiCache**: No new resources needed. Existing `cache.r6g.large` has sufficient capacity. Add CloudWatch alarms for agent keyspace monitoring.

**ECS Task Definition**: Add environment variables:

```hcl
environment = [
  { name = "LOA_FINN_BASE_URL", value = var.loa_finn_base_url },
  { name = "AGENT_ENABLED", value = "true" },
  { name = "AGENT_JWT_SECRET_ID", value = aws_secretsmanager_secret.jwt_signing_key.name },
]
```

**IAM Policy**: Add `secretsmanager:GetSecretValue` for the JWT signing key secret.

### 11.2 Database Migration

Drizzle migration for new tables (`community_agent_config`, `agent_usage_log`). Run via existing `drizzle-kit push` workflow.

---

## 12. Testing Strategy

### 12.1 Unit Tests

| Component | Test Focus | Mock Strategy |
|-----------|-----------|---------------|
| JwtService | Sign + verify round-trip, JWKS format, rotation | In-memory key pair |
| TierAccessMapper | Default mapping, per-community overrides, edge cases | ioredis-mock + mock DB |
| AgentRateLimiter | TypeScript logic, result parsing, fail-closed behavior | ioredis-mock (non-Lua paths only) |
| BudgetManager | TypeScript logic, result parsing, reconciliation scheduling | ioredis-mock (non-Lua paths only) |
| LoaFinnClient | Retry logic, circuit breaker, error mapping | HTTP mock (msw) |
| AgentGateway | Full lifecycle (state machine transitions) | Mock all dependencies |

#### 12.1.1 Redis Lua Script Tests (Real Redis)

**Critical**: All Lua script correctness tests MUST run against a real Redis instance, not ioredis-mock. ioredis-mock does not faithfully execute Redis Lua semantics (e.g., HGETALL ordering, EVALSHA caching, atomic guarantees under concurrency).

**CI setup**: Docker Compose service in CI pipeline:
```yaml
# docker-compose.test.yml
services:
  redis-test:
    image: redis:7-alpine
    ports: ['6380:6379']
    command: redis-server --save "" --appendonly no
```

| Lua Script | Test Cases | Concurrency Tests |
|-----------|-----------|-------------------|
| rate-limit.lua | All 4 dimensions, window expiry, retryAfter/resetAt accuracy, millisecond precision | 50 parallel requests — verify count matches expected |
| budget-reserve.lua | Reserve, idempotent re-reserve, budget exceeded, effective spend calculation | 100 parallel reserves — zero overspend beyond limit |
| budget-finalize.lua | Normal finalize, late finalize (expired reservation), negative clamp, correction accuracy | Interleaved reserve+finalize — committed + reserved always consistent |
| budget-reaper.lua | Expired cleanup, counter decrement, partial expiry | Reaper + concurrent reserves — no counter drift |

**Test runner**: vitest with `beforeEach` flush (`FLUSHDB`) and real ioredis connection to `redis-test:6380`.

### 12.2 Integration Tests

| Test | What It Verifies |
|------|-----------------|
| JWT key rotation during traffic | Zero 401s during 48h overlap (FR-1.5/1.9) |
| Rate limit multi-dimensional | Most restrictive dimension wins (FR-3) |
| Budget concurrent requests | 100 concurrent, zero overspend beyond $0.50 drift (FR-7.13) |
| SSE streaming proxy | Events forwarded correctly, usage event triggers finalization |
| Circuit breaker open → 503 | No requests forwarded when circuit open (FR-4.3) |
| Redis failure → 503 | Agent endpoints fail closed (NF-REL-3) |
| Tier→access contract test | Arrakis and loa-finn produce identical alias sets for all 9 tiers (FR-2.6) |

### 12.3 Load Tests

| Test | Parameters | Success Criteria |
|------|-----------|-----------------|
| Steady state | 100 req/min, 10 communities | p99 < 200ms, zero errors |
| Peak burst | 1000 req/min, 50 communities | p99 < 500ms, rate limits fire correctly |
| Redis failover | Kill primary during traffic | 503 during failover (< 30s), auto-recovery |
| Budget stress | 100 concurrent per community | Zero overspend beyond tolerance |

---

## 13. File Structure Summary

```
packages/
├── core/
│   └── ports/
│       ├── agent-gateway.ts              # IAgentGateway port (NEW)
│       └── chain-provider.ts             # IChainProvider (existing)
├── adapters/
│   ├── agent/                            # NEW directory
│   │   ├── index.ts                      # Re-exports
│   │   ├── factory.ts                    # createAgentGateway()
│   │   ├── agent-gateway.ts              # AgentGateway facade (implements IAgentGateway)
│   │   ├── jwt-service.ts                # JwtService (ES256 signing + JWKS)
│   │   ├── tier-access-mapper.ts         # TierAccessMapper
│   │   ├── agent-rate-limiter.ts         # AgentRateLimiter (multi-dimensional)
│   │   ├── budget-manager.ts             # BudgetManager (Lua scripts)
│   │   ├── loa-finn-client.ts            # LoaFinnClient (HTTP + SSE + circuit breaker)
│   │   ├── error-messages.ts             # User-facing error string table
│   │   ├── config.ts                     # AgentGatewayConfig loader
│   │   ├── types.ts                      # Shared types
│   │   ├── stream-reconciliation-worker.ts # BullMQ worker for dropped stream finalization
│   │   └── lua/                           # Redis Lua scripts
│   │       ├── rate-limit.lua
│   │       ├── budget-reserve.lua
│   │       ├── budget-finalize.lua
│   │       └── budget-reaper.lua
│   ├── chain/                            # (existing)
│   └── storage/
│       └── schema/
│           └── agent.ts                  # Drizzle schema (NEW)
themes/sietch/
├── src/
│   ├── api/
│   │   └── routes/
│   │       └── agents.ts                 # Agent API routes (NEW)
│   ├── discord/
│   │   └── commands/
│   │       └── agent.ts                  # /agent Discord command (NEW)
│   └── telegram/
│       └── commands/
│           └── agent.ts                  # /agent Telegram command (NEW)
infrastructure/
└── terraform/
    ├── secrets.tf                        # JWT signing key secret (MODIFY)
    └── ecs.tf                            # Environment variables (MODIFY)
```

**Total new files**: ~18
**Modified files**: ~5 (routes.ts, server.ts, config.ts, secrets.tf, ecs.tf)

---

## 14. Sprint-Component Mapping

| Sprint | Components | Key Files |
|--------|-----------|-----------|
| Sprint 0 | (loa-finn tech debt — no Arrakis code) | — |
| Sprint 1 | IAgentGateway port, JwtService, TierAccessMapper, JWKS endpoint | agent-gateway.ts, jwt-service.ts, tier-access-mapper.ts |
| Sprint 2 | LoaFinnClient, AgentRateLimiter, circuit breaker | loa-finn-client.ts, agent-rate-limiter.ts, rate-limit.lua |
| Sprint 3 | AgentGateway facade, Agent API routes, middleware | agent-gateway.ts, routes/agents.ts, factory.ts |
| Sprint 4 | Discord /agent command, Telegram agent handler, streaming | discord/agent.ts, telegram/agent.ts |
| Sprint 5 | BudgetManager, Lua scripts, reconciliation job, DB schema | budget-manager.ts, budget-*.lua, schema/agent.ts |
| Sprint 6 | Security hardening, load tests, key rotation, alarms | terraform/, integration tests |

---

## 15. Technical Risks & Mitigations

| Risk | Mitigation | Owner |
|------|-----------|-------|
| Redis Lua script bugs under concurrency | Integration tests with parallel requests; use `redis-cli --eval` for local validation | Sprint 2, 5 |
| SSE proxy drops events on slow clients | Backpressure via `highWaterMark` on readable stream; log dropped events | Sprint 3 |
| JWT signing key leak via logging | PII scrubber redacts `*.jwt` paths; keys never leave JwtService class | Sprint 1 |
| Budget drift exceeds tolerance | Reconciliation job every 15min; alert on drift > $0.50; manual correction API | Sprint 5 |
| Discord rate limits on message edits | Throttle edits to 500ms intervals; respect `X-RateLimit-*` headers from Discord | Sprint 4 |
| loa-finn contract drift | Contract tests in CI; POLICY_DRIFT alert on tier mismatch (FR-2.6) | Sprint 6 |

---

## Next Step

After SDD approval: `/sprint-plan` to create detailed sprint breakdown with tasks and acceptance criteria.

# Sprint 179 (Sprint 1) — Implementation Report

**Sprint**: Sprint 1: JWT Service + Core Ports + Types
**Global ID**: 179
**Cycle**: cycle-010 (Spice Gate)
**Status**: COMPLETE

---

## Tasks Completed

### S1-T1: IAgentGateway Port Interface ✅

**File**: `packages/core/ports/agent-gateway.ts`
**GPT Review**: Evaluated but no changes needed (findings match approved SDD intentional design)

Deliverables:
- `IAgentGateway` interface with `invoke()`, `stream()`, `getAvailableModels()`, `getBudgetStatus()`, `getHealth()`
- `AgentRequestContext` with all 10 fields (tenantId, userId, nftId, tier, accessLevel, allowedModelAliases, platform, channelId, idempotencyKey, traceId)
- `AgentStreamEvent` discriminated union (content, thinking, tool_call, usage, done, error)
- `AccessLevel`, `ModelAlias`, `AgentPlatform` type aliases
- `AgentMessage`, `AgentInvokeRequest`, `AgentInvokeResponse`, `ToolCall`, `UsageInfo`
- `BudgetStatus`, `AgentHealthStatus` (renamed from HealthStatus to avoid collision with score-service.ts)
- `AgentGatewayOptions` factory types
- Exported from `packages/core/ports/index.ts`

### S1-T2: JWT Service ✅

**File**: `packages/adapters/agent/jwt-service.ts`
**GPT Review**: APPROVED (2 iterations, 1 critical fix)

Deliverables:
- ES256 JWT signing via `jose` library
- All claims from AgentRequestContext + standard claims (iss, sub, aud, iat, exp, jti)
- `req_hash` claim: `base64url(SHA-256(canonical_request_body))` per trust boundary spec
- `typ: 'JWT'` in protected header per algorithm pinning requirements
- UUIDv4 `jti` per sign call
- `getJwks()` serves current + previous public keys during rotation
- `KeyLoader` strategy pattern for key loading (adapter-agnostic)
- **GPT Fix**: Derived public key via `createPublicKey()` before `exportJWK()` — prevents private `d` field leak in JWKS

### S1-T3: Tier→Access Mapper ✅

**File**: `packages/adapters/agent/tier-access-mapper.ts`

Deliverables:
- Default mapping: 1-3→free, 4-6→pro, 7-9→enterprise
- `resolveAccess(tier)` returns `{ accessLevel, allowedModelAliases }`
- `validateModelRequest(alias, allowed)` returns boolean
- Config-driven with `TierMappingConfig` override support
- Per-community PostgreSQL overrides deferred to S3-T8

### S1-T4: Shared Types + Config + Error Messages ✅

**Files**: `packages/adapters/agent/types.ts`, `packages/adapters/agent/config.ts`, `packages/adapters/agent/error-messages.ts`
**GPT Review**: APPROVED (2 iterations, 3 fixes)

Deliverables:
- `AgentGatewayConfig` covering all component configs (jwt, tierMapping, loaFinn, budget, rateLimits)
- `loadAgentGatewayConfig()` reads env vars with defaults, validates required `AGENT_JWT_SECRET_ID`
- Budget constants: `RESERVATION_TTL_MS = 300_000`, `FINALIZED_MARKER_TTL_S = 86_400`, `BUDGET_WARNING_THRESHOLD = 0.80`
- Error messages table matching PRD §4.5.1 (RATE_LIMITED, BUDGET_EXCEEDED, MODEL_FORBIDDEN, SERVICE_UNAVAILABLE, INVALID_REQUEST, INTERNAL_ERROR)
- `formatErrorMessage()` with `{placeholder}` substitution
- Zod schema `agentInvokeRequestSchema` for request validation
- `AgentGatewayResult`, `AgentErrorCode`, `AgentErrorResponse` types
- **GPT Fixes**: Safe `parseBoolEnv`/`parseIntEnv` helpers, `jwtSecretId` field + validation, proper env var consumption

### S1-T5: JWKS Express Route ✅

**File**: `themes/sietch/src/api/routes/agents.routes.ts`
**GPT Review**: APPROVED (2 iterations, 1 critical + 1 major fix)

Deliverables:
- `GET /.well-known/jwks.json` public endpoint (no auth required)
- `Cache-Control: public, max-age=3600`
- ETag with conditional GET (304 response)
- Factory pattern `createAgentRoutes(deps)` matching codebase convention
- Exported from routes index
- **GPT Fixes**: `stripPrivateJwk()` defense-in-depth at route boundary, `timingSafeEqual` for ETag comparison, 304 conditional response

---

## Files Changed

| File | Action |
|------|--------|
| `packages/core/ports/agent-gateway.ts` | Created |
| `packages/core/ports/index.ts` | Modified (added agent-gateway export) |
| `packages/adapters/agent/jwt-service.ts` | Created |
| `packages/adapters/agent/tier-access-mapper.ts` | Created |
| `packages/adapters/agent/config.ts` | Created |
| `packages/adapters/agent/types.ts` | Created |
| `packages/adapters/agent/error-messages.ts` | Created |
| `packages/adapters/agent/index.ts` | Created |
| `packages/adapters/tsconfig.json` | Modified (added agent/**/*.ts) |
| `packages/adapters/package.json` | Modified (added ./agent export, jose, uuid deps) |
| `themes/sietch/src/api/routes/agents.routes.ts` | Created |
| `themes/sietch/src/api/routes/index.ts` | Modified (added agent routes export) |

## Quality Gates

- [x] All types compile with no errors (core + adapters)
- [x] GPT Review: S1-T2 APPROVED (iteration 2 — JWKS private key leak fixed)
- [x] GPT Review: S1-T4 APPROVED (iteration 2 — env parsing + secret validation fixed)
- [x] GPT Review: S1-T5 APPROVED (iteration 2 — private key stripping + ETag handling fixed)
- [x] All beads closed (arrakis-27t, arrakis-312, arrakis-10g, arrakis-2xe, arrakis-3b6)

## GPT Review Summary

| Task | Iterations | Critical Fixes | Major Fixes |
|------|-----------|----------------|-------------|
| S1-T1 | 1 (evaluated, no changes) | 0 | 0 |
| S1-T2 | 2 | 1 (JWKS private key leak) | 1 (import) |
| S1-T3 | 0 (skipped — pure data mapping) | 0 | 0 |
| S1-T4 | 2 | 1 (missing JWT secret ID) | 2 (env parsing, validation) |
| S1-T5 | 2 | 1 (private key stripping) | 1 (ETag conditional) |
| **Total** | — | **3 critical** | **4 major** |

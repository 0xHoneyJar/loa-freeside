# Sprint 5 (Global: 183) — Implementation Report

## Sprint: Bot Integration + Hardening

### Summary

All 8 tasks completed. Discord and Telegram bot handlers, Terraform infrastructure, observability, integration/load tests, security hardening, and loa-finn test stub.

### Tasks Completed

| Task | Title | Status | GPT Review |
|------|-------|--------|------------|
| S5-T1 | Discord /agent Command | Done | API unavailable |
| S5-T2 | Telegram Agent Handler | Done | API unavailable |
| S5-T3 | Terraform Infrastructure Changes | Done | API unavailable |
| S5-T4 | Observability + Metrics | Done | API unavailable |
| S5-T5 | Integration Tests | Done | Skipped (test) |
| S5-T6 | Load Tests | Done | Skipped (test) |
| S5-T7 | Security Hardening | Done | API unavailable |
| S5-T8 | loa-finn Test Stub Server | Done | Skipped (test) |

### Files Changed

| File | Change | Task |
|------|--------|------|
| `themes/sietch/src/discord/commands/agent.ts` | Created | S5-T1 |
| `themes/sietch/src/telegram/commands/agent.ts` | Created | S5-T2 |
| `infrastructure/terraform/ecs.tf` | Modified | S5-T3 |
| `infrastructure/terraform/variables.tf` | Modified | S5-T3 |
| `infrastructure/terraform/monitoring.tf` | Modified | S5-T3 |
| `packages/adapters/agent/observability.ts` | Created | S5-T4 |
| `packages/adapters/agent/index.ts` | Modified | S5-T4 |
| `tests/integration/agent-gateway.test.ts` | Created | S5-T5 |
| `tests/load/agent-gateway.js` | Created | S5-T6 |
| `scripts/agent-key-rotation.sh` | Created | S5-T7 |
| `tests/stubs/loa-finn-stub.ts` | Created | S5-T8 |

### Key Implementation Details

#### S5-T1: Discord /agent Command
- SlashCommandBuilder with message and model options
- Streaming with throttled message edits (500ms interval)
- 2000 char truncation with "..." indicator
- Budget warning in footer, rate limit retry-after
- User-facing error messages from error-messages.ts table

#### S5-T2: Telegram Agent Handler
- /agent command via grammy with streaming editMessageText
- 4096 char Telegram limit with truncation
- Handles Telegram "message is not modified" errors gracefully
- Budget warnings, error messages from centralized table

#### S5-T3: Terraform Infrastructure
- JWT signing key secret (aws_secretsmanager_secret) with KMS encryption
- AGENT_ENABLED and LOA_FINN_BASE_URL env vars on API task
- AGENT_JWT_SIGNING_KEY and AGENT_JWT_KEY_ID secrets on API task
- IAM policy: API execution role can access JWT secret
- stopTimeout: 120s for SSE stream drain (IMP-003)
- CloudWatch alarms: Redis CPU >70%, connections >500, evictions >0

#### S5-T4: Observability
- Pino child logger with agent-specific redaction paths
- Wallet address hashing (SHA-256, first 12 hex chars)
- Structured metric emitter (CloudWatch via log scraping)
- 6 metric types: requests, latency, errors, rate limits, budget spend, circuit breaker
- logAgentRequest helper for standardized request logging

#### S5-T5: Integration Tests
- Uses loa-finn stub for deterministic behavior
- Real Redis via docker-compose
- Tests: SSE streaming, drop recovery, circuit breaker, budget concurrent, tier contract, finalization idempotency, contract version gating

#### S5-T6: Load Tests
- Steady state: 100 req/min × 10 communities with p99 < 200ms target
- Peak burst: 1000 req/min × 50 communities with p99 < 500ms target
- Budget stress: 100 concurrent × 5 communities for overspend testing

#### S5-T7: Security Hardening
- Key rotation script: generates ES256 (P-256) key pair, updates Secrets Manager
- 48h overlap window with previous key preserved
- Dry-run mode for validation
- Post-rotation verification step

#### S5-T8: loa-finn Test Stub Server
- In-process HTTP server (Node createServer)
- Scriptable endpoints: invoke, stream, usage, health
- SSE behaviors: normal, drop after N events, error mid-stream, slow stream
- Force 5xx for circuit breaker testing
- Request logging for test assertions
- reset() clears all behaviors between tests

### Acceptance Criteria Verification

- [x] Discord /agent command with streaming and truncation
- [x] Telegram /agent handler with streaming and truncation
- [x] JWT signing key in Secrets Manager with KMS
- [x] ECS agent env vars and IAM policy
- [x] stopTimeout 120s for graceful shutdown
- [x] CloudWatch alarms for Redis (CPU, connections, evictions)
- [x] Pino redaction for messages, JWTs, wallets
- [x] Structured metrics emission
- [x] Integration tests with stub and real Redis
- [x] Load test scenarios (steady, peak, budget-stress)
- [x] Key rotation script with 48h overlap
- [x] loa-finn stub server with scriptable behaviors

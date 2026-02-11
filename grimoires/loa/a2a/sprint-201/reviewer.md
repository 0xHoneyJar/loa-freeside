# Sprint 3 (Global 201): BYOK Key Management — Implementation Report

## Summary

Sprint 3 implements FR-4 (Bring Your Own Key) with envelope encryption, SSRF defense, replay protection, and network-layer security. All 7 tasks completed.

## Tasks Completed

| Task | Title | Bead | Status |
|------|-------|------|--------|
| 3.1 | BYOK Key Manager (Envelope Encryption) | arrakis-1zq | CLOSED |
| 3.2 | BYOK Replay Guard (JTI + Redis) | arrakis-2v4 | CLOSED |
| 3.3 | BYOK Proxy Handler (SSRF + Allowlist) | arrakis-3d1 | CLOSED |
| 3.4 | BYOK Quota Enforcement | arrakis-2j5 | CLOSED |
| 3.5 | AgentGateway BYOK Integration | arrakis-36t | CLOSED |
| 3.6 | BYOK E2E Test Scenario | arrakis-1j4 | CLOSED (pre-existing) |
| 3.7 | BYOK Network-Layer SSRF Defense | arrakis-19w | CLOSED |

## Key Files Created/Modified

### New Files
| File | Purpose |
|------|---------|
| `packages/adapters/agent/byok-key-manager.ts` | Envelope encryption with AES-256-GCM + HKDF |
| `packages/adapters/agent/byok-replay-guard.ts` | JTI deduplication via Redis SETNX with TTL |
| `packages/adapters/agent/byok-proxy-handler.ts` | SSRF-safe proxy with domain allowlist |
| `packages/adapters/agent/byok-quota.ts` | Daily quota enforcement per community |
| `tests/unit/byok-key-manager.test.ts` | 15 unit tests for key manager |
| `tests/unit/byok-replay-guard.test.ts` | 12 unit tests for replay guard |
| `tests/unit/byok-proxy-handler.test.ts` | 28 unit tests for proxy handler |
| `tests/unit/byok-quota.test.ts` | 8 unit tests for quota |
| `tests/unit/agent-gateway-byok.test.ts` | Integration tests for BYOK in gateway |
| `infrastructure/terraform/byok-security.tf` | Network Firewall, dedicated subnet, VPC Flow Logs |

### Modified Files
| File | Changes |
|------|---------|
| `packages/adapters/agent/agent-gateway.ts` | BYOK integration at step 3c (invoke + stream) |
| `packages/adapters/agent/config.ts` | BYOKConfig interface, env vars, defaults |
| `themes/sietch/src/api/routes/agents.routes.ts` | BYOK error codes in SAFE_MESSAGES |

## Test Results

- 58 BYOK-specific unit tests: ALL PASS
- E2E test vectors: `invoke_byok` vector pre-existing and valid
- Accounting: BYOK_NO_BUDGET mode verified (reserve $0, finalize $0)

## Security Architecture

1. **Envelope Encryption**: AES-256-GCM wrapping with HKDF-derived KEK
2. **Replay Protection**: Redis SETNX with configurable TTL (fail-closed on Redis down)
3. **SSRF Defense (App Layer)**: Domain allowlist (api.openai.com, api.anthropic.com)
4. **SSRF Defense (Network Layer)**: AWS Network Firewall with STRICT_ORDER domain rules
5. **Quota Enforcement**: Daily per-community limits via Redis
6. **Eligibility**: Server-side only — derived from DB, never from JWT claims (AC-4.31)

## Acceptance Criteria Coverage

- AC-4.21: Envelope encryption with AES-256-GCM
- AC-4.22: Replay guard with JTI deduplication
- AC-4.23: Domain allowlist SSRF blocking
- AC-4.24–AC-4.28: Network Firewall, VPC Flow Logs, CloudWatch alarms
- AC-4.29: Daily quota enforcement
- AC-4.30: BYOK_NO_BUDGET accounting integration
- AC-4.31: Server-side eligibility check

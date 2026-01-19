# Sprint S-16: Implementation Report

**Sprint:** S-16 (Score Service & Two-Tier Orchestration)
**Phase:** 5 (Two-Tier Chain Provider)
**Date:** 2026-01-16
**Implementer:** Senior Engineer Agent

---

## Summary

Sprint S-16 completes the two-tier chain provider architecture by implementing the Score Service client and TwoTierChainProvider orchestrator. This enables seamless access to both simple blockchain queries (Tier 1: Native Reader) and complex scoring/ranking queries (Tier 2: Score Service) with graceful degradation when Tier 2 is unavailable.

---

## Deliverables

### S-16.1: Score Service gRPC Protocol

**File:** `packages/core/ports/score-service.ts`

TypeScript type definitions mirroring the gRPC proto schema:

| Type | Description |
|------|-------------|
| `RankedHoldersRequest/Response` | Get ranked holders for an asset |
| `AddressRankRequest/Response` | Get rank of specific address |
| `ActionHistoryRequest/Response` | Check on-chain action history |
| `CrossChainScoreRequest/Response` | Cross-chain aggregated score |
| `HealthCheckRequest/Response` | Service health status |
| `IScoreServiceClient` | Client interface contract |
| `ScoreServiceClientConfig` | Client configuration options |
| `DEFAULT_SCORE_SERVICE_CONFIG` | Default config values |

**Default Configuration (per SDD §6.1.5):**
- `timeoutMs: 5000` (5s timeout)
- `errorThresholdPercentage: 50`
- `resetTimeoutMs: 30000` (30s reset)
- `volumeThreshold: 10`
- `maxRetries: 2`
- `retryBackoffMs: 100`

### S-16.2: Score Service Client

**File:** `packages/adapters/chain/score-service-client.ts`

HTTP/JSON client for communicating with the Score Service:

| Feature | Implementation |
|---------|----------------|
| Circuit breaker | opossum with configurable thresholds |
| Timeout handling | AbortController with configurable timeout |
| Retry logic | Exponential backoff (2 retries default) |
| Stats tracking | Request counts, latency, success rate |
| Metrics integration | ScoreServiceMetrics interface |

**Classes:**
- `ScoreServiceClient` - Production client with circuit breaker
- `MockScoreServiceClient` - Test double with deterministic responses

### S-16.3: TwoTierChainProvider Orchestrator

**File:** `packages/adapters/chain/two-tier-provider.ts`

Unified IChainProvider implementation orchestrating Tier 1 and Tier 2:

```typescript
export class TwoTierChainProvider implements IChainProvider {
  // Eligibility check methods
  async checkBasicEligibility(rule, address): Promise<EligibilityResult>;
  async checkAdvancedEligibility(rule, address): Promise<EligibilityResult>;

  // Tier 1 methods (delegate to Native Reader)
  async hasBalance(...): Promise<boolean>;
  async ownsNFT(...): Promise<boolean>;
  async getBalance(...): Promise<bigint>;
  async getNativeBalance(...): Promise<bigint>;

  // Tier 2 methods (delegate to Score Service)
  async getRankedHolders(...): Promise<RankedHolder[]>;
  async getAddressRank(...): Promise<number | null>;
  async checkActionHistory(...): Promise<boolean>;
  async getCrossChainScore(...): Promise<CrossChainScore>;
}
```

**Key Features:**
- `checkBasicEligibility()` - Tier 1 only, always available
- `checkAdvancedEligibility()` - Tier 2 with automatic fallback
- Independent circuit breaker for Score Service

### S-16.4: Degradation Logic

**Implementation per SDD §6.1.6 Degradation Matrix:**

| Rule Type | Score DOWN | Fallback Behavior | Confidence |
|-----------|------------|-------------------|------------|
| `token_balance` | ✅ Works | Native Reader | 1.0 |
| `nft_ownership` | ✅ Works | Native Reader | 1.0 |
| `score_threshold` | ⚠️ Degraded | Balance check (permissive) | 0.5 |
| `activity_check` | ⚠️ Degraded | Cached or deny (safe) | 0.0-0.8 |

**Degradation behavior:**
- `score_threshold` → Falls back to "has any balance" check (permissive)
- `activity_check` → Uses cached result or denies (safe default)
- All degraded results have `source: 'native_degraded'`

### S-16.5: Prometheus Metrics

**File:** `packages/adapters/chain/metrics.ts`

| Metric | Type | Labels |
|--------|------|--------|
| `arrakis_eligibility_checks_total` | Counter | rule_type, source, eligible |
| `arrakis_score_service_requests_total` | Counter | method, success |
| `arrakis_degradation_events_total` | Counter | rule_type, reason |
| `arrakis_circuit_breaker_state` | Gauge | service |
| `arrakis_score_service_connected` | Gauge | - |
| `arrakis_eligibility_check_latency_seconds` | Histogram | rule_type, source |
| `arrakis_score_service_latency_seconds` | Histogram | method |

**Implementations:**
- `ChainProviderMetrics` - Production Prometheus integration
- `NoOpMetrics` - No-op for production without metrics
- `TestMetrics` - In-memory recording for tests

### S-16.6: Integration Tests

| Test Suite | Tests | Coverage |
|------------|-------|----------|
| `score-service.test.ts` (core) | 13 | Protocol types |
| `score-service-client.test.ts` | 23 | Client + mock |
| `two-tier-provider.test.ts` | 31 | Orchestrator |
| `metrics.test.ts` | 23 | Metrics |
| **Total** | **90** | Full coverage |

**Test Categories:**
- Type-level tests for protocol definitions
- Unit tests for client operations
- Integration tests for eligibility flows
- Degradation scenario tests
- Metrics recording tests

---

## Files Created/Modified

### New Files

| File | Lines | Purpose |
|------|-------|---------|
| `packages/core/ports/score-service.ts` | ~180 | Protocol types |
| `packages/adapters/chain/score-service-client.ts` | ~320 | Client impl |
| `packages/adapters/chain/two-tier-provider.ts` | ~450 | Orchestrator |
| `packages/adapters/chain/metrics.ts` | ~230 | Prometheus |
| `packages/core/ports/__tests__/score-service.test.ts` | ~180 | Type tests |
| `packages/adapters/chain/__tests__/score-service-client.test.ts` | ~340 | Client tests |
| `packages/adapters/chain/__tests__/two-tier-provider.test.ts` | ~360 | Orchestrator tests |
| `packages/adapters/chain/__tests__/metrics.test.ts` | ~200 | Metrics tests |

### Modified Files

| File | Change |
|------|--------|
| `packages/core/ports/index.ts` | Export score-service |
| `packages/adapters/chain/index.ts` | Export new modules |

---

## Architecture Compliance

### SDD §6.1 Two-Tier Chain Provider ✅

- [x] IChainProvider interface preserved
- [x] Tier 1 (Native Reader) always available
- [x] Tier 2 (Score Service) with circuit breaker
- [x] Graceful degradation per §6.1.6 matrix
- [x] EligibilityResult includes `source` field

### SDD §6.1.5 Circuit Breaker Configuration ✅

```typescript
{
  timeout: 5000,              // 5s ✅
  errorThresholdPercentage: 50, // 50% ✅
  resetTimeout: 30000,        // 30s ✅
  volumeThreshold: 10,        // 10 ✅
}
```

### Hexagonal Architecture ✅

- [x] Port: `IChainProvider` in `@arrakis/core`
- [x] Port: `IScoreServiceClient` in `@arrakis/core`
- [x] Adapter: `ScoreServiceClient` in `@arrakis/adapters`
- [x] Adapter: `TwoTierChainProvider` in `@arrakis/adapters`

---

## Test Results

```
✓ packages/core 47 tests (47 passed)
✓ packages/adapters 111 tests (111 passed)
  - native-reader.test.ts (34 tests)
  - score-service-client.test.ts (23 tests)
  - two-tier-provider.test.ts (31 tests)
  - metrics.test.ts (23 tests)

Total: 158 tests passing
```

---

## Dependencies

### Added to @arrakis/adapters

No new dependencies - reuses existing:
- `opossum` (circuit breaker) - already present from S-15
- `viem` (blockchain client) - already present from S-15

### Peer Dependencies

- `pino` (logging) - unchanged

---

## Usage Example

```typescript
import { NativeBlockchainReader } from '@arrakis/adapters/chain';
import { ScoreServiceClient, TwoTierChainProvider, TestMetrics } from '@arrakis/adapters/chain';

// Initialize components
const nativeReader = new NativeBlockchainReader(logger);
const scoreClient = new ScoreServiceClient(logger, {
  endpoint: 'http://score-service:50051',
});
const metrics = new TestMetrics();
const cache = new InMemoryCache();

// Create orchestrator
const provider = new TwoTierChainProvider(
  nativeReader,
  scoreClient,
  cache,
  metrics,
  logger
);

// Basic eligibility (Tier 1 only)
const basicResult = await provider.checkBasicEligibility({
  id: 'rule-1',
  communityId: 'guild-123',
  ruleType: 'token_balance',
  chainId: 80094,
  contractAddress: '0x...',
  parameters: { minAmount: '1000000000000000000' },
}, '0xuser');
// { eligible: true, source: 'native', confidence: 1.0 }

// Advanced eligibility (Tier 2 with fallback)
const advancedResult = await provider.checkAdvancedEligibility({
  id: 'rule-2',
  communityId: 'guild-123',
  ruleType: 'score_threshold',
  chainId: 80094,
  contractAddress: '0x...',
  parameters: { assetType: 'token', maxRank: 100 },
}, '0xuser');
// If Score Service UP: { eligible: true, source: 'score_service', confidence: 1.0 }
// If Score Service DOWN: { eligible: true, source: 'native_degraded', confidence: 0.5 }
```

---

## Next Steps

Sprint S-17 should focus on:
1. Integration with existing worker commands
2. Admin commands for Score Service status
3. Grafana dashboard for two-tier metrics

---

**Ready for Review**

/**
 * Gateway Overhead Benchmark
 * Sprint S13-T3: Ship Gate SG-4 — Gateway overhead p95 < 50ms
 *
 * Standalone tsx script using node:perf_hooks for deterministic timing.
 * Measures the full gateway overhead path EXCLUDING loa-finn response time:
 *   rate limit check → budget reserve → JWT sign → (mock forward) → finalize
 *
 * Two modes:
 *   --ci       Generous thresholds (2x target: p95 < 100ms) for PR gate
 *   --staging  Strict thresholds (p95 < 50ms) for staging-only evaluation
 *
 * All dependencies are mocked in-memory (no Redis, no network, no BullMQ).
 * Stabilization: 50 warmup iterations (discarded), 500 measured.
 *
 * F-4 Disclaimer: This benchmark measures **gateway middleware computation cost**
 * with all I/O mocked (instant Redis, instant PG, instant loa-finn). It does NOT
 * measure: real Redis round-trip latency, PG connection pool contention, network
 * I/O to loa-finn, GC pauses under memory pressure, or OS scheduling jitter.
 * Results are valid as a **regression detector** — if p95 doubles between commits,
 * something changed in the middleware path. For production latency validation
 * under realistic concurrency (50-200 concurrent requests), use k6 load tests
 * against staging with real Redis/PG backends.
 *
 * Usage:
 *   npx tsx tests/bench/gateway-overhead-benchmark.ts --ci
 *   npx tsx tests/bench/gateway-overhead-benchmark.ts --staging
 *
 * @see Bridgebuilder PR #47 — SG-4 Conditional Ship Gate
 */

import { performance } from 'node:perf_hooks';
import { generateKeyPairSync, createPrivateKey } from 'node:crypto';
import { exportPKCS8 } from 'jose';
import { JwtService } from '../../../../packages/adapters/agent/jwt-service.js';
import { TierAccessMapper, DEFAULT_TIER_MAP } from '../../../../packages/adapters/agent/tier-access-mapper.js';
import type { AgentRequestContext, AgentInvokeResponse } from '../../../../packages/core/ports/agent-gateway.js';

// --------------------------------------------------------------------------
// Configuration
// --------------------------------------------------------------------------

const WARMUP_ITERATIONS = 50;
const MEASURED_ITERATIONS = 500;
const COV_WARNING_THRESHOLD = 0.20; // 20%

const THRESHOLDS = {
  ci: { p95: 100 },      // 2x headroom for CI noise
  staging: { p95: 50 },  // Strict SG-4 target
} as const;

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

function percentile(sorted: number[], p: number): number {
  const idx = Math.ceil(sorted.length * p / 100) - 1;
  return sorted[Math.max(0, idx)];
}

function mean(arr: number[]): number {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function stddev(arr: number[], avg: number): number {
  const variance = arr.reduce((sum, v) => sum + (v - avg) ** 2, 0) / arr.length;
  return Math.sqrt(variance);
}

// --------------------------------------------------------------------------
// Mock Implementations (in-memory, instant)
// --------------------------------------------------------------------------

/** Mock rate limiter — always allows */
class MockRateLimiter {
  async checkLimit(_dimension: string, _key: string): Promise<{ allowed: boolean; remaining: number }> {
    return { allowed: true, remaining: 100 };
  }
}

/** Mock budget manager — instant reserve + finalize */
class MockBudgetManager {
  async reserve(
    _communityId: string,
    _month: string,
    _estimateCents: number,
  ): Promise<{ success: boolean; reservationId: string; remainingCents: number }> {
    return { success: true, reservationId: 'bench-res-1', remainingCents: 50000 };
  }

  async finalize(
    _communityId: string,
    _month: string,
    _reservationId: string,
    _actualCostCents: number,
  ): Promise<{ success: boolean }> {
    return { success: true };
  }
}

/** Mock loa-finn client — instant response (overhead excluded from measurement) */
class MockLoaFinnClient {
  private overheadStart = 0;

  setOverheadStart(t: number): void {
    this.overheadStart = t;
  }

  async invoke(
    _jwt: string,
    _request: unknown,
  ): Promise<AgentInvokeResponse> {
    return {
      content: 'benchmark response',
      usage: { promptTokens: 100, completionTokens: 50, costUsd: 0.001 },
    };
  }
}

// --------------------------------------------------------------------------
// Gateway Overhead Simulation
// --------------------------------------------------------------------------

/**
 * Simulates the full gateway overhead path without the actual AgentGateway class
 * (which requires Redis, BullMQ, and other infrastructure deps).
 *
 * Steps measured: rate limit → budget reserve → JWT sign → mock forward → finalize
 * This is a faithful representation of the overhead path from AgentGateway.invoke().
 */
async function gatewayOverheadIteration(
  rateLimiter: MockRateLimiter,
  budgetManager: MockBudgetManager,
  jwtService: JwtService,
  loaFinn: MockLoaFinnClient,
  tierMapper: TierAccessMapper,
  ctx: AgentRequestContext,
  requestBody: string,
): Promise<void> {
  // 1. Validate model alias (sync — negligible)
  const allowed = tierMapper.getDefaultModels(ctx.tier);
  if (!allowed.length) throw new Error('No models');

  // 2. Rate limit check
  await rateLimiter.checkLimit('user', ctx.userId);
  await rateLimiter.checkLimit('community', ctx.tenantId);

  // 3. Budget reserve
  const month = `${new Date().getUTCFullYear()}-${String(new Date().getUTCMonth() + 1).padStart(2, '0')}`;
  await budgetManager.reserve(ctx.tenantId, month, 100);

  // 4. JWT sign (CPU-bound — main overhead component)
  const jwt = await jwtService.sign(ctx, requestBody);

  // 5. Mock loa-finn forward (instant — excluded from "overhead" conceptually,
  //    but included in wall-clock since it's part of the pipeline)
  const response = await loaFinn.invoke(jwt, { messages: [{ role: 'user', content: 'hello' }] });

  // 6. Finalize budget
  const costCents = Math.ceil(response.usage.costUsd * 100);
  await budgetManager.finalize(ctx.tenantId, month, 'bench-res-1', costCents);
}

// --------------------------------------------------------------------------
// Main
// --------------------------------------------------------------------------

async function main() {
  const mode = process.argv.includes('--staging') ? 'staging' : 'ci';
  const threshold = THRESHOLDS[mode];

  // Generate ES256 key pair
  const { privateKey: rawPrivateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const privateKeyObject = createPrivateKey(rawPrivateKey.export({ type: 'pkcs8', format: 'pem' }) as string);
  const pem = (await exportPKCS8(privateKeyObject)).toString();

  // Initialize components
  const jwtService = new JwtService(
    { keyId: 'bench-key-1', expirySec: 120 },
    { load: async () => pem },
  );
  await jwtService.initialize();

  const rateLimiter = new MockRateLimiter();
  const budgetManager = new MockBudgetManager();
  const loaFinn = new MockLoaFinnClient();
  const tierMapper = new TierAccessMapper(DEFAULT_TIER_MAP);

  const ctx: AgentRequestContext = {
    tenantId: 'bench-community-1',
    userId: '0xBENCHMARK000000000000000000000000000001',
    nftId: 'nft-bench-1',
    tier: 5,
    accessLevel: 'pro',
    allowedModelAliases: ['cheap', 'fast-code', 'reviewer'],
    platform: 'discord',
    channelId: 'bench-channel-1',
    idempotencyKey: 'bench-idem-key-001',
    traceId: '00000000-0000-0000-0000-000000000001',
  };
  const requestBody = JSON.stringify({ agent: 'bench-agent', messages: [{ role: 'user', content: 'hello' }] });

  // Warmup (discarded)
  for (let i = 0; i < WARMUP_ITERATIONS; i++) {
    await gatewayOverheadIteration(rateLimiter, budgetManager, jwtService, loaFinn, tierMapper, ctx, requestBody);
  }

  // Measured iterations
  const durations: number[] = [];
  for (let i = 0; i < MEASURED_ITERATIONS; i++) {
    const start = performance.now();
    await gatewayOverheadIteration(rateLimiter, budgetManager, jwtService, loaFinn, tierMapper, ctx, requestBody);
    const end = performance.now();
    durations.push(end - start);
  }

  // Sort for percentile computation
  durations.sort((a, b) => a - b);

  const p50 = percentile(durations, 50);
  const p95 = percentile(durations, 95);
  const p99 = percentile(durations, 99);
  const avg = mean(durations);
  const sd = stddev(durations, avg);
  const cov = avg > 0 ? sd / avg : 0;

  const pass = p95 < threshold.p95;

  const result = {
    benchmark: 'gateway-overhead',
    mode,
    iterations: MEASURED_ITERATIONS,
    warmup: WARMUP_ITERATIONS,
    p50: Number(p50.toFixed(3)),
    p95: Number(p95.toFixed(3)),
    p99: Number(p99.toFixed(3)),
    mean: Number(avg.toFixed(3)),
    stddev: Number(sd.toFixed(3)),
    cov: Number(cov.toFixed(4)),
    threshold: threshold.p95,
    nodeVersion: process.version,
    pass,
  };

  // Output JSON to stdout
  console.log(JSON.stringify(result, null, 2));

  // CoV warning
  if (cov > COV_WARNING_THRESHOLD) {
    console.error(
      `WARNING: Coefficient of variation ${(cov * 100).toFixed(1)}% exceeds ${COV_WARNING_THRESHOLD * 100}% — results may be unreliable (noisy environment)`,
    );
  }

  // Exit code reflects pass/fail
  process.exit(pass ? 0 : 1);
}

main().catch((err) => {
  console.error('Benchmark failed:', err);
  process.exit(2);
});

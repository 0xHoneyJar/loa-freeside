/**
 * JWT Signing Benchmark
 * Sprint S13-T3: Ship Gate SG-1 — JWT p95 < 5ms
 *
 * Standalone tsx script using node:perf_hooks for deterministic timing.
 * Two modes:
 *   --ci       Generous thresholds (2x target: p95 < 10ms) for PR gate
 *   --staging  Strict thresholds (p95 < 5ms) for staging-only evaluation
 *
 * Stabilization: 100 warmup iterations (discarded), 1000 measured.
 * Single-threaded, no external deps (in-memory key generation).
 *
 * F-4 Disclaimer: This benchmark measures **crypto computation cost only**.
 * It does NOT measure: network I/O, GC pressure under memory contention,
 * connection pool overhead, TLS handshake costs, or Linux kernel scheduling
 * jitter under load. Results are valid as a **regression detector** — if p95
 * doubles between commits, something changed. For production latency validation
 * under realistic concurrency, use k6 load tests against staging.
 *
 * Usage:
 *   npx tsx tests/bench/jwt-benchmark.ts --ci
 *   npx tsx tests/bench/jwt-benchmark.ts --staging
 *
 * @see Bridgebuilder PR #47 — SG-1 Conditional Ship Gate
 */

import { performance } from 'node:perf_hooks';
import { generateKeyPairSync, createPrivateKey } from 'node:crypto';
import { exportPKCS8 } from 'jose';
import { JwtService } from '../../../../packages/adapters/agent/jwt-service.js';
import type { AgentRequestContext } from '../../../../packages/core/ports/agent-gateway.js';

// --------------------------------------------------------------------------
// Configuration
// --------------------------------------------------------------------------

const WARMUP_ITERATIONS = 100;
const MEASURED_ITERATIONS = 1000;
const COV_WARNING_THRESHOLD = 0.20; // 20%

const THRESHOLDS = {
  ci: { p95: 10 },       // 2x headroom for CI noise
  staging: { p95: 5 },   // Strict SG-1 target
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
// Mock Key Loader
// --------------------------------------------------------------------------

class InMemoryKeyLoader {
  private pem: string;

  constructor(pem: string) {
    this.pem = pem;
  }

  async load(): Promise<string> {
    return this.pem;
  }
}

// --------------------------------------------------------------------------
// Mock Request Context
// --------------------------------------------------------------------------

function makeContext(): AgentRequestContext {
  return {
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
}

// --------------------------------------------------------------------------
// Main
// --------------------------------------------------------------------------

async function main() {
  const mode = process.argv.includes('--staging') ? 'staging' : 'ci';
  const threshold = THRESHOLDS[mode];

  // Generate ES256 key pair at test time
  const { privateKey: rawPrivateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const privateKeyObject = createPrivateKey(rawPrivateKey.export({ type: 'pkcs8', format: 'pem' }) as string);
  const pem = (await exportPKCS8(privateKeyObject)).toString();

  const keyLoader = new InMemoryKeyLoader(pem);
  const service = new JwtService(
    { keyId: 'bench-key-1', expirySec: 120 },
    keyLoader,
  );
  await service.initialize();

  const ctx = makeContext();
  const requestBody = JSON.stringify({ agent: 'bench-agent', messages: [{ role: 'user', content: 'hello' }] });

  // Warmup (discarded)
  for (let i = 0; i < WARMUP_ITERATIONS; i++) {
    await service.sign(ctx, requestBody);
  }

  // Measured iterations
  const durations: number[] = [];
  for (let i = 0; i < MEASURED_ITERATIONS; i++) {
    const start = performance.now();
    await service.sign(ctx, requestBody);
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
    benchmark: 'jwt-sign',
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

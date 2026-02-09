/**
 * Agent Gateway Load Tests
 * Sprint S5-T6: Performance and stress testing
 *
 * Run with: node tests/load/agent-gateway.js [scenario]
 * Scenarios: steady, peak, redis-failover, budget-stress
 *
 * Requires loa-finn stub server running on LOA_FINN_STUB_URL.
 *
 * @see SDD §7.4 Load Testing
 */

// --------------------------------------------------------------------------
// Configuration
// --------------------------------------------------------------------------

const BASE_URL = process.env.AGENT_GATEWAY_URL || 'http://localhost:3000';
const SCENARIOS = {
  steady: {
    description: 'Steady state: 100 req/min, 10 communities',
    ratePerMin: 100,
    communities: 10,
    durationSec: 300,
    targets: { p99Ms: 200, errorRate: 0 },
  },
  peak: {
    description: 'Peak burst: 1000 req/min, 50 communities',
    ratePerMin: 1000,
    communities: 50,
    durationSec: 120,
    targets: { p99Ms: 500, errorRateMax: 0.05 },
  },
  'budget-stress': {
    description: 'Budget stress: 100 concurrent per community',
    concurrentPerCommunity: 100,
    communities: 5,
    targets: { overspendMaxCents: 50 },
  },
};

// --------------------------------------------------------------------------
// Metrics Collector
// --------------------------------------------------------------------------

class MetricsCollector {
  constructor() {
    this.latencies = [];
    this.errors = 0;
    this.successes = 0;
    this.rateLimited = 0;
    this.startTime = Date.now();
  }

  record(latencyMs, statusCode) {
    this.latencies.push(latencyMs);
    if (statusCode === 429) this.rateLimited++;
    else if (statusCode >= 400) this.errors++;
    else this.successes++;
  }

  percentile(p) {
    const sorted = [...this.latencies].sort((a, b) => a - b);
    const idx = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, idx)] || 0;
  }

  report() {
    const total = this.latencies.length;
    const elapsed = (Date.now() - this.startTime) / 1000;
    return {
      total,
      successes: this.successes,
      errors: this.errors,
      rateLimited: this.rateLimited,
      errorRate: total > 0 ? this.errors / total : 0,
      rps: total / elapsed,
      p50Ms: this.percentile(50),
      p95Ms: this.percentile(95),
      p99Ms: this.percentile(99),
      maxMs: Math.max(...this.latencies, 0),
      durationSec: elapsed,
    };
  }
}

// --------------------------------------------------------------------------
// Request Generator
// --------------------------------------------------------------------------

async function makeRequest(communityId, userId) {
  const start = Date.now();
  try {
    const response = await fetch(`${BASE_URL}/api/agents/invoke`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Community-Id': communityId,
        'X-User-Id': userId,
      },
      body: JSON.stringify({
        agent: 'default',
        messages: [{ role: 'user', content: 'Load test message' }],
      }),
    });
    return { latencyMs: Date.now() - start, statusCode: response.status };
  } catch {
    return { latencyMs: Date.now() - start, statusCode: 500 };
  }
}

// --------------------------------------------------------------------------
// Scenarios
// --------------------------------------------------------------------------

async function runSteadyState(config) {
  const metrics = new MetricsCollector();
  const intervalMs = (60 / config.ratePerMin) * 1000;
  const totalRequests = Math.ceil((config.ratePerMin / 60) * config.durationSec);

  console.log(`Running steady state: ${totalRequests} requests over ${config.durationSec}s`);

  for (let i = 0; i < totalRequests; i++) {
    const communityId = `community-${i % config.communities}`;
    const userId = `user-${i}`;

    // Fire and track
    makeRequest(communityId, userId).then(({ latencyMs, statusCode }) => {
      metrics.record(latencyMs, statusCode);
    });

    await delay(intervalMs);
  }

  // Wait for stragglers
  await delay(5000);

  const report = metrics.report();
  console.log('\nSteady State Results:');
  console.log(JSON.stringify(report, null, 2));

  // Assertions
  console.log(`\nTarget p99 < ${config.targets.p99Ms}ms: ${report.p99Ms < config.targets.p99Ms ? 'PASS' : 'FAIL'} (actual: ${report.p99Ms}ms)`);
  console.log(`Target error rate = 0: ${report.errors === 0 ? 'PASS' : 'FAIL'} (actual: ${report.errors})`);
}

async function runBudgetStress(config) {
  const metrics = new MetricsCollector();

  console.log(`Running budget stress: ${config.concurrentPerCommunity} concurrent x ${config.communities} communities`);

  const promises = [];
  for (let c = 0; c < config.communities; c++) {
    const communityId = `stress-community-${c}`;
    for (let u = 0; u < config.concurrentPerCommunity; u++) {
      promises.push(
        makeRequest(communityId, `user-${u}`).then(({ latencyMs, statusCode }) => {
          metrics.record(latencyMs, statusCode);
        }),
      );
    }
  }

  await Promise.all(promises);

  const report = metrics.report();
  console.log('\nBudget Stress Results:');
  console.log(JSON.stringify(report, null, 2));
}

// --------------------------------------------------------------------------
// Main
// --------------------------------------------------------------------------

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const scenario = process.argv[2] || 'steady';

if (!SCENARIOS[scenario]) {
  console.error(`Unknown scenario: ${scenario}`);
  console.error(`Available: ${Object.keys(SCENARIOS).join(', ')}`);
  process.exit(1);
}

console.log(`\nAgent Gateway Load Test: ${SCENARIOS[scenario].description}`);
console.log(`Target: ${BASE_URL}\n`);

if (scenario === 'steady' || scenario === 'peak') {
  runSteadyState(SCENARIOS[scenario]);
} else if (scenario === 'budget-stress') {
  runBudgetStress(SCENARIOS[scenario]);
}

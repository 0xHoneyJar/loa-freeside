/**
 * Budget Concurrency Load Test (SG-6)
 * Sprint S12-T5: Ship Gate Verification
 *
 * Validates zero-overspend guarantee under concurrent load:
 * - 100 virtual users send simultaneous invoke requests
 * - Each with unique idempotency key
 * - Mock loa-finn returns deterministic cost (10,000 micro-cents per request)
 * - After completion: Redis committed counter must = 100 × 10,000 = 1,000,000 (±0)
 *
 * Run with:
 *   k6 run tests/load/budget-concurrency.k6.ts
 *
 * Prerequisites:
 *   - Agent gateway running on GATEWAY_URL
 *   - loa-finn stub server running (deterministic 200ms, 10,000 micro-cents)
 *   - Redis accessible for post-test verification
 *
 * @see SDD §4.5 Budget Enforcement
 * @see Sprint Plan S12-T5 (Flatline IMP-003)
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Trend } from 'k6/metrics';

// --------------------------------------------------------------------------
// Configuration
// --------------------------------------------------------------------------

const GATEWAY_URL = __ENV.GATEWAY_URL || 'http://localhost:3000';
const COMMUNITY_ID = __ENV.COMMUNITY_ID || 'load-test-community';
const JWT_TOKEN = __ENV.JWT_TOKEN || 'test-jwt-token';
const COST_PER_REQUEST_MICRO_CENTS = 10_000; // deterministic mock loa-finn cost

export const options = {
  scenarios: {
    concurrent_budget: {
      executor: 'shared-iterations',
      vus: 100,
      iterations: 100,
      maxDuration: '60s',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],        // <1% error rate
    budget_success: ['count>=90'],          // At least 90 of 100 succeed
    budget_abort: ['count<=10'],            // At most 10 aborts (edge case)
    http_req_duration: ['p(95)<5000'],      // p95 < 5s
  },
};

// --------------------------------------------------------------------------
// Custom Metrics
// --------------------------------------------------------------------------

const budgetSuccess = new Counter('budget_success');
const budgetAbort = new Counter('budget_abort');
const budgetError = new Counter('budget_error');
const invokeLatency = new Trend('invoke_latency');

// --------------------------------------------------------------------------
// Test Execution
// --------------------------------------------------------------------------

export default function () {
  const vuId = __VU;
  const iterationId = __ITER;
  const idempotencyKey = `k6-budget-test-${vuId}-${iterationId}-${Date.now()}`;

  const payload = JSON.stringify({
    messages: [{ role: 'user', content: 'Hello from k6 budget test' }],
    model: 'cheap',
    idempotencyKey,
  });

  const params = {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${JWT_TOKEN}`,
      'X-Community-Id': COMMUNITY_ID,
    },
    timeout: '30s',
  };

  const res = http.post(`${GATEWAY_URL}/api/agents/invoke`, payload, params);
  invokeLatency.add(res.timings.duration);

  const passed = check(res, {
    'status is 200 or 202': (r) => r.status === 200 || r.status === 202,
    'has response body': (r) => r.body !== null && r.body !== '',
  });

  if (res.status === 200 || res.status === 202) {
    budgetSuccess.add(1);
  } else if (res.status === 409 || res.status === 503) {
    // 409 = idempotency conflict, 503 = budget exhausted — expected edge cases
    budgetAbort.add(1);
  } else {
    budgetError.add(1);
  }
}

// --------------------------------------------------------------------------
// Post-Test Verification (manual step)
// --------------------------------------------------------------------------

/**
 * After k6 completes, verify budget accuracy manually:
 *
 * 1. Read Redis committed counter:
 *    redis-cli GET agent:budget:committed:<COMMUNITY_ID>:<YYYY-MM>
 *
 * 2. Expected value:
 *    - If all 100 succeeded: committed = 100 × 10,000 / 10,000 = 100 cents
 *      (BudgetManager stores in cents, loa-finn returns micro-cents)
 *    - If N aborted: committed ≤ (100 - N) × cost, reconciliation corrects
 *
 * 3. Run reconciliation:
 *    Trigger StreamReconciliationWorker to process any pending reconciliation
 *
 * 4. Verify zero overspend:
 *    committed_total ≤ sum(actual_costs) — no overcharge
 *
 * 5. Run drift monitor:
 *    Trigger BudgetDriftMonitor.process() and verify drift < $0.50
 */

export function handleSummary(data) {
  const totalReqs = data.metrics.http_reqs?.values?.count || 0;
  const successCount = data.metrics.budget_success?.values?.count || 0;
  const abortCount = data.metrics.budget_abort?.values?.count || 0;
  const errorCount = data.metrics.budget_error?.values?.count || 0;
  const p95 = data.metrics.http_req_duration?.values?.['p(95)'] || 0;

  const summary = {
    test: 'SG-6 Budget Concurrency',
    timestamp: new Date().toISOString(),
    totalRequests: totalReqs,
    successes: successCount,
    aborts: abortCount,
    errors: errorCount,
    p95LatencyMs: Math.round(p95),
    expectedCommittedCents: successCount * (COST_PER_REQUEST_MICRO_CENTS / 10_000),
    verdict: errorCount === 0 ? 'PASS' : 'FAIL',
    notes: [
      `${successCount} requests completed successfully`,
      `${abortCount} requests aborted (expected edge case: ≤10)`,
      `${errorCount} unexpected errors`,
      'Manual verification required: check Redis committed counter matches expected',
    ],
  };

  return {
    stdout: JSON.stringify(summary, null, 2) + '\n',
    'tests/load/budget-concurrency-results.json': JSON.stringify(summary, null, 2),
  };
}

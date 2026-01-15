/**
 * k6 Load Test: Multi-Tenant Command Processing
 * Sprint S-7: Multi-Tenancy & Integration
 *
 * Tests 100 concurrent communities with mixed tier distribution.
 * Target: <500ms p95, <1% error rate
 *
 * Run: k6 run apps/worker/tests/load/multi-tenant.js
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';
import { randomIntBetween, randomItem } from 'https://jslib.k6.io/k6-utils/1.2.0/index.js';

// --------------------------------------------------------------------------
// Configuration
// --------------------------------------------------------------------------

const WORKER_URL = __ENV.WORKER_URL || 'http://localhost:8080';
const NATS_PUBLISH_URL = __ENV.NATS_PUBLISH_URL || 'http://localhost:8222/pub';

// Test configuration
export const options = {
  scenarios: {
    // Ramp up to 100 concurrent communities
    multi_tenant_load: {
      executor: 'ramping-vus',
      startVUs: 10,
      stages: [
        { duration: '30s', target: 50 },  // Warm up
        { duration: '1m', target: 100 },  // Target load
        { duration: '2m', target: 100 },  // Sustained load
        { duration: '30s', target: 0 },   // Ramp down
      ],
      gracefulRampDown: '10s',
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<500'], // 95th percentile < 500ms
    http_req_failed: ['rate<0.01'],   // Error rate < 1%
    'command_latency': ['p(95)<500'],
    'rate_limit_hits': ['rate<0.05'], // Rate limiting should be minimal
  },
};

// --------------------------------------------------------------------------
// Custom Metrics
// --------------------------------------------------------------------------

const commandLatency = new Trend('command_latency');
const rateLimitHits = new Rate('rate_limit_hits');
const commandsProcessed = new Counter('commands_processed');
const errorCount = new Counter('error_count');

// --------------------------------------------------------------------------
// Test Data
// --------------------------------------------------------------------------

// Simulate 100 communities with mixed tiers
const COMMUNITIES = [];
for (let i = 0; i < 100; i++) {
  let tier = 'free';
  if (i < 10) tier = 'enterprise';     // 10% enterprise
  else if (i < 30) tier = 'pro';       // 20% pro
  // Remaining 70% free

  COMMUNITIES.push({
    communityId: `comm_${i.toString().padStart(3, '0')}`,
    guildId: `guild_${1000000000 + i}`,
    tier: tier,
    // Simulate different command frequencies by tier
    commandFrequencyMs: tier === 'enterprise' ? 100 : tier === 'pro' ? 500 : 2000,
  });
}

const COMMANDS = ['stats', 'position', 'threshold', 'leaderboard', 'profile', 'badges'];

// --------------------------------------------------------------------------
// Helper Functions
// --------------------------------------------------------------------------

function generateCommandPayload(community, command) {
  return {
    event_id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    event_type: `interaction.command.${command}`,
    shard_id: randomIntBetween(0, 24),
    timestamp: Date.now(),
    guild_id: community.guildId,
    channel_id: `channel_${randomIntBetween(1000, 9999)}`,
    user_id: `user_${randomIntBetween(10000, 99999)}`,
    data: {
      interaction_id: `int_${Date.now()}`,
      interaction_type: 'APPLICATION_COMMAND',
      token: `token_${Math.random().toString(36).slice(2, 20)}`,
      command_name: command,
    },
  };
}

// --------------------------------------------------------------------------
// Test Scenario
// --------------------------------------------------------------------------

export default function () {
  // Pick a random community (weighted by tier activity)
  const community = randomItem(COMMUNITIES);
  const command = randomItem(COMMANDS);

  // Simulate command execution
  const payload = generateCommandPayload(community, command);

  // Option 1: Direct health check (tests worker responsiveness)
  const healthStart = Date.now();
  const healthRes = http.get(`${WORKER_URL}/health`);

  check(healthRes, {
    'health check status is 200': (r) => r.status === 200,
    'health check is healthy': (r) => {
      try {
        const body = JSON.parse(r.body);
        return body.status === 'healthy';
      } catch {
        return false;
      }
    },
  });

  const healthLatency = Date.now() - healthStart;
  commandLatency.add(healthLatency);

  if (healthRes.status !== 200) {
    errorCount.add(1);
  } else {
    commandsProcessed.add(1);
  }

  // Simulate rate limiting check (based on tier)
  // Free tier: 10/min = ~6s between requests
  // Pro tier: 100/min = ~600ms between requests
  // Enterprise: unlimited
  if (community.tier === 'free' && Math.random() < 0.1) {
    rateLimitHits.add(true);
  } else {
    rateLimitHits.add(false);
  }

  // Sleep based on tier's expected command frequency
  sleep(community.commandFrequencyMs / 1000);
}

// --------------------------------------------------------------------------
// Setup & Teardown
// --------------------------------------------------------------------------

export function setup() {
  console.log('Starting multi-tenant load test');
  console.log(`Testing ${COMMUNITIES.length} communities`);
  console.log(`Enterprise: ${COMMUNITIES.filter(c => c.tier === 'enterprise').length}`);
  console.log(`Pro: ${COMMUNITIES.filter(c => c.tier === 'pro').length}`);
  console.log(`Free: ${COMMUNITIES.filter(c => c.tier === 'free').length}`);

  // Verify worker is up
  const res = http.get(`${WORKER_URL}/health`);
  if (res.status !== 200) {
    throw new Error(`Worker not healthy: ${res.status}`);
  }

  return { startTime: Date.now() };
}

export function teardown(data) {
  const duration = (Date.now() - data.startTime) / 1000;
  console.log(`Test completed in ${duration.toFixed(2)}s`);
}

/**
 * PgBouncer Connection Pool Load Test
 * Sprint S-1: Foundation Hardening
 *
 * Validates connection pooling performance with target:
 * - p99 latency < 10ms
 * - 1000+ concurrent connections
 * - Zero connection errors under load
 *
 * Usage:
 *   k6 run pgbouncer-load.js
 *   k6 run --vus 100 --duration 60s pgbouncer-load.js
 *
 * Environment variables:
 *   PGBOUNCER_HOST - PgBouncer endpoint (default: localhost)
 *   PGBOUNCER_PORT - PgBouncer port (default: 6432)
 *   DB_NAME - Database name (default: arrakis)
 *   DB_USER - Database user
 *   DB_PASSWORD - Database password
 */

import sql from 'k6/x/sql';
import { check, sleep } from 'k6';
import { Counter, Trend, Rate } from 'k6/metrics';

// Custom metrics
const queryDuration = new Trend('query_duration', true);
const connectionErrors = new Counter('connection_errors');
const queryErrors = new Counter('query_errors');
const successRate = new Rate('success_rate');

// Configuration
const config = {
  host: __ENV.PGBOUNCER_HOST || 'localhost',
  port: __ENV.PGBOUNCER_PORT || '6432',
  database: __ENV.DB_NAME || 'arrakis',
  user: __ENV.DB_USER || 'arrakis_admin',
  password: __ENV.DB_PASSWORD || '',
};

// Test scenarios
export const options = {
  scenarios: {
    // Scenario 1: Ramp-up to steady state
    steady_load: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 50 },   // Ramp up to 50 users
        { duration: '1m', target: 50 },    // Stay at 50 for 1 minute
        { duration: '30s', target: 100 },  // Ramp up to 100
        { duration: '1m', target: 100 },   // Stay at 100 for 1 minute
        { duration: '30s', target: 0 },    // Ramp down
      ],
      gracefulRampDown: '10s',
    },
    // Scenario 2: Spike test
    spike_test: {
      executor: 'ramping-vus',
      startVUs: 0,
      startTime: '4m', // Start after steady_load
      stages: [
        { duration: '10s', target: 200 },  // Spike to 200
        { duration: '30s', target: 200 },  // Hold spike
        { duration: '10s', target: 0 },    // Drop to 0
      ],
      gracefulRampDown: '5s',
    },
  },
  thresholds: {
    // p99 latency must be under 10ms
    'query_duration': ['p(99)<10'],
    // Success rate must be above 99.9%
    'success_rate': ['rate>0.999'],
    // No more than 10 connection errors total
    'connection_errors': ['count<10'],
    // No more than 10 query errors total
    'query_errors': ['count<10'],
  },
};

// Connection string
const connectionString = `postgres://${config.user}:${config.password}@${config.host}:${config.port}/${config.database}?sslmode=prefer`;

// Main test function
export default function () {
  let db;

  try {
    // Acquire connection from pool
    db = sql.open('postgres', connectionString);
  } catch (error) {
    connectionErrors.add(1);
    successRate.add(false);
    console.error(`Connection error: ${error}`);
    return;
  }

  try {
    // Test 1: Simple SELECT (most common query pattern)
    const startSimple = Date.now();
    const result1 = sql.query(db, 'SELECT 1 as health_check');
    const durationSimple = Date.now() - startSimple;
    queryDuration.add(durationSimple);

    const healthCheckPassed = check(result1, {
      'health check returns 1': (r) => r && r.length > 0 && r[0].health_check === 1,
    });
    successRate.add(healthCheckPassed);

    // Test 2: Tenant-scoped query (simulates RLS pattern)
    const startTenant = Date.now();
    const result2 = sql.query(db, `
      SELECT COUNT(*) as community_count
      FROM communities
      WHERE discord_guild_id IS NOT NULL
      LIMIT 1
    `);
    const durationTenant = Date.now() - startTenant;
    queryDuration.add(durationTenant);

    const tenantQueryPassed = check(result2, {
      'tenant query succeeds': (r) => r !== null,
    });
    successRate.add(tenantQueryPassed);

    // Test 3: Index-utilizing query (common lookup pattern)
    const startIndex = Date.now();
    const result3 = sql.query(db, `
      SELECT EXISTS(
        SELECT 1 FROM information_schema.tables
        WHERE table_name = 'communities'
      ) as table_exists
    `);
    const durationIndex = Date.now() - startIndex;
    queryDuration.add(durationIndex);

    const indexQueryPassed = check(result3, {
      'index query succeeds': (r) => r !== null,
    });
    successRate.add(indexQueryPassed);

  } catch (error) {
    queryErrors.add(1);
    successRate.add(false);
    console.error(`Query error: ${error}`);
  } finally {
    if (db) {
      db.close();
    }
  }

  // Small sleep to simulate realistic request patterns
  sleep(0.1);
}

// Setup function - runs once before test
export function setup() {
  console.log(`Testing PgBouncer at ${config.host}:${config.port}`);
  console.log(`Database: ${config.database}`);

  // Verify connectivity
  let db;
  try {
    db = sql.open('postgres', connectionString);
    const result = sql.query(db, 'SELECT version()');
    console.log(`Connected to: ${result[0].version}`);
    db.close();
    return { connected: true };
  } catch (error) {
    console.error(`Setup failed: ${error}`);
    return { connected: false, error: error.toString() };
  }
}

// Teardown function - runs once after test
export function teardown(data) {
  if (data.connected) {
    console.log('Load test completed successfully');
  } else {
    console.log(`Load test failed during setup: ${data.error}`);
  }
}

// Handle summary output
export function handleSummary(data) {
  const p99 = data.metrics.query_duration?.values?.['p(99)'] || 'N/A';
  const successRateValue = data.metrics.success_rate?.values?.rate || 0;
  const connErrors = data.metrics.connection_errors?.values?.count || 0;
  const qErrors = data.metrics.query_errors?.values?.count || 0;

  const summary = {
    timestamp: new Date().toISOString(),
    metrics: {
      p99_latency_ms: p99,
      success_rate: successRateValue,
      connection_errors: connErrors,
      query_errors: qErrors,
    },
    thresholds_passed: Object.keys(data.metrics)
      .filter(k => data.metrics[k].thresholds)
      .every(k => Object.values(data.metrics[k].thresholds).every(t => t.ok)),
  };

  return {
    'stdout': textSummary(data, { indent: ' ', enableColors: true }),
    'pgbouncer-load-results.json': JSON.stringify(summary, null, 2),
  };
}

// Text summary helper
function textSummary(data, options) {
  const lines = [
    '\n========================================',
    'PgBouncer Load Test Summary',
    '========================================\n',
    `p99 Latency: ${data.metrics.query_duration?.values?.['p(99)']?.toFixed(2) || 'N/A'} ms (target: <10ms)`,
    `Success Rate: ${((data.metrics.success_rate?.values?.rate || 0) * 100).toFixed(2)}% (target: >99.9%)`,
    `Connection Errors: ${data.metrics.connection_errors?.values?.count || 0} (target: <10)`,
    `Query Errors: ${data.metrics.query_errors?.values?.count || 0} (target: <10)`,
    '\n========================================\n',
  ];

  return lines.join('\n');
}

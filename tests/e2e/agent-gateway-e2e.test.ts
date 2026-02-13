/**
 * Agent Gateway E2E Tests
 * Sprint 1, Task 1.3: End-to-end test scenarios
 *
 * Tests the full arrakis → loa-finn round-trip using the E2E stub.
 * Requires Docker Compose services (Redis + PostgreSQL) for full integration.
 *
 * Run: SKIP_E2E=false npx vitest run tests/e2e/agent-gateway-e2e.test.ts
 *
 * @see SDD §3.2.4 Test Scenarios
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { LoaFinnE2EStub } from './loa-finn-e2e-stub.js';
import { getVector, CONTRACT_VERSION, validateContractCompatibility } from '../../packages/contracts/src/index.js';

// --------------------------------------------------------------------------
// Environment
// --------------------------------------------------------------------------

const SKIP_E2E = process.env['SKIP_E2E'] !== 'false';

// --------------------------------------------------------------------------
// Test Suite
// --------------------------------------------------------------------------

describe.skipIf(SKIP_E2E)('Agent Gateway E2E', () => {
  let stub: LoaFinnE2EStub;

  beforeAll(async () => {
    stub = new LoaFinnE2EStub({
      validateInboundJwt: false, // No arrakis JWKS in unit-style E2E
    });
    await stub.start();
  });

  afterAll(async () => {
    await stub.stop();
  });

  beforeEach(() => {
    stub.reset();
  });

  // --------------------------------------------------------------------------
  // Scenario: invoke_free_tier — basic round-trip
  // --------------------------------------------------------------------------

  describe('invoke_free_tier', () => {
    it('should complete invoke round-trip with 200', async () => {
      const vector = getVector('invoke_free_tier');
      const response = await fetch(`${stub.getBaseUrl()}/v1/agents/invoke`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${createMockJwt(vector.request.jwt_claims)}`,
        },
        body: JSON.stringify(vector.request.body),
      });

      expect(response.status).toBe(200);

      const body = await response.json();
      expect(body).toHaveProperty('content');
      expect(body).toHaveProperty('usage');
      expect(body.usage).toHaveProperty('prompt_tokens');
      expect(body.usage).toHaveProperty('completion_tokens');
    });

    it('should receive usage report matching vector (zero drift)', async () => {
      const vector = getVector('invoke_free_tier');
      await fetch(`${stub.getBaseUrl()}/v1/agents/invoke`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${createMockJwt(vector.request.jwt_claims)}`,
        },
        body: JSON.stringify(vector.request.body),
      });

      const reports = stub.getUsageReports();
      expect(reports.length).toBe(1);

      const report = reports[0];
      expect(report.poolId).toBe(vector.usage_report_payload!.pool_id);
      expect(report.inputTokens).toBe(vector.usage_report_payload!.input_tokens);
      expect(report.outputTokens).toBe(vector.usage_report_payload!.output_tokens);
      expect(report.costMicro).toBe(vector.usage_report_payload!.cost_micro);
      expect(report.accountingMode).toBe('PLATFORM_BUDGET');
    });
  });

  // --------------------------------------------------------------------------
  // Scenario: invoke_pro_pool_routing — pool claim in JWT
  // --------------------------------------------------------------------------

  describe('invoke_pro_pool_routing', () => {
    it('should route to correct pool based on JWT claims', async () => {
      const vector = getVector('invoke_pro_pool_routing');
      const response = await fetch(`${stub.getBaseUrl()}/v1/agents/invoke`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${createMockJwt(vector.request.jwt_claims)}`,
        },
        body: JSON.stringify(vector.request.body),
      });

      expect(response.status).toBe(200);

      const reports = stub.getUsageReports();
      expect(reports.length).toBe(1);
      expect(reports[0].poolId).toBe('fast-code');
    });
  });

  // --------------------------------------------------------------------------
  // Scenario: invoke_stream_sse — SSE event order
  // --------------------------------------------------------------------------

  describe('invoke_stream_sse', () => {
    it('should stream events in correct order: content* → usage → done', async () => {
      const vector = getVector('invoke_stream_sse');
      const response = await fetch(`${stub.getBaseUrl()}/v1/agents/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${createMockJwt(vector.request.jwt_claims)}`,
        },
        body: JSON.stringify(vector.request.body),
      });

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('text/event-stream');

      const text = await response.text();
      const events = parseSSEEvents(text);

      // Verify event order: content events first, then usage, then done
      const types = events.map((e) => e.type);
      const usageIdx = types.indexOf('usage');
      const doneIdx = types.indexOf('done');
      const contentEvents = types.filter((t) => t === 'content');

      expect(contentEvents.length).toBeGreaterThan(0);
      expect(usageIdx).toBeGreaterThan(0);
      expect(doneIdx).toBe(types.length - 1);
      expect(usageIdx).toBeLessThan(doneIdx);
    });
  });

  // --------------------------------------------------------------------------
  // Scenario: invoke_rate_limited — 429 response
  // --------------------------------------------------------------------------

  describe('invoke_rate_limited', () => {
    it('should return 429 when rate limited (stub simulated)', async () => {
      // Rate limiting is enforced by arrakis gateway, not the stub.
      // This test validates the test vector shape for when arrakis returns 429.
      const vector = getVector('invoke_rate_limited');
      expect(vector.response.status).toBe(429);
      expect(vector.response.headers).toHaveProperty('retry-after');
      expect(vector.usage_report_payload).toBeNull();
    });
  });

  // --------------------------------------------------------------------------
  // Scenario: invoke_budget_exceeded — 402 response
  // --------------------------------------------------------------------------

  describe('invoke_budget_exceeded', () => {
    it('should return 402 when budget exhausted (stub simulated)', async () => {
      // Budget enforcement is on arrakis side before forwarding.
      // This validates the test vector defines the expected error shape.
      const vector = getVector('invoke_budget_exceeded');
      expect(vector.response.status).toBe(402);
      expect(vector.response.body).toHaveProperty('error');
      expect((vector.response.body as Record<string, unknown>).error).toHaveProperty('code', 'BUDGET_EXCEEDED');
      expect(vector.usage_report_payload).toBeNull();
    });
  });

  // --------------------------------------------------------------------------
  // Scenario: stream_abort_reconciliation — abort mid-stream
  // --------------------------------------------------------------------------

  describe('stream_abort_reconciliation', () => {
    it('should have reconciliation metadata in test vector', () => {
      const vector = getVector('stream_abort_reconciliation');
      expect(vector.response.abort_after_events).toBe(1);
      expect(vector.response.expect_reconciliation).toBe(true);
      expect(vector.usage_report_payload).not.toBeNull();
    });
  });

  // --------------------------------------------------------------------------
  // Scenario: invoke_byok — BYOK accounting
  // --------------------------------------------------------------------------

  describe('invoke_byok', () => {
    it('should use BYOK_NO_BUDGET accounting mode with zero platform cost', async () => {
      const vector = getVector('invoke_byok');
      const response = await fetch(`${stub.getBaseUrl()}/v1/agents/invoke`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${createMockJwt(vector.request.jwt_claims)}`,
        },
        body: JSON.stringify(vector.request.body),
      });

      expect(response.status).toBe(200);

      const reports = stub.getUsageReports();
      expect(reports.length).toBe(1);
      expect(reports[0].accountingMode).toBe('BYOK_NO_BUDGET');
      expect(reports[0].costMicro).toBe(0);
      expect(reports[0].usageTokens).toBe(500);
    });
  });

  // --------------------------------------------------------------------------
  // Scenario: invoke_ensemble_best_of_n — ensemble claims
  // --------------------------------------------------------------------------

  describe('invoke_ensemble_best_of_n', () => {
    it('should process ensemble request with budget multiplier', async () => {
      const vector = getVector('invoke_ensemble_best_of_n');
      const response = await fetch(`${stub.getBaseUrl()}/v1/agents/invoke`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${createMockJwt(vector.request.jwt_claims)}`,
        },
        body: JSON.stringify(vector.request.body),
      });

      expect(response.status).toBe(200);

      const reports = stub.getUsageReports();
      expect(reports.length).toBe(1);
      expect(reports[0].costMicro).toBe(2250);
    });
  });

  // --------------------------------------------------------------------------
  // Scenario: invoke_ensemble_partial_failure — partial failure reconciliation
  // --------------------------------------------------------------------------

  describe('invoke_ensemble_partial_failure', () => {
    it('should handle partial failure with committed ≤ reserved (drift = 0)', async () => {
      const vector = getVector('invoke_ensemble_partial_failure');
      const response = await fetch(`${stub.getBaseUrl()}/v1/agents/invoke`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${createMockJwt(vector.request.jwt_claims)}`,
        },
        body: JSON.stringify(vector.request.body),
      });

      expect(response.status).toBe(200);

      const body = await response.json();
      expect(body.ensemble_partial_failure).toBe(true);
      expect(body.ensemble_succeeded).toBe(2);
      expect(body.ensemble_failed).toBe(1);

      const reports = stub.getUsageReports();
      expect(reports.length).toBe(1);

      // Committed cost = sum of successful model costs (1500 micro)
      expect(reports[0].costMicro).toBe(1500);

      // Reserved was 3 × single model estimate. Committed ≤ reserved.
      const estimatedPerModel = 2250; // from best_of_n vector cost_micro
      const reserved = 3 * estimatedPerModel;
      expect(reports[0].costMicro).toBeLessThanOrEqual(reserved);
    });
  });

  // --------------------------------------------------------------------------
  // Contract Version
  // --------------------------------------------------------------------------

  describe('contract version', () => {
    it('should expose contract version via health endpoint', async () => {
      const response = await fetch(`${stub.getBaseUrl()}/v1/health`);
      expect(response.status).toBe(200);

      const body = await response.json();
      expect(body.contract_version).toBe(CONTRACT_VERSION);
    });

    it('should expose JWKS endpoint', async () => {
      const response = await fetch(
        `${stub.getBaseUrl()}/.well-known/jwks.json`,
      );
      expect(response.status).toBe(200);

      const body = await response.json();
      expect(body).toHaveProperty('keys');
      expect(body.keys.length).toBe(1);
      expect(body.keys[0].alg).toBe('ES256');
      expect(body.keys[0].kty).toBe('EC');
      expect(body.keys[0].crv).toBe('P-256');
    });

    it('should have pool_mapping_version in all test vector JWT claims', () => {
      for (const vector of [...getTestVectors()]) {
        expect(
          vector.request.jwt_claims.pool_mapping_version,
          `Vector ${vector.name} missing pool_mapping_version`,
        ).toBeDefined();
      }
    });

    // AC-2.22: Version negotiation — stub returns X-Contract-Version header
    it('should return X-Contract-Version header in invoke response', async () => {
      const vector = getVector('invoke_free_tier');
      const response = await fetch(`${stub.getBaseUrl()}/v1/agents/invoke`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${createMockJwt(vector.request.jwt_claims)}`,
        },
        body: JSON.stringify(vector.request.body),
      });

      expect(response.status).toBe(200);
      const peerVersion = response.headers.get('x-contract-version');
      expect(peerVersion).toBe(CONTRACT_VERSION);

      // Validate compatibility succeeds
      const compat = validateContractCompatibility(CONTRACT_VERSION, peerVersion!);
      expect(compat.compatible).toBe(true);
      expect(compat.status).toBe('supported');
    });

    // AC-2.23: Version mismatch — explicit error, not silent fallthrough
    it('should detect version mismatch with incompatible major version', () => {
      const result = validateContractCompatibility('1.1.0', '2.0.0');
      expect(result.compatible).toBe(false);
      expect(result.status).toBe('unsupported');
      expect(result.reason).toContain('Major version mismatch');
    });

    it('should allow minor version differences within same major', () => {
      const result = validateContractCompatibility('1.0.0', '1.1.0');
      expect(result.compatible).toBe(true);
      expect(result.contract_version).toBe('1.1.0'); // newer of the two
    });
  });
});

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

/**
 * Create a mock JWT token (not cryptographically signed — for stub routing only).
 * The E2E stub is configured with validateInboundJwt=false for these tests.
 */
function createMockJwt(claims: Record<string, unknown>): string {
  const header = Buffer.from(
    JSON.stringify({ alg: 'ES256', typ: 'JWT' }),
  ).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({
      iss: 'arrakis',
      sub: 'test-user',
      aud: 'loa-finn',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 300,
      jti: crypto.randomUUID(),
      v: 1,
      ...claims,
    }),
  ).toString('base64url');
  // Stub signature — not verified when validateInboundJwt=false
  const sig = Buffer.from('stub-signature').toString('base64url');
  return `${header}.${payload}.${sig}`;
}

/** Parse SSE event stream text into typed events */
function parseSSEEvents(
  text: string,
): Array<{ type: string; data: unknown }> {
  const events: Array<{ type: string; data: unknown }> = [];
  const blocks = text.split('\n\n').filter((b) => b.trim());

  for (const block of blocks) {
    const lines = block.split('\n');
    let type = '';
    let data = '';

    for (const line of lines) {
      if (line.startsWith('event: ')) {
        type = line.slice(7);
      } else if (line.startsWith('data: ')) {
        data = line.slice(6);
      }
    }

    if (type && data) {
      try {
        events.push({ type, data: JSON.parse(data) });
      } catch {
        events.push({ type, data });
      }
    }
  }

  return events;
}

/** Get all test vectors for iteration */
function getTestVectors() {
  const names = [
    'invoke_free_tier',
    'invoke_pro_pool_routing',
    'invoke_stream_sse',
    'invoke_rate_limited',
    'invoke_budget_exceeded',
    'stream_abort_reconciliation',
    'invoke_byok',
    'invoke_ensemble_best_of_n',
    'invoke_ensemble_partial_failure',
  ];
  return names.map((n) => getVector(n));
}

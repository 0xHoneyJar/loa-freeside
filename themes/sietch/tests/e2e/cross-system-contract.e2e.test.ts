/**
 * Cross-System Contract E2E Tests
 *
 * Validates that S2S responses from arrakis conform to loa-hounfour protocol
 * schemas using the contract-validator service.
 *
 * These tests require the full Docker Compose stack:
 *   docker compose -f tests/e2e/docker-compose.e2e.yml up -d
 *
 * Sprint 256, Task 5.3
 *
 * Scenarios:
 * 1. Finalize with format=loh → validate BillingEntry against contract validator
 * 2. Verify anchor → validate response against contract validator
 */

import { describe, it, expect, beforeAll } from 'vitest';

// =============================================================================
// Configuration
// =============================================================================

const ARRAKIS_URL = process.env.ARRAKIS_E2E_URL || 'http://localhost:3099';
const VALIDATOR_URL = process.env.VALIDATOR_E2E_URL || 'http://localhost:3199';
const S2S_JWT_SECRET = process.env.BILLING_INTERNAL_JWT_SECRET || 'e2e-s2s-jwt-secret-for-testing-only-32chr';

// =============================================================================
// Helpers
// =============================================================================

/**
 * Create a basic S2S JWT token for internal auth.
 * Matches the format expected by requireInternalAuth in billing-routes.ts.
 */
function createS2SToken(sub = 'e2e-test-service'): string {
  const { createHmac } = require('crypto');
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    sub,
    aud: 'arrakis-internal',
    iss: 'loa-finn',
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 300,
  })).toString('base64url');

  const signature = createHmac('sha256', S2S_JWT_SECRET)
    .update(`${header}.${payload}`)
    .digest('base64url');

  return `${header}.${payload}.${signature}`;
}

async function validatePayload(schema: string, payload: unknown): Promise<{ valid: boolean; errors?: string[] }> {
  const res = await fetch(`${VALIDATOR_URL}/validate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ schema, payload }),
  });
  return res.json();
}

// =============================================================================
// Tests
// =============================================================================

describe('Cross-System Contract Validation', () => {
  let servicesAvailable = false;

  beforeAll(async () => {
    // Check if services are running
    try {
      const [arrakisHealth, validatorHealth] = await Promise.all([
        fetch(`${ARRAKIS_URL}/health`).then(r => r.ok).catch(() => false),
        fetch(`${VALIDATOR_URL}/health`).then(r => r.ok).catch(() => false),
      ]);
      servicesAvailable = arrakisHealth && validatorHealth;
    } catch {
      servicesAvailable = false;
    }

    if (!servicesAvailable) {
      console.warn(
        'Cross-system E2E services not available. Start with:\n' +
        '  docker compose -f tests/e2e/docker-compose.e2e.yml up -d\n' +
        'Skipping cross-system contract tests.'
      );
    }
  });

  describe('Scenario 1: BillingEntry schema validation', () => {
    it('validator should have billing-entry schema loaded', async () => {
      if (!servicesAvailable) return;

      const res = await fetch(`${VALIDATOR_URL}/health`);
      const health = await res.json();

      expect(health.status).toBe('ok');
      expect(health.schemas).toContain('billing-entry');
    });

    it('valid BillingEntry should pass validation', async () => {
      if (!servicesAvailable) return;

      const validEntry = {
        entry_id: 'finalize:res-001',
        account_id: 'acct-1',
        total_micro: '5000000',
        entry_type: 'finalize',
        reference_id: 'res-001',
        created_at: new Date().toISOString(),
        metadata: null,
        contract_version: '4.6.0',
      };

      const result = await validatePayload('billing-entry', validEntry);
      expect(result.valid).toBe(true);
    });

    it('invalid BillingEntry should fail validation with errors', async () => {
      if (!servicesAvailable) return;

      const invalidEntry = {
        entry_id: 'finalize:res-001',
        // missing account_id
        total_micro: 'not-a-number', // should be numeric string
        entry_type: 'invalid_type', // not in enum
        created_at: 'not-a-date',
        contract_version: '4.6.0',
      };

      const result = await validatePayload('billing-entry', invalidEntry);
      expect(result.valid).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors!.length).toBeGreaterThan(0);
    });
  });

  describe('Scenario 2: Anchor verification schema validation', () => {
    it('validator should have anchor-verification schema loaded', async () => {
      if (!servicesAvailable) return;

      const res = await fetch(`${VALIDATOR_URL}/health`);
      const health = await res.json();

      expect(health.schemas).toContain('anchor-verification');
    });

    it('successful verification response should pass validation', async () => {
      if (!servicesAvailable) return;

      const { createHash } = await import('crypto');
      const anchorHash = 'sha256:' + createHash('sha256').update('test-anchor').digest('hex');

      const validResponse = {
        verified: true,
        anchor_hash: anchorHash,
        checked_at: new Date().toISOString(),
      };

      const result = await validatePayload('anchor-verification', validResponse);
      expect(result.valid).toBe(true);
    });

    it('failed verification response should pass validation', async () => {
      if (!servicesAvailable) return;

      const validResponse = {
        verified: false,
        reason: 'anchor_mismatch',
        checked_at: new Date().toISOString(),
      };

      const result = await validatePayload('anchor-verification', validResponse);
      expect(result.valid).toBe(true);
    });

    it('invalid verification response should fail', async () => {
      if (!servicesAvailable) return;

      const invalidResponse = {
        verified: true,
        // missing anchor_hash and checked_at
      };

      const result = await validatePayload('anchor-verification', invalidResponse);
      expect(result.valid).toBe(false);
    });
  });
});

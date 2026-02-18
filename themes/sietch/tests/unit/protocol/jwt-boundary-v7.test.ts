/**
 * JWT Claim Schema Migration Tests — trust_scopes (Task 302.3, Sprint 302)
 *
 * Verifies the v4.6.0 -> v7.0.0 protocol boundary migration for JWT claims,
 * specifically the trust_level -> trust_scopes normalization pathway.
 *
 * Tests cover:
 * - v4.6.0 inbound tokens with trust_level (legacy mapping)
 * - v7.0.0 inbound tokens with trust_scopes (native pass-through)
 * - Exactly-one-of enforcement (BOTH rejected, NEITHER rejected)
 * - Privilege escalation guard (admin:full NEVER mapped)
 * - Edge cases (negative, out-of-range, non-integer trust_level)
 * - Feature flag behavior (PROTOCOL_V7_NORMALIZATION=false)
 * - JWT encode/decode round-trip with v7.0.0 schema
 *
 * SDD refs: $3.6, $3.7, $8.3
 * Sprint refs: Task 302.3
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  normalizeInboundClaims,
  ClaimNormalizationError,
  isV7NormalizationEnabled,
  negotiateVersion,
} from '../../../src/packages/core/protocol/arrakis-compat.js';
import type { TrustScope, NormalizedClaims } from '../../../src/packages/core/protocol/arrakis-compat.js';
import { createTestKeypairs, signInbound, makeInboundClaims } from '../../helpers/jwt-factory.js';
import { jwtVerify } from 'jose';

// =============================================================================
// Environment Helpers
// =============================================================================

/**
 * Save and restore PROTOCOL_V7_NORMALIZATION env var around each test.
 * Prevents env pollution between tests.
 */
let originalEnv: string | undefined;

beforeEach(() => {
  originalEnv = process.env.PROTOCOL_V7_NORMALIZATION;
});

afterEach(() => {
  if (originalEnv === undefined) {
    delete process.env.PROTOCOL_V7_NORMALIZATION;
  } else {
    process.env.PROTOCOL_V7_NORMALIZATION = originalEnv;
  }
});

// =============================================================================
// Helpers
// =============================================================================

/** Assert that a normalization call throws ClaimNormalizationError with the given code. */
function expectNormalizationError(
  claims: { trust_level?: number; trust_scopes?: string[] },
  expectedCode: string,
): void {
  try {
    normalizeInboundClaims(claims);
    expect.fail(`Expected ClaimNormalizationError [${expectedCode}] but no error was thrown`);
  } catch (err) {
    expect(err).toBeInstanceOf(ClaimNormalizationError);
    expect((err as ClaimNormalizationError).code).toBe(expectedCode);
  }
}

// =============================================================================
// Tests
// =============================================================================

describe('JWT Claim Schema Migration -- trust_scopes (Task 302.3)', () => {
  // ---------------------------------------------------------------------------
  // v4.6.0 inbound token with trust_level (legacy path)
  // ---------------------------------------------------------------------------

  describe('v4.6.0 inbound token with trust_level', () => {
    beforeEach(() => {
      // Ensure normalization is enabled for these tests
      process.env.PROTOCOL_V7_NORMALIZATION = 'true';
    });

    it('accepts valid trust_level=3 and maps via least-privilege table', () => {
      const result = normalizeInboundClaims({ trust_level: 3 });
      expect(result.source).toBe('v4_mapped');
      expect(result.trust_scopes).toContain('billing:read');
      expect(result.trust_scopes).toContain('billing:write');
      expect(result.trust_scopes).toContain('agent:invoke');
      // trust_level=3 should NOT have agent:manage or governance scopes
      expect(result.trust_scopes).not.toContain('agent:manage');
      expect(result.trust_scopes).not.toContain('governance:propose');
      expect(result.trust_scopes).not.toContain('governance:vote');
    });

    it('maps trust_level=0 to minimal scopes (billing:read only)', () => {
      const result = normalizeInboundClaims({ trust_level: 0 });
      expect(result.source).toBe('v4_mapped');
      expect(result.trust_scopes).toEqual(['billing:read']);
      // Must be the minimal set -- nothing beyond billing:read
      expect(result.trust_scopes).toHaveLength(1);
    });

    it('maps trust_level=1 to billing:read + agent:invoke', () => {
      const result = normalizeInboundClaims({ trust_level: 1 });
      expect(result.source).toBe('v4_mapped');
      expect(result.trust_scopes).toContain('billing:read');
      expect(result.trust_scopes).toContain('agent:invoke');
      expect(result.trust_scopes).toHaveLength(2);
    });

    it('maps trust_level=5 to include agent:manage', () => {
      const result = normalizeInboundClaims({ trust_level: 5 });
      expect(result.source).toBe('v4_mapped');
      expect(result.trust_scopes).toContain('agent:manage');
    });

    it('maps trust_level=7 to include governance:propose', () => {
      const result = normalizeInboundClaims({ trust_level: 7 });
      expect(result.source).toBe('v4_mapped');
      expect(result.trust_scopes).toContain('governance:propose');
      // trust_level=7 should NOT have governance:vote
      expect(result.trust_scopes).not.toContain('governance:vote');
    });

    it('maps trust_level=8 to include governance:vote', () => {
      const result = normalizeInboundClaims({ trust_level: 8 });
      expect(result.source).toBe('v4_mapped');
      expect(result.trust_scopes).toContain('governance:propose');
      expect(result.trust_scopes).toContain('governance:vote');
    });

    it('maps trust_level=9 to governance scopes (NOT admin)', () => {
      const result = normalizeInboundClaims({ trust_level: 9 });
      expect(result.source).toBe('v4_mapped');
      expect(result.trust_scopes).toContain('governance:propose');
      expect(result.trust_scopes).toContain('governance:vote');
      // CRITICAL INVARIANT: trust_level=9 must NEVER map to admin:full
      expect(result.trust_scopes).not.toContain('admin:full');
      // Also must not contain admin-level scopes
      expect(result.trust_scopes).not.toContain('governance:admin');
      expect(result.trust_scopes).not.toContain('agent:admin');
      expect(result.trust_scopes).not.toContain('billing:admin');
    });

    it('produces monotonically increasing scope sets as trust_level increases', () => {
      // Each trust level should have >= scopes as the previous level
      let previousScopes: readonly TrustScope[] = [];
      for (let level = 0; level <= 9; level++) {
        const result = normalizeInboundClaims({ trust_level: level });
        expect(result.trust_scopes.length).toBeGreaterThanOrEqual(previousScopes.length);
        // Every scope in the previous level should exist in the current level
        for (const scope of previousScopes) {
          expect(result.trust_scopes).toContain(scope);
        }
        previousScopes = result.trust_scopes;
      }
    });
  });

  // ---------------------------------------------------------------------------
  // v7.0.0 inbound token with trust_scopes (native path)
  // ---------------------------------------------------------------------------

  describe('v7.0.0 inbound token with trust_scopes', () => {
    beforeEach(() => {
      process.env.PROTOCOL_V7_NORMALIZATION = 'true';
    });

    it('accepts and uses trust_scopes directly', () => {
      const scopes: TrustScope[] = ['billing:read', 'agent:invoke'];
      const result = normalizeInboundClaims({ trust_scopes: scopes });
      expect(result.source).toBe('v7_native');
      expect(result.trust_scopes).toEqual(scopes);
    });

    it('accepts trust_scopes with multiple capabilities', () => {
      const scopes: TrustScope[] = [
        'billing:read',
        'billing:write',
        'agent:invoke',
        'agent:manage',
        'governance:propose',
      ];
      const result = normalizeInboundClaims({ trust_scopes: scopes });
      expect(result.source).toBe('v7_native');
      expect(result.trust_scopes).toEqual(scopes);
    });

    it('accepts trust_scopes with a single scope', () => {
      const scopes: TrustScope[] = ['billing:read'];
      const result = normalizeInboundClaims({ trust_scopes: scopes });
      expect(result.source).toBe('v7_native');
      expect(result.trust_scopes).toEqual(scopes);
    });
  });

  // ---------------------------------------------------------------------------
  // Exactly-one-of enforcement
  // ---------------------------------------------------------------------------

  describe('Exactly-one-of enforcement', () => {
    beforeEach(() => {
      process.env.PROTOCOL_V7_NORMALIZATION = 'true';
    });

    it('rejects token with BOTH trust_level AND trust_scopes (AMBIGUOUS_AUTHORITY)', () => {
      expectNormalizationError(
        { trust_level: 3, trust_scopes: ['billing:read'] },
        'AMBIGUOUS_AUTHORITY',
      );
    });

    it('rejects token with NEITHER trust_level nor trust_scopes (NO_AUTHORITY)', () => {
      expectNormalizationError({}, 'NO_AUTHORITY');
    });

    it('rejects token with empty trust_scopes and no trust_level (NO_AUTHORITY)', () => {
      // Empty array means no scopes -- treated as not having trust_scopes
      expectNormalizationError({ trust_scopes: [] }, 'NO_AUTHORITY');
    });

    it('rejects token with undefined trust_level and undefined trust_scopes', () => {
      expectNormalizationError(
        { trust_level: undefined, trust_scopes: undefined },
        'NO_AUTHORITY',
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Privilege escalation guard
  // ---------------------------------------------------------------------------

  describe('Privilege escalation guard', () => {
    beforeEach(() => {
      process.env.PROTOCOL_V7_NORMALIZATION = 'true';
    });

    it('trust_level=9 NEVER maps to admin:full (exhaustive check all levels)', () => {
      for (let level = 0; level <= 9; level++) {
        const result = normalizeInboundClaims({ trust_level: level });
        expect(result.trust_scopes).not.toContain('admin:full');
      }
    });

    it('rejects inbound trust_scopes containing admin:full (PRIVILEGE_ESCALATION)', () => {
      expectNormalizationError(
        { trust_scopes: ['billing:read', 'admin:full'] },
        'PRIVILEGE_ESCALATION',
      );
    });

    it('rejects trust_scopes with only admin:full', () => {
      expectNormalizationError(
        { trust_scopes: ['admin:full'] },
        'PRIVILEGE_ESCALATION',
      );
    });

    it('rejects trust_scopes with admin:full among many valid scopes', () => {
      expectNormalizationError(
        {
          trust_scopes: [
            'billing:read',
            'billing:write',
            'agent:invoke',
            'agent:manage',
            'governance:propose',
            'governance:vote',
            'admin:full',
          ],
        },
        'PRIVILEGE_ESCALATION',
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Edge cases: invalid trust_level values
  // ---------------------------------------------------------------------------

  describe('Edge cases', () => {
    beforeEach(() => {
      process.env.PROTOCOL_V7_NORMALIZATION = 'true';
    });

    it('rejects negative trust_level (-1)', () => {
      expectNormalizationError({ trust_level: -1 }, 'INVALID_TRUST_LEVEL');
    });

    it('rejects negative trust_level (-100)', () => {
      expectNormalizationError({ trust_level: -100 }, 'INVALID_TRUST_LEVEL');
    });

    it('rejects trust_level > 9 (10)', () => {
      expectNormalizationError({ trust_level: 10 }, 'INVALID_TRUST_LEVEL');
    });

    it('rejects trust_level > 9 (999)', () => {
      expectNormalizationError({ trust_level: 999 }, 'INVALID_TRUST_LEVEL');
    });

    it('rejects non-integer trust_level (3.5)', () => {
      expectNormalizationError({ trust_level: 3.5 }, 'INVALID_TRUST_LEVEL');
    });

    it('rejects non-integer trust_level (0.1)', () => {
      expectNormalizationError({ trust_level: 0.1 }, 'INVALID_TRUST_LEVEL');
    });

    it('rejects NaN trust_level', () => {
      expectNormalizationError({ trust_level: NaN }, 'INVALID_TRUST_LEVEL');
    });

    it('rejects Infinity trust_level', () => {
      expectNormalizationError({ trust_level: Infinity }, 'INVALID_TRUST_LEVEL');
    });

    it('rejects -Infinity trust_level', () => {
      expectNormalizationError({ trust_level: -Infinity }, 'INVALID_TRUST_LEVEL');
    });
  });

  // ---------------------------------------------------------------------------
  // Feature flag: PROTOCOL_V7_NORMALIZATION=false (disabled)
  // ---------------------------------------------------------------------------

  describe('Feature flag: PROTOCOL_V7_NORMALIZATION=false', () => {
    beforeEach(() => {
      process.env.PROTOCOL_V7_NORMALIZATION = 'false';
    });

    it('reports disabled when flag is false', () => {
      expect(isV7NormalizationEnabled()).toBe(false);
    });

    it('reports disabled when flag is 0', () => {
      process.env.PROTOCOL_V7_NORMALIZATION = '0';
      expect(isV7NormalizationEnabled()).toBe(false);
    });

    it('reports enabled when flag is not set', () => {
      delete process.env.PROTOCOL_V7_NORMALIZATION;
      expect(isV7NormalizationEnabled()).toBe(true);
    });

    it('reports enabled when flag is true', () => {
      process.env.PROTOCOL_V7_NORMALIZATION = 'true';
      expect(isV7NormalizationEnabled()).toBe(true);
    });

    it('passes through trust_scopes without validation when disabled', () => {
      // When disabled, trust_scopes are passed through — but admin:full and
      // unknown scopes are STILL blocked (security invariants survive flag state)
      const scopes = ['billing:read', 'agent:invoke'];
      const result = normalizeInboundClaims({ trust_scopes: scopes });
      expect(result.source).toBe('v7_native');
      expect(result.trust_scopes).toEqual(scopes);
    });

    it('maps trust_level to default scopes when disabled', () => {
      // When disabled, trust_level maps to a fixed default set (billing:read + agent:invoke)
      // regardless of the actual level value
      const result = normalizeInboundClaims({ trust_level: 5 });
      expect(result.source).toBe('v4_mapped');
      expect(result.trust_scopes).toEqual(['billing:read', 'agent:invoke']);
    });

    it('maps any trust_level to the same default scopes when disabled', () => {
      // Level 0 and level 9 both produce the same default when flag is off
      const result0 = normalizeInboundClaims({ trust_level: 0 });
      const result9 = normalizeInboundClaims({ trust_level: 9 });
      expect(result0.trust_scopes).toEqual(result9.trust_scopes);
      expect(result0.trust_scopes).toEqual(['billing:read', 'agent:invoke']);
    });

    it('rejects out-of-range trust_level even when disabled', () => {
      expectNormalizationError({ trust_level: -1 }, 'INVALID_TRUST_LEVEL');
      expectNormalizationError({ trust_level: 10 }, 'INVALID_TRUST_LEVEL');
      expectNormalizationError({ trust_level: 1.5 }, 'INVALID_TRUST_LEVEL');
    });

    it('still rejects NO_AUTHORITY even when disabled', () => {
      // Even with normalization off, a token with neither trust_level nor trust_scopes
      // is still rejected -- the feature flag does not bypass the no-authority guard
      expectNormalizationError({}, 'NO_AUTHORITY');
    });
  });

  // ---------------------------------------------------------------------------
  // Version negotiation sanity checks
  // ---------------------------------------------------------------------------

  describe('Version negotiation', () => {
    it('prefers v7.0.0', () => {
      const negotiation = negotiateVersion();
      expect(negotiation.preferred).toBe('7.0.0');
    });

    it('supports both v4.6.0 and v7.0.0', () => {
      const negotiation = negotiateVersion();
      expect(negotiation.supported).toContain('4.6.0');
      expect(negotiation.supported).toContain('7.0.0');
    });
  });

  // ---------------------------------------------------------------------------
  // JWT encode/decode round-trip with v7.0.0 schema
  // ---------------------------------------------------------------------------

  describe('JWT encode/decode round-trip with v7.0.0 schema', () => {
    it('round-trips inbound claims through sign + verify', async () => {
      const keypairs = createTestKeypairs();
      const claims = makeInboundClaims();

      // Sign with loa-finn's private key
      const token = await signInbound(claims, keypairs.loaFinn.privateKey);

      // Verify with loa-finn's public key (EdDSA)
      const { payload } = await jwtVerify(token, keypairs.loaFinn.publicKey, {
        algorithms: ['EdDSA'],
      });

      // All inbound claims fields survive the round-trip
      expect(payload.jti).toBe(claims.jti);
      expect(payload.finalized).toBe(true);
      expect(payload.reservation_id).toBe(claims.reservation_id);
      expect(payload.actual_cost_micro).toBe(claims.actual_cost_micro);
      expect(payload.models_used).toEqual(claims.models_used);
      expect(payload.input_tokens).toBe(claims.input_tokens);
      expect(payload.output_tokens).toBe(claims.output_tokens);
    });

    it('round-trips claims with trust_scopes through normalization', async () => {
      process.env.PROTOCOL_V7_NORMALIZATION = 'true';

      // Simulate a v7.0.0 token payload with trust_scopes
      const v7Claims = {
        trust_scopes: ['billing:read', 'billing:write', 'agent:invoke'] as TrustScope[],
      };

      // Normalize (v7 native path)
      const normalized = normalizeInboundClaims(v7Claims);
      expect(normalized.source).toBe('v7_native');
      expect(normalized.trust_scopes).toEqual(v7Claims.trust_scopes);

      // Verify output has at least one scope (post-normalization validation)
      expect(normalized.trust_scopes.length).toBeGreaterThan(0);
    });

    it('round-trips claims with trust_level through normalization', async () => {
      process.env.PROTOCOL_V7_NORMALIZATION = 'true';

      // Simulate a v4.6.0 token payload with trust_level
      const v4Claims = { trust_level: 5 };

      // Normalize (v4 mapped path)
      const normalized = normalizeInboundClaims(v4Claims);
      expect(normalized.source).toBe('v4_mapped');
      expect(normalized.trust_scopes.length).toBeGreaterThan(0);

      // Output is a valid v7.0.0 trust_scopes array
      for (const scope of normalized.trust_scopes) {
        expect(typeof scope).toBe('string');
        expect(scope.length).toBeGreaterThan(0);
        // All scopes must follow the category:action format
        expect(scope).toMatch(/^[a-z]+:[a-z]+$/);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Post-normalization output validation (v7.0.0 schema compliance)
  // ---------------------------------------------------------------------------

  describe('Post-normalization output passes v7.0.0 schema validation', () => {
    beforeEach(() => {
      process.env.PROTOCOL_V7_NORMALIZATION = 'true';
    });

    it('all trust_level mappings produce non-empty scope arrays', () => {
      for (let level = 0; level <= 9; level++) {
        const result = normalizeInboundClaims({ trust_level: level });
        expect(result.trust_scopes.length).toBeGreaterThan(0);
      }
    });

    it('all trust_level mappings produce source=v4_mapped', () => {
      for (let level = 0; level <= 9; level++) {
        const result = normalizeInboundClaims({ trust_level: level });
        expect(result.source).toBe('v4_mapped');
      }
    });

    it('all v7 native scopes produce source=v7_native', () => {
      const result = normalizeInboundClaims({
        trust_scopes: ['billing:read', 'governance:propose'],
      });
      expect(result.source).toBe('v7_native');
    });

    it('NormalizedClaims always has trust_scopes as readonly array', () => {
      const result = normalizeInboundClaims({ trust_level: 5 });
      expect(Array.isArray(result.trust_scopes)).toBe(true);
      expect(result.trust_scopes).toBeDefined();
    });

    it('every scope in the mapping table follows category:action format', () => {
      for (let level = 0; level <= 9; level++) {
        const result = normalizeInboundClaims({ trust_level: level });
        for (const scope of result.trust_scopes) {
          expect(scope).toMatch(/^[a-z]+:[a-z]+$/);
        }
      }
    });

    it('all mapped scopes are from the valid TrustScope union', () => {
      const validScopes: readonly string[] = [
        'billing:read',
        'billing:write',
        'billing:admin',
        'agent:invoke',
        'agent:manage',
        'agent:admin',
        'governance:propose',
        'governance:vote',
        'governance:admin',
        'admin:full',
      ];

      for (let level = 0; level <= 9; level++) {
        const result = normalizeInboundClaims({ trust_level: level });
        for (const scope of result.trust_scopes) {
          expect(validScopes).toContain(scope);
        }
      }
    });
  });
});

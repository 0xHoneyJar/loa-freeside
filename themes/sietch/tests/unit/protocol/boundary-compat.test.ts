/**
 * Backward Compatibility Integration Tests (Task 302.5, Sprint 302)
 *
 * Combines JWT claim normalization + coordination message normalization
 * into cross-boundary integration scenarios. Verifies:
 *
 * - v4.6.0 inbound JWT accepted (trust_level mapped to trust_scopes)
 * - v7.0.0 inbound JWT accepted (trust_scopes used directly)
 * - v4.6.0 coordination message accepted (normalized)
 * - v7.0.0 coordination message accepted (direct)
 * - Malformed messages rejected with correct error codes
 * - Feature flag: PROTOCOL_V7_NORMALIZATION=false reverts to v4.6 behavior
 * - Cross-boundary: combined JWT + coordination scenarios
 *
 * NOTE: The canonical validateCompatibility() from @0xhoneyjar/loa-hounfour
 * has MIN_SUPPORTED_VERSION=6.0.0, which rejects v4.6.0. We mock it to
 * accept both 4.6.0 and 7.0.0 since the arrakis transition window still
 * accepts v4.6.0.
 *
 * SDD refs: §3.6, §3.7, §8.3
 * Sprint refs: Task 302.5
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the canonical library so v4.6.0 passes validateCompatibility
// during the transition period. The local negotiateVersion() advertises
// v4.6.0 support; the mock makes the canonical validator agree.
vi.mock('@0xhoneyjar/loa-hounfour', () => ({
  CONTRACT_VERSION: '7.0.0',
  validateCompatibility: (version: string) => {
    // Accept 4.6.0 and 7.0.0 (the transition support window)
    if (version === '7.0.0' || version === '4.6.0') {
      return { compatible: true };
    }
    return { compatible: false, error: `Version ${version} is not supported` };
  },
}));

import {
  normalizeInboundClaims,
  normalizeCoordinationMessage,
  ClaimNormalizationError,
  negotiateVersion,
  isV7NormalizationEnabled,
  CONTRACT_VERSION,
} from '../../../src/packages/core/protocol/arrakis-compat.js';

describe('Backward Compatibility Integration Tests (Task 302.5)', () => {

  let originalEnv: string | undefined;
  beforeEach(() => { originalEnv = process.env.PROTOCOL_V7_NORMALIZATION; });
  afterEach(() => {
    if (originalEnv === undefined) delete process.env.PROTOCOL_V7_NORMALIZATION;
    else process.env.PROTOCOL_V7_NORMALIZATION = originalEnv;
  });

  // ===========================================================================
  // v4.6.0 inbound JWT accepted (trust_level mapped)
  // ===========================================================================

  describe('v4.6.0 inbound JWT accepted (trust_level mapped)', () => {
    it('maps trust_level=5 to expected v7 scopes', () => {
      const result = normalizeInboundClaims({ trust_level: 5 });
      expect(result.source).toBe('v4_mapped');
      expect(result.trust_scopes).toContain('billing:read');
      expect(result.trust_scopes).toContain('agent:manage');
      expect(result.trust_scopes).not.toContain('admin:full');
    });
  });

  // ===========================================================================
  // v7.0.0 inbound JWT accepted (trust_scopes direct)
  // ===========================================================================

  describe('v7.0.0 inbound JWT accepted (trust_scopes direct)', () => {
    it('accepts native trust_scopes', () => {
      const result = normalizeInboundClaims({ trust_scopes: ['billing:read', 'agent:invoke'] });
      expect(result.source).toBe('v7_native');
      expect(result.trust_scopes).toEqual(['billing:read', 'agent:invoke']);
    });
  });

  // ===========================================================================
  // v4.6.0 coordination message accepted (normalized)
  // ===========================================================================

  describe('v4.6.0 coordination message accepted (normalized)', () => {
    it('normalizes v4.6.0 coordination message', () => {
      const result = normalizeCoordinationMessage({
        version: '4.6.0', type: 'heartbeat', payload: { status: 'alive' },
      });
      expect(result.version).toBe('4.6.0');
      expect(result.type).toBe('heartbeat');
    });
  });

  // ===========================================================================
  // v7.0.0 coordination message accepted (direct)
  // ===========================================================================

  describe('v7.0.0 coordination message accepted (direct)', () => {
    it('passes through v7.0.0 messages', () => {
      const result = normalizeCoordinationMessage({
        version: '7.0.0', type: 'capability_sync', payload: { scopes: ['billing:read'] },
      });
      expect(result.version).toBe('7.0.0');
    });
  });

  // ===========================================================================
  // Malformed messages rejected with correct error codes
  // ===========================================================================

  describe('Malformed messages rejected with correct error codes', () => {
    it('rejects JWT with both trust_level and trust_scopes (AMBIGUOUS_AUTHORITY)', () => {
      expect(() => normalizeInboundClaims({ trust_level: 3, trust_scopes: ['billing:read'] }))
        .toThrow(ClaimNormalizationError);
      try {
        normalizeInboundClaims({ trust_level: 3, trust_scopes: ['billing:read'] });
      } catch (e: any) {
        expect(e.code).toBe('AMBIGUOUS_AUTHORITY');
      }
    });

    it('rejects JWT with neither authority (NO_AUTHORITY)', () => {
      expect(() => normalizeInboundClaims({})).toThrow(ClaimNormalizationError);
      try {
        normalizeInboundClaims({});
      } catch (e: any) {
        expect(e.code).toBe('NO_AUTHORITY');
      }
    });

    it('rejects coordination without version (MISSING_VERSION)', () => {
      expect(() => normalizeCoordinationMessage({ type: 'ping', payload: {} } as any))
        .toThrow(ClaimNormalizationError);
      try {
        normalizeCoordinationMessage({ type: 'ping', payload: {} } as any);
      } catch (e: any) {
        expect(e.code).toBe('MISSING_VERSION');
      }
    });

    it('rejects coordination with unknown version (UNSUPPORTED_VERSION)', () => {
      expect(() => normalizeCoordinationMessage({ version: '2.0.0', type: 'ping', payload: {} }))
        .toThrow(ClaimNormalizationError);
      try {
        normalizeCoordinationMessage({ version: '2.0.0', type: 'ping', payload: {} });
      } catch (e: any) {
        expect(e.code).toBe('UNSUPPORTED_VERSION');
      }
    });

    it('rejects admin:full in inbound scopes (PRIVILEGE_ESCALATION)', () => {
      expect(() => normalizeInboundClaims({ trust_scopes: ['admin:full'] }))
        .toThrow(ClaimNormalizationError);
      try {
        normalizeInboundClaims({ trust_scopes: ['admin:full'] });
      } catch (e: any) {
        expect(e.code).toBe('PRIVILEGE_ESCALATION');
      }
    });

    it('rejects unknown trust scopes (UNKNOWN_SCOPE)', () => {
      expect(() => normalizeInboundClaims({ trust_scopes: ['billing:read', 'system:root'] }))
        .toThrow(ClaimNormalizationError);
      try {
        normalizeInboundClaims({ trust_scopes: ['billing:read', 'system:root'] });
      } catch (e: any) {
        expect(e.code).toBe('UNKNOWN_SCOPE');
        expect(e.message).toContain('system:root');
      }
    });
  });

  // ===========================================================================
  // Feature flag: PROTOCOL_V7_NORMALIZATION=false reverts to v4.6 behavior
  // ===========================================================================

  describe('Feature flag: PROTOCOL_V7_NORMALIZATION=false reverts to v4.6 behavior', () => {
    beforeEach(() => { process.env.PROTOCOL_V7_NORMALIZATION = 'false'; });

    it('normalization disabled returns false', () => {
      expect(isV7NormalizationEnabled()).toBe(false);
    });

    it('admin:full is always blocked even when normalization disabled', () => {
      // Security invariant: admin:full check is independent of feature flag
      expect(() => normalizeInboundClaims({ trust_scopes: ['admin:full', 'billing:read'] }))
        .toThrow(ClaimNormalizationError);
    });

    it('valid trust_scopes pass through when normalization disabled', () => {
      const result = normalizeInboundClaims({ trust_scopes: ['billing:read', 'agent:invoke'] });
      expect(result.trust_scopes).toContain('billing:read');
      expect(result.source).toBe('v7_native');
    });

    it('trust_level maps to default scopes when disabled', () => {
      const result = normalizeInboundClaims({ trust_level: 9 });
      expect(result.source).toBe('v4_mapped');
      // When disabled, uses fixed default mapping
      expect(result.trust_scopes).toContain('billing:read');
      expect(result.trust_scopes).toContain('agent:invoke');
    });

    it('coordination still rejects missing version even when disabled', () => {
      expect(() => normalizeCoordinationMessage({ type: 'ping', payload: {} } as any))
        .toThrow(ClaimNormalizationError);
    });

    it('coordination rejects unsupported version even when disabled', () => {
      expect(() => normalizeCoordinationMessage({ version: '2.0.0', type: 'ping', payload: {} }))
        .toThrow(ClaimNormalizationError);
      try {
        normalizeCoordinationMessage({ version: '2.0.0', type: 'ping', payload: {} });
      } catch (e: any) {
        expect(e.code).toBe('UNSUPPORTED_VERSION');
      }
    });

    it('coordination accepts supported versions when disabled', () => {
      const result = normalizeCoordinationMessage({ version: '4.6.0', type: 'heartbeat', payload: {} });
      expect(result.version).toBe('4.6.0');
    });

    it('rejects out-of-range trust_level even when disabled', () => {
      expect(() => normalizeInboundClaims({ trust_level: -1 })).toThrow(ClaimNormalizationError);
      expect(() => normalizeInboundClaims({ trust_level: 10 })).toThrow(ClaimNormalizationError);
      expect(() => normalizeInboundClaims({ trust_level: 1.5 })).toThrow(ClaimNormalizationError);
    });
  });

  // ===========================================================================
  // Cross-boundary: combined JWT + coordination scenario
  // ===========================================================================

  describe('Cross-boundary: combined JWT + coordination scenario', () => {
    it('full v4.6.0 upgrade path: JWT + coordination both normalized', () => {
      // Step 1: Normalize v4.6.0 JWT claims
      const claims = normalizeInboundClaims({ trust_level: 7 });
      expect(claims.source).toBe('v4_mapped');
      expect(claims.trust_scopes).toContain('governance:propose');

      // Step 2: Normalize v4.6.0 coordination message
      const msg = normalizeCoordinationMessage({
        version: '4.6.0', type: 'capability_sync', payload: { scopes: [...claims.trust_scopes] },
      });
      expect(msg.version).toBe('4.6.0');
      expect(msg.type).toBe('capability_sync');
    });

    it('full v7.0.0 native path: JWT + coordination direct', () => {
      const claims = normalizeInboundClaims({ trust_scopes: ['billing:read', 'billing:write', 'agent:invoke'] });
      expect(claims.source).toBe('v7_native');

      const msg = normalizeCoordinationMessage({
        version: '7.0.0', type: 'capability_sync', payload: { scopes: [...claims.trust_scopes] },
      });
      expect(msg.version).toBe('7.0.0');
    });
  });
});

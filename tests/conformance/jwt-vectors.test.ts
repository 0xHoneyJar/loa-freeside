/**
 * JWT Conformance Test Suite
 * Sprint 2, Task 2.3: Parametrized tests for loa-hounfour JWT vectors
 *
 * Tests 4 static claim vectors + 2 JWKS behavioral vectors using the
 * actual S2SJwtValidator from packages/adapters.
 *
 * Run: npx vitest run tests/conformance/jwt-vectors.test.ts
 *
 * @see SDD §3.5 JWT Conformance Suite
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { loadVectorFile } from '../e2e/vectors/index.js';
import { JwksTestServer } from './jwks-test-server.js';
import { S2SJwtValidator, type S2SJwtValidatorConfig } from '../../packages/adapters/agent/s2s-jwt-validator.js';
import type { Clock } from '../../packages/adapters/agent/clock.js';
import { computeReqHash } from '@0xhoneyjar/loa-hounfour';

// --------------------------------------------------------------------------
// Vector Types
// --------------------------------------------------------------------------

interface JwtVector {
  id: string;
  description: string;
  claims: Record<string, unknown>;
  expected: 'valid' | 'invalid';
  error?: string;
  kid?: string;
  jwks_contains?: string[];
  jwks_state?: string;
  notes?: string;
}

interface JwtConformanceVectors {
  vectors: JwtVector[];
}

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

/** No-op logger satisfying pino interface for testing */
const nullLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  fatal: () => {},
  trace: () => {},
  child: () => nullLogger,
  level: 'silent',
} as unknown as import('pino').Logger;

/** Create a validator configured for test vectors */
function createTestValidator(
  jwksUri: string,
  overrides?: Partial<S2SJwtValidatorConfig>,
  clock?: Clock,
): S2SJwtValidator {
  const config: S2SJwtValidatorConfig = {
    jwksUrl: jwksUri,
    expectedIssuer: 'https://auth.honeyjar.xyz',
    expectedAudience: 'loa-finn',
    jwksCacheTtlMs: overrides?.jwksCacheTtlMs ?? 3_600_000,
    jwksStaleMaxMs: overrides?.jwksStaleMaxMs ?? 259_200_000,
    jwksRefreshCooldownMs: overrides?.jwksRefreshCooldownMs ?? 0,
    clockToleranceSec: overrides?.clockToleranceSec ?? 30,
    ...overrides,
  };
  return new S2SJwtValidator(config, nullLogger, clock);
}

// --------------------------------------------------------------------------
// Load Vectors
// --------------------------------------------------------------------------

const jwtVectors = loadVectorFile<JwtConformanceVectors>('vectors/jwt/conformance.json');

// --------------------------------------------------------------------------
// Test Suite
// --------------------------------------------------------------------------

describe('JWT Conformance', () => {
  let server: JwksTestServer;

  beforeAll(async () => {
    server = new JwksTestServer();
    await server.start();
  });

  afterAll(async () => {
    await server.stop();
  });

  // --------------------------------------------------------------------------
  // Static Claim Tests (jwt-valid-invoke, jwt-expired, jwt-wrong-aud, jwt-disallowed-iss)
  // --------------------------------------------------------------------------

  describe('static claim validation', () => {
    const staticVectors = jwtVectors.vectors.filter(
      (v) => !['jwt-rotated-key', 'jwt-jwks-timeout'].includes(v.id),
    );

    it.each(staticVectors)('$id: $description', async (vector) => {
      // Add a fresh key for signing
      const kid = vector.kid ?? `test-${vector.id}`;
      const existing = server.getKeyEntry(kid);
      if (!existing) {
        await server.addKey(kid);
      }

      // Build claims — use vector claims directly, set iat/exp if missing
      const now = Math.floor(Date.now() / 1000);
      const claims: Record<string, unknown> = {
        ...vector.claims,
      };

      // Only set iat/exp if vector doesn't provide them
      if (claims.iat === undefined) claims.iat = now;
      if (claims.exp === undefined) claims.exp = now + 300;

      // Sign with the test key
      const token = await server.signJwtWithClaims(kid, claims);

      // Create validator matching vector's expected iss/aud
      const validator = createTestValidator(server.getJwksUri(), {
        jwksCacheTtlMs: 0, // No cache for static tests
        jwksRefreshCooldownMs: 0,
        expectedIssuer: 'https://auth.honeyjar.xyz',
        expectedAudience: 'loa-finn',
      });

      if (vector.expected === 'valid') {
        const payload = await validator.validateJwt(token);
        expect(payload.iss).toBe(claims.iss);
        expect(payload.aud).toBe(claims.aud);
      } else {
        await expect(validator.validateJwt(token)).rejects.toThrow();
      }
    });
  });

  // --------------------------------------------------------------------------
  // req_hash Consistency
  // --------------------------------------------------------------------------

  describe('req_hash consistency', () => {
    const vectorsWithHash = jwtVectors.vectors.filter(
      (v) => v.claims.req_hash,
    );

    it.each(vectorsWithHash)(
      '$id: req_hash matches computeReqHash',
      (vector) => {
        const bodyBytes = vector.claims.req_body_bytes_base64
          ? Buffer.from(String(vector.claims.req_body_bytes_base64), 'base64')
          : Buffer.alloc(0);
        const computed = computeReqHash(bodyBytes);

        if (vector.claims.req_hash) {
          expect(computed).toBe(vector.claims.req_hash);
        }
      },
    );
  });

  // --------------------------------------------------------------------------
  // Behavioral: jwt-rotated-key
  // --------------------------------------------------------------------------

  describe('jwt-rotated-key', () => {
    it('should handle key rotation: K1 valid → K2 valid → K1 removed rejects', async () => {
      const rotationServer = new JwksTestServer();
      await rotationServer.start();

      try {
        // Step 1: Add K1, create validator with cacheTtl=0 (fresh fetch every time)
        const k1 = await rotationServer.addKey('key-v1');
        const validator = createTestValidator(rotationServer.getJwksUri(), {
          jwksCacheTtlMs: 0,
          jwksRefreshCooldownMs: 0,
        });

        // Step 2: K1 token should PASS
        const k1Claims = {
          iss: 'https://auth.honeyjar.xyz',
          aud: 'loa-finn',
          sub: 'test-user',
          purpose: 'invoke',
          iat: Math.floor(Date.now() / 1000),
          exp: Math.floor(Date.now() / 1000) + 300,
          jti: 'rotation-test-k1',
        };
        const k1Token = await rotationServer.signJwtWithClaims('key-v1', k1Claims);
        const k1Result = await validator.validateJwt(k1Token);
        expect(k1Result.iss).toBe('https://auth.honeyjar.xyz');

        // Step 3: Add K2 (key rotation)
        await rotationServer.addKey('key-v2');

        // Step 4: K2 token should PASS (kid-miss triggers refetch, finds K2)
        const k2Claims = {
          ...k1Claims,
          jti: 'rotation-test-k2',
        };
        const k2Token = await rotationServer.signJwtWithClaims('key-v2', k2Claims);
        const k2Result = await validator.validateJwt(k2Token);
        expect(k2Result.iss).toBe('https://auth.honeyjar.xyz');

        // Step 5: Remove K1 from JWKS
        rotationServer.removeKey('key-v1');

        // Step 6: K1 token should REJECT (K1 no longer in JWKS)
        const k1Token2 = await rotationServer.signJwtWithClaims('key-v1', {
          ...k1Claims,
          jti: 'rotation-test-k1-after-removal',
        });
        await expect(validator.validateJwt(k1Token2)).rejects.toThrow();
      } finally {
        await rotationServer.stop();
      }
    });
  });

  // --------------------------------------------------------------------------
  // Behavioral: jwt-jwks-timeout
  // --------------------------------------------------------------------------

  describe('jwt-jwks-timeout', () => {
    it('should handle JWKS timeout: cached K1 accepts, unknown K3 rejects', async () => {
      const timeoutServer = new JwksTestServer();
      await timeoutServer.start();

      try {
        // Controllable clock for deterministic timing
        let currentTime = Date.now();
        const clock: Clock = { now: () => currentTime };

        // Step 1: Add K1 and populate cache
        await timeoutServer.addKey('known-kid');
        const validator = createTestValidator(timeoutServer.getJwksUri(), {
          jwksCacheTtlMs: 5_000,
          jwksStaleMaxMs: 60_000,
          jwksRefreshCooldownMs: 0,
        }, clock);

        // Step 2: K1 validation populates cache
        const k1Claims = {
          iss: 'https://auth.honeyjar.xyz',
          aud: 'loa-finn',
          sub: 'test-user',
          purpose: 'invoke',
          iat: Math.floor(currentTime / 1000),
          exp: Math.floor(currentTime / 1000) + 300,
          jti: 'timeout-test-k1',
        };
        const k1Token = await timeoutServer.signJwtWithClaims('known-kid', k1Claims);
        const k1Result = await validator.validateJwt(k1Token);
        expect(k1Result.iss).toBe('https://auth.honeyjar.xyz');

        // Step 3: Block JWKS endpoint
        timeoutServer.setBlocked(true);

        // Advance time past cache TTL but within stale max
        currentTime += 5_500;

        // Step 4: Cached K1 should ACCEPT (stale-if-error within 60s stale max)
        const k1Token2 = await timeoutServer.signJwtWithClaims('known-kid', {
          ...k1Claims,
          jti: 'timeout-test-k1-cached',
          iat: Math.floor(currentTime / 1000),
          exp: Math.floor(currentTime / 1000) + 300,
        });
        const k1CachedResult = await validator.validateJwt(k1Token2);
        expect(k1CachedResult.iss).toBe('https://auth.honeyjar.xyz');

        // Step 5: Unknown K3 should REJECT (kid-miss triggers refetch → blocked → fails)
        // We need a K3 key to sign with, but it won't be in the JWKS
        const tempServer = new JwksTestServer();
        await tempServer.start();
        await tempServer.addKey('unknown-kid');
        const k3Token = await tempServer.signJwtWithClaims('unknown-kid', {
          ...k1Claims,
          jti: 'timeout-test-k3',
          iat: Math.floor(currentTime / 1000),
          exp: Math.floor(currentTime / 1000) + 300,
        });
        await tempServer.stop();

        await expect(validator.validateJwt(k3Token)).rejects.toThrow();
      } finally {
        await timeoutServer.stop();
      }
    });
  });
});

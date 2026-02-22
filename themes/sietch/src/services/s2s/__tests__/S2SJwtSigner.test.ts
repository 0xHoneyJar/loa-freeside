/**
 * S2SJwtSigner Tests — Cycle 036, Sprint 1 (326), Task 1.3
 *
 * Tests ES256 JWT signing for service-to-service communication.
 * Verifies:
 *   - JWT contains required claims (iss, aud, iat, exp, custom)
 *   - TTL enforced at 60s
 *   - ES256 signature is valid and verifiable
 *   - Ephemeral key generation works for local dev
 *   - Signed JWT can be verified against the public key
 *
 * @see SDD §1.9 Security Architecture
 * @see SDD §5.2 S2S Contract
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as jose from 'jose';

// Mock the database and logger before importing the module
vi.mock('../../../db/index.js', () => ({
  getDatabase: () => ({
    prepare: () => ({
      all: () => [],
      run: () => ({ changes: 1 }),
      get: () => null,
    }),
  }),
}));

vi.mock('../../../db/connection.js', () => ({
  getDatabase: () => ({
    prepare: () => ({
      all: () => [],
      run: () => ({ changes: 1 }),
      get: () => null,
    }),
  }),
}));

vi.mock('../../../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock JwksService to prevent DB calls
vi.mock('../JwksService.js', () => ({
  insertPublicKey: vi.fn(),
  resetJwksCache: vi.fn(),
}));

import {
  initS2SJwtSigner,
  signS2SJwt,
  getSigningPublicKeyJwk,
  getActiveKid,
  isSignerReady,
  resetSigner,
} from '../S2SJwtSigner.js';
import type { S2SJwtClaims } from '../S2SJwtSigner.js';

describe('S2SJwtSigner', () => {
  beforeEach(() => {
    resetSigner();
    // Clear env vars
    delete process.env.S2S_SIGNING_KEY_PRIVATE;
    delete process.env.S2S_SIGNING_KEY_KID;
    process.env.NODE_ENV = 'development';
  });

  afterEach(() => {
    resetSigner();
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // Initialization
  // -------------------------------------------------------------------------

  describe('initS2SJwtSigner', () => {
    it('generates ephemeral keypair in development mode', async () => {
      await initS2SJwtSigner();

      expect(isSignerReady()).toBe(true);
      expect(getActiveKid()).toBeTruthy();
      expect(getActiveKid()!.startsWith('freeside-ephemeral-')).toBe(true);
    });

    it('throws in production without env vars', async () => {
      process.env.NODE_ENV = 'production';

      await expect(initS2SJwtSigner()).rejects.toThrow(
        'S2S_SIGNING_KEY_PRIVATE and S2S_SIGNING_KEY_KID must be set in production',
      );
    });

    it('loads key from environment when configured', async () => {
      // Generate a test keypair
      const { privateKey } = await jose.generateKeyPair('ES256', { extractable: true });
      const privatePem = await jose.exportPKCS8(privateKey);

      process.env.S2S_SIGNING_KEY_PRIVATE = privatePem;
      process.env.S2S_SIGNING_KEY_KID = 'test-key-123';

      await initS2SJwtSigner();

      expect(isSignerReady()).toBe(true);
      expect(getActiveKid()).toBe('test-key-123');
    });
  });

  // -------------------------------------------------------------------------
  // JWT Signing
  // -------------------------------------------------------------------------

  describe('signS2SJwt', () => {
    const testClaims: S2SJwtClaims = {
      nft_id: '42',
      tier: 'diamond',
      community_id: 'comm_xyz',
      budget_reservation_id: 'res_abc123',
    };

    it('throws if signer not initialized', async () => {
      await expect(signS2SJwt(testClaims)).rejects.toThrow(
        'S2S JWT signer not initialized',
      );
    });

    it('produces a valid JWT string', async () => {
      await initS2SJwtSigner();
      const jwt = await signS2SJwt(testClaims);

      expect(typeof jwt).toBe('string');
      // JWT has 3 base64url-encoded parts
      const parts = jwt.split('.');
      expect(parts).toHaveLength(3);
    });

    it('JWT contains correct standard claims', async () => {
      await initS2SJwtSigner();
      const jwt = await signS2SJwt(testClaims);

      // Decode without verification to inspect claims
      const decoded = jose.decodeJwt(jwt);

      expect(decoded.iss).toBe('loa-freeside');
      expect(decoded.aud).toBe('loa-finn');
      expect(decoded.iat).toBeDefined();
      expect(decoded.exp).toBeDefined();
    });

    it('JWT TTL is exactly 60 seconds', async () => {
      await initS2SJwtSigner();
      const jwt = await signS2SJwt(testClaims);

      const decoded = jose.decodeJwt(jwt);
      const ttl = (decoded.exp as number) - (decoded.iat as number);

      expect(ttl).toBe(60);
    });

    it('JWT contains custom claims', async () => {
      await initS2SJwtSigner();
      const jwt = await signS2SJwt(testClaims);

      const decoded = jose.decodeJwt(jwt);

      expect(decoded.nft_id).toBe('42');
      expect(decoded.tier).toBe('diamond');
      expect(decoded.community_id).toBe('comm_xyz');
      expect(decoded.budget_reservation_id).toBe('res_abc123');
    });

    it('JWT header specifies ES256 algorithm and kid', async () => {
      await initS2SJwtSigner();
      const jwt = await signS2SJwt(testClaims);

      const header = jose.decodeProtectedHeader(jwt);

      expect(header.alg).toBe('ES256');
      expect(header.kid).toBeTruthy();
      expect(header.typ).toBe('JWT');
    });

    it('JWT is verifiable against the signing public key', async () => {
      await initS2SJwtSigner();
      const jwt = await signS2SJwt(testClaims);

      // Get the public key
      const publicJwk = await getSigningPublicKeyJwk();
      expect(publicJwk).toBeTruthy();

      const publicKey = await jose.importJWK(publicJwk!, 'ES256');

      // Verify the JWT
      const { payload } = await jose.jwtVerify(jwt, publicKey, {
        issuer: 'loa-freeside',
        audience: 'loa-finn',
      });

      expect(payload.nft_id).toBe('42');
      expect(payload.tier).toBe('diamond');
    });

    it('JWT verification fails with wrong audience', async () => {
      await initS2SJwtSigner();
      const jwt = await signS2SJwt(testClaims);

      const publicJwk = await getSigningPublicKeyJwk();
      const publicKey = await jose.importJWK(publicJwk!, 'ES256');

      // Should reject wrong audience
      await expect(
        jose.jwtVerify(jwt, publicKey, {
          issuer: 'loa-freeside',
          audience: 'wrong-audience',
        }),
      ).rejects.toThrow();
    });

    it('JWT verification fails with wrong issuer', async () => {
      await initS2SJwtSigner();
      const jwt = await signS2SJwt(testClaims);

      const publicJwk = await getSigningPublicKeyJwk();
      const publicKey = await jose.importJWK(publicJwk!, 'ES256');

      // Should reject wrong issuer
      await expect(
        jose.jwtVerify(jwt, publicKey, {
          issuer: 'wrong-issuer',
          audience: 'loa-finn',
        }),
      ).rejects.toThrow();
    });

    it('each JWT has a unique signature', async () => {
      await initS2SJwtSigner();
      const jwt1 = await signS2SJwt(testClaims);
      const jwt2 = await signS2SJwt(testClaims);

      // ES256 uses random nonce per signature, so same payload = different JWTs
      expect(jwt1).not.toBe(jwt2);
    });
  });

  // -------------------------------------------------------------------------
  // Public Key Export
  // -------------------------------------------------------------------------

  describe('getSigningPublicKeyJwk', () => {
    it('returns null before initialization', async () => {
      const jwk = await getSigningPublicKeyJwk();
      expect(jwk).toBeNull();
    });

    it('returns valid EC JWK after initialization', async () => {
      await initS2SJwtSigner();
      const jwk = await getSigningPublicKeyJwk();

      expect(jwk).toBeTruthy();
      expect(jwk!.kty).toBe('EC');
      expect(jwk!.crv).toBe('P-256');
      expect(jwk!.x).toBeTruthy();
      expect(jwk!.y).toBeTruthy();
      expect(jwk!.kid).toBeTruthy();
      expect(jwk!.use).toBe('sig');
      expect(jwk!.alg).toBe('ES256');
    });

    it('does NOT include private key material', async () => {
      await initS2SJwtSigner();
      const jwk = await getSigningPublicKeyJwk();

      // Must not contain 'd' (private scalar for EC keys)
      expect(jwk!.d).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // State Management
  // -------------------------------------------------------------------------

  describe('state management', () => {
    it('isSignerReady returns false before init', () => {
      expect(isSignerReady()).toBe(false);
    });

    it('isSignerReady returns true after init', async () => {
      await initS2SJwtSigner();
      expect(isSignerReady()).toBe(true);
    });

    it('resetSigner clears state', async () => {
      await initS2SJwtSigner();
      expect(isSignerReady()).toBe(true);

      resetSigner();
      expect(isSignerReady()).toBe(false);
      expect(getActiveKid()).toBeNull();
    });
  });
});

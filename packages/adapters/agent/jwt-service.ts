/**
 * JWT Service
 * Sprint S1-T2: ES256 JWT signing, JWKS endpoint, key rotation
 *
 * Signs JWTs with all required claims from AgentRequestContext.
 * Serves JWKS endpoint with current and previous public keys during rotation.
 *
 * @see SDD §4.2 JWT Service
 * @see Trust Boundary Document §3.2 JWT Claims
 */

import { SignJWT, importPKCS8, exportJWK, type JWK, type KeyLike } from 'jose';
import { v4 as uuidv4 } from 'uuid';
import { createPublicKey, type KeyObject } from 'node:crypto';
import type { AgentRequestContext } from '@arrakis/core/ports';
import { computeReqHash } from './req-hash.js';
import { REAL_CLOCK, type Clock } from './clock.js';

// --------------------------------------------------------------------------
// Tier Name Mapping
// --------------------------------------------------------------------------

/** Human-readable tier names included in JWT for analytics */
const TIER_NAMES: Record<number, string> = {
  1: 'Cub',
  2: 'Worker',
  3: 'Scout',
  4: 'Builder',
  5: 'Elder',
  6: 'Guardian',
  7: 'Keeper',
  8: 'Sovereign',
  9: 'Oracle',
};

// --------------------------------------------------------------------------
// Configuration
// --------------------------------------------------------------------------

/** Previous key retained during rotation overlap */
export interface PreviousKeyConfig {
  /** Key ID of the previous key */
  keyId: string;
  /** Private key (for signing tokens still using old kid) */
  privateKey: KeyLike;
  /** Public JWK for JWKS endpoint */
  publicJwk: JWK;
  /** Expiry time — must be >= rotation time + max token exp + 30s clock skew */
  expiresAt: Date;
}

/** JWT Service configuration */
export interface JwtServiceConfig {
  /** Key ID (kid) for current signing key */
  keyId: string;
  /** Token expiry in seconds (default: 120) */
  expirySec: number;
  /** Previous key for rotation overlap (undefined if not rotating) */
  previousKey?: PreviousKeyConfig;
}

/** Strategy for loading the ES256 private key */
export interface KeyLoader {
  /** Load the PKCS8 PEM-encoded private key */
  load(): Promise<string>;
}

// Clock interface and REAL_CLOCK imported from ./clock.js (S13-T2: shared types extraction)

// --------------------------------------------------------------------------
// JWT Service
// --------------------------------------------------------------------------

export class JwtService {
  private privateKey!: KeyLike;
  private publicJwk!: JWK;
  private initialized = false;
  private readonly clock: Clock;

  constructor(
    private readonly config: JwtServiceConfig,
    private readonly keyLoader: KeyLoader,
    clock?: Clock,
  ) {
    this.clock = clock ?? REAL_CLOCK;
  }

  /**
   * Initialize the service by loading the private key and exporting the public JWK.
   * Must be called before sign() or getJwks().
   */
  async initialize(): Promise<void> {
    const pem = await this.keyLoader.load();
    // ES256 (ECDSA P-256): Chosen over RS256 for shorter signatures (64B vs 256B),
    // faster verification, and NIST P-256 compatibility with JWKS tooling. See SDD §4.2.
    this.privateKey = await importPKCS8(pem, 'ES256');

    // Derive public key and export only public JWK parameters (excludes private `d` field)
    const publicKey = createPublicKey(this.privateKey as KeyObject);
    this.publicJwk = await exportJWK(publicKey);

    this.initialized = true;
  }

  /**
   * Sign a JWT with all required claims from the agent request context.
   *
   * Claims include: tenant_id, nft_id, tier, tier_name, access_level,
   * allowed_model_aliases, platform, channel_id, idempotency_key, req_hash.
   *
   * @param context - Agent request context
   * @param requestBody - Canonical request body for req_hash binding
   * @returns Signed JWT string
   */
  async sign(context: AgentRequestContext, requestBody: string): Promise<string> {
    this.assertInitialized();

    const now = Math.floor(this.clock.now() / 1000);
    const reqHash = computeReqHash(requestBody);

    return new SignJWT({
      tenant_id: context.tenantId,
      nft_id: context.nftId,
      tier: context.tier,
      tier_name: TIER_NAMES[context.tier] ?? `Tier${context.tier}`,
      access_level: context.accessLevel,
      allowed_model_aliases: context.allowedModelAliases,
      platform: context.platform,
      channel_id: context.channelId,
      idempotency_key: context.idempotencyKey,
      req_hash: reqHash,
    })
      .setProtectedHeader({ alg: 'ES256', kid: this.config.keyId, typ: 'JWT' })
      .setIssuer('arrakis')
      .setSubject(context.userId)
      .setAudience('loa-finn')
      .setIssuedAt(now)
      .setExpirationTime(now + this.config.expirySec)
      .setJti(uuidv4())
      .sign(this.privateKey);
  }

  /**
   * Returns JWKS JSON for /.well-known/jwks.json endpoint.
   * Includes current key and previous key during rotation overlap.
   *
   * Cache-Control: public, max-age=3600
   */
  getJwks(): { keys: JWK[] } {
    this.assertInitialized();

    const keys: JWK[] = [
      { ...this.publicJwk, kid: this.config.keyId, use: 'sig', alg: 'ES256', kty: 'EC', crv: 'P-256' },
    ];

    if (this.config.previousKey && this.config.previousKey.expiresAt.getTime() > this.clock.now()) {
      // Strip private parameters (defense-in-depth: publicJwk should already be public-only)
      const { d: _d, ...publicOnly } = this.config.previousKey.publicJwk;
      keys.push({
        ...publicOnly,
        kid: this.config.previousKey.keyId,
        use: 'sig',
        alg: 'ES256',
        kty: 'EC',
        crv: 'P-256',
      });
    }

    return { keys };
  }

  private assertInitialized(): void {
    if (!this.initialized) {
      throw new Error('JwtService not initialized. Call initialize() first.');
    }
  }
}

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

// computeReqHash imported from ./req-hash.js — single source of truth
// for request body hashing. See ADR: Knight Capital anti-pattern avoidance.

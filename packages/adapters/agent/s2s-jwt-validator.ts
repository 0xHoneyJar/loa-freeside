/**
 * S2S JWT Validator — Inbound loa-finn → arrakis authentication
 *
 * Validates ES256 JWTs and verifies JWS compact serialization payloads
 * from loa-finn using remote JWKS with tiered caching.
 *
 * JWKS caching strategy:
 *   - Fresh: < 1h → serve cached
 *   - Stale: 1h–72h → background refresh, serve stale on failure
 *   - Rejected: > 72h stale without successful refresh → hard reject
 *   - Unknown kid: force refresh (respects 60s cooldown)
 *   - Single-flight dedup: one fetch at a time, all callers share result
 *
 * Cross-protocol safety:
 *   - JWT validation enforces typ: "JWT"
 *   - JWS verification rejects typ: "JWT"
 *
 * @see SDD §3.1 S2SJwtValidator
 * @see ADR-005 Budget Unit Convention
 */

import { jwtVerify, compactVerify, importJWK, type JWK, type KeyLike } from 'jose'
import type { Logger } from 'pino'
import type { Clock } from './clock.js'
import { REAL_CLOCK } from './clock.js'

// --------------------------------------------------------------------------
// Types
// --------------------------------------------------------------------------

export interface S2SJwtValidatorConfig {
  /** loa-finn JWKS URL: {LOA_FINN_BASE_URL}/.well-known/jwks.json */
  jwksUrl: string
  /** Expected JWT issuer (default: "loa-finn") */
  expectedIssuer: string
  /** Expected JWT audience (default: "arrakis") */
  expectedAudience: string
  /** JWKS cache TTL in ms (default: 3,600,000 = 1h) */
  jwksCacheTtlMs: number
  /** Max stale-if-error TTL in ms (default: 259,200,000 = 72h) */
  jwksStaleMaxMs: number
  /** Min interval between JWKS refresh attempts in ms (default: 60,000 = 60s) */
  jwksRefreshCooldownMs: number
  /** Clock-skew leeway in seconds for exp/nbf/iat (default: 30) */
  clockToleranceSec: number
}

export interface S2SJwtPayload {
  iss: string
  aud: string
  exp: number
  iat: number
  jti?: string
  purpose: string
  report_id?: string
  /** JWT schema version — @see Bridgebuilder F-10 */
  v?: number
}

interface JwksResponse {
  keys: JWK[]
}

// --------------------------------------------------------------------------
// S2SJwtValidator
// --------------------------------------------------------------------------

export class S2SJwtValidator {
  private cachedJwks: JwksResponse | null = null
  private lastSuccessfulFetch = 0
  private lastRefreshAttempt = 0
  private inflight: Promise<JwksResponse> | null = null

  constructor(
    private readonly config: S2SJwtValidatorConfig,
    private readonly logger: Logger,
    private readonly clock: Clock = REAL_CLOCK,
  ) {}

  /**
   * Validate an S2S JWT bearer token from loa-finn.
   * Enforces: alg=ES256, typ=JWT, iss, aud, exp with clock-skew leeway.
   * @throws Error on invalid/expired/untrusted token
   */
  async validateJwt(token: string): Promise<S2SJwtPayload> {
    const jwks = await this.getJwks()
    const kid = this.extractKid(token)
    const key = await this.resolveKey(kid, jwks)

    const { payload, protectedHeader } = await jwtVerify(token, key, {
      issuer: this.config.expectedIssuer,
      audience: this.config.expectedAudience,
      algorithms: ['ES256'],
      clockTolerance: this.config.clockToleranceSec,
    })

    // Enforce typ: JWT (cross-protocol confusion guard)
    if (protectedHeader.typ !== 'JWT') {
      throw new Error('S2S JWT must have typ: JWT')
    }

    const custom = payload as Record<string, unknown>

    return {
      iss: payload.iss!,
      aud: payload.aud as string,
      exp: payload.exp!,
      iat: payload.iat!,
      jti: payload.jti,
      purpose: custom.purpose as string,
      report_id: custom.report_id as string | undefined,
      v: typeof custom.v === 'number' ? custom.v : undefined,
    }
  }

  /**
   * Verify a JWS compact serialization payload from loa-finn.
   * Enforces: alg=ES256. Rejects typ=JWT (cross-protocol safety).
   * Returns raw payload bytes.
   */
  async verifyJws(jws: string): Promise<Uint8Array> {
    const jwks = await this.getJwks()
    const kid = this.extractKid(jws)
    const key = await this.resolveKey(kid, jwks)

    const { payload, protectedHeader } = await compactVerify(jws, key)

    if (protectedHeader.alg !== 'ES256') {
      throw new Error(`JWS alg must be ES256, got ${protectedHeader.alg}`)
    }

    // Reject typ: JWT on JWS (cross-protocol confusion guard)
    if (protectedHeader.typ === 'JWT') {
      throw new Error('JWS must not have typ: JWT (use validateJwt for JWTs)')
    }

    return payload
  }

  // --------------------------------------------------------------------------
  // JWKS Management
  // --------------------------------------------------------------------------

  /**
   * Get JWKS with tiered caching: fresh (1h) → stale-if-error (72h) → reject.
   * Single-flight dedup prevents thundering herd.
   */
  private async getJwks(forceRefresh = false): Promise<JwksResponse> {
    const now = this.clock.now()

    // Fast path: fresh cache and not forcing refresh
    if (this.cachedJwks && !forceRefresh) {
      const age = now - this.lastSuccessfulFetch
      if (age < this.config.jwksCacheTtlMs) {
        return this.cachedJwks
      }
    }

    // Single-flight dedup — must check BEFORE cooldown so concurrent
    // callers join the inflight request instead of hitting cooldown
    if (this.inflight) {
      return this.inflight
    }

    // Check cooldown
    const sinceLastAttempt = now - this.lastRefreshAttempt
    if (sinceLastAttempt < this.config.jwksRefreshCooldownMs) {
      // In cooldown — serve stale if available and within window
      if (this.cachedJwks) {
        const age = now - this.lastSuccessfulFetch
        if (age < this.config.jwksStaleMaxMs) {
          return this.cachedJwks
        }
      }
      throw new Error('JWKS unavailable: refresh on cooldown and stale cache expired')
    }

    this.inflight = this.fetchJwks(now)
    try {
      return await this.inflight
    } finally {
      this.inflight = null
    }
  }

  private async fetchJwks(now: number): Promise<JwksResponse> {
    this.lastRefreshAttempt = now

    let res: Response
    try {
      res = await fetch(this.config.jwksUrl, {
        signal: AbortSignal.timeout(10_000),
        headers: { Accept: 'application/json' },
      })
    } catch (err) {
      return this.handleFetchFailure(err)
    }

    if (!res.ok) {
      return this.handleFetchFailure(new Error(`JWKS fetch failed: HTTP ${res.status}`))
    }

    const jwks = (await res.json()) as JwksResponse
    if (!jwks.keys || !Array.isArray(jwks.keys) || jwks.keys.length === 0) {
      throw new Error('JWKS response has no keys')
    }

    this.cachedJwks = jwks
    this.lastSuccessfulFetch = this.clock.now()
    this.logger.debug({ url: this.config.jwksUrl, keyCount: jwks.keys.length }, 'JWKS refreshed')
    return jwks
  }

  private handleFetchFailure(err: unknown): JwksResponse {
    this.logger.warn({ err, url: this.config.jwksUrl }, 'JWKS fetch failed')

    // Stale-if-error: serve stale cache within 72h window
    if (this.cachedJwks) {
      const age = this.clock.now() - this.lastSuccessfulFetch
      if (age < this.config.jwksStaleMaxMs) {
        this.logger.info({ staleSec: Math.round(age / 1000) }, 'Serving stale JWKS')
        return this.cachedJwks
      }
    }

    throw new Error('JWKS unavailable: fetch failed and no valid stale cache')
  }

  // --------------------------------------------------------------------------
  // Key Resolution
  // --------------------------------------------------------------------------

  /**
   * Extract kid from a JWT/JWS protected header without full verification.
   * Uses base64url decoding of the first segment.
   */
  private extractKid(token: string): string | undefined {
    const headerB64 = token.split('.')[0]
    if (!headerB64) return undefined
    try {
      const header = JSON.parse(
        new TextDecoder().decode(this.base64UrlDecode(headerB64)),
      )
      return header.kid
    } catch {
      return undefined
    }
  }

  /**
   * Resolve a JWK from the JWKS by kid. If kid not found, force-refresh once.
   */
  private async resolveKey(kid: string | undefined, jwks: JwksResponse): Promise<KeyLike | Uint8Array> {
    let jwk = this.findKey(kid, jwks)

    // Unknown kid → force refresh (single attempt, respects cooldown)
    if (!jwk) {
      this.logger.info({ kid }, 'Unknown kid, forcing JWKS refresh')
      const refreshed = await this.getJwks(true)
      jwk = this.findKey(kid, refreshed)
      if (!jwk) {
        throw new Error(`No matching key found for kid: ${kid ?? 'undefined'}`)
      }
    }

    return importJWK(jwk, 'ES256')
  }

  private findKey(kid: string | undefined, jwks: JwksResponse): JWK | undefined {
    if (kid) {
      return jwks.keys.find((k) => k.kid === kid)
    }
    // No kid in header — use first ES256 key
    return jwks.keys.find((k) => k.alg === 'ES256' || k.kty === 'EC')
  }

  private base64UrlDecode(str: string): Uint8Array {
    const base64 = str.replace(/-/g, '+').replace(/_/g, '/')
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
    const binary = atob(padded)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i)
    }
    return bytes
  }
}

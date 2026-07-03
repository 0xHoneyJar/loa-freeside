/**
 * JwtProducerPolicy — verified svc-JWT → AppendGrant (SDD sandwich-line §6b-3).
 *
 * Algorithm hygiene (sprint blocker cure SKP-005): the accepted algorithm is
 * PINNED to the substrate's ES256 (packages/adapters/agent/jwt-service.ts);
 * `none` and every HS* die at the allowlist (algorithm-confusion killed by
 * construction — jose rejects any alg not in the list). Keys resolve by `kid`
 * against a JWKS (remote URL with jose's built-in cooldown cache ≤5min, or an
 * inline JWK set for single-key deploys). Claims are zod-validated; unknown
 * shape = reject.
 */

import { createLocalJWKSet, createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { z } from 'zod';
import { AppendGrant, GrantError } from './append-grant.js';

export const PINNED_ALG = 'ES256';
export const PRODUCER_AUDIENCE = 'shadow-mode-ledger';

const ClaimsSchema = z.object({
  producer_id: z.string().min(1),
  sources: z.array(z.string().min(1)).min(1),
  event_names: z.array(z.string().min(1)).min(1),
});

export interface JwtProducerPolicyConfig {
  issuer: string;
  /** Remote JWKS url (preferred; jose caches with cooldown) … */
  jwksUrl?: string;
  /** … or an inline JWK set JSON (single-key deploys). */
  jwks?: { keys: unknown[] };
  audience?: string;
  clockToleranceSec?: number;
}

export class JwtProducerPolicy {
  private readonly getKey: JWTVerifyGetKey;

  constructor(private readonly config: JwtProducerPolicyConfig) {
    if (config.jwksUrl) {
      this.getKey = createRemoteJWKSet(new URL(config.jwksUrl), {
        cooldownDuration: 5 * 60 * 1000,
      });
    } else if (config.jwks) {
      this.getKey = createLocalJWKSet(config.jwks as Parameters<typeof createLocalJWKSet>[0]);
    } else {
      throw new Error('JwtProducerPolicy requires jwksUrl or jwks');
    }
  }

  /** Verify the token and mint the scoped grant. Throws GrantError on ANY failure. */
  async authorize(token: string): Promise<AppendGrant> {
    let payload: unknown;
    try {
      const verified = await jwtVerify(token, this.getKey, {
        algorithms: [PINNED_ALG], // hard allowlist: none/HS* structurally rejected
        issuer: this.config.issuer,
        audience: this.config.audience ?? PRODUCER_AUDIENCE,
        clockTolerance: this.config.clockToleranceSec ?? 60,
        maxTokenAge: '1h',
      });
      payload = verified.payload;
      // maxTokenAge bounds how OLD a token is; also cap total lifetime exp-iat ≤ 1h
      // so a far-future exp can't grant a long-lived credential (FAGAN S2).
      const { iat, exp } = verified.payload;
      if (typeof iat !== 'number' || typeof exp !== 'number' || exp - iat > 3600) {
        throw new Error('token lifetime exceeds 1h (exp - iat)');
      }
    } catch (err) {
      throw new GrantError(`producer token rejected: ${err instanceof Error ? err.message : 'verify failed'}`);
    }
    const claims = ClaimsSchema.safeParse(payload);
    if (!claims.success) {
      throw new GrantError('producer token rejected: claims shape invalid');
    }
    return AppendGrant._mint(claims.data.producer_id, claims.data.sources, claims.data.event_names);
  }
}

export function jwtProducerPolicyFromEnv(env: NodeJS.ProcessEnv = process.env): JwtProducerPolicy | null {
  const issuer = env.PRODUCER_JWT_ISSUER?.trim();
  const jwksUrl = env.PRODUCER_JWKS_URL?.trim();
  const jwksInline = env.PRODUCER_JWKS?.trim();
  if (!issuer || (!jwksUrl && !jwksInline)) return null;
  return new JwtProducerPolicy({
    issuer,
    jwksUrl: jwksUrl || undefined,
    jwks: jwksInline ? JSON.parse(jwksInline) : undefined,
  });
}

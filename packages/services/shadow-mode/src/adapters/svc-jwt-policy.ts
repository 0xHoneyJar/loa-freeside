/**
 * SvcJwtProducerPolicy — the DEPLOYED producer-auth policy (SDD 6b-3).
 *
 * Implements IProducerPolicy by verifying `ctx.bearerToken` through
 * JwtProducerPolicy and returning the minted grant. This is what a deployed
 * shadow-mode server MUST use (via producerPolicyFromEnv) so the HTTP ingress
 * cannot bypass JWT auth — StaticProducerPolicy remains a structural-only gate
 * for in-process/library use where no transport token exists.
 */

import type { IProducerPolicy, PolicyContext, PolicyResult } from '../ports/producer-policy.js';
import { JwtProducerPolicy, jwtProducerPolicyFromEnv } from '../auth/jwt-producer-policy.js';
import { StaticProducerPolicy } from './static-producer-policy.js';

export class SvcJwtProducerPolicy implements IProducerPolicy {
  constructor(private readonly jwt: JwtProducerPolicy) {}

  async verifyProducer(ctx: PolicyContext): Promise<PolicyResult> {
    if (!ctx.bearerToken) return { ok: false, reason: 'no_token' };
    try {
      const grant = await this.jwt.authorize(ctx.bearerToken);
      // Defense in depth: the token's scope must cover THIS event AND community.
      if (!grant.allows(ctx.source, ctx.name)) return { ok: false, reason: 'unauthorized_source' };
      if (!grant.allowsCommunity(ctx.communityId)) return { ok: false, reason: 'cross_community' };
      return { ok: true, grant };
    } catch {
      return { ok: false, reason: 'token_rejected' };
    }
  }
}

/**
 * The deployed policy: JWT-verified when PRODUCER_JWT_ISSUER + JWKS are set,
 * else the fail-closed structural StaticProducerPolicy. A deployed server that
 * wants real producer-auth MUST set the env; otherwise it runs structural-only
 * and that fact is observable (this factory is the single wiring point).
 */
export function producerPolicyFromEnv(env: NodeJS.ProcessEnv = process.env): IProducerPolicy {
  const jwt = jwtProducerPolicyFromEnv(env);
  if (jwt) return new SvcJwtProducerPolicy(jwt);
  // No JWT config → structural-only StaticProducerPolicy, which is NOT a
  // transport-auth boundary. It is NEVER a silent default (FAGAN S2 crit): an
  // operator must EXPLICITLY opt in with SHADOW_MODE_ALLOW_STRUCTURAL_POLICY=1
  // (intended only for in-process/library or a trusted-network deploy). Absent
  // that flag we fail closed regardless of any environment marker.
  if (env.SHADOW_MODE_ALLOW_STRUCTURAL_POLICY === '1') return new StaticProducerPolicy();
  throw new Error(
    'producer-auth not configured (set PRODUCER_JWT_ISSUER + PRODUCER_JWKS[_URL] for real auth, ' +
      'or SHADOW_MODE_ALLOW_STRUCTURAL_POLICY=1 to explicitly accept the structural-only gate)',
  );
}
